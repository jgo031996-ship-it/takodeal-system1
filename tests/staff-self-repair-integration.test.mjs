import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {staffSelfRepairSwapsProof as proof,restoreStaffSelfRepairSwaps as restore,staffSelfRepairSha as sha} from './helpers/staff-self-repair-swaps-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:6e6});
test('seven exact reviewed inverses and two pinned new modules preserve every other live b576 product byte',()=>{
 assert.equal(proof.base,'b576555caa29b571706ba8d0fc0ebaae414869bf');assert.equal(Object.keys(proof.files).length,7);assert.equal(Object.keys(proof.addedFiles).length,2);
 for(const[file,row]of Object.entries(proof.files)){const before=git('show',proof.base+':'+file);assert.equal(sha(before),row.baselineSha256);assert.equal(restore(read(file),file),before);assert.throws(()=>restore(read(file)+'\n// unreviewed change\n',file),/Only the reviewed Staff self-repair/);}
 for(const[file,pin]of Object.entries(proof.addedFiles)){assert.equal(git('ls-tree',proof.base,'--',file),'');assert.equal(sha(read(file)),pin);}
});
test('reset-pending entry checks hold before any normal PIN query, local selection mutation or private grant action',async()=>{
 const app=read('takodeal-staff/app.js');let checks=0,opened=0;
 const context={window:{staffSelfRepair:{requiresCode:()=>true,open:()=>opened++},startStaffDeviceSetup:()=>checks++},document:{getElementById(){throw Error('Do not read the daily PIN or private UI during unfinished handoff');}},localStorage:{getItem(){throw Error('Do not restore a local staff selection during unfinished handoff');}}};
 for(const name of ['checkNormalLogin','loginStaff']){const from=app.indexOf('window.'+name+' = '),to=app.indexOf('\n};',from);assert.ok(from>0&&to>from);vm.runInNewContext(app.slice(from,to+3),context);}
 assert.equal(context.window.checkNormalLogin(),false);assert.equal(await context.window.loginStaff(),false);assert.equal(checks,1);assert.equal(opened,1);
});
test('actual app wiring uses existing primary SDK handles and only rechecks setup for matching completed handoff',()=>{
 const appSource=read('takodeal-staff/app.js'),from=appSource.indexOf('if(window.staffSelfRepair){\n    let repairStateKey='),to=appSource.indexOf('\ninstallStaffRegistration(',from);assert.ok(from>0&&to>from);
 let listener,configured,invalidations=0,starts=0,calls=0,pending=false;const app={},db={},auth={currentUser:{uid:'new-primary'}},values=new Map([['takodeal_device_id','DEV-NEW-123456']]),sdkMethod=()=>{};
 const context={window:{addEventListener:(name,fn)=>{assert.equal(name,'takodeal-staff-repair-state');listener=fn;},staffSelfRepair:{requiresCode:()=>pending,configureSDK:value=>configured=value},staffSetupAccess:{invalidate:()=>invalidations++},startStaffDeviceSetup:()=>starts++},app,db,staffPrimaryAuth:auth,firebaseConfig:{projectId:'fictional'},createStaffSelfRepairSDK:input=>{calls++;assert.equal(input.app,app);assert.equal(input.auth,auth);assert.equal(input.db,db);assert.equal(input.sdk.updateCurrentUser,sdkMethod);assert.equal(input.sdk.waitForPendingWrites,sdkMethod);return {fixture:'actual-wiring'};},readInitializedStaffDocumentClient:()=>{throw Error('The integration must not initialize/read private Auth merely to configure');},getApps:sdkMethod,initializeApp:sdkMethod,getAuth:sdkMethod,setPersistence:sdkMethod,browserLocalPersistence:{},signInAnonymously:sdkMethod,updateCurrentUser:sdkMethod,waitForPendingWrites:sdkMethod,localStorage:{getItem:key=>values.get(key)||null}};
 vm.runInNewContext(appSource.slice(from,to),context);assert.equal(calls,1);assert.deepEqual(configured,{fixture:'actual-wiring'});assert.equal(starts,0);
 values.set('takodeal_staff_self_repair_v1',JSON.stringify({phase:'complete',candidateUid:'foreign',candidateDeviceId:'DEV-NEW-123456',operationId:'op-one'}));listener();assert.equal(starts,0);
 values.set('takodeal_staff_self_repair_v1',JSON.stringify({phase:'complete',candidateUid:'new-primary',candidateDeviceId:'DEV-NEW-123456',operationId:'op-one'}));listener();listener();assert.equal(starts,1);assert.equal(invalidations,1);
 pending=true;listener();assert.equal(starts,2);assert.equal(invalidations,2);
});
test('classic repair and startup are exact parser-inline copies before dependencies and all four entry points need no SDK',()=>{
 const page=read('takodeal-staff/index.html'),startup=read('takodeal-staff/staff-startup.js'),repair=read('takodeal-staff/staff-self-repair.js'),firstLink=page.indexOf('<link');
 for(const runtime of [startup,repair]){const inline='<script>'+runtime+'</script>';assert.equal(page.split(inline).length,2);assert.ok(page.indexOf(inline)<firstLink);}
 assert.equal((page.match(/data-staff-self-repair>/g)||[]).length,4);assert.doesNotMatch(page,/<script[^>]+src=["']staff-self-repair\.js/);assert.doesNotMatch(repair,/^\s*(?:import|export)\s/m);
 assert.match(page,/app\.js\?v=staff-self-repair-swaps-20261112-r1/);assert.ok(read('takodeal-staff/sw.js').includes('./staff-self-repair-sdk.js'));
});
test('other apps, backend/rules, normal punching/upload code and separate private identity remain byte-exact to live b576',()=>{
 const changed=git('diff','--name-only',proof.base,'--','Takodeal-POS','takodeal-manager','takodeal-customer','takodeal-rider','takodeal-franchise','functions','firestore.rules','storage.rules');assert.equal(changed,'');
 for(const file of ['takodeal-staff/clock-upload-access.js','takodeal-staff/attendance-camera.js','takodeal-staff/attendance-proof.js','takodeal-staff/staff-registration.js','takodeal-staff/staff-access.js','takodeal-staff/private-phone-identity.js','takodeal-staff/schedule-swap-model.js'])assert.equal(read(file),git('show',proof.base+':'+file));
 const handler=source=>{const from=source.indexOf('window.punchTime = async function'),to=source.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',from);assert.ok(from>0&&to>from);return source.slice(from,to);};assert.equal(handler(read('takodeal-staff/app.js')),handler(git('show',proof.base+':takodeal-staff/app.js')));
});
