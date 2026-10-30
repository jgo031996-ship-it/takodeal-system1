import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ReviewDocument,ReviewElement,deferred} from './helpers/review-dom.mjs';
import {exportPayslipImage,syncPayslipImageButton} from '../takodeal-manager/payroll-completion.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
Object.defineProperty(ReviewElement.prototype,'innerText',{get(){return this.textContent;},set(value){this.textContent=value;}});
const extract=name=>{const from=source.indexOf('window.'+name+' = '),end=source.indexOf('\n};',from);assert.ok(from>=0&&end>from);return source.slice(from,end+3);};
function fixture(extra={}){
 const d=new ReviewDocument(),calls={reviews:[],corrections:[],notifications:[],writes:0,downloads:0,captures:0};
 const inputIds=new Set(['psPayDistributed','psOvertime','psStraightBonus','psHoliday','psPerfBonus','psLate','psSSS','psPhil','psPagibig','psAdvance','psLoans','psFoods']);
 const ids=['payslipModal','printablePayslip','psDocumentTitle','psDocumentState','psReviewPanel','psReviewReasons','psReviewHours','btnReviewPayslipRecords','btnCheckSavedPayslip','btnFinalizePayslip','btnDownloadPayslip','psName','psBranch','psStart','psEnd','psBasicPay','psDaysWorked','psDateHired','psScheduleMemory','psOnlineRefunds','psCashShortages','psPenalties','psDynamicDeductionsArea','psAttendanceBody','psGross','psTotalDeduct','psNetPay',...inputIds];
 for(const id of ids){const node=d.createElement(inputIds.has(id)?'input':id==='psAttendanceBody'?'tbody':id.startsWith('btn')?'button':'div');node.setAttribute('id',id);node.style={};d.body.appendChild(node);}
 d.querySelectorAll=selector=>selector==='.ps-dynamic-deduction'?d.body.querySelectorAll('input').filter(node=>(node.attributes.class||'').split(' ').includes('ps-dynamic-deduction')):d.body.querySelectorAll(selector);
 const data={name:'Fictional Crew',staffId:'fictional-crew',branch:'Maa',start:'2026-10-16',end:'2026-10-31',profile:{staffId:'fictional-crew',dateHired:'2026-02-25'},attendanceReviewRequired:true,salaryReviewRequired:false,recordedHours:16.75,hours:0,basicPay:0,shiftsWorked:0,meals:530.25,
  payrollReviewReasons:['Linked Time In is missing; confirm the affected original shift.'],attendanceLogIds:['affected-out'],attendanceIssues:[{id:'affected-out',type:'TIME OUT',timestamp:'2026-10-24T17:00:00+08:00',timeInLogId:'missing-original'}],
  logs:[{date:'Oct 16',in:'09:00 AM',out:'05:00 PM',hrs:'8.00',remark:'Recorded pair · payroll review pending'}],...extra};
 const w={globalPayrollCache:{[data.name]:data},currentPayslipData:null,paidPayrollSnapshots:new WeakSet(),requirePayrollPreview(value){if(w.stale||!value||value!==w.globalPayrollCache[value.name])throw Error('Refresh payroll for the selected cutoff.');return 'confirmed-preview';},ManagerUI:{notify:message=>calls.notifications.push(message)},openAttendanceRecovery:value=>calls.reviews.push(copy(value)),openOwnerTimeOutCorrection:value=>calls.corrections.push(copy(value)),auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',permissions:['all'],allowedBranches:['All']}};
 const deny=()=>{calls.writes++;assert.fail('Preview and navigation must not write business records.');};
 const context=vm.createContext({window:w,document:d,syncPayslipImageButton,exportPayslipImage,console:{error(){}},Date,addDoc:deny,setDoc:deny,updateDoc:deny,deleteDoc:deny,runTransaction:deny,writeBatch:deny});
 for(const name of ['openPayslipModal','recalcPayslip','downloadPayslipImage'])vm.runInContext(extract(name),context);
 return {w,d,data,calls,node:id=>d.getElementById(id),open:()=>w.openPayslipModal(data.name)};
}
test('an attendance-held payroll is a review draft, not zero earnings minus recorded deductions',async()=>{
 const f=fixture(),before=copy(f.data);await f.open();assert.equal(f.node('psBasicPay').innerText,'Review pending');assert.equal(f.node('psGross').innerText,'Review pending');assert.equal(f.node('psNetPay').innerText,'Review pending');assert.equal(f.node('psDaysWorked').innerText,'review pending');assert.equal(f.node('psTotalDeduct').innerText,'530.25');assert.match(f.node('psDocumentState').innerText,/REVIEW DRAFT/);assert.equal(f.node('psReviewPanel').hidden,false);assert.match(f.node('psReviewHours').textContent,/16.75 recorded paired hours/);assert.match(f.node('psReviewReasons').textContent,/Linked Time In/);assert.equal(f.node('btnFinalizePayslip').disabled,true);assert.equal(f.node('btnReviewPayslipRecords').disabled,false);assert.equal(f.node('btnDownloadPayslip').disabled,true);f.node('psFoods').value='600';f.w.recalcPayslip();assert.equal(f.node('psNetPay').innerText,'Review pending');assert.deepEqual(f.data,before);assert.equal(f.calls.writes,0);
});
test('salary and identity holds share the same payment protection without losing their specific reason',async()=>{
 for(const mode of ['salary','identity']){const f=fixture({salaryReviewRequired:mode==='salary',payrollReviewReasons:[mode==='salary'?'Private salary history is unavailable.':'Two employee IDs share a payroll name.']});await f.open();assert.equal(f.node('psNetPay').innerText,mode==='salary'?'Awaiting rate review':'Review pending');assert.equal(f.node('btnFinalizePayslip').disabled,true);assert.equal(f.node('btnReviewPayslipRecords').hidden,false);assert.equal(f.node('psReviewReasons').textContent,f.data.payrollReviewReasons[0]);}
});
test('the enabled review action carries the exact employee cutoff reasons issues IDs and paired hours',async()=>{
 const f=fixture();await f.open();f.node('btnReviewPayslipRecords').click();assert.equal(f.node('payslipModal').style.display,'none');assert.deepEqual(f.calls.reviews,[{staffId:f.data.staffId,staffName:f.data.name,branch:'Maa',from:f.data.start,to:f.data.end,payrollReviewReasons:f.data.payrollReviewReasons,attendanceLogId:'affected-out',attendanceLogIds:['affected-out'],attendanceIssues:f.data.attendanceIssues,recordedHours:16.75}]);assert.equal(f.calls.writes,0);
});
test('a held review callback cannot navigate with a stale account cutoff or different selected payslip',async()=>{
 for(const change of ['stale','selection']){const f=fixture();await f.open();if(change==='stale')f.w.stale=true;else f.w.currentPayslipData={...f.data,name:'Another employee'};f.node('btnReviewPayslipRecords').click();assert.equal(f.calls.reviews.length,0);assert.equal(f.node('payslipModal').style.display,'flex');assert.equal(f.calls.notifications.length,1);}
});
test('each missing Time Out action uses its actual source ID and branch with the selected cutoff and no departure time',async()=>{
 const f=fixture({logs:[{date:'Oct 24',in:'06:30 PM',out:'MISSED',hrs:'0.00',remark:'Missed Time Out',attendanceLogId:'exact-original-in',branch:'Cabantian'}]});await f.open();const button=f.node('psAttendanceBody').querySelector('[data-payslip-missing-index]');assert.ok(button);button.click();assert.deepEqual(f.calls.corrections,[{attendanceLogId:'exact-original-in',staffId:f.data.staffId,staffName:f.data.name,branch:'Cabantian',cutoffStart:f.data.start,cutoffEnd:f.data.end}]);assert.equal(Object.hasOwn(f.calls.corrections[0],'timeOutAt'),false);assert.equal(f.node('payslipModal').style.display,'none');assert.equal(f.calls.writes,0);
});
test('unlinked missing-punch rows do not invent a source and stale correction callbacks cannot run',async()=>{
 const f=fixture({logs:[{in:'09:00 AM',out:'MISSED',remark:'Missing source'}]});await f.open();assert.equal(f.node('psAttendanceBody').querySelector('[data-payslip-missing-index]'),null);
 const linked=fixture({logs:[{in:'09:00 AM',out:'MISSED',attendanceLogId:'original-in'}]});await linked.open();linked.w.stale=true;linked.node('psAttendanceBody').querySelector('[data-payslip-missing-index]').click();assert.equal(linked.calls.corrections.length,0);assert.equal(linked.calls.writes,0);
});
test('paid snapshots keep their saved figures and do not expose unpaid repair actions even with obsolete hold fields',async()=>{
 for(const viaWeakSet of [false,true]){const f=fixture({isPaid:!viaWeakSet,basicPay:4500,shiftsWorked:10,finalNetPay:3969.75,logs:[{in:'09:00 AM',out:'MISSED',attendanceLogId:'historical-in'}]});if(viaWeakSet)f.w.paidPayrollSnapshots.add(f.data);const before=copy(f.data);await f.open();assert.equal(f.node('psBasicPay').innerText,'4,500.00');assert.equal(f.node('psGross').innerText,'4,500.00');assert.equal(f.node('psNetPay').innerText,'3,969.75');assert.equal(f.node('psDaysWorked').innerText,'10');assert.equal(f.node('psReviewPanel').hidden,true);assert.equal(f.node('btnReviewPayslipRecords').hidden,true);assert.equal(f.node('btnDownloadPayslip').disabled,false);assert.equal(f.node('psAttendanceBody').querySelector('[data-payslip-missing-index]'),null);assert.deepEqual(f.data,before);}
});
test('legacy malformed hold reasons do not break paid or unpaid opening, and text cannot create markup',async()=>{
 for(const isPaid of [false,true]){const f=fixture({isPaid,payrollReviewReasons:null,attendanceReviewReasons:'legacy non-array reason',basicPay:500,finalNetPay:400});await f.open();assert.equal(f.node('payslipModal').style.display,'flex');}
 const f=fixture({payrollReviewReasons:['<img src=x onerror=bad>']});await f.open();assert.equal(f.node('psReviewReasons').querySelector('img'),null);assert.match(f.node('psReviewReasons').textContent,/<img/);
});
test('held unpaid image export stops before cloning loading libraries or creating a file and gives the review action',async()=>{
 const f=fixture();await f.open();f.node('printablePayslip').cloneNode=()=>assert.fail('A held preview cannot become an official-looking image.');await assert.rejects(exportPayslipImage(f.w,f.d,{load:()=>assert.fail('No library download'),capture:()=>assert.fail('No image capture')}),error=>error.code==='payroll-review-required'&&/Review affected records/.test(error.message));assert.equal(await f.w.downloadPayslipImage(),null);assert.match(f.calls.notifications.at(-1),/Review affected records/);assert.equal(f.calls.writes,0);
});
test('an export that becomes held during asynchronous preparation is stopped before capture',async()=>{
 const f=fixture({attendanceReviewRequired:false,salaryReviewRequired:false,basicPay:500}),gate=deferred();await f.open();f.node('printablePayslip').cloneNode=()=>({style:{},querySelectorAll:()=>[]});const create=f.d.createElement.bind(f.d);f.d.createElement=tag=>{const node=create(tag);node.style={};node.remove=()=>{};return node;};
 const pending=exportPayslipImage(f.w,f.d,{load:()=>gate.promise,capture:()=>assert.fail('A newly held draft cannot be captured.')});f.data.attendanceReviewRequired=true;gate.resolve();await assert.rejects(pending,error=>error.code==='payroll-review-required');assert.equal(f.node('btnDownloadPayslip').disabled,true);
});
