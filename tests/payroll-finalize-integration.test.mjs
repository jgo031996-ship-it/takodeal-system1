import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import * as roster from '../takodeal-manager/payroll-roster-model.js';
import * as rosterUI from '../takodeal-manager/payroll-balance-review.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import * as completion from '../takodeal-manager/payroll-completion.js';
import * as preview from '../takodeal-manager/payroll-preview-guard.js';
import * as freshness from '../takodeal-manager/payroll-schedule-freshness.js';
import {assertPayrollSalaryFresh} from '../takodeal-manager/staff-rate-model.js';
import {assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {finalizeOrdinaryPayroll,ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {canOpenWorkspacePage,createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';

const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function extract(name){const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,name+' exists in actual main.js');return source.slice(start+1,end+3);}
const held=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node{
 constructor(id,tag='DIV'){this.id=id;this.tagName=tag;this.value='';this.style={};this.disabled=false;this._text='';this.innerHTML='';this.listeners={};}
 get innerText(){return this._text;}set innerText(value){this._text=String(value);}
 get textContent(){return this._text;}set textContent(value){this._text=String(value);}
 addEventListener(event,callback){(this.listeners[event]||=[]).push(callback);}
 querySelectorAll(){return [];}
}
async function fixture(options={}){
 const h=firestoreHarness(),nodes=new Map(),events=[],notifications=[],exports=[],opens=[],queries=[],rows=[];
 const inputIds=new Set(['psOvertime','psStraightBonus','psHoliday','psPerfBonus','psLate','psSSS','psPhil','psPagibig','psAdvance','psLoans','psFoods','psPayDistributed']);
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Node(id,inputIds.has(id)?'INPUT':'DIV'));return nodes.get(id);};
 const d={getElementById:id=>id==='payrollBalanceReview'?null:node(id),querySelectorAll:()=>[]};
 const uid='sample-owner',email='sample-owner@example.test',branch='Sample Branch',staffId='sample-staff',name='Sample Staff',start='2030-01-16',end=start;
 const actor={uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]},hq={email,role:'Owner',fullName:'Sample Owner',permissions:['all'],assignedBranch:'All',active:true};
 Object.assign(h.api,{auth:{currentUser:actor},sessionUser:createWorkspaceSession(actor,hq),isBranchAllowed:()=>true,ManagerUI:{notify:message=>notifications.push(message)}});
 h.put('hq_managers/'+uid,hq);h.put('hq_email_access/'+email,{active:true,permissions:['all'],allowedBranches:['All']});
 const profile={staffId,cashierName:name,branch,role:'Crew',hourlyRate:450,dateHired:'2029-01-01',customDeductions:[]};
 h.put('cashiers/'+staffId,profile);h.put('cash_accounts/sample-cash',{name:'Sample Cash',branch,balance:5000});
 h.put('staff_ledger/sample-loan',{staffId,staffName:name,branch,totalLoaned:500,totalPaid:0,cutoffDeduction:50});
 h.put('staff_deductions/sample-food',{staffId,staffName:name,branch,type:'Staff Meal',amount:35,status:'Unpaid',dateAdded:new Date(start+'T12:00:00+08:00')});
 const history=assembleScheduleHistory({currentYear:2030,currentMonth:1});
 h.api.loadPayrollScheduleHistory=async()=>history;
 h.api.getDocFromServer=async reference=>({ref:reference,id:reference.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))});
 const read=h.api.getDocsFromServer;h.api.getDocsFromServer=async reference=>{queries.push(reference.table);return read(reference);};
 let transactions=0;const run=h.api.runTransaction;h.api.runTransaction=async(...args)=>{transactions++;return run(...args);};
 const data={staffId,name,branch,start,end,profile:{...profile},hours:8,shiftsWorked:1,basicPay:450,nightBonus:0,straightBonus:0,holidayPayTotal:0,perfBonus:0,lateDeduction:0,sss:0,philhealth:0,pagibig:0,advances:0,meals:35,loans:50,ledgerId:'sample-loan',customDeductionsTotal:0,onlineRefunds:0,onlineRefundRows:[],scheduleEvidenceStamp:freshness.payrollScheduleStamp(history,{start,end}),logs:[{date:'Jan 16',in:'09:00 AM',out:'05:00 PM',hrs:'8.00',remark:'Complete'}]};
 const other={name:'Other Staff',staffId:'other',branch,start,end,basicPay:400,hours:8,profile:{hourlyRate:400},isPaid:false};
 const row=person=>{const button=new Node('button');button.textContent='Generate Payslip';const value={cells:[{textContent:person.name},{textContent:person.branch},{textContent:'8.00 hrs'},{textContent:'Original deductions'}],style:{background:'white',opacity:'1'},querySelector:()=>button,button};rows.push(value);return value;};
 const ownRow=row(data),otherRow=row(other);node('payrollGeneratorBody').querySelectorAll=selector=>selector==='tr'?rows:[];
 node('payrollStart').value=start;node('payrollEnd').value=end;node('payrollGrandTotalContainer').style.display='flex';
 const state={h,w:h.api,d,node,data,other,ownRow,otherRow,events,notifications,exports,opens,queries,transactions:()=>transactions,recordId:ordinaryPayrollId(staffId,start,end)};
 const Swal={fire:async(...args)=>{events.push(args);const first=args[0];if(first?.title==='💸 Disburse Payroll')return options.confirm?options.confirm(state,first):{isConfirmed:true,value:'0'};return {isConfirmed:false};},showValidationMessage:message=>notifications.push(message)};
 const context=vm.createContext({activeStaffProfile,...roster,...rosterUI,...completion,...preview,...freshness,assertPayrollSalaryFresh,canOpenWorkspacePage,window:h.api,document:d,Swal,Date,console:{error(){},log(){}},escapeHtml:value=>String(value),
  finalizeOrdinaryPayroll:async(api,input)=>{const result=await finalizeOrdinaryPayroll(api,input);await options.afterEngine?.(state,result);return result;},
  finalizeRefundPayroll:()=>assert.fail('This ordinary fixture must use the atomic ordinary-payroll engine'),
  exportPayslipImage:async()=>{exports.push({data:h.api.currentPayslipData,name:node('psName').innerText,isPaid:h.api.currentPayslipData?.isPaid});if(options.imageFailure)throw Error('Synthetic image renderer failure');return {filename:'sample.png'};}
 });
 for(const name of ['getPayrollPreviewGuard','requirePayrollPreview','openPayslipModal','recalcPayslip','finalizePayslip','downloadPayslipImage'])vm.runInContext(extract(name),context);
 for(const name of ['generateAutoPayslips','loadLedgerData','loadLedger','loadBudgets','loadAccountsAndBudget'])h.api[name]=()=>assert.fail('Payment must not trigger hidden full-panel refresh: '+name);
 const guard=h.api.getPayrollPreviewGuard(),token=guard.begin();guard.complete(token);
 h.api.globalPayrollCache={[name]:data,[other.name]:other};node('payrollGrandTotalAmount').innerText='₱765.00';
 const open=h.api.openPayslipModal;h.api.openPayslipModal=async name=>{opens.push(name);return open(name);};
 await h.api.openPayslipModal(name);opens.length=0;
 return state;
}
function assertOnePayment(f){
 assert.equal(f.h.get('cash_accounts/sample-cash').balance,4635);
 assert.equal(f.h.get('staff_deductions/sample-food').status,'Paid');
 assert.equal(f.h.get('staff_ledger/sample-loan').totalPaid,50);
 const paid=f.h.get('payroll_records/'+f.recordId);assert.equal(paid.finalNetPay,365);assert.equal(paid.frozenData.isPaid,true);assert.equal(paid.frozenData.meals,35);assert.equal(paid.frozenData.loans,50);
 assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('payroll_records/')).length,1);
 assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('expenses/')).length,1);
 assert.equal(f.transactions(),1);
}

test('actual main finalizer makes one atomic ordinary payment and updates only its paid row without full-panel refreshes',async()=>{
 const f=await fixture(),otherBefore=structuredClone(f.other),otherLabel=f.otherRow.button.textContent;
 await f.w.finalizePayslip();assertOnePayment(f);
 assert.equal(f.data.isPaid,true);assert.equal(f.data.finalNetPay,365);assert.equal(f.ownRow.button.textContent,'✅ View Paid Payslip');
 assert.deepEqual(f.other,otherBefore);assert.equal(f.otherRow.button.textContent,otherLabel);assert.equal(f.otherRow.style.background,'white');
 assert.equal(f.node('payrollGrandTotalAmount').innerText,'₱765.00');assert.equal(f.w.liveAccounts[0].balance,4635);
 assert.deepEqual(f.opens,['Sample Staff']);assert.equal(f.exports.length,1);assert.equal(f.exports[0].data,f.data);assert.equal(f.exports[0].isPaid,true);
 assert.equal(f.node('payslipModal').style.display,'none');assert.equal(f.node('btnFinalizePayslip').disabled,true);assert.equal(f.w.payrollPaymentPending,false);
 assert.ok(f.events.some(([event])=>event?.title==='Payroll paid and saved'));
});

test('actual main finalizer blocks repeated invocations while confirmation is open and cannot pay the saved row again',async()=>{
 const gate=held();let dialogCount=0;const f=await fixture({confirm:()=>{dialogCount++;return gate.promise;}});
 const first=f.w.finalizePayslip();for(let n=0;n<30&&!dialogCount;n++)await tick();assert.equal(dialogCount,1);
 await Promise.all(Array.from({length:12},()=>f.w.finalizePayslip()));assert.equal(dialogCount,1);assert.equal(f.transactions(),0);assert.equal(f.h.get('cash_accounts/sample-cash').balance,5000);
 gate.resolve({isConfirmed:true,value:'0'});await first;assertOnePayment(f);
 await f.w.finalizePayslip();assertOnePayment(f);assert.equal(dialogCount,1);assert.equal(f.exports.length,1);
 assert.ok(f.events.some(([event])=>event==='Payslip already paid'));
});

test('actual image-download failure leaves the confirmed payment saved and its payment control disabled',async()=>{
 const f=await fixture({imageFailure:true});await f.w.finalizePayslip();await tick();assertOnePayment(f);
 assert.equal(f.data.isPaid,true);assert.equal(f.exports.length,1);assert.equal(f.node('btnFinalizePayslip').disabled,true);assert.equal(f.node('btnFinalizePayslip').innerText,'✅ Paid & Done!');
 assert.ok(f.notifications.some(message=>/image could not be downloaded.*confirmed payment remains saved/i.test(message)));
 await f.w.finalizePayslip();assertOnePayment(f);assert.equal(f.exports.length,1);
});

test('a different editor selected after the engine confirms payment is neither closed nor exported by the old completion',async()=>{
 const f=await fixture({afterEngine:state=>{state.w.currentPayslipData=state.other;state.node('psName').innerText=state.other.name;state.node('payslipModal').style.display='flex';state.node('btnFinalizePayslip').innerText='Other employee editor';state.node('btnFinalizePayslip').disabled=false;}});
 await f.w.finalizePayslip();assertOnePayment(f);
 assert.equal(f.data.isPaid,true);assert.equal(f.ownRow.button.textContent,'✅ View Paid Payslip');assert.equal(f.w.currentPayslipData,f.other);assert.equal(f.other.isPaid,false);
 assert.equal(f.exports.length,0);assert.deepEqual(f.opens,[]);assert.equal(f.node('payslipModal').style.display,'flex');assert.equal(f.node('psName').innerText,'Other Staff');
 assert.equal(f.node('btnFinalizePayslip').innerText,'Other employee editor');assert.equal(f.node('btnFinalizePayslip').disabled,false);assert.equal(f.w.payrollPaymentPending,false);
});
