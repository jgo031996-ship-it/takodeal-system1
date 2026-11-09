import test from 'node:test';
import assert from 'node:assert/strict';
import {documentMetadataFixture,STAFF,UID,BRANCH,OWNER,PHONE_TOKEN,OWNER_TOKEN,MANAGER_TOKEN} from './helpers/document-metadata-fixture.mjs';
const headPath=`staff_private_documents/${STAFF}/files/valid_id`,versionPath=id=>`staff_private_documents/${STAFF}/versions/${id}`;
async function uploaded(){const f=await documentMetadataFixture();await f.uploadBytes();assert.equal((await f.request('upload')).status,200);return f;}
test('actual byte attestation plus metadata transaction writes exact legacy16-field equal head/version with no URL, grants or financial writes',async()=>{
 const f=await uploaded(),head=await f.head();assert.equal(Object.keys(head).length,16);assert.equal(head.status,'pending_review');assert.equal(head.version,1);assert.deepEqual(head,await f.version(f.input.uploadId));assert.equal(f.creates,1);assert.ok(f.byteReads>=2);assert.ok(f.txWrites.every(path=>path.startsWith('staff_private_documents/'+STAFF+'/')));assert.ok(f.verified.every(call=>call.revoked===true));assert.doesNotMatch(JSON.stringify(head),/token|URL|pin|salary|account/);assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.headers.Authorization,'Bearer '+PHONE_TOKEN);
});
test('lost acknowledgment retries one immutable upload without increasing version or rewriting original timestamps',async()=>{
 const f=await documentMetadataFixture();await f.uploadBytes();f.lostAck=true;assert.equal((await f.request('upload')).status,503);const committed=structuredClone(await f.head());const retry=await f.request('upload');assert.equal(retry.status,200);assert.equal(retry.body.alreadySaved,true);assert.deepEqual(await f.head(),committed);assert.equal(f.creates,1);assert.equal([...f.memory.rows.keys()].filter(path=>path.includes('/versions/')).length,1);assert.equal(f.txWrites.length,2);
});
test('fresh HQ approval atomically updates exact head/version and creates only a nine-field immutable audit, with idempotent lost-ACK retry',async()=>{
 const f=await uploaded(),input=await f.review();f.lostAck=true;assert.equal((await f.request('review',input,OWNER_TOKEN)).status,503);const reviewed=structuredClone(await f.head());assert.equal(reviewed.version,2);assert.equal(reviewed.status,'approved');assert.deepEqual(reviewed,await f.version(input.uploadId));const audit=await f.read(`staff_private_documents/${STAFF}/reviews/${input.reviewId}`);assert.equal(Object.keys(audit).length,9);assert.deepEqual(audit.recordedAt,reviewed.reviewedAt);
 const retry=await f.request('review',input,OWNER_TOKEN);assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.alreadySaved,true);assert.deepEqual(await f.head(),reviewed);assert.equal(JSON.parse(f.requests.at(-1).options.body).version,2,'retry attests the freshly inspected committed version');
});
test('missing or corrupt photo holds approval but remains rejectable with a reason under fresh trusted authority',async()=>{
 for(const mode of ['missing','corrupt']){const f=await uploaded(),head=await f.head();if(mode==='missing')f.images.delete(head.storagePath);else f.images.get(head.storagePath).bytes[4]++;assert.notEqual((await f.request('review',await f.review(),OWNER_TOKEN)).status,200);assert.equal((await f.head()).version,1);const before=f.requests.length,reply=await f.request('review',await f.review('rejected'),OWNER_TOKEN);assert.equal(reply.status,200,JSON.stringify(reply.body));assert.equal(f.requests.length,before,'rejection does not require GCS attestation');assert.equal((await f.head()).status,'rejected');}
});
test('a disabled policy, revoked/foreign binding, inactive employee or branch move never publishes metadata',async()=>{
 for(const[path,patch]of [['staff_document_config/current',{enabled:false}],['staff_document_devices/'+UID,{active:false}],['staff_document_devices/'+UID,{uid:'foreign'}],['staff_document_devices/'+UID,{staffId:'foreign'}],['cashiers/'+STAFF,{deleted:true}],['cashiers/'+STAFF,{branch:'Other'}]]){const f=await documentMetadataFixture();await f.uploadBytes();await f.put(path,{...await f.read(path),...patch});assert.equal((await f.request('upload')).status,403);assert.equal(await f.head(),null);assert.equal(f.txWrites.length,0);}
});
test('access and profile revocation after valid attestation are rechecked in the commit transaction',async()=>{
 for(const path of ['staff_document_devices/'+UID,'cashiers/'+STAFF]){const f=await documentMetadataFixture();await f.uploadBytes();f.afterAttest=async()=>{await f.put(path,{...await f.read(path),active:false});};assert.equal((await f.request('upload')).status,403);assert.equal(await f.head(),null);assert.equal(f.txWrites.length,0);}
});
test('revoked Firebase identity after object IO cannot commit even when document grants remain active',async()=>{const f=await documentMetadataFixture();await f.uploadBytes();f.afterAttest=()=>f.revoked.add(PHONE_TOKEN);assert.equal((await f.request('upload')).status,401);assert.equal(await f.head(),null);});
test('altered/ABA metadata during attestation is held rather than overwriting a later head or history',async()=>{
 const f=await uploaded(),original=structuredClone(await f.head()),input={...f.input,uploadId:'sample-upload-two',expectedVersion:1};await f.uploadBytes(input);f.afterAttest=async()=>{await f.put(headPath,{...original,reviewNote:'temporary'});await f.put(headPath,original);};assert.equal((await f.request('upload',input)).status,409);assert.deepEqual(await f.head(),original);assert.equal(await f.version(input.uploadId),null);
});
test('stale expected version or an older operation cannot restore earlier metadata after a newer upload',async()=>{const f=await uploaded(),input={...f.input,uploadId:'sample-upload-two',expectedVersion:1};await f.uploadBytes(input);assert.equal((await f.request('upload',input)).status,200);assert.equal((await f.request('upload',f.input)).status,409);assert.equal((await f.head()).uploadId,input.uploadId);assert.equal((await f.version(f.input.uploadId)).version,1);});
test('foreign/HQ/staff actors and malformed requests are rejected before metadata writes or image verification',async()=>{
 for(const patch of [{staffId:'../foreign'},{storagePath:'https://untrusted.example'},{expiresOn:'2026-99-99'},{size:0},{group:'passport'},{expectedVersion:-1}]){const f=await documentMetadataFixture();assert.equal((await f.request('upload',{...f.input,...patch})).status,400);assert.equal(f.requests.length,0);assert.equal(f.txWrites.length,0);}
 const f=await documentMetadataFixture();assert.equal((await f.request('upload',f.input,OWNER_TOKEN)).status,403);assert.equal((await f.request('review',{staffId:STAFF,group:'valid_id',uploadId:'sample',expectedVersion:1,sha256:f.input.sha256,reviewId:'sample-review',status:'approved',note:''},PHONE_TOKEN)).status,403);
 assert.equal((await f.request('upload',f.input,PHONE_TOKEN,{origin:'https://untrusted.example'})).status,403);assert.equal(f.txWrites.length,0);
});
test('exact scoped HQ profile/index/bridge intersection permits review and denies foreign or revoked scope',async()=>{
 const f=await uploaded();await f.seedManager();assert.equal((await f.request('review',await f.review('rejected'),MANAGER_TOKEN)).status,200);
 for(const path of ['hq_account_index/doc-manager@example.test','hq_email_access/doc-manager@example.test','hq_managers/sample-doc-manager']){const g=await uploaded();await g.seedManager();await g.put(path,{...await g.read(path),active:false});assert.equal((await g.request('review',await g.review('rejected'),MANAGER_TOKEN)).status,403);assert.equal((await g.head()).version,1);}
 const g=await uploaded();await g.seedManager(['branches'],'Foreign Branch');assert.equal((await g.request('review',await g.review('rejected'),MANAGER_TOKEN)).status,403);
});
test('both raw HQ PIN revocation fields defeat a still-active protected index immediately',async()=>{
 for(const key of ['pin','securityPin']){const f=await uploaded();await f.seedManager();await f.put('hq_managers/sample-doc-manager',{...await f.read('hq_managers/sample-doc-manager'),[key]:' revoked '});assert.equal((await f.request('review',await f.review('rejected'),MANAGER_TOKEN)).status,403);assert.equal((await f.head()).version,1);}
});
test('HQ role/permission changes during attestation and mismatched history/audit cannot approve a stale record',async()=>{
 const f=await uploaded();await f.seedManager();f.afterAttest=async()=>{await f.put('hq_email_access/doc-manager@example.test',{active:true,permissions:['inbox'],allowedBranches:[BRANCH]});};assert.equal((await f.request('review',await f.review(),MANAGER_TOKEN)).status,403);assert.equal((await f.head()).version,1);
 const g=await uploaded();await g.put(versionPath(g.input.uploadId),{...await g.head(),sha256:'b'.repeat(64)});assert.equal((await g.request('review',await g.review('rejected'),OWNER_TOKEN)).status,409);
});
test('mixed-case duplicate HQ records and credential/profile leakage are refused',async()=>{const f=await uploaded();await f.seedManager();await f.put('hq_managers/duplicate',{email:'DOC-MANAGER@EXAMPLE.TEST',role:'Manager',permissions:['all'],assignedBranch:'All',active:true});const result=await f.request('review',await f.review('rejected'),MANAGER_TOKEN);assert.equal(result.status,403);assert.doesNotMatch(JSON.stringify(result),/sourceAccess|permissions|salary|securityPin|verifier/);});
