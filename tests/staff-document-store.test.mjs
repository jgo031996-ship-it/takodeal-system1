import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStore, documentFilePath} from '../takodeal-staff/staff-document-store.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Transaction and lifecycle tests only: this harness does not execute Security
// Rules. Authorization must additionally pass Firebase Rules tests before release.
const staffId = 'staff-1', uid = 'device-uid', branch = 'Maa';
const docPath = (kind = 'valid_id') => `staff_private_documents/${staffId}/files/${kind}`;
const versionPath = op => `staff_private_documents/${staffId}/versions/${op}`;
const photo = (lastByte = 1) => new Blob([Uint8Array.from([255, 216, 255, 224, lastByte])], {type: 'image/jpeg'});
// The store delegates real image decoding to its UI. This stub asserts the
// callback is reached; browser/image-decoder QA covers the JPEG decoder itself.
const decodedPhoto = {validatePhoto: async blob => {assert.equal(blob.type, 'image/jpeg');}};
function fixture({hq = false, enabled = true, id = staffId, user = uid} = {}) {
    const h = firestoreHarness(), blobs = new Map(), calls = {uploads: 0, reads: 0}, auth = {currentUser: {uid: user}};
    let selectedId = id, operation = 0, clock = 1000, afterUpload, beforeGet;
    h.put('staff_document_config/current', {enabled, policyVersion: 1});
    h.put(`staff_document_devices/${uid}`, {uid, staffId, branch, active: true});
    const sdk = {...h.api,
        doc: (_, ...segments) => h.ref(segments.slice(0, -1).join('/'), segments.at(-1)),
        async getDocFromServer(ref) { if (beforeGet) await beforeGet(ref); return {exists: () => h.docs.has(ref.path), data: () => structuredClone(h.get(ref.path))}; },
        ref: (_, path) => ({path}),
        async getMetadata(ref) {
            const file = blobs.get(ref.path);
            if (!file) throw Object.assign(Error('Missing object'), {code: 'storage/object-not-found'});
            return structuredClone(file.metadata);
        },
        async uploadBytes(ref, blob, metadata) {
            calls.uploads++;
            blobs.set(ref.path, {blob, metadata: {size: blob.size, contentType: blob.type, customMetadata: metadata.customMetadata}});
            if (afterUpload) await afterUpload();
        },
        async getBlob(ref, maxBytes) {
            calls.reads++;
            const file = blobs.get(ref.path);
            if (!file || file.blob.size > maxBytes) throw Error('Missing or oversized photo');
            if (beforeGet) await beforeGet(ref);
            return file.blob;
        }
    };
    const store = createDocumentStore({sdk, db: h.api.db, storage: {}, auth, identity: () => selectedId, isHQ: hq, now: () => clock, uuid: () => `operation-${++operation}`});
    return {...h, sdk, store, blobs, calls, auth, select: id => {selectedId = id;}, advance: ms => {clock += ms;}, afterUpload: fn => {afterUpload = fn;}, beforeGet: fn => {beforeGet = fn;}};
}

test('document paths reject unsupported groups, separators, URLs and unsafe identity values', () => {
    assert.equal(documentFilePath(uid, staffId, 'valid_id', 'op-1'), `staff_private_documents/${uid}/${staffId}/valid_id/op-1.jpg`);
    for (const args of [[uid, staffId, 'passport', 'op'], ['../uid', staffId, 'valid_id', 'op'], [uid, 'other/staff', 'valid_id', 'op'], [uid, staffId, 'valid_id', 'https://x'], [uid, staffId, 'valid_id', '']]) assert.throws(() => documentFilePath(...args), /Invalid/);
});

test('disabled or incompatible policy blocks reads, device requests and uploads before Storage', async () => {
    for (const config of [{enabled: false, policyVersion: 1}, {enabled: true, policyVersion: 2}]) {
        const h = fixture(); h.put('staff_document_config/current', config);
        await assert.rejects(h.store.records(), /prepared/);
        await assert.rejects(h.store.requestDevice(), /prepared/);
        await assert.rejects(h.store.upload('valid_id', photo(), {}), /prepared/);
        assert.equal(h.calls.uploads, 0); assert.equal(h.docs.has(docPath()), false);
    }
});

for (const initial of ['disabled', 'missing']) test(`the same document store recovers from ${initial} policy after HQ enables it without reloading`, async () => {
    const h = fixture({enabled: false});
    if (initial === 'missing') h.docs.delete('staff_document_config/current');
    let policyReads = 0;
    h.beforeGet(ref => {if (ref.path === 'staff_document_config/current') policyReads++;});
    await assert.rejects(h.store.upload('valid_id', photo(), {}, 0, 'op-enable'), /prepared/);
    assert.equal(h.calls.uploads, 0); assert.equal(h.docs.has(docPath()), false);
    h.put('staff_document_config/current', {enabled: true, policyVersion: 1});
    // Refresh uses this same instance rather than rebuilding Firebase or its auth.
    const refreshed = await h.store.records();
    assert.equal(refreshed.valid_id, null); assert.equal(policyReads, 2);
    assert.equal((await h.store.upload('valid_id', photo(), {}, 0, 'op-enable')).saved, true);
    assert.equal(h.calls.uploads, 1); assert.equal(h.get(docPath()).status, 'pending_review');
    assert.equal(policyReads, 2, 'a successfully enabled policy retains the existing read cache');
});

test('missing, revoked or other-employee binding prevents Staff document reads and uploads', async () => {
    for (const access of [null, {uid, staffId, branch, active: false}, {uid, staffId: 'another-staff', branch, active: true}]) {
        const h = fixture();
        if (!access) h.docs.delete(`staff_document_devices/${uid}`); else h.put(`staff_document_devices/${uid}`, access);
        await assert.rejects(h.store.records(), /approve/);
        await assert.rejects(h.store.upload('valid_id', photo(), {}), /approve/);
        assert.equal(h.calls.uploads, 0);
    }
});

test('a pending device request is idempotent and never grants a private binding', async () => {
    const h = fixture(); h.docs.delete(`staff_document_devices/${uid}`);
    assert.deepEqual(await h.store.requestDevice({deviceId: 'tablet-1', deviceName: 'Phone'}), {requested: true});
    assert.deepEqual(await h.store.requestDevice({deviceId: 'tablet-1', deviceName: 'Phone'}), {alreadyRequested: true});
    assert.equal(h.docs.has(`staff_document_devices/${uid}`), false);
    assert.equal(h.get(`staff_document_requests/${uid}`).status, 'pending');
    await assert.rejects(h.store.records(), /approve/);
});

test('pending requests cannot silently be retargeted to another employee', async () => {
    const h = fixture(); h.docs.delete(`staff_document_devices/${uid}`);
    await h.store.requestDevice(); h.select('staff-2');
    await assert.rejects(h.store.requestDevice(), /another employee/);
    assert.equal(h.get(`staff_document_requests/${uid}`).staffId, staffId);
});

test('upload atomically creates pending metadata and identical immutable-intent history', async () => {
    const h = fixture(), result = await h.store.upload('clearance', photo(), {clearanceType: 'POLICE'}, 0, 'op-first');
    const current = h.get(docPath('clearance')), version = h.get(versionPath('op-first'));
    assert.equal(result.saved, true); assert.deepEqual(current, version);
    assert.equal(current.staffId, staffId); assert.equal(current.branch, branch); assert.equal(current.group, 'clearance');
    assert.equal(current.status, 'pending_review'); assert.equal(current.clearanceType, 'POLICE'); assert.equal(current.version, 1);
    assert.match(current.sha256, /^[a-f0-9]{64}$/);
    assert.equal(current.storagePath, documentFilePath(uid, staffId, 'clearance', 'op-first'));
    assert.equal(h.calls.uploads, 1); assert.equal(JSON.stringify(current).includes('downloadURL'), false);
});

test('lost commit acknowledgement retries without duplicate upload or metadata version increase', async () => {
    const h = fixture(), blob = photo(); h.loseNextAck();
    await assert.rejects(h.store.upload('valid_id', blob, {}, 0, 'op-retry'), /Connection lost/);
    const afterFirst = structuredClone(h.get(docPath()));
    const retry = await h.store.upload('valid_id', blob, {}, 0, 'op-retry');
    assert.equal(retry.alreadySaved, true); assert.deepEqual(h.get(docPath()), afterFirst);
    assert.equal(h.calls.uploads, 1); assert.equal([...h.docs.keys()].filter(path => path.includes('/versions/')).length, 1);
});

test('metadata commit failure resumes the existing same-hash private photo', async () => {
    const h = fixture(), blob = photo(); h.failNextCommit();
    await assert.rejects(h.store.upload('valid_id', blob, {}, 0, 'op-resume'), /Commit rejected/);
    assert.equal(h.docs.has(docPath()), false); assert.equal(h.blobs.size, 1);
    assert.equal((await h.store.upload('valid_id', blob, {}, 0, 'op-resume')).saved, true);
    assert.equal(h.calls.uploads, 1);
});

test('same-operation retry rejects different photo bytes or different document details', async () => {
    const h = fixture(); await h.store.upload('clearance', photo(1), {clearanceType: 'NBI'}, 0, 'op-intent');
    await assert.rejects(h.store.upload('clearance', photo(2), {clearanceType: 'NBI'}, 0, 'op-intent'), /retry does not match/);
    await assert.rejects(h.store.upload('clearance', photo(1), {clearanceType: 'POLICE'}, 0, 'op-intent'), /retry does not match/);
    await assert.rejects(h.store.upload('clearance', photo(1), {clearanceType: 'NBI', expiresOn: '2027-01-01'}, 0, 'op-intent'), /retry does not match/);
    assert.equal(h.get(docPath('clearance')).version, 1); assert.equal(h.calls.uploads, 1);
});

test('replacing a current photo preserves the preceding upload version', async () => {
    const h = fixture(); await h.store.upload('valid_id', photo(1), {}, 0, 'op-old');
    const original = structuredClone(h.get(versionPath('op-old')));
    await h.store.upload('valid_id', photo(2), {}, 1, 'op-new');
    assert.equal(h.get(docPath()).uploadId, 'op-new'); assert.equal(h.get(docPath()).version, 2);
    assert.deepEqual(h.get(versionPath('op-old')), original); assert.equal(h.blobs.size, 2);
});

test('a stale metadata version cannot replace a newer document', async () => {
    const h = fixture(); await h.store.upload('valid_id', photo(), {}, 0, 'op-original');
    await assert.rejects(h.store.upload('valid_id', photo(2), {}, 0, 'op-stale'), /changed/);
    assert.equal(h.get(docPath()).uploadId, 'op-original'); assert.equal(h.docs.has(versionPath('op-stale')), false);
});

test('binding revocation during photo processing prevents metadata publication', async () => {
    const h = fixture(); h.afterUpload(() => h.put(`staff_document_devices/${uid}`, {uid, staffId, branch, active: false}));
    await assert.rejects(h.store.upload('valid_id', photo(), {}, 0, 'op-revoked'), /changed this device/);
    assert.equal(h.docs.has(docPath()), false); assert.equal(h.docs.has(versionPath('op-revoked')), false);
});

test('Staff cannot review and the HQ client cannot use the Staff upload flow', async () => {
    const h = fixture(); await assert.rejects(h.store.review('valid_id', 0, 'approved'), /unavailable/);
    const owner = fixture({hq: true}); await assert.rejects(owner.store.upload('valid_id', photo(), {}), /Staff app/);
    assert.equal(owner.calls.uploads, 0);
});

test('HQ review updates current and history together and appends an immutable scoped audit intent', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(), {}, 0, 'op-reviewed');
    const before = structuredClone(h.get(docPath()));
    await h.store.file(before, decodedPhoto);
    await h.store.review('valid_id', 1, 'approved', 'Clear photo');
    const after = h.get(docPath()), archive = h.get(versionPath('op-reviewed'));
    assert.deepEqual(after, archive); assert.equal(after.status, 'approved'); assert.equal(after.version, 2);
    assert.equal(after.storagePath, before.storagePath); assert.equal(after.sha256, before.sha256); assert.deepEqual(after.uploadedAt, before.uploadedAt);
    const audit = h.get(`staff_private_documents/${staffId}/reviews/${after.reviewId}`);
    assert.equal(audit.staffId, staffId); assert.equal(audit.branch, branch); assert.equal(audit.recordVersion, 2);
    assert.equal(audit.uploadId, 'op-reviewed'); assert.equal(audit.actorUid, uid); assert.equal(audit.status, 'approved');
});

test('stale reviews and unexplained rejections do not write metadata or audit', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(), {}, 0, 'op-review');
    await h.store.file(h.get(docPath()), decodedPhoto);
    await assert.rejects(h.store.review('valid_id', 0, 'approved'), /View or download/);
    await assert.rejects(h.store.review('valid_id', 1, 'rejected', ' '), /reason/);
    assert.equal(h.get(docPath()).version, 1);
    assert.equal([...h.docs.keys()].some(path => path.includes('/reviews/')), false);
});

test('concurrent HQ reviews allow only one revision and preserve one matching audit', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(), {}, 0, 'op-contend');
    await h.store.file(h.get(docPath()), decodedPhoto);
    const results = await Promise.allSettled([h.store.review('valid_id', 1, 'approved'), h.store.review('valid_id', 1, 'rejected', 'Blurry')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(h.get(docPath()).version, 2); assert.equal([...h.docs.keys()].filter(path => path.includes('/reviews/')).length, 1);
});

test('private downloads check the current record and refuse a replaced or forged file path', async () => {
    const h = fixture(); await h.store.upload('valid_id', photo(), {}, 0, 'op-download');
    const original = structuredClone(h.get(docPath()));
    assert.equal((await h.store.file(original)).type, 'image/jpeg'); assert.equal(h.calls.reads, 1);
    await assert.rejects(h.store.file({...original, storagePath: 'https://example.org/public.jpg?token=x'}), /invalid/);
    await h.store.upload('valid_id', photo(2), {}, 1, 'op-replacement');
    await assert.rejects(h.store.file(original), /replaced/); assert.equal(h.calls.reads, 1);
});

test('account/profile changes during metadata reads or downloads do not return private results', async () => {
    const h = fixture(); await h.store.upload('valid_id', photo(), {}, 0, 'op-switch');
    const current = structuredClone(h.get(docPath()));
    h.beforeGet(ref => {if (ref.path === docPath()) h.select('staff-2');});
    await assert.rejects(h.store.records(), /account changed/);
    h.select(staffId); h.beforeGet(ref => {if (ref.path === current.storagePath) h.auth.currentUser = {uid: 'another-device'};});
    await assert.rejects(h.store.file(current), /account changed/);
});

test('invalid clearance, expiry, MIME or oversized photos fail before Storage', async () => {
    const h = fixture();
    await assert.rejects(h.store.upload('clearance', photo(), {clearanceType: 'Other'}), /NBI/);
    await assert.rejects(h.store.upload('valid_id', photo(), {expiresOn: '2026-02-29'}), /expiry/);
    await assert.rejects(h.store.upload('valid_id', new Blob(['x'], {type: 'image/png'}), {}), /photo/);
    await assert.rejects(h.store.upload('valid_id', {type: 'image/jpeg', size: 2097153}, {}), /photo/);
    assert.equal(h.calls.uploads, 0);
});

test('invalid expected versions and reused upload IDs fail before uploading another photo', async () => {
    const h = fixture();
    for (const version of [-1, 1.5, NaN, '0']) await assert.rejects(h.store.upload('valid_id', photo(), {}, version, 'op-bad-version'), /Refresh the profile/);
    assert.equal(h.calls.uploads, 0);
    await h.store.upload('valid_id', photo(), {}, 0, 'op-reuse');
    await assert.rejects(h.store.upload('health_card', photo(), {}, 0, 'op-reuse'), /retry does not match|already used/);
    await h.store.upload('valid_id', photo(2), {}, 1, 'op-latest');
    await assert.rejects(h.store.upload('valid_id', photo(), {}, 2, 'op-reuse'), /already used/);
    assert.equal(h.calls.uploads, 2); assert.equal(h.get(docPath()).uploadId, 'op-latest');
});

test('approval requires a matching private download proof that expires after five minutes', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(), {}, 0, 'op-proof');
    await assert.rejects(h.store.review('valid_id', 1, 'approved'), /View or download/);
    await h.store.file(h.get(docPath()), decodedPhoto); h.advance(300001);
    await assert.rejects(h.store.review('valid_id', 1, 'approved'), /View or download/);
    assert.equal(h.get(docPath()).status, 'pending_review'); assert.equal(h.get(docPath()).version, 1);
});

test('a file with altered bytes or an incorrect recorded SHA cannot establish review proof', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(1), {}, 0, 'op-hash');
    const current = h.get(docPath()), stored = h.blobs.get(current.storagePath);
    stored.blob = photo(2);
    await assert.rejects(h.store.file(current), /does not match/);
    await assert.rejects(h.store.review('valid_id', 1, 'approved'), /View or download/);
    assert.equal(h.get(docPath()).version, 1);
});

test('missing or failed HQ photo decoder cannot establish an approval proof', async () => {
    const h = fixture({hq: true});
    const staffStore = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await staffStore.upload('valid_id', photo(), {}, 0, 'op-decode');
    await assert.rejects(h.store.file(h.get(docPath())), /Open the photo/);
    await assert.rejects(h.store.file(h.get(docPath()), {validatePhoto: async () => {throw Error('JPEG decode failed');}}), /JPEG decode failed/);
    await assert.rejects(h.store.review('valid_id', 1, 'approved'), /View or download/);
    assert.equal(h.get(docPath()).version, 1);
});

test('Staff identity changes during hashing do not return private bytes to another profile', async () => {
    const h = fixture(); await h.store.upload('valid_id', photo(), {}, 0, 'op-hash-switch');
    const digest = crypto.subtle.digest;
    crypto.subtle.digest = async function (...args) {const result = await digest.apply(this, args); h.select('staff-2'); return result;};
    try {await assert.rejects(h.store.file(h.get(docPath())), /account changed/);}
    finally {crypto.subtle.digest = digest;}
});

test('a delayed policy read cannot retarget an operation to a different employee or authenticated UID', async () => {
    for (const action of ['records', 'requestDevice', 'upload', 'file', 'review']) for (const change of ['employee', 'uid']) {
        const h = fixture({hq: action === 'review'});
        // Use another instance to seed a document without warming the store under test.
        if (action === 'file' || action === 'review') {
            const seed = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
            await seed.upload('valid_id', photo(), {}, 0, 'op-policy-seed');
        }
        const before = structuredClone([...h.docs]), uploadsBefore = h.calls.uploads;
        let privateReads = 0;
        h.beforeGet(async ref => {
            if (ref.path.startsWith('staff_private_documents/')) privateReads++;
            if (ref.path === 'staff_document_config/current') {
                await Promise.resolve();
                if (change === 'employee') h.select('staff-2'); else h.auth.currentUser = {uid: 'different-uid'};
            }
        });
        const run = () => action === 'upload' ? h.store.upload('health_card', photo(), {}, 0, 'op-policy')
            : action === 'file' ? h.store.file(h.get(docPath()))
            : action === 'review' ? h.store.review('valid_id', 1, 'rejected', 'Blurry photo') : h.store[action]();
        await assert.rejects(run(), /account changed/, `${action}: ${change}`);
        assert.deepEqual([...h.docs], before); assert.equal(h.calls.uploads, uploadsBefore);
        assert.equal(privateReads, 0, 'do not begin private reads after the delayed policy check changed identity');
    }
});

test('switching employee or UID during byte reading or hashing prevents the first Storage write', async () => {
    for (const boundary of ['bytes', 'digest']) for (const change of ['employee', 'uid']) {
        const h = fixture(), original = photo(), switchIdentity = () => change === 'employee' ? h.select('staff-2') : h.auth.currentUser = {uid: 'different-uid'};
        const blob = boundary === 'bytes' ? {type: original.type, size: original.size, arrayBuffer: async () => {const bytes = await original.arrayBuffer(); switchIdentity(); return bytes;}} : original;
        const digest = crypto.subtle.digest;
        if (boundary === 'digest') crypto.subtle.digest = async function (...args) {const result = await digest.apply(this, args); switchIdentity(); return result;};
        try {await assert.rejects(h.store.upload('valid_id', blob, {}, 0, 'op-hash-race'), /account changed/);}
        finally {crypto.subtle.digest = digest;}
        assert.equal(h.calls.uploads, 0); assert.equal(h.blobs.size, 0); assert.equal(h.docs.has(docPath()), false);
    }
});

test('switching employee or UID during upload-version or Storage-metadata lookup cannot publish file bytes', async () => {
    for (const boundary of ['version', 'metadata']) for (const change of ['employee', 'uid']) {
        const h = fixture(), switchIdentity = () => change === 'employee' ? h.select('staff-2') : h.auth.currentUser = {uid: 'different-uid'};
        if (boundary === 'version') h.beforeGet(async ref => {if (ref.path === versionPath('op-lookup')) {await Promise.resolve(); switchIdentity();}});
        else {
            const metadata = h.sdk.getMetadata;
            h.sdk.getMetadata = async ref => {try {return await metadata(ref);} finally {switchIdentity();}};
        }
        await assert.rejects(h.store.upload('valid_id', photo(), {}, 0, 'op-lookup'), /account changed/);
        assert.equal(h.calls.uploads, 0); assert.equal(h.blobs.size, 0); assert.equal(h.docs.has(docPath()), false);
    }
});

test('a changed identity inside device-request or upload transaction reads prevents every metadata write', async () => {
    for (const action of ['requestDevice', 'upload']) {
        const h = fixture(), transaction = h.sdk.runTransaction;
        h.docs.delete(`staff_document_devices/${uid}`);
        if (action === 'upload') h.put(`staff_document_devices/${uid}`, {uid, staffId, branch, active: true});
        h.sdk.runTransaction = (db, callback) => transaction(db, tx => callback({...tx, get: async ref => {
            const value = await tx.get(ref); h.select('staff-2'); return value;
        }}));
        await assert.rejects(action === 'requestDevice' ? h.store.requestDevice() : h.store.upload('valid_id', photo(), {}, 0, 'op-tx-switch'), /account changed/);
        assert.equal(h.docs.has(`staff_document_requests/${uid}`), false);
        assert.equal(h.docs.has(docPath()), false); assert.equal(h.docs.has(versionPath('op-tx-switch')), false);
        // A file already accepted by Storage before the switch is held as an orphan;
        // it must not become a document for either selected employee.
        assert.equal([...h.docs.keys()].filter(path => path.includes('/files/')).length, 0);
    }
});

test('a changed HQ UID during review transaction reads cannot update the document or create its audit', async () => {
    const h = fixture({hq: true}), seed = createDocumentStore({sdk: h.sdk, db: h.api.db, storage: {}, auth: h.auth, identity: () => staffId});
    await seed.upload('valid_id', photo(), {}, 0, 'op-review-race');
    const before = structuredClone([...h.docs]), transaction = h.sdk.runTransaction;
    h.sdk.runTransaction = (db, callback) => transaction(db, tx => callback({...tx, get: async ref => {
        const value = await tx.get(ref); h.auth.currentUser = {uid: 'different-hq'}; return value;
    }}));
    await assert.rejects(h.store.review('valid_id', 1, 'rejected', 'Unreadable photo'), /account changed/);
    assert.deepEqual([...h.docs], before); assert.equal([...h.docs.keys()].filter(path => path.includes('/reviews/')).length, 0);
});
