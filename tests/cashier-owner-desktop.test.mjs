import test from 'node:test';
import assert from 'node:assert/strict';
import {prepUI} from './helpers/cashier-prep-fixture.mjs';
import {createCashierOwnerDesktopContext,resolveCashierProtectedAction} from '../Takodeal-POS/cashier-protected-action.js';
import {createCashierPrepAccess} from '../Takodeal-POS/cashier-prep-access.js';
import {createCashierVoidAccess} from '../Takodeal-POS/cashier-void-access.js';
import {CashierDeviceSetupMissing} from '../Takodeal-POS/stock-audit-device.js';
const missingSetup=()=>{throw new CashierDeviceSetupMissing('SAMPLE fresh binding is missing.');};
const config={projectId:'takodeal-pos',appId:'SAMPLE_APP',apiKey:'SAMPLE_PUBLIC_CONFIG',authDomain:'SAMPLE.invalid'},OWNER='jgo031996@gmail.com';
function fixture({primaryOwner=false,named=true}={}){
 const f=prepUI(),w=f.w,app={name:'[DEFAULT]',options:config},ownerApp={name:'takodeal-pos-owner-preview-v1',options:{...config}};
 let claims={sub:'existing-owner',email:OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const user={uid:'existing-owner',isAnonymous:false,email:OWNER,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'OWNER_SAMPLE_TOKEN_0123456789012345',getIdTokenResult:async force=>{assert.equal(force,true);f.tokenCalls++;if(f.tokenHook)await f.tokenHook();return{claims};}};
 f.tokenCalls=0;f.created=0;w.auth.app=app;w.db={app,kind:'primary'};if(primaryOwner)w.auth.currentUser=user;
 const ownerAuth={app:ownerApp,currentUser:named?user:null,authStateReady:async()=>{if(f.readyHook)await f.readyHook();}},ownerDb={app:ownerApp,kind:'owner-named'};
 const apps=[app,...(named?[ownerApp]:[])];f.options={primaryAuth:w.auth,primaryDb:w.db,firebaseConfig:config,getApps:()=>apps,initializeApp:(options,name)=>{assert.equal(name,ownerApp.name);assert.deepEqual(options,config);f.created++;apps.push(ownerApp);return ownerApp;},getAuth:a=>{assert.equal(a,ownerApp);return ownerAuth;},getFirestore:a=>{assert.equal(a,ownerApp);return ownerDb;}};
 f.ownerAuth=ownerAuth;f.ownerDb=ownerDb;f.user=user;f.claims=patch=>{claims={...claims,...patch};};f.resolveOwnerDesktop=createCashierOwnerDesktopContext(w,f.options);return f;
}

test('retained named Google Owner uses its matching database, fresh token and unchanged physical and primary identity',async()=>{
 const f=fixture(),primary=f.w.auth.currentUser,stored=[...f.saved];f.w.cashierVoidQueue={list:async()=>[]};const context=await resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup});assert.equal(context.ownerDesktop,true);assert.equal(context.api.auth,f.ownerAuth);assert.equal(context.api.db,f.ownerDb);assert.equal(context.actorUid,f.user.uid);assert.equal(f.w.auth.currentUser,primary);assert.deepEqual([...f.saved],stored);assert.equal(f.tokenCalls,1);assert.equal(f.created,0);context.api.assertStockAuditCurrent();
});

test('already signed-in primary Google Owner is used without consulting or replacing the named identity',async()=>{
 const f=fixture({primaryOwner:true}),result=await f.resolveOwnerDesktop();assert.equal(result.auth,f.w.auth);assert.equal(result.db,f.w.db);assert.equal(f.created,0);assert.equal(f.tokenCalls,1);
});

test('valid anonymous tablet remains selected without consulting retained Owner hints or creating a named app',async()=>{
 const f=fixture({named:false});f.w.ownerPreviewActive=true;f.w.isOwner=true;const result={api:{sample:true},actorUid:'EXISTING_ANON'};let checks=0;assert.equal(await resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:async input=>{assert.equal(input.action,'check');checks++;return result;}}),result);assert.equal(checks,1);assert.equal(f.created,0);assert.equal(f.tokenCalls,0);assert.equal(f.ownerAuth.currentUser,null);
});

test('bad, unverified, non-Google or foreign refreshed Owner claims fail held with no anonymous fallback',async()=>{
 for(const patch of [{sub:'FOREIGN'},{email:'other@example.invalid'},{email_verified:false},{firebase:{sign_in_provider:'password'}}]){const f=fixture();f.claims(patch);await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup}),/verified Google Owner/);assert.equal(f.calls.length,0);}
});

test('named context rejects wrong project/config and mismatched database apps',async()=>{
 for(const type of ['config','db']){const f=fixture();if(type==='config')f.ownerAuth.app.options={...config,projectId:'FOREIGN'};else f.ownerDb.app={...f.ownerAuth.app};await assert.rejects(f.resolveOwnerDesktop(),/verified Google Owner/);assert.equal(f.calls.length,0);}
});

test('primary, named user or selected branch mutation during refreshed claims invalidates the retained context',async()=>{
 for(const kind of ['primary','named','branch']){const f=fixture();f.tokenHook=async()=>{if(kind==='primary')f.w.auth.currentUser={uid:'OTHER'};if(kind==='named')f.ownerAuth.currentUser={...f.user};if(kind==='branch')f.storage.setItem('takodeal_device_branch','OTHER');};await assert.rejects(f.resolveOwnerDesktop(),/changed/);assert.equal(f.calls.length,0);}
});

test('foreign anonymous correction and prep journals remain visible and pinned across staff and branch changes',async()=>{
 for(const type of ['void','prep']){const f=fixture(),row={operationId:'SAMPLE_OLD',receiptId:'SAMPLE-OLD-RECEIPT',state:type==='void'?'queued':'pending',scope:JSON.stringify({uid:'ORIGINAL_ANON',deviceId:f.backend.deviceId,branch:'OLD BRANCH',staffId:'OLD STAFF'}),payload:{keep:'PAID_OR_UNKNOWN'}};const key=(type==='void'?'takodeal_cashier_void_v1_':'takodeal_cashier_prep_v2_')+'ORIGINAL_ANON:SAMPLE_OLD';f.storage.setItem(key,JSON.stringify(row));const before=[...f.saved];await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup}),/SAMPLE-OLD-RECEIPT.*original sign-in|original Cashier sign-in.*SAMPLE-OLD-RECEIPT/);assert.deepEqual([...f.saved],before);assert.equal(f.calls.length,0);}
});

test('isolated correction queue with a missing original journal cannot be hidden by Owner context selection',async()=>{
 const f=fixture();f.w.cashierVoidQueue={list:async()=>[{saleId:'KEEP-PAID',payload:{receiptId:'KEEP-RECEIPT',voidCorrection:{operationId:'ORPHAN'}}}]};const before=[...f.saved];await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup}),/KEEP-RECEIPT/);assert.deepEqual([...f.saved],before);assert.equal(f.calls.length,0);
});

test('returning to anonymous mode cannot hide a pending or paid Owner correction reference',async()=>{
 for(const state of ['pending','queued']){const f=fixture({named:false}),row={operationId:'OWNER_OLD',receiptId:'OWNER-RECEIPT',state,scope:JSON.stringify({uid:'OWNER_UID',deviceId:f.backend.deviceId,branch:'OTHER BRANCH'}),payload:state==='queued'?{keep:'PAID'}:undefined};f.storage.setItem('takodeal_cashier_void_v1_OWNER_UID:OWNER_OLD',JSON.stringify(row));const before=[...f.saved];await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:async()=>({actorUid:'ORIGINAL_ANON',api:{}})}),/OWNER-RECEIPT/);assert.deepEqual([...f.saved],before);assert.equal(f.calls.length,0);}
});

test('without retained Google Owner, approval failure gives conditional desktop sign-in guidance without provisioning',async()=>{
 const f=fixture({named:false});await assert.rejects(resolveCashierProtectedAction(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup}),/verified Google Owner.*do not request another tablet approval/);assert.equal(f.ownerAuth.currentUser,null);assert.equal(f.calls.length,0);
});

test('typed Owner-desktop denial keeps its hold and gives Google/registered-PC guidance instead of a tablet approval loop',async()=>{
 for(const create of [createCashierPrepAccess,createCashierVoidAccess])for(const code of ['owner-desktop/approval-required','access/pin']){const f=fixture();let logout=0;const makeClient=()=>({login:async()=>{throw Object.assign(Error('ORIGINAL HOLD'),{status:403,code});},logout:async()=>{logout++;},flushLogout:async()=>{}}),access=create(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup,makeClient,now:f.backend.now});await assert.rejects(access.capture().resolve(),error=>{assert.equal(error.status,403);assert.equal(error.code,code);if(code==='access/pin')assert.equal(error.message,'ORIGINAL HOLD');else assert.match(error.message,/verified Google Owner.*Main Office desktop.*no new approval was requested/);return true;});await new Promise(setImmediate);assert.equal(logout,1);assert.equal(f.calls.length,0);assert.equal(f.ownerAuth.currentUser,f.user);}
});

test('both explicit prep and void use a fresh first Owner PIN session, then reuse only that new-mode session with matching named auth/db',async()=>{
 for(const create of [createCashierPrepAccess,createCashierVoidAccess]){const f=fixture(),primary=f.w.auth.currentUser;f.w.sessionUser={...f.w.sessionUser,staffLoginUid:f.user.uid,staffLoginDeviceId:f.backend.deviceId,staffLoginSessionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',staffLoginExpiresAt:new Date(f.backend.now()+3600000).toISOString()};let selected,logins=0;const makeClient=options=>{selected=options;return{login:async()=>{logins++;assert.equal(options.primaryAuth,f.ownerAuth);assert.equal(options.primaryDb,f.ownerDb);return{staffLoginUid:f.user.uid,staffId:f.backend.staffId,branch:f.backend.branch,staffLoginSessionId:'11111111-2222-4333-8444-555555555555',staffLoginExpiresAt:new Date(f.backend.now()+3600000).toISOString()};},takeOperationalContext:()=>({auth:f.ownerAuth,db:f.ownerDb}),logout:async()=>{},flushLogout:async()=>{}};};const access=create(f.w,{resolveOwnerDesktop:f.resolveOwnerDesktop,resolveDevice:missingSetup,makeClient,now:f.backend.now}),context=access.capture(),api=await context.resolve();assert.equal(api.auth,f.ownerAuth);assert.equal(api.db,f.ownerDb);assert.equal(context.actor().uid,f.user.uid);assert.equal(f.w.auth.currentUser,primary);assert.equal(logins,1);assert.equal(selected.primaryDb,f.ownerDb);assert.notEqual(context.actor().staffSessionId,f.w.sessionUser.staffLoginSessionId);context.current();const again=access.capture();await again.resolve();assert.equal(logins,1);assert.equal(again.actor().staffSessionId,context.actor().staffSessionId);assert.ok(f.dialogs.some(row=>/signed-in Google Owner/.test(row.text||'')));assert.doesNotMatch([...f.saved.values()].join(''),/SAMPLE_TOKEN|"1234"/);}
});
