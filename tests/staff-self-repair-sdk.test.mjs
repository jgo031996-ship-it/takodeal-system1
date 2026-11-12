import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createStaffSelfRepairSDK,STAFF_REPAIR_CANDIDATE_APP} from '../takodeal-staff/staff-self-repair-sdk.js';

const core=readFileSync(new URL('../takodeal-staff/staff-self-repair.js',import.meta.url),'utf8'),JOURNAL='takodeal_staff_self_repair_v1',PREPARED='takodeal_staff_self_repair_candidate_v1';
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function waitFor(predicate){for(let i=0;i<50&&!predicate();i++)await tick();assert.ok(predicate());}
function fixture({privateUsed=true,windows=1}={}){
 const config={projectId:'fictional-staff-demo',apiKey:'fictional-public-key'},app={name:'[DEFAULT]',options:config},privateApp={name:'staff-private-documents',options:config};
 const user=uid=>({uid,isAnonymous:true,getIdToken:async()=>'fictional-token-'+uid}),primary={app,currentUser:user('original-primary')},privateAuth={app:privateApp,currentUser:user('original-private')},db={app},privateDb={app:privateApp};
 const data=new Map([['takodeal_staff_id','fictional-staff'],['takodeal_staff_name','Fictional Crew'],['takodeal_staff_pic','saved-pic'],['takodeal_staff_session_id','saved-session'],['takodeal_device_id','DEV-ORIGINAL-123456'],['private-document-key','keep-private'],['unrelated-work','keep-work']]);
 const storage={get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear(){throw Error('Never clear browser storage');}};
 const h={app,primary,privateAuth,db,privateDb,data,storage,bindings:new Map(),calls:{apps:0,auth:[],signup:0,update:[],drains:[],routes:[]},windows,privateUsed,sequence:0};
 const apps=[app,...(privateUsed?[privateApp]:[])];let candidate;
 const sdk={browserLocalPersistence:{fixture:true},getApps:()=>apps,initializeApp:(options,name)=>{h.calls.apps++;const value={name,options};apps.push(value);return value;},getAuth:target=>{h.calls.auth.push(target.name);assert.equal(target.name,STAFF_REPAIR_CANDIDATE_APP);if(!candidate){candidate={app:target,currentUser:null,authStateReady:async()=>{if(h.authReady)await h.authReady();}};h.candidate=candidate;}return candidate;},setPersistence:async target=>{assert.equal(target,candidate);},signInAnonymously:async target=>{assert.equal(target,candidate);h.calls.signup++;if(h.signupGate)await h.signupGate.promise;target.currentUser=user('candidate-'+(++h.sequence));return {user:target.currentUser};},updateCurrentUser:async(target,value)=>{h.calls.update.push({target:target.app.name,uid:value?.uid??null});if(target===primary&&h.handoffGate)await h.handoffGate.promise;target.currentUser=value?{...value}:null;if(target===candidate&&value===null&&h.crashAfterRotation)throw Error('Fictional interruption after named candidate rotation');},waitForPendingWrites:async target=>{h.calls.drains.push(target===db?'primary':target===privateDb?'private':'unexpected');assert.ok(target===db||target===privateDb);if(h.onDrain)await h.onDrain(target);}};
 class Channel{constructor(){const one={onmessage:null,close(){}},two={postMessage:value=>queueMicrotask(()=>one.onmessage?.({data:value})),close(){}};this.port1=one;this.port2=two;}}
 const worker={scriptURL:'https://staff.example.invalid/sw.js',postMessage(data,ports){assert.deepEqual(data,{type:'TAKODEAL_STAFF_SINGLE_WINDOW'});ports[0].postMessage(h.windowResponse||{schemaVersion:1,singleWindow:h.windows===1,windows:h.windows});}};
 const nav={onLine:true,serviceWorker:{controller:worker,getRegistration:async()=>({active:worker,scope:'https://staff.example.invalid/'})}};
 const w={localStorage:storage,location:{href:'https://staff.example.invalid/index.html'},navigator:nav,crypto:webcrypto,MessageChannel:Channel,setTimeout,clearTimeout,addEventListener(){},dispatchEvent(){},CustomEvent:class{constructor(type){this.type=type;}}};
 const fetcher=async(url,options)=>{
  const route=new URL(url).pathname.split('/').at(-1),body=JSON.parse(options.body),uid=options.headers.Authorization.replace('Bearer fictional-token-','');h.calls.routes.push({route,uid,deviceId:body.deviceId,operationId:body.operationId});
  if(route==='activate'){
   if(h.activationError)return {ok:false,status:409,json:async()=>({error:h.activationError})};
   assert.equal(body.code,'1234567890');h.bindings.set(uid,{staffId:body.staffId,deviceId:body.deviceId,status:'Active'});
   if(h.loseReply){h.loseReply=false;throw Error('Fictional lost activation reply');}
   return {ok:true,status:200,json:async()=>({activated:true})};
  }
  assert.equal(route,'device-status');const binding=h.bindings.get(uid),result=h.statusOverride||(!binding?{enabled:false,mode:'legacy',device:null}:{enabled:false,mode:'protected',device:{...binding,staffName:'Fictional Crew',branch:'Maa'}});
  return {ok:true,status:200,json:async()=>structuredClone(result)};
 };
 h.adapter=()=>createStaffSelfRepairSDK({app,auth:primary,db,config,sdk,readPrivateClient:()=>h.privateUsed?{auth:privateAuth,db:privateDb}:null,window:w,storage,navigator:nav,fetcher});
 const d={querySelectorAll:()=>[],addEventListener(){},body:{}};vm.runInNewContext(core,{window:w,document:d,navigator:nav,Symbol,Promise,Object,Array,String,Number,Date,JSON,Error});w.staffSelfRepair.configureSDK(h.adapter());
 h.w=w;h.sdk=sdk;h.start=()=>w.staffSelfRepair.startReset({code:'1234567890',confirmed:true});h.original=()=>Object.fromEntries([...data].filter(([key])=>!key.startsWith('takodeal_staff_self_repair')&&key!=='takodeal_staff_previous_device_v1'));return h;
}

test('constructing/capturing repair creates no candidate or unused private client and rejects an unexpected primary provider',()=>{
 const h=fixture({privateUsed:false}),before=h.original();assert.deepEqual(h.adapter().capture(),{primaryUid:'original-primary',privateUid:null,staffId:'fictional-staff',deviceId:'DEV-ORIGINAL-123456'});assert.equal(h.calls.apps,0);assert.deepEqual(h.calls.auth,[]);assert.equal(h.calls.signup,0);assert.deepEqual(h.original(),before);
 h.primary.currentUser.isAnonymous=false;assert.throws(()=>h.adapter().capture(),/not a normal Staff phone/);assert.deepEqual(h.original(),before);
});
test('incorrect code and full-slot failures leave exact original primary/private users and all old keys unchanged',async()=>{
 for(const failure of ['Fictional incorrect personal code','Fictional phone-slot limit']){const h=fixture(),before=h.original(),primary=h.primary.currentUser,privateUser=h.privateAuth.currentUser;h.activationError=failure;assert.equal(await h.start(),false);assert.equal(h.primary.currentUser,primary);assert.equal(h.privateAuth.currentUser,privateUser);assert.deepEqual(h.original(),before);assert.equal(h.calls.update.length,0);assert.equal(h.w.staffSelfRepair.requiresCode(),false);assert.equal(JSON.stringify([...h.data]).includes('1234567890'),false);}
});
test('successful reset confirms same-staff Active before primary-only handoff and retains private Auth/data/other work byte-exact',async()=>{
 const h=fixture(),privateUser=h.privateAuth.currentUser;assert.equal(await h.start(),true);const row=JSON.parse(h.data.get(JOURNAL));assert.equal(row.phase,'complete');assert.equal(h.primary.currentUser.uid,row.candidateUid);assert.equal(h.privateAuth.currentUser,privateUser);assert.equal(h.data.get('private-document-key'),'keep-private');assert.equal(h.data.get('unrelated-work'),'keep-work');assert.equal(h.data.get('takodeal_device_id'),row.candidateDeviceId);
 for(const key of ['takodeal_staff_id','takodeal_staff_name','takodeal_staff_pic','takodeal_staff_session_id'])assert.equal(h.data.has(key),false);
 assert.deepEqual(h.calls.update,[{target:'[DEFAULT]',uid:row.candidateUid}]);assert.ok(h.calls.drains.includes('primary'));assert.ok(h.calls.drains.includes('private'));assert.deepEqual(h.calls.auth,[STAFF_REPAIR_CANDIDATE_APP]);assert.equal(JSON.stringify([...h.data]).includes('fictional-token-'),false);
 assert.deepEqual(h.adapter().capture(),{primaryUid:row.candidateUid,privateUid:'original-private',staffId:'fictional-staff',deviceId:row.candidateDeviceId});
});
test('lost activation reply resumes the exact persisted candidate/DEV/operation without another activation or code cache',async()=>{
 const h=fixture(),before=h.original();h.loseReply=true;assert.equal(await h.start(),false);const pending=JSON.parse(h.data.get(JOURNAL));assert.equal(pending.phase,'activation-pending');assert.deepEqual(h.original(),before);assert.equal(h.calls.routes.filter(row=>row.route==='activate').length,1);
 assert.equal(await h.w.staffSelfRepair.resumeReset(),true);const done=JSON.parse(h.data.get(JOURNAL));for(const key of ['candidateUid','candidateDeviceId','operationId'])assert.equal(done[key],pending[key]);assert.equal(h.calls.routes.filter(row=>row.route==='activate').length,1);assert.equal(h.calls.signup,1);
});
test('candidate signup keeps a physical single flight after UI timeout and resumes its original prepared DEV/operation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=fixture();h.w.setTimeout=setTimeout;h.w.clearTimeout=clearTimeout;h.signupGate=deferred();const first=h.start();await waitFor(()=>h.calls.signup===1);const prepared=JSON.parse(h.data.get(PREPARED));t.mock.timers.tick(15001);assert.equal(await first,false);
 const second=h.start();await tick();assert.equal(h.calls.signup,1);h.signupGate.resolve();assert.equal(await second,false);assert.equal(h.primary.currentUser.uid,'original-primary');h.signupGate=null;
 assert.equal(await h.start(),true);const done=JSON.parse(h.data.get(JOURNAL));assert.equal(done.candidateDeviceId,prepared.deviceId);assert.equal(done.operationId,prepared.operationId);assert.equal(h.calls.signup,1);
});
test('a crash after rotating only named candidate Auth resumes the saved next preparation without losing original access',async()=>{
 const h=fixture();assert.equal(await h.start(),true);const oldPrimary=h.primary.currentUser,oldDevice=h.data.get('takodeal_device_id'),privateUser=h.privateAuth.currentUser;
 h.crashAfterRotation=true;assert.equal(await h.start(),false);const planned=JSON.parse(h.data.get(PREPARED));assert.equal(h.candidate.currentUser,null);assert.equal(h.primary.currentUser,oldPrimary);assert.equal(h.data.get('takodeal_device_id'),oldDevice);assert.equal(h.privateAuth.currentUser,privateUser);
 h.crashAfterRotation=false;h.w.staffSelfRepair.configureSDK(h.adapter());assert.equal(await h.start(),true);const done=JSON.parse(h.data.get(JOURNAL));assert.equal(done.candidateDeviceId,planned.deviceId);assert.equal(done.operationId,planned.operationId);assert.equal(h.calls.update.filter(row=>row.target===STAFF_REPAIR_CANDIDATE_APP&&row.uid===null).length,1);
});
test('physical primary handoff is not released at the15second watchdog and never clears local selection before SDK settlement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=fixture();h.w.setTimeout=setTimeout;h.w.clearTimeout=clearTimeout;h.handoffGate=deferred();const before=h.original(),pending=h.start();await waitFor(()=>h.calls.update.some(row=>row.target==='[DEFAULT]'));t.mock.timers.tick(15001);await tick();
 assert.equal(h.data.get('takodeal_staff_id'),'fictional-staff');assert.deepEqual(h.original(),before);assert.equal(h.primary.currentUser.uid,'original-primary');assert.equal(await h.start(),false);assert.equal(JSON.parse(h.data.get(JOURNAL)).phase,'handoff-pending');
 h.handoffGate.resolve();assert.equal(await pending,true);assert.equal(JSON.parse(h.data.get(JOURNAL)).phase,'complete');
});
test('multiple windows or malformed window proof block before candidate creation and preserve original data',async()=>{
 for(const kind of ['multiple','malformed']){const h=fixture({windows:kind==='multiple'?2:1}),before=h.original();if(kind==='malformed')h.windowResponse={schemaVersion:1,singleWindow:true,windows:2};assert.equal(await h.start(),false);assert.equal(h.calls.signup,0);assert.equal(h.calls.apps,0);assert.deepEqual(h.original(),before);}
});
test('new unconfirmed work during drain blocks reset before primary handoff',async()=>{
 const h=fixture(),before=h.original();h.onDrain=async()=>{h.w.staffSwapWritePending=true;};assert.equal(await h.start(),false);assert.equal(h.calls.update.length,0);assert.deepEqual(h.original(),before);assert.equal(h.primary.currentUser.uid,'original-primary');
});
test('an already-created private client accessor never initializes Auth and returns only the existing handles',async()=>{
 let authReads=0,dbReads=0,signins=0;const auth={currentUser:{uid:'kept-private'}},db={},noop=()=>{};
 const source=readFileSync(new URL('../takodeal-staff/staff-document-firebase.js',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/gm,'').replace(/^export /gm,'');
 const context={getApp:()=>({}),getAuth:()=>{authReads++;return auth;},getFirestore:()=>{dbReads++;return db;},signInAnonymously:()=>{signins++;},createDocumentStore:()=>({}),doc:noop,getDocFromServer:noop,runTransaction:noop,serverTimestamp:noop,query:noop,where:noop,collection:noop,getDocsFromServer:noop,limit:noop,onAuthStateChanged:noop};vm.runInNewContext(source+';globalThis.readExisting=readInitializedStaffDocumentClient;globalThis.createPrivate=createStaffDocumentFirebase;',context);
 assert.equal(context.readExisting(),null);assert.equal(authReads,0);assert.equal(dbReads,0);await context.createPrivate({},()=> 'fictional-staff');const one=context.readExisting(),two=context.readExisting();assert.notEqual(one,two);assert.equal(one.auth,auth);assert.equal(one.db,db);assert.equal(authReads,1);assert.equal(dbReads,1);assert.equal(signins,0);
});
