import {escapeHTML as esc, accountRecord, groupAccounts, filterAccounts, canManageAccess,
    accountAction, checkNewAccount, permissionLabels, branchRecord, filterBranches, branchAction, dateLabel, registerBranchRecord, branchName} from './access-workspace-model.js';

const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
    shield:'<path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z"/><path d="m8 12 3 3 5-6"/>',
    people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
    building:'<path d="M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h3"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v2"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'}[name] || ''}</svg>`;

export function initAccessWorkspace({document:d = document, window:w = window, pages = {}} = {}) {
    const root = d.getElementById('view-admin');
    if (!root || root.dataset.accessWorkspace) return;
    root.dataset.accessWorkspace = '20261005';
    const css = d.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./access-workspace.css',import.meta.url).href; d.head.append(css);
    const navIcon = d.querySelector('#nav-admin .nav-icon'); if (navIcon) navIcon.innerHTML = icon('shield');
    let records = [], groups = [], branches = [], accountReady = false, branchReady = false;
    let accountsLoading, branchesLoading, busy = false, stopped = false, activeTab = 'accounts';
    const user = () => w.auth?.currentUser;
    const writable = () => canManageAccess(user());
    const byId = id => d.getElementById(id);
    root.innerHTML = `<div class="acw-shell">
        <header class="acw-intro"><div><div class="acw-eyebrow">GOVERNANCE & CONFIGURATION</div><h2>Access & branch management</h2><p>Control who can enter Manager and keep branch settings organized.</p></div><div class="acw-security">${icon('shield')}<span>Owner-managed access<small>Core accounts and branches stay protected.</small></span></div></header>
        <div class="acw-metrics"><div><span>AUTHORIZED EMAILS</span><strong id="acwAccountCount">—</strong><small id="acwRecordCount">Loading access records</small></div><div><span>ACCOUNTS TO REVIEW</span><strong id="acwReviewCount">—</strong><small>Duplicate records or missing PIN setup</small></div><div><span>REGISTERED BRANCHES</span><strong id="acwBranchCount">—</strong><small id="acwBranchStatus">Checking branch settings</small></div></div>
        <div class="acw-tabs" role="tablist" aria-label="Access and branch management"><button role="tab" id="acwTab-accounts" aria-controls="acwPanel-accounts" aria-selected="true" data-tab="accounts">${icon('people')}HQ access</button><button role="tab" id="acwTab-branches" aria-controls="acwPanel-branches" aria-selected="false" tabindex="-1" data-tab="branches">${icon('building')}Branches</button></div>
        <p id="acwStatus" class="acw-status" role="status" aria-live="polite"></p>
        <section id="acwPanel-accounts" role="tabpanel" aria-labelledby="acwTab-accounts">
            <div class="acw-grant"><div><h3>Authorize a Google account</h3><p>Enter the email, then complete its profile, role, and security PIN.</p></div><form id="acwGrantForm"><label class="acw-sr" for="newManagerEmail">Google email address</label><input id="newManagerEmail" type="email" placeholder="name@company.com" autocomplete="off" required maxlength="254"><button type="submit" class="acw-primary" data-write>${icon('plus')}Grant access</button></form></div>
            <div id="acwDuplicateNote" class="acw-notice" hidden><span>${icon('shield')}<span id="acwDuplicateText"></span></span><button data-action="filter-duplicates">Review records ${icon('arrow')}</button></div>
            <div class="acw-panel"><div class="acw-panel-heading"><div><h3>Authorized accounts</h3><p>One email per row. Open an account to review its exact records.</p></div><button data-action="refresh-accounts">${icon('refresh')}Refresh accounts</button></div>
                <div class="acw-filters"><label class="acw-search">${icon('search')}<span class="acw-sr">Search accounts</span><input id="acwAccountSearch" type="search" placeholder="Search name, email, or branch"></label><label class="acw-select"><span class="acw-sr">Filter accounts</span><select id="acwAccountFilter"><option value="all">All accounts</option><option value="owner">System owner</option><option value="manager">Managers</option><option value="co-owner">Co-Owners</option><option value="franchise owner">Franchise owners</option><option value="duplicates">Duplicate records</option><option value="pin">PIN setup needed</option></select></label><span id="acwAccountResults"></span></div>
                <div class="acw-table-wrap"><table class="acw-table"><thead><tr><th>Account & profile</th><th>Role & scope</th><th>Security</th><th>Controls</th></tr></thead><tbody id="adminTableBody"><tr><td colspan="4" class="acw-empty">Loading authorized accounts…</td></tr></tbody></table></div>
                <footer class="acw-panel-footer">${icon('lock')}Only the main owner can reveal saved PINs inside a profile. Profile changes and revocation retain the existing confirmation steps.</footer>
            </div>
        </section>
        <section id="acwPanel-branches" role="tabpanel" aria-labelledby="acwTab-branches" hidden>
            <div class="acw-panel"><div class="acw-panel-heading"><div><h3>Branch directory</h3><p>Manage branch settings and release approval in one place.</p></div><div class="acw-actions"><button data-action="release" data-write>Register release</button><button data-action="add-branch" class="acw-primary" data-write>${icon('plus')}Add branch</button></div></div>
                <div class="acw-filters"><label class="acw-search">${icon('search')}<span class="acw-sr">Search branches</span><input id="acwBranchSearch" type="search" placeholder="Search branch or address"></label><label class="acw-select"><span class="acw-sr">Filter branches</span><select id="acwBranchFilter"><option value="all">All branches</option><option value="pending">Update approval needed</option><option value="protected">Protected branches</option></select></label><button data-action="refresh-branches">${icon('refresh')}Refresh</button></div>
                <div class="acw-table-wrap"><table class="acw-table acw-branches"><thead><tr><th>Branch & configuration</th><th>Release approval</th><th>Registered</th><th>Controls</th></tr></thead><tbody id="branchManagerListBody"><tr><td colspan="4" class="acw-empty">Loading registered branches…</td></tr></tbody></table></div>
                <footer class="acw-panel-footer">Release approval is recorded here. Installed app versions and live connections are checked on each branch device.</footer>
            </div>
        </section>
    </div><dialog id="acwAccountDialog" class="acw-dialog" aria-labelledby="acwDialogTitle"><div class="acw-dialog-head"><div><div class="acw-eyebrow">ACCOUNT REVIEW</div><h2 id="acwDialogTitle">Access records</h2></div><button data-action="close-review" aria-label="Close account review">${icon('close')}</button></div><div id="acwDialogBody"></div><footer><button data-action="close-review">Done</button></footer></dialog>`;

    function status(message = '', error = false) { const el = byId('acwStatus'); el.textContent = message; el.classList.toggle('acw-error',error); }
    function syncWriteControls() {
        root.querySelectorAll('[data-write]').forEach(el => { el.disabled = !writable() || busy || (el.closest('#acwGrantForm') ? !accountReady : !branchReady); });
    }
    const actionButton = (action,id,label,extra = '') => `<button data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
    const badge = (label,tone = '') => `<span class="acw-badge ${tone}">${esc(label)}</span>`;
    function accountControls(record) {
        if (!writable()) return '<small>Owner controls</small>';
        return `<div class="acw-actions">${actionButton('profile',record.id,'Profile & PIN')}${!record.owner ? actionButton('permissions',record.id,'Edit permissions')+actionButton('sync-access',record.id,'Sync saved access') : ''}</div>`;
    }
    function permissionText(record) { const labels = permissionLabels(record,pages); return labels.length ? labels.join(' · ') : 'No tabs assigned'; }
    function renderAccounts() {
        const filtered = filterAccounts(groups,byId('acwAccountSearch').value,byId('acwAccountFilter').value);
        byId('acwAccountResults').textContent = accountReady ? `${filtered.length} of ${groups.length} emails` : '';
        if (!accountReady) return;
        byId('acwAccountCount').textContent = groups.length;
        byId('acwRecordCount').textContent = `${records.length} access record${records.length === 1 ? '' : 's'}`;
        byId('acwReviewCount').textContent = groups.filter(group => group.duplicate || !group.pinConfigured).length;
        const duplicates = groups.filter(group => group.duplicate).length;
        byId('acwDuplicateNote').hidden = !duplicates;
        byId('acwDuplicateText').textContent = `${duplicates} email${duplicates === 1 ? ' has' : 's have'} multiple records. Review each record before changing access.`;
        byId('adminTableBody').innerHTML = filtered.length ? filtered.map(group => {
            const record = group.records[0];
            return `<tr><td><strong class="acw-email">${esc(group.email || 'Email missing')}</strong><span class="acw-name">${esc(group.name)}</span>${group.duplicate ? badge(`${group.records.length} records · review`,'acw-warn') : record.phone ? `<small>${esc(record.phone)}</small>` : ''}</td>
                <td>${badge(group.role,group.owner ? 'acw-owner' : '')}<small>${group.duplicate ? 'Review scope for each record' : esc(record.branch === 'All' || !record.branch ? 'Manager workspace' : record.branch)}</small></td>
                <td>${badge(group.pinConfigured ? 'PIN configured' : 'PIN setup needed',group.pinConfigured ? 'acw-good' : 'acw-warn')}<small>${group.owner ? 'Protected system account' : 'Google sign-in + security PIN'}</small></td>
                <td>${actionButton('review',record.id,group.duplicate ? 'Review records' : 'View access')}${!group.duplicate ? accountControls(record) : '<small class="acw-muted">Changes use the exact record</small>'}</td></tr>`;
        }).join('') : '<tr><td colspan="4" class="acw-empty">No accounts match your search or filter.</td></tr>';
        syncWriteControls();
    }
    function renderBranches() {
        if (!branchReady) return;
        const filtered = filterBranches(branches,byId('acwBranchSearch').value,byId('acwBranchFilter').value);
        const pending = branches.filter(row => row.approval === 'pending').length;
        byId('acwBranchCount').textContent = branches.length;
        byId('acwBranchStatus').textContent = pending ? `${pending} update approval${pending === 1 ? '' : 's'} needed` : 'Branch directory available';
        byId('branchManagerListBody').innerHTML = filtered.length ? filtered.map(row => `<tr><td><strong>${esc(row.name)}</strong><span class="acw-name">${row.protected ? 'Protected core branch' : 'Registered branch'}</span><small>${row.hasLocation ? 'Clock location configured' : 'Clock location not configured'}</small></td><td>${badge(row.approval === 'pending' ? 'Approval needed' : row.approval === 'approved' ? 'Approved' : 'No release registered',row.approval === 'pending' ? 'acw-warn' : row.approval === 'approved' ? 'acw-good' : '')}<small>Branch release approval</small></td><td>${esc(dateLabel(row.createdAt))}</td><td><div class="acw-actions">${writable() ? actionButton('settings',row.id,'Settings') + (row.approval === 'pending' ? actionButton('approve',row.id,'Approve update') : '') : '<small>Owner controls</small>'}</div>${row.protected ? '<small class="acw-muted">Core branch protected</small>' : writable() ? actionButton('delete',row.id,'Remove branch','class="acw-danger-text"') : ''}</td></tr>`).join('') : '<tr><td colspan="4" class="acw-empty">No branches match your search or filter.</td></tr>';
        syncWriteControls();
    }
    async function timedRead(operation) {
        let timer;
        try { return await Promise.race([operation,new Promise((_,reject) => { timer = w.setTimeout(() => reject(Error('HQ did not respond. Check your connection and refresh.')),20000); })]); }
        finally { w.clearTimeout(timer); }
    }
    function reader() { return w.getDocsFromServer || w.getDocs; }
    function readError(target,count,message) {
        byId(target).innerHTML = `<tr><td colspan="4" class="acw-empty acw-error">${esc(message)}</td></tr>`;
        byId(count).textContent = '—'; status(message,true); syncWriteControls();
    }
    function loadAccounts() {
        if (accountsLoading) return accountsLoading;
        accountReady = false; byId('acwDuplicateNote').hidden = true;
        byId('adminTableBody').innerHTML = '<tr><td colspan="4" class="acw-empty">Loading authorized accounts…</td></tr>';
        byId('acwAccountCount').textContent = byId('acwReviewCount').textContent = '—';
        syncWriteControls();
        accountsLoading = (async () => {
            try {
                if (!user() || !w.db || !reader()) throw Error('Sign in to connect to HQ.');
                const result = await timedRead(reader()(w.collection(w.db,'hq_managers')));
                if (stopped) return;
                records = result.docs.map(doc => accountRecord(doc.id,doc.data())); groups = groupAccounts(records);
                accountReady = true; renderAccounts(); status();
            } catch (error) { if (!stopped) { byId('acwRecordCount').textContent = 'Refresh to retry'; readError('adminTableBody','acwAccountCount',`Could not load accounts. ${error.message}`); } }
            finally { accountsLoading = null; }
        })();
        return accountsLoading;
    }
    function loadBranches() {
        if (branchesLoading) return branchesLoading;
        branchReady = false;
        byId('branchManagerListBody').innerHTML = '<tr><td colspan="4" class="acw-empty">Loading registered branches…</td></tr>';
        byId('acwBranchCount').textContent = '—';
        syncWriteControls();
        branchesLoading = (async () => {
            try {
                if (!user() || !w.db || !reader()) throw Error('Sign in to connect to HQ.');
                const [result,version] = await timedRead(Promise.all([
                    reader()(w.collection(w.db,'branches')),
                    (w.getDocFromServer || w.getDoc)(w.doc(w.db,'settings','global_app_version'))
                ]));
                if (stopped) return;
                const latest = version.exists() ? version.data().latestVersion : 0;
                w.globalBranchData = Object.fromEntries(result.docs.map(doc => [doc.id,doc.data()]));
                branches = result.docs.map(doc => branchRecord(doc.id,doc.data(),latest)).sort((a,b) => Number(b.protected)-Number(a.protected) || a.name.localeCompare(b.name));
                w.globalActiveBranches = [...new Set(branches.map(row => row.name))];
                branchReady = true; renderBranches();
                w.injectDynamicBranchDropdowns?.();
            } catch (error) { if (!stopped) { byId('acwBranchStatus').textContent = 'Refresh to retry'; readError('branchManagerListBody','acwBranchCount',`Could not load branches. ${error.message}`); } }
            finally { branchesLoading = null; }
        })();
        return branchesLoading;
    }
    const originalAccounts = w.loadAdminDashboard, originalBranches = w.loadBranchManager;
    w.loadAdminDashboard = loadAccounts; w.loadBranchManager = loadBranches;

    // The previous registration dialog did not contain the map its handler expected.
    // Register the branch first, then configure its real clock location in Settings.
    const registration = byId('addBranchModal'), originalRegistration = w.openAddBranchModal;
    let registrationForm, registrationRef, registrationName = '';
    function openRegistration() {
        if (!writable() || !branchReady) throw Error('Refresh the branch directory before registering a branch.');
        if (!registration) throw Error('Branch registration is unavailable. Refresh Manager.');
        byId('newBranchName').value = registrationName;
        byId('acwRegistrationStatus').textContent = registrationRef ? 'Retry will check the same registration request.' : '';
        registration.style.display = 'flex'; byId('acwRegistrationDialog').showModal(); byId('newBranchName').focus();
    }
    async function saveRegistration(event) {
        event.preventDefault();
        if (busy) return;
        const message = byId('acwRegistrationStatus');
        try {
            if (!writable() || !branchReady) throw Error('Refresh the branch directory before registering a branch.');
            const name = branchName(byId('newBranchName').value);
            if (branches.some(row => row.name.toLowerCase() === name.toLowerCase()) && registrationName !== name) throw Error('A branch with this name already exists.');
            if (registrationName && registrationName !== name) throw Error('The previous request is still being checked. Keep the same name and retry.');
            byId('newBranchName').value = name;
            busy = true; byId('btnSaveNewBranch').disabled = true; syncWriteControls();
            // Reuse a document ID after a lost response, so retry cannot create a second branch.
            registrationRef ||= w.doc(w.collection(w.db,'branches')); registrationName = name;
            await timedRead(registerBranchRecord({name,user:user(),timestamp:()=>w.serverTimestamp(),
                read:async()=>{const snapshot = await (w.getDocFromServer || w.getDoc)(registrationRef); return snapshot.exists() ? snapshot.data() : null;},
                write:payload=>w.setDoc(registrationRef,payload)}));
            registrationRef = null; registrationName = '';
            byId('acwRegistrationDialog').close(); status(`${name} is registered. Open Settings to configure its clock location and receipt details.`);
            // Preserve the app's existing provisioning hook, once registration is confirmed.
            try { await w.autoSetupNewBranch?.(name); } catch { status(`${name} is registered. Review its settings and initial setup before use.`,true); }
            await loadBranches();
        } catch (error) { message.textContent = error.message; }
        finally { busy = false; byId('btnSaveNewBranch').disabled = false; syncWriteControls(); }
    }
    const closeRegistration = event => { if (event.target.closest('[data-close-registration]')) byId('acwRegistrationDialog').close(); };
    const hideRegistration = () => { registration.style.display = 'none'; };
    if (registration) {
        registration.innerHTML = `<dialog id="acwRegistrationDialog" class="acw-registration" aria-labelledby="acwRegistrationTitle"><div class="acw-dialog-head"><div><div class="acw-eyebrow">BRANCH DIRECTORY</div><h2 id="acwRegistrationTitle">Register a branch</h2></div><button type="button" data-close-registration aria-label="Close branch registration">${icon('close')}</button></div><form id="acwRegistrationForm"><label for="newBranchName">Branch name</label><input id="newBranchName" maxlength="100" required placeholder="e.g. Agdao"><p class="acw-registration-note">The branch will appear in Manager and app branch lists. Configure its receipt details and actual clock location in Settings after registration.</p><p id="acwRegistrationStatus" role="status" class="acw-error"></p><div class="acw-registration-actions"><button type="button" data-close-registration>Cancel</button><button id="btnSaveNewBranch" type="submit" class="acw-primary">Register branch</button></div></form></dialog>`;
        registrationForm = byId('acwRegistrationForm'); registrationForm.addEventListener('submit',saveRegistration);
        registration.addEventListener('click',closeRegistration);
        byId('acwRegistrationDialog').addEventListener('close',hideRegistration);
        w.openAddBranchModal = openRegistration;
    }

    function setTab(tab) {
        if (!['accounts','branches'].includes(tab)) return;
        activeTab = tab;
        for (const value of ['accounts','branches']) {
            byId(`acwTab-${value}`).setAttribute('aria-selected',String(value === tab));
            byId(`acwTab-${value}`).tabIndex = value === tab ? 0 : -1;
            byId(`acwPanel-${value}`).hidden = value !== tab;
        }
        status();
    }
    function review(id) {
        if (!accountReady) throw Error('Refresh accounts before reviewing access.');
        const group = groups.find(row => row.records.some(record => record.id === id));
        if (!group) throw Error('This account is no longer in the loaded list. Refresh accounts.');
        byId('acwDialogTitle').textContent = group.email || 'Account without email';
        byId('acwDialogBody').innerHTML = `${group.duplicate ? '<p class="acw-review-notice">This email has multiple saved records. Records remain separately reviewable. Sign-in uses the latest saved PIN and the latest explicit permission update for this Google email.</p>' : ''}${group.records.map((record,i) => `<article class="acw-record"><div class="acw-record-head"><strong>${group.duplicate ? `Record ${i+1}` : 'Account profile'}</strong>${badge(record.role,record.owner ? 'acw-owner' : '')}</div><dl><dt>Name</dt><dd>${esc(record.name || 'Not provided')}</dd><dt>Branch scope</dt><dd>${esc(record.branch || 'Not recorded')}</dd><dt>Security PIN</dt><dd>${record.pinConfigured ? 'Configured · value hidden' : 'Setup needed'}</dd><dt>Record ID</dt><dd class="acw-id">${esc(record.id)}</dd></dl><div class="acw-permissions"><span>WORKSPACE TAB PERMISSIONS</span><p>${esc(permissionText(record))}</p></div>${accountControls(record)}${record.owner ? '<p class="acw-helper">The system owner cannot be revoked.</p>' : group.duplicate ? '<p class="acw-helper">Revocation is unavailable while this email has duplicate records. Resolve the records before removing access.</p>' : writable() ? actionButton('revoke',record.id,'Revoke account access','class="acw-danger-text"') : ''}</article>`).join('')}`;
        byId('acwAccountDialog').showModal();
    }
    async function runExisting(name,args = []) {
        if (typeof w[name] !== 'function') throw Error('This control is not ready. Refresh Manager and try again.');
        busy = true; syncWriteControls();
        byId('acwAccountDialog').close();
        try { await w[name](...args); }
        finally { busy = false; syncWriteControls(); }
    }
    async function grant(event) {
        event.preventDefault();
        if (busy) return;
        try {
            if (!accountReady) throw Error('Refresh accounts before granting access.');
            byId('newManagerEmail').value = checkNewAccount(byId('newManagerEmail').value,records,user());
            await runExisting('addHqManager');
        } catch (error) { status(error.message,true); }
    }
    async function clicked(event) {
        const button = event.target.closest('button');
        if (!button || !root.contains(button) || button.disabled || busy) return;
        if (button.dataset.tab) { setTab(button.dataset.tab); return; }
        const action = button.dataset.action, id = button.dataset.id;
        if (!action) return;
        try {
            if (action === 'close-review') { byId('acwAccountDialog').close(); return; }
            if (action === 'refresh-accounts') { await loadAccounts(); return; }
            if (action === 'refresh-branches') { await loadBranches(); return; }
            if (action === 'filter-duplicates') { byId('acwAccountFilter').value = 'duplicates'; byId('acwAccountSearch').value = ''; renderAccounts(); return; }
            if (action === 'review') { review(id); return; }
            if (action === 'sync-access') { if(!writable() || !accountReady)throw Error('Refresh accounts as the main Owner before synchronizing access.');await runExisting('syncSavedHQAccess',[id]);return; }
            if (['profile','permissions','revoke'].includes(action)) {
                if (!accountReady) throw Error('Refresh accounts before changing access.');
                const record = accountAction(records,id,action,user());
                // Existing dialogs build HTML. Escape values at that boundary; document IDs remain exact.
                if (action === 'profile') await runExisting('editManagerProfile',[record.id,esc(record.name),esc(record.phone),esc(record.email)]);
                else if (action === 'permissions') await runExisting('editManagerPermissions',[record.id,esc(record.email),record.permissions.join(',')]);
                else await runExisting('removeHqManager',[record.id,record.email]);
                return;
            }
            if (!writable()) throw Error('Only the system owner can manage branches.');
            if (!branchReady) throw Error('Refresh branches before changing settings.');
            if (action === 'release') { await runExisting('announceNewGlobalUpdate'); return; }
            if (action === 'add-branch') { await runExisting('openAddBranchModal'); return; }
            const row = branchAction(branches,id,action,user());
            if (action === 'settings') await runExisting('openBranchSettings',[row.id]);
            else if (action === 'approve') await runExisting('pushBranchUpdate',[row.id,row.name,row.targetVersion]);
            else if (action === 'delete') await runExisting('deleteBranch',[row.id,row.name]);
        } catch (error) { status(error.message,true); }
    }
    const filterChanged = event => {
        if (event.target.matches('#acwAccountSearch,#acwAccountFilter')) renderAccounts();
        else if (event.target.matches('#acwBranchSearch,#acwBranchFilter')) renderBranches();
    };
    const keydown = event => {
        if (!event.target.matches('[role="tab"]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); setTab(event.key === 'Home' ? 'accounts' : event.key === 'End' ? 'branches' : activeTab === 'accounts' ? 'branches' : 'accounts');
        byId(`acwTab-${activeTab}`).focus();
    };
    root.addEventListener('click',clicked); root.addEventListener('input',filterChanged); root.addEventListener('change',filterChanged); root.addEventListener('keydown',keydown);
    byId('acwGrantForm').addEventListener('submit',grant);
    const observer = new w.MutationObserver(() => { if (root.classList.contains('active')) { if (!accountReady) loadAccounts(); if (!branchReady) loadBranches(); } });
    observer.observe(root,{attributes:true,attributeFilter:['class']});
    syncWriteControls();
    if (root.classList.contains('active')) { loadAccounts(); loadBranches(); }
    return {stop() {
        stopped = true; observer.disconnect();
        root.removeEventListener('click',clicked); root.removeEventListener('input',filterChanged); root.removeEventListener('change',filterChanged); root.removeEventListener('keydown',keydown);
        byId('acwGrantForm').removeEventListener('submit',grant); byId('acwAccountDialog').close();
        registrationForm?.removeEventListener('submit',saveRegistration); registration?.removeEventListener('click',closeRegistration);
        byId('acwRegistrationDialog')?.removeEventListener('close',hideRegistration);
        byId('acwRegistrationDialog')?.close(); if (registration) registration.style.display = 'none';
        if (w.openAddBranchModal === openRegistration) w.openAddBranchModal = originalRegistration;
        if (w.loadAdminDashboard === loadAccounts) w.loadAdminDashboard = originalAccounts;
        if (w.loadBranchManager === loadBranches) w.loadBranchManager = originalBranches;
    }};
}
