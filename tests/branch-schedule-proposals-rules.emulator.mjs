// Full candidate Rules, loopback-only emulator and synthetic records.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8803,projectId='demo-branch-schedule-proposals',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,query,where,writeBatch,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const s=createConnection({host,port});s.setTimeout(250);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied test emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();});
const anon=()=>env.authenticatedContext('sample-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const publicDB=()=>env.unauthenticatedContext().firestore();
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const r=(db,id='DEV-SAMPLE-PHONE')=>doc(db,'pos_devices',id);
const legacy={deviceId:'DEV-SAMPLE-PHONE',deviceName:'SAMPLE phone',branch:'SAMPLE Branch',appType:'Staff',status:'Pending'};
const reserved={...legacy,setupVersion:1,setupUid:'sample-phone',staffId:'sample-staff',status:'Active'};
const roots=['staff_setup_credentials','staff_app_setup_config','staff_app_bindings','staff_app_device_index','staff_setup_audit','staff_setup_operations','staff_setup_attempts','staff_setup_device_slots'];


const proposalId='sample-proposal',proposalPath='branch_schedule_proposals/'+proposalId;
const pending={schemaVersion:1,proposal:{id:proposalId,branch:'SAMPLE Branch',month:'2026-10',from:'2026-10-25',to:'2026-10-26'},intent:'sample-hash',status:'Pending',submittedBy:{uid:'sample-phone',staffId:'sample-staff',staffName:'Sample Staff',deviceId:'DEV-SAMPLE-POS'},submittedAt:'2026-10-25T12:00:00Z',reviewedAt:null,reviewedByUid:null,reviewedByEmail:null,reviewNote:'',revisionId:null};
const review=(db,decision='Rejected',overrides={})=>({...pending,status:decision,reviewedAt:sdk.serverTimestamp(),reviewedByUid:'sample-owner',reviewedByEmail:'jgo031996@gmail.com',reviewNote:'Sample reviewed explanation',revisionId:decision==='Approved'?'proposal-'+proposalId:null,...overrides});
const revision={source:'cashier-schedule-proposal',branchScheduleProposalId:proposalId,actor:'jgo031996@gmail.com',month:'2026-10',effectiveFrom:'2026-10-25',effectiveTo:'2026-10-26'};
const proposalRef=db=>doc(db,proposalPath),revisionRef=db=>doc(db,'settings/schedule_revision_proposal-'+proposalId);
const sampleSeed=()=>admin(db=>setDoc(proposalRef(db),pending));
test('all browser identities are denied proposal creation and deletion',async()=>{
 await admin(db=>setDoc(doc(db,'pos_bindings/sample-phone'),{uid:'sample-phone',status:'Active',branch:'SAMPLE Branch'}));
 for(const db of [publicDB(),anon(),owner()])await assertFails(setDoc(proposalRef(db),pending));
 await sampleSeed();for(const db of [publicDB(),anon(),owner()])await assertFails(deleteDoc(proposalRef(db)));
});
test('verified Owner reads proposals; unauthenticated, unrelated and unapproved devices cannot',async()=>{
 await sampleSeed();await assertSucceeds(getDocFromServer(proposalRef(owner())));const listed=await assertSucceeds(getDocsFromServer(collection(owner(),'branch_schedule_proposals')));assert.equal(listed.size,1);
 for(const db of [publicDB(),anon(),env.authenticatedContext('unrelated',{email:'other@example.com',email_verified:true}).firestore(),env.authenticatedContext('unverified-owner',{email:'jgo031996@gmail.com',email_verified:false}).firestore()])await assertFails(getDocFromServer(proposalRef(db)));
});
test('approved same-UID branch tablet reads only its own submitted proposals',async()=>{
 await sampleSeed();await admin(db=>setDoc(doc(db,'pos_bindings/sample-phone'),{status:'Active',branch:'SAMPLE Branch'}));await assertSucceeds(getDocFromServer(proposalRef(anon())));
 await admin(db=>updateDoc(doc(db,'pos_bindings/sample-phone'),{branch:'OTHER Branch'}));await assertFails(getDocFromServer(proposalRef(anon())));
 await admin(db=>updateDoc(doc(db,'pos_bindings/sample-phone'),{branch:'SAMPLE Branch',status:'Revoked'}));await assertFails(getDocFromServer(proposalRef(anon())));
});

test('same-branch tablets cannot read another tablet submission or list proposals without scope filters',async()=>{
 await sampleSeed();await admin(async db=>{await setDoc(doc(db,'pos_bindings/sample-phone'),{uid:'sample-phone',status:'Active',branch:'SAMPLE Branch'});await setDoc(doc(db,'branch_schedule_proposals/other-proposal'),{...pending,proposal:{...pending.proposal,id:'other-proposal'},submittedBy:{...pending.submittedBy,uid:'other-phone'}});});
 const db=anon();await assertFails(getDocFromServer(doc(db,'branch_schedule_proposals/other-proposal')));await assertFails(getDocsFromServer(collection(db,'branch_schedule_proposals')));
 const own=await assertSucceeds(getDocsFromServer(query(collection(db,'branch_schedule_proposals'),where('proposal.branch','==','SAMPLE Branch'),where('submittedBy.uid','==','sample-phone'))));assert.equal(own.size,1);
});
test('all browser identities including verified Owner are denied direct decisions',async()=>{
 await admin(db=>setDoc(doc(db,'pos_bindings/sample-phone'),{uid:'sample-phone',status:'Active',branch:'SAMPLE Branch'}));
 await sampleSeed();for(const db of [publicDB(),anon(),env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:false}).firestore(),env.authenticatedContext('sample-manager',{email:'manager@example.com',email_verified:true}).firestore()])await assertFails(setDoc(proposalRef(db),review(db)));
 for(const decision of ['Rejected','Approved'])await assertFails(setDoc(proposalRef(owner()),review(owner(),decision)));
});
test('direct review cannot alter original proposal, origin, reason or submission timestamp',async()=>{
 await sampleSeed();const db=owner();for(const change of [{proposal:{...pending.proposal,branch:'OTHER'}},{submittedBy:{...pending.submittedBy,staffName:'Forged'}},{intent:'altered'},{submittedAt:'2030-01-01'}])await assertFails(setDoc(proposalRef(db),review(db,'Rejected',change)));
});
test('direct review remains forbidden with forged attribution, time or explanation',async()=>{
 await sampleSeed();const db=owner();for(const change of [{reviewedByUid:'forged'},{reviewedByEmail:'manager@example.com'},{reviewedAt:new Date(0)},{reviewNote:'x'},{status:'Pending'},{revisionId:'invented'}])await assertFails(setDoc(proposalRef(db),review(db,'Rejected',change)));
});
test('a client cannot approve even with a newly-created matching schedule revision in the same batch',async()=>{
 await sampleSeed();const db=owner();await assertFails(setDoc(proposalRef(db),review(db,'Approved')));
 for(const change of [{source:'manager-save'},{branchScheduleProposalId:'wrong'},{actor:'wrong@example.com'},{month:'2026-11'},{effectiveFrom:'2026-10-24'},{effectiveTo:'2026-10-27'}]){const batch=writeBatch(db);batch.set(proposalRef(db),review(db,'Approved'));batch.set(revisionRef(db),{...revision,...change});await assertFails(batch.commit());}
 const batch=writeBatch(db);batch.set(proposalRef(db),review(db,'Approved'));batch.set(revisionRef(db),revision);await assertFails(batch.commit());assert.equal((await getDocFromServer(revisionRef(db))).exists(),false);
});
test('an existing stale revision cannot be reused to label a proposal approved',async()=>{
 await sampleSeed();await admin(db=>setDoc(revisionRef(db),revision));const db=owner();await assertFails(setDoc(proposalRef(db),review(db,'Approved')));
});
test('a decided proposal is immutable even to Owner',async()=>{
 await admin(db=>setDoc(proposalRef(db),{...review(db),reviewedAt:new Date('2026-10-25T12:30:00Z')}));const db=owner();await assertSucceeds(getDocFromServer(proposalRef(db)));await assertFails(updateDoc(proposalRef(db),{reviewNote:'Changed after decision',reviewedAt:sdk.serverTimestamp()}));await assertFails(setDoc(proposalRef(db),review(db,'Approved')));await assertFails(deleteDoc(proposalRef(db)));
});
test('service operation receipts, rate counters and nested records stay private',async()=>{
 for(const table of ['branch_schedule_proposal_operations','branch_schedule_proposal_review_operations','branch_schedule_proposal_attempts']){
  await admin(db=>setDoc(doc(db,table,'sample'),{sample:true}));
  for(const db of [publicDB(),anon(),owner()]){await assertFails(getDocFromServer(doc(db,table,'sample')));await assertFails(getDocsFromServer(collection(db,table)));await assertFails(setDoc(doc(db,table,'new'),{sample:true}));await assertFails(updateDoc(doc(db,table,'sample'),{sample:false}));await assertFails(deleteDoc(doc(db,table,'sample')));await assertFails(setDoc(doc(db,table+'/sample/nested/child'),{sample:true}));}
 }
});
