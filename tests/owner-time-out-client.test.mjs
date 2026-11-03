import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerTimeOutClient,OWNER_TIME_OUT_ENDPOINT} from '../takodeal-manager/owner-time-out-client.js';
const email='jgo031996@gmail.com',token='fiction-id-token-for-local-unit-tests',deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve};},drain=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const clone=value=>structuredClone(value),response=(value,{ok=true,status=200}={})=>({ok,status,json:async()=>value});
function fixture({fetch,tokenWork,timeoutMs=1000}={}){
 const calls=[],api={auth:{currentUser:{uid:'fiction-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:()=>tokenWork?tokenWork():Promise.resolve(token)}},sessionUser:{uid:'fiction-owner',email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['Maa']},isBranchAllowed:branch=>branch==='Maa'},context={attendanceLogId:'fiction-in',staffId:'fiction-staff',staffName:'Fictional Employee',branch:'Maa',requestId:'fiction-request'},view={context,expectedFingerprint:'a'.repeat(64),staffName:context.staffName,staffId:context.staffId,branch:context.branch,timeInAt:'2026-10-30T09:30:00.000Z',request:{id:context.requestId,status:'Pending',requestedDepartureAt:'2026-10-30T18:35:00.000Z',reason:'Fictional overnight departure review.'},existingTimeOut:null,paidCutoffs:[],canSave:true},input={context:clone(context),expectedFingerprint:view.expectedFingerprint,operationId:'00000000-0000-4000-8000-000000000001',dateTimeRaw:'2026-10-31T02:35:00',reason:'Fictional Owner verified the actual departure.',managementReply:'Fictional reason accepted.',confirmActualDeparture:true,acceptReason:true};
 const result=body=>({saved:true,id:'time-out-'+ 'c'.repeat(64),timestamp:new Date(Date.parse(body.dateTimeRaw+'+08:00')).toISOString(),auditId:'timeout-'+ 'b'.repeat(64),operationId:body.operationId,staffId:context.staffId,branch:context.branch});
 const client=createOwnerTimeOutClient(api,{timeoutMs,fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});return fetch?fetch(url,options,body,{view,result}):response(url.endsWith('/inspect')?clone(view):result(body));}});
 return {api,client,calls,context,view,input,result};
}

test('transport uses only the existing trusted endpoint and verified token with no browser credentials',async()=>{const f=fixture();assert.deepEqual(await f.client.inspect(f.context),f.view);assert.equal((await f.client.save(f.input)).saved,true);assert.deepEqual(f.calls.map(c=>c.url),[OWNER_TIME_OUT_ENDPOINT+'/inspect',OWNER_TIME_OUT_ENDPOINT+'/confirm']);for(const {options}of f.calls){assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');}assert.deepEqual(f.calls[1].body,f.input);});

test('UI-only callbacks and presentation notes never enter the server identity context',async()=>{const f=fixture(),context={...f.context,onReturn:()=>{throw Error('This UI callback must not be invoked by transport.');},reviewNote:'Fictional UI-only message',display:{caption:'Fictional presentation'}};await f.client.inspect(context);await f.client.save({...f.input,context});assert.deepEqual(f.calls[0].body.context,f.context);assert.deepEqual(f.calls[1].body.context,f.context);});

test('same operation shares one in-flight request and changed details or a second operation cannot duplicate it',async()=>{const gate=deferred(),f=fixture({fetch:()=>gate.promise}),first=f.client.save(f.input),second=f.client.save(clone(f.input));assert.strictEqual(first,second);await drain();assert.equal(f.client.isSaving(),true);assert.equal(f.calls.length,1);for(const patch of [{dateTimeRaw:'2026-10-31T03:00:00'},{operationId:'00000000-0000-4000-8000-000000000002'}])await assert.rejects(f.client.save({...f.input,...patch}),/current correction|pending/i);gate.resolve(response(f.result(f.input)));assert.equal((await first).saved,true);assert.equal((await second).saved,true);await drain();assert.equal(f.client.isSaving(),false);assert.equal(f.calls.length,1);});

test('lost response permits only the same confirmed operation until the server returns its idempotent result',async()=>{let attempts=0;const f=fixture({fetch:async(_,__,body,{result})=>{if(++attempts===1)throw TypeError('Fictional lost response');return response({...result(body),saved:false,alreadySaved:true});}});await assert.rejects(f.client.save(f.input),/lost response/);assert.equal(f.client.isSaving(),false);await assert.rejects(f.client.save({...f.input,operationId:'00000000-0000-4000-8000-000000000002'}),/unknown result/);const saved=await f.client.save(clone(f.input));assert.equal(saved.alreadySaved,true);assert.equal(f.calls.length,2);assert.equal(new Set(f.calls.map(c=>c.body.operationId)).size,1);});

test('a hung token lookup is bounded, sends no late request, and retains the same-operation retry lock',async t=>{t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),f=fixture({tokenWork:()=>gate.promise}),pending=f.client.save(f.input),observed=assert.rejects(pending,e=>e.code==='owner-time-out/pending');await drain();t.mock.timers.tick(1000);await observed;assert.equal(f.calls.length,0);assert.equal(f.client.isSaving(),false);await assert.rejects(f.client.save({...f.input,dateTimeRaw:'2026-10-31T03:00:00'}),/unknown result/);gate.resolve(token);await drain();assert.equal(f.calls.length,0);assert.equal((await f.client.save(clone(f.input))).saved,true);assert.equal(f.calls.length,1);});

test('an aborted or ignored network timeout remains uncertain until exact saved-operation inspection reconciles it',async t=>{t.mock.timers.enable({apis:['setTimeout']});const gate=deferred();let first=true;const f=fixture({fetch:async(url,options,body,{view,result})=>{if(url.endsWith('/inspect'))return response({...clone(view),lastOperationId:f.input.operationId,existingTimeOut:{id:result(f.input).id,timestamp:result(f.input).timestamp,operationId:f.input.operationId}});if(first){first=false;return gate.promise;}return response(result(body));}}),pending=f.client.save(f.input),observed=assert.rejects(pending,e=>e.code==='owner-time-out/pending');await drain();t.mock.timers.tick(1000);await observed;assert.equal(f.calls[0].options.signal.aborted,true);gate.resolve(response(f.result(f.input)));await drain();await assert.rejects(f.client.save({...f.input,dateTimeRaw:'2026-10-31T03:00:00'}),/unknown result/);await f.client.inspect(f.context);assert.equal((await f.client.save({...f.input,operationId:'00000000-0000-4000-8000-000000000002',dateTimeRaw:'2026-10-31T03:00:00'})).saved,true);});

test('inspection of a different or absent operation does not clear an uncertain correction',async()=>{const f=fixture({fetch:async(url,_,__,{view})=>{if(url.endsWith('/inspect'))return response({...clone(view),lastOperationId:'different-operation'});throw TypeError('Fictional lost response');}});await assert.rejects(f.client.save(f.input));await f.client.inspect(f.context);await assert.rejects(f.client.save({...f.input,operationId:'another-operation'}),/unknown result/);assert.equal(f.calls.filter(c=>c.url.endsWith('/confirm')).length,1);});

test('a known HTTP validation rejection permits a separately reviewed operation without claiming success',async()=>{let count=0;const f=fixture({fetch:async(_,__,body,{result})=>++count===1?response({code:'source-stale',message:'Refresh the saved source.'},{ok:false,status:409}):response(result(body))});await assert.rejects(f.client.save(f.input),e=>e.status===409&&e.code==='source-stale');assert.equal((await f.client.save({...f.input,operationId:'00000000-0000-4000-8000-000000000002'})).saved,true);});

test('an account change during token lookup prevents the request from being sent',async()=>{const gate=deferred(),f=fixture({tokenWork:()=>gate.promise}),pending=f.client.save(f.input);f.api.auth.currentUser.uid='different-owner';gate.resolve(token);await assert.rejects(pending,/changed|verified Owner/);assert.equal(f.calls.length,0);});

test('an account change after a response is sent cannot expose its personal result',async()=>{const gate=deferred(),f=fixture({fetch:()=>gate.promise}),pending=f.client.inspect(f.context);await drain();f.api.sessionUser.allowedBranches=['Cabantian'];gate.resolve(response(f.view));await assert.rejects(pending,/changed|verified Owner/);});

test('a locked or unpermitted branch cannot make an inspection request',async()=>{for(const change of [f=>{f.api.sessionUser.isOwner=false;},f=>{f.api.auth.currentUser.emailVerified=false;},f=>{f.context.branch='Cabantian';}]){const f=fixture();change(f);await assert.rejects(f.client.inspect(f.context),/Owner|branch|access|review/i);assert.equal(f.calls.length,0);}});

for(const [label,alter]of [
 ['foreign staff',v=>{v.context.staffId='foreign-staff';v.staffId='foreign-staff';}],
 ['foreign branch',v=>{v.context.branch='Cabantian';v.branch='Cabantian';}],
 ['inconsistent top-level branch',v=>{v.branch='Cabantian';}],
 ['foreign request',v=>{v.context.requestId='another-request';}],
 ['foreign Time In',v=>{v.context.attendanceLogId='another-in';}],
 ['malformed Time In',v=>{v.timeInAt='not-a-date';}],
 ['missing fingerprint',v=>{v.expectedFingerprint='';}]
])test('inspection rejects '+label+' rather than showing a mismatched employee review',async()=>{const f=fixture({fetch:async(_,__,___,{view})=>{const changed=clone(view);alter(changed);return response(changed);}});await assert.rejects(f.client.inspect(f.context));});

for(const [label,alter]of [
 ['false outcome',v=>{v.saved=false;}],
 ['malformed timestamp',v=>{v.timestamp='not-a-date';}],
 ['foreign departure time',v=>{v.timestamp='2026-10-30T19:00:00.000Z';}],
 ['foreign operation',v=>{v.operationId='another-operation';}],
 ['foreign staff',v=>{v.staffId='foreign-staff';}],
 ['foreign branch',v=>{v.branch='Cabantian';}],
 ['empty audit reference',v=>{v.auditId='';}]
])test('confirmation rejects '+label+' and does not unlock a different uncertain operation',async()=>{const f=fixture({fetch:async(_,__,body,{result})=>{const changed=result(body);alter(changed);return response(changed);}});await assert.rejects(f.client.save(f.input));await assert.rejects(f.client.save({...f.input,operationId:'00000000-0000-4000-8000-000000000002'}),/unknown result/);assert.equal(f.calls.length,1);});

test('a paid inspection remains read-only and carries its original hold information',async()=>{const f=fixture({fetch:async(_,__,___,{view})=>response({...clone(view),canSave:false,paidCutoffs:[{id:'fiction-paid',from:'2026-10-16',to:'2026-10-31'}]})});const view=await f.client.inspect(f.context);assert.equal(view.canSave,false);assert.equal(view.paidCutoffs[0].id,'fiction-paid');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url.endsWith('/inspect'),true);});
