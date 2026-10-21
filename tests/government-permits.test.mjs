import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {normalizePermitDraft,permitExpiry,permitDay,filterPermits,permitSummary} from '../takodeal-manager/government-permits-model.js';
import {createGovernmentPermitService} from '../takodeal-manager/government-permits-service.js';
import {prepareOwnerRecordFile} from '../takodeal-manager/owner-record-files.js';
import {permitCardMarkup,permitHistoryMarkup,governmentPermitsMarkup} from '../takodeal-manager/government-permits.js';
const id='10000000-0000-4000-8000-000000000001',op='20000000-0000-4000-8000-000000000001',next='30000000-0000-4000-8000-000000000001';
const draft={branch:'Sample Branch',permitType:'Operating permit',permitName:'Sample business permit',agency:'Sample agency',permitNumber:'SAMPLE-001',issueDate:'2030-01-01',expiryDate:'2030-12-31',renewalStatus:'Not started',notes:'Synthetic permit only.',archived:false,attachment:null};
function fixture(){
 const h=firestoreHarness(),api={...h.api,crypto:webcrypto},queries=[];api.auth={currentUser:{uid:'sample-owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}};api.sessionUser={uid:'sample-owner',email:OWNER_EMAIL,role:'Owner',permissions:['all'],allowedBranches:['All']};
 api.doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1)});api.collection=(_, ...parts)=>({table:parts.join('/')});api.orderBy=(field,direction)=>({kind:'order',field,direction});api.limit=count=>({kind:'limit',count});api.startAfter=cursor=>({kind:'after',cursor});api.query=(ref,...constraints)=>({...ref,constraints});
 api.getDocFromServer=async ref=>{const data=structuredClone(h.get(ref.path));return {ref,id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>data!==undefined,data:()=>structuredClone(data)};};
 api.getDocsFromServer=async reference=>{queries.push(reference);let entries=[...h.docs].filter(([path])=>path.startsWith(reference.table+'/')&&!path.slice(reference.table.length+1).includes('/'));for(const order of reference.constraints||[])if(order.kind==='order')entries.sort((a,b)=>{const one=a[1][order.field]?.seconds??a[1][order.field]??0,two=b[1][order.field]?.seconds??b[1][order.field]??0;return (one<two?-1:one>two?1:0)*(order.direction==='desc'?-1:1)||a[0].localeCompare(b[0]);});const after=reference.constraints?.find(item=>item.kind==='after');if(after)entries=entries.slice(entries.findIndex(([path])=>path.split('/').at(-1)===after.cursor.id)+1);const limit=reference.constraints?.find(item=>item.kind==='limit');if(limit)entries=entries.slice(0,limit.count);const docs=await Promise.all(entries.map(([path])=>api.getDocFromServer({path,id:path.split('/').at(-1)})));return {docs,metadata:{fromCache:false,hasPendingWrites:false}};};
 h.put('branches/sample',{name:'Sample Branch',active:true});return {h,api,queries,service:createGovernmentPermitService(api),save:extra=>createGovernmentPermitService(api).save({id,operationId:op,expectedRevision:0,draft,...extra})};
}

test('expiry is calculated from explicit dates and a chosen PH reminder window without guessed legal deadlines',()=>{
 assert.equal(permitDay(new Date('2030-01-01T16:01:00Z')),'2030-01-02');assert.equal(permitExpiry({expiryDate:'2030-01-01'},{today:'2030-01-02',days:30}).key,'Expired');assert.equal(permitExpiry({expiryDate:'2030-01-02'},{today:'2030-01-02',days:0}).label,'Expires today');assert.equal(permitExpiry({expiryDate:'2030-02-01'},{today:'2030-01-02',days:30}).key,'Due soon');assert.equal(permitExpiry({expiryDate:'2030-02-01'},{today:'2030-01-02',days:29}).key,'Current');assert.equal(permitExpiry({expiryDate:''},{today:'2030-01-02'}).key,'No expiry');assert.equal(permitExpiry({expiryDate:'2030-02-30'},{today:'2030-01-02'}).key,'Review');assert.equal(permitExpiry({...draft,archived:true},{today:'2031-01-02'}).key,'Archived');
 assert.throws(()=>normalizePermitDraft({...draft,expiryDate:'2029-12-01'}),/before/);assert.throws(()=>normalizePermitDraft({...draft,issueDate:'2030-02-30'}),/valid issue/);assert.equal(normalizePermitDraft({...draft,issueDate:'',expiryDate:''}).expiryDate,'');
});

test('search and expiry filters keep branch scope and archived records separate',()=>{
 const rows=[{...draft,id:'one',expiryDate:'2030-01-01'},{...draft,id:'two',permitNumber:'OTHER',branch:'Other Branch',expiryDate:'2030-02-01'},{...draft,id:'three',expiryDate:'',archived:true}];const options={today:'2030-01-02',days:30};assert.deepEqual(filterPermits(rows,{...options,branch:'Sample Branch',status:'Expired',search:'sample agency'}).map(row=>row.id),['one']);assert.deepEqual(filterPermits(rows,{...options,status:'Archived'}).map(row=>row.id),['three']);assert.equal(filterPermits(rows,{...options,status:'Active'}).length,2);assert.deepEqual(permitSummary(rows,options),{active:2,dueSoon:1,expired:1,noExpiry:0,archived:1});
});

test('create, lost acknowledgement, update and archive retain immutable revisions and all source fields',async()=>{
 const f=fixture();f.h.loseNextAck();await assert.rejects(f.save(),/lost after commit/);assert.equal((await f.save()).repeated,true);assert.equal(f.h.get('government_permits/'+id).revision,1);assert.equal([...f.h.docs.keys()].filter(path=>path.includes('/changes/')).length,1);
 await f.service.save({id,operationId:next,expectedRevision:1,draft:{...draft,renewalStatus:'Submitted'},reason:'Renewal lodged'});const first=f.h.get('government_permits/'+id+'/changes/'+op),second=f.h.get('government_permits/'+id+'/changes/'+next);assert.equal(first.after.renewalStatus,'Not started');assert.equal(second.before.renewalStatus,'Not started');assert.equal(second.after.renewalStatus,'Submitted');assert.deepEqual(first.after,draft);assert.equal(first.before,null);
 await assert.rejects(f.service.save({id,operationId:'40000000-0000-4000-8000-000000000001',expectedRevision:2,draft:{...second.after,archived:true},reason:''}),/short reason/);assert.equal(f.h.get('government_permits/'+id).archived,false);
 await f.service.save({id,operationId:'40000000-0000-4000-8000-000000000001',expectedRevision:2,draft:{...second.after,archived:true},reason:'No longer active'});assert.equal(f.h.get('government_permits/'+id).archived,true);assert.equal(first.after.archived,false);assert.equal((await f.service.history(id)).rows.length,3);
});

test('concurrent edits and stale revisions fail without overwriting another device or moving to an unknown branch',async()=>{
 const f=fixture(),outcomes=await Promise.allSettled([f.save(),f.save({operationId:next,draft:{...draft,permitName:'Other saved name'}})]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected').length,1);assert.equal(f.h.get('government_permits/'+id).revision,1);assert.equal([...f.h.docs.keys()].filter(path=>path.includes('/changes/')).length,1);
 const g=fixture();await assert.rejects(g.save({draft:{...draft,branch:'Unknown Branch'}}),/existing branch/);assert.equal(g.h.get('government_permits/'+id),undefined);
});

test('permit and private attachment commit together, with history descriptors only; rejected writes leave no orphan upload',async()=>{
 const f=fixture(),bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic permit proof'),prepared=await prepareOwnerRecordFile(f.api,{file:{name:'Sample.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer},kind:'government_permit',recordId:id,fileId:'50000000-0000-4000-8000-000000000001',operationId:op});f.h.failNextCommit();await assert.rejects(f.save({preparedFile:prepared}),/Commit rejected/);assert.deepEqual([...f.h.docs.keys()],['branches/sample']);
 await f.save({preparedFile:prepared});const saved=f.h.get('government_permits/'+id),history=f.h.get('government_permits/'+id+'/changes/'+op);assert.deepEqual(saved.attachment,prepared.descriptor);assert.deepEqual(history.after.attachment,prepared.descriptor);assert.doesNotMatch(JSON.stringify(history),/JVBER|data:|Synthetic permit proof/);assert.ok(f.h.get('owner_record_files/'+prepared.descriptor.id+'/chunks/0000'));
});

test('read failures, unverified identity and an account switch cannot produce false empty lists or write records',async()=>{
 const f=fixture();f.api.getDocsFromServer=async()=>({docs:[],metadata:{fromCache:true}});await assert.rejects(f.service.list(),/could not be confirmed/);f.api.auth.currentUser.emailVerified=false;await assert.rejects(f.save(),/Owner/);assert.equal(f.h.get('government_permits/'+id),undefined);
 const g=fixture();let release;const gate=new Promise(resolve=>release=resolve),read=g.api.getDocsFromServer;g.api.getDocsFromServer=async ref=>{await gate;return read(ref);};const pending=g.service.list();g.api.sessionUser={...g.api.sessionUser,allowedBranches:[]};release();await assert.rejects(pending,/account changed/);assert.equal(g.h.docs.size,1);
});

test('permit lists and history are explicitly paged instead of returning a falsely complete capped result',async()=>{
 const f=fixture();for(let index=0;index<205;index++){const key='sample-'+String(index).padStart(3,'0');f.h.put('government_permits/'+key,{...draft,recordId:key,updatedAt:{seconds:index}});}const first=await f.service.list();assert.equal(first.rows.length,200);assert.equal(first.partial,true);assert.ok(first.cursor);const second=await f.service.list({cursor:first.cursor});assert.equal(second.rows.length,5);assert.equal(second.partial,false);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,205);assert.ok(f.queries.every(query=>!query.table.startsWith('owner_record_files')));
 for(let index=1;index<=52;index++)f.h.put('government_permits/'+id+'/changes/change-'+index,{revision:index,action:'Updated',after:draft});const history=await f.service.history(id);assert.equal(history.rows.length,50);assert.equal(history.partial,true);assert.equal(history.rows[0].revision,52);const older=await f.service.history(id,{cursor:history.cursor});assert.equal(older.rows.length,2);assert.equal(older.partial,false);assert.equal(older.rows.at(-1).revision,1);
});

test('public permit and change markup escapes every saved field and keeps supporting documents behind explicit download controls',()=>{
 const unsafe='<img src=x onerror=alert(1)>',row={...draft,id,permitName:unsafe,agency:unsafe,permitNumber:unsafe,notes:'</textarea>'+unsafe,attachment:{fileName:unsafe,id:op}};for(const html of [permitCardMarkup(row,{today:'2030-01-01',days:30}),permitHistoryMarkup({action:'Updated',revision:1,before:null,after:row,reason:unsafe,recordedByEmail:unsafe}),governmentPermitsMarkup()]){assert.doesNotMatch(html,/<img|<script|onclick=|<iframe|firebaseStorageDownloadTokens/);assert.doesNotMatch(html,/<[a-z][^>]*\sonerror\s*=/i);}assert.match(permitCardMarkup(row,{today:'2030-01-01'}),/&lt;img/);
});

test('actual archive confirmation cannot silently restore a permit archived by another device while the prompt was open',async()=>{
 const source=readFileSync(new URL('../takodeal-manager/government-permits.js',import.meta.url),'utf8'),start=source.indexOf(' async function action(action,id)'),end=source.indexOf("\n el('permitsRefresh')",start);assert.ok(start>0&&end>start);let writes=0;
 const context=vm.createContext({context:()=>()=>{},rows:[{...draft,id,archived:false}],w:{Swal:{fire:async()=>({isConfirmed:true,value:'Sample archive reason'})}},service:{get:async()=>({...draft,id,archived:true,revision:2}),save:async()=>writes++},permitSnapshot:row=>row});vm.runInContext(source.slice(start,end)+'\nglobalThis.actualAction=action;',context);await assert.rejects(context.actualAction('archive',id),/status changed/);assert.equal(writes,0);
});

test('actual lifecycle preserves unsaved permit fields and pending-save guards across browser tab switches, while route/account changes invalidate them',()=>{
 const source=readFileSync(new URL('../takodeal-manager/government-permits.js',import.meta.url),'utf8');
 const extract=start=>{const index=source.indexOf(start);assert.ok(index>0);return source.slice(index,source.indexOf('\n',index));};
 let actor='sample-owner',active=true,releases=0,loads=0,removed=0;const form={entries:{permitName:'Unsaved sample permit',permitNumber:'DRAFT-001'},remove(){removed++;}},history={remove(){removed++;}};
 const nodes={permitsRecords:{innerHTML:''},permitsSummary:{innerHTML:''}};
 const context=vm.createContext({w:{},d:{hidden:false},root:{classList:{contains:()=>active}},el:id=>nodes[id],ownerRecordActor:()=>({key:actor}),revokeOwnerRecordFileUrls:()=>releases++,load:()=>loads++,status:()=>{},form,history});
 vm.runInContext("let epoch=0,detailEpoch=0,loading=true,rows=[],branches=[],cursor=null,loaded=true,identity='sample-owner',dialog=form,historyDialog=null,stopped=false;\nconst visible="+source.match(/visible=(\(\)=>root\.classList\.contains\('active'\)[^;]*);let epoch/)[1]+';\n'+extract(' function context(')+'\n'+extract(' function closeDetails(')+'\n'+extract(' function clear(')+'\n'+extract(' function lifecycle(')+'\nglobalThis.guard=context();globalThis.run=lifecycle;',context);
 context.d.hidden=true;context.run();assert.equal(removed,0);assert.equal(loads,0);assert.equal(releases,1);assert.equal(form.entries.permitName,'Unsaved sample permit');assert.doesNotThrow(context.guard);
 context.d.hidden=false;context.run();assert.equal(removed,0);assert.equal(loads,0);assert.doesNotThrow(context.guard);
 vm.runInContext('dialog=null;historyDialog=history;',context);context.run();assert.equal(loads,0);assert.equal(removed,0);
 vm.runInContext('historyDialog=null;',context);context.run();assert.equal(loads,1);
 vm.runInContext('dialog=form;',context);active=false;context.run();assert.equal(removed,1);assert.throws(context.guard,/page or Owner account changed/);
 active=true;actor='other-owner';vm.runInContext('dialog=form;',context);context.run();assert.equal(removed,2);assert.throws(context.guard,/page or Owner account changed/);
});
