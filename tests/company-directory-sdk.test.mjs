import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCompanyDirectoryEndpoint,verifyInstalledCashRemittanceSdk} from '../tools/cash-remittance-sdk-check.mjs';
test('actual locked SDK installs only the two fixed document triggers under the reviewed runtime without credentials or cloud calls',async()=>{
 const result=await verifyInstalledCashRemittanceSdk();assert.equal(result.network,'blocked');assert.equal(result.credentialFiles,'blocked');assert.equal(result.cloudCalls,'none');assert.equal(result.triggers.staff.eventTrigger.eventFilterPathPatterns.document,'cashiers/{staffId}');assert.equal(result.triggers.hq.eventTrigger.eventFilterPathPatterns.document,'hq_managers/{profileId}');assert.equal(result.endpoint.concurrency,4);assert.equal(result.endpoint.maxInstances,2);
 for(const [key,value]of [['serviceAccountEmail','different@example.invalid'],['maxInstances',10],['timeoutSeconds',300]]){const changed=structuredClone(result.triggers.staff);changed[key]=value;assert.throws(()=>assertCompanyDirectoryEndpoint(changed,'cashiers/{staffId}'));}
 assert.throws(()=>assertCompanyDirectoryEndpoint(result.triggers.staff,'{all=**}'));assert.throws(()=>assertCompanyDirectoryEndpoint({...result.triggers.staff,eventTrigger:{...result.triggers.staff.eventTrigger,eventFilterPathPatterns:{document:'transactions/{id}'}}},'cashiers/{staffId}'));
});
