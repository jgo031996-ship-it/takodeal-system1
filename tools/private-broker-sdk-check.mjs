import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import childProcess from 'node:child_process';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function guardSdkImport() {
    const restorers=[];
    const replace=(object,key,value)=>{const prior=object[key];object[key]=value;restorers.push(()=>{object[key]=prior;});};
    const noNetwork=()=>{throw Error('Network/subprocess access is prohibited during SDK verification.');};
    for(const [object,keys] of [[http,['request','get']],[https,['request','get']],[http2,['connect']],
        [net,['connect','createConnection']],[net.Socket.prototype,['connect']],[tls,['connect']],
        [childProcess,['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']]])for(const key of keys)replace(object,key,noNetwork);
    for(const object of [dns,dnsPromises])for(const key of Object.keys(object))if(/^lookup|^resolve/.test(key) && typeof object[key]==='function')replace(object,key,noNetwork);
    replace(globalThis,'fetch',noNetwork);
    const credentialFile=value=>{
        if(typeof value==='number')return false;
        const raw=value instanceof URL?fileURLToPath(value):Buffer.isBuffer(value)?value.toString():String(value);
        const path=raw.replaceAll('\\','/').toLowerCase();
        return /(?:^|\/)(?:application_default_credentials|firebase-tools|credentials|adc)\.json$/.test(path)
            || /\/(?:\.config\/)?gcloud\//.test(path) || /\/configstore\/firebase-tools/.test(path);
    };
    const noCredentialFile=value=>{if(credentialFile(value))throw Error('Credential-file access is prohibited during SDK verification.');};
    for(const key of ['readFileSync','readFile','openSync','open','createReadStream']) {
        const prior=fs[key];replace(fs,key,function(path,...args){noCredentialFile(path);return prior.call(this,path,...args);});
    }
    for(const key of ['readFile','open']) {
        const prior=fsPromises[key];replace(fsPromises,key,async function(path,...args){noCredentialFile(path);return prior.call(this,path,...args);});
    }
    for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_CONFIG']) {
        const prior=process.env[key];delete process.env[key];restorers.push(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});
    }
    syncBuiltinESMExports();
    return ()=>{for(const restore of restorers.reverse())restore();syncBuiltinESMExports();};
}
export function assertBrokerEndpoint(endpoint) {
    const expected={platform:'gcfv2',region:['asia-southeast1'],serviceAccountEmail:'staff-document-broker@takodeal-pos.iam.gserviceaccount.com',availableMemoryMb:256,cpu:'gcf_gen1',concurrency:1,minInstances:0,maxInstances:2,timeoutSeconds:30,httpsTrigger:{invoker:['public']}};
    if(!endpoint || Object.entries(expected).some(([key,value])=>JSON.stringify(endpoint[key])!==JSON.stringify(value)))throw Error('The real installed SDK endpoint differs from the reviewed broker limits.');
    return expected;
}
export async function verifyInstalledBrokerSdk(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')) {
    const restore=guardSdkImport();
    try {
        const folder=resolve(root,'functions/staff-document-broker');
        const json=path=>JSON.parse(fs.readFileSync(path,'utf8'));
        const pkg=json(resolve(folder,'package.json')),lock=json(resolve(folder,'package-lock.json'));
        const versions={'firebase-admin':'14.5.0','firebase-functions':'7.4.0'};
        if(pkg.engines?.node!=='22' || pkg.main!=='index.mjs')throw Error('The reviewed production runtime changed.');
        for(const [name,version] of Object.entries(versions)) {
            if(pkg.dependencies?.[name]!==version || lock.packages?.[`node_modules/${name}`]?.version!==version || json(resolve(folder,'node_modules',name,'package.json')).version!==version)throw Error(`The installed, locked SDK version differs: ${name}`);
        }
        if(!lock.packages?.['node_modules/@google-cloud/firestore'] || !lock.packages?.['node_modules/@google-cloud/storage'])throw Error('Required locked Firestore/GCS modules are missing.');
        const wrapper=await import(pathToFileURL(resolve(folder,'index.mjs')).href);
        if(typeof wrapper.staffDocumentBroker!=='function')throw Error('The real SDK wrapper did not load as a function.');
        const endpoint=assertBrokerEndpoint(wrapper.staffDocumentBroker.__endpoint);
        const admin=createRequire(resolve(folder,'package.json'))('firebase-admin/app');
        const app=admin.getApp();
        if(app.options.projectId!=='takodeal-pos' || app.options.storageBucket!=='takodeal-pos.firebasestorage.app')throw Error('The reviewed project/bucket changed.');
        return {localNode:process.version,productionNode:'22',sdk:versions,endpoint,network:'blocked',credentialFiles:'blocked',cloudCalls:'none'};
    } finally {restore();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    try {console.log(JSON.stringify(await verifyInstalledBrokerSdk()));}
    catch(error) {console.error(error.message);process.exitCode=1;}
}
