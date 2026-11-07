import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer} from 'node:http';
import {createFirebaseVerifier,createBoardHandler,validateQuery,sourceQuery,SOURCES,calculateEvidence,readEvidence,validateReport,interpret} from '../takodeal-manager/server/ai-board.mjs';
import {renderBoardReport} from '../takodeal-manager/ai-board.js';
import {canOpenWorkspacePage,createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {canOpenManagerPage} from '../takodeal-manager/workspace-access.js';

const now=Date.parse('2026-11-07T02:00:00Z'),uid='pinned-owner',env={AI_BOARD_OWNER_UID:uid,OPENAI_API_KEY:'test-private-key'};
const base={directorId:'finance',question:'Review the evidence',branch:'All',period:{start:'2026-11-01',end:'2026-11-07'}};
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=keys.publicKey.export({type:'spki',format:'pem'});
const claims={sub:uid,email:'jgo031996@gmail.com',email_verified:true,aud:'takodeal-pos',iss:'https://securetoken.google.com/takodeal-pos',iat:now/1000-5,auth_time:now/1000-20,exp:now/1000+3600};
function token(overrides={},header={alg:'RS256',kid:'test'}){const parts=[header,{...claims,...overrides}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url'));return parts.join('.')+'.'+sign('RSA-SHA256',Buffer.from(parts.join('.')),keys.privateKey).toString('base64url');}
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const owner={localId:uid,email:claims.email,emailVerified:true,validSince:String(now/1000-100)};
test('actual workspace routing admits only a verified owner, including after permission application',()=>{
  const user={uid,email:claims.email,emailVerified:true};
  assert.equal(canOpenManagerPage({auth:{currentUser:user},sessionUser:createWorkspaceSession(user,{email:user.email})},'ai-board'),true);
  for(const user of [{uid:'staff',email:'staff@example.com',emailVerified:true,permissions:['all','ai-board']},{uid,email:claims.email,emailVerified:false},{email:claims.email,emailVerified:true}])assert.equal(canOpenManagerPage({auth:{currentUser:user},sessionUser:{uid:user.uid}},'ai-board'),false);
  assert.equal(canOpenWorkspacePage({uid:'staff',permissions:['all','ai-board']},'ai-board'),false);
});
const fixture={
  transactions:[{id:'t1',branch:'Maa',timestamp:'2026-11-06T04:00:00Z',netTotal:110.5,receiptId:'A',paymentMethod:'Cash',paymentVerified:false},{id:'t2',branch:'Maa',timestamp:'2026-11-06T05:00:00Z',netTotal:20,receiptId:'A',paymentMethod:'Cash'},{id:'void',branch:'Maa',timestamp:'2026-11-06T06:00:00Z',netTotal:500,status:'voided'}],
  expenses:[{id:'e',branch:'Maa',timestamp:'2026-11-06T05:00:00Z',amount:30}],
  inventory:[{id:'i',branch:'Maa',currentStock:-1,reorderLevel:5}],stock_logs:[{id:'l',branch:'Maa',timestamp:'2026-11-06T05:00:00Z',variance:2}],
  attendance_logs:[{id:'a',branch:'Maa',timestamp:'2026-11-06T05:00:00Z',type:'in',isManual:true}],
  shifts:[{id:'s',branch:'Maa',startTime:'2026-11-06T01:00:00Z',active:false,expectedCash:300,declaredCash:290}]
};
const firestoreValue=v=>typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{doubleValue:v}: /^2026-/.test(v)?{timestampValue:v}:{stringValue:v};
const wire=rows=>rows.map(({id,...row})=>({document:{name:'projects/takodeal-pos/databases/(default)/documents/test/'+id,fields:Object.fromEntries(Object.entries(row).map(([k,v])=>[k,firestoreValue(v)]))}}));
const report=ids=>({summary:'Review these recorded signals.',confidence:'medium',findings:[{title:'Review the evidence',explanation:'The recorded evidence supports manual review.',evidenceIds:[ids[0]]}],assumptions:['Uploaded records may be incomplete.'],counterargument:'A process difference may explain this signal.',options:['Review the source records.'],recommendation:'Wait for reconciliation.',nextSteps:['Check the named sources.']});
function fetchFixture(calls,options={}){return async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/metadata/x509/'))return response({test:pem});
  if(url.includes('accounts:lookup'))return response({users:[options.user||owner]});
  if(url.includes('documents:runQuery')){const table=JSON.parse(init.body).structuredQuery.from[0].collectionId;if(options.deny===table)return new Response('{}',{status:403});return response(wire(fixture[table]||[]));}
  if(url==='https://api.openai.com/v1/responses'){const packet=JSON.parse(JSON.parse(init.body).input).packet;return response({status:'completed',model:'fixture',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(report(packet.evidence.map(e=>e.id)))}]}]});}
  throw Error('Unexpected network call: '+url);
};}
function fakeResponse(){return {headers:{},status(n){this.code=n;return this;},json(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}};}

test('real RSA verification checks Firebase issuer, audience, signature, owner and current account',async()=>{
  const calls=[],verify=createFirebaseVerifier({fetcher:fetchFixture(calls),now:()=>now});
  assert.deepEqual(await verify(token(),uid),{uid});
  await assert.rejects(()=>verify(token(),undefined),{code:'owner-not-configured'});
  for(const change of [{aud:'other-project'},{iss:'https://example.com'},{exp:now/1000},{iat:now/1000+1},{auth_time:now/1000+1},{sub:''}])await assert.rejects(()=>verify(token(change),uid),{code:'invalid-auth'});
  for(const change of [{sub:'other-user'},{email:'staff@example.com'},{email_verified:false}])await assert.rejects(()=>verify(token(change),uid),{code:'owner-only'});
  await assert.rejects(()=>verify(token({}, {alg:'none',kid:'test'}),uid),{code:'invalid-auth'});
  const tampered=token().split('.');tampered[1]=Buffer.from(JSON.stringify({...claims,sub:'attacker'})).toString('base64url');
  await assert.rejects(()=>verify(tampered.join('.'),uid),{code:'invalid-auth'});
  assert.equal(calls.filter(c=>c.url.includes('/metadata/x509/')).length,1);
});
test('revoked, disabled, removed and changed owner accounts fail before data reads',async()=>{
  for(const user of [{...owner,validSince:String(now/1000)},{...owner,disabled:true},{...owner,emailVerified:false},{...owner,email:'changed@example.com'},{...owner,localId:'other'},{...owner,validSince:'invalid'}]){
    const calls=[],verify=createFirebaseVerifier({fetcher:fetchFixture(calls,{user}),now:()=>now});
    await assert.rejects(()=>verify(token(),uid),{code:'revoked-auth'});
    assert.equal(calls.some(c=>c.url.includes('firestore')),false);
  }
});
test('server request contract bounds dates, modes, scope, extra fields and question length',()=>{
  const q=validateQuery(base,now);assert.equal(new Date(q.start).toISOString(),'2026-11-01T00:30:00.000Z');assert.equal(q.end,now+1);
  for(const change of [{directorId:'__proto__'},{question:' '},{question:'a'.repeat(4001)},{branch:[]},{branch:'bad\nbranch'},{action:'delete'},{consultation:'execute'},{period:{start:'2026-02-30',end:'2026-03-01'}},{period:{start:'2026-10-01',end:'2026-11-07'}},{period:{start:'2026-11-08',end:'2026-11-08'}}])assert.throws(()=>validateQuery({...base,...change},now));
});
test('Firestore reads are projected, bounded, dated and branch scoped without write capabilities',()=>{
  const q=validateQuery({...base,branch:'Maa'},now);
  for(const table of Object.keys(SOURCES)){
    const query=sourceQuery(table,q).structuredQuery;
    assert.equal(query.limit,SOURCES[table].cap+1);assert.ok(query.select.fields.length>0);
    assert.match(JSON.stringify(query.where),/Maa/);
    assert.doesNotMatch(JSON.stringify(query.select),/photo|PIN|signature|staffName|customerName|location/i);
  }
  assert.throws(()=>sourceQuery('hq_managers',q),{code:'source-denied'});
});
test('calculations match fixture totals, exclude voids and expose missing evidence honestly',()=>{
  const q=validateQuery({...base,directorId:'mentor'},now);
  const coverage=Object.keys(fixture).map(source=>({source,complete:true}));
  const p=calculateEvidence({data:fixture,coverage},q,now),get=id=>p.evidence.find(e=>e.id===id).value;
  assert.equal(get('sales.net'),130.5);assert.equal(get('sales.orders'),2);assert.equal(get('audit.duplicates'),1);assert.equal(get('costs.recorded'),30);assert.equal(get('stock.negative'),1);assert.equal(get('hr.manual'),1);assert.equal(get('audit.cash'),-10);
  assert.equal(p.evidence.some(e=>/profit|ROI|lateness/i.test(e.label)),false);
  const missing=calculateEvidence({data:{transactions:null},coverage:[{source:'transactions',complete:false,error:'Denied'}]},q,now);
  assert.equal(missing.evidence.length,0);assert.equal(missing.partial,true);
});
test('all seven directors execute through auth, reads, calculations and structured interpretation',async()=>{
  for(const directorId of ['finance','audit','inventory','hr','operations','marketing','mentor']){
    const calls=[],logs=[],handler=createBoardHandler({env,fetcher:fetchFixture(calls),now:()=>now,log:x=>logs.push(x)}),res=fakeResponse();
    await handler({method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json',origin:'https://takodeal-owner.vercel.app'},body:{...base,directorId}},res);
    assert.equal(res.code,200,directorId+': '+JSON.stringify(res.body));assert.equal(res.body.packet.directorId,directorId);assert.equal(res.body.advisoryOnly,true);
    const modelRequest=JSON.parse(calls.find(c=>c.url.includes('openai.com')).init.body);
    assert.deepEqual(modelRequest.text.format.schema.properties.findings.items.properties.evidenceIds.items.enum,res.body.packet.evidence.map(e=>e.id));
    assert.equal(modelRequest.text.format.schema.properties.findings.items.properties.evidenceIds.minItems,1);
    assert.equal(modelRequest.store,false);assert.equal(modelRequest.tools,undefined);assert.doesNotMatch(modelRequest.input,/test-private-key|Bearer|pinned-owner|staffName|customerName/);
    assert.doesNotMatch(JSON.stringify(logs),/test-private-key|Review the evidence|pinned-owner|eyJ/);
    assert.ok(calls.filter(c=>c.url.includes('firestore')).every(c=>c.url.endsWith('documents:runQuery')&&c.init.method==='POST'));
  }
});

test('historical consultations retain current-stock timestamps and count-only control limitations',()=>{
  const q=validateQuery({...base,directorId:'mentor',period:{start:'2026-11-06',end:'2026-11-06'}},now);
  const p=calculateEvidence({data:fixture,coverage:Object.keys(fixture).map(source=>({source,complete:true}))},q,now);
  for(const item of p.evidence.filter(e=>e.source==='inventory')){
    assert.match(item.label,/Current/);assert.ok(item.note.includes(new Date(now).toISOString()));
    assert.match(item.note,/NOT stock on the selected historical business days/);
  }
  assert.match(p.evidence.find(e=>e.id==='stock.movements').note,/not stock movement transactions/);
  assert.match(p.evidence.find(e=>e.id==='hr.manual').note,/Zero does not prove automated or reliable capture/);
  assert.match(p.evidence.find(e=>e.id==='ops.overdue').note,/not a verified shift policy/);
  assert.match(p.evidence.find(e=>e.id==='audit.cash').note,/Differences can cancel/);
});
test('no auth, wrong owner, cross-origin, writes, bad content and missing key cannot trigger data or AI reads',async()=>{
  for(const change of [{headers:{authorization:''}},{headers:{authorization:'Bearer '+token({sub:'other'})}},{headers:{origin:'https://evil.example'}},{method:'DELETE'},{headers:{'content-type':'text/plain'}},{body:{...base,action:'write'}}]){
    const calls=[],handler=createBoardHandler({env,fetcher:fetchFixture(calls),now:()=>now,log:()=>{}}),res=fakeResponse();
    await handler({method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json',...change.headers},body:base,...Object.fromEntries(Object.entries(change).filter(([k])=>k!=='headers'))},res);
    assert.ok(res.code>=400);assert.equal(calls.some(c=>/firestore|openai.com/.test(c.url)),false);
  }
  const calls=[],handler=createBoardHandler({env:{AI_BOARD_OWNER_UID:uid},fetcher:fetchFixture(calls),now:()=>now,log:()=>{}}),res=fakeResponse();
  await handler({method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:base},res);
  assert.equal(res.body.error.code,'ai-not-configured');assert.equal(calls.some(c=>/firestore|openai.com/.test(c.url)),false);
});
test('denied source reads remain unavailable, not zero, while safe surviving evidence stays labelled partial',async()=>{
  const q=validateQuery(base,now),result=await readEvidence(q,'token',{fetcher:fetchFixture([],{deny:'expenses'}),now:()=>now});
  assert.equal(result.data.expenses,null);const packet=calculateEvidence(result,q,now);assert.equal(packet.partial,true);assert.equal(packet.evidence.some(e=>e.id==='costs.recorded'),false);
  const wrongScope=await readEvidence({...q,branch:'Other'},'token',{fetcher:fetchFixture([]),now:()=>now});assert.ok(wrongScope.coverage.every(c=>!c.complete));
});
test('capped reads remain samples and invalid model citations or refusal cannot become reports',async()=>{
  const q=validateQuery(base,now),data=await readEvidence(q,'t',{fetcher:async()=>response(wire(Array.from({length:751},(_,i)=>({...fixture.transactions[0],id:String(i)}))))});
  assert.equal(data.coverage[0].complete,false);assert.equal(data.data.transactions.length,750);
  assert.throws(()=>validateReport(report(['invented.evidence']),[{id:'sales.net'}]),{code:'invalid-report'});
  await assert.rejects(()=>interpret({evidence:[{id:'sales.net'}]},q,{apiKey:'test',fetcher:async()=>response({status:'incomplete'})}),{code:'incomplete-report'});
});
test('rendering treats model output and branch strings as text, with visible source coverage',()=>{
  const packet=calculateEvidence({data:fixture,coverage:Object.keys(fixture).map(source=>({source,records:1,complete:false,basis:'Fixture'}))},validateQuery({...base,directorId:'mentor',branch:'<img src=x onerror=alert(1)>'},now),now);
  const r=report(packet.evidence.map(e=>e.id));r.summary='<script>alert(1)</script>';
  const html=renderBoardReport({packet,report:r,model:'fixture',requestId:'test'});
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Partial evidence/);assert.match(html,/Source coverage/);
});
test('provider quota failures have safe diagnostics and never echo a key or upstream message',async()=>{
  const q=validateQuery(base,now);
  try{await interpret({evidence:[{id:'sales.net'}]},q,{apiKey:'private-do-not-log',fetcher:async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'private-do-not-log'}}),{status:429})});assert.fail('Expected quota rejection');}
  catch(error){assert.equal(error.code,'provider-quota');assert.equal(error.service,'openai');assert.equal(error.upstreamStatus,429);assert.equal(error.providerCode,'insufficient_quota');assert.doesNotMatch(error.message,/private-do-not-log/);}
});
test('unclassified provider 429 errors and type-only quota errors stay actionable and secret-free',async()=>{
  for(const [body,code]of [[{error:{code:null,type:'insufficient_quota',message:'sk-proj-private'}},'provider-quota'],[{error:{code:'sk-proj-private',type:'sk-proj-private',message:'secret'}},'provider-limited']]){
    await assert.rejects(()=>interpret({evidence:[{id:'sales.net'}]},validateQuery(base,now),{apiKey:'test',fetcher:async()=>new Response(JSON.stringify(body),{status:429})}),error=>error.code===code&&!JSON.stringify(error).includes('sk-proj-private'));
  }
});
test('model confidence is bounded by partial coverage and the limited operational evidence set',async()=>{
  for(const [partial,expected]of [[true,'low'],[false,'medium']]){
    const r={...report(['sales.net']),confidence:'high'};
    const result=await interpret({partial,evidence:[{id:'sales.net'}]},validateQuery(base,now),{apiKey:'fixture',fetcher:async()=>response({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(r)}]}]})});
    assert.equal(result.report.confidence,expected);
  }
});
test('HTTP integration returns private structured reports and rejects unauthenticated requests',async t=>{
  const handler=createBoardHandler({env,fetcher:fetchFixture([]),now:()=>now,log:()=>{}});
  const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;try{req.body=raw?JSON.parse(raw):undefined;}catch{res.writeHead(400);res.end();return;}res.status=n=>{res.statusCode=n;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};await handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/ai-board`;
  const denied=await fetch(url);assert.equal(denied.status,401);
  const ok=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify(base)});
  assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);assert.equal((await ok.json()).packet.evidence[0].value,130.5);
});
