import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createOwnerTimeOutHandler,OWNER_TIME_OUT_ORIGIN} from '../functions/cash-remittance-review/owner-time-out-handler.mjs';
import {createOwnerTimeOutStore} from '../functions/cash-remittance-review/owner-time-out-store.mjs';
import {actualTimeOutInstant,TIME_OUT_KIND,createOwnerTimeOutService} from '../functions/cash-remittance-review/owner-time-out-service.mjs';
import {validEarlyTimeOutApproval} from '../takodeal-manager/early-time-out-model.js';
const email='jgo031996@gmail.com',staffId='fictional-employee',startId='fictional-time-in',name='Fictional Branch Cashier';
const start=new Date('2026-11-02T14:04:00+08:00'),oldOut=new Date('2026-11-02T15:30:00+08:00'),actual=new Date('2026-11-03T03:28:00+08:00'),clock=Date.parse('2026-11-05T12:00:00+08:00');
const canonicalOut='time-out-'+createHash('sha256').update(JSON.stringify([staffId,startId])).digest('hex'),canonicalRequest='early-'+canonicalOut.slice(9);
async function fixture({existing=true,legacy=false,request=true,emergency=false}={}){
 const h=firestoreHarness(),queryCalls=[],verifyCalls=[];let physical=0;
 const native=snap=>({id:snap.id,exists:snap.exists(),data:snap.data});
 const db={doc:path=>({path,id:path.split('/')[1]}),collection:table=>({table,where(field,op,value){return {...this,filters:[{field,op,value}]};},limit(n){return {...this,max:n};},select(...fields){return {...this,fields};}}),runTransaction:callback=>{physical++;return h.api.runTransaction({},outer=>callback({async get(ref){if(!ref.table)return native(await outer.get(ref));queryCalls.push(ref);const docs=[];for(const [path,row]of h.docs)if(path.startsWith(ref.table+'/')&&ref.filters.every(f=>row[f.field]===f.value)){const snap=await outer.get(db.doc(path)),data=snap.data();docs.push({id:snap.id,data:()=>ref.fields?Object.fromEntries(ref.fields.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])):data});if(docs.length>=ref.max)break;}return {docs,size:docs.length};},set:(ref,row)=>outer.set(ref,row),update:(ref,row)=>outer.update(ref,row),create(ref,row){assert.equal(h.docs.has(ref.path),false,'immutable create cannot overwrite');outer.set(ref,row);}}));}};
 const marker={version:1,homeBranch:'Maa',branch:'Cabantian',requiresReview:true},outId=legacy?'legacy-departure':canonicalOut;
 h.put('hq_managers/owner',{email,role:'Owner',pin:'fictional-owner-pin',active:true,assignedBranch:'All',permissions:['all']});
 h.put('cashiers/'+staffId,{cashierName:name,branch:emergency?'Maa':'Cabantian',active:true,pin:'fictional-staff-secret'});
 h.put('attendance_logs/'+startId,{staffId,staffName:name,branch:'Cabantian',type:'TIME IN',timestamp:start,photoBase64:'PRIVATE_ATTENDANCE_PHOTO',...(emergency?{emergencyRelief:marker}: {})});
 if(existing)h.put('attendance_logs/'+outId,{staffId,staffName:name,branch:'Cabantian',type:'TIME OUT',timestamp:oldOut,photoBase64:'PRIVATE_OUT_PHOTO',...(!legacy?{timeInLogId:startId,timeInAt:start.toISOString(),attendanceVersion:2}:{}),...(emergency?{emergencyRelief:marker,reliefRequestId:canonicalRequest}:{})});
 if(request)h.put('staff_requests/'+canonicalRequest,{type:'Early Time Out',schemaVersion:1,status:'Pending',staffId,staffName:name,branch:'Cabantian',timeInLogId:startId,timeInAt:start.toISOString(),timestamp:actual,requestedDepartureAt:actual.toISOString(),reason:'Assigned to emergency renovation support.',requestVersion:1,requestToken:'fictional-request-token',...(emergency?{emergencyRelief:marker,requiresScheduleReview:true}:{})});
 const actor={uid:'fiction-owner',email,email_verified:true,firebase:{sign_in_provider:'google.com'}},store=createOwnerTimeOutStore(db,{serverTimestamp:()=>new Date(clock),now:()=>clock}),handler=createOwnerTimeOutHandler({store,now:()=>clock,verifyToken:async(token,revoked)=>{verifyCalls.push([token,revoked]);return actor;}}),context={attendanceLogId:startId,staffId,branch:'Cabantian',...(request?{requestId:canonicalRequest}:{})};
 const call=(path,body,extra={})=>handler({method:'POST',path:'/owner-time-out/'+path,origin:OWNER_TIME_OUT_ORIGIN,query:{},contentType:'application/json',authorization:'Bearer '+'t'.repeat(24),rawSize:Buffer.byteLength(JSON.stringify(body)),body,...extra});
 const input=async(extra={})=>{const response=await call('inspect',{context});assert.equal(response.status,200,response.body.message);return {context:response.body.context,expectedFingerprint:response.body.expectedFingerprint,operationId:'fiction-operation-001',dateTimeRaw:'2026-11-03T03:28',reason:'Confirmed the actual departure with the branch attendance evidence.',managementReply:'Your actual departure has been reviewed and recorded.',confirmActualDeparture:true,acceptReason:!!response.body.request,...extra};};
 return {h,db,store,handler,service:createOwnerTimeOutService({store,now:()=>clock}),actor,context,outId,marker,queryCalls,verifyCalls,physical:()=>physical,call,input};
}

test('Owner amendments use the same departure ID, private immutable evidence and exact operation receipt',async()=>{
 const f=await fixture(),input=await f.input(),beforeIn=structuredClone(f.h.get('attendance_logs/'+startId)),beforeOut=structuredClone(f.h.get('attendance_logs/'+f.outId)),count=f.physical(),result=await f.call('confirm',input);
 assert.equal(result.status,200,result.body.message);assert.equal(result.body.saved,true);assert.equal(result.body.id,f.outId);assert.equal(result.body.timestamp,actual.toISOString());assert.equal(result.body.actualTimeOutAt,actual.toISOString());assert.equal(result.body.operationId,input.operationId);assert.match(result.body.auditId,/^timeout-[a-f0-9]{64}$/);assert.equal(f.physical()-count,2);
 assert.deepEqual(f.h.get('attendance_logs/'+startId),beforeIn);const after=f.h.get('attendance_logs/'+f.outId);assert.equal(+after.timestamp,+actual);assert.equal(after.type,beforeOut.type);assert.equal(after.photoBase64,beforeOut.photoBase64);assert.equal(after.reliefScheduleReview.kind,TIME_OUT_KIND);
 const audit=f.h.get('attendance_relief_reviews/'+result.body.auditId);assert.equal(+audit.originalTimeOut.timestamp,+oldOut);assert.equal(+audit.originalTimeIn.timestamp,+start);assert.equal(audit.requestBefore.status,'Pending');assert.equal(audit.reason,input.reason);assert.equal(JSON.stringify(audit).includes('PRIVATE_ATTENDANCE_PHOTO'),false);assert.equal(JSON.stringify(audit).includes('PRIVATE_OUT_PHOTO'),false);
 const request=f.h.get('staff_requests/'+canonicalRequest);assert.equal(request.status,'Approved');assert.equal(request.reasonAccepted,true);assert.equal(request.actualTimeOutRecorded,true);assert.equal(request.actualTimeOutAt,actual.toISOString());assert.equal(request.timeOutLogId,f.outId);assert.equal(request.requestVersion,2);assert.notEqual(request.requestToken,'fictional-request-token');assert.match(request.decisionScope,/permissions were not changed/);
 assert.equal(f.queryCalls.filter(q=>q.table==='attendance_logs').every(q=>q.max<=5001&&q.fields&&!q.fields.includes('photoBase64')),true);assert.equal(f.verifyCalls.every(row=>row[1]===true),true);
 assert.equal(validEarlyTimeOutApproval(request,null,{staffId,staffName:name,branch:'Cabantian',timeInLogId:startId},actual),false);
 assert.equal(JSON.stringify(result.body).includes('fictional-staff-secret'),false);
});

test('an uncertain successful save retries the same operation without another departure or audit',async()=>{
 const f=await fixture(),input=await f.input(),first=await f.call('confirm',input),second=await f.call('confirm',input);assert.equal(first.status,200);assert.equal(second.status,200,second.body.message);assert.equal(second.body.alreadySaved,true);assert.equal(second.body.operationId,input.operationId);assert.equal(second.body.timestamp,actual.toISOString());assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_relief_reviews/')).length,1);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,2);
 const view=(await f.call('inspect',{context:f.context})).body;assert.equal(view.lastOperationId,input.operationId);assert.equal(view.existingTimeOut.operationId,input.operationId);assert.equal(view.request.actualTimeOutAt,actual.toISOString());
 const wrong=await f.call('confirm',{...input,dateTimeRaw:'2026-11-03T03:29'});assert.equal(wrong.status,409);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+actual);
});

test('a rejected atomic commit changes neither departure nor request and can retry the same reviewed intent',async()=>{
 const f=await fixture(),input=await f.input();f.h.failNextCommit();await assert.rejects(f.service.confirm(input,f.actor),/Commit rejected/);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);assert.equal(f.h.get('staff_requests/'+canonicalRequest).status,'Pending');assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('attendance_relief_reviews/')),false);const result=await f.service.confirm(input,f.actor);assert.equal(result.saved,true);
});

test('a lost acknowledgement after the atomic commit reconciles to one saved operation on retry',async()=>{
 const f=await fixture(),input=await f.input();f.h.loseNextAck();await assert.rejects(f.service.confirm(input,f.actor),/Connection lost after commit/);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+actual);assert.equal(f.h.get('staff_requests/'+canonicalRequest).status,'Approved');const result=await f.service.confirm(input,f.actor);assert.equal(result.alreadySaved,true);assert.equal(result.operationId,input.operationId);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_relief_reviews/')).length,1);
});

test('a second reviewed amendment preserves the first original departure and records its previous amendment',async()=>{
 const f=await fixture(),first=await f.call('confirm',await f.input());assert.equal(first.status,200);const input=await f.input({operationId:'fiction-operation-002',dateTimeRaw:'2026-11-03T03:30'}),second=await f.call('confirm',input);assert.equal(second.status,200,second.body.message);const marker=f.h.get('attendance_logs/'+f.outId).reliefScheduleReview;assert.equal(marker.revision,2);assert.equal(marker.originalTimestamp,oldOut.toISOString());const audit=f.h.get('attendance_relief_reviews/'+second.body.auditId);assert.equal(audit.originalTimeOut.reliefScheduleReview.auditId,first.body.auditId);assert.equal(+audit.originalTimeOut.timestamp,+actual);
});

test('a legacy unlinked departure is amended in place instead of creating a duplicate linked Time Out',async()=>{
 const f=await fixture({legacy:true}),result=await f.call('confirm',await f.input());assert.equal(result.status,200,result.body.message);assert.equal(result.body.id,'legacy-departure');assert.equal(f.h.get('attendance_logs/'+canonicalOut),undefined);assert.equal(f.h.get('attendance_logs/legacy-departure').timeInLogId,startId);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,2);
});

test('a missing departure can be recorded without an associated request or fabricated reason acceptance',async()=>{
 const f=await fixture({existing:false,request:false}),input=await f.input();assert.equal(input.acceptReason,false);const result=await f.call('confirm',input);assert.equal(result.status,200,result.body.message);assert.equal(result.body.id,canonicalOut);assert.equal(result.body.requestStatus,null);assert.equal(f.h.get('attendance_logs/'+canonicalOut).timeInAt,start.toISOString());assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('staff_requests/')),false);assert.equal((await f.call('confirm',input)).body.alreadySaved,true);
});

test('a unique fresh pending request is discovered and must be explicitly accepted in the returned context',async()=>{
 const f=await fixture();delete f.context.requestId;const view=await f.call('inspect',{context:f.context});assert.equal(view.status,200,view.body.message);assert.equal(view.body.context.requestId,canonicalRequest);const input=await f.input({acceptReason:false});assert.equal((await f.call('confirm',input)).status,409);assert.equal(f.h.get('staff_requests/'+canonicalRequest).status,'Pending');input.acceptReason=true;assert.equal((await f.call('confirm',input)).status,200);
});

test('multiple pending request sources hold the correction before any records are changed',async()=>{
 const f=await fixture();f.h.put('staff_requests/another-pending',{...f.h.get('staff_requests/'+canonicalRequest)});const result=await f.call('inspect',{context:f.context});assert.equal(result.status,409);assert.match(result.body.message,/conflicting/);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);
});

test('emergency relief records actual departure while retaining Pending HR hours review and its exact linkage',async()=>{
 for(const existing of [false,true]){const f=await fixture({emergency:true,existing}),result=await f.call('confirm',await f.input());assert.equal(result.status,200,result.body.message);assert.equal(result.body.requiresScheduleReview,true);assert.equal(result.body.requestStatus,'Pending');const request=f.h.get('staff_requests/'+canonicalRequest),out=f.h.get('attendance_logs/'+canonicalOut);assert.equal(request.status,'Pending');assert.equal(request.requiresScheduleReview,true);assert.equal(request.reasonAccepted,true);assert.deepEqual(out.emergencyRelief,f.marker);assert.equal(out.reliefRequestId,canonicalRequest);assert.match(request.decisionScope,/assigned hours still need/);}
});

test('fresh saved Owner inactivity, employee revocation and changed source punches prevent writes',async()=>{
 for(const mode of ['owner','staff','source','request']){const f=await fixture(),input=await f.input();if(mode==='owner')f.h.put('hq_managers/owner',{email,pin:'REVOKED',active:false});if(mode==='staff')f.h.put('cashiers/'+staffId,{cashierName:name,branch:'Cabantian',pin:'REVOKED'});if(mode==='source')f.h.put('attendance_logs/'+startId,{...f.h.get('attendance_logs/'+startId),timestamp:new Date(+start+60000)});if(mode==='request')f.h.put('staff_requests/'+canonicalRequest,{...f.h.get('staff_requests/'+canonicalRequest),requestVersion:2});assert.equal((await f.call('confirm',input)).status,409,mode);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('attendance_relief_reviews/')),false);}
});

test('a changed existing departure invalidates the preview instead of overwriting a concurrent correction',async()=>{
 const f=await fixture(),input=await f.input();f.h.put('attendance_logs/'+f.outId,{...f.h.get('attendance_logs/'+f.outId),timestamp:new Date(+oldOut+60000)});const result=await f.call('confirm',input);assert.equal(result.status,409);assert.match(result.body.message,/changed/);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut+60000);
});

test('paid custom and canonical cutoffs, including the proposed next-day departure date, block amendments',async()=>{
 for(const mode of ['custom','canonical','refund','legacy-name','next-day']){const f=await fixture(),input=await f.input(),key=mode==='canonical'?'payroll-'+staffId+'-2026-11-01-2026-11-15':mode==='refund'?'refund-payroll-'+staffId+'-2026-11-01-2026-11-15':'fiction-paid-'+mode;f.h.put('payroll_records/'+key,{...(mode==='legacy-name'?{staffName:name}:{staffId}),startDate:mode==='next-day'?'2026-11-03':'2026-11-01',endDate:mode==='next-day'?'2026-11-03':'2026-11-15',isPaid:true,finalNetPay:1000,frozenData:{preserved:true}});const result=await f.call('confirm',input);assert.equal(result.status,409,mode);assert.match(result.body.message,/paid payslip/);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);assert.equal(f.h.get('payroll_records/'+key).finalNetPay,1000);}
});

test('foreign stable-ID payroll records with the same name do not freeze this employee',async()=>{
 const f=await fixture(),input=await f.input();f.h.put('payroll_records/foreign-staff',{staffId:'another-employee',staffName:name,startDate:'2026-11-01',endDate:'2026-11-15',isPaid:true,finalNetPay:500});assert.equal((await f.call('confirm',input)).status,200);
});

test('malformed frozen cutoff evidence and foreign canonical identifiers require separate payroll review',async()=>{
 for(const foreign of [false,true]){const f=await fixture(),input=await f.input(),key='payroll-'+staffId+'-2026-11-01-2026-11-15';f.h.put('payroll_records/'+key,{staffId:foreign?'another-employee':staffId,frozenData:{preserved:true},finalNetPay:1000});const result=await f.call('confirm',input);assert.equal(result.status,409);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);assert.match(result.body.message,foreign?/different saved employee/:/paid payslip/);}
});

test('ambiguous name-only history and duplicate linked departures are held separately',async()=>{
 for(const mode of ['name','out']){const f=await fixture();if(mode==='name'){f.h.put('attendance_logs/legacy-row',{staffName:name,branch:'Cabantian',type:'TIME IN',timestamp:new Date('2026-09-02T10:00:00+08:00')});f.h.put('cashiers/another-name',{cashierName:name,branch:'Maa',active:true});}else f.h.put('attendance_logs/duplicate-out',{...f.h.get('attendance_logs/'+f.outId)});const result=await f.call('inspect',{context:f.context});assert.equal(result.status,409);assert.match(result.body.message,mode==='name'?/ambiguous/:/More than one/);}
});

test('other active Time Ins, paired shifts and unpaired departures cannot be crossed by a correction',async()=>{
 for(const mode of ['in','pair','out']){const f=await fixture(),input=await f.input();if(mode==='in'||mode==='pair')f.h.put('attendance_logs/other-in',{staffId,staffName:name,branch:'Maa',type:'TIME IN',timestamp:new Date('2026-11-02T18:00:00+08:00')});if(mode==='pair'||mode==='out')f.h.put('attendance_logs/other-out',{staffId,staffName:name,branch:'Maa',type:'TIME OUT',timestamp:new Date('2026-11-02T20:00:00+08:00'),...(mode==='pair'?{timeInLogId:'other-in'}:{})});const result=await f.call('confirm',input);assert.equal(result.status,409,mode);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);}
});

test('Owner must verify an actual PH departure rather than a future time, backward interval or request timestamp',async()=>{
 for(const patch of [{confirmActualDeparture:false},{dateTimeRaw:'2026-11-02T13:00'},{dateTimeRaw:'2026-11-03T10:00'},{dateTimeRaw:'2026-11-06T03:28'},{dateTimeRaw:'2026-02-30T03:28'},{dateTimeRaw:'2026-11-03T03:28Z'},{reason:'ok'}]){const f=await fixture(),input=await f.input(patch);assert.equal((await f.call('confirm',input)).status,409);assert.equal(+f.h.get('attendance_logs/'+f.outId).timestamp,+oldOut);}
 assert.equal(actualTimeOutInstant('2026-11-03T03:28').toISOString(),'2026-11-02T19:28:00.000Z');
});

test('foreign origin, unauthenticated, unverified, non-Google or non-Owner identities never read business records',async()=>{
 for(const mode of ['origin','token','email','verified','provider','revoked-token']){const f=await fixture();if(mode==='email')f.actor.email='someone@example.test';if(mode==='verified')f.actor.email_verified=false;if(mode==='provider')f.actor.firebase.sign_in_provider='anonymous';let response;if(mode==='revoked-token'){const handler=createOwnerTimeOutHandler({store:f.store,verifyToken:async()=>{throw Error('revoked');}});response=await handler({method:'POST',path:'/owner-time-out/inspect',origin:OWNER_TIME_OUT_ORIGIN,query:{},contentType:'application/json',authorization:'Bearer '+'t'.repeat(24),rawSize:10,body:{context:f.context}});}else response=await f.call('inspect',{context:f.context},mode==='origin'?{origin:'https://untrusted.invalid'}:mode==='token'?{authorization:''}:{});assert.ok([401,403].includes(response.status),mode);assert.equal(response.headers['X-Takodeal-Time-Out-Version'],'1');assert.equal(f.physical(),0);assert.equal(f.queryCalls.length,0);}
});

test('malformed requests, unknown fields, oversized data and unsupported routes cannot reach the correction store',async()=>{
 const f=await fixture();for(const [path,body,extra]of [['inspect',{context:{...f.context,pin:'secret'}},{}],['inspect',{context:f.context},{rawSize:32769}],['inspect',{context:f.context},{query:{bypass:true}}],['unknown',{context:f.context},{}],['inspect',{context:f.context},{method:'GET'}],['confirm',{context:f.context,arbitrary:'write'},{}]]){assert.ok((await f.call(path,body,extra)).status>=400);assert.equal(f.physical(),0);}const preflight=await f.call('inspect',{}, {method:'OPTIONS',preflightMethod:'POST',preflightHeaders:'Authorization, Content-Type'});assert.equal(preflight.status,204);assert.equal(f.physical(),0);
});

test('the separate Admin adapter permits only exact protected departure, request acceptance and immutable audit writes',async()=>{
 const f=await fixture();for(const work of [tx=>tx.get('stock/fiction'),tx=>tx.query('transactions','branch','Cabantian'),tx=>tx.query('staff_requests','staffName',name),tx=>tx.amendOut(startId,{timestamp:actual}),tx=>tx.createAudit('timeout-fiction',{kind:TIME_OUT_KIND}),tx=>tx.acceptRequest(canonicalRequest,{status:'Approved'})])await assert.rejects(f.store.transaction(work));assert.equal(+f.h.get('attendance_logs/'+startId).timestamp,+start);
});

test('Owner request throttling stays bounded in the existing private attempts collection',async()=>{
 const f=await fixture();for(let n=0;n<120;n++)await f.store.rateOwner('fiction-owner');await assert.rejects(f.store.rateOwner('fiction-owner'),error=>error.status===429);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('cash_remittance_attempts/owner-time-out-')).length,1);
});
