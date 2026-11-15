#!/usr/bin/env python3
"""Check and stage the reviewed Vault fix against the deployed source. No deploy."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PROJECT = 'takodeal-pos'
REGION = 'asia-southeast1'
MANIFEST = ROOT / 'tools/personal-vault-release-manifest.json'

class ReleaseCheckError(Exception):
    pass

def digest(value):
    return hashlib.sha256(value).hexdigest()

def cloud(*arguments):
    result = subprocess.run(['gcloud', *arguments], capture_output=True, text=True)
    if result.returncode:
        # Do not echo raw cloud responses, environment values or auth diagnostics.
        raise ReleaseCheckError('Google Cloud command failed. Check Cloud Shell authorization and source-storage access.')
    return result.stdout

def describe(name):
    return json.loads(cloud('functions', 'describe', name, '--v2', '--project='+PROJECT,
                            '--region='+REGION, '--format=json'))

def validate_metadata(name, metadata, spec):
    expected = f'projects/{PROJECT}/locations/{REGION}/functions/{name}'
    build = metadata.get('buildConfig', {})
    service = metadata.get('serviceConfig', {})
    if metadata.get('name') != expected or metadata.get('state') != 'ACTIVE' or metadata.get('environment') != 'GEN_2':
        raise ReleaseCheckError(name+': expected an existing ACTIVE generation-2 function in the TAKODEAL project.')
    if build.get('runtime') != 'nodejs22' or build.get('entryPoint') != name:
        raise ReleaseCheckError(name+': runtime or entry point changed; review is required.')
    if service.get('serviceAccountEmail') != spec['serviceAccount']:
        raise ReleaseCheckError(name+': runtime service account differs from the reviewed account; review is required.')
    if metadata.get('eventTrigger'):
        raise ReleaseCheckError(name+': an unexpected event trigger needs review.')
    source = build.get('sourceProvenance', {}).get('resolvedStorageSource') or build.get('source', {}).get('storageSource')
    if not isinstance(source, dict) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,221}', source.get('bucket', '')):
        raise ReleaseCheckError(name+': the deployed source archive is unavailable.')
    obj = source.get('object')
    if not isinstance(obj, str) or not obj or len(obj) > 2048 or any(ord(c) < 32 for c in obj) or '#' in obj:
        raise ReleaseCheckError(name+': invalid source archive reference.')
    generation = str(source.get('generation', ''))
    if not generation.isdigit():
        raise ReleaseCheckError(name+': a fixed source generation is required.')
    return 'gs://'+source['bucket']+'/'+obj+'#'+generation

def stage_bundle(name, archive_path, spec, repo_root, target):
    # Validate the archive without executing any deployed code.
    if archive_path.stat().st_size > 64*1024*1024:
        raise ReleaseCheckError(name+': source archive is too large for this bounded check.')
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if len(infos) > 10000 or sum(info.file_size for info in infos) > 128*1024*1024:
            raise ReleaseCheckError(name+': source archive exceeds the bounded check.')
        names = {}
        for info in infos:
            normalized = info.filename[2:] if info.filename.startswith('./') else info.filename
            path = PurePosixPath(normalized)
            mode = stat.S_IFMT(info.external_attr >> 16)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename or any(ord(c) < 32 for c in info.filename) or mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ReleaseCheckError(name+': unsafe archive entry.')
            canonical = str(path)+('/' if info.is_dir() else '')
            if normalized != canonical:
                raise ReleaseCheckError(name+': noncanonical archive path.')
            if str(path) in names:
                raise ReleaseCheckError(name+': duplicate archive entry.')
            names[str(path)] = info
        # Google archives normally use the function root; permit one named root.
        roots = []
        for filename, info in names.items():
            if PurePosixPath(filename).name != 'package.json' or 'node_modules' in PurePosixPath(filename).parts:
                continue
            try:
                package = json.loads(archive.read(info))
            except (ValueError, KeyError):
                continue
            if package.get('name') == spec['packageName']:
                roots.append(filename[:-len('package.json')])
        if len(roots) != 1:
            raise ReleaseCheckError(name+': function source root is ambiguous.')
        prefix = roots[0]
        mismatches = []
        for relative, hashes in spec['files'].items():
            candidate = repo_root / spec['directory'] / relative
            if not candidate.is_file() or digest(candidate.read_bytes()) != hashes['candidate']:
                raise ReleaseCheckError(name+': checked-out candidate source was changed: '+relative)
            deployed = prefix+relative
            current = digest(archive.read(names[deployed])) if deployed in names else None
            if current not in (hashes['baseline'], hashes['candidate']):
                mismatches.append(relative)
        if mismatches:
            raise ReleaseCheckError(name+': deployed source differs from the reviewed baseline in '+', '.join(mismatches[:12])+'. Nothing was deployed.')
        target.mkdir(mode=0o700)
        for filename, info in names.items():
            if not filename.startswith(prefix) or info.is_dir():
                continue
            relative = PurePosixPath(filename[len(prefix):])
            if '.git' in relative.parts or 'node_modules' in relative.parts:
                continue
            destination = target / str(relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(info))
        # Retain deployed files; replace only the reviewed source changes.
        for relative, hashes in spec['files'].items():
            if hashes['baseline'] != hashes['candidate']:
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(repo_root / spec['directory'] / relative, destination)

def main():
    manifest = json.loads(MANIFEST.read_text())
    work = Path(tempfile.mkdtemp(prefix='takodeal-vault-stage-', dir=Path.home()))
    results = []
    for name, spec in manifest['functions'].items():
        print('Checking '+name+'...', flush=True)
        metadata = describe(name)
        uri = validate_metadata(name, metadata, spec)
        archive = work / (name+'.zip')
        cloud('storage', 'cp', uri, str(archive), '--quiet')
        target = work / name
        stage_bundle(name, archive, spec, ROOT, target)
        # Detect a concurrent deployment during source download/staging.
        fresh = describe(name)
        if fresh.get('updateTime') != metadata.get('updateTime') or validate_metadata(name, fresh, spec) != uri:
            raise ReleaseCheckError(name+': deployment changed during the check; retry before publishing.')
        service = metadata['serviceConfig']
        results.append({'name':name, 'source':str(target), 'updateTime':metadata.get('updateTime'),
                        'runtime':metadata['buildConfig']['runtime'],
                        'serviceAccount':service['serviceAccountEmail'],
                        'memory':service.get('availableMemory'), 'cpu':service.get('availableCpu'),
                        'timeout':service.get('timeoutSeconds'), 'concurrency':service.get('maxInstanceRequestConcurrency'),
                        'minInstances':service.get('minInstanceCount',0), 'maxInstances':service.get('maxInstanceCount'),
                        'ingress':service.get('ingressSettings')})
        print('READY '+name+': deployed source matches the reviewed baseline; PIN changes staged.', flush=True)
    state = {'project':PROJECT, 'region':REGION, 'candidateSource':manifest['candidateSource'], 'functions':results}
    marker = work / 'ready.json'
    marker.write_text(json.dumps(state, indent=2)+'\n')
    os.chmod(marker,0o600)
    print('CHECK PASSED. Nothing was deployed.')
    print('STAGE: '+str(work))
    for result in results:
        print(json.dumps({key:result[key] for key in ['name','runtime','memory','timeout','concurrency','minInstances','maxInstances','ingress','serviceAccount']}))

if __name__ == '__main__':
    try:
        main()
    except (ReleaseCheckError, ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        if isinstance(error, ReleaseCheckError):
            print('CHECK BLOCKED: '+str(error), file=sys.stderr)
        else:
            print('CHECK BLOCKED: source/configuration could not be verified. Nothing was deployed.', file=sys.stderr)
        sys.exit(1)
