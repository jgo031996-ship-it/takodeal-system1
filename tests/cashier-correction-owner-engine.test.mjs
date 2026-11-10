import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorrectionSaleEngine} from '../Takodeal-POS/cashier-correction-engine.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {voidUI} from './helpers/cashier-void-fixture.mjs';
function fixture({anonymous=false}={}){
 const h=firestoreHarness(),app={name:anonymous?'EXISTING_APPROVED_DEVICE':'takodeal-pos-owner-preview-v1'},db={app},user={uid:anonymous?'EXISTING_ANON':'EXISTING_OWNER',isAnonymous:anonymous},auth={app,currentUser:user},calls=[];
 const source=h.api,api={...source,doc:(actual,...args)=>{assert.equal(actual,db);calls.push('doc:'+args.join('/'));return source.doc(actual,...args);},collection:(actual,...args)=>{assert.equal(actual,db);calls.push('collection:'+args.join('/'));return source.collection(actual,...args);},getDocsFromServer:async q=>{const result=await source.getDocsFromServer(q);if(f.queryHook)await f.queryHook();return result;},runTransaction:async(actual,work)=>{assert.equal(actual,db);calls.push('TX');const result=await source.runTransaction(actual,tx=>work(new Proxy(tx,{get(target,key){const value=target[key];return typeof value==='function'?asyncOrSync(key,value,target):value;}})));if(f.afterCommit)await f.afterCommit();return result;}};
 function asyncOrSync(key,method,target){return(...args)=>{const value=method.apply(target,args);if(value?.then)return value.then(row=>{if(f.transactionRead)f.transactionRead(args[0]);return row;});if(f.transactionWrite)f.transactionWrite(key,args[0]);return value;};}
 const connection={api:{auth,db},user,uid:user.uid},engine=createCorrectionSaleEngine(api,connection),f={h,db,auth,user,api,connection,engine,calls};
 h.put('inventory/raw',{branch:'SAMPLE',name:'SAMPLE Raw',baseUom:'Gram',uom:'Gram',currentStock:100});h.put('transactions/SOURCE',{saleId:'SOURCE',receiptId:'OLD',branch:'SAMPLE',shiftId:'SHIFT',status:'Voided',voidReason:'WrongPunched',voidOperationId:'OPERATION'});h.put('shifts/SHIFT',{branch:'SAMPLE',active:true,salesRevision:1});
 f.payload={saleId:'REPLACEMENT',receiptId:'NEW',branch:'SAMPLE',shiftId:'SHIFT',saleVersion:2,localTimestamp:'2026-11-11T00:00:00.000Z',cart:[{name:'SAMPLE Meal',qty:1}],netTotal:80,paymentMethod:'Cash',voidCorrection:{schemaVersion:1,operationId:'OPERATION',sourceSaleId:'SOURCE',sourceReceiptId:'OLD',sourceFingerprint:'a'.repeat(64),checkoutAttemptId:'ATTEMPT',claimTokenHash:'b'.repeat(64)}};return f;
}
const prepare=f=>f.engine.prepare(f.payload,[{menuItem:'SAMPLE Meal',ingredientName:'SAMPLE Raw',qty:2}]);

test('named Owner and existing anonymous corrections use only their selected matching app/db for fresh prepare and commit',async()=>{
 for(const anonymous of [false,true]){const f=fixture({anonymous}),ordinaryDb=f.api.db;assert.notEqual(ordinaryDb,f.db);const payload=await prepare(f);assert.equal(payload.inventoryMovements[0].inventoryId,'raw');assert.equal(await f.engine.commit(payload),'committed');assert.equal(f.h.get('inventory/raw').currentStock,98);assert.equal(f.h.get('transactions/REPLACEMENT').receiptId,'NEW');assert.equal(f.api.db,ordinaryDb);assert.equal(f.calls.some(row=>row==='collection:inventory'),true);assert.equal(f.calls.filter(row=>row==='TX').length,1);}
});

test('missing, foreign UID or mismatched selected app never falls back to the ordinary engine',()=>{
 const f=fixture();for(const value of [null,{...f.connection,uid:'FOREIGN'},{...f.connection,api:{auth:f.auth,db:{app:{name:'OTHER'}}}}])assert.throws(()=>createCorrectionSaleEngine(f.api,value),/original receipt correction account changed/);assert.equal(f.h.get('transactions/REPLACEMENT'),undefined);
});

test('selected Owner identity changing during inventory preparation keeps the original source and writes nothing',async()=>{
 const f=fixture();f.queryHook=()=>{f.auth.currentUser={...f.user};};await assert.rejects(prepare(f),/account changed/);assert.equal(f.h.get('inventory/raw').currentStock,100);assert.equal(f.h.get('transactions/REPLACEMENT'),undefined);
});

test('selected identity changing during transaction reads or writes aborts every staged stock/receipt change',async()=>{
 for(const stage of ['read','write']){const f=fixture(),payload=await prepare(f);if(stage==='read')f.transactionRead=()=>{f.auth.currentUser={...f.user};};else f.transactionWrite=()=>{f.auth.currentUser={...f.user};};await assert.rejects(f.engine.commit(payload),/account changed/);assert.equal(f.h.get('inventory/raw').currentStock,100,stage);assert.equal(f.h.get('transactions/REPLACEMENT'),undefined,stage);assert.equal(f.h.get('shifts/SHIFT').salesRevision,1,stage);}
});

test('identity changing after actual commit cannot acknowledge success; exact original payload retry commits no second stock movement',async()=>{
 const f=fixture(),payload=await prepare(f);f.afterCommit=()=>{f.auth.currentUser={...f.user};};await assert.rejects(f.engine.commit(payload),/account changed/);assert.equal(f.h.get('inventory/raw').currentStock,98);assert.equal(f.h.get('transactions/REPLACEMENT').receiptId,'NEW');f.afterCommit=null;f.auth.currentUser=f.user;assert.equal(await f.engine.commit(payload),'already-committed');assert.equal(f.h.get('inventory/raw').currentStock,98);assert.equal(f.h.get('shifts/SHIFT').salesRevision,2);
});

test('durably prepared correction keeps original cashier identity across unrelated local operator change',async()=>{
 const f=fixture(),payload={...await prepare(f),cashier:'ORIGINAL CASHIER'};f.transactionRead=()=>{f.localSelectedEmployee='OTHER EMPLOYEE';};assert.equal(await f.engine.commit(payload),'committed');assert.equal(f.h.get('transactions/REPLACEMENT').cashier,'ORIGINAL CASHIER');assert.equal(f.auth.currentUser,f.user);
});

test('a reloaded paid correction has no writer until the exact original private claim is freshly verified',async()=>{
 const f=voidUI();await f.controller.start('SAMPLE_SOURCE','SAMPLE-OLD-RECEIPT');const payload={branch:f.backend.branch,shiftId:'SAMPLE_SHIFT',cart:f.w.cart,paymentMethod:'Cash',netTotal:85},reserved=await f.controller.prepareCheckout(payload);Object.assign(payload,{saleId:reserved.saleId,receiptId:reserved.receiptId});const frozen=await f.controller.freezeCheckout(payload),g=voidUI({backend:f.backend,saved:f.saved,tabSaved:f.tabSaved});assert.throws(()=>g.controller.saleConnection(frozen),/saved correction/);assert.equal(await g.controller.verifyQueued(frozen),false);const writer=g.controller.saleConnection(frozen);assert.equal(writer.uid,f.backend.uid);assert.equal(writer.api.auth.currentUser,writer.user);assert.equal(writer.api.db.app,writer.api.auth.app);assert.throws(()=>g.controller.saleConnection({...frozen,paymentMethod:'GCash'}),/saved correction/);assert.equal(g.calls.filter(row=>row.path==='/cashier-void/commit').length,0);assert.equal(f.backend.commits,1);
});
