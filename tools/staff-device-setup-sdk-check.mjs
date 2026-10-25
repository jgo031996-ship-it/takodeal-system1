import fs from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {guardSdkImport} from './private-broker-sdk-check.mjs';

export function assertSetupEndpoint(endpoint) {
 const expected={platform:'gcfv2',region:['asia-southeast1'],serviceAccountEmail:'staff-device-setup@takodeal-pos.iam.gserviceaccount.com',availableMemoryMb:512,cpu:1,concurrency:4,minInstances:0,maxInstances:2,timeoutSeconds:30,httpsTrigger:{invoker:['public']}};
 if(!endpoint||Object.entries(expected).some(([key,value])=>JSON.stringify(endpoint[key])!==JSON.stringify(value)))throw Error('The real installed SDK endpoint differs from the reviewed Staff setup limits.');
 return expected;
}
export async function verifyInstalledStaffDeviceSetupSdk(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')) {
 const restore=guardSdkImport();
 try {
  const folder=resolve(root,'functions/staff-device-setup'),json=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  const pkg=json(resolve(folder,'package.json')),lock=json(resolve(folder,'package-lock.json')),versions={'firebase-admin':'14.5.0','firebase-functions':'7.4.0'};
  if(pkg.name!=='takodeal-staff-device-setup'||pkg.engines?.node!=='22'||pkg.main!=='index.mjs')throw Error('The reviewed Staff setup runtime changed.');
  for(const[name,version]of Object.entries(versions)){
   if(pkg.dependencies?.[name]!==version||lock.packages?.[`node_modules/${name}`]?.version!==version||json(resolve(folder,'node_modules',name,'package.json')).version!==version)throw Error('The installed locked SDK differs: '+name);
  }
  if(!lock.packages?.['node_modules/@google-cloud/firestore'])throw Error('Required locked Firestore SDK is missing.');
  // GHSA-27r3-jxmh-p828 is fixed in this reviewed transitive version.
  const bodyParserVersion='2.4.0';
  if(lock.packages?.['node_modules/body-parser']?.version!==bodyParserVersion||json(resolve(folder,'node_modules/body-parser/package.json')).version!==bodyParserVersion)throw Error('The reviewed body-parser security patch is missing.');
  const wrapper=await import(pathToFileURL(resolve(folder,'index.mjs')).href);
  if(typeof wrapper.staffDeviceSetup!=='function')throw Error('The real Staff setup wrapper did not load as a function.');
  const endpoint=assertSetupEndpoint(wrapper.staffDeviceSetup.__endpoint),admin=createRequire(resolve(folder,'package.json'))('firebase-admin/app'),app=admin.getApp('staff-device-setup');
  if(app.options.projectId!=='takodeal-pos')throw Error('The reviewed Staff setup project changed.');
  return {localNode:process.version,productionNode:'22',sdk:versions,transitive:{'body-parser':bodyParserVersion},endpoint,adminApp:'staff-device-setup',projectId:'takodeal-pos',network:'blocked',credentialFiles:'blocked',cloudCalls:'none'};
 }finally{restore();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await verifyInstalledStaffDeviceSetupSdk()));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
