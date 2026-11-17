import test from 'node:test';
import assert from 'node:assert/strict';
import {adminMemory} from './helpers/admin-memory.mjs';
import {createStaffPrivateProfileStore} from '../functions/cash-remittance-review/staff-private-profile-store.mjs';
import {CONTACT_FIELDS} from '../functions/cash-remittance-review/staff-private-profile-model.mjs';

test('Staff and Owner use the same GCash number after explicit edits, including clearing it',async()=>{
 const memory=adminMemory(),staffId='test-crew',uid='private-test',deviceId='DEV-TEST-PHONE',scope={staffId,deviceId};
 const actor={uid,firebase:{sign_in_provider:'anonymous'}},path='cashiers/'+staffId;
 memory.put('staff_document_config/current',{enabled:true,policyVersion:2,brokerEndpoint:'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'});
 memory.put('staff_document_devices/'+uid,{uid,staffId,deviceId,branch:'Test',active:true});
 memory.put(path,{cashierName:'Synthetic crew',active:true,branch:'Test',gcashNum:'owner-fixture'});
 const store=createStaffPrivateProfileStore(memory.db,{serverTimestamp:memory.serverTimestamp});
 const read=()=>store.read(scope,actor);
 let saved=await read();assert.equal(saved.profile.gcashNumber,'owner-fixture');assert.equal(saved.profile.gcashNum,undefined);
 const submit=(patch,operationId)=>store.update({...scope,patch,operationId,expectedFingerprint:saved.expectedFingerprint},actor);
 await assert.rejects(submit(Object.fromEntries(CONTACT_FIELDS.map(key=>[key,''])),'old-form-submit'),{status:409});
 assert.equal(memory.get(path).gcashNum,'owner-fixture');
 await submit({phone:'test-phone'},'edit-contact-only');assert.equal(memory.get(path).gcashNum,'owner-fixture');
 saved=await read();await submit({gcashNumber:'new-fixture'},'edit-gcash-number');
 assert.equal((await submit({gcashNumber:'new-fixture'},'edit-gcash-number')).alreadySaved,true);
 assert.equal(memory.get(path).gcashNum,'new-fixture');
 memory.put(path,{...memory.get(path),gcashNum:'edited-in-owner'});saved=await read();
 assert.equal(saved.profile.gcashNumber,'edited-in-owner');
 await submit({gcashNumber:''},'clear-gcash-number');assert.equal(memory.get(path).gcashNum,'');assert.equal(memory.get(path).gcashNumber,'');
 await assert.rejects(store.read({...scope,staffId:'other-staff'},actor),{status:403});
});
