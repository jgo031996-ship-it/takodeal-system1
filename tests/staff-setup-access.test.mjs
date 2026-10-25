import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installStaffRegistration} from '../takodeal-staff/staff-registration.js';
import {normalizeSetupCode,freshSetupId,STAFF_SETUP_ENDPOINT,STAFF_SETUP_DRAFT,createStaffSetupTransport,createStaffSetupAuthority,validateSetupStatus,readSetupStaffDirectory,installStaffSetupGate} from '../takodeal-staff/staff-setup-access.js';
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
function deadlineClock(){const timers=new Map();let id=0;return {delay:fn=>(timers.set(++id,fn),id),cancelDelay:key=>timers.delete(key),expire(){for(const [key,fn] of [...timers]){timers.delete(key);fn();}},size:()=>timers.size};}
const deviceId='DEV-12345678-1234-4123-8123-123456789000';
const protectedState=(overrides={})=>({enabled:true,mode:'protected',device:{staffId:'staff-a',staffName:'Sample Staff',branch:'Maa',deviceId,status:'Active',...overrides}});
function authHarness(){const user={uid:'uid-a',getIdToken:async()=>'firebase-token'},auth={currentUser:user};return {auth,user,ensureUser:async()=>auth.currentUser};}
test('setup code normalizes display spacing but refuses partial, alphabetic or overlong input',()=>{
    assert.equal(normalizeSetupCode('12345-67890'),'1234567890');assert.equal(normalizeSetupCode('12345 67890'),'1234567890');
    for(const value of ['1234','12345678901','1234x67890','<script>',''])assert.throws(()=>normalizeSetupCode(value),/10-digit/);
    assert.match(freshSetupId({getRandomValues:array=>array.fill(17)}),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.throws(()=>freshSetupId({}),/Secure device setup/);
});
test('transport uses fixed HTTPS endpoint and Firebase bearer auth with no cookie or cache fallback',async()=>{
    const h=authHarness(),calls=[],transport=createStaffSetupTransport({...h,fetcher:async(url,options)=>{calls.push({url,options});return response(200,{enabled:false});}});
    await transport.call('/config',{});assert.equal(calls[0].url,STAFF_SETUP_ENDPOINT+'/config');assert.equal(calls[0].options.headers.Authorization,'Bearer firebase-token');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.redirect,'error');
    await assert.rejects(()=>transport.call('/unknown',{}),/Unsupported/);assert.equal(calls.length,1);
});
test('changed authentication during token retrieval stops before sending a setup code',async()=>{
    const h=authHarness(),token=deferred();let calls=0;h.user.getIdToken=()=>token.promise;
    const transport=createStaffSetupTransport({...h,fetcher:async()=>{calls++;return response(200,{});}}),pending=transport.call('/activate',{code:'1234567890'});await new Promise(setImmediate);h.auth.currentUser={uid:'uid-b'};token.resolve('old-token');await assert.rejects(pending,/session changed/);assert.equal(calls,0);
});
test('transport retains generic server code errors as plain text and deadline cannot imply activation',async()=>{
    const h=authHarness();const blocked=createStaffSetupTransport({...h,fetcher:async()=>response(429,{error:{code:'RATE_LIMITED',message:'Too many attempts. Try again later.'}})});
    await assert.rejects(blocked.call('/activate',{}),/Too many attempts/);
    const clock=deadlineClock(),transport=createStaffSetupTransport({...h,...clock,fetcher:async(url,options)=>new Promise((ok,no)=>options.signal.addEventListener('abort',()=>no({name:'AbortError'})))});
    const pending=transport.call('/device-status',{deviceId});await new Promise(setImmediate);clock.expire();await assert.rejects(pending,/not confirmed/);assert.equal(clock.size(),0);
});
test('never resolving authentication times out, releases the shared flight and supports a fresh retry',async()=>{
    const h=authHarness(),clock=deadlineClock(),stalled=deferred();let ensure=()=>stalled.promise,calls=0;
    const transport=createStaffSetupTransport({...h,...clock,ensureUser:context=>ensure(context),fetcher:async()=>{calls++;return response(200,{});}}),first=transport.ready();await new Promise(setImmediate);clock.expire();await assert.rejects(first,/session could not be confirmed/);assert.equal(clock.size(),0);
    ensure=async()=>h.user;assert.equal((await transport.ready()).uid,h.user.uid);stalled.resolve(h.user);await new Promise(setImmediate);assert.equal(calls,0);assert.equal(clock.size(),0);
});
test('an overall deadline covers authentication before token and a late auth result cannot send a setup code',async()=>{
    const h=authHarness(),clock=deadlineClock(),stalled=deferred();let fetches=0;
    const transport=createStaffSetupTransport({...h,...clock,ensureUser:()=>stalled.promise,fetcher:async()=>{fetches++;return response(200,{});}}),pending=transport.call('/activate',{code:'1234567890'});await new Promise(setImmediate);clock.expire();await assert.rejects(pending,/not confirmed|session could not be confirmed/);stalled.resolve(h.user);await new Promise(setImmediate);assert.equal(fetches,0);assert.equal(clock.size(),0);
});
test('a never resolving or late token is bounded and never transmits a code after expiry',async()=>{
    const h=authHarness(),clock=deadlineClock(),token=deferred();let fetches=0;h.user.getIdToken=()=>token.promise;
    const transport=createStaffSetupTransport({...h,...clock,fetcher:async()=>{fetches++;return response(200,{});}}),pending=transport.call('/activate',{code:'1234567890'});await new Promise(setImmediate);clock.expire();await assert.rejects(pending,/not confirmed/);token.resolve('late-token');await new Promise(setImmediate);assert.equal(fetches,0);assert.equal(clock.size(),0);
    h.user.getIdToken=async()=>'fresh';await transport.call('/config',{});assert.equal(fetches,1);
});
test('JSON and fetch responses that ignore abort still settle the request deadline and cannot restore authority',async()=>{
    for(const stage of ['fetch','json']){
        const h=authHarness(),clock=deadlineClock(),stalled=deferred();
        const transport=createStaffSetupTransport({...h,...clock,fetcher:async()=>stage==='fetch'?stalled.promise:{ok:true,status:200,json:()=>stalled.promise}}),authority=createStaffSetupAuthority({transport,getUid:()=>h.auth.currentUser.uid}),pending=authority.confirm(deviceId);
        await new Promise(setImmediate);clock.expire();await assert.rejects(pending,/not confirmed/);stalled.resolve(stage==='fetch'?response(200,protectedState()):protectedState());await new Promise(setImmediate);assert.equal(authority.isVerified(),false);assert.equal(clock.size(),0);
    }
});
test('directory token and body parsing are bounded and late tokens cannot begin a directory download',async()=>{
    for(const stage of ['token','json']){
        const clock=deadlineClock(),stalled=deferred();let fetches=0;const pending=readSetupStaffDirectory({projectId:'test',apiKey:'public',...clock,getToken:()=>stage==='token'?stalled.promise:'token',fetcher:async()=>{fetches++;return {ok:true,json:()=>stalled.promise};}});await new Promise(setImmediate);clock.expire();await assert.rejects(pending,/took too long/);stalled.resolve(stage==='token'?'late-token':{documents:[]});await new Promise(setImmediate);assert.equal(fetches,stage==='token'?0:1);assert.equal(clock.size(),0);
    }
});
test('only explicit disabled legacy mode or an active exact bound phone is verified',async()=>{
    let uid='uid-a',payload=protectedState(),now=0;const transport={ready:async()=>({uid}),call:async()=>payload};
    const authority=createStaffSetupAuthority({transport,getUid:()=>uid,now:()=>now});assert.equal(authority.isVerified(),false);await authority.confirm(deviceId);assert.equal(authority.isVerified(),true);assert.equal(authority.assertStaff('staff-a'),true);assert.throws(()=>authority.assertStaff('staff-b'),/different staff/);
    const binding=authority.binding();binding.staffId='staff-b';assert.equal(authority.binding().staffId,'staff-a');
    now=60001;assert.equal(authority.isVerified(),false);payload={enabled:true,mode:'legacy',device:null};await assert.rejects(authority.confirm(deviceId),/unsupported/);assert.equal(authority.isVerified(),false);
    payload={enabled:false,mode:'legacy',device:null};await authority.confirm(deviceId);assert.equal(authority.assertStaff('staff-b'),true);
    payload={...protectedState(),enabled:false};await authority.confirm(deviceId);assert.equal(authority.assertStaff('staff-a'),true);assert.throws(()=>authority.assertStaff('staff-b'),/different staff/);
});
test('public mirror fields, another phone, malformed status and no binding never become activation authority',()=>{
    for(const data of [{enabled:true,mode:'protected',device:null},{enabled:false,mode:'legacy',device:{status:'Active'}},{...protectedState(),device:{...protectedState().device,deviceId:'DEV-OTHER0000'}},protectedState({status:'Approved'})]){
        if(data.device===null){assert.equal(validateSetupStatus(data,deviceId).device,null);continue;}
        assert.throws(()=>validateSetupStatus(data,deviceId));
    }
});
test('newer blocked response wins over a stale active result and invalidation cancels saved authorization',async()=>{
    let uid='uid-a',calls=[];const transport={ready:async()=>({uid}),call:()=>{const item=deferred();calls.push(item);return item.promise;}};
    const authority=createStaffSetupAuthority({transport,getUid:()=>uid});const old=authority.confirm(deviceId);await new Promise(setImmediate);const current=authority.confirm(deviceId);await new Promise(setImmediate);calls[1].resolve(protectedState({status:'Blocked'}));await current;calls[0].resolve(protectedState());await assert.rejects(old,/session changed/);assert.equal(authority.isVerified(),false);
    const pending=authority.confirm(deviceId);await new Promise(setImmediate);authority.invalidate();calls[2].resolve(protectedState());await assert.rejects(pending,/session changed/);assert.equal(authority.isVerified(),false);
});
test('login authority snapshot survives harmless status refresh but not UID/staff changes or blocks',async()=>{
    let uid='uid-a',payload=protectedState();const authority=createStaffSetupAuthority({transport:{ready:async()=>({uid}),call:async()=>payload},getUid:()=>uid});
    await authority.confirm(deviceId);const snapshot=authority.capture();await authority.confirm(deviceId);assert.equal(authority.assert(snapshot,'staff-a'),true);
    uid='uid-b';assert.equal(authority.isVerified(),false);assert.throws(()=>authority.assert(snapshot,'staff-a'),/session changed/);
    uid='uid-a';payload=protectedState({status:'Blocked'});await authority.confirm(deviceId);assert.throws(()=>authority.assert(snapshot,'staff-a'),/session changed/);
});
test('directory requests only minimal fields, traverses pages, excludes inactive and never returns unknown private fields',async()=>{
    const urls=[];const row=(id,name,status='Active')=>({name:'projects/test/databases/(default)/documents/cashiers/'+id,fields:{cashierName:{stringValue:name},branch:{stringValue:'Maa'},status:{stringValue:status},pin:{stringValue:'NOT-RETURNED'},bank:{stringValue:'NOT-RETURNED'}}});
    const rows=await readSetupStaffDirectory({projectId:'test',apiKey:'public',getToken:async()=>'token',fetcher:async url=>{urls.push(url);return response(200,urls.length===1?{documents:[row('staff-b','Bee'),row('staff-x','Inactive','Revoked')],nextPageToken:'next'}:{documents:[row('staff-a','Aye')]});}});
    assert.deepEqual(rows.map(r=>r.staffId),['staff-a','staff-b']);assert.equal(urls.length,2);assert.match(urls[1],/pageToken=next/);assert.ok(urls.every(url=>new URL(url).searchParams.getAll('mask.fieldPaths').join(',')==='cashierName,branch,status,active,archived,blocked'));assert.equal(JSON.stringify(rows).includes('NOT-RETURNED'),false);
});
function uiHarness(){
    const nodes=new Map(),store=new Map(),timers=new Map(),events=new Map();let timerId=0,uuid=0,loginCalls=0,legacyCalls=0;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',style:{},children:[],addEventListener:(name,fn)=>events.set(id+':'+name,fn),replaceChildren(){this.children=[];this.value='';},append(child){this.children.push(child);}});return nodes.get(id);};
    const document={hidden:false,getElementById:node,querySelector:()=>node('button'),createElement:()=>({value:'',textContent:''}),addEventListener:(name,fn)=>events.set('doc:'+name,fn)};
    const localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
    const window={crypto:{randomUUID:()=>`12345678-1234-4123-8123-${String(++uuid).padStart(12,'0')}`},stopStaffLiveListeners(){},lockPayslipVault(){},checkNormalLogin(){loginCalls++;},addEventListener:(name,fn)=>events.set('win:'+name,fn)};
    const env={window,document,localStorage,navigator:{onLine:true},setTimeout:fn=>(timers.set(++timerId,fn),timerId),clearTimeout:id=>timers.delete(id)};
    const auth=authHarness(),requests=[];let result={enabled:true,mode:'protected',device:null},activateWait=null,activateFailure=null;
    const fetcher=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,body});if(url.endsWith('/activate')){if(activateWait)await activateWait;if(activateFailure)return response(activateFailure.status,{error:{code:activateFailure.code,message:activateFailure.message}});result={...protectedState(),device:{...protectedState().device,deviceId:body.deviceId,staffId:body.staffId}};return response(200,result);}return response(200,result);};
    const gate=installStaffSetupGate({...auth,projectId:'test',apiKey:'public',fetcher,directoryFetcher:async()=>response(200,{documents:[{name:'projects/test/databases/(default)/documents/cashiers/staff-a',fields:{cashierName:{stringValue:'Sample Staff'},branch:{stringValue:'Maa'}}}]})},{legacyRequest:async()=>{legacyCalls++;},legacyListen:async()=>{legacyCalls++;},stopLegacy(){}},env);
    return {gate,window,document,localStorage,store,node,requests,events,timers,auth,setResult:value=>result=value,setActivateWait:value=>activateWait=value,setActivateFailure:value=>activateFailure=value,get loginCalls(){return loginCalls;},get legacyCalls(){return legacyCalls;}};
}
test('required setup replaces legacy public ID with a new protected enrollment, activates automatically and stores no code',async()=>{
    const h=uiHarness();h.store.set('takodeal_device_id','DEV-OLDPUBLIC123');h.store.set('takodeal_staff_id','staff-b');h.store.set('takodeal_staff_name','Other Staff');
    try{
        await h.gate.start();await new Promise(setImmediate);const first=JSON.parse(h.store.get(STAFF_SETUP_DRAFT));assert.notEqual(first.deviceId,'DEV-OLDPUBLIC123');assert.equal(h.legacyCalls,0);assert.equal(h.node('staffSetupFields').hidden,false);
        h.node('deviceNameInput').value='My phone';h.node('setupStaffInput').value='staff-a';h.node('staffSetupCode').value='12345 67890';await h.window.requestDeviceAccess();
        const activation=h.requests.find(r=>r.url.endsWith('/activate'));assert.deepEqual(Object.keys(activation.body).sort(),['code','deviceId','deviceName','operationId','staffId']);assert.equal(activation.body.code,'1234567890');assert.equal(activation.body.deviceId,first.deviceId);assert.equal(h.store.get('takodeal_device_id'),first.deviceId);assert.equal(h.store.has('takodeal_staff_id'),false);assert.equal(h.store.has(STAFF_SETUP_DRAFT),false);assert.equal(h.node('staffSetupCode').value,'');assert.equal([...h.store.values()].some(v=>String(v).includes('1234567890')),false);assert.equal(h.loginCalls,1);assert.equal(h.node('deviceAuthOverlay').style.display,'none');
        await h.gate.start(false);assert.equal(h.loginCalls,1,'routine status checks do not restart portal loaders');
    }finally{h.gate.stop();}
});
test('account device-cap refusal keeps the phone unactivated, clears the code and permits the same nonsecret retry after HQ frees a slot',async()=>{
    const h=uiHarness(),legacyId='DEV-OLDPUBLIC123',code='1234567890',message='This staff account already has 2 active phones. Ask the Owner to block or delete an old phone registration before activating this one.';
    h.store.set('takodeal_device_id',legacyId);
    try{
        await h.gate.start();await new Promise(setImmediate);h.node('deviceNameInput').value='Replacement phone';h.node('setupStaffInput').value='staff-a';h.node('staffSetupCode').value=code;
        h.setActivateFailure({status:409,code:'device-limit',message});await h.window.requestDeviceAccess();
        const first=h.requests.find(row=>row.url.endsWith('/activate')),draft=JSON.parse(h.store.get(STAFF_SETUP_DRAFT));
        assert.equal(h.node('deviceRegistrationStatus').textContent,message);assert.equal(h.node('staffSetupCode').value,'');assert.equal(h.node('button').disabled,false);
        assert.equal(h.gate.authority.isVerified(),false);assert.equal(h.gate.authority.binding(),null);assert.equal(h.loginCalls,0);assert.equal(h.legacyCalls,0);assert.equal(h.node('appContainer').style.display,'none');assert.equal(h.node('registerCard').style.display,'block');assert.equal(h.store.get('takodeal_device_id'),legacyId);assert.equal(h.store.has('takodeal_staff_id'),false);
        assert.equal(draft.operationId,first.body.operationId);assert.equal(draft.deviceId,first.body.deviceId);assert.equal(draft.staffId,'staff-a');assert.equal(draft.deviceName,'Replacement phone');assert.equal(Object.hasOwn(draft,'code'),false);assert.equal([...h.store.values()].some(value=>String(value).includes(code)),false);
        // Owner blocks/deletes an older active registration on the server. The
        // client does not reset counts or generate a different setup identity.
        h.setActivateFailure(null);h.node('staffSetupCode').value=code;await h.window.requestDeviceAccess();
        const retry=h.requests.filter(row=>row.url.endsWith('/activate')).at(-1);assert.equal(retry.body.operationId,first.body.operationId);assert.equal(retry.body.deviceId,first.body.deviceId);assert.equal(h.store.get('takodeal_device_id'),first.body.deviceId);assert.equal(h.store.has(STAFF_SETUP_DRAFT),false);assert.equal(h.node('staffSetupCode').value,'');assert.equal(h.loginCalls,1);
    }finally{h.gate.stop();}
});
test('legacy registration is available only after an explicit disabled response, and no public record substitutes for outage',async()=>{
    const h=uiHarness();try{h.setResult({enabled:false,mode:'legacy',device:null});await h.gate.start();await h.window.requestDeviceAccess();assert.equal(h.legacyCalls,1);h.setResult({enabled:true,mode:'protected',device:null});await h.gate.start();await new Promise(setImmediate);assert.equal(h.node('staffSetupFields').hidden,false);assert.equal(h.legacyCalls,1);}finally{h.gate.stop();}
});
test('a quiet required-policy transition invalidates the actual legacy listener before a late public Active callback',async()=>{
    const h=uiHarness();h.gate.stop();h.window.db={};h.window.doc=()=>({});let required=false,callback,unsubscribed=0,swaps=0;
    h.window.onSnapshot=(_ref,_options,fn)=>{callback=fn;return()=>unsubscribed++;};h.window.listenToIncomingSwaps=()=>swaps++;
    const values={window:h.window,document:h.document,localStorage:h.localStorage,navigator:{onLine:true}},savedGlobals=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    let gate;try{
        h.store.set('takodeal_device_id',deviceId);
        gate=installStaffRegistration({projectId:'test',apiKey:'public',fetcher:async url=>url.includes('cloudfunctions.net')?response(200,{enabled:required,mode:required?'protected':'legacy',device:null}):url.includes('/cashiers?')?response(200,{documents:[]}):response(200,{fields:{status:{stringValue:'Active'},branch:{stringValue:'Maa'}}}),setup:h.auth});
        await gate.start();assert.equal(h.loginCalls,1);assert.equal(swaps,1);const old=callback;
        required=true;await gate.start(false);await new Promise(setImmediate);const before=h.loginCalls;assert.ok(unsubscribed>0);assert.equal(h.node('deviceAuthOverlay').style.display,'flex');
        old({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({status:'Active',branch:'Maa'})});
        assert.equal(h.loginCalls,before);assert.equal(swaps,1);assert.equal(h.node('deviceAuthOverlay').style.display,'flex');assert.equal(gate.authority.isVerified(),false);
    }finally{gate?.stop();for(const [key,descriptor] of savedGlobals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
});
test('hiding during a slow activation clears the code and prevents old activation from entering the portal',async()=>{
    const h=uiHarness(),wait=deferred();try{await h.gate.start();await new Promise(setImmediate);h.node('deviceNameInput').value='My phone';h.node('setupStaffInput').value='staff-a';h.node('staffSetupCode').value='1234567890';h.setActivateWait(wait.promise);const pending=h.window.requestDeviceAccess();await new Promise(setImmediate);h.document.hidden=true;h.events.get('doc:visibilitychange')();wait.resolve();await pending;assert.equal(h.loginCalls,0);assert.equal(h.node('staffSetupCode').value,'');assert.equal(h.node('appContainer').style.display,'none');assert.equal([...h.store.values()].some(v=>String(v).includes('1234567890')),false);}finally{h.gate.stop();}
});
test('Staff boot and primary PIN login are bound to trusted setup authority, and source/cache include the complete graph',()=>{
    const app=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),sw=readFileSync(new URL('../takodeal-staff/sw.js',import.meta.url),'utf8'),html=readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8');
    assert.match(app,/await signInAnonymously\(staffPrimaryAuth\)/);assert.match(app,/await setPersistence\(staffPrimaryAuth,browserLocalPersistence\)/);assert.match(app,/getDocFromServer\(doc\(db,'cashiers',setupBinding.staffId\)\)/);assert.match(app,/staffSetupAccess\.assert\(setupSession,docId\)/);assert.match(app,/staffSetupAccess\?\.isVerified\(\)/);
    const pageShow=app.slice(app.indexOf("window.addEventListener('pageshow'"),app.indexOf('// =======================================================',app.indexOf("window.addEventListener('pageshow'")));assert.doesNotMatch(pageShow,/startInboxListener|startSanctionListener/);assert.match(pageShow,/startStaffDeviceSetup/);
    assert.match(sw,/staff-setup-access\.js/);assert.match(sw,/staff-setup\.css/);assert.match(html,/id="staffSetupCode" type="password"/);assert.match(html,/id="setupStaffInput"/);
});
function actualLoginHarness({pin='1111',profileWait=null}={}){
    const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),nodes=new Map(),store=new Map(),timers=[],calls=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerText:'',style:{},disabled:false});return nodes.get(id);};
    const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
    let uid='uid-a';const authority=createStaffSetupAuthority({transport:{ready:async()=>({uid}),call:async()=>protectedState()},getUid:()=>uid});
    const window={staffSetupAccess:authority,stopStaffLiveListeners:()=>calls.push('stop'),lockPayslipVault(){},startStaffDeviceSetup:()=>calls.push('check-setup'),startLiveClock(){},loadAnnouncements:()=>calls.push('news'),startInboxListener:()=>calls.push('inbox'),checkContractLifecycle:()=>calls.push('contract'),listenToIncomingSwaps(){},startSanctionListener:()=>calls.push('sanctions')};
    const context={window,document:{getElementById:node,querySelector:()=>node('loginButton')},localStorage:storage,db:{},doc:(_db,collection,id)=>({collection,id}),getDocFromServer:async ref=>{calls.push(ref);if(profileWait)await profileWait;return {exists:()=>true,data:()=>({cashierName:'Sample Staff',branch:'Maa',pin,profilePicUrl:'',active:true})};},query:()=>{throw Error('Protected login must not query other staff PINs');},collection(){},where(){},getDocs(){throw Error('Protected login must use its exact bound staff account');},setTimeout:fn=>timers.push(fn),console:{error(){}}};
    for(const name of ['checkNormalLogin','loginStaff']){const start=source.indexOf('window.'+name+' = '),end=source.indexOf('\n};',start)+3;vm.runInNewContext(source.slice(start,end),context);}
    store.set('takodeal_device_id',deviceId);return {window,authority,node,store,timers,calls,changeUid:value=>{uid=value;authority.invalidate();}};
}
test('actual normal-login function removes a forged cached different employee before opening portal',async()=>{
    const h=actualLoginHarness();await h.authority.confirm(deviceId);h.store.set('takodeal_staff_id','staff-b');h.store.set('takodeal_staff_name','Other Person');h.window.checkNormalLogin();assert.equal(h.store.has('takodeal_staff_id'),false);assert.equal(h.node('appContainer').style.display,'none');assert.equal(h.node('loginOverlay').style.display,'flex');assert.equal(h.calls.includes('news'),false);
});
test('actual protected PIN login never searches another employee and rejects their PIN',async()=>{
    const h=actualLoginHarness();h.node('loginPin').value='2222';await h.window.loginStaff();assert.equal(h.store.has('takodeal_staff_id'),false);assert.match(h.node('loginError').innerText,/Incorrect PIN/);assert.deepEqual(h.calls.filter(v=>typeof v==='object'),[{collection:'cashiers',id:'staff-a'}]);assert.equal(h.node('loginButton').disabled,false);
});
test('actual protected PIN login preserves legacy numeric leading zeros without accepting partial numbers or changing string PINs',async()=>{
    for(const {stored,input,accepted} of [{stored:31,input:'0031',accepted:true},{stored:31,input:'31x',accepted:false},{stored:31,input:'31.0',accepted:false},{stored:'31',input:'0031',accepted:false},{stored:'0031',input:'0031',accepted:true}]){
        const h=actualLoginHarness({pin:stored});h.node('loginPin').value=input;await h.window.loginStaff();assert.equal(h.store.get('takodeal_staff_id')==='staff-a',accepted,`stored ${JSON.stringify(stored)}, submitted ${input}`);
    }
});
test('actual PIN login refuses a late staff profile after device authentication changes',async()=>{
    const wait=deferred(),h=actualLoginHarness({profileWait:wait.promise});h.node('loginPin').value='1111';const pending=h.window.loginStaff();await new Promise(setImmediate);h.changeUid('uid-b');wait.resolve();await pending;assert.equal(h.store.has('takodeal_staff_id'),false);assert.equal(h.calls.includes('news'),false);assert.match(h.node('loginError').innerText,/session changed/);
});
test('actual protected PIN login opens only its bound staff and delayed render cannot survive later revocation',async()=>{
    const h=actualLoginHarness();h.node('loginPin').value='1111';await h.window.loginStaff();assert.equal(h.store.get('takodeal_staff_id'),'staff-a');assert.equal(h.store.get('takodeal_staff_name'),'Sample Staff');assert.equal(h.timers.length,1);h.changeUid('uid-b');h.timers[0]();assert.equal(h.node('appContainer').style.display,undefined);assert.equal(h.calls.includes('check-setup'),true);
});
