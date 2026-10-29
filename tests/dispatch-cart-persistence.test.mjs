import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {reportDetailsHTML,purchaseQuantity,escapeStock} from '../takodeal-manager/stock-cycle.js';

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
// Compile every assignment, including any later legacy override, in the exact
// source order. Testing only the first definition concealed this regression.
function assignments(name,text=source){
 const pattern=new RegExp('window\\.'+name+'\\s*=(?![=>])','g'),found=[];
 for(const match of text.matchAll(pattern)){
  let statement;for(let end=text.indexOf(';',match.index);end>=0;end=text.indexOf(';',end+1)){
   const candidate=text.slice(match.index,end+1);try{new vm.Script(candidate);statement=candidate;break;}catch(error){if(!(error instanceof SyntaxError))throw error;}
  }
  assert.ok(statement,'The actual '+name+' assignment must be executable.');found.push({index:match.index,statement});
 }
 assert.ok(found.length,'The actual '+name+' handler must exist.');return found;
}
const cart=[
 {sourceId:'fiction-zero',name:'Fictional Zero Row',itemName:'Fictional Zero Row',qty:0,rawQty:0,baseUom:'Gram',uom:'Gram',purchaseUom:'Pack',conversionRate:1000,convRate:1,selectedUom:'base',hqStock:0},
 {sourceId:'fiction-positive',name:'Fictional Positive Row',itemName:'Fictional Positive Row',qty:2500,rawQty:2.5,baseUom:'Gram',uom:'Gram',purchaseUom:'Pack',conversionRate:1000,convRate:1000,selectedUom:'purch',hqStock:5000},
 {sourceId:'fiction-count',name:'Fictional Physical Count Row',itemName:'Fictional Physical Count Row',qty:250,rawQty:.25,baseUom:'Gram',uom:'Gram',purchaseUom:'Pack',conversionRate:1000,convRate:1000,selectedUom:'purch',hqStock:1000,requestType:'Low Stock',physicalStock:750,systemStock:1000,maintainingStock:3000,countSnapshot:{version:1,baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:0,baseCount:750,totalBaseQty:750}}
];
function storageFixture(rows=cart){
 const storage={},writes=[],removals=[];let failed=false;
 Object.defineProperties(storage,{getItem:{value:key=>Object.hasOwn(storage,key)?storage[key]:null},setItem:{value:(key,value)=>{if(failed)throw Error('Synthetic local storage denied');writes.push([key,String(value)]);storage[key]=String(value);}},removeItem:{value:key=>{removals.push(key);delete storage[key];}}});
 Object.assign(storage,{takodeal_dispatch_cart:JSON.stringify(rows),takodeal_dispatch_from:'Cabantian',takodeal_dispatch_to:'Maa',takodeal_active_po:'fictional-pending-po',takodeal_dispatch_attempt:JSON.stringify({id:'fictional-in-flight-delivery',state:'awaiting-response'}),takodeal_dispatch_draft_attempt:JSON.stringify({id:'fictional-linked-request'}),unrelated_profile_draft:'keep this draft',takodeal_draft_qty_0:'stale index zero',takodeal_draft_qty_1:'stale index one'});
 return {storage,writes,removals,fail:()=>{failed=true;},recover:()=>{failed=false;}};
}
function runtime(shared=storageFixture(),text=source){
 const nodes={dispatchCartBody:{tagName:'TBODY',innerHTML:''},btnSetAsideDispatch:{disabled:true},dispFrom:{innerHTML:'',value:''},dispTo:{innerHTML:'',value:''},btnSubmitDispatch:{innerText:''}},calls={inventoryLoads:0,listeners:0,businessWrites:0},notifications=[];
 const window={dispatchCart:[],dispatchInventoryList:[],globalActiveBranches:['Main Office','Cabantian','Maa'],sessionUser:{isOwner:true,isFranchisee:false},activePurchaseOrder:'fictional-pending-po',startPOListener:()=>calls.listeners++,loadDispatchInventory:async()=>{calls.inventoryLoads++;},ManagerUI:{notify:value=>notifications.push(value)}};
 const forbid=()=>{calls.businessWrites++;assert.fail('Editing a local cart must not write stock, deliveries, purchase orders or financial records.');};
 const context=vm.createContext({window,document:{getElementById:id=>nodes[id]||null},localStorage:shared.storage,reportDetailsHTML,purchaseQuantity,escapeStock,console:{error(){},warn(){}},addDoc:forbid,setDoc:forbid,updateDoc:forbid,deleteDoc:forbid,writeBatch:forbid,runTransaction:forbid});
 const handlers=['loadDispatchDashboard','renderDispatchCart','removeFromDispatchCart'].flatMap(name=>assignments(name,text)).sort((a,b)=>a.index-b.index);
 for(const handler of handlers)vm.runInContext(handler.statement,context);
 return {window,nodes,calls,notifications,shared,open:()=>window.loadDispatchDashboard(),rows:()=>copy(window.dispatchCart),stored:()=>JSON.parse(shared.storage.getItem('takodeal_dispatch_cart'))};
}
const unrelated=shared=>Object.fromEntries(Object.keys(shared.storage).filter(key=>key!=='takodeal_dispatch_cart'&&!key.startsWith('takodeal_draft_qty_')).sort().map(key=>[key,shared.storage.getItem(key)]));
for(const index of [0,1,2])test('actual final Remove handler persists removal of mixed-cart row '+index+' across tab reopen and a fresh runtime',async()=>{
 const shared=storageFixture(),f=runtime(shared),kept=cart.filter((_,position)=>position!==index),preserved=unrelated(shared);await f.open();assert.deepEqual(f.rows(),cart);assert.match(f.nodes.dispatchCartBody.innerHTML,/Branch reported count/);
 assert.equal(f.window.removeFromDispatchCart(index),true);assert.deepEqual(f.rows(),kept);assert.deepEqual(f.stored(),kept);assert.doesNotMatch(f.nodes.dispatchCartBody.innerHTML,new RegExp(cart[index].name));
 await f.open();assert.deepEqual(f.rows(),kept);assert.deepEqual(f.stored(),kept);assert.equal(f.nodes.dispFrom.value,'Cabantian');assert.equal(f.nodes.dispTo.value,'Maa');assert.equal(f.window.activePurchaseOrder,'fictional-pending-po');assert.deepEqual(unrelated(shared),preserved);
 const reload=runtime(shared);await reload.open();assert.deepEqual(reload.rows(),kept);assert.deepEqual(reload.stored(),kept);assert.equal(reload.nodes.dispFrom.value,'Cabantian');assert.equal(reload.nodes.dispTo.value,'Maa');assert.equal(reload.calls.businessWrites+f.calls.businessWrites,0);
 assert.ok(shared.writes.every(([key])=>key==='takodeal_dispatch_cart'));assert.ok(shared.removals.every(key=>key.startsWith('takodeal_draft_qty_')));assert.deepEqual(unrelated(shared),preserved);
});
test('removing every actual cart row keeps an explicit empty draft after reopening and browser reload',async()=>{
 const shared=storageFixture(),f=runtime(shared),preserved=unrelated(shared);await f.open();while(f.window.dispatchCart.length)assert.equal(f.window.removeFromDispatchCart(0),true);
 assert.deepEqual(f.rows(),[]);assert.equal(shared.storage.getItem('takodeal_dispatch_cart'),'[]');assert.match(f.nodes.dispatchCartBody.innerHTML,/Cart is empty/);assert.equal(f.nodes.btnSetAsideDispatch.disabled,true);
 await f.open();assert.deepEqual(f.rows(),[]);const reload=runtime(shared);await reload.open();assert.deepEqual(reload.rows(),[]);assert.deepEqual(reload.stored(),[]);assert.match(reload.nodes.dispatchCartBody.innerHTML,/Cart is empty/);assert.deepEqual(unrelated(shared),preserved);assert.equal(f.calls.businessWrites+reload.calls.businessWrites,0);
});
test('invalid Remove indices preserve visible rows, quantities, storage and pending deliveries',async()=>{
 const shared=storageFixture(),f=runtime(shared);await f.open();const before=copy(shared.storage),markup=f.nodes.dispatchCartBody.innerHTML;
 for(const index of [-1,cart.length,100,.5,NaN,Infinity,'1',null,undefined,{},[]]){assert.equal(f.window.removeFromDispatchCart(index),false);assert.deepEqual(f.rows(),cart);assert.deepEqual(copy(shared.storage),before);assert.equal(f.nodes.dispatchCartBody.innerHTML,markup);}
 assert.equal(shared.writes.length,0);assert.equal(shared.removals.length,0);assert.deepEqual(f.notifications,[]);assert.equal(f.calls.businessWrites,0);
});
test('denied device storage leaves both the rendered and stored cart unchanged and reports a retryable failure',async()=>{
 const shared=storageFixture(),f=runtime(shared);await f.open();const before=copy(shared.storage),markup=f.nodes.dispatchCartBody.innerHTML;shared.fail();
 assert.equal(f.window.removeFromDispatchCart(1),false);assert.deepEqual(f.rows(),cart);assert.deepEqual(copy(shared.storage),before);assert.equal(f.nodes.dispatchCartBody.innerHTML,markup);assert.match(f.notifications[0],/Unable to save this cart change.*retry/);assert.equal(shared.removals.length,0);
 await f.open();assert.deepEqual(f.rows(),cart);const reload=runtime(shared);await reload.open();assert.deepEqual(reload.rows(),cart);assert.equal(f.calls.businessWrites+reload.calls.businessWrites,0);
 shared.recover();assert.equal(f.window.removeFromDispatchCart(1),true);assert.deepEqual(f.stored(),[cart[0],cart[2]]);
});
test('retained purchase units and physical-count metadata are unchanged by removal or reopening',async()=>{
 const f=runtime();await f.open();f.window.removeFromDispatchCart(0);await f.open();assert.deepEqual(f.rows(),[cart[1],cart[2]]);assert.equal(f.rows()[0].rawQty,2.5);assert.equal(f.rows()[0].qty,2500);assert.equal(f.rows()[0].selectedUom,'purch');assert.deepEqual(f.rows()[1].countSnapshot,cart[2].countSnapshot);assert.match(f.nodes.dispatchCartBody.innerHTML,/value="2.5"/);assert.match(f.nodes.dispatchCartBody.innerHTML,/value="0.25"/);assert.equal(f.calls.businessWrites,0);
});
test('the regression harness applies a later override rather than accidentally testing only the first definition',async()=>{
 const legacy=source+'\nwindow.removeFromDispatchCart = function(index) { window.dispatchCart.splice(index,1); window.renderDispatchCart(); };',shared=storageFixture(),f=runtime(shared,legacy);await f.open();
 f.window.removeFromDispatchCart(1);assert.deepEqual(f.rows(),[cart[0],cart[2]]);assert.deepEqual(f.stored(),cart,'The synthetic legacy override intentionally lacks persistence.');await f.open();assert.deepEqual(f.rows(),cart,'Executing every assignment exposes the original resurrection behavior.');
});
test('production has one canonical Remove definition after deleting the obsolete override',()=>{
 assert.equal(assignments('removeFromDispatchCart').length,1);
});
