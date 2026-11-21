import test from 'node:test';
import assert from 'node:assert/strict';
import {createSalesSnapshotReader,showConfirmedReceipts} from '../takodeal-manager/sales-report-recovery.js';
const start=new Date('2026-11-21T00:00:00+08:00'),end=new Date('2026-11-22T00:00:00+08:00');
const at='2026-11-21T09:04:03.123456Z',root='projects/fictional-store/databases/(default)/documents/';
const entry=(id,branch='Agdao',value=80)=>({document:{name:root+'transactions/'+id,fields:{timestamp:{timestampValue:at},branch:{stringValue:branch},netTotal:{integerValue:String(value)},status:{stringValue:'Paid'}}},readTime:at});
function fixture(responses,extra={}){
 const calls=[];let tokens=0;const read=createSalesSnapshotReader({projectId:'fictional-store',apiKey:'example',branch:'Agdao',start,end,pageSize:2,user:{getIdToken:async()=>{tokens++;return 'fixture';}},current:()=>true,getAppCheckToken:async()=>({token:'device'}),fetcher:async(url,request)=>{
 calls.push({url,request,query:JSON.parse(request.body)});const rows=responses.shift();assert.ok(rows);return rows.status?{ok:false,status:rows.status}:{ok:true,json:async()=>rows};
 },...extra});return {read,calls,tokens:()=>tokens};
}
test('authenticated read-only report fixes one server time and paginates equal-timestamp receipts with the Philippine range',async()=>{
 const f=fixture([[{readTime:at}],[entry('a'),entry('b')],[entry('c')],[{readTime:at}]]);
 const rows=await f.read('transactions');assert.deepEqual(rows.docs.map(x=>x.id),['a','b','c']);assert.equal(rows.docs[0].data().timestamp.toMillis(),Date.parse(at));await f.read('menu');
 assert.equal(f.tokens(),1);for(const {url,request} of f.calls){assert.equal(url,'https://firestore.googleapis.com/v1/'+root.slice(0,-1)+':runQuery?key=example');assert.equal(request.method,'POST');assert.equal(request.headers.Authorization,'Bearer fixture');assert.equal(request.headers['X-Firebase-AppCheck'],'device');}
 assert.deepEqual(f.calls.slice(1).map(c=>c.query.readTime),[at,at,at]);
 const q=f.calls[1].query.structuredQuery;
 assert.deepEqual(q.where.compositeFilter.filters.map(f=>f.fieldFilter.value),[{timestampValue:'2026-11-20T16:00:00.000Z'},{timestampValue:'2026-11-21T16:00:00.000Z'},{stringValue:'Agdao'}]);
 assert.deepEqual(f.calls[2].query.structuredQuery.startAt,{before:false,values:[{timestampValue:at},{referenceValue:root+'transactions/b'}]});
});
test('partial pages, duplicate receipts and documents from another collection never produce a total',async()=>{
 for(const bad of [[entry('b')],[{document:{name:root+'menu/other'}}],{status:503},[{error:{code:13}}]]){
 const f=fixture([[{readTime:at}],[entry('a'),entry('b')],bad]);await assert.rejects(f.read('transactions'));
 }
});
test('a denied or interrupted read can retry and a changed account discards a delayed response',async()=>{
 const f=fixture([[{readTime:at}],{status:403},[entry('only')]]);await assert.rejects(f.read('transactions'),/denied/);assert.equal((await f.read('transactions')).docs.length,1);
 let receive,started,current=true;const began=new Promise(r=>started=r);
 const delayed=fixture([],{current:()=>current,fetcher:async()=>{started();return new Promise(r=>receive=r);}});
 const pending=delayed.read('transactions');await began;current=false;receive({ok:true,json:()=>[{readTime:at}]});await assert.rejects(pending,/account changed/);
});
test('confirmed receipt cards exclude other branches, unpaid and voided rows, and use PH time and escaped display text',()=>{
 const entries=[{branch:'Agdao',netTotal:80,orderType:'Grab',paymentMethod:'Cash',status:'Paid',cashier:'<fictional>'},{branch:'Agdao',netTotal:50,status:'Voided'},{branch:'Agdao',netTotal:70,status:'Parked'},{branch:'Maa',netTotal:999,status:'Paid'}];
 const nodes=new Map(),d={getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
 showConfirmedReceipts(d,{docs:entries.map((r,i)=>({id:String(i),data:()=>({...r,timestamp:start})}))},'Agdao');
 assert.match(nodes.get('histSumNet').textContent,/80\.00/);assert.equal(nodes.get('histSumNet').textContent,nodes.get('histSumGrab').textContent);const html=nodes.get('historyTableBody').innerHTML;
 assert.match(html,/&lt;fictional&gt;/);assert.doesNotMatch(html,/Maa|999/);assert.match(html,/12:00/i);assert.match(html,/2026/);
});
