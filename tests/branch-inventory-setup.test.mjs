import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {planBranchInventorySetup,branchInventoryId,inventoryTemplatePayload} from '../takodeal-manager/branch-inventory-model.js';
import {branchInventoryActor,createBranchInventorySetup,installBranchInventorySetup} from '../takodeal-manager/branch-inventory-setup.js';
import {planPrepBatch} from '../functions/cash-remittance-review/prep-model.mjs';
import {canOpenInventoryTab} from '../takodeal-manager/workspace-access-model.js';
const email='jgo031996@gmail.com',branch='Fictional New Store';
const item=(name,source='Cabantian',extra={})=>({id:source+'-'+name,branch:source,name,category:'Prepared Batch',purchaseUom:'Batch',baseUom:'Gram',conversionRate:1000,purchaseCost:250,baseCost:.25,currentStock:8000,maintainingStock:10000,lowStockAlert:1000,showInPrep:true,allowRequest:true,...extra});
const branchRows=()=>['Main Office','Cabantian','Maa',branch].map((name,id)=>({id:'branch-'+id,name}));
function fixture({includeBranch=true,items=[item('Fictional Sauce'),item('Fictional Ingredient','Maa',{category:'Raw Material',showInPrep:false})]}={}){
 const h=firestoreHarness(),api=h.api,calls={reads:[],dialogs:[],loads:0};
 for(const row of branchRows().filter(row=>includeBranch||row.name!==branch))h.put('branches/'+row.id,{name:row.name,allowedPrepItems:['Fictional Sauce']});
 for(const row of items)h.put('inventory/'+row.id,{...row});
 const read=api.getDocsFromServer.bind(api);api.limit=count=>({count});
 api.getDocsFromServer=async query=>{calls.reads.push(query.table);const result=await read(query);return {...result,forEach:callback=>result.docs.forEach(callback),empty:result.docs.length===0,metadata:{fromCache:false,hasPendingWrites:false}};};
 api.auth={currentUser:{uid:'fictional-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}};api.sessionUser={uid:'fictional-owner',email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']};api.isBranchAllowed=()=>true;
 api.Swal={fire:async(...args)=>{calls.dialogs.push(args);return {isConfirmed:true};},showLoading(){}};api.ManagerUI={notify:message=>calls.dialogs.push([message])};api.loadBranchManager=async()=>{calls.loads++;};
 const service=installBranchInventorySetup(api);
 return {h,api,service,calls,inventory:()=>[...h.docs].filter(([path])=>path.startsWith('inventory/')).map(([id,row])=>({id,...row}))};
}
test('the catalog is a union of active branches, prefers store prices and copies metadata with zero quantities',()=>{
 const items=[item('Fictional Sauce','Main Office',{purchaseCost:100}),item('Fictional Sauce'),item('Maa Only','Maa'),item('Retired','Maa',{archived:true}),item('Closed Branch','Closed')],before=structuredClone(items);
 const plan=planBranchInventorySetup({branch,branches:branchRows(),items});assert.deepEqual(plan.creates.map(row=>row.name).sort(),['Fictional Sauce','Maa Only']);assert.equal(plan.creates.find(row=>row.name==='Fictional Sauce').payload.purchaseCost,250);
 for(const row of plan.creates){assert.equal(row.payload.branch,branch);assert.equal(row.payload.currentStock,0);assert.equal(row.payload.showInPrep,true);assert.equal('physicalStock' in row.payload,false);assert.equal('timestamp' in row.payload,false);}
 assert.deepEqual(items,before);
});
test('legacy purchase/base aliases are retained consistently and warehouse-only items can seed missing ingredients',()=>{
 const row=item('Legacy','Main Office',{purchaseUom:undefined,purchUom:'Bag',baseUom:undefined,uom:'Gram',conversionRate:undefined,conversion:1000,purchaseCost:undefined,cost:200});
 const planned=planBranchInventorySetup({branch,branches:branchRows(),items:[row]}).creates[0].payload;assert.equal(planned.purchaseUom,'Bag');assert.equal(planned.purchUom,'Bag');assert.equal(planned.baseUom,'Gram');assert.equal(planned.conversionRate,1000);assert.equal(planned.purchaseCost,200);assert.equal(planned.baseCost,.2);
});
test('conflicting store units are held and inactive source records never silently become active',()=>{
 const plan=planBranchInventorySetup({branch,branches:branchRows(),items:[item('Conflicting'),item('Conflicting','Maa',{baseUom:'Litre'}),item('Valid'),item('Disabled','Maa',{active:false})]});assert.deepEqual(plan.creates.map(row=>row.name),['Valid']);assert.equal(plan.issues[0].name,'Conflicting');
});
test('existing target records win, including their quantities, local prices, visibility and restrictions',async()=>{
 const existing=item('Fictional Sauce',branch,{id:'legacy-target',currentStock:17,purchaseCost:99,showInPrep:false}),f=fixture({items:[item('Fictional Sauce'),existing]}),before=structuredClone(f.h.get('inventory/legacy-target'));
 const result=await f.service.ensure(branch);assert.equal(result.created,0);assert.equal(result.ready,true);assert.deepEqual(f.h.get('inventory/legacy-target'),before);assert.deepEqual(f.h.get('branches/branch-3').allowedPrepItems,['Fictional Sauce']);
});
test('safe stable IDs support Unicode and punctuation without using a branch name as a collection path',async()=>{
 const one=await branchInventoryId("Fictional O'Hare / Store",'Fictional Sauce');assert.match(one,/^branch-stock-[a-f0-9]{64}$/);assert.equal(one,await branchInventoryId("Fictional O'Hare / Store",'Fictional Sauce'));assert.notEqual(one,await branchInventoryId('Different Branch','Fictional Sauce'));
});
test('setup and repeated or simultaneous retries create exactly one item per name and never deduct or copy source balances',async()=>{
 const f=fixture(),sources=structuredClone([...f.h.docs].filter(([path])=>path.startsWith('inventory/'))),other=createBranchInventorySetup(f.api);
 await Promise.all([f.service.ensure(branch),f.service.ensure(branch),other.ensure(branch)]);await f.service.ensure(branch);
 const target=f.inventory().filter(row=>row.branch===branch);assert.equal(target.length,2);assert.ok(target.every(row=>row.currentStock===0));for(const [path,row]of sources)assert.deepEqual(f.h.get(path),row);
 assert.equal([...f.h.docs].some(([path])=>/^(stock_logs|sales|shifts|expenses)\//.test(path)),false);assert.equal(f.h.get('branches/branch-3').inventorySetupStatus,'Ready');
});
test('a lost acknowledgement and later retry cannot reset stock received after the successful creation',async()=>{
 const f=fixture();f.h.loseNextAck();await assert.rejects(f.service.ensure(branch),/Connection lost/);const id=await branchInventoryId(branch,'Fictional Sauce'),saved=f.h.get('inventory/'+id);assert.equal(saved.currentStock,0);f.h.put('inventory/'+id,{...saved,currentStock:450});await f.service.ensure(branch);assert.equal(f.h.get('inventory/'+id).currentStock,450);
});
test('source stock movement does not invalidate metadata copying or become a destination stock balance',async()=>{
 const f=fixture(),read=f.api.getDocsFromServer;f.api.getDocsFromServer=async query=>{const result=await read(query);if(query.table==='inventory'){const row=f.h.get('inventory/Cabantian-Fictional Sauce');f.h.put('inventory/Cabantian-Fictional Sauce',{...row,currentStock:7000});}return result;};await f.service.ensure(branch);assert.equal(f.inventory().find(row=>row.branch===branch&&row.name==='Fictional Sauce').currentStock,0);assert.equal(f.h.get('inventory/Cabantian-Fictional Sauce').currentStock,7000);
});
test('changed metadata or a deleted branch aborts the pending creation instead of writing stale item setup',async()=>{
 for(const kind of ['source','branch']){const f=fixture(),run=f.api.runTransaction;let first=true;f.api.runTransaction=async(...args)=>{if(first){first=false;if(kind==='source'){const row=f.h.get('inventory/Cabantian-Fictional Sauce');f.h.put('inventory/Cabantian-Fictional Sauce',{...row,purchaseCost:300});}else f.h.docs.delete('branches/branch-3');}return run(...args);};await assert.rejects(f.service.ensure(branch),/changed/);assert.equal(f.inventory().filter(row=>row.branch===branch).length,0);}
});
test('cached reads and changed or limited accounts cannot launch stock creation',async()=>{
 for(const kind of ['cache','account','franchise','limited','permission']){const f=fixture(),before=structuredClone([...f.h.docs]);if(kind==='franchise')f.api.sessionUser.isFranchisee=true;if(kind==='limited'){f.api.auth.currentUser.email=f.api.sessionUser.email='limited@example.test';f.api.sessionUser.allowedBranches=[branch];}if(kind==='permission')f.api.isBranchAllowed=()=>false;if(['cache','account'].includes(kind)){const read=f.api.getDocsFromServer;f.api.getDocsFromServer=async q=>{const result=await read(q);if(kind==='cache')result.metadata.fromCache=true;else f.api.auth.currentUser={...f.api.auth.currentUser,uid:'different'};return result;};}await assert.rejects(f.service.ensure(branch));assert.deepEqual([...f.h.docs],before);}
});
test('valid items are provisioned while incompatible templates keep the branch setup in Needs Review',async()=>{
 const f=fixture({items:[item('Valid'),item('Conflict'),item('Conflict','Maa',{conversionRate:100})]}),result=await f.service.ensure(branch);assert.equal(result.created,1);assert.equal(result.ready,false);assert.equal(f.h.get('branches/branch-3').inventorySetupStatus,'Needs Review');assert.equal(f.inventory().filter(row=>row.branch===branch).length,1);
});
test('a partially acknowledged large setup resumes missing items without resetting completed items',async()=>{
 const f=fixture({items:Array.from({length:60},(_,index)=>item('Fictional '+index))});f.h.loseNextAck();await assert.rejects(f.service.ensure(branch));const completed=f.inventory().filter(row=>row.branch===branch);assert.equal(completed.length,25);const key=completed[0].id;f.h.put(key,{...f.h.get(key),currentStock:321});await f.service.ensure(branch);assert.equal(f.inventory().filter(row=>row.branch===branch).length,60);assert.equal(f.h.get(key).currentStock,321);
});
test('copied output and ingredient metadata work with the existing global recipe after real ingredients are received',async()=>{
 const f=fixture();await f.service.ensure(branch);const rows=f.inventory().filter(row=>row.branch===branch).map(row=>({...row,id:row.id.slice('inventory/'.length),updateTime:{seconds:1,nanoseconds:0}}));
 const output=rows.find(row=>row.name==='Fictional Sauce'),ingredient=rows.find(row=>row.name==='Fictional Ingredient');ingredient.currentStock=2000;
 const plan=planPrepBatch({output,ingredients:[ingredient],recipes:[{id:'fictional-global-recipe',menuItem:output.name,ingredientName:ingredient.name,qty:500,updateTime:{seconds:1,nanoseconds:0}}],qty:1});assert.equal(plan.branch,branch);assert.equal(plan.effects[0].afterStock,1000);assert.equal(plan.effects[1].delta,-500);assert.equal(output.currentStock,0);
});
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),extract=name=>{const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start);return source.slice(start+1,end+3);};
function branchForm(f){
 const nodes={newBranchName:{value:branch},newBranchLat:{value:'7.1'},newBranchLng:{value:'125.5'},btnSaveNewBranch:{},addBranchModal:{style:{display:'flex'}}};const ctx=vm.createContext({window:f.api,document:{getElementById:id=>nodes[id]},Swal:f.api.Swal,branchInventoryActor,branchInventoryId,console:{error(){}}});
 for(const name of ['saveNewBranch','autoSetupNewBranch'])vm.runInContext(extract(name),ctx);return {ctx,nodes};
}
test('the real Launch Branch flow waits for shared inventory provisioning, preserves GPS, and does not use retired inventory collections',async()=>{
 const f=fixture({includeBranch:false}),form=branchForm(f),result=await f.api.saveNewBranch();assert.equal(result.ready,true);assert.equal(f.inventory().filter(row=>row.branch===branch).length,2);const record=[...f.h.docs].find(([path,row])=>path.startsWith('branches/')&&row.name===branch)[1];assert.equal(record.isMallBranch,false);assert.equal(record.lat,7.1);assert.equal(record.lng,125.5);assert.equal(record.inventorySetupStatus,'Ready');assert.equal(form.nodes.addBranchModal.style.display,'none');assert.equal(form.nodes.btnSaveNewBranch.disabled,false);assert.equal([...f.h.docs].some(([path])=>path.startsWith('inventory_')),false);
});
test('a failed item setup reports the saved branch and a safe retry instead of claiming successful provisioning',async()=>{
 const f=fixture({includeBranch:false});branchForm(f);f.api.ensureBranchInventory=async()=>{throw Error('Fictional network failure');};assert.equal(await f.api.saveNewBranch(),false);assert.equal([...f.h.docs].filter(([path,row])=>path.startsWith('branches/')&&row.name===branch).length,1);assert.equal(f.calls.dialogs.at(-1)[0].titleText,'Branch saved · item setup incomplete');assert.match(f.calls.dialogs.at(-1)[0].text,/Sync Stock Items/);assert.equal(f.inventory().filter(row=>row.branch===branch).length,0);
});
test('two branch launchers cannot create duplicate registrations or inventory records',async()=>{
 const f=fixture({includeBranch:false});branchForm(f);const original=f.api.saveNewBranch;
 const second={...f.api};const other={...f,api:second};branchForm(other);
 await Promise.all([original(),second.saveNewBranch()]);
 assert.equal([...f.h.docs].filter(([path,row])=>path.startsWith('branches/')&&row.name===branch).length,1);
 assert.equal(f.inventory().filter(row=>row.branch===branch).length,2);
});
function inventoryForm(f){
 const values={newInvBranch:branch,newInvCat:'Prepared Batch',newInvName:'Fictional Sauce',newInvPurchUom:'Batch',newInvBaseUom:'Gram',newInvConv:'1000',newInvCost:'250',newInvInitQty:'1',newInvBranchReorder:'1',newInvHqReorder:'1',newInvMaintainPurch:'1',newInvMaintainBase:'0',newInvCycle:'Monthly'};
 const nodes=new Map(Object.entries(values).map(([id,value])=>[id,{value,checked:true,files:[],style:{}}]));
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:true,files:[],style:{}});return nodes.get(id);};
 f.api.globalActiveBranches=['Cabantian','Maa',branch];f.api.loadInventoryData=()=>{};
 vm.runInNewContext(extract('saveAdvancedInventoryItem'),{window:f.api,document:{getElementById:node},canOpenInventoryTab,branchInventoryId,Swal:f.api.Swal,console:{error(){}}});return {node};
}
test('manual item creation and automatic setup share the same identity and keep the explicitly entered initial stock',async()=>{
 const f=fixture();inventoryForm(f);await f.api.saveAdvancedInventoryItem();const id=await branchInventoryId(branch,'Fictional Sauce');assert.equal(f.h.get('inventory/'+id).currentStock,1000);await f.service.ensure(branch);assert.equal(f.h.get('inventory/'+id).currentStock,1000);assert.equal(f.inventory().filter(row=>row.branch===branch&&row.name==='Fictional Sauce').length,1);
});
test('a catalog record appearing after the manual duplicate check is never overwritten with another opening quantity',async()=>{
 const f=fixture(),id=await branchInventoryId(branch,'Fictional Sauce'),read=f.api.getDocsFromServer;inventoryForm(f);let first=true;
 f.api.getDocsFromServer=async query=>{const result=await read(query);if(first&&query.table==='inventory'){first=false;f.h.put('inventory/'+id,{...inventoryTemplatePayload(item('Fictional Sauce'),branch),currentStock:321});}return result;};
 await f.api.saveAdvancedInventoryItem();assert.equal(f.h.get('inventory/'+id).currentStock,321);assert.equal(f.inventory().filter(row=>row.branch===branch&&row.name==='Fictional Sauce').length,1);
});
