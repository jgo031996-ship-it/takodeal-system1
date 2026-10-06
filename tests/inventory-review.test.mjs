import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSaleEngine, SALE_VERSION } from '../Takodeal-POS/pos-safety.js';
import { ensureShiftSalesUploaded, createShiftSalesFeed } from '../Takodeal-POS/shift-sales.js';
import { firestoreHarness } from './helpers/firestore-harness.mjs';

const sale = (overrides = {}) => ({ saleVersion: SALE_VERSION, saleId: 'octopus-sale', receiptId: '20261004-0093-817BC060',
    branch: 'Maa', shiftId: 'S1', cashier: 'Cashier', netTotal: 640, paymentMethod: 'GCash', paymentVerified: false,
    localTimestamp: '2026-10-04T14:21:00Z', cart: [{name:'6 Pcs Takoyaki',qty:2}],
    recipeSnapshot: [{menuItem:'6 Pcs Takoyaki',ingredientName:'Batter',qty:6}, {menuItem:'6 Pcs Takoyaki',ingredientName:'Octopus',qty:10}], ...overrides });
function setup() {
    const h = firestoreHarness();
    h.put('inventory/batter', {branch:'Maa',name:'Batter',currentStock:100});
    h.put('inventory/cooked', {branch:'Maa',name:'Cooked Octopus',currentStock:1000});
    h.put('inventory/office-matcha', {branch:'Main Office',name:'Ceremonial Matcha',currentStock:1000});
    return {h, engine:createSaleEngine(h.api)};
}

test('both held Maa receipts upload their full amounts while preserving unmatched quantities', async () => {
    const {h,engine}=setup();
    const payloads=[sale(),sale({saleId:'matcha-sale',receiptId:'20261004-0091-FD26A49B',netTotal:625,
        cart:[{name:'Matcha Latte',qty:1}],recipeSnapshot:[{menuItem:'Matcha Latte',ingredientName:'Ceremonial Matcha',qty:6}]})];
    for(const payload of payloads) {
        const prepared=await engine.prepare(payload);
        await Promise.all(Array.from({length:10},()=>engine.commit(prepared)));
        const saved=h.get('transactions/'+payload.saleId);
        assert.equal(saved.netTotal,payload.netTotal); assert.equal(saved.receiptId,payload.receiptId);
        assert.equal(saved.paymentVerified,false); assert.equal(saved.inventoryReviewRequired,true);
        assert.equal(saved.inventoryIssues[0].ingredientName,payload.recipeSnapshot.at(-1).ingredientName);
        assert.equal(saved.inventoryIssues[0].quantity,payload.saleId==='octopus-sale'?20:6);
        const alert=h.get('manager_alerts/inventory-review-'+payload.saleId);
        assert.equal(alert.receiptId,payload.receiptId); assert.deepEqual(alert.inventoryIssues,saved.inventoryIssues);
    }
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('transactions/')).length,2);
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('manager_alerts/')).length,2);
    assert.equal(h.get('inventory/batter').currentStock,88);
    assert.equal(h.get('inventory/cooked').currentStock,1000);
    assert.equal(h.get('inventory/office-matcha').currentStock,1000);
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls,12);
});

test('duplicate ingredients are not deducted and the exact skipped quantity stays on the receipt', async()=>{
    const {h,engine}=setup();
    for(const id of ['a','b']) h.put('inventory/'+id,{branch:'Maa',name:'Octopus',currentStock:100});
    await engine.commit(await engine.prepare(sale()));
    const issue=h.get('transactions/octopus-sale').inventoryIssues[0];
    assert.equal(issue.reason,'duplicate'); assert.equal(issue.matches,2); assert.equal(issue.quantity,20);
    assert.equal(h.get('inventory/a').currentStock,100); assert.equal(h.get('inventory/b').currentStock,100);
});

test('commit failure rolls back receipt, known stock and inventory alert together',async()=>{
    const {h,engine}=setup(), prepared=await engine.prepare(sale());
    h.failNextCommit(); await assert.rejects(engine.commit(prepared));
    assert.equal(h.get('transactions/octopus-sale'),undefined);
    assert.equal(h.get('manager_alerts/inventory-review-octopus-sale'),undefined);
    assert.equal(h.get('inventory/batter').currentStock,100);
    h.loseNextAck(); await assert.rejects(engine.commit(prepared));
    assert.equal(await engine.alreadyCommitted(sale()),true); await engine.commit(prepared);
    assert.equal(h.get('inventory/batter').currentStock,88);
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('manager_alerts/')).length,1);
});

test('stock added after preparation does not silently change the recorded review decision',async()=>{
    const {h,engine}=setup(), prepared=await engine.prepare(sale());
    h.put('inventory/octopus',{branch:'Maa',name:'Octopus',currentStock:100});
    assert.deepEqual(await engine.prepare(prepared),prepared);
    await engine.commit(prepared);
    assert.equal(h.get('inventory/octopus').currentStock,100);
    assert.equal(h.get('transactions/octopus-sale').inventoryIssues[0].quantity,20);
});

test('query permission errors and invalid recipe quantities still prevent upload',async()=>{
    const {h,engine}=setup();
    h.api.getDocsFromServer=async()=>{throw Object.assign(Error('Missing permissions'),{code:'permission-denied'});};
    await assert.rejects(createSaleEngine(h.api).prepare(sale()),/Missing permissions/);
    await assert.rejects(engine.prepare(sale({recipeSnapshot:[{menuItem:'6 Pcs Takoyaki',ingredientName:'Octopus',qty:NaN}]})),/Invalid ingredient/);
    assert.equal(h.get('transactions/octopus-sale'),undefined);
});

test('audit resume and repeated voids touch only recorded stock and cancel unmatched review',async()=>{
    const {h,engine}=setup();
    const prepared=await engine.prepare(sale({auditDeferred:true}));
    await engine.commit(prepared); assert.equal(h.get('inventory/batter').currentStock,100);
    await engine.resumeAudit('Maa'); await engine.resumeAudit('Maa');
    assert.equal(h.get('inventory/batter').currentStock,88);
    await engine.voidSale(prepared.receiptId,'Owner','Maa'); await engine.voidSale(prepared.receiptId,'Owner','Maa');
    assert.equal(h.get('inventory/batter').currentStock,100);
    assert.equal(h.get('inventory/cooked').currentStock,1000);
    assert.equal(h.get('manager_alerts/inventory-review-octopus-sale').reviewStatus,'Cancelled');
    assert.equal(h.get('transactions/octopus-sale').inventoryState,'reversed');
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls,0);
});

test('shift close retries authoritative pending rows, including a sale added during the first sync',async()=>{
    const rows=[sale()]; let attempts=0;
    const w={offlineQueue:[],getPendingSales:async()=>rows,syncOfflineQueue:async()=>{
        rows.shift(); if(++attempts===1) rows.push(sale({saleId:'new-sale'}));
    }};
    await ensureShiftSalesUploaded(w,{branch:'Maa',shiftId:'S1',startTime:'2026-10-04T00:00:00Z'});
    assert.equal(attempts,2); assert.equal(rows.length,0);
});

test('shift close retains genuine upload failures and exposes their receipts instead of clearing them',async()=>{
    const row=sale({syncError:{message:'Missing or insufficient permissions.'}});
    const rows=[row]; const w={getPendingSales:async()=>rows,syncOfflineQueue:async()=>{}};
    await assert.rejects(ensureShiftSalesUploaded(w,{branch:'Maa',shiftId:'S1',startTime:new Date(0)}),error=>{
        assert.equal(error.code,'sales-pending'); assert.match(error.message,/0093-817BC060/);
        assert.match(error.message,/permissions/); return true;
    });
    assert.deepEqual(rows,[row]);
});

test('other branches and completed shifts do not block this drawer; unknown current records remain visible',async()=>{
    const rows=[sale({branch:'Cabantian'}),sale({shiftId:'OLD'})];
    const w={getPendingSales:async()=>rows,syncOfflineQueue:async()=>{throw Error('Must not sync');}};
    await ensureShiftSalesUploaded(w,{branch:'Maa',shiftId:'S1',startTime:new Date(0)});
    rows.push(sale({shiftId:'UNKNOWN',localTimestamp:'2026-10-04T14:21:00Z'}));
    w.syncOfflineQueue=async()=>{};
    await assert.rejects(ensureShiftSalesUploaded(w,{branch:'Maa',shiftId:'S1',startTime:new Date(0)}),/still awaiting upload/);
});

test('live feed scopes rows to the active shift and discards late snapshots after branch changes or navigation',async()=>{
    const listeners=[],rendered=[]; let stopped=0;
    const api={db:{},collection:(_,table)=>table,query:(table,...filters)=>({table,filters}),where:(key,op,value)=>({key,op,value}),
        onSnapshot:(q,callback)=>{listeners.push({q,callback});return()=>stopped++;}};
    const feed=createShiftSalesFeed(api,rows=>rendered.push(rows));
    const start='2026-10-04T00:00:00Z'; feed.start('Maa',start,'S1'); feed.start('Maa',start,'S1');
    assert.equal(listeners.length,1);
    const snapshot=rows=>({docs:rows.map((data,id)=>({id:String(id),data:()=>data}))});
    listeners[0].callback(snapshot([sale(),sale({branch:'Cabantian'}),sale({shiftId:'OLD'})]));
    assert.equal(rendered[0].length,1);
    feed.start('Cabantian',start,'S2'); listeners[0].callback(snapshot([sale()]));
    assert.equal(rendered.length,1); assert.equal(stopped,1);
    feed.stop(); listeners[1].callback(snapshot([sale({branch:'Cabantian',shiftId:'S2'})]));
    assert.equal(rendered.length,1); assert.equal(stopped,2);
});

async function closeFlow(blocked=false) {
    const {h,engine}=setup(); let rows=[sale(),sale({saleId:'matcha-sale',receiptId:'20261004-0091-FD26A49B',netTotal:625,
        cart:[{name:'Matcha Latte',qty:1}],recipeSnapshot:[{menuItem:'Matcha Latte',ingredientName:'Ceremonial Matcha',qty:6}]})];
    const messages=[],closed=[]; const values=new Map([['takodeal_device_branch','Maa'],['currentShiftId','S1']]);
    const storage={getItem:key=>values.get(key),removeItem:key=>values.delete(key)};
    const w={...h.api,sessionUser:{cashierName:'Cashier'},saveCurrentShiftCloseDraft(){},getPendingSales:async()=>rows,
        getDocFromServer:async()=>({exists:()=>true,data:()=>({active:true,isMallBranch:false})}),
        getDocs:async()=>{throw Error('Cached financial query must not be used');},
        syncOfflineQueue:async()=>{if(blocked)return;for(const row of rows)await engine.commit(await engine.prepare(row));rows=[];}};
    const server=w.getDocsFromServer;w.getDocsFromServer=async q=>{const s=await server(q);return {...s,forEach:fn=>s.docs.forEach(fn)};};
    const context={window:w,localStorage:storage,console:{error(){}},Date,ensureShiftSalesUploaded,
        document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null},
        activeShiftDetails:{logId:'S1',startTime:new Date('2026-10-04T00:00:00Z'),startingCash:0},
        Swal:{fire:async(...args)=>{messages.push(args);return {isConfirmed:true};}},
        readBranchPolicy:async()=>({}),closeShiftAtomic:async(_,input)=>closed.push(input),clearCurrentShiftCloseDraft(){}};
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    const start=source.indexOf('window.MASTER_CloseShift = async function');
    const end=source.indexOf('\n};',start)+4;
    vm.runInNewContext(source.slice(start,end),context); await w.MASTER_CloseShift();
    return {h,closed,messages,values,rows};
}
test('actual close handler uploads the two held sales, settles full server totals and informs cashier of skipped stock',async()=>{
    const {closed,messages,values,rows}=await closeFlow();
    assert.equal(closed.length,1);assert.equal(closed[0].totalDigitalSales,1265);assert.equal(closed[0].totalCashSales,0);
    assert.equal(closed[0].digitalBreakdown.GCash,1265);assert.equal(rows.length,0);assert.equal(values.has('currentShiftId'),false);
    assert.ok(messages.some(([message])=>message?.text?.includes('2 receipt(s) have skipped stock deductions')));
});
test('actual close handler preserves the drawer and never settles when upload is still blocked',async()=>{
    const {closed,values,rows,messages}=await closeFlow(true);
    assert.equal(closed.length,0);assert.equal(values.get('currentShiftId'),'S1');assert.equal(rows.length,2);
    assert.ok(messages.some(args=>String(args[1]).includes('still awaiting upload')));
});

test('HQ review alerts display ingredient names as text and preserve their original spelling',async()=>{
    const {h,engine}=setup(); const name='<img src=x onerror=alert(1)> Sauce';
    await engine.commit(await engine.prepare(sale({recipeSnapshot:[{menuItem:'6 Pcs Takoyaki',ingredientName:name,qty:3}]})));
    const alert=h.get('manager_alerts/inventory-review-octopus-sale');
    assert.ok(!alert.message.includes('<img'));assert.match(alert.message,/&lt;img/);
    assert.equal(alert.inventoryIssues[0].ingredientName,name);assert.equal(alert.inventoryIssues[0].quantity,6);
});

test('an in-flight sales render cannot overwrite the closed-register view or read a cleared shift',async()=>{
    const errors=[],body={innerHTML:''};let release;
    const w={sessionUser:{branch:'Maa'},currentShift:{active:true,shiftId:'S1',startTime:new Date(0)},
        getSalesDashboardData:async()=>[],query:()=>({}),collection:()=>({}),where:()=>({}),db:{},
        getParkedShiftSales:async()=>[],mergeParkedShiftSales:rows=>rows,
        getPendingSales:()=>new Promise(resolve=>{release=resolve;}),
        mergePendingSales:rows=>rows};
    const source=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
    const start=source.indexOf('window.loadSalesDashboard = async function');
    vm.runInNewContext(source.slice(start,source.indexOf('\n};',start)+4),{window:w,Date,
        document:{getElementById:id=>id==='view-sales'?{classList:{contains:()=>true}}:body},console:{error:(...args)=>errors.push(args)}});
    const old=w.loadSalesDashboard();
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(release);w.currentShift=null;await w.loadSalesDashboard();release([]);await old;
    assert.match(body.innerHTML,/Register is Closed/);assert.deepEqual(errors,[]);
});
