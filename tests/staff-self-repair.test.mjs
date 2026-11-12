import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../takodeal-staff/staff-self-repair.js',import.meta.url),'utf8');
const JOURNAL='takodeal_staff_self_repair_v1',HISTORY='takodeal_staff_previous_device_v1';
const code='1234567890',flush=async()=>{for(let i=0;i<90;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

function fixture(options={}){
 const elements=[],events=new Map(),timers=new Map(),calls={refresh:0,create:0,activate:0,verify:0,drain:0,single:0,handoff:0,forbidden:0},rows=options.rows||new Map([
  ['takodeal_staff_id','STAFF_A'],['takodeal_staff_name','Fictional Staff'],['takodeal_staff_pic','kept-pic'],['takodeal_staff_session_id','kept-session'],['takodeal_device_id','DEV-ORIGINAL1'],
  ['privateApproval','PRIVATE_APPROVED_UID'],['firebaseSentinel','SDK owns this'],['unrelatedApp','kept'],['queuedReceiptSentinel','kept-queue']
 ]);
 let primaryUid=options.primaryUid||'PRIMARY_OLD',privateUid=options.privateUid||'PRIVATE_APPROVED_UID',candidate=options.candidate||null,active=options.active||false,nextId=1;
 let setHook=options.setHook,removeHook=options.removeHook;
 const storage={get length(){return rows.size;},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.has(key)?rows.get(key):null,
  setItem(key,value){setHook?.(key,value);rows.set(key,String(value));},removeItem(key){removeHook?.(key);rows.delete(key);},clear(){calls.forbidden++;throw Error('Storage clear forbidden');}};
 function node(tag){const out={tagName:tag.toUpperCase(),children:[],style:{},hidden:false,disabled:false,value:'',attrs:new Map(),listeners:new Map(),files:[],appendChild(child){this.children.push(child);child.parentElement=this;return child;},setAttribute(key,value){this.attrs.set(key,value);},getAttribute(key){return this.attrs.get(key)??null;},hasAttribute(key){return this.attrs.has(key);},addEventListener(type,fn){this.listeners.set(type,fn);}};elements.push(out);return out;}
 const d={body:node('body'),createElement:node,createTextNode:text=>({textContent:text}),getElementById:key=>elements.find(el=>el.id===key),addEventListener:(type,fn)=>events.set('dom:'+type,fn),querySelectorAll(selector){
  if(selector==='input[type="file"]')return elements.filter(el=>el.tagName==='INPUT'&&el.type==='file');
  if(selector==='textarea, [data-staff-unsent]')return elements.filter(el=>el.tagName==='TEXTAREA'||el.hasAttribute('data-staff-unsent'));
  return[];
 }};
 let counter=0;
 const forbidden=()=>{calls.forbidden++;throw Error('Forbidden Auth/data/cache access');};
 const w={localStorage:storage,setTimeout(fn,ms){const id=++counter;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>events.set(type,fn),CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:event=>events.get(event.type)?.(event),location:{reload:forbidden},indexedDB:{deleteDatabase:forbidden},caches:{delete:forbidden},signOut:forbidden,fetch:forbidden};
 if(options.storageUnavailable)Object.defineProperty(w,'localStorage',{get(){throw Error('Storage blocked');}});
 w[Symbol.for('takodeal.staff.appUpdate')]=async()=>{calls.refresh++;return true;};
 const nav={onLine:true};
 vm.runInNewContext(source,{window:w,document:d,navigator:nav,Symbol,Array,Date,JSON,Object,Number,String,Promise,Error});
 const api=w.staffSelfRepair;api.open();
 const journal=()=>{const raw=storage.getItem(JOURNAL);return raw?JSON.parse(raw):null;};
 const result=()=>({active,uid:candidate.uid,deviceId:candidate.deviceId,staffId:'STAFF_A'});
 const adapter={
  capture:()=>({primaryUid,privateUid,staffId:storage.getItem('takodeal_staff_id')||journal()?.staffId,deviceId:storage.getItem('takodeal_device_id')}),
  async createCandidate(input){calls.create++;input.assertCurrent();if(!candidate||candidate.uid===primaryUid){candidate={uid:'CANDIDATE_'+nextId,deviceId:'DEV-CANDIDATE'+nextId,operationId:'SETUP_OP_'+nextId++};active=false;}await options.create?.(input);input.assertCurrent();return{...candidate};},
  async verifyCandidate(input){calls.verify++;input.assertCurrent();await options.verify?.(input);input.assertCurrent();return result();},
  async activateCandidate(input){calls.activate++;input.assertCurrent();assert.equal(input.code,code);await options.activate?.(input);input.assertCurrent();active=true;return result();},
  async drainPendingWrites(input){calls.drain++;input.assertCurrent();await options.drain?.(input,calls.drain);input.assertCurrent();},
  async assertSingleWindow(input){calls.single++;input.assertCurrent();const value=await options.single?.(input,calls.single);input.assertCurrent();return value??true;},
  async handoffPrimary(input){calls.handoff++;input.assertCurrent();await options.handoff?.(input);input.assertCurrent();primaryUid=input.journal.candidateUid;input.assertCurrent();}
 };
 if(options.configured!==false)api.configureSDK(adapter);
 return{api,w,d,nav,storage,rows,elements,calls,events,timers,adapter,journal,node,
  get primaryUid(){return primaryUid;},set primaryUid(value){primaryUid=value;},get privateUid(){return privateUid;},set privateUid(value){privateUid=value;},
  get active(){return active;},set active(value){active=value;},get candidate(){return candidate;},set candidate(value){candidate=value;},
  setHook(value){setHook=value;},removeHook(value){removeHook=value;},
  message:()=>elements.find(el=>el.attrs.get('role')==='status')?.textContent||'',
  snapshot:()=>Object.fromEntries([...rows].filter(([key])=>![JOURNAL,HISTORY].includes(key))),
  expire(ms){for(const[id,timer]of[...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}},
  reset:()=>api.startReset({code,confirmed:true}),
  intact(){assert.equal(calls.forbidden,0);assert.equal(privateUid,'PRIVATE_APPROVED_UID');assert.equal(storage.getItem('privateApproval'),'PRIVATE_APPROVED_UID');assert.equal(storage.getItem('firebaseSentinel'),'SDK owns this');assert.equal(storage.getItem('queuedReceiptSentinel'),'kept-queue');assert.equal(storage.getItem('unrelatedApp'),'kept');}
 };
}

test('classic repair opens without app/SDK; file refresh delegates shared updater and touches no identity',async()=>{
 const h=fixture({configured:false}),before=h.snapshot();assert.equal(typeof h.api.open,'function');assert.equal(await h.api.refreshFiles(),true);assert.equal(h.calls.refresh,1);
 assert.equal(await h.reset(),false);assert.match(h.message(),/finish opening/);assert.deepEqual(h.snapshot(),before);assert.equal(h.journal(),null);h.intact();
});
test('file-only repair remains available with blocked account storage or durable pending references; Reset stays held',async()=>{
 for(const unavailable of[true,false]){
  const h=fixture({configured:false,storageUnavailable:unavailable});if(!unavailable)h.storage.setItem('takodeal_staff_session_pending_v1:kept:SID','kept exact pending reference');const before=h.snapshot();
  assert.equal(await h.api.refreshFiles(),true);assert.equal(h.calls.refresh,1);assert.equal(await h.reset(),false);assert.deepEqual(h.snapshot(),before);assert.equal(h.calls.create,0);h.intact();
 }
});
test('code and explicit consent are required before candidate creation or saved-data mutation',async()=>{
 const h=fixture(),before=h.snapshot();for(const input of[{code,confirmed:false},{code:'1234',confirmed:true},{code:'',confirmed:true}])assert.equal(await h.api.startReset(input),false);
 assert.equal(h.calls.create,0);assert.equal(h.calls.activate,0);assert.equal(h.journal(),null);assert.deepEqual(h.snapshot(),before);h.intact();
});
test('busy attendance, pending swap, unsent file/form and known pending references block before all SDK work',async()=>{
 for(const kind of['punch','swap-write','swap-draft','swap-check','registration','late','file','form','setup','legacy-request','session','sop','unknown-marker']){
  const h=fixture();if(kind==='punch')h.w.staffPunchBusy=true;if(kind==='swap-write')h.w.staffSwapWritePending=true;if(kind==='swap-draft')h.w.pendingSwapData={qty:2};if(kind==='swap-check')h.w.staffSwapSubmitting={};if(kind==='registration')h.w.staffDeviceRegistrationBusy=true;if(kind==='late')h.w.staffLateProofDraft={reason:'Kept reason'};
  if(kind==='file'){const n=h.node('input');n.type='file';n.files=[{name:'kept.jpg'}];}if(kind==='form')h.node('textarea').value='Kept explanation';
  const keys={setup:'takodeal_staff_setup_draft_v1','legacy-request':'takodeal_staff_registration_draft',session:'takodeal_staff_session_pending_v1:UID:SID',sop:'takodeal_sop_draft_Branch_Role','unknown-marker':'takodeal_staff_operation_journal_bad'};
  if(keys[kind])h.storage.setItem(keys[kind],'malformed but preserved');const before=h.snapshot();
  assert.equal(await h.reset(),false,kind);assert.equal(h.calls.create,0,kind);assert.equal(h.calls.drain,0,kind);assert.deepEqual(h.snapshot(),before,kind);assert.equal(h.journal(),null);h.intact();
 }
});
test('unconfirmed swap survives draft removal as independent blocking flag for reset and refresh',async()=>{
 const h=fixture();h.w.staffSwapWritePending=true;h.w.pendingSwapData=null;assert.equal(await h.reset(),false);assert.equal(await h.api.refreshFiles(),false);assert.equal(h.calls.refresh,0);assert.equal(h.calls.handoff,0);h.intact();
});
test('closed saved forms do not block repair forever; visible input-only unsent requests and hidden selected files do',async()=>{
 const done=fixture(),modal=done.node('section'),reason=done.node('textarea');modal.style.display='none';reason.value='Already sent reason';modal.appendChild(reason);assert.equal(await done.reset(),true);done.intact();
 for(const id of['reqAmount','reqMealReceiptCode','reqStart','reqEnd']){const h=fixture(),input=h.node('input');input.id=id;input.value=id==='reqMealReceiptCode'?'SAVED-RECEIPT':'1';assert.equal(await h.reset(),false,id);assert.equal(h.calls.create,0);assert.equal(input.value,id==='reqMealReceiptCode'?'SAVED-RECEIPT':'1');h.intact();}
 const file=fixture(),hidden=file.node('section'),selected=file.node('input');hidden.hidden=true;selected.type='file';selected.files=[{name:'still-unsent.jpg'}];hidden.appendChild(selected);assert.equal(await file.reset(),false);assert.equal(file.calls.create,0);file.intact();
});
test('incorrect/disabled code and phone-slot errors keep original Auth, device, selection and private approval byte-exact',async()=>{
 for(const reason of['Incorrect code','Code disabled','Phone slots full']){const h=fixture({activate(){throw Error(reason);}}),before=h.snapshot();assert.equal(await h.reset(),false);assert.deepEqual(h.snapshot(),before);assert.equal(h.primaryUid,'PRIMARY_OLD');assert.equal(h.journal().phase,'activation-pending');assert.equal(h.api.requiresCode(),false);assert.equal(h.calls.handoff,0);assert.equal(JSON.stringify(h.journal()).includes(code),false);h.intact();}
});
test('activation intent is durable before dispatch; lost reply resumes exact candidate/op without another activation',async()=>{
 let h;h=fixture({activate({journal}){assert.deepEqual(h.journal(),JSON.parse(JSON.stringify(journal)));h.active=true;throw Error('Reply lost');}});const before=h.snapshot();
 assert.equal(await h.reset(),false);const original=h.journal();assert.deepEqual(h.snapshot(),before);assert.equal(h.primaryUid,'PRIMARY_OLD');
 assert.equal(await h.api.resumeReset(),true);assert.equal(h.calls.create,1);assert.equal(h.calls.activate,1);assert.equal(h.journal().operationId,original.operationId);assert.equal(h.primaryUid,original.candidateUid);h.intact();
});
test('normal reset switches only after fresh Active and second drain/exclusive checks; clears only four account keys',async()=>{
 const h=fixture();assert.equal(await h.reset(),true);const row=h.journal();assert.equal(row.phase,'complete');assert.equal(h.calls.drain,2);assert.equal(h.calls.single,2);assert.equal(h.calls.verify,2);assert.equal(h.calls.handoff,1);assert.equal(h.storage.getItem('takodeal_device_id'),row.candidateDeviceId);
 for(const key of['takodeal_staff_id','takodeal_staff_name','takodeal_staff_pic','takodeal_staff_session_id'])assert.equal(h.storage.getItem(key),null);
 assert.equal(JSON.parse(h.storage.getItem(HISTORY)).deviceId,'DEV-ORIGINAL1');assert.equal(h.api.requiresCode(),false);assert.equal(JSON.stringify([...h.rows]).includes(code),false);h.intact();
});
test('unknown, inactive, wrong-staff or wrong-device confirmation never adopts candidate',async()=>{
 for(const kind of['inactive','staff','device','extra']){const h=fixture();const normal=h.adapter.verifyCandidate;h.adapter.verifyCandidate=async input=>{const value=await normal(input);if(kind==='inactive'&&h.calls.verify>1)value.active=false;if(kind==='staff')value.staffId='STAFF_B';if(kind==='device')value.deviceId='DEV-FOREIGN1';if(kind==='extra')value.token='must never be accepted';return value;};const before=h.snapshot();assert.equal(await h.reset(),false,kind);assert.equal(h.calls.handoff,0);assert.deepEqual(h.snapshot(),before);h.intact();}
});
test('unsupported or multiple-window confirmation keeps original data and creates no candidate',async()=>{
 for(const reply of[false,{count:1},'true']){const h=fixture({single:()=>reply}),before=h.snapshot();assert.equal(await h.reset(),false);assert.equal(h.calls.create,0);assert.equal(h.calls.handoff,0);assert.deepEqual(h.snapshot(),before);h.intact();}
});
test('new work or changed primary/private UID during awaits holds before adoption, preserving selected data',async()=>{
 for(const kind of['punch','private','primary','staff','device','window']){let h;h=fixture({drain(_input,count){if(count!==2)return;if(kind==='punch')h.w.staffPunchBusy=true;if(kind==='private')h.privateUid='OTHER_PRIVATE';if(kind==='primary')h.primaryUid='OTHER_PRIMARY';if(kind==='staff')h.storage.setItem('takodeal_staff_id','STAFF_B');if(kind==='device')h.storage.setItem('takodeal_device_id','DEV-CHANGED1');},single(_input,count){if(kind==='window'&&count===2)return false;}});
  assert.equal(await h.reset(),false,kind);assert.equal(h.calls.handoff,0,kind);assert.notEqual(h.journal()?.phase,'complete');assert.equal(h.calls.forbidden,0);assert.equal(h.storage.getItem('privateApproval'),'PRIVATE_APPROVED_UID');
 }
});
test('pre-activation drain timeout has no late candidate/primary switch and permits safe retry',async()=>{
 const gate=deferred();let once=true;const h=fixture({drain(){if(once){once=false;return gate.promise;}}}),before=h.snapshot(),pending=h.reset();await flush();h.expire(15000);assert.equal(await pending,false);gate.resolve();await flush();assert.equal(h.calls.create,0);assert.deepEqual(h.snapshot(),before);assert.equal(await h.reset(),true);h.intact();
});
test('activation timeout keeps reference; late activation cannot adopt primary, and exact status resumes',async()=>{
 const gate=deferred();let h;h=fixture({activate:()=>gate.promise});const before=h.snapshot(),pending=h.reset();await flush();assert.equal(h.journal().phase,'activation-pending');h.expire(25000);assert.equal(await pending,false);h.active=true;gate.resolve();await flush();assert.equal(h.calls.handoff,0);assert.deepEqual(h.snapshot(),before);assert.equal(await h.api.resumeReset(),true);assert.equal(h.calls.activate,1);h.intact();
});
test('handoff notice NEVER releases physical singleflight or permits retry before SDK adoption settles',async()=>{
 const gate=deferred(),h=fixture({handoff:()=>gate.promise}),pending=h.reset();await flush();assert.equal(h.journal().phase,'handoff-pending');assert.match(h.api.blockReason({filesOnly:true}),/reset is still finishing/);h.expire(15000);await flush();assert.match(h.message(),/still finishing/);assert.match(h.api.blockReason({filesOnly:true}),/reset is still finishing/);assert.equal(await h.api.resumeReset(),false);assert.equal(await h.api.refreshFiles(),false);assert.equal(h.calls.handoff,1);assert.equal(h.storage.getItem('takodeal_device_id'),'DEV-ORIGINAL1');gate.resolve();assert.equal(await pending,true);assert.equal(h.api.blockReason({filesOnly:true}),'');h.intact();
});
test('crash after SDK adoption resumes exact handoff and never repeats activation or erases private identity',async()=>{
 let h,once=true;h=fixture({handoff({journal}){if(once){once=false;h.primaryUid=journal.candidateUid;throw Error('Browser interrupted after adoption');}}});assert.equal(await h.reset(),false);assert.equal(h.journal().phase,'handoff-pending');assert.equal(h.storage.getItem('takodeal_device_id'),'DEV-ORIGINAL1');assert.equal(await h.api.resumeReset(),true);assert.equal(h.calls.activate,1);assert.equal(h.calls.create,1);h.intact();
});
test('partial local key handoff stays recoverable until exact candidate/device selection is complete',async()=>{
 let fail=true;const h=fixture({removeHook(key){if(fail&&key==='takodeal_staff_name'){fail=false;throw Error('Interrupted local update');}}});assert.equal(await h.reset(),false);assert.equal(h.journal().phase,'handoff-pending');assert.equal(h.storage.getItem('takodeal_staff_id'),null);assert.equal(h.storage.getItem('takodeal_device_id'),h.journal().candidateDeviceId);assert.equal(await h.api.resumeReset(),true);assert.equal(h.calls.activate,1);assert.equal(h.journal().phase,'complete');h.intact();
});
test('a fresh page resumes every persisted crash phase from fixed candidate Auth without silently starting setup',async()=>{
 for(const phase of['activation-pending','activated','handoff-pending']){
  const h=fixture({activate(){throw Error('Interrupted');}});assert.equal(await h.reset(),false);const row={...h.journal(),phase};h.storage.setItem(JOURNAL,JSON.stringify(row));
  const adopted=phase==='handoff-pending',reloaded=fixture({rows:new Map(h.rows),candidate:h.candidate,primaryUid:adopted?row.candidateUid:row.primaryUid,active:true});
  assert.equal(reloaded.calls.create,0);assert.equal(reloaded.calls.activate,0);assert.equal(reloaded.api.requiresCode(),phase!=='activation-pending');
  assert.equal(await reloaded.api.resumeReset(),true,phase);assert.equal(reloaded.calls.create,0);assert.equal(reloaded.calls.activate,0);assert.equal(reloaded.journal().operationId,row.operationId);reloaded.intact();
 }
});
test('journal storage failure before activation leaves old identity unchanged and dispatches no code',async()=>{
 let fail=true;const h=fixture({setHook(key){if(fail&&key===JOURNAL){fail=false;throw Error('Quota');}}}),before=h.snapshot();assert.equal(await h.reset(),false);assert.equal(h.calls.activate,0);assert.equal(h.calls.handoff,0);assert.deepEqual(h.snapshot(),before);assert.equal(await h.reset(),true);assert.equal(h.calls.create,2);assert.equal(h.calls.activate,1);h.intact();
});
test('malformed journal holds reset without treating it as permission; file refresh still preserves it',async()=>{
 const h=fixture();h.storage.setItem(JOURNAL,'{"phase":"complete","code":"malformed"}');assert.equal(h.api.requiresCode(),true);const raw=h.storage.getItem(JOURNAL);assert.equal(await h.reset(),false);assert.equal(h.calls.create,0);assert.equal(await h.api.refreshFiles(),true);assert.equal(h.storage.getItem(JOURNAL),raw);h.intact();
});
test('two-tab journal replacement during read prevents old response from adopting or clearing new context',async()=>{
 const gate=deferred(),h=fixture({verify:()=>gate.promise}),pending=h.reset();await flush();const changed={...h.journal(),operationId:'OTHER_OP'};h.storage.setItem(JOURNAL,JSON.stringify(changed));gate.resolve();assert.equal(await pending,false);assert.equal(h.calls.handoff,0);assert.equal(h.journal().operationId,'OTHER_OP');assert.equal(h.primaryUid,'PRIMARY_OLD');h.intact();
});
test('a completed reset can be checked and a later explicit reset uses a fresh candidate, never the old code silently',async()=>{
 const h=fixture();assert.equal(await h.reset(),true);const first=h.journal();assert.equal(await h.api.resumeReset(),true);assert.equal(h.calls.create,1);assert.equal(await h.reset(),true);assert.notEqual(h.journal().operationId,first.operationId);assert.equal(h.calls.activate,2);assert.equal(h.calls.handoff,2);h.intact();
});
test('source remains classic and has no direct Auth, IndexedDB, cache deletion, network, reload or broad storage reset',()=>{
 assert.doesNotMatch(source,/^\s*(?:import|export)\s/m);assert.doesNotMatch(source,/\bsignOut\s*\(|\bindexedDB\s*\.|\bcaches\s*\.|\bfetch\s*\(|location\.reload\s*\(|\.clear\s*\(|\.unregister\s*\(/);
 assert.match(source,/TAKODEAL|Staff/);assert.match(source,/ACCOUNT\.forEach/);
});
