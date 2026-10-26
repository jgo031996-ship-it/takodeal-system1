import test from 'node:test';
import assert from 'node:assert/strict';
import {createCashierCashClient,createCashRemittanceAttempts,createCashRemittanceDeviceSession,CASH_REMITTANCE_ENDPOINT,assertCashRecordsReady,hasPendingCashRemittance} from '../Takodeal-POS/cash-remittance-client.js';
import {installCashRemittance} from '../Takodeal-POS/cash-remittance-ui.js';
import {ReviewDocument} from './helpers/review-dom.mjs';
const held=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const identity=()=>({uid:'sample-pos',staffId:'sample-staff',branch:'Sample Branch'});
const memory=()=>{const rows=new Map();return{rows,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k),key:i=>[...rows.keys()][i]??null,get length(){return rows.size;}};};
const input=()=>({staffId:'sample-staff',quoteId:'quote-sample',amount:'22500',countedRemaining:'12327.75',countConfirmed:true,varianceReason:'',channel:'Physical Handover',recipient:'Sample recipient',referenceNumber:'SAMPLE',salesPeriodStart:'2026-10-01',salesPeriodEnd:'2026-10-26'});
function clientFixture(){const calls=[],auth={currentUser:{uid:'sample-pos',isAnonymous:true,getIdToken:async()=> 'SAMPLE_TEST_POS_TOKEN_12345'}},state={status:200,result:{quoteId:'quote-sample'},beforeFetch:()=>{},beforeJSON:()=>{},beforeToken:()=>{}};auth.currentUser.getIdToken=async()=>{await state.beforeToken();return'SAMPLE_TEST_POS_TOKEN_12345';};const client=createCashierCashClient({auth,timeoutMs:1000,fetcher:async(url,options)=>{calls.push({url,options});await state.beforeFetch();return{ok:state.status>=200&&state.status<300,status:state.status,json:async()=>{await state.beforeJSON();return state.result;}};}});return{client,auth,calls,state};}
test('Cashier cash requests use only the fixed service with explicit credentials and no browser database writes',async()=>{const f=clientFixture(),body={staffId:'sample-staff',pin:'SAMPLE-ONLY',branch:'Sample Branch',operationId:'sample-op'};assert.deepEqual(await f.client.call('/quote',body,{uid:'sample-pos'}),f.state.result);assert.equal(f.calls[0].url,CASH_REMITTANCE_ENDPOINT+'/quote');const o=f.calls[0].options;assert.equal(o.method,'POST');assert.equal(o.headers.Authorization,'Bearer SAMPLE_TEST_POS_TOKEN_12345');assert.equal(o.cache,'no-store');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.deepEqual(JSON.parse(o.body),body);});
for(const route of ['/quote','/submit','/history','/status','/cancel'])test('Cashier supported cash route '+route+' is bounded and authenticated',async()=>{const f=clientFixture();await f.client.call(route,{}, {uid:'sample-pos'});assert.equal(f.calls[0].url,CASH_REMITTANCE_ENDPOINT+route);assert.ok(f.calls[0].options.signal instanceof AbortSignal);});
test('a browser cannot ask the Cashier transport to call an Owner receipt route',()=>{const f=clientFixture();assert.throws(()=>f.client.call('/receive',{}, {uid:'sample-pos'}),/Unsupported/);assert.equal(f.calls.length,0);});
for(const variant of ['missing','different','google'])test('unverified Cashier auth '+variant+' cannot send any cash request',async()=>{const f=clientFixture();if(variant==='missing')f.auth.currentUser=null;if(variant==='different')f.auth.currentUser.uid='other';if(variant==='google')f.auth.currentUser.isAnonymous=false;await assert.rejects(f.client.call('/quote',{}, {uid:'sample-pos'}),/account changed/);assert.equal(f.calls.length,0);});
test('a cashier/session change during token acquisition stops the physical network request',async()=>{const f=clientFixture(),gate=held();let valid=true;f.state.beforeToken=()=>gate.promise;const promise=f.client.call('/submit',{}, {uid:'sample-pos',assertCurrent:()=>{if(!valid)throw Error('Cashier changed');}});const rejected=assert.rejects(promise,/Cashier changed/);valid=false;gate.resolve();await rejected;assert.equal(f.calls.length,0);});
test('account changes after HTTP or JSON reads cannot produce confirmed success',async()=>{for(const at of ['beforeFetch','beforeJSON']){const f=clientFixture();f.state[at]=()=>{f.auth.currentUser.uid='other';};await assert.rejects(f.client.call('/submit',{}, {uid:'sample-pos'}),/account changed/);}});
test('server cash conflict and malformed response remain unconfirmed',async()=>{const f=clientFixture();f.state.status=409;f.state.result={code:'drawer-changed',message:'Recount the drawer.'};await assert.rejects(f.client.call('/submit',{}, {uid:'sample-pos'}),e=>e.message==='Recount the drawer.'&&e.code==='drawer-changed'&&e.status===409);f.state.status=200;f.state.result=null;await assert.rejects(f.client.call('/quote',{}, {uid:'sample-pos'}),/unconfirmed/);});
test('whole request deadline prevents a late token from sending a transfer',async()=>{const gate=held(),calls=[],auth={currentUser:{uid:'sample-pos',isAnonymous:true,getIdToken:()=>gate.promise}},client=createCashierCashClient({auth,timeoutMs:10,fetcher:async()=>calls.push('unexpected')});const pending=client.call('/submit',{}, {uid:'sample-pos'});await assert.rejects(pending,/not confirmed/);gate.resolve('SAMPLE_TEST_POS_TOKEN_12345');await new Promise(setImmediate);assert.equal(calls.length,0);});
test('saved transfer IDs survive page recreation and never persist PINs',()=>{const storage=memory(),actor=identity(),first=createCashRemittanceAttempts(storage,{makeId:()=> 'sample-operation'}),saved=first.prepare(actor,{...input(),pin:'NEVER-SAVE-THIS'},{expectedBeforeCents:3482775});const restored=createCashRemittanceAttempts(storage,{makeId:()=> 'different-operation'}).prepare(actor,input(),saved.snapshot);assert.equal(restored.operationId,saved.operationId);assert.equal([...storage.rows.values()].some(v=>v.includes('NEVER-SAVE-THIS')||v.includes('"pin"')),false);first.complete(actor,'different-operation');assert.ok(first.pending(actor));first.complete(actor,saved.operationId);assert.equal(first.pending(actor),null);});
test('an uncertain transfer cannot silently change its amount or counted retained cash',()=>{const s=createCashRemittanceAttempts(memory(),{makeId:()=> 'sample-operation'}),actor=identity();s.prepare(actor,input(),{});for(const change of [{amount:'22000'},{countedRemaining:'0'},{quoteId:'other-quote'},{channel:'Other'}])assert.throws(()=>s.prepare(actor,{...input(),...change},{}),/earlier transfer/);});
test('pending cash attempts are isolated by staff, authentication identity and branch',()=>{const s=createCashRemittanceAttempts(memory(),{makeId:()=> 'sample-operation'}),actor=identity();s.prepare(actor,input(),{});for(const change of [{uid:'other'},{staffId:'other'},{branch:'Other'}])assert.equal(s.pending({...actor,...change}),null);});
test('local persistence failure stops preparation and malformed saved data does not become a new transfer',()=>{const broken={getItem:()=>null,key:()=>null,length:0,setItem:()=>{throw Error('Disk full');}},s=createCashRemittanceAttempts(broken);assert.throws(()=>s.prepare(identity(),input(),{}),/Disk full/);const m=memory(),ok=createCashRemittanceAttempts(m,{makeId:()=> 'sample-operation'});ok.prepare(identity(),input(),{});const key=[...m.rows.keys()][0],saved=JSON.parse(m.rows.get(key));saved.body.amount='99999';m.rows.set(key,JSON.stringify(saved));assert.throws(()=>ok.pending(identity()),/could not be verified/);});
test('a cash count waits for durable receipt upload rather than turning unsynced cash into an overage',async()=>{const actor={branch:'Sample Branch',assertCurrent(){}},w={getPendingSales:async()=>[{payload:{branch:'Sample Branch',paymentMethod:'Cash',netTotal:100}}]};await assert.rejects(assertCashRecordsReady(w,actor),/Upload or reconcile/);w.getPendingSales=async()=>[{branch:'Other Branch'}];assert.equal(await assertCashRecordsReady(w,actor),true);w.getPendingSales=async()=>[{needsReconciliation:true}];await assert.rejects(assertCashRecordsReady(w,actor),/Upload or reconcile/);});
test('missing, unreadable and stalled receipt queues do not authorize a drawer quote',async()=>{const actor={branch:'Sample Branch',assertCurrent(){}};await assert.rejects(assertCashRecordsReady({},actor),/not ready/);await assert.rejects(assertCashRecordsReady({getPendingSales:async()=>null},actor),/not be verified/);await assert.rejects(assertCashRecordsReady({getPendingSales:()=>new Promise(()=>{})},actor,{timeoutMs:5}),/could not be confirmed/);});
test('checkout, upload or account changes block cash counting before a quote is requested',async()=>{for(const state of [{isProcessingOrder:true},{isSubmittingOrder:true},{isSyncing:true},{navigator:{onLine:false}}])await assert.rejects(assertCashRecordsReady({...state,getPendingSales:async()=>[]},{branch:'Sample Branch',assertCurrent(){}}),/Wait|Reconnect/);let active=true;const actor={branch:'Sample Branch',assertCurrent(){if(!active)throw Error('Cashier changed');}},w={getPendingSales:async()=>{active=false;return[];}};await assert.rejects(assertCashRecordsReady(w,actor),/Cashier changed/);});
test('an unconfirmed physical handover remains detectable after browser restart before any new checkout',()=>{const saved=memory(),storage={...saved,key:i=>[...saved.rows.keys()][i]??null,get length(){return saved.rows.size;}},actor=identity(),attempts=createCashRemittanceAttempts(storage,{makeId:()=> 'sample-op'});assert.equal(hasPendingCashRemittance(storage,actor.branch),false);const pending=attempts.prepare(actor,input(),{});assert.equal(hasPendingCashRemittance(storage,actor.branch),true);assert.equal(hasPendingCashRemittance(storage,'Other Branch'),false);const afterRestart={getItem:storage.getItem,key:storage.key,get length(){return saved.rows.size;}};assert.equal(hasPendingCashRemittance(afterRestart,actor.branch),true);attempts.complete(actor,pending.operationId);assert.equal(hasPendingCashRemittance(afterRestart,actor.branch),false);});
test('unreadable pending cash metadata cannot silently authorize another checkout',()=>{const saved=memory(),storage={...saved,key:i=>[...saved.rows.keys()][i]??null,get length(){return saved.rows.size;}};storage.setItem('takodeal_cash_remittance_v4:sample','not-json');assert.equal(hasPendingCashRemittance(storage,'Sample Branch'),true);assert.throws(()=>hasPendingCashRemittance({},'Sample Branch'),/could not be checked/);});

function deviceFixture(){
 const localStorage=memory(),google={uid:'sample-google',isAnonymous:false,getIdToken:async()=>{throw Error('Google credentials must not be used for cash actions');}},primaryAuth={currentUser:google},anonymous={uid:'sample-pos',isAnonymous:true,getIdToken:async()=>'SAMPLE_NAMED_POS_TOKEN_123456'},auth={currentUser:anonymous},db={app:'named-device'},reads=[],resolves=[];
 localStorage.setItem('takodeal_device_branch','Sample Branch');localStorage.setItem('takodeal_device_id','sample-tablet');
 const w={localStorage,sessionUser:{staffId:'sample-staff',cashierName:'Sample cashier',branch:'Sample Branch'},doc(){throw Error('The default Firestore must not read device approval');}};
 const deviceApi={db,doc:(value,table,id)=>({db:value,table,id}),getDocFromServer:async ref=>{reads.push(ref);assert.equal(ref.db,db);return{metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>ref.table==='pos_bindings'?{uid:'sample-pos',deviceId:'sample-tablet',branch:'Sample Branch',legacyDeviceDocId:'sample-fleet',status:'Active'}:{deviceId:'sample-tablet',branch:'Sample Branch',status:'Active',appType:'Cashier'}};}};
 const deviceContext={async resolve({assertCurrent}){assertCurrent();resolves.push('resolve');await Promise.resolve();assertCurrent();return{auth,deviceApi,kind:'isolated'};}};
 const signInAnonymously=async()=>{throw Error('Existing selected anonymous identity must be reused');};
 return{w,primaryAuth,google,auth,anonymous,db,reads,resolves,deviceContext,signInAnonymously};
}

test('cash device session lazily selects the matching anonymous auth and Firestore while Google remains signed in',async()=>{
 const f=deviceFixture(),devices=createCashRemittanceDeviceSession(f.w,{primaryAuth:f.primaryAuth,signInAnonymously:f.signInAnonymously,deviceContext:f.deviceContext});
 assert.equal(f.resolves.length,0);assert.equal(devices.auth,f.primaryAuth);
 const approval=await devices.check();assert.equal(approval.status,'Active');assert.equal(approval.uid,'sample-pos');assert.equal(devices.auth,f.auth);assert.deepEqual(f.reads.map(r=>r.table),['pos_bindings','pos_devices']);
 const actor=devices.capture();assert.equal(actor.uid,'sample-pos');actor.assertCurrent();assert.equal(f.primaryAuth.currentUser,f.google);
 f.w.sessionUser={...f.w.sessionUser};assert.throws(()=>actor.assertCurrent(),/cashier, tablet or branch changed/);
});

test('a staff change during device-context resolution cannot authorize a remittance gate',async()=>{
 const f=deviceFixture(),wait=held(),deviceContext={async resolve(){await wait.promise;return{auth:f.auth,deviceApi:{},kind:'isolated'};}};
 const devices=createCashRemittanceDeviceSession(f.w,{primaryAuth:f.primaryAuth,deviceContext}),work=devices.check();f.w.sessionUser={...f.w.sessionUser,staffId:'other-staff'};wait.resolve();
 await assert.rejects(work,/cashier, tablet or branch changed/);assert.equal(f.reads.length,0);assert.equal(f.primaryAuth.currentUser,f.google);
});

test('legacy device-session injection still uses the existing default anonymous context',async()=>{
 const f=deviceFixture(),primaryAuth=f.auth,devices=createCashRemittanceDeviceSession({...f.w,...f.deviceContext,db:f.db,doc:(db,table,id)=>({db,table,id}),getDocFromServer:async ref=>({metadata:{},exists:()=>true,data:()=>ref.table==='pos_bindings'?{uid:'sample-pos',deviceId:'sample-tablet',branch:'Sample Branch',legacyDeviceDocId:'sample-fleet',status:'Active'}:{deviceId:'sample-tablet',branch:'Sample Branch',status:'Active'}})},{primaryAuth});
 assert.equal((await devices.check()).status,'Active');assert.equal(devices.auth,primaryAuth);assert.equal(devices.capture().uid,'sample-pos');assert.equal(f.resolves.length,0);
});

test('all cash routes obtain the selected device token without borrowing the preserved Google account',async()=>{
 const f=deviceFixture(),calls=[],client=createCashierCashClient({auth:f.primaryAuth,getAuth:()=>f.auth,fetcher:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>({saved:true})};}});
 for(const route of ['/quote','/submit','/history','/status','/cancel'])await client.call(route,{}, {uid:'sample-pos'});
 assert.equal(calls.length,5);assert.ok(calls.every(call=>call.options.headers.Authorization==='Bearer SAMPLE_NAMED_POS_TOKEN_123456'));assert.equal(f.primaryAuth.currentUser,f.google);
});

test('transport snapshots the selected auth and user so an equal-UID replacement during token or response work cannot confirm cash',async()=>{
 for(const at of ['token','response','json'])for(const replace of ['auth','user']){
  const f=deviceFixture(),calls=[];let selected=f.auth;
  const change=()=>{const user={...f.anonymous};if(replace==='auth')selected={currentUser:user};else f.auth.currentUser=user;};
  f.anonymous.getIdToken=async()=>{if(at==='token')change();return'SAMPLE_NAMED_POS_TOKEN_123456';};
  const client=createCashierCashClient({getAuth:()=>selected,fetcher:async()=>{calls.push('request');if(at==='response')change();return{ok:true,status:200,json:async()=>{if(at==='json')change();return{saved:true};}};}});
  await assert.rejects(client.call('/submit',{}, {uid:'sample-pos'}),/tablet account changed/);assert.equal(calls.length,at==='token'?0:1);assert.equal(f.primaryAuth.currentUser,f.google);
 }
});

test('a same-branch transfer saved by another UID or staff blocks new preparation without erasing or migrating it',()=>{
 for(const change of [{uid:'new-device-uid'},{staffId:'new-staff'}]){
  const storage=memory(),attempts=createCashRemittanceAttempts(storage,{makeId:()=>'original-operation'}),original=identity(),saved=attempts.prepare(original,input(),{}),before=[...storage.rows];
  const actor={...original,...change};assert.equal(attempts.pending(actor),null);
  assert.throws(()=>attempts.assertAvailable(actor),/another staff or tablet account/);
  assert.throws(()=>attempts.prepare(actor,{...input(),staffId:actor.staffId},{}),/another staff or tablet account/);
  attempts.complete(actor,saved.operationId);assert.deepEqual([...storage.rows],before);assert.equal(attempts.pending(original).operationId,saved.operationId);
  assert.equal(attempts.prepare(original,input(),{}).operationId,saved.operationId);
 }
});

test('a different branch can use its own transfer and malformed foreign metadata fails closed',()=>{
 const storage=memory(),attempts=createCashRemittanceAttempts(storage,{makeId:()=>'sample-operation'}),actor=identity();attempts.prepare(actor,input(),{});
 const other={...actor,uid:'other-device',branch:'Other Branch'};assert.equal(attempts.assertAvailable(other),true);attempts.prepare(other,input(),{});assert.equal(storage.length,2);
 storage.setItem('takodeal_cash_remittance_v4:broken','not-json');assert.throws(()=>attempts.assertAvailable({...other,branch:'New Branch'}),/Owner review/);assert.equal(storage.length,3);
});

function uiFixture(){
 const f=deviceFixture(),d=new ReviewDocument(),create=d.createElement.bind(d),calls=[];
 d.createElement=tag=>{const e=create(tag);e.classList={add(){},toggle(){}};e.replaceChildren=(...children)=>{e.children=[];e._text='';e.append(...children);};e.reset=()=>{for(const field of e.querySelectorAll('input,textarea,select')){field.value='';field.checked=false;}};return e;};
 for(const id of ['view-remit','remittanceModal']){const e=d.createElement('div');e.id=id;d.body.append(e);}
 const snapshot={sourceShiftId:'sample-shift',asOf:'2026-10-26T12:00:00Z',basis:'active-ledger',openingCashCents:100000,cashSalesCents:0,drawerExpenseCents:0,priorRemittanceCents:0,expectedBeforeCents:100000};
 Object.assign(f.w,{crypto:{randomUUID:()=>'sample-quote-operation'},getPendingSales:async()=>[],switchView(){},addEventListener(){},Swal:{fire:async()=>({isConfirmed:true})},fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/quote'))return{ok:true,status:200,json:async()=>({quoteId:'sample-quote',sourceShiftId:snapshot.sourceShiftId,branch:'Sample Branch',snapshot,expiresAt:'2026-10-26T12:05:00Z',channels:['Physical Handover']})};throw Error('Simulated uncertain acknowledgement');}});
 const ui=installCashRemittance(f.w,d,{primaryAuth:f.primaryAuth,deviceContext:f.deviceContext,signInAnonymously:f.signInAnonymously,now:()=>new Date('2026-10-26T12:00:00Z')});
 const status=()=>d.querySelector('[role]')?.textContent||d.body.textContent;
 return{...f,d,ui,calls,snapshot,status};
}

test('the cash UI uses the selected approval database and device token for a verified quote without changing Google',async()=>{
 const f=uiFixture();f.ui.open();f.d.getElementById('cashRemitPin').value='SAMPLE-ONLY';await f.ui.loadQuote();
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/quote'));assert.equal(f.calls[0].options.headers.Authorization,'Bearer SAMPLE_NAMED_POS_TOKEN_123456');assert.equal(f.reads.length,2);assert.equal(f.primaryAuth.currentUser,f.google);assert.equal(f.w.cashierCashCountActive,true);
});

test('the cash UI blocks a fresh quote for a foreign durable attempt and keeps the checkout pause after reopen',async()=>{
 const f=uiFixture(),attempts=createCashRemittanceAttempts(f.w.localStorage,{makeId:()=>'old-default-operation'}),oldActor={...identity(),uid:'old-default-pos'};attempts.prepare(oldActor,input(),f.snapshot);const before=[...f.w.localStorage.rows];
 f.ui.open();assert.equal(f.w.cashierCashCountActive,true);f.d.getElementById('cashRemitPin').value='SAMPLE-ONLY';await f.ui.loadQuote();
 assert.equal(f.calls.length,0);assert.match(f.d.body.textContent,/another staff or tablet account/);assert.deepEqual([...f.w.localStorage.rows],before);assert.equal(f.primaryAuth.currentUser,f.google);f.ui.open();assert.equal(f.w.cashierCashCountActive,true);
});

test('a foreign attempt appearing after the quote blocks the new handover before any submit or local migration',async()=>{
 const f=uiFixture();f.ui.open();f.d.getElementById('cashRemitPin').value='SAMPLE-ONLY';await f.ui.loadQuote();
 const attempts=createCashRemittanceAttempts(f.w.localStorage,{makeId:()=>'other-cashier-operation'}),other={...identity(),staffId:'other-staff'};attempts.prepare(other,{...input(),staffId:other.staffId},f.snapshot);const before=[...f.w.localStorage.rows];
 await f.w.submitRemittance();assert.equal(f.calls.length,1);assert.match(f.d.body.textContent,/another staff or tablet account/);assert.deepEqual([...f.w.localStorage.rows],before);assert.equal(f.w.cashierCashCountActive,true);
});

test('an original selected-UID attempt retries the same handover and never asks for a replacement quote',async()=>{
 const f=uiFixture(),attempts=createCashRemittanceAttempts(f.w.localStorage,{makeId:()=>'original-operation'}),saved=attempts.prepare(identity(),input(),f.snapshot);f.ui.open();f.d.getElementById('cashRemitPin').value='SAMPLE-ONLY';await f.ui.loadQuote();assert.equal(f.calls.length,0);
 await f.w.submitRemittance();assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/submit'));const body=JSON.parse(f.calls[0].options.body);assert.equal(body.operationId,saved.operationId);assert.equal(body.quoteId,saved.body.quoteId);assert.equal(f.calls[0].options.headers.Authorization,'Bearer SAMPLE_NAMED_POS_TOKEN_123456');assert.equal(attempts.pending(identity()).operationId,saved.operationId);assert.equal(f.w.cashierCashCountActive,true);assert.equal(f.primaryAuth.currentUser,f.google);
});
