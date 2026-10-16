import { bounded } from './unlock-gate.js';
import { branchesOf, fullHQScope, canUseHQBranch, conversationAudience, conversationVisible } from './franchise-hq-model.js';

const trim = value => String(value ?? '').trim();
const identity = session => JSON.stringify([session?.uid, session?.email, session?.branch, session?.allowedBranches, session?.assignedBranch, session?.permissions, session?.isOwner, session?.isFranchisee]);
function capture(api, getSession, assertAccess, operation, branch, hq) {
    const session = getSession(), key = identity(session), uid = api.auth?.currentUser?.uid;
    const authenticated = () => !!uid && uid === api.auth?.currentUser?.uid && getSession()?.uid === uid && trim(api.auth?.currentUser?.email).toLowerCase() === trim(getSession()?.email).toLowerCase();
    if (!authenticated()) throw Error('Your signed-in account changed. Sign in again before continuing.');
    if (!session?.email || assertAccess?.(session, operation, branch) !== true) throw Error('This action is outside your approved HQ access.');
    if (branch && !canUseHQBranch(session, branch, { hq })) throw Error('Choose a branch within your assigned access.');
    if (!hq && (!branch || session.branch !== branch)) throw Error('Choose your assigned franchise branch.');
    const check = () => {
        if (identity(getSession()) !== key || !authenticated() || assertAccess?.(getSession(), operation, branch) !== true)
            throw Error('Your account or branch changed. Reload this page before continuing.');
    };
    return { session, check };
}
function required(value, label, max) {
    const result = trim(value);
    if (!result || result.length > max) throw Error(`${label} is required and must be ${max} characters or fewer.`);
    return result;
}
function recordId(value) {
    const id = trim(value);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw Error('The request reference is invalid. Reopen the form and try again.');
    return id;
}
function threadId(value) {
    const id = trim(value);
    if (!id || id.length > 1500 || id.includes('/') || ['.', '..'].includes(id)) throw Error('The conversation reference is invalid.');
    return id;
}
function author(session, api, hq) {
    return { author: trim(session.cashierName || session.fullName || session.name || session.email),
        authorUid: trim(session.uid || api.auth?.currentUser?.uid), authorEmail: trim(session.email).toLowerCase(),
        authorBranch: hq ? 'HQ Main Office' : session.branch };
}
export function createFranchiseConversations(api, { getSession = () => api.sessionUser, assertAccess, hq = false }) {
    const pending = new Map();
    function readServer(key, makeRequest, check) {
        check(); key = identity(getSession()) + ':' + api.auth?.currentUser?.uid + ':' + key;
        if (!pending.has(key)) {
            const physical = Promise.resolve().then(() => { check(); return makeRequest(); });
            pending.set(key, physical);
            const settled = () => { if (pending.get(key) === physical) pending.delete(key); };
            physical.then(settled, settled);
        }
        // A screen deadline must not start another physical request while this one is pending.
        return bounded(pending.get(key), 20000);
    }
    async function list(branch = '') {
        const context = capture(api, getSession, assertAccess, 'read', branch, hq), { session, check } = context;
        const targets = branch ? [branch] : branchesOf(session).filter(value => value.toLowerCase() !== 'all');
        let snaps;
        if (hq && !branch && fullHQScope(session)) snaps = [await readServer('all', () => api.getDocsFromServer(api.collection(api.db, 'franchise_comms')), check)];
        else snaps = await Promise.all([...new Set([...targets, 'All', 'HQ Main Office', 'Main Office'])].map(target => readServer('branch:' + target, () => api.getDocsFromServer(api.query(api.collection(api.db, 'franchise_comms'), api.where('branch', '==', target))), check)));
        check();
        const rows = new Map();
        for (const snap of snaps) for (const doc of snap.docs) {
            const row = { ...doc.data(), id: doc.id };
            if (conversationVisible(session, row, { hq, branch })) rows.set(row.id, row);
        }
        return [...rows.values()];
    }
    async function get(id, branch = '') {
        const { session, check } = capture(api, getSession, assertAccess, 'read', branch, hq);
        const snap = await readServer('thread:' + threadId(id), () => api.getDocFromServer(api.doc(api.db, 'franchise_comms', threadId(id))), check); check();
        if (!snap.exists() || !conversationVisible(session, snap.data(), { hq, branch })) throw Error('This conversation is unavailable for this branch.');
        return { ...snap.data(), id: snap.id };
    }
    async function create({ id, branch = '', type = 'Discussion', title, message, audience = 'branch' }) {
        const { session, check } = capture(api, getSession, assertAccess, 'create', branch, hq);
        id = recordId(id); title = required(title, 'Subject', 160); message = required(message, 'Message', 4000);
        if (!['Discussion', 'Help', ...(hq ? ['Announcement'] : [])].includes(type)) throw Error('Choose a valid conversation type.');
        if (!['branch', 'network'].includes(audience) || audience === 'network' && (!hq || session.isFranchisee || !fullHQScope(session)) || audience === 'branch' && !canUseHQBranch(session, branch, { hq })) throw Error('Choose an approved conversation recipient.');
        const ref = api.doc(api.db, 'franchise_comms', id), actor = author(session, api, hq), target = audience === 'branch' ? branch : '';
        await api.runTransaction(api.db, async tx => {
            const existing = await tx.get(ref); check();
            if (existing.exists()) {
                const row = existing.data();
                if (row.authorEmail !== actor.authorEmail || row.title !== title || row.message !== message || row.type !== type || row.audience !== audience || row.targetBranch !== target) throw Error('This conversation reference was already used.');
                return;
            }
            tx.set(ref, { schemaVersion: 1, audience, targetBranch: target, branch: target || 'All', type, title, message,
                ...actor, replies: [], timestamp: api.serverTimestamp(), lastActivity: api.serverTimestamp() });
        });
        check(); return { id };
    }
    async function reply({ id, branch = '', message, replyId }) {
        const { session, check } = capture(api, getSession, assertAccess, 'reply', branch, hq);
        id = threadId(id); replyId = recordId(replyId); message = required(message, 'Reply', 2000);
        const ref = api.doc(api.db, 'franchise_comms', id), actor = author(session, api, hq), timestamp = new Date().toISOString();
        await api.runTransaction(api.db, async tx => {
            const snap = await tx.get(ref); check();
            if (!snap.exists() || !conversationVisible(session, snap.data(), { hq, branch })) throw Error('This conversation is unavailable for this branch.');
            const row = snap.data(), audience = conversationAudience(row);
            if (audience.legacy || audience.kind === 'unknown') throw Error('This older conversation has no confirmed recipient. Start a new conversation with a selected recipient.');
            if (row.replies != null && !Array.isArray(row.replies)) throw Error('This conversation needs an HQ record review before replying.');
            const replies = row.replies || [], existing = replies.find(reply => reply.id === replyId);
            if (existing) {
                if (existing.message !== message || existing.authorEmail !== actor.authorEmail) throw Error('This reply reference was already used.');
                return;
            }
            if (replies.length >= 200) throw Error('This conversation is full. Start a new conversation to continue.');
            tx.update(ref, { replies: [...replies, { id: replyId, ...actor, branch: actor.authorBranch, message, timestamp }], lastActivity: api.serverTimestamp() });
        });
        check(); return { id, replyId };
    }
    return { list, get, create, reply };
}
export async function createFranchiseLedgerEntry(api, { id, branch, type, amount, description, getSession = () => api.sessionUser, assertAccess }) {
    const { session, check } = capture(api, getSession, assertAccess, 'ledger', branch, true);
    if (session.isFranchisee) throw Error('Only HQ can record charges and confirmed payments.');
    if (!['number', 'string'].includes(typeof amount)) throw Error('Enter a valid positive amount.');
    id = recordId(id); amount = Number(amount); description = required(description, 'Payment reference or reason', 500);
    if (!['Charge', 'Payment'].includes(type) || !Number.isFinite(amount) || Math.round(amount * 100) <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 || !Number.isSafeInteger(Math.round(amount * 100))) throw Error('Enter a valid positive amount with no more than two decimal places.');
    amount = Math.round(amount * 100) / 100;
    const ref = api.doc(api.db, 'franchise_ledger', id), email = trim(session.email).toLowerCase();
    await api.runTransaction(api.db, async tx => {
        const snap = await tx.get(ref); check();
        if (snap.exists()) {
            const row = snap.data();
            if (row.branch !== branch || row.type !== type || row.amount !== amount || row.description !== description || row.authorEmail !== email) throw Error('This payment reference was already used.');
            return;
        }
        tx.set(ref, { branch, type, amount, description, category: type === 'Payment' ? 'Account Settlement' : 'Manual Adjustment', loggedBy: session.cashierName || email, authorEmail: email, authorUid: session.uid || api.auth?.currentUser?.uid || '', timestamp: api.serverTimestamp() });
    });
    check(); return { id };
}
