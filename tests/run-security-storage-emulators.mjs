import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),tools=resolve(process.env.STAFF_DOCUMENT_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),runtime=JSON.parse(readFileSync(resolve(tools,'runtime.json'),'utf8')),cli=resolve(process.env.APPDATA,'npm/node_modules/firebase-tools/lib/bin/firebase.js');
mkdirSync(resolve(tools,'config'),{recursive:true});const configPath=resolve(tools,'security-storage-emulators.json');
writeFileSync(configPath,JSON.stringify({storage:{rules:resolve(root,'docs/staff-document-storage.rules.snippet')},emulators:{firestore:{host:'127.0.0.1',port:8788},storage:{host:'127.0.0.1',port:9798},hub:{host:'127.0.0.1',port:4798},logging:{host:'127.0.0.1',port:4898},ui:{enabled:false},singleProjectMode:true}}));
const child=spawn(process.execPath,[cli,'--config',configPath,'--project','demo-security-private-uploads','emulators:exec','--only','firestore,storage','--non-interactive','node --test tests/security-storage.emulator.mjs'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PATH:dirname(runtime.java)+delimiter+process.env.PATH,XDG_CONFIG_HOME:resolve(tools,'config'),FIREBASE_EMULATORS_PATH:resolve(tools,'emulators'),STAFF_DOCUMENT_TEST_TOOLS:tools,NO_UPDATE_NOTIFIER:'1',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'1'}});
child.on('error',error=>{throw error;});child.on('exit',code=>{process.exitCode=code||0;});
