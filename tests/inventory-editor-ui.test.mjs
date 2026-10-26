import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewDocument,ReviewElement,deferred,tick} from './helpers/review-dom.mjs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {installInventoryEditor} from '../takodeal-manager/inventory-editor.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';

// Extend the existing small DOM only inside this fixture. The controller,
// markup, edit planner and optimistic database transaction are the real ones;
// no production SDK, authentication, storage or business data is loaded.
function documentFixture(){
 const d=new ReviewDocument(),html=Object.getOwnPropertyDescriptor(ReviewElement.prototype,'innerHTML');
 function enhance(node){
  if(node.fixtureEnhanced)return node;node.fixtureEnhanced=true;node.style={};node.checked=false;node.files=[];node.hidden=Object.hasOwn(node.attributes,'hidden');
  Object.defineProperty(node,'className',{get:()=>node.attributes.class||'',set:value=>{node.attributes.class=String(value);},configurable:true});
  node.classList={add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');}};
  const matches=node.matches.bind(node);node.matches=selector=>selector.startsWith('.')?node.className.split(/\s+/).includes(selector.slice(1)):matches(selector);
  node.removeAttribute=name=>{delete node.attributes[name];};
  node.replaceChildren=(...children)=>{for(const child of node.children)child.parentElement=null;node.children=[];node._text='';node._html='';node.append(...children);};
  node.focus=()=>{d.activeElement=node;};node.getClientRects=()=>node.hidden?[]:[{}];
  Object.defineProperty(node,'type',{get:()=>node.attributes.type||'',configurable:true});
  Object.defineProperty(node,'innerHTML',{get(){return html.get.call(this);},set(value){html.set.call(this,value);const walk=parent=>{for(const child of parent.children){enhance(child);walk(child);}};walk(this);},configurable:true});
  return node;
 }
 enhance(d.body);d.head=enhance(new ReviewElement('head',d));d.activeElement=d.body;
 d.createElement=tag=>enhance(new ReviewElement(tag,d));
 const overlay=d.createElement('div');overlay.id='editInvModal';d.body.append(overlay);
 return d;
}

function fixture({sourceCost=100,menuRefresh,stockRefresh}={}){
 const h=firestoreHarness(),d=documentFixture(),notifications=[],invalidations=[],writes=[],refreshes=[];
 const actor={uid:'sample-owner',email:OWNER_EMAIL};
 h.put('hq_managers/access',{email:OWNER_EMAIL,pin:'synthetic',role:'Owner',permissions:['all'],assignedBranch:'All',active:true});
 for(const [id,branch,cost,currentStock] of [['cab','Cabantian',sourceCost,-1200],['maa','Maa',100,4300],['city','Citygate',100,-50],['agdao','Agdao',100,0],['hq','Main Office',77,20000]]){
  h.put('branches/'+id,{name:branch,active:true});
  h.put('inventory/'+id,{name:'Ice Cubes',branch,category:'Ingredients',purchaseUom:'Kilo',purchUom:'Kilo',baseUom:'gram',uom:'gram',conversionRate:1000,conversion:1000,purchaseCost:cost,purchCost:cost,cost,baseCost:cost/1000,currentStock,maintainingStock:5000,lowStockAlert:1000,reorderLevel:1000,restockCycle:'Monthly',showInPrep:true,allowRequest:true});
 }
 const w={...h.api,auth:{currentUser:actor},sessionUser:{...actor,permissions:['all'],allowedBranches:['All'],cashierName:'Synthetic Owner'},
  getDocFromServer:async reference=>({id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))}),
  isBranchAllowed:()=>true,ManagerUI:{notify:(message,options)=>notifications.push({message,...options})},
  invalidateCache:table=>invalidations.push(table),refreshInventoryStocks:()=>{refreshes.push('stocks');return stockRefresh?.();},
  recipeCostUI:{inventoryChanged:options=>{refreshes.push(['menu',options]);return menuRefresh?.(options);}}
 };
 const transaction=w.runTransaction;w.runTransaction=(db,callback)=>transaction(db,tx=>callback({...tx,update:(reference,data)=>{writes.push({path:reference.path,data:structuredClone(data)});tx.update(reference,data);}}));
 installInventoryEditor(w,d);
 const el=id=>d.getElementById(id),input=(id,value)=>{const node=el(id);node.value=value;node.emit('input');},check=(id,value)=>{const node=el(id);node.checked=value;node.emit('change');};
 return{h,w,d,el,input,check,notifications,invalidations,writes,refreshes,async open(id='cab'){await w.openEditInvModal(id);assert.equal(el('inventoryEditorError').hidden,true,el('inventoryEditorError').textContent);assert.equal(el('btnSaveInvEdit').disabled,false);}};
}

const stockSnapshot=f=>Object.fromEntries([...f.h.docs].filter(([path])=>path.startsWith('inventory/')).map(([path,row])=>[path,row.currentStock]));
const assertNoStockWrites=f=>assert.ok(f.writes.every(write=>!Object.hasOwn(write.data,'currentStock')),'cost saves must never write physical quantities');

test('store cost preview and controller save share 15/kg with all matching stores and preserve negative physical counts',async()=>{
 const f=fixture();await f.open();const before=stockSnapshot(f),hq=structuredClone(f.h.get('inventory/hq'));
 assert.match(f.el('inventoryCostScope').textContent,/Agdao.*Citygate.*Maa/);
 f.input('editInvPurchCost','15');
 assert.match(f.el('editInvCostSummary').textContent,/0\.015.*gram/);
 assert.match(f.el('inventoryEditorSaveScope').textContent,/Shared item settings.*Agdao.*Citygate.*Maa/);
 await f.w.saveInventoryEdit();
 for(const id of ['cab','maa','city','agdao']){const row=f.h.get('inventory/'+id);assert.equal(row.purchaseCost,15);assert.equal(row.purchCost,15);assert.equal(row.cost,15);assert.equal(row.baseCost,.015);}
 assert.deepEqual(stockSnapshot(f),before);assert.deepEqual(f.h.get('inventory/hq'),hq);assertNoStockWrites(f);
 assert.equal(f.el('editInvModal').style.display,'none');assert.equal(f.el('btnSaveInvEdit').disabled,false);
 assert.match(f.notifications.find(notice=>notice.type==='success')?.message,/Cabantian, Agdao, Citygate, Maa.*Main Office stays separate/);
 assert.deepEqual(f.invalidations,['inventory','bom','menu']);
});

test('the same-price checkbox repairs existing peer costs without requiring a fake price edit',async()=>{
 const f=fixture({sourceCost:15});await f.open();assert.equal(f.el('editInvPurchCost').value,'15');
 await f.w.saveInventoryEdit();assert.equal(f.h.get('inventory/maa').purchaseCost,100);assert.equal(f.writes.length,0);assert.match(f.el('inventoryEditorLoadStatus').textContent,/No item settings changed/);
 f.check('inventoryResyncCost',true);await f.w.saveInventoryEdit();
 for(const id of ['cab','maa','city','agdao'])assert.equal(f.h.get('inventory/'+id).purchaseCost,15);
 assert.equal(f.h.get('inventory/hq').purchaseCost,77);assertNoStockWrites(f);
 assert.match(f.notifications.find(notice=>notice.type==='success')?.message,/Shared item settings saved/);
});

test('Main Office hides cost synchronization and stays isolated after a store editor was opened',async()=>{
 const f=fixture();await f.open();f.check('inventoryResyncCost',true);assert.equal(f.el('inventoryResyncCost').checked,true);
 f.el('inventoryEditorClose').onclick();await f.open('hq');
 assert.equal(f.el('inventoryResyncCostWrap').hidden,true);assert.equal(f.el('inventoryResyncCost').checked,false);
 assert.match(f.el('inventoryCostScope').textContent,/Main Office cost only/);
 f.input('editInvPurchCost','25');await f.w.saveInventoryEdit();
 assert.equal(f.h.get('inventory/hq').purchaseCost,25);for(const id of ['cab','maa','city','agdao'])assert.equal(f.h.get('inventory/'+id).purchaseCost,100);
 assert.equal(f.writes.filter(write=>write.path.startsWith('inventory/')).length,1);assertNoStockWrites(f);
 assert.match(f.notifications.find(notice=>notice.type==='success')?.message,/saved for Main Office/);
});

test('an unchanged rounded cost field never overwrites saved weighted-cost precision',async()=>{
 const weighted=15.123456789,f=fixture({sourceCost:weighted}),before=structuredClone([...f.h.docs]);await f.open();
 assert.equal(f.el('editInvPurchCost').value,'15.1235');await f.w.saveInventoryEdit();
 assert.equal(f.h.get('inventory/cab').purchaseCost,weighted);assert.deepEqual([...f.h.docs],before);assert.equal(f.writes.length,0);assert.equal(f.notifications.length,0);assert.equal(f.refreshes.length,0);
});

test('a changed cost retains physical movements saved after the editor opened',async()=>{
 const f=fixture();await f.open();
 for(const id of ['cab','maa','city','agdao'])f.h.put('inventory/'+id,{...f.h.get('inventory/'+id),currentStock:-6543});
 f.input('editInvPurchCost','15');await f.w.saveInventoryEdit();
 for(const id of ['cab','maa','city','agdao'])assert.equal(f.h.get('inventory/'+id).currentStock,-6543);
 assertNoStockWrites(f);assert.equal(f.el('inventoryEditorError').hidden,true);assert.ok(f.notifications.some(notice=>notice.type==='success'));
});

test('pending optional Menu refresh never delays or misreports the committed item save',{timeout:1000},async()=>{
 const pending=deferred(),f=fixture({menuRefresh:()=>pending.promise});await f.open();f.input('editInvPurchCost','15');
 await f.w.saveInventoryEdit();
 assert.equal(f.h.get('inventory/maa').purchaseCost,15);assert.equal(f.el('editInvModal').style.display,'none');assert.ok(f.notifications.some(notice=>notice.type==='success'));
 assert.equal(f.el('inventoryEditorError').hidden,true);assert.equal(f.el('btnSaveInvEdit').disabled,false);
 pending.reject(Error('Synthetic optional report connection failure'));await tick();
 assert.equal(f.h.get('inventory/maa').purchaseCost,15);assert.equal(f.el('inventoryEditorError').hidden,true);
 assert.match(f.notifications.find(notice=>notice.type==='warning')?.message,/costs are saved.*Refresh Menu & Recipes/);
 assertNoStockWrites(f);
});

test('synchronous optional report failures remain refresh warnings after a successful save',async()=>{
 const f=fixture({stockRefresh:()=>{throw Error('Synthetic stock renderer failure');},menuRefresh:()=>{throw Error('Synthetic menu renderer failure');}});await f.open();f.input('editInvPurchCost','15');
 await f.w.saveInventoryEdit();await tick();
 assert.equal(f.h.get('inventory/maa').purchaseCost,15);assert.equal(f.el('editInvModal').style.display,'none');assert.equal(f.el('inventoryEditorError').hidden,true);
 assert.ok(f.notifications.some(notice=>notice.type==='success'));
 assert.ok(f.notifications.some(notice=>notice.type==='warning'&&/changes are saved.*Refresh stocks/.test(notice.message)));
 assert.ok(f.notifications.some(notice=>notice.type==='warning'&&/costs are saved.*Refresh Menu & Recipes/.test(notice.message)));
 assertNoStockWrites(f);
});

test('a peer price changed after opening holds the complete save and explains the stale preview',async()=>{
 const f=fixture();await f.open();f.h.put('inventory/maa',{...f.h.get('inventory/maa'),purchaseCost:123});f.input('editInvPurchCost','15');
 await f.w.saveInventoryEdit();
 assert.equal(f.h.get('inventory/cab').purchaseCost,100);assert.equal(f.h.get('inventory/maa').purchaseCost,123);assert.equal(f.h.get('inventory/city').purchaseCost,100);
 assert.equal(f.el('editInvModal').style.display,'flex');assert.equal(f.el('inventoryEditorError').hidden,false);assert.match(f.el('inventoryEditorError').textContent,/affected item changed/);
 assert.equal(f.el('btnSaveInvEdit').disabled,false);assert.equal(f.notifications.length,0);assertNoStockWrites(f);
});
