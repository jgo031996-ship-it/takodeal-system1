import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {captureOwnerPayslip,installOwnerPayslipSharing} from '../takodeal-manager/staff-payslip-publication-ui.js';
import {prepareSharedPayslip} from '../takodeal-manager/staff-payslip-publication.js';
import {deferred,tick} from './helpers/review-dom.mjs';
const owner='jgo031996@gmail.com';
function fixture({stage,confirm=true,revision=0,bootstrap=false}={}){
 const nodes=new Map(),inputs=[],events=[],reads=[],publications=[],dialogs=[],businessWrites=[];let freshCount=0,valid=true,answer=confirm;const gate=deferred(),arrived=deferred();
 const node=(id,tagName='INPUT')=>{if(!nodes.has(id))nodes.set(id,{id,tagName,value:'0',innerText:'0',textContent:'',dataset:{},style:{display:'flex'},hidden:false,disabled:false});return nodes.get(id);};
 for(const [id,value]of Object.entries({psLoans:'0',psAdvance:'2',psFoods:'5',psLate:'0',psSSS:'10',psPhil:'0',psPagibig:'0',psStraightBonus:'0',psPerfBonus:'0',psHoliday:'0',psBasicPay:'1000',psOvertime:'0',psNetPay:'965.65'})){const n=node(id,['psBasicPay','psOvertime','psNetPay'].includes(id)?'SPAN':'INPUT');n.value=value;n.innerText=value;}
 node('payslipModal','DIV');node('btnShareStaffPayslip','BUTTON');
 const data={staffId:'sample',name:'Sample <img src=x onerror=bad()> Staff',branch:'Maa',start:'2030-01-01',end:'2030-01-15',isPaid:false,basicPay:9999,nightBonus:888,overtime:777,straightBonus:222,perfBonus:333,holidayPayTotal:444,holiday:555,performanceBonus:666,
  loans:40,advances:50,meals:60,lateDeduction:70,sss:80,philhealth:90,pagibig:100,payrollAdjustments:0,onlineRefunds:0,cashShortages:0,ownerDeductions:0,
  customDeductions:[{name:'Reviewed Wi-Fi',amount:999},{name:'Manual zero',amount:888}],customDeductionsTotal:1887,
  profile:{staffId:'sample',cashierName:'Sample Staff',branch:'Maa',hourlyRate:500,sssAmount:999,philHealthAmount:999,pagibigAmount:999,customDeductions:[{name:'Wrong current profile label',amount:999}],pin:'PRIVATE_PIN',phone:'PRIVATE_PHONE'},logs:[]};
 for(const [i,value]of ['17.35','0'].entries()){const n=node('custom-'+i);n.value=value;n.dataset.deductionIndex=String(i);inputs.push(n);}
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector==='.ps-dynamic-deduction'?inputs:[]};
 const token={},w={auth:{currentUser:{uid:'owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'owner',email:owner,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},currentPayslipData:data,paidPayrollSnapshots:new WeakSet(),recalcPayslip:()=>events.push('recalculate'),
  requirePayrollPreview:row=>{if(!valid||row!==w.currentPayslipData)throw Error('Payroll preview is locked or stale');return token;},getPayrollPreviewGuard:()=>({assertCurrent:value=>{assert.equal(value,token);if(!valid)throw Error('Payroll preview is locked or stale');}})};
 for(const name of ['updateDoc','setDoc','addDoc','deleteDoc','runTransaction','finalizePayslip','submitMultiDispatch'])w[name]=()=>{businessWrites.push(name);throw Error('Unexpected financial/business write: '+name);};
 const pause=async label=>{events.push(label);if(stage===label){arrived.resolve();await gate.promise;}};
 const assertFresh=async row=>{assert.equal(row,data);await pause('fresh-'+(++freshCount));};
 const read=async(_api,options)=>{reads.push(options);options.assertCurrent();await pause('read');options.assertCurrent();return{revision};};
 const publish=async(_api,options)=>{options.assertCurrent();await pause('publish');options.assertCurrent();const prepared=prepareSharedPayslip(options.data,options.finalNetPay);publications.push({options,prepared});return{revision:revision+1};};
 w.Swal={fire:async options=>{dialogs.push(options);if(options.showCancelButton){await pause('confirm');return {isConfirmed:answer};}return{};}};
 let controller;
 if(bootstrap){const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),line=main.split('\n').find(line=>line.includes('runManagerDomReady(() => installOwnerPayslipSharing('));assert.ok(line,'actual main bootstrap exists');vm.runInNewContext(line,{window:w,document,runManagerDomReady:callback=>callback(),payrollActorKey:()=>JSON.stringify([w.auth.currentUser.uid,w.sessionUser]),assertPayrollScheduleFresh:async()=>{events.push('schedule-fresh');},assertPayrollSalaryFresh:async()=>{events.push('salary-fresh');},installOwnerPayslipSharing:(api,d,options)=>{controller=installOwnerPayslipSharing(api,d,{...options,read,publish});}});}
 else controller=installOwnerPayslipSharing(w,document,{actorKey:()=>JSON.stringify([w.auth.currentUser.uid,w.sessionUser]),assertFresh,read,publish});
 controller.sync(data);
 return{w,data,node,inputs,document,controller,events,reads,publications,dialogs,businessWrites,gate,arrived:arrived.promise,lock:()=>{valid=false;},answer:value=>{answer=value;}};
}

test('capture reads every visible manual amount, preserves explicit zeros/custom labels and leaves current profiles unchanged',()=>{
 const f=fixture(),before=structuredClone(f.data),captured=captureOwnerPayslip(f.document,f.data),prepared=prepareSharedPayslip(captured.data,captured.finalNetPay);
 for(const key of ['nightBonus','straightBonus','perfBonus','holidayPayTotal','loans','lateDeduction','philhealth','pagibig'])assert.equal(prepared.snapshot[key],0,key);
 assert.equal(prepared.snapshot.sss,10);assert.equal(prepared.grossPay,1000);assert.equal(prepared.totalDeductions,34.35);assert.equal(prepared.finalNetPay,965.65);assert.deepEqual(prepared.snapshot.customDeductions,[{name:'Reviewed Wi-Fi',amount:17.35},{name:'Manual zero',amount:0}]);assert.deepEqual(f.data,before);assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_|Wrong current profile label/);
});
test('actual main bootstrap calls both salary and schedule freshness checks before review and again before publication',async()=>{
 const f=fixture({bootstrap:true});assert.deepEqual(await f.controller.share(),{revision:1});assert.equal(f.events.filter(value=>value==='schedule-fresh').length,2);assert.equal(f.events.filter(value=>value==='salary-fresh').length,2);assert.equal(f.reads.length,1);assert.equal(f.publications.length,1);assert.deepEqual(f.businessWrites,[]);
});
test('the concrete confirmation names staff/cutoff and exact reviewed totals with escaped text, and cancel performs no publication or business write',async()=>{
 const f=fixture({confirm:false});assert.equal(await f.controller.share(),false);assert.equal(f.reads.length,1);assert.equal(f.publications.length,0);assert.deepEqual(f.businessWrites,[]);const dialog=f.dialogs.find(row=>row.showCancelButton);assert.match(dialog.html,/2030-01-01.*2030-01-15/);assert.match(dialog.html,/1,000\.00/);assert.match(dialog.html,/34\.35/);assert.match(dialog.html,/965\.65/);assert.match(dialog.html,/&lt;img/);assert.doesNotMatch(dialog.html,/<img|PRIVATE_/);assert.match(dialog.html,/Payment is a separate action/);assert.deepEqual(f.events,['recalculate','fresh-1','read','confirm']);assert.equal(f.node('btnShareStaffPayslip').disabled,false);
});
test('confirmed publication forwards the captured manual values and current revision only after both fresh checks',async()=>{
 const f=fixture({revision:3});assert.deepEqual(await f.controller.share(),{revision:4});assert.deepEqual(f.events,['recalculate','fresh-1','read','confirm','fresh-2','publish']);assert.equal(f.publications[0].options.expectedRevision,3);assert.equal(f.publications[0].options.finalNetPay,965.65);assert.equal(f.publications[0].prepared.snapshot.sss,10);assert.equal(f.publications[0].prepared.snapshot.nightBonus,0);assert.deepEqual(f.businessWrites,[]);assert.equal(f.node('btnShareStaffPayslip').disabled,false);assert.equal(f.node('btnShareStaffPayslip').textContent,'Save & share payslip');assert.match(f.dialogs.at(-1).text,/Revision 4/);
});
test('blank/malformed/negative or missing amounts and mismatched custom labels refuse before any cloud read or confirmation',async()=>{
 for(const mutate of [f=>{f.node('psSSS').value='';},f=>{f.node('psSSS').value='1oops';},f=>{f.node('psSSS').value='-1';},f=>{f.node('psSSS').value='Infinity';},f=>{f.document.getElementById=id=>id==='psSSS'?null:f.node(id);},f=>{f.inputs[0].dataset.deductionIndex='22';},f=>{f.data.customDeductions[0].name='';}]){const f=fixture();mutate(f);assert.equal(await f.controller.share(),false);assert.equal(f.reads.length+f.publications.length,0);assert.equal(f.dialogs.some(row=>row.showCancelButton),false);assert.deepEqual(f.businessWrites,[]);}
});
test('manual edits during each awaited review/publication stage reject the stale snapshot before a write',async()=>{
 for(const stage of ['fresh-1','read','confirm','fresh-2','publish']){const f=fixture({stage}),pending=f.controller.share();await f.arrived;f.node('psSSS').value='11';f.node('psNetPay').innerText='964.65';f.gate.resolve();assert.equal(await pending,false,stage);assert.equal(f.publications.length,0,stage);assert.deepEqual(f.businessWrites,[]);assert.match(f.dialogs.at(-1).text,/amounts changed/);}
});
test('changing an in-place custom label or fixed deduction source during confirmation invalidates the exact reviewed intent',async()=>{
 for(const mutate of [f=>{f.data.customDeductions[0].name='Changed label';},f=>{f.data.ownerDeductions=1;f.node('psNetPay').innerText='964.65';},f=>{f.data.staffId='another-staff';}]){const f=fixture({stage:'confirm'}),pending=f.controller.share();await f.arrived;mutate(f);f.gate.resolve();assert.equal(await pending,false);assert.equal(f.publications.length,0);assert.deepEqual(f.businessWrites,[]);}
});
test('auth replacement, permission edit, hidden modal, preview lock, payment start and held/paid transitions reject before publication',async()=>{
 for(const mutate of [f=>{f.w.auth.currentUser={...f.w.auth.currentUser};},f=>{f.w.sessionUser={...f.w.sessionUser};},f=>{f.w.sessionUser.permissions=[];},f=>{f.node('payslipModal').style.display='none';},f=>f.lock(),f=>{f.w.payrollPaymentPending=true;},f=>{f.data.isPaid=true;},f=>f.w.paidPayrollSnapshots.add(f.data),f=>{f.data.attendanceReviewRequired=true;},f=>{f.data.salaryReviewRequired=true;}]){const f=fixture({stage:'read'}),pending=f.controller.share();await f.arrived;mutate(f);f.gate.resolve();assert.equal(await pending,false);assert.equal(f.publications.length,0);assert.deepEqual(f.businessWrites,[]);}
});
test('switching to a new payslip while an old share is waiting never publishes the old record and releases the new selection button',async()=>{
 const f=fixture({stage:'read'}),pending=f.controller.share();await f.arrived;const next={...f.data,staffId:'next',name:'Next Employee'};f.w.currentPayslipData=next;f.controller.sync(next);assert.equal(f.node('btnShareStaffPayslip').disabled,true);f.gate.resolve();assert.equal(await pending,false);assert.equal(f.publications.length,0);assert.equal(f.node('btnShareStaffPayslip').disabled,false);assert.equal(f.node('btnShareStaffPayslip').hidden,false);assert.deepEqual(f.businessWrites,[]);
});
test('paid/frozen/history/held views hide Share; ineligible and payment-pending calls perform no reads or writes',async()=>{
 for(const kind of ['paid','frozen','history','attendance','salary','unverified','not-owner','franchise','pending']){const f=fixture();if(kind==='paid')f.data.isPaid=true;if(kind==='frozen')f.w.paidPayrollSnapshots.add(f.data);if(kind==='attendance')f.data.attendanceReviewRequired=true;if(kind==='salary')f.data.salaryReviewRequired=true;if(kind==='unverified')f.w.auth.currentUser.emailVerified=false;if(kind==='not-owner')f.w.auth.currentUser.email='manager@example.invalid';if(kind==='franchise')f.w.sessionUser.isFranchisee=true;if(kind==='pending')f.w.payrollPaymentPending=true;f.controller.sync(f.data,{history:kind==='history'});assert.equal(f.node('btnShareStaffPayslip').hidden,kind!=='pending');if(kind==='history')continue;assert.equal(await f.controller.share(),false);assert.equal(f.reads.length+f.publications.length,0);assert.deepEqual(f.businessWrites,[]);}
});
test('repeated clicks while checking or publishing coalesce to a single confirmation and one publication',async()=>{
 for(const stage of ['read','publish']){const f=fixture({stage}),first=f.controller.share();await f.arrived;assert.equal(await f.w.saveAndShareStaffPayslip(),false);assert.equal(await f.controller.share(),false);f.gate.resolve();assert.deepEqual(await first,{revision:1});assert.equal(f.reads.length,1);assert.equal(f.publications.length,1);assert.equal(f.dialogs.filter(row=>row.showCancelButton).length,1);assert.deepEqual(f.businessWrites,[]);}
});
test('actual modal sync hook passes the saved-history context and never replaces the separate payment flow',()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.match(main,/staffPayslipSharing\?\.sync\(data,\{history:!!savedHistoryData\}\)/);assert.match(main,/window\.finalizePayslip\s*=\s*async function/);const html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8');assert.match(html,/id="btnShareStaffPayslip"[^>]*onclick="window\.saveAndShareStaffPayslip\(\)"|onclick="window\.saveAndShareStaffPayslip\(\)"[^>]*id="btnShareStaffPayslip"/);
});
