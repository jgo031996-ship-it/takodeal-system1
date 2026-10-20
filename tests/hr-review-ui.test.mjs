import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';
import {ReviewDocument,drain,deferred} from './helpers/review-dom.mjs';
import {metadataFetch} from './helpers/attendance-metadata-fixture.mjs';
import {confirmAttendanceAmendmentReview} from '../takodeal-manager/attendance-amendment-review.js';

// Execute the production UI unchanged, replacing only its browser Firebase SDK
// document adapter. All test reads are fictional/in-memory; no live records.
const sourceURL=new URL('../takodeal-manager/hr-review-ui.js',import.meta.url);
const source=readFileSync(sourceURL,'utf8').replace(/import \{createStaffDocumentFirebase\} from '\.\/staff-document-firebase.js';/,"const createStaffDocumentFirebase=async()=>{throw Error('Synthetic document adapter unavailable');};").replace(/from '(\.\/[^']+)'/g,(_,path)=>"from '"+new URL(path,sourceURL).href+"'");
const {installHRReviewCenter,heldPayrollReviewHTML}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const find=(f,id)=>f.document.getElementById(id),node=(f,attr)=>f.document.querySelector('[data-'+attr+']');
async function fixture(options={}){
 const h=await amendmentFixture({name:options.name||'Sample Crew'}),document=new ReviewDocument(),calls={confirm:[],onboarding:[],schedule:[],profile:[],notify:[],invalidated:[],reads:0};h.api.auth.currentUser.getIdToken=async()=> 'SYNTHETIC_FIREBASE_TOKEN';
 Object.assign(h.api,{loadPayrollScheduleHistory:async()=>h.history,openScheduleRecovery:value=>calls.schedule.push(value),openEmployeeProfile:id=>calls.profile.push(id),ManagerUI:{notify:message=>calls.notify.push(message),confirm:options.confirm||(async()=>false)},getPayrollPreviewGuard:()=>({invalidate:reason=>calls.invalidated.push(reason)})});
 const dependencies={readAttendance:async()=>{calls.reads++;return [h.withId(),{...structuredClone(h.get('attendance_logs/sample-out')),id:'sample-out'}];},readDocuments:async()=>({}),confirmReview:async(api,input)=>{calls.confirm.push(input);return options.confirmReview?options.confirmReview(api,input):confirmAttendanceAmendmentReview(api,input);},saveOnboarding:async(api,input)=>{calls.onboarding.push(input);return options.saveOnboarding?.(api,input);},...options.dependencies};
 const ui=installHRReviewCenter(h.api,document,dependencies),context={staffId:h.staffId,staffName:h.name,branch:h.branch,workDate:'2026-10-16',attendanceLogId:h.attendanceId};return {...h,document,calls,ui,context,open:()=>ui.open(context)};
}

test('opening the linked HR center shows the exact source record and both saved/corrected minutes without any implicit write',async()=>{
 const f=await fixture(),before=structuredClone([...f.docs]);await f.open();assert.equal(f.document.querySelector('dialog').open,true);assert.equal(find(f,'hrRecoveryStaff').value,f.staffId);assert.equal(find(f,'hrRecoveryFrom').value,'2026-10-16');assert.match(find(f,'hrRecoveryContent').textContent,/35 minutes.*0 minutes/);assert.match(find(f,'hrRecoveryContent').textContent,/sample-in/);assert.match(find(f,'hrRecoveryContent').textContent,/Time In \/ Time Out records/);assert.deepEqual([...f.docs],before);assert.deepEqual(f.calls.confirm,[]);assert.deepEqual(f.calls.onboarding,[]);
 node(f,'schedule').click();assert.deepEqual(f.calls.schedule,[{staffId:f.staffId,staffName:f.name,branch:f.branch,workDate:'2026-10-16'}]);find(f,'hrRecoveryProfile').click();assert.deepEqual(f.calls.profile,[f.staffId]);assert.equal(f.document.querySelector('dialog').open,false);
});

test('staff-provided names, branches and the held-record link cannot create markup or script attributes',async()=>{
 const name='Sample <img src=x onerror="alert(1)">',f=await fixture({name});await f.open();assert.equal(f.document.body.querySelector('img'),null);assert.match(find(f,'hrRecoveryStaff').textContent,/<img/);assert.match(find(f,'hrRecoveryStaff').innerHTML,/&lt;img/);
 const link=heldPayrollReviewHTML({staffId:'sample-staff',name:'"\'><img src=x onerror=alert(1)>',branch:'<script>alert(1)</script>',start:'2026-10-16',attendanceLogIds:['sample-in']});const container=f.document.createElement('div');container.innerHTML=link;assert.equal(container.querySelector('img'),null);assert.equal(container.querySelector('script'),null);assert.match(link,/&lt;img/);assert.match(link,/&quot;/);
});

test('a non-Owner or locked/foreign session cannot open HR records or execute an action',async()=>{
 for(const change of [f=>{f.api.sessionUser.isOwner=false;},f=>{f.api.auth.currentUser.emailVerified=false;},f=>{f.api.sessionUser.uid='other';},f=>{f.api.sessionUser.isFranchisee=true;}]){const f=await fixture();change(f);const before=structuredClone([...f.docs]);await f.open();assert.equal(f.document.querySelector('dialog'),null);assert.equal(f.calls.reads,0);assert.match(f.calls.notify[0],/Owner/);assert.deepEqual([...f.docs],before);}
});

test('the real review action requires a reason and explicit choice, then updates only the paired audit/marker and invalidates unpaid preview',async()=>{
 const f=await fixture();await f.open();node(f,'review').click();await drain();assert.equal(f.calls.confirm.length,0);assert.match(find(f,'hrRecoveryStatus').textContent,/8 characters/);node(f,'reason').value='Reviewed the original punch and corrected dated assignment.';node(f,'choice').value='Use corrected schedule minutes';node(f,'review').click();await drain();assert.equal(f.calls.confirm.length,1);assert.equal(f.calls.confirm[0].attendanceId,f.attendanceId);assert.equal(f.calls.confirm[0].expectedRevision,0);assert.equal(f.get('attendance_logs/'+f.attendanceId).scheduleAmendmentReview.choice,'Use corrected schedule minutes');assert.equal(f.get('attendance_logs/'+f.attendanceId).reviewedLateMinutes,35);assert.equal(f.get('payroll_records/sample-paid').frozenData.netPay,4500);assert.equal(f.calls.invalidated.length,1);assert.equal(node(f,'review'),null);assert.match(find(f,'hrRecoveryStatus').textContent,/saved/);
});

test('declining employment-start or contract preparation never writes onboarding, attendance or payroll',async()=>{
 const f=await fixture();await f.open();find(f,'hrRecoveryStart').value='2026-10-16';find(f,'hrRecoveryStartReason').value='Verified first workday with original employment record.';const before=structuredClone([...f.docs]);node(f,'onboarding').click();await drain();assert.equal(f.calls.onboarding.length,0);assert.deepEqual([...f.docs],before);assert.equal(f.calls.confirm.length,0);
});

test('a superseded employee load or closed dialog cannot publish late records into a new review',async()=>{
 const slow=deferred(),f=await fixture({dependencies:{readAttendance:()=>slow.promise}}),opening=f.open();await drain();const dialog=f.document.querySelector('dialog');dialog.close();slow.resolve([f.withId()]);await opening;assert.equal(dialog.open,false);assert.equal(find(f,'hrRecoveryContent').textContent,'');assert.equal(f.calls.confirm.length,0);
});

test('HQ access changes while data is loading cannot expose a stale employee review',async()=>{
 const slow=deferred(),f=await fixture({dependencies:{readAttendance:()=>slow.promise}}),opening=f.open();await drain();f.api.auth.currentUser.uid='different-owner';slow.resolve([f.withId()]);await opening;assert.equal(find(f,'hrRecoveryContent').textContent,'');assert.equal(node(f,'review'),null);assert.equal(f.calls.confirm.length,0);
});

test('a failed protected save preserves the review reason and never reports that it was saved',async()=>{
 const f=await fixture({confirmReview:async()=>{throw Error('Synthetic protected save rejected.');}});await f.open();node(f,'reason').value='Original explanation remains available after failure.';node(f,'review').click();await drain();assert.equal(f.calls.confirm.length,1);assert.equal(node(f,'reason').value,'Original explanation remains available after failure.');assert.match(find(f,'hrRecoveryStatus').textContent,/rejected/);assert.equal(f.calls.invalidated.length,0);assert.equal(f.get('attendance_logs/'+f.attendanceId).scheduleAmendmentReview,undefined);
});

test('the configured default HR read uses projected metadata and does not download historical photos',async()=>{
 const f=await fixture({dependencies:{readAttendance:undefined}}),queries=[];f.api.deviceFleetConnection={projectId:'sample-project',apiKey:'sample-public-key'};f.api.fetch=metadataFetch(f.docs,request=>queries.push(request));const sdk=f.api.getDocsFromServer;f.api.getDocsFromServer=async query=>{if(query.table==='attendance_logs')throw Error('Heavy photo SDK path must not run.');return sdk(query);};f.get('attendance_logs/'+f.attendanceId).photoBase64='data:image/jpeg;base64,'+'x'.repeat(500000);await f.open();assert.equal(queries.length,2);assert.ok(queries.every(x=>x.query.select.fields.every(field=>field.fieldPath!=='photoBase64')));assert.match(find(f,'hrRecoveryContent').textContent,/sample-in/);assert.equal(f.calls.confirm.length,0);
});

test('an account change while the employment confirmation is open cannot save with the new context',async()=>{
 const confirmation=deferred(),f=await fixture({confirm:()=>confirmation.promise});await f.open();find(f,'hrRecoveryStart').value='2026-10-16';find(f,'hrRecoveryStartReason').value='Reviewed original employment start and staff identity.';node(f,'onboarding').click();await drain();f.api.auth.currentUser.uid='different-owner';confirmation.resolve(true);await drain();assert.equal(f.calls.onboarding.length,0);assert.equal(f.calls.confirm.length,0);
});

test('an explicit missing employee ID cannot fall back to a matching name or retain a previous employee action',async()=>{
 for(const reopen of [false,true]){const f=await fixture();if(reopen)await f.open();const beforeReads=f.calls.reads,before=structuredClone([...f.docs]);await f.ui.open({...f.context,staffId:'missing-employee'});assert.match(find(f,'hrRecoveryStatus').textContent,/affected employee is unavailable/);assert.equal(f.calls.reads,beforeReads);assert.equal(node(f,'review'),null);assert.equal(find(f,'hrRecoveryContent').textContent,'');find(f,'hrRecoveryProfile').click();assert.deepEqual(f.calls.profile,[]);assert.deepEqual([...f.docs],before);assert.equal(f.calls.confirm.length,0);}
});

for(const rejected of [false,true])test('an account change before a dated-review '+(rejected?'failure':'success')+' returns cannot reload or expose another account’s result',async()=>{
 const pending=deferred(),f=await fixture({confirmReview:()=>pending.promise});await f.open();node(f,'reason').value='Verified the original dated attendance and saved decision.';node(f,'review').click();await drain();assert.equal(f.calls.confirm.length,1);node(f,'review').click();assert.equal(f.calls.confirm.length,1);assert.equal(f.document.querySelector('dialog').emit('cancel').defaultPrevented,true);f.api.auth.currentUser.uid='different-owner';if(rejected)pending.reject(Error('Synthetic protected failure must not appear in a different account.'));else pending.resolve({attendanceId:f.attendanceId,revision:1});await drain();assert.equal(f.document.querySelector('dialog').open,false);assert.equal(f.calls.reads,1);assert.deepEqual(f.calls.invalidated,[]);assert.equal(find(f,'hrRecoveryContent').textContent,'');assert.doesNotMatch(find(f,'hrRecoveryStatus').textContent,/review saved|Synthetic protected failure/);assert.equal(f.get('attendance_logs/'+f.attendanceId).scheduleAmendmentReview,undefined);
});

for(const rejected of [false,true])test('an account change before an employment-date '+(rejected?'failure':'success')+' returns suppresses refresh and personal result',async()=>{
 const pending=deferred(),f=await fixture({confirm:async()=>true,saveOnboarding:()=>pending.promise});await f.open();find(f,'hrRecoveryStart').value='2026-10-16';find(f,'hrRecoveryStartReason').value='Confirmed the actual start against original work and hiring records.';node(f,'onboarding').click();await drain();assert.equal(f.calls.onboarding.length,1);f.api.auth.currentUser.uid='different-owner';if(rejected)pending.reject(Error('Synthetic private employment save failure.'));else pending.resolve({alreadySaved:false});await drain();assert.equal(f.document.querySelector('dialog').open,false);assert.equal(f.calls.reads,1);assert.equal(find(f,'hrRecoveryContent').textContent,'');assert.doesNotMatch(find(f,'hrRecoveryStatus').textContent,/confirmed\. One-week|Synthetic private|Initial contract prepared/);assert.equal(f.calls.confirm.length,0);
});
