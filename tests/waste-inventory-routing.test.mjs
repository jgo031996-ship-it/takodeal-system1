import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {previewWasteReport,reviewWasteReport} from '../takodeal-manager/inventory-waste-review.js';
import {normalizeInventoryHistory,summarizeInventoryHistory} from '../takodeal-manager/inventory-history-model.js';
import {inventoryHistoryRecordMarkup} from '../takodeal-manager/inventory-history-workspace.js';
import {installOwnerInbox,installInboxBadge} from '../takodeal-manager/owner-inbox.js';
const at=new Date('2026-11-03T05:09:00Z');
const line={id:'bowl',name:'Bowl',qty:5,uom:'piece',rawQty:5,displayUom:'piece',reason:'Dropped',photoUrl:'https://example.test/proof.jpg'};
const report={type:'Waste Report',staffName:'Fictional Cashier',branch:'Cabantian',timestamp:at,items:[line],totalValueLost:10,status:'Pending'};
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'owner',email:OWNER_EMAIL,emailVerified:true}};h.api.sessionUser={uid:'owner',email:OWNER_EMAIL,permissions:['all'],allowedBranches:['All']};
 h.put('hq_managers/account',{email:OWNER_EMAIL,role:'Owner',pin:'1234',permissions:['all'],assignedBranch:'All'});h.put('staff_requests/waste',report);h.put('inventory/bowl',{branch:'Cabantian',name:'Bowl',uom:'piece',currentStock:100,baseCost:2});
 h.api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 return h;
}
test('existing Cashier Waste Report is visible with item details, actor and status in inventory, excluded from booked waste totals',()=>{
 const rows=normalizeInventoryHistory('Waste',{staff_requests:[{...report,id:'legacy-report'}]}),row=rows[0];assert.equal(row.source,'staff_requests');assert.equal(row.actor,'Fictional Cashier');assert.equal(row.status,'Pending');assert.equal(row.items[0].quantity,5);assert.equal(row.items[0].proof,line.photoUrl);assert.equal(row.requestedValue,10);
 const html=inventoryHistoryRecordMarkup(row,'Waste',0);assert.match(html,/Bowl/);assert.match(html,/Dropped/);assert.match(html,/Review report/);assert.doesNotMatch(html,/N\/A/);const sum=summarizeInventoryHistory(rows,['Cabantian'],{kind:'Waste'})[0];assert.equal(sum.recordedValue,0);assert.equal(sum.estimatedValue,0);assert.equal(sum.unknownValues,0);
});
test('approved legacy reports stay visible without duplicating the physical stock log value',()=>{
 const rows=normalizeInventoryHistory('Waste',{staff_requests:[{...report,id:'old',status:'Approved'}],stock_logs:[{id:'log',branch:'Cabantian',item:'Bowl',type:'Waste / Spoilage (HQ Approved)',timestamp:at,variance:-5,valueLost:10}]}),sum=summarizeInventoryHistory(rows,[],{kind:'Waste'})[0];assert.equal(rows.length,2);assert.equal(sum.recordedValue,10);assert.match(inventoryHistoryRecordMarkup(rows.find(row=>row.source==='staff_requests'),'Waste',0),/will not be applied again/);
});
test('approval saves request decision, cumulative item quantities and deterministic audits in one transaction',async()=>{
 const h=fixture();h.put('staff_requests/waste',{...report,items:[line,{...line,qty:3}]});const preview=await previewWasteReport(h.api,'waste');const result=await reviewWasteReport(h.api,preview,{decision:'Approved',reply:'Reviewed proof'});
 assert.equal(result.stockLines,2);assert.equal(h.get('inventory/bowl').currentStock,92);assert.equal(h.get('staff_requests/waste').status,'Approved');assert.equal(h.get('staff_requests/waste').managerReply,'Reviewed proof');assert.equal(h.get('stock_logs/waste_report_waste_0').newQty,95);assert.equal(h.get('stock_logs/waste_report_waste_1').oldQty,95);assert.equal(h.get('stock_logs/waste_report_waste_1').valueLost,6);assert.equal(h.get('stock_logs/waste_report_waste_0').requestId,'waste');assert.equal(+h.get('stock_logs/waste_report_waste_0').timestamp,+at);assert.equal([...h.docs.keys()].some(key=>key.startsWith('staff_deductions/')),false);
});
test('failed commits preserve pending state, balance and proof; lost acknowledgment retries apply stock only once',async()=>{
 const h=fixture(),preview=await previewWasteReport(h.api,'waste');h.failNextCommit();await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}),/Commit rejected/);assert.equal(h.get('inventory/bowl').currentStock,100);assert.equal(h.get('staff_requests/waste').status,'Pending');assert.equal(h.get('stock_logs/waste_report_waste_0'),undefined);
 h.loseNextAck();await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}),/after commit/);assert.equal((await reviewWasteReport(h.api,preview,{decision:'Approved'})).status,'already-applied');assert.equal(h.get('inventory/bowl').currentStock,95);assert.equal([...h.docs.keys()].filter(key=>key.startsWith('stock_logs/')).length,1);assert.equal(h.get('staff_requests/waste').items[0].photoUrl,line.photoUrl);
});
test('two simultaneous approvals cannot deduct the same report twice',async()=>{
 const h=fixture(),preview=await previewWasteReport(h.api,'waste');const decisions=await Promise.all([reviewWasteReport(h.api,preview,{decision:'Approved'}),reviewWasteReport(h.api,preview,{decision:'Approved'})]);assert.equal(h.get('inventory/bowl').currentStock,95);assert.deepEqual(decisions.map(row=>row.status).sort(),['already-applied','saved']);
});
test('rejection keeps recorded items and does not create a stock movement or payroll deduction',async()=>{
 const h=fixture(),preview=await previewWasteReport(h.api,'waste');await reviewWasteReport(h.api,preview,{decision:'Rejected',reply:'Please clarify'});assert.equal(h.get('inventory/bowl').currentStock,100);assert.equal(h.get('staff_requests/waste').status,'Rejected');assert.equal(h.get('staff_requests/waste').items[0].name,'Bowl');assert.equal([...h.docs.keys()].some(key=>key.startsWith('stock_logs/')||key.startsWith('staff_deductions/')),false);
});
test('changed source, revoked access, branch mismatch, missing item and insufficient stock hold all effects',async()=>{
 for(const modify of [h=>h.put('staff_requests/waste',{...report,totalValueLost:11}),h=>h.put('hq_managers/account',{...h.get('hq_managers/account'),active:false}),h=>h.put('inventory/bowl',{...h.get('inventory/bowl'),branch:'Maa'}),h=>h.docs.delete('inventory/bowl'),h=>h.put('inventory/bowl',{...h.get('inventory/bowl'),currentStock:4})]){const h=fixture(),preview=await previewWasteReport(h.api,'waste');modify(h);await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}));assert.equal(h.get('staff_requests/waste').status,'Pending');assert.equal(h.get('stock_logs/waste_report_waste_0'),undefined);}
});
test('legacy Approved report is never replayed even if its old audit was partial or missing',async()=>{
 const h=fixture();h.put('staff_requests/waste',{...report,status:'Approved'});const preview=await previewWasteReport(h.api,'waste');await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}),/already reviewed/);assert.equal(h.get('inventory/bowl').currentStock,100);
});
test('changing the signed-in actor before or during the review prevents all stock changes',async()=>{
 for(const during of [false,true]){const h=fixture(),preview=await previewWasteReport(h.api,'waste'),change=()=>{h.api.auth={currentUser:{uid:'other',email:'other@example.test'}};};if(!during)change();else{const run=h.api.runTransaction;h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async ref=>{const snap=await tx.get(ref);if(ref.path==='staff_requests/waste')change();return snap;}}));}await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}));assert.equal(h.get('inventory/bowl').currentStock,100);assert.equal(h.get('staff_requests/waste').status,'Pending');}
});
test('existing Waste permission can review its branch; revoked Waste access or a different saved branch cannot',async()=>{
 function manager(){const h=fixture(),email='inventory@example.test';h.api.auth.currentUser.email=email;h.api.sessionUser={uid:'owner',email,permissions:['waste'],allowedBranches:['Cabantian']};h.put('hq_managers/account',{email,role:'Manager',pin:'1234',permissions:['waste'],assignedBranch:'Cabantian'});return h;}
 const allowed=manager(),preview=await previewWasteReport(allowed.api,'waste');assert.equal(preview.canReview,true);await reviewWasteReport(allowed.api,preview,{decision:'Approved'});assert.equal(allowed.get('inventory/bowl').currentStock,95);
 for(const patch of [{permissions:['inbox']},{assignedBranch:'Maa'}]){const h=manager(),preview=await previewWasteReport(h.api,'waste');h.put('hq_managers/account',{...h.get('hq_managers/account'),...patch});await assert.rejects(reviewWasteReport(h.api,preview,{decision:'Approved'}));assert.equal(h.get('inventory/bowl').currentStock,100);assert.equal(h.get('staff_requests/waste').status,'Pending');}
});
test('HR live badge and full inbox history exclude Waste Report while normal requests remain',async()=>{
 const h=fixture();h.put('staff_requests/leave',{type:'Leave',branch:'Cabantian',staffName:'Fictional Cashier',status:'Pending',timestamp:at});h.put('cashiers/person',{cashierName:'Fictional Cashier',branch:'Cabantian',status:'Active'});
 const nodes=Object.fromEntries(['inboxBadge','inboxTableBody','resolvedRequestsBody'].map(id=>[id,{style:{},innerHTML:'',innerText:''}])),d={getElementById:id=>nodes[id]},w={...h.api};let listener;w.onSnapshot=(q,callback)=>{listener=callback;return()=>{};};
 installInboxBadge(w,d);listener({docs:[{id:'waste',data:()=>report},{id:'leave',data:()=>h.get('staff_requests/leave')}]});assert.equal(Number(nodes.inboxBadge.innerText),1);
 const inbox=installOwnerInbox(w,d);await inbox.load();inbox.setView('all');assert.equal(inbox.request('waste'),null);assert.ok(inbox.request('leave'));assert.doesNotMatch(nodes.inboxTableBody.innerHTML,/Waste Report|waste-report/);assert.equal(Number(nodes.inboxBadge.innerText),1);
});
test('HR direct actions route waste to inventory and no longer contain non-atomic waste deduction loop',()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.match(main,/req\.type==='Waste Report'.*switchInvTab\('Waste'\)/);assert.match(main,/originalRequest\.data\(\)\.type==='Waste Report'/);assert.doesNotMatch(main,/action === "Approved" && type === "Waste Report"/);
 const pos=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');assert.match(pos,/reviewWorkspace: "inventory-waste"/);assert.match(pos,/Live Inventory → Waste & Spoilage/);
 const franchise=readFileSync(new URL('../takodeal-franchise/franchise-workspace.js',import.meta.url),'utf8');assert.match(franchise,/filter\(row=>!isWasteRequest\(row\)\)/);assert.match(franchise,/Cashier waste reports · HQ inventory review/);
});
