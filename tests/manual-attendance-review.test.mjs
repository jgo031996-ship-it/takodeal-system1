import test from 'node:test';
import assert from 'node:assert/strict';
import {manualTimeOutReferences,prepareManualTimeOut} from '../takodeal-manager/manual-attendance-review.js';
import {createHash} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createOwnerTimeOutClient} from '../takodeal-manager/owner-time-out-client.js';
import {createOwnerTimeOutHandler,OWNER_TIME_OUT_ORIGIN} from '../functions/cash-remittance-review/owner-time-out-handler.mjs';
import {createOwnerTimeOutStore} from '../functions/cash-remittance-review/owner-time-out-store.mjs';

const payload={staffId:'fiction-staff',staffName:'Fictional Crew',branch:'Sample Branch',type:'TIME OUT',timestamp:new Date('2026-10-06T03:32:00+08:00'),remarks:'The branch confirmed this actual departure.'};
const original={id:'fiction-in',staffId:payload.staffId,staffName:payload.staffName,branch:payload.branch,type:'TIME IN',timestamp:new Date('2026-10-05T18:23:00+08:00')};
function fixture(){
 const api={auth:{currentUser:{uid:'fiction-owner',email:'owner@example.invalid'}}},requests=[];let inspections=0;
 const client={inspect:async context=>{inspections++;return{context,staffId:payload.staffId,branch:payload.branch,timeInAt:original.timestamp.toISOString(),expectedFingerprint:'f'.repeat(64),canSave:true,paidCutoffs:[]};},save:async request=>{requests.push(request);return{saved:true,id:'fiction-out'};}};
 const options={operationId:'fiction-operation',readAttendance:async()=>[original],client};
 return{api,client,requests,options,inspections:()=>inspections,prepare:extra=>prepareManualTimeOut(api,payload,{...options,...extra})};
}
test('manual departure references use the saved employee, branch and actual 18-hour interval without assigning another person or changing a punch',()=>{
 const rows=[original,{...original,id:'other-staff',staffId:'other'},{...original,id:'other-branch',branch:'Elsewhere'},{...original,id:'future',timestamp:new Date('2026-10-06T04:00:00+08:00')},{...original,id:'too-old',timestamp:new Date('2026-10-05T01:00:00+08:00')},{...original,id:'cancelled',status:'Cancelled'}],before=structuredClone(rows);
 assert.deepEqual(manualTimeOutReferences(rows,payload).map(row=>row.id),['fiction-in']);assert.deepEqual(rows,before);
});
test('one original is selected by identity and the existing service receives the exact entered overnight departure and reason',async()=>{
 const f=fixture(),prepared=await f.prepare();assert.equal(f.requests.length,0);assert.equal(prepared.request.context.attendanceLogId,original.id);assert.equal(prepared.request.dateTimeRaw,'2026-10-06T03:32:00');assert.equal(prepared.request.reason,payload.remarks);assert.equal(prepared.request.managementReply,payload.remarks);assert.equal(prepared.request.confirmActualDeparture,true);assert.equal(prepared.request.acceptReason,false);assert.equal(prepared.request.operationId,'fiction-operation');assert.equal(prepared.request.expectedFingerprint,'f'.repeat(64));await prepared.save();assert.equal(f.requests.length,1);assert.equal(f.inspections(),1);
});
test('ambiguous originals are never selected by proximity and require an explicit saved reference',async()=>{
 const f=fixture(),second={...original,id:'second-in',timestamp:new Date('2026-10-05T19:00:00+08:00')},readAttendance=async()=>[original,second];
 await assert.rejects(f.prepare({readAttendance}),/Choose the exact original/);assert.equal(f.inspections(),0);assert.equal(f.requests.length,0);
 const prepared=await f.prepare({readAttendance,chooseReference:async choices=>{assert.deepEqual(choices.map(row=>row.id),['second-in','fiction-in']);return original.id;}});assert.equal(prepared.request.context.attendanceLogId,original.id);
 await assert.rejects(f.prepare({readAttendance,chooseReference:async()=> 'invented-source'}),/selected original Time In changed/);
});
test('a missing original, invalid saved attendance time or a paid cutoff cannot create a second manual departure',async()=>{
 const f=fixture();await assert.rejects(f.prepare({readAttendance:async()=>[]}),/No original Time In/);await assert.rejects(f.prepare({readAttendance:async()=>[{...original,timestamp:null}]}),/saved attendance time/);
 f.client.inspect=async context=>({context,canSave:false,paidCutoffs:[{id:'fiction-paid',from:'2026-10-01',to:'2026-10-15'}]});await assert.rejects(f.prepare(),/paid payslip covers/);assert.equal(f.requests.length,0);
});
test('an original changed during Owner inspection is rejected before the explicit confirmation or save',async()=>{
 const f=fixture(),inspect=f.client.inspect;f.client.inspect=async context=>({...await inspect(context),timeInAt:'2026-10-05T09:00:00.000Z'});await assert.rejects(f.prepare(),/original Time In changed/);assert.equal(f.requests.length,0);
});
test('a lost acknowledgement retries the identical reviewed operation without reading a new source or generating a different fingerprint',async()=>{
 const f=fixture();let first=true;f.client.save=async request=>{f.requests.push(request);if(first){first=false;throw Error('Synthetic response lost after commit');}return{alreadySaved:true,id:'fiction-out'};};const prepared=await f.prepare();await assert.rejects(prepared.save(),/lost after commit/);const retry=await f.prepare({readAttendance:async()=>{throw Error('Must preserve the uncertain intent');}});assert.equal(retry,prepared);assert.equal((await retry.save()).alreadySaved,true);assert.equal(f.inspections(),1);assert.equal(f.requests.length,2);assert.equal(f.requests[0],f.requests[1]);
});
test('a known rejected stale review can refresh the same entered facts instead of retaining an obsolete source fingerprint',async()=>{
 const f=fixture();f.client.save=async()=>{throw Object.assign(Error('Synthetic known stale source rejection'),{status:409});};const prepared=await f.prepare();await assert.rejects(prepared.save(),/known stale/);const refreshed=await f.prepare();assert.notEqual(refreshed,prepared);assert.equal(f.inspections(),2);
});
test('a stale actor or newer form prevents a pending inspection and an already prepared manual departure from saving',async()=>{
 const f=fixture();let current=true;const assertCurrent=()=>{if(!current)throw Error('The selected attendance changed');};const prepared=await f.prepare({assertCurrent});current=false;await assert.rejects(prepared.save(),/selected attendance changed/);assert.equal(f.requests.length,0);await assert.rejects(f.prepare({assertCurrent}),/selected attendance changed/);
});
test('manual review runs through the actual Owner client and existing server contract, including reason acceptance and a lost response, with one audited departure',async()=>{
 for(const hasRequest of [false,true]){
  const h=firestoreHarness(),clock=Date.parse('2026-10-07T12:00:00+08:00'),email='jgo031996@gmail.com';
  const native=snap=>({id:snap.id,exists:snap.exists(),data:snap.data});
  const db={doc:path=>({path,id:path.split('/')[1]}),collection:table=>({table,where(field,op,value){return{...this,filters:[{field,op,value}]};},limit(max){return{...this,max};},select(...fields){return{...this,fields};}}),runTransaction:callback=>h.api.runTransaction({},outer=>callback({async get(ref){if(!ref.table)return native(await outer.get(ref));const docs=[];for(const [path,row]of h.docs)if(path.startsWith(ref.table+'/')&&ref.filters.every(filter=>row[filter.field]===filter.value)){const saved=await outer.get(db.doc(path)),value=saved.data();docs.push({id:saved.id,data:()=>ref.fields?Object.fromEntries(ref.fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])):value});if(docs.length>=ref.max)break;}return{docs,size:docs.length};},set:(ref,row)=>outer.set(ref,row),update:(ref,row)=>outer.update(ref,row),create(ref,row){assert.equal(h.docs.has(ref.path),false);outer.set(ref,row);}}))};
  h.put('hq_managers/fiction-owner',{email,role:'Owner',permissions:['all'],assignedBranch:'All',active:true,pin:'fiction-only'});h.put('cashiers/'+payload.staffId,{cashierName:payload.staffName,branch:payload.branch,active:true,pin:'fiction-only'});h.put('attendance_logs/'+original.id,structuredClone(original));
  const hash=createHash('sha256').update(JSON.stringify([payload.staffId,original.id])).digest('hex'),requestId='early-'+hash;
  if(hasRequest)h.put('staff_requests/'+requestId,{type:'Early Time Out',schemaVersion:1,status:'Pending',staffId:payload.staffId,staffName:payload.staffName,branch:payload.branch,timeInLogId:original.id,timeInAt:original.timestamp.toISOString(),requestedDepartureAt:payload.timestamp.toISOString(),reason:'Fictional staff explanation for actual departure.',requestVersion:1,requestToken:'fiction-request-token'});
  const beforeIn=structuredClone(h.get('attendance_logs/'+original.id)),actor={uid:'fiction-owner',email,email_verified:true,firebase:{sign_in_provider:'google.com'}};
  const handler=createOwnerTimeOutHandler({store:createOwnerTimeOutStore(db,{serverTimestamp:()=>new Date(clock),now:()=>clock}),now:()=>clock,verifyToken:async()=>actor});
  const api={auth:{currentUser:{uid:actor.uid,email,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'fictional-token-for-local-test-only'}},sessionUser:{uid:actor.uid,email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true};
  let loseResponse=true;const sent=[];
  const client=createOwnerTimeOutClient(api,{fetch:async(url,options)=>{const body=JSON.parse(options.body);sent.push(body);const response=await handler({method:'POST',path:'/owner-time-out/'+url.split('/').at(-1),origin:OWNER_TIME_OUT_ORIGIN,query:{},contentType:'application/json',authorization:options.headers.Authorization,rawSize:Buffer.byteLength(options.body),body});if(url.endsWith('/confirm')&&response.status===200&&loseResponse){loseResponse=false;throw Error('Synthetic response lost after actual server commit');}return{ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.body};}});
  const options={operationId:'fiction-manual-operation-001',readAttendance:async()=>[original],client},prepared=await prepareManualTimeOut(api,payload,options);assert.equal(prepared.request.acceptReason,hasRequest);await assert.rejects(prepared.save(),/lost after actual server commit/);const facts=()=>[...h.docs].filter(([path])=>!path.startsWith('cash_remittance_attempts/')),committed=structuredClone(facts()),retry=await prepareManualTimeOut(api,payload,options);assert.equal((await retry.save()).alreadySaved,true);assert.deepEqual(facts(),committed);assert.deepEqual(h.get('attendance_logs/'+original.id),beforeIn);assert.equal(h.get('attendance_logs/time-out-'+hash).timestamp.toISOString(),payload.timestamp.toISOString());assert.equal([...h.docs.keys()].filter(path=>path.startsWith('attendance_relief_reviews/')).length,1);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,2);assert.equal([...h.docs.keys()].some(path=>/^(cash_accounts|expenses|payroll_records)\//.test(path)),false);assert.equal(sent.filter(body=>body.operationId).every(body=>body.confirmActualDeparture===true&&body.managementReply===payload.remarks),true);if(hasRequest){assert.equal(h.get('staff_requests/'+requestId).status,'Approved');assert.equal(h.get('staff_requests/'+requestId).reasonAccepted,true);}
 }
});
