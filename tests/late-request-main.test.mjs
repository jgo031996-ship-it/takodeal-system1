import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import * as summary from '../takodeal-manager/late-request-summary.js';
import {scheduleDateKey} from '../takodeal-manager/schedule-history.js';
import {confirmAttendanceAmendmentReview} from '../takodeal-manager/attendance-amendment-review.js';
import * as lateResolution from '../takodeal-manager/late-request-resolution.js';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';

const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function actual(name){const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,name+' must exist');return source.slice(start+1,end+3);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const {resolveCorrectedLateRequest,lateRequestResolutionFingerprint}=lateResolution;

async function fixture({mode='zero',action='Approved',zeroService,legacyService,shiftOverride}={}){
    const f=await amendmentFixture(),requestId='sample-letter';
    const request={type:'Reason Letter',status:'Pending',staffId:f.staffId,staffName:f.name,branch:f.branch,
        attendanceLogId:f.attendanceId,lateMinutes:462,timestamp:f.withId().timestamp,
        explanationCause:'Tardiness / Late Arrival',explanationMessage:'Clocked in 462 minutes late. Reason: Please review the dated shift.'};
    f.put('staff_requests/'+requestId,request);
    if(mode==='zero'||mode==='positive')await confirmAttendanceAmendmentReview(f.api,f.input(mode==='positive'?{choice:'Keep saved lateness decision'}:{}));
    const correctionSettings=structuredClone([...f.docs].filter(([path])=>path.startsWith('settings/')));
    const restoreCorrection=()=>{for(const [path,data]of correctionSettings)f.put(path,structuredClone(data));};
    if(mode==='legacy'){
        const original=f.get('settings/schedule_revision_original');
        f.put('settings/global_schedule',{...structuredClone(original.snapshot),scheduleRevisionId:'original',scheduleEffectiveFrom:'2026-10-01',payrollHistoryEnforcedFrom:'2026-10-01'});
        f.put('settings/schedule_month_2026_10',{schemaVersion:1,kind:'schedule-month',month:'2026-10',revisionIds:['original'],latestRevisionId:'original',updatedAt:original.savedAt,payrollHistoryEnforcedFrom:'2026-10-01'});
        f.put('settings/schedule_shift_amendments_2026_10',{month:'2026-10',shiftAmendments:[]});
    }
    const nodes=new Map(),alerts=[],calls={zero:[],legacy:[],inbox:0,recovery:[]},forms=[];
    const makeNode=id=>{
        let html='',text='';const node={id,value:'',innerText:'',disabled:false,files:[],style:{},removed:false,
            remove(){this.removed=true;if(nodes.get(id)===this){nodes.delete(id);if(id==='dynamicReplyModal')for(const child of ['replyMessage','replyAttendanceLog','replyLateCalculation','replyProofImage','btnSubmitReply'])nodes.delete(child);}}};
        Object.defineProperties(node,{innerHTML:{get:()=>html,set:value=>{html=String(value);text='';}},textContent:{get:()=>text,set:value=>{text=String(value);html='';}}});nodes.set(id,node);return node;
    };
    const mount=html=>{
        forms.push(html);for(const match of html.matchAll(/\bid="([^"]+)"/g))makeNode(match[1]);
        const select=/<select id="replyAttendanceLog"[\s\S]*?<\/select>/.exec(html)?.[0],first=select&&/<option value="([^"]*)"/.exec(select)?.[1];
        if(nodes.has('replyAttendanceLog'))nodes.get('replyAttendanceLog').value=first||'';
    };
    const document={getElementById:id=>nodes.get(id)||null,body:{insertAdjacentHTML:(_where,html)=>mount(html)}};
    const api=Object.assign(f.api,{isBranchAllowed:branch=>branch===f.branch,
        loadPayrollScheduleHistory:async()=>mode==='legacy'?{}:f.history,
        loadInbox:async()=>{calls.inbox++;},ManagerUI:{notify:message=>alerts.push(['notice',message])},
        openAttendanceRecovery:context=>calls.recovery.push(context)});
    const context=vm.createContext({...payroll,...summary,scheduleDateKey,lateRequestResolutionFingerprint,
        resolveAttendanceShift:(...args)=>{const actual=payroll.resolveAttendanceShift(...args);return shiftOverride?shiftOverride(actual):actual;},
        resolveCorrectedLateRequest:async(...args)=>{calls.zero.push(args[1]);return zeroService?zeroService(...args):resolveCorrectedLateRequest(...args);},
        reviewLateRequest:()=>assert.fail('Actual main must use the fresh dated-evidence legacy wrapper'),
        reviewOriginalLateRequest:async(...args)=>{calls.legacy.push(args[1]);return legacyService?legacyService(...args):lateResolution.reviewOriginalLateRequest(...args);},
        tkOwnerDoc:reference=>api.getDocFromServer(reference),tkOwnerDocs:reference=>api.getDocsFromServer(reference),
        window:api,document,Swal:{fire:async(...args)=>{alerts.push(args);return {};},showLoading(){}},Date,console:{error(){}}});
    const escapeStart=source.indexOf('const requestEscape = '),escapeEnd=source.indexOf('\nwindow.updateLateRequestPreview',escapeStart);vm.runInContext(source.slice(escapeStart,escapeEnd),context);
    for(const name of ['updateLateRequestPreview','openLateRequestAttendance','handleRequest','submitCurrentRequestReply','submitRequestReply'])vm.runInContext(actual(name),context);
    const open=()=>api.handleRequest(requestId,action,request.type,0,f.name);
    const submit=(decision=action)=>api.submitRequestReply(requestId,decision,request.type,0,f.name);
    return {...f,w:api,context,document,nodes,node:id=>nodes.get(id),calls,alerts,forms,requestId,request,open,submit,mount,restoreCorrection};
}

test('actual preview labels the original462 separately and selects only the verified zero service',async()=>{
    const f=await fixture(),before=structuredClone([...f.docs]);await f.open();
    const html=f.node('replyLateCalculation').innerHTML;assert.match(html,/Original submission · 462 minutes reported/);assert.match(html,/Confirmed dated attendance review: 0 minutes late/);
    assert.equal(f.node('btnSubmitReply').disabled,false);assert.equal(f.node('btnSubmitReply').innerText,'Close reviewed zero-lateness letter');
    f.node('replyMessage').value='Verified the dated correction.';await f.w.submitCurrentRequestReply();
    assert.equal(f.calls.zero.length,1);assert.equal(f.calls.legacy.length,0);assert.equal(f.calls.zero[0].attendanceId,f.attendanceId);assert.ok(f.calls.zero[0].expectedFingerprint);
    assert.equal(f.get('staff_requests/'+f.requestId).lateMinutes,462);assert.equal(f.get('staff_requests/'+f.requestId).currentReviewedLateMinutes,0);
    assert.deepEqual([...f.docs].filter(([path])=>path!=='staff_requests/'+f.requestId),before.filter(([path])=>path!=='staff_requests/'+f.requestId));
    assert.equal(f.node('dynamicReplyModal'),undefined);assert.equal(f.calls.inbox,1);
});

for(const mode of ['positive','held'])test('actual '+mode+' dated preview disables confirmation and never invokes the legacy decision',async()=>{
    const f=await fixture({mode});await f.open();assert.equal(f.node('btnSubmitReply').disabled,true);assert.match(f.node('btnSubmitReply').innerText,/Review dated attendance first/);
    const before=structuredClone([...f.docs]);await f.submit();assert.equal(f.calls.zero.length,0);assert.equal(f.calls.legacy.length,0);assert.deepEqual([...f.docs],before);
    assert.equal(f.node('btnSubmitReply').disabled,true);assert.ok(f.node('dynamicReplyModal'));
});

test('resolver-held assignment reconciliation with unverified correction cannot fall through to a legacy decision',async()=>{
    const f=await fixture({mode:'held',shiftOverride:shift=>({...shift,attendanceCorrectionVerified:false,amendmentNeedsReview:true,needsScheduleReview:true,assignmentReconciliationRequired:true,scheduleSource:'shift-amendment-review'})});
    await f.open();assert.equal(f.node('btnSubmitReply').disabled,true);const before=structuredClone([...f.docs]);await f.submit();
    assert.equal(f.calls.legacy.length,0);assert.equal(f.calls.zero.length,0);assert.deepEqual([...f.docs],before);assert.equal(f.node('btnSubmitReply').disabled,true);
});

test('changing the selected clock-in without its matching preview prevents either service',async()=>{
    const f=await fixture();await f.open();const before=structuredClone([...f.docs]);f.node('replyAttendanceLog').value='another-in';await f.submit();
    assert.equal(f.calls.zero.length,0);assert.equal(f.calls.legacy.length,0);assert.deepEqual([...f.docs],before);assert.equal(f.node('btnSubmitReply').disabled,true);assert.match(f.node('replyLateCalculation').textContent,/Select the correct clock-in/);
});

test('changing the decision without reopening the preview cannot reuse its zero confirmation',async()=>{
    const f=await fixture();await f.open();await f.submit('Rejected');assert.equal(f.calls.zero.length,0);assert.equal(f.calls.legacy.length,0);assert.equal(f.get('staff_requests/'+f.requestId).status,'Pending');assert.ok(f.node('dynamicReplyModal'));
});

test('failed zero service keeps the exact preview and reply available without a legacy fallback',async()=>{
    const f=await fixture({zeroService:async()=>{throw Error('Synthetic zero-resolution failure');}});await f.open();
    const preview=f.w.lateRequestContext.selectedLatePreview,before=structuredClone([...f.docs]);f.node('replyMessage').value='Keep this reply for retry.';await f.submit();
    assert.equal(f.calls.zero.length,1);assert.equal(f.calls.legacy.length,0);assert.deepEqual([...f.docs],before);assert.ok(f.node('dynamicReplyModal'));
    assert.equal(f.node('replyMessage').value,'Keep this reply for retry.');assert.equal(f.w.lateRequestContext.selectedLatePreview.fingerprint,preview.fingerprint);assert.equal(f.node('btnSubmitReply').disabled,false);assert.equal(f.node('btnSubmitReply').innerText,'Close reviewed zero-lateness letter');
    assert.ok(f.alerts.some(args=>args[1]==='Synthetic zero-resolution failure'));
});

for(const action of ['Approved','Rejected'])test('ordinary legacy '+action+' still uses original reported minutes and the original service',async()=>{
    const f=await fixture({mode:'legacy',action});await f.open();const html=f.node('replyLateCalculation').innerHTML;
    assert.equal(f.node('btnSubmitReply').disabled,false);assert.match(html,/Review of the original reported minutes/);assert.match(html,/462 minutes reported/);assert.equal(f.w.lateRequestContext.selectedLatePreview.corrected,false);
    const paid=structuredClone(f.get('payroll_records/sample-paid'));await f.submit();assert.equal(f.calls.legacy.length,1);assert.equal(f.calls.zero.length,0);
    assert.equal(f.get('staff_requests/'+f.requestId).status,action);assert.equal(f.get('staff_requests/'+f.requestId).payrollReviewVersion,1);assert.equal(f.get('attendance_logs/'+f.attendanceId).reviewedLateMinutes,462);assert.equal(f.get('attendance_logs/'+f.attendanceId).lateExempted,action==='Approved');assert.deepEqual(f.get('payroll_records/sample-paid'),paid);
});

test('a generic legacy-unverified schedule is distinct from an actual held amendment',async()=>{
    const f=await fixture({mode:'legacy',shiftOverride:shift=>({...shift,needsScheduleReview:true,scheduleSource:'legacy-unverified'})});await f.open();assert.equal(f.node('btnSubmitReply').disabled,false);assert.equal(f.w.lateRequestContext.selectedLatePreview.corrected,false);
});

test('a real dated correction arriving after legacy preview blocks the stale original-minute decision',async()=>{
    const f=await fixture({mode:'legacy',action:'Rejected'});await f.open();assert.equal(f.w.lateRequestContext.selectedLatePreview.corrected,false);
    f.restoreCorrection();const before=structuredClone([...f.docs]);await f.submit();
    assert.equal(f.calls.legacy.length,1);assert.equal(f.calls.legacy[0].profileId,f.staffId);assert.equal(f.calls.zero.length,0);assert.deepEqual([...f.docs],before);
    assert.equal(f.get('staff_requests/'+f.requestId).status,'Pending');assert.ok(f.node('dynamicReplyModal'));assert.ok(f.alerts.some(args=>/dated|correction|review/i.test(String(args[1]))));
});

test('a correction arriving before legacy transaction commit forces retry and prevents staged stale writes',async()=>{
    const f=await fixture({mode:'legacy',action:'Rejected'});await f.open();const originalRun=f.w.runTransaction;let restored=false,afterCorrection;
    f.w.runTransaction=(db,callback)=>originalRun(db,async tx=>{const result=await callback(tx);if(!restored){restored=true;f.restoreCorrection();afterCorrection=structuredClone([...f.docs]);}return result;});
    await f.submit();assert.equal(restored,true);assert.ok(f.retries()>0);assert.equal(f.calls.legacy.length,1);assert.equal(f.calls.zero.length,0);
    assert.deepEqual([...f.docs],afterCorrection);assert.equal(f.get('staff_requests/'+f.requestId).status,'Pending');assert.ok(f.node('dynamicReplyModal'));
});

test('linked attendance navigation uses the selected exact record and closes only the original letter form',async()=>{
    const f=await fixture();await f.open();f.w.openLateRequestAttendance();assert.equal(f.calls.recovery.length,1);assert.equal(f.calls.recovery[0].attendanceLogId,f.attendanceId);assert.equal(f.calls.recovery[0].staffId,f.staffId);assert.equal(f.w.lateRequestContext,null);assert.equal(f.node('dynamicReplyModal'),undefined);
});

for(const failure of [false,true])test('a late '+(failure?'failed':'successful')+' zero-service completion cannot close a replacement letter modal',async()=>{
    const held=deferred(),entered=deferred(),f=await fixture({zeroService:async()=>{entered.resolve();await held.promise;if(failure)throw Error('Old form failure');return {resolved:true};}});await f.open();const pending=f.submit();await entered.promise;
    f.node('dynamicReplyModal').remove();f.mount('<div id="dynamicReplyModal"><textarea id="replyMessage"></textarea><select id="replyAttendanceLog"><option value="other-in">Other</option></select><div id="replyLateCalculation"></div><button id="btnSubmitReply"></button></div>');
    const replacement={requestId:'other-letter',action:'Approved',request:{},logs:[]};f.w.lateRequestContext=replacement;const modal=f.node('dynamicReplyModal'),before=f.alerts.length;held.resolve();await pending;await tick();
    assert.equal(f.node('dynamicReplyModal'),modal);assert.equal(f.w.lateRequestContext,replacement);assert.equal(f.calls.inbox,0);assert.equal(f.alerts.length,before);
});

test('account replacement while zero service is pending suppresses its old-form completion',async()=>{
    const held=deferred(),entered=deferred(),f=await fixture({zeroService:async()=>{entered.resolve();await held.promise;return {resolved:true};}});await f.open();const pending=f.submit();await entered.promise;const modal=f.node('dynamicReplyModal');f.w.auth.currentUser={...f.w.auth.currentUser,uid:'different-owner'};const before=f.alerts.length;held.resolve();await pending;
    assert.equal(f.node('dynamicReplyModal'),modal);assert.equal(f.calls.inbox,0);assert.equal(f.alerts.length,before);
});
