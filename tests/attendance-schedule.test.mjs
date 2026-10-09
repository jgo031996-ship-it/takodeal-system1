import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import * as sanctions from '../Takodeal-POS/sanction-schedule.js';
import * as reconciliation from '../takodeal-staff/attendance-reconcile.js';
import {createScheduleHistoryStore,scheduleDateKey,monthKey,resolveScheduleForDate} from '../takodeal-staff/schedule-history.js';

const staffSource = readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
const cashierSource = readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const now = new Date('2026-10-06T09:02:00+08:00');
const profile = {cashierName:'Sample Staff',scheduleNickname:'Sample',branch:'Maa',hourlyRate:500};
const clone = value => value === undefined ? undefined : structuredClone(value);
function schedule(month='2026-10',start='09:00',end='18:00',days=[6]) {
    const [year,number]=month.split('-').map(Number);
    return {currentYear:year,currentMonth:number,branchConfig:{Maa:[{id:'slot',name:'Saved shift',startTime:start,endTime:end,active:true,days:[0,1,2,3,4,5,6]}]},
        currentSchedule:Object.fromEntries(days.map(day=>[day,{Maa:{scheduled:{slot:'Sample'},rest:[],unavailable:[],swaps:{}}}])),employees:[],holidays:{},unavailability:{}};
}
function memory(initial={}) {
    const records = new Map(Object.entries(clone(initial))),writes=[];
    let sequence=0,clock=now;
    const snap=(path,data=records.get(path))=>({id:path.split('/').at(-1),ref:path,exists:()=>data!==undefined,data:()=>clone(data)});
    const api={db:{},collection:(_db,path)=>path,doc:(parent,collection,id)=>id===undefined?`${parent}/auto-${++sequence}`:`${collection}/${id}`,
        query:(path,...filters)=>({path,filters}),where:(...filter)=>filter,orderBy:(...sort)=>sort,limit:value=>value,
        getDoc:async path=>snap(path),getDocFromServer:async path=>snap(path),
        getDocs:async q=>{const entries=[...records].filter(([path,row])=>path.startsWith(q.path+'/') && (q.filters||[]).every(([key,op,value])=>op!=='=='||row[key]===value));const documents=entries.map(([path,row])=>snap(path,row));return {empty:!documents.length,docs:documents,forEach:fn=>documents.forEach(fn)};},
        serverTimestamp:()=>new Date(clock),
        async addDoc(path,data){const ref=`${path}/auto-${++sequence}`;records.set(ref,clone(data));writes.push(ref);return {id:ref.split('/').at(-1)};},
        writeBatch(){const changes=[];return {set:(path,data)=>changes.push([path,clone(data)]),async commit(){for(const [path,data]of changes){records.set(path,data);writes.push(path);}}};},
        async runTransaction(_db,callback){const changes=[];let writing=false;const result=await callback({get:async path=>{assert.equal(writing,false);return snap(path);},set:(path,data)=>{writing=true;changes.push([path,clone(data)]);},update:(path,data)=>{writing=true;changes.push([path,{...clone(records.get(path)),...clone(data)}]);}});for(const [path,data]of changes){records.set(path,data);writes.push(path);}return result;}};
    api.getDocsFromServer=api.getDocs;
    const store=createScheduleHistoryStore(api,{now:()=>clock,makeId:()=>`revision-${++sequence}`});
    return {api,store,records,writes,set clock(value){clock=new Date(value);},get clock(){return clock;}};
}
function dateAt(value) {
    return class TestDate extends Date {constructor(...args){super(...(args.length?args:[value]));}static now(){return +new Date(value);}};
}
function dom() {
    const nodes=new Map(),storage=new Map([['takodeal_staff_name',profile.cashierName],['takodeal_staff_id','staff-id'],['takodeal_device_id','device-id'],['takodeal_device_branch','Maa']]);
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},disabled:false,videoWidth:0,textContent:'',innerHTML:''});return nodes.get(id);};
    const alerts=[];
    return {nodes,node,alerts,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
        document:{getElementById:node,querySelector:()=>null,querySelectorAll:()=>[]},
        Swal:{fire:async(...args)=>{alerts.push(args);return {isConfirmed:true};},close(){},showLoading(){}},
        alert:message=>alerts.push([message]),confirm:()=>true,console:{error(){},warn(){},log(){}}};
}
function staffClock(h,clock) {
    const ui=dom(),fix={branch:'Maa',distance:2,accuracy:10,lat:7,lng:125,timestamp:+new Date(clock)};
    const window={...h.api,getAttendanceLocation:async()=>fix,checkActiveSanctions:async()=>false,loadMyAttendance(){},verifyAttendanceFace:async()=>({photoBase64:'data:image/jpeg;base64,verified',faceCheck:{faceCount:1,capturedAt:new Date(clock).toISOString()}}),assertAttendanceFaceFresh(){}};
    const context={...h.api,...ui,...payroll,...reconciliation,createScheduleHistoryStore,window,Date:dateAt(clock)};
    const start=staffSource.indexOf('window.punchTime = async function');
    vm.runInNewContext(staffSource.slice(start,staffSource.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',start)),context);
    return {...ui,window};
}
function cashierClock(h,clock,{cachedProfile=true,lastTimeInHours=null,pin='test-pin'}={}) {
    const ui=dom();ui.node('clockStaffName').value=profile.cashierName;ui.node('clockStaffPin').value='test-pin';
    ui.node('timeClockModal').style.display='flex';
    let gpsDone;
    if(lastTimeInHours!==null)h.records.set('attendance_logs/last-in',{staffId:'staff-id',staffName:profile.cashierName,branch:'Maa',type:'TIME IN',timestamp:new Date(+new Date(clock)-lastTimeInHours*3600000)});
    const window={...h.api,BRANCH_ZONES:{Maa:{lat:7,lng:125}},getDistanceInMeters:()=>2,prepareAttendanceCamera:async()=>true,verifyAttendanceFace:async()=>({photoBase64:'data:image/jpeg;base64,verified',faceCheck:{faceCount:1,capturedAt:new Date(clock).toISOString()}}),assertAttendanceFaceFresh(){},
        currentBranchStaffCache:cachedProfile?[{...profile,id:'staff-id',pin:'test-pin'}]:null};
    const api={...h.api,getDocs:async q=>{
        if(q.path==='cashiers'){const d={id:'staff-id',data:()=>({...profile,pin})};return {empty:false,docs:[d],forEach:fn=>fn(d)};}
        return h.api.getDocs(q);
    }};api.getDocsFromServer=async q=>{if(h.serverError)throw h.serverError;return api.getDocs(q);};Object.assign(window,api);
    const context={...api,...ui,...payroll,...sanctions,...reconciliation,createScheduleHistoryStore,window,Date:dateAt(clock),
        navigator:{geolocation:{getCurrentPosition:ok=>{gpsDone=ok({coords:{latitude:7,longitude:125}});}}}};
    const start=cashierSource.indexOf('window.submitAttendance = async function');
    vm.runInNewContext(cashierSource.slice(start,cashierSource.indexOf('// 📥 STAFF REQUEST HUB (WITH INBOX)',start)),context);
    return {...ui,window,wait:()=>gpsDone};
}

test('actual Staff clock-in saves the November rule while the live head still shows October; later edits cannot alter that punch',async()=>{
    const h=memory({'settings/global_schedule':schedule(),'cashiers/staff-id':profile});
    await h.store.save(schedule('2026-11','11:00','20:00',[1]),{effectiveFrom:'2026-11-01',expectedRevisionId:null});
    const clock='2026-11-01T11:02:00+08:00';h.clock=clock;
    assert.equal(h.records.get('settings/global_schedule').currentMonth,10);
    const before=h.writes.length,app=staffClock(h,clock);await app.window.punchTime('TIME IN');
    const refs=h.writes.slice(before);assert.equal(refs.length,1);assert.match(refs[0],/^attendance_logs\//);
    const attendance=h.records.get(refs[0]);
    assert.equal(attendance.sourceApp,'staff');assert.equal(attendance.recordedByStaffId,'staff-id');assert.equal(attendance.recordedDeviceId,'device-id');
    assert.equal(attendance.scheduleSnapshot.expectedStartAt,'2026-11-01T03:00:00.000Z');assert.equal(attendance.lateMinutes,2);
    const november=await h.store.loadMonth('2026-11');
    await h.store.save(schedule('2026-11','12:00','21:00',[1]),{expectedRevisionId:november.latestRevisionId,effectiveFrom:'2026-11-01'});
    h.clock='2026-12-01T09:00:00+08:00';await h.store.save(schedule('2026-12','08:00','17:00',[1]),{effectiveFrom:'2026-12-01',expectedRevisionId:null});
    const paidLater=payroll.resolveAttendanceShift(attendance,await h.store.loadRange('2026-11-01','2026-12-01'),{[profile.cashierName]:profile});
    assert.equal(paidLater.lateMinutes,2);assert.equal(paidLater.expectedStartAt.toISOString(),'2026-11-01T03:00:00.000Z');assert.equal(paidLater.scheduleSource,'clock-in');
});

test('actual Cashier clock-in includes the previous month for a midnight overnight shift and records server profile identity',async()=>{
    const h=memory({'settings/global_schedule':schedule('2026-10','23:00','07:00',[31])});
    await h.store.save(schedule('2026-11','09:00','18:00',[1]),{effectiveFrom:'2026-11-01',expectedRevisionId:null});
    const before=h.writes.length,clock='2026-11-01T00:05:00+08:00';h.clock=clock;
    const app=cashierClock(h,clock,{cachedProfile:false});await app.window.submitAttendance('TIME IN');await app.wait();
    assert.equal(h.writes.length-before,1);const attendance=h.records.get(h.writes.at(-1));
    assert.equal(attendance.type,'TIME IN');assert.equal(attendance.staffId,'staff-id');assert.equal(attendance.recordedByStaffId,'staff-id');
    assert.equal(attendance.sourceApp,'cashier');assert.equal(attendance.recordedDeviceId,'device-id');
    assert.equal(attendance.scheduleSnapshot.needsScheduleReview,false);assert.equal(attendance.scheduleSnapshot.expectedStartAt,'2026-10-31T15:00:00.000Z');
    assert.equal(attendance.scheduleSnapshot.expectedEndAt,'2026-10-31T23:00:00.000Z');assert.equal(attendance.scheduleSnapshot.lateMinutes,65);
});

test('missing schedule evidence preserves a Cashier punch as review-required, rather than inferring another month’s lateness',async()=>{
    const h=memory({'settings/global_schedule':schedule('2026-10','09:00','18:00',[6])});
    const clock='2026-11-01T11:02:00+08:00';h.clock=clock;const app=cashierClock(h,clock);
    await app.window.submitAttendance('TIME IN');await app.wait();
    const attendance=h.records.get(h.writes.at(-1));assert.equal(attendance.scheduleSnapshot.needsScheduleReview,true);
    assert.equal(attendance.scheduleSnapshot.expectedStartAt,'');assert.equal(attendance.lateMinutes,undefined);
    const match=payroll.resolveAttendanceShift(attendance,null,{[profile.cashierName]:profile});assert.equal(match.needsScheduleReview,true);assert.equal(match.lateMinutes,0);
});

test('Cashier rejects an unsupported manual-edit type before querying identity, GPS or creating a record',async()=>{
    const h=memory(),app=cashierClock(h,now);await app.window.submitAttendance('TIME IN (Manual Edit: System Error)');
    assert.equal(h.writes.length,0);assert.equal(app.wait(),undefined);assert.equal(app.window.isProcessingAttendance,undefined);
});

test('actual Staff Time In requires camera proof, records its checked image, and rejects a changed staff session',async()=>{
    for(const problem of ['missing','turned','session']){
        const h=memory(),app=staffClock(h,now);
        if(problem==='missing')delete app.window.verifyAttendanceFace;
        if(problem==='turned')app.window.verifyAttendanceFace=async()=>{throw Error('Turn your face toward the camera.');};
        if(problem==='session')app.window.verifyAttendanceFace=async()=>{app.localStorage.setItem('takodeal_staff_id','other');return {photoBase64:'bad'};};
        await app.window.punchTime('TIME IN');assert.equal(h.writes.length,0);assert.equal(app.window.staffPunchBusy,false);
        assert.match(app.alerts.at(-1)[1],/camera|session/);
    }
    const h=memory(),app=staffClock(h,now);await app.window.punchTime('TIME IN');
    const row=h.records.get(h.writes.at(-1));assert.equal(row.photoBase64,'data:image/jpeg;base64,verified');assert.equal(row.faceCheck.faceCount,1);
});
test('Cashier always verifies the current server PIN and never bypasses it with a stored descriptor',async()=>{
    const h=memory(),app=cashierClock(h,now,{pin:'new-pin'});app.window.currentBranchStaffCache[0].faceDescriptor=Array(128).fill(0);
    app.window.isFaceAiReady=true;await app.window.submitAttendance('TIME IN');await app.wait();assert.equal(h.writes.length,0);assert.equal(app.wait(),undefined);assert.match(app.alerts.at(-1)[0],/Incorrect PIN/);
});
test('Cashier camera failure leaves no Time In, biometric enrollment, auto Time Out, or penalty side effects',async()=>{
    for(const lastTimeInHours of [null,15]){
        const h=memory(),app=cashierClock(h,now,{lastTimeInHours});app.window.verifyAttendanceFace=async()=>{throw Error('Only one person should be in the camera frame.');};
        await app.window.submitAttendance('TIME IN');await app.wait();assert.equal(h.writes.length,0);assert.equal(app.window.isProcessingAttendance,false);assert.match(app.alerts.at(-1)[0],/one person/);
    }
});
test('Cashier saves a checked Time In and staged missing-Time-Out records together only after the final camera succeeds',async()=>{
    const h=memory(),app=cashierClock(h,now,{lastTimeInHours:15});let complete;
    app.window.verifyAttendanceFace=()=>new Promise(resolve=>complete=resolve);
    await app.window.submitAttendance('TIME IN');while(!complete)await new Promise(setImmediate);assert.equal(h.writes.length,0);
    complete({photoBase64:'data:image/jpeg;base64,checked',faceCheck:{faceCount:1}});await app.wait();assert.equal(h.writes.length,3);
    const saved=h.writes.map(path=>h.records.get(path));assert.equal(saved.filter(row=>row.type==='TIME IN').length,1);assert.equal(saved.filter(row=>row.type==='AUTO TIME OUT (Penalty)').length,1);assert.equal(saved.filter(row=>row.type==='ATTENDANCE_PENALTY').length,1);
    assert.equal(saved.find(row=>row.type==='TIME IN').photoBase64,'data:image/jpeg;base64,checked');
});
test('Cashier Time Out remains available with missing camera models and no photo, using the existing PIN and shift checks',async()=>{
    const h=memory(),app=cashierClock(h,now,{lastTimeInHours:8});
    app.window.prepareAttendanceCamera=app.window.verifyAttendanceFace=async()=>{throw Error('Camera unavailable');};
    await app.window.submitAttendance('TIME OUT');await app.wait();assert.equal(h.writes.length,1);assert.equal(h.records.get(h.writes[0]).type,'TIME OUT');assert.equal(h.records.get(h.writes[0]).photoBase64,'');
});
test('Cashier does not save after the selected account or open Clock changes during camera inference',async()=>{
    for(const changed of ['account','closed']){
        const h=memory(),app=cashierClock(h,now);
        app.window.verifyAttendanceFace=async()=>{if(changed==='account')app.node('clockStaffName').value='Other';else app.node('timeClockModal').style.display='none';return {photoBase64:'data:image/jpeg;base64,checked',faceCheck:{faceCount:1}};};
        await app.window.submitAttendance('TIME IN');await app.wait();assert.equal(h.writes.length,0);assert.equal(app.window.isProcessingAttendance,false);assert.match(app.alerts.at(-1)[0],/changed/);
    }
});

test('actual Cashier Time In is visible to Staff Time Out, including a completed overnight SOP, with no second closure',async()=>{
    const h=memory({'cashiers/staff-id':profile}),inClock='2026-10-06T22:00:00+08:00',outClock='2026-10-07T06:00:00+08:00';h.clock=inClock;
    const cashier=cashierClock(h,inClock);await cashier.window.submitAttendance('TIME IN');await cashier.wait();
    assert.equal(h.writes.length,1);const inRef=h.writes[0],original=clone(h.records.get(inRef));
    h.records.set('sop_logs/checklist',{staffId:'staff-id',staffName:profile.cashierName,branch:'Maa',timestamp:new Date('2026-10-06T23:45:00+08:00')});h.clock=outClock;
    const staff=staffClock(h,outClock);staff.window.verifyAttendanceFace=()=>{throw Error('Time Out must not require models');};
    await staff.window.punchTime('TIME OUT');assert.equal(h.writes.length,2);
    const ended=h.records.get(h.writes[1]);assert.equal(ended.sourceApp,'staff');assert.equal(ended.timeInLogId,inRef.split('/').at(-1));assert.equal(ended.type,'TIME OUT');assert.deepEqual(h.records.get(inRef),original);
    await staff.window.punchTime('TIME OUT');assert.equal(h.writes.length,2);assert.equal(staff.alerts.at(-1)[0],'Already Timed Out');
});
test('actual Staff Time In is visible to Cashier Time Out and keeps the original start untouched',async()=>{
    const h=memory({'cashiers/staff-id':profile}),inClock='2026-10-06T09:00:00+08:00',outClock='2026-10-06T17:00:00+08:00';h.clock=inClock;
    const staff=staffClock(h,inClock);await staff.window.punchTime('TIME IN');assert.equal(h.writes.length,1);const original=clone(h.records.get(h.writes[0])),startRef=h.writes[0];
    h.clock=outClock;const cashier=cashierClock(h,outClock);await cashier.window.submitAttendance('TIME OUT');await cashier.wait();assert.equal(h.writes.length,2);
    const end=h.records.get(h.writes[1]);assert.equal(end.timeInLogId,startRef.split('/').at(-1));assert.equal(end.sourceApp,'cashier');assert.deepEqual(h.records.get(startRef),original);
});
test('a Cashier Time Out does not create a phantom record when fresh HQ attendance cannot be read',async()=>{
    const h=memory(),cashier=cashierClock(h,now,{lastTimeInHours:8});h.serverError=Error('offline');await cashier.window.submitAttendance('TIME OUT');await cashier.wait();
    assert.equal(h.writes.length,0);assert.match(cashier.alerts.at(-1)[0],/confirmed with HQ/);assert.equal(cashier.window.isProcessingAttendance,false);
});

test('both actual clocks keep the newer shift active after a delayed linked closure of an older shift',async()=>{
    for(const appName of ['staff','cashier']){
        const employee={staffId:'staff-id',staffName:profile.cashierName,branch:'Maa'},clock='2026-10-07T10:00:00+08:00';
        const older={...employee,type:'TIME IN',timestamp:new Date('2026-10-06T22:00:00+08:00')},newer={...employee,type:'TIME IN',timestamp:new Date('2026-10-07T02:00:00+08:00')},oldClosed={...employee,type:'TIME OUT',timeInLogId:'older',timestamp:new Date('2026-10-07T06:00:00+08:00')};
        const h=memory({'cashiers/staff-id':profile,'attendance_logs/older':older,'attendance_logs/newer':newer,'attendance_logs/old-closed':oldClosed,'sop_logs/current':{...employee,timeInLogId:'newer',timestamp:new Date('2026-10-07T07:30:00+08:00')}});h.clock=clock;
        const app=appName==='staff'?staffClock(h,clock):cashierClock(h,clock),punch=type=>appName==='staff'?app.window.punchTime(type):app.window.submitAttendance(type);
        await punch('TIME IN');await app.wait?.();assert.equal(h.writes.length,0,'a newer active shift must still block another Time In');
        if(appName==='cashier')app.node('clockStaffPin').value='test-pin';
        await punch('TIME OUT');await app.wait?.();assert.equal(h.writes.length,1,appName+': '+JSON.stringify(app.alerts));
        assert.equal(h.records.get(h.writes[0]).timeInLogId,'newer');assert.deepEqual(h.records.get('attendance_logs/older'),older);assert.deepEqual(h.records.get('attendance_logs/newer'),newer);assert.deepEqual(h.records.get('attendance_logs/old-closed'),oldClosed);
    }
});

test('actual Staff SOP screen follows an ID-matched Cashier shift instead of a GPS default or duplicate display name',async()=>{
    const h=memory({'attendance_logs/in':{staffId:'staff-id',staffName:'Old Staff Name',branch:'Maa',type:'TIME IN',timestamp:new Date('2026-10-06T09:00:00+08:00')},
        'attendance_logs/older':{staffId:'staff-id',staffName:profile.cashierName,branch:'Cabantian',type:'TIME IN',timestamp:new Date('2026-10-05T22:00:00+08:00')},
        'attendance_logs/late-old-out':{staffId:'staff-id',staffName:profile.cashierName,branch:'Cabantian',type:'TIME OUT',timeInLogId:'older',timestamp:new Date('2026-10-06T10:00:00+08:00')},
        'attendance_logs/other':{staffId:'someone-else',staffName:profile.cashierName,branch:'Citygate',type:'TIME IN',timestamp:new Date('2026-10-06T10:00:00+08:00')}}),ui=dom();let loads=0;
    const window={...h.api,getClosestBranch:()=> 'Cabantian',onSopBranchChange:async()=>loads++},context={...h.api,...ui,...reconciliation,window,Date:dateAt('2026-10-06T17:00:00+08:00')};
    const at=staffSource.indexOf('window.initSopModule = async function()');vm.runInNewContext(staffSource.slice(at,staffSource.indexOf('window.onSopBranchChange = async function()',at)),context);
    await window.initSopModule();assert.equal(ui.node('sopBranchSelect').value,'Maa');assert.equal(ui.node('sopBranchSelect').disabled,true);assert.equal(loads,1);assert.equal(window.sopActiveTimeIn.id,'in');
    h.records.get('attendance_logs/in').timestamp=null;await window.initSopModule();assert.equal(ui.node('sopBranchSelect').value,'');assert.equal(loads,1);assert.match(ui.node('sopGpsBadge').innerText,/timestamp/);
});

function scheduleView(h,selected='2026-11') {
    const ui=dom();ui.node('staffMonthPicker').value=selected;
    const window={...h.api};const context={...h.api,...ui,window,createScheduleHistoryStore,scheduleDateKey,monthKey,resolveScheduleForDate,structuredClone,Date:dateAt(now)};
    const start=staffSource.indexOf('window.loadStaffSchedule = async function');
    vm.runInNewContext(staffSource.slice(start,staffSource.indexOf('window.initiateSwapRequest = function',start)),context);
    return {...ui,window,context};
}
test('Staff month view reads the planned archive and changing to an unsaved month never relabels the active schedule',async()=>{
    const h=memory({'settings/global_schedule':schedule(),'cashiers/staff-id':profile});
    await h.store.save(schedule('2026-11','11:00','20:00',[1]),{effectiveFrom:'2026-11-01',expectedRevisionId:null});
    const before=clone([...h.records]),view=scheduleView(h);await view.window.loadStaffSchedule();
    assert.equal(view.window.cachedSchedData.currentMonth,11);assert.match(view.node('scheduleContainer').innerHTML,/November 2026/);
    assert.match(view.node('scheduleContainer').innerHTML,/11:00 AM to 8:00 PM/);
    view.node('staffMonthPicker').value='2026-09';await view.window.loadStaffSchedule();
    assert.equal(view.window.cachedSchedData,null);assert.match(view.node('scheduleContainer').innerHTML,/has not saved a schedule for September 2026/);
    assert.deepEqual([...h.records],before,'readonly month navigation must not write or fabricate schedule history');
});

test('a slow older month response cannot replace a newer selected month or revive its swap cache',async()=>{
    const h=memory({'settings/global_schedule':schedule(),'cashiers/staff-id':profile});
    await h.store.save(schedule('2026-11','11:00','20:00',[1]),{effectiveFrom:'2026-11-01',expectedRevisionId:null});
    const view=scheduleView(h);let release;const real=h.api.getDocFromServer;
    view.window.getDocFromServer=path=>path==='settings/schedule_month_2026_11'?new Promise(resolve=>{release=()=>real(path).then(resolve);}):real(path);
    const first=view.window.loadStaffSchedule();while(!release)await new Promise(resolve=>setImmediate(resolve));
    view.node('staffMonthPicker').value='2026-10';await view.window.loadStaffSchedule();release();await first;
    assert.equal(view.window.cachedSchedData.currentMonth,10);assert.match(view.node('scheduleContainer').innerHTML,/October 2026/);
    assert.doesNotMatch(view.node('scheduleContainer').innerHTML,/November 2026/);
});

function swapApp(h) {
    const ui=dom(),window={loadStaffSchedule(){}};
    const context={...h.api,...ui,window,scheduleDateKey,monthKey,Date:dateAt(now)};
    const start=staffSource.indexOf('window.handleIncomingSwap = async function');
    vm.runInNewContext(staffSource.slice(start,staffSource.indexOf('// 🖨️ UNIVERSAL HR DOCUMENT PRINTER',start)),context);
    return {...ui,window};
}
const request={status:'Pending',targetName:'Sample',targetAssignedName:'Sample',requesterName:'Other Staff',requesterAssignedName:'Other',
    workDate:'2026-10-20',sourceScheduleMonth:'2026-10',sourceRevisionId:'saved-revision',branch:'Maa',dayIndex:20,requesterShiftId:'morning',targetShiftId:'afternoon'};
test('Staff accepts a swap for HQ approval only, idempotently, without changing settings or attendance',async()=>{
    const h=memory({'cashiers/staff-id':profile,'shift_swaps/request':request,'settings/global_schedule':schedule()});const baseline=clone(h.records.get('settings/global_schedule'));
    const app=swapApp(h);await app.window.handleIncomingSwap('request','Approved');await app.window.handleIncomingSwap('request','Approved');
    assert.deepEqual(h.writes,['shift_swaps/request']);assert.deepEqual(h.records.get('settings/global_schedule'),baseline);
    const accepted=h.records.get('shift_swaps/request');assert.equal(accepted.status,'Awaiting HQ Approval');assert.equal(accepted.acceptedByStaffId,'staff-id');assert.equal(accepted.acceptanceVersion,1);
    assert.equal(accepted.targetAssignedName,'Sample');assert.equal(accepted.requesterAssignedName,'Other');
});
test('Staff swap acceptance cannot use a partial name, expired day or legacy undated request',async()=>{
    for(const invalid of [{targetName:'Sam'},{workDate:'2026-10-05'},{workDate:undefined},{sourceScheduleMonth:'2026-11'}]){
        const h=memory({'cashiers/staff-id':profile,'shift_swaps/request':{...request,...invalid}}),app=swapApp(h);
        await app.window.handleIncomingSwap('request','Approved');assert.equal(h.writes.length,0);assert.equal(h.records.get('shift_swaps/request').status,'Pending');
    }
});
test('Staff rejection updates only the request and an unsupported swap action changes nothing',async()=>{
    const h=memory({'cashiers/staff-id':profile,'shift_swaps/request':request}),app=swapApp(h);
    await app.window.handleIncomingSwap('request','Force Approved');assert.equal(h.writes.length,0);
    await app.window.handleIncomingSwap('request','Rejected');assert.deepEqual(h.writes,['shift_swaps/request']);assert.equal(h.records.get('shift_swaps/request').rejectedByStaffId,'staff-id');
});
