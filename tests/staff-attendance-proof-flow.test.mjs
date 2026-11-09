import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import * as reconciliation from '../takodeal-staff/attendance-reconcile.js';
import * as savedShiftProposals from '../takodeal-staff/saved-shift-proposal.js';
import {chooseClockInSchedule} from '../takodeal-staff/attendance-shift-declaration-ui.js';
import * as scheduleDeclarations from '../takodeal-staff/attendance-shift-declaration.js';
import {createScheduleHistoryStore,createScheduleRevision} from '../takodeal-staff/schedule-history.js';
import {prepareEarlyTimeOut} from '../takodeal-staff/early-time-out-ui.js';
import {createEarlyTimeOutService} from '../takodeal-staff/early-time-out-actions.js';
import {renderAttendanceSchedulePreview,assertAttendanceScheduleUnchanged,emergencyReliefForClockIn,emergencyReliefTimeOutNotice} from '../takodeal-staff/attendance-schedule-preview.js';
import {createLocationSession} from '../takodeal-staff/staff-location.js';
import {createClockUploadAccess} from '../takodeal-staff/clock-upload-access.js';
import {createStaffSetupAuthority} from '../takodeal-staff/staff-setup-access.js';

const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
const start=source.indexOf('window.punchTime = async function');
const end=source.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',start);
assert.ok(start>=0 && end>start,'Exercise the real Staff attendance handler.');
const handler=source.slice(start,end);
const profile={cashierName:'Synthetic Staff',scheduleNickname:'Synthetic',branch:'Maa',hourlyRate:50};
const clock='2026-10-06T09:15:00+08:00';
const screenshot={name:'synthetic-proof.png',type:'image/png',size:1024};
const proofUrl='https://example.invalid/synthetic-late-proof.jpg';
const clone=value=>value===undefined?undefined:structuredClone(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
async function waitFor(predicate,label){for(let attempt=0;attempt<50;attempt++){if(predicate())return;await tick();}assert.ok(predicate(),label);}

function harness({late=true}={}) {
    let clockMs=Date.parse(clock),sequence=0;
    const schedule={currentYear:2026,currentMonth:10,branchConfig:{Maa:[{id:'slot',name:'Saved shift',startTime:'09:00',endTime:'18:00',active:true,days:[0,1,2,3,4,5,6]}]},
        currentSchedule:{6:{Maa:{scheduled:{slot:'Synthetic'},rest:[],unavailable:[],swaps:{}}}},employees:[],holidays:{},unavailability:{}};
    const records=new Map([['cashiers/staff-id',profile],...(late?[['settings/global_schedule',schedule]]:[])]);
    const writes=[],batches=[],transactions=[],events=[],nodes=new Map(),alerts=[],uploadCalls=[];
    const storage=new Map([['takodeal_staff_id','staff-id'],['takodeal_staff_name',profile.cashierName],['takodeal_device_id','synthetic-device']]);
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],style:{},disabled:false,textContent:'',innerText:'',dataset:{}});return nodes.get(id);};
    const pathOf=value=>typeof value==='string'?value:value.path;
    const reference=path=>({path,id:path.split('/').at(-1)});
    const snapshot=value=>{const path=pathOf(value);return {id:path.split('/').at(-1),ref:reference(path),exists:()=>records.has(path),data:()=>clone(records.get(path))};};
    const api={db:{},collection:(_db,path)=>path,doc:(parent,table,id)=>reference(id===undefined?`${parent}/auto-${++sequence}`:`${table}/${id}`),
        query:(path,...filters)=>({path,filters}),where:(...filter)=>filter,
        getDoc:async path=>snapshot(path),getDocFromServer:async path=>snapshot(path),
        getDocs:async q=>{const docs=[...records].filter(([path,row])=>path.startsWith(q.path+'/') && (q.filters||[]).every(([key,op,value])=>op!=='=='||row[key]===value)).map(([path])=>snapshot(path));return {docs,empty:!docs.length,forEach:fn=>docs.forEach(fn)};},
        serverTimestamp:()=>new Date(clockMs),
        writeBatch:()=>{const changes=[];return {set:(ref,data)=>changes.push([pathOf(ref),clone(data)]),async commit(){events.push('commit:start');if(h.beforeCommit)await h.beforeCommit();batches.push(changes.map(([path,data])=>({path,data})));for(const [path,data]of changes){records.set(path,data);writes.push(path);}events.push('commit:done');}};},
        runTransaction:async(_db,fn)=>{const changes=[];const result=await fn({get:async ref=>snapshot(ref),set:(ref,data)=>changes.push([pathOf(ref),clone(data)]),update:(ref,data)=>changes.push([pathOf(ref),{...clone(records.get(pathOf(ref))),...clone(data)}])});transactions.push(changes);for(const [path,data]of changes){records.set(path,data);writes.push(path);}return result;}};
    api.getDocsFromServer=api.getDocs;
    const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
    const h={records,writes,batches,transactions,events,nodes,node,alerts,uploadCalls,localStorage,lateForm:{reason:'Delayed public transport; synthetic test only.',file:screenshot},cancelDialog:false};
    const window={...api,auth:{currentUser:{uid:'synthetic-auth'}},
        async getAttendanceLocation(){events.push('gps');if(h.location) return h.location();return {branch:'Maa',distance:2,accuracy:10,lat:7,lng:125,timestamp:clockMs};},
        async checkActiveSanctions(_name,options){events.push('sanctions');assert.equal(options.requireFresh,true);return h.blocked===true;},
        async verifyAttendanceFace(){events.push('camera');if(h.camera)return h.camera();return {photoBase64:'data:image/jpeg;base64,c3ludGhldGlj',faceCheck:{policyVersion:'attendance-photo-v2',capturedAt:new Date(clockMs).toISOString()}};},
        assertAttendanceFaceFresh(result){events.push('fresh');if(h.fresh)h.fresh(result);},
        captureOptionalAttendancePhoto:()=>'',loadMyAttendance:()=>events.push('refresh'),
        async authorizeAttendanceUpload({staffId,attendanceId,assertCurrent}){assertCurrent();return{path:`staff_requests/synthetic-auth/${staffId}/late_${attendanceId}.jpg`,metadata:{contentType:'image/jpeg',customMetadata:{staffUploadUid:'synthetic-auth',staffId}},assertCurrent};},
        async uploadAttendanceProof(request){events.push('proof:start');uploadCalls.push(request);request.assertCurrent();const result=h.upload?await h.upload(request):{url:proofUrl};events.push('proof:done');return result;}};
    class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clockMs]));}static now(){return clockMs;}}
    const Swal={async fire(...args){alerts.push(args);const options=args[0];if(options?.title==='Review your assigned hours'){events.push('schedule:preview');return {isConfirmed:h.cancelPreview!==true,value:h.swapChoice?'swap':'assigned'};}if(options?.title==='Declare an unrequested shift swap'){options.didOpen?.();node('attendanceSwapCoworker').value=h.swapChoice.coworker;node('attendanceSwapCoworker').onchange();node('attendanceSwapShift').value=h.swapChoice.key;node('attendanceSwapExplanation').value='We agreed to cover the saved later shift; please check this declaration with HQ.';const value=options.preConfirm();return {isConfirmed:!!value,value};}if(options?.title?.includes('You are Late')){
            if(h.cancelDialog)return {isConfirmed:false};
            options.didOpen?.();
            if(h.lateForm.reason!==null)node('lateReason').value=h.lateForm.reason;
            node('lateProof').files=h.lateForm.file?[h.lateForm.file]:[];
            const value=options.preConfirm?options.preConfirm():h.lateForm;
            return value?{isConfirmed:true,value}:{isConfirmed:false};
        }return {isConfirmed:true};},close(){},showLoading(){},showValidationMessage(message){events.push('validation');alerts.push(['Validation',message]);}};
    const document={hidden:false,getElementById:node,querySelector:()=>null,querySelectorAll:()=>[]};
    node('view-timeclock').classList={contains:value=>value==='active'};
    vm.runInNewContext(handler,{...api,...payroll,...reconciliation,...savedShiftProposals,...scheduleDeclarations,chooseClockInSchedule,renderAttendanceSchedulePreview,assertAttendanceScheduleUnchanged,emergencyReliefForClockIn,emergencyReliefTimeOutNotice,createScheduleHistoryStore,prepareEarlyTimeOut:(api,input)=>prepareEarlyTimeOut(api,input,{service:createEarlyTimeOutService(api,{now:()=>new Date(clockMs)})}),window,auth:window.auth,localStorage,document,Swal,Date:ClockDate,console:{error(){},warn(){},log(){}}});
    return Object.assign(h,{window,punch:type=>window.punchTime(type),advance:milliseconds=>{clockMs+=milliseconds;}});
}

function assertNoAttendance(h) {
    assert.equal(h.writes.length,0);
    assert.equal(h.batches.length,0);
    assert.equal(h.window.staffPunchBusy,false);
    assert.equal(h.node('btnTimeIn').disabled,false);
    assert.equal(h.node('btnTimeOut').disabled,false);
    assert.equal(h.events.includes('refresh'),false);
    assert.equal(h.alerts.some(args=>typeof args[0]==='string' && args[0].includes('Success')),false);
}

function activatedUpload(h){
 const deviceId='DEV-SYNTHETIC-PHONE';h.localStorage.setItem('takodeal_device_id',deviceId);const user=h.window.auth.currentUser;user.isAnonymous=true;user.getIdToken=async()=>{throw Error('No separate PIN login is needed');};h.window.auth.authStateReady=async()=>{};
 let status='Active';const setup=createStaffSetupAuthority({getUid:()=>h.window.auth.currentUser?.uid,transport:{ready:async()=>user,call:async()=>({enabled:false,mode:'protected',device:{staffId:'staff-id',staffName:profile.cashierName,branch:'Maa',deviceId,status}})}});
 h.window.authorizeAttendanceUpload=createClockUploadAccess({auth:h.window.auth,deviceId:()=>h.localStorage.getItem('takodeal_device_id'),authority:()=>setup,Swal:{fire(){throw Error('No second PIN or HQ prompt');}},makeClient:()=>({login(){throw Error('No separate PIN login');}})});
 return{async block(){status='Blocked';await setup.confirm(deviceId);}};
}
test('actual late Time In uses activated ownership without a second PIN; a failed transfer retains its draft and explicit retry saves one linked punch',async()=>{
 const h=harness();activatedUpload(h);h.upload=async()=>{throw Error('Synthetic interrupted upload');};await h.punch('TIME IN');assertNoAttendance(h);assert.equal(h.window.staffLateProofDraft.file,screenshot);assert.match(h.uploadCalls[0].path,/staff_requests\/synthetic-auth\/staff-id\/activated_late_/);assert.equal(h.uploadCalls[0].metadata.customMetadata.staffUploadAuthority,'phone-activation');
 h.upload=null;h.lateForm={reason:null,file:null};await h.punch('TIME IN');assert.equal(h.uploadCalls.length,2);assert.equal(h.uploadCalls[1].file,screenshot);assert.equal(h.batches.length,1);assert.equal(h.batches[0].length,2);assert.equal(h.window.staffLateProofDraft,null);assert.equal(h.window.staffPunchBusy,false);assert.ok(h.writes.every(path=>path.startsWith('attendance_logs/')||path.startsWith('staff_requests/')));
});
test('blocking a phone while the actual Time In upload is pending stops camera and all attendance/request writes',async()=>{
 const h=harness(),activation=activatedUpload(h),gate=deferred();h.upload=async request=>{await gate.promise;request.assertCurrent();return{url:proofUrl};};const pending=h.punch('TIME IN');await waitFor(()=>h.uploadCalls.length,'The activated upload must begin');await activation.block();gate.resolve();await pending;assertNoAttendance(h);assert.equal(h.events.includes('camera'),false);assert.equal(h.window.staffLateProofDraft.file,screenshot);
});

test('actual late Time In preserves required reason and screenshot; cancel or missing proof creates no attendance',async()=>{
    for(const mode of ['cancel','missing-file','missing-reason']){
        const h=harness();if(mode==='cancel')h.cancelDialog=true;else if(mode==='missing-file')h.lateForm.file=null;else h.lateForm.reason='';
        await h.punch('TIME IN');assertNoAttendance(h);assert.equal(h.uploadCalls.length,0);
        assert.equal(h.events.includes('camera'),false);
    }
});

test('the exact saved hours are shown before proof or camera and cancelling the preview creates no punch',async()=>{
    const h=harness();h.cancelPreview=true;await h.punch('TIME IN');assertNoAttendance(h);
    assert.equal(h.uploadCalls.length,0);assert.equal(h.events.includes('camera'),false);
    const preview=h.alerts.find(args=>args[0]?.title==='Review your assigned hours')[0];assert.match(preview.html,/9:00\s*AM/i);assert.match(preview.html,/6:00\s*PM/i);
});

test('HQ changing the exact shift during a slow proof upload cannot save stale attendance or its reason letter',async()=>{
    const h=harness();h.upload=async()=>{const rules=h.records.get('settings/global_schedule').branchConfig.Maa;rules[0].startTime='10:00';rules[0].endTime='18:30';return {url:proofUrl};};
    await h.punch('TIME IN');assertNoAttendance(h);assert.equal(h.uploadCalls.length,1);
    assert.match(h.alerts.at(-1)[1],/HQ updated the assigned schedule/);assert.equal(h.window.staffLateProofDraft.file,screenshot);
});

test('actual late Time In restores controls after upload timeout, cancellation or unreadable proof; no partial HR letter is saved',async()=>{
    for(const message of ['Proof upload timed out. Try again.','Proof upload cancelled.','The selected screenshot could not be read.']){
        const h=harness();h.upload=async()=>{throw Error(message);};await h.punch('TIME IN');
        assertNoAttendance(h);assert.equal(h.uploadCalls.length,1);assert.match(h.alerts.at(-1)[1],new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
        assert.equal(h.events.includes('camera'),false);
    }
});

test('a pending proof holds the real click lock and stable attendance-specific path; a second click cannot start another upload',async()=>{
    const h=harness(),gate=deferred();h.upload=()=>gate.promise;
    const pending=h.punch('TIME IN');await waitFor(()=>h.uploadCalls.length,'The actual handler must reach the injected proof uploader.');
    assert.equal(h.window.staffPunchBusy,true);assert.equal(h.node('btnTimeIn').disabled,true);assert.equal(h.node('btnTimeOut').disabled,true);
    await h.punch('TIME IN');assert.equal(h.uploadCalls.length,1);assert.equal(h.writes.length,0);
    assert.equal(h.uploadCalls[0].file,screenshot);assert.equal(h.uploadCalls[0].path,'staff_requests/synthetic-auth/staff-id/late_auto-1.jpg');assert.deepEqual(h.uploadCalls[0].metadata.customMetadata,{staffUploadUid:'synthetic-auth',staffId:'staff-id'});
    gate.reject(Error('Proof upload cancelled.'));await pending;assertNoAttendance(h);
});

test('the actual proof callback binds to the captured staff identity; switching ID, name or signing out aborts before attendance',async()=>{
    for(const change of ['id','name','logout']){
        const h=harness(),gate=deferred();h.upload=async request=>{await gate.promise;request.assertCurrent();return {url:proofUrl};};
        const pending=h.punch('TIME IN');await waitFor(()=>h.uploadCalls.length,'The real upload must begin before changing employee identity.');
        if(change==='id')h.localStorage.setItem('takodeal_staff_id','different-staff');
        else if(change==='name')h.localStorage.setItem('takodeal_staff_name','Different Staff');
        else{h.localStorage.removeItem('takodeal_staff_id');h.localStorage.removeItem('takodeal_staff_name');}
        gate.resolve();await pending;assertNoAttendance(h);assert.match(h.alerts.at(-1)[1],/session|sign in|account|identity/i);
    }
});

test('late upload success saves one linked reason and Time In in the same batch, with current camera/location evidence',async()=>{
    const h=harness();await h.punch('TIME IN');
    assert.equal(h.uploadCalls.length,1);assert.equal(h.batches.length,1);assert.equal(h.batches[0].length,2);assert.equal(h.transactions.length,0);
    const attendance=h.records.get('attendance_logs/auto-1'),letter=h.records.get('staff_requests/auto-2');
    assert.equal(attendance.type,'TIME IN');assert.equal(attendance.staffId,'staff-id');assert.equal(attendance.staffName,profile.cashierName);
    assert.equal(attendance.sourceApp,'staff');assert.equal(attendance.recordedByStaffId,'staff-id');assert.equal(attendance.recordedDeviceId,'synthetic-device');
    assert.equal(attendance.lateReasonRequestId,'auto-2');assert.equal(letter.attendanceLogId,'auto-1');
    assert.equal(letter.proofImageUrl,proofUrl);assert.equal(letter.status,'Pending');assert.equal(letter.type,'Reason Letter');
    assert.match(letter.explanationMessage,/Delayed public transport/);assert.equal(letter.lateMinutes,attendance.lateMinutes);assert.equal(attendance.lateMinutes,15);
    assert.equal(attendance.photoBase64,'data:image/jpeg;base64,c3ludGhldGlj');assert.equal(attendance.faceCheck.policyVersion,'attendance-photo-v2');
    assert.equal(attendance.locationAccuracyMeters,10);assert.equal(attendance.branch,'Maa');
    assert.equal(h.events.filter(event=>event==='gps').length,3);
    assert.ok(h.events.indexOf('sanctions')>h.events.indexOf('proof:done'));
    assert.ok(h.events.indexOf('camera')>h.events.indexOf('proof:done'));
    assert.ok(h.events.lastIndexOf('gps')>h.events.indexOf('camera'));
    assert.ok(h.events.indexOf('fresh')>h.events.lastIndexOf('gps'));
    assert.ok(h.events.indexOf('commit:start')>h.events.indexOf('fresh'));
    assert.equal(h.window.staffPunchBusy,false);assert.equal(h.node('btnTimeIn').disabled,false);assert.equal(h.node('btnTimeOut').disabled,false);
});

function declaredSwapHarness(){
    const h=harness(),plan=h.records.get('settings/global_schedule');
    plan.employees=[{staffId:'staff-id',cashierName:profile.cashierName,name:'Synthetic',branch:'Maa'},
        {staffId:'coworker-id',cashierName:'Synthetic Coworker',name:'Coworker',branch:'Maa'}];
    plan.branchConfig.Maa.push({id:'later-slot',name:'Later saved shift',startTime:'10:00',endTime:'18:30',active:true});
    plan.currentSchedule[6].Maa.scheduled['later-slot']='Coworker';
    const revision=createScheduleRevision(plan,{revisionId:'declaration-roster',effectiveFrom:'2026-10-06',savedAt:new Date('2026-10-06T06:00:00+08:00')});
    h.records.set('settings/schedule_month_2026_10',{revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId});
    h.records.set('settings/schedule_revision_'+revision.revisionId,revision);
    const selectChoice=JSON.stringify(['coworker-id','2026-10-06','Maa','later-slot',revision.revisionId]);
    h.swapChoice={coworker:'coworker-id',key:selectChoice};
    h.declarationPlan=plan;
    return h;
}

test('declaring a swap during actual late Staff Time In preserves the required proof and saves one combined linked Reason Letter',async()=>{
    const h=declaredSwapHarness();await h.punch('TIME IN');
    assert.equal(h.uploadCalls.length,1);assert.equal(h.batches.length,1);assert.equal(h.batches[0].length,2);
    const attendance=h.records.get('attendance_logs/auto-1'),request=h.records.get('staff_requests/auto-2');
    assert.equal(request.type,'Reason Letter');assert.equal(request.status,'Pending');assert.equal(request.lateMinutes,15);assert.equal(request.proofImageUrl,proofUrl);
    assert.equal(attendance.scheduleSnapshot.shiftId,'slot');assert.equal(attendance.scheduleSnapshot.lateMinutes,15);assert.equal(attendance.lateMinutes,15);
    assert.equal(attendance.scheduleDeclarationRequestId,attendance.lateReasonRequestId);assert.equal(request.attendanceLogId,'auto-1');
    assert.deepEqual(request.scheduleDeclaration,attendance.scheduleDeclaration);assert.equal(request.scheduleDeclaration.coworkerStaffId,'coworker-id');
    assert.equal(request.staffShiftProposal.shiftId,'later-slot');assert.equal(request.staffShiftProposal.referenceOnly,true);assert.match(request.explanationCause,/Tardiness \/ Late Arrival/);
    assert.match(request.explanationMessage,/Delayed public transport/);assert.match(request.explanationMessage,/agreed to cover/);
});

test('a selected swap cannot bypass required Staff lateness proof or write a declaration separately',async()=>{
    const h=declaredSwapHarness();h.lateForm.file=null;await h.punch('TIME IN');assertNoAttendance(h);assert.equal(h.uploadCalls.length,0);
});

test('a coworker becoming inactive while the late proof uploads prevents both the Time In and declaration request',async()=>{
    const h=declaredSwapHarness();h.upload=async()=>{h.declarationPlan.employees[1].active=false;return {url:proofUrl};};await h.punch('TIME IN');
    assertNoAttendance(h);assert.equal(h.uploadCalls.length,1);assert.match(h.alerts.at(-1)[1],/coworker|dated shift/);assert.equal(h.window.staffLateProofDraft.file,screenshot);
});

test('failed upload keeps the screenshot and reason for an explicit same-employee retry without relaxing required proof',async()=>{
    const h=harness();h.upload=async()=>{throw Error('Proof upload timed out.');};await h.punch('TIME IN');assertNoAttendance(h);
    assert.equal(h.window.staffLateProofDraft.file,screenshot);assert.equal(h.window.staffLateProofDraft.reason,h.lateForm.reason);
    h.upload=null;h.lateForm={reason:null,file:null};await h.punch('TIME IN');
    assert.equal(h.uploadCalls.length,2);assert.equal(h.uploadCalls[1].file,screenshot);assert.equal(h.uploadCalls[1].path,'staff_requests/synthetic-auth/staff-id/late_auto-3.jpg');
    assert.equal(h.batches.length,1);assert.equal(h.writes.length,2);assert.match(h.node('lateProofKept').textContent,/synthetic-proof\.png/);
    assert.equal(h.window.staffLateProofDraft,null);
});

test('an expired retry draft or a different employee cannot reuse the earlier screenshot to satisfy the required proof',async()=>{
    for(const mode of ['expired','different-employee']){
        const h=harness();h.upload=async()=>{throw Error('Proof upload cancelled.');};await h.punch('TIME IN');assertNoAttendance(h);
        if(mode==='expired')h.advance(31*60*1000);
        else{h.localStorage.setItem('takodeal_staff_id','other-staff');h.records.set('cashiers/other-staff',profile);}
        h.upload=null;h.lateForm={reason:'A new explicit reason.',file:null};await h.punch('TIME IN');assertNoAttendance(h);
        assert.equal(h.uploadCalls.length,1);assert.equal(h.window.staffLateProofDraft,null);assert.equal(h.events.includes('validation'),true);
    }
});

test('a branch change or lost GPS after upload still prevents the real Time In and its HR letter',async()=>{
    for(const mode of ['different-branch','permission-error']){
        const h=harness();let checks=0;h.location=()=>{checks++;if(checks>1){if(mode==='permission-error')throw Error('Location permission was removed.');return {branch:'Cabantian',distance:1,accuracy:8,lat:7,lng:125,timestamp:Date.parse(clock)};}return {branch:'Maa',distance:2,accuracy:10,lat:7,lng:125,timestamp:Date.parse(clock)};};
        await h.punch('TIME IN');assert.equal(h.uploadCalls.length,1);assertNoAttendance(h);assert.match(h.alerts.at(-1)[1],/branch changed|permission/i);
    }
});

test('a saved screenshot never bypasses current camera capture, final photo freshness or fresh sanctions',async()=>{
    for(const mode of ['camera','expired-photo','sanction']){
        const h=harness();if(mode==='camera')h.camera=async()=>{throw Error('Camera unavailable. Restart camera.');};
        else if(mode==='expired-photo')h.fresh=()=>{throw Error('The camera photo expired.');};else h.blocked=true;
        await h.punch('TIME IN');assert.equal(h.uploadCalls.length,1);assertNoAttendance(h);assert.match(h.alerts.at(-1)[1],/Camera|expired|HR notice/i);
    }
});

test('the proof upload timeout is not reused for attendance commit: pending acknowledgement keeps the click lock until completion',async()=>{
    const h=harness(),gate=deferred();h.beforeCommit=()=>gate.promise;
    const pending=h.punch('TIME IN');await waitFor(()=>h.events.includes('commit:start'),'The actual handler must reach its original attendance batch commit.');
    h.advance(5*60*1000);await tick();
    assert.equal(h.window.staffPunchBusy,true);assert.equal(h.node('btnTimeIn').disabled,true);assert.equal(h.node('btnTimeOut').disabled,true);
    await h.punch('TIME IN');assert.equal(h.uploadCalls.length,1);assert.equal(h.batches.length,0);assert.equal(h.writes.length,0);
    gate.resolve();await pending;assert.equal(h.batches.length,1);assert.equal(h.writes.length,2);assert.equal(h.window.staffPunchBusy,false);
});

test('normal scheduled Staff Time Out does not upload a late proof or require a camera, and keeps deterministic cross-app closure',async()=>{
    const h=harness();h.records.set('attendance_logs/cashier-start',{staffName:profile.cashierName,staffId:'staff-id',branch:'Maa',type:'TIME IN',sourceApp:'cashier',timestamp:new Date('2026-10-06T01:15:00+08:00'),scheduleSnapshot:{version:1,source:'clock-in',branch:'Maa',staffName:profile.cashierName,clockInAt:'2026-10-05T17:15:00.000Z',expectedStartAt:'2026-10-05T17:15:00.000Z',expectedEndAt:'2026-10-06T01:15:00.000Z',shiftId:'saved-night',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'saved-original'}});
    h.records.set('sop_logs/synthetic-sop',{staffName:profile.cashierName,staffId:'staff-id',branch:'Maa',timeInLogId:'cashier-start',timestamp:new Date('2026-10-06T08:45:00+08:00')});
    h.window.uploadAttendanceProof=()=>{throw Error('Time Out must never upload a late proof.');};h.camera=()=>{throw Error('Camera is optional for Time Out.');};
    await h.punch('TIME OUT');assert.equal(h.uploadCalls.length,0);assert.equal(h.batches.length,0);assert.equal(h.transactions.length,2);assert.equal(h.transactions[0].length,0);assert.equal(h.writes.length,1);assert.equal([...h.records.keys()].some(path=>path.startsWith('staff_requests/')),false);
    const ended=h.records.get(h.writes[0]);assert.equal(ended.type,'TIME OUT');assert.equal(ended.timeInLogId,'cashier-start');assert.equal(ended.sourceApp,'staff');assert.equal(ended.photoBase64,'');
    await h.punch('TIME OUT');assert.equal(h.writes.length,1);assert.equal(h.alerts.at(-1)[0],'Already Timed Out');
});

test('the actual Time In reuses one visible GPS watch through a proof delay and saves its newly captured location in the original atomic batch',async()=>{
 const h=harness();let now=Date.parse(clock),watchCalls=0,quickCalls=0,watch;const cleared=[];
 const session=createLocationSession({geolocation:{watchPosition(ok,fail){watchCalls++;if(watchCalls>1)fail({code:1});else watch=ok;return watchCalls;},getCurrentPosition(){quickCalls++;},clearWatch:id=>cleared.push(id)},zones:{Maa:{lat:7,lng:125}},keepWatching:true,now:()=>now});
 const position=()=>({timestamp:now,coords:{latitude:7.00001,longitude:125,accuracy:7}}),ready=session.acquire();watch(position());await ready;
 h.location=async()=>{const state=await session.acquire();if(state.state!=='verified')throw Object.assign(Error(state.title+' '+state.hint),{code:'attendance/location-'+state.state});return state;};
 h.upload=async()=>{now+=70000;h.advance(70000);watch(position());return{url:proofUrl};};h.beforeCommit=()=>assert.equal(h.alerts.at(-1)[0].title,'Saving attendance…');
 try{await h.punch('TIME IN');assert.equal(watchCalls,1);assert.equal(quickCalls,1);assert.equal(h.events.filter(event=>event==='gps').length,3);assert.equal(h.batches.length,1);assert.equal(h.batches[0].length,2);const attendance=h.records.get('attendance_logs/auto-1');assert.equal(attendance.locationCapturedAt,new Date(now).toISOString());assert.equal(attendance.locationLat,7.00001);assert.equal(attendance.locationAccuracyMeters,7);assert.equal(attendance.distanceMeters,1);assert.equal(attendance.staffId,'staff-id');assert.ok(attendance.faceCheck);assert.equal(attendance.lateReasonRequestId,'auto-2');assert.equal(cleared.length,0);}finally{session.stop();}assert.equal(cleared.length,1);
});
test('a proof delay without a new GPS sample cannot reuse expired coordinates or save attendance when permission is lost',async()=>{
 const h=harness();let now=Date.parse(clock),watchCalls=0,watch;
 const session=createLocationSession({geolocation:{watchPosition(ok,fail){watchCalls++;if(watchCalls===1)watch=ok;else fail({code:1});return watchCalls;},getCurrentPosition(){},clearWatch(){}},zones:{Maa:{lat:7,lng:125}},keepWatching:true,now:()=>now});
 const ready=session.acquire();watch({timestamp:now,coords:{latitude:7,longitude:125,accuracy:10}});await ready;h.location=async()=>{const state=await session.acquire();if(state.state!=='verified')throw Object.assign(Error(state.title+' '+state.hint),{code:'attendance/location-'+state.state});return state;};h.upload=async()=>{now+=70000;h.advance(70000);return{url:proofUrl};};
 try{await h.punch('TIME IN');assertNoAttendance(h);assert.equal(watchCalls,2);assert.equal(h.uploadCalls.length,1);assert.equal(h.alerts.at(-1)[0],'Location needs attention');assert.match(h.alerts.at(-1)[1],/Allow Location.*Refresh location/);assert.equal(h.window.staffLateProofDraft.file,screenshot);}finally{session.stop();}
});
test('the actual Time In names GPS, camera, final schedule and save phases without changing the guarded save order',async()=>{
 const h=harness();await h.punch('TIME IN');const titles=h.alerts.map(args=>args[0]?.title).filter(Boolean),expected=['Checking your branch location…','Review your assigned hours','Rechecking your branch location…','Checking your current camera photo…','Confirming your branch location…','Preparing attendance…','Confirming your saved shift…','Saving attendance…'];let previous=-1;for(const title of expected){const index=titles.indexOf(title);assert.ok(index>previous,title+' follows its real guarded phase');previous=index;}assert.equal(h.batches.length,1);assert.equal(h.events.indexOf('camera')>h.events.indexOf('proof:done'),true);assert.equal(h.events.indexOf('commit:start')>h.events.lastIndexOf('fresh'),true);assert.equal(h.writes.length,2);
});
