import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onRequest} from 'firebase-functions/v2/https';
import {createPrivateDocumentBroker,PRODUCTION_ORIGINS} from './broker.mjs';

// Application Default Credentials only. No client Storage API or download URLs.
initializeApp({projectId:'takodeal-pos',storageBucket:'takodeal-pos.firebasestorage.app'});
const firestore=getFirestore(),bucket=getStorage().bucket();
const objects={
    async metadata(path) {
        try {const [metadata]=await bucket.file(path).getMetadata();return metadata;}
        catch(error) {if(Number(error.code)===404)return null;throw error;}
    },
    async create(path,bytes,metadata,generation) {
        await bucket.file(path).save(bytes,{metadata,resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:generation}});
    },
    async bytes(path,generation,maxBytes) {
        const stream=bucket.file(path,{generation}).createReadStream({validation:'crc32c'}),chunks=[];let size=0;
        try {
            for await (const chunk of stream) {size+=chunk.length;if(size>maxBytes)throw Error('Private object exceeds the byte limit.');chunks.push(chunk);}
            return Buffer.concat(chunks,size);
        } finally {stream.destroy();}
    }
};
const handle=createPrivateDocumentBroker({
    verifyToken:(token,checkRevoked)=>getAuth().verifyIdToken(token,checkRevoked),
    async read(path) {const snapshot=await firestore.doc(path).get();return snapshot.exists?snapshot.data():null;},
    objects,allowedOrigins:PRODUCTION_ORIGINS
});
export const staffDocumentBroker=onRequest({
    region:'asia-southeast1',memory:'256MiB',cpu:'gcf_gen1',concurrency:1,
    minInstances:0,maxInstances:2,timeoutSeconds:30,cors:false,invoker:'public',
    serviceAccount:'staff-document-broker@takodeal-pos.iam.gserviceaccount.com'
},async(request,response)=>{
    const result=await handle({
        method:request.method,path:request.path,query:request.query,
        origin:request.get('Origin'),contentType:request.get('Content-Type'),
        authorization:request.get('Authorization'),rawSize:request.rawBody?.length,
        preflightMethod:request.get('Access-Control-Request-Method'),
        preflightHeaders:request.get('Access-Control-Request-Headers'),body:request.body
    });
    response.status(result.status).set(result.headers);
    if(result.body===null)response.end();else if(Buffer.isBuffer(result.body))response.end(result.body);else response.json(result.body);
});
