import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import * as actions from '../takodeal-franchise/franchise-discipline-actions.js';
import {acknowledgeSanction,suspensionDates} from '../takodeal-franchise/sanction-schedule.js';

const branch = 'Sample Franchise',email = 'franchise@example.test',staffId = 'crew-one',staffName = 'Sample Crew';
const now = () => new Date('2026-10-23T04:00:00Z'), clone = value => structuredClone(value);
function fixture() {
    const h = firestoreHarness();
    h.api.auth = {currentUser:{uid:'reviewer',email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
    h.api.sessionUser = {uid:'reviewer',email,isOwner:false,isFranchisee:true,role:'Franchise owner',branch,allowedBranches:[branch],permissions:['sanctions'],cashierName:'Branch Reviewer'};
    h.api.getDocFromServer = async reference => ({id:reference.id,exists:() => h.docs.has(reference.path),data:() => clone(h.get(reference.path)),metadata:{fromCache:false,hasPendingWrites:false}});
    h.put('hq_managers/reviewer',{email,role:'Franchise owner',assignedBranch:branch,permissions:['sanctions'],active:true,pin:'test-only'});
    h.put('hq_email_access/' + email,{active:true,allowedBranches:[branch],permissions:['sanctions']});
    h.put('cashiers/' + staffId,{cashierName:staffName,branch,active:true,pin:'test-only'});
    h.put('payroll_records/frozen',{staffId,status:'Paid',netPay:1234});h.put('staff_deductions/frozen',{staffId,amount:35,status:'Unpaid'});
    return h;
}
const noticeInput = (extra = {}) => ({staffId,staffName,branch,type:'Reported incident',details:'Please explain the reported incident and supporting records.',effectiveDate:'2026-10-24',proposedLevelId:null,expectedPolicyRevision:0,...extra});
const issue = (h,id = 'case-one',extra = {}) => actions.issueDisciplineCase(h.api,noticeInput(extra),{id,now});
const review = (h,id = 'case-one',extra = {},changeId = 'review-one') => actions.reviewDisciplineCase(h.api,id,{outcome:'Confirmed',levelId:'written-warning',effectiveDate:'2026-10-25',reason:'The staff explanation and supporting records were reviewed.',expectedRevision:0,expectedPolicyRevision:0,...extra},{changeId,now});
const cancel = (h,id = 'case-one',extra = {},changeId = 'cancel-one') => actions.cancelDisciplineCase(h.api,id,{reason:'The incident notice was withdrawn after review.',expectedRevision:0,...extra},{changeId,now});
const reply = (h,id = 'case-one') => acknowledgeSanction(h.api,{id,staffName,reply:'This is the full explanation supplied by the staff member.',signature:'saved-test-signature'},{identity:() => ({staffId,staffName})});
const money = h => clone([...h.docs].filter(([path]) => /^(payroll_records|staff_deductions|cash_accounts|staff_ledger|cashiers)\//.test(path)));

test('Franchise uses the byte-identical Manager policy/history model and has no policy-write export',() => {
    assert.equal(readFileSync(new URL('../takodeal-franchise/discipline-case-model.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/discipline-case-model.js',import.meta.url),'utf8'));
    assert.equal(actions.saveDisciplinePolicy,undefined);
});
test('fresh branch context is read-only, retains legacy notices and counts all incident types continuously',async () => {
    const h = fixture();h.put('hr_sanctions/legacy',{staffName,branch,type:'Earlier incident',status:'Cancelled'});h.put('hr_sanctions/other-id',{staffId:'other',staffName,branch,type:'Unrelated',status:'Replied'});
    const before = clone([...h.docs]), context = await actions.readDisciplineContext(h.api,{id:staffId});
    assert.equal(context.nextCaseNumber,2);assert.equal(context.history.totalCases,1);assert.equal(context.history.confirmedCount,0);assert.deepEqual([...h.docs],before);
});
test('authorized Franchise issues v2 allegation without money, attendance or termination writes',async () => {
    const h = fixture(), before = money(h);await issue(h,'case-one',{proposedLevelId:'suspension-7'});
    const row = h.get('hr_sanctions/case-one');assert.equal(row.caseVersion,2);assert.equal(row.finding,'Pending');assert.equal(row.status,'Pending Reply');assert.equal(row.caseNumber,1);assert.equal(row.proposedSeverity.suspensionDays,7);assert.equal(row.reviewedAction,undefined);assert.equal(row.amount,undefined);assert.equal(row.deductionId,undefined);assert.deepEqual(suspensionDates(row),[]);assert.deepEqual(money(h),before);
});
test('the exact same Staff signed explanation protocol transitions Franchise v2 notice to Replied',async () => {
    const h = fixture();await issue(h);await reply(h);const row = h.get('hr_sanctions/case-one');assert.equal(row.status,'Replied');assert.equal(row.replyByStaffId,staffId);assert.equal(row.finding,'Pending');await review(h);assert.equal(h.get('hr_sanctions/case-one').finding,'Confirmed');
});
test('concurrent cases across incident types receive atomic consecutive stable staff ID numbers',async () => {
    const h = fixture();const result = await Promise.all([issue(h,'case-one'),issue(h,'case-two',{type:'Different incident'})]);assert.deepEqual(result.map(row => row.caseNumber).sort(),[1,2]);assert.ok(h.retries() > 0);await cancel(h);await issue(h,'case-three');assert.equal(h.get('hr_sanctions/case-three').caseNumber,3);
});
test('failed commit leaves no case/counter and lost acknowledgment retry cannot consume a second number',async () => {
    const h = fixture();h.failNextCommit();await assert.rejects(issue(h),/rejected/);assert.equal(h.get('hr_sanctions/case-one'),undefined);h.loseNextAck();await assert.rejects(issue(h),/lost/);const before = clone([...h.docs]);assert.equal((await issue(h)).alreadySaved,true);assert.deepEqual([...h.docs],before);await assert.rejects(issue(h,'case-one',{type:'Changed'}),/different details/);
});
for (const [name,mutate] of [
    ['unverified Google',h => h.api.auth.currentUser.emailVerified = false],['non Google identity',h => h.api.auth.currentUser.providerData = []],['different actor UID',h => h.api.sessionUser.uid = 'other'],
    ['cached local permission only',h => h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),permissions:['inbox']})],['saved inactive profile',h => h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),active:false})],
    ['saved role changed',h => h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),role:'Manager'})],['Franchise All branch assignment',h => h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),assignedBranch:'All'})],
    ['missing protected grant',h => h.docs.delete('hq_email_access/' + email)],['inactive protected grant',h => h.put('hq_email_access/' + email,{active:false,permissions:['sanctions'],allowedBranches:[branch]})],
    ['protected permission absent',h => h.put('hq_email_access/' + email,{active:true,permissions:['inbox'],allowedBranches:[branch]})],['protected branch absent',h => h.put('hq_email_access/' + email,{active:true,permissions:['sanctions'],allowedBranches:['Other Branch']})],
    ['selected branch absent',h => h.api.sessionUser.branch = 'Other Branch']
]) test(name + ' fails before any Franchise discipline write',async () => {const h = fixture();mutate(h);const before = clone([...h.docs]);await assert.rejects(issue(h));assert.deepEqual([...h.docs],before);});

test('fresh authority and actor are rechecked inside every transaction, including same UID branch switches',async () => {
    for (const mutate of [h => h.api.sessionUser.branch = 'Other Branch',h => h.put('hq_managers/reviewer',{...h.get('hq_managers/reviewer'),permissions:[]}),h => h.put('hq_email_access/' + email,{active:false}),h => h.api.auth.currentUser.uid = 'other']) {
        const h = fixture(),run = h.api.runTransaction;h.api.runTransaction = (...args) => {mutate(h);return run(...args);};await assert.rejects(issue(h));assert.equal(h.get('hr_sanctions/case-one'),undefined);
    }
});
test('conflicting HQ PIN duplicates and newest saved permission revocation cannot use the earlier local session',async () => {
    for (const extra of [{pin:'different-pin'},{permissions:[],permissionsUpdatedAt:{seconds:2}}]) {const h = fixture();h.put('hq_managers/duplicate',{...h.get('hq_managers/reviewer'),...extra});await assert.rejects(issue(h));assert.equal(h.get('hr_sanctions/case-one'),undefined);}
});
test('cross-branch direct case reads/writes and forged stored IDs cannot escape the selected branch',async () => {
    const h = fixture();h.put('hr_sanctions/outside',{staffId,staffName,branch:'Other Branch',caseVersion:2,caseKey:staffId,caseNumber:1,decisionRevision:0,status:'Pending Reply'});const before = clone([...h.docs]);await assert.rejects(actions.readFranchiseDisciplineCase(h.api,'outside'),/assigned branch/);await assert.rejects(cancel(h,'outside'),/assigned branch/);assert.deepEqual([...h.docs],before);
    h.put('hr_sanctions/local',{id:'outside',staffName,branch,type:'Earlier',status:'Resolved'});const rows = await actions.readFranchiseDisciplineCases(h.api);assert.deepEqual(rows.map(row => row.id),['local']);assert.equal((await actions.readFranchiseDisciplineCase(h.api,'local')).row.id,'local');
});
test('history hides earlier branch contents; missing global counter blocks an incomplete first seed',async () => {
    const h = fixture();h.put('hr_sanctions/old-branch',{staffId,staffName,branch:'Earlier Branch',type:'Private prior incident',status:'Cancelled'});
    const context = await actions.readDisciplineContext(h.api,{id:staffId});assert.equal(context.history.totalCases,0);assert.equal(context.sequenceNeedsReview,true);assert.equal(JSON.stringify(context).includes('Private prior incident'),false);await assert.rejects(issue(h),/earlier branch cases/);
    h.put('settings/discipline_case_' + staffId,{version:1,staffId,staffName,branch:'Earlier Branch',lastCaseNumber:7,lastCaseId:'earlier-case',seededLegacyCount:0});assert.equal((await actions.readDisciplineContext(h.api,{id:staffId})).nextCaseNumber,8);await issue(h);assert.equal(h.get('hr_sanctions/case-one').caseNumber,8);
});
test('ambiguous legacy names do not seed another person’s sequence, even in the same branch',async () => {
    const h = fixture();h.put('cashiers/duplicate',{cashierName:staffName,branch,active:true});h.put('hr_sanctions/legacy',{staffName,branch,type:'Unverified identity'});assert.equal((await actions.readDisciplineContext(h.api,{id:staffId})).sequenceNeedsReview,true);await assert.rejects(issue(h),/Legacy notices share/);
});
test('cached history/profile/authority snapshots and incomplete sequence fail closed',async () => {
    const h = fixture(),read = h.api.getDocsFromServer;h.api.getDocsFromServer = async q => ({...await read(q),metadata:{fromCache:q.table === 'hr_sanctions'}});await assert.rejects(issue(h),/complete saved history/);
    const second = fixture(),get = second.api.getDocFromServer;second.api.getDocFromServer = async r => ({...await get(r),metadata:{hasPendingWrites:r.path.startsWith('hq_email_access/')}});await assert.rejects(issue(second),/saved record could not be confirmed/);
});
test('new notice cannot automatically add money, use wrong staff identity or use a stale Owner policy revision',async () => {
    for (const extra of [{amount:40},{amount:'invalid'},{deductionId:'money'},{staffName:'Different Crew'},{branch:'Other Branch'},{expectedPolicyRevision:2}]) {const h = fixture(),before = clone([...h.docs]);await assert.rejects(issue(h,'case-one',extra));assert.deepEqual([...h.docs],before);}
});
test('review requires the exact saved signed staff reply; not-established records no action',async () => {
    const h = fixture(),before = money(h);await issue(h);await assert.rejects(review(h),/Only a replied/);await reply(h);await review(h,'case-one',{outcome:'Not established',levelId:null});const row = h.get('hr_sanctions/case-one');assert.equal(row.reviewedAction.id,'none');assert.equal(row.reviewedAction.suspensionDays,0);assert.equal(row.finding,'Not established');assert.deepEqual(money(h),before);
});
test('reviewed finding snapshots remain frozen and retry identity never creates a second review',async () => {
    const h = fixture();await issue(h);await reply(h);h.loseNextAck();await assert.rejects(review(h),/lost/);const saved = clone(h.get('hr_sanctions/case-one'));assert.equal((await review(h)).alreadySaved,true);assert.deepEqual(h.get('hr_sanctions/case-one'),saved);await assert.rejects(review(h,'case-one',{reason:'Different management finding from another set of details.'}),/different details/);await assert.rejects(review(h,'case-one',{},'other-review'),/Only a replied/);
});
test('related findings must belong to exact staff ID and selected branch; allegations cannot establish prior guilt',async () => {
    const h = fixture();await issue(h,'earlier');await reply(h,'earlier');await review(h,'earlier');await issue(h,'case-one');await reply(h);await review(h,'case-one',{relatedCaseIds:['earlier']});assert.deepEqual(h.get('hr_sanctions/case-one').relatedCaseIds,['earlier']);
    for (const change of [{staffId:'other',caseKey:'other'},{branch:'Other Branch'},{status:'Pending Reply',finding:'Pending'}]) {const next = fixture();await issue(next);await reply(next);next.put('hr_sanctions/unrelated',{...h.get('hr_sanctions/earlier'),...change});await assert.rejects(review(next,'case-one',{relatedCaseIds:['unrelated']}));}
});
test('legacy notices remain readable but cannot receive v2 findings or cancellation through the case protocol',async () => {
    const h = fixture();h.put('hr_sanctions/legacy',{staffName,branch,type:'Earlier notice',status:'Replied',staffReply:'Earlier explanation'});assert.equal((await actions.readFranchiseDisciplineCase(h.api,'legacy')).context,null);await assert.rejects(review(h,'legacy'),/legacy or incomplete/);await assert.rejects(cancel(h,'legacy'),/legacy or incomplete/);
});
test('reviewed case archives preserve its finding, case number and action; no record is deleted',async () => {
    const h = fixture();await issue(h);await reply(h);await review(h);const before = clone(h.get('hr_sanctions/case-one')),savedMoney = money(h);await cancel(h,'case-one',{expectedRevision:1});const after = h.get('hr_sanctions/case-one');assert.equal(after.status,'Archived');assert.equal(after.finding,before.finding);assert.deepEqual(after.reviewedAction,before.reviewedAction);assert.equal(after.caseNumber,1);assert.deepEqual(money(h),savedMoney);assert.equal((await cancel(h,'case-one',{expectedRevision:1})).alreadySaved,true);
});
test('fresh list/staff readers enforce protected grants and branch filtering before returning data',async () => {
    const h = fixture();h.put('cashiers/outside',{cashierName:'Hidden Crew',branch:'Other Branch',active:true});h.put('cashiers/inactive',{cashierName:'Old Crew',branch,status:'Resigned'});assert.deepEqual((await actions.readFranchiseDisciplineStaff(h.api)).map(row => row.id),[staffId]);h.docs.delete('hq_email_access/' + email);await assert.rejects(actions.readFranchiseDisciplineStaff(h.api),/protected sanctions/);await assert.rejects(actions.readFranchiseDisciplineCases(h.api),/protected sanctions/);
});
