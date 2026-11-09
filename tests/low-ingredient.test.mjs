import test from 'node:test';
import assert from 'node:assert/strict';
import {postedIngredientIds,lowIngredientPosition,createLowIngredientReader} from '../Takodeal-POS/low-ingredient-model.js';
import {installCashierLowIngredients} from '../Takodeal-POS/low-ingredient-ui.js';
import {ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
const sale=(id='sale-1',extra={})=>({saleId:id,branch:'Maa',saleVersion:2,statsApplied:true,inventoryState:'applied',inventoryMovements:[{inventoryId:'flour',ingredientName:'Flour',quantity:25}],...extra});
const stock=(extra={})=>({branch:'Maa',name:'Flour',baseUom:'gram',uom:'gram',currentStock:10,lowStockAlert:100,reorderLevel:100,...extra});
const identity={id:'flour',name:'Flour',branch:'Maa'};
const snapshot=row=>({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>row!==undefined,data:()=>structuredClone(row)});
function fixture(options={}){
 const records=new Map([['transactions/sale-1',sale()],['inventory/flour',stock()]]),reads=[],document=new ReviewDocument();document.querySelectorAll=selector=>document.body.querySelectorAll(selector);const create=document.createElement.bind(document);document.createElement=tag=>{const node=create(tag);node.remove=()=>{if(node.parentElement){node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=null;}};return node;};
 const receipt=document.createElement('div');receipt.id='receiptModal';receipt.style={display:'none'};document.body.append(receipt);
 const auth={currentUser:{uid:'signed-in-tablet'}},api={db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>{reads.push(ref.table+'/'+ref.id);return snapshot(records.get(ref.table+'/'+ref.id));},assertStockAuditCurrent(){}},intervals=[],opened=[],notifications=[],w={sessionUser:{staffId:'cashier',cashierName:'Fictional Cashier',branch:'Maa'},cart:[],setInterval:callback=>{intervals.push(callback);return 1;},clearInterval(){},addEventListener(){},openActualIngredientCount:async value=>opened.push(value),Swal:{fire:(...args)=>notifications.push(args)}};
 const controller=installCashierLowIngredients(w,document,{primaryAuth:auth,resolveApi:async()=>({api}),...options});
 return {records,reads,document,api,auth,w,controller,opened,notifications,intervals,dialog:()=>document.querySelector('dialog'),button:text=>document.querySelectorAll('button').find(button=>button.textContent===text),async commit(id='sale-1'){if(!records.has('transactions/'+id))records.set('transactions/'+id,sale(id));await controller.committedSale({saleId:id,branch:'Maa'});},async show(){controller.receiptClosed();await drain();}};
}
test('only exact posted applied sale metadata can supply ingredient IDs, including zero-net discounted sales',()=>{
 assert.deepEqual(postedIngredientIds(sale('sale-1',{netTotal:0,globalDiscountType:'staff_meal'}),'sale-1','Maa'),[{id:'flour',name:'Flour'}]);
 const mobileId='mobile-%5B%22Maa%22%2C%22OR-123%22%5D';assert.deepEqual(postedIngredientIds(sale(mobileId,{mobileOrderId:'order-123'}),mobileId,'Maa'),[{id:'flour',name:'Flour'}]);
 for(const change of [{branch:'Other'},{saleId:'other'},{saleVersion:1},{statsApplied:false},{inventoryState:'deferred'},{status:'Voided'},{status:'Pending'},{status:null},{inventoryMovements:[{inventoryId:'../other',ingredientName:'Flour',quantity:1}]},{inventoryMovements:[{inventoryId:'flour',ingredientName:'Flour',quantity:0}]},{inventoryMovements:Array(201).fill({inventoryId:'flour',ingredientName:'Flour',quantity:1})}])assert.deepEqual(postedIngredientIds(sale('sale-1',change),'sale-1','Maa'),[]);
});
test('low comparisons stay in recorded base units and reject ambiguous thresholds, units and malformed numbers',()=>{
 const row=lowIngredientPosition(stock({purchaseUom:'Pack',conversionRate:1000}),identity);assert.equal(row.status,'low');assert.equal(row.stock,10);assert.equal(row.baseUom,'gram');
 assert.equal(lowIngredientPosition(stock({currentStock:101}),identity).status,'sufficient');assert.equal(lowIngredientPosition(stock({currentStock:-1}),identity).status,'low');
 for(const change of [{branch:'Other'},{name:'Other'},{uom:'kilogram'},{baseUom:'',uom:''},{currentStock:''},{currentStock:true},{currentStock:'NaN'},{lowStockAlert:-1,reorderLevel:-1},{lowStockAlert:100,reorderLevel:99},{lowStockAlert:null,reorderLevel:null}])assert.equal(lowIngredientPosition(stock(change),identity).status,'unknown',JSON.stringify(change));
});
test('reader fetches exact current-branch IDs only, never reinterprets recipes and rejects cached evidence',async()=>{
 const f=fixture(),rows=await createLowIngredientReader(f.api).read({saleId:'sale-1',branch:'Maa'});assert.equal(rows[0].status,'low');assert.deepEqual(f.reads,['transactions/sale-1','inventory/flour']);
 f.api.getDocFromServer=async()=>({...snapshot(sale()),metadata:{fromCache:true,hasPendingWrites:false}});await assert.rejects(createLowIngredientReader(f.api).read({saleId:'sale-1',branch:'Maa'}),/confirmed/);
});
test('a posted-sale check remains read only and shows only after receipt close at an idle checkout',async()=>{
 const f=fixture(),before=structuredClone([...f.records]);await f.commit();assert.equal(f.dialog(),null);f.w.cart=[{name:'Next order',qty:1}];await f.show();assert.equal(f.dialog(),null);f.w.cart=[];f.controller.showPending();assert.equal(f.dialog().open,true);assert.match(f.dialog().textContent,/Flour/);assert.match(f.dialog().textContent,/10 gram/);assert.match(f.dialog().textContent,/100 gram/);assert.deepEqual([...f.records],before);
});
test('Ignore for now is exact-ingredient scoped and expires on changed quantity or recovery',async()=>{
 const f=fixture();await f.commit();await f.show();f.button('Ignore for now').click();assert.equal(f.dialog(),null);await f.commit('sale-2');assert.equal(f.dialog(),null);
 f.records.set('inventory/flour',stock({currentStock:9}));await f.commit('sale-3');assert.ok(f.dialog());f.button('Ignore for now').click();f.records.set('inventory/flour',stock({currentStock:200}));await f.commit('sale-4');assert.equal(f.dialog(),null);f.records.set('inventory/flour',stock());await f.commit('sale-5');assert.ok(f.dialog());
});
test('Ignore has a bounded15-minute lifetime even when the same balance returns without an observed recovery',async()=>{
 let clock=1000;const f=fixture({now:()=>clock});await f.commit();await f.show();f.button('Ignore for now').click();clock+=15*60*1000;await f.commit('after-ignore-expiry');assert.ok(f.dialog());
});
test('Input actual stock only opens the existing audited count flow without prefilled quantity or automatic writes',async()=>{
 const f=fixture(),before=structuredClone([...f.records]);await f.commit();await f.show();f.button('Input actual stock').click();await drain();assert.deepEqual(f.opened,[{inventoryId:'flour',name:'Flour',branch:'Maa'}]);assert.equal(f.dialog(),null);assert.deepEqual([...f.records],before);assert.equal(f.notifications.length,0);
});
test('account/branch changes retire visible and late alerts, clear ignored state, and never open a stale count',async()=>{
 const f=fixture();await f.commit();await f.show();const stale=f.button('Input actual stock');f.w.sessionUser={...f.w.sessionUser,branch:'Other',staffId:'other'};f.intervals[0]();assert.equal(f.dialog(),null);stale.click();await drain();assert.equal(f.opened.length,0);
 f.w.sessionUser={staffId:'cashier',cashierName:'Fictional Cashier',branch:'Maa'};const gate=deferred(),real=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{if(ref.table==='inventory')await gate.promise;return real(ref);};const work=f.commit('sale-late');await drain();f.auth.currentUser={uid:'new-account'};gate.resolve();await work;await f.show();assert.equal(f.dialog(),null);assert.equal(f.opened.length,0);
});
test('failed, deferred, ambiguous and foreign-branch checks do not manufacture a low-stock popup',async()=>{
 const f=fixture();f.records.set('transactions/sale-1',sale('sale-1',{inventoryState:'deferred'}));await f.commit();await f.show();assert.equal(f.dialog(),null);assert.deepEqual(f.reads,['transactions/sale-1']);
 f.records.set('transactions/sale-2',sale('sale-2'));f.records.set('inventory/flour',stock({branch:'Other'}));await f.commit('sale-2');assert.equal(f.dialog(),null);
 f.api.getDocFromServer=async()=>{throw Error('Denied');};await f.commit('sale-3');assert.equal(f.dialog(),null);assert.equal(f.opened.length,0);
});
