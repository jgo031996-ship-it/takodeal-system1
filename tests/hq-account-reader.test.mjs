import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHQAccountReader,HQ_ACCOUNT_FIELDS} from '../takodeal-manager/hq-account-reader.js';
import {resolveHQAccount} from '../takodeal-manager/hq-account-model.js';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {createUnlockGate} from '../takodeal-manager/unlock-gate.js';
const projectId='sample-hq-project',apiKey='sample-public-key',email='manager@example.test',prefix='projects/'+projectId+'/databases/(default)/documents/hq_managers/';
const profile={email,fullName:'Fictional Manager',pin:'6241',role:'Manager',active:true,permissions:['inbox'],assignedBranch:['Maa']};
const encode=value=>value===null?{nullValue:null}:typeof value==='string'?{stringValue:value}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{integerValue:String(value)}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}};
const record=(id,data=profile)=>({document:{name:prefix+id,fields:Object.fromEntries(Object.entries(data).map(([key,item])=>[key,encode(item)]))},readTime:'2030-01-10T01:00:00Z'});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const hold=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const requests=[],diagnostics=[],user={uid:'sample-hq-user',email,getIdToken:async()=> 'sample-current-id-token'},auth={currentUser:null};auth.currentUser=user;
 const read=createHQAccountReader({projectId,apiKey,auth,fetch:async(url,settings)=>{requests.push({url,settings});return options.send?options.send(url,settings):response([record('approved')]);},onDiagnostic:status=>diagnostics.push(status),...options});
 return {user,auth,read,requests,diagnostics};
}
test('fresh HTTPS reads the complete exact-email query with current token and no cache or query limit',async()=>{
 const f=fixture(),snap=await f.read(f.user);assert.equal(snap.empty,false);assert.deepEqual(snap.docs[0].data(),profile);assert.equal(snap.metadata.fromCache,false);const request=f.requests[0],body=JSON.parse(request.settings.body);assert.equal(request.settings.method,'POST');assert.equal(request.settings.cache,'no-store');assert.equal(request.settings.credentials,'omit');assert.equal(request.settings.headers.Authorization,'Bearer sample-current-id-token');assert.match(request.url,/firestore.googleapis.com\/v1\/projects\/sample-hq-project/);assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue,email);assert.equal(body.structuredQuery.from[0].collectionId,'hq_managers');assert.equal('limit'in body.structuredQuery,false);assert.deepEqual(body.structuredQuery.select.fields.map(row=>row.fieldPath),HQ_ACCOUNT_FIELDS);assert.equal(f.diagnostics.at(-1).stage,'verified');
});
test('full duplicate account history preserves latest profile, PIN and permissions, including sub-millisecond ordering',async()=>{
 const older=record('a',{...profile,pin:'1111',permissions:['all']}),newer=record('z',{...profile,pin:'7392',permissions:['inbox'],fullName:'Latest Fictional Manager'});
 for(const field of ['profileUpdatedAt','pinUpdatedAt','permissionsUpdatedAt']){older.document.fields[field]={timestampValue:'2030-01-10T01:00:00.000100Z'};newer.document.fields[field]={timestampValue:'2030-01-10T01:00:00.000900Z'};}
 const f=fixture({send:async()=>response([older,newer])}),snap=await f.read(f.user),resolved=resolveHQAccount(snap.docs.map(row=>({id:row.id,data:row.data()})));assert.equal(snap.docs.length,2);assert.equal(resolved.pin,'7392');assert.deepEqual(resolved.permissions,['inbox']);assert.equal(resolved.fullName,'Latest Fictional Manager');assert.ok(snap.docs[1].data().pinUpdatedAt.toMillis()>snap.docs[0].data().pinUpdatedAt.toMillis());assert.equal(createWorkspaceSession(f.user,resolved).isOwner,false);
});
test('conflicting saved PINs and inactive accounts remain blocked after a successful network response',async()=>{
 const f=fixture({send:async()=>response([record('a'),record('b',{...profile,pin:'other-pin'})])}),snap=await f.read(f.user);assert.throws(()=>resolveHQAccount(snap.docs.map(row=>({id:row.id,data:row.data()}))),/conflicting PIN/);
 for(const patch of [{active:false},{status:'Blocked'},{status:'Revoked'}]){const g=fixture({send:async()=>response([record('a',{...profile,...patch})])}),saved=await g.read(g.user);assert.throws(()=>createWorkspaceSession(g.user,resolveHQAccount(saved.docs.map(row=>({id:row.id,data:row.data()})))),/inactive/);}
});
test('fresh PIN recheck refuses a previously correct PIN after HQ changes it and never loads business data',async()=>{
 let currentPin='6241',loads=0;const f=fixture({send:async()=>response([record('a',{...profile,pin:currentPin})])}),gate=createUnlockGate({verifyOnUnlock:true,verify:async user=>{const snap=await f.read(user);return resolveHQAccount(snap.docs.map(row=>({id:row.id,data:row.data()})));},load:async()=>{loads++;}});await gate.identify(f.user);currentPin='7392';assert.equal(await gate.unlock('6241'),false);assert.equal(loads,0);assert.equal(await gate.unlock('7392'),true);assert.equal(loads,1);assert.equal(f.requests.length,3);
});
test('concurrent checks share one physical request; a later fresh check never reuses settled account authority',async()=>{
 const gate=hold(),f=fixture({send:async()=>gate.promise});const a=f.read(f.user),b=f.read(f.user);assert.equal(a,b);await tick();assert.equal(f.requests.length,1);gate.resolve(response([record('a')]));await Promise.all([a,b]);await tick();await f.read(f.user);assert.equal(f.requests.length,2);
});
test('timeout aborts the HTTPS request, rejects late results and cannot stack a transport that ignores abort',async()=>{
 const gate=hold(),f=fixture({timeoutMs:5,send:async()=>gate.promise}),first=f.read(f.user);await assert.rejects(first,error=>error.code==='hq/deadline-exceeded');assert.equal(f.requests[0].settings.signal.aborted,true);await assert.rejects(f.read(f.user),/timed out/);assert.equal(f.requests.length,1);gate.resolve(response([record('late')]));await tick();assert.equal(f.diagnostics.some(row=>row.stage==='verified'),false);await f.read(f.user);assert.equal(f.requests.length,2);
});
test('native-style abort settlement releases Retry for a new fresh request',async()=>{
 let calls=0;const f=fixture({timeoutMs:5,send:async(_url,settings)=>++calls===1?new Promise((_,reject)=>settings.signal.addEventListener('abort',()=>reject(Error('Synthetic aborted transport')),{once:true})):response([record('current')])});await assert.rejects(f.read(f.user),/timed out/);await tick();assert.equal((await f.read(f.user)).docs[0].id,'current');assert.equal(f.requests.length,2);
});
test('token wait is bounded and its late completion cannot start an HQ request',async()=>{
 const gate=hold(),f=fixture({timeoutMs:5});f.user.getIdToken=()=>gate.promise;await assert.rejects(f.read(f.user),error=>error.code==='hq/sign-in-timeout'&&/Reload this verification tab/.test(error.message));assert.equal(f.requests.length,0);gate.resolve('late-token');await tick();assert.equal(f.requests.length,0);assert.equal(f.diagnostics.some(row=>row.stage==='verified'),false);
});
test('account, UID and email changes during token or response wait cannot provide another account authority',async()=>{
 for(const phase of ['token','response'])for(const change of ['object','uid','email']){const gate=hold(),f=fixture({send:async()=>gate.promise});if(phase==='token')f.user.getIdToken=()=>gate.promise;const read=f.read(f.user);await tick();if(change==='object')f.auth.currentUser={...f.user};if(change==='uid')f.user.uid='other-user';if(change==='email')f.user.email='other@example.test';gate.resolve(phase==='token'?'current-token':response([record('a')]));await assert.rejects(read,error=>error.code==='hq/account-changed');if(phase==='token')assert.equal(f.requests.length,0);assert.equal(f.diagnostics.some(row=>row.stage==='verified'),false);}
});
test('wrong or expired ID tokens and Rules denials never fall back to authority cached elsewhere',async()=>{
 for(const [status,remote,code]of [[401,'UNAUTHENTICATED','hq/sign-in-expired'],[403,'PERMISSION_DENIED','hq/permission-denied'],[429,'RESOURCE_EXHAUSTED','hq/busy'],[503,'UNAVAILABLE','hq/server-unavailable']]){const f=fixture({send:async()=>response({error:{status:remote,message:'secret server detail should never be displayed'}},status)});await assert.rejects(f.read(f.user),error=>error.code===code&&!error.message.includes('secret'));assert.equal(f.requests.length,1);}
});
test('optional App Check uses its token and fails closed before an HQ request when device verification fails',async()=>{
 const f=fixture({getAppCheckToken:async()=>({token:'sample-device-token'})});await f.read(f.user);assert.equal(f.requests[0].settings.headers['X-Firebase-AppCheck'],'sample-device-token');const failed=fixture({getAppCheckToken:async()=>{throw Error('private detail');}});await assert.rejects(failed.read(failed.user),error=>error.code==='hq/device-unavailable'&&!error.message.includes('private'));assert.equal(failed.requests.length,0);
});
test('malformed, truncated, cross-project and cross-email responses fail closed without a profile',async()=>{
 const malformed=[[],{},[{readTime:'2030-01-10',skippedResults:1}],[{document:{name:prefix+'a',fields:{email:{stringValue:'other@example.test'}}}}],[{document:{name:prefix.replace(projectId,'other-project')+'a',fields:record('a').document.fields}}],[record('a'),record('a')],[{document:{name:prefix+'a/other/doc',fields:record('a').document.fields}}]];
 for(const body of malformed){const f=fixture({send:async()=>response(body)});await assert.rejects(f.read(f.user),error=>error.code==='hq/invalid-response');}
});
test('empty confirmed result stays empty and response snapshot data cannot be mutated across reads',async()=>{
 const f=fixture({send:async()=>response([{readTime:'2030-01-10T01:00:00Z'}])});assert.equal((await f.read(f.user)).empty,true);const g=fixture(),snap=await g.read(g.user),changed=snap.docs[0].data();changed.pin='tampered';changed.permissions.push('all');assert.equal(snap.docs[0].data().pin,'6241');assert.deepEqual(snap.docs[0].data().permissions,['inbox']);
});
test('diagnostics contain only stage/code/timing and no identity, PIN, profile or token',async()=>{
 const f=fixture();await f.read(f.user);for(const diagnostic of f.diagnostics)assert.deepEqual(Object.keys(diagnostic).sort(),['code','elapsedMs','stage']);const text=JSON.stringify(f.diagnostics);for(const secret of [email,profile.pin,profile.fullName,f.user.uid,'sample-current-id-token'])assert.equal(text.includes(secret),false);const source=readFileSync(new URL('../takodeal-manager/hq-account-reader.js',import.meta.url),'utf8');assert.doesNotMatch(source,/console\.|localStorage|sessionStorage|indexedDB/);
});
test('the deployed auth path uses fresh HTTPS for both checks and caches only the new static reader',()=>{
 const auth=readFileSync(new URL('../takodeal-manager/auth.js',import.meta.url),'utf8'),core=readFileSync(new URL('../takodeal-manager/firebase-core.js',import.meta.url),'utf8'),worker=readFileSync(new URL('../takodeal-manager/sw.js',import.meta.url),'utf8');assert.match(auth,/verifyOnUnlock:true/);assert.match(auth,/await window\.readHQAccountFromServer\(user\)/);assert.match(auth,/startsWith\('hq\/'\)\) throw error/);assert.match(core,/createHQAccountReader/);assert.ok(Number(worker.match(/takodeal-manager-core-v(\d+)/)?.[1])>=82);assert.doesNotMatch(worker,/owner_record_files|staff_sss_remittances|bookkeeper_payments/);assert.match(worker,/CORE_ASSETS\.push\('\.\/hq-account-reader\.js'\)/);
});
