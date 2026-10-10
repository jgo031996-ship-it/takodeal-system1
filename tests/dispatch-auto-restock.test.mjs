import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {prepareDispatchRestock,commitDispatch,transitionDispatch,receiveDispatch} from '../takodeal-manager/dispatch-safety.js';

const clone=value=>structuredClone(value);
function environment(options={}){
    const {currentStock=-82500,purchaseCost=200,conversionRate=1000,isFranchise=false}=options,baseCost=Object.hasOwn(options,'baseCost')?options.baseCost:0.2;
    const h=firestoreHarness(),reads=[],originalRead=h.api.getDocsFromServer;
    h.put('inventory/hq-chicken',{branch:'Main Office',name:'Chicken Powder',currentStock,uom:'Gram',purchaseUom:'Pack',conversionRate,baseCost,purchaseCost,purchCost:purchaseCost,cost:purchaseCost,note:'Original prices must stay unchanged'});
    h.put('inventory/maa-chicken',{branch:'Maa',name:'Chicken Powder',currentStock:13,uom:'Gram',purchaseUom:'Pack',conversionRate,baseCost:0.3});
    h.put('branches/maa',{name:'Maa',active:true,isFranchise});
    h.put('purchase_orders/maa-request',{branch:'Maa',sourceBranch:'Main Office',status:'Drafting',items:[{name:'Chicken Powder',qty:7500,uom:'Gram'}]});
    h.put('cash_accounts/owner-cash',{branch:'Main Office',balance:20000});
    const session={uid:'sample-owner',email:'jgo031996@gmail.com',cashierName:'Synthetic Owner',role:'Owner',permissions:['all'],allowedBranches:['All'],isOwner:true,isFranchisee:false};
    h.api.auth={currentUser:{uid:session.uid,email:session.email,emailVerified:true}};h.api.sessionUser=session;
    h.api.isBranchAllowed=name=>h.api.sessionUser.allowedBranches.includes('All')||h.api.sessionUser.allowedBranches.includes(name);
    h.api.getDocsFromServer=async query=>{reads.push(query);const result=await originalRead(query);await h.afterRead?.(query,result);return result;};
    h.api.getDocs=h.api.getDocsFromServer;
    h.api.getDocFromServer=async reference=>{const data=clone(h.get(reference.path));return {ref:reference,id:reference.id,exists:()=>data!==undefined,data:()=>clone(data)};};
    const items=[{sourceId:'hq-chicken',name:'Chicken Powder',qty:7500,rawQty:7500/conversionRate,baseUom:'Gram',uom:'Gram',friendlyUom:'Pack',purchaseUom:'Pack',selectedUom:'purch',convRate:conversionRate,cost:purchaseCost}];
    const input={id:'sample-batch',source:'Main Office',destination:'Maa',driver:'Sample Driver',actor:'Synthetic Owner',items,purchaseOrderIds:['maa-request'],now:new Date('2026-10-10T13:00:00+08:00')};
    return Object.assign(h,{reads,items,input,async prepare(override={}){return prepareDispatchRestock(h.api,{source:input.source,destination:input.destination,items,...override});},async send(autoRestock,override={}){return commitDispatch(h.api,{...input,autoRestock,...override});}});
}
const records=(h,collection)=>[...h.docs].filter(([path])=>path.startsWith(collection+'/'));
const snapshot=h=>clone([...h.docs]);
const invoice=h=>h.get('hq_restocks/dispatch-sample-batch');

test('negative HQ stock is corrected, only new dispatch goods are estimated, and no cash or employee deductions are written',async()=>{
    const h=environment(),old=clone(h.get('inventory/hq-chicken')),plan=await h.prepare();assert.equal(await h.send(plan),'dispatched');
    assert.equal(h.get('inventory/hq-chicken').currentStock,0);assert.equal(h.get('inventory/maa-chicken').currentStock,13);
    const corrected=h.get('stock_logs/correction-sample-batch-hq-chicken');assert.deepEqual([corrected.oldQty,corrected.newQty,corrected.variance],[-82500,0,82500]);
    const restock=h.get('stock_logs/restock-sample-batch-hq-chicken');assert.deepEqual([restock.oldQty,restock.newQty,restock.variance],[0,7500,7500]);
    const bill=invoice(h);assert.equal(bill.dispatchAutoRestock,true);assert.equal(bill.dispatchBatchId,'sample-batch');assert.equal(bill.estimated,true);assert.equal(bill.totalCost,1500);assert.equal(bill.items[0].baseQtyToAdd,7500);assert.equal(bill.items[0].purchQty,7.5);assert.equal(bill.items[0].correctionQty,82500);assert.equal(bill.items[0].subtotal,1500);assert.equal(bill.actorUid,'sample-owner');
    for(const field of ['baseCost','purchaseCost','purchCost','cost','conversionRate','note'])assert.equal(h.get('inventory/hq-chicken')[field],old[field]);
    assert.equal(h.get('cash_accounts/owner-cash').balance,20000);for(const table of ['expenses','account_logs','remittances','staff_deductions','staff_ledger'])assert.equal(records(h,table).length,0);
    assert.equal(h.get('purchase_orders/maa-request').status,'Completed');assert.equal(h.get('dispatch_logs/sample-batch-0').status,'In Transit');
});
test('fresh server inventory is used for preview and dispatch, with no cached collection fallback',async()=>{
    const h=environment();h.api.getDocs=()=>{throw Error('Cached read must not be used');};const plan=await h.prepare();await h.send(plan);assert.deepEqual(h.reads.map(query=>query.table),['inventory','inventory','branches']);
});
test('Cashier receipt separately adds the actual received quantity and does not apply the old correction to branch inventory',async()=>{
    const h=environment(),plan=await h.prepare();await h.send(plan);await transitionDispatch(h.api,{ids:['sample-batch-0'],mode:'arrive',actor:'Synthetic Owner'});assert.equal(h.get('inventory/maa-chicken').currentStock,13);
    await receiveDispatch(h.api,{branch:'Maa',actor:'Synthetic Cashier',items:[{id:'sample-batch-0',actualDisplayQty:7.5,isMissing:false}]});assert.equal(h.get('inventory/maa-chicken').currentStock,7513);assert.equal(h.get('inventory/hq-chicken').currentStock,0);assert.equal(h.get('dispatch_logs/sample-batch-0').status,'Received');assert.equal(records(h,'hq_restocks').length,1);
});
test('returning an unreceived automatic-restock delivery restores only sent goods and credits a franchise once',async()=>{
    const h=environment({isFranchise:true}),plan=await h.prepare();await h.send(plan);const bill=clone(invoice(h));await transitionDispatch(h.api,{ids:['sample-batch-0'],mode:'return',actor:'Synthetic Owner'});await transitionDispatch(h.api,{ids:['sample-batch-0'],mode:'return',actor:'Synthetic Owner'});
    assert.equal(h.get('inventory/hq-chicken').currentStock,7500);assert.equal(h.get('inventory/maa-chicken').currentStock,13);assert.equal(h.get('dispatch_logs/sample-batch-0').status,'Backloaded');assert.deepEqual(invoice(h),bill);assert.equal(records(h,'hq_restocks').length,1);assert.equal(h.get('franchise_ledger/supply-sample-batch').amount,1500);assert.equal(h.get('franchise_ledger/supply-return-sample-batch-0').amount,1500);assert.equal(records(h,'franchise_ledger').length,2);assert.equal(h.get('cash_accounts/owner-cash').balance,20000);
});
test('ten concurrent identical sends and repeated retries create exactly one restock, correction and delivery',async()=>{
    const h=environment(),plan=await h.prepare(),results=await Promise.all(Array.from({length:10},()=>h.send(plan)));assert.equal(results.filter(result=>result==='dispatched').length,1);assert.ok(h.retries()>0);assert.equal(await h.send(plan),'already-dispatched');assert.equal(records(h,'hq_restocks').length,1);assert.equal(records(h,'dispatch_logs').length,1);assert.equal(records(h,'stock_logs').filter(([path])=>path.startsWith('stock_logs/correction-')).length,1);assert.equal(h.get('inventory/hq-chicken').currentStock,0);assert.equal(invoice(h).totalCost,1500);
});
test('lost acknowledgement retries the original operation without buying, correcting or dispatching twice',async()=>{
    const h=environment(),plan=await h.prepare();h.loseNextAck();await assert.rejects(h.send(plan),/Connection lost after commit/);const committed=snapshot(h);assert.equal(await h.send(plan),'already-dispatched');assert.deepEqual(snapshot(h),committed);assert.equal(records(h,'hq_restocks').length,1);
});
test('a failed atomic commit retains source, branch, request, cash and all audit collections unchanged',async()=>{
    const h=environment(),plan=await h.prepare(),before=snapshot(h);h.failNextCommit();await assert.rejects(h.send(plan),/Commit rejected/);assert.deepEqual(snapshot(h),before);assert.equal(records(h,'hq_restocks').length,0);assert.equal(records(h,'stock_logs').length,0);assert.equal(records(h,'dispatch_logs').length,0);
});
test('positive partial HQ stock restocks only the shortage and sufficient stock creates no invoice or correction',async()=>{
    for(const [currentStock,restockQty,after]of [[2000,5500,0],[9000,0,1500]]){const h=environment({currentStock}),plan=await h.prepare();await h.send(plan);assert.equal(h.get('inventory/hq-chicken').currentStock,after);assert.equal(records(h,'stock_logs').filter(([path])=>path.startsWith('stock_logs/correction-')).length,0);if(restockQty){assert.equal(invoice(h).items[0].restockQty,restockQty);assert.equal(invoice(h).totalCost,1100);}else{assert.equal(records(h,'hq_restocks').length,0);assert.equal(records(h,'stock_logs').filter(([path])=>path.startsWith('stock_logs/restock-')).length,0);}}
});
test('unknown saved prices persist as review-needed null estimates, never fake zero-cost goods',async()=>{
    const h=environment();h.put('inventory/hq-chicken',{...h.get('inventory/hq-chicken'),baseCost:undefined,purchaseCost:undefined,purchCost:undefined,cost:undefined});const plan=await h.prepare();assert.equal(plan.estimatedTotal,null);await h.send(plan);assert.equal(invoice(h).totalCost,null);assert.equal(invoice(h).costStatus,'Needs price review');assert.equal(invoice(h).items[0].knownCost,false);assert.equal(invoice(h).items[0].estimatedUnitCost,null);assert.equal(invoice(h).items[0].subtotal,null);assert.equal(h.get('dispatch_logs/sample-batch-0').unitCost,null);assert.equal(h.get('inventory/hq-chicken').baseCost,undefined);
});
test('stale preview stock, price or package conversion rejects every stock and invoice write',async()=>{
    for(const patch of [{currentStock:-80000},{baseCost:0.25},{purchaseCost:250},{conversionRate:5000}]){const h=environment(),plan=await h.prepare();h.put('inventory/hq-chicken',{...h.get('inventory/hq-chicken'),...patch});const before=snapshot(h);await assert.rejects(h.send(plan),/changed|preview/i);assert.deepEqual(snapshot(h),before);}
});
test('two distinct batches using the same old stock preview cannot silently make a second correction or purchase',async()=>{
    const h=environment(),plan=await h.prepare(),results=await Promise.allSettled([h.send(plan),h.send(plan,{id:'second-batch',purchaseOrderIds:[]})]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);assert.equal(records(h,'hq_restocks').length,1);assert.equal(h.get('inventory/hq-chicken').currentStock,0);assert.equal(records(h,'stock_logs').filter(([path])=>path.startsWith('stock_logs/correction-')).length,1);
});
test('different intent cannot reuse a committed batch ID even after acknowledgement loss',async()=>{
    const h=environment(),plan=await h.prepare();await h.send(plan);const before=snapshot(h);for(const override of [{driver:'Changed Driver'},{items:[{...h.items[0],qty:8000}]},{actor:'Different actor'}]){await assert.rejects(h.send(plan,override),/different|saved operation/i);assert.deepEqual(snapshot(h),before);}
});
test('branch status/request completion changes after preview refuse the entire combined transaction',async()=>{
    for(const change of ['branch','request']){const h=environment(),plan=await h.prepare();if(change==='branch')h.put('branches/maa',{...h.get('branches/maa'),active:false});else h.put('purchase_orders/maa-request',{...h.get('purchase_orders/maa-request'),status:'Completed'});const before=snapshot(h);await assert.rejects(h.send(plan),/changed|processed/i);assert.deepEqual(snapshot(h),before);}
});
test('an orphan linked invoice or legacy marker cannot be replayed as a new automatic restock',async()=>{
    for(const kind of ['invoice','legacy-marker']){const h=environment(),plan=await h.prepare();if(kind==='invoice')h.put('hq_restocks/dispatch-sample-batch',{dispatchBatchId:'sample-batch',totalCost:99});else h.put('settings/dispatch_commit_sample-batch',{id:'sample-batch',source:'Main Office',destination:'Maa'});const before=snapshot(h);await assert.rejects(h.send(plan),/linked restock|older|different/i);assert.deepEqual(snapshot(h),before);}
});
test('verified Google/session identity, dispatch/inventory permission and both branch scopes are required',async()=>{
    for(const mode of ['anonymous','unverified','session-mismatch','no-dispatch','no-inventory','franchise','source-scope','destination-scope']){const h=environment(),plan=await h.prepare();const user=h.api.auth.currentUser,session=h.api.sessionUser;
        if(mode==='anonymous')h.api.auth.currentUser=null;if(mode==='unverified')user.emailVerified=false;if(mode==='session-mismatch')session.uid='different';
        if(['no-dispatch','no-inventory','franchise'].includes(mode)){user.email=session.email='manager@sample.invalid';session.isOwner=false;session.role='Manager';session.permissions=mode==='no-dispatch'?['inventory']:mode==='no-inventory'?['dispatch']:['dispatch','inventory'];if(mode==='franchise')session.isFranchisee=true;}
        if(mode==='source-scope')session.allowedBranches=['Maa'];if(mode==='destination-scope')session.allowedBranches=['Main Office'];
        const before=snapshot(h);await assert.rejects(h.send(plan),/Google|access|inventory/i,mode);assert.deepEqual(snapshot(h),before,mode);
    }
});
test('account or branch revocation while server reads wait aborts before any combined writes',async()=>{
    for(const mode of ['account','branch']){const h=environment(),plan=await h.prepare();let changed=false;h.afterRead=async()=>{if(changed)return;changed=true;if(mode==='account')h.api.auth.currentUser={uid:'other-owner',email:'other@sample.invalid',emailVerified:true};else h.api.sessionUser.allowedBranches=['Main Office'];};const before=snapshot(h);await assert.rejects(h.send(plan),/account|Google|access/i);assert.deepEqual(snapshot(h),before);}
});
test('same-object UID/email replacement during preparation cannot adopt the old operation into a different identity',async()=>{
    const h=environment();h.afterRead=async()=>{h.api.auth.currentUser.uid=h.api.sessionUser.uid='replacement-user';h.api.auth.currentUser.email=h.api.sessionUser.email='replacement@sample.invalid';};const before=snapshot(h);await assert.rejects(h.prepare(),/account|Google|changed/i);assert.deepEqual(snapshot(h),before);
});
test('same-object UID/email replacement during dispatch cannot commit using the earlier captured actor',async()=>{
    const h=environment(),plan=await h.prepare();let changed=false;h.afterRead=async()=>{if(changed)return;changed=true;h.api.auth.currentUser.uid=h.api.sessionUser.uid='replacement-user';h.api.auth.currentUser.email=h.api.sessionUser.email='replacement@sample.invalid';};const before=snapshot(h);await assert.rejects(h.send(plan),/account|Google|changed/i);assert.deepEqual(snapshot(h),before);
});
test('explicit stale-session callback refuses even an already-committed retry without new writes',async()=>{
    const h=environment(),plan=await h.prepare();await h.send(plan);const before=snapshot(h);await assert.rejects(h.send(plan,{assertCurrent(){throw Error('Synthetic session epoch changed');}}),/session epoch/);assert.deepEqual(snapshot(h),before);
});
test('purchase-unit cost converts to base cost exactly once when charging franchise stock',async()=>{
    const h=environment({baseCost:undefined,purchaseCost:5000,conversionRate:5000,isFranchise:true}),plan=await h.prepare();assert.equal(plan.lines[0].baseCost,1);assert.equal(plan.lines[0].estimatedUnitCost,5000);await h.send(plan);assert.equal(invoice(h).items[0].purchQty,1.5);assert.equal(invoice(h).totalCost,7500);assert.equal(h.get('dispatch_logs/sample-batch-0').unitCost,1);assert.equal(h.get('franchise_ledger/supply-sample-batch').amount,7500);assert.equal(h.get('inventory/hq-chicken').cost,5000);assert.equal(h.get('inventory/hq-chicken').baseCost,undefined);assert.equal(h.get('cash_accounts/owner-cash').balance,20000);
});
test('a franchise delivery with no saved supply price rejects all staged restock and charge writes',async()=>{
    const h=environment({isFranchise:true});h.put('inventory/hq-chicken',{...h.get('inventory/hq-chicken'),baseCost:undefined,purchaseCost:undefined,purchCost:undefined,cost:undefined});const plan=await h.prepare(),before=snapshot(h);await assert.rejects(h.send(plan),/saved supply price/);assert.deepEqual(snapshot(h),before);assert.equal(records(h,'franchise_ledger').length,0);
});
test('duplicate source lines restock and correct only their combined quantity',async()=>{
    const h=environment({currentStock:1000}),items=[{...h.items[0],qty:3000,rawQty:3},{...h.items[0],qty:4500,rawQty:4.5}],plan=await h.prepare({items});await h.send(plan,{items});assert.equal(invoice(h).items.length,1);assert.equal(invoice(h).items[0].restockQty,6500);assert.equal(invoice(h).totalCost,1300);assert.equal(records(h,'dispatch_logs').length,2);assert.equal(h.get('inventory/hq-chicken').currentStock,0);assert.equal(records(h,'stock_logs').filter(([path])=>path.startsWith('stock_logs/restock-')).length,1);
    const first=h.get('stock_logs/out-sample-batch-0'),second=h.get('stock_logs/out-sample-batch-1');assert.deepEqual([first.oldQty,first.newQty,first.variance],[7500,4500,-3000]);assert.deepEqual([second.oldQty,second.newQty,second.variance],[4500,0,-4500]);assert.equal(first.newQty,second.oldQty);for(const row of [first,second])assert.equal(row.newQty-row.oldQty,row.variance);
});
test('missing/duplicate source stock and the write-count cap fail without creating any partial records',async()=>{
    for(const mode of ['missing','duplicate','cap']){const h=environment(),plan=await h.prepare();if(mode==='missing')h.docs.delete('inventory/hq-chicken');if(mode==='duplicate')h.put('inventory/duplicate',{...h.get('inventory/hq-chicken')});const before=snapshot(h),override=mode==='cap'?{items:Array.from({length:62},()=>clone(h.items[0]))}:{};await assert.rejects(h.send(plan,override),/Missing|duplicate|smaller batches/i);assert.deepEqual(snapshot(h),before);}
});
