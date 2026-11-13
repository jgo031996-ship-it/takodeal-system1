import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {prepareDispatchRestock,commitDispatch} from '../takodeal-manager/dispatch-safety.js';
function fixture(count=129){
 const h=firestoreHarness(),session={uid:'synthetic-owner',email:'jgo031996@gmail.com',cashierName:'Synthetic Owner',isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']};
 Object.assign(h.api,{auth:{currentUser:{uid:session.uid,email:session.email,emailVerified:true}},sessionUser:session,isBranchAllowed:()=>true,getDocs:h.api.getDocsFromServer});
 h.put('branches/test',{name:'Synthetic branch',active:true});h.put('purchase_orders/request',{branch:'Synthetic branch',status:'Pending'});
 const items=Array.from({length:count},(_,index)=>{const id='item-'+index,name='Synthetic item '+index;h.put('inventory/'+id,{name,branch:'Main Office',currentStock:index%3===0?-20:index%3===1?0:50,uom:'gram',purchaseUom:'Pack',conversionRate:1000,baseCost:.5,purchaseCost:500});return {sourceId:id,name,qty:1000,rawQty:1,convRate:1000,baseUom:'gram',uom:'gram',friendlyUom:'Pack'};});
 return {...h,items,async send(){const autoRestock=await prepareDispatchRestock(h.api,{source:'Main Office',destination:'Synthetic branch',items});return {id:'one-complete-delivery',source:'Main Office',destination:'Synthetic branch',driver:'Synthetic Driver',actor:session.cashierName,items,purchaseOrderIds:['request'],autoRestock};}};
}
test('129 mixed zero/negative-stock items save as one complete delivery with one restock invoice and every audit record',async()=>{
 const h=fixture(),input=await h.send();assert.equal(await commitDispatch(h.api,input),'dispatched');
 assert.equal([...h.docs.keys()].filter(key=>key.startsWith('dispatch_logs/')).length,129);
 assert.equal([...h.docs.keys()].filter(key=>key.startsWith('hq_restocks/')).length,1);
 assert.equal(h.get('hq_restocks/dispatch-one-complete-delivery').items.length,129);
 for(let i=0;i<129;i++)assert.equal(h.get('inventory/item-'+i).currentStock,0);
 assert.equal(h.get('purchase_orders/request').status,'Completed');
 const before=structuredClone([...h.docs]);assert.equal(await commitDispatch(h.api,input),'already-dispatched');assert.deepEqual([...h.docs],before);
});
test('a rejected large save preserves all stock, request and delivery records; the unchanged cart can retry',async()=>{
 const h=fixture(),input=await h.send(),before=structuredClone([...h.docs]);h.failNextCommit();await assert.rejects(commitDispatch(h.api,input),/Commit rejected/);assert.deepEqual([...h.docs],before);assert.equal(await commitDispatch(h.api,input),'dispatched');
});
test('a lost acknowledgement of a large save retries the same ID without duplicating stock or restocks',async()=>{
 const h=fixture(),input=await h.send();h.loseNextAck();await assert.rejects(commitDispatch(h.api,input),/Connection lost/);const before=structuredClone([...h.docs]);assert.equal(await commitDispatch(h.api,input),'already-dispatched');assert.deepEqual([...h.docs],before);
});
test('actual oversized details are rejected without a partial save regardless of the item count',async()=>{
 const h=fixture(1),input=await h.send(),before=structuredClone([...h.docs]);input.items[0].notes='x'.repeat(710*1024);await assert.rejects(commitDispatch(h.api,input),/unusually large item details/);assert.deepEqual([...h.docs],before);
});
