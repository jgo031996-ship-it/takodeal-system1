import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {PRODUCTION_ORIGINS} from '../functions/staff-document-broker/broker.mjs';

// Executes the actual wrapper with API-compatible local SDK seams; does not claim
// that npm dependencies, IAM, Cloud Run routing or deployed CORS were exercised.
async function wrapper() {
    const source=await readFile(new URL('../functions/staff-document-broker/index.mjs',import.meta.url),'utf8');
    const calls=[],state={metadata:{generation:'7',size:'6'},chunks:[Buffer.from('sample')]};let api;
    const context={Buffer,PRODUCTION_ORIGINS,
        initializeApp(options){calls.push(['initialize',options]);},
        getAuth:()=>({verifyIdToken:(token,flag)=>{calls.push(['verify',token,flag]);return {uid:'approved'};}}),
        getFirestore:()=>({doc:path=>({async get(){calls.push(['read',path]);return {exists:true,data:()=>({path})};}})}),
        getStorage:()=>({bucket:()=>({file:(path,options)=>({
            async getMetadata(){calls.push(['metadata',path]);if(state.error)throw state.error;return [state.metadata];},
            async save(bytes,options){calls.push(['save',path,bytes,options]);},
            createReadStream(streamOptions){calls.push(['stream',path,options,streamOptions]);state.stream=Readable.from(state.chunks);return state.stream;}
        })})}),
        createPrivateDocumentBroker(options){api=options;return async request=>{calls.push(['request',request]);return state.response || {status:200,headers:{'Cache-Control':'no-store'},body:{ok:true}};};},
        onRequest:(options,handler)=>({options,handler})
    };
    vm.runInNewContext(source.replace(/^import[^\n]*\n/gm,'').replace('export const staffDocumentBroker=','globalThis.deployed='),context);
    return {api,state,calls,deployed:context.deployed};
}
test('actual wrapper fixes ADC project/bucket, dedicated identity and bounded scale; no credential material',async()=>{
    const {calls,deployed,api}=await wrapper();const config=JSON.parse(JSON.stringify(deployed.options));
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['initialize',{projectId:'takodeal-pos',storageBucket:'takodeal-pos.firebasestorage.app'}]);
    assert.equal(config.region,'asia-southeast1');assert.equal(config.memory,'256MiB');assert.equal(config.cpu,'gcf_gen1');assert.equal(config.concurrency,1);
    assert.equal(config.minInstances,0);assert.equal(config.maxInstances,2);assert.equal(config.timeoutSeconds,30);assert.equal(config.cors,false);assert.equal(config.invoker,'public');
    assert.equal(config.serviceAccount,'staff-document-broker@takodeal-pos.iam.gserviceaccount.com');assert.deepEqual(api.allowedOrigins,PRODUCTION_ORIGINS);
    await api.verifyToken('firebase-id-token',true);assert.deepEqual(calls.at(-1),['verify','firebase-id-token',true]);
    assert.deepEqual(await api.read('staff_document_config/current'),{path:'staff_document_config/current'});
});
test('actual GCS wrapper is create-only with CRC32C and preserves conflict errors for idempotent core',async()=>{
    const {api,calls,state}=await wrapper();const bytes=Buffer.from('sample'),metadata={contentType:'image/jpeg',metadata:{sha256:'fakehash'}};
    await api.objects.create('fixed/private/path.jpg',bytes,metadata,0);const save=calls.at(-1);
    assert.equal(save[0],'save');assert.equal(save[1],'fixed/private/path.jpg');assert.equal(save[2],bytes);
    assert.equal(save[3].preconditionOpts.ifGenerationMatch,0);assert.equal(save[3].resumable,false);assert.equal(save[3].validation,'crc32c');assert.equal(save[3].metadata,metadata);
    state.error={code:404};assert.equal(await api.objects.metadata('private/missing.jpg'),null);state.error={code:403};await assert.rejects(api.objects.metadata('private/held.jpg'));
});
test('actual wrapper pins read generation and destroys stream on oversize rather than buffering unlimited bytes',async()=>{
    const {api,calls,state}=await wrapper();assert.deepEqual(await api.objects.bytes('fixed/private/path.jpg','7',6),Buffer.from('sample'));
    const stream=calls.at(-1);assert.equal(stream[2].generation,'7');assert.equal(stream[3].validation,'crc32c');assert.equal(state.stream.destroyed,true);
    state.chunks=[Buffer.alloc(4),Buffer.alloc(4)];await assert.rejects(api.objects.bytes('fixed/private/path.jpg','7',6),/byte limit/);assert.equal(state.stream.destroyed,true);
});
test('actual HTTP wrapper forwards explicit protocol values, emits JPEG bytes and never redirects',async()=>{
    const {state,calls,deployed}=await wrapper();state.response={status:200,headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'},body:Buffer.from('sample')};
    const input={method:'POST',path:'/download',query:{},rawBody:Buffer.from('{}'),body:{staffId:'a'},get:header=>({'Origin':PRODUCTION_ORIGINS[1],'Content-Type':'application/json','Authorization':'Bearer test'})[header]};
    const result={status(value){this.code=value;return this;},set(value){this.headers=value;return this;},end(value){this.bytes=value;},json(value){this.jsonBody=value;}};
    await deployed.handler(input,result);assert.equal(result.code,200);assert.deepEqual(result.bytes,Buffer.from('sample'));assert.equal(result.jsonBody,undefined);
    const request=calls.at(-1)[1];assert.equal(request.rawSize,2);assert.equal(request.origin,PRODUCTION_ORIGINS[1]);assert.equal(request.authorization,'Bearer test');assert.equal(request.path,'/download');
});
