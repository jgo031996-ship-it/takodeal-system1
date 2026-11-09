import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {readOperationalStaffSession} from '../Takodeal-POS/staff-operational-session.js';
import {createStockCountEngine} from '../Takodeal-POS/stock-count-engine.js';
import {captureShiftCloseIdentity,resolveShiftCloseIdentity,closeLegacyShiftAtomic} from '../Takodeal-POS/cash-settlement.js';
const clock=Date.parse('2030-01-07T12:00:00+08:00'),now=()=>clock;
function fixture(){
 const h=firestoreHarness(),paths=[],staffId='staff-a',uid='device-uid',deviceId='DEV-SYNTHETIC-A',sessionId='00000000-0000-4000-8000-000000000001',branch='Maa',name='Synthetic Crew',actor={staffId,branch,cashierName:name,staffLoginSessionId:sessionId},metadata={fromCache:false,hasPendingWrites:false};
 h.put('staff_directory/'+staffId,{staffId,cashierName:name,branch:'Home Branch',role:'Staff',active:true,profileRevision:'100|1'});h.put('staff_login_sessions/'+uid,{schemaVersion:1,uid,staffId,deviceId,sessionId,app:'cashier',branch,profileRevision:'100|1',issuedAt:new Date(clock-1000),expiresAt:new Date(clock+3600000)});
 h.put('inventory/flour',{branch,name:'Flour',baseUom:'gram',purchaseUom:'Pack',conversionRate:1000,currentStock:100,maintainingStock:500,restockCycle:'Weekly',baseCost:.02});
 const original=h.api,record=ref=>{paths.push(ref.path);if(ref.path.startsWith('cashiers/'))throw Error('Private staff collection must not be read.');},api={...original,requireStaffLogin:true,staffProfileCollection:'staff_directory',auth:{currentUser:{uid}},sessionUser:actor,staffPinActor:()=>({uid,deviceId,sessionId,app:'cashier'}),serverTimestamp:()=>new Date(clock),getDocFromServer:async ref=>{record(ref);const row=h.get(ref.path);return {id:ref.id,exists:()=>row!==undefined,data:()=>structuredClone(row),metadata};},runTransaction:(db,callback)=>original.runTransaction(db,tx=>callback({...tx,get:async ref=>{record(ref);return tx.get(ref);}}))};
 api.readStaffSessionProfile=input=>readOperationalStaffSession(api,{...input,now});return {h,api,actor,staffId,uid,deviceId,branch,name,paths};
}
const input=f=>({staffId:f.staffId,branch:f.branch,name:f.name,now});
test('operational validation reads only own protected login and safe directory, with home branch kept informational',async()=>{
 const f=fixture(),profile=await readOperationalStaffSession(f.api,input(f));assert.equal(profile.branch,'Home Branch');assert.equal(profile.pin,undefined);assert.equal(profile.hourlyRate,undefined);assert.deepEqual(f.paths,['staff_login_sessions/device-uid','staff_directory/staff-a']);
});
test('expired, wrong-account/device/branch/revision or disabled staff sessions cannot authorize an operational action',async()=>{
 for(const [table,change] of [['session',{expiresAt:new Date(clock)}],['session',{uid:'other'}],['session',{staffId:'other'}],['session',{deviceId:'DEV-OTHER-A'}],['session',{sessionId:'a-new-login-in-another-tab'}],['session',{branch:'Other'}],['session',{profileRevision:'changed'}],['profile',{active:false}],['profile',{archived:true}],['profile',{cashierName:'Other'}]]){
  const f=fixture(),path=table==='session'?'staff_login_sessions/'+f.uid:'staff_directory/'+f.staffId;f.h.put(path,{...f.h.get(path),...change});await assert.rejects(readOperationalStaffSession(f.api,input(f)));assert.ok(f.paths.every(path=>!path.startsWith('cashiers/')));
 }
});
test('actual audited count/save and explicit request work with no private roster document or new PIN prompt',async()=>{
 const f=fixture(),engine=createStockCountEngine(f.api,{actor:()=>f.actor,now}),result=await engine.submit({id:'count-a',branch:f.branch,cashier:f.name,selectedCycle:'Weekly',periodStart:'2030-01-07',periodEnd:'2030-01-13',entries:[{id:'flour',name:'Flour',baseUom:'gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:0,baseCount:50,physicalQty:50}]});
 assert.equal(result.itemCount,1);assert.equal(f.h.get('inventory/flour').currentStock,50);assert.equal(f.h.get('inventory_audit_reports/count-a').counts[0].systemQty,100);assert.equal(f.h.get('inventory_audit_reports/count-a').staffActionSessionId,f.actor.staffLoginSessionId);assert.equal(f.h.get('stock_counts/count-a').staffActionSessionId,f.actor.staffLoginSessionId);assert.ok(![...f.h.docs.keys()].some(path=>path.startsWith('purchase_orders/')));
 await engine.request({report:f.h.get('inventory_audit_reports/count-a')});assert.equal(f.h.get('purchase_orders/count-request-count-a').items[0].qty,450);assert.ok(f.paths.every(path=>!path.startsWith('cashiers/')));
});
test('an expired session cannot save any stock, audit or request despite a locally unlocked session object',async()=>{
 const f=fixture();f.h.put('staff_login_sessions/'+f.uid,{...f.h.get('staff_login_sessions/'+f.uid),expiresAt:new Date(clock-1)});const before=structuredClone([...f.h.docs]);
 await assert.rejects(createStockCountEngine(f.api,{actor:()=>f.actor,now}).submit({id:'count-a',branch:f.branch,cashier:f.name,entries:[{id:'flour',name:'Flour',baseUom:'gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:0,baseCount:50,physicalQty:50}]}),/expired|changed/);assert.deepEqual([...f.h.docs],before);
});
test('a renewed staff session during an actual count read retires the old attempt before any count or stock write',async()=>{
 const f=fixture(),before=structuredClone([...f.h.docs]),run=f.api.runTransaction,originalActor=f.api.staffPinActor;
 let currentId=f.actor.staffLoginSessionId;
 f.api.staffPinActor=()=>({...originalActor(),sessionId:currentId});
 f.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async ref=>{const result=await tx.get(ref);if(ref.path==='inventory/flour')currentId='00000000-0000-4000-8000-000000000002';return result;}}));
 await assert.rejects(createStockCountEngine(f.api,{actor:()=>f.actor,now}).submit({id:'count-renewed',branch:f.branch,cashier:f.name,selectedCycle:'Weekly',periodStart:'2030-01-07',periodEnd:'2030-01-13',entries:[{id:'flour',name:'Flour',baseUom:'gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:0,baseCount:50,physicalQty:50}]}),/changed/);
 assert.deepEqual([...f.h.docs],before);
});
test('actual shift-close identity and atomic close use the injected safe session path without PIN/private-profile reads',async()=>{
 const f=fixture();f.h.put('shifts/shift-a',{branch:f.branch,active:true,startingCash:100});const captured=captureShiftCloseIdentity(f.api,f.branch),closer=await resolveShiftCloseIdentity(f.api,captured);assert.equal(closer.staffId,f.staffId);
 await closeLegacyShiftAtomic(f.api,{shiftId:'shift-a',branch:f.branch,closer,actualCash:100,expectedCash:100,diff:0});assert.equal(f.h.get('shifts/shift-a').closedBy.staffBranch,'Home Branch');assert.equal(f.h.get('shifts/shift-a').active,false);assert.ok(f.paths.every(path=>!path.startsWith('cashiers/')));
});
