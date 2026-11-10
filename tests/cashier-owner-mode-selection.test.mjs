import test from 'node:test';
import assert from 'node:assert/strict';
import {prepUI} from './helpers/cashier-prep-fixture.mjs';
import {createCashierOwnerDesktopContext,resolveCashierProtectedAction} from '../Takodeal-POS/cashier-protected-action.js';
import {createStockAuditDeviceResolver,CashierDeviceSetupMissing,CashierNoRetainedAnonymousCredential} from '../Takodeal-POS/stock-audit-device.js';
import {createCashRemittanceDeviceSession} from '../Takodeal-POS/cash-remittance-client.js';
function fixture({status='Active',primaryOwner=false,credential='anonymous'}={}){
 const f=prepUI(),w=f.w,config={projectId:'takodeal-pos',appId:'SAMPLE',apiKey:'SAMPLE_PUBLIC',authDomain:'SAMPLE.invalid'},primaryApp={name:'[DEFAULT]',options:config},ownerApp={name:'takodeal-pos-owner-preview-v1',options:config},deviceApp={name:'RETAINED_APPROVED_DEVICE'};
 f.ownerTokens=0;f.signups=0;f.reads=[];f.readyCalls=0;const owner={uid:'OWNER',isAnonymous:false,email:'jgo031996@gmail.com',emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'OWNER_SAMPLE_TOKEN_01234567890',getIdTokenResult:async()=>{f.ownerTokens++;return{claims:{sub:'OWNER',email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}};}};
 w.auth.app=primaryApp;w.db={app:primaryApp};if(primaryOwner)w.auth.currentUser=owner;
 const anonymous={uid:'APPROVED_ANON',isAnonymous:true,getIdToken:async()=> 'DEVICE_SAMPLE_TOKEN_01234567890'},deviceAuth={app:deviceApp,currentUser:credential==='anonymous'?anonymous:credential==='null'?null:owner,authStateReady:async()=>{f.readyCalls++;if(f.readyHook)f.readyHook();}},deviceDb={app:deviceApp};
 const api={auth:deviceAuth,db:deviceDb,doc:(_,table,id)=>({path:table+'/'+id}),getDocFromServer:async ref=>{f.reads.push(ref.path);if(f.readError)throw f.readError;let data;if(ref.path==='pos_bindings/APPROVED_ANON'&&status!=='Missing')data={uid:anonymous.uid,deviceId:f.backend.deviceId,branch:f.backend.branch,status,legacyDeviceDocId:'SAMPLE_DEVICE'};if(ref.path==='pos_devices/SAMPLE_DEVICE')data={status:'Active',branch:f.backend.branch,deviceId:f.backend.deviceId,appType:'Cashier'};return {metadata:{fromCache:!!f.cached,hasPendingWrites:false},exists:()=>!!data,data:()=>structuredClone(data)};},getDocsFromServer:()=>assert.fail('Check only cannot list or request a registration'),runTransaction:()=>assert.fail('No Pending registration or business write')};
 const deviceContext={resolve:async({assertCurrent})=>{assertCurrent();return{auth:deviceAuth,deviceApi:api};}},signInAnonymously=async auth=>{f.signups++;auth.currentUser=anonymous;return{user:anonymous};};
 const ownerAuth={app:ownerApp,currentUser:owner,authStateReady:async()=>{}},ownerDb={app:ownerApp};f.resolveOwnerDesktop=createCashierOwnerDesktopContext(w,{primaryAuth:w.auth,primaryDb:w.db,firebaseConfig:config,getApps:()=>[primaryApp,ownerApp],initializeApp:()=>assert.fail('Retained app already exists'),getAuth:()=>ownerAuth,getFirestore:()=>ownerDb});
 f.deviceAuth=deviceAuth;f.deviceDb=deviceDb;f.anonymous=anonymous;f.resolveDevice=createStockAuditDeviceResolver(w,{primaryAuth:w.auth,deviceContext,signInAnonymously});f.session=()=>createCashRemittanceDeviceSession(w,{primaryAuth:w.auth,deviceContext,signInAnonymously});f.select=()=>resolveCashierProtectedAction(w,{resolveDevice:f.resolveDevice,resolveOwnerDesktop:f.resolveOwnerDesktop});return f;
}

test('approved existing anonymous store identity wins over both primary and retained named Owner credentials without Owner token lookup',async()=>{
 for(const primaryOwner of [false,true]){const f=fixture({primaryOwner}),primary=f.w.auth.currentUser,result=await f.select();assert.equal(result.actorUid,'APPROVED_ANON');assert.equal(result.api.auth,f.deviceAuth);assert.equal(result.api.db,f.deviceDb);assert.notEqual(result.ownerDesktop,true);assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);assert.equal(f.w.auth.currentUser,primary);assert.deepEqual(f.reads,['pos_bindings/APPROVED_ANON','pos_devices/SAMPLE_DEVICE']);}
});

test('actual fresh absent private binding creates only the Missing brand and permits named Owner selection without a new UID',async()=>{
 const f=fixture({status:'Missing'});await assert.rejects(f.resolveDevice({action:'check',existingOnly:true}),error=>error instanceof CashierDeviceSetupMissing&&error.deviceStatus==='Missing');assert.deepEqual(f.reads,['pos_bindings/APPROVED_ANON']);const result=await f.select();assert.equal(result.ownerDesktop,true);assert.equal(result.actorUid,'OWNER');assert.equal(f.ownerTokens,1);assert.equal(f.signups,0);
});

test('confirmed null retained anonymous auth has a distinct brand and permits existing primary Owner proof without creating an account',async()=>{
 const f=fixture({primaryOwner:true,credential:'null'});await assert.rejects(f.resolveDevice({action:'check',existingOnly:true}),error=>error instanceof CashierNoRetainedAnonymousCredential&&!(error instanceof CashierDeviceSetupMissing));const result=await f.select();assert.equal(result.ownerDesktop,true);assert.equal(result.actorUid,'OWNER');assert.equal(result.api.auth,f.w.auth);assert.equal(f.ownerTokens,1);assert.equal(f.reads.length,0);assert.equal(f.signups,0);
});

test('Pending, revoked, cached, transport, permission and nonanonymous credential failures never choose Owner or create a UID',async()=>{
 for(const kind of ['Pending','Revoked','cached','network','permission','nonanonymous']){const f=fixture({status:['Pending','Revoked'].includes(kind)?kind:'Active',credential:kind==='nonanonymous'?'other':'anonymous'});if(kind==='cached')f.cached=true;if(kind==='network')f.readError=Error('Network unavailable');if(kind==='permission')f.readError=Object.assign(Error('Permission denied'),{status:403,code:'permission-denied'});await assert.rejects(f.select(),undefined,kind);assert.equal(f.ownerTokens,0,kind);assert.equal(f.signups,0,kind);}
});

test('credential clearing during the second auth-ready await cannot make the probe auto-sign-in or select Owner',async()=>{
 const f=fixture();f.readyHook=()=>{if(f.readyCalls===2)f.deviceAuth.currentUser=null;};await assert.rejects(f.select(),/No new anonymous account was created/);assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);assert.equal(f.reads.length,0);
});

test('known anonymous identity clearing or replacing during the first auth-ready await is held, never reclassified as no credential',async()=>{
 for(const replace of [false,true]){const f=fixture();f.readyHook=()=>{if(f.readyCalls===1)f.deviceAuth.currentUser=replace?{...f.anonymous}:null;};await assert.rejects(f.select(),/existing tablet account changed/);assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);assert.equal(f.reads.length,0);}
});

test('initially null auth restoring its existing anonymous credential through authStateReady keeps the approved tablet identity',async()=>{
 const f=fixture({credential:'null'});f.readyHook=()=>{if(f.readyCalls===1)f.deviceAuth.currentUser=f.anonymous;};const result=await f.select();assert.equal(result.actorUid,'APPROVED_ANON');assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);
});

test('forged Missing message/code and branded errors carrying a 403 cannot trigger Owner fallback',async()=>{
 for(const error of [Object.assign(Error('SAMPLE binding is missing'),{code:'cashier-device/setup-missing',deviceStatus:'Missing'}),Object.assign(new CashierDeviceSetupMissing('SAMPLE'),{status:403}),Object.assign(new CashierNoRetainedAnonymousCredential(),{status:401})]){const f=fixture();await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:async()=>{throw error;}}));assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);}
});

test('corrupt or foreign saved work after an Active anonymous check holds that context without trying Owner',async()=>{
 for(const corrupt of [false,true]){const f=fixture(),key='takodeal_cashier_void_v1_FOREIGN:OLD';f.storage.setItem(key,corrupt?'INVALID':JSON.stringify({operationId:'OLD',receiptId:'KEEP-OLD',state:'queued',scope:JSON.stringify({uid:'FOREIGN',deviceId:f.backend.deviceId,branch:'OLD'}),payload:{keep:'PAID'}}));const before=[...f.saved];await assert.rejects(f.select(),/original Cashier sign-in/);assert.equal(f.ownerTokens,0);assert.equal(f.signups,0);assert.deepEqual([...f.saved],before);}
});

test('existingOnly cannot request approval while default legacy checks retain their original anonymous sign-in behavior',async()=>{
 const f=fixture({status:'Missing',credential:'null'});await assert.rejects(f.resolveDevice({action:'request',existingOnly:true}),/No approval was requested/);await assert.rejects(f.session().check(true,{existingOnly:true}),/no approval was requested/);assert.equal(f.signups,0);assert.equal(f.reads.length,0);const result=await f.session().check(false);assert.equal(result.status,'Missing');assert.equal(f.signups,1);assert.equal(f.ownerTokens,0);
});
