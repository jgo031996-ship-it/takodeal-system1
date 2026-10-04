export const OWNER_EMAIL = 'jgo031996@gmail.com';
const text = value => typeof value === 'string' ? value.trim() : '';
export const normalizeEmail = value => text(value).toLowerCase();
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const validEmail = value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeEmail(value));
// Match the existing Firestore owner rule, rather than the broader UI isOwner flag.
export const canManageAccess = user => normalizeEmail(user?.email) === OWNER_EMAIL;

export function accountRecord(id, data = {}) {
    const email = normalizeEmail(data.email), owner = email === OWNER_EMAIL;
    return { id:String(id), email, name:text(data.fullName || data.name), phone:text(data.phone), owner,
        role:owner ? 'Owner' : data.role === 'Franchisee' ? 'Franchise owner' : 'Manager',
        branch:text(data.assignedBranch), pinConfigured:Boolean(data.pin),
        // Missing permissions do not imply all-access. Never keep credentials in the view model.
        permissions:Array.isArray(data.permissions) ? data.permissions.filter(p => typeof p === 'string').map(p => p.trim()).filter(Boolean) : [] };
}

export function groupAccounts(records) {
    const groups = new Map();
    for (const record of records) {
        // Malformed email records remain individually reviewable.
        const key = record.email || `record:${record.id}`;
        if (!groups.has(key)) groups.set(key, {key,email:record.email,records:[]});
        groups.get(key).records.push(record);
    }
    return [...groups.values()].map(group => ({...group,
        name:group.records.find(record => record.name)?.name || 'Profile not completed',
        owner:group.records.every(record => record.owner), duplicate:group.records.length > 1,
        role:new Set(group.records.map(record => record.role)).size === 1 ? group.records[0].role : 'Mixed roles',
        pinConfigured:group.records.every(record => record.pinConfigured)}))
        .sort((a,b) => Number(b.owner)-Number(a.owner) || a.email.localeCompare(b.email) || a.key.localeCompare(b.key));
}

export function filterAccounts(groups, search = '', filter = 'all') {
    const needle = text(search).toLowerCase();
    return groups.filter(group => (!needle || [group.email,group.name,...group.records.flatMap(record => [record.name,record.phone,record.branch,record.id])].join(' ').toLowerCase().includes(needle))
        && (filter === 'all' || filter === 'duplicates' && group.duplicate || filter === 'pin' && !group.pinConfigured
            || group.records.some(record => record.role.toLowerCase() === filter)));
}

export function accountAction(records, id, action, user) {
    const record = records.find(row => row.id === id);
    if (!record || !canManageAccess(user)) throw Error('Only the system owner can change access records.');
    if (!['profile','permissions','revoke'].includes(action)) throw Error('Unknown account action.');
    if (record.owner && action !== 'profile') throw Error('The system owner account is protected.');
    if (action === 'revoke' && records.filter(row => row.email && row.email === record.email).length > 1)
        throw Error('This email has multiple records. Review them before removing access.');
    return record;
}

export function checkNewAccount(email, records, user) {
    if (!canManageAccess(user)) throw Error('Only the system owner can grant access.');
    const normalized = normalizeEmail(email);
    if (!validEmail(normalized)) throw Error('Enter a complete Google email address.');
    if (records.some(record => record.email === normalized)) throw Error('This email already has access. Use its profile or permissions controls below.');
    return normalized;
}

export function permissionLabels(record, pages = {}) {
    if (record.permissions.includes('all')) return ['All Manager tabs'];
    return [...new Set(record.permissions)].map(key => pages[key]?.[1] || key);
}

const CORE_BRANCHES = new Set(['main office','cabantian','citygate','maa']);
export function branchRecord(id, data = {}, latestVersion = 0) {
    const name = text(data.name) || 'Unnamed branch';
    const approved = Number(data.approvedVersion), latest = Number(latestVersion);
    const hasLocation = data.lat != null && data.lat !== '' && data.lng != null && data.lng !== ''
        && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))
        && Math.abs(Number(data.lat)) <= 90 && Math.abs(Number(data.lng)) <= 180;
    return {id:String(id),name,protected:data.isCore === true || CORE_BRANCHES.has(name.toLowerCase()),
        createdAt:data.createdAt,hasLocation,address:text(data.address),
        approval:!Number.isFinite(latest) || latest <= 0 ? 'untracked' : Number.isFinite(approved) && approved >= latest ? 'approved' : 'pending',
        targetVersion:Number.isFinite(latest) && latest > 0 ? latest : 0};
}
export function filterBranches(rows, search = '', filter = 'all') {
    const needle = text(search).toLowerCase();
    return rows.filter(row => (!needle || `${row.name} ${row.address} ${row.id}`.toLowerCase().includes(needle))
        && (filter === 'all' || filter === 'pending' && row.approval === 'pending' || filter === 'protected' && row.protected));
}

export function branchAction(rows, id, action, user) {
    const row = rows.find(branch => branch.id === id);
    if (!row || !canManageAccess(user)) throw Error('Only the system owner can change branch settings.');
    if (!['settings','approve','delete'].includes(action)) throw Error('Unknown branch action.');
    if (action === 'delete' && row.protected) throw Error('Core branches are protected.');
    if (action === 'approve' && row.approval !== 'pending') throw Error('This branch does not need update approval.');
    return row;
}

export function dateLabel(value) {
    try {
        const date = value?.toDate?.() || (Number.isFinite(value?.seconds) ? new Date(value.seconds * 1000) : value ? new Date(value) : null);
        return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : 'Date not recorded';
    } catch { return 'Date not recorded'; }
}

export function branchName(value) {
    const name = text(value);
    if (!name || name.length > 100 || /[\/\\\x00-\x1f]/.test(name)) throw Error('Enter a branch name of up to 100 characters, without slashes.');
    return name;
}
export async function registerBranchRecord({name, user, read, write, timestamp}) {
    if (!canManageAccess(user)) throw Error('Only the system owner can register branches.');
    name = branchName(name);
    const existing = await read();
    if (existing && existing.name !== name) throw Error('This registration no longer matches. Refresh the directory.');
    if (existing) return {existing:true,name};
    // The caller retains the same reference across retries. Never invent GPS coordinates.
    await write({name,isCore:false,createdAt:timestamp()});
    return {existing:false,name};
}
