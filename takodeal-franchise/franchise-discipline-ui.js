import {phDay} from './sanction-schedule.js';
import {readDisciplineContext,issueDisciplineCase,reviewDisciplineCase,cancelDisciplineCase,readFranchiseDisciplineCases,readFranchiseDisciplineStaff,readFranchiseDisciplineCase} from './franchise-discipline-actions.js';
import {disciplineEscape as esc,disciplineCaseSummary,disciplineCaseName,franchiseDisciplineHistoryHTML} from './franchise-discipline-model.js';

const safeImage = value => typeof value === 'string' && (/^https:\/\//.test(value) || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value));
const levelsHTML = policy => '<option value="">No proposed action</option>' + policy.levels.map(level => '<option value="' + esc(level.id) + '">' + esc(level.label) + (level.suspensionDays ? ' · ' + level.suspensionDays + ' suspension day(s)' : '') + '</option>').join('');
const unique = prefix => prefix + '-' + crypto.randomUUID();

export function installFranchiseDiscipline(api = window, {document:d = document,reload = () => api.loadSanctionsDashboard(),onPending = () => {}} = {}) {
    if (api.franchiseDiscipline) return api.franchiseDiscipline;
    let dialog, epoch = 0, busy = false, current = null, dashboardEpoch = 0;
    const actorKey = () => JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.auth?.currentUser?.emailVerified,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.branch,api.sessionUser?.allowedBranches,api.sessionUser?.permissions,api.sessionUser?.role,api.sessionUser?.isOwner,api.sessionUser?.isFranchisee]);
    const node = id => d.getElementById(id);
    const controls = () => dialog?.querySelectorAll('button,input,select,textarea') || [];
    const currentView = view => !!view && current === view && view.epoch === epoch && view.actor === actorKey();
    function ensureDialog() {
        if (dialog) return dialog;
        dialog = d.createElement('dialog');dialog.id = 'franchiseDisciplineDialog';dialog.className = 'fd-dialog';dialog.setAttribute('aria-labelledby','fd-title');
        dialog.innerHTML = '<header><div><small>HUMAN RESOURCES · DISCIPLINARY CASES</small><h2 id="fd-title"></h2></div><button type="button" data-fd-close aria-label="Close disciplinary case">×</button></header><div class="fd-body"></div><footer></footer>';
        dialog.querySelector('[data-fd-close]').onclick = () => {if (!busy) dialog.close();};
        dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
        dialog.addEventListener('close', () => {epoch++;current = null;dialog.querySelector('.fd-body').innerHTML = '';dialog.querySelector('footer').innerHTML = '';});
        d.body.append(dialog);return dialog;
    }
    function begin(title) {
        if (busy) return null;
        ensureDialog();const view = {epoch:++epoch,actor:actorKey(),attempt:null};current = view;
        node('fd-title').textContent = title;dialog.querySelector('.fd-body').innerHTML = '<p class="fd-loading" role="status">Confirming current branch access and saved case records…</p>';dialog.querySelector('footer').innerHTML = '';
        for (const control of controls()) control.disabled = false;
        if (!dialog.open) dialog.showModal();return view;
    }
    function message(view,error) {
        if (!currentView(view)) return;
        let box = node('fd-message');
        if (!box) {box = d.createElement('p');box.id = 'fd-message';dialog.querySelector('.fd-body').append(box);}
        box.className = 'fd-error';box.setAttribute('role','alert');box.textContent = error.message || 'The saved records could not be confirmed. Reconnect and reopen this case.';
    }
    function lock(view,value) {
        busy = value;for (const control of controls()) control.disabled = value;
        if (currentView(view) && !value) {
            if (view.kind === 'review') {
                const allowed = disciplineCaseSummary(view.row).canReview;
                if (node('fd-save-review')) node('fd-save-review').disabled = !allowed;
                updateFinding();
            }
            if (view.attempt) {
                for (const input of dialog.querySelectorAll('input,select,textarea')) input.disabled = true;
                if (node('fd-save-issue')) node('fd-save-issue').textContent = 'Retry this same notice';
                if (node('fd-save-review') && view.attempt.kind === 'review') node('fd-save-review').textContent = 'Retry this same finding';
                if (node('fd-cancel-case')) node('fd-cancel-case').disabled = view.attempt.kind !== 'cancel';
                if (node('fd-save-review') && view.attempt.kind === 'cancel') node('fd-save-review').disabled = true;
                if (!node('fd-retry-help')) {const note = d.createElement('p');note.id = 'fd-retry-help';note.className = 'fd-retry';note.textContent = 'Retry keeps the same details and reference to avoid duplicates. Close and reopen this record to load fresh data or change the details.';dialog.querySelector('.fd-body').append(note);}
            } else if (view.kind === 'issue' && node('fd-save-issue')) node('fd-save-issue').disabled = !view.context || view.context.sequenceNeedsReview === true;
        }
    }
    async function perform(view,operation,success) {
        if (busy || !currentView(view)) return;
        lock(view,true);onPending(1);
        try {
            const result = await operation();
            if (!currentView(view)) return;
            dialog.close();
            await reload();
            if (view.actor !== actorKey()) return;
            await api.Swal?.fire({title:success(result),text:'The saved case history is updated. Payroll and attendance are unchanged.',icon:'success'});
        } catch (error) {message(view,error);} finally {onPending(-1);lock(view,false);if (current === view && view.actor !== actorKey()) invalidate();}
    }
    async function loadContext(view) {
        if (busy || !currentView(view) || view.attempt) return;
        const staff = view.staff.find(row => row.id === node('fd-staff').value), ticket = (view.contextEpoch || 0) + 1;view.contextEpoch = ticket;view.context = null;
        node('fd-message').className = 'fd-notice';node('fd-message').textContent = 'This notice asks for an explanation. It does not establish a violation or create a payroll deduction.';
        node('fd-save-issue').disabled = true;node('fd-proposed').innerHTML = '<option value="">Select staff first</option>';node('fd-context').textContent = staff ? 'Confirming this staff account’s continuous case history…' : 'Select the saved staff account to view its case history.';
        if (!staff) return;
        try {
            const context = await readDisciplineContext(api, {id:staff.id,cashierName:staff.cashierName,branch:staff.branch});
            if (!currentView(view) || view.contextEpoch !== ticket || node('fd-staff').value !== staff.id) return;
            view.context = context;node('fd-proposed').innerHTML = levelsHTML(context.policy);
            node('fd-context').innerHTML = '<p class="fd-notice"><strong>Next case: #' + esc(context.nextCaseNumber) + '</strong> · all incident types. The number is reserved when the notice saves.</p>' +
                (context.sequenceNeedsReview ? '<p class="fd-error">This account’s earlier history needs Owner review before a case sequence can be confirmed.</p>' : '') + '<details><summary>View case history</summary>' + franchiseDisciplineHistoryHTML(context) + '</details>';
            node('fd-save-issue').disabled = context.sequenceNeedsReview === true;
        } catch (error) {if (currentView(view) && view.contextEpoch === ticket) message(view,error);}
    }
    async function openIssue() {
        const view = begin('Issue a notice to explain');if (!view) return;view.kind = 'issue';view.id = unique('case');
        try {
            const staff = await readFranchiseDisciplineStaff(api);if (!currentView(view)) return;view.staff = staff;
            if (!staff.length) throw Error('No active saved staff profiles are registered for this branch.');
            dialog.querySelector('.fd-body').innerHTML = '<p id="fd-message" class="fd-notice">This notice asks for an explanation. It does not establish a violation, deduct pay, suspend attendance or end employment.</p><div class="fd-fields">' +
                '<label class="fd-full">Staff member<select id="fd-staff"><option value="">Choose a saved staff account</option>' + staff.map(row => '<option value="' + esc(row.id) + '">' + esc(row.cashierName) + '</option>').join('') + '</select></label>' +
                '<div id="fd-context" class="fd-full fd-help">Select the saved staff account to view its case history.</div>' +
                '<label>Incident type<input id="fd-type" maxlength="200" placeholder="For example, missed procedure"></label><label>Effective date (Philippine time)<input id="fd-effective" type="date" value="' + phDay() + '" min="' + phDay() + '"></label>' +
                '<label class="fd-full">Proposed level for review (optional)<select id="fd-proposed"><option value="">Select staff first</option></select></label>' +
                '<p class="fd-full fd-help">The Owner maintains these future action choices. Management must review the staff explanation before recording any final finding or action.</p>' +
                '<label class="fd-full">Specific incident details<textarea id="fd-details" maxlength="10000" placeholder="Describe the incident, date and records that need an explanation. Avoid presenting an allegation as an established finding."></textarea></label>' +
                '<label class="fd-full">Evidence image (optional, PNG / JPEG / WebP, up to 250 KB)<input id="fd-evidence" type="file" accept="image/png,image/jpeg,image/webp"></label></div>';
            dialog.querySelector('footer').innerHTML = '<button id="fd-close-issue" type="button">Cancel</button><button id="fd-save-issue" class="fd-primary" type="button">Issue notice</button>';
            node('fd-close-issue').onclick = () => {if (!busy) dialog.close();};node('fd-save-issue').disabled = true;
            node('fd-staff').onchange = () => loadContext(view);node('fd-save-issue').onclick = () => submitIssue(view);
        } catch (error) {message(view,error);}
    }
    function evidence(file) {
        if (!file) return Promise.resolve('');
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !Number.isFinite(file.size) || file.size <= 0 || file.size > 250000) return Promise.reject(Error('Choose a PNG, JPEG or WebP evidence image of 250 KB or less.'));
        return new Promise((resolve,reject) => {
            const Reader = api.FileReader || globalThis.FileReader, reader = new Reader();
            reader.onload = () => safeImage(reader.result) ? resolve(reader.result) : reject(Error('The evidence image could not be read.'));
            reader.onerror = () => reject(Error('The evidence image could not be read. Select it again.'));reader.readAsDataURL(file);
        });
    }
    async function submitIssue(view = current) {
        if (busy || !currentView(view)) return;
        if (!view.attempt) {
            const context = view.context, staff = view.staff.find(row => row.id === node('fd-staff').value);
            if (!staff || !context || context.sequenceNeedsReview) return message(view, Error('Select a saved staff account and confirm its case history first.'));
            const details = node('fd-details').value.trim(), type = node('fd-type').value.trim();
            if (!type || details.length < 8) return message(view, Error('Complete the incident type and at least 8 characters of specific incident details.'));
            view.attempt = {kind:'issue',id:view.id,input:{staffId:staff.id,staffName:staff.cashierName,branch:staff.branch,type,details,effectiveDate:node('fd-effective').value,proposedLevelId:node('fd-proposed').value || null,expectedPolicyRevision:context.policy.revision},file:node('fd-evidence').files?.[0]};
        }
        const attempt = view.attempt;
        await perform(view,async () => {
            if (attempt.input.evidencePhoto == null) attempt.input.evidencePhoto = await evidence(attempt.file);
            if (!currentView(view)) throw Error('The signed-in account or branch changed. Reopen the notice.');
            return issueDisciplineCase(api,attempt.input,{id:attempt.id});
        },result => 'Case #' + result.caseNumber + ' notice saved');
    }
    function updateFinding() {
        const view = current;if (!view || view.kind !== 'review' || !node('fd-outcome')) return;
        const confirmed = node('fd-outcome').value === 'Confirmed';node('fd-level').disabled = busy || !!view.attempt || !confirmed;
        if (!confirmed) node('fd-level').value = '';
    }
    async function openReview(id) {
        const view = begin('Review a disciplinary case');if (!view) return;view.kind = 'review';
        try {
            const {row,context} = await readFranchiseDisciplineCase(api,id);if (!currentView(view)) return;view.row = row;view.context = context;
            const summary = disciplineCaseSummary(row), proof = safeImage(row.evidencePhoto) ? '<details><summary>View submitted evidence</summary><img class="fd-proof" src="' + esc(row.evidencePhoto) + '" alt="Saved incident evidence"></details>' : '';
            const related = context?.history.confirmedRows.filter(saved => saved.id !== row.id && saved.branch === row.branch) || [];
            dialog.querySelector('.fd-body').innerHTML = '<p id="fd-message" class="fd-notice"><strong>' + esc(disciplineCaseName(row)) + ' · ' + esc(row.staffName) + ' · ' + esc(row.branch) + '</strong><br><span class="fd-status">' + esc(summary.finding) + ' · ' + esc(summary.status) + '</span></p>' +
                '<h3>' + esc(row.type || 'Reported incident') + '</h3><div class="fd-memo">' + esc(row.details) + '</div>' + proof +
                '<h3>Staff explanation</h3><div class="fd-memo">' + esc(row.staffReply || row.reply || row.response || 'No staff explanation has been saved yet.') + '</div>' +
                (row.caseVersion !== 2 ? '<p class="fd-help">Earlier notice: its finding was not recorded using reviewed cases. It remains readable and does not become a confirmed case.</p>' :
                '<p class="fd-help">Proposed level: ' + esc(row.proposedSeverity?.label || 'None') + '. This is an allegation until management records a finding after the staff reply.</p>' +
                (row.reviewedAction ? '<h3>Saved management finding</h3><div class="fd-memo">' + esc(row.finding) + '\n' + esc(row.reviewedAction.label) + ' · effective ' + esc(row.reviewedAction.effectiveDate) + '\n' + esc(row.reviewReason) + '</div>' : '') +
                (summary.canReview ? '<h3>Management review</h3><div class="fd-fields"><label>Finding<select id="fd-outcome"><option value="">Choose a finding</option><option value="Confirmed">Violation confirmed</option><option value="Not established">Violation not established</option></select></label><label>Action effective date (PH)<input id="fd-review-effective" type="date" value="' + phDay() + '" min="' + phDay() + '"></label>' +
                '<label class="fd-full">Reviewed action<select id="fd-level">' + levelsHTML(context.policy) + '</select></label><label class="fd-full">Reason for this finding<textarea id="fd-review-reason" maxlength="1500" placeholder="Explain the facts and the staff response considered in this management review."></textarea></label></div>' +
                (related.length ? '<details><summary>Link relevant earlier confirmed findings (up to five)</summary><div class="fd-related">' + related.map(saved => '<label><input type="checkbox" data-fd-related="' + esc(saved.id) + '">' + esc(disciplineCaseName(saved)) + ' · ' + esc(saved.type) + ' · ' + esc(saved.reviewedAction.label) + '</label>').join('') + '</div></details>' : '') : '<p class="fd-help">' + (row.status === 'Pending Reply' ? 'Wait for the staff explanation and signature before recording a finding.' : 'The saved finding is preserved. It cannot be replaced by a new policy or another review.') + '</p>') +
                '<p class="fd-help">This action records a management review. It does not create a payroll deduction, change attendance, block time out or end employment.</p>' +
                '<details><summary>View staff case history</summary>' + franchiseDisciplineHistoryHTML(context) + '</details>' +
                (summary.canClose ? '<div class="fd-close-section"><label>Reason for ' + (row.status === 'Reviewed' ? 'archiving' : 'withdrawing') + ' this case<textarea id="fd-cancel-reason" maxlength="1500" placeholder="Explain why this case should be closed. Its history will remain saved."></textarea></label></div>' : ''));
            dialog.querySelector('footer').innerHTML = '<button id="fd-close-review" type="button">Close</button>' + (summary.canClose ? '<button id="fd-cancel-case" class="fd-danger" type="button">' + (row.status === 'Reviewed' ? 'Archive reviewed case' : 'Withdraw case') + '</button>' : '') + (summary.canReview ? '<button id="fd-save-review" class="fd-primary" type="button">Save management finding</button>' : '');
            node('fd-close-review').onclick = () => {if (!busy) dialog.close();};
            if (node('fd-outcome')) node('fd-outcome').onchange = updateFinding;
            if (node('fd-save-review')) node('fd-save-review').onclick = () => submitReview(view);
            if (node('fd-cancel-case')) node('fd-cancel-case').onclick = () => cancelCase(view);
            updateFinding();
        } catch (error) {message(view,error);}
    }
    async function submitReview(view = current) {
        if (busy || !currentView(view) || !disciplineCaseSummary(view.row).canReview) return;
        if (!view.attempt) {
            const outcome = node('fd-outcome').value, reason = node('fd-review-reason').value.trim(), levelId = outcome === 'Confirmed' ? node('fd-level').value : null;
            const relatedCaseIds = [...dialog.querySelectorAll('[data-fd-related]')].filter(input => input.checked).map(input => input.dataset.fdRelated);
            if (!['Confirmed','Not established'].includes(outcome) || outcome === 'Confirmed' && !levelId || reason.length < 8 || relatedCaseIds.length > 5) return message(view, Error('Choose a finding, its action when confirmed, a reason of at least 8 characters and up to five related cases.'));
            view.attempt = {kind:'review',id:view.row.id,changeId:unique('case-review'),input:{outcome,levelId,reason,relatedCaseIds,effectiveDate:node('fd-review-effective').value,expectedRevision:view.row.decisionRevision,expectedPolicyRevision:view.context.policy.revision}};
        }
        if (view.attempt.kind !== 'review') return;
        const attempt = view.attempt;await perform(view,() => reviewDisciplineCase(api,attempt.id,attempt.input,{changeId:attempt.changeId}),() => 'Management finding saved');
    }
    async function cancelCase(view = current) {
        if (busy || !currentView(view) || !disciplineCaseSummary(view.row).canClose) return;
        if (!view.attempt) {
            const reason = node('fd-cancel-reason').value.trim();if (reason.length < 8) return message(view, Error('Explain why this case should be closed in at least 8 characters.'));
            view.attempt = {kind:'cancel',id:view.row.id,changeId:unique('case-close'),input:{reason,expectedRevision:view.row.decisionRevision}};
        }
        if (view.attempt.kind !== 'cancel') return;
        const attempt = view.attempt;await perform(view,() => cancelDisciplineCase(api,attempt.id,attempt.input,{changeId:attempt.changeId}),result => result.status === 'Archived' ? 'Reviewed case archived' : 'Case withdrawn');
    }
    async function renderDashboard(root) {
        const ticket = ++dashboardEpoch,key = actorKey(), rows = await readFranchiseDisciplineCases(api);
        if (ticket !== dashboardEpoch || key !== actorKey()) return;
        const card = d.createElement('section');card.className = 'card';
        card.innerHTML = '<div class="card-head"><div><h2>Disciplinary cases & staff replies</h2><p>Continuous case history with a separate management finding after the staff explanation.</p></div><button type="button" data-fd-issue class="primary-button">Issue notice</button></div><div class="tools"><label class="search">Search cases<input type="search" data-fd-search placeholder="Search staff, incident or status"></label></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Staff</th><th>Incident</th><th>Finding / action</th><th>Status</th><th>Review</th></tr></thead><tbody></tbody></table></div><div class="pager"><span data-fd-page></span><div class="button-row"><button type="button" data-fd-prev class="secondary-button">Previous</button><button type="button" data-fd-next class="secondary-button">Next</button></div></div>';
        const source = [...rows].sort((a,b) => (b.issuedAt?.seconds || b.timestamp?.seconds || 0) - (a.issuedAt?.seconds || a.timestamp?.seconds || 0));let page = 0;
        function draw() {
            const query = card.querySelector('[data-fd-search]').value.trim().toLowerCase(), filtered = source.filter(row => [row.staffName,row.type,row.status,row.caseNumber,disciplineCaseSummary(row).finding].join(' ').toLowerCase().includes(query));page = Math.max(0,Math.min(page,Math.ceil(filtered.length / 50) - 1));
            card.querySelector('tbody').innerHTML = filtered.slice(page * 50,(page + 1) * 50).map(row => {const summary = disciplineCaseSummary(row);return '<tr><td>' + esc(summary.name) + '<br><small>Effective: ' + esc(row.effectiveDate || 'Immediate (earlier notice)') + '</small></td><td>' + esc(row.staffName) + '</td><td>' + esc(row.type) + '</td><td>' + esc(summary.finding) + '<br><small>' + esc(summary.action) + '</small></td><td>' + esc(summary.status) + '</td><td><button type="button" class="table-action" data-fd-case="' + esc(row.id) + '">View & review</button></td></tr>';}).join('') || '<tr><td colspan="6" class="empty">No matching cases in this branch.</td></tr>';
            card.querySelector('[data-fd-page]').textContent = filtered.length ? (page * 50 + 1) + '–' + Math.min((page + 1) * 50,filtered.length) + ' of ' + filtered.length + ' cases' : '0 cases';card.querySelector('[data-fd-prev]').disabled = page === 0;card.querySelector('[data-fd-next]').disabled = (page + 1) * 50 >= filtered.length;
        }
        card.querySelector('[data-fd-issue]').onclick = openIssue;card.querySelector('[data-fd-search]').oninput = () => {page = 0;draw();};card.querySelector('[data-fd-prev]').onclick = () => {page--;draw();};card.querySelector('[data-fd-next]').onclick = () => {page++;draw();};card.addEventListener('click',event => {const id = event.target.closest('[data-fd-case]')?.dataset.fdCase;if (id) void openReview(id);});draw();root.append(card);
    }
    function invalidate() {epoch++;dashboardEpoch++;current = null;if (dialog?.open) dialog.close();}
    const result = {openIssue,openReview,viewLegacy:openReview,renderDashboard,submitIssue,submitReview,cancelCase,hasPending:() => busy,invalidate};
    api.openIssueSanctionModal = openIssue;api.viewSanction = openReview;api.franchiseDiscipline = result;return result;
}
