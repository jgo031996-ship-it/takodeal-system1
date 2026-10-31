import test from 'node:test';
import assert from 'node:assert/strict';
import {createCashierDeviceAuthContext,CASHIER_DEVICE_APP_NAME} from '../Takodeal-POS/cashier-device-auth.js';
import {createStockAuditDeviceResolver} from '../Takodeal-POS/stock-audit-device.js';
import {createStockCountEngine,countEntries} from '../Takodeal-POS/stock-count-engine.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Exercise the actual resolver, isolated Firebase selection, approval session and
// saved binding gate together. These synthetic adapters perform no network I/O.
function fixture({provider='google',binding='Active',fleet={}}={}){
 const config={projectId:'fictional-project',appId:'fictional-app',apiKey:'public-key',authDomain:'fictional-project.firebaseapp.com'};
 const primaryApp={name:'[DEFAULT]',options:config},primaryUser=provider==='none'?null:{uid:'primary-user',isAnonymous:provider==='anonymous',email:provider==='google'?'owner@example.test':undefined};
 const primaryAuth={app:primaryApp,currentUser:primaryUser,authStateReady:async()=>{}},primaryDb={app:primaryApp},apps=[primaryApp],auths=new Map([[primaryApp,primaryAuth]]),dbs=new Map([[primaryApp,primaryDb]]);
 const values=new Map([['takodeal_device_branch','Maa'],['takodeal_device_id','DEV-fictional']]),records=new Map(),reads=[],writes=[],signIns=[];
 const deviceUid=provider==='google'?'isolated-device':provider==='anonymous'?'primary-user':'default-device';
 records.set('pos_devices/legacy',{deviceId:'DEV-fictional',deviceName:'Fictional counter',branch:'Maa',status:'Active',appType:'POS',...fleet});
 if(binding)records.set('pos_bindings/'+deviceUid,{uid:deviceUid,deviceId:'DEV-fictional',deviceName:'Fictional counter',branch:'Maa',legacyDeviceDocId:'legacy',status:binding});
 const snapshot=ref=>({id:ref.path.split('/').pop(),metadata:{fromCache:false,hasPendingWrites:false},exists:()=>records.has(ref.path),data:()=>structuredClone(records.get(ref.path))});
 const f={afterRead:()=>{}};
 const read=async ref=>{reads.push({path:ref.path,app:ref.db.app.name});if(ref.path.startsWith('pos_bindings/')&&auths.get(ref.db.app).currentUser?.uid!==ref.path.split('/')[1])throw Error('Wrong identity for private binding');const saved=snapshot(ref);await f.afterRead(ref);return saved;};
 const w={sessionUser:{staffId:'fictional-staff',cashierName:'Fictional Operator',branch:'Maa'},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))},doc:(db,table,id)=>({db,path:table+'/'+id}),collection:(db,table)=>({db,table}),where:(...args)=>args,limit:value=>value,query:(ref,...filters)=>({...ref,filters}),getDocFromServer:read,getDocsFromServer:async query=>({metadata:{fromCache:false,hasPendingWrites:false},docs:[...records.keys()].filter(path=>path.startsWith(query.table+'/')).map(path=>snapshot({db:query.db,path}))}),serverTimestamp:()=>({serverTimestamp:true}),runTransaction:async(db,callback)=>{const staged=[],result=await callback({get:read,set:(ref,value)=>{assert.equal(ref.db,db);assert.equal(auths.get(db.app).currentUser.isAnonymous,true);assert.equal(auths.get(db.app).currentUser.uid,ref.path.split('/')[1]);assert.equal(value.status,'Pending');staged.push([ref,value]);}});for(const[ref,value]of staged){writes.push({path:ref.path,app:db.app.name,value:structuredClone(value)});records.set(ref.path,structuredClone(value));}return result;}};
 const options={primaryAuth,primaryDb,firebaseConfig:config,initializeApp:(options,name)=>{const app={name,options};apps.push(app);return app;},getApps:()=>apps,getAuth:app=>{if(!auths.has(app))auths.set(app,{app,currentUser:null,authStateReady:async()=>{}});return auths.get(app);},getFirestore:app=>{if(!dbs.has(app))dbs.set(app,{app});return dbs.get(app);}};
 const signInAnonymously=async auth=>{signIns.push(auth.app.name);const user={uid:auth.app===primaryApp?'default-device':'isolated-device',isAnonymous:true};auth.currentUser=user;return {user};};
 const deviceContext=createCashierDeviceAuthContext(w,options),resolve=createStockAuditDeviceResolver(w,{primaryAuth,signInAnonymously,deviceContext});
 Object.assign(f,{w,values,records,reads,writes,signIns,primaryAuth,primaryDb,primaryUser,deviceContext,deviceUid,resolve});return f;
}

test('stock audit construction does not enroll a device or replace the primary Google account',()=>{
 const f=fixture();assert.deepEqual(f.signIns,[]);assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
test('an active approved isolated tablet returns its matching database and actor while keeping Google intact',async()=>{
 const f=fixture(),result=await f.resolve({action:'submit'});assert.equal(result.actorUid,'isolated-device');assert.notEqual(result.api.auth,f.primaryAuth);assert.equal(result.api.auth.app,result.api.db.app);assert.equal(result.api.auth.app.name,CASHIER_DEVICE_APP_NAME);assert.equal(result.api.sessionUser,f.w.sessionUser);assert.equal(f.primaryAuth.currentUser,f.primaryUser);assert.deepEqual(f.signIns,[CASHIER_DEVICE_APP_NAME]);assert.equal(f.writes.length,0);assert.ok(f.reads.every(row=>row.app===CASHIER_DEVICE_APP_NAME));
});
test('existing default anonymous approval stays in the default database without a second identity',async()=>{
 const f=fixture({provider:'anonymous'}),result=await f.resolve();assert.equal(result.actorUid,'primary-user');assert.equal(result.api.auth,f.primaryAuth);assert.equal(result.api.db,f.primaryDb);assert.deepEqual(f.signIns,[]);assert.equal(f.writes.length,0);
});
test('checking a missing approval does not create a Pending or Active binding',async()=>{
 const f=fixture({binding:null});await assert.rejects(f.resolve({action:'check'}),/Request tablet approval/);assert.equal(f.writes.length,0);assert.equal(f.records.has('pos_bindings/isolated-device'),false);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
test('an explicit request may create only Pending approval and never returns a stock-writing API',async()=>{
 const f=fixture({binding:null});await assert.rejects(f.resolve({action:'request'}),/approval is pending/);assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'pos_bindings/isolated-device');assert.equal(f.writes[0].app,CASHIER_DEVICE_APP_NAME);assert.equal(f.writes[0].value.status,'Pending');assert.equal(f.primaryAuth.currentUser,f.primaryUser);assert.equal([...f.records.keys()].some(path=>path.startsWith('stock_counts/')||path.startsWith('inventory_audit_reports/')),false);
});
for(const status of ['Pending','Revoked','Blocked'])test('saved '+status+' approval cannot be used to submit stock counts',async()=>{
 const f=fixture({binding:status});await assert.rejects(f.resolve({action:'submit'}),/pending|revoked or blocked/);assert.equal(f.writes.length,0);assert.equal(f.records.get('pos_bindings/isolated-device').status,status);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
for(const patch of [{branch:'Cabantian'},{status:'Blocked'},{appType:'Staff'}])test('an Active binding does not bypass its mismatched or inactive original fleet registration '+JSON.stringify(patch),async()=>{
 const f=fixture({fleet:patch});await assert.rejects(f.resolve(),/registration is no longer active/);assert.equal(f.writes.length,0);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
test('missing staff identity fails before auth, approval reads or enrollment',async()=>{
 const f=fixture();delete f.w.sessionUser.staffId;await assert.rejects(f.resolve(),/Sign in as yourself/);assert.equal(f.reads.length,0);assert.equal(f.signIns.length,0);assert.equal(f.writes.length,0);
});
for(const change of ['staff object','staff name','staff branch','physical branch','physical tablet','isolated auth'])test('changing '+change+' during a fresh approval read cancels before returning an API',async()=>{
 const f=fixture();f.afterRead=ref=>{if(!ref.path.startsWith('pos_bindings/'))return;f.afterRead=()=>{};
  if(change==='staff object')f.w.sessionUser={...f.w.sessionUser};
  if(change==='staff name')f.w.sessionUser.cashierName='Different operator';
  if(change==='staff branch')f.w.sessionUser.branch='Cabantian';
  if(change==='physical branch')f.values.set('takodeal_device_branch','Cabantian');
  if(change==='physical tablet')f.values.set('takodeal_device_id','DEV-other');};
 if(change==='isolated auth')f.afterRead=async ref=>{if(!ref.path.startsWith('pos_bindings/'))return;f.afterRead=()=>{};const context=await f.deviceContext.resolve();context.auth.currentUser={uid:'replacement-device',isAnonymous:true};};
 await assert.rejects(f.resolve(),/changed|Sign in as yourself/);assert.equal(f.writes.length,0);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
test('a caller cancellation remains active through both approval and final context resolution',async()=>{
 const f=fixture();let current=true;f.afterRead=ref=>{if(ref.path.startsWith('pos_devices/'))current=false;};await assert.rejects(f.resolve({assertCurrent:()=>{if(!current)throw Error('Count period changed');}}),/Count period changed/);assert.equal(f.writes.length,0);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
for(const change of ['staff object','staff ID','staff name','physical branch','physical tablet','isolated auth','caller period'])test('returned approval guard rejects a later '+change+' change',async()=>{
 const f=fixture();let current=true;const{api}=await f.resolve({assertCurrent:()=>{if(!current)throw Error('Count period changed');}});assert.equal(typeof api.assertStockAuditCurrent,'function');api.assertStockAuditCurrent();
 if(change==='staff object')f.w.sessionUser={...f.w.sessionUser};
 if(change==='staff ID')f.w.sessionUser.staffId='other-staff';
 if(change==='staff name')f.w.sessionUser.cashierName='Other operator';
 if(change==='physical branch')f.values.set('takodeal_device_branch','Cabantian');
 if(change==='physical tablet')f.values.set('takodeal_device_id','DEV-other');
 if(change==='isolated auth')api.auth.currentUser={uid:'replacement-device',isAnonymous:true};
 if(change==='caller period')current=false;
 assert.throws(()=>api.assertStockAuditCurrent(),/changed|Sign in as yourself/);assert.equal(f.primaryAuth.currentUser,f.primaryUser);assert.equal(f.writes.length,0);
});
test('real count engine invokes the captured device guard after inventory reads and cancels a changed physical tablet without writes',async()=>{
 const f=fixture(),{api}=await f.resolve({action:'submit'}),h=firestoreHarness(),item={id:'flour',name:'Flour',branch:'Maa',baseUom:'gram',purchaseUom:'Pack',conversionRate:1000,currentStock:500,baseCost:.02,restockCycle:'Weekly'};
 h.put('cashiers/fictional-staff',{...f.w.sessionUser,status:'Active'});h.put('inventory/flour',item);
 api.doc=h.api.doc;api.serverTimestamp=h.api.serverTimestamp;api.runTransaction=(db,callback)=>h.api.runTransaction(db,async tx=>{const read=tx.get;tx.get=async ref=>{const snapshot=await read(ref);if(ref.path==='inventory/flour')f.values.set('takodeal_device_id','DEV-other');return snapshot;};return callback(tx);});
 const engine=createStockCountEngine(api,{now:()=>Date.parse('2026-10-31T12:00:00+08:00')});await assert.rejects(engine.submit({id:'fictional-count',branch:'Maa',cashier:'Fictional Operator',entries:countEntries([item],{flour_base:'400'}),selectedCycle:'Weekly',periodStart:'2026-10-26',periodEnd:'2026-11-01'}),/changed/);
 assert.equal(h.docs.size,2);assert.equal(h.get('inventory/flour').currentStock,500);assert.equal(h.get('stock_counts/fictional-count'),undefined);assert.equal(f.primaryAuth.currentUser,f.primaryUser);
});
