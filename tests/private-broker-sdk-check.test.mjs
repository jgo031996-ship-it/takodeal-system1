import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {guardSdkImport,assertBrokerEndpoint} from '../tools/private-broker-sdk-check.mjs';

test('SDK verification blocks network, subprocess and ADC/config file reads, then restores builtins',async()=>{
    const original={http:http.get,https:https.request,connect:net.Socket.prototype.connect,read:fs.readFileSync,fetch:globalThis.fetch};
    const restore=guardSdkImport();
    try {
        assert.throws(()=>http.get('http://must-not-contact.invalid'),/prohibited/);
        assert.throws(()=>https.request('https://must-not-contact.invalid'),/prohibited/);
        assert.throws(()=>new net.Socket().connect(1,'127.0.0.1'),/prohibited/);
        assert.throws(()=>dns.lookup('must-not-contact.invalid',()=>{}),/prohibited/);
        assert.throws(()=>childProcess.execFile('gcloud',[]),/prohibited/);
        assert.throws(()=>globalThis.fetch('https://must-not-contact.invalid'),/prohibited/);
        for(const path of ['C:/synthetic/gcloud/private.json','C:/synthetic/application_default_credentials.json','C:/synthetic/configstore/firebase-tools.json'])assert.throws(()=>fs.readFileSync(path),/Credential-file access is prohibited/);
        await assert.rejects(fsPromises.readFile('C:/synthetic/application_default_credentials.json'),/Credential-file access is prohibited/);
        const source=fs.readFileSync(new URL('../functions/staff-document-broker/package.json',import.meta.url),'utf8');assert.equal(JSON.parse(source).engines.node,'22');
    } finally {restore();}
    assert.equal(http.get,original.http);assert.equal(https.request,original.https);assert.equal(net.Socket.prototype.connect,original.connect);assert.equal(fs.readFileSync,original.read);assert.equal(globalThis.fetch,original.fetch);
});
test('real endpoint audit refuses scale, origin-independent invoker, service account or runtime drift',()=>{
    const expected={platform:'gcfv2',region:['asia-southeast1'],serviceAccountEmail:'staff-document-broker@takodeal-pos.iam.gserviceaccount.com',availableMemoryMb:256,cpu:'gcf_gen1',concurrency:1,minInstances:0,maxInstances:2,timeoutSeconds:30,httpsTrigger:{invoker:['public']}};
    assert.deepEqual(assertBrokerEndpoint(expected),expected);
    for(const patch of [{maxInstances:100},{minInstances:1},{concurrency:80},{serviceAccountEmail:'default@example.com'},{region:['us-central1']},{httpsTrigger:{invoker:['private']}}])assert.throws(()=>assertBrokerEndpoint({...expected,...patch}),/differs from the reviewed/);
});
test('standalone installed SDK check emits safe real configuration without an approval manifest or cloud call',{
    skip:!fs.existsSync(new URL('../functions/staff-document-broker/node_modules/firebase-functions/package.json',import.meta.url))
},()=>{
    const result=childProcess.spawnSync(process.execPath,[fileURLToPath(new URL('../tools/private-broker-sdk-check.mjs',import.meta.url))],{encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout.trim());
    assert.equal(report.productionNode,'22');assert.deepEqual(report.sdk,{'firebase-admin':'14.5.0','firebase-functions':'7.4.0'});assert.equal(report.network,'blocked');assert.equal(report.credentialFiles,'blocked');assert.equal(report.cloudCalls,'none');assert.equal(report.endpoint.maxInstances,2);
    assert.equal(JSON.stringify(report).includes('access_token'),false);assert.equal(JSON.stringify(report).includes('private_key'),false);
});
