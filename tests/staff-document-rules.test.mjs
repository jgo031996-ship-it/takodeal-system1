import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenizeRules} from '../tools/build-firestore-rules.mjs';

// Structural policy regression checks, NOT a Firebase Rules interpreter. A real
// emulator/Rules compile and unauthorized access tests remain release prerequisites.
const firestore = readFileSync(new URL('../firestore.policy.rules', import.meta.url), 'utf8');
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
const rule = path => expandVerifiedAliases(body(vault, `match ${path}`));
// The size-limited production Rules share transparent selectors/readers. Pin
// their entire bodies before expanding calls for the existing predicate checks;
// an altered actor, timestamp, read method or document path must still fail.
function expandVerifiedAliases(source) {
    const aliases = {
        reqUid: 'return request.auth.uid;',
        reqEmail: 'return request.auth.token.email;',
        reqTime: 'return request.time;',
        readData: 'return get(/databases/$(database)/documents/$(collectionName)/$(recordId)).data;',
        nextData: 'return getAfter(/databases/$(database)/documents/$(collectionName)/$(recordId)).data;',
        newData: 'return request.resource.data;',
        oldData: 'return resource.data;',
        reqProvider: 'return request.auth.token.firebase.sign_in_provider;',
        reqVerified: "return request.auth.token.get('email_verified', false);",
        paidKeys: "return ['paidAt','payrollRecordId','partialPaid','amountPaid','payrollFrozen'];",
        inactiveStaff: "return ['Blocked', 'Revoked', 'Terminated', 'Resigned', 'Inactive', 'Disabled', 'Archived', 'Deleted'];",
        rateKeys: "return ['latestRateRaise', 'staffRateAuditId','salaryRateVersion','salaryRateRevision'];",
        privatePoKeys: "return ['dispatchInvoice','deliveryReceipt','supplyInvoice','requestedByEmail'];"
    };
    for (const [name, expected] of Object.entries(aliases)) {
        assert.equal((firestore.match(new RegExp(`\\bfunction ${name}\\(`, 'g')) || []).length, 1, `${name} must not be shadowed`);
        assert.equal(body(firestore, `function ${name}(`).trim(), expected, `${name} must remain a transparent selector`);
        if (!['readData', 'nextData'].includes(name)) assert.match(firestore, new RegExp(`\\bfunction ${name}\\(\\)`));
    }
    assert.match(firestore, /function readData\(collectionName,recordId\)/);
    assert.match(firestore, /function nextData\(collectionName,recordId\)/);
    let expanded = source;
    for (const [name, expected] of Object.entries(aliases)) {
        if (!['readData', 'nextData'].includes(name)) expanded = expanded.replace(new RegExp(`\\b${name}\\(\\)`, 'g'), expected.slice('return '.length, -1));
    }
    expanded = expanded.replace(/\b(readData|nextData)\('([A-Za-z0-9_]+)',\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\)/g,
        (_, helper, collection, id) => `${helper === 'readData' ? 'get' : 'getAfter'}(/databases/$(database)/documents/${collection}/$(${id})).data`);
    expanded = expanded.replace(/\breadData\('staff_pin_contexts',request\.auth\.uid \+ '_time-clock'\)/g,
        "get(/databases/$(database)/documents/staff_pin_contexts/$(request.auth.uid + '_time-clock')).data");
    assert.doesNotMatch(expanded, new RegExp(`\\b(?:${Object.keys(aliases).join('|')})\\(`),
        'A changed helper call must be reviewed instead of silently omitted from the policy checks');
    return expanded;
}
const fn = name => expandVerifiedAliases(body(vault, `function ${name}(`));

test('private vault has explicit nonoverlapping collection blocks and no public wildcard', () => {
    assert.notEqual(firestore.indexOf(marker), -1);
    assert.equal(/isHQUser\(|\/cashiers\/|\/branches\/|\/settings\//.test(vault.replace(/\/\/[^\n]*/g, '')), false);
    for (const path of ['/staff_document_config/{id}', '/staff_document_requests/{uid}', '/staff_document_devices/{uid}', '/staff_private_documents/{staffId}', '/files/{kind}', '/versions/{uploadId}', '/reviews/{reviewId}']) assert.ok(rule(path).length);
    assert.equal(/match \/\{document=\*\*\}/.test(vault), false);
    assert.equal(/allow (?:read|write): if true/.test(vault), false);
});

test('private staff and attendance access retains audited wage, onboarding and reviewed-attendance protection', () => {
    const legacy=firestore.slice(0,firestore.indexOf(marker)),profile=expandVerifiedAliases(body(legacy,'match /cashiers/{cashierId}'));
    const create=body(profile,'function selectorCashiersCreate('),update=body(profile,'function selectorCashiersUpdate(');
    assert.doesNotMatch(profile,/allow read: if true/);
    assert.match(profile,/companyHRRead\(resource.data\)/);assert.match(profile,/companyPrivateProfile\(cashierId\)/);
    assert.match(create,/companyHQCan\(\['all','branches'\],data.branch\)/);
    for(const key of ['rateHistory','onboardingStartConfirmation','contractTerms','payslipPinManaged','payslipPinVersion','loginPinVersion'])assert.ok(create.includes("'"+key+"'"));
    assert.match(create,/staffRateProfileLink\(cashierId, \{\}, data\)/);
    assert.match(update,/companyProfileEdit\(cashierId,before,data\)/);
    assert.match(update,/companyHQCan\(\['all','branches'\],before.branch\) && companyHQCan\(\['all','branches'\],data.branch\)/);
    assert.match(update,/before.get\('payslipPinManaged',false\) != true \|\| !data.diff\(before\).affectedKeys\(\).hasAny\(\['payslipPin'\]\)/);
    assert.match(update,/onboardingProfileLink\(cashierId,before,data\)/);assert.match(update,/staffRateProfileLink\(cashierId, before, data\)/);
    assert.match(update,/before.get\('salaryRateVersion',0\) == 1/);
    const attendance=expandVerifiedAliases(body(legacy,'match /attendance_logs/{logId}')),review=body(attendance,'function selectorAttendanceLogsUpdate(');
    assert.doesNotMatch(attendance,/allow (?:read|create): if true/);
    assert.match(attendance,/allow list: if companyOperationalRead\(resource.data\)/);
    assert.match(attendance,/companyOperationalCreate\(request.resource.data\)/);
    assert.match(attendance,/allow update: if companyOperationalHQ\(resource.data\) && companyOperationalHQ\(request.resource.data\)/);
    assert.match(attendance,/reliefOriginalSourceUnchanged\(request.resource.data,resource.data\)/);
    assert.match(review,/hasOnly\(\['scheduleAmendmentReview'\]\)/);assert.match(review,/amendmentReviewMarker/);
    assert.doesNotMatch(review,/reliefReviewMarker/);
    assert.match(body(attendance,'function reliefOriginalSourceUnchanged('),/'timestamp','type','staffId','staffName','branch','timeInLogId','timeInAt','scheduleSnapshot','status','deleted'/);
    assert.match(attendance,/allow delete: if companyOperationalHQ\(resource.data\)/);assert.match(attendance,/!reliefLinkedOut\(resource.data\)/);
    const relief=body(legacy,'match /attendance_relief_reviews/{auditId}');assert.match(relief,/allow write: if false/);
});

test('legacy wildcard is deny-gated before scoped business grants and excludes separately protected staff and Rider collections',()=>{
    const roots=['account_logs','archived_months','bom','branches','budgets','cash_accounts','customer_app_categories','daily_metrics','dispatch_logs','equipment_assets','expenses','foodpanda_payouts','franchise_accounts','franchise_budgets','franchise_comms','franchise_ledger','global_addons','grab_payouts','hq_restocks','inventory','manager_alerts','menu','parked_orders','payables','pos_devices','shifts','stock_logs','suppliers','yield_logs'];
    assert.equal(body(firestore,'function legacyCandidate(').trim(),"return root.matches('^("+roots.join('|')+")$');");
    for(const denied of ['cashiers','staff_requests','staff_ledger','staff_bonuses','shift_swaps','sop_logs','riders','rider_topups','settings','hr_sanctions'])assert.ok(!roots.includes(denied));
    const flat=body(firestore,'match /{legacyCollection}/{legacyDocument}');
    assert.match(flat,/allow read: if legacyCandidate\(legacyCollection\) && companyBusinessRead\(legacyCollection,oldData\(\)\)/);
    assert.match(flat,/allow create: if legacyCandidate\(legacyCollection\) && companyBusinessCreate\(legacyCollection,newData\(\)\) && staffSetupCreateAllowed/);
    assert.match(flat,/allow update: if legacyCandidate\(legacyCollection\) && companyBusinessUpdate\(legacyCollection,oldData\(\),newData\(\)\) && staffSetupExistingAllowed/);
    assert.match(flat,/allow delete: if legacyCandidate\(legacyCollection\) && \(companyBusinessHQ/);
    assert.match(body(firestore,'function companyBusinessUpdate('),/branch == data.get/);
    assert.match(body(firestore,'match /{legacyTree}/{legacyTail=**}'),/legacyCandidate\(legacyTree\).*isHQUser\(\)/);
    const remit=body(firestore,'match /remittances/{remittanceId}');assert.doesNotMatch(remit,/allow read: if true/);assert.match(remit,/mallHandover\(newData\(\)\)/);assert.doesNotMatch(remit,/allow (?:update|delete|write)/);
    const counts=body(firestore,'match /stock_counts/{id}');assert.doesNotMatch(counts,/allow (?:get|read|create): if true/);
    assert.match(counts,/resource == null \? isHQUser\(\) \|\| ownTrustedDevice\(\) : stockCountReader/);
    assert.match(counts,/allow create: if \(isOwner\(\) \|\| trustedPOS/);assert.match(counts,/stockAuditSourceCreate\(newData\(\),id\)/);
    assert.match(counts,/allow update: if companyHQCan/);assert.match(counts,/oldData\(\).get\('version',0\) != 3 && newData\(\).get\('version',0\) != 3/);
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
    assert.match(request, /^[ \t]*allow read: if \(request\.method == 'get' && isSignedIn\(\) && request\.auth\.uid == uid\) \|\| docVaultHQAll\(\);[ \t]*$/m);
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

test('Storage fallback excludes private namespaces, never grants public writes and private document bytes remain broker-only',()=>{
    const fallback=body(storage,'match /{topLevel}/{rest=**}');
    assert.doesNotMatch(fallback,/allow (?:read, )?write: if .*!= 'staff_private_documents'/);
    for(const prefix of ['staff_private_documents','staff_requests','staff_profiles','riders','deliveries'])assert.ok(fallback.includes("'"+prefix+"'"));
    assert.match(fallback,/allow update, delete: if false/);
    const bytes=body(storage,'match /staff_private_documents/{rest=**}').replace(/\/\/[^\n]*/g,'').trim();
    assert.equal(bytes,'allow read, write: if false;');
});

test('Storage uploads require immutable bounded images and never generate a private document download token',()=>{
    const policy=storage.replace(/\/\/[^\n]*/g,'');
    assert.match(body(storage,'function image('),/resource == null/);assert.match(body(storage,'function image('),/request.resource.size/);
    assert.match(body(storage,'function owner('),/email_verified/);assert.match(body(storage,'function owner('),/google.com/);
    assert.doesNotMatch(policy,/getDownloadURL|firebaseStorageDownloadTokens/);
});
