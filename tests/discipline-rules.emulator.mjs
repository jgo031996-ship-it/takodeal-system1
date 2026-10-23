// Full production Rules, isolated local emulator and synthetic records only.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {issueDisciplineCase,reviewDisciplineCase,cancelDisciplineCase,saveDisciplinePolicy,readDisciplineContext} from '../takodeal-manager/discipline-actions.js';
import {acknowledgeSanction,phDay} from '../takodeal-manager/sanction-schedule.js';
import {normalizeDisciplinePolicy} from '../takodeal-manager/discipline-case-model.js';

const host='127.0.0.1',port=8794,projectId='demo-discipline-case-review',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),requireTools=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=requireTools('@firebase/rules-unit-testing'),sdk=requireTools('firebase/firestore');
const {doc,collection,query,where,orderBy,limit,getDocsFromServer,getDocFromServer,runTransaction,serverTimestamp,setDoc,updateDoc,deleteDoc,writeBatch}=sdk;sdk.setLogLevel('silent');
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(300);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const deadline=Date.now()+25000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error('Emulator startup failed: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:40000});
after(async()=>{if(process.env.DISCIPLINE_RULE_COVERAGE==='1'&&env)writeFileSync(resolve(root,'../discipline-rule-coverage.json'),await fetch('http://'+endpoint+'/emulator/v1/projects/'+projectId+':ruleCoverage').then(response=>response.text()));await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
const ownerEmail='jgo031996@gmail.com',managerEmail='discipline-manager@example.test',staffId='sample-discipline-staff',staffName='SAMPLE Discipline Crew',branch='Sample Branch';
const owner=()=>env.authenticatedContext('sample-owner',{email:ownerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const manager=()=>env.authenticatedContext('sample-manager',{email:managerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const anon=()=>env.authenticatedContext('sample-pin-browser',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const read=path=>getDocFromServer(doc(owner(),path)).then(snapshot=>snapshot.data());
function api(db=owner(),isOwner=true){const uid=isOwner?'sample-owner':'sample-manager',email=isOwner?ownerEmail:managerEmail;return {db,doc,collection,query,where,orderBy,limit,getDocsFromServer,getDocFromServer,runTransaction,serverTimestamp,auth:{currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid,email,isOwner,isFranchisee:false,role:isOwner?'Owner':'Manager',permissions:isOwner?['all']:['sanctions'],allowedBranches:isOwner?['All']:[branch]}};}
beforeEach(async()=>{await env.clearFirestore();await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'hq_managers/sample-owner-record'),{email:ownerEmail,role:'Owner',permissions:['all'],assignedBranch:'All',active:true,pin:'SAMPLE-OWNER'});batch.set(doc(db,'hq_managers/sample-manager-record'),{email:managerEmail,role:'Manager',permissions:['sanctions'],assignedBranch:branch,active:true,pin:'SAMPLE-MANAGER'});batch.set(doc(db,'hq_email_access',managerEmail),{active:true,permissions:['sanctions'],allowedBranches:[branch]});batch.set(doc(db,'cashiers',staffId),{cashierName:staffName,branch,active:true,pin:'SAMPLE-STAFF'});await batch.commit();});});
const input=(type='Attendance')=>({staffId,staffName,branch,type,details:'SAMPLE incident requiring an explanation and evidence review.',effectiveDate:phDay(),proposedLevelId:null});
async function issue(a=api(),id='case-'+crypto.randomUUID(),type){await issueDisciplineCase(a,input(type),{id});return {id,row:await read('hr_sanctions/'+id)};}
async function reply(id,db=anon()){const a={db,doc,runTransaction,serverTimestamp};return acknowledgeSanction(a,{id,staffName,reply:'SAMPLE staff explanation: please review the incident evidence.',signature:'data:image/png;base64,U0FNUExF'},{identity:()=>({staffId,staffName})});}
const decision=(overrides={})=>({outcome:'Confirmed',levelId:'written-warning',effectiveDate:phDay(),reason:'SAMPLE management finding after evidence and staff response review.',expectedRevision:0,...overrides});
async function reviewed(a=api(),id){const result=await issue(a,id);await reply(result.id);await reviewDisciplineCase(a,result.id,decision(),{changeId:'review-'+crypto.randomUUID()});return {id:result.id,row:await read('hr_sanctions/'+result.id)};}
async function rawPair(source,{db=owner(),mutateNotice=()=>{},mutateCounter=()=>{},caseOnly=false,counterOnly=false}={}){
 const id='raw-'+crypto.randomUUID(),old=await read('settings/discipline_case_'+staffId),at=serverTimestamp();
 const notice={...source,caseNumber:(old?.lastCaseNumber||0)+1,timestamp:at,issuedAt:at,scheduleAudit:{issued:{oldDate:null,newDate:phDay(),reason:'Notice issued',actorUid:'sample-owner',actorEmail:ownerEmail,at}}};
 const counter={version:1,staffId,staffName,branch,lastCaseNumber:notice.caseNumber,lastCaseId:id,seededLegacyCount:old?.seededLegacyCount||0,updatedAt:at,updatedByUid:'sample-owner',updatedByEmail:ownerEmail};
 mutateNotice(notice);mutateCounter(counter);const batch=writeBatch(db);if(!counterOnly)batch.set(doc(db,'hr_sanctions',id),notice);if(!caseOnly)batch.set(doc(db,'settings','discipline_case_'+staffId),counter);return batch.commit();
}
async function rawReviewData(id,overrides={}){
 const row=await read('hr_sanctions/'+id),revision=(await read('settings/discipline_policy'))?.revision||0;
 return {status:'Reviewed',finding:'Confirmed',reviewedAction:{id:'written-warning',label:'Written warning',suspensionDays:0,effectiveDate:phDay(),policyRevision:revision},reviewReason:'SAMPLE complete management finding after response.',reviewedByUid:'sample-owner',reviewedByEmail:ownerEmail,reviewedAt:serverTimestamp(),decisionRevision:row.decisionRevision+1,reviewChangeId:'raw-review-'+crypto.randomUUID(),reviewIntent:'SAMPLE raw review intent',relatedCaseIds:[],...overrides};
}
async function rawReview(id,overrides={},db=owner()){return updateDoc(doc(db,'hr_sanctions',id),await rawReviewData(id,overrides));}

test('actual Owner service issues one atomic continuous sequence across types and retains legacy/cancelled records',async()=>{
 await admin(db=>Promise.all([setDoc(doc(db,'hr_sanctions/legacy-first'),{staffName,branch,type:'Conduct',status:'Cancelled'}),setDoc(doc(db,'hr_sanctions/legacy-second'),{staffName,branch,type:'Food safety',status:'Resolved',caseNumber:8})]));
 const a=api(),first=await issue(a,'first-new','Attendance');assert.equal(first.row.caseNumber,9);assert.equal(first.row.finding,'Pending');assert.equal(first.row.status,'Pending Reply');
 await cancelDisciplineCase(a,first.id,{expectedRevision:0,reason:'SAMPLE incident withdrawn before review.'},{changeId:'cancel-first'});
 const second=await issue(a,'second-new','Food safety');assert.equal(second.row.caseNumber,10);assert.equal((await read('settings/discipline_case_'+staffId)).seededLegacyCount,2);
 const context=await readDisciplineContext(a,{id:staffId});assert.equal(context.history.totalCases,4);assert.equal(context.history.confirmedCount,0);assert.equal(context.nextCaseNumber,11);
 const repeat=await issueDisciplineCase(a,input('Food safety'),{id:second.id});assert.equal(repeat.alreadySaved,true);assert.equal((await read('settings/discipline_case_'+staffId)).lastCaseNumber,10);
});
test('actual scoped Manager issues, Staff replies, and management records a confirmed explicit action',async()=>{
 const a=api(manager(),false),first=await issue(a);await assertSucceeds(reply(first.id));await assertSucceeds(reviewDisciplineCase(a,first.id,decision(),{changeId:'manager-review'}));
 const saved=await read('hr_sanctions/'+first.id);assert.equal(saved.finding,'Confirmed');assert.equal(saved.status,'Reviewed');assert.equal(saved.reviewedByUid,'sample-manager');assert.equal(saved.reviewedAction.suspensionDays,0);
 await assertSucceeds(cancelDisciplineCase(a,first.id,{expectedRevision:1,reason:'SAMPLE close and archive the completed case.'},{changeId:'manager-archive'}));
 const archived=await read('hr_sanctions/'+first.id);assert.equal(archived.status,'Archived');assert.equal(archived.finding,'Confirmed');assert.deepEqual(archived.reviewedAction,saved.reviewedAction);
});
test('a finding not established records no disciplinary action and cannot later be changed to confirmed',async()=>{
 const a=api(),first=await issue(a);await reply(first.id);await assertSucceeds(reviewDisciplineCase(a,first.id,decision({outcome:'Not established',levelId:null}),{changeId:'not-established'}));
 const row=await read('hr_sanctions/'+first.id);assert.equal(row.reviewedAction.id,'none');assert.equal(row.reviewedAction.suspensionDays,0);await assertFails(rawReview(first.id));
});
test('Owner policy edits affect future choices and preserve existing reviewed action snapshots',async()=>{
 const a=api(),first=await reviewed(a),before=await read('hr_sanctions/'+first.id),levels=normalizeDisciplinePolicy().levels.map(level=>level.id==='suspension-7'?{...level,label:'One day after review',suspensionDays:1}:level);
 await assertSucceeds(saveDisciplinePolicy(a,{expectedRevision:0,levels},{changeId:'policy-one'}));assert.deepEqual(await read('hr_sanctions/'+first.id),before);
 const second=await issue(a);await reply(second.id);await assertSucceeds(reviewDisciplineCase(a,second.id,decision({levelId:'suspension-7'}),{changeId:'review-reduced'}));
 assert.equal((await read('hr_sanctions/'+second.id)).reviewedAction.suspensionDays,1);
 await assertFails(updateDoc(doc(a.db,'settings/discipline_policy'),{revision:1}));await assertFails(deleteDoc(doc(a.db,'settings/discipline_policy')));
});
test('twenty custom levels fit the actual Rules evaluation budget and duplicate IDs are rejected',async()=>{
 const a=api(),levels=Array.from({length:20},(_,i)=>({id:'level-'+i,label:'SAMPLE action '+i,suspensionDays:i}));await assertSucceeds(saveDisciplinePolicy(a,{expectedRevision:0,levels},{changeId:'maximum-policy'}));
 const saved=await read('settings/discipline_policy');await assertFails(setDoc(doc(a.db,'settings/discipline_policy'),{...saved,revision:2,levels:[levels[0],{...levels[1],id:levels[0].id}],changeId:'bad-duplicate',intent:'SAMPLE bad duplicate',updatedAt:serverTimestamp()}));
});
test('policy and reserved discipline settings cannot use the broad legacy settings grant',async()=>{
 const a=api();await saveDisciplinePolicy(a,{expectedRevision:0,levels:normalizeDisciplinePolicy().levels},{changeId:'first-policy'});const saved=await read('settings/discipline_policy');
 for(const db of [manager(),anon(),env.unauthenticatedContext().firestore(),env.authenticatedContext('unverified-owner',{email:ownerEmail,email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore()]){
  await assertFails(setDoc(doc(db,'settings/discipline_policy'),{...saved,revision:2,changeId:'forged',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'settings/discipline_unknown'),{version:1}));await assertFails(deleteDoc(doc(db,'settings/discipline_policy')));
 }
});
test('a standalone case, standalone counter, skipped increment and reset seed are rejected atomically',async()=>{
 const first=await issue();await assertFails(rawPair(first.row,{caseOnly:true}));await assertFails(rawPair(first.row,{counterOnly:true}));
 await assertFails(rawPair(first.row,{mutateNotice:r=>r.caseNumber+=3,mutateCounter:r=>r.lastCaseNumber+=3}));
 await assertFails(rawPair(first.row,{mutateCounter:r=>r.seededLegacyCount++}));assert.equal((await read('settings/discipline_case_'+staffId)).lastCaseNumber,1);
});
test('raw case creates cannot add a finding, payroll charge, forged actor, wrong identity or unapproved action',async()=>{
 const first=await issue();for(const mutateNotice of [r=>r.finding='Confirmed',r=>r.amount=100,r=>r.deductionId='forged',r=>r.issuedByUid='another-owner',r=>r.staffId='another-staff',r=>r.staffName='Another Crew',r=>r.branch='Foreign Branch',r=>r.proposedSeverity={id:'forged',label:'999 days suspension',suspensionDays:366}]) await assertFails(rawPair(first.row,{mutateNotice}));
});
test('unapproved, revoked, wrong-branch and anonymous actors cannot create or decide a v2 case',async()=>{
 const first=await issue();
 for(const db of [anon(),env.unauthenticatedContext().firestore(),env.authenticatedContext('foreign',{email:'foreign@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore(),env.authenticatedContext('unverified',{email:ownerEmail,email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore()]) await assertFails(rawPair(first.row,{db}));
 await reply(first.id);const managerActor={reviewedByUid:'sample-manager',reviewedByEmail:managerEmail};
 await admin(db=>setDoc(doc(db,'hq_email_access',managerEmail),{active:false,permissions:['sanctions'],allowedBranches:[branch]}));await assertFails(rawReview(first.id,managerActor,manager()));
 await admin(db=>setDoc(doc(db,'hq_email_access',managerEmail),{active:true,permissions:['sanctions'],allowedBranches:['Foreign Branch']}));await assertFails(rawReview(first.id,managerActor,manager()));
 await admin(db=>setDoc(doc(db,'hq_email_access',managerEmail),{active:true,permissions:['inbox'],allowedBranches:[branch]}));await assertFails(rawReview(first.id,managerActor,manager()));
 await admin(db=>setDoc(doc(db,'hq_email_access',managerEmail),{active:true,permissions:['sanctions'],allowedBranches:[branch]}));await assertSucceeds(rawReview(first.id,managerActor,manager()));
});
test('signed-in PIN compatibility permits only the explanation/signature transition; a reply cannot decide or change identity',async()=>{
 const first=await issue(),db=anon(),valid={status:'Replied',staffReply:'SAMPLE complete explanation for management.',signatureBase64:'SAMPLE signature',repliedAt:serverTimestamp(),replyByStaffId:staffId,replyScheduleRevision:1};
 for(const patch of [{finding:'Confirmed'},{staffId:'other-person'},{branch:'Foreign Branch'},{severity:'Termination'},{decisionRevision:1},{amount:500},{reviewedAction:{suspensionDays:14}}]) await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{...valid,...patch}));
 await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(),'hr_sanctions',first.id),valid));await assertSucceeds(updateDoc(doc(db,'hr_sanctions',first.id),valid));
 await assertFails(rawReview(first.id,{},db));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{staffReply:'SAMPLE rewritten explanation'}));
});
test('only a current replied case can receive a finding and a verified management actor/time',async()=>{
 const first=await issue();await assertFails(rawReview(first.id));await reply(first.id);
 for(const patch of [{reviewedByUid:'other-owner'},{reviewedByEmail:'other@example.test'},{reviewedAt:new Date('2000-01-01')},{reviewReason:'Short'},{decisionRevision:3},{status:'Resolved'},{type:'Another incident'},{caseNumber:99},{effectiveDate:'2000-01-01'}]) await assertFails(rawReview(first.id,patch));
 await assertSucceeds(rawReview(first.id));await assertFails(rawReview(first.id,{reviewReason:'SAMPLE changed finding after decision.'}));
});
test('reviewed action must match the current saved policy exactly and use a current effective date',async()=>{
 const first=await issue();await reply(first.id);const base={id:'written-warning',label:'Written warning',suspensionDays:0,effectiveDate:phDay(),policyRevision:0};
 for(const reviewedAction of [{...base,suspensionDays:14},{...base,label:'Forged action'},{...base,policyRevision:8},{...base,effectiveDate:'2000-01-01'},{...base,effectiveDate:'2030-02-31'},{...base,suspensionDays:'0'}]) await assertFails(rawReview(first.id,{reviewedAction}));
 await saveDisciplinePolicy(api(),{expectedRevision:0,levels:normalizeDisciplinePolicy().levels},{changeId:'policy-changed'});await assertFails(rawReview(first.id,{reviewedAction:base}));await assertSucceeds(rawReview(first.id));
});
test('case identity/history cannot be deleted, rewritten, downgraded to legacy or upgraded from legacy',async()=>{
 const first=await issue(),db=owner();await assertFails(deleteDoc(doc(db,'hr_sanctions',first.id)));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{caseVersion:1}));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{details:'SAMPLE silently changed incident'}));
 await admin(db=>setDoc(doc(db,'hr_sanctions/legacy'),{staffName,branch,status:'Replied'}));await assertFails(setDoc(doc(db,'hr_sanctions/legacy'),first.row));
 await assertFails(deleteDoc(doc(db,'settings/discipline_case_'+staffId)));await assertFails(updateDoc(doc(db,'settings/discipline_case_'+staffId),{lastCaseNumber:0}));
});
test('cancellation requires management, a new revision and a reason while preserving review evidence',async()=>{
 const first=await reviewed(),db=owner(),valid={status:'Archived',decisionRevision:2,cancelChangeId:'cancel-reviewed',cancelIntent:'SAMPLE cancellation intent',cancelReason:'SAMPLE archive after management review.',cancelledAt:serverTimestamp(),cancelledByUid:'sample-owner',cancelledByEmail:ownerEmail};
 await assertFails(updateDoc(doc(anon(),'hr_sanctions',first.id),valid));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{...valid,finding:'Not established'}));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{...valid,reviewedAction:null}));await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{...valid,cancelReason:'Short'}));
 await assertSucceeds(updateDoc(doc(db,'hr_sanctions',first.id),valid));assert.deepEqual((await read('hr_sanctions/'+first.id)).reviewedAction,first.row.reviewedAction);await assertFails(updateDoc(doc(db,'hr_sanctions',first.id),{...valid,decisionRevision:3}));
});
for(const reviewer of ['Owner','Manager'])test(reviewer+': five confirmed related cases fit Rules limits; pending/foreign/self/duplicate links are rejected',async()=>{
 const related=[];for(let index=0;index<5;index++)related.push((await reviewed(api(),'related-'+index)).id);
 const reviewingApi=reviewer==='Owner'?api():api(manager(),false);
 const first=await issue(reviewingApi);await reply(first.id);await assertSucceeds(reviewDisciplineCase(reviewingApi,first.id,decision({relatedCaseIds:related}),{changeId:'review-five-related'}));
 const second=await issue();await reply(second.id);const pending=await issue();
 await assertFails(rawReview(second.id,{relatedCaseIds:[pending.id]}));await assertFails(rawReview(second.id,{relatedCaseIds:[second.id]}));await assertFails(rawReview(second.id,{relatedCaseIds:[related[0],related[0]]}));
 await admin(db=>setDoc(doc(db,'hr_sanctions/foreign-related'),{...first.row,staffId:'foreign-staff',caseKey:'foreign-staff',status:'Reviewed',finding:'Confirmed'}));await assertFails(rawReview(second.id,{relatedCaseIds:['foreign-related']}));
});
test('a null proposed action still requires the current policy revision at issue',async()=>{
 const first=await issue();assert.equal(first.row.proposedSeverity,null);await assertFails(rawPair(first.row,{mutateNotice:row=>row.policyRevisionAtIssue=99}));
});
test('an atomic policy change and decision must match the final committed policy',async()=>{
 const first=await issue();await reply(first.id);const db=owner(),newLevel={id:'written-warning',label:'SAMPLE current renamed warning',suspensionDays:0};
 const policy={version:1,revision:1,levels:[newLevel],changeId:'atomic-policy',intent:'SAMPLE policy change',updatedAt:serverTimestamp(),updatedByUid:'sample-owner',updatedByEmail:ownerEmail};
 const stale=writeBatch(db);stale.set(doc(db,'settings/discipline_policy'),policy);stale.update(doc(db,'hr_sanctions',first.id),await rawReviewData(first.id));await assertFails(stale.commit());
 assert.equal(await read('settings/discipline_policy'),undefined);
 const current=writeBatch(db);current.set(doc(db,'settings/discipline_policy'),policy);current.update(doc(db,'hr_sanctions',first.id),await rawReviewData(first.id,{reviewedAction:{...newLevel,effectiveDate:phDay(),policyRevision:1}}));await assertSucceeds(current.commit());
});
test('Owner-only catalogue bounds do not allow a malformed chosen action to become a decision',async()=>{
 for(const level of [{id:'unsafe-label',label:'<img src=x onerror=alert(1)>',suspensionDays:0},{id:'unsafe-days',label:'SAMPLE out of range',suspensionDays:367},{id:'fractional',label:'SAMPLE fractional',suspensionDays:1.5},{id:'unsafe/id',label:'SAMPLE bad ID',suspensionDays:0}]){
  const first=await issue(),db=owner(),old=await read('settings/discipline_policy');
  await assertSucceeds(setDoc(doc(db,'settings/discipline_policy'),{version:1,revision:(old?.revision||0)+1,levels:[level],changeId:'malformed-'+crypto.randomUUID(),intent:'SAMPLE raw Owner catalogue boundary',updatedAt:serverTimestamp(),updatedByUid:'sample-owner',updatedByEmail:ownerEmail}));
  await reply(first.id);await assertFails(rawReview(first.id,{reviewedAction:{...level,effectiveDate:phDay(),policyRevision:(old?.revision||0)+1}}));
  // Restore with a raw, well-formed Owner policy so the next independent issue
  // still uses the actual service (which rejects malformed saved catalogues).
  await assertSucceeds(setDoc(doc(db,'settings/discipline_policy'),{version:1,revision:(old?.revision||0)+2,levels:normalizeDisciplinePolicy().levels,changeId:'restore-'+crypto.randomUUID(),intent:'SAMPLE restore valid catalogue',updatedAt:serverTimestamp(),updatedByUid:'sample-owner',updatedByEmail:ownerEmail}));
 }
});
test('ordinary legacy notices and unrelated settings keep the existing compatibility rules',async()=>{
 const db=anon();await assertSucceeds(setDoc(doc(db,'hr_sanctions/legacy-notice'),{staffName,branch,type:'Legacy',severity:'Warning',status:'Pending Reply'}));await assertSucceeds(updateDoc(doc(db,'hr_sanctions/legacy-notice'),{status:'Replied',staffReply:'SAMPLE legacy explanation'}));await assertSucceeds(setDoc(doc(db,'settings/ordinary-sample-setting'),{sample:true}));
});
