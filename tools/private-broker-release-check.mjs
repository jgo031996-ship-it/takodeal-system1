import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const RELEASE_FILES=[
    'firebase.broker.json','functions/staff-document-broker/broker.mjs',
    'functions/staff-document-broker/index.mjs','functions/staff-document-broker/package.json',
    'functions/staff-document-broker/package-lock.json'
];
export async function verifyBrokerRelease(root,{loadSdk=true}={}) {
    let manifest;
    try {manifest=JSON.parse(await readFile(resolve(root,'private-broker-reviewed.json'),'utf8'));}
    catch {throw Error('The final reviewed broker manifest is missing. Complete dependency installation and release review first.');}
    if(manifest.schemaVersion!==1 || manifest.project!=='takodeal-pos' || manifest.codebase!=='staff-documents' || !/^[a-f0-9]{40}$/.test(manifest.reviewedCommit || '') || !Array.isArray(manifest.files) || manifest.files.length!==RELEASE_FILES.length || new Set(manifest.files.map(file=>file.path)).size!==RELEASE_FILES.length || manifest.files.some(file=>!RELEASE_FILES.includes(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 || '')))throw Error('The broker review manifest is invalid.');
    for(const file of manifest.files) {
        let bytes;try {bytes=await readFile(resolve(root,file.path));}catch {throw Error(`Required reviewed file missing: ${file.path}`);}
        if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error(`Reviewed source changed: ${file.path}`);
    }
    const config=JSON.parse(await readFile(resolve(root,'firebase.broker.json'),'utf8'));
    if(Object.keys(config).length!==1 || !Array.isArray(config.functions) || config.functions.length!==1 || config.functions[0].source!=='functions/staff-document-broker' || config.functions[0].codebase!=='staff-documents')throw Error('The deployment config must contain only the reviewed broker codebase.');
    const folder=resolve(root,'functions/staff-document-broker'),pkg=JSON.parse(await readFile(resolve(folder,'package.json'),'utf8'));
    if(pkg.main!=='index.mjs' || pkg.engines?.node!=='22' || pkg.dependencies?.['firebase-admin']!=='14.5.0' || pkg.dependencies?.['firebase-functions']!=='7.4.0')throw Error('The reviewed SDK/runtime pairing changed.');
    const lock=JSON.parse(await readFile(resolve(folder,'package-lock.json'),'utf8'));
    if(lock.packages?.['node_modules/firebase-admin']?.version!=='14.5.0' || lock.packages?.['node_modules/firebase-functions']?.version!=='7.4.0' || !lock.packages?.['node_modules/@google-cloud/firestore'] || !lock.packages?.['node_modules/@google-cloud/storage'])throw Error('The installed SDK lock must include the exact runtime and its Firestore/GCS dependencies.');
    if(loadSdk) {
        const require=createRequire(resolve(folder,'package.json'));
        for(const [name,expected] of Object.entries(pkg.dependencies)) {
            const installed=JSON.parse(await readFile(resolve(folder,'node_modules',name,'package.json'),'utf8'));
            if(installed.version!==expected)throw Error(`Installed SDK mismatch: ${name}`);
        }
        require.resolve('firebase-admin/firestore');require.resolve('firebase-admin/storage');require.resolve('firebase-functions/v2/https');
        const wrapper=await import(pathToFileURL(resolve(folder,'index.mjs')).href);
        if(typeof wrapper.staffDocumentBroker!=='function')throw Error('The real SDK wrapper did not load as an HTTPS function.');
    }
    return manifest.reviewedCommit;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    try {const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const commit=await verifyBrokerRelease(root);console.log(`Broker check passed for reviewed source ${commit}. No cloud operation was performed.`);}
    catch(error) {console.error(error.message);process.exitCode=1;}
}
