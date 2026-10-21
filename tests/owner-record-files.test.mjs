import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {OWNER_FILE_LIMITS,prepareOwnerRecordFile,ownerRecordFileDescriptor,checkOwnerRecordFile,appendOwnerRecordFileWrites,readOwnerRecordFile,downloadOwnerRecordFile,revokeOwnerRecordFileUrls} from '../takodeal-manager/owner-record-files.js';
const id='10000000-0000-4000-8000-000000000001',operationId='20000000-0000-4000-8000-000000000001',recordId='sample-record';
function fixture(){const h=firestoreHarness(),api={...h.api,crypto:webcrypto};api.auth={currentUser:{uid:'sample-owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}};api.sessionUser={uid:'sample-owner',email:OWNER_EMAIL,isOwner:true,role:'Owner',permissions:['all'],allowedBranches:['All']};api.doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1)});const gets=[];api.getDocFromServer=async ref=>{gets.push(ref.path);const value=structuredClone(h.get(ref.path));return {ref,id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>value!==undefined,data:()=>structuredClone(value)};};api.getDocsFromServer=()=>{throw Error('Private documents must never list binary bodies.');};return {h,api,gets};}
function pdf(size=100){const bytes=new Uint8Array(size).fill(32);bytes.set(new TextEncoder().encode('%PDF-1.7\nSynthetic sample\n'));return {bytes,file:{name:'Sample supporting document.pdf',type:'application/pdf',size,arrayBuffer:async()=>bytes.slice().buffer}};}
const prepare=(f,file=pdf().file,extra={})=>prepareOwnerRecordFile(f.api,{file,kind:'government_permit',recordId,fileId:id,operationId,...extra});
async function save(f,prepared){return f.api.runTransaction(f.api.db,async tx=>{const state=await checkOwnerRecordFile(f.api,tx,prepared);tx.set(f.api.doc(f.api.db,'sample_records',recordId),{attachment:ownerRecordFileDescriptor(prepared)});appendOwnerRecordFileWrites(f.api,tx,prepared,state);});}
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('private document and chunks are atomic, immutable on retry, and absent from serialized history descriptors',async()=>{
 const f=fixture(),sample=pdf(200000),prepared=await prepare(f,sample.file);assert.deepEqual(Object.keys(prepared),['descriptor']);assert.equal(prepared.descriptor.chunkCount,2);assert.doesNotMatch(JSON.stringify(prepared),/JVBER|Synthetic sample|data:/);
 f.h.failNextCommit();await assert.rejects(save(f,prepared),/Commit rejected/);assert.equal(f.h.docs.size,0);
 f.h.loseNextAck();await assert.rejects(save(f,prepared),/lost after commit/);const manifest=structuredClone(f.h.get('owner_record_files/'+id));await save(f,prepared);assert.deepEqual(f.h.get('owner_record_files/'+id),manifest);assert.equal(f.h.docs.size,4);
 const blob=await readOwnerRecordFile(f.api,prepared.descriptor);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),sample.bytes);assert.equal(blob.type,'application/pdf');assert.equal(f.gets.length,3);
});

test('maximal permitted file stays within 15 immutable chunks of 192 KiB base64; oversized or disguised files never save',async()=>{
 const f=fixture(),prepared=await prepare(f,pdf(OWNER_FILE_LIMITS.bytes).file);await save(f,prepared);assert.equal(prepared.descriptor.chunkCount,15);
 for(const [path,row]of f.h.docs)if(path.includes('/chunks/')){assert.ok(row.data.length<=196608);assert.ok(row.size<=147456);}
 let read=0;await assert.rejects(prepare(f,{name:'Too large.pdf',size:OWNER_FILE_LIMITS.bytes+1,type:'application/pdf',arrayBuffer:()=>{read++;}}),/2 MiB/);assert.equal(read,0);
 await assert.rejects(prepare(f,{...pdf().file,type:'image/png'}),/contents do not match/);
 const html=new TextEncoder().encode('<html>not a pdf</html>');await assert.rejects(prepare(f,{name:'Unsafe.html',size:html.length,type:'application/pdf',arrayBuffer:async()=>html.buffer}),/PDF, JPEG or PNG/);
});

test('fresh reads detect corrupted chunks, changed record binding and cached responses before producing a file',async()=>{
 const f=fixture(),prepared=await prepare(f);await save(f,prepared);const chunk='owner_record_files/'+id+'/chunks/0000';f.h.put(chunk,{...f.h.get(chunk),data:btoa('%PDF-corrupted')});await assert.rejects(readOwnerRecordFile(f.api,prepared.descriptor),/integrity/);
 const g=fixture(),other=await prepare(g);await save(g,other);g.h.put('owner_record_files/'+id,{...g.h.get('owner_record_files/'+id),recordId:'other-record'});await assert.rejects(readOwnerRecordFile(g.api,other.descriptor),/does not match/);
 g.api.getDocFromServer=async()=>({metadata:{fromCache:true},exists:()=>true});await assert.rejects(readOwnerRecordFile(g.api,other.descriptor),/unavailable/);
 await assert.rejects(readOwnerRecordFile(g.api,{...other.descriptor,url:'https://example.test/public.pdf'}),/reference is invalid/);
});

test('only the matching verified Google Owner can prepare or fetch private documents; late account changes stop preparation',async()=>{
 for(const mutate of [api=>api.auth.currentUser.email='manager@example.test',api=>api.auth.currentUser.emailVerified=false,api=>api.sessionUser.uid='other',api=>api.sessionUser.isFranchisee=true,api=>api.auth.currentUser.providerData=[]]){const f=fixture();mutate(f.api);await assert.rejects(prepare(f),/Owner/);assert.equal(f.h.docs.size,0);assert.equal(f.gets.length,0);}
 const f=fixture(),gate=defer(),pending=prepare(f,{...pdf().file,arrayBuffer:()=>gate.promise});f.api.sessionUser={...f.api.sessionUser,permissions:[]};gate.resolve(pdf().bytes.buffer);await assert.rejects(pending,/account changed/);assert.equal(f.h.docs.size,0);
});

test('a file must be checked in the same transaction and cannot overwrite another operation or record',async()=>{
 const f=fixture(),prepared=await prepare(f);await assert.rejects(f.api.runTransaction(f.api.db,async tx=>appendOwnerRecordFileWrites(f.api,tx,prepared,{exists:false})),/Confirm/);assert.equal(f.h.docs.size,0);
 await save(f,prepared);const changed=await prepare(f,pdf().file,{operationId:'30000000-0000-4000-8000-000000000001'});await assert.rejects(save(f,changed),/already used/);assert.equal(f.h.docs.size,3);
});

test('an unsettled document read is coalesced across bounded retries and cannot trigger a late download',async()=>{
 const f=fixture(),prepared=await prepare(f);await save(f,prepared);const original=f.api.getDocFromServer,gate=defer();let calls=0;f.api.getDocFromServer=async ref=>{calls++;await gate.promise;return original(ref);};
 await assert.rejects(readOwnerRecordFile(f.api,prepared.descriptor,{timeoutMs:5}),/timed out/);await assert.rejects(readOwnerRecordFile(f.api,prepared.descriptor,{timeoutMs:5}),/timed out/);assert.equal(calls,1);gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('downloaded private blob URLs are revocable and document names are assigned as text',async()=>{
 const f=fixture(),prepared=await prepare(f);await save(f,prepared);const revoked=[],clicked=[],timers=new Map();let next=0;f.api.URL={createObjectURL:()=> 'blob:sample-private',revokeObjectURL:url=>revoked.push(url)};f.api.setTimeout=callback=>{timers.set(++next,callback);return next;};f.api.clearTimeout=id=>timers.delete(id);const d={body:{appendChild(){}},createElement:()=>({click(){clicked.push({name:this.download,url:this.href});},remove(){}})};
 await downloadOwnerRecordFile(f.api,d,prepared.descriptor);assert.deepEqual(clicked,[{name:'Sample supporting document.pdf',url:'blob:sample-private'}]);assert.equal(timers.size,1);revokeOwnerRecordFileUrls(f.api);assert.deepEqual(revoked,['blob:sample-private']);assert.equal(timers.size,0);revokeOwnerRecordFileUrls(f.api);assert.equal(revoked.length,1);
});
