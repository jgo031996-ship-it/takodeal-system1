import {DRAFT_TYPES, escapeHTML as esc, newDraftId, prepareGuidedDraft, audienceLabel, canPublish, validateDraft,
    visibleAnnouncement, uniqueSignatures, createDraftStore, publicationMatches, publishReviewedDraft} from './ai-hub-model.js';

const icon = (name, size = 20) => {
    const paths = { document:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
        edit:'<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>', folder:'<path d="M3 7V5h7l2 2h9v14H3z"/>', check:'<path d="m5 12 4 4L19 6"/>',
        arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>',
        close:'<path d="m6 6 12 12M18 6 6 18"/>', grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
};
const formatDate = timestamp => {
    const value = timestamp?.toDate?.() || (timestamp?.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp));
    return !timestamp || Number.isNaN(value.getTime()) ? 'Pending date' : value.toLocaleString('en-PH', {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
};

export function initAIHub({document:d = document, window:w = window} = {}) {
    const root = d.getElementById('view-bulletin');
    if (!root || root.dataset.aiHub) return;
    root.dataset.aiHub = 'professional-20261004';
    const css = d.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./ai-hub.css', import.meta.url).href; d.head.append(css);
    const nav = d.querySelector('#nav-bulletin .nav-text'); if (nav) nav.textContent = 'AI Hub';
    const navIcon = d.querySelector('#nav-bulletin .nav-icon'); if (navIcon) navIcon.innerHTML = icon('grid',17);
    const user = () => w.sessionUser, uid = () => w.auth?.currentUser?.uid || '';
    let storage; try { storage = w.localStorage; } catch { storage = {getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}}; }
    const draftStore = createDraftStore(storage, uid());
    let draft, attachments = [], imageURLs = [], history = [], signatures = [], loading, busy = false, reviewed = false, activeTab = 'workspace';
    const canWrite = canPublish(user());
    root.innerHTML = `<div class="aih-shell">
        <header class="aih-intro"><div><div class="aih-eyebrow">TEAM COMMUNICATION</div><h2>Company announcements</h2><p>Prepare clear instructions. Review every detail. Keep your team informed.</p></div><div class="aih-mode"><span></span>Built-in drafting<small>Works inside Manager. No external account needed.</small></div></header>
        <div class="aih-overview"><div><span>ACTIVE ANNOUNCEMENTS</span><strong id="aihActiveCount">—</strong></div><div><span>STAFF SIGNATURES</span><strong id="aihSignatureCount">—</strong></div><div><span>DRAFTS ON THIS DEVICE</span><strong id="aihDraftCount">0</strong></div><p>Brief <span>→</span> Draft <span>→</span> Review <span>→</span> Publish</p></div>
        <div class="aih-tabs" role="tablist" aria-label="AI Hub workspace">
            <button id="aihTab-workspace" role="tab" aria-controls="aihPanel-workspace" aria-selected="true" data-tab="workspace">${icon('edit',17)}Writing workspace</button>
            <button id="aihTab-drafts" role="tab" aria-controls="aihPanel-drafts" aria-selected="false" tabindex="-1" data-tab="drafts">${icon('folder',17)}Saved drafts</button>
            <button id="aihTab-published" role="tab" aria-controls="aihPanel-published" aria-selected="false" tabindex="-1" data-tab="published">${icon('document',17)}Published & signatures</button>
        </div>
        <p id="aihStatus" class="aih-status" role="status" aria-live="polite"></p>
        <section id="aihPanel-workspace" role="tabpanel" aria-labelledby="aihTab-workspace">
            <div class="aih-workspace">
                <aside class="aih-brief aih-panel"><div class="aih-panel-title"><span class="aih-step">01</span><div><h3>Start with a brief</h3><p>Choose a format and enter the facts.</p></div></div>
                    <div class="aih-formats">${Object.entries(DRAFT_TYPES).map(([type, item]) => `<button data-format="${type}" aria-pressed="${type === 'notice'}"><span>${item.label}</span><small>${item.note}</small></button>`).join('')}</div>
                    <label for="aihBriefTitle">Subject</label><input id="aihBriefTitle" maxlength="180" placeholder="e.g. Updated opening checklist">
                    <label for="aihBriefFacts">Key facts & instructions</label><textarea id="aihBriefFacts" rows="7" maxlength="11000" placeholder="Include the required actions, responsible people, and any deadlines."></textarea>
                    <label for="aihBriefDate">Effective date <span>(optional)</span></label><input id="aihBriefDate" type="date">
                    <button class="aih-primary aih-wide" data-action="prepare">Prepare draft ${icon('arrow',16)}</button>
                    <p class="aih-helper">Built-in templates organize your words. They do not call ChatGPT or verify facts.</p>
                </aside>
                <div class="aih-editor aih-panel"><div class="aih-panel-title"><span class="aih-step">02</span><div><h3>Compose your announcement</h3><p>Edit the draft before it reaches your team.</p></div><button class="aih-text-button" data-action="new">New draft</button></div>
                    <div class="aih-editor-meta"><span id="aihDraftSource">Manual draft</span><span id="aihSaveState">Not saved yet</span></div>
                    <label for="announceTitle">Announcement title <span class="aih-required">Required</span></label><input id="announceTitle" maxlength="180" placeholder="Enter a clear, descriptive title">
                    <label for="announceSubHeadline">Summary <span>(optional)</span></label><input id="announceSubHeadline" maxlength="300" placeholder="A short introduction or effective date">
                    <div class="aih-label-row"><label for="announceMessage">Message <span class="aih-required">Required</span></label><span id="aihWordCount">0 words</span></div><textarea id="announceMessage" rows="11" maxlength="12000" placeholder="Write the announcement or prepare a draft from your brief."></textarea>
                    <label for="announceFooter">Issued by <span>(optional)</span></label><input id="announceFooter" maxlength="300" placeholder="TAKODEÁL Management">
                    <div class="aih-section-label">AUDIENCE & DELIVERY</div><div class="aih-target-grid"><div><label for="announceTargetType">Send to</label><select id="announceTargetType"><option value="All">All branches & staff</option><option value="Branch">Specific branch</option><option value="Individual">Individual staff member</option></select></div><div id="aihBranchField" hidden><label for="announceTargetBranch">Branch</label><select id="announceTargetBranch"><option value="">Choose a branch</option></select></div><div id="aihStaffField" hidden><label for="announceTargetStaff">Staff member</label><select id="announceTargetStaff"><option value="">Choose a staff member</option></select></div></div>
                    <label class="aih-attachments" for="announceImages">${icon('document',19)}<span>Attach images <small>Optional · JPG, PNG or WebP · up to 8 images, 5 MB each</small></span><input id="announceImages" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="aihFiles" class="aih-files"></div>
                    <div class="aih-editor-actions"><div><strong id="aihAudienceSummary">All branches & staff</strong><small>Staff acknowledgement remains required.</small></div><button class="aih-primary" data-action="review">Review announcement ${icon('arrow',16)}</button></div>
                </div>
            </div>
        </section>
        <section id="aihPanel-drafts" role="tabpanel" aria-labelledby="aihTab-drafts" hidden><div class="aih-panel"><div class="aih-panel-title"><div><h3>Saved drafts</h3><p>Up to 20 drafts saved for your account on this device. Reselect image files after reopening.</p></div><button class="aih-primary" data-action="new">New draft</button></div><div id="aihDraftList" class="aih-draft-list"></div></div></section>
        <section id="aihPanel-published" role="tabpanel" aria-labelledby="aihTab-published" hidden><div class="aih-panel"><div class="aih-panel-title"><div><h3>Published announcements</h3><p>Review delivery audiences, active notices, and staff acknowledgement.</p></div><button class="aih-secondary" data-action="refresh">${icon('refresh',16)}Refresh</button></div><div class="aih-table-wrap"><table class="aih-table"><thead><tr><th>Published</th><th>Announcement & audience</th><th>Status</th><th>Signatures & actions</th></tr></thead><tbody id="announcementHistoryBody"><tr><td colspan="4" class="aih-empty">Open this tab to load announcements.</td></tr></tbody></table></div></div></section>
        <dialog id="aihReviewDialog" class="aih-dialog" aria-labelledby="aihReviewHeading"><div class="aih-dialog-heading"><div><span class="aih-eyebrow">03 / REVIEW BEFORE PUBLISHING</span><h3 id="aihReviewHeading">Announcement preview</h3></div><button class="aih-icon-button" data-action="close-review" aria-label="Close preview">${icon('close')}</button></div><div class="aih-dialog-body"><p id="aihReviewAudience" class="aih-review-audience"></p><article class="aih-paper"><div class="aih-paper-brand">TAKODEÁL <span>OFFICIAL COMMUNICATION</span></div><h2 id="aihReviewTitle"></h2><p id="aihReviewSummary"></p><div id="aihReviewMessage"></div><footer id="aihReviewFooter"></footer><div id="aihReviewImages" class="aih-review-images"></div></article><label class="aih-review-check"><input id="aihReviewed" type="checkbox"><span>I have reviewed the message, details, and selected audience.</span></label><p class="aih-helper">Publishing makes this notice available to the selected staff and requests their acknowledgement.</p><p id="aihPublishError" role="alert" class="aih-error"></p></div><div class="aih-dialog-actions"><button class="aih-secondary" data-action="close-review">Continue editing</button><button id="btnPublishAnnounce" class="aih-primary" data-action="publish" disabled>Publish announcement</button></div></dialog>
        <dialog id="aihDetailDialog" class="aih-dialog" aria-labelledby="aihDetailHeading"><div class="aih-dialog-heading"><h3 id="aihDetailHeading">Announcement details</h3><button class="aih-icon-button" data-action="close-details" aria-label="Close announcement details">${icon('close')}</button></div><div id="aihDetailBody" class="aih-dialog-body"></div></dialog>
    </div>`;
    const el = id => d.getElementById(id);
    const fields = {title:'announceTitle',subHeadline:'announceSubHeadline',message:'announceMessage',footerMessage:'announceFooter',targetType:'announceTargetType',targetBranch:'announceTargetBranch',targetStaff:'announceTargetStaff'};
    function status(text, error = false) { el('aihStatus').textContent = text; el('aihStatus').classList.toggle('aih-error',error); }
    function ensureAccount() { if (!uid() || uid() !== identity || !canPublish(user())) throw new Error('Sign in again with an account that can publish announcements.'); }
    const identity = uid();
    function readFields() { for (const [key,id] of Object.entries(fields)) draft[key] = el(id).value; draft.updatedAt = Date.now(); return draft; }
    function save() {
        if (!canWrite || !uid() || uid() !== identity) return;
        readFields(); draft.brief = {type:draft.type, title:el('aihBriefTitle').value, facts:el('aihBriefFacts').value, date:el('aihBriefDate').value};
        if (!draft.title.trim() && !draft.message.trim() && !draft.brief.title.trim() && !draft.brief.facts.trim()) return;
        const saved = draftStore.save(draft);
        el('aihSaveState').textContent = saved ? 'Saved on this device' : draftStore.error();
        el('aihSaveState').classList.toggle('aih-error',!saved); el('aihDraftCount').textContent = draftStore.list().length;
        return saved;
    }
    function updateCounts() {
        const words = el('announceMessage').value.trim().split(/\s+/).filter(Boolean).length;
        el('aihWordCount').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
        el('aihAudienceSummary').textContent = audienceLabel(readFields());
    }
    function releaseImages(clearInput = true) { imageURLs.forEach(url => w.URL.revokeObjectURL(url)); imageURLs = []; attachments = []; if (clearInput) el('announceImages').value = ''; el('aihFiles').replaceChildren(); }
    function fillDraft(value) {
        draft = {...value}; releaseImages();
        for (const [key,id] of Object.entries(fields)) el(id).value = draft[key] || (key === 'targetType' ? 'All' : '');
        el('aihBriefTitle').value = draft.brief?.title || ''; el('aihBriefFacts').value = draft.brief?.facts || ''; el('aihBriefDate').value = draft.brief?.date || '';
        root.querySelectorAll('[data-format]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.format === (draft.type || 'notice'))));
        el('aihDraftSource').textContent = draft.source === 'guided-template' ? 'Guided draft · editable' : 'Manual draft';
        el('aihSaveState').textContent = value.updatedAt ? 'Restored from this device' : 'Not saved yet';
        updateTargets(); updateCounts();
    }
    function blankDraft() { return {id:newDraftId(w.crypto), type:'notice',title:'',subHeadline:'',message:'',footerMessage:'TAKODEÁL Management',targetType:'All',targetBranch:'',targetStaff:'',createdAt:Date.now(),source:'manager-editor'}; }
    function showTab(tab) {
        activeTab = canWrite ? tab : 'published';
        root.querySelectorAll('[data-tab]').forEach(button => { const selected = button.dataset.tab === activeTab; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1; });
        for (const name of ['workspace','drafts','published']) el('aihPanel-'+name).hidden = name !== activeTab;
        if (activeTab === 'drafts') renderDrafts(); if (activeTab === 'published') loadHistory();
    }
    async function updateTargets() {
        const type = el('announceTargetType').value;
        el('aihBranchField').hidden = type !== 'Branch'; el('aihStaffField').hidden = type !== 'Individual';
        if (type === 'Branch') {
            const selected = draft.targetBranch;
            const branches = [...new Set([...(w.globalActiveBranches || []),...(selected ? [selected] : [])])].sort();
            el('announceTargetBranch').innerHTML = '<option value="">Choose a branch</option>' + branches.map(branch => `<option value="${esc(branch)}">${esc(branch)}</option>`).join('');
            el('announceTargetBranch').value = selected || '';
            if (!branches.length) status('Branch names are not loaded yet. Open the branch list, then return here.',true);
        }
        if (type === 'Individual' && el('announceTargetStaff').options.length <= 1 && w.getDocs) {
            const selected = draft.targetStaff; el('announceTargetStaff').disabled = true;
            try {
                const snap = await w.getDocs(w.collection(w.db,'cashiers'));
                if (uid() !== identity) return;
                const names = [...new Set(snap.docs.map(row => row.data()).filter(row => row.status !== 'Resigned' && row.pin !== 'REVOKED').map(row => row.cashierName).filter(Boolean))].sort();
                el('announceTargetStaff').innerHTML = '<option value="">Choose a staff member</option>' + names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join(''); el('announceTargetStaff').value = selected || '';
                updateCounts();
            } catch { status('Staff names could not be loaded. Reconnect and choose the audience again.',true); }
            finally { el('announceTargetStaff').disabled = false; }
        }
    }
    function renderDrafts() {
        const rows = draftStore.list(); el('aihDraftCount').textContent = rows.length;
        el('aihDraftList').innerHTML = rows.length ? rows.map(row => `<article class="aih-draft-card"><div>${icon('document',22)}<span><strong>${esc(row.title || row.brief?.title || 'Untitled draft')}</strong><small>${esc(audienceLabel(row))} · ${esc(formatDate(row.updatedAt))}</small></span></div><p>${esc((row.message || row.brief?.facts || '').slice(0,170))}${(row.message || '').length > 170 ? '…' : ''}</p><div><button class="aih-secondary" data-open-draft="${esc(row.id)}">Continue editing</button><button class="aih-text-button" data-delete-draft="${esc(row.id)}">Delete draft</button></div></article>`).join('') : '<p class="aih-empty">Your saved drafts will appear here as you write. Drafts are private to your account on this device.</p>';
    }
    function renderHistory() {
        const rows = history.filter(row => visibleAnnouncement(row,user()));
        const counts = row => uniqueSignatures(signatures.filter(ack => ack.announcementId === row.id));
        el('aihActiveCount').textContent = rows.filter(row => row.active === true).length;
        el('aihSignatureCount').textContent = rows.reduce((sum,row) => sum + counts(row).length,0);
        el('announcementHistoryBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${esc(formatDate(row.timestamp))}</td><td><button class="aih-history-title" data-details="${esc(row.id)}">${esc(row.title || 'Untitled announcement')}</button><small>${esc(audienceLabel(row))}</small></td><td><span class="aih-badge ${row.active ? 'is-active' : ''}">${row.active ? 'Active' : 'Archived'}</span></td><td><div class="aih-history-actions"><button class="aih-secondary" data-details="${esc(row.id)}">${counts(row).length} signed</button>${canWrite ? `<button class="aih-text-button" data-toggle="${esc(row.id)}">${row.active ? 'Archive' : 'Reactivate'}</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="4" class="aih-empty">No announcements published for this audience yet.</td></tr>';
    }
    async function loadHistory() {
        if (loading) return loading;
        const button = root.querySelector('[data-action="refresh"]'); button.disabled = true;
        el('announcementHistoryBody').innerHTML = '<tr><td colspan="4" class="aih-empty">Loading announcements and signatures…</td></tr>';
        loading = (async () => {
            try {
                const [notices,acks] = await Promise.all([w.getDocs(w.query(w.collection(w.db,'announcements'),w.orderBy('timestamp','desc'))),w.getDocs(w.collection(w.db,'acknowledgments'))]);
                if (uid() !== identity) return;
                history = notices.docs.map(row => ({...row.data(),id:row.id})); signatures = acks.docs.map(row => row.data()); renderHistory();
            } catch {
                el('announcementHistoryBody').innerHTML = '<tr><td colspan="4" class="aih-empty aih-error">Could not load announcements. Check your connection and choose Refresh.</td></tr>';
                el('aihActiveCount').textContent = '—'; el('aihSignatureCount').textContent = '—';
            } finally { loading = null; button.disabled = false; }
        })(); return loading;
    }
    function showReview() {
        ensureAccount(); save(); const issues = validateDraft(readFields(),attachments);
        if (issues.length) { status(issues.join(' '),true); return; }
        reviewed = false; el('aihReviewed').checked = false; el('btnPublishAnnounce').disabled = true; el('aihPublishError').textContent = '';
        el('aihReviewAudience').textContent = 'Selected audience: ' + audienceLabel(draft);
        for (const [id,key] of [['aihReviewTitle','title'],['aihReviewSummary','subHeadline'],['aihReviewMessage','message'],['aihReviewFooter','footerMessage']]) el(id).textContent = draft[key] || '';
        el('aihReviewImages').innerHTML = imageURLs.map((url,i) => `<img src="${esc(url)}" alt="${esc(attachments[i].name)}">`).join('');
        el('aihReviewDialog').showModal();
    }
    function showDetails(id) {
        const row = history.find(row => row.id === id && visibleAnnouncement(row,user())); if (!row) return;
        const acks = uniqueSignatures(signatures.filter(ack => ack.announcementId === id));
        el('aihDetailHeading').textContent = row.title || 'Announcement details';
        const safeImages = (Array.isArray(row.images) ? row.images : []).filter(url => { try { return new URL(url).protocol === 'https:'; } catch { return false; } });
        el('aihDetailBody').innerHTML = `<p class="aih-review-audience">${esc(audienceLabel(row))} · ${esc(formatDate(row.timestamp))}</p><article class="aih-paper"><p>${esc(row.subHeadline || '')}</p><div class="aih-detail-message">${esc(row.message || '')}</div><footer>${esc(row.footerMessage || '')}</footer><div class="aih-review-images">${safeImages.map(url => `<img src="${esc(url)}" alt="Announcement attachment" loading="lazy">`).join('')}</div></article><h4 class="aih-signature-heading">Staff signatures <span>${acks.length}</span></h4>${acks.length ? `<ul class="aih-signature-list">${acks.map(ack => `<li><strong>${esc(ack.staffName)}</strong><span>${esc(formatDate(ack.timestamp))}</span></li>`).join('')}</ul>` : '<p class="aih-helper">No staff signatures yet.</p>'}`;
        el('aihDetailDialog').showModal();
    }
    const adapter = {
        async read(id) { const snap = await w.getDocFromServer(w.doc(w.db,'announcements',id)); return snap.exists() ? snap.data() : null; },
        async upload(id, index, file) {
            ensureAccount(); const extension = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
            const reference = w.ref(w.storage,`announcements/${id}/${index}.${extension}`);
            const result = await w.uploadBytes(reference,file); return w.getDownloadURL(result.ref);
        },
        async commit(id, payload) {
            ensureAccount(); return w.runTransaction(w.db, async tx => {
                const reference = w.doc(w.db,'announcements',id), prior = await tx.get(reference);
                if (prior.exists()) { if (!publicationMatches(prior.data(),payload)) throw new Error('This draft is already published. Start a new draft for another announcement.'); return {id,existing:true}; }
                tx.set(reference,{...payload,timestamp:w.serverTimestamp()}); return {id,existing:false};
            });
        }
    };
    async function publish() {
        if (busy) return;
        busy = true; const button = el('btnPublishAnnounce'); button.disabled = true; button.textContent = 'Publishing…'; el('aihPublishError').textContent = '';
        try {
            ensureAccount();
            const result = await publishReviewedDraft(readFields(),attachments,{user:user(),uid:uid(),online:w.navigator.onLine,reviewed,adapter});
            draftStore.remove(draft.id); fillDraft(blankDraft()); el('aihDraftCount').textContent = draftStore.list().length;
            el('aihReviewDialog').close(); status(result.existing ? 'This announcement was already published. No duplicate was created.' : 'Announcement published. Staff acknowledgement is now being tracked.'); showTab('published');
        } catch (error) { el('aihPublishError').textContent = error.message || 'Publication could not be confirmed. Your draft is saved; reconnect and retry.'; }
        finally { busy = false; button.textContent = 'Publish announcement'; button.disabled = !reviewed; }
    }
    async function toggle(id) {
        ensureAccount(); const row = history.find(row => row.id === id); if (!row) return;
        if (!w.confirm(`${row.active ? 'Archive' : 'Reactivate'} “${row.title}”? ${row.active ? 'This stops requesting new acknowledgements. Existing signatures remain saved.' : 'Staff who have not signed will be asked to acknowledge this notice.'}`)) return;
        try { await w.updateDoc(w.doc(w.db,'announcements',id),{active:!row.active}); status(row.active ? 'Announcement archived. Signatures are retained.' : 'Announcement reactivated.'); await loadHistory(); }
        catch { status('Could not update the announcement. Reconnect and try again.',true); }
    }
    async function act(event) {
        const button = event.target.closest('button'); if (!button) return;
        try {
            if (button.dataset.tab) { showTab(button.dataset.tab); return; }
            if (button.dataset.format && canWrite) { draft.type = button.dataset.format; root.querySelectorAll('[data-format]').forEach(item => item.setAttribute('aria-pressed',String(item === button))); save(); return; }
            if (button.dataset.openDraft) { const selected = draftStore.list().find(row => row.id === button.dataset.openDraft); if (selected) { if (save() === false) throw new Error(draftStore.error()); fillDraft(selected); showTab('workspace'); status('Draft restored. Reselect any image attachments before publishing.'); } return; }
            if (button.dataset.deleteDraft) { if (w.confirm('Delete this saved draft from this device?')) { draftStore.remove(button.dataset.deleteDraft); renderDrafts(); if (draft.id === button.dataset.deleteDraft) fillDraft(blankDraft()); } return; }
            if (button.dataset.details) { showDetails(button.dataset.details); return; }
            if (button.dataset.toggle) { await toggle(button.dataset.toggle); return; }
            switch (button.dataset.action) {
                case 'new': ensureAccount(); if (save() === false) throw new Error(draftStore.error()); fillDraft(blankDraft()); showTab('workspace'); status('New draft ready. Your previous draft remains in Saved drafts.'); el('announceTitle').focus(); break;
                case 'prepare': {
                    ensureAccount();
                    const hadMessage = !!(draft.title || draft.message), priorId = draft.id;
                    if (hadMessage && !w.confirm('Prepare a new guided draft? The current draft will remain in Saved drafts.')) return;
                    const generated = prepareGuidedDraft({type:draft.type,title:el('aihBriefTitle').value,facts:el('aihBriefFacts').value,date:el('aihBriefDate').value},{id:newDraftId(w.crypto)});
                    generated.targetType = draft.targetType; generated.targetBranch = draft.targetBranch; generated.targetStaff = draft.targetStaff;
                    if (save() === false) throw new Error(draftStore.error()); fillDraft(generated); const saved = save();
                    if (saved && !hadMessage) { draftStore.remove(priorId); el('aihDraftCount').textContent = draftStore.list().length; }
                    status('Guided draft prepared. Review and edit the wording and facts before publishing.'); el('announceTitle').focus(); break;
                }
                case 'review': showReview(); break;
                case 'publish': await publish(); break;
                case 'refresh': await loadHistory(); break;
                case 'close-review': if (!busy) el('aihReviewDialog').close(); break;
                case 'close-details': el('aihDetailDialog').close(); break;
            }
        } catch (error) { status(error.message || 'This action could not be completed. Please try again.',true); }
    }
    root.addEventListener('click',act);
    root.addEventListener('input', event => {
        if (event.target.id === 'aihReviewed') { reviewed = event.target.checked; el('btnPublishAnnounce').disabled = !reviewed || busy; return; }
        if (!canWrite || event.target.type === 'file') return;
        if (event.target.matches('input,textarea,select')) { reviewed = false; save(); updateCounts(); }
    });
    root.addEventListener('change', event => {
        if (event.target.id === 'announceTargetType') { readFields(); updateTargets(); save(); updateCounts(); }
        if (event.target.id === 'announceImages') {
            const files = [...event.target.files]; const issues = validateDraft({title:'File validation',message:'File validation',targetType:'All'},files);
            releaseImages(false); if (issues.length) { event.target.value = ''; status(issues.join(' '),true); return; }
            attachments = files; imageURLs = files.map(file => w.URL.createObjectURL(file));
            el('aihFiles').innerHTML = files.map(file => `<span>${esc(file.name)} <small>${(file.size/1024/1024).toFixed(1)} MB</small></span>`).join('');
            status(files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected. Images are uploaded only when you publish.` : 'Image attachments removed.');
        }
    });
    el('aihReviewDialog').addEventListener('cancel',event => { if (busy) event.preventDefault(); });
    root.querySelector('[role="tablist"]').addEventListener('keydown',event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        const tabs = [...root.querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden), index = tabs.indexOf(d.activeElement); if (index < 0) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus(); showTab(tabs[next].dataset.tab);
    });
    w.loadAnnouncementHistory = loadHistory;
    // Legacy route calls now point to this workspace; no Gemini prompt builder remains.
    w.publishAnnouncement = showReview;
    const saved = draftStore.list(); fillDraft(canWrite && saved.length ? saved[0] : blankDraft()); el('aihDraftCount').textContent = saved.length;
    if (!canWrite) { root.querySelector('[data-tab="workspace"]').hidden = true; root.querySelector('[data-tab="drafts"]').hidden = true; showTab('published'); }
    else if (draftStore.error()) status(draftStore.error(),true);
    const observer = new w.MutationObserver(() => { if (root.classList.contains('active')) loadHistory(); });
    observer.observe(root,{attributes:true,attributeFilter:['class']});
    if (root.classList.contains('active')) loadHistory();
    return {loadHistory,showTab,stop(){observer.disconnect(); imageURLs.forEach(url => w.URL.revokeObjectURL(url));}};
}
