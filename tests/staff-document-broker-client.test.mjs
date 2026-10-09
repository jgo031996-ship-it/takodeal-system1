import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDocumentBroker,trustedDocumentBroker,DOCUMENT_BROKER_ENDPOINT,DOCUMENT_POLICY_VERSION} from '../takodeal-staff/staff-document-broker.js';
const staff='staff-1',uid='phone-1',hash='a'.repeat(64),bytes=Uint8Array.from([255,216,255,224,1]);
const config={enabled:true,policyVersion:2,brokerEndpoint:DOCUMENT_BROKER_ENDPOINT};
const upload={staffId:staff,group:'valid_id',uploadId:'photo-1',expectedVersion:0,sha256:hash,bytes};
const download={staffId:staff,group:'valid_id',uploadId:'photo-1',version:1,sha256:hash};
const acknowledgement={storagePath:`staff_private_documents/${uid}/${staff}/valid_id/photo-1.jpg`,contentType:'image/jpeg',size:bytes.length,sha256:hash,alreadyExists:false};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const jpeg=(body=bytes,headers={})=>new Response(body,{status:200,headers:{'content-type':'image/jpeg',...headers}});
function fixture(fetchFn=async()=>json(acknowledgement),options={}){
    let selected=staff,tokenReads=0;const requests=[];
    const auth={currentUser:{uid,getIdToken:async()=>{tokenReads++;return 'SAMPLE_FIREBASE_ID_TOKEN';}}};
    const broker=createDocumentBroker({auth,identity:()=>selected,fetchFn:async(...args)=>{requests.push(args);return fetchFn(...args);},...options});
    return {broker,auth,requests,select:value=>{selected=value;},tokenReads:()=>tokenReads};
}
test('only enabled V2 configuration and the exact reviewed HTTPS endpoint may request a Firebase token',async()=>{
    assert.equal(DOCUMENT_POLICY_VERSION,2);assert.equal(trustedDocumentBroker(config),DOCUMENT_BROKER_ENDPOINT);
    const h=fixture();for(const candidate of [undefined,{...config,enabled:false},{...config,policyVersion:1},{...config,policyVersion:3},{...config,brokerEndpoint:''},...[
        'https://attacker.example/upload',DOCUMENT_BROKER_ENDPOINT+'/',DOCUMENT_BROKER_ENDPOINT+'?token=x',DOCUMENT_BROKER_ENDPOINT+'#x',DOCUMENT_BROKER_ENDPOINT.replace('https://','http://'),DOCUMENT_BROKER_ENDPOINT.replace('https://','https://user@')
    ].map(brokerEndpoint=>({...config,brokerEndpoint}))])await assert.rejects(h.broker.upload(candidate,upload),/prepared|verified/);
    assert.equal(h.tokenReads(),0);assert.equal(h.requests.length,0);
});
test('upload sends bounded bytes and the current ID token only to the fixed POST route, without cookies or redirects',async()=>{
    const h=fixture(),result=await h.broker.upload(config,upload);assert.deepEqual(result,acknowledgement);assert.equal(h.tokenReads(),1);
    const [url,request]=h.requests[0];assert.equal(url,DOCUMENT_BROKER_ENDPOINT+'/upload');assert.equal(request.method,'POST');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.headers.Authorization,'Bearer SAMPLE_FIREBASE_ID_TOKEN');assert.ok(request.signal instanceof AbortSignal);
    const sent=JSON.parse(request.body);assert.deepEqual(Object.keys(sent).sort(),['base64','clearanceType','expectedVersion','expiresOn','group','sha256','staffId','uploadId'].sort());assert.deepEqual([...Buffer.from(sent.base64,'base64')],[...bytes]);assert.equal(sent.clearanceType,'');assert.equal(sent.expiresOn,'');
});
test('upload refuses a foreign object path, altered hash/size, download URL or missing acknowledgement fields',async()=>{
    for(const changes of [{storagePath:acknowledgement.storagePath.replace(uid,'other-phone')},{sha256:'b'.repeat(64)},{size:100},{contentType:'application/octet-stream'},{alreadyExists:'yes'},{downloadURL:'https://example.test/?token=SECRET'}]){
        const h=fixture(async()=>json({...acknowledgement,...changes}));await assert.rejects(h.broker.upload(config,upload),/access changed/);
    }
    const h=fixture(async()=>json({sha256:hash}));await assert.rejects(h.broker.upload(config,upload),/access changed/);
});
test('unsupported operation/bytes/version fail before token acquisition or a broker request',async()=>{
    const h=fixture();for(const changes of [{group:'other'},{uploadId:'bad/path'},{expectedVersion:'0'},{expectedVersion:-1},{sha256:'broken'},{bytes:new Uint8Array([1,2])},{bytes:new Uint8Array(2097153)}])await assert.rejects(h.broker.upload(config,{...upload,...changes}),/invalid/);
    for(const changes of [{version:0},{version:'1'},{staffId:'other-staff'},{uploadId:'https://x'}])await assert.rejects(h.broker.download(config,{...download,...changes}),/invalid|Sign in/);
    assert.equal(h.requests.length,0);assert.equal(h.tokenReads(),0);
});
test('identity changes during token acquisition cannot send the old credential or photo',async()=>{
    for(const change of ['employee','uid','user-instance']){
        const h=fixture();h.auth.currentUser.getIdToken=async()=>{await Promise.resolve();if(change==='employee')h.select('other-staff');else if(change==='uid')h.auth.currentUser={uid:'other-phone'};else h.auth.currentUser={uid,getIdToken:async()=>''};return 'SAMPLE_FIREBASE_ID_TOKEN';};
        await assert.rejects(h.broker.upload(config,upload),/account changed/);assert.equal(h.requests.length,0);
    }
});
test('identity changes after the request or while consuming private bytes cannot return a result',async()=>{
    const h=fixture(async()=>{h.select('other-staff');return json(acknowledgement);});await assert.rejects(h.broker.upload(config,upload),/account changed/);
    const streamed=fixture(async()=>({ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:{getReader:()=>({async read(){streamed.select('other-staff');return {done:false,value:bytes};},releaseLock(){},async cancel(){}})}}));
    await assert.rejects(streamed.broker.download(config,download),/account changed/);
});
test('download posts only exact current metadata identifiers and accepts bounded authenticated JPEG bytes',async()=>{
    const h=fixture(async()=>jpeg()),blob=await h.broker.download(config,download);assert.equal(blob.type,'image/jpeg');assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[...bytes]);
    assert.equal(h.requests[0][0],DOCUMENT_BROKER_ENDPOINT+'/download');assert.deepEqual(JSON.parse(h.requests[0][1].body),download);assert.equal(h.requests[0][1].credentials,'omit');
});
test('download rejects wrong MIME, invalid JPEG bytes and oversized advertised or actual response bodies',async()=>{
    for(const response of [jpeg(bytes,{'content-type':'image/png'}),jpeg(new Uint8Array([1,2])),jpeg(bytes,{'content-length':'2097153'}),jpeg(new Uint8Array(2097153))]){
        const h=fixture(async()=>response);await assert.rejects(h.broker.download(config,download),/invalid/);
    }
});
test('redirects, opaque responses and mismatched response destinations have no token-following fallback',async()=>{
    for(const changes of [{redirected:true},{type:'opaque'},{type:'opaqueredirect'},{url:'https://attacker.example/download'}]){
        const h=fixture(async()=>({ok:true,...changes}));await assert.rejects(h.broker.upload(config,upload),/unavailable/);assert.equal(h.requests.length,1);assert.equal(h.requests[0][1].redirect,'error');
    }
});
test('broker failure does not echo arbitrary server text, token URLs or credentials',async()=>{
    const h=fixture(async()=>new Response(JSON.stringify({error:{code:'permission-denied',message:'SECRET https://x/?token=SAMPLE_FIREBASE_ID_TOKEN'}}),{status:403}));
    await assert.rejects(h.broker.download(config,download),error=>error.code==='document-broker/permission-denied'&&!/SECRET|token=|SAMPLE/.test(error.message));
    const bad=fixture(async()=>new Response('SECRET_TOKEN is not JSON',{status:200}));await assert.rejects(bad.broker.upload(config,upload),error=>!error.message.includes('SECRET'));
});
test('a stalled connection has a bounded deadline and aborts without returning a private result',async()=>{
    const h=fixture(async()=>new Promise(()=>{}),{timeoutMs:15});await assert.rejects(h.broker.upload(config,upload),/unavailable/);assert.equal(h.requests.length,1);assert.equal(h.requests[0][1].signal.aborted,true);
});
test('a stalled response body or ID-token request also reaches the same bounded deadline',async()=>{
    const h=fixture(async()=>({ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}}),{timeoutMs:15});await assert.rejects(h.broker.download(config,download),/unavailable/);assert.equal(h.requests[0][1].signal.aborted,true);
    const auth=fixture(undefined,{timeoutMs:15});auth.auth.currentUser.getIdToken=()=>new Promise(()=>{});await assert.rejects(auth.broker.upload(config,upload),/unavailable/);assert.equal(auth.requests.length,0);
});
test('Staff and Owner private transfer modules are identical and expose no direct Firebase Storage client',()=>{
    for(const name of ['staff-document-broker.js','staff-document-store.js','staff-document-firebase.js'])assert.equal(readFileSync(new URL('../takodeal-staff/'+name,import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8'));
    const firebase=readFileSync(new URL('../takodeal-staff/staff-document-firebase.js',import.meta.url),'utf8'),store=readFileSync(new URL('../takodeal-staff/staff-document-store.js',import.meta.url),'utf8');
    assert.doesNotMatch(firebase,/firebase-storage|uploadBytes|getBlob|getDownloadURL/);assert.doesNotMatch(store,/sdk\.(uploadBytes|getBlob|getMetadata|ref)\(/);
});
