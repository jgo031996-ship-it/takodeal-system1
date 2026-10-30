import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createStaffPayrollAttendanceReader,STAFF_PAYROLL_ATTENDANCE_FIELDS} from '../takodeal-staff/staff-payroll-reader.js';
import {ATTENDANCE_METADATA_FIELDS} from '../takodeal-staff/attendance-metadata-reader.js';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import * as sanctions from '../takodeal-staff/sanction-schedule.js';
import * as reconciliation from '../takodeal-staff/attendance-reconcile.js';
import * as deductionDetails from '../takodeal-staff/payroll-deduction-details.js';
import {planPayrollAttendance} from '../takodeal-staff/payroll-attendance.js';
import {createScheduleHistoryStore} from '../takodeal-staff/schedule-history.js';
import {onlineRefundReviewHTML} from '../takodeal-staff/online-refund-pay.js';
import {readStaffOwnerDeductionEstimate} from '../takodeal-staff/staff-owner-deductions.js';
import {isOwnerDeduction} from '../takodeal-staff/owner-deduction-model.js';
import {attendanceAmendmentReviewFingerprint} from '../takodeal-staff/attendance-amendment-review-model.js';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';

const base='projects/sample-project/databases/(default)/documents/attendance_logs/';
const readTime='2026-10-27T10:00:00.000Z';
const encoded=value=>value==null?{nullValue:null}:value instanceof Date?{timestampValue:value.toISOString()}:typeof value?.toMillis==='function'?{timestampValue:new Date(value.seconds*1000).toISOString().slice(0,19)+'.'+String(value.nanoseconds).padStart(9,'0')+'Z'}:Array.isArray(value)?{arrayValue:{values:value.map(encoded)}}:typeof value==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,encoded(item)]))}}:typeof value==='string'?{stringValue:value}:typeof value==='boolean'?{booleanValue:value}:Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
const equivalentValues=value=>value instanceof Date?{millis:+value}:typeof value?.toMillis==='function'?{millis:value.toMillis()}:Array.isArray(value)?value.map(equivalentValues):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,equivalentValues(item)])):value;
const documentFor=(row,fields=Object.keys(row).filter(key=>key!=='id'))=>({document:{name:base+row.id,fields:Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,encoded(row[key])]))},readTime});
const snapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>row})),forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>row}))});
const legacyUnion=(rows,staffId,names)=>[...new Map([...rows.filter(row=>names.includes(row.staffName)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))),...rows.filter(row=>row.staffId===staffId).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)))].map(row=>[row.id,row])).values()];
function projectedFetch(rows,onRequest=()=>{}){return async(url,options)=>{
 const query=JSON.parse(options.body).structuredQuery;onRequest({url,options,query});
 const filters=query.where.compositeFilter.filters,id=filters.find(row=>row.fieldFilter.field.fieldPath==='staffId').fieldFilter.value.stringValue,names=filters.find(row=>row.fieldFilter.field.fieldPath==='staffName').fieldFilter.value.arrayValue.values.map(row=>row.stringValue),fields=query.select.fields.map(row=>row.fieldPath);
 const selected=rows.filter(row=>row.staffId===id||names.includes(row.staffName)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
 return {ok:true,status:200,json:async()=>selected.length?selected.map(row=>documentFor(row,fields)):[{readTime}]};
};}
const create=(options={})=>createStaffPayrollAttendanceReader({projectId:'sample-project',apiKey:'public-sample',...options});
const request={staffId:'sample',names:['Test Staff','TEST']};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('one Rules-authorized OR target keeps all reference history and only payroll fields',async()=>{
 const rows=[{id:'a',staffId:'sample',staffName:'Previous Name',timestamp:new Date('2025-01-01'),penaltyAmount:25,photoBase64:'large secret photo'},{id:'b',staffName:'TEST',type:'TIME IN'},{id:'c',staffId:'other',staffName:'Test Staff'},{id:'d',staffName:'Not This Person'}],calls=[];
 const auth={currentUser:{uid:'phone-user',getIdToken:async()=>'sample-token'}},read=create({auth,getAppCheckToken:async()=>({token:'sample-app-check'}),fetch:projectedFetch(rows,call=>calls.push(call))});
 const result=await read(request),call=calls[0];
 assert.equal(calls.length,1);assert.equal(call.query.where.compositeFilter.op,'OR');assert.equal(call.query.from[0].collectionId,'attendance_logs');assert.equal(call.query.limit,undefined);assert.equal(call.query.orderBy,undefined);assert.equal(call.query.offset,undefined);
 assert.deepEqual(call.query.select.fields.map(row=>row.fieldPath),STAFF_PAYROLL_ATTENDANCE_FIELDS);assert.equal(ATTENDANCE_METADATA_FIELDS.includes('penaltyAmount'),false);assert.equal(STAFF_PAYROLL_ATTENDANCE_FIELDS.includes('photoBase64'),false);
 assert.deepEqual(result.docs.map(row=>row.id),legacyUnion(rows,'sample',request.names).map(row=>row.id));assert.equal(result.docs.find(row=>row.id==='a').data().penaltyAmount,25);assert.equal(result.docs.find(row=>row.id==='a').data().photoBase64,undefined);
 assert.equal(call.options.cache,'no-store');assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,'Bearer sample-token');assert.equal(call.options.headers['X-Firebase-AppCheck'],'sample-app-check');assert.match(call.url,/firestore\.googleapis\.com\/v1\/projects\/sample-project\/databases\/\(default\)\/documents:runQuery/);
 assert.deepEqual(result.metadata,{fromCache:false,hasPendingWrites:false});
});

test('nested timestamp review evidence and exact aliases survive without changing source records',async()=>{
 const at=new Date('2026-10-07T09:00:00.123Z'),row={id:'a',staffId:'sample',staffName:' Test Staff ',timestamp:at,timeInAt:at,lateMinutes:3,lateReviewHistory:[{at,lateExempted:true,nested:{values:[null,false,0,1.25,'saved']}}],lateAmendmentReview:{reviewedAt:at},scheduleSnapshot:{start:at,shiftId:'morning'},penaltyAmount:'12.50'};
 let query;const read=create({fetch:projectedFetch([row],call=>{query=call.query;})});const result=await read({staffId:'sample',names:[' Test Staff ','Test Staff','Test Staff']}),data=result.docs[0].data();
 assert.deepEqual(equivalentValues(data),equivalentValues(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id'))));assert.deepEqual(query.where.compositeFilter.filters[1].fieldFilter.value.arrayValue.values,[{stringValue:' Test Staff '},{stringValue:'Test Staff'}]);assert.equal(data.timestamp.toDate().toISOString(),at.toISOString());
 data.lateReviewHistory[0].nested.values[4]='changed';assert.equal(result.docs[0].data().lateReviewHistory[0].nested.values[4],'saved');assert.equal(row.lateReviewHistory[0].nested.values[4],'saved');
});

test('Timestamp-compatible decoding preserves nanoseconds and negative epochs through independent snapshot clones',async()=>{
 for(const [iso,seconds,nanoseconds]of[['2026-10-07T09:00:00.000000001Z',1791363600,1],['1969-12-31T23:59:59.999999999Z',-1,999999999],['1970-01-01T07:59:59.999999999+08:00',-1,999999999],['1960-01-01T00:00:00.123456789Z',-315619200,123456789]]){
  const read=create({fetch:async()=>({ok:true,json:async()=>[{document:{name:base+'a',fields:{staffId:{stringValue:'sample'},timestamp:{timestampValue:iso}}},readTime}]})}),result=await read(request),stamp=result.docs[0].data().timestamp;
  assert.equal(stamp.seconds,seconds);assert.equal(stamp.nanoseconds,nanoseconds);assert.equal(stamp.toMillis(),seconds*1000+nanoseconds/1e6);assert.equal(+stamp.toDate(),+new Date(stamp.toMillis()));stamp.nanoseconds=0;assert.equal(result.docs[0].data().timestamp.nanoseconds,nanoseconds);
 }
});

test('concurrent equivalent reads coalesce only while pending and give independent snapshots',async()=>{
 const ready=deferred();let count=0;const read=create({fetch:async()=>{count++;await ready.promise;return{ok:true,json:async()=>[documentFor({id:'a',staffId:'sample'})]};}});
 const a=read(request),b=read({...request,names:['TEST','Test Staff','TEST']});await tick();assert.equal(count,1);ready.resolve();const [left,right]=await Promise.all([a,b]);assert.notEqual(left,right);assert.notEqual(left.docs[0],right.docs[0]);await read(request);assert.equal(count,2);
});

test('different staff, aliases, or same-UID replacement account never share pending work',async()=>{
 let calls=0;const finish=deferred(),auth={currentUser:{uid:'same',getIdToken:async()=>'first'}},read=create({auth,fetch:async()=>{calls++;await finish.promise;return{ok:true,json:async()=>[{readTime}]};}});
 const a=read(request);await tick();const b=read({...request,names:['Other Alias']}),c=read({...request,staffId:'other'});await tick();auth.currentUser={uid:'same',getIdToken:async()=>'second'};const d=read(request);await tick();assert.equal(calls,4);finish.resolve();const result=await Promise.allSettled([a,b,c,d]);assert.deepEqual(result.map(row=>row.status),['rejected','rejected','rejected','fulfilled']);assert.equal(result[0].reason.code,'unauthenticated');
});

test('a closed coalesced view fails while another current view can complete',async()=>{
 const finish=deferred();let open=true,count=0;const read=create({fetch:async()=>{count++;await finish.promise;return{ok:true,json:async()=>[{readTime}]};}});
 const stale=read({...request,assertCurrent:()=>{if(!open)throw Error('closed first view');}}),current=read(request);await tick();open=false;finish.resolve();const result=await Promise.allSettled([stale,current]);assert.equal(count,1);assert.equal(result[0].status,'rejected');assert.match(result[0].reason.message,/closed first/);assert.equal(result[1].status,'fulfilled');
});

test('a changed account after token, network, or JSON waits cannot return another employee evidence',async()=>{
 for(const stage of ['token','fetch','json']){
  const finish=deferred();let called=0,bodyRead=0;const auth={currentUser:{uid:'one',getIdToken:async()=>{if(stage==='token')await finish.promise;return'token';}}};
  const read=create({auth,fetch:async()=>{called++;if(stage==='fetch')await finish.promise;return{ok:true,json:async()=>{bodyRead++;if(stage==='json')await finish.promise;return[{readTime}];}};}}),pending=read(request);await tick();auth.currentUser={uid:'two',getIdToken:async()=>'other'};finish.resolve();await assert.rejects(pending,error=>error.code==='unauthenticated');if(stage==='token')assert.equal(called,0);if(stage==='fetch')assert.equal(bodyRead,0);
 }
});

test('deadline bounds token and body waits; a late token never starts a request',async()=>{
 for(const stage of ['token','fetch','json']){
  const finish=deferred();let calls=0,signal;const auth={currentUser:{uid:'one',getIdToken:async()=>{if(stage==='token')await finish.promise;return'token';}}};
  const read=create({timeoutMs:15,auth,fetch:async(_url,options)=>{calls++;signal=options.signal;if(stage==='fetch')await finish.promise;return{ok:true,json:async()=>{if(stage==='json')await finish.promise;return[{readTime}];}};}});
  await assert.rejects(read(request),error=>error.code==='attendance/read-timeout');finish.resolve();await tick();if(stage==='token')assert.equal(calls,0);else assert.equal(signal.aborted,true);
 }
});

test('PIN-only legacy session sends no fabricated token and reads again after an empty result',async()=>{
 let calls=0;const read=create({auth:{currentUser:null},fetch:async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);return{ok:true,json:async()=>[{readTime}]};}});assert.equal((await read(request)).empty,true);await read(request);assert.equal(calls,2);
});

test('malformed, partial, duplicate, foreign and unprojected evidence fails closed',async()=>{
 const valid=documentFor({id:'a',staffId:'sample'}),cases=[[],{},[{}],[{readTime,skippedResults:1}],[valid,valid],[{document:{name:base+'wrong/child',fields:{}},readTime}],[documentFor({id:'a',staffId:'other',staffName:'Other'})],[documentFor({id:'a',staffId:'sample',photoBase64:'unexpected'})],[{...valid,document:{...valid.document,fields:{staffId:{stringValue:42}}}}],[{...valid,document:{...valid.document,fields:{staffId:{stringValue:'sample'},penaltyAmount:{doubleValue:Infinity}}}}],[{...valid,document:{...valid.document,name:valid.document.name.replace('sample-project','other-project')}}]];
 for(const payload of cases){const read=create({fetch:async()=>({ok:true,json:async()=>payload})});await assert.rejects(read(request),error=>error.code==='attendance/read-invalid');}
 const failed=create({fetch:async()=>({ok:true,json:async()=>{throw Error('broken JSON');}})});await assert.rejects(failed(request),error=>error.code==='attendance/read-invalid');
});

test('HTTP and streamed query errors stay explicit, with no cached failure or full-document fallback',async()=>{
 for(const [status,remote,code]of[[403,{status:'PERMISSION_DENIED',message:'Rules denied'},'permission-denied'],[503,null,'unavailable'],[200,{status:'RESOURCE_EXHAUSTED',message:'Quota'},'resource-exhausted']]){
  let calls=0;const read=create({fetch:async()=>{calls++;return{ok:status===200,status,json:async()=>remote?[{error:remote}]:[]};}});await assert.rejects(read(request),error=>error.code===code);await assert.rejects(read(request));assert.equal(calls,2);
 }
});

test('invalid requests and already closed views perform no token or attendance query',async()=>{
 let calls=0;const read=create({fetch:async()=>{calls++;throw Error('unexpected');}});
 for(const input of[{...request,staffId:'bad/id'},{...request,names:[]},{...request,names:[' ']},{...request,names:Array.from({length:11},(_,i)=>String(i))},{...request,assertCurrent:42}])await assert.rejects(read(input),error=>error.code==='invalid-argument');
 await assert.rejects(read({...request,assertCurrent:()=>{throw Error('locked');}}),/locked/);assert.equal(calls,0);assert.equal(createStaffPayrollAttendanceReader(),null);
});

const engine=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),vaultStart=engine.indexOf('window.loadPayslipVault = async function() {'),vaultEnd=engine.indexOf('// 🧾 THE UPGRADED PAYSLIP UI ENGINE',vaultStart),vault=engine.slice(vaultStart,vaultEnd);
const legacyAttendance=`const attQ = query(collection(db, "attendance_logs"), where("staffName", "in", [...new Set([staffName, nickname])].slice(0, 10)));
        const attendanceSources = await Promise.all([getDocs(attQ),getDocs(query(collection(db, "attendance_logs"), where("staffId", "==", staffId)))]);
        const attendanceRecords = new Map();
        attendanceSources.forEach(source=>source.forEach(row=>{const data=row.data();if(data.staffId?data.staffId===staffId:isMatch(data.staffName))attendanceRecords.set(row.id,{...data,id:row.id});}));
        `;
const legacyVault=vault.replace(/if\(typeof window\.readStaffPayrollAttendance[\s\S]*?(?=const attSnap =)/,legacyAttendance);
function runVault(logs,{legacy=false,read,clock='2026-10-08T12:00:00+08:00',staffId='sample',staffName='Test Staff',profile={},scheduleFactory=createScheduleHistoryStore}={}){
 const nodes=new Map(),errors=[],queries=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',innerText:'',textContent:'',style:{},parentElement:{insertAdjacentHTML(){},querySelector(){return null;}},appendChild(){},prepend(){}});return nodes.get(id);};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}}
 const match=(row,filters)=>filters.every(filter=>filter.op==='in'?filter.value.includes(row[filter.key]):row[filter.key]===filter.value);
 const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:(ref,...filters)=>({...ref,filters}),where:(key,op,value)=>({key,op,value}),orderBy:()=>({}),getDocFromServer:async ref=>({exists:()=>ref.table==='cashiers',data:()=>({hourlyRate:450,cashierName:staffName,scheduleNickname:'TEST',branch:'Maa',nightDiffRate:0,...profile})}),getDocs:async ref=>{queries.push(ref);return snapshot(ref.table==='attendance_logs'?logs.filter(row=>match(row,ref.filters)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))):[]);}};
 const context={...api,...payroll,...sanctions,...reconciliation,...deductionDetails,planPayrollAttendance,onlineRefundReviewHTML,readStaffOwnerDeductionEstimate,isOwnerDeduction,createScheduleHistoryStore:scheduleFactory,Date:FixedDate,console:{error:(...error)=>errors.push(error)},window:{...api,readStaffPayrollAttendance:read,staffVaultSession:{epoch:1,allows:()=>true}},localStorage:{getItem:key=>key.endsWith('_id')?staffId:staffName},document:{getElementById:node}};
 vm.runInNewContext(legacy?legacyVault:vault,context);
 return {node,errors,queries,load:()=>context.window.loadPayslipVault(),context,result:()=>Object.fromEntries([...nodes].map(([key,value])=>[key,{text:value.innerText,html:value.innerHTML}]))};
}
const date=value=>new Date(value),own={staffId:'sample',staffName:'Test Staff',branch:'Maa'};
async function equivalentVault(logs,options={}){const old=runVault(logs,{...options,legacy:true}),current=runVault(logs,{...options,read:create({fetch:projectedFetch(logs)})});await old.load();await current.load();assert.deepEqual(old.errors,[]);assert.deepEqual(current.errors,[]);assert.deepEqual(current.result(),old.result());return{old,current};}

test('actual vault pay stays identical with saved late decisions and manual penalties on both punches and standalone logs',async()=>{
 const logs=[{...own,id:'a',type:'TIME IN',lateMinutes:120,reviewedLateMinutes:5,lateReviewedAt:date('2026-10-06T10:00:00+08:00'),lateReviewedBy:'HQ',lateReviewHistory:[{at:date('2026-10-06T10:00:00+08:00'),action:'review'}],penaltyAmount:12.50,timestamp:date('2026-10-06T09:00:00+08:00')},{...own,id:'b',type:'TIME OUT',timeInLogId:'a',penaltyAmount:'7.50',timestamp:date('2026-10-06T17:00:00+08:00')},{...own,id:'c',type:'MANUAL PENALTY',penaltyAmount:30,timestamp:date('2026-10-07T10:00:00+08:00')},{...own,id:'d',type:'TIME IN',lateMinutes:120,lateExempted:true,penaltyAmount:0,timestamp:date('2026-10-07T09:00:00+08:00')},{...own,id:'e',type:'TIME OUT',timeInLogId:'d',timestamp:date('2026-10-07T17:00:00+08:00')}];
 const {current}=await equivalentVault(logs);assert.equal(current.node('liveEstGross').innerText,'₱900.00');assert.equal(current.node('liveEstLates').innerText,'-₱106.25');assert.equal(current.node('liveEstNetPay').innerText,'₱793.75');assert.match(current.node('liveCutoffDetailedLogs').innerHTML,/20\.00 Manual Penalty/);assert.match(current.node('liveCutoffDetailedLogs').innerHTML,/30\.00 Manual Penalty/);
});

test('actual vault preserves renamed IDs, legacy aliases, foreign-ID exclusion and adjacent linked boundary ordering',async()=>{
 const logs=[{...own,staffName:'Previous Name',id:'old-in',type:'TIME IN',lateExempted:true,timestamp:date('2026-10-06T09:00:00+08:00')},{...own,staffName:'Previous Name',id:'old-out',type:'TIME OUT',timeInLogId:'old-in',timestamp:date('2026-10-06T17:00:00+08:00')},{staffName:'TEST',branch:'Maa',id:'a',type:'TIME IN',lateExempted:true,timestamp:date('2026-10-07T09:00:00+08:00')},{staffName:'TEST',branch:'Maa',id:'b',type:'TIME IN',lateExempted:true,timestamp:date('2026-10-07T12:00:00+08:00')},{staffName:'TEST',branch:'Maa',id:'oa',type:'TIME OUT',timeInLogId:'a',timestamp:date('2026-10-07T12:00:00+08:00')},{staffName:'TEST',branch:'Maa',id:'ob',type:'TIME OUT',timeInLogId:'b',timestamp:date('2026-10-07T20:00:00+08:00')},{...own,staffId:'another',id:'foreign',type:'MANUAL PENALTY',penaltyAmount:999,timestamp:date('2026-10-07T10:00:00+08:00')}];
 const {current}=await equivalentVault(logs);assert.equal(current.node('liveEstGross').innerText,'₱1,350.00');assert.equal(current.node('liveEstLates').innerText,'-₱0.00');assert.doesNotMatch(current.node('liveCutoffDetailedLogs').innerHTML,/999|HR REVIEW/);
});

test('actual vault retains outside-cutoff closure references and later conflicting closures',async()=>{
 const logs=[{...own,id:'previous',type:'TIME IN',lateExempted:true,timestamp:date('2026-09-30T22:00:00+08:00')},{...own,id:'closure',type:'TIME OUT',timeInLogId:'previous',timestamp:date('2026-10-01T06:00:00+08:00')},{...own,id:'in',type:'TIME IN',lateExempted:true,timestamp:date('2026-10-07T09:00:00+08:00')},{...own,id:'out',type:'TIME OUT',timeInLogId:'in',timestamp:date('2026-10-07T17:00:00+08:00')}];
 const {current}=await equivalentVault(logs);assert.equal(current.node('liveEstGross').innerText,'₱450.00');assert.doesNotMatch(current.node('liveCutoffDetailedLogs').innerHTML,/HR REVIEW/);assert.match(current.node('payslipPendingList').innerHTML,/450\.00/);
 // A second later closure is outside the visible cutoff but must still hold
 // the original linked shift, rather than infer an apparently payable pair.
 const duplicate={...own,id:'later-out',type:'TIME OUT',timeInLogId:'in',timestamp:date('2026-10-20T10:00:00+08:00')};
 const held=await equivalentVault([...logs,duplicate]);assert.equal(held.current.node('liveEstNetPay').innerText,'Held for HR review');assert.match(held.current.node('liveCutoffDetailedLogs').innerHTML,/More than one Time Out/);
});

test('actual vault retains an amendment hold and its exact saved HQ review outcome including nested timestamps',async()=>{
 const f=await amendmentFixture(),log=f.withId(),close={...f.get('attendance_logs/sample-out'),id:'sample-out'},options={staffId:f.staffId,staffName:f.name,profile:f.profile,clock:'2026-10-21T12:00:00+08:00',scheduleFactory:()=>({loadRange:async()=>f.history})};
 const held=await equivalentVault([log,close],options);assert.equal(held.current.node('liveEstNetPay').innerText,'Held for HR review');assert.match(held.current.node('liveScheduleHistoryNotice').textContent,/saved lateness decision/);
 const marker={version:1,revision:1,auditId:'amendment-'+log.id+'-1',sourceFingerprint:attendanceAmendmentReviewFingerprint(log,f.shift()),choice:'Use corrected schedule minutes',lateMinutes:0,exempt:false,actorUid:'sample-owner',actorEmail:f.email,reviewedAt:f.now,reason:'Confirmed exact workday correction.'};
 const reviewed=await equivalentVault([{...log,scheduleAmendmentReview:marker},close],options);assert.equal(reviewed.current.node('liveEstGross').innerText,'₱450.00');assert.equal(reviewed.current.node('liveEstLates').innerText,'-₱0.00');assert.equal(reviewed.current.node('liveEstNetPay').innerText,'₱450.00');
});

test('actual vault still holds overlapping sub-millisecond punches that Date-only decoding would make payable',async()=>{
 const precise=(whole,nanoseconds)=>{const seconds=+new Date(whole)/1000;return{seconds,nanoseconds,toMillis(){return seconds*1000+nanoseconds/1e6;},toDate(){return new Date(this.toMillis());}};};
 const logs=[{...own,id:'a-in',type:'TIME IN',lateExempted:true,timestamp:precise('2026-10-07T09:00:00+08:00',0)},{...own,id:'a-out',type:'TIME OUT',timeInLogId:'a-in',timestamp:precise('2026-10-07T17:00:00+08:00',600000)},{...own,id:'b-in',type:'TIME IN',lateExempted:true,timestamp:precise('2026-10-07T17:00:00+08:00',400000)},{...own,id:'b-out',type:'TIME OUT',timeInLogId:'b-in',timestamp:precise('2026-10-08T01:00:00+08:00',0)}];
 const {current}=await equivalentVault(logs);assert.equal(current.node('liveEstNetPay').innerText,'Held for HR review');assert.equal(current.node('liveEstGross').innerText,'Held for HR review');assert.match(current.node('liveCutoffDetailedLogs').innerHTML,/overlap/);
});

test('every saved log field consumed directly by the actual vault is retained by the payroll projection',()=>{
 const fields=[...new Set([...vault.matchAll(/\blog\.([A-Za-z_]\w*)/g)].map(match=>match[1]))];for(const field of fields)assert.ok(field==='id'||STAFF_PAYROLL_ATTENDANCE_FIELDS.includes(field),'Missing payroll attendance field '+field);
});

test('actual vault network/projection failure follows existing error path without inferred pay or full attendance reads',async()=>{
 const read=create({fetch:async()=>({ok:false,status:503,json:async()=>({error:{status:'UNAVAILABLE',message:'network failure'}})})}),current=runVault([],{read});await current.load();assert.equal(current.node('liveEstNetPay').innerText,'Error');assert.equal(current.errors.length,1);assert.equal(current.queries.filter(row=>row.table==='attendance_logs').length,0);
});

test('synthetic duplicate-photo fixture demonstrates requested read and transfer reduction without dropping manual penalties',async()=>{
 const rows=Array.from({length:20},(_,i)=>({...own,id:'record-'+String(i).padStart(2,'0'),type:i%2?'TIME OUT':'TIME IN',timestamp:new Date(Date.UTC(2026,9,1+i,1)),penaltyAmount:i/2,photoBase64:'A'.repeat(100000)}));
 const oldPayload=[...rows,...rows].map(row=>documentFor(row)),newPayload=rows.map(row=>documentFor(row,STAFF_PAYROLL_ATTENDANCE_FIELDS)),calls=[];
 const result=await create({fetch:projectedFetch(rows,call=>calls.push(call))})(request);
 const oldBytes=Buffer.byteLength(JSON.stringify(oldPayload)),newBytes=Buffer.byteLength(JSON.stringify(newPayload));
 assert.equal(oldPayload.length,40);assert.equal(result.docs.length,20);assert.equal(calls.length,1);assert.ok(newBytes<oldBytes/100);assert.equal(result.docs.reduce((sum,row)=>sum+row.data().penaltyAmount,0),95);
});
