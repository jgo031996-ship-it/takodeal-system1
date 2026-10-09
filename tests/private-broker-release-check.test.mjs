import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyBrokerRelease,RELEASE_FILES} from '../tools/private-broker-release-check.mjs';

async function reviewFixture(t) {
    const root=await mkdtemp(resolve(tmpdir(),'broker-reviewed-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resolve(root,'functions/staff-document-broker'),{recursive:true});
    const fixture={
        'firebase.broker.json':JSON.stringify({functions:[{source:'functions/staff-document-broker',codebase:'staff-documents'}]}),
        'functions/staff-document-broker/broker.mjs':'// reviewed model',
        'functions/staff-document-broker/index.mjs':'// reviewed wrapper',
        'functions/staff-document-broker/package.json':JSON.stringify({main:'index.mjs',engines:{node:'22'},dependencies:{'firebase-admin':'14.5.0','firebase-functions':'7.4.0'}}),
        'functions/staff-document-broker/package-lock.json':JSON.stringify({packages:{'node_modules/firebase-admin':{version:'14.5.0'},'node_modules/firebase-functions':{version:'7.4.0'},'node_modules/@google-cloud/firestore':{},'node_modules/@google-cloud/storage':{}}})
    },manifest={schemaVersion:1,project:'takodeal-pos',codebase:'staff-documents',reviewedCommit:'a'.repeat(40),files:[]};
    for(const path of RELEASE_FILES) {await writeFile(resolve(root,path),fixture[path]);manifest.files.push({path,sha256:createHash('sha256').update(fixture[path]).digest('hex')});}
    await writeFile(resolve(root,'private-broker-reviewed.json'),JSON.stringify(manifest));return {root,manifest};
}
test('release gate fails closed before a final reviewed manifest/real dependency lock exists',async t=>{
    const root=await mkdtemp(resolve(tmpdir(),'broker-no-review-'));t.after(()=>rm(root,{recursive:true,force:true}));await assert.rejects(verifyBrokerRelease(root,{loadSdk:false}),/reviewed broker manifest/);
    const ready=await reviewFixture(t);await rm(resolve(ready.root,'functions/staff-document-broker/package-lock.json'));await assert.rejects(verifyBrokerRelease(ready.root,{loadSdk:false}),/Required reviewed file missing/);
});
test('release gate verifies exact reviewed file bytes and functions-only codebase',async t=>{
    const {root}=await reviewFixture(t);assert.equal(await verifyBrokerRelease(root,{loadSdk:false}),'a'.repeat(40));
    await writeFile(resolve(root,'functions/staff-document-broker/broker.mjs'),'// changed after review');await assert.rejects(verifyBrokerRelease(root,{loadSdk:false}),/Reviewed source changed/);
});
test('release gate rejects traversal/duplicate or unrelated resource manifests',async t=>{
    const {root,manifest}=await reviewFixture(t);manifest.files[0].path='../private-key.json';await writeFile(resolve(root,'private-broker-reviewed.json'),JSON.stringify(manifest));await assert.rejects(verifyBrokerRelease(root,{loadSdk:false}),/manifest is invalid/);
    const next=await reviewFixture(t),path='firebase.broker.json',value=JSON.stringify({functions:[{source:'functions/staff-document-broker',codebase:'staff-documents'}],storage:{rules:'storage.rules'}});
    await writeFile(resolve(next.root,path),value);next.manifest.files.find(file=>file.path===path).sha256=createHash('sha256').update(value).digest('hex');await writeFile(resolve(next.root,'private-broker-reviewed.json'),JSON.stringify(next.manifest));await assert.rejects(verifyBrokerRelease(next.root,{loadSdk:false}),/only the reviewed broker/);
});
test('release gate requires actual installed SDKs unless test seam explicitly disables them',async t=>{
    const {root}=await reviewFixture(t);await assert.rejects(verifyBrokerRelease(root),/ENOENT/);
    const lock=JSON.parse(await readFile(resolve(root,'functions/staff-document-broker/package-lock.json'),'utf8'));assert.equal(lock.packages['node_modules/firebase-admin'].version,'14.5.0');
});
