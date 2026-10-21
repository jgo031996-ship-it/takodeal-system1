import test from 'node:test';
import assert from 'node:assert/strict';
import {createCancelledOrderEngine} from '../Takodeal-POS/cancelled-orders.js';
import {quoteCancelledFoodPortion,createCancelledFoodOperationId} from '../Takodeal-POS/cancelled-food-portions.js';
import {cancelledFoodPortionForm} from '../Takodeal-POS/cancelled-orders-ui.js';
import {saleFingerprint} from '../Takodeal-POS/pos-safety.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const sourceSaleId='sample-split',branch='Maa',shiftId='sample-open',input={sourceSaleId,branch,shiftId,cashier:'Sample cashier'};
const op=n=>n.toString(16).padStart(32,'0');
const row=(name,qty,total,extra={})=>({name,qty,lineTotalFinal:total,...extra});
async function fixture(cart=[row('Mango Shake',2,200),row('Bonito Takoyaki 6 Pcs',2,240)],config={}){
 const h=firestoreHarness();h.put('shifts/'+shiftId,{branch,active:true,status:'Open',salesRevision:0});h.put('cashiers/wenna',{cashierName:'Sample Wenna',role:'Staff',pin:'1234',active:true});h.put('cashiers/hannah',{cashierName:'Sample Hannah',role:'Staff',pin:'2345',active:true});
 const sale={saleVersion:2,saleId:sourceSaleId,receiptId:'SAMPLE-CANCELLED',branch,shiftId,cart,paymentMethod:'Grab',status:'Paid',inventoryState:'applied',inventoryMovements:[{ingredientName:'Batter',inventoryId:'sample-batter',quantity:12}],subTotalBeforeDiscount:cart.reduce((sum,item)=>sum+item.lineTotalFinal,0),netTotal:cart.reduce((sum,item)=>sum+item.lineTotalFinal,0),statsApplied:true,ballsCounted:cart.filter(item=>/takoyaki/i.test(item.name)).reduce((sum,item)=>sum+item.qty*6,0)};
 h.put('transactions/'+sourceSaleId,sale);h.put('pos_sale_commits/'+sourceSaleId,{saleId:sourceSaleId,branch,receiptId:sale.receiptId,fingerprint:saleFingerprint(sale)});h.put('settings/global_stats',{totalTakoyakiBalls:sale.ballsCounted,balls_Maa:sale.ballsCounted});h.put('inventory/sample-batter',{branch,name:'Batter',currentStock:88});h.put('settings/global_pos_config',{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:20,...config});
 const engine=createCancelledOrderEngine(h.api);await engine.cancel({...input,reason:'customer'});
 const quote=async(chosen,n=1)=>quoteCancelledFoodPortion(await engine.available(input),chosen,op(n));
 const purchase=(offer,person='wenna')=>engine.purchase({...input,staffId:person,staffName:person==='wenna'?'Sample Wenna':'Sample Hannah',pin:person==='wenna'?'1234':'2345',quote:offer});
 return {h,engine,quote,purchase};
}
const rows=(h,table)=>[...h.docs].filter(([path])=>path.startsWith(table+'/'));
test('two employees each buy one shake and one takoyaki from the same cancelled receipt',async()=>{
 const f=await fixture(),beforeStock=structuredClone(rows(f.h,'inventory'));
 const first=await f.purchase(await f.quote([{lineIndex:0,qty:1},{lineIndex:1,qty:1}]));
 const remaining=await f.engine.available(input);assert.deepEqual(remaining.lines.map(line=>line.remainingQty),[1,1]);
 const second=await f.purchase(await f.quote([{lineIndex:0,qty:1},{lineIndex:1,qty:1}],2),'hannah');
 assert.notEqual(first.saleId,second.saleId);assert.equal(first.amount,176);assert.equal(second.amount,176);
 assert.deepEqual((await f.engine.available(input)).lines.map(line=>line.remainingQty),[0,0]);assert.equal(rows(f.h,'staff_deductions').length,2);assert.equal(rows(f.h,'transactions').length,3);assert.deepEqual(rows(f.h,'inventory'),beforeStock);assert.equal(f.h.get('settings/global_stats').totalTakoyakiBalls,12);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,3);
 for(const [id,data]of rows(f.h,'staff_deductions')){assert.equal(data.type,'Cancelled Food Purchase');assert.equal(data.sourcePlatform,'Grab');assert.equal(data.sourceReceiptId,'SAMPLE-CANCELLED');assert.equal(data.purchasedItems.length,2);assert.deepEqual(data.purchasedItems.map(item=>item.qty),[1,1]);assert.equal(data.purchasedItems.reduce((sum,item)=>sum+item.amount,0),data.amount);assert.deepEqual(f.h.get(id.replace('staff_deductions/','transactions/')).inventoryMovements,[]);}
});
test('different names, sizes, duplicate rows and notes retain original line identities',async()=>{
 const f=await fixture([row('Shake',1,70,{variantName:'Small',notes:'No ice',addons:{Cream:{qty:1,price:5}}}),row('Shake',1,90,{variantName:'Large',notes:'Extra ice'})]);
 const answer=await f.purchase(await f.quote([{lineIndex:1,qty:1}]));const purchase=f.h.get('transactions/'+answer.saleId);assert.equal(purchase.cart.length,1);assert.equal(purchase.cart[0].variantName,'Large');assert.equal(purchase.cart[0].notes,'Extra ice');assert.equal(answer.amount,72);assert.deepEqual((await f.engine.available(input)).lines.map(line=>line.remainingQty),[1,0]);
});
test('concurrent claims cannot buy the same last unit or produce orphan deductions',async()=>{
 const f=await fixture([row('Shake',1,100)]),a=await f.quote([{lineIndex:0,qty:1}],1),b=await f.quote([{lineIndex:0,qty:1}],2);
 const results=await Promise.allSettled([f.purchase(a),f.purchase(b,'hannah')]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(rows(f.h,'staff_deductions').length,1);assert.equal(f.h.get('cancelled_food_allocations/'+sourceSaleId).purchasedQuantities['0'],1);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,2);
});
test('lost acknowledgment and concurrent exact retries reuse one purchase reference and charge',async()=>{
 const f=await fixture(),quote=await f.quote([{lineIndex:0,qty:1}]);f.h.loseNextAck();assert.equal((await f.purchase(quote)).alreadyPurchased,true);await Promise.all(Array.from({length:10},()=>f.purchase(quote)));assert.equal(rows(f.h,'staff_deductions').length,1);assert.equal(f.h.get('cancelled_food_allocations/'+sourceSaleId).purchasedQuantities['0'],1);assert.equal(f.h.get('shifts/'+shiftId).salesRevision,2);const confirm=await f.engine.confirmPortion({...input,staffId:'wenna',staffName:'Sample Wenna',quote});assert.equal(confirm.alreadyPurchased,true);
});
test('same operation cannot be reassigned to a different buyer or different item',async()=>{
 const f=await fixture(),quote=await f.quote([{lineIndex:0,qty:1}]);await f.purchase(quote);const before=structuredClone([...f.h.docs]);await assert.rejects(f.purchase(quote,'hannah'),/purchase ID/i);await assert.rejects(f.purchase({...quote,selection:[{...quote.selection[0],lineIndex:1}]}),/purchase ID/i);assert.deepEqual([...f.h.docs],before);
});
test('portion cent allocation exhausts exactly the source row and its rounded discount',async()=>{
 const f=await fixture([row('Sample food',3,0.05)]),answers=[];for(let n=1;n<=3;n++)answers.push(await f.purchase(await f.quote([{lineIndex:0,qty:1}],n)));assert.equal(Math.round(answers.reduce((sum,item)=>sum+item.amount,0)*100),4);const charges=rows(f.h,'staff_deductions').map(([,row])=>row);assert.equal(Math.round(charges.reduce((sum,row)=>sum+row.originalAmount,0)*100),5);assert.equal(Math.round(charges.reduce((sum,row)=>sum+row.discountAmount,0)*100),1);
});
test('six different receipt lines work while seven lines must be split into another purchase',async()=>{
 const f=await fixture(Array.from({length:7},(_,index)=>row('Sample '+index,1,10)));const six=Array.from({length:6},(_,lineIndex)=>({lineIndex,qty:1}));assert.equal((await f.purchase(await f.quote(six))).amount,48);await assert.rejects(f.quote([...six,{lineIndex:6,qty:1}],2),/up to 6/);assert.equal((await f.purchase(await f.quote([{lineIndex:6,qty:1}],2))).amount,8);
});
for(const selection of [[{lineIndex:0,qty:3}],[{lineIndex:0,qty:-1}],[{lineIndex:0,qty:0.5}],[{lineIndex:2,qty:1}],[{lineIndex:0,qty:1},{lineIndex:0,qty:1}]])test('invalid selected quantities cannot write '+JSON.stringify(selection),async()=>{const f=await fixture(),before=structuredClone([...f.h.docs]);await assert.rejects(f.quote(selection));assert.deepEqual([...f.h.docs],before);});
test('legacy whole purchase consumes all food and a partial purchase blocks old whole clients',async()=>{
 const whole=await fixture();const oldQuote=await whole.engine.quote(input);await whole.purchase(oldQuote);await assert.rejects(whole.engine.available(input),/in full/);
 const partial=await fixture(),quote=await partial.engine.quote(input);await partial.purchase(await partial.quote([{lineIndex:0,qty:1}]));await assert.rejects(partial.purchase(quote),/portions/);await assert.rejects(partial.engine.quote(input),/portions/);
});
test('fresh discount and ledger reads reject tampered or stale quoted quantities',async()=>{
 for(const edit of [quote=>({...quote,amount:1}),quote=>({...quote,selection:[{...quote.selection[0],baseCents:1}]}),quote=>({...quote,selection:[{...quote.selection[0],priorPurchasedQty:1}]})]){const f=await fixture(),q=edit(await f.quote([{lineIndex:0,qty:1}])),before=structuredClone([...f.h.docs]);await assert.rejects(f.purchase(q));assert.deepEqual([...f.h.docs],before);}
 const f=await fixture(),q=await f.quote([{lineIndex:0,qty:1}]);f.h.put('settings/global_pos_config',{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:30});await assert.rejects(f.purchase(q),/changed/);
});
test('commit denial leaves no orphan and retry after a later shift closure acknowledges a saved result',async()=>{const f=await fixture(),q=await f.quote([{lineIndex:0,qty:1}]),before=structuredClone([...f.h.docs]);f.h.failNextCommit();await assert.rejects(f.purchase(q),/Commit rejected/);assert.deepEqual([...f.h.docs],before);await f.purchase(q);f.h.put('shifts/'+shiftId,{branch,active:false,status:'Closed',salesRevision:2});assert.equal((await f.purchase(q)).alreadyPurchased,true);});
test('the selection form escapes original text and starts every quantity at zero',async()=>{const f=await fixture([row('<img src=x onerror=alert(1)>',2,20,{notes:'<script>bad</script>'})]),html=cancelledFoodPortionForm(await f.engine.available(input));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/value="0"/);assert.match(html,/2 of 2 remaining/);assert.match(html,/Other staff can buy the remaining food/);});
test('secure purchase identities fail closed when random support is unavailable',()=>{assert.throws(()=>createCancelledFoodOperationId({}),/Secure purchase IDs/);assert.match(createCancelledFoodOperationId(),/^[a-f0-9]{32}$/);});
test('split modifiers remain explicitly attached to their original receipt quantity',async()=>{const f=await fixture([row('Sample shake',2,200,{addons:{Cream:{qty:1,price:10}}})]),offer=await f.engine.available(input),answer=await f.purchase(quoteCancelledFoodPortion(offer,[{lineIndex:0,qty:1}],op(1)));const item=f.h.get('staff_deductions/'+answer.saleId).purchasedItems[0];assert.equal(item.sourceOriginalQty,2);assert.equal(item.qty,1);assert.deepEqual(item.addons,{Cream:{qty:1,price:10}});assert.match(cancelledFoodPortionForm(offer),/Original line extras \(2 items\)/);});
for(const item of [row('Invalid quantity',100001,100),row('Invalid price',1,100000001)])test('absurd original receipt data gets a clear review error rather than a failed save '+item.name,async()=>{const f=await fixture([item]),before=structuredClone([...f.h.docs]);await assert.rejects(f.engine.available(input),/needs HQ review/);assert.deepEqual([...f.h.docs],before);});
