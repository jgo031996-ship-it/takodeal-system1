import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Structural policy regression checks, NOT a Firebase Rules interpreter. A real
// emulator/Rules compile and unauthorized access tests remain release prerequisites.
const firestore = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../docs/staff-document-storage.rules.snippet', import.meta.url), 'utf8');
const marker = '// Private Staff document vault.';
const vault = firestore.slice(firestore.indexOf(marker));
function body(source, declaration) {
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, `Missing declaration ${declaration}`);
    const open = source.indexOf('{', start + declaration.length);
    let depth = 1, quote = null, lineComment = false;
    for (let i = open + 1; i < source.length; i++) {
        const c = source[i], next = source[i + 1];
        if (lineComment) {if (c === '\n') lineComment = false; continue;}
        if (quote) {if (c === '\\') i++; else if (c === quote) quote = null; continue;}
        if (c === '/' && next === '/') {lineComment = true; i++; continue;}
        if (c === "'" || c === '"') {quote = c; continue;}
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return source.slice(open + 1, i);
    }
    throw Error(`Unbalanced block ${declaration}`);
}
const rule = path => body(vault, `match ${path}`);
const fn = name => body(vault, `function ${name}(`);

test('private vault has explicit nonoverlapping collection blocks and no public wildcard', () => {
    assert.notEqual(firestore.indexOf(marker), -1);
    assert.equal(/isHQUser\(|\/cashiers\/|\/branches\/|\/settings\//.test(vault.replace(/\/\/[^\n]*/g, '')), false);
    for (const path of ['/staff_document_config/{id}', '/staff_document_requests/{uid}', '/staff_document_devices/{uid}', '/staff_private_documents/{staffId}', '/files/{kind}', '/versions/{uploadId}', '/reviews/{reviewId}']) assert.ok(rule(path).length);
    assert.equal(/match \/\{document=\*\*\}/.test(vault), false);
    assert.equal(/allow (?:read|write): if true/.test(vault), false);
});

test('legacy operational authority remains while new rate metadata is protected', () => {
    const legacy = firestore.slice(0, firestore.indexOf(marker));
    const profile = body(legacy, 'match /cashiers/{cashierId}');
    assert.match(profile, /allow read: if true;/);
    assert.match(profile, /allow create: if isHQUser\(\)/);
    assert.match(profile, /allow delete: if isHQUser\(\);/);
    // Ordinary legacy edits still pass. Only the new audit/history fields add
    // authorization and atomic-link requirements; they must not inherit the
    // preceding unrestricted update grant.
    assert.match(profile, /allow update: if !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['rateHistory'\]\)/);
    assert.match(profile, /!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['latestRateRaise', 'staffRateAuditId'\]\)/);
    assert.match(profile, /staffRateProfileLink\(cashierId, resource\.data, request\.resource\.data\)/);
    assert.doesNotMatch(profile, /allow (?:read, )?update: if true/);
    assert.match(legacy, /match \/hq_email_access\/\{email\}[\s\S]*?allow write: if offlineOwner\(\);/);
    assert.match(legacy, /match \/rider_topups\/\{topupId\}/);
});

test('HQ authority requires verified email and protected active permissions plus branch scope', () => {
    const branch = fn('docVaultHQ'), all = fn('docVaultHQAll');
    for (const text of [branch, all]) {
        assert.match(text, /hq_email_access/); assert.match(text, /email_verified/); assert.match(text, /get\('active', false\)/);
        assert.match(text, /get\('permissions', \[\]\)/); assert.match(text, /get\('allowedBranches', \[\]\)/);
    }
    assert.match(branch, /hasAny\(\['all', 'branches'\]\)/);
    assert.match(branch, /hasAny\(\['All', branch\]\)/);
    assert.match(all, /'all' in/); assert.match(all, /'All' in/);
    assert.match(fn('docVaultOwn'), /docVaultAnonymous\(\)/);
    assert.match(fn('docVaultOwn'), /staff_document_devices/);
    assert.match(fn('docVaultOwn'), /active == true/);
    assert.match(fn('docVaultOwn'), /staffId == staffId/);
});

test('configuration is publicly get-only, bounded to the enable flag, and owner-write-only', () => {
    const config = rule('/staff_document_config/{id}');
    assert.match(config, /allow get: if id == 'current'/);
    assert.match(config, /allow list, delete: if false/);
    assert.match(config, /docVaultOwner\(\)/);
    assert.match(config, /hasOnly\(\['enabled', 'policyVersion'\]\)/);
    assert.match(config, /policyVersion == 1/);
});

test('pending requests have no private grant and cannot retarget an existing identity', () => {
    const request = rule('/staff_document_requests/{uid}'), valid = fn('docVaultRequest');
    assert.match(valid, /request.auth.uid == uid/); assert.match(valid, /status == 'pending'/);
    assert.match(valid, /requestedAt == request.time/); assert.match(valid, /data.active == false/);
    assert.match(request, /allow list: if docVaultHQAll\(\)/);
    assert.match(request, /request.resource.data.staffId == resource.data.staffId/);
    assert.match(request, /getAfter[\s\S]*staff_document_devices[\s\S]*active == true/);
    assert.match(request, /allow delete: if false/);
});

test('only Owner/HQ-All may approve bindings; UID, employee and branch are immutable', () => {
    const device = rule('/staff_document_devices/{uid}');
    assert.match(device, /allow create: if docVaultHQAll\(\)/);
    assert.match(device, /approvedAt == request.time/);
    assert.match(device, /getAfter[\s\S]*staff_document_requests[\s\S]*status == 'approved'/);
    assert.match(device, /getAfter[\s\S]*staff_private_documents[\s\S]*branch == request.resource.data.branch/);
    assert.match(device, /affectedKeys\(\).hasOnly\(\['active', 'updatedAt', 'updatedByUid', 'audit'\]\)/);
    assert.match(device, /changedKeys\(\).size\(\) == 0/); assert.match(device, /removedKeys\(\).size\(\) == 0/);
    assert.match(device, /addedKeys\(\).size\(\) == 1/); assert.match(device, /allow delete: if false/);
    assert.match(fn('docVaultBinding'), /audit.values\(\).hasAny\(\[\{'active': data.active, 'actorUid': request.auth.uid, 'recordedAt': request.time\}\]\)/);
});

test('staff metadata must match binding, exact path, SHA, pending status, bytes and timestamp', () => {
    const upload = fn('docVaultUpload');
    assert.match(upload, /docVaultEnabled\(\)/); assert.match(upload, /docVaultOwn\(staffId\)/);
    assert.match(upload, /data.branch == get\([\s\S]*staff_document_devices[\s\S]*data.branch/); assert.match(upload, /data.uploadedByUid == request.auth.uid/);
    assert.match(upload, /data.storagePath == 'staff_private_documents\/'/);
    assert.match(upload, /data.contentType == 'image\/jpeg'/); assert.match(upload, /data.size <= 2097152/);
    assert.match(upload, /data.sha256.matches\('\^\[a-f0-9\]\{64\}\$'\)/);
    assert.match(upload, /data.status == 'pending_review'/); assert.match(upload, /data.uploadedAt == request.time/);
    assert.match(upload, /data.clearanceType in \['NBI', 'POLICE'\]/);
    assert.match(upload, /keys\(\).hasOnly/);
});

test('current/history uploads and HQ reviews are atomic with version checks and no deletes', () => {
    const files = rule('/files/{kind}'), versions = rule('/versions/{uploadId}'), review = fn('docVaultReview'), audits = rule('/reviews/{reviewId}');
    assert.match(files, /version == resource.data.version \+ 1/);
    assert.match(files, /uploadId != resource.data.uploadId/);
    assert.match(files, /getAfter[\s\S]*\/versions\//); assert.match(versions, /getAfter[\s\S]*\/files\//);
    assert.match(review, /getAfter[\s\S]*\/reviews\/\$\(after.reviewId\)/);
    assert.match(review, /affectedKeys\(\).hasOnly/); assert.match(review, /after.version == before.version \+ 1/);
    assert.match(review, /audit.recordVersion == after.version/); assert.match(review, /audit.actorUid == request.auth.uid/);
    assert.match(audits, /getAfter[\s\S]*reviewId == reviewId/);
    assert.match(audits, /allow update, delete: if false/);
    for (const text of [files, versions]) assert.match(text, /allow delete: if false/);
});

test('Storage candidate excludes every private-prefix path from the legacy public fallback', () => {
    const fallback = body(storage, 'match /{topLevel}/{rest=**}');
    assert.match(fallback, /allow read, write: if topLevel != 'staff_private_documents'/);
    assert.equal(/match \/\{allPaths=\*\*\}/.test(storage), false);
    const privateFiles = body(storage, 'match /staff_private_documents/{uid}/{staffId}/{documentGroup}/{filename}');
    assert.match(privateFiles, /allow get:/); assert.match(privateFiles, /owner\(\) \|\| ownEmployee\(staffId\) \|\| hqForUploader\(uid, staffId\)/);
    assert.match(privateFiles, /allow list, update, delete: if false/);
    assert.match(privateFiles, /allow create: if resource == null && anonymous\(\) && request.auth.uid == uid/);
    assert.match(privateFiles, /enabled\(\) && ownEmployee\(staffId\)/);
    assert.match(privateFiles, /size <= 2097152/); assert.match(privateFiles, /contentType == 'image\/jpeg'/);
    assert.match(privateFiles, /metadata.size\(\) == 4/);
    assert.match(privateFiles, /metadata.keys\(\).hasAll\(\['staffId', 'documentGroup', 'uploadId', 'sha256'\]\)/);
    assert.equal(/allow write:/.test(privateFiles), false);
});

test('Storage cross-service lookups are confined to two distinct documents per authorized flow', () => {
    const own = body(storage, 'function ownEmployee('), enabled = body(storage, 'function enabled('), hq = body(storage, 'function hqForUploader(');
    assert.match(own, /staff_document_devices\/\$\(uid\)/);
    assert.match(enabled, /staff_document_config\/current/);
    assert.match(hq, /hq_email_access\/\$\(email\)/); assert.match(hq, /staff_document_devices\/\$\(uid\)/);
    for (const text of [own, enabled, hq]) assert.equal(/cashiers|settings|staff_private_documents/.test(text), false);
    assert.equal((hq.match(/let .* = \/databases\//g) || []).length, 2);
    assert.equal(/getDownloadURL|tokenURL|firebaseStorageDownloadTokens/.test(storage), false);
});
