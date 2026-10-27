import test from 'node:test';
import assert from 'node:assert/strict';
import {readPaymentReviewCount,installPaymentReviewScanner} from '../takodeal-manager/payment-review-scanner.js';

const anchor='2026-10-27T00:00:00.123456Z',since=new Date('2026-10-23T00:00:00Z');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const direct=row=>typeof row.paymentMethod==='string'&&Boolean(row.paymentMethod)&&row.paymentMethod.toLowerCase()!=='cash'&&row.status!=='Voided'&&row.paymentVerified!==true;
const cash=Array.from({length:16},(_,mask)=>[...'cash'].map((letter,index)=>mask&(1<<index)?letter.toUpperCase():letter).join(''));
function dataset(){
 const rows=[],methods=[undefined,'',null,true,0,3.5,[],['Cash'],{},...cash,' ',' cash','Cash ','Grab','foodpanda','gcash','\u0000','🔥'];
 for(const method of methods)for(const status of [undefined,'Voided','voided',null,true])for(const verified of [undefined,true,false,'true',1,null]){const row={id:'sample-'+rows.length,branch:'Sample Maa',timestamp:'2026-10-26T12:00:00Z'};if(method!==undefined)row.paymentMethod=method;if(status!==undefined)row.status=status;if(verified!==undefined)row.paymentVerified=verified;rows.push(row);}
 return rows;
}
function fixture({rows=dataset(),branches=['All'],email='jgo031996@gmail.com'}={}){
 const calls=[],values=[],snapshots=new Map();let clock=0;
 const api={deviceFleetConnection:{projectId:'sample-project',apiKey:'SAMPLE_PUBLIC_KEY'},auth:{currentUser:{uid:'sample-owner',email,emailVerified:true,getIdToken:async()=>'SYNTHETIC_TOKEN'}},sessionUser:{uid:'sample-owner',email,permissions:['all'],allowedBranches:branches},updateUnverifiedBadges:count=>values.push(count),addEventListener(){}};
 const f={api,calls,values,rows,snapshots,now:()=>clock,setClock:value=>{clock=value;},before:null,after:null,shape:null,failAggregate:null,failLegacy:null};
 const fields=value=>{if(value===null)return{nullValue:null};if(typeof value==='string')return{stringValue:value};if(typeof value==='boolean')return{booleanValue:value};if(typeof value==='number')return{integerValue:String(value)};if(Array.isArray(value))return{arrayValue:{values:value.map(fields)}};return{mapValue:{fields:{}}};};
 const filterMatch=(row,node)=>{if(node.compositeFilter)return node.compositeFilter.filters.every(filter=>filterMatch(row,filter));const {field,op,value}=node.fieldFilter,actual=row[field.fieldPath];if(op==='EQUAL')return Object.hasOwn(value,'stringValue')?typeof actual==='string'&&actual===value.stringValue:actual===value.booleanValue;if(op==='GREATER_THAN')return typeof actual==='string'&&actual>value.stringValue;if(op==='GREATER_THAN_OR_EQUAL')return Number.isFinite(+new Date(actual))&&new Date(actual)>=new Date(value.timestampValue);if(op==='IN')return typeof actual==='string'&&value.arrayValue.values.some(entry=>entry.stringValue===actual);throw Error('Unexpected filter.');};
 api.fetch=async(url,input)=>{const body=JSON.parse(input.body),aggregate=url.includes(':runAggregationQuery'),query=aggregate?body.structuredAggregationQuery.structuredQuery:body.structuredQuery,call={url,input,body,query,aggregate};calls.push(call);await f.before?.(call);
  if(aggregate&&f.failAggregate){const failure=await f.failAggregate(call);if(failure){const status=failure.statusCode||400;return{ok:status<400,status,json:async()=>failure.body??{error:failure}};}}
  if(!aggregate&&f.failLegacy)throw f.failLegacy;
  if(aggregate){const at=body.readTime||anchor;if(!snapshots.has(at)){assert.equal(body.readTime,undefined,'An unknown historical readTime must never be invented.');snapshots.set(at,structuredClone(rows));}const selected=snapshots.get(at).filter(row=>filterMatch(row,query.where));let response=[{result:{aggregateFields:{pendingCount:{integerValue:String(selected.length)}}},readTime:at}];response=f.shape?.(response,call)??response;return{ok:true,status:200,json:async()=>{await f.after?.(call);return response;}};}
  const selected=rows.filter(row=>filterMatch(row,query.where));return{ok:true,status:200,json:async()=>{await f.after?.(call);return selected.length?selected.map(row=>({document:{name:'projects/sample-project/databases/(default)/documents/transactions/'+row.id,fields:Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id').map(([key,value])=>[key,key==='timestamp'?{timestampValue:value}:fields(value)]))},readTime:anchor})):[{readTime:anchor}];}};
 };
 return f;
}
const read=(f,options={})=>readPaymentReviewCount(f.api,{since,now:f.now,...options});
const missingIndex={status:'FAILED_PRECONDITION',message:'The query requires an index. Create the composite index.'};

test('actual aggregate reader preserves mixed-type, missing-field, exact-Voided and all sixteen Cash-case semantics',async()=>{
 const f=fixture(),expected=f.rows.filter(direct).length,result=await read(f);assert.equal(result.count,expected);assert.equal(result.mode,'aggregation');assert.equal(f.calls.length,8);assert.ok(f.calls.every(call=>call.aggregate));assert.equal(result.evidence.returnedDocuments,0);assert.equal(result.evidence.actualReadUnits,null);assert.equal(result.evidence.requiresQueryExplain,true);assert.equal(result.evidence.minimumAggregationReadUnits,8);
 for(const call of f.calls){assert.equal(call.input.method,'POST');assert.equal(call.input.headers.Authorization,'Bearer SYNTHETIC_TOKEN');assert.equal(call.input.cache,'no-store');assert.equal(call.input.credentials,'omit');assert.deepEqual(call.query.from,[{collectionId:'transactions'}]);assert.equal(call.query.orderBy[0].field.fieldPath,'timestamp');assert.equal('select'in call.query,false);assert.equal('limit'in call.query,false);assert.equal('upTo'in call.body.structuredAggregationQuery.aggregations[0].count,false);assert.doesNotMatch(JSON.stringify(call.query),/photo|proof|items|customer/);}
 const cashQuery=f.calls.find(call=>call.query.where.compositeFilter.filters.some(node=>node.fieldFilter.op==='IN'));assert.deepEqual(cashQuery.query.where.compositeFilter.filters.find(node=>node.fieldFilter.op==='IN').fieldFilter.value.arrayValue.values.map(row=>row.stringValue).sort(),cash.slice().sort());
});

test('only the first count chooses readTime; every other term retains exact microseconds across concurrent payment updates',async()=>{
 const f=fixture({rows:[{id:'pending',branch:'Sample Maa',timestamp:anchor,paymentMethod:'Grab'},{id:'cash',branch:'Sample Maa',timestamp:anchor,paymentMethod:'Cash'}]});f.after=call=>{if(f.calls.length===1){f.rows[0].paymentVerified=true;f.rows.push({id:'arriving',branch:'Sample Maa',timestamp:anchor,paymentMethod:'GCash'});}};
 const result=await read(f);assert.equal(result.count,1);assert.equal(f.calls[0].body.readTime,undefined);assert.ok(f.calls.slice(1).every(call=>call.body.readTime===anchor));assert.equal(result.evidence.readTime,anchor);
});

test('assigned branches are deduplicated and share the first snapshot without broadening to other branches',async()=>{
 const rows=[{id:'one',branch:'Sample Maa',timestamp:anchor,paymentMethod:'Grab'},{id:'two',branch:'Other Branch',timestamp:anchor,paymentMethod:'Grab'},{id:'foreign',branch:'Hidden Branch',timestamp:anchor,paymentMethod:'Grab'}],f=fixture({rows,branches:['Sample Maa','Other Branch','Sample Maa'],email:'manager@example.test'});
 const result=await read(f);assert.equal(result.count,2);assert.equal(result.evidence.branchCount,2);assert.equal(f.calls.length,16);assert.ok(f.calls.slice(1).every(call=>call.body.readTime===anchor));for(const call of f.calls){const filter=call.query.where.compositeFilter.filters.find(node=>node.fieldFilter.field.fieldPath==='branch');assert.ok(['Sample Maa','Other Branch'].includes(filter.fieldFilter.value.stringValue));}
});

test('a proven empty string population needs one count and does not invent an eight-query saving',async()=>{
 const f=fixture({rows:[{id:'empty',branch:'Sample Maa',timestamp:anchor,paymentMethod:''},{id:'wrong-type',branch:'Sample Maa',timestamp:anchor,paymentMethod:true}]});const result=await read(f);assert.equal(result.count,0);assert.equal(f.calls.length,1);assert.equal(result.evidence.minimumAggregationReadUnits,1);assert.equal(result.evidence.actualReadUnits,null);
});

test('missing first index falls back once, memoizes only capability and retries aggregation after five minutes',async()=>{
 const f=fixture();f.failAggregate=()=>missingIndex;const one=await read(f);assert.equal(one.mode,'masked-rest');assert.equal(one.count,f.rows.filter(direct).length);assert.equal(one.evidence.fallbackReason,'missing-index');assert.deepEqual(f.calls.map(call=>call.aggregate),[true,false]);
 const two=await read(f);assert.equal(two.evidence.fallbackReason,'cached-missing-index');assert.equal(two.evidence.aggregateRequestCount,0);assert.deepEqual(f.calls.map(call=>call.aggregate),[true,false,false]);
 f.setClock(300001);const three=await read(f);assert.equal(three.evidence.fallbackReason,'missing-index');assert.deepEqual(f.calls.slice(-2).map(call=>call.aggregate),[true,false]);assert.ok(f.calls.filter(call=>!call.aggregate).every(call=>call.query.select.fields.length===5));
});

test('a missing later index discards all aggregate terms and uses a fresh complete compatibility scan',async()=>{
 const f=fixture();f.failAggregate=call=>f.calls.length>1?missingIndex:null;const result=await read(f);assert.equal(result.mode,'masked-rest');assert.equal(result.count,f.rows.filter(direct).length);assert.ok(f.calls.some(call=>!call.aggregate));const before=f.calls.filter(call=>call.aggregate).length;await read(f);assert.equal(f.calls.filter(call=>call.aggregate).length,before);
});

test('the actual production array-shaped missing-index error falls back and memoizes without repeating the failed query',async()=>{
 const f=fixture();f.failAggregate=()=>({statusCode:400,body:[{error:{code:400,status:'FAILED_PRECONDITION',message:'no matching index found.'}}]});const first=await read(f);assert.equal(first.mode,'masked-rest');assert.equal(first.count,f.rows.filter(direct).length);assert.equal(first.evidence.fallbackReason,'missing-index');assert.deepEqual(f.calls.map(call=>call.aggregate),[true,false]);const second=await read(f);assert.equal(second.evidence.fallbackReason,'cached-missing-index');assert.deepEqual(f.calls.map(call=>call.aggregate),[true,false,false]);
});

test('HTTP 200 streamed missing-index envelopes also fall back, including read-time-only progress before the error',async()=>{
 for(const body of [[{error:{code:400,status:'FAILED_PRECONDITION',message:'no matching index found.'}}],[{readTime:anchor},{error:missingIndex}],{error:missingIndex}]){const f=fixture();f.failAggregate=()=>({statusCode:200,body});const result=await read(f);assert.equal(result.mode,'masked-rest');assert.equal(result.count,f.rows.filter(direct).length);assert.equal(result.evidence.fallbackReason,'missing-index');}
});

test('mixed streaming errors, execution results and malformed progress never trigger the index fallback',async()=>{
 const denied={error:{code:403,status:'PERMISSION_DENIED',message:'Denied'}},missing={error:missingIndex};for(const body of [[missing,denied],[missing,{result:{aggregateFields:{pendingCount:{integerValue:'0'}}},readTime:anchor}],[missing,{readTime:'invalid'}],[missing,{unrecognized:true}],[denied]]){const f=fixture();f.failAggregate=()=>({statusCode:200,body});await assert.rejects(read(f),/count could not/);assert.ok(f.calls.every(call=>call.aggregate));}
});

test('capability failures never leak between projects, staff accounts or saved branch scopes',async()=>{
 const f=fixture();f.failAggregate=()=>missingIndex;await read(f);const aggregateCalls=()=>f.calls.filter(call=>call.aggregate).length;assert.equal(aggregateCalls(),1);
 f.api.deviceFleetConnection.projectId='another-project';f.failLegacy=Error('Stop after scope probe');await assert.rejects(read(f),/scope|Stop/);assert.equal(aggregateCalls(),2);f.api.deviceFleetConnection.projectId='sample-project';f.failLegacy=null;
 f.api.auth.currentUser.uid=f.api.sessionUser.uid='second-owner';await read(f);assert.equal(aggregateCalls(),3);f.api.auth.currentUser.email=f.api.sessionUser.email='manager@example.test';f.api.sessionUser.allowedBranches=['Sample Maa'];await read(f);assert.equal(aggregateCalls(),4);f.api.sessionUser.allowedBranches=['Other Branch'];await read(f);assert.equal(aggregateCalls(),5);
});

for(const failure of [{status:'PERMISSION_DENIED',message:'Denied',statusCode:403},{status:'UNAUTHENTICATED',message:'Sign in',statusCode:401},{status:'FAILED_PRECONDITION',message:'The snapshot is too old.'}])test('does not use compatibility fallback for '+failure.status+' / '+failure.message,async()=>{const f=fixture();f.failAggregate=()=>failure;await assert.rejects(read(f),/count could not/);assert.ok(f.calls.every(call=>call.aggregate));});

test('network failure never falls back or overwrites a confirmed badge',async()=>{
 const f=fixture(),prior=7;f.values.push(prior);f.before=()=>{throw Error('network failed');};const controller=installPaymentReviewScanner(f.api,{visibilityState:'visible',querySelector:()=>null,addEventListener(){}});assert.equal(await controller.scan(),false);assert.deepEqual(f.values,[prior]);assert.equal(f.api.paymentReviewReadEvidence,undefined);assert.equal(f.calls.length,1);controller.stop();
});

const malformed=[[],{},[null],[{readTime:anchor}],[{result:{aggregateFields:{other:{integerValue:'0'}}},readTime:anchor}],[{result:{aggregateFields:{pendingCount:{doubleValue:0}}},readTime:anchor}],[{result:{aggregateFields:{pendingCount:{integerValue:'-1'}}},readTime:anchor}],[{result:{aggregateFields:{pendingCount:{integerValue:'1.5'}}},readTime:anchor}],[{result:{aggregateFields:{pendingCount:{integerValue:'0'}}},readTime:'2026-02-30T00:00:00Z'}],[{result:{aggregateFields:{pendingCount:{integerValue:'0'}}},readTime:'2026-10-27T00:00:00.123456789Z'}],[{error:{status:'PERMISSION_DENIED'},readTime:anchor}]];
test('malformed aggregation responses reject instead of converting absent or wrong values into zero',async()=>{for(const response of malformed){const f=fixture();f.shape=()=>response;await assert.rejects(read(f),/count could not/);assert.ok(f.calls.every(call=>call.aggregate));}});

test('mixed snapshot timestamps, duplicate results, impossible partitions and unsafe totals are rejected',async()=>{
 for(const mode of ['time','duplicate','partition','unsafe']){const f=fixture();f.shape=(response,call)=>{if(mode==='time'&&call.body.readTime)return[{...response[0],readTime:'2026-10-27T00:00:01.123456Z'}];if(mode==='duplicate')return[...response,...response];if(mode==='partition'&&f.calls.length===1)return[{result:{aggregateFields:{pendingCount:{integerValue:'1'}}},readTime:anchor}];if(mode==='unsafe'&&f.calls.length===1)return[{result:{aggregateFields:{pendingCount:{integerValue:'18014398509481984'}}},readTime:anchor}];return response;};await assert.rejects(read(f),/count could not/,mode);assert.ok(f.calls.every(call=>call.aggregate));}
});

test('identity, permissions and project changes during token, HTTP or JSON work reject without fallback',async()=>{
 for(const phase of ['token','fetch','json'])for(const change of ['uid','permissions','project','user-object']){const f=fixture(),pending=deferred();if(phase==='token')f.api.auth.currentUser.getIdToken=()=>pending.promise;else if(phase==='fetch')f.before=()=>pending.promise;else f.after=()=>pending.promise;const work=read(f),rejected=assert.rejects(work,/changed/);await new Promise(resolve=>setImmediate(resolve));if(change==='uid')f.api.auth.currentUser.uid='other';else if(change==='permissions')f.api.sessionUser.permissions=['dashboard'];else if(change==='project')f.api.deviceFleetConnection.projectId='other-project';else f.api.auth.currentUser={...f.api.auth.currentUser};pending.resolve('SYNTHETIC_TOKEN');await rejected;assert.ok(f.calls.every(call=>call.aggregate));}
});

test('pre-abort and finite deadlines settle stalled tokens or fetches without replacing a badge',async()=>{
 const pre=fixture(),aborted=new AbortController();aborted.abort();await assert.rejects(read(pre,{signal:aborted.signal}),/cancelled/);assert.equal(pre.calls.length,0);
 for(const phase of ['token','fetch','json']){const f=fixture(),pending=deferred();if(phase==='token')f.api.auth.currentUser.getIdToken=()=>pending.promise;else if(phase==='fetch')f.before=()=>pending.promise;else f.after=()=>pending.promise;await assert.rejects(read(f,{timeoutMs:5}),/count could not|cancelled/);assert.equal(f.calls.filter(call=>!call.aggregate).length,0);pending.resolve('SYNTHETIC_TOKEN');}
});

test('the installed scanner prefers real aggregate counts, exposes honest evidence and preserves its existing cadence',async()=>{
 const f=fixture(),intervals=[],timeouts=[];const controller=installPaymentReviewScanner(f.api,{visibilityState:'visible',querySelector:()=>null,addEventListener(){}},{now:()=>new Date('2026-10-27T00:00:00Z'),setIntervalFn:(callback,ms)=>{intervals.push(ms);return 1;},clearIntervalFn(){},setTimeoutFn:(callback,ms)=>{timeouts.push(ms);return 2;},clearTimeoutFn(){}});controller.start();assert.equal(await controller.scan(),true);assert.equal(f.values.at(-1),f.rows.filter(direct).length);assert.equal(f.api.paymentReviewReadEvidence.mode,'aggregation');assert.equal(f.api.paymentReviewReadEvidence.actualReadUnits,null);assert.deepEqual(intervals,[120000]);assert.equal(timeouts[0],3000);assert.ok(timeouts.includes(6000));controller.stop();
});

test('failed compatibility reads and malformed injected reader results retain the existing badge',async()=>{
 const f=fixture();f.failAggregate=()=>missingIndex;f.failLegacy=Error('offline');f.values.push(12);const doc={visibilityState:'visible',querySelector:()=>null,addEventListener(){}},controller=installPaymentReviewScanner(f.api,doc);assert.equal(await controller.scan(),false);assert.deepEqual(f.values,[12]);assert.equal(f.api.paymentReviewReadEvidence,undefined);controller.stop();
 for(const result of [{count:-1},{count:NaN},{count:undefined},null]){const next=installPaymentReviewScanner(f.api,doc,{read:async()=>result});assert.equal(await next.scan(),false);assert.deepEqual(f.values,[12]);next.stop();}
});
