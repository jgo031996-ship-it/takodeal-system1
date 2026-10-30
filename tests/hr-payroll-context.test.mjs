import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';
import {ReviewDocument} from './helpers/review-dom.mjs';

// Exercise the actual HR module; replace only its browser-only Firebase
// document adapter. No test connects to Firebase or changes a real record.
const sourceURL=new URL('../takodeal-manager/hr-review-ui.js',import.meta.url);
const source=readFileSync(sourceURL,'utf8').replace(/import \{createStaffDocumentFirebase\} from '\.\/staff-document-firebase.js';/,"const createStaffDocumentFirebase=async()=>{throw Error('Synthetic document adapter unavailable');};").replace(/from '(\.\/[^']+)'/g,(_,path)=>"from '"+new URL(path,sourceURL).href+"'");
const {resolveHRPayrollContext,heldPayrollReviewHTML,installHRReviewCenter}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const selection={staffId:'sample-staff',staffName:'Sample Crew',branch:'Sample Branch',from:'2026-10-16',to:'2026-10-31'};
const hold={name:selection.staffName,staffId:selection.staffId,branch:selection.branch,start:selection.from,end:selection.to,attendanceReviewRequired:true,payrollReviewReasons:['A saved original Time In needs review.'],attendanceLogIds:['actual-out'],attendanceIssues:[{id:'actual-out',timeInLogId:'missing-original',type:'TIME OUT',timestamp:new Date('2026-10-28T03:00:00+08:00'),reason:'The exact source could not be confirmed.'}],recordedHours:87.25};
function fixture(rows=[hold],ready=true){let checks=0;return {api:{globalPayrollCache:Object.fromEntries(rows.map((row,index)=>[String(index),row])),getPayrollPreviewGuard:()=>({requireReady(){checks++;if(!ready)throw Error('Synthetic stale preview');}})},get checks(){return checks;}};}

test('HR can recover the exact held employee and cutoff from one ready payroll preview',()=>{
 const f=fixture(),result=resolveHRPayrollContext(f.api,selection);
 assert.equal(f.checks,1);assert.deepEqual(result,{...selection,payrollReviewReasons:hold.payrollReviewReasons,attendanceLogIds:['actual-out'],attendanceLogId:'actual-out',attendanceIssues:hold.attendanceIssues,recordedHours:87.25});
});
test('legacy cache profiles resolve by their stable staff ID and retain an explicit unknown hours value',()=>{
 const {staffId,...saved}=hold,f=fixture([{...saved,profile:{staffId},recordedHours:null,totalHours:0}]),result=resolveHRPayrollContext(f.api,selection);
 assert.equal(result.recordedHours,null);assert.deepEqual(result.attendanceIssues,hold.attendanceIssues);
 const markup=heldPayrollReviewHTML({...saved,profile:{staffId},recordedHours:null,totalHours:0});assert.doesNotMatch(markup,/0\.00 recorded paired hrs/);
});
test('wrong employees, dates, paid snapshots, resolved rows and duplicate matches cannot provide another hold context',()=>{
 const variants=[{...hold,staffId:'other-staff'},{...hold,start:'2026-10-01'},{...hold,end:'2026-10-30'},{...hold,isPaid:true},{...hold,attendanceReviewRequired:false}];
 for(const row of variants){const f=fixture([row]);assert.deepEqual(resolveHRPayrollContext(f.api,selection),selection);assert.equal(f.checks,1);}
 assert.deepEqual(resolveHRPayrollContext(fixture([hold,{...hold}]).api,selection),selection);
});
test('a stale or unavailable preview guard never reuses cached review explanations or hours',()=>{
 const stale=fixture([hold],false);assert.deepEqual(resolveHRPayrollContext(stale.api,selection),selection);
 for(const guard of [undefined,()=>null,()=>{throw Error('Synthetic unavailable guard');}])assert.deepEqual(resolveHRPayrollContext({globalPayrollCache:{held:hold},getPayrollPreviewGuard:guard},selection),selection);
});
test('an exact explicit review context preserves its issue evidence while using the selected canonical identity',()=>{
 const provided={...selection,staffName:'Previous display name',branch:'Previous display branch',payrollReviewReasons:['Explicit reviewed context'],attendanceLogIds:['explicit-out'],attendanceIssues:hold.attendanceIssues,recordedHours:null,notes:'Retain this review note'},f=fixture([hold],false),before=structuredClone(provided);
 const result=resolveHRPayrollContext(f.api,selection,provided);
 assert.equal(f.checks,0);assert.equal(result.staffName,selection.staffName);assert.equal(result.branch,selection.branch);assert.deepEqual(result.payrollReviewReasons,provided.payrollReviewReasons);assert.equal(result.recordedHours,null);assert.equal(result.notes,provided.notes);assert.deepEqual(provided,before);
});
test('explicit context from another employee or cutoff is discarded and only an exact fresh cache may replace it',()=>{
 for(const change of [{staffId:'someone-else'},{from:'2026-10-01'},{to:'2026-10-15'}]){
  const supplied={...selection,...change,payrollReviewReasons:['Must not leak'],attendanceLogIds:['wrong-person-out'],recordedHours:999};
  const fresh=resolveHRPayrollContext(fixture().api,selection,supplied);assert.deepEqual(fresh.payrollReviewReasons,hold.payrollReviewReasons);assert.equal(fresh.recordedHours,87.25);assert.deepEqual(fresh.attendanceLogIds,['actual-out']);
  assert.deepEqual(resolveHRPayrollContext(fixture([],false).api,selection,supplied),selection);
 }
});

async function view(context){
 const h=await amendmentFixture(),document=new ReviewDocument(),notifications=[];
 Object.assign(h.api,{loadPayrollScheduleHistory:async()=>h.history,ManagerUI:{notify:message=>notifications.push(message)},getPayrollPreviewGuard:()=>({requireReady(){}}),globalPayrollCache:{}});
 const ui=installHRReviewCenter(h.api,document,{readAttendance:async()=>[h.withId(),{...structuredClone(h.get('attendance_logs/sample-out')),id:'sample-out'}],readDocuments:async()=>({})});
 const before=structuredClone([...h.docs]);await ui.open({...selection,...context});return {...h,document,ui,notifications,before,content:document.getElementById('hrRecoveryContent')};
}
test('the actual HR hold card omits unknown hours instead of converting null to zero',async()=>{
 const f=await view({recordedHours:null,payrollReviewReasons:['Unknown combined identity hours.']});assert.doesNotMatch(f.content.textContent,/Recorded hours in the payroll preview/);assert.match(f.content.textContent,/Unknown combined identity hours/);assert.deepEqual([...f.docs],f.before);
});
test('the actual HR card shows exact issue dates and source IDs with every hostile value escaped',async()=>{
 const hostile='"\'><img src=x onerror=alert(1)><script>bad()</script>',issue={...hold.attendanceIssues[0],id:hostile,timeInLogId:hostile,type:hostile,reason:hostile};
 const f=await view({recordedHours:87.25,payrollReviewReasons:[hostile],attendanceLogIds:[hostile],attendanceIssues:[issue]});
 assert.match(f.content.textContent,/87\.25 hours/);assert.match(f.content.textContent,/Exact records requiring review/);assert.match(f.content.textContent,/Oct 28, 2026/);assert.match(f.content.textContent,/Linked Time In:/);assert.equal(f.content.querySelector('img'),null);assert.equal(f.content.querySelector('script'),null);assert.match(f.content.innerHTML,/&lt;img/);assert.match(f.content.innerHTML,/&quot;/);assert.deepEqual([...f.docs],f.before);
 const document=new ReviewDocument(),container=document.createElement('div');container.innerHTML=heldPayrollReviewHTML({staffId:hostile,name:hostile,branch:hostile,start:selection.from,end:selection.to,recordedHours:null,attendanceLogIds:[hostile],attendanceIssues:[issue]});assert.equal(container.querySelector('img'),null);assert.equal(container.querySelector('script'),null);assert.match(container.innerHTML,/&lt;img/);
});
test('a missing Time Out opens the exact source and work branch with its selected payroll cutoff',async()=>{
 const h=await amendmentFixture(),document=new ReviewDocument(),opened=[];
 Object.assign(h.api,{loadPayrollScheduleHistory:async()=>h.history,openOwnerTimeOutCorrection:async context=>opened.push(context),ManagerUI:{notify(){}}});
 const ui=installHRReviewCenter(h.api,document,{readAttendance:async()=>[h.withId()],readDocuments:async()=>({})}),before=structuredClone([...h.docs]);
 await ui.open({...selection,staffId:h.staffId,staffName:h.name,branch:h.branch});
 const action=document.querySelector('dialog').querySelector('[data-correct-timeout]');assert.ok(action);action.click();
 assert.deepEqual(opened,[{attendanceLogId:h.attendanceId,staffId:h.staffId,staffName:h.name,branch:h.branch,cutoffStart:selection.from,cutoffEnd:selection.to}]);
 assert.equal(document.querySelector('dialog').open,false);assert.deepEqual([...h.docs],before);
});
