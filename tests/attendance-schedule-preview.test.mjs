import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {plannedAttendancePreview,renderAttendanceSchedulePreview,attendanceScheduleIdentity,assertAttendanceScheduleUnchanged,staffScheduleDay,renderStaffScheduleConflict} from '../takodeal-staff/attendance-schedule-preview.js';

const source=fs.readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
const saved=()=>({branch:'Cabantian',staffName:'Toni Sample',shiftId:'morning2',shiftName:'Morning 2 Cashier',shiftType:'morning',expectedStartAt:'2026-10-29T02:00:00.000Z',expectedEndAt:'2026-10-29T10:30:00.000Z',scheduleRevisionId:'roster-1',wasScheduled:true,needsScheduleReview:false,clockInAt:'2026-10-29T01:57:00.000Z',lateMinutes:0});
test('preview shows the exact Morning 2 assignment rather than its broad morning category',()=>{
 const result=plannedAttendancePreview(saved(),{at:'2026-10-29T01:57:00Z'});
 assert.equal(result.verified,true);assert.equal(result.workDate,'2026-10-29');assert.match(result.start,/10:00\s*AM/i);assert.match(result.finish,/6:30\s*PM/i);
 assert.match(renderAttendanceSchedulePreview(saved()),/Morning 2 Cashier/);assert.doesNotMatch(renderAttendanceSchedulePreview(saved()),/9:00/);
});
test('overnight preview explicitly retains its starting work date and next-day finish',()=>{
 const result=plannedAttendancePreview({...saved(),expectedStartAt:'2026-10-29T10:30:00Z',expectedEndAt:'2026-10-29T19:00:00Z'});
 assert.equal(result.workDate,'2026-10-29');assert.equal(result.nextDay,true);assert.match(result.finish,/30/);assert.match(result.finish,/3:00\s*AM/i);
 assert.match(renderAttendanceSchedulePreview({...saved(),expectedStartAt:'2026-10-29T10:30:00Z',expectedEndAt:'2026-10-29T19:00:00Z'}),/next day/);
});
test('unassigned and invalid evidence is clearly a review rather than a claimed late arrival',()=>{
 const unknown={...saved(),wasScheduled:false,needsScheduleReview:true,lateMinutes:57};
 assert.equal(plannedAttendancePreview(unknown).verified,false);
 const html=renderAttendanceSchedulePreview(unknown);assert.match(html,/Unverified reference hours/);assert.match(html,/no lateness is inferred/);assert.doesNotMatch(html,/57 minutes/);
 assert.equal(plannedAttendancePreview({...saved(),expectedEndAt:''}).hasTimes,false);
 assert.equal(plannedAttendancePreview({...saved(),expectedEndAt:'2026-10-30T10:30:00Z'}).hasTimes,false);
});
test('preview escapes all staff-controlled labels',()=>{
 const html=renderAttendanceSchedulePreview({...saved(),staffName:'<img onerror=bad>',branch:'A&B',shiftName:'<script>bad</script>'});
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/A&amp;B/);
});
test('schedule guard ignores elapsed late minutes but stops changed saved instructions',()=>{
 const before=saved();assert.equal(attendanceScheduleIdentity(before),attendanceScheduleIdentity({...before,clockInAt:'2026-10-29T02:05:00Z',lateMinutes:5}));
 for(const [key,value]of Object.entries({shiftId:'morning1',expectedStartAt:'2026-10-29T01:00:00Z',expectedEndAt:'2026-10-29T09:30:00Z',branch:'Maa',scheduleRevisionId:'roster-2',scheduleReviewReason:'multiple-assignments',needsScheduleReview:true}))assert.throws(()=>assertAttendanceScheduleUnchanged(before,{...before,[key]:value}),/No Time In was saved/);
});
test('relief work is visible even if the home branch occurs first with standby',()=>{
 const day=staffScheduleDay({Maa:{rest:['Toni Sample']},Cabantian:{scheduled:{morning2:' Toni Sample '}}},{Cabantian:[{id:'morning2',name:'Morning 2 Cashier'}]},['Toni Sample']);
 assert.equal(day.conflict,false);assert.equal(day.assignments.length,1);assert.equal(day.assignments[0].branch,'Cabantian');assert.equal(day.standby[0].branch,'Maa');
});
test('a relief assignment is not hidden by an earlier branch leave entry',()=>{
 const day=staffScheduleDay({Maa:{unavailable:[{name:'Toni Sample',status:'Day Off'}]},Cabantian:{scheduled:{morning2:'Toni Sample'}}},{Cabantian:[{id:'morning2'}]},['Toni Sample']);
 assert.equal(day.assignments.length,1);assert.equal(day.assignments[0].branch,'Cabantian');
});
test('duplicate assignments, missing rules and same-branch leave conflicts require review',()=>{
 const aliases=['Toni Sample'],rules={Cabantian:[{id:'m1',name:'Morning 1',startTime:'09:00',endTime:'17:30'},{id:'m2',name:'Morning 2',startTime:'10:00',endTime:'18:30'}]};
 for(const data of [{Cabantian:{scheduled:{m1:'Toni Sample',m2:'Toni Sample'}}},{Cabantian:{scheduled:{unknown:'Toni Sample'}}},{Cabantian:{scheduled:{m2:'Toni Sample'},unavailable:[{name:'Toni Sample',status:'Leave'}]}}])assert.equal(staffScheduleDay(data,rules,aliases).conflict,true);
 const html=renderStaffScheduleConflict(staffScheduleDay({Cabantian:{scheduled:{m1:'Toni Sample',m2:'Toni Sample'}}},rules,aliases));assert.match(html,/09:00/);assert.match(html,/10:00/);assert.match(html,/does not choose a shift/);
});
test('cross-branch directory aliases normalize spacing and case',()=>{
 assert.equal(staffScheduleDay({Maa:{scheduled:{m:' SYNTHETIC  CREW '}}},{Maa:[{id:'m'}]},['Synthetic Crew']).assignments.length,1);
});
test('Cashier and Staff use the same preview and schedule guard',()=>{
 assert.equal(fs.readFileSync(new URL('../Takodeal-POS/attendance-schedule-preview.js',import.meta.url),'utf8'),fs.readFileSync(new URL('../takodeal-staff/attendance-schedule-preview.js',import.meta.url),'utf8'));
});

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
test('the actual Staff schedule reader rejects pending/cache evidence and guards session changes',async()=>{
 const first=source.indexOf('    const readFreshPunchSchedule=async at=>'),last=source.indexOf('\n\n    try {',first);assert.ok(first>0&&last>first);
 const make=new AsyncFunction('createScheduleHistoryStore','getDocFromServer','assertPunchIdentity','db','doc',source.slice(first,last)+';return readFreshPunchSchedule(new Date("2026-10-29T01:57:00Z"));');
 let calls=0;const factory=api=>({loadRange:async(from,to)=>{assert.equal(+to-+from,172800000);await api.getDocFromServer('settings/global_schedule');return 'fresh';}});
 assert.equal(await make(factory,async()=>{calls++;return {exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false}};},()=>{}, {},()=>{}),'fresh');assert.equal(calls,1);
 for(const metadata of [{fromCache:true},{hasPendingWrites:true}])await assert.rejects(make(factory,async()=>({exists:()=>true,metadata}),()=>{}, {},()=>{}),/could not be confirmed with HQ/);
 await assert.rejects(make(factory,async()=>({exists:()=>true}),()=>{throw Error('Changed employee');}, {},()=>{}),/Changed employee/);
});
const start=source.indexOf('            // Slow proof, HR and camera checks must not save an earlier roster.');
const endMarker='            if(!(Number(attendance.lateMinutes)>3))pendingLateRequest=null;';
assert.ok(start>0);const finalCode=source.slice(start,source.indexOf(endMarker,start)+endMarker.length);
async function runFinal({after=saved(),late=0,request=null,locationAge=0}={}){
 const now=Date.parse('2026-10-29T01:57:00Z');class Clock extends Date{constructor(value=now){super(value);}static now(){return now;}}
 let reads=0,guards=0;
 const run=new AsyncFunction('readFreshPunchSchedule','assertPunchIdentity','captureAttendanceSchedule','assertAttendanceScheduleUnchanged','resolveAttendanceShift','Date','punchSchedulePreview','initialRequest','punchLocation',`let punchScheduleData=null,pendingLateRequest=initialRequest;const attendance={},closestBranch='Cabantian',staffName='Toni Sample',punchScheduleProfiles={},window={assertAttendanceFaceFresh(){}},faceResult={};${finalCode};return {attendance,pendingLateRequest};`);
 const result=await run(async()=>{reads++;return {};},()=>{guards++;},()=>after,assertAttendanceScheduleUnchanged,()=>({lateMinutes:late}),Clock,saved(),request,{timestamp:now-locationAge});
 return {...result,reads,guards};
}
test('actual Staff final-save fragment rereads HQ and accepts unchanged exact hours',async()=>{
 const result=await runFinal();assert.equal(result.reads,1);assert.equal(result.guards,1);assert.equal(result.attendance.lateMinutes,0);
});
test('actual Staff final-save fragment refuses changed hours and stale location before a write',async()=>{
 await assert.rejects(runFinal({after:{...saved(),expectedStartAt:'2026-10-29T01:00:00Z'}}),/HQ updated/);
 await assert.rejects(runFinal({locationAge:60001}),/Location verification expired/);
});
test('actual Staff final-save fragment never silently creates an unexplained late punch',async()=>{
 await assert.rejects(runFinal({late:4}),/needs a lateness explanation/);
 const pending={proofImageUrl:'kept-private-draft'};const reviewed=await runFinal({late:5,request:pending});assert.equal(reviewed.pendingLateRequest,pending);
 const noLongerLate=await runFinal({late:0,request:pending});assert.equal(noLongerLate.pendingLateRequest,null);
});
test('Staff does not infer lateness for an unverified assignment',async()=>{
 const before={...saved(),wasScheduled:false,needsScheduleReview:true};
 const changed=source.slice(start,source.indexOf(endMarker,start)+endMarker.length);
 const run=new AsyncFunction('readFreshPunchSchedule','assertPunchIdentity','captureAttendanceSchedule','assertAttendanceScheduleUnchanged','resolveAttendanceShift','punchSchedulePreview',`let punchScheduleData=null,pendingLateRequest=null;const attendance={},closestBranch='Cabantian',staffName='Toni Sample',punchScheduleProfiles={},window={assertAttendanceFaceFresh(){}},faceResult={},punchLocation={timestamp:Date.now()};${changed};return attendance;`);
 const result=await run(async()=>({}),()=>{},()=>before,assertAttendanceScheduleUnchanged,()=>({lateMinutes:57}),before);assert.equal(result.lateMinutes,undefined);
});
