const text = value => String(value ?? '').trim();
const actorIdentity = actor => {
    const uid = text(actor?.uid), email = text(actor?.email).toLowerCase(), name = text(actor?.name || actor?.cashierName || actor?.displayName || email);
    if (!uid || uid.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 200) throw new Error('Sign in with your authorized Google account before recording a correction.');
    return {uid, email, name};
};
const instant = value => value?.toDate?.() || (value?.seconds !== undefined ? new Date(value.seconds * 1000) : new Date(value));
function philippineDateTime(value) {
    const raw = text(value), match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) throw new Error('Enter the attendance date and time in Philippine local time.');
    const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part || 0));
    const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 2000 || year > 2199 || wall.getUTCFullYear() !== year || wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) throw new Error('Enter a valid attendance date and time.');
    return new Date(wall.getTime() - 8 * 60 * 60 * 1000);
}
function checkedFields(input) {
    const staffName = text(input.staffName), branch = text(input.branch), type = text(input.type).toUpperCase(), remarks = text(input.remarks);
    if (!staffName || staffName.length > 200 || ['unknown','select staff','-- select staff --'].includes(staffName.toLowerCase())) throw new Error('Choose a valid staff member.');
    if (!branch || branch.length > 200 || ['all','unknown','select branch','-- select branch --'].includes(branch.toLowerCase())) throw new Error('Choose a valid branch.');
    if (!['TIME IN','TIME OUT'].includes(type)) throw new Error('Choose TIME IN or TIME OUT for the manual correction.');
    if (!remarks || remarks.length > 2000) throw new Error('Describe why this manual correction is needed.');
    const fields = {staffName, branch, type, remarks};
    if (input.staffId != null) {
        const staffId = text(input.staffId);
        if (!staffId || staffId.length > 200 || staffId.includes('/')) throw new Error('The selected staff profile is invalid.');
        fields.staffId = staffId;
    }
    if (input.scheduleSnapshot != null) {
        if (!input.scheduleSnapshot || typeof input.scheduleSnapshot !== 'object' || Array.isArray(input.scheduleSnapshot)) throw new Error('The attendance schedule snapshot is invalid.');
        if (input.scheduleSnapshot.branch && input.scheduleSnapshot.branch !== branch || input.scheduleSnapshot.staffName && text(input.scheduleSnapshot.staffName).toLowerCase() !== staffName.toLowerCase()) throw new Error('The saved schedule belongs to another staff member or branch.');
        fields.scheduleSnapshot = JSON.parse(JSON.stringify(input.scheduleSnapshot));
    }
    return fields;
}
export function validateManualAttendance(input, {actor, allowed, branchAllowed, now = new Date()} = {}) {
    const identity = actorIdentity(actor), fields = checkedFields(input || {});
    if ((typeof allowed === 'function' ? allowed() : allowed) !== true || (typeof branchAllowed === 'function' ? branchAllowed(fields.branch) : branchAllowed) !== true) throw new Error('Your account does not have attendance-correction access for this branch.');
    const timestamp = philippineDateTime(input.dateTimeRaw ?? input.dateTime), current = instant(typeof now === 'function' ? now() : now);
    if (!Number.isFinite(+current) || timestamp > current) throw new Error('Attendance corrections cannot use a future date or time.');
    return {...fields, timestamp, isManual:true, source:'manager-correction', manualAttendanceVersion:1,
        actorUid:identity.uid, actorEmail:identity.email, actorName:identity.name, loggedBy:identity.email};
}
function canonical(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
    return value;
}
export async function saveManualAttendance(api, payload, {operationId, actor, authorize = () => {}, now = new Date()} = {}) {
    const identity = actorIdentity(actor), fields = checkedFields(payload || {}), timestamp = instant(payload?.timestamp), current = instant(typeof now === 'function' ? now() : now);
    if (payload?.isManual !== true || payload?.source !== 'manager-correction' || payload?.manualAttendanceVersion !== 1
        || text(payload.actorUid) !== identity.uid || text(payload.actorEmail).toLowerCase() !== identity.email || !Number.isFinite(+timestamp) || !Number.isFinite(+current) || timestamp > current) throw new Error('The correction or its authorized reviewer is invalid. Reopen the attendance form.');
    const id = text(operationId).startsWith('manual_') ? text(operationId) : 'manual_' + text(operationId);
    if (!/^manual_[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('A stable manual-correction reference is required.');
    const data = {...fields,timestamp,isManual:true,source:'manager-correction',manualAttendanceVersion:1,
        actorUid:identity.uid,actorEmail:identity.email,actorName:text(payload.actorName) || identity.name,loggedBy:identity.email,operationId:id};
    const fingerprint = JSON.stringify(canonical(data));
    const guard = () => {
        if (api.auth) {
            const currentActor = api.auth.currentUser;
            if (!currentActor || text(currentActor.uid) !== identity.uid || text(currentActor.email).toLowerCase() !== identity.email) throw new Error('The signed-in account changed. Reopen the attendance correction.');
        }
        if (authorize(fields.branch) === false) throw new Error('Your attendance-correction permission changed. Reopen the attendance form.');
    };
    guard();
    return api.runTransaction(api.db,async tx => {
        const reference = api.doc(api.db,'attendance_logs',id), existing = await tx.get(reference);
        guard();
        if (existing.exists()) {
            const saved = existing.data(), storedPayload = Object.fromEntries(Object.keys(data).map(key => [key,saved[key]]));
            storedPayload.timestamp = instant(saved.timestamp);
            if (saved.manualFingerprint !== fingerprint || JSON.stringify(canonical(storedPayload)) !== fingerprint) throw new Error('This correction reference is already used by different attendance details. Do not overwrite the saved record.');
            return {id,status:'already-recorded'};
        }
        tx.set(reference,{...data,manualFingerprint:fingerprint,recordedAt:api.serverTimestamp()});
        return {id,status:'created'};
    });
}
