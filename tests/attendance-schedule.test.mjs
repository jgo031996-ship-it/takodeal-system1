import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-staff/payroll-safety.js';
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
        getDocs:async q=>{const documents=q.path==='cashiers'?[snap('cashiers/staff-id',profile)]:[];return {empty:!documents.length,docs:documents,forEach:fn=>documents.forEach(fn)};},
        serverTimestamp:()=>new Date(clock),
        async addDoc(path,data){const ref=`${path}/auto-${++sequence}`;records.set(ref,clone(data));writes.push(ref);return {id:ref.split('/').at(-1)};},
        writeBatch(){const changes=[];return {set:(path,data)=>changes.push([path,clone(data)]),async commit(){for(const [path,data]of changes){records.set(path,data);writes.push(path);}}};},
        async runTransaction(_db,callback){const changes=[];let writing=false;const result=await callback({get:async path=>{assert.equal(writing,false);return snap(path);},set:(path,data)=>{writing=true;changes.push([path,clone(data)]);},update:(path,data)=>{writing=true;changes.push([path,{...clone(records.get(path)),...clone(data)}]);}});for(const [path,data]of changes){records.set(path,data);writes.push(path);}return result;}};
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
    const window={...h.api,getAttendanceLocation:async()=>fix,checkActiveSanctions:async()=>false,loadMyAttendance(){}};
    const context={...h.api,...ui,...payroll,createScheduleHistoryStore,window,Date:dateAt(clock)};
    const start=staffSource.indexOf('window.punchTime = async function');
    vm.runInNewContext(staffSource.slice(start,staffSource.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',start)),context);
    return {...ui,window};
}
function cashierClock(h,clock,{cachedProfile=true}={}) {
    const ui=dom();ui.node('clockStaffName').value=profile.cashierName;ui.node('clockStaffPin').value='test-pin';
    let gpsDone;
    const window={...h.api,isFaceAiReady:false,BRANCH_ZONES:{Maa:{lat:7,lng:125}},getDistanceInMeters:()=>2,
        currentBranchStaffCache:cachedProfile?[{...profile,id:'staff-id',pin:'test-pin'}]:null};
    const api={...h.api,getDocs:async q=>{
        if(q.path==='cashiers'){const d={id:'staff-id',data:()=>({...profile,pin:'test-pin'})};return {empty:false,docs:[d],forEach:fn=>fn(d)};}
        return {empty:true,docs:[],forEach(){}};
    }};Object.assign(window,api);
    const context={...api,...ui,...payroll,createScheduleHistoryStore,window,Date:dateAt(clock),
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
