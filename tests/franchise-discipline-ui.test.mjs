import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ReviewElement,ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
import {phDay} from '../takodeal-franchise/sanction-schedule.js';
import {caseHistory,normalizeDisciplinePolicy} from '../takodeal-franchise/discipline-case-model.js';
import {disciplineEscape as esc,disciplineCaseSummary,disciplineCaseName,franchiseDisciplineHistoryHTML} from '../takodeal-franchise/franchise-discipline-model.js';

const originalAttribute = ReviewElement.prototype.setAttribute;
ReviewElement.prototype.setAttribute = function(name,value) {originalAttribute.call(this,name,value);if (name === 'disabled') this.disabled = true;if (name === 'hidden') this.hidden = true;};
ReviewElement.prototype.matches = function(selector) {return selector.split(',').some(raw => {const one = raw.trim();if (one[0] === '[') return Object.hasOwn(this.attributes,one.slice(1,-1));if (one[0] === '#') return this.id === one.slice(1);if (one[0] === '.') return String(this.className || this.attributes.class || '').split(/\s+/).includes(one.slice(1));return this.tagName.toLowerCase() === one;});};
const source = readFileSync(new URL('../takodeal-franchise/franchise-discipline-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export function /g,'function ');
const branch = 'Sample Franchise', staff = {id:'crew',staffId:'crew',cashierName:'Sample Crew',name:'Sample Crew',branch}, policy = () => normalizeDisciplinePolicy(null);
const caseRow = (extra = {}) => ({id:'case-one',caseVersion:2,staffId:'crew',staffName:'Sample Crew',branch,caseKey:'crew',caseNumber:4,status:'Replied',finding:'Pending',decisionRevision:0,details:'Please explain the reported incident.',type:'Reported incident',staffReply:'The staff member provided a full explanation.',signatureBase64:'saved',proposedSeverity:{id:'written-warning',label:'Written warning',suspensionDays:0},...extra});
function fixture(options = {}) {
    const document = new ReviewDocument(),node = id => document.getElementById(id),calls = {issue:[],review:[],cancel:[],reload:0,pending:[],success:[]};let serial = 0;
    const api = {auth:{currentUser:{uid:'reviewer',email:'franchise@example.test',emailVerified:true}},sessionUser:{uid:'reviewer',email:'franchise@example.test',branch,allowedBranches:[branch],role:'Franchise owner',isFranchisee:true,isOwner:false,permissions:['sanctions']},Swal:{fire:async value => calls.success.push(value)},FileReader:class {readAsDataURL(file) {if (options.evidence) return options.evidence(this,file);this.result = 'data:image/png;base64,eA==';this.onload();}}};
    const records = new Map([['case-one',caseRow(options.caseRow)]]);
    const contextFor = person => ({staff:person,history:caseHistory([...records.values()],person),policy:policy(),nextCaseNumber:5,sequenceNeedsReview:false,...options.context});
    const backend = {
        readFranchiseDisciplineStaff:async () => options.staffRead ? options.staffRead() : [staff],
        readDisciplineContext:async (_api,person) => options.contextRead ? options.contextRead(person) : contextFor({...staff,...person}),
        readFranchiseDisciplineCase:async (_api,id) => options.caseRead ? options.caseRead(id) : {row:records.get(id),context:records.get(id)?.caseVersion === 2 ? contextFor(staff) : null},
        readFranchiseDisciplineCases:async () => [...records.values()],
        issueDisciplineCase:async (_api,input,operation) => {calls.issue.push({input:structuredClone(input),operation:structuredClone(operation)});return options.issue ? options.issue(input,operation) : {caseNumber:5};},
        reviewDisciplineCase:async (_api,id,input,operation) => {calls.review.push({id,input:structuredClone(input),operation:structuredClone(operation)});return options.review ? options.review(id,input,operation) : {finding:input.outcome};},
        cancelDisciplineCase:async (_api,id,input,operation) => {calls.cancel.push({id,input:structuredClone(input),operation:structuredClone(operation)});return options.cancel ? options.cancel(id,input,operation) : {status:'Cancelled'};}
    };
    const runtime = vm.createContext({...backend,phDay,esc,disciplineCaseSummary,disciplineCaseName,franchiseDisciplineHistoryHTML,crypto:{randomUUID:() => 'uuid-' + (++serial)},window:api,document,Date});vm.runInContext(source,runtime);
    const ui = runtime.installFranchiseDiscipline(api,{document,reload:async () => calls.reload++,onPending:delta => calls.pending.push(delta)});
    return {api,ui,node,document,calls,records,contextFor,async issueForm() {await ui.openIssue();node('fd-staff').value = staff.id;await node('fd-staff').onchange();node('fd-type').value = 'Reported incident';node('fd-details').value = 'The reported facts require a separate staff explanation.';node('fd-effective').value = phDay();node('fd-proposed').value = 'written-warning';},async reviewForm() {await ui.openReview('case-one');if (node('fd-outcome')) {node('fd-outcome').value = 'Confirmed';node('fd-outcome').onchange();node('fd-level').value = 'written-warning';node('fd-review-reason').value = 'The explanation and supporting records were reviewed separately.';node('fd-review-effective').value = phDay();}}};
}

test('Franchise dialogs are dynamically created, centered, responsive, and contain no policy editor or money input',async () => {
    const f = fixture();await f.issueForm();assert.equal(f.node('franchiseDisciplineDialog').tagName,'DIALOG');assert.equal(f.node('franchiseDisciplineDialog').open,true);assert.match(f.node('fd-context').innerHTML,/Next case: #5/);assert.match(f.node('franchiseDisciplineDialog').querySelector('.fd-body').innerHTML,/not establish a violation/);assert.doesNotMatch(f.node('franchiseDisciplineDialog').querySelector('.fd-body').innerHTML,/penalty.*type="number"|data-policy-save/);
    const css = readFileSync(new URL('../takodeal-franchise/franchise-discipline.css',import.meta.url),'utf8');assert.match(css,/inset:0;margin:auto/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/overflow:auto/);
});
test('issue waits for exact saved history and binds the selected policy revision',async () => {
    const gate = deferred(),f = fixture({contextRead:() => gate.promise});await f.ui.openIssue();f.node('fd-staff').value = staff.id;const loading = f.node('fd-staff').onchange();assert.equal(f.node('fd-save-issue').disabled,true);gate.resolve({...f.contextFor(staff),policy:{...policy(),revision:9}});await loading;f.node('fd-type').value = 'Incident';f.node('fd-details').value = 'These are specific reported incident details.';f.node('fd-proposed').value = 'written-warning';await f.ui.submitIssue();assert.equal(f.calls.issue[0].input.expectedPolicyRevision,9);assert.equal(f.calls.issue[0].input.staffId,'crew');assert.equal(f.calls.issue[0].input.amount,undefined);assert.equal(f.calls.reload,1);assert.equal(f.node('franchiseDisciplineDialog').open,false);
});
test('sequence ambiguity keeps issue disabled and cannot reach the backend by direct submit',async () => {
    const f = fixture({context:{sequenceNeedsReview:true}});await f.issueForm();assert.equal(f.node('fd-save-issue').disabled,true);await f.ui.submitIssue();assert.equal(f.calls.issue.length,0);assert.match(f.node('fd-message').textContent,/confirm its case history/);
});
test('case context race never replaces the selected newer staff account',async () => {
    const old = deferred(),f = fixture({contextRead:person => person.id === 'crew' ? old.promise : {...f.contextFor(person),nextCaseNumber:8}});await f.ui.openIssue();f.node('fd-staff').value = 'crew';const first = f.node('fd-staff').onchange();f.node('fd-staff').value = '';await f.node('fd-staff').onchange();old.resolve(f.contextFor(staff));await first;assert.equal(f.node('fd-save-issue').disabled,true);assert.match(f.node('fd-context').textContent,/Select the saved/);
});
test('double submit and native close are blocked during save, with pending accounting balanced',async () => {
    const gate = deferred(),f = fixture({issue:() => gate.promise});await f.issueForm();const saving = f.ui.submitIssue();await drain();await f.ui.submitIssue();await f.ui.openIssue();assert.equal(f.calls.issue.length,1);assert.equal(f.node('franchiseDisciplineDialog').emit('cancel').defaultPrevented,true);f.node('franchiseDisciplineDialog').querySelector('[data-fd-close]').click();assert.equal(f.node('franchiseDisciplineDialog').open,true);gate.resolve({caseNumber:5});await saving;assert.deepEqual(f.calls.pending,[1,-1]);assert.equal(f.ui.hasPending(),false);
});
test('lost issue acknowledgment retry retains exact details, evidence and stable case reference',async () => {
    let attempt = 0;const f = fixture({issue:() => {if (++attempt === 1) throw Error('Connection lost after commit');return {caseNumber:5};}});await f.issueForm();f.node('fd-evidence').files = [{type:'image/png',size:123}];await f.ui.submitIssue();const original = structuredClone(f.calls.issue[0]);assert.equal(f.node('fd-details').disabled,true);assert.match(f.node('fd-retry-help').textContent,/same details and reference/);f.node('fd-details').value = 'Programmatically changed details must never replace the captured attempt.';await f.ui.submitIssue();assert.deepEqual(f.calls.issue[1],original);assert.equal(f.calls.reload,1);
});
test('invalid evidence never issues a notice; an evidence read in progress cannot adopt edited facts',async () => {
    const invalid = fixture();await invalid.issueForm();invalid.node('fd-evidence').files = [{type:'text/html',size:10}];await invalid.ui.submitIssue();assert.equal(invalid.calls.issue.length,0);assert.match(invalid.node('fd-message').textContent,/PNG, JPEG or WebP/);
    const gate = deferred();let reader;const f = fixture({evidence:r => {reader = r;return gate.promise;}});await f.issueForm();const original = f.node('fd-details').value;f.node('fd-evidence').files = [{type:'image/png',size:123}];const saving = f.ui.submitIssue();await drain();f.node('fd-details').value = 'Different text entered after save began.';reader.result = 'data:image/png;base64,eA==';reader.onload();gate.resolve();await saving;assert.equal(f.calls.issue[0].input.details,original);
});
test('Not established clears selected level and saves a distinct reason with no disciplinary action',async () => {
    const f = fixture();await f.reviewForm();f.node('fd-outcome').value = 'Not established';f.node('fd-outcome').onchange();assert.equal(f.node('fd-level').disabled,true);assert.equal(f.node('fd-level').value,'');f.node('fd-level').value = 'suspension-7';await f.ui.submitReview();assert.equal(f.calls.review[0].input.outcome,'Not established');assert.equal(f.calls.review[0].input.levelId,null);assert.equal(f.calls.review[0].input.expectedRevision,0);assert.equal(f.calls.review[0].input.expectedPolicyRevision,0);
});
test('review retry retains captured finding, policy and operation ID; close/reopen explicitly loads a new attempt',async () => {
    let attempts = 0;const f = fixture({review:() => {if (++attempts === 1) throw Error('Connection lost after commit');return {finding:'Confirmed'};}});await f.reviewForm();await f.ui.submitReview();const saved = structuredClone(f.calls.review[0]);f.node('fd-review-reason').value = 'Different programmatic text after failure.';f.node('fd-outcome').value = 'Not established';await f.ui.submitReview();assert.deepEqual(f.calls.review[1],saved);assert.equal(f.calls.cancel.length,0);assert.equal(f.calls.reload,1);
});
test('pending staff explanation, legacy record and frozen reviewed finding offer no new finding action',async () => {
    for (const row of [{status:'Pending Reply'},{caseVersion:undefined,status:'Replied'},{status:'Reviewed',finding:'Confirmed',reviewedAction:{id:'written-warning',label:'Saved written action',suspensionDays:0,effectiveDate:phDay(),policyRevision:0}}]) {const f = fixture({caseRow:row});await f.ui.openReview('case-one');assert.equal(f.node('fd-save-review'),null);await f.ui.submitReview();assert.equal(f.calls.review.length,0);if (row.caseVersion === undefined && Object.hasOwn(row,'caseVersion')) assert.equal(f.node('fd-cancel-case'),null);}
});
test('withdrawal captures an explicit reason and optimistic revision without deleting the case',async () => {
    const f = fixture();await f.reviewForm();f.node('fd-cancel-reason').value = 'The incident notice is withdrawn after reconciliation.';await f.ui.cancelCase();assert.equal(f.calls.cancel.length,1);assert.equal(f.calls.cancel[0].id,'case-one');assert.equal(f.calls.cancel[0].input.expectedRevision,0);assert.equal(f.calls.review.length,0);assert.match(f.calls.success[0].title,/withdrawn/);
});
for (const rejected of [false,true]) test('late old-account save ' + (rejected ? 'failure' : 'success') + ' cannot repaint another branch or account',async () => {
    const gate = deferred(),f = fixture({issue:() => gate.promise});await f.issueForm();const saving = f.ui.submitIssue();await drain();f.api.sessionUser.branch = 'Other Branch';f.api.sessionUser.allowedBranches = ['Other Branch'];if (rejected) gate.reject(Error('Private old branch failure'));else gate.resolve({caseNumber:5});await saving;assert.equal(f.calls.reload,0);assert.equal(f.calls.success.length,0);assert.equal(f.node('franchiseDisciplineDialog').open,false);assert.equal(f.node('franchiseDisciplineDialog').querySelector('.fd-body').innerHTML,'');assert.deepEqual(f.calls.pending,[1,-1]);
});
test('late old case lookup cannot replace a newer case dialog',async () => {
    const gate = deferred(),f = fixture({caseRead:id => id === 'old-case' ? gate.promise : {row:caseRow(),context:f.contextFor(staff)}});const old = f.ui.openReview('old-case');await drain();await f.ui.openReview('case-one');gate.reject(Error('Old case lookup failed'));await old;assert.match(f.node('fd-message').textContent,/Case #4/);assert.doesNotMatch(f.node('fd-message').textContent,/Old case lookup failed/);
});
test('all case content is escaped, pending allegations never appear as confirmed findings, and dashboard search avoids private raw fields',async () => {
    const f = fixture({caseRow:{staffName:'<script>crew</script>',details:'<img src=x onerror=alert(1)>',staffReply:'<script>reply</script>',type:'<b>Incident</b>',pin:'secret-pin'}});await f.ui.openReview('case-one');const body = f.node('franchiseDisciplineDialog').querySelector('.fd-body').innerHTML;assert.match(body,/&lt;img/);assert.doesNotMatch(body,/<script>|onerror="/);assert.match(f.node('fd-message').textContent,/Awaiting management finding/);assert.doesNotMatch(f.node('fd-message').textContent,/Violation confirmed/);const root = f.document.createElement('div');await f.ui.renderDashboard(root);assert.doesNotMatch(root.querySelector('tbody').innerHTML,/secret-pin/);
});
test('invalidating account state removes case details and suppresses a late private read',async () => {
    const gate = deferred(),f = fixture({staffRead:() => gate.promise});const opening = f.ui.openIssue();f.ui.invalidate();gate.resolve([staff]);await opening;assert.equal(f.node('franchiseDisciplineDialog').open,false);assert.equal(f.node('fd-staff'),null);await f.ui.submitIssue();await f.ui.submitReview();await f.ui.cancelCase();assert.equal(f.calls.issue.length,0);
});
test('the actual dashboard paginates branch cases, searches safe summaries and opens the exact saved case ID',async () => {
    const f = fixture();for (let index = 2;index <= 61;index++) f.records.set('case-' + index,caseRow({id:'case-' + index,caseNumber:index,staffName:'Crew ' + index,type:'Type ' + index}));
    const root = f.document.createElement('div');await f.ui.renderDashboard(root);assert.match(root.querySelector('[data-fd-page]').textContent,/1–50 of 61 cases/);assert.equal(root.querySelector('[data-fd-prev]').disabled,true);root.querySelector('[data-fd-next]').click();assert.match(root.querySelector('[data-fd-page]').textContent,/51–61 of 61 cases/);
    root.querySelector('[data-fd-search]').value = 'Crew 61';root.querySelector('[data-fd-search]').oninput();assert.match(root.querySelector('[data-fd-page]').textContent,/1–1 of 1 cases/);assert.match(root.querySelector('tbody').innerHTML,/data-fd-case="case-61"/);root.querySelector('[data-fd-case]').click();await drain();assert.match(f.node('fd-message').textContent,/Case #61 · Crew 61/);
});
test('dashboard authorization read completing after branch invalidation cannot append old private records',async () => {
    const f = fixture(),root = f.document.createElement('div'),rendering = f.ui.renderDashboard(root);f.api.sessionUser.branch = 'Another Branch';f.ui.invalidate();await rendering;assert.equal(root.children.length,0);
});
