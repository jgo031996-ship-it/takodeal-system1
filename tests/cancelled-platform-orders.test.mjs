
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCancelledOrderEngine} from '../Takodeal-POS/cancelled-orders.js';
import {createSaleEngine,SALE_VERSION,safeId,saleFingerprint,receiptIngredientBurn} from '../Takodeal-POS/pos-safety.js';
import {isMealDeduction} from '../takodeal-manager/payroll-safety.js';
import {saleIsPaid,salesSummary} from '../takodeal-manager/dashboard-data.js';
import {closeShiftAtomic} from '../Takodeal-POS/cash-settlement.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Actual engine callbacks against optimistic, memory-only Firestore. This
// harness rejects reads after writes and simulates contention/lost ACKs.
const branch='Maa',shiftId='sample-open-shift',staffId='sample-staff-one',staffName='Synthetic Staff One',pin='5678';
const sourceSaleId='sample-platform-sale',recoveryId='cancelled-food-'+safeId(sourceSaleId);
const bom=[{menuItem:'6 Pcs Takoyaki',ingredientName:'Batter',qty:6},{menuItem:'6 Pcs Takoyaki',ingredientName:'Box',qty:1}];
const rows=(h,table)=>[...h.docs].filter(([path])=>path.startsWith(table+'/'));
const snapshot=h=>structuredClone([...h.docs]);
const stock=h=>rows(h,'inventory');
const moneyTables=['cash_accounts','account_logs','remittances','expenses','franchise_ledger','payroll_records'];

async function fixture(options={}){
    const h=firestoreHarness();let current=true;
    h.api.getDocs=h.api.getDocsFromServer;
    for(const name of ['Batter','Box'])h.put('inventory/Maa-'+name,{branch,name,currentStock:100,uom:'units'});
    h.put('branches/sample-maa',{name:branch,royaltyPercent:0});
    h.put('cash_accounts/sample-hq',{branch:'Main Office',name:'Cash',balance:30000});
    h.put('cash_accounts/sample-branch',{branch,name:'Cash',balance:2000});
    h.put('shifts/'+shiftId,{branch,active:true,status:'Open',cashier:'Synthetic Cashier',startingCash:2000,salesRevision:0});
    h.put('cashiers/'+staffId,{cashierName:staffName,branch,role:'Staff',status:'Active',pin});
    h.put('cashiers/sample-staff-two',{cashierName:'Synthetic Staff Two',branch,role:'Staff',status:'Active',pin:'6789'});
    h.put('settings/global_pos_config',{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:20,...options.settings});
    const payload={saleVersion:SALE_VERSION,saleId:sourceSaleId,receiptId:'SAMPLE-GRAB-0001',branch,shiftId,cashier:'Synthetic Cashier',
        status:'Paid',paymentMethod:options.platform||'Grab',orderType:options.platform||'Grab',netTotal:200,subTotalBeforeDiscount:240,
        localTimestamp:'2026-10-11T01:00:00Z',auditDeferred:options.deferred===true,cart:[{name:'6 Pcs Takoyaki',category:'Takoyaki',qty:2,lineTotalFinal:240}]};
    const sales=createSaleEngine(h.api);await sales.commit(await sales.prepare(payload,bom));
    const sessionCheck=()=>{if(!current)throw Error('The Cashier session changed.');return true;};
    const engine=createCancelledOrderEngine(h.api,{sessionCheck}),input={sourceSaleId,branch,shiftId,cashier:'Synthetic Cashier'};
    return {h,sales,engine,input,payload,cancel:(reason='customer',change={})=>engine.cancel({...input,reason,...change}),
        quote:()=>engine.quote(input),purchase:(quote,change={})=>engine.purchase({...input,staffId,staffName,pin,quote,...change}),revokeSession:()=>{current=false;}};
}
async function refused(f,operation,pattern=/branch|shift|receipt|sale|staff|pin|quote|changed|cancel|purchase|reconcil|reason|missing|prepared|Grab|Foodpanda/i){const before=snapshot(f.h);await assert.rejects(operation(),pattern);assert.deepEqual(snapshot(f.h),before);}

for(const reason of ['customer','rider'])test(`${reason} cancellation excludes revenue and retains consumed stock and immutable source identity`,async()=>{
    const f=await fixture(),original=structuredClone(f.h.get('transactions/'+sourceSaleId)),beforeStock=stock(f.h),beforeMoney=moneyTables.map(table=>rows(f.h,table));
    await f.cancel(reason);const source=f.h.get('transactions/'+sourceSaleId);
    assert.equal(source.status,'Voided');assert.equal(source.preparedCancellation.reason,reason);assert.equal(source.preparedCancellation.prepared,true);
    for(const field of ['saleId','receiptId','branch','shiftId','cart','netTotal','subTotalBeforeDiscount','timestamp','inventoryState','inventoryMovements','inventoryIssues','ballsCounted'])assert.deepEqual(source[field],original[field],field);
    assert.equal(saleFingerprint(source),saleFingerprint(original));assert.deepEqual(stock(f.h),beforeStock);assert.equal(saleIsPaid(source),false);
    assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,0);assert.equal(f.h.get('settings/global_stats').balls_Maa,0);
    assert.deepEqual(moneyTables.map(table=>rows(f.h,table)),beforeMoney);assert.equal(rows(f.h,'transactions').length,1);assert.equal(rows(f.h,'staff_deductions').length,0);
});
test('15 concurrent cancellations reverse the sold counter and sales revision once without returning stock',async()=>{
    const f=await fixture();await Promise.all(Array.from({length:15},()=>f.cancel()));
    assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,0);assert.equal(f.h.get('inventory/Maa-Batter').currentStock,88);assert.equal(f.h.get('inventory/Maa-Box').currentStock,98);
    assert.equal(f.h.get('shifts/'+shiftId).salesRevision,1);assert.equal(rows(f.h,'manager_alerts').length,1);
});
test('rejected cancellation rolls back everything; lost ACK retries without another reversal',async()=>{
    const f=await fixture(),before=snapshot(f.h);f.h.failNextCommit();await assert.rejects(f.cancel(),/Commit rejected/);assert.deepEqual(snapshot(f.h),before);
    f.h.loseNextAck();await assert.rejects(f.cancel(),/Connection lost/);await f.cancel();assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,0);assert.equal(f.h.get('inventory/Maa-Batter').currentStock,88);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,1);
});
test('an existing cancellation cannot be retried with a different reason',async()=>{const f=await fixture();await f.cancel('customer');await refused(f,()=>f.cancel('rider'),/different|reason/i);});
for(const platform of ['Grab','Foodpanda'])test(`${platform} receipt remains identified by its saved payment destination`,async()=>{const f=await fixture({platform});await f.cancel();const offer=await f.quote();assert.equal(offer.platform,platform);assert.equal(offer.sourceReceiptId,f.payload.receiptId);assert.equal(f.h.get('transactions/'+sourceSaleId).paymentMethod,platform);});
test('ordinary Cash receipt and invalid reason cannot use prepared cancellation',async()=>{const a=await fixture({platform:'Cash'});await refused(a,()=>a.cancel());const f=await fixture();await refused(f,()=>f.cancel('inventory-shortage'));});
for(const changes of [{branch:'Cabantian'},{shiftId:'another-shift'}])test(`mismatched ${Object.keys(changes)[0]} fails without a write`,async()=>{const f=await fixture();await refused(f,()=>f.cancel('customer',changes));});
for(const state of [{active:false,status:'Closed'},{active:true,status:'Closed'}])test(`closed shift ${JSON.stringify(state)} prevents cancellation`,async()=>{const f=await fixture();f.h.put('shifts/'+shiftId,{...f.h.get('shifts/'+shiftId),...state});await refused(f,()=>f.cancel());});
test('legacy sale, missing sale and missing immutable commit marker require reconciliation',async()=>{
    for(const damage of ['legacy','missing-sale','missing-marker']){const f=await fixture();if(damage==='legacy')f.h.put('transactions/'+sourceSaleId,{...f.h.get('transactions/'+sourceSaleId),saleVersion:1});if(damage==='missing-sale')f.h.docs.delete('transactions/'+sourceSaleId);if(damage==='missing-marker')f.h.docs.delete('pos_sale_commits/'+sourceSaleId);await refused(f,()=>f.cancel());}
});
test('source cart mutation after original commit does not defeat its immutable fingerprint',async()=>{const f=await fixture();f.h.put('transactions/'+sourceSaleId,{...f.h.get('transactions/'+sourceSaleId),cart:[{name:'Another food',qty:100,lineTotalFinal:200}]});await refused(f,()=>f.cancel());});
test('session revocation prevents both cancellation and a new purchase',async()=>{const a=await fixture();a.revokeSession();await refused(a,()=>a.cancel());const f=await fixture();await f.cancel();const offer=await f.quote();f.revokeSession();await refused(f,()=>f.purchase(offer));});
test('quote uses saved gross amount and current percentage in cents without writes',async()=>{
    const f=await fixture();await f.cancel();const before=snapshot(f.h),offer=await f.quote();assert.deepEqual({sourceSaleId:offer.sourceSaleId,branch:offer.branch,shiftId:offer.shiftId,baseAmount:offer.baseAmount,discountPct:offer.discountPct,discountAmount:offer.discountAmount,amount:offer.amount},{sourceSaleId,branch,shiftId,baseAmount:240,discountPct:20,discountAmount:48,amount:192});assert.equal(offer.fingerprint,saleFingerprint(f.h.get('transactions/'+sourceSaleId)));assert.deepEqual(snapshot(f.h),before);
});
test('one staff purchase creates one direct Unpaid Foods charge and linked receipt, never another stock deduction or pending meal request',async()=>{
    const f=await fixture();await f.cancel();const offer=await f.quote(),beforeStock=stock(f.h),beforeMoney=moneyTables.map(table=>rows(f.h,table));await f.purchase(offer);
    const recovery=f.h.get('transactions/'+recoveryId),deduction=f.h.get('staff_deductions/'+recoveryId);assert.ok(recovery);assert.ok(deduction);
    assert.equal(recovery.status,'Paid');assert.equal(recovery.paymentMethod,'Salary Deduction');assert.equal(recovery.netTotal,192);assert.deepEqual(recovery.cart,f.payload.cart);assert.deepEqual(recovery.inventoryMovements,[]);assert.equal(recovery.cancelledFoodSourceId,sourceSaleId);
    assert.equal(deduction.staffId,staffId);assert.equal(deduction.staffName,staffName);assert.equal(deduction.branch,branch);assert.equal(deduction.type,'Cancelled Food Purchase');assert.equal(deduction.status,'Unpaid');assert.equal(deduction.amount,192);assert.ok(deduction.dateAdded);assert.equal(deduction.sourceSaleId,sourceSaleId);
    assert.equal(rows(f.h,'transactions').length,2);assert.equal(rows(f.h,'staff_deductions').length,1);assert.equal(rows(f.h,'staff_requests').length,0);assert.deepEqual(stock(f.h),beforeStock);assert.deepEqual(moneyTables.map(table=>rows(f.h,table)),beforeMoney);
    assert.ok(!JSON.stringify(recovery).includes(pin));assert.ok(!JSON.stringify(deduction).includes(pin));assert.equal(isMealDeduction(deduction.type),true,'Actual payroll must categorize the deduction as Foods.');
    const counted=rows(f.h,'transactions').map(([,data])=>data).filter(saleIsPaid);assert.equal(salesSummary(counted).net,192,'Only staff purchase revenue remains.');assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,12,'The food is sold once, to staff.');assert.equal(f.h.get('shifts/'+shiftId).salesRevision,2);
});
test('lost-ACK purchase plus 15 concurrent retries charges the same staff once',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.loseNextAck();assert.equal((await f.purchase(offer)).alreadyPurchased,true);await Promise.all(Array.from({length:15},()=>f.purchase(offer)));assert.equal(rows(f.h,'transactions').length,2);assert.equal(rows(f.h,'staff_deductions').length,1);assert.equal(f.h.get('staff_deductions/'+recoveryId).amount,192);assert.equal(f.h.get('inventory/Maa-Batter').currentStock,88);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,2);});

test('purchase error recovery is read-only and preserves the original error when no committed result exists',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote(),before=snapshot(f.h),run=f.h.api.runTransaction,original=Error('Synthetic initial commit denied');let calls=0,writes=0;f.h.api.runTransaction=(db,callback)=>{if(++calls===1)throw original;return run(db,tx=>callback({...tx,set:()=>{writes++;throw Error('Recovery wrote');},update:()=>{writes++;throw Error('Recovery wrote');}}));};await assert.rejects(f.purchase(offer),e=>e===original);assert.equal(calls,2);assert.equal(writes,0);assert.deepEqual(snapshot(f.h),before);});

test('purchase acknowledgement read denial retains the initial error without another create',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote(),before=snapshot(f.h),original=Error('Synthetic initial commit denied');let calls=0;f.h.api.runTransaction=()=>{calls++;throw calls===1?original:Error('Synthetic read denied');};await assert.rejects(f.purchase(offer),e=>e===original);assert.equal(calls,2);assert.deepEqual(snapshot(f.h),before);});

test('a mismatched saved deduction cannot acknowledge a lost purchase response or replay writes',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote(),run=f.h.api.runTransaction,original=Error('Synthetic lost acknowledgement');let calls=0;f.h.api.runTransaction=async(db,callback)=>{const result=await run(db,callback);if(++calls===1){f.h.put('staff_deductions/'+recoveryId,{...f.h.get('staff_deductions/'+recoveryId),amount:1});throw original;}return result;};await assert.rejects(f.purchase(offer),e=>e===original);assert.equal(calls,2);assert.equal(rows(f.h,'staff_deductions').length,1);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,2);assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,12);});

test('literal revoked PIN sentinel cannot buy cancelled food even on an otherwise Active Staff profile',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),pin:'REVOKED'});await refused(f,()=>f.purchase(offer,{pin:'REVOKED'}));});
test('same committed quote reordered by serialization still acknowledges the exact original purchase',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();await f.purchase(offer);const before=snapshot(f.h),reordered=Object.fromEntries(Object.entries(offer).reverse()),answer=await f.purchase(reordered);assert.equal(answer.alreadyPurchased,true);assert.deepEqual(snapshot(f.h),before);});
test('purchase failure has no orphan receipt/deduction; successful same-identity retry is acknowledged after shift closure',async()=>{
    const f=await fixture();await f.cancel();const offer=await f.quote(),before=snapshot(f.h);f.h.failNextCommit();await assert.rejects(f.purchase(offer),/Commit rejected/);assert.deepEqual(snapshot(f.h),before);await f.purchase(offer);
    f.h.put('shifts/'+shiftId,{...f.h.get('shifts/'+shiftId),active:false,status:'Closed'});const committed=snapshot(f.h),result=await f.purchase(offer);assert.equal(result.alreadyPurchased,true);assert.deepEqual(snapshot(f.h),committed);
});
test('second buyer cannot replace the committed purchase or receive false success',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();await f.purchase(offer);await refused(f,()=>f.purchase(offer,{staffId:'sample-staff-two',staffName:'Synthetic Staff Two',pin:'6789'}));});
test('configuration changed after quote requires a new quote, rather than a silently changed charge',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('settings/global_pos_config',{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:25});await refused(f,()=>f.purchase(offer));const fresh=await f.quote();assert.equal(fresh.amount,180);await f.purchase(fresh);assert.equal(f.h.get('staff_deductions/'+recoveryId).amount,180);});
test('disabled purchase policy still allows cancellation but never a salary charge',async()=>{const f=await fixture({settings:{cancelledFoodPurchaseEnabled:false}});await f.cancel();await refused(f,()=>f.quote());assert.equal(f.h.get('transactions/'+sourceSaleId).status,'Voided');});
test('tampered quote never changes source, discount, amount or immutable fingerprint',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();for(const change of [{amount:0},{discountPct:100},{baseAmount:1},{sourceSaleId:'another-sale'},{fingerprint:'forged'}])await refused(f,()=>f.purchase({...offer,...change}));});
for(const change of [{pin:'0000'},{pin:'REVOKED'},{status:'Resigned'},{role:'Owner'},{cashierName:'Another Name'}])test(`fresh profile ${JSON.stringify(change)} refuses purchase`,async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),...change});await refused(f,()=>f.purchase(offer));});
test('explicit All staff branch retains existing permitted shared-branch identity',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),branch:'All'});await f.purchase(offer);assert.equal(f.h.get('staff_deductions/'+recoveryId).branch,branch);});
test('missing profile, wrong typed name and invalid input PIN cannot create a charge',async()=>{for(const changes of [{staffId:'missing-staff'},{staffName:'Another Name'},{pin:'0000'}]){const f=await fixture();await f.cancel();const offer=await f.quote();await refused(f,()=>f.purchase(offer,changes));}});
test('uncancelled receipt and normal stock-returning void cannot become a recovery purchase',async()=>{const a=await fixture();await refused(a,()=>a.quote());const f=await fixture();await f.sales.voidSale(f.payload.receiptId,'Synthetic Cashier',branch);await refused(f,()=>f.quote());});
test('closing the shift after quote prevents a new charge and preserves frozen settlement',async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('shifts/'+shiftId,{...f.h.get('shifts/'+shiftId),active:false,status:'Closed'});await refused(f,()=>f.purchase(offer));});
test('deferred cancellation resumes only original frozen ingredient use once and leaves recovery movements empty',async()=>{
    const f=await fixture({deferred:true});await f.cancel();assert.equal(f.h.get('transactions/'+sourceSaleId).inventoryState,'deferred');assert.equal(f.h.get('inventory/Maa-Batter').currentStock,100);await f.purchase(await f.quote());await Promise.all([f.sales.resumeAudit(branch),f.sales.resumeAudit(branch)]);
    assert.equal(f.h.get('inventory/Maa-Batter').currentStock,88);assert.equal(f.h.get('inventory/Maa-Box').currentStock,98);assert.equal(f.h.get('transactions/'+sourceSaleId).inventoryState,'applied');assert.deepEqual(receiptIngredientBurn(f.h.get('transactions/'+sourceSaleId)),{Batter:12,Box:2});assert.deepEqual(receiptIngredientBurn(f.h.get('transactions/'+recoveryId)),{});
});
test('generic void cannot restore linked purchased food or detach its payroll charge',async()=>{const f=await fixture();await f.cancel();await f.purchase(await f.quote());const recovery=f.h.get('transactions/'+recoveryId);await refused(f,()=>f.sales.voidSale(recovery.receiptId,'Synthetic Cashier',branch));const before=snapshot(f.h);await f.sales.voidSale(f.payload.receiptId,'Synthetic Cashier',branch);assert.deepEqual(snapshot(f.h),before);});
test('cancellation invalidates a closeShiftAtomic calculation made from the old sales revision',async()=>{
    const f=await fixture();await f.cancel();const before=snapshot(f.h);
    await assert.rejects(closeShiftAtomic(f.h.api,{shiftId,branch,cashier:'Synthetic Cashier',declaredCash:2000,totalCashSales:0,totalDigitalSales:200,digitalBreakdown:{Grab:200},physicalStockCount:[],shiftIngredientBurn:{Batter:12,Box:2},cashOut:0,expectedSalesRevision:0,closing:{}}),/sales|changed|revision|recalculate|refresh/i);assert.deepEqual(snapshot(f.h),before);
});
test('an identity change during a transaction read blocks the late cancellation and purchase',async()=>{
    for(const kind of ['cancel','purchase']){
        const f=await fixture();let offer;if(kind==='purchase'){await f.cancel();offer=await f.quote();}
        const before=snapshot(f.h),run=f.h.api.runTransaction;let swapped=false;
        f.h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async reference=>{const result=await tx.get(reference);if(!swapped){swapped=true;f.revokeSession();}return result;}}));
        await assert.rejects(kind==='cancel'?f.cancel():f.purchase(offer),/session|branch|shift|changed/i);assert.deepEqual(snapshot(f.h),before);
    }
});

for(const changes of [{role:'Manager'},{branch:'Cabantian'},{role:'Manager',branch:'Cabantian'}])test('active registered buyer is eligible: '+JSON.stringify(changes),async()=>{const f=await fixture();await f.cancel();const offer=await f.quote();f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),...changes});await f.purchase(offer);assert.equal(f.h.get('staff_deductions/'+recoveryId).staffId,staffId);});
