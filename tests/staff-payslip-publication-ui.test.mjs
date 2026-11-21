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
 const handlers={};const document={addEventListener:(type,fn)=>{handlers[type]=fn;},change:node=>handlers.change({target:node}),getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector==='.ps-dynamic-deduction'?inputs:[]};
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
test('opening an eligible payslip syncs it automatically without another payment or dialog',async()=>{
 const f=fixture({bootstrap:true});await f.controller.beforePayment(f.data);assert.equal(f.publications.length,1);assert.ok(f.events.includes('schedule-fresh'));assert.ok(f.events.includes('salary-fresh'));assert.equal(f.reads.length,1);assert.deepEqual(f.dialogs,[]);assert.deepEqual(f.businessWrites,[]);
});
test('several changes to the same manual amount publish one updated amount before payment',async()=>{
 const f=fixture();await f.controller.beforePayment(f.data);f.node('psFoods').value='2';f.node('psNetPay').innerText='968.65';f.document.change(f.node('psFoods'));f.document.change(f.node('psFoods'));await f.controller.beforePayment(f.data);
 assert.equal(f.publications.length,2);assert.equal(f.publications.at(-1).prepared.snapshot.meals,2);assert.equal(f.publications.at(-1).prepared.snapshot.vaultOverrides.meals,2);
});
test('an edit during the initial private read is captured, and history never starts another write',async()=>{
 const f=fixture({stage:'read'});await f.arrived;f.node('psFoods').value='2';f.node('psNetPay').innerText='968.65';f.document.change(f.node('psFoods'));f.gate.resolve();await f.controller.beforePayment(f.data);assert.equal(f.publications[0].prepared.finalNetPay,968.65);
 f.controller.sync({...f.data,isPaid:true},{history:true});await tick();assert.equal(f.publications.length,1);
});
test('changed Owner identity cannot publish an interrupted save',async()=>{
 const f=fixture({stage:'publish'});await f.arrived;f.w.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};f.gate.resolve();await assert.rejects(f.controller.beforePayment(f.data));assert.equal(f.publications.length,0);
});
