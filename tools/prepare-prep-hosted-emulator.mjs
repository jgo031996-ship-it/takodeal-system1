// Hosted CI only; downloads the exact official emulator, never production data.
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,createWriteStream,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GITHUB_ENV||!process.env.JAVA_HOME||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_TOKEN)throw Error('Use a credential-free hosted test runner only.');
const tools=resolve('tests/fixtures/prep-hosted-tools'),java=join(process.env.JAVA_HOME,'bin','java'),folder=join(tools,'emulators'),jar=join(folder,'cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java))throw Error('Java21 is required.');mkdirSync(folder,{recursive:true});
const url='https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar',response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(180000)});
if(response.status!==200||Number(response.headers.get('content-length'))!==136707194)throw Error('Official emulator download size changed.');
await pipeline(Readable.fromWeb(response.body),createWriteStream(jar));
const bytes=readFileSync(jar),sha=createHash('sha256').update(bytes).digest('hex');if(bytes.length!==136707194||sha!=='9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c')throw Error('Official emulator checksum differs.');
writeFileSync(join(tools,'runtime.json'),JSON.stringify({java,downloads:[{file:jar,sha256:sha,bytes:bytes.length}]},null,2)+'\n');
appendFileSync(process.env.GITHUB_ENV,'TAKODEAL_TEST_TOOLS='+tools+'\nPREP_RULES_FILE='+resolve('tests/fixtures/prep-active32cdf.rules')+'\n');
console.log(JSON.stringify({hostedOnly:true,emulatorVersion:'1.22.0',sha256:sha,productionCredentials:false}));
