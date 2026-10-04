// Built-in drafting: deterministic templates, never presented as a model response.
export const DRAFT_TYPES = Object.freeze({
    notice: { label: 'Operational notice', note: 'Share a clear update with your team.', opening: 'Please review the following operational update.', closing: 'Review these instructions and acknowledge this notice.' },
    policy: { label: 'Policy & standards', note: 'Document expectations and required actions.', opening: 'The following standards apply to the selected team.', closing: 'Follow these requirements and acknowledge that you have read this notice.' },
    schedule: { label: 'Schedule update', note: 'Communicate dates, assignments, and changes.', opening: 'Please review the following schedule update.', closing: 'Check your assigned schedule. Contact your manager if a clarification is needed, then acknowledge this notice.' },
    training: { label: 'Training & procedure', note: 'Give practical steps for consistent work.', opening: 'Please review the following procedure.', closing: 'Review each step with your manager when needed and acknowledge this notice.' }
});
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const cleanText = (value, max = 12000) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export function newDraftId(crypto = globalThis.crypto) {
    return 'hub-' + (crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
}
export function dateLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value + 'T12:00:00');
    if (Number.isNaN(date.getTime()) || `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` !== value) return '';
    return date.toLocaleDateString('en-PH', {month:'long', day:'numeric', year:'numeric'});
}
export function prepareGuidedDraft(brief, { id = newDraftId(), now = Date.now() } = {}) {
    const type = Object.hasOwn(DRAFT_TYPES, brief.type) ? brief.type : 'notice', template = DRAFT_TYPES[type];
    const title = cleanText(brief.title, 180), facts = cleanText(brief.facts);
    if (!title || !facts) throw new Error('Enter a subject and the facts or instructions to include.');
    const effective = dateLabel(brief.date);
    if (brief.date && !effective) throw new Error('Choose a valid effective date.');
    return { id, type, brief: {type, title, facts, date:brief.date || ''}, title,
        subHeadline: effective ? `Effective ${effective}` : template.label,
        message: `${template.opening}\n\n${facts}\n\n${template.closing}`,
        footerMessage: 'TAKODEÁL Management', targetType:'All', targetBranch:'', targetStaff:'',
        createdAt:now, updatedAt:now, source:'guided-template' };
}
export function audienceLabel(draft) {
    return draft.targetType === 'Branch' ? draft.targetBranch || 'Choose a branch'
        : draft.targetType === 'Individual' ? draft.targetStaff || 'Choose a staff member' : 'All branches & staff';
}
export function canPublish(user) {
    return !!user && !user.isFranchisee && (user.isOwner || user.permissions?.includes('all') || user.permissions?.includes('bulletin'));
}
export function validateDraft(draft, files = []) {
    const issues = [];
    if (!cleanText(draft.title)) issues.push('Add an announcement title.');
    if (!cleanText(draft.message)) issues.push('Add the announcement message.');
    if (!['All','Branch','Individual'].includes(draft.targetType)) issues.push('Choose a valid audience.');
    if (draft.targetType === 'Branch' && !cleanText(draft.targetBranch)) issues.push('Choose the target branch.');
    if (draft.targetType === 'Individual' && !cleanText(draft.targetStaff)) issues.push('Choose the target staff member.');
    if (String(draft.title || '').length > 180 || String(draft.message || '').length > 12000) issues.push('Keep the title within 180 characters and the message within 12,000 characters.');
    if (files.length > 8) issues.push('Attach up to 8 images.');
    if (files.some(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) issues.push('Use JPG, PNG, or WebP images up to 5 MB each.');
    return issues;
}
export function visibleAnnouncement(row, user) {
    if (!user) return false;
    if (!user.isFranchisee) return canPublish(user);
    if (row.targetType === 'Individual') return row.targetStaff === user.cashierName;
    return !row.targetType || row.targetType === 'All' || row.targetType === 'Branch' && user.allowedBranches?.includes(row.targetBranch);
}
export function uniqueSignatures(rows = []) {
    const signatures = new Map();
    for (const row of rows) {
        const name = cleanText(row.staffName, 180);
        if (name && !signatures.has(name.toLowerCase())) signatures.set(name.toLowerCase(), row);
    }
    return [...signatures.values()];
}
export function createDraftStore(storage, identity) {
    const key = identity ? 'takodeal.ai-hub.v1/' + encodeURIComponent(identity) : '';
    let lastError = '';
    function read() {
        if (!key) return [];
        try {
            const data = JSON.parse(storage.getItem(key) || '[]');
            return Array.isArray(data) ? data.filter(row => row && typeof row.id === 'string' && row.id.startsWith('hub-')).slice(0, 20) : [];
        } catch { lastError = 'Draft storage is unavailable on this browser.'; return []; }
    }
    function write(rows) {
        if (!key) { lastError = 'Sign in to save a draft.'; return false; }
        try { storage.setItem(key, JSON.stringify(rows)); lastError = ''; return true; }
        catch { lastError = 'Draft not saved. Browser storage is unavailable or full.'; return false; }
    }
    return { list:read, save(draft) {
        const rows = read();
        if (rows.length >= 20 && !rows.some(row => row.id === draft.id)) { lastError = '20 drafts are saved. Delete an old draft to save a new one.'; return false; }
        return write([draft, ...rows.filter(row => row.id !== draft.id)]);
    },
        remove(id) { return write(read().filter(row => row.id !== id)); }, error:() => lastError };
}
export function publicationMatches(row, payload) {
    return ['title','subHeadline','message','footerMessage','targetType','targetBranch','targetStaff','publisherUid'].every(key => (row[key] ?? null) === (payload[key] ?? null));
}
// Use one document ID for retries, with a final transaction check. A failed or
// uncertain connection must never overwrite an existing notice or publish twice.
export async function publishReviewedDraft(draft, files, {user, uid, online, reviewed, adapter}) {
    if (!canPublish(user) || !uid) throw new Error('Your account does not have announcement publishing access.');
    if (!online) throw new Error('Reconnect to publish. Your draft remains on this device.');
    if (!reviewed) throw new Error('Review the message and audience before publishing.');
    const issues = validateDraft(draft, files); if (issues.length) throw new Error(issues.join(' '));
    if (!/^hub-[a-zA-Z0-9-]{8,100}$/.test(draft.id || '')) throw new Error('Start a new draft before publishing.');
    const payload = { title:cleanText(draft.title,180), subHeadline:cleanText(draft.subHeadline,300), message:cleanText(draft.message),
        footerMessage:cleanText(draft.footerMessage,300), targetType:draft.targetType,
        targetBranch:draft.targetType === 'Branch' ? cleanText(draft.targetBranch,180) : null,
        targetStaff:draft.targetType === 'Individual' ? cleanText(draft.targetStaff,180) : null,
        isPrivateMessage:draft.targetType === 'Individual', active:true, publisher:cleanText(user.cashierName,180) || 'Manager',
        publisherUid:uid, source:draft.source === 'guided-template' ? 'guided-template' : 'manager-editor' };
    const existing = await adapter.read(draft.id);
    if (existing) {
        if (!publicationMatches(existing, payload)) throw new Error('This draft has already been published. Start a new draft for another announcement.');
        return { id:draft.id, existing:true };
    }
    const images = [];
    for (let i = 0; i < files.length; i++) images.push(await adapter.upload(draft.id, i, files[i]));
    return adapter.commit(draft.id, {...payload, images});
}
