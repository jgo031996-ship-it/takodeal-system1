import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createFranchiseBoardHandler,validateFranchiseBoardQuery,FRANCHISE_BOARD_SOURCES} from '../takodeal-manager/server/franchise-ai-board.mjs';

const NOW=Date.parse('2026-11-07T02:00:00Z'),email='branch@example.test',uid='franchise-user',ownerEmail='jgo031996@gmail.com';
const key=generateKeyPairSync('rsa',{modulusLength:2048}),pem=key.publicKey.export({type:'spki',format:'pem'});
const claims={sub:uid,email,email_verified:true,aud:'takodeal-pos',iss:'https://securetoken.google.com/takodeal-pos',iat:NOW/1000-10,auth_time:NOW/1000-20,exp:NOW/1000+3600,firebase:{sign_in_provider:'google.com'}};
function token(change={},header={alg:'RS256',kid:'fixture'}){const parts=[header,{...claims,...change}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url'));return parts.join('.')+'.'+sign('RSA-SHA256',Buffer.from(parts.join('.')),key.privateKey).toString('base64url');}
const base={branch:'Maa',from:'2026-11-01',to:'2026-11-07',mode:'snapshot'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const encode=value=>value===null?{nullValue:null}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{doubleValue:value}:typeof value==='string'&&/^20\d\d-\d\d-\d\dT/.test(value)?{timestampValue:value}:{stringValue:value};
const document=(table,id,row)=>({name:`projects/takodeal-pos/databases/(default)/documents/${table}/${id}`,fields:Object.fromEntries(Object.entries(row).map(([field,value])=>[field,encode(value)]))});
const wire=(table,rows)=>rows.map((row,index)=>({document:document(table,row.id||'row-'+index,Object.fromEntries(Object.entries(row).filter(([field])=>field!=='id')))}));
const fixtureData=()=>({
 transactions:[{branch:'Maa',timestamp:'2026-11-06T04:00:00Z',netTotal:100,paymentMethod:'GCash',paymentVerified:false,globalDiscountAmount:5,customerName:'PRIVATE CUSTOMER',paymentReference:'PRIVATE REFERENCE',receiptId:'PRIVATE RECEIPT'},{branch:'Maa',timestamp:'2026-11-06T05:00:00Z',status:'Voided',netTotal:999,paymentMethod:'Cash'}],
 expenses:[{branch:'Maa',timestamp:'2026-11-06T04:00:00Z',amount:30,staffName:'PRIVATE STAFF'}],
 inventory:[{branch:'Maa',currentStock:-1,reorderLevel:5,name:'PRIVATE ITEM'}],
 stock_logs:[{branch:'Maa',timestamp:'2026-11-06T04:00:00Z',variance:2,staffName:'PRIVATE STAFF'}],
 shifts:[{branch:'Maa',startTime:'2026-11-06T00:30:00Z',active:false,expectedCash:300,declaredCash:290,cashier:'PRIVATE STAFF',pin:'PRIVATE PIN'}],
 attendance_logs:[{branch:'Maa',timestamp:'2026-11-06T04:00:00Z',type:'TIME IN',isManual:true,staffName:'PRIVATE STAFF',hourlyRate:12345,photoBase64:'PRIVATE PHOTO'}]
});
function aiResult(body){const schema=body.text.format.schema,board={summary:'Review the supplied recorded evidence.',priorities:['Confirm evidence gaps before deciding.'],directors:Object.fromEntries(Object.entries(schema.properties.directors.properties).map(([id,definition])=>[id,{summary:'Review these recorded signals with their limitations.',actions:['Reconcile the underlying records before deciding.'],evidenceIds:(definition.properties.evidenceIds.items.enum??[]).slice(0,1)}])),limitations:[schema.properties.limitations.items.enum[0]]};return {status:'completed',usage:{input_tokens:2000,output_tokens:700,total_tokens:2700,output_tokens_details:{reasoning_tokens:0},input_tokens_details:{cached_tokens:0,cache_write_tokens:2000,cache_write_tokens_details:{ttl_30m_tokens:2000,ttl_12h_tokens:0}},private:'PRIVATE USAGE'},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(board)}]}]};}
function fixture(options={}){
 const state={now:NOW,profile:{email,role:'Franchisee',assignedBranch:['Maa'],permissions:['all'],active:true,profileUpdatedAt:'2026-11-01T00:00:00Z',permissionsUpdatedAt:'2026-11-01T00:00:00Z'},grant:{active:true,allowedBranches:['Maa'],permissions:['all'],accessVersion:1},registered:[{name:'Maa',active:true}],data:fixtureData(),...options.state};
 const calls=[],logs=[],fetcher=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,init,body});
  if(url.includes('/metadata/x509/'))return response({fixture:pem});
  if(url.includes('accounts:lookup')){if(options.accountError)return response({},400);const saved=JSON.parse(Buffer.from(body.idToken.split('.')[1],'base64url'));return response({users:[{localId:saved.sub,email:saved.email,emailVerified:true,validSince:String(NOW/1000-100),providerUserInfo:[{providerId:'google.com'}],...state.account}]});}
  if(url.includes('/hq_email_access/'))return options.missingGrant?response({},404):response(document('hq_email_access',email,state.grant));
  if(url.endsWith(':runQuery')){
   const table=body.structuredQuery.from[0].collectionId;
   if(table==='hq_managers')return response(wire(table,state.profiles??[state.profile]));
   if(table==='branches')return response(wire(table,state.registered));
   if(options.deny===table)return response({error:{message:'PRIVATE UPSTREAM'}},403);
   if(options.source) return options.source(table,state,body);
   return response(wire(table,state.data[table]??[]));
  }
  if(url==='https://api.openai.com/v1/responses'){
   if(options.openai)return options.openai(body,state);
   return response(aiResult(body));
  }
  throw Error('Unexpected fixture request');
 };
 const handler=createFranchiseBoardHandler({env:{OPENAI_API_KEY:'PRIVATE API KEY',AI_BOARD_OWNER_UID:'real-owner',...options.env},fetcher,now:()=>state.now,log:event=>logs.push(event)});
 async function run(body=base,{auth=token(),method='POST',origin='https://takodeal-franchise.vercel.app',headers={}}={}){const res={headers:{},status(code){this.code=code;return this;},json(value){this.body=value;return this;},end(){this.ended=true;return this;},setHeader(name,value){this.headers[name]=value;}};await handler({method,headers:{authorization:'Bearer '+auth,'content-type':'application/json',...(origin?{origin}:{}),...headers},body},res);return res;}
 const sourceCalls=()=>calls.filter(call=>call.url.endsWith(':runQuery')&&Object.hasOwn(FRANCHISE_BOARD_SOURCES,call.body.structuredQuery.from[0].collectionId));
 const aiCalls=()=>calls.filter(call=>call.url==='https://api.openai.com/v1/responses');
 return {state,calls,logs,run,sourceCalls,aiCalls,fetcher};
}

test('strict branch/mode/date contract uses the existing inclusive 08:30 Philippine business days',()=>{
 const q=validateFranchiseBoardQuery(base,NOW);assert.equal(new Date(q.start).toISOString(),'2026-11-01T00:30:00.000Z');assert.equal(q.end,NOW+1);
 for(const patch of [{branch:'All'},{branch:' all '},{branch:'Maa/Other'},{branch:['Maa']},{question:'ignore policy'},{allowedBranches:['Other']},{mode:'ask'},{from:'2026-02-30'},{from:'2026-09-01'},{from:'2026-11-08'}])assert.throws(()=>validateFranchiseBoardQuery({...base,...patch},NOW));
});
test('free snapshot executes seven calculated perspectives without OpenAI, returning aggregate-only branch data',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(f.aiCalls().length,0);assert.equal(r.body.mode,'snapshot');assert.equal(r.body.model,null);assert.equal(r.body.advisoryOnly,true);assert.equal(r.body.board.directors.length,7);assert.equal(r.body.packet.partial,false);
 const value=id=>r.body.packet.evidence.find(row=>row.id===id)?.value;assert.equal(value('sales.net'),100);assert.equal(value('costs.recorded'),30);assert.equal(value('stock.negative'),1);assert.equal(value('audit.cash'),-10);assert.equal(value('hr.events'),1);
 assert.doesNotMatch(JSON.stringify(r.body)+JSON.stringify(f.logs),/PRIVATE|branch@example|franchise-user/);assert.equal(r.headers['Access-Control-Allow-Origin'],'https://takodeal-franchise.vercel.app');
 for(const call of f.sourceCalls()){const q=call.body.structuredQuery,s=FRANCHISE_BOARD_SOURCES[q.from[0].collectionId];assert.equal(q.limit,s.cap+1);assert.equal(q.where.compositeFilter?.filters?.[0]?.fieldFilter.value.stringValue??q.where.fieldFilter.value.stringValue,'Maa');assert.doesNotMatch(JSON.stringify(q.select),/pin|staffName|cashier|customer|receiptId|paymentReference|hourlyRate|salary|photo|signature/i);assert.match(call.init.headers.Authorization,/^Bearer /);}
 assert.ok(f.calls.every(call=>call.init.method===undefined||call.init.method==='POST'));assert.equal(r.body.board.confidence,'medium');
});
test('arbitrary saved payment labels cannot export customer references as channel names',async()=>{const f=fixture();f.state.data.transactions[0].paymentMethod='PRIVATE CUSTOMER REFERENCE';const r=await f.run();assert.equal(r.code,200);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);assert.ok(r.body.packet.evidence.some(row=>row.label==='Other payment method'));});
test('prototype-like payment labels are treated as unrecognized text rather than inherited objects',async()=>{const f=fixture(),row=f.state.data.transactions[0];f.state.data.transactions=['constructor','__proto__','toString','Cash'].map(paymentMethod=>({...row,paymentMethod}));const r=await f.run();assert.equal(r.code,200);assert.equal(r.body.packet.evidence.find(item=>item.label==='Other payment method').value,300);assert.equal(r.body.packet.evidence.find(item=>item.label==='Cash').value,100);});
test('dashboard access exposes only actual Dashboard aggregates, without inventory or shift data',async()=>{
 const f=fixture({state:{profile:{email,role:'Franchisee',assignedBranch:['Maa'],permissions:['dashboard'],active:true},grant:{active:true,allowedBranches:['Maa'],permissions:['all','dashboard']}}}),r=await f.run();assert.equal(r.code,200);assert.deepEqual(f.sourceCalls().map(call=>call.body.structuredQuery.from[0].collectionId).sort(),['attendance_logs','expenses','transactions']);assert.equal(r.body.packet.partial,true);assert.match(r.body.board.directors.find(row=>row.id==='inventory').summary,/No permitted source evidence/);assert.equal(r.body.packet.evidence.some(row=>row.source==='shifts'),false);
});
test('explicit Board permission does not widen source access and saved/protected permissions intersect',async()=>{
 const f=fixture({state:{profile:{email,role:'Franchisee',assignedBranch:['Maa'],permissions:['ai-board','inventory'],active:true},grant:{active:true,allowedBranches:['Maa'],permissions:['ai-board']}}}),r=await f.run();assert.equal(r.code,200);assert.equal(f.sourceCalls().length,0);assert.equal(r.body.packet.evidence.length,0);assert.equal(r.body.board.directors.length,7);const b=await f.run({...base,mode:'briefing'});assert.equal(b.body.error.code,'no-evidence');assert.equal(f.aiCalls().length,0);
});
test('all permissions are intersected semantically with narrower saved or protected source grants',async()=>{
 for(const [saved,protectedPermissions]of [[['all'],['dashboard']],[['dashboard'],['all']]]){const f=fixture({state:{profile:{email,role:'Franchisee',assignedBranch:['Maa'],permissions:saved,active:true},grant:{active:true,allowedBranches:['Maa'],permissions:protectedPermissions}}}),r=await f.run();assert.equal(r.code,200);assert.deepEqual(f.sourceCalls().map(call=>call.body.structuredQuery.from[0].collectionId).sort(),['attendance_logs','expenses','transactions']);}
});
test('unauthenticated, malformed, forged, wrong-project and non-Google tokens cannot read business data or call AI',async()=>{
 const forged=token().split('.');forged[2]='a'.repeat(forged[2].length);
 for(const auth of ['', 'not-a-token',forged.join('.'),token({aud:'wrong'}),token({iss:'https://wrong.example'}),token({exp:NOW/1000}),token({iat:NOW/1000+1}),token({auth_time:NOW/1000+1}),token({email_verified:false}),token({firebase:{sign_in_provider:'password'}}),token({}, {alg:'none',kid:'fixture'})]){const f=fixture(),r=await f.run(base,{auth});assert.equal(r.code,401);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);}
});
test('disabled, revoked, changed-email and unlinked-Google accounts fail before grants or branch data',async()=>{
 for(const account of [{disabled:true},{validSince:String(NOW/1000)},{emailVerified:false},{email:'other@example.test'},{localId:'other'}, {providerUserInfo:[{providerId:'password'}]}]){const f=fixture({state:{account}}),r=await f.run();assert.equal(r.code,401);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);assert.equal(f.calls.some(call=>call.url.includes('/hq_email_access/')),false);}
});
test('missing protected grants and rejected fresh Auth sessions report access failures before branch reads',async()=>{for(const [options,status]of [[{missingGrant:true},403],[{accountError:true},401]]){const f=fixture(options),r=await f.run();assert.equal(r.code,status);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);}});
test('forged branch scope, inactive grants, HQ manager all and conflicting access profiles fail before branch data',async()=>{
 for(const change of [{grant:{active:false,allowedBranches:['Maa'],permissions:['all']}},{grant:{active:'true',allowedBranches:['Maa'],permissions:['all']}},{grant:{active:true,allowedBranches:['All'],permissions:['all']}},{profile:{email,role:'Manager',assignedBranch:['Maa'],permissions:['all'],active:true}},{profile:{email,role:'Franchisee',assignedBranch:['All'],permissions:['all'],active:true}},{profile:{email,role:'Franchisee',assignedBranch:['Maa'],permissions:['all'],status:'Terminated'}},{profiles:[{id:'one',email,role:'Franchisee',assignedBranch:['Maa'],permissions:['all'],active:true},{id:'two',email,role:'Manager',assignedBranch:['Other'],permissions:['all'],active:true}]}]){const f=fixture({state:change}),r=await f.run();assert.equal(r.code,403,JSON.stringify(change));assert.equal(f.sourceCalls().length+f.aiCalls().length,0);}
 const f=fixture(),r=await f.run({...base,branch:'Other'});assert.equal(r.code,403);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);
});
test('archived and deleted saved HQ profiles cannot inherit an active protected grant',async()=>{
 for(const patch of [{archived:true},{deleted:true},{blocked:true}]){const f=fixture();Object.assign(f.state.profile,patch);const r=await f.run();assert.equal(r.code,403);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);const projection=f.calls.find(call=>call.body?.structuredQuery?.from[0].collectionId==='hq_managers').body.structuredQuery.select.fields.map(field=>field.fieldPath);assert.ok(projection.includes('archived'));assert.ok(projection.includes('deleted'));assert.doesNotMatch(JSON.stringify(projection),/pin|fullName|phone/i);}
});
test('missing, duplicate and inactive canonical branch records cannot produce a report, including Owner preview',async()=>{
 for(const registered of [[],[{name:'Maa',active:false}],[{name:'Maa',status:'Closed'}],[{name:'Maa'},{name:'Maa'}],[{name:'Other'}]]){const f=fixture({state:{registered}}),r=await f.run();assert.equal(r.code,403);assert.equal(f.sourceCalls().length+f.aiCalls().length,0);}
 const f=fixture(),ok=await f.run(base,{auth:token({sub:'real-owner',email:ownerEmail})});assert.equal(ok.code,200);assert.equal(f.calls.some(call=>call.url.includes('/hq_email_access/')),false);assert.equal(f.calls.some(call=>call.body?.structuredQuery?.from[0].collectionId==='branches'),true);
 const denied=fixture(),r=await denied.run(base,{auth:token({sub:'impostor-owner',email:ownerEmail})});assert.equal(r.code,403);assert.equal(denied.sourceCalls().length,0);
});
test('unavailable, capped and wrong-branch source data stay partial without a fallback or invented zero',async()=>{
 const denied=fixture({deny:'expenses'}),r=await denied.run();assert.equal(r.code,200);assert.equal(r.body.packet.partial,true);assert.equal(r.body.packet.evidence.some(row=>row.id==='costs.recorded'),false);assert.equal(denied.sourceCalls().filter(call=>call.body.structuredQuery.from[0].collectionId==='expenses').length,1);
 const capped=fixture();capped.state.data.transactions=Array.from({length:751},()=>capped.state.data.transactions[0]);const cap=await capped.run();assert.equal(cap.body.packet.coverage.find(row=>row.source==='transactions').complete,false);assert.equal(cap.body.packet.evidence.find(row=>row.id==='sales.net').value,75000);assert.equal(cap.body.board.confidence,'low');
 const foreign=fixture();foreign.state.data.inventory=[{branch:'Other',currentStock:999,reorderLevel:10}];const bad=await foreign.run();assert.equal(bad.code,200);assert.equal(bad.body.packet.evidence.some(row=>row.source==='inventory'),false);assert.doesNotMatch(JSON.stringify(bad.body),/999|Other/);
});
test('source response names, row shapes and duplicate IDs are validated before aggregation',async()=>{
 for(const malformed of [[{document:{name:'projects/other/databases/(default)/documents/transactions/a',fields:{}}}],[{document:{name:'projects/takodeal-pos/databases/(default)/documents/expenses/a',fields:{}}}],[{document:{name:'projects/takodeal-pos/databases/(default)/documents/transactions/',fields:{}}}],[{document:{name:'projects/takodeal-pos/databases/(default)/documents/transactions/a/nested/b',fields:{}}}],wire('transactions',[{id:'same',...fixtureData().transactions[0]},{id:'same',...fixtureData().transactions[0]}]),[null],[{}],[{document:'invalid'}]]){
  const f=fixture({source:async(table,state)=>response(table==='transactions'?malformed:wire(table,state.data[table]??[]))}),r=await f.run();assert.equal(r.code,200);assert.equal(r.body.packet.coverage.find(row=>row.source==='transactions').complete,false);assert.equal(r.body.packet.evidence.some(row=>row.source==='transactions'),false);
 }
 const empty=fixture({source:async table=>response([{readTime:'2026-11-07T02:00:00Z'}])}),r=await empty.run();assert.equal(r.code,200);assert.equal(r.body.packet.partial,false);assert.equal(r.body.packet.evidence.find(row=>row.id==='sales.net').value,0);
});
test('identical snapshots reuse the soft server cache but always refresh account and protected grants first',async()=>{
 const f=fixture(),one=await f.run(),firstCount=f.sourceCalls().length;assert.equal(one.code,200);f.state.now+=1000;const two=await f.run();assert.equal(two.body.cache.snapshot,true);assert.equal(two.body.packet.asOf,one.body.packet.asOf);assert.equal(f.sourceCalls().length,firstCount);assert.equal(f.calls.filter(call=>call.url.includes('accounts:lookup')).length,4);
 f.state.grant.active=false;const revoked=await f.run();assert.equal(revoked.code,403);assert.equal(f.sourceCalls().length,firstCount);
});
test('one optional Luna call produces seven concise roles and identical meaningful evidence reuses the briefing cache',async()=>{
 const f=fixture(),one=await f.run({...base,mode:'briefing'});assert.equal(one.code,200,JSON.stringify(one.body));assert.equal(f.aiCalls().length,1);const call=f.aiCalls()[0].body;assert.equal(call.model,'gpt-6-luna');assert.equal(call.reasoning.effort,'none');assert.equal(call.max_output_tokens,2200);assert.equal(call.text.verbosity,'low');assert.equal(call.store,false);assert.equal(call.tools,undefined);assert.doesNotMatch(call.input,/PRIVATE|branch@example|franchise-user/);assert.equal(one.body.board.directors.length,7);
 f.state.now+=61000;const two=await f.run({...base,mode:'briefing'});assert.equal(two.code,200);assert.equal(two.body.cache.snapshot,false);assert.equal(two.body.cache.briefing,true);assert.notEqual(two.body.packet.asOf,one.body.packet.asOf);assert.equal(two.body.generatedAt,one.body.generatedAt);assert.equal(f.aiCalls().length,1);assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE/);
 const usage=f.logs.find(row=>row.event==='franchise-board-usage');assert.equal(usage.usage.output_tokens_details.reasoning_tokens,0);assert.equal(usage.usage.input_tokens_details.cache_write_tokens_details.ttl_30m_tokens,2000);
});
test('changes to evidence invalidate AI cache and paid-call rate limits do not affect free snapshots',async()=>{
 const f=fixture();for(let at=0;at<2;at++){f.state.now+=61000;f.state.data.transactions[0].netTotal+=1;assert.equal((await f.run({...base,mode:'briefing'})).code,200);}f.state.now+=61000;f.state.data.transactions[0].netTotal+=1;const limited=await f.run({...base,mode:'briefing'});assert.equal(limited.code,429);assert.equal(limited.body.error.code,'briefing-limit');assert.equal(f.aiCalls().length,2);assert.equal((await f.run()).code,200);
});
test('concurrent busy requests cannot release an existing UID lock or start another paid generation',async()=>{
 let finish;const held=new Promise(resolve=>finish=resolve),f=fixture({openai:async body=>{await held;return response(aiResult(body));}}),first=f.run({...base,mode:'briefing'});
 for(let at=0;at<10&&!f.aiCalls().length;at++)await new Promise(setImmediate);assert.equal(f.aiCalls().length,1);
 assert.equal((await f.run({...base,mode:'briefing'})).code,429);assert.equal((await f.run({...base,mode:'briefing'})).code,429);assert.equal(f.aiCalls().length,1);finish();assert.equal((await first).code,200);const cached=await f.run({...base,mode:'briefing'});assert.equal(cached.code,200);assert.equal(cached.body.cache.briefing,true);assert.equal(f.aiCalls().length,1);
});
test('narrowing source permissions during valid AI generation prevents disclosure and invalidates cached scope',async()=>{
 let finish;const held=new Promise(resolve=>finish=resolve);let first=true;const f=fixture({openai:async body=>{if(first){first=false;await held;}return response(aiResult(body));}}),pending=f.run({...base,mode:'briefing'});
 for(let at=0;at<10&&!f.aiCalls().length;at++)await new Promise(setImmediate);f.state.profile.permissions=['dashboard'];finish();const rejected=await pending;assert.equal(rejected.code,403);assert.equal(rejected.body.error.code,'access-changed');assert.equal(rejected.body.packet,undefined);
 const retried=await f.run({...base,mode:'briefing'});assert.equal(retried.code,200);assert.equal(retried.body.cache.briefing,false);assert.equal(f.aiCalls().length,2);assert.doesNotMatch(f.aiCalls()[1].body.input,/"stock\./);assert.match(retried.body.board.directors.find(row=>row.id==='inventory').summary,/No permitted source evidence/);
});
test('invalid AI citations or oversized role actions fail closed and do not become cached reports',async()=>{
 for(const patch of [board=>{board.directors.finance.evidenceIds=['other-branch.fact'];},board=>{board.directors.hr.actions=['one','two','three'];}]){
  const f=fixture({openai:async body=>{const result=aiResult(body),board=JSON.parse(result.output[0].content[0].text);patch(board);result.output[0].content[0].text=JSON.stringify(board);return response(result);}}),r=await f.run({...base,mode:'briefing'});assert.equal(r.code,502);assert.equal(r.body.error.code,'invalid-briefing');assert.equal(r.body.board,undefined);assert.equal(f.logs.filter(row=>row.event==='franchise-board-usage').length,1);assert.equal((await f.run()).code,200);
 }
});
test('revocation during AI work prevents both response disclosure and cache admission',async()=>{
 const f=fixture({openai:async(_body,state)=>{state.grant.active=false;return response({status:'incomplete',usage:{input_tokens:10,output_tokens:20}});}}),r=await f.run({...base,mode:'briefing'});assert.equal(r.code,502);assert.equal(r.body.error.code,'incomplete-briefing');assert.equal(f.logs.find(row=>row.event==='franchise-board-usage').usage.output_tokens,20);
 // A valid generation is also held if access changes before its final authorization.
 const g=fixture(),read=g.fetcher;let switched=false;const handler=createFranchiseBoardHandler({env:{OPENAI_API_KEY:'PRIVATE API KEY'},now:()=>NOW,fetcher:async(url,init)=>{const answer=await read(url,init);if(url==='https://api.openai.com/v1/responses'){g.state.grant.active=false;switched=true;}return answer;},log:()=>{}}),res={headers:{},setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json',origin:'https://takodeal-franchise.vercel.app'},body:{...base,mode:'briefing'}},res);assert.equal(switched,true);assert.equal(res.code,403);assert.equal(res.body.packet,undefined);
});
test('unsupported Franchise model overrides cannot inherit Owner model settings or trigger paid work',async()=>{
 const f=fixture({env:{FRANCHISE_AI_BOARD_MODEL:'gpt-6.1-terra',AI_BOARD_MODEL:'gpt-6.1-terra'}}),free=await f.run();assert.equal(free.code,200);assert.equal(free.body.aiAvailable,false);const r=await f.run({...base,mode:'briefing'});assert.equal(r.code,503);assert.equal(r.body.error.code,'unsupported-ai-model');assert.equal(f.aiCalls().length,0);
 const missing=fixture({env:{OPENAI_API_KEY:''}});assert.equal((await missing.run()).code,200);assert.equal((await missing.run({...base,mode:'briefing'})).body.error.code,'ai-not-configured');assert.equal(missing.aiCalls().length,0);
});
test('CORS preflight is exact and unauthenticated; bad origins/methods/content do not read any account or source',async()=>{
 const f=fixture(),preflight=await f.run(undefined,{method:'OPTIONS',auth:''});assert.equal(preflight.code,204);assert.equal(preflight.ended,true);assert.equal(f.calls.length,0);
 for(const options of [{origin:'https://evil.example'},{origin:'https://takodeal-franchise-preview.vercel.app'},{method:'GET'},{headers:{'content-type':'text/plain'}}]){const g=fixture(),r=await g.run(base,options);assert.ok(r.code>=400);assert.equal(g.calls.length,0);}
});
