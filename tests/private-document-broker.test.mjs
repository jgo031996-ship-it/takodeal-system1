import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPrivateDocumentBroker,BROKER_ENDPOINT,MAX_BYTES,MAX_REQUEST_BYTES,PRODUCTION_ORIGINS} from '../functions/staff-document-broker/broker.mjs';

const token='fixture_firebase_token_1234567890';
const photo=Buffer.from([255,216,255,224,0,16,83,65,77,80,76,69,255,217]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uploadBody={staffId:'staff_A',group:'valid_id',uploadId:'upload_A',expectedVersion:0,sha256:sha(photo),clearanceType:'',expiresOn:'',base64:photo.toString('base64')};
function fixture() {
    const docs=new Map([
        ['staff_document_config/current',{enabled:true,policyVersion:2,brokerEndpoint:BROKER_ENDPOINT}],
        ['staff_private_documents/staff_A',{staffId:'staff_A',branch:'Maa',version:1}],
        ['staff_document_devices/device_A',{uid:'device_A',staffId:'staff_A',branch:'Maa',active:true,approvedByUid:'owner_A',approvedAt:{seconds:1}}],
        ['hq_email_access/manager@example.com',{active:true,permissions:['branches'],allowedBranches:['Maa']}]
    ]),stored=new Map(),reads=[],verifications=[],writes=[];
    const env={docs,stored,reads,verifications,writes,actor:{uid:'device_A',firebase:{sign_in_provider:'anonymous'}},generation:0,revoked:false,hooks:{}};
    const broker=createPrivateDocumentBroker({allowedOrigins:PRODUCTION_ORIGINS,
        async verifyToken(value,revoked) {verifications.push([value,revoked]);if(env.revoked || value!==token)throw Error('private SDK secret must not escape');return structuredClone(env.actor);},
        async read(path) {reads.push(path);await env.hooks.read?.(path);return structuredClone(docs.get(path) || null);},
        objects:{
            async metadata(path) {await env.hooks.metadata?.(path);return structuredClone(stored.get(path)?.metadata || null);},
            async create(path,bytes,metadata,generation) {
                assert.equal(generation,0);await env.hooks.beforeCreate?.(path);
                if(stored.has(path))throw Object.assign(Error('already exists'),{code:412});
                const item={bytes:Buffer.from(bytes),metadata:{...structuredClone(metadata),size:String(bytes.length),generation:String(++env.generation)}};
                stored.set(path,item);writes.push(path);await env.hooks.afterCreate?.(path);
            },
            async bytes(path,generation,maxBytes) {await env.hooks.bytes?.(path);const item=stored.get(path);assert.equal(String(item.metadata.generation),generation);assert.equal(maxBytes,MAX_BYTES);return Buffer.from(item.bytes);}
        }
    });
    env.request=async(path='/upload',body=uploadBody,options={})=>broker({method:'POST',path,query:{},origin:PRODUCTION_ORIGINS[0],contentType:'application/json',rawSize:Buffer.byteLength(JSON.stringify(body)),authorization:`Bearer ${token}`,body:structuredClone(body),...options});
    env.commit=(response,body=uploadBody)=>{
        const data={...response.body,staffId:body.staffId,group:body.group,branch:'Maa',uploadId:body.uploadId,uploadedByUid:'device_A',clearanceType:body.clearanceType,expiresOn:body.expiresOn,status:'pending_review',reviewNote:'',version:body.expectedVersion+1,uploadedAt:{seconds:1},updatedAt:{seconds:1}};
        delete data.alreadyExists;
        docs.set(`staff_private_documents/${body.staffId}/files/${body.group}`,data);
        docs.set(`staff_private_documents/${body.staffId}/versions/${body.uploadId}`,structuredClone(data));return data;
    };
    env.download=record=>env.request('/download',{staffId:record.staffId,group:record.group,uploadId:record.uploadId,version:record.version,sha256:record.sha256});
    return env;
}
async function uploaded() {const f=fixture(),reply=await f.request();assert.equal(reply.status,200);return {f,reply,record:f.commit(reply)};}
const noBytes=reply=>assert.equal(Buffer.isBuffer(reply.body),false);

test('approved immutable Staff upload uses only safe auth documents and create-only bytes; reply contains no URLs/tokens',async()=>{
    const f=fixture(),reply=await f.request();assert.equal(reply.status,200);
    assert.deepEqual(Object.keys(reply.body).sort(),['alreadyExists','contentType','sha256','size','storagePath']);
    assert.equal(reply.body.storagePath,'staff_private_documents/device_A/staff_A/valid_id/upload_A.jpg');
    assert.equal(reply.body.alreadyExists,false);assert.equal(f.writes.length,1);
    assert.ok(f.verifications.length>=3);assert.ok(f.verifications.every(([,flag])=>flag===true));
    assert.ok(f.reads.every(path=>/^(staff_document_config|staff_document_devices|staff_private_documents|hq_email_access)\//.test(path)));
    assert.equal(reply.headers['Cache-Control'],'no-store');assert.equal(reply.headers['X-Content-Type-Options'],'nosniff');
    assert.equal(Object.hasOwn(f.stored.get(reply.body.storagePath).metadata.metadata,'firebaseStorageDownloadTokens'),false);
});
test('lost upload acknowledgement retries the same immutable object without duplicate creates',async()=>{
    const f=fixture();let first=true;f.hooks.afterCreate=()=>{if(first){first=false;throw Error('lost acknowledgement');}};
    assert.equal((await f.request()).status,503);assert.equal(f.writes.length,1);
    const retry=await f.request();assert.equal(retry.status,200);assert.equal(retry.body.alreadyExists,true);assert.equal(f.writes.length,1);
    f.commit(retry);assert.equal((await f.request()).status,200);assert.equal(f.writes.length,1);
});
test('concurrent identical generation-zero upload retries converge on one immutable object',async()=>{
    const f=fixture();const [a,b]=await Promise.all([f.request(),f.request()]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(f.writes.length,1);
    assert.equal([a.body.alreadyExists,b.body.alreadyExists].filter(Boolean).length,1);
});
test('existing upload ID with different hash or details cannot be overwritten',async()=>{
    const f=fixture();assert.equal((await f.request()).status,200);
    const other=Buffer.from(photo);other[6]=84;const retry=await f.request('/upload',{...uploadBody,sha256:sha(other),base64:other.toString('base64')});
    assert.equal(retry.status,409);assert.equal(f.writes.length,1);
    assert.equal((await f.request('/upload',{...uploadBody,expiresOn:'2027-01-01'})).status,409);
});
test('upload accepts canonical clearance details and preserves exact metadata',async()=>{
    const f=fixture(),body={...uploadBody,group:'clearance',clearanceType:'POLICE',expiresOn:'2027-02-28'};
    const reply=await f.request('/upload',body);assert.equal(reply.status,200);const record=f.commit(reply,body);assert.equal((await f.download(record)).status,200);
});
test('successful download requires matching committed current/version records, fresh authority and pinned generation',async()=>{
    const {f,record}=await uploaded(),before=f.verifications.length,reply=await f.download(record);
    assert.equal(reply.status,200);assert.deepEqual(reply.body,photo);assert.equal(reply.headers['Content-Type'],'image/jpeg');
    assert.equal(reply.headers['Content-Disposition'],'attachment; filename="valid_id.jpg"');assert.equal(f.verifications.length-before,2);
});
test('orphan after successful byte upload is inaccessible until valid Firestore commit',async()=>{
    const f=fixture(),reply=await f.request();assert.equal(reply.status,200);
    const download=await f.request('/download',{staffId:'staff_A',group:'valid_id',uploadId:'upload_A',version:1,sha256:sha(photo)});
    assert.equal(download.status,409);noBytes(download);assert.equal(f.stored.size,1);
});
test('missing or conflicting immutable version metadata denies download and committed retry',async()=>{
    const {f,record}=await uploaded();f.docs.delete('staff_private_documents/staff_A/versions/upload_A');
    assert.equal((await f.download(record)).status,409);assert.equal((await f.request()).status,409);
    f.docs.set('staff_private_documents/staff_A/versions/upload_A',{...record,status:'approved'});
    assert.equal((await f.download(record)).status,409);
});
test('approved different phone may read own current record but cannot retry original uploader path',async()=>{
    const {f,record}=await uploaded();f.actor.uid='device_B';f.docs.set('staff_document_devices/device_B',{uid:'device_B',staffId:'staff_A',branch:'Maa',active:true,approvedByUid:'owner_A',approvedAt:{seconds:1}});
    assert.equal((await f.download(record)).status,200);assert.equal((await f.request()).status,409);assert.equal(f.writes.length,1);
});
test('verified Owner and protected scoped HQ can download, never upload through HQ identity',async()=>{
    const {f,record}=await uploaded();f.actor={uid:'owner_A',email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
    assert.equal((await f.download(record)).status,200);assert.equal((await f.request()).status,403);
    f.actor={uid:'manager_A',email:'manager@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
    assert.equal((await f.download(record)).status,200);
    f.docs.get('hq_email_access/manager@example.com').permissions=['payroll'];assert.equal((await f.download(record)).status,403);
    f.docs.get('hq_email_access/manager@example.com').permissions=['all'];f.docs.get('hq_email_access/manager@example.com').allowedBranches=['Cabantian'];assert.equal((await f.download(record)).status,403);
});
test('missing/unverified/inactive HQ access cannot fall back to public employee or manager data',async()=>{
    const {f,record}=await uploaded();f.actor={uid:'manager_A',email:'manager@example.com',email_verified:false,firebase:{sign_in_provider:'google.com'}};
    assert.equal((await f.download(record)).status,403);f.actor.email_verified=true;f.docs.get('hq_email_access/manager@example.com').active=false;
    assert.equal((await f.download(record)).status,403);f.docs.delete('hq_email_access/manager@example.com');assert.equal((await f.download(record)).status,403);
    assert.ok(f.reads.every(path=>!path.startsWith('cashiers/') && !path.startsWith('hq_managers/')));
});
test('revoked ID token fails fresh Auth verification without exposing SDK errors',async()=>{
    const f=fixture();f.revoked=true;const reply=await f.request();assert.equal(reply.status,401);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(reply).includes('secret'),false);
});
test('device binding must match UID, staff ID, active approval and protected parent branch',async()=>{
    for(const patch of [{uid:'wrong'},{staffId:'staff_B'},{branch:'Cabantian'},{active:false}]) {
        const f=fixture();Object.assign(f.docs.get('staff_document_devices/device_A'),patch);assert.equal((await f.request()).status,403);assert.equal(f.writes.length,0);
    }
    const f=fixture();f.docs.delete('staff_private_documents/staff_A');assert.equal((await f.request()).status,403);
});
test('disabled/V1/alternate endpoint policy fails closed without Storage writes',async()=>{
    for(const patch of [{enabled:false},{policyVersion:1},{brokerEndpoint:BROKER_ENDPOINT+'/'},{brokerEndpoint:'https://evil.example'}]) {
        const f=fixture();Object.assign(f.docs.get('staff_document_config/current'),patch);assert.equal((await f.request()).status,503);assert.equal(f.writes.length,0);
    }
});
test('binding revoked while creating leaves inaccessible orphan and gives no upload success',async()=>{
    const f=fixture();f.hooks.afterCreate=()=>{f.docs.get('staff_document_devices/device_A').active=false;};
    const reply=await f.request();assert.equal(reply.status,403);assert.equal(f.stored.size,1);noBytes(reply);
    assert.equal((await f.request()).status,403);
});
test('binding revoked or policy disabled while reading bytes denies download response',async()=>{
    for(const mutate of [f=>{f.docs.get('staff_document_devices/device_A').active=false;},f=>{f.docs.get('staff_document_config/current').enabled=false;},f=>{f.revoked=true;}]) {
        const {f,record}=await uploaded();f.hooks.bytes=()=>mutate(f);const reply=await f.download(record);assert.notEqual(reply.status,200);noBytes(reply);
    }
});
test('HQ branch permission revoked while reading bytes denies download',async()=>{
    const {f,record}=await uploaded();f.actor={uid:'manager_A',email:'manager@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
    f.hooks.bytes=()=>{f.docs.get('hq_email_access/manager@example.com').allowedBranches=[];};const reply=await f.download(record);assert.equal(reply.status,403);noBytes(reply);
});
test('current file replaced or reviewed during read returns no stale bytes',async()=>{
    for(const change of [{uploadId:'upload_B'},{version:2,status:'approved'}]) {
        const {f,record}=await uploaded();f.hooks.bytes=()=>{const next={...record,...change};if(change.uploadId)next.storagePath=next.storagePath.replace('upload_A','upload_B');f.docs.set('staff_private_documents/staff_A/files/valid_id',next);f.docs.set(`staff_private_documents/staff_A/versions/${next.uploadId}`,structuredClone(next));};
        const reply=await f.download(record);assert.equal(reply.status,409);noBytes(reply);
    }
});
test('stale expected upload version cannot replace a current photo',async()=>{
    const {f}=await uploaded();assert.equal((await f.request('/upload',{...uploadBody,uploadId:'upload_B'})).status,409);assert.equal(f.writes.length,1);
    const reply=await f.request('/upload',{...uploadBody,uploadId:'upload_B',expectedVersion:1});assert.equal(reply.status,200);assert.equal(f.writes.length,2);
});
test('photo replacement during create refuses commit response for old preview',async()=>{
    const {f,record}=await uploaded();f.hooks.afterCreate=()=>{const next={...record,version:2,status:'approved'};f.docs.set('staff_private_documents/staff_A/files/valid_id',next);f.docs.set('staff_private_documents/staff_A/versions/upload_A',structuredClone(next));};
    const reply=await f.request('/upload',{...uploadBody,uploadId:'upload_B',expectedVersion:1});assert.equal(reply.status,409);assert.equal(f.stored.size,2);
});
test('Firebase token metadata (including blank), extra object metadata and corrupted bytes cannot be served',async()=>{
    for(const patch of [{firebaseStorageDownloadTokens:'token'},{firebaseStorageDownloadTokens:''},{unexpected:'x'},{policyVersion:'1'}]) {
        const {f,record}=await uploaded();Object.assign(f.stored.get(record.storagePath).metadata.metadata,patch);const reply=await f.download(record);assert.equal(reply.status,409);noBytes(reply);
    }
    const {f,record}=await uploaded();f.stored.get(record.storagePath).bytes[6]=90;assert.equal((await f.download(record)).status,409);
});
test('schema rejects traversal, unknown keys, invalid details and unsupported record paths before writes',async()=>{
    for(const patch of [{staffId:'../staff_A'},{uploadId:'a/b'},{group:'password'},{sha256:'A'.repeat(64)},{expectedVersion:-1},{expiresOn:'2027-02-29'},{clearanceType:'NBI'},{storagePath:'legacy/file'}]) {
        const f=fixture(),reply=await f.request('/upload',{...uploadBody,...patch});assert.equal(reply.status,400);assert.equal(f.writes.length,0);
    }
    const f=fixture();assert.equal((await f.request('/upload',{...uploadBody,group:'clearance'})).status,400);
});
test('raw body, base64, byte size, JPEG marker and hash limits are enforced',async()=>{
    const f=fixture();assert.equal((await f.request('/upload',uploadBody,{rawSize:MAX_REQUEST_BYTES+1})).status,413);
    assert.equal((await f.request('/upload',uploadBody,{rawSize:undefined})).status,413);
    assert.equal((await f.request('/upload',{...uploadBody,base64:'!invalid!'})).status,413);
    const huge=Buffer.alloc(MAX_BYTES+1,1);assert.equal((await f.request('/upload',{...uploadBody,base64:huge.toString('base64'),sha256:sha(huge)})).status,413);
    const broken=Buffer.from(photo);broken[broken.length-1]=0;assert.equal((await f.request('/upload',{...uploadBody,base64:broken.toString('base64'),sha256:sha(broken)})).status,400);
    assert.equal((await f.request('/upload',{...uploadBody,sha256:'0'.repeat(64)})).status,409);assert.equal(f.writes.length,0);
});
test('exact 2 MiB canonical JPEG is accepted without recursive base64 regex overflow',async()=>{
    const f=fixture(),bytes=Buffer.alloc(MAX_BYTES,65);photo.copy(bytes,0,0,6);bytes[MAX_BYTES-2]=255;bytes[MAX_BYTES-1]=217;
    const reply=await f.request('/upload',{...uploadBody,sha256:sha(bytes),base64:bytes.toString('base64')});assert.equal(reply.status,200);assert.equal(reply.body.size,MAX_BYTES);
});
test('exact CORS, route, method, query and bearer guards fail closed',async()=>{
    const f=fixture();for(const origin of [undefined,'null','http://localhost:8770','https://takodeal-staff.vercel.app.evil.example'])assert.equal((await f.request('/upload',uploadBody,{origin})).status,403);
    assert.equal((await f.request('/credentials')).status,404);assert.equal((await f.request('/upload',uploadBody,{query:{token:'x'}})).status,404);
    assert.equal((await f.request('/upload',uploadBody,{method:'GET'})).status,405);assert.equal((await f.request('/upload',uploadBody,{authorization:undefined})).status,401);
    assert.equal((await f.request('/upload',uploadBody,{contentType:'image/jpeg'})).status,413);assert.equal(f.writes.length,0);
});
test('explicit production preflight needs POST and only the approved headers, no credential CORS',async()=>{
    const f=fixture();const reply=await f.request('/upload',{}, {method:'OPTIONS',authorization:undefined,preflightMethod:'POST',preflightHeaders:'authorization, content-type'});
    assert.equal(reply.status,204);assert.equal(reply.headers['Access-Control-Allow-Origin'],PRODUCTION_ORIGINS[0]);assert.equal(Object.hasOwn(reply.headers,'Access-Control-Allow-Credentials'),false);
    assert.equal((await f.request('/upload',{}, {method:'OPTIONS',preflightMethod:'GET'})).status,403);
    assert.equal((await f.request('/upload',{}, {method:'OPTIONS',preflightMethod:'POST',preflightHeaders:'x-private-key'})).status,403);assert.equal(f.reads.length,0);
});
test('wrong parent branch/current path and uncommitted review state cannot expose bytes',async()=>{
    const {f,record}=await uploaded();f.docs.get('staff_private_documents/staff_A/files/valid_id').storagePath='public/legacy.jpg';assert.equal((await f.download(record)).status,409);
    f.docs.set('staff_private_documents/staff_A/files/valid_id',{...record,branch:'Cabantian'});assert.equal((await f.download(record)).status,409);
});
test('malformed approval and missing record schema fields fail closed',async()=>{
    const f=fixture();delete f.docs.get('staff_document_devices/device_A').approvedAt;assert.equal((await f.request()).status,403);assert.equal(f.writes.length,0);
    const ready=await uploaded();delete ready.f.docs.get('staff_private_documents/staff_A/files/valid_id').uploadedAt;assert.equal((await ready.f.download(ready.record)).status,409);
});
test('origin constructor refuses wildcard/nonexact/nonHTTPS authority',()=>{
    for(const origin of ['*','http://example.com','https://example.com/','https://user@example.com'])assert.throws(()=>createPrivateDocumentBroker({allowedOrigins:[origin]}),/exact HTTPS/);
});
