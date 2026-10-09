import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveStaffProfileAtomic} from '../takodeal-manager/staff-rate-changes.js';

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
