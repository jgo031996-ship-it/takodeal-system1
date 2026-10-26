import fs from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {guardSdkImport} from './private-broker-sdk-check.mjs';

export function assertCashRemittanceEndpoint(endpoint){
 const expected={platform:'gcfv2',region:['asia-southeast1'],serviceAccountEmail:'cash-remittance-review@takodeal-pos.iam.gserviceaccount.com',availableMemoryMb:256,cpu:1,concurrency:4,minInstances:0,maxInstances:2,timeoutSeconds:60,httpsTrigger:{invoker:['public']}};
 if(!endpoint||Object.entries(expected).some(([key,value])=>JSON.stringify(endpoint[key])!==JSON.stringify(value)))throw Error('The real installed SDK endpoint differs from the reviewed cash remittance runtime.');return expected;
}
export async function verifyInstalledCashRemittanceSdk(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
 const restore=guardSdkImport();
 try{
  const folder=resolve(root,'functions/cash-remittance-review'),json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),pkg=json(resolve(folder,'package.json')),lock=json(resolve(folder,'package-lock.json')),versions={'firebase-admin':'14.5.0','firebase-functions':'7.4.0'};
  if(pkg.name!=='takodeal-cash-remittance-review'||pkg.engines?.node!=='22'||pkg.main!=='index.mjs')throw Error('The reviewed cash remittance runtime changed.');
  for(const [name,version]of Object.entries(versions))if(pkg.dependencies?.[name]!==version||lock.packages?.[`node_modules/${name}`]?.version!==version||json(resolve(folder,'node_modules',name,'package.json')).version!==version)throw Error('The installed locked SDK differs: '+name);
  const patched='2.4.0';if(lock.packages?.['node_modules/body-parser']?.version!==patched||json(resolve(folder,'node_modules/body-parser/package.json')).version!==patched)throw Error('The reviewed body-parser patch is missing.');
  const wrapper=await import(pathToFileURL(resolve(folder,'index.mjs')).href),store=await import(pathToFileURL(resolve(folder,'store.mjs')).href);
  if(typeof wrapper.cashRemittanceReview!=='function'||typeof store.createCashRemittanceStore!=='function')throw Error('The real runtime wrapper or shared Admin transaction adapter did not load.');
  const endpoint=assertCashRemittanceEndpoint(wrapper.cashRemittanceReview.__endpoint),admin=createRequire(resolve(folder,'package.json'))('firebase-admin/app'),app=admin.getApp('cash-remittance-review');
  if(app.options.projectId!=='takodeal-pos')throw Error('The reviewed cash remittance project changed.');
  return{localNode:process.version,productionNode:'22',sdk:versions,transitive:{'body-parser':patched},endpoint,adminApp:'cash-remittance-review',projectId:'takodeal-pos',sharedStore:'createCashRemittanceStore',network:'blocked',credentialFiles:'blocked',cloudCalls:'none'};
 }finally{restore();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await verifyInstalledCashRemittanceSdk()));}catch(error){console.error(error.message);process.exitCode=1;}
}
