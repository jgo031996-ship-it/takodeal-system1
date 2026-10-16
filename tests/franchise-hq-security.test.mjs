import test from 'node:test';
import assert from 'node:assert/strict';
import {createFranchiseConversations,createFranchiseLedgerEntry} from '../takodeal-manager/franchise-hq-actions.js';
import {summarizeFranchiseLedger,conversationVisible} from '../takodeal-manager/franchise-hq-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

function fixture(){
 const h=firestoreHarness(),api=h.api,calls=[];
 api.auth={currentUser:{uid:'owner-id',email:'owner@example.test',emailVerified:true}};
 api.sessionUser={uid:'owner-id',email:'owner@example.test',cashierName:'Sample HQ',branch:'Main Office',allowedBranches:['All'],permissions:['franchise-hub'],isOwner:true};
 api.getDocsFromServer=async reference=>{calls.push(reference);return {docs:[]};};
 api.getDocFromServer=async reference=>{calls.push(reference);return {id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))};};
 const assertAccess=session=>session?.permissions?.includes('franchise-hub')===true;
 return {...h,calls,assertAccess,service:createFranchiseConversations(api,{hq:true,assertAccess})};
}
test('a changed account is rejected before any queued conversation query reaches the database',async()=>{
 const h=fixture(),pending=h.service.list('Agdao');
 h.api.auth.currentUser={uid:'another-id',email:'another@example.test',emailVerified:true};
 h.api.sessionUser={...h.api.sessionUser,uid:'another-id',email:'another@example.test'};
 await assert.rejects(pending,/account|access|sign|identity|session/i);
 assert.equal(h.calls.length,0,'captured old-scope queries must not be sent under the next Google identity');
});
test('missing authentication and initial session/Google mismatches cannot read or attribute an HQ transaction',async()=>{
 for(const change of [h=>h.api.auth.currentUser=null,h=>h.api.auth.currentUser.uid='other-id',h=>h.api.auth.currentUser.email='other@example.test']){
  const h=fixture();change(h);
  await assert.rejects(h.service.list('Agdao'),/account|access|sign|identity|session/i);
  await assert.rejects(createFranchiseLedgerEntry(h.api,{id:'sample-payment',branch:'Agdao',type:'Payment',amount:100,description:'Sample proof',assertAccess:h.assertAccess}),/account|access|sign|identity|session/i);
  assert.equal(h.calls.length,0);assert.equal(h.get('franchise_ledger/sample-payment'),undefined);
 }
});
test('boolean or object ledger amounts are unknown data, and a sub-cent payment cannot create a zero-valued entry',async()=>{
 for(const amount of [true,false,[1],{valueOf:()=>1}]){
  const summary=summarizeFranchiseLedger([{id:'invalid',type:'Charge',amount,timestamp:new Date()}]);
  assert.equal(summary.invalidCount,1);assert.equal(summary.balance,null);
 }
 for(const amount of [true,[1],0.001,0.004,Number.MIN_VALUE]){
  const h=fixture();
  await assert.rejects(createFranchiseLedgerEntry(h.api,{id:'sample-payment',branch:'Agdao',type:'Payment',amount,description:'Sample proof',assertAccess:h.assertAccess}));
  assert.equal(h.get('franchise_ledger/sample-payment'),undefined);
 }
});
test('a malformed ledger total never becomes a plausible rounded balance',()=>{
 const summary=summarizeFranchiseLedger([{id:'a',type:'Charge',amount:Number.MAX_SAFE_INTEGER/100,timestamp:1},{id:'b',type:'Charge',amount:Number.MAX_SAFE_INTEGER/100,timestamp:2}]);
 assert.equal(summary.balance,null);
 assert.ok(summary.invalidCount>0 || summary.overflow===true || summary.needsReview===true,'unsafe combined totals must explicitly require review');
});
test('retries with the same payment reference preserve one charge and reject a different branch or amount',async()=>{
 const h=fixture(),input={id:'sample-payment',branch:'Agdao',type:'Payment',amount:100,description:'Sample proof',assertAccess:h.assertAccess};
 h.loseNextAck();await assert.rejects(createFranchiseLedgerEntry(h.api,input),/Connection lost/);
 await createFranchiseLedgerEntry(h.api,input);
 assert.equal([...h.docs.keys()].filter(path=>path.startsWith('franchise_ledger/')).length,1);
 await assert.rejects(createFranchiseLedgerEntry(h.api,{...input,branch:'Maa'}),/reference|used/i);
 await assert.rejects(createFranchiseLedgerEntry(h.api,{...input,amount:200}),/reference|used/i);
 assert.equal(h.get('franchise_ledger/sample-payment').amount,100);
});
test('legacy HQ discussions never become network messages; only confirmed announcements are shared',()=>{
 const franchise={uid:'branch-id',email:'branch@example.test',branch:'Agdao',allowedBranches:['Agdao'],isFranchisee:true};
 const owner=fixture().api.sessionUser;
 for(const row of [{branch:'HQ Main Office',type:'Discussion'},{branch:'Main Office',type:'Help'},{branch:'All',type:'Discussion'},{audience:'branch',branch:'Maa',targetBranch:'Agdao',type:'Discussion'}]){
  assert.equal(conversationVisible(franchise,row),false);
  assert.equal(conversationVisible(owner,row,{hq:true}),true,'full HQ can inspect the unresolved recipient');
  assert.equal(conversationVisible(owner,row,{hq:true,branch:'Agdao'}),false,'unresolved data is not a confirmed branch conversation');
 }
 assert.equal(conversationVisible(franchise,{branch:'HQ Main Office',type:'Announcement'}),true);
 assert.equal(conversationVisible(franchise,{branch:'Agdao',type:'Help'}),true);
 assert.equal(conversationVisible(franchise,{branch:'Maa',type:'Help'}),false);
});
test('a visible legacy branch conversation stays read-only until its recipient is explicitly confirmed',async()=>{
 const h=fixture();h.api.auth.currentUser={uid:'branch-id',email:'branch@example.test',emailVerified:true};
 h.api.sessionUser={uid:'branch-id',email:'branch@example.test',cashierName:'Sample franchise',branch:'Agdao',allowedBranches:['Agdao'],isFranchisee:true,permissions:['franchise-hub']};
 const original={branch:'Agdao',type:'Help',title:'Sample older question',message:'Synthetic branch message',replies:[]};h.put('franchise_comms/legacy-thread',original);
 const service=createFranchiseConversations(h.api,{hq:false,assertAccess:h.assertAccess});
 assert.equal((await service.get('legacy-thread','Agdao')).title,original.title);
 await assert.rejects(service.reply({id:'legacy-thread',branch:'Agdao',replyId:'sample-reply',message:'Must not be written'}),/older|recipient|review/i);
 assert.deepEqual(h.get('franchise_comms/legacy-thread'),original);
});
