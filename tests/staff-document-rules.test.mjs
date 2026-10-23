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
    const profileCreate = body(profile, 'function selectorCashiersCreate('), profileUpdate = body(profile, 'function selectorCashiersUpdate(');
    assert.match(profile, /allow read: if true;/);
    assert.match(profile, /allow create: if selectorCashiersCreate\(request\.resource\.data\);/);
    assert.match(profileCreate, /return isHQUser\(\) && !data\.keys\(\)\.hasAny\(\['rateHistory','onboardingStartConfirmation','contractTerms'\]\)/);
    assert.match(profileCreate, /staffRateProfileLink\(cashierId, \{\}, data\)/);
    assert.match(profile, /allow delete: if isHQUser\(\) && !resource\.data\.keys\(\)\.hasAny\(\['onboardingStartConfirmation','contractTerms'\]\);/);
    assert.match(profileUpdate, /affectedKeys\(\)\.hasAny\(\['onboardingStartConfirmation','contractTerms'\]\)/);
    assert.match(profileUpdate, /onboardingProfileLink\(cashierId,before,data\)/);
    const attendance = body(legacy, 'match /attendance_logs/{logId}');
    const attendanceUpdate = body(attendance, 'function selectorAttendanceLogsUpdate(');
    assert.match(attendance, /allow read: if true;/);
    assert.match(attendance, /allow create: if !request\.resource\.data\.keys\(\)\.hasAny\(\['scheduleAmendmentReview'\]\);/);
    assert.match(attendance, /allow update: if selectorAttendanceLogsUpdate\(request\.resource\.data,resource == null \? null : resource\.data\);/);
    assert.match(attendanceUpdate, /return !data\.diff\(before\)\.affectedKeys\(\)\.hasAny\(\['scheduleAmendmentReview'\]\)/);
    assert.match(attendanceUpdate, /data\.diff\(before\)\.affectedKeys\(\)\.hasOnly\(\['scheduleAmendmentReview'\]\)/);
    assert.match(attendanceUpdate, /amendmentReviewMarker\(data\.scheduleAmendmentReview,before,logId\)/);
    assert.match(attendance, /allow delete: if isHQUser\(\) && !resource\.data\.keys\(\)\.hasAny\(\['scheduleAmendmentReview'\]\);/);
    // Ordinary legacy edits still pass. Only the new audit/history fields add
    // authorization and atomic-link requirements; they must not inherit the
    // preceding unrestricted update grant.
    assert.match(profile, /allow update: if selectorCashiersUpdate\(request\.resource\.data,resource == null \? null : resource\.data\);/);
    assert.match(profileUpdate, /return !data\.diff\(before\)\.affectedKeys\(\)\.hasAny\(\['rateHistory'\]\)/);
    assert.match(profileUpdate, /affectedKeys\(\)\.hasAny\(\['latestRateRaise', 'staffRateAuditId','salaryRateVersion','salaryRateRevision'\]\)/);
    assert.match(profileUpdate, /before\.get\('salaryRateVersion',0\) == 1 && data\.diff\(before\)\.affectedKeys\(\)\.hasAny\(\['hourlyRate','dailyRate','branch'\]\)/);
    assert.match(profileUpdate, /staffRateProfileLink\(cashierId, before, data\)/);
    assert.doesNotMatch(profile, /allow (?:read, )?update: if true/);
    assert.match(legacy, /match \/hq_email_access\/\{email\}[\s\S]*?allow write: if offlineOwner\(\);/);
    assert.match(legacy, /match \/rider_topups\/\{topupId\}/);
});

test('HQ authority requires verified email and protected active permissions plus branch scope', () => {
    const branch = fn('docVaultHQ'), all = fn('docVaultHQAll');
    for (const text of [branch, all]) {
        assert.match(text, /hq_email_access/); assert.match(text, /email_verified/); assert.match(text, /get\('active', false\)/);
        assert.match(text, /get\('permissions', \[\]\)/); assert.match(text, /get\('allowedBranches', \[\]\)/);
        assert.match(text, /let owner = docVaultOwner\(\);/);
        assert.match(text, /let eligible = !owner && isSignedIn\(\)/);
        assert.match(text, /let grant = eligible && exists\(path\) \? get\(path\)\.data : \{\};/);
        assert.match(text, /return owner \|\|/);
        assert.equal((text.match(/\bget\(path\)\.data/g) || []).length, 1, 'Owner fast path must not perform an unconditional HQ grant read');
    }
    assert.match(branch, /hasAny\(\['all', 'branches'\]\)/);
    assert.match(branch, /hasAny\(\['All', branch\]\)/);
    assert.match(all, /'all' in/); assert.match(all, /'All' in/);
    assert.match(fn('docVaultOwn'), /docVaultAnonymous\(\)/);
    assert.match(fn('docVaultOwn'), /staff_document_devices/);
    assert.match(fn('docVaultOwn'), /active == true/);
    assert.match(fn('docVaultOwn'), /staffId == staffId/);
    assert.match(fn('docVaultOwn'), /let present = docVaultAnonymous\(\) && exists\(path\);/);
    assert.match(fn('docVaultOwn'), /let binding = present \? get\(path\)\.data : \{\};/);
    assert.match(fn('docVaultOwn'), /return present && binding\.uid == request\.auth\.uid/);
    const scope = fn('docVaultScope');
    assert.match(scope, /let global = docVaultHQAll\(\);/);
    assert.match(scope, /let present = !global && exists\(path\);/);
    assert.match(scope, /let profile = present \? get\(path\)\.data : \{\};/);
    assert.match(scope, /return global \|\| \(present && profile\.staffId == staffId && docVaultHQ\(profile\.branch\)\)/);
    assert.equal((scope.match(/\bget\(path\)\.data/g) || []).length, 1, 'Owner/HQ-All scope must skip private-profile reads');
});

test('configuration is publicly get-only and pins the v2 broker destination for Owner writes', () => {
    const config = rule('/staff_document_config/{id}'), write = fn('selectorStaffDocumentConfigCreateUpdate'), enabled = fn('docVaultEnabled');
    assert.match(config, /allow get: if id == 'current'/);
    assert.match(config, /allow list, delete: if false/);
    assert.match(config, /allow create, update: if selectorStaffDocumentConfigCreateUpdate\(request\.resource\.data\);/);
    assert.match(write, /return id == 'current' && docVaultOwner\(\)/);
    assert.match(write, /hasOnly\(\['enabled', 'policyVersion', 'brokerEndpoint'\]\)\s*&& data\.enabled is bool && data\.policyVersion == 2\s*&& data\.brokerEndpoint == 'https:\/\/asia-southeast1-takodeal-pos\.cloudfunctions\.net\/staffDocumentBroker';/);
    assert.match(write, /data\.enabled is bool/);
    assert.match(enabled, /let present = exists\(path\);/);
    assert.match(enabled, /let config = present \? get\(path\)\.data : \{\};/);
    assert.match(enabled, /return present && config\.enabled == true/);
    for (const policy of [write, enabled]) {
        assert.match(policy, /policyVersion == 2/);
        assert.match(policy, /brokerEndpoint == 'https:\/\/asia-southeast1-takodeal-pos\.cloudfunctions\.net\/staffDocumentBroker'/);
    }
});

test('pending requests have no private grant and cannot retarget an existing identity', () => {
    const request = rule('/staff_document_requests/{uid}'), valid = fn('docVaultRequest'), update = fn('selectorStaffDocumentRequestsUpdate');
    assert.match(valid, /request.auth.uid == uid/); assert.match(valid, /status == 'pending'/);
    assert.match(valid, /requestedAt == request.time/);
    assert.match(valid, /let eligible = docVaultEnabled\(\) && docVaultAnonymous\(\) && request\.auth\.uid == uid/);
    assert.match(valid, /let present = eligible && exists\(path\);/);
    assert.match(valid, /let binding = present \? get\(path\)\.data : \{\};/);
    assert.match(valid, /return eligible && \(!present \|\| \(binding\.staffId == data\.staffId && binding\.active == false\)\)/);
    assert.match(request, /allow list: if docVaultHQAll\(\)/);
    assert.match(request, /allow create: if docVaultRequest\(uid, request\.resource\.data\);/);
    assert.match(request, /allow update: if selectorStaffDocumentRequestsUpdate\(request\.resource\.data,resource == null \? null : resource\.data\);/);
    assert.match(update, /docVaultRequest\(uid, data\)\s*&& before\.uid == uid && data\.staffId == before\.staffId/);
    assert.match(update, /docVaultHQAll\(\)\s*&& data\.diff\(before\)\.affectedKeys\(\)\.hasOnly\(\['status', 'reviewedAt', 'reviewedByUid', 'reviewNote'\]\)/);
    assert.match(update, /data\.status in \['approved', 'rejected'\]/);
    assert.match(update, /data\.reviewedAt == request\.time && data\.reviewedByUid == request\.auth\.uid/);
    assert.match(update, /getAfter[\s\S]*staff_document_devices[\s\S]*active == true/);
    assert.match(update, /\.data\.staffId == before\.staffId/);
    assert.match(request, /allow delete: if false/);
});

test('only Owner/HQ-All may approve bindings; UID, employee and branch are immutable', () => {
    const device = rule('/staff_document_devices/{uid}'), create = fn('docVaultDeviceCreate'), update = fn('docVaultDeviceUpdate');
    assert.match(device, /allow create: if docVaultDeviceCreate\(request\.resource\.data\);/);
    assert.match(device, /allow update: if docVaultDeviceUpdate\(request\.resource\.data,\s*resource == null \? null : resource\.data\);/);
    assert.match(create, /let eligible = docVaultHQAll\(\) && docVaultBinding\(uid, data\)/);
    assert.match(update, /return docVaultHQAll\(\) && docVaultBinding\(uid, data\)/);
    assert.match(create, /data.active == true && data.approvedAt == request.time/);
    assert.match(create, /data.audit.size\(\) == 1/); assert.match(create, /data.approvedByUid == request.auth.uid/);
    assert.match(create, /let requestPath = \/databases\/\$\(database\)\/documents\/staff_document_requests\/\$\(uid\);/);
    assert.match(create, /let prior = eligible \? get\(requestPath\)\.data : \{\};/);
    assert.match(create, /return eligible && prior\.status == 'pending'\s*&& prior\.staffId == data\.staffId/);
    assert.match(create, /getAfter\(requestPath\)\.data\.status == 'approved'/);
    assert.match(create, /getAfter[\s\S]*staff_private_documents[\s\S]*branch == data.branch/);
    assert.match(update, /data.diff\(before\).affectedKeys\(\).hasOnly\(\['active', 'updatedAt', 'updatedByUid', 'audit'\]\)/);
    assert.match(update, /data.audit.diff\(before.audit\).changedKeys\(\).size\(\) == 0/);
    assert.match(update, /data.audit.diff\(before.audit\).removedKeys\(\).size\(\) == 0/);
    assert.match(update, /data.audit.diff\(before.audit\).addedKeys\(\).size\(\) == 1/); assert.match(device, /allow delete: if false/);
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
    const fileCreate = fn('docVaultFileCreate'), fileUpdate = fn('docVaultFileUpdate'), versionCreate = fn('docVaultVersionCreate'), versionUpdate = fn('docVaultVersionUpdate'), auditCreate = fn('docVaultAuditCreate');
    assert.match(files, /allow create: if docVaultFileCreate\(request\.resource\.data\);/);
    assert.match(files, /allow update: if docVaultFileUpdate\(request\.resource\.data,\s*resource == null \? null : resource\.data\);/);
    assert.match(versions, /allow create: if docVaultVersionCreate\(request\.resource\.data\);/);
    assert.match(versions, /allow update: if docVaultVersionUpdate\(request\.resource\.data,\s*resource == null \? null : resource\.data\);/);
    assert.match(audits, /allow create: if docVaultAuditCreate\(request\.resource\.data\);/);
    assert.match(fileCreate, /docVaultUpload\(staffId, kind, data\)/); assert.match(fileCreate, /data.version == 1/);
    assert.match(fileUpdate, /data.version == before.version \+ 1/); assert.match(fileUpdate, /data.uploadId != before.uploadId/);
    assert.match(fileUpdate, /docVaultReview\(staffId, kind, before, data\)/);
    for (const policy of [fileCreate, fileUpdate]) assert.match(policy, /getAfter[\s\S]*\/versions\//);
    assert.match(versionCreate, /docVaultUpload\(staffId, data.group, data\)/); assert.match(versionCreate, /uploadId == data.uploadId/);
    assert.match(versionUpdate, /docVaultReview\(staffId, before.group, before, data\)/); assert.match(versionUpdate, /uploadId == before.uploadId/);
    for (const policy of [versionCreate, versionUpdate]) assert.match(policy, /getAfter[\s\S]*\/files\//);
    assert.match(review, /getAfter[\s\S]*\/reviews\/\$\(after.reviewId\)/);
    assert.match(review, /affectedKeys\(\).hasOnly/); assert.match(review, /after.version == before.version \+ 1/);
    assert.match(review, /audit.recordVersion == after.version/); assert.match(review, /audit.actorUid == request.auth.uid/);
    assert.match(auditCreate, /getAfter[\s\S]*reviewId == reviewId/);
    assert.match(auditCreate, /let saved = eligible \? getAfter\(\/databases\/\$\(database\)\/documents\/staff_private_documents\/\$\(staffId\)\/files\/\$\(data\.group\)\)\.data : \{\};/);
    assert.match(auditCreate, /return eligible && saved\.reviewId == reviewId\s*&& saved\.version == data\.recordVersion\s*&& saved\.branch == data\.branch\s*&& saved\.uploadId == data\.uploadId/);
    assert.match(auditCreate, /data.staffId == staffId && docVaultHQ\(data.branch\)/);
    assert.match(auditCreate, /data.actorUid == request.auth.uid && data.recordedAt == request.time/);
    assert.match(audits, /allow update, delete: if false/);
    for (const text of [files, versions]) assert.match(text, /allow delete: if false/);
});

test('Storage candidate excludes every private-prefix path from the legacy public fallback', () => {
    const fallback = body(storage, 'match /{topLevel}/{rest=**}');
    assert.match(fallback, /allow read, write: if topLevel != 'staff_private_documents'/);
    assert.equal(/match \/\{allPaths=\*\*\}/.test(storage), false);
    const privateFiles = body(storage, 'match /staff_private_documents/{rest=**}').replace(/\/\/[^\n]*/g, '').trim();
    assert.equal(privateFiles, 'allow read, write: if false;');
});

test('Storage has no signed-in, cross-service or token-generation exception for private bytes', () => {
    const policy = storage.replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(policy, /request\.auth|firestore\.(?:get|exists)|function\s/);
    assert.equal((policy.match(/allow\s/g) || []).length, 2);
    assert.doesNotMatch(policy, /getDownloadURL|firebaseStorageDownloadTokens/);
});
