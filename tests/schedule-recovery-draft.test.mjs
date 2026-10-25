import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleRecoveryDraftStore,scheduleRecoveryScope,scheduleDraftSnapshot,scheduleDraftKey,scheduleSnapshotFingerprint,validateScheduleDraft,planScheduleDraftRecovery,SCHEDULE_RECOVERY_DB} from '../takodeal-manager/schedule-recovery-draft.js';
import {createOwnerScheduleSync,installOwnerScheduleSync} from '../takodeal-manager/owner-schedule-sync.js';
import {createScheduleRevision} from '../takodeal-manager/schedule-history.js';
const copy=value=>structuredClone(value),tick=()=>new Promise(resolve=>setImmediate(resolve)),now=()=>new Date('2026-10-25T04:00:00.000Z');
const held=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const initial=()=>({currentYear:2026,currentMonth:10,branchConfig:{Maa:[{id:'m1',name:'Morning',startTime:'09:00',endTime:'17:30',active:true,days:[0,1,2,3,4,5,6]}]},employees:[{staffId:'staff-one',name:'Sample staff',branch:'Maa'}],currentSchedule:{25:{Maa:{scheduled:{m1:'Sample staff'},rest:[],swaps:{}}}},unavailability:{},holidays:{}});
const actor=()=>({uid:'owner-one',email:'owner@example.test',permissions:['schedule'],branches:['Maa']});
async function record(overrides={}){const scope=await scheduleRecoveryScope(actor()),snapshot=initial();return{schemaVersion:1,...scope,month:'2026-10',editorId:'old-editor',key:scheduleDraftKey(scope,'2026-10','old-editor'),savedAt:now().toISOString(),editorSnapshot:snapshot,effectiveFrom:'2026-10-25',base:{revisionId:'base-v1',snapshotFingerprint:scheduleSnapshotFingerprint(snapshot)},pending:null,...overrides};}
function memoryStore(){const rows=new Map();return{rows,write:async value=>{const safe=validateScheduleDraft(value);rows.set(safe.key,copy(safe));return copy(safe);},list:async(scope,month)=>[...rows.values()].filter(row=>row.ownerUid===scope.ownerUid&&row.scopeHash===scope.scopeHash&&row.month===month).map(copy).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)),remove:async key=>{rows.delete(key);}};}
function server(){let revision='base-v1',snapshot=initial(),writes=0;const revisions=[];return{get writes(){return writes;},get revision(){return revision;},async view(){return{month:'2026-10',expectedRevisionId:revision,editorSnapshot:copy(snapshot),hasSavedSchedule:true,archive:{month:'2026-10',revisions:copy(revisions)}};},async save(value,options){const previous=revisions.find(row=>row.revisionId===options.revisionId);if(previous)return{revision:copy(previous),latestRevisionId:revision,alreadySaved:true};assert.equal(options.expectedRevisionId,revision);const row=createScheduleRevision(value,{revisionId:options.revisionId,effectiveFrom:options.effectiveFrom,savedAt:now(),cutover:'2026-10-25'});snapshot=copy(row.snapshot);revision=row.revisionId;revisions.push(row);writes++;return{revision:copy(row),latestRevisionId:revision};},remote(value){snapshot=copy(value);revision='remote-v2';}};}
function editor(db,store,extra={}){let value=initial(),expected,effective='2026-10-25',identity=actor(),count=0;const messages=[];const options={readView:db.view,applyView:view=>{value=copy(view.editorSnapshot);},applyRecoveredSnapshot:snapshot=>{value=copy(snapshot);},getSnapshot:()=>value,getMonth:()=>`${value.currentYear}-${String(value.currentMonth).padStart(2,'0')}`,getIdentity:()=>identity,getExpectedRevision:()=>expected,setExpectedRevision:id=>{expected=id;},getEffectiveFrom:()=>effective,setEffectiveFrom:day=>{effective=day;},saveSnapshot:db.save,makeId:()=>String(++count),editorId:'new-editor',draftStore:store,onStatus:(text,error)=>messages.push({text,error}),now,...extra};const controller=createOwnerScheduleSync(options);return{controller,options,messages,get value(){return value;},set value(next){value=next;},get expected(){return expected;},set effective(next){effective=next;},set identity(next){identity=next;}};}

test('draft schema preserves exact schedule values but refuses authentication fields and unknown envelope keys',async()=>{
 const draft=await record();draft.editorSnapshot.branchConfig.Maa[0].name='  Edited label  ';draft.editorSnapshot.branchConfig.Maa[0].endTime='';assert.equal(validateScheduleDraft(draft).editorSnapshot.branchConfig.Maa[0].name,'  Edited label  ');assert.equal(validateScheduleDraft(draft).editorSnapshot.branchConfig.Maa[0].endTime,'');
 for(const field of ['pin','loginPin','password','idToken','auth']){const bad=copy(draft);bad.editorSnapshot.employees[0][field]='PRIVATE';assert.throws(()=>validateScheduleDraft(bad),/Private login/);}
 assert.throws(()=>validateScheduleDraft({...draft,authorization:'PRIVATE'}),/needs review/);assert.throws(()=>validateScheduleDraft({...draft,month:'2026-11'}),/review|different month/);
});
test('draft keys and scope hashes separate accounts, permission scopes and months without storing identity tokens',async()=>{
 const one=await scheduleRecoveryScope({...actor(),idToken:'DO-NOT-STORE'}),same=await scheduleRecoveryScope(actor()),other=await scheduleRecoveryScope({...actor(),uid:'owner-two'}),scope=await scheduleRecoveryScope({...actor(),branches:['Citygate']});assert.deepEqual(one,same);assert.notEqual(one.scopeHash,other.scopeHash);assert.notEqual(one.scopeHash,scope.scopeHash);assert.equal(JSON.stringify(one).includes('DO-NOT-STORE'),false);assert.notEqual(scheduleDraftKey(one,'2026-10','editor'),scheduleDraftKey(one,'2026-11','editor'));
});
test('recovery permits only a matching fresh baseline and keeps expired or changed drafts for manual review',async()=>{
 const draft=await record(),view=await server().view();assert.equal(planScheduleDraftRecovery(draft,view,{now:now()}).kind,'restore');assert.equal(planScheduleDraftRecovery(draft,{...view,expectedRevisionId:'remote-v2'},{now:now()}).kind,'conflict');const changed=copy(view);changed.editorSnapshot.branchConfig.Maa[0].endTime='18:00';assert.equal(planScheduleDraftRecovery(draft,changed,{now:now()}).kind,'conflict');assert.equal(planScheduleDraftRecovery({...draft,savedAt:'2026-08-01T00:00:00.000Z'},view,{now:now()}).kind,'conflict');assert.equal(planScheduleDraftRecovery({...draft,savedAt:'2026-11-01T00:00:00.000Z'},view,{now:now()}).kind,'conflict');
});
test('already committed proof compares the original operation and normalizes only its saved recipe of schedule fields',async()=>{
 const draft=await record();delete draft.editorSnapshot.branchConfig.Maa[0].startTime;draft.editorSnapshot.branchConfig.Maa[0].name='Morning (9am-5:30pm)';const pending={revisionId:'owner-schedule-proof',expectedRevisionId:'base-v1',effectiveFrom:'2026-10-25',snapshot:copy(draft.editorSnapshot)};draft.pending=pending;const saved=createScheduleRevision(pending.snapshot,{revisionId:pending.revisionId,effectiveFrom:pending.effectiveFrom,savedAt:now(),cutover:'2026-10-25'}),view={month:'2026-10',expectedRevisionId:pending.revisionId,editorSnapshot:copy(saved.snapshot),archive:{revisions:[saved]}};assert.equal(planScheduleDraftRecovery(draft,view,{now:now()}).kind,'committed');const bad=copy(view);bad.archive.revisions[0].snapshot.branchConfig.Maa[0].endTime='19:00';assert.equal(planScheduleDraftRecovery(draft,bad,{now:now()}).kind,'conflict');
});

test('a next-day recovery recognizes committed proof but keeps an unconfirmed past-effective operation for review',async()=>{
 const draft=await record(),pending={revisionId:'owner-schedule-next-day',expectedRevisionId:'base-v1',effectiveFrom:'2026-10-25',snapshot:copy(initial())};draft.pending=pending;
 const nextDay=new Date('2026-10-25T17:00:00.000Z');assert.equal(planScheduleDraftRecovery(draft,await server().view(),{now:nextDay}).kind,'conflict');
 const saved=createScheduleRevision(pending.snapshot,{revisionId:pending.revisionId,effectiveFrom:pending.effectiveFrom,savedAt:now(),cutover:'2026-10-25'});
 assert.equal(planScheduleDraftRecovery(draft,{month:'2026-10',expectedRevisionId:pending.revisionId,editorSnapshot:copy(saved.snapshot),archive:{revisions:[saved]}},{now:nextDay}).kind,'committed');
});
test('cloud write waits for acknowledged local backup and a failed backup never starts it',async()=>{
 const db=server(),store=memoryStore(),gate=held(),entered=held(),original=store.write;store.write=async row=>{entered.resolve();await gate.promise;return original(row);};const h=editor(db,store);await h.controller.load();h.value.branchConfig.Maa[0].endTime='18:00';const saving=h.controller.save();await entered.promise;assert.equal(db.writes,0);gate.resolve();assert.equal(await saving,true);assert.equal(db.writes,1);
 const blocked=editor(server(),{...memoryStore(),write:async()=>{throw Error('Disk full');}});await blocked.controller.load();blocked.value.branchConfig.Maa[0].endTime='18:30';assert.equal(await blocked.controller.save(),false);assert.equal(blocked.controller.recoveryState().preserved,false);assert.match(blocked.messages.at(-1).text,/backup.*not confirmed/);
});
test('reload recovery restores exact edits and frozen retry ID without automatically saving',async()=>{
 const db=server(),store=memoryStore(),attempts=[];const first=editor(db,store,{editorId:'old-editor',saveSnapshot:async(value,options)=>{attempts.push(copy(options));throw Error('Network unavailable');}});await first.controller.load();first.value.branchConfig.Maa[0].endTime='18:40';first.value.branchConfig.Maa[0].days=[1,3,5];assert.equal(await first.controller.save(),false);assert.equal(store.rows.size,1);const saved=[...store.rows.values()][0];const next=editor(db,store,{saveSnapshot:async(value,options)=>{attempts.push(copy(options));return db.save(value,options);}});await next.controller.load();await next.controller.checkRecovery();assert.equal(next.controller.recoveryState().candidates.length,1);assert.equal(await next.controller.recoverDraft(),true);assert.equal(db.writes,0);assert.equal(next.value.branchConfig.Maa[0].endTime,'18:40');assert.deepEqual(next.value.branchConfig.Maa[0].days,[1,3,5]);assert.equal(await next.controller.save(),true);assert.equal(attempts[1].revisionId,saved.pending.revisionId);assert.equal(attempts[1].expectedRevisionId,saved.pending.expectedRevisionId);assert.equal(db.writes,1);
});
test('lost acknowledgement recovery recognizes the committed ID and never creates another revision on restore',async()=>{
 const db=server(),store=memoryStore(),first=editor(db,store,{editorId:'old-editor',saveSnapshot:async(value,options)=>{await db.save(value,options);throw Error('Acknowledgement lost');}});await first.controller.load();first.value.branchConfig.Maa[0].endTime='18:40';assert.equal(await first.controller.save(),false);assert.equal(db.writes,1);const next=editor(db,store);await next.controller.load();await next.controller.checkRecovery();assert.equal(next.controller.recoveryState().plan.kind,'committed');assert.equal(await next.controller.recoverDraft(),true);assert.equal(db.writes,1);assert.equal(next.controller.isDirty(),false);assert.equal(next.expected,db.revision);
});
test('remote changes or another account scope never restore an unreviewed draft over HQ',async()=>{
 const db=server(),store=memoryStore(),first=editor(db,store,{editorId:'old-editor',saveSnapshot:async()=>{throw Error('offline');}});await first.controller.load();first.value.branchConfig.Maa[0].endTime='18:40';await first.controller.save();const remote=initial();remote.branchConfig.Maa[0].endTime='19:00';db.remote(remote);const next=editor(db,store);await next.controller.load();await next.controller.checkRecovery();assert.equal(await next.controller.recoverDraft(),false);assert.equal(next.value.branchConfig.Maa[0].endTime,'19:00');assert.equal(db.writes,0);assert.match(await next.controller.exportDraft(next.controller.recoveryState().candidates[0].key),/18:40/);const other=editor(db,store,{getIdentity:()=>({...actor(),branches:['Citygate']})});await other.controller.load();await other.controller.checkRecovery();assert.equal(other.controller.recoveryState().candidates.length,0);
});
test('save UI deadline keeps the physical operation deduped and accepts a late success once',async()=>{
 const db=server(),store=memoryStore(),gate=held(),entered=held();let attempts=0;const h=editor(db,store,{saveTimeoutMs:10,saveSnapshot:async(value,options)=>{attempts++;entered.resolve();await gate.promise;return db.save(value,options);}});await h.controller.load();h.value.branchConfig.Maa[0].endTime='18:40';const pending=h.controller.save();await entered.promise;assert.equal(await pending,false);assert.equal(h.controller.isSaving(),true);assert.equal(await h.controller.save(),false);h.value.branchConfig.Maa[0].endTime='19:00';assert.equal(await h.controller.save(),false);assert.equal(attempts,1);gate.resolve();for(let n=0;n<10&&h.controller.isSaving();n++)await tick();assert.equal(db.writes,1);assert.equal(h.expected,db.revision);assert.equal(h.controller.isDirty(),true);assert.match(h.messages.at(-1).text,/Additional unsaved/);
});
test('fatal SDK event releases UI wait, preserves pending and newer edits, and starts no second physical save',async()=>{
 const db=server(),store=memoryStore(),gate=held(),entered=held();let failed=false,attempts=0;const h=editor(db,store,{saveTimeoutMs:60000,health:{isFailed:()=>failed,assertReady(){if(failed)throw Error('SDK stopped');}},saveSnapshot:async()=>{attempts++;entered.resolve();await gate.promise;throw Error('FIRESTORE INTERNAL ASSERTION FAILED Unexpected state');}});await h.controller.load();h.value.branchConfig.Maa[0].endTime='18:40';const saving=h.controller.save();await entered.promise;h.value.branchConfig.Maa[0].endTime='19:10';failed=true;await h.controller.cloudFailed();assert.equal(await saving,false);const draft=[...store.rows.values()][0];assert.equal(draft.pending.snapshot.branchConfig.Maa[0].endTime,'18:40');assert.equal(draft.editorSnapshot.branchConfig.Maa[0].endTime,'19:10');assert.equal(h.controller.recoveryState().preserved,true);assert.equal(await h.controller.save(),false);assert.equal(attempts,1);gate.resolve();await tick();
});

test('a backup failure before any cloud call does not freeze an unsent older edit for the next save',async()=>{
 const db=server(),store=memoryStore(),write=store.write;let unavailable=true;
 store.write=async row=>{if(unavailable)throw Error('Disk full');return write(row);};
 const h=editor(db,store);await h.controller.load();h.value.branchConfig.Maa[0].endTime='18:40';
 assert.equal(await h.controller.save(),false);assert.equal(db.writes,0);
 unavailable=false;h.value.branchConfig.Maa[0].endTime='19:00';assert.equal(await h.controller.save(),true);
 assert.equal((await db.view()).editorSnapshot.branchConfig.Maa[0].endTime,'19:00');assert.equal(db.writes,1);
});

test('account or scope changes during backup cannot start a cloud save or expose an earlier account draft',async()=>{
 const db=server(),store=memoryStore(),gate=held(),entered=held(),write=store.write;
 store.write=async row=>{entered.resolve();await gate.promise;return write(row);};
 const h=editor(db,store);await h.controller.load();h.value.branchConfig.Maa[0].endTime='18:40';const saving=h.controller.save();
 await entered.promise;h.identity={...actor(),branches:['Citygate']};gate.resolve();assert.equal(await saving,false);assert.equal(db.writes,0);assert.equal(h.controller.recoveryState().preserved,false);
 await assert.rejects(h.controller.exportDraft(),/signed-in Owner/);assert.equal(await h.controller.recoverDraft(),false);
 const saved=[...store.rows.values()][0];assert.equal(saved.scopeHash,(await scheduleRecoveryScope(actor())).scopeHash);
});

function recoveryDom(){
 const nodes=new Map(),events=new Map();
 class Element{constructor(){this.style={};this.value='';this.children=[];this.events={};this.classList={contains:()=>true,toggle(){}};}setAttribute(){}append(...children){this.children.push(...children);for(const child of children)if(child.id)nodes.set(child.id,child);}replaceChildren(...children){this.children=children;}addEventListener(name,handler){this.events[name]=handler;}}
 for(const id of ['scheduleMemoryPanel','view-schedule']){const node=new Element();node.id=id;nodes.set(id,node);}
 return{nodes,events,document:{hidden:false,getElementById:id=>nodes.get(id)||null,createElement:()=>new Element(),addEventListener(){}},window:{addEventListener:(name,handler)=>events.set(name,handler),ManagerUI:{confirm:async()=>false},Swal:{isVisible:()=>false}}};
}

test('reload control commits the latest visible edit again and never reloads after backup failure',{timeout:10000},async()=>{
 const db=server(),store=memoryStore(),dom=recoveryDom(),preserved=held();let value=initial(),visibleEnd='17:30',expected,failed=false,reloads=0,unavailable=false;const write=store.write;
 store.write=async row=>{if(unavailable)throw Error('Disk full');return write(row);};
 dom.window.managerCloudHealth={isFailed:()=>failed,assertReady(){if(failed)throw Error('Connection stopped');}};dom.window.location={reload(){reloads++;}};
 const controller=installOwnerScheduleSync(dom.window,dom.document,{draftStore:store,now,editorId:'reload-editor',getIdentity:actor,getMonth:()=> '2026-10',getSnapshot:()=>value,captureEditor:()=>{value.branchConfig.Maa[0].endTime=visibleEnd;return value;},getExpectedRevision:()=>expected,setExpectedRevision:id=>{expected=id;},getEffectiveFrom:()=> '2026-10-25',readView:db.view,applyView:view=>{value=copy(view.editorSnapshot);},saveSnapshot:db.save,onRecovery:state=>{if(failed&&state.preserved)preserved.resolve();}});
 await controller.load();visibleEnd='18:40';failed=true;dom.events.get('managercloudfailure')();await preserved.promise;
 const reload=dom.nodes.get('ownerScheduleReloadApp');assert.equal(reload.disabled,false);
 visibleEnd='19:10';await reload.events.click();assert.equal(reloads,1);assert.equal([...store.rows.values()][0].editorSnapshot.branchConfig.Maa[0].endTime,'19:10');
 unavailable=true;visibleEnd='19:20';await reload.events.click();assert.equal(reloads,1);assert.equal(controller.recoveryState().preserved,false);assert.equal(reload.disabled,true);
});

function fakeIDB(){const writes=[],reads=[],transactions=[];const db={createObjectStore(){return{createIndex(){}};},close(){},transaction(){const tx={error:null,abort(){tx.onabort?.();},objectStore(){return{put(value){const request={result:undefined};writes.push({value:copy(value),request,tx});return request;},delete(){const request={result:undefined};writes.push({request,tx});return request;},index(){return{getAll(query){const request={result:[]};reads.push({query,request,tx});return request;}};}};}};transactions.push(tx);return tx;}};return {writes,reads,transactions,open(){const request={result:db};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};}
test('dedicated IndexedDB store does not acknowledge success on request success, only transaction completion',async()=>{
 const indexedDB=fakeIDB(),store=createScheduleRecoveryDraftStore(indexedDB),draft=await record();let done=false;const writing=store.write(draft).then(()=>{done=true;});await tick();assert.equal(indexedDB.writes.length,1);const saved=indexedDB.writes[0];saved.request.onsuccess();await tick();assert.equal(done,false);saved.tx.oncomplete();await writing;assert.equal(done,true);assert.notEqual(SCHEDULE_RECOVERY_DB,'firebaseLocalStorageDb');assert.match(SCHEDULE_RECOVERY_DB,/schedule-recovery/);
});
test('IndexedDB abort rejects a backup and missing storage cannot claim durability',async()=>{
 const indexedDB=fakeIDB(),store=createScheduleRecoveryDraftStore(indexedDB),draft=await record(),writing=store.write(draft);await tick();indexedDB.writes[0].tx.error=Error('Quota exceeded');indexedDB.writes[0].tx.onabort();await assert.rejects(writing,/Quota/);await assert.rejects(createScheduleRecoveryDraftStore(null).write(draft),/unavailable/);
});

test('a synchronous IndexedDB open failure can be retried after local storage becomes available',async()=>{
 const db=fakeIDB(),draft=await record();let attempts=0;
 const store=createScheduleRecoveryDraftStore({...db,open(...args){if(++attempts===1)throw Error('Storage disabled');return db.open(...args);}});
 await assert.rejects(store.write(draft),/Storage disabled/);const retry=store.write(draft);await tick();assert.equal(attempts,2);db.writes[0].tx.oncomplete();await retry;
});
