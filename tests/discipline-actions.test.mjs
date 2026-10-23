import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {readDisciplineContext,issueDisciplineCase,saveDisciplinePolicy,reviewDisciplineCase,cancelDisciplineCase} from '../takodeal-manager/discipline-actions.js';
import {DEFAULT_DISCIPLINE_POLICY} from '../takodeal-manager/discipline-case-model.js';
import {acknowledgeSanction,suspensionDates} from '../takodeal-manager/sanction-schedule.js';

const ownerEmail='jgo031996@gmail.com', branch='Sample Branch', staffId='sample-staff', staffName='Sample Employee';
const at=new Date('2026-10-23T04:00:00Z'), now=()=>at;
const clone=value=>structuredClone(value);
function fixture({owner=false}={}) {
    const h=firestoreHarness(), email=owner?ownerEmail:'reviewer@example.test';
    h.api.auth={currentUser:{uid:'reviewer-uid',email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
    h.api.sessionUser={uid:'reviewer-uid',email,isOwner:owner,isFranchisee:false,permissions:['sanctions'],allowedBranches:[branch],role:owner?'Owner':'Manager',cashierName:'Sample Reviewer'};
    h.api.getDocFromServer=async reference=>({id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>clone(h.get(reference.path)),metadata:{fromCache:false,hasPendingWrites:false}});
    h.put('hq_managers/reviewer',{email,role:owner?'Owner':'Manager',permissions:['sanctions'],assignedBranch:branch,pin:'test-only',active:true});
    h.put('hq_email_access/'+email,{active:true,permissions:['sanctions'],allowedBranches:[branch]});
    h.put('cashiers/'+staffId,{cashierName:staffName,branch,pin:'sample-pin',active:true});
    h.put('staff_deductions/saved',{staffId,amount:40,status:'Unpaid'});
    h.put('payroll_records/saved',{staffId,status:'Paid',frozenData:{netPay:3500}});
    h.put('cash_accounts/saved',{balance:10000});
    return h;
}
const input=extra=>({staffId,name:staffName,branch,type:'SOP procedure',details:'Please explain the missed sample procedure.',effectiveDate:'2026-10-24',evidencePhoto:'',proposedLevelId:null,...extra});
const issue=(h,id='new-case',extra={})=>issueDisciplineCase(h.api,input(extra),{id,now});
const review=(h,id='new-case',extra={},changeId='review-one')=>reviewDisciplineCase(h.api,id,{outcome:'Confirmed',levelId:'written-warning',effectiveDate:'2026-10-25',reason:'Management reviewed the saved explanation and evidence.',expectedRevision:0,...extra},{changeId,now});
const cancel=(h,id='new-case',extra={},changeId='cancel-one')=>cancelDisciplineCase(h.api,id,{expectedRevision:0,reason:'Management withdrew this sample notice.',...extra},{changeId,now});
const moneyState=h=>clone([...h.docs].filter(([path])=>/^(staff_deductions|cash_accounts|payroll_records|cashiers)\//.test(path)));
const casePaths=h=>[...h.docs.keys()].filter(path=>path.startsWith('hr_sanctions/'));
async function reply(h,id='new-case') {
    return acknowledgeSanction(h.api,{id,staffName,reply:'This is a complete sample staff explanation.',signature:'sample-signature'},{identity:()=>({staffId,staffName})});
}
function reviewedRow(extra={}) {
    return {staffId,staffName,branch,type:'SOP procedure',caseVersion:2,caseKey:staffId,caseNumber:1,status:'Reviewed',finding:'Confirmed',decisionRevision:1,
        reviewedAction:{id:'written-warning',label:'Written warning',suspensionDays:0,effectiveDate:'2026-10-23',policyRevision:0},
        reviewedByUid:'earlier-reviewer',reviewedByEmail:'earlier@example.test',reviewedAt:{seconds:1},reviewReason:'A prior separate management review.',...extra};
}

test('fresh context keeps all exact-identity incident types/statuses, excludes other IDs, and writes nothing',async()=>{
    const h=fixture();
    h.put('hr_sanctions/legacy-one',{staffName,branch,type:'Tardiness',severity:'3rd offense',status:'Cancelled'});
    h.put('hr_sanctions/legacy-two',{staffName,branch,type:'Cash issue',status:'Archived'});
    h.put('hr_sanctions/explicit-id',{staffId,staffName:'Previous saved name',branch:'Previous Branch',type:'Other issue',status:'Resolved',caseNumber:7});
    h.put('hr_sanctions/different-id',{staffId:'another-staff',staffName,branch,status:'Replied'});
    const before=clone([...h.docs]), context=await readDisciplineContext(h.api,{id:staffId,cashierName:staffName,branch});
    assert.equal(context.history.totalCases,3);assert.equal(context.nextCaseNumber,8);assert.equal(context.history.confirmedCount,0);
    assert.deepEqual(context.policy,DEFAULT_DISCIPLINE_POLICY);assert.equal(context.history.rows.find(row=>row.id==='legacy-one').findingLabel,'Finding not recorded');
    assert.deepEqual([...h.docs],before);assert.equal(context.staff.pin,undefined);
});

test('first issue seeds continuous case numbering from all legacy statuses and commits no money or profile changes',async()=>{
    const h=fixture();
    h.put('hr_sanctions/old-cancelled',{staffName,branch,type:'Old incident',status:'Cancelled'});
    h.put('hr_sanctions/old-closed',{staffId,staffName,branch,type:'Different incident',status:'Closed',caseNumber:5});
    const original=clone(h.get('hr_sanctions/old-cancelled')), money=moneyState(h), result=await issue(h,'new-case',{proposedLevelId:'suspension-3'});
    assert.equal(result.caseNumber,6);const row=h.get('hr_sanctions/new-case'),counter=h.get('settings/discipline_case_'+staffId);
    assert.equal(row.caseKey,staffId);assert.equal(row.caseVersion,2);assert.equal(row.finding,'Pending');assert.equal(row.status,'Pending Reply');
    assert.equal(row.severity,'Pending management review');assert.deepEqual(row.proposedSeverity,{id:'suspension-3',label:'3 days suspension',suspensionDays:3});
    assert.equal(row.policyRevisionAtIssue,0);assert.equal(row.decisionRevision,0);assert.equal(row.deductionId,undefined);assert.equal(row.amount,undefined);
    assert.equal(counter.lastCaseNumber,6);assert.equal(counter.seededLegacyCount,2);assert.equal(counter.lastCaseId,'new-case');
    assert.deepEqual(h.get('hr_sanctions/old-cancelled'),original);assert.deepEqual(moneyState(h),money);assert.deepEqual(suspensionDates(row),[]);
});

test('case numbers continue across different types and a cancelled notice without reusing its number',async()=>{
    const h=fixture();await issue(h,'first');await cancel(h,'first');await issue(h,'second',{type:'A different allegation'});
    assert.equal(h.get('hr_sanctions/first').caseNumber,1);assert.equal(h.get('hr_sanctions/first').status,'Cancelled');
    assert.equal(h.get('hr_sanctions/second').caseNumber,2);assert.equal((await readDisciplineContext(h.api,{id:staffId})).nextCaseNumber,3);
});

test('concurrent issuers get distinct consecutive numbers from one atomic stable-ID counter',async()=>{
    const h=fixture();h.put('hr_sanctions/legacy',{staffName,branch,status:'Cancelled'});
    const results=await Promise.all([issue(h,'one'),issue(h,'two',{type:'Another incident'})]);
    assert.deepEqual(results.map(row=>row.caseNumber).sort(),[2,3]);assert.equal(h.get('settings/discipline_case_'+staffId).lastCaseNumber,3);assert.ok(h.retries()>0);
});

test('failed issue commit leaves neither a notice nor its sequence; lost acknowledgment retry never consumes a second number',async()=>{
    const h=fixture();h.failNextCommit();await assert.rejects(issue(h),/rejected/);assert.equal(casePaths(h).length,0);assert.equal(h.get('settings/discipline_case_'+staffId),undefined);
    h.loseNextAck();await assert.rejects(issue(h),/lost/);const saved=clone(h.get('hr_sanctions/new-case')),counter=clone(h.get('settings/discipline_case_'+staffId));
    assert.equal((await issue(h)).alreadySaved,true);assert.deepEqual(h.get('hr_sanctions/new-case'),saved);assert.deepEqual(h.get('settings/discipline_case_'+staffId),counter);
    for(const changed of [{type:'Changed incident'},{details:'The details changed after the commit.'},{proposedLevelId:'verbal-warning'},{evidencePhoto:'different image'}]) await assert.rejects(issue(h,'new-case',changed),/different/);
});

test('same reference double-submit cannot overwrite saved issue snapshots after policy changes',async()=>{
    const h=fixture({owner:true});const first=await Promise.all([issue(h),issue(h)]);assert.equal(first.filter(row=>row.alreadySaved).length,1);
    await saveDisciplinePolicy(h.api,{levels:[{id:'new-choice',label:'New future action',suspensionDays:4}],expectedRevision:0},{changeId:'policy-one',now});
    assert.equal((await issue(h)).alreadySaved,true);assert.equal(h.get('hr_sanctions/new-case').policyRevisionAtIssue,0);assert.equal(h.get('settings/discipline_case_'+staffId).lastCaseNumber,1);
});

test('ambiguous same-name legacy records never get assigned to a stable ID; explicit-ID cases remain visible',async()=>{
    const h=fixture();h.put('cashiers/duplicate',{cashierName:staffName,branch,pin:'other'});
    h.put('hr_sanctions/ambiguous',{staffName,branch,status:'Pending Reply'});h.put('hr_sanctions/exact',{staffId,staffName,branch,status:'Cancelled'});
    const context=await readDisciplineContext(h.api,{id:staffId});assert.equal(context.legacyNameVerified,false);assert.equal(context.sequenceNeedsReview,true);assert.equal(context.history.totalCases,1);
    const before=clone([...h.docs]);await assert.rejects(issue(h),/Legacy notices share/);assert.deepEqual([...h.docs],before);
});

test('deleted or reassigned legacy seed records detected inside transaction do not create a guessed case sequence',async()=>{
    for(const mutation of [h=>h.docs.delete('hr_sanctions/legacy'),h=>h.put('hr_sanctions/legacy',{staffId:'other',staffName,branch,status:'Cancelled'})]) {
        const h=fixture();h.put('hr_sanctions/legacy',{staffName,branch,status:'Cancelled'});const run=h.api.runTransaction;
        h.api.runTransaction=(...args)=>{mutation(h);return run(...args);};await assert.rejects(issue(h),/changed/);assert.equal(h.get('hr_sanctions/new-case'),undefined);assert.equal(h.get('settings/discipline_case_'+staffId),undefined);
    }
});

test('cached or incomplete history and malformed sequence metadata fail closed',async()=>{
    const h=fixture(),read=h.api.getDocsFromServer;h.api.getDocsFromServer=async q=>({...await read(q),metadata:{fromCache:q.table==='hr_sanctions'}});
    await assert.rejects(issue(h),/complete saved history/);assert.equal(casePaths(h).length,0);
    const second=fixture();second.put('settings/discipline_case_'+staffId,{version:1,staffId,lastCaseNumber:-2,seededLegacyCount:0,lastCaseId:'old',staffName,branch});
    await assert.rejects(issue(second),/sequence/);
});

test('verified Google identity, saved permissions and protected branch grant are all required',async()=>{
    const mutations=[h=>h.api.auth.currentUser.emailVerified=false,h=>h.api.auth.currentUser.providerData=[],h=>h.api.sessionUser.uid='another-user',h=>h.api.sessionUser.isFranchisee=true,
        h=>h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),permissions:['inbox']}),h=>h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),active:false}),
        h=>h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),archived:true}),h=>h.put('hq_email_access/reviewer@example.test',{active:false,permissions:['sanctions'],allowedBranches:[branch]}),
        h=>h.put('hq_email_access/reviewer@example.test',{active:true,permissions:['sanctions'],allowedBranches:['Other Branch']})];
    for(const mutate of mutations) {const h=fixture();mutate(h);const before=clone([...h.docs]);await assert.rejects(issue(h));assert.deepEqual([...h.docs],before);}
});

test('permissions revoked or signed-in account changed after preflight are rechecked before every write',async()=>{
    for(const mutate of [h=>h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),permissions:[]}),h=>h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),email:''}),h=>h.put('hq_email_access/reviewer@example.test',{active:false}),h=>h.api.auth.currentUser.uid='another']) {
        const h=fixture(),run=h.api.runTransaction;h.api.runTransaction=(...args)=>{mutate(h);return run(...args);};await assert.rejects(issue(h));assert.equal(casePaths(h).length,0);assert.equal(h.get('settings/discipline_case_'+staffId),undefined);
    }
});

test('conflicting duplicate HQ PINs and newest saved permission revocation are not bypassed by a local session',async()=>{
    for(const extra of [{pin:'conflicting-pin'},{pin:'test-only',permissions:[],permissionsUpdatedAt:{seconds:2}}]) {
        const h=fixture();h.put('hq_managers/new-duplicate',{...h.get('hq_managers/reviewer'),...extra});await assert.rejects(issue(h));assert.equal(casePaths(h).length,0);
    }
});

test('existing HQ and legacy notice document IDs may contain valid Firestore punctuation without changing their identity',async()=>{
    const h=fixture(),account=clone(h.get('hq_managers/reviewer'));h.docs.delete('hq_managers/reviewer');h.put('hq_managers/reviewer@example.test',account);
    h.put('hr_sanctions/legacy.notice',{staffName,branch,type:'Earlier incident',status:'Cancelled'});
    await issue(h);assert.equal(h.get('hr_sanctions/new-case').caseNumber,2);assert.equal(h.get('hr_sanctions/legacy.notice').status,'Cancelled');
});

test('invalid notice inputs, nonzero monetary actions and stale staff assignments produce no writes',async()=>{
    for(const extra of [{staffId:'bad/id'},{name:'Another employee'},{branch:'Other Branch'},{type:''},{details:'short'},{effectiveDate:'2026-02-29'},{effectiveDate:'2026-10-22'},{amount:50},{amount:'invalid'},{deductionId:'other'},{proposedLevelId:'missing'}]) {
        const h=fixture(),before=clone([...h.docs]);await assert.rejects(issue(h,'new-case',extra));assert.deepEqual([...h.docs],before);
    }
});

test('oversized UTF-8 evidence plus immutable intent cannot produce an over-limit Firestore notice',async()=>{
    const h=fixture(),before=clone([...h.docs]);await assert.rejects(issue(h,'new-case',{evidencePhoto:'x'.repeat(500000)}),/too large/);assert.deepEqual([...h.docs],before);
    const second=fixture();await assert.rejects(issue(second,'new-case',{evidencePhoto:'界'.repeat(150000)}),/too large/);assert.equal(casePaths(second).length,0);
});

test('Owner policy edits are revisioned future choices and cannot rewrite any issued or reviewed case',async()=>{
    const h=fixture({owner:true});await issue(h,'new-case',{proposedLevelId:'written-warning'});await reply(h);await review(h);
    const old=clone(h.get('hr_sanctions/new-case')),money=moneyState(h),levels=[{id:'written-warning',label:'New future written action',suspensionDays:7}];
    const result=await saveDisciplinePolicy(h.api,{levels,expectedRevision:0},{changeId:'policy-one',now});assert.equal(result.policy.revision,1);assert.deepEqual(result.policy.levels,levels);
    assert.deepEqual(h.get('hr_sanctions/new-case'),old);assert.deepEqual(moneyState(h),money);
    const manager=fixture();await assert.rejects(saveDisciplinePolicy(manager.api,{levels,expectedRevision:0},{changeId:'policy-one',now}),/Only the verified Owner/);
});

test('policy commit failure, lost acknowledgment and concurrent revisions preserve the winning saved catalogue',async()=>{
    const h=fixture({owner:true}),levels=[{id:'sample-level',label:'Sample action',suspensionDays:0}],save=(changeId='policy-one',extra={})=>saveDisciplinePolicy(h.api,{levels,expectedRevision:0,...extra},{changeId,now});
    h.failNextCommit();await assert.rejects(save(),/rejected/);assert.equal(h.get('settings/discipline_policy'),undefined);
    h.loseNextAck();await assert.rejects(save(),/lost/);assert.equal((await save()).alreadySaved,true);assert.equal(h.get('settings/discipline_policy').revision,1);
    await assert.rejects(save('policy-one',{levels:[{id:'other',label:'Other',suspensionDays:1}]}),/different/);
    await assert.rejects(save('policy-two'),/changed/);
    const concurrent=fixture({owner:true});const results=await Promise.allSettled(['one','two'].map(changeId=>saveDisciplinePolicy(concurrent.api,{levels,expectedRevision:0},{changeId,now})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(concurrent.get('settings/discipline_policy').revision,1);
});

test('policy validation and fresh saved Owner revocation prevent invalid settings writes',async()=>{
    for(const levels of [[],[{id:'bad/id',label:'Invalid',suspensionDays:0}],[{id:'one',label:'Unsafe <b>label</b>',suspensionDays:0}],[{id:'one',label:'One',suspensionDays:1.5}]]) {
        const h=fixture({owner:true}),before=clone([...h.docs]);await assert.rejects(saveDisciplinePolicy(h.api,{levels,expectedRevision:0},{changeId:'policy-one',now}));assert.deepEqual([...h.docs],before);
    }
    const h=fixture({owner:true}),run=h.api.runTransaction;h.api.runTransaction=(...args)=>{h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),active:false});return run(...args);};
    await assert.rejects(saveDisciplinePolicy(h.api,{levels:DEFAULT_DISCIPLINE_POLICY.levels,expectedRevision:0},{changeId:'policy-one',now}));assert.equal(h.get('settings/discipline_policy'),undefined);
});

test('staff reply remains a separate step; only the subsequent saved finding selects an action',async()=>{
    const h=fixture(),money=moneyState(h);await issue(h,'new-case',{proposedLevelId:'suspension-14'});
    await assert.rejects(review(h),/Only a replied/);await reply(h);const replied=clone(h.get('hr_sanctions/new-case'));assert.deepEqual(suspensionDates(replied),[]);
    await review(h,'new-case',{levelId:'suspension-1'});const row=h.get('hr_sanctions/new-case');
    assert.equal(row.finding,'Confirmed');assert.equal(row.status,'Reviewed');assert.equal(row.decisionRevision,1);assert.equal(row.proposedSeverity.suspensionDays,14);assert.equal(row.reviewedAction.suspensionDays,1);
    for(const field of ['staffReply','signatureBase64','repliedAt','issuedAt','timestamp','issueIntent','scheduleAudit','effectiveDate'])assert.deepEqual(row[field],replied[field]);
    assert.equal(row.reviewedByUid,'reviewer-uid');assert.equal(row.reviewedByEmail,'reviewer@example.test');assert.deepEqual(suspensionDates(row),['2026-10-25']);assert.deepEqual(moneyState(h),money);
});

test('not established has an explicit zero-action snapshot and creates no automatic deduction or suspension',async()=>{
    const h=fixture();await issue(h,'new-case',{proposedLevelId:'suspension-14'});await reply(h);const money=moneyState(h);
    await review(h,'new-case',{outcome:'Not established',levelId:null});const row=h.get('hr_sanctions/new-case');
    assert.deepEqual(row.reviewedAction,{id:'none',label:'No disciplinary action',suspensionDays:0,effectiveDate:'2026-10-25',policyRevision:0});assert.equal(row.finding,'Not established');
    assert.deepEqual(suspensionDates(row),[]);assert.equal((await readDisciplineContext(h.api,{id:staffId})).history.confirmedCount,0);assert.deepEqual(moneyState(h),money);
});

test('review uses the current saved policy, preserving its new snapshot even after later edits',async()=>{
    const h=fixture({owner:true});await issue(h,'new-case',{proposedLevelId:'written-warning'});await reply(h);
    await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'Current reviewed action',suspensionDays:3}],expectedRevision:0},{changeId:'policy-one',now});
    await review(h);const row=clone(h.get('hr_sanctions/new-case'));assert.equal(row.proposedSeverity.label,'Written warning');assert.equal(row.reviewedAction.label,'Current reviewed action');assert.equal(row.reviewedAction.policyRevision,1);
    await saveDisciplinePolicy(h.api,{levels:[{id:'future',label:'Future only',suspensionDays:0}],expectedRevision:1},{changeId:'policy-two',now});assert.deepEqual(h.get('hr_sanctions/new-case'),row);
});

test('an explicitly captured proposal policy revision rejects changed wording or suspension days before notice creation',async()=>{
    const h=fixture({owner:true}),context=await readDisciplineContext(h.api,{id:staffId});
    await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'Seven day action',suspensionDays:7}],expectedRevision:0},{changeId:'changed-policy',now});
    const before=clone([...h.docs]);await assert.rejects(issue(h,'new-case',{proposedLevelId:'written-warning',expectedPolicyRevision:context.policy.revision}),/policy changed after you opened/);
    assert.deepEqual([...h.docs],before);assert.equal(h.get('settings/discipline_case_'+staffId),undefined);
    await issue(h,'new-case',{proposedLevelId:'written-warning',expectedPolicyRevision:1});assert.equal(h.get('hr_sanctions/new-case').proposedSeverity.suspensionDays,7);
});

test('a captured review policy prevents silently turning the displayed warning into a newly changed suspension',async()=>{
    const h=fixture({owner:true});await issue(h);await reply(h);const context=await readDisciplineContext(h.api,{id:staffId});
    await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'Seven day action',suspensionDays:7}],expectedRevision:0},{changeId:'changed-policy',now});
    const before=clone(h.get('hr_sanctions/new-case'));await assert.rejects(review(h,'new-case',{expectedPolicyRevision:context.policy.revision}),/policy changed after you opened/);
    assert.deepEqual(h.get('hr_sanctions/new-case'),before);assert.deepEqual(suspensionDates(before),[]);
    await review(h,'new-case',{expectedPolicyRevision:1});assert.equal(h.get('hr_sanctions/new-case').reviewedAction.suspensionDays,7);assert.equal(h.get('hr_sanctions/new-case').reviewedAction.policyRevision,1);
});

test('a real policy save racing an issue or review transaction forces retry and then rejects the stale displayed selection',async()=>{
    for(const reviewing of [false,true]) {
        const h=fixture({owner:true});if(reviewing){await issue(h);await reply(h);}
        const run=h.api.runTransaction;let injected=false;
        h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async reference=>{
            const snap=await tx.get(reference);
            if(!injected&&reference.path==='settings/discipline_policy'){
                injected=true;
                await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'Concurrent changed action',suspensionDays:7}],expectedRevision:0},{changeId:'concurrent-policy',now});
            }
            return snap;
        }}));
        const pending=reviewing?review(h,'new-case',{expectedPolicyRevision:0}):issue(h,'new-case',{expectedPolicyRevision:0,proposedLevelId:'written-warning'});
        await assert.rejects(pending,/policy changed after you opened/);assert.ok(h.retries()>0);assert.equal(h.get('settings/discipline_policy').revision,1);
        if(reviewing){assert.equal(h.get('hr_sanctions/new-case').status,'Replied');assert.equal(h.get('hr_sanctions/new-case').reviewedAction,undefined);}else{assert.equal(h.get('hr_sanctions/new-case'),undefined);assert.equal(h.get('settings/discipline_case_'+staffId),undefined);}
    }
});

test('lost issue and review acknowledgments recover their exact original snapshot after a later policy edit',async()=>{
    const h=fixture({owner:true});h.loseNextAck();await assert.rejects(issue(h,'new-case',{expectedPolicyRevision:0,proposedLevelId:'written-warning'}),/lost/);
    await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'First policy edit',suspensionDays:3}],expectedRevision:0},{changeId:'policy-one',now});
    assert.equal((await issue(h,'new-case',{expectedPolicyRevision:0,proposedLevelId:'written-warning'})).alreadySaved,true);assert.equal(h.get('hr_sanctions/new-case').proposedSeverity.suspensionDays,0);
    await assert.rejects(issue(h,'new-case',{expectedPolicyRevision:1,proposedLevelId:'written-warning'}),/different details/);
    await reply(h);h.loseNextAck();await assert.rejects(review(h,'new-case',{expectedPolicyRevision:1}),/lost/);
    await saveDisciplinePolicy(h.api,{levels:[{id:'written-warning',label:'Second policy edit',suspensionDays:7}],expectedRevision:1},{changeId:'policy-two',now});
    assert.equal((await review(h,'new-case',{expectedPolicyRevision:1})).alreadySaved,true);assert.equal(h.get('hr_sanctions/new-case').reviewedAction.suspensionDays,3);
    await assert.rejects(review(h,'new-case',{expectedPolicyRevision:2}),/different details/);assert.equal(h.get('hr_sanctions/new-case').decisionRevision,1);
});

test('an optional captured policy revision must be an exact nonnegative integer when provided',async()=>{
    for(const invalid of [undefined,null,'0',-1,.5,NaN,Number.MAX_SAFE_INTEGER+1]) {
        const h=fixture();await assert.rejects(issue(h,'new-case',{expectedPolicyRevision:invalid}),/current discipline policy/);assert.equal(h.get('hr_sanctions/new-case'),undefined);
        await issue(h);await reply(h);await assert.rejects(review(h,'new-case',{expectedPolicyRevision:invalid}),/current discipline policy/);assert.equal(h.get('hr_sanctions/new-case').status,'Replied');
    }
});

test('review failure is atomic; exact lost acknowledgment retry succeeds while changed intent and new review cannot overwrite it',async()=>{
    const h=fixture();await issue(h);await reply(h);h.failNextCommit();const replied=clone(h.get('hr_sanctions/new-case'));await assert.rejects(review(h),/rejected/);assert.deepEqual(h.get('hr_sanctions/new-case'),replied);
    h.loseNextAck();await assert.rejects(review(h),/lost/);const decided=clone(h.get('hr_sanctions/new-case'));assert.equal((await review(h)).alreadySaved,true);assert.deepEqual(h.get('hr_sanctions/new-case'),decided);
    await assert.rejects(review(h,'new-case',{levelId:'suspension-1'}),/different/);await assert.rejects(review(h,'new-case',{},'review-two'),/Only a replied/);
});

test('concurrent contradictory management reviews retain only one finding at the expected revision',async()=>{
    const h=fixture();await issue(h);await reply(h);
    const results=await Promise.allSettled([review(h),review(h,'new-case',{outcome:'Not established',levelId:null},'different-review')]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(h.get('hr_sanctions/new-case').decisionRevision,1);
});

test('cancelled, archived, resolved and legacy notices cannot be directly confirmed or migrated by review',async()=>{
    for(const extra of [{status:'Cancelled'},{status:'Archived'},{status:'Resolved'},{caseVersion:undefined},{caseNumber:undefined},{caseKey:'other'},{finding:'Confirmed'},{staffReply:'short'},{signatureBase64:''},{replyByStaffId:'other'}]) {
        const h=fixture();await issue(h);await reply(h);h.put('hr_sanctions/new-case',{...h.get('hr_sanctions/new-case'),...extra});const before=clone([...h.docs]);await assert.rejects(review(h));assert.deepEqual([...h.docs],before);
    }
});

test('related findings require exact stable identity, complete saved proof and fresh transaction reads',async()=>{
    const h=fixture();h.put('hr_sanctions/prior',reviewedRow({status:'Archived'}));await issue(h);await reply(h);await review(h,'new-case',{relatedCaseIds:['prior']});
    assert.deepEqual(h.get('hr_sanctions/new-case').relatedCaseIds,['prior']);
    for(const extra of [{staffId:'other'},{caseVersion:1},{status:'Cancelled'},{finding:'Pending'},{reviewedByUid:''},{reviewedByEmail:''},{reviewedAction:null}]) {
        const second=fixture();second.put('hr_sanctions/prior',reviewedRow(extra));await issue(second);await reply(second);const before=clone([...second.docs]);await assert.rejects(review(second,'new-case',{relatedCaseIds:['prior']}));assert.deepEqual([...second.docs],before);
    }
    const third=fixture();third.put('hr_sanctions/prior',reviewedRow());await issue(third);await reply(third);const run=third.api.runTransaction;third.api.runTransaction=(...args)=>{third.put('hr_sanctions/prior',reviewedRow({finding:'Not established'}));return run(...args);};await assert.rejects(review(third,'new-case',{relatedCaseIds:['prior']}));assert.equal(third.get('hr_sanctions/new-case').status,'Replied');
});

test('short reasons, stale revisions, duplicate/self/too many related IDs and removed actions do not write a finding',async()=>{
    for(const extra of [{reason:'short'},{expectedRevision:1},{effectiveDate:'2026-10-22'},{levelId:'removed'},{relatedCaseIds:['new-case']},{relatedCaseIds:['a','a']},{relatedCaseIds:['a','b','c','d','e','f']},{outcome:'Not established',levelId:'suspension-1'}]) {
        const h=fixture();await issue(h);await reply(h);const before=clone([...h.docs]);await assert.rejects(review(h,'new-case',extra));assert.deepEqual([...h.docs],before);
    }
});

test('review rechecks protected permission and both historical/current branches inside its transaction',async()=>{
    for(const mutate of [h=>h.put('hq_email_access/reviewer@example.test',{active:false}),h=>h.put('cashiers/'+staffId,{...h.get('cashiers/'+staffId),branch:'Other Branch'})]) {
        const h=fixture();await issue(h);await reply(h);const run=h.api.runTransaction;h.api.runTransaction=(...args)=>{mutate(h);return run(...args);};await assert.rejects(review(h));assert.equal(h.get('hr_sanctions/new-case').status,'Replied');
    }
});

test('cancelling a pending case retains every issue field and its number; reviewed cases archive the existing finding',async()=>{
    const h=fixture();await issue(h);const initial=clone(h.get('hr_sanctions/new-case')),money=moneyState(h);await cancel(h);const cancelled=h.get('hr_sanctions/new-case');
    assert.equal(cancelled.status,'Cancelled');assert.equal(cancelled.decisionRevision,1);for(const field of ['caseNumber','caseKey','finding','issueIntent','issuedAt','proposedSeverity','scheduleAudit'])assert.deepEqual(cancelled[field],initial[field]);
    assert.equal(cancelled.cancelledByUid,'reviewer-uid');assert.deepEqual(moneyState(h),money);
    const second=fixture();await issue(second);await reply(second);await review(second,'new-case',{levelId:'suspension-3'});const finding=clone(second.get('hr_sanctions/new-case'));
    await cancel(second,'new-case',{expectedRevision:1});const archived=second.get('hr_sanctions/new-case');assert.equal(archived.status,'Archived');assert.equal(archived.decisionRevision,2);assert.deepEqual(archived.reviewedAction,finding.reviewedAction);assert.equal(archived.finding,'Confirmed');assert.deepEqual(suspensionDates(archived),[]);assert.equal((await readDisciplineContext(second.api,{id:staffId})).history.confirmedCount,1);
});

test('cancellation is revision guarded and retry-safe without deleting a case or erasing a reviewed finding',async()=>{
    const h=fixture();await issue(h);h.loseNextAck();await assert.rejects(cancel(h),/lost/);const old=clone(h.get('hr_sanctions/new-case'));assert.equal((await cancel(h)).alreadySaved,true);assert.deepEqual(h.get('hr_sanctions/new-case'),old);
    await assert.rejects(cancel(h,'new-case',{reason:'Different reason for the same retry.'}),/different/);await assert.rejects(cancel(h,'new-case',{},'cancel-two'),/changed or is already closed/);
    const second=fixture();await issue(second);await reply(second);await review(second);await assert.rejects(cancel(second),/changed/);assert.equal(second.get('hr_sanctions/new-case').status,'Reviewed');assert.equal(casePaths(second).length,1);
});

test('failed cancellation is atomic and a concurrent finding cannot overwrite the winning closure',async()=>{
    const h=fixture();await issue(h);await reply(h);const replied=clone(h.get('hr_sanctions/new-case'));h.failNextCommit();await assert.rejects(cancel(h),/rejected/);assert.deepEqual(h.get('hr_sanctions/new-case'),replied);
    const results=await Promise.allSettled([cancel(h),review(h)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const row=h.get('hr_sanctions/new-case');assert.equal(row.decisionRevision,1);
    if(row.status==='Cancelled'){assert.equal(row.finding,'Pending');assert.equal(row.reviewedAction,undefined);}else{assert.equal(row.status,'Reviewed');assert.equal(row.cancelChangeId,undefined);}
});

test('read-only context rejects stale profile aliases and sequence corruption without changing business records',async()=>{
    const h=fixture();await issue(h);h.put('hr_sanctions/manual',{staffId,staffName,branch,caseNumber:20,status:'Archived'});const before=clone([...h.docs]);
    await assert.rejects(readDisciplineContext(h.api,{id:staffId,staffId:'different'}),/exact/);await assert.rejects(readDisciplineContext(h.api,{id:staffId,name:'Different Name'}),/assignment/);await assert.rejects(readDisciplineContext(h.api,{id:staffId}),/ahead/);assert.deepEqual([...h.docs],before);
});
