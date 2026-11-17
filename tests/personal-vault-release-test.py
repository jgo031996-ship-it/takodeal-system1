import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('vault_release', Path(__file__).resolve().parent.parent/'tools/personal-vault-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class SourceAudit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root/'repo'
        (self.repo/'function').mkdir(parents=True)
        self.package = json.dumps({'name':'synthetic-package'}).encode()
        self.before = b'export const ownVersion = 1;\n'
        self.after = b'export const ownVersion = 2;\n'
        self.helper = b'export const helper = true;\n'
        self.config = {'directory':'function','packageName':'synthetic-package','serviceAccount':'staff-device-setup@takodeal-pos.iam.gserviceaccount.com','files':{
            'package.json':{'baseline':release.digest(self.package),'candidate':release.digest(self.package)},
            'index.mjs':{'baseline':release.digest(self.before),'candidate':release.digest(self.after)},
            'helper.mjs':{'baseline':None,'candidate':release.digest(self.helper)}}}
        for name, data in [('package.json',self.package),('index.mjs',self.after),('helper.mjs',self.helper)]:
            (self.repo/'function'/name).write_bytes(data)
        self.archive = self.root/'source.zip'
        self.metadata = {'name':'projects/takodeal-pos/locations/asia-southeast1/functions/staffDeviceSetup','state':'ACTIVE','environment':'GEN_2','buildConfig':{'runtime':'nodejs22','entryPoint':'staffDeviceSetup','source':{'storageSource':{'bucket':'synthetic-bucket','object':'source.zip','generation':'12345'}}},'serviceConfig':{'serviceAccountEmail':self.config['serviceAccount']}}
    def tearDown(self):
        self.temp.cleanup()
    def bundle(self, prefix='', replace=None, extra=None):
        files={'package.json':self.package,'index.mjs':self.before,'other-preserved.txt':b'unchanged'}
        files.update(replace or {})
        with zipfile.ZipFile(self.archive,'w') as archive:
            for name, data in files.items():
                archive.writestr(prefix+name,data)
            for name, data in (extra or {}).items():
                archive.writestr(name,data)
    def stage(self):
        release.stage_bundle('staffDeviceSetup', self.archive,self.config,self.repo,self.root/'stage')
    def test_manifest_matches_every_reviewed_runtime_file(self):
        manifest=json.loads(release.MANIFEST.read_text())
        for function in manifest['functions'].values():
            for relative, hashes in function['files'].items():
                self.assertEqual(release.digest((release.ROOT/function['directory']/relative).read_bytes()),hashes['candidate'],relative)
    def test_deployed_source_is_staged_with_only_reviewed_files_replaced(self):
        self.bundle();self.stage()
        self.assertEqual((self.root/'stage/index.mjs').read_bytes(),self.after)
        self.assertEqual((self.root/'stage/helper.mjs').read_bytes(),self.helper)
        self.assertEqual((self.root/'stage/other-preserved.txt').read_bytes(),b'unchanged')
    def test_nested_and_dot_prefixed_roots_work(self):
        for prefix in ['source/','./']:
            with self.subTest(prefix=prefix):
                self.bundle(prefix=prefix)
                target=self.root/('stage-'+str(len(prefix)))
                release.stage_bundle('staffDeviceSetup',self.archive,self.config,self.repo,target)
                self.assertEqual((target/'index.mjs').read_bytes(),self.after)
    def test_already_applied_candidate_is_idempotent(self):
        self.bundle(replace={'index.mjs':self.after,'helper.mjs':self.helper});self.stage()
        self.assertEqual((self.root/'stage/index.mjs').read_bytes(),self.after)
    def test_complete_inventory_blocks_extra_source_before_staging(self):
        self.config['completeSourceInventory']=True
        self.bundle(extra={'unexpected.mjs':b'export {}'})
        with self.assertRaises(release.ReleaseCheckError):self.stage()
        self.assertFalse((self.root/'stage').exists())
    def test_complete_inventory_accepts_known_nested_files_and_ignores_dependencies(self):
        self.config['completeSourceInventory']=True
        content=b'unchanged'
        (self.repo/'function/other-preserved.txt').write_bytes(content)
        self.config['files']['other-preserved.txt']={'baseline':release.digest(content),'candidate':release.digest(content)}
        self.bundle(prefix='source/',extra={'source/node_modules/package/helper.mjs':b'export {}'})
        self.stage()
        self.assertEqual((self.root/'stage/helper.mjs').read_bytes(),self.helper)
    def test_deployed_verification_rejects_baseline_and_mixed_state_and_writes_no_stage(self):
        for changes,success in [({},False),({'index.mjs':self.after},False),({'index.mjs':self.after,'helper.mjs':self.helper},True)]:
            with self.subTest(changes=changes):
                self.bundle(replace=changes)
                def verify():
                    release.stage_bundle('staffDeviceSetup',self.archive,self.config,self.repo,self.root/'stage',require_candidate=True)
                if success:verify()
                else:
                    with self.assertRaises(release.ReleaseCheckError):verify()
                self.assertFalse((self.root/'stage').exists())
    def test_unknown_deployed_or_locally_edited_source_blocks_before_staging(self):
        for where in ['deployed','local']:
            with self.subTest(where=where):
                self.bundle(replace={'index.mjs':b'other changes'} if where=='deployed' else None)
                if where=='local':(self.repo/'function/index.mjs').write_bytes(b'local edit')
                with self.assertRaises(release.ReleaseCheckError):self.stage()
                self.assertFalse((self.root/'stage').exists())
    def test_archive_traversal_aliases_and_symlinks_are_rejected(self):
        for name in ['../escape','/absolute','source/../escape','foo/./bar','double//slash','bad\\path']:
            with self.subTest(name=name):
                self.bundle(extra={name:b'bad'})
                with self.assertRaises(release.ReleaseCheckError):self.stage()
        self.bundle()
        with zipfile.ZipFile(self.archive,'a') as archive:
            entry=zipfile.ZipInfo('symlink');entry.create_system=3;entry.external_attr=(stat.S_IFLNK|0o777)<<16;archive.writestr(entry,'/outside')
        with self.assertRaises(release.ReleaseCheckError):self.stage()
    def test_normalized_duplicate_paths_are_rejected(self):
        self.bundle(extra={'./index.mjs':self.before})
        with self.assertRaises(release.ReleaseCheckError):self.stage()
    def test_foreign_project_runtime_and_identity_are_rejected(self):
        self.assertEqual(release.validate_metadata('staffDeviceSetup',self.metadata,self.config),'gs://synthetic-bucket/source.zip#12345')
        for part,key,value in [(None,'name','projects/other/locations/asia-southeast1/functions/staffDeviceSetup'),(None,'state','FAILED'),(None,'environment','GEN_1'),('buildConfig','runtime','nodejs20'),('buildConfig','entryPoint','other'),('serviceConfig','serviceAccountEmail','other@takodeal-pos.iam.gserviceaccount.com')]:
            candidate=copy.deepcopy(self.metadata)
            (candidate if part is None else candidate[part])[key]=value
            with self.assertRaises(release.ReleaseCheckError):release.validate_metadata('staffDeviceSetup',candidate,self.config)
    def test_fixed_storage_generation_and_safe_uri_are_required(self):
        for key,value in [('generation',''),('generation','bad'),('bucket','bad/bucket'),('object','source.zip#other'),('object','bad\nsource')]:
            candidate=copy.deepcopy(self.metadata);candidate['buildConfig']['source']['storageSource'][key]=value
            with self.assertRaises(release.ReleaseCheckError):release.validate_metadata('staffDeviceSetup',candidate,self.config)

if __name__=='__main__':unittest.main()
