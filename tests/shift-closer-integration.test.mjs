import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as settlement from '../Takodeal-POS/cash-settlement.js';
import {cashShortageSource} from '../takodeal-manager/cash-shortage-model.js';
import {openCashShortageReview} from '../takodeal-manager/cash-shortage.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {readOperationalStaffSession} from '../Takodeal-POS/staff-operational-session.js';
import {businessClock} from '../Takodeal-POS/branch-operations.js';

// Exercise the actual POS close button handler and settlement transaction. All
// employees, cash, receipts and payroll here are fictional in-memory fixtures.
const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const shiftId='sample-shift',branch='Sample Working Branch',staffId='sample-closer',staffName='Sample Closing Cashier';
const hold=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({session={},upload=async()=>{},confirm=async()=>({isConfirmed:true})}={}){
 const h=firestoreHarness(),values=new Map([['takodeal_device_branch',branch],['cashierName',staffName],['currentShiftId',shiftId]]),localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 h.put('branches/sample',{name:branch,isMallBranch:false});h.put('shifts/'+shiftId,{branch,status:'Open',active:true,startingCash:1000,cashier:'Sample Earlier Cashier / '+staffName,startTime:new Date('2026-10-21T09:00:00+08:00'),salesRevision:0});
 h.put('staff_directory/'+staffId,{staffId,cashierName:staffName,branch:'Sample Home Branch',active:true,profileRevision:'sample-revision'});h.put('staff_login_sessions/sample-device-auth',{schemaVersion:1,uid:'sample-device-auth',staffId,deviceId:'DEV-SAMPLE-DEVICE',app:'cashier',branch,expiresAt:new Date('2030-01-01'),profileRevision:'sample-revision',sessionId:'sample-nonce'});h.put('payroll_records/sample-paid',{status:'Paid',finalNetPay:700,frozenData:{finalNetPay:700,isPaid:true}});
 const messages=[],errors=[],cleared=[],button={innerText:'Confirm & end shift',innerHTML:'',disabled:false};
 const api={...h.api,localStorage,auth:{currentUser:{uid:'sample-device-auth'}},sessionUser:{staffId,cashierName:staffName,branch,staffLoginSessionId:'sample-nonce',...session},staffPinActor:()=>({deviceId:'DEV-SAMPLE-DEVICE',sessionId:api.sessionUser?.staffLoginSessionId}),saveCurrentShiftCloseDraft(){},getDocFromServer:async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}}),serverTimestamp:()=>new Date('2026-10-21T18:00:00+08:00')};
 api.readStaffSessionProfile=input=>readOperationalStaffSession(api,input);api.resolveCashierOperationalApi=async()=>{const captured=api.sessionUser,selectedBranch=values.get('takodeal_device_branch');api.assertStaffOperationalCurrent=()=>{if(api.sessionUser!==captured||values.get('takodeal_device_branch')!==selectedBranch)throw Error('The cashier or branch changed. Reopen the shift close review.');};return api;};
 api.getDocsFromServer=async query=>{const snap=await h.api.getDocsFromServer(query);return {...snap,forEach:callback=>snap.docs.forEach(callback),metadata:{fromCache:false,hasPendingWrites:false}};};api.getDocs=api.getDocsFromServer;
 const context={...settlement,businessClock,window:api,localStorage,Date,console:{error:(...args)=>errors.push(args)},activeShiftDetails:{logId:shiftId,startTime:new Date('2026-10-21T09:00:00+08:00'),startingCash:1000},currentShift:{shiftId,active:true},receiptIngredientBurn:()=>({}),ensureShiftSalesUploaded:()=>upload({h,api,values}),clearCurrentShiftCloseDraft:scope=>cleared.push(scope),confirmMallDailyClose:async()=>({isFinalShiftOfDay:false}),document:{querySelector:selector=>selector.includes('MASTER_CloseShift')?button:null,querySelectorAll:selector=>selector==='.denom-input'?[{value:'9',getAttribute:()=> '100'}]:[],getElementById:()=>null},Swal:{fire:async(...args)=>{messages.push(args);return confirm(args,{h,api,values});}}};
 const start=source.indexOf('window.MASTER_CloseShift = async function'),end=source.indexOf('\n};',start)+4;assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);
 return {h,api,values,messages,errors,cleared,button,context,close:()=>api.MASTER_CloseShift()};
}

test('actual close button records the current logged-in saved staff account independently of the joined shift cashier log',async()=>{
 const f=fixture(),beforePaid=structuredClone(f.h.get('payroll_records/sample-paid'));await f.close();assert.deepEqual(f.errors,[]);const closed=f.h.get('shifts/'+shiftId);assert.equal(closed.status,'Closed');assert.equal(closed.closedBy.staffId,staffId);assert.equal(closed.closedBy.staffName,staffName);assert.equal(closed.closedBy.branch,branch);assert.equal(closed.closedBy.staffBranch,'Sample Home Branch');assert.equal(closed.cashier,'Sample Earlier Cashier / '+staffName);assert.equal(closed.expectedCash,1000);assert.equal(closed.declaredCash,900);assert.equal(closed.closedBy.recordedAt.getTime(),closed.endTime.getTime());assert.equal(f.cleared.length,1);assert.equal(f.values.has('currentShiftId'),false);assert.deepEqual(f.h.get('payroll_records/sample-paid'),beforePaid);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('staff_deductions/')),false);
});

test('an approved device session closes without a Google account, another PIN prompt or private employee reads',async()=>{
 const f=fixture();f.api.auth.currentUser.isAnonymous=true;await f.close();assert.deepEqual(f.errors,[]);const closed=f.h.get('shifts/'+shiftId);assert.equal(closed.status,'Closed');assert.equal(closed.closedBy.staffId,staffId);assert.equal(closed.closedBy.staffName,staffName);assert.equal(closed.closedBy.authUid,'sample-device-auth');assert.equal(f.cleared.length,1);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('cashiers/')),false);
});

test('actual close handler refuses to attribute a pending close after the cashier session is replaced during upload',async()=>{
 const gate=hold(),f=fixture({upload:()=>gate.promise}),before=structuredClone([...f.h.docs]);const closing=f.close();await tick();f.api.sessionUser={...f.api.sessionUser};gate.resolve();await closing;assert.deepEqual([...f.h.docs],before);assert.equal(f.cleared.length,0);assert.equal(f.values.get('currentShiftId'),shiftId);assert.ok(f.errors.length);assert.ok(f.messages.some(args=>String(args[1]).match(/changed|reopen|sign in|cashier/i)));
});

test('actual close refuses a device branch change during cash variance confirmation',async()=>{
 const f=fixture({confirm:async(args,{values})=>{if(args[0]?.title?.includes('Cash Shortage'))values.set('takodeal_device_branch','Another Branch');return {isConfirmed:true};}}),before=structuredClone([...f.h.docs]);await f.close();assert.deepEqual([...f.h.docs],before);assert.equal(f.cleared.length,0);assert.equal(f.values.get('currentShiftId'),shiftId);assert.ok(f.errors.length);
});

test('lost close acknowledgement and retry never replace the original saved closer or double-create cash alerts',async()=>{
 const f=fixture();f.h.loseNextAck();await f.close();const first=structuredClone(f.h.get('shifts/'+shiftId));assert.equal(first.status,'Closed');assert.equal(first.closedBy.staffId,staffId);assert.equal(f.cleared.length,0);assert.equal(f.values.get('currentShiftId'),shiftId);await f.close();assert.deepEqual(f.h.get('shifts/'+shiftId),first);assert.equal(f.cleared.length,1);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('manager_alerts/cash-variance-')).length,1);assert.equal(f.h.get('payroll_records/sample-paid').finalNetPay,700);
});

test('a missing stable employee ID requires fresh login instead of inferring an identity from names or PINs',async()=>{
 const f=fixture({session:{staffId:undefined}}),before=structuredClone([...f.h.docs]);await f.close();assert.deepEqual([...f.h.docs],before);assert.equal(f.cleared.length,0);assert.ok(f.errors.length);assert.equal(f.values.get('currentShiftId'),shiftId);
});

test('a legacy name-only login without a captured PIN or with a changed PIN cannot claim closing identity',async()=>{
 for(const pin of [undefined,'','STALE SAMPLE PIN']){const f=fixture({session:{staffId:undefined,pin}}),before=structuredClone([...f.h.docs]);await f.close();assert.deepEqual([...f.h.docs],before);assert.equal(f.cleared.length,0);assert.equal(f.values.get('currentShiftId'),shiftId);assert.ok(f.errors.length);}
});

test('changing the active drawer during upload cannot close the originally captured shift',async()=>{
 const gate=hold(),f=fixture({upload:()=>gate.promise}),before=structuredClone([...f.h.docs]);const closing=f.close();await tick();f.context.activeShiftDetails={...f.context.activeShiftDetails,logId:'another-shift'};gate.resolve();await closing;assert.deepEqual([...f.h.docs],before);assert.equal(f.cleared.length,0);assert.ok(f.messages.some(args=>String(args[1]).includes('active shift changed')));
});

test('saved closing account is context only: it cannot change a financial fingerprint or reassign an existing reviewed employee',async()=>{
 const h=firestoreHarness(),email='jgo031996@gmail.com',shift={branch,status:'Closed',active:false,cashier:'Sample Earlier / Sample Closing',startTime:new Date('2026-10-21T09:00:00+08:00'),endTime:new Date('2026-10-21T18:00:00+08:00'),expectedCash:1000,declaredCash:900,closedBy:{version:1,staffId:'sample-original-closer',staffName:'Sample Original Closer',branch,source:'pos-session'}};
 const api={...h.api,auth:{currentUser:{uid:'sample-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-owner',email,isOwner:true,role:'Owner',permissions:['all'],allowedBranches:['all']}};
 h.put('hq_managers/sample-owner',{email,role:'Owner',permissions:['all'],assignedBranch:branch,pin:'SAMPLE OWNER PIN',active:true});h.put('shifts/'+shiftId,shift);h.put('cashiers/sample-reviewed',{cashierName:'Sample Reviewed Staff',branch,pin:'SAMPLE STAFF PIN',active:true});const input={shiftId,staffId:'sample-reviewed',details:'Sample Owner explicitly checked the responsible staff account.',evidence:'Sample reconciliation evidence and handover reference.'};
 const financial=cashShortageSource(shiftId,shift).sourceFingerprint;await openCashShortageReview(api,input);const original=structuredClone(h.get('cash_shortage_reviews/cash-shortage-'+shiftId));
 const changed={...shift,closedBy:{...shift.closedBy,staffId:'sample-different-closer',staffName:'Sample Different Closer',recordedAt:new Date('2026-10-21T18:01:00+08:00')}};h.put('shifts/'+shiftId,changed);assert.equal(cashShortageSource(shiftId,changed).sourceFingerprint,financial);assert.equal((await openCashShortageReview(api,input)).alreadySaved,true);assert.equal(h.get('cash_shortage_reviews/cash-shortage-'+shiftId).staffId,'sample-reviewed');assert.deepEqual(h.get('cash_shortage_reviews/cash-shortage-'+shiftId),original);assert.equal(h.get('staff_deductions/cash-shortage-'+shiftId).amount,0);
});
