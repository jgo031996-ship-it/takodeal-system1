import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveStaffProfileAtomic, dateLegacyStaffIncrease} from '../takodeal-manager/staff-rate-changes.js';
import {staffRateDate, staffRateForDate, staffProfileForWork} from '../takodeal-manager/staff-rate-model.js';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService} from '../takodeal-manager/early-time-out-review.js';
import {createScheduleRevision} from '../takodeal-manager/schedule-history.js';
import {attendanceEstimate} from '../takodeal-franchise/franchise-data.js';
import {finalizeOrdinaryPayroll} from '../takodeal-manager/payroll-settlement.js';

// These tests use real local Firebase Rules runtimes. They must not be silently
// skipped when the runtime is missing, and cannot connect to production.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8787' || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9797') throw Error('Run the isolated Staff document emulator launcher.');
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = resolve(process.env.STAFF_DOCUMENT_TEST_TOOLS || resolve(root, '../staff-nextlevel-tools'));
const requireTools = createRequire(resolve(tools, 'package.json'));
const {initializeTestEnvironment, assertSucceeds, assertFails} = requireTools('@firebase/rules-unit-testing');
const {doc, collection, query, where, getDoc, getDocs, getDocFromServer, getDocsFromServer, runTransaction, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp} = requireTools('firebase/firestore');
const {ref, uploadBytes, getBytes, getMetadata, getDownloadURL, deleteObject, updateMetadata, listAll} = requireTools('firebase/storage');
const projectId = 'demo-staff-document-vault';
const brokerEndpoint = 'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
const vaultConfig = (enabled = true) => ({enabled, policyVersion: 2, brokerEndpoint});
const uid = 'approved-device', staffId = 'employee-1', branch = 'Maa';
const bytes = Uint8Array.from([255, 216, 255, 224, 1]);
const sha = 'a'.repeat(64);
const currentPath = (kind = 'valid_id') => `staff_private_documents/${staffId}/files/${kind}`;
const versionPath = operation => `staff_private_documents/${staffId}/versions/${operation}`;
const objectPath = (operation = 'seed-upload', device = uid, employee = staffId, kind = 'valid_id') => `staff_private_documents/${device}/${employee}/${kind}/${operation}.jpg`;
const anonymous = device => env.authenticatedContext(device, {firebase: {sign_in_provider: 'anonymous'}});
const google = (id, email, verified = true) => env.authenticatedContext(id, {email, email_verified: verified, firebase: {sign_in_provider: 'google.com'}});
const owner = () => google('owner-uid', 'jgo031996@gmail.com');
const hqAll = () => google('hq-all', 'hq-all@example.test');
const hqBranch = () => google('hq-maa', 'hq-maa@example.test');
const otherHQ = () => google('hq-city', 'hq-city@example.test');
let env, sequence = 0;
const nextOp = () => `test-${++sequence}`;
function fileData(operation, extra = {}, timestamps = true) {
    return {staffId, branch, group: 'valid_id', uploadId: operation, uploadedByUid: uid,
        storagePath: objectPath(operation), contentType: 'image/jpeg', size: bytes.length, sha256: sha,
        clearanceType: '', expiresOn: '', status: 'pending_review', reviewNote: '', version: 1,
        uploadedAt: timestamps ? serverTimestamp() : Timestamp.fromMillis(1000),
        updatedAt: timestamps ? serverTimestamp() : Timestamp.fromMillis(1000), ...extra};
}
function storageMetadata(operation, extra = {}) {
    return {contentType: 'image/jpeg', customMetadata: {staffId, documentGroup: 'valid_id', uploadId: operation, sha256: sha}, ...extra};
}
function bindingData(device = uid, employee = staffId, active = true) {
    const stamp = Timestamp.fromMillis(1000);
    return {uid: device, staffId: employee, branch, active, approvedAt: stamp, approvedByUid: 'owner-uid',
        updatedAt: stamp, updatedByUid: 'owner-uid', audit: {'seed-approval': {active, actorUid: 'owner-uid', recordedAt: stamp}}};
}
async function adminSet(path, data) {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));
}
async function atomicUpload(ctx, operation, extra = {}) {
    const data = fileData(operation, extra), db = ctx.firestore(), batch = writeBatch(db);
    batch.set(doc(db, currentPath(data.group)), data);
    batch.set(doc(db, versionPath(operation)), data);
    return batch.commit();
}
async function atomicReview(ctx, status = 'approved', extra = {}, includeAudit = true, includeVersion = true) {
    const db = ctx.firestore(), operation = nextOp(), previous = (await getDoc(doc(db, currentPath()))).data();
    const patch = {status, reviewId: operation, reviewNote: status === 'rejected' ? 'Please send a clearer photo.' : '',
        reviewedByUid: ctx.authenticatedUid || 'owner-uid', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), version: previous.version + 1, ...extra};
    const batch = writeBatch(db);
    batch.update(doc(db, currentPath()), patch);
    if (includeVersion) batch.update(doc(db, versionPath(previous.uploadId)), patch);
    if (includeAudit) batch.set(doc(db, `staff_private_documents/${staffId}/reviews/${operation}`), {
        staffId, branch: previous.branch, group: 'valid_id', uploadId: previous.uploadId, status,
        note: patch.reviewNote, actorUid: patch.reviewedByUid, recordVersion: patch.version, recordedAt: serverTimestamp()});
    return batch.commit();
}
before(async () => {
    env = await initializeTestEnvironment({projectId,
        firestore: {host: '127.0.0.1', port: 8787, rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8')},
        storage: {host: '127.0.0.1', port: 9797, rules: readFileSync(resolve(root, 'docs/staff-document-storage.rules.snippet'), 'utf8')}
    });
});
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore();
        await Promise.all([
            setDoc(doc(db, 'staff_document_config/current'), vaultConfig()),
            setDoc(doc(db, `staff_document_devices/${uid}`), bindingData()),
            setDoc(doc(db, 'staff_document_devices/other-employee'), bindingData('other-employee', 'employee-2')),
            setDoc(doc(db, 'staff_document_devices/revoked-device'), bindingData('revoked-device', staffId, false)),
            setDoc(doc(db, `staff_private_documents/${staffId}`), {staffId, branch, version: 1, updatedAt: Timestamp.fromMillis(1000), updatedByUid: 'owner-uid'}),
            setDoc(doc(db, currentPath()), fileData('seed-upload', {}, false)),
            setDoc(doc(db, versionPath('seed-upload')), fileData('seed-upload', {}, false)),
            setDoc(doc(db, 'hq_email_access/hq-all@example.test'), {active: true, permissions: ['all'], allowedBranches: ['All']}),
            setDoc(doc(db, 'hq_email_access/hq-maa@example.test'), {active: true, permissions: ['branches'], allowedBranches: [branch]}),
            setDoc(doc(db, 'hq_email_access/hq-city@example.test'), {active: true, permissions: ['all'], allowedBranches: ['Citygate']}),
            setDoc(doc(db, 'hq_email_access/no-permission@example.test'), {active: true, permissions: ['dashboard'], allowedBranches: ['All']}),
            setDoc(doc(db, 'hq_email_access/legacy-hq@example.test'), {active: true, allowedBranches: ['All']}),
            setDoc(doc(db, 'cashiers/public-profile'), {pin: '1234', cashierName: 'Employee', branch, role: 'Owner', permissions: ['all']})
        ]);
        await uploadBytes(ref(ctx.storage(), objectPath()), bytes, storageMetadata('seed-upload'));
    });
});
after(async () => {if (env) await env.cleanup();});

test('unapproved and unauthenticated clients cannot read metadata, history, scope or private photo bytes', async () => {
    for (const ctx of [env.unauthenticatedContext(), anonymous('new-device')]) {
        for (const path of [currentPath(), versionPath('seed-upload'), `staff_private_documents/${staffId}`]) await assertFails(getDoc(doc(ctx.firestore(), path)));
        await assertFails(getBytes(ref(ctx.storage(), objectPath())));
        await assertFails(getMetadata(ref(ctx.storage(), objectPath())));
    }
});
test('other-employee and revoked bindings cannot read this employee’s metadata or photo', async () => {
    for (const id of ['other-employee', 'revoked-device']) {
        const ctx = anonymous(id);
        await assertFails(getDoc(doc(ctx.firestore(), currentPath())));
        await assertFails(getBytes(ref(ctx.storage(), objectPath())));
    }
});
test('forged public PIN, owner role and branch fields cannot authorize the private vault', async () => {
    const ctx = anonymous('unapproved-forger');
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'cashiers/public-profile'), {pin: '9999', role: 'Owner', permissions: ['all'], staffId, branch}));
    await assertFails(getDoc(doc(ctx.firestore(), currentPath())));
    await assertFails(getBytes(ref(ctx.storage(), objectPath())));
    await assertFails(setDoc(doc(ctx.firestore(), 'staff_document_devices/unapproved-forger'), {uid: 'unapproved-forger', staffId, branch, active: true}));
});
test('approved Staff, verified Owner and scoped HQ read protected metadata but cannot directly read private bytes or mint links', async () => {
    for (const ctx of [anonymous(uid), owner(), hqAll(), hqBranch()]) {
        await assertSucceeds(getDoc(doc(ctx.firestore(), currentPath())));
        await assertFails(getBytes(ref(ctx.storage(), objectPath())));
        await assertFails(getMetadata(ref(ctx.storage(), objectPath())));
        await assertFails(getDownloadURL(ref(ctx.storage(), objectPath())));
    }
});
test('HQ with another branch, absent permissions or unrelated permissions cannot read private documents', async () => {
    for (const ctx of [otherHQ(), google('no-permission', 'no-permission@example.test'), google('legacy-hq', 'legacy-hq@example.test'), google('unapproved-google', 'unknown@example.test'), google('unverified-owner', 'jgo031996@gmail.com', false)]) {
        await assertFails(getDoc(doc(ctx.firestore(), currentPath())));
        await assertFails(getBytes(ref(ctx.storage(), objectPath())));
    }
});
test('approved Staff and scoped HQ can get missing file kinds using the protected employee scope', async () => {
    for (const ctx of [anonymous(uid), hqBranch(), owner()]) {
        const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), currentPath('health_card'))));
        assert.equal(snap.exists(), false);
    }
    await assertFails(getDoc(doc(otherHQ().firestore(), currentPath('health_card'))));
});
test('configuration exposes only the current broker policy; Staff cannot enable, list or expand it', async () => {
    const ctx = env.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'staff_document_config/current')));
    await assertFails(getDoc(doc(ctx.firestore(), 'staff_document_config/secret')));
    await assertFails(getDocs(collection(ctx.firestore(), 'staff_document_config')));
    await assertFails(setDoc(doc(anonymous(uid).firestore(), 'staff_document_config/current'), vaultConfig()));
    await assertFails(setDoc(doc(owner().firestore(), 'staff_document_config/current'), {...vaultConfig(), secret: 'private'}));
});
test('Owner can enable only the exact v2 broker endpoint and cannot retarget credentials or downgrade the policy', async () => {
    const target = doc(owner().firestore(), 'staff_document_config/current');
    await assertSucceeds(setDoc(target, vaultConfig(false)));
    await assertSucceeds(setDoc(target, vaultConfig()));
    for (const invalid of [
        {enabled: true, policyVersion: 1},
        {enabled: true, policyVersion: 2},
        {...vaultConfig(), policyVersion: 1},
        {...vaultConfig(), enabled: 'true'},
        {...vaultConfig(), brokerEndpoint: 'https://unexpected.example.test/staffDocumentBroker'},
        {...vaultConfig(), brokerEndpoint: brokerEndpoint + '?next=https://unexpected.example.test'},
        {...vaultConfig(), brokerEndpoint: brokerEndpoint + '/'},
        {...vaultConfig(), brokerEndpoint: brokerEndpoint.replace('https:', 'http:')}
    ]) await assertFails(setDoc(target, invalid));
});
test('stale or incomplete broker configuration cannot authorize new document metadata or approval requests', async () => {
    for (const config of [
        {enabled: true, policyVersion: 1},
        {enabled: true, policyVersion: 2},
        {...vaultConfig(), brokerEndpoint: 'https://unexpected.example.test/staffDocumentBroker'}
    ]) {
        await adminSet('staff_document_config/current', config);
        await assertFails(atomicUpload(anonymous(uid), nextOp(), {version: 2}));
        const requestUid = nextOp(), db = anonymous(requestUid).firestore();
        await assertFails(setDoc(doc(db, `staff_document_requests/${requestUid}`), {uid: requestUid, staffId, deviceId: 'phone', deviceName: 'Phone', status: 'pending', requestedAt: serverTimestamp()}));
    }
});
test('unapproved Staff may request approval only for its own UID and remains unable to access files', async () => {
    const ctx = anonymous('new-request'), db = ctx.firestore();
    const request = {uid: 'new-request', staffId, deviceId: 'tablet', deviceName: 'Staff phone', status: 'pending', requestedAt: serverTimestamp()};
    await assertSucceeds(setDoc(doc(db, 'staff_document_requests/new-request'), request));
    await assertFails(setDoc(doc(db, 'staff_document_requests/stolen-uid'), {...request, uid: 'stolen-uid'}));
    await assertFails(setDoc(doc(db, 'staff_document_requests/new-request'), {...request, staffId: 'other-staff'}));
    await assertFails(getDoc(doc(db, currentPath())));
    await assertFails(getDocs(query(collection(db, 'staff_document_requests'), where('staffId', '==', staffId))));
    await assertSucceeds(getDocs(query(collection(owner().firestore(), 'staff_document_requests'), where('staffId', '==', staffId))));
});
test('Owner approval atomically links pending request, protected scope and immutable UID binding', async () => {
    const requestedUid = 'new-approved', requestData = {uid: requestedUid, staffId, deviceId: 'phone', deviceName: 'Phone', status: 'pending', requestedAt: Timestamp.fromMillis(1000)};
    await adminSet(`staff_document_requests/${requestedUid}`, requestData);
    const db = owner().firestore(), stamp = serverTimestamp(), batch = writeBatch(db);
    batch.set(doc(db, `staff_document_devices/${requestedUid}`), {uid: requestedUid, staffId, branch, active: true, deviceId: 'phone', deviceName: 'Phone',
        approvedAt: stamp, approvedByUid: 'owner-uid', updatedAt: stamp, updatedByUid: 'owner-uid', audit: {'approval-1': {active: true, actorUid: 'owner-uid', recordedAt: stamp}}});
    batch.update(doc(db, `staff_document_requests/${requestedUid}`), {status: 'approved', reviewedAt: stamp, reviewedByUid: 'owner-uid', reviewNote: ''});
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(anonymous(requestedUid).firestore(), currentPath())));
    await assertFails(updateDoc(doc(db, `staff_document_devices/${requestedUid}`), {staffId: 'another-staff', updatedAt: serverTimestamp(), updatedByUid: 'owner-uid'}));
    await assertFails(updateDoc(doc(db, `staff_document_devices/${requestedUid}`), {branch: 'Citygate', updatedAt: serverTimestamp(), updatedByUid: 'owner-uid'}));
});
test('Staff and branch-scoped HQ cannot approve or enumerate document-device bindings', async () => {
    for (const ctx of [anonymous(uid), hqBranch()]) {
        await assertFails(getDocs(collection(ctx.firestore(), 'staff_document_devices')));
        await assertFails(setDoc(doc(ctx.firestore(), 'staff_document_devices/rogue'), {uid: 'rogue', staffId, branch, active: true}));
    }
});
test('Owner revocation appends an exact audit and immediately removes Staff access', async () => {
    const db = owner().firestore(), target = doc(db, `staff_document_devices/${uid}`), stamp = serverTimestamp();
    await assertFails(updateDoc(target, {active: false, updatedAt: stamp, updatedByUid: 'owner-uid'}));
    await assertFails(updateDoc(target, {active: false, updatedAt: stamp, updatedByUid: 'owner-uid',
        'audit.forged': {active: false, actorUid: 'someone-else', recordedAt: stamp}}));
    await assertSucceeds(updateDoc(target, {active: false, updatedAt: stamp, updatedByUid: 'owner-uid',
        'audit.revoke-1': {active: false, actorUid: 'owner-uid', recordedAt: stamp}}));
    await assertFails(getDoc(doc(anonymous(uid).firestore(), currentPath())));
    await assertFails(getBytes(ref(anonymous(uid).storage(), objectPath())));
    await assertSucceeds(getDoc(doc(owner().firestore(), currentPath())));
    await assertFails(getBytes(ref(owner().storage(), objectPath())));
});
test('even Owner cannot create a private binding without its matching pending approval request', async () => {
    const device = 'unlinked-device', stamp = serverTimestamp();
    const data = {...bindingData(device), approvedAt: stamp, updatedAt: stamp,
        audit: {'unlinked-approval': {active: true, actorUid: 'owner-uid', recordedAt: stamp}}};
    await assertFails(setDoc(doc(owner().firestore(), `staff_document_devices/${device}`), data));
});
test('atomic pending upload succeeds and a metadata-only or history-only upload fails', async () => {
    const ctx = anonymous(uid), op = nextOp(), data = fileData(op, {version: 2});
    await assertFails(setDoc(doc(ctx.firestore(), currentPath()), data));
    await assertFails(setDoc(doc(ctx.firestore(), versionPath(op)), data));
    await assertSucceeds(atomicUpload(ctx, op, {version: 2}));
    assert.deepEqual((await getDoc(doc(ctx.firestore(), currentPath()))).data(), (await getDoc(doc(ctx.firestore(), versionPath(op)))).data());
});
test('Staff cannot self-approve, forge paths/branches/timestamps, add URLs, or skip versions', async () => {
    const ctx = anonymous(uid);
    for (const patch of [{status: 'approved'}, {branch: 'Citygate'}, {uploadedByUid: 'other-employee'}, {storagePath: 'https://example.test/file.jpg?token=x'},
        {storagePath: objectPath('bad-path', 'someone-else')}, {version: 9}, {uploadedAt: Timestamp.fromMillis(1)}, {downloadURL: 'https://example.test'},
        {sha256: 'not-a-hash'}, {contentType: 'text/html'}, {size: 2097153}, {expiresOn: 'tomorrow'}]) {
        await assertFails(atomicUpload(ctx, nextOp(), {version: 2, ...patch}));
    }
    assert.equal((await getDoc(doc(ctx.firestore(), currentPath()))).data().version, 1);
});
test('clearance upload requires NBI or POLICE and matching immutable history', async () => {
    const ctx = anonymous(uid);
    for (const clearanceType of ['', 'OTHER']) {
        const op = nextOp();
        await assertFails(atomicUpload(ctx, op, {group: 'clearance', clearanceType, storagePath: objectPath(op, uid, staffId, 'clearance')}));
    }
    const op = nextOp();
    await assertSucceeds(atomicUpload(ctx, op, {group: 'clearance', clearanceType: 'POLICE', storagePath: objectPath(op, uid, staffId, 'clearance')}));
});
test('HQ review requires matching version-history and immutable review audit in the same commit', async () => {
    await assertFails(atomicReview(owner(), 'approved', {}, false));
    await assertFails(atomicReview(owner(), 'approved', {}, true, false));
    await assertSucceeds(atomicReview(owner()));
    const db = owner().firestore(), current = (await getDoc(doc(db, currentPath()))).data();
    assert.equal(current.status, 'approved'); assert.equal(current.version, 2);
    const audit = (await getDoc(doc(db, `staff_private_documents/${staffId}/reviews/${current.reviewId}`))).data();
    assert.equal(audit.recordVersion, 2); assert.equal(audit.actorUid, 'owner-uid');
    await assertFails(updateDoc(doc(db, `staff_private_documents/${staffId}/reviews/${current.reviewId}`), {note: 'altered'}));
    await assertFails(deleteDoc(doc(db, `staff_private_documents/${staffId}/reviews/${current.reviewId}`)));
});
test('reviewers cannot change original upload intent or review another branch', async () => {
    await assertFails(atomicReview(owner(), 'approved', {size: 1}));
    const branchCtx = hqBranch(); branchCtx.authenticatedUid = 'hq-maa';
    await assertSucceeds(atomicReview(branchCtx));
    await assertFails(atomicReview(otherHQ(), 'approved', {reviewedByUid: 'hq-city'}));
});
test('private metadata/history cannot be deleted or its original upload replaced by Staff', async () => {
    for (const ctx of [anonymous(uid), owner()]) {
        await assertFails(deleteDoc(doc(ctx.firestore(), currentPath())));
        await assertFails(deleteDoc(doc(ctx.firestore(), versionPath('seed-upload'))));
    }
    await assertFails(updateDoc(doc(anonymous(uid).firestore(), versionPath('seed-upload')), {size: 1}));
});
test('private Storage denies every direct SDK write even for approved Staff, Owner and branch-authorized HQ', async () => {
    for (const ctx of [anonymous(uid), owner(), hqAll(), hqBranch(), env.unauthenticatedContext()]) {
        const op = nextOp();
        await assertFails(uploadBytes(ref(ctx.storage(), objectPath(op)), bytes, storageMetadata(op)));
        await assertFails(uploadBytes(ref(ctx.storage(), objectPath()), bytes, storageMetadata('seed-upload')));
        await assertFails(updateMetadata(ref(ctx.storage(), objectPath()), {customMetadata: {staffId: 'someone-else'}}));
        await assertFails(deleteObject(ref(ctx.storage(), objectPath())));
    }
});
test('unapproved, revoked or wrong-employee UID cannot upload private bytes', async () => {
    for (const device of ['new-device', 'revoked-device', 'other-employee']) {
        const op = nextOp(); await assertFails(uploadBytes(ref(anonymous(device).storage(), objectPath(op, device)), bytes, storageMetadata(op)));
    }
});
test('private Storage deny-all also covers malformed MIME, size, filename and spoofed metadata', async () => {
    const ctx = anonymous(uid);
    const attempts = [
        {label: 'PNG MIME', metadata: {contentType: 'image/png'}},
        {label: 'size over2MiB', data: new Uint8Array(2097153)},
        {label: 'PNG filename', filename: 'not-jpeg.png'},
        {label: 'different staffId', custom: {staffId: 'employee-2'}},
        {label: 'different operation', custom: {uploadId: 'another-operation'}},
        {label: 'different group', custom: {documentGroup: 'health_card'}},
        {label: 'invalid SHA', custom: {sha256: 'bad'}},
        {label: 'extra ordinary key', custom: {unapprovedMetadata: 'unexpected'}}
    ];
    for (const attempt of attempts) {
        const op = nextOp(), metadata = storageMetadata(op, attempt.metadata || {});
        if (attempt.custom) Object.assign(metadata.customMetadata, attempt.custom);
        const path = attempt.filename ? objectPath(op).replace(`${op}.jpg`, attempt.filename) : objectPath(op);
        try {await assertFails(uploadBytes(ref(ctx.storage(), path), attempt.data || bytes, metadata));}
        catch (error) {
            const saved = await getMetadata(ref(ctx.storage(), path));
            throw new Error(`Unauthorized upload accepted: ${attempt.label}; customMetadata=${JSON.stringify(saved.customMetadata)}`, {cause: error});
        }
    }
});
test('client-supplied reserved token metadata cannot create a private object or obtain a link', async () => {
    const ctx = anonymous(uid), op = nextOp(), path = objectPath(op), metadata = storageMetadata(op);
    metadata.customMetadata.firebaseStorageDownloadTokens = 'public-token';
    await assertFails(uploadBytes(ref(ctx.storage(), path), bytes, metadata));
    await assertFails(getMetadata(ref(ctx.storage(), path)));
    await assertFails(getDownloadURL(ref(ctx.storage(), objectPath())));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
});
test('deny-all cannot revoke pre-existing bearer links; removing a legacy synthetic object closes its token route', async () => {
    // LOCAL emulator fixture only. Direct-Rules denial is not token revocation.
    // withSecurityRulesDisabled returns Promise<void>; capture the SDK result
    // inside its callback rather than treating the helper as a value wrapper.
    let url;
    await env.withSecurityRulesDisabled(async ctx => {url = await getDownloadURL(ref(ctx.storage(), objectPath()));});
    assert.equal(typeof url, 'string');
    const parsed = new URL(url);
    assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.port, '9797');
    const accessible = await fetch(url);
    assert.equal(accessible.status, 200);
    assert.deepEqual(new Uint8Array(await accessible.arrayBuffer()), bytes);
    await assertFails(getDownloadURL(ref(owner().storage(), objectPath())));
    await env.withSecurityRulesDisabled(ctx => deleteObject(ref(ctx.storage(), objectPath())));
    const refused = await fetch(url);
    assert.ok([401, 403, 404].includes(refused.status), `Old token route must be refused, received ${refused.status}`);
    assert.notEqual(refused.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), 'image/jpeg');
    const refusedBytes = new Uint8Array(await refused.arrayBuffer());
    assert.equal(refusedBytes[0] === 255 && refusedBytes[1] === 216, false, 'Closed token route must not return JPEG bytes');
});
test('entire private prefix remains denied for unknown paths, nested paths, lists and unbound employee IDs', async () => {
    for (const ctx of [anonymous(uid), owner(), hqAll(), env.unauthenticatedContext()]) {
        for (const path of ['staff_private_documents/anything.jpg', 'staff_private_documents/arbitrary/nested/path.jpg', objectPath(nextOp(), uid, 'employee-2')]) {
            await assertFails(uploadBytes(ref(ctx.storage(), path), bytes, {contentType: 'image/jpeg'}));
            await assertFails(getMetadata(ref(ctx.storage(), path)));
        }
        await assertFails(listAll(ref(ctx.storage(), 'staff_private_documents')));
        await assertFails(listAll(ref(ctx.storage(), `staff_private_documents/${uid}/${staffId}`)));
    }
});
test('disabling the policy prevents new requests, pending metadata and private-byte uploads', async () => {
    await adminSet('staff_document_config/current', vaultConfig(false));
    const ctx = anonymous(uid), op = nextOp();
    await assertFails(atomicUpload(ctx, op, {version: 2}));
    await assertFails(uploadBytes(ref(ctx.storage(), objectPath(op)), bytes, storageMetadata(op)));
    const newCtx = anonymous('new-disabled');
    await assertFails(setDoc(doc(newCtx.firestore(), 'staff_document_requests/new-disabled'), {uid: 'new-disabled', staffId, deviceId: 'phone', deviceName: 'Phone', status: 'pending', requestedAt: serverTimestamp()}));
});
test('legacy operational transactions and non-private image uploads keep their preceding policy', async () => {
    const ctx = env.unauthenticatedContext();
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'transactions/legacy-demo-sale'), {branch, totalAmount: 123, status: 'paid'}));
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'transactions/legacy-demo-sale')));
    await assertSucceeds(uploadBytes(ref(ctx.storage(), `staff_profiles/legacy-${nextOp()}.jpg`), bytes, {contentType: 'image/jpeg'}));
});

async function rateSetup() {
    await adminSet(`cashiers/${staffId}`, {cashierName:'Sample Staff',branch,role:'Crew',hourlyRate:450,pin:'1111'});
    await adminSet('hq_managers/rate-owner', {email:'jgo031996@gmail.com',role:'System Architect',permissions:['all'],assignedBranch:'All',pin:'1234'});
    await adminSet('hq_managers/rate-maa', {email:'rate-maa@example.test',role:'Manager',permissions:['payroll'],assignedBranch:branch,pin:'1234'});
    await adminSet('hq_email_access/rate-maa@example.test', {active:true,permissions:['payroll'],allowedBranches:[branch]});
    await adminSet('payroll_records/rate-frozen', {staffName:'Sample Staff',status:'Paid',frozenData:{dailyRate:450,netPay:4500}});
}
function rateApi(ctx, id='owner-uid', email='jgo031996@gmail.com') {
    return {db:ctx.firestore(),auth:{currentUser:{uid:id,email,emailVerified:true}},sessionUser:{uid:id,email,permissions:['all'],allowedBranches:['All'],cashierName:'Sample HQ'},
        doc,collection,query,where,getDocFromServer,getDocsFromServer,runTransaction,serverTimestamp};
}
const ratePayload=(rate=500,assigned=branch)=>({cashierName:'Sample Staff',branch:assigned,role:'Crew',hourlyRate:rate,pin:'1111'});
const rateSave=(api,operation,rate=500)=>saveStaffProfileAtomic(api,staffId,ratePayload(rate),{operationId:operation,expectedExists:true,expectedRate:450});

test('actual Owner rate transaction writes private audit and amount-free marker, preserving frozen payroll and retries', async () => {
    await rateSetup();const ctx=owner(),api=rateApi(ctx),op='owner-raise';
    const run=api.runTransaction;let lose=true;api.runTransaction=async(...args)=>{const result=await run(...args);if(lose){lose=false;throw Error('Sample lost response after committed raise');}return result;};
    await assert.rejects(rateSave(api,op),/lost response/);
    const retried=await assertSucceeds(rateSave(api,op));assert.equal(retried.alreadySaved,true);
    const profile=(await getDoc(doc(ctx.firestore(),`cashiers/${staffId}`))).data(),audit=(await getDoc(doc(ctx.firestore(),'staff_rate_changes/'+op))).data();
    assert.equal(profile.hourlyRate,500);assert.equal(Object.hasOwn(profile,'rateHistory'),false);assert.deepEqual(profile.latestRateRaise,{eventId:op,version:1});
    assert.equal(audit.fromDailyRate,450);assert.equal(audit.toDailyRate,500);assert.equal(audit.eventType,'increase');assert.equal(audit.actorUid,'owner-uid');
    assert.deepEqual((await getDoc(doc(ctx.firestore(),'payroll_records/rate-frozen'))).data().frozenData,{dailyRate:450,netPay:4500});
    assert.equal((await getDocs(query(collection(ctx.firestore(),'staff_rate_changes'),where('staffId','==',staffId),where('branch','==',branch)))).size,1);
});

test('actual verified branch-payroll HQ transaction succeeds independently of document-vault enablement', async () => {
    await rateSetup();await adminSet('staff_document_config/current',vaultConfig(false));
    const ctx=google('rate-maa','rate-maa@example.test'),api=rateApi(ctx,'rate-maa','rate-maa@example.test');
    const result=await assertSucceeds(rateSave(api,'hq-payroll-raise'));assert.equal(result.eventType,'increase');
    const events=await assertSucceeds(getDocs(query(collection(ctx.firestore(),'staff_rate_changes'),where('staffId','==',staffId),where('branch','==',branch))));assert.equal(events.size,1);
    await assertFails(getDoc(doc(otherHQ().firestore(),'staff_rate_changes/hq-payroll-raise')));
    await assertFails(getDocs(collection(ctx.firestore(),'staff_rate_changes')));
    await adminSet('hq_email_access/rate-maa@example.test',{active:false,permissions:['payroll'],allowedBranches:[branch]});
    await assertFails(getDoc(doc(ctx.firestore(),'staff_rate_changes/hq-payroll-raise')));
});

test('private rate audit reads and writes reject unauthenticated, anonymous, unverified, unpermitted and wrong-scope callers', async () => {
    await rateSetup();await rateSave(rateApi(owner()),'private-raise');
    for(const ctx of [env.unauthenticatedContext(),anonymous(uid),google('unverified-owner','jgo031996@gmail.com',false),google('no-permission','no-permission@example.test'),otherHQ()]){
        await assertFails(getDoc(doc(ctx.firestore(),'staff_rate_changes/private-raise')));
        await assertFails(getDocs(query(collection(ctx.firestore(),'staff_rate_changes'),where('staffId','==',staffId),where('branch','==',branch))));
        await assertFails(setDoc(doc(ctx.firestore(),'staff_rate_changes/forged-private'),{version:1,staffId,branch,eventType:'increase',fromDailyRate:450,toDailyRate:500}));
        await assertFails(updateDoc(doc(ctx.firestore(),`cashiers/${staffId}`),{latestRateRaise:{eventId:'fake',version:1},staffRateAuditId:'fake'}));
    }
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'staff_rate_changes/not-created')));
    await assertSucceeds(getDoc(doc(google('rate-maa','rate-maa@example.test').firestore(),'staff_rate_changes/not-created')));
});

test('rate audit is immutable; existing audit cannot be reused to spoof a marker, and public salary history is forbidden', async () => {
    await rateSetup();const ctx=owner();await rateSave(rateApi(ctx),'immutable-raise');
    await assertFails(updateDoc(doc(ctx.firestore(),'staff_rate_changes/immutable-raise'),{toDailyRate:1000}));
    await assertFails(deleteDoc(doc(ctx.firestore(),'staff_rate_changes/immutable-raise')));
    await assertFails(updateDoc(doc(ctx.firestore(),`cashiers/${staffId}`),{latestRateRaise:null}));
    await assertFails(updateDoc(doc(ctx.firestore(),`cashiers/${staffId}`),{staffRateAuditId:'old-reference'}));
    for(const actor of [ctx,env.unauthenticatedContext()])await assertFails(updateDoc(doc(actor.firestore(),`cashiers/${staffId}`),{rateHistory:[{fromDailyRate:450,toDailyRate:500}]}));
    const publicDb=env.unauthenticatedContext().firestore();await assertSucceeds(updateDoc(doc(publicDb,`cashiers/${staffId}`),{phone:'Sample new contact',hourlyRate:510}));
    const publicProfile=(await getDoc(doc(publicDb,`cashiers/${staffId}`))).data();assert.equal(publicProfile.phone,'Sample new contact');assert.equal(Object.hasOwn(publicProfile,'rateHistory'),false);
    await assertFails(setDoc(doc(ctx.firestore(),'cashiers/forged-new-profile'),{cashierName:'Fake',branch,hourlyRate:500,rateHistory:[]}));
});

test('numeric-string rate baseline is validated, while nonnumeric old rate and false-positive zero-baseline marker are refused', async () => {
    await rateSetup();await adminSet(`cashiers/${staffId}`,{cashierName:'Sample Staff',branch,role:'Crew',hourlyRate:' 450.50 ',pin:'1111'});
    const api=rateApi(owner());await assertSucceeds(saveStaffProfileAtomic(api,staffId,ratePayload(),{operationId:'numeric-string-rate',expectedRate:450.50,expectedExists:true}));
    assert.equal((await getDoc(doc(api.db,'staff_rate_changes/numeric-string-rate'))).data().fromDailyRate,450.50);
    await adminSet(`cashiers/${staffId}`,{cashierName:'Sample Staff',branch,role:'Crew',hourlyRate:'unknown',pin:'1111'});
    await assert.rejects(saveStaffProfileAtomic(api,staffId,ratePayload(),{operationId:'unknown-rate'}),/existing daily rate/);
    assert.equal((await getDoc(doc(api.db,'staff_rate_changes/unknown-rate'))).exists(),false);
    await adminSet(`cashiers/${staffId}`,{cashierName:'Sample Staff',branch,role:'Crew',hourlyRate:0,pin:'1111'});
    const batch=writeBatch(api.db),op='fake-baseline-raise';
    batch.update(doc(api.db,`cashiers/${staffId}`),{hourlyRate:500,staffRateAuditId:op,latestRateRaise:{eventId:op,version:1}});
    batch.set(doc(api.db,'staff_rate_changes/'+op),{version:1,staffId,staffName:'Sample Staff',branch,previousBranch:branch,eventType:'increase',fromDailyRate:0,toDailyRate:500,inputHash:sha,actorUid:'owner-uid',actorEmail:'jgo031996@gmail.com',actorName:'Sample Owner',recordedAt:serverTimestamp()});
    await assertFails(batch.commit());assert.equal((await getDoc(doc(api.db,`cashiers/${staffId}`))).data().hourlyRate,0);
});

test('actual decrease clears congratulations with its own audit and first profile save is a baseline', async () => {
    await rateSetup();const api=rateApi(owner());await rateSave(api,'first-increase');
    await assertSucceeds(saveStaffProfileAtomic(api,staffId,ratePayload(400),{operationId:'actual-decrease',expectedRate:500,expectedExists:true}));
    assert.equal((await getDoc(doc(api.db,`cashiers/${staffId}`))).data().latestRateRaise,null);
    assert.equal((await getDoc(doc(api.db,'staff_rate_changes/actual-decrease'))).data().eventType,'decrease');
    await assertSucceeds(saveStaffProfileAtomic(api,'new-rate-staff',ratePayload(450),{operationId:'new-baseline',expectedRate:null,expectedExists:false}));
    assert.equal((await getDoc(doc(api.db,'cashiers/new-rate-staff'))).data().latestRateRaise,null);
    assert.equal((await getDoc(doc(api.db,'staff_rate_changes/new-baseline'))).data().eventType,'baseline');
});

// These cases execute the dated salary writer and early Time Out service against
// the real local Rules runtime. Admin seeding is limited to synthetic fixtures.
const dateOffset = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const datedSave = (api, operation, rate, effectiveDate, extra = {}) => saveStaffProfileAtomic(api, staffId, ratePayload(rate), {
    operationId: operation, expectedExists: true, expectedRate: 450, effectiveDate, ...extra
});
async function salarySnapshot(ctx = owner()) {
    const db = ctx.firestore(), profile = (await getDoc(doc(db, `cashiers/${staffId}`))).data();
    return {...profile, salaryRateTimeline: (await getDoc(doc(db, `staff_salary_rates/${staffId}`))).data()};
}

test('dated future salary preserves the current public wage, earlier cutoff and frozen paid payroll', async () => {
    await rateSetup();
    const ctx = owner(), api = rateApi(ctx), today = staffRateDate(), future = dateOffset(today, 2);
    const saved = await assertSucceeds(datedSave(api, 'dated-future', 500, future));
    assert.equal(saved.scheduled, true);
    const profile = await salarySnapshot(ctx), audit = (await getDoc(doc(api.db, 'staff_rate_changes/dated-future'))).data();
    assert.equal(profile.hourlyRate, 450);
    assert.equal(profile.salaryRateTimeline.baselineDailyRate, 450);
    assert.equal(staffRateForDate(profile, dateOffset(today, -15)), 450);
    assert.equal(staffRateForDate(profile, today), 450);
    assert.equal(staffRateForDate(profile, future), 500);
    assert.equal(audit.version, 2); assert.equal(audit.effectiveDate, future); assert.equal(audit.rateChange, true);
    assert.equal(audit.projectionDailyRate, 450); assert.equal(audit.fromDailyRate, 450);
    const publicProfile = (await getDoc(doc(env.unauthenticatedContext().firestore(), `cashiers/${staffId}`))).data();
    for (const field of ['rates', 'baselineDailyRate', 'salaryRateTimeline', 'rateHistory']) assert.equal(Object.hasOwn(publicProfile, field), false);
    assert.deepEqual((await getDoc(doc(api.db, 'payroll_records/rate-frozen'))).data().frozenData, {dailyRate: 450, netPay: 4500});
});

test('same-date salary revisions are ordered and a stale private revision cannot overwrite a future change', async () => {
    await rateSetup();
    const ctx = owner(), api = rateApi(ctx), future = dateOffset(staffRateDate(), 2);
    await datedSave(api, 'dated-first', 500, future);
    await assertSucceeds(datedSave(api, 'dated-second', 600, future, {expectedRateRevision: 'dated-first'}));
    const profile = await salarySnapshot(ctx);
    assert.equal(staffRateForDate(profile, future), 600);
    assert.equal(profile.hourlyRate, 450); assert.equal(profile.salaryRateTimeline.revision, 2);
    assert.deepEqual(profile.salaryRateTimeline.rates['dated-second'], {effectiveDate: future, dailyRate: 600, sequence: 2});
    await assert.rejects(datedSave(api, 'dated-stale', 700, future, {expectedRateRevision: 'dated-first'}), /changed after/);
    assert.equal((await getDoc(doc(api.db, 'staff_rate_changes/dated-stale'))).exists(), false);
    assert.equal((await salarySnapshot(ctx)).salaryRateTimeline.revision, 2);
});

test('dated salary lost-ack retry reuses one immutable event and refuses a changed effective-date intent', async () => {
    await rateSetup();
    const ctx = owner(), api = rateApi(ctx), future = dateOffset(staffRateDate(), 3), run = api.runTransaction;
    let lose = true;
    api.runTransaction = async (...args) => {const result = await run(...args); if (lose) {lose = false; throw Error('Synthetic dated salary lost acknowledgement');} return result;};
    await assert.rejects(datedSave(api, 'dated-lost-ack', 510, future), /lost acknowledgement/);
    assert.equal((await datedSave(api, 'dated-lost-ack', 510, future)).alreadySaved, true);
    await assert.rejects(datedSave(api, 'dated-lost-ack', 510, dateOffset(future, 1)), /different staff edits/);
    const timeline = (await salarySnapshot(ctx)).salaryRateTimeline;
    assert.equal(timeline.revision, 1); assert.deepEqual(Object.keys(timeline.rates), ['dated-lost-ack']);
    assert.equal((await getDocs(query(collection(api.db, 'staff_rate_changes'), where('staffId', '==', staffId), where('branch', '==', branch)))).size, 1);
});

test('dated salary is private to approved own Staff devices and scoped verified payroll HQ', async () => {
    await rateSetup();
    const path = `staff_salary_rates/${staffId}`;
    await datedSave(rateApi(owner()), 'salary-read-scope', 500, dateOffset(staffRateDate(), 1));
    await assertSucceeds(getDoc(doc(anonymous(uid).firestore(), path)));
    const payrollHQ = google('rate-maa', 'rate-maa@example.test');
    await assertSucceeds(getDocs(query(collection(payrollHQ.firestore(), 'staff_salary_rates'), where('branch', '==', branch))));
    for (const ctx of [env.unauthenticatedContext(), anonymous('new-phone'), anonymous('other-employee'), anonymous('revoked-device'), otherHQ(), google('unverified-owner', 'jgo031996@gmail.com', false)]) {
        await assertFails(getDoc(doc(ctx.firestore(), path)));
        await assertFails(setDoc(doc(ctx.firestore(), path), {version: 1, staffId, branch, baselineDailyRate: 900}));
    }
    await assertFails(getDocs(collection(anonymous(uid).firestore(), 'staff_salary_rates')));
    await assertFails(getDocs(collection(payrollHQ.firestore(), 'staff_salary_rates')));
    await adminSet('hq_email_access/rate-maa@example.test', {active: false, permissions: ['payroll'], allowedBranches: [branch]});
    await assertFails(getDoc(doc(payrollHQ.firestore(), path)));
});

test('timeline, v2 audit and protected public projection must commit together; baseline and prior events are immutable', async () => {
    await rateSetup();
    const ctx = owner(), db = ctx.firestore(), api = rateApi(ctx), future = dateOffset(staffRateDate(), 2);
    await datedSave(api, 'salary-batch-first', 500, future);
    const profile = await salarySnapshot(ctx), prior = profile.salaryRateTimeline;
    const oldAudit = (await getDoc(doc(db, 'staff_rate_changes/salary-batch-first'))).data();
    async function batchSave(operation, {omit, baseline, changeOld, actor} = {}) {
        const batch = writeBatch(db), rates = {...prior.rates, [operation]: {effectiveDate: future, dailyRate: 600, sequence: 2}};
        if (changeOld) rates['salary-batch-first'] = {...rates['salary-batch-first'], dailyRate: 999};
        if (omit !== 'profile') batch.update(doc(db, `cashiers/${staffId}`), {staffRateAuditId: operation, salaryRateRevision: operation});
        if (omit !== 'timeline') batch.set(doc(db, `staff_salary_rates/${staffId}`), {...prior, baselineDailyRate: baseline ?? prior.baselineDailyRate, rates, revision: 2, revisionId: operation, updatedAt: serverTimestamp()});
        if (omit !== 'audit') batch.set(doc(db, `staff_rate_changes/${operation}`), {...oldAudit, fromDailyRate: 500, toDailyRate: 600, rateRevision: 2, actorUid: actor ?? 'owner-uid', recordedAt: serverTimestamp()});
        return batch.commit();
    }
    for (const omit of ['profile', 'timeline', 'audit']) await assertFails(batchSave('salary-missing-' + omit, {omit}));
    await assertFails(batchSave('salary-change-baseline', {baseline: 1}));
    await assertFails(batchSave('salary-rewrite-old', {changeOld: true}));
    await assertFails(batchSave('salary-spoof-actor', {actor: 'other-uid'}));
    await assertFails(updateDoc(doc(db, `cashiers/${staffId}`), {hourlyRate: 800}));
    await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), `cashiers/${staffId}`), {branch: 'Citygate'}));
    await assertFails(deleteDoc(doc(db, `staff_salary_rates/${staffId}`)));
    await assertSucceeds(batchSave('salary-complete-atomic'));
    assert.equal(staffRateForDate(await salarySnapshot(ctx), future), 600);
    assert.deepEqual((await getDoc(doc(db, 'staff_rate_changes/salary-batch-first'))).data(), oldAudit);
});

test('dated numeric-string baselines, future decrease and first employment date do not invent earlier wages', async () => {
    await rateSetup();
    await adminSet(`cashiers/${staffId}`, {...ratePayload(' 450.50 '), active: true});
    const api = rateApi(owner()), today = staffRateDate(), future = dateOffset(today, 2);
    await assertSucceeds(datedSave(api, 'salary-numeric-baseline', 0, future, {expectedRate: 450.50}));
    const existing = await salarySnapshot();
    assert.equal(existing.salaryRateTimeline.baselineDailyRate, 450.50);
    assert.equal(staffRateForDate(existing, today), 450.50); assert.equal(staffRateForDate(existing, future), 0);
    assert.equal((await getDoc(doc(api.db, 'staff_rate_changes/salary-numeric-baseline'))).data().eventType, 'decrease');
    await assertSucceeds(saveStaffProfileAtomic(api, 'new-dated-staff', ratePayload(450), {operationId: 'salary-first-date', expectedExists: false, expectedRate: null, effectiveDate: future}));
    const newProfile = (await getDoc(doc(api.db, 'cashiers/new-dated-staff'))).data();
    newProfile.salaryRateTimeline = (await getDoc(doc(api.db, 'staff_salary_rates/new-dated-staff'))).data();
    assert.equal(staffRateForDate(newProfile, today), null); assert.equal(staffRateForDate(newProfile, future), 450);
    await assert.rejects(datedSave(api, 'salary-invalid-calendar', 500, '2026-02-30'), /valid salary effective date/);
    assert.equal((await getDoc(doc(api.db, 'staff_rate_changes/salary-invalid-calendar'))).exists(), false);
});

test('branch payroll HQ may save dated wages while the document vault is disabled, but not for another branch', async () => {
    await rateSetup(); await adminSet('staff_document_config/current', vaultConfig(false));
    const ctx = google('rate-maa', 'rate-maa@example.test'), api = rateApi(ctx, 'rate-maa', 'rate-maa@example.test');
    await assertSucceeds(datedSave(api, 'salary-hq-dated', 500, dateOffset(staffRateDate(), 1)));
    await assert.rejects(saveStaffProfileAtomic(api, staffId, ratePayload(600, 'Citygate'), {operationId: 'salary-cross-branch', effectiveDate: dateOffset(staffRateDate(), 1)}), /branch|access|assigned/i);
    assert.equal((await getDoc(doc(owner().firestore(), 'staff_rate_changes/salary-cross-branch'))).exists(), false);
});

test('the first dated salary audit must bind its normalized source wage and include the current-projection flag', async () => {
    await rateSetup();
    const db = owner().firestore(), today = staffRateDate(), future = dateOffset(today, 2);
    async function firstSalary(operation, fromDailyRate, omitAppliesNow = false) {
        const batch = writeBatch(db), audit = {version: 2, staffId, staffName: 'Sample Staff', branch, previousBranch: branch,
            eventType: fromDailyRate == null || fromDailyRate === 0 ? 'baseline' : 'increase', fromDailyRate, toDailyRate: 500,
            effectiveDate: future, rateChange: true, appliesNow: false, rateRevision: 1, projectionDate: today, projectionDailyRate: 450,
            inputHash: sha, actorUid: 'owner-uid', actorEmail: 'jgo031996@gmail.com', actorName: 'Sample HQ', recordedAt: serverTimestamp()};
        if (omitAppliesNow) delete audit.appliesNow;
        batch.update(doc(db, `cashiers/${staffId}`), {hourlyRate: 450, latestRateRaise: null, salaryRateVersion: 1, salaryRateRevision: operation, staffRateAuditId: operation});
        batch.set(doc(db, `staff_salary_rates/${staffId}`), {version: 1, staffId, branch, baselineDailyRate: 450,
            rates: {[operation]: {effectiveDate: future, dailyRate: 500, sequence: 1}}, revision: 1, revisionId: operation, updatedAt: serverTimestamp(), updatedByUid: 'owner-uid'});
        batch.set(doc(db, 'staff_rate_changes/' + operation), audit);
        return batch.commit();
    }
    for (const [index, forged] of [null, 0, 1, 449].entries()) await assertFails(firstSalary('first-forged-source-' + index, forged));
    await assertFails(firstSalary('first-missing-projection', 450, true));
    await assertSucceeds(firstSalary('first-bound-source', 450));
    assert.equal((await getDoc(doc(db, 'staff_rate_changes/first-bound-source'))).data().fromDailyRate, 450);
});

async function earlyFixture() {
    await rateSetup();
    const clock = new Date(), startAt = new Date(+clock - 4 * 3600000), endAt = new Date(+clock + 2 * 3600000);
    const start = {id: 'early-original-in', staffId, staffName: 'Sample Staff', branch, type: 'TIME IN', timestamp: Timestamp.fromDate(startAt),
        scheduleSnapshot: {version: 1, source: 'clock-in', branch, staffName: 'Sample Staff', clockInAt: startAt.toISOString(), expectedStartAt: startAt.toISOString(), expectedEndAt: endAt.toISOString(), shiftId: 'early-saved-slot', wasScheduled: true, needsScheduleReview: false, scheduleRevisionId: 'early-original-schedule'}};
    const {id, ...source} = start;
    await adminSet('attendance_logs/' + id, source);
    const staffApi = rateApi(env.unauthenticatedContext()); delete staffApi.auth; delete staffApi.sessionUser;
    let activeClock = null, token = 0;
    const options = {now: () => activeClock ? new Date(activeClock) : new Date(), makeToken: () => `early-synthetic-token-${++token}`};
    const staffService = createEarlyTimeOutService(staffApi, options), hqApi = rateApi(owner()), hqService = createEarlyTimeOutService(hqApi, options);
    const input = {start, staffId, staffName: 'Sample Staff', pin: '1111', assertCurrent() {}};
    const attendance = {staffId, staffName: 'Sample Staff', branch, type: 'TIME OUT', sourceApp: 'emulator-synthetic-only'};
    return {get clock() {return activeClock ? new Date(activeClock) : new Date();}, start, input, attendance, staffApi, staffService, hqService, hqApi,
        setClock: value => {activeClock = new Date(value);},
        request: () => staffService.request({...input, reason: 'Synthetic family appointment'}),
        review: (requestId, decision = 'Approved', extra = {}) => hqService.review({requestId, decision, reviewer: {uid: 'owner-uid', email: 'jgo031996@gmail.com'}, assertReviewAccess: candidate => {assert.equal(candidate, branch); return true;}, ...extra})};
}
async function approvalBatch(ctx, requestId, {approval = {}, requestPatch = {}, omitRequest = false, omitApproval = false} = {}) {
    const db = ctx.firestore(), pending = (await getDoc(doc(db, 'staff_requests/' + requestId))).data();
    const data = {schemaVersion: 1, requestId, requestVersion: pending.requestVersion, requestToken: pending.requestToken, decision: 'Approved',
        staffId: pending.staffId, staffName: pending.staffName, branch: pending.branch, timeInLogId: pending.timeInLogId, timeInAt: pending.timeInAt,
        scheduledEndAt: pending.scheduledEndAt, scheduleFingerprint: pending.scheduleFingerprint, requestedDepartureAt: pending.requestedDepartureAt,
        reviewedByUid: 'owner-uid', reviewedByEmail: 'jgo031996@gmail.com', reviewedAt: serverTimestamp(), validUntil: Timestamp.fromMillis(Date.now() + 5 * 60000), reviewNote: 'Synthetic review', ...approval};
    const batch = writeBatch(db);
    if (!omitApproval) batch.set(doc(db, 'attendance_time_out_approvals/' + requestId), data);
    if (!omitRequest) batch.update(doc(db, 'staff_requests/' + requestId), {status: data.decision, processedAt: serverTimestamp(), processedBy: data.reviewedByEmail, managerReply: data.reviewNote, staffAcknowledged: false, ...requestPatch});
    return batch.commit();
}

async function finishBoundFixture() {
    const f = await earlyFixture(), at = time => new Date(`2026-10-19T${time}:00+08:00`);
    const plan = {currentYear: 2026, currentMonth: 10, branchConfig: {[branch]: [
        {id: 'm1', name: 'Morning Staff 1', startTime: '09:00', endTime: '17:30', active: true},
        {id: 'm2', name: 'Morning Staff 2', startTime: '09:30', endTime: '18:00', active: true}]},
        currentSchedule: {19: {[branch]: {scheduled: {m1: 'Other Synthetic Crew', m2: 'UNFILLED'}, rest: ['Sample Staff'], unavailable: [], swaps: {}}}},
        employees: [{id: staffId, name: 'Sample Staff', branch}], unavailability: {}};
    const revision = createScheduleRevision(plan, {revisionId: 'synthetic-maa-captured', effectiveFrom: '2026-10-01', savedAt: new Date('2026-10-01T07:00:00+08:00'), cutover: '2026-10-01'});
    await adminSet('settings/global_schedule', {...revision.snapshot, scheduleRevisionId: revision.revisionId, payrollHistoryEnforcedFrom: '2026-10-01'});
    await adminSet('settings/schedule_month_2026_10', {month: '2026-10', revisionIds: [revision.revisionId], latestRevisionId: revision.revisionId});
    await adminSet('settings/schedule_revision_' + revision.revisionId, revision);
    const start = {...f.start, timestamp: Timestamp.fromDate(at('08:49')), scheduleSnapshot: {
        version: 1, source: 'clock-in', branch, staffName: 'Sample Staff', clockInAt: at('08:49').toISOString(),
        expectedStartAt: at('09:00').toISOString(), expectedEndAt: at('17:30').toISOString(), shiftId: 'm1',
        wasScheduled: false, needsScheduleReview: false, scheduleRevisionId: revision.revisionId}};
    const {id, ...source} = start; await adminSet('attendance_logs/' + id, source);
    const input = {...f.input, start}; f.setClock(at('17:40'));
    const request = await f.staffService.request({...input, reason: 'Synthetic unknown schedule review'});
    return {...f, start, input, request, at, reviewService: createEarlyTimeOutReviewService(f.hqApi, {now: () => new Date(f.clock)})};
}

test('local Rules permit normal close after the complete-only bound without creating an approval or altering saved paid payroll', async () => {
    const f = await finishBoundFixture(), db = f.hqApi.db;
    const original = (await getDoc(doc(db, 'attendance_logs/' + f.start.id))).data(), paid = (await getDoc(doc(db, 'payroll_records/rate-frozen'))).data();
    await assert.rejects(f.staffService.close({...f.input, attendance: f.attendance}), /could not be verified/);
    assert.equal((await getDocs(query(collection(db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0);
    f.setClock(f.at('18:40'));
    assert.equal((await f.staffService.inspect(f.input)).complete, true);
    assert.equal((await getDocs(query(collection(db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0, 'inspection does not create departure');
    const result = await assertSucceeds(f.staffService.close({...f.input, attendance: {...f.attendance, timestamp: f.at('17:40')}}));
    const out = (await getDoc(doc(db, 'attendance_logs/' + result.id))).data();
    assert.equal(out.timestamp.toMillis(), +f.at('18:40')); assert.equal(out.earlyTimeOut, undefined);
    assert.equal((await getDoc(doc(db, 'staff_requests/' + f.request.id))).data().status, 'Completed Normally');
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + f.request.id))).exists(), false);
    assert.deepEqual((await getDoc(doc(db, 'attendance_logs/' + f.start.id))).data(), original);
    assert.deepEqual((await getDoc(doc(db, 'payroll_records/rate-frozen'))).data(), paid);
    assert.equal((await f.staffService.close({...f.input, attendance: f.attendance})).alreadySaved, true);
});

test('local HQ review fresh-inspects the complete-only bound then dismisses only the obsolete request without clocking staff out', async () => {
    const f = await finishBoundFixture(), db = f.hqApi.db;
    const requestPath = 'staff_requests/' + f.request.id, pending = (await getDoc(doc(db, requestPath))).data();
    const preview = {requestId: f.request.id, expectedRequestVersion: pending.requestVersion, expectedRequestToken: pending.requestToken};
    await assert.rejects(f.reviewService.dismiss(preview), /still needs an attendance decision/);
    f.setClock(f.at('18:40'));
    const inspection = await assertSucceeds(f.reviewService.inspect(preview));
    assert.equal(inspection.complete, true); assert.equal(inspection.clockOutCompleteOnly, true); assert.equal(inspection.closed, false);
    assert.deepEqual((await getDoc(doc(db, requestPath))).data(), pending);
    const result = await assertSucceeds(f.reviewService.dismiss({...preview, reviewNote: 'Verified finish has passed. Normal Time Out is available.'}));
    assert.equal(result.decision, 'Not Required');
    const resolved = (await getDoc(doc(db, requestPath))).data();
    assert.equal(resolved.status, 'Not Required'); assert.equal(resolved.processedBy, 'jgo031996@gmail.com');
    assert.equal(resolved.timeOutReview.verifiedFinishAt, f.at('18:00').toISOString()); assert.equal(resolved.timeOutReview.existingTimeOutLogId, null);
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + f.request.id))).exists(), false);
    assert.equal((await getDocs(query(collection(db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0);
    assert.deepEqual((await getDoc(doc(db, 'payroll_records/rate-frozen'))).data().frozenData, {dailyRate: 450, netPay: 4500});
    assert.equal((await f.reviewService.dismiss(preview)).alreadySaved, true);
});

test('actual protected early approval closes one linked Time Out and preserves the original punch and paid payroll', async () => {
    const f = await earlyFixture(), request = await f.request();
    const original = (await getDoc(doc(f.hqApi.db, 'attendance_logs/' + f.start.id))).data();
    await assertSucceeds(f.review(request.id));
    const beforeClose = Date.now(), result = await assertSucceeds(f.staffService.close({...f.input, attendance: f.attendance}));
    const retry = await assertSucceeds(f.staffService.close({...f.input, attendance: f.attendance}));
    assert.equal(result.saved, true); assert.equal(retry.alreadySaved, true); assert.equal(retry.id, result.id);
    const out = (await getDoc(doc(f.hqApi.db, 'attendance_logs/' + result.id))).data();
    assert.equal(out.timeInLogId, f.start.id); assert.equal(out.earlyTimeOut.requestId, request.id);
    assert.ok(out.timestamp.toMillis() >= beforeClose && out.timestamp.toMillis() <= Date.now());
    assert.equal((await getDoc(doc(f.hqApi.db, 'staff_requests/' + request.id))).data().status, 'Consumed');
    assert.deepEqual((await getDoc(doc(f.hqApi.db, 'attendance_logs/' + f.start.id))).data(), original);
    assert.deepEqual((await getDoc(doc(f.hqApi.db, 'payroll_records/rate-frozen'))).data().frozenData, {dailyRate: 450, netPay: 4500});
    assert.equal((await getDocs(query(collection(f.hqApi.db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 1);
});

test('a small reviewer clock lead remains within the server expiry cap while larger skew fails closed', async () => {
    const f = await earlyFixture(), request = await f.request(), db = f.hqApi.db;
    f.setClock(Date.now() + 2000);
    await assertSucceeds(f.review(request.id));
    const approval = (await getDoc(doc(db, 'attendance_time_out_approvals/' + request.id))).data();
    const duration = approval.validUntil.toMillis() - approval.reviewedAt.toMillis();
    assert.ok(duration > 28 * 60000 && duration <= 30 * 60000, 'Client expiry remains below the authoritative server limit');
    assert.equal((await f.staffService.close({...f.input, attendance: f.attendance})).saved, true);
    // A second synthetic shift uses the same protected-policy paths but a new
    // original punch. No tolerance is added to the Rules' thirty-minute cap.
    const oldId = f.start.id, nextId = 'early-second-in';
    const {id, ...source} = {...f.start, id: nextId};
    await adminSet('attendance_logs/' + id, source);
    const nextInput = {...f.input, start: {...f.start, id: nextId}};
    f.setClock(Date.now() + 2 * 60000);
    const next = await f.staffService.request({...nextInput, reason: 'Synthetic second-shift appointment'});
    await assertFails(f.review(next.id));
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + next.id))).exists(), false);
    assert.equal((await getDoc(doc(db, 'staff_requests/' + next.id))).data().status, 'Pending');
    assert.equal((await getDoc(doc(db, 'attendance_logs/' + oldId))).data().type, 'TIME IN');
});

test('public request status cannot manufacture early attendance authority, and unknown Staff cannot issue protected approvals', async () => {
    const f = await earlyFixture(), request = await f.request(), db = f.staffApi.db;
    await assertSucceeds(updateDoc(doc(db, 'staff_requests/' + request.id), {status: 'Approved', processedBy: 'forged-owner'}));
    await assert.rejects(f.staffService.close({...f.input, attendance: f.attendance}), /Management approval/);
    await adminSet('staff_requests/' + request.id, {...(await getDoc(doc(db, 'staff_requests/' + request.id))).data(), status: 'Pending'});
    for (const ctx of [env.unauthenticatedContext(), anonymous(uid), google('unverified-owner', 'jgo031996@gmail.com', false), otherHQ(), google('no-permission', 'no-permission@example.test')]) {
        await assertFails(approvalBatch(ctx, request.id));
    }
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + request.id))).exists(), false);
    assert.equal((await getDocs(query(collection(db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0);
});

test('early approval and reviewed request must be atomic and exact; forged links, tokens, versions and review actors fail', async () => {
    const f = await earlyFixture(), request = await f.request(), ctx = owner();
    await assertFails(approvalBatch(ctx, request.id, {omitRequest: true}));
    for (const approval of [{requestVersion: 99}, {requestToken: 'different-token'}, {requestToken: 'x'}, {staffId: 'employee-2'}, {branch: 'Citygate'}, {timeInLogId: 'other-start'}, {reviewedByUid: 'other-owner'}, {reviewedByEmail: 'other@example.test'}, {extra: true}]) {
        await assertFails(approvalBatch(ctx, request.id, {approval}));
    }
    for (const requestPatch of [{reason: 'Rewritten incident'}, {requestToken: 'new-unsafe-token'}, {processedBy: 'someone-else'}, {staffAcknowledged: true}, {processedAt: Timestamp.fromMillis(1)}]) {
        await assertFails(approvalBatch(ctx, request.id, {requestPatch}));
    }
    await assertFails(approvalBatch(ctx, request.id, {approval: {validUntil: Timestamp.fromMillis(Date.now() - 1000)}}));
    await assertFails(approvalBatch(ctx, request.id, {approval: {validUntil: Timestamp.fromMillis(Date.now() + 31 * 60000)}}));
    await assertSucceeds(approvalBatch(ctx, request.id));
    assert.equal((await getDoc(doc(ctx.firestore(), 'staff_requests/' + request.id))).data().status, 'Approved');
});

test('scoped inbox HQ can review early attendance but revocation, approval listing and same-version rewrite are denied', async () => {
    const f = await earlyFixture(), request = await f.request();
    await adminSet('hq_email_access/early-inbox@example.test', {active: true, permissions: ['inbox'], allowedBranches: [branch]});
    const ctx = google('early-inbox', 'early-inbox@example.test'), api = rateApi(ctx, 'early-inbox', 'early-inbox@example.test');
    const service = createEarlyTimeOutService(api, {now: () => new Date(f.clock)});
    await assertSucceeds(service.review({requestId: request.id, decision: 'Approved', reviewer: {uid: 'early-inbox', email: 'early-inbox@example.test'}, assertReviewAccess: () => true}));
    const path = 'attendance_time_out_approvals/' + request.id;
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
    await assertFails(getDocs(collection(ctx.firestore(), 'attendance_time_out_approvals')));
    await assertFails(deleteDoc(doc(owner().firestore(), path)));
    const approval = (await getDoc(doc(ctx.firestore(), path))).data();
    await assertFails(setDoc(doc(ctx.firestore(), path), {...approval, reviewedAt: serverTimestamp()}));
    await f.staffService.cancel(f.input); await f.request();
    await adminSet('hq_email_access/early-inbox@example.test', {active: false, permissions: ['inbox'], allowedBranches: [branch]});
    await assertFails(service.review({requestId: request.id, decision: 'Approved', reviewer: {uid: 'early-inbox', email: 'early-inbox@example.test'}, assertReviewAccess: () => true}));
    assert.equal((await getDoc(doc(ctx.firestore(), path))).data().requestVersion, 1);
});

test('cancel and re-request invalidates old approval; only a fresh version can close the original shift', async () => {
    const f = await earlyFixture(), request = await f.request();
    await f.review(request.id); await f.staffService.cancel(f.input); await f.request();
    const db = f.hqApi.db, before = (await getDoc(doc(db, 'attendance_time_out_approvals/' + request.id))).data();
    assert.equal((await getDoc(doc(db, 'staff_requests/' + request.id))).data().requestVersion, 2);
    await assert.rejects(f.staffService.close({...f.input, attendance: f.attendance}), /Management approval/);
    await assertFails(approvalBatch(owner(), request.id, {approval: {requestVersion: before.requestVersion, requestToken: before.requestToken}}));
    await assertSucceeds(f.review(request.id));
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + request.id))).data().requestVersion, 2);
    assert.equal((await f.staffService.close({...f.input, attendance: f.attendance})).saved, true);
});

test('expired approval and unknown schedules cannot close early or fabricate a worked-hours record', async () => {
    const f = await earlyFixture(), request = await f.request();
    await f.review(request.id); f.setClock(+f.clock + 31 * 60000);
    await assert.rejects(f.staffService.close({...f.input, attendance: f.attendance}), /Management approval/);
    const withoutSnapshot = {...f.start}; delete withoutSnapshot.id; delete withoutSnapshot.scheduleSnapshot;
    await adminSet('attendance_logs/' + f.start.id, withoutSnapshot);
    const unknown = await f.request();
    assert.equal((await getDoc(doc(f.hqApi.db, 'staff_requests/' + unknown.id))).data().requiresScheduleReview, true);
    await assert.rejects(f.review(unknown.id), /does not identify a verified assigned shift finish/);
    await assert.rejects(f.staffService.close({...f.input, attendance: f.attendance}), /could not be verified/);
    assert.equal((await getDocs(query(collection(f.hqApi.db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0);
});

test('protected approval cannot extend a shift beyond twenty-four hours; an authorized rejection needs no expiry', async () => {
    const f = await earlyFixture(), request = await f.request(), db = f.hqApi.db;
    const oldStart = new Date(Date.now() - 25 * 3600000), path = 'attendance_logs/' + f.start.id;
    await adminSet(path, {...(await getDoc(doc(db, path))).data(), timestamp: Timestamp.fromDate(oldStart)});
    const requestPath = 'staff_requests/' + request.id;
    await adminSet(requestPath, {...(await getDoc(doc(db, requestPath))).data(), timeInAt: oldStart.toISOString()});
    await assertFails(approvalBatch(owner(), request.id));
    await assertFails(approvalBatch(owner(), request.id, {approval: {decision: 'Rejected', validUntil: Timestamp.fromMillis(Date.now() + 60000)}}));
    await assertSucceeds(approvalBatch(owner(), request.id, {approval: {decision: 'Rejected', validUntil: null}}));
    assert.equal((await getDoc(doc(db, 'attendance_time_out_approvals/' + request.id))).data().decision, 'Rejected');
    assert.equal((await getDoc(doc(db, requestPath))).data().status, 'Rejected');
    assert.equal((await getDocs(query(collection(db, 'attendance_logs'), where('type', '==', 'TIME OUT')))).size, 0);
});

async function legacyIncreaseFixture() {
    await rateSetup();
    const ctx = owner(), api = rateApi(ctx), sourceId = 'legacy-date-source';
    await rateSave(api, sourceId, 480);
    return {ctx, api, sourceId, today: staffRateDate(),
        source: (await getDoc(doc(api.db, 'staff_rate_changes/' + sourceId))).data(),
        profile: (await getDoc(doc(api.db, 'cashiers/' + staffId))).data(),
        paid: (await getDoc(doc(api.db, 'payroll_records/rate-frozen'))).data()};
}
function dateLegacy(f, operationId, effectiveDate = dateOffset(f.today, -8), options = {}) {
    return dateLegacyStaffIncrease(f.api, staffId, f.sourceId, {operationId, effectiveDate, expectedRate: 480, expectedRateRevision: null, ...options});
}
function legacyMigrationBatch(f, ctx, operationId, {omit, audit = {}, salary = {}, profile = {}, actorUid = 'owner-uid', actorEmail = 'jgo031996@gmail.com'} = {}) {
    const db = ctx.firestore(), effectiveDate = dateOffset(f.today, -8), batch = writeBatch(db);
    const record = {version: 2, staffId, staffName: 'Sample Staff', branch, previousBranch: branch, eventType: 'increase',
        fromDailyRate: 450, toDailyRate: 480, effectiveDate, rateChange: true, appliesNow: true, rateRevision: 1,
        projectionDate: f.today, projectionDailyRate: 480, inputHash: sha, actorUid, actorEmail, actorName: 'Sample HQ',
        legacyAuditId: f.sourceId, recordedAt: serverTimestamp(), ...audit};
    if (omit !== 'profile') batch.update(doc(db, 'cashiers/' + staffId), {hourlyRate: 480, latestRateRaise: {eventId: operationId, version: 1},
        salaryRateVersion: 1, salaryRateRevision: operationId, staffRateAuditId: operationId, ...profile});
    if (omit !== 'timeline') batch.set(doc(db, 'staff_salary_rates/' + staffId), {version: 1, staffId, branch, baselineDailyRate: 450,
        rates: {[operationId]: {effectiveDate, dailyRate: 480, sequence: 1}}, revision: 1, revisionId: operationId,
        updatedAt: serverTimestamp(), updatedByUid: actorUid, ...salary});
    if (omit !== 'audit') batch.set(doc(db, 'staff_rate_changes/' + operationId), record);
    return batch.commit();
}

test('dating the latest trusted legacy raise preserves its old wage, mixed cutoff and paid snapshot', async () => {
    const f = await legacyIncreaseFixture(), effectiveDate = dateOffset(f.today, -8), beforeDate = dateOffset(effectiveDate, -1);
    await assertSucceeds(dateLegacy(f, 'legacy-date-confirmed', effectiveDate));
    const profile = await salarySnapshot(f.ctx), audit = (await getDoc(doc(f.api.db, 'staff_rate_changes/legacy-date-confirmed'))).data();
    assert.equal(profile.hourlyRate, 480); assert.equal(profile.salaryRateTimeline.baselineDailyRate, 450);
    assert.equal(staffRateForDate(profile, dateOffset(effectiveDate, -20)), 450);
    assert.equal(staffRateForDate(profile, beforeDate), 450); assert.equal(staffRateForDate(profile, effectiveDate), 480);
    assert.equal(audit.version, 2); assert.equal(audit.legacyAuditId, f.sourceId); assert.equal(audit.fromDailyRate, 450); assert.equal(audit.toDailyRate, 480);
    const logs = [beforeDate, effectiveDate].flatMap((date, index) => [
        {id: 'dated-work-in-' + index, staffId, staffName: 'Sample Staff', branch, type: 'TIME IN', lateMinutes: 0, timestamp: new Date(date + 'T09:00:00+08:00')},
        {id: 'dated-work-out-' + index, staffId, staffName: 'Sample Staff', branch, type: 'TIME OUT', timestamp: new Date(date + 'T17:00:00+08:00')}
    ]);
    const estimates = attendanceEstimate({logs, profiles: [{...profile, id: staffId, nightDiffRate: 0}], start: beforeDate, end: effectiveDate, branch});
    assert.equal(estimates.length, 1); assert.equal(estimates[0].basic, 930);
    assert.deepEqual(estimates[0].logs.map(row => row.dailyRate), [450, 480]);
    assert.equal(staffProfileForWork(profile, logs[0], {}).hourlyRate, 450);
    assert.equal(staffProfileForWork(profile, logs[2], {}).hourlyRate, 480);
    assert.deepEqual((await getDoc(doc(f.api.db, 'staff_rate_changes/' + f.sourceId))).data(), f.source);
    assert.deepEqual((await getDoc(doc(f.api.db, 'payroll_records/rate-frozen'))).data(), f.paid);
});

test('legacy-date lost acknowledgement and repeated operation reuse one correction and refuse another date or operation', async () => {
    const f = await legacyIncreaseFixture(), run = f.api.runTransaction;
    let lose = true;
    f.api.runTransaction = async (...args) => {const result = await run(...args); if (lose) {lose = false; throw Error('Synthetic legacy-date lost acknowledgement');} return result;};
    await assert.rejects(dateLegacy(f, 'legacy-date-retry'), /lost acknowledgement/);
    assert.equal((await dateLegacy(f, 'legacy-date-retry')).alreadySaved, true);
    await assert.rejects(dateLegacy(f, 'legacy-date-retry', dateOffset(f.today, -7)));
    await assert.rejects(dateLegacy(f, 'legacy-date-second-operation'));
    const profile = await salarySnapshot(f.ctx);
    assert.deepEqual(Object.keys(profile.salaryRateTimeline.rates), ['legacy-date-retry']);
    assert.equal(profile.salaryRateTimeline.revision, 1);
    assert.equal((await getDocs(query(collection(f.api.db, 'staff_rate_changes'), where('staffId', '==', staffId), where('branch', '==', branch)))).size, 2);
    assert.deepEqual((await getDoc(doc(f.api.db, 'payroll_records/rate-frozen'))).data(), f.paid);
});

test('legacy dating refuses a missing or no-longer-current audit, stale wage and stale revision without a partial correction', async () => {
    const f = await legacyIncreaseFixture();
    await assert.rejects(dateLegacyStaffIncrease(f.api, staffId, 'missing-legacy-audit', {operationId: 'legacy-missing-source', effectiveDate: dateOffset(f.today, -8), expectedRate: 480, expectedRateRevision: null}));
    await assert.rejects(dateLegacy(f, 'legacy-stale-opened-rate', undefined, {expectedRate: 450}));
    await assert.rejects(dateLegacy(f, 'legacy-stale-opened-revision', undefined, {expectedRateRevision: 'stale-private-revision'}));
    await adminSet('cashiers/' + staffId, {...f.profile, hourlyRate: 481});
    await assert.rejects(dateLegacy(f, 'legacy-current-wage-changed'));
    await adminSet('cashiers/' + staffId, {...f.profile, staffRateAuditId: 'another-audit'});
    await assert.rejects(dateLegacy(f, 'legacy-current-audit-changed'));
    await adminSet('cashiers/' + staffId, {...f.profile, latestRateRaise: {eventId: 'another-audit', version: 1}});
    await assert.rejects(dateLegacy(f, 'legacy-current-marker-changed'));
    assert.equal((await getDoc(doc(f.api.db, 'staff_salary_rates/' + staffId))).exists(), false);
    for (const id of ['legacy-missing-source', 'legacy-stale-opened-rate', 'legacy-stale-opened-revision', 'legacy-current-wage-changed', 'legacy-current-audit-changed', 'legacy-current-marker-changed']) {
        assert.equal((await getDoc(doc(f.api.db, 'staff_rate_changes/' + id))).exists(), false);
    }
    assert.deepEqual((await getDoc(doc(f.api.db, 'staff_rate_changes/' + f.sourceId))).data(), f.source);
});

test('dating a legacy raise rejects an existing private timeline and cannot replace already dated history', async () => {
    const f = await legacyIncreaseFixture();
    const orphan = {version: 1, staffId, branch, baselineDailyRate: 400, rates: {}, revision: 1, revisionId: 'unrelated-history', updatedByUid: 'owner-uid', updatedAt: Timestamp.fromMillis(1000)};
    await adminSet('staff_salary_rates/' + staffId, orphan);
    await assert.rejects(dateLegacy(f, 'legacy-orphan-timeline'));
    assert.deepEqual((await getDoc(doc(f.api.db, 'staff_salary_rates/' + staffId))).data(), orphan);
    assert.equal((await getDoc(doc(f.api.db, 'staff_rate_changes/legacy-orphan-timeline'))).exists(), false);
    await adminSet('cashiers/' + staffId, {...f.profile, salaryRateVersion: 1, salaryRateRevision: 'unrelated-history'});
    await assert.rejects(dateLegacy(f, 'legacy-already-dated'));
    assert.deepEqual((await getDoc(doc(f.api.db, 'staff_salary_rates/' + staffId))).data(), orphan);
});

test('legacy migration Rules require the exact immutable source and all three linked writes', async () => {
    const f = await legacyIncreaseFixture();
    for (const omit of ['profile', 'timeline', 'audit']) await assertFails(legacyMigrationBatch(f, f.ctx, 'legacy-partial-' + omit, {omit}));
    await assertFails(legacyMigrationBatch(f, f.ctx, 'legacy-forged-source-id', {audit: {legacyAuditId: 'missing-source'}}));
    await assertFails(legacyMigrationBatch(f, f.ctx, 'legacy-forged-old-wage', {audit: {fromDailyRate: 449}, salary: {baselineDailyRate: 449}}));
    await assertFails(legacyMigrationBatch(f, f.ctx, 'legacy-forged-current-wage', {audit: {toDailyRate: 490, projectionDailyRate: 490}, profile: {hourlyRate: 490},
        salary: {rates: {'legacy-forged-current-wage': {effectiveDate: dateOffset(f.today, -8), dailyRate: 490, sequence: 1}}}}));
    assert.equal((await getDoc(doc(f.api.db, 'staff_salary_rates/' + staffId))).exists(), false);
    assert.deepEqual((await getDoc(doc(f.api.db, 'cashiers/' + staffId))).data(), f.profile);
    await assertSucceeds(legacyMigrationBatch(f, f.ctx, 'legacy-complete-control'));
    assert.equal(staffRateForDate(await salarySnapshot(f.ctx), dateOffset(f.today, -9)), 450);
    assert.equal(staffRateForDate(await salarySnapshot(f.ctx), dateOffset(f.today, -8)), 480);
    assert.deepEqual((await getDoc(doc(f.api.db, 'staff_rate_changes/' + f.sourceId))).data(), f.source);
    assert.deepEqual((await getDoc(doc(f.api.db, 'payroll_records/rate-frozen'))).data(), f.paid);
});

test('only verified payroll HQ in the staff branch can date a legacy increase', async () => {
    const f = await legacyIncreaseFixture();
    const denied = [
        [env.unauthenticatedContext(), '', ''],
        [anonymous(uid), uid, ''],
        [google('unverified-owner', 'jgo031996@gmail.com', false), 'unverified-owner', 'jgo031996@gmail.com'],
        [otherHQ(), 'hq-city', 'hq-city@example.test'],
        [google('no-permission', 'no-permission@example.test'), 'no-permission', 'no-permission@example.test']
    ];
    for (const [index, [ctx, actorUid, actorEmail]] of denied.entries()) {
        await assertFails(legacyMigrationBatch(f, ctx, 'legacy-denied-' + index, {actorUid, actorEmail}));
    }
    const ctx = google('rate-maa', 'rate-maa@example.test'), api = rateApi(ctx, 'rate-maa', 'rate-maa@example.test');
    await adminSet('staff_document_config/current', vaultConfig(false));
    await assertSucceeds(dateLegacyStaffIncrease(api, staffId, f.sourceId, {operationId: 'legacy-scoped-payroll', effectiveDate: dateOffset(f.today, -8), expectedRate: 480, expectedRateRevision: null}));
    assert.equal((await salarySnapshot(f.ctx)).salaryRateTimeline.baselineDailyRate, 450);
    await assertFails(getDoc(doc(otherHQ().firestore(), 'staff_salary_rates/' + staffId)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'staff_rate_changes/legacy-scoped-payroll')));
});

test('invalid legacy sources and dates cannot create a timeline or a guessed prior wage', async () => {
    const f = await legacyIncreaseFixture();
    for (const date of ['', '2026-02-30', '10/19/2026']) await assert.rejects(dateLegacy(f, 'legacy-invalid-' + nextOp(), date));
    for (const [index, sourcePatch] of [{version: 2}, {eventType: 'unchanged'}, {fromDailyRate: null}, {fromDailyRate: 0}, {fromDailyRate: 480}, {toDailyRate: 479}, {staffId: 'employee-2'}, {staffName: 'Another Staff'}, {branch: 'Citygate'}].entries()) {
        await adminSet('staff_rate_changes/' + f.sourceId, {...f.source, ...sourcePatch});
        await assert.rejects(dateLegacy(f, 'legacy-invalid-source-' + index));
        assert.equal((await getDoc(doc(f.api.db, 'staff_rate_changes/legacy-invalid-source-' + index))).exists(), false);
    }
    assert.equal((await getDoc(doc(f.api.db, 'staff_salary_rates/' + staffId))).exists(), false);
    assert.deepEqual((await getDoc(doc(f.api.db, 'payroll_records/rate-frozen'))).data(), f.paid);
});

async function payrollPerformanceFixture(){
    const employee='payroll-performance-staff',ctx=owner(),api=rateApi(ctx),profile={cashierName:'Synthetic Payroll Staff',branch,role:'Crew',hourlyRate:450,dateHired:'2030-01-01'};
    api.auth.currentUser.providerData=[{providerId:'google.com'}];api.sessionUser.isOwner=true;
    await adminSet('hq_managers/payroll-performance-owner',{email:'jgo031996@gmail.com',role:'System Architect',permissions:['all'],assignedBranch:'All',pin:'1234'});
    await adminSet('cashiers/'+employee,profile);
    await adminSet('cash_accounts/payroll-performance-bank',{name:'Synthetic Bank',branch:'Main Office',balance:1000});
    const meal=(amount,date)=>({staffId:employee,staffName:profile.cashierName,branch,type:'Staff Meal (POS Auto)',amount,status:'Unpaid',dateAdded:Timestamp.fromDate(new Date(date))});
    await adminSet('staff_deductions/payroll-performance-food-a',meal(40,'2030-01-02T10:00:00+08:00'));
    await adminSet('staff_deductions/payroll-performance-food-b',meal(15,'2030-01-03T10:00:00+08:00'));
    const data={staffId:employee,name:profile.cashierName,branch,start:'2030-01-01',end:'2030-01-15',profile:{...profile,staffId:employee},basicPay:450,meals:50,sourcePerfBonus:0,customDeductionsTotal:0,customDeductions:[],logs:[]};
    return {api,data,input:{data,accountId:'payroll-performance-bank',finalNetPay:400}};
}

test('real Rules permit the ordinary payroll atomic save and exact partial Foods settlement, with no duplicate debit on retry',async()=>{
    const f=await payrollPerformanceFixture();
    const paid=await assertSucceeds(finalizeOrdinaryPayroll(f.api,f.input));assert.equal(paid.alreadyPaid,false);
    assert.equal((await getDoc(doc(f.api.db,'cash_accounts/payroll-performance-bank'))).data().balance,600);
    assert.equal((await getDoc(doc(f.api.db,'staff_deductions/payroll-performance-food-a'))).data().status,'Paid');
    const remainder=(await getDoc(doc(f.api.db,'staff_deductions/payroll-performance-food-b'))).data();assert.equal(remainder.status,'Unpaid');assert.equal(remainder.amount,5);
    const saved=(await getDoc(doc(f.api.db,'payroll_records/'+paid.id))).data();assert.equal(saved.frozenData.finalNetPay,400);assert.equal(saved.acknowledged,false);
    const retry=await assertSucceeds(finalizeOrdinaryPayroll(f.api,f.input));assert.equal(retry.alreadyPaid,true);
    assert.equal((await getDoc(doc(f.api.db,'cash_accounts/payroll-performance-bank'))).data().balance,600);
    assert.equal((await getDocs(query(collection(f.api.db,'expenses'),where('payrollRecordId','==',paid.id)))).size,1);
});

test('real Rules preserve one atomic payroll save after a lost response, and do not reapply deductions',async()=>{
    const f=await payrollPerformanceFixture(),run=f.api.runTransaction;let lose=true;
    f.api.runTransaction=async(...args)=>{const result=await run(...args);if(lose){lose=false;throw Error('Synthetic response lost after commit');}return result;};
    await assert.rejects(finalizeOrdinaryPayroll(f.api,f.input),/response lost/);
    const result=await assertSucceeds(finalizeOrdinaryPayroll(f.api,f.input));assert.equal(result.alreadyPaid,true);
    assert.equal((await getDoc(doc(f.api.db,'cash_accounts/payroll-performance-bank'))).data().balance,600);
    assert.equal((await getDoc(doc(f.api.db,'staff_deductions/payroll-performance-food-b'))).data().amount,5);
});

test('real Rules payroll callback stops a stale selection before any bookkeeping is committed',async()=>{
    const f=await payrollPerformanceFixture(),run=f.api.runTransaction;let stale=false;
    f.api.runTransaction=async(db,callback)=>{stale=true;return run(db,callback);};
    await assert.rejects(finalizeOrdinaryPayroll(f.api,{...f.input,assertCurrent:()=>{if(stale)throw Error('Synthetic selected cutoff changed');}}),/cutoff changed/);
    assert.equal((await getDoc(doc(f.api.db,'cash_accounts/payroll-performance-bank'))).data().balance,1000);
    assert.equal((await getDocs(query(collection(f.api.db,'payroll_records'),where('staffId','==',f.data.staffId)))).empty,true);
    assert.equal((await getDoc(doc(f.api.db,'staff_deductions/payroll-performance-food-a'))).data().status,'Unpaid');
});
