import test from 'node:test';
import assert from 'node:assert/strict';
import {DOCUMENT_GROUPS, CLEARANCE_TYPES, MAX_INPUT_BYTES, MAX_UPLOAD_BYTES,
    validDocumentDay, philippineDocumentDay, detectDocumentContentType, validateDocumentFile,
    validateDocumentDraft, validPrivateDocumentPath, validateDocumentRecord, documentState, documentSummary} from '../takodeal-staff/staff-document-model.js';

const today = '2026-10-07';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const file = (type, bytes) => ({type, size: bytes.length, name: 'photo.jpg'});
const record = (group, extra = {}) => ({group, status: 'pending_review', storagePath: `staff_documents/uid/${group}/version.png`, contentType: 'image/png', size: png.length,
    ...(group === 'clearance' ? {clearanceType: 'NBI'} : {}), ...extra});

test('exactly three document groups require either NBI or Police for the clearance group', () => {
    assert.deepEqual(DOCUMENT_GROUPS, ['valid_id', 'health_card', 'clearance']);
    assert.deepEqual(CLEARANCE_TYPES, ['NBI', 'POLICE']);
    assert.equal(validateDocumentDraft({group: 'clearance'}, today).valid, false);
    assert.equal(validateDocumentDraft({group: 'clearance', clearanceType: 'Barangay'}, today).valid, false);
    assert.equal(validateDocumentDraft({group: 'clearance', clearanceType: ' police '}, today).clearanceType, 'POLICE');
    assert.equal(validateDocumentDraft({group: 'nbi'}, today).valid, false);
});

test('expiry dates are optional and no document receives an invented expiry interval', () => {
    for (const group of DOCUMENT_GROUPS) {
        const draft = validateDocumentDraft({group, clearanceType: 'NBI'}, today);
        assert.equal(draft.valid, true);
        assert.equal(draft.expiresOn, null);
        assert.equal(documentState(group, record(group, {status: 'approved'}), '2029-12-31').code, 'approved');
    }
});

test('real date validation rejects invalid calendar days and accepts leap years', () => {
    for (const day of ['2026-02-29', '2026-04-31', '2026-00-01', '2026-10-00', '2026-13-01', '26-10-07', ' 2026-10-07', '0000-01-01']) assert.equal(validDocumentDay(day), false);
    assert.equal(validDocumentDay('2028-02-29'), true);
    assert.equal(validateDocumentDraft({group: 'valid_id', expiresOn: '2026-02-29'}, today).valid, false);
    assert.throws(() => philippineDocumentDay('2026-02-29'), /Invalid/);
});

test('expiry remains valid through its Philippine day and changes at midnight', () => {
    const doc = record('health_card', {status: 'approved', expiresOn: today});
    assert.equal(philippineDocumentDay('2026-10-07T15:59:59.999Z'), today);
    assert.equal(documentState('health_card', doc, '2026-10-07T15:59:59.999Z').code, 'approved');
    assert.equal(philippineDocumentDay('2026-10-07T16:00:00Z'), '2026-10-08');
    assert.equal(documentState('health_card', doc, '2026-10-07T16:00:00Z').code, 'expired');
});

test('missing photos are urgent red reminders for all three groups', () => {
    const summary = documentSummary({}, today);
    assert.equal(summary.urgentCount, 3);
    assert.equal(summary.uploadedCount, 0);
    assert.equal(summary.tone, 'danger');
    assert.equal(summary.allUploaded, false);
    for (const item of summary.items) { assert.equal(item.code, 'missing'); assert.equal(item.needsUpload, true); assert.equal(item.needsReview, false); }
});

test('uploaded pending photos are amber review items and stop the upload urgency', () => {
    const summary = documentSummary(Object.fromEntries(DOCUMENT_GROUPS.map(group => [group, record(group)])), today);
    assert.equal(summary.urgentCount, 0);
    assert.equal(summary.reviewCount, 3);
    assert.equal(summary.uploadedCount, 3);
    assert.equal(summary.tone, 'warning');
    assert.equal(summary.allUploaded, true);
    assert.equal(summary.allApproved, false);
    for (const item of summary.items) { assert.equal(item.needsUpload, false); assert.equal(item.urgent, false); assert.equal(item.complete, false); }
});

test('mixed documents count urgent uploads independently from pending HQ reviews', () => {
    const summary = documentSummary({valid_id: record('valid_id', {status: 'approved'}), health_card: record('health_card'), clearance: record('clearance', {status: 'rejected'})}, today);
    assert.equal(summary.urgentCount, 1);
    assert.equal(summary.reviewCount, 1);
    assert.equal(summary.approvedCount, 1);
    assert.equal(summary.allUploaded, false);
    assert.equal(summary.items[2].code, 'rejected');
    assert.equal(summary.items[2].tone, 'danger');
});

test('expired photos remain urgent even if they await review or were approved', () => {
    for (const status of ['pending_review', 'approved', 'rejected']) {
        const result = documentState('valid_id', record('valid_id', {status, expiresOn: '2026-10-06'}), today);
        assert.equal(result.code, 'expired'); assert.equal(result.urgent, true); assert.equal(result.needsUpload, true);
    }
    assert.equal(validateDocumentDraft({group: 'valid_id', expiresOn: '2026-10-06'}, today).warnings.length, 1);
});

test('all three current approvals are complete, without conflating upload with approval', () => {
    const summary = documentSummary(Object.fromEntries(DOCUMENT_GROUPS.map(group => [group, record(group, {status: 'approved'})])), today);
    assert.equal(summary.allApproved, true); assert.equal(summary.approvedCount, 3); assert.equal(summary.tone, 'success');
});

test('unknown status, wrong group, missing file, invalid expiry or clearance never appears approved', () => {
    for (const extra of [{status: 'uploaded'}, {group: 'health_card'}, {storagePath: ''}, {expiresOn: '2026-11-31'}, {contentType: 'text/html'}, {size: 0}, {size: MAX_UPLOAD_BYTES + 1}]) {
        const result = documentState('valid_id', record('valid_id', {status: 'approved', ...extra}), today);
        assert.equal(result.code, 'invalid'); assert.equal(result.complete, false); assert.equal(result.urgent, true);
    }
    assert.equal(documentState('clearance', record('clearance', {status: 'approved', clearanceType: null}), today).code, 'invalid');
    assert.equal(documentState('clearance', record('clearance', {clearanceType: 'POLICE'}), today).code, 'pending_review');
    assert.equal(documentState('unknown', null, today).code, 'invalid');
});

test('relative storage paths are accepted but public/token URLs and traversal are rejected', () => {
    assert.equal(validPrivateDocumentPath('staff_documents/uid/valid_id/abc.png'), true);
    for (const path of ['https://example.org/private.png?token=abc', 'gs://bucket/photo.png', '/photo.png', 'photo.png?token=abc', 'photo.png#x', 'dir/../photo.png', 'dir/%2e%2e/photo.png', 'dir//photo.png', 'dir\\photo.png', 'dir/\nphoto.png']) assert.equal(validPrivateDocumentPath(path), false);
    for (const key of ['downloadURL', 'downloadUrl', 'url', 'publicUrl', 'token', 'profilePicUrl']) {
        const result = validateDocumentRecord('valid_id', record('valid_id', {[key]: 'secret-link'}), today);
        assert.equal(result.valid, false);
    }
});

test('JPEG, PNG and WebP signatures are accepted; PDF, SVG and HTML are rejected', () => {
    for (const [type, bytes] of [['image/png', png], ['image/jpeg', jpeg], ['image/webp', webp]]) {
        assert.equal(detectDocumentContentType(bytes), type);
        const result = validateDocumentFile(file(type, bytes), {bytes, requireSignature: true});
        assert.equal(result.valid, true); assert.equal(result.signatureVerified, true);
    }
    for (const [type, text] of [['application/pdf', '%PDF-1.7'], ['image/svg+xml', '<svg></svg>'], ['text/html', '<html>']]) {
        const bytes = new TextEncoder().encode(text);
        assert.equal(detectDocumentContentType(bytes), null);
        assert.equal(validateDocumentFile(file(type, bytes), {bytes}).valid, false);
    }
});

test('spoofed MIME, incomplete reads and unsupported byte containers fail before upload', () => {
    assert.equal(validateDocumentFile(file('image/png', jpeg), {bytes: jpeg}).valid, false);
    assert.equal(validateDocumentFile({...file('image/png', png), size: png.length + 1}, {bytes: png}).valid, false);
    assert.equal(validateDocumentFile(file('image/png', png), {bytes: []}).valid, false);
    assert.equal(validateDocumentFile(file('image/png', png), {requireSignature: true}).valid, false);
    assert.equal(validateDocumentFile(file('image/png', png), {bytes: png.buffer}).valid, true);
    assert.equal(validateDocumentFile(file('image/png', png), {bytes: new DataView(png.buffer)}).valid, true);
});

test('input permits 10 MiB but the normalized stored photo is limited to 2 MiB', () => {
    assert.equal(validateDocumentFile({type: 'image/png', size: MAX_INPUT_BYTES}).valid, true);
    assert.equal(validateDocumentFile({type: 'image/png', size: MAX_INPUT_BYTES + 1}).valid, false);
    assert.equal(validateDocumentFile({type: 'image/png', size: MAX_UPLOAD_BYTES}, {maxBytes: MAX_UPLOAD_BYTES}).valid, true);
    assert.equal(validateDocumentFile({type: 'image/png', size: MAX_UPLOAD_BYTES + 1}, {maxBytes: MAX_UPLOAD_BYTES}).valid, false);
    for (const size of [0, -1, 1.5, NaN, Infinity, '20']) assert.equal(validateDocumentFile({type: 'image/png', size}).valid, false);
});

test('model does not alter protected file metadata or create expiry/review fields', () => {
    const item = Object.freeze(record('clearance', {status: 'approved'}));
    const data = Object.freeze({clearance: item});
    const before = JSON.stringify(data);
    documentSummary(data, today);
    assert.equal(JSON.stringify(data), before);
    assert.equal(Object.hasOwn(item, 'expiresOn'), false);
});
