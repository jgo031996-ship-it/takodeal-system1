import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPayrollPreviewInputs} from '../takodeal-manager/payroll-loading.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const at=day=>new Date(day+'+08:00'),person={staffId:'staff-a',staffName:'Ann',branch:'Maa'};
const row=(id,type,time,extra={})=>({...person,id,type,timestamp:at(time),...extra});
const source=row('previous-in','TIME IN','2026-10-15T18:30:00',{photo:'never-return-this-photo'});
const finish=row('previous-out','TIME OUT','2026-10-16T03:00:00',{timeInLogId:source.id,timeInAt:'2030-01-01T12:00:00Z'});
const valid=[row('current-in','TIME IN','2026-10-16T09:00:00'),row('current-out','TIME OUT','2026-10-16T17:00:00',{timeInLogId:'current-in'})];
const options={start:'2026-10-16',end:'2026-10-31',fetchStartDate:at('2026-10-16T00:00:00'),trueStartDate:at('2026-10-16T00:00:00'),fetchEndDate:at('2026-11-01T12:00:00')};
const snapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:false,hasPendingWrites:false},forEach(fn){this.docs.forEach(fn);}});
const document=(id,saved,extra={})=>({id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>saved!==null,data:()=>saved,...extra});
function fixture({records=[finish,...valid],read=async ref=>document(ref.id,source),scoped=false}={}){
 const queries=[],lookups=[],staff=[{id:'staff-a',cashierName:'Ann',branch:'Maa'},{id:'staff-b',cashierName:'Beth',branch:'Cabantian'}];
 const email=scoped?'hr@example.test':'jgo031996@gmail.com';
 const api={db:{},auth:{currentUser:{uid:'account',email,emailVerified:true}},sessionUser:{uid:'account',email,permissions:['payroll'],allowedBranches:scoped?['Maa']:['All']},
  doc:(_db,table,id)=>({table,id}),collection:(_db,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:(...value)=>value,query:(ref,...filters)=>({...ref,filters}),
  async getDocsFromServer(ref){queries.push(ref);return snapshot(ref.table==='attendance_logs'?records:ref.table==='cashiers'?staff:[]);},
  async getDocFromServer(ref){lookups.push(ref);return read(ref);},async loadPayrollScheduleHistory(){return {historyMonths:{}};}};
 return {api,queries,lookups,records};
}
function plan(input){return planPayrollAttendance(input.attSnap.docs.map(doc=>({...doc.data(),id:doc.id})),{referenceRecords:input.attendanceReferenceRecords,cutoffStart:options.trueStartDate,cutoffEnd:at('2026-10-31T23:59:59')});}

test('an exact canonical boundary source clears a false orphan without changing the attendance range or adding prior payable work',async()=>{
 const f=fixture(),before=structuredClone(f.records),input=await loadPayrollPreviewInputs(f.api,options),result=plan(input);
 assert.deepEqual(f.lookups,[{table:'attendance_logs',id:source.id}]);assert.equal(input.attSnap.docs.length,3);assert.deepEqual(f.records,before);
 assert.equal(input.attendanceReferenceRecords.length,1);assert.equal(input.attendanceReferenceRecords[0].timestamp,source.timestamp);assert.equal(input.attendanceReferenceRecords[0].photo,undefined);
 assert.deepEqual(result.logs.map(row=>row.id),['current-in','current-out']);assert.equal(result.reviews.length,0);
 const query=f.queries.find(ref=>ref.table==='attendance_logs');assert.equal(query.filters.find(filter=>filter.field==='timestamp'&&filter.op==='>=').value,options.fetchStartDate);
});
test('only missing active closure sources are read and repeated links share one exact lookup',async()=>{
 const f=fixture({records:[finish,{...finish,id:'duplicate-out'},...valid,{...finish,id:'voided',timeInLogId:'not-read',status:'Voided'},{...finish,id:'deleted',timeInLogId:'also-not-read',deleted:true},{...finish,id:'wrong-kind',type:'TIME IN',timeInLogId:'malformed-link'}]});
 const input=await loadPayrollPreviewInputs(f.api,options);assert.deepEqual(f.lookups.map(ref=>ref.id),['previous-in']);assert.match(plan(input).reviews[0].reason,/More than one|missing or ambiguous/);
});
test('unsafe reference paths are held without issuing a document request',async()=>{
 for(const id of ['../another','a/b','.','..',3,{path:'other'}]){const f=fixture({records:[{...finish,timeInLogId:id},...valid]});const input=await loadPayrollPreviewInputs(f.api,options);assert.equal(f.lookups.length,0);assert.equal(plan(input).reviews.length,1);}
});
test('missing, failed, cached, pending and malformed source responses keep only the affected employee held',async()=>{
 const other=[row('beth-in','TIME IN','2026-10-17T09:00:00',{staffId:'staff-b',staffName:'Beth',branch:'Cabantian'}),row('beth-out','TIME OUT','2026-10-17T17:00:00',{staffId:'staff-b',staffName:'Beth',branch:'Cabantian',timeInLogId:'beth-in'})];
 const reads=[async ref=>document(ref.id,null),async()=>{throw Error('Synthetic denied read');},async ref=>document(ref.id,source,{metadata:{fromCache:true}}),async ref=>document(ref.id,source,{metadata:{hasPendingWrites:true}}),async()=>document('wrong-id',source),async ref=>document(ref.id,[]),async()=>({})];
 for(const read of reads){const f=fixture({records:[finish,...valid,...other],read}),input=await loadPayrollPreviewInputs(f.api,options),result=plan(input);assert.deepEqual(input.attendanceReferenceRecords,[]);assert.equal(result.heldNames.has('Ann'),true);assert.equal(result.heldNames.has('Beth'),false);assert.deepEqual(result.logs.map(row=>row.id),['beth-in','beth-out']);}
});
test('a source with a real identity, branch, type, status or time conflict remains held after hydration',async()=>{
 for(const changes of [{staffId:'staff-b',staffName:'Beth'},{branch:'Cabantian'},{type:'TIME OUT'},{status:'Voided'},{deleted:true},{timestamp:at('2026-10-16T04:00:00')},{timestamp:at('2026-10-13T18:30:00')},{timestamp:null}]){
  const f=fixture({read:async ref=>document(ref.id,{...source,...changes})}),input=await loadPayrollPreviewInputs(f.api,options),result=plan(input);assert.equal(input.attendanceReferenceRecords.length,1);assert.equal(result.heldNames.has('Ann'),true);assert.equal(result.logs.length,0);
 }
});
test('scope filtering runs before lookups and also filters a returned forbidden source',async()=>{
 const foreign={...finish,id:'foreign-out',staffId:'staff-b',staffName:'Beth',branch:'Cabantian',timeInLogId:'foreign-in'};
 for(const changes of [{branch:'Cabantian'},{staffId:'staff-b',staffName:'Beth',branch:'Maa'}]){const f=fixture({records:[finish,...valid,foreign],scoped:true,read:async ref=>document(ref.id,{...source,...changes})}),input=await loadPayrollPreviewInputs(f.api,options);assert.deepEqual(f.lookups.map(ref=>ref.id),['previous-in']);assert.deepEqual(input.attendanceReferenceRecords,[]);assert.equal(input.attSnap.docs.length,3);assert.equal(plan(input).heldNames.has('Ann'),true);}
});
test('account, permission and branch-scope changes during a source read invalidate the entire run',async()=>{
 for(const change of ['account','permission','branch']){const gate=deferred(),f=fixture({read:()=>gate.promise}),pending=loadPayrollPreviewInputs(f.api,options);await tick();assert.equal(f.lookups.length,1);if(change==='account')f.api.auth.currentUser={uid:'other'};else if(change==='permission')f.api.sessionUser.permissions=[];else f.api.sessionUser.allowedBranches=['Other'];gate.resolve(document(source.id,source));await assert.rejects(pending,/changed|verified|assigned/);}
});
test('source reads have four workers and never scan unrelated attendance history',async()=>{
 const gates=Array.from({length:9},deferred),started=[];let active=0,maxActive=0;
 const f=fixture({records:gates.map((_,index)=>({...finish,id:'out-'+index,timeInLogId:'in-'+index})),read:async ref=>{const index=Number(ref.id.slice(3));started.push(index);active++;maxActive=Math.max(maxActive,active);await gates[index].promise;active--;return document(ref.id,{...source,id:ref.id});}});
 const pending=loadPayrollPreviewInputs(f.api,options);await tick();assert.deepEqual(started,[0,1,2,3]);gates.slice(0,4).forEach(gate=>gate.resolve());await tick();assert.deepEqual(started,[0,1,2,3,4,5,6,7]);gates.slice(4,8).forEach(gate=>gate.resolve());await tick();gates[8].resolve();const input=await pending;assert.equal(input.attendanceReferenceRecords.length,9);assert.equal(maxActive,4);assert.equal(f.queries.filter(ref=>ref.table==='attendance_logs').length,1);
});
test('a source deadline retains the hold and retries share a still-pending physical read',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gate=deferred();let first=true;const f=fixture({read:ref=>first?gate.promise:Promise.resolve(document(ref.id,source))});
 const pending=loadPayrollPreviewInputs(f.api,{...options,timeoutMs:5});await tick();t.mock.timers.tick(5);assert.equal((await pending).attendanceReferenceRecords.length,0);
 assert.equal((await loadPayrollPreviewInputs(f.api,{...options,timeoutMs:5})).attendanceReferenceRecords.length,0);assert.equal(f.lookups.length,1);
 gate.resolve(document(source.id,source));await tick();first=false;const fresh=await loadPayrollPreviewInputs(f.api,{...options,timeoutMs:5});assert.equal(fresh.attendanceReferenceRecords.length,1);assert.equal(f.lookups.length,2);assert.equal(plan(fresh).reviews.length,0);
});
test('fresh completed refreshes re-read canonical sources instead of treating an old read as current',async()=>{
 let removed=false;const f=fixture({read:async ref=>document(ref.id,removed?null:source)});assert.equal(plan(await loadPayrollPreviewInputs(f.api,options)).reviews.length,0);removed=true;assert.equal(plan(await loadPayrollPreviewInputs(f.api,options)).reviews.length,1);assert.equal(f.lookups.length,2);
});
