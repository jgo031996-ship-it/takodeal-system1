// A separate screen privacy lock. Firebase authorization remains the responsibility
// of database rules; this PIN is never used as a Firebase authentication token.
export const PIN_ITERATIONS = 300000;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) || [], x => parseInt(x, 16));
export function validVaultPin(pin) { return /^\d{6,8}$/.test(pin); }
export async function createPinVerifier(pin, cryptoAPI = globalThis.crypto) {
    if (!validVaultPin(pin)) throw new Error('Use a PIN with 6 to 8 digits.');
    const salt = hex(cryptoAPI.getRandomValues(new Uint8Array(16)));
    const hash = await derive(pin, salt, PIN_ITERATIONS, cryptoAPI);
    return { version: 1, salt, hash, iterations: PIN_ITERATIONS };
}
async function derive(pin, salt, iterations, cryptoAPI) {
    const key = await cryptoAPI.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoAPI.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations, hash: 'SHA-256' }, key, 256);
    return hex(new Uint8Array(bits));
}
export function validVerifier(value) {
    return value?.version === 1 && /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{64}$/.test(value.hash)
        && value.iterations === PIN_ITERATIONS;
}
export async function verifyPin(pin, verifier, cryptoAPI = globalThis.crypto) {
    if (!validVaultPin(pin) || !validVerifier(verifier)) return false;
    const hash = await derive(pin, verifier.salt, verifier.iterations, cryptoAPI);
    let mismatch = 0;
    for (let i = 0; i < hash.length; i++) mismatch |= hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
    return mismatch === 0;
}
export class VaultSession {
    constructor(now = () => Date.now(), timeout = 120000) { this.now = now; this.timeout = timeout; this.epoch = 0; this.lock(); }
    lock() { this.staffId = null; this.expires = 0; this.epoch++; }
    unlock(staffId) { this.lock(); this.staffId = staffId; this.expires = this.now() + this.timeout; return this.epoch; }
    allows(staffId, epoch = this.epoch) {
        return Boolean(staffId && this.staffId === staffId && epoch === this.epoch && this.now() < this.expires);
    }
    touch(staffId) { if (this.allows(staffId)) this.expires = this.now() + this.timeout; }
}
export function belongsToStaff(record, id, name) {
    if (record.staffId) return record.staffId === id;
    return String(record.staffName || '').trim().toLocaleLowerCase() === String(name || '').trim().toLocaleLowerCase();
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function timestampDate(value) {
    if (!value) return null;
    const date = value.toDate ? value.toDate() : value.seconds != null ? new Date(value.seconds * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
// Pair by chronological punch rather than calendar date, including overnight work.
export function attendanceHistory(records, id, name, now = new Date()) {
    const logs = records.filter(r => belongsToStaff(r, id, name)).map(r => ({ ...r, date: timestampDate(r.timestamp) }))
        .filter(r => r.date && /^TIME (IN|OUT)$/.test(String(r.type).toUpperCase())).sort((a,b) => a.date - b.date);
    const shifts = []; let active = null;
    for (const log of logs) {
        if (String(log.type).toUpperCase() === 'TIME IN') {
            if (active) shifts.push({ in: active, out: null, status: 'Missing time out' });
            active = log;
        } else if (active) {
            const hours = (log.date - active.date) / 3600000;
            if (hours <= 24) shifts.push({ in: active, out: log, hours, status: 'Complete' });
            else {
                shifts.push({ in: active, out: null, status: 'Missing time out' });
                shifts.push({ in: null, out: log, status: 'Missing time in' });
            }
            active = null;
        } else shifts.push({ in: null, out: log, status: 'Missing time in' });
    }
    if (active) shifts.push({ in: active, out: null, status: now - active.date > 24 * 3600000 ? 'Missing time out' : 'On duty' });
    return shifts.sort((a,b) => (b.in || b.out).date - (a.in || a.out).date);
}
