export const MASTER_EMAIL = 'jgo031996@gmail.com';
export const savedPin = data => String(data?.pin === '' || data?.pin == null ? data?.securityPin ?? '' : data.pin);
const stamp = value => Number(value?.toMillis?.() ?? (value?.seconds != null ? value.seconds * 1000 : Date.parse(value || ''))) || 0;
export function resolveHQAccount(records) {
    if (!records.length) throw Error('This Google account is not approved for the Owner workspace.');
    const sorted = [...records].sort((a,b) => stamp(b.data.profileUpdatedAt) - stamp(a.data.profileUpdatedAt) || String(a.id).localeCompare(String(b.id)));
    const pins = [...records].sort((a,b) => stamp(b.data.pinUpdatedAt) - stamp(a.data.pinUpdatedAt));
    const newest = stamp(pins[0].data.pinUpdatedAt);
    const current = newest ? pins.filter(row => stamp(row.data.pinUpdatedAt) === newest) : pins;
    if (new Set(current.map(row => savedPin(row.data))).size !== 1)
        throw Error('This email has conflicting PIN records. Ask the main owner to save its PIN again in HQ Access Control.');
    // Access uses the most recent explicit permission save, independently of PIN/profile edits.
    const access = [...records].sort((a,b)=>stamp(b.data.permissionsUpdatedAt)-stamp(a.data.permissionsUpdatedAt) || String(a.id).localeCompare(String(b.id)));
    const permissions = stamp(access[0].data.permissionsUpdatedAt) ? access[0].data.permissions : sorted[0].data.permissions;
    return {...sorted[0].data, permissions, docId:sorted[0].id, pin:savedPin(current[0].data)};
}
export function mealRole(data, source) {
    if (source === 'hq_managers' && String(data.email || '').trim().toLowerCase() === MASTER_EMAIL) return 'owner';
    const role = String(data.role || '').trim().toLowerCase();
    const roles = {'manager':'manager','co-owner':'co_owner','co owner':'co_owner','co_owner':'co_owner','owner':'owner','franchisee':'franchise_owner','franchise owner':'franchise_owner','staff':'staff','staff crew':'staff','cashier':'staff','crew':'staff'};
    return roles[role] || (source === 'cashiers' ? 'staff' : '');
}
