import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {prepareSharedPayslip,publishStaffPayslip,readStaffPayslipPublication,staffPayslipPreviewId} from '../takodeal-manager/staff-payslip-publication.js';
import {validateOrdinaryPayrollSnapshot} from '../takodeal-manager/payroll-settlement.js';
import {validateRefundPayrollSnapshot} from '../takodeal-manager/refund-payroll.js';
import {normalizeStaffPayslip,payslipSavedAmounts} from '../takodeal-staff/staff-payslip-snapshot.js';
import {payslipDeductionBreakdown} from '../takodeal-staff/payroll-deduction-details.js';
import {readStaffSavedPayslips,installStaffSavedPayslipViews} from '../takodeal-staff/staff-saved-payslips.js';
const staffId='sample-crew',name='Synthetic Crew',branch='Maa',start='2030-01-01',end='2030-01-15',key=staffPayslipPreviewId(staffId,start,end),net=930.73;
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function fixture(){
  const h=firestoreHarness(),user={uid:'verified-owner',email:'jgo031996@gmail.com',emailVerified:true,providerData:[{providerId:'google.com'}]};
  h.api.auth={currentUser:user};h.api.sessionUser={uid:user.uid,email:user.email,isOwner:true,isFranchisee:false,allowedBranches:['All']};
  h.api.getDocFromServer=async ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
  const field=(row,path)=>path.split('.').reduce((value,key)=>value?.[key],row);h.api.where=(key,op,value)=>({key,op,value});h.api.getDocsFromServer=async q=>({docs:[...h.docs].filter(([path,row])=>path.startsWith(q.table+'/')&&(q.filters||[]).every(f=>f.op==='in'?f.value.includes(field(row,f.key)):field(row,f.key)===f.value)).map(([path,row])=>({id:path.slice(q.table.length+1),data:()=>structuredClone(row)}))});
  const profile={staffId,cashierName:name,branch,hourlyRate:500,sssAmount:100,philHealthAmount:200,pagibigAmount:300,customDeductions:[{name:'Old profile amount',amount:999}],pin:'PRIVATE_PIN',phone:'PRIVATE_PHONE',bank:'PRIVATE_BANK'};
  h.put('cashiers/'+staffId,profile);h.put('cash_accounts/cash',{balance:5000});h.put('staff_deductions/meal',{amount:20,status:'Unpaid'});
  const data={staffId,name,branch,start,end,profile,shiftsWorked:2,hours:16,basicPay:1000,nightBonus:0,overtime:999,straightBonus:0,holidayPayTotal:0,holiday:777,perfBonus:0,performanceBonus:888,payrollAdjustments:0,
    lateDeduction:7.5,sss:1,philhealth:2,pagibig:3,advances:10,loans:5,meals:20,onlineRefunds:0,cashShortages:0,ownerDeductions:0,
    customDeductions:[{name:'Edited Wi-Fi',amount:17.35},{name:'Manual deduction',amount:3.42}],customDeductionsTotal:20.77,
    logs:[{date:'Jan 1',in:'09:00',out:'17:00',hrs:'8.00',remark:'Saved assigned hours',photoBase64:'PRIVATE_PHOTO',pin:'PRIVATE_LOG_PIN'}]};
  return {h,data,publish:options=>publishStaffPayslip(h.api,{data,finalNetPay:net,expectedRevision:0,...options})};
}
function paid(data,extra={}){return {id:'paid-original',staffId,staffName:name,branch,startDate:start,endDate:end,finalNetPay:net,acknowledged:false,processedAt:{seconds:1893456000},frozenData:validateOrdinaryPayrollSnapshot(data,net),...extra};}
async function privateReader(f,{binding={},privateError=null}={}){
  const primaryQueries=[],privateQueries=[],read=f.h.api.getDocsFromServer;
  const api={...f.h.api,getDocsFromServer:async q=>{primaryQueries.push(q);return read(q);}};
  const user={uid:'private-approved'},auth={currentUser:user};f.h.put('staff_document_devices/'+user.uid,{uid:user.uid,staffId,branch,active:true,...binding});
  const sdk={...f.h.api,getDocsFromServer:async q=>{privateQueries.push(q);if(privateError)throw privateError;return read(q);}};
  const state=await readStaffSavedPayslips(api,{staffId,staffName:name,profile:f.data.profile,createVault:async()=>({auth,db:{},sdk})});
  return {state,primaryQueries,privateQueries,auth};
}

test('Owner-edited deductions and explicit zero incomes roundtrip through publication into the exact Staff snapshot',async()=>{
  const f=fixture(),before=structuredClone(f.data),result=await f.publish(),record={...f.h.get('staff_payslip_previews/'+key),id:key},staff=normalizeStaffPayslip(record,{staffId},{shared:true});
  assert.equal(result.finalNetPay,net);assert.equal(staff.finalNetPay,net);assert.equal(staff.grossPay,1000);assert.equal(staff.totalDeductions,69.27);
  for(const field of ['sss','philhealth','pagibig','lateDeduction','advances','meals','loans','nightBonus','holidayPayTotal','perfBonus'])assert.equal(staff[field],f.data[field],field);
  assert.deepEqual(staff.customDeductions,f.data.customDeductions);assert.equal(payslipDeductionBreakdown(staff).total,69.27);assert.equal(staff.recordState,'shared');assert.equal(staff.isPaid,false);assert.deepEqual(f.data,before);
  assert.doesNotMatch(JSON.stringify(record),/PRIVATE_|Old profile amount|999|777|888/);
});
test('a genuine Owner payment freeze preserves the same manual deduction edits in Staff and never substitutes current profile charges',()=>{
  const f=fixture(),record=paid(f.data),before=structuredClone(record),staff=normalizeStaffPayslip(record,{staffId});
  f.data.profile.sssAmount=8888;f.data.profile.customDeductions=[{name:'TODAY_ONLY',amount:7000}];
  assert.equal(staff.sss,1);assert.equal(staff.nightBonus,0);assert.equal(staff.holidayPayTotal,0);assert.equal(staff.finalNetPay,net);assert.deepEqual(staff.customDeductions,before.frozenData.customDeductions);assert.deepEqual(record,before);
});
test('refund payment freezes use the same saved manual deductions and keep the approved refund as a distinct amount',()=>{
  const f=fixture(),data={...f.data,onlineRefunds:30,onlineRefundRows:[{id:'refund',amount:30}]},record={...paid(f.data),finalNetPay:net-30,frozenData:validateRefundPayrollSnapshot(data,net-30)};
  const staff=normalizeStaffPayslip(record,{staffId});assert.equal(staff.onlineRefunds,30);assert.equal(staff.sss,1);assert.equal(staff.totalDeductions,99.27);assert.equal(staff.finalNetPay,900.73);
});
test('shared payroll credits and previous-payroll recovery references retain their exact safe saved breakdown',()=>{
  const f=fixture(),recovery={staffId,originalStart:'2029-12-16',originalEnd:'2029-12-31',sourcePayrollRecordId:'original-paid',sourceNetPay:200,reason:'Reviewed recovery from the previous paid cutoff.'};
  const data={...f.data,payrollAdjustments:100,payrollAdjustmentRows:[{id:'payroll-adjustment-'+String('a').repeat(64),amount:100,originalStart:'2029-12-16',originalEnd:'2029-12-31',effectiveDate:start,reason:'The previous payroll missed this approved credit.',sourcePayrollRecordId:'original-paid',pin:'PRIVATE_CREDIT_PIN'}],
    ownerDeductions:30,ownerDeductionDetails:[{id:'recovery-row',label:'Previous payroll recovery',amount:30,payrollRecovery:recovery}],payrollRecoveryRows:[{id:'recovery-row',amount:30,...recovery}]};
  const prepared=prepareSharedPayslip(data,net+70),record={schemaVersion:1,kind:'owner-shared-payslip',status:'Published',staffId,staffName:name,branch,startDate:start,endDate:end,revision:1,snapshot:prepared.snapshot,finalNetPay:net+70};
  const staff=normalizeStaffPayslip(record,{staffId},{shared:true}),breakdown=payslipDeductionBreakdown(staff);
  assert.equal(staff.payrollAdjustments,100);assert.equal(staff.payrollAdjustmentRows[0].sourcePayrollRecordId,'original-paid');assert.equal(breakdown.groups.find(row=>row.key==='ownerDeductions').entries[0].payrollRecovery.staffId,staffId);assert.doesNotMatch(JSON.stringify(prepared.snapshot),/PRIVATE_CREDIT_PIN/);
});
test('a complete numeric zero net/zero edited deduction remains valid and does not revive older aliases',()=>{
  const f=fixture(),data={...f.data,basicPay:0,lateDeduction:0,sss:0,philhealth:0,pagibig:0,advances:0,loans:0,meals:0,customDeductions:[],customDeductionsTotal:0};
  const result=prepareSharedPayslip(data,0);assert.equal(result.finalNetPay,0);assert.equal(result.grossPay,0);assert.equal(result.totalDeductions,0);
  assert.equal(payslipSavedAmounts({...data,nightBonus:undefined,overtime:25}).nightBonus,25,'only an absent primary value may use its legacy saved alias');
});
test('publication writes exactly one preview document, without debiting, paying, settling, acknowledging or mutating any source record',async()=>{
  const f=fixture(),before=structuredClone([...f.h.docs]);await f.publish();
  assert.deepEqual([...f.h.docs].filter(([path])=>!path.startsWith('staff_payslip_previews/')),before);assert.equal(f.h.get('payroll_records/payroll-'+key),undefined);
  const row=f.h.get('staff_payslip_previews/'+key);assert.deepEqual(Object.keys(row).sort(),['schemaVersion','kind','status','staffId','staffName','branch','startDate','endDate','revision','publishedAt','publishedByUid','publishedByEmail','snapshot','finalNetPay'].sort());
  assert.equal(row.snapshot.isPaid,false);assert.equal(row.revision,1);assert.equal(row.publishedByUid,'verified-owner');
});
test('concurrent identical publication calls share the unresolved save and changed figures cannot overtake it',async()=>{
  const f=fixture(),gate=deferred(),read=f.h.api.getDocsFromServer;f.h.api.getDocsFromServer=async q=>{await gate.promise;return read(q);};
  const first=f.publish(),same=f.publish();assert.equal(first,same);await assert.rejects(f.publish({data:{...f.data,basicPay:1001},finalNetPay:net+1}),/earlier payslip save/);
  gate.resolve();await first;assert.equal(f.h.get('staff_payslip_previews/'+key).revision,1);
});
test('fresh revision is required for a replacement, and a stale Owner tab cannot overwrite another saved version',async()=>{
  const f=fixture();assert.equal((await readStaffPayslipPublication(f.h.api,{data:f.data})).revision,0);await f.publish();
  await assert.rejects(f.publish(),/Another saved payslip changed/);assert.equal((await readStaffPayslipPublication(f.h.api,{data:f.data})).revision,1);
  await f.publish({data:{...f.data,sss:0},finalNetPay:net+1,expectedRevision:1});assert.equal(f.h.get('staff_payslip_previews/'+key).revision,2);assert.equal(f.h.get('staff_payslip_previews/'+key).snapshot.sss,0);
});
test('ordinary, refund and legacy paid-cutoff references prohibit a new shared draft, leaving paid freezes intact',async()=>{
  for(const paymentId of ['payroll-'+key,'refund-payroll-'+key,'legacy-paid']){
    const f=fixture(),original=paid(f.data);f.h.put('payroll_records/'+paymentId,original);const before=structuredClone([...f.h.docs]);await assert.rejects(f.publish(),/saved payroll record/);assert.deepEqual([...f.h.docs],before);
  }
});
test('random legacy paid IDs with frozen-only cutoffs and saved old aliases block publication and dominate an existing shared draft',async()=>{
  for(const idsPresent of [true,false]){
    const f=fixture();f.data.profile.scheduleAliases=['Previous Crew Name'];await f.publish();
    const old=paid(f.data);delete old.staffId;delete old.startDate;delete old.endDate;old.staffName='Previous Crew Name';old.frozenData.name='Previous Crew Name';
    if(!idsPresent){delete old.frozenData.staffId;delete old.frozenData.profile.staffId;delete old.frozenData.profile.id;}
    f.h.put('payroll_records/random-legacy',old);const before=structuredClone([...f.h.docs]);
    await assert.rejects(f.publish({expectedRevision:1}),/saved payroll record/);assert.deepEqual([...f.h.docs],before);
    const result=await privateReader(f);assert.equal(result.state.shared.length,0,'a paid/held original blocks stale unpaid publication');
    if(idsPresent){assert.equal(result.state.paid.length,1);assert.equal(result.state.paid[0].data.name,'Previous Crew Name');assert.equal(result.state.paid[0].data.finalNetPay,net);}
    else assert.equal(result.state.held.length,1,'a renamed name-only source needs unique identity confirmation, without inventing a replacement');
  }
});
test('unknown or overflowing owned payroll history fails closed before publication',async()=>{
  const f=fixture();f.h.put('payroll_records/unknown',{staffId,staffName:name,finalNetPay:123,frozenData:{staffId,name}});await assert.rejects(f.publish(),/conflicting identity or cutoff/);assert.equal(f.h.get('staff_payslip_previews/'+key),undefined);
  const g=fixture();g.h.api.getDocsFromServer=async()=>({docs:Array.from({length:251},(_,index)=>({id:'old-'+index,data:()=>({staffId})}))});await assert.rejects(g.publish(),/incomplete or too large/);assert.equal(g.h.get('staff_payslip_previews/'+key),undefined);
});
test('a negative unpaid Owner net is shared exactly without making a payment or clamping it to zero',async()=>{
  const f=fixture(),data={...f.data,customDeductions:[{name:'Owner-edited carry',amount:2000}],customDeductionsTotal:2000},amount=-1048.5;
  await f.publish({data,finalNetPay:amount});const row={...f.h.get('staff_payslip_previews/'+key),id:key},staff=normalizeStaffPayslip(row,{staffId},{shared:true});
  assert.equal(staff.finalNetPay,amount);assert.equal(staff.totalDeductions,2048.5);assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(f.h.get('payroll_records/payroll-'+key),undefined);
});
test('held payroll, inconsistent totals, malformed money and another staff identity cannot be shared',async()=>{
  for(const change of [{attendanceReviewRequired:true},{salaryReviewRequired:true},{isPaid:true},{sss:-1},{basicPay:NaN},{customDeductionsTotal:999},{profile:{staffId:'another-crew'}}]){
    const f=fixture(),before=structuredClone([...f.h.docs]);await assert.rejects(f.publish({data:{...f.data,...change}}));assert.deepEqual([...f.h.docs],before);
  }
  const f=fixture();await assert.rejects(f.publish({finalNetPay:net+1}),/edited payslip total changed/);
});
test('only the unchanged verified Google Owner can publish and the final transaction rechecks saved employee/rate identity',async()=>{
  for(const change of [f=>f.h.api.auth.currentUser.emailVerified=false,f=>f.h.api.auth.currentUser.providerData=[],f=>f.h.api.sessionUser.isOwner=false,f=>f.h.api.auth.currentUser.email='other@example.test',
    f=>f.h.put('cashiers/'+staffId,{...f.data.profile,branch:'Citygate'}),f=>f.h.put('cashiers/'+staffId,{...f.data.profile,hourlyRate:600})]){
    const f=fixture();change(f);await assert.rejects(f.publish());assert.equal(f.h.get('staff_payslip_previews/'+key),undefined);
  }
  const f=fixture(),gate=deferred(),read=f.h.api.getDocsFromServer;let current=true;f.h.api.getDocsFromServer=async q=>{await gate.promise;return read(q);};const promise=f.publish({assertCurrent:()=>{if(!current)throw Error('Selection changed');}});current=false;gate.resolve();await assert.rejects(promise,/Selection changed/);assert.equal(f.h.get('staff_payslip_previews/'+key),undefined);
});
test('transaction failure creates no publication and a lost acknowledgment is recoverable through a fresh revision read',async()=>{
  const f=fixture();f.h.failNextCommit();await assert.rejects(f.publish(),/Commit rejected/);assert.equal(f.h.get('staff_payslip_previews/'+key),undefined);
  f.h.loseNextAck();await assert.rejects(f.publish(),/Connection lost/);assert.equal((await readStaffPayslipPublication(f.h.api,{data:f.data})).revision,1);await assert.rejects(f.publish(),/Another saved payslip changed/);
});
test('Staff reads new shared snapshots only through its fresh approved private-doc client, and a paid record always wins',async()=>{
  const f=fixture();await f.publish();const first=await privateReader(f);assert.equal(first.state.shared.length,1);assert.equal(first.state.shared[0].data.sss,1);
  assert.equal(first.primaryQueries.some(q=>q.table==='staff_payslip_previews'),false);assert.equal(first.privateQueries.filter(q=>q.table==='staff_payslip_previews').length,1);
  f.h.put('payroll_records/paid-original',paid(f.data));const original=structuredClone(f.h.get('payroll_records/paid-original')),after=await privateReader(f);
  assert.equal(after.state.shared.length,0);assert.equal(after.state.paid.length,1);assert.equal(after.state.paid[0].data.recordState,'paid');assert.deepEqual(f.h.get('payroll_records/paid-original'),original);
});
test('a legacy paid freeze using frozen startDate/endDate suppresses a same-cutoff shared pending card',async()=>{
  const f=fixture();await f.publish();const row=paid(f.data);delete row.startDate;delete row.endDate;delete row.frozenData.start;delete row.frozenData.end;row.frozenData.startDate=start;row.frozenData.endDate=end;
  f.h.put('payroll_records/legacy-date-fields',row);const result=await privateReader(f);assert.equal(result.state.paid.length,1);assert.equal(result.state.paid[0].data.start,start);assert.equal(result.state.shared.length,0);
  const ui=displayFixture();ui.controller.render(result.state,{staffId,epoch:1,start,end});assert.doesNotMatch(ui.node('payslipPendingList').innerHTML,/Payment pending/);assert.match(ui.node('payslipPendingList').innerHTML,/Paid payslip/);
});
test('missing/revoked/wrong-staff private approval never falls back to reading shared snapshots on public Staff auth',async()=>{
  for(const binding of [{active:false},{staffId:'another-crew'},{uid:'different-uid'}]){
    const f=fixture();await f.publish();const result=await privateReader(f,{binding});assert.equal(result.state.shared.length,0);assert.equal(result.privateQueries.length,0);assert.equal(result.primaryQueries.some(q=>q.table==='staff_payslip_previews'),false);assert.ok(result.state.errors.length);
  }
});
test('a private-preview denial or estimate failure cannot discard already verified paid Owner snapshots',async()=>{
  const f=fixture();f.h.put('payroll_records/paid-original',paid(f.data));const result=await privateReader(f,{privateError:Error('Private view offline')});assert.equal(result.state.paid.length,1);assert.equal(result.state.paid[0].data.finalNetPay,net);assert.equal(result.state.shared.length,0);
});
test('conflicting identity, cutoff and paid net sources are held rather than merged with current figures',()=>{
  for(const mutate of [row=>row.staffId='other',row=>row.frozenData.profile.staffId='other',row=>row.frozenData.finalNetPay=100,row=>row.frozenData.start='2029-12-16',row=>row.frozenData.isPaid=false]){
    const f=fixture(),row=paid(f.data);mutate(row);assert.throws(()=>normalizeStaffPayslip(row,{staffId}));
  }
});
test('a name-only legacy snapshot needs a verified unique current account, and current charges still never fill saved fields',()=>{
  const f=fixture(),row=paid(f.data);delete row.staffId;delete row.frozenData.staffId;delete row.frozenData.profile.staffId;
  assert.throws(()=>normalizeStaffPayslip(row,{staffId}),/exact employee/);assert.equal(normalizeStaffPayslip(row,{staffId,legacyNames:[name]}).finalNetPay,net);
});
function displayFixture(){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',innerText:'',textContent:'',hidden:false,style:{},children:[],querySelectorAll:()=>[],prepend(child){this.children.unshift(child);},remove(){nodes.delete(this.id);}});return nodes.get(id);};
  for(const id of ['payslipPendingList','payslipHistoryList','pendingPayBadge','payslipLiveSection','staffAuthoritativePayslip','btnTabLivePay'])node(id);
  let unlocked=true,epoch=1;const calls=[];
  const w={localStorage:{getItem:()=>staffId},staffVaultSession:{get epoch(){return epoch;},allows:(_id,version)=>unlocked&&_id===staffId&&(version==null||version===epoch)},viewPastPayslip:encoded=>calls.push(['view',JSON.parse(decodeURIComponent(encoded))]),openPayslipSignatureModal:(recordId)=>calls.push(['sign',recordId])};
  const d={getElementById:id=>nodes.get(id)||null,createElement:()=>({innerHTML:'',hidden:false,remove(){}})},controller=installStaffSavedPayslipViews(w,d);
  return {w,d,node,calls,controller,lock(){unlocked=false;epoch++;w.clearStaffSavedPayslips();}};
}
test('shared preview is read-only, paid acknowledgment remains separate, and vault lock invalidates old saved-view actions',async()=>{
  const f=fixture();await f.publish();const {state}=await privateReader(f),ui=displayFixture();ui.controller.render(state,{staffId,epoch:1,start,end});
  assert.match(ui.node('payslipPendingList').innerHTML,/Owner-shared payslip/);assert.doesNotMatch(ui.node('payslipPendingList').innerHTML,/data-saved-sign/);assert.match(ui.node('staffAuthoritativePayslip').innerHTML,/930\.73/);
  ui.w.signSavedStaffPayslip('shared:'+key);assert.equal(ui.calls.length,0);ui.w.viewSavedStaffPayslip('shared:'+key);assert.equal(ui.calls[0][1].recordState,'shared');ui.lock();ui.w.viewSavedStaffPayslip('shared:'+key);assert.equal(ui.calls.length,1);assert.equal(ui.node('payslipPendingList').innerHTML,'');
  f.h.put('payroll_records/paid-original',paid(f.data));const paidView=await privateReader(f),other=displayFixture();other.controller.render(paidView.state,{staffId,epoch:1,start,end});other.w.signSavedStaffPayslip('paid:paid-original');assert.deepEqual(other.calls,[['sign','paid-original']]);
});
test('an older paid record without an acknowledgment marker is not labeled signed or acknowledged',async()=>{
  const f=fixture(),record=paid(f.data);delete record.acknowledged;f.h.put('payroll_records/old-paid',record);const {state}=await privateReader(f),ui=displayFixture();ui.controller.render(state,{staffId,epoch:1,start,end});
  assert.match(ui.node('payslipHistoryList').innerHTML,/acknowledgment not recorded/);assert.doesNotMatch(ui.node('payslipHistoryList').innerHTML,/· Acknowledged|data-saved-sign/);
});
test('the exact saved arithmetic adapter ships identically for Owner publication and Staff presentation',()=>{
  assert.equal(readFileSync(new URL('../takodeal-staff/staff-payslip-snapshot.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/staff-payslip-snapshot.js',import.meta.url),'utf8'));
});
