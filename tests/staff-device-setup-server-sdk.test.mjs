import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertSetupEndpoint} from '../tools/staff-device-setup-sdk-check.mjs';

test('Staff setup endpoint audit rejects runtime identity, region, resource or scale drift',()=>{
 const expected={platform:'gcfv2',region:['asia-southeast1'],serviceAccountEmail:'staff-device-setup@takodeal-pos.iam.gserviceaccount.com',availableMemoryMb:512,cpu:1,concurrency:4,minInstances:0,maxInstances:2,timeoutSeconds:30,httpsTrigger:{invoker:['public']}};
 assert.deepEqual(assertSetupEndpoint(expected),expected);
 for(const patch of [{maxInstances:100},{minInstances:1},{concurrency:80},{availableMemoryMb:256},{cpu:2},{serviceAccountEmail:'default@example.com'},{region:['us-central1']},{httpsTrigger:{invoker:['private']}}])assert.throws(()=>assertSetupEndpoint({...expected,...patch}),/differs from the reviewed/);
});
test('actual installed Staff setup SDK loads under network and credential-file guards',()=>{
 const result=childProcess.spawnSync(process.execPath,[fileURLToPath(new URL('../tools/staff-device-setup-sdk-check.mjs',import.meta.url))],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout.trim());
 assert.equal(report.productionNode,'22');assert.deepEqual(report.sdk,{'firebase-admin':'14.5.0','firebase-functions':'7.4.0'});assert.equal(report.network,'blocked');assert.equal(report.credentialFiles,'blocked');assert.equal(report.cloudCalls,'none');assert.equal(report.adminApp,'staff-device-setup');assert.equal(report.projectId,'takodeal-pos');assert.equal(report.endpoint.maxInstances,2);
 assert.equal(JSON.stringify(report).includes('access_token'),false);assert.equal(JSON.stringify(report).includes('private_key'),false);
 assert.deepEqual(report.transitive,{'body-parser':'2.4.0'});
});
test('production wrapper uses ADC, trusted socket peer and a separate functions deployment scope',()=>{
 const wrapper=fs.readFileSync(new URL('../functions/staff-device-setup/index.mjs',import.meta.url),'utf8'),config=JSON.parse(fs.readFileSync(new URL('../firebase.staff-device-setup.json',import.meta.url),'utf8'));
 assert.match(wrapper,/verifyIdToken\(token,checkRevoked\)/);assert.match(wrapper,/trustedIP:request\.socket\?\.remoteAddress/);assert.doesNotMatch(wrapper,/request\.get\(['"](?:X-Forwarded-For|Forwarded)['"]\)/i);assert.doesNotMatch(wrapper,/console\.(?:log|error|warn)\(/);assert.doesNotMatch(wrapper,/cert\(|private_key|client_email|\.credential\(/);
 assert.deepEqual(config.functions,[{source:'functions/staff-device-setup',codebase:'staff-device-setup',ignore:['node_modules','.git','*-debug.log','*.local']}]);
});
