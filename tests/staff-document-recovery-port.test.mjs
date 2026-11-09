import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStore} from '../takodeal-staff/staff-document-store.js';
import {createStaffLoanLedgerClient} from '../takodeal-staff/staff-loan-ledger-client.js';
import {createStaffVaultRecoveryForPhone} from '../takodeal-staff/staff-vault-recovery.js';
import {buildStaffLoanLedgerSnapshot} from '../takodeal-staff/staff-loan-ledger-model.js';
const staffId='sample-port-staff',privateId='DEV-OLD-PRIVATE-PHONE',operationalId='DEV-NEW-OPERATIONAL',branch='Synthetic Branch',endpoint='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
function fixture(){
 const user={uid:'sample-private-uid',isAnonymous:true,getIdToken:async()=>'SYNTHETIC_PRIVATE_TOKEN'},primary={uid:'sample-primary-uid',isAnonymous:true,getIdToken:async()=>{throw Error('Primary identity is not private authority');}},auth={currentUser:user,authStateReady:async()=>{}},binding={uid:user.uid,staffId,deviceId:privateId,branch,active:true},calls=[];
 const client={auth,db:{},sdk:{doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>['staff_document_config','staff_document_devices'].includes(ref.table),data:()=>ref.table==='staff_document_config'?{enabled:true,policyVersion:2,brokerEndpoint:endpoint}:{...binding}}),runTransaction(){throw Error('No SDK writes permitted in read compatibility test');}}};
 client.store=createDocumentStore({...client,identity:()=>staffId,metadata:{upload(){throw Error('No metadata writes expected');},review(){throw Error('No metadata writes expected');}}});
 const authority={confirm:async()=>({enabled:false,mode:'protected',device:{staffId,deviceId:operationalId,branch,status:'Active'}}),mode:()=> 'protected',binding:()=>({staffId,deviceId:operationalId,branch,status:'Active'})};
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_PRIVATE_TOKEN');assert.equal(body.deviceId,privateId);return{ok:true,status:200,json:async()=>url.endsWith('/vault-pin-status')?{staffId,deviceId:privateId,version:0,configured:false}:buildStaffLoanLedgerSnapshot({staffId,staffName:'Synthetic Staff',branch,asOf:'2026-11-09T00:00:00.000Z',ledgers:[],history:[]})};};
 return{client,binding,user,primary,authority,calls,fetcher};
}
test('new document store preserves old approved private identity beside activated operational phone for records, loans and Forgot PIN',async()=>{
 const f=fixture();assert.equal((await f.client.store.binding()).deviceId,privateId);assert.deepEqual(await f.client.store.records(),{valid_id:null,health_card:null,clearance:null});
 const loans=createStaffLoanLedgerClient({createPrivateClient:async()=>f.client,identity:()=>staffId,deviceId:()=>operationalId,fetcher:f.fetcher});assert.equal((await loans.read()).staffId,staffId);loans.invalidate();
 const recovery=await createStaffVaultRecoveryForPhone({auth:{currentUser:f.primary,authStateReady:async()=>{}},authority:f.authority,identity:()=>staffId,deviceId:()=>operationalId,createPrivateClient:async()=>f.client,fetcher:f.fetcher});assert.equal((await recovery.status()).deviceId,privateId);assert.equal(f.calls.length,2);assert.equal(f.client.auth.currentUser,f.user);assert.equal(f.binding.deviceId,privateId);assert.equal(f.binding.active,true);
});
test('operational activation cannot replace a revoked or foreign private UID approval after metadata client installation',async()=>{
 for(const patch of [{active:false},{uid:'other-private-uid'},{staffId:'other-staff'}]){const f=fixture();Object.assign(f.binding,patch);const loans=createStaffLoanLedgerClient({createPrivateClient:async()=>f.client,identity:()=>staffId,deviceId:()=>operationalId,fetcher:f.fetcher});await assert.rejects(loans.read());loans.invalidate();await assert.rejects(createStaffVaultRecoveryForPhone({auth:{currentUser:f.primary,authStateReady:async()=>{}},authority:f.authority,identity:()=>staffId,deviceId:()=>operationalId,createPrivateClient:async()=>f.client,fetcher:f.fetcher}));assert.equal(f.calls.length,0);assert.equal(f.client.auth.currentUser,f.user);}
});
