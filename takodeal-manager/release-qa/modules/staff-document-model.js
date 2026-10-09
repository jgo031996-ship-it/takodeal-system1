// Presentation and file validation only. Authentication, ownership, review status,
// and access to file bytes must be enforced by the private vault's server rules.
export const DOCUMENT_GROUPS = Object.freeze(['valid_id', 'health_card', 'clearance']);
export const DOCUMENT_LABELS = Object.freeze({
    valid_id: 'Valid ID', health_card: 'Health Card', clearance: 'NBI or Police Clearance'
});
export const CLEARANCE_TYPES = Object.freeze(['NBI', 'POLICE']);
export const DOCUMENT_STATUSES = Object.freeze(['pending_review', 'approved', 'rejected']);
export const DOCUMENT_CONTENT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const PH_OFFSET = 8 * 60 * 60 * 1000;

export function validDocumentDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export function philippineDocumentDay(value = new Date()) {
    if (validDocumentDay(value)) return value;
    // A malformed date-only value must not be rolled into the following month.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid document date.');
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) throw new Error('Invalid document date.');
    return new Date(time + PH_OFFSET).toISOString().slice(0, 10);
}

function viewBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

export function detectDocumentContentType(value) {
    const bytes = viewBytes(value);
    if (!bytes) return null;
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return 'image/png';
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}

// Input files may be larger than the stored image. The caller must decode and
// re-encode the image, removing EXIF, then validate the new bytes at MAX_UPLOAD_BYTES.
// A matching header is not a full image decoder or a security boundary.
export function validateDocumentFile(file, {bytes, maxBytes = MAX_INPUT_BYTES, requireSignature = false} = {}) {
    const errors = [];
    const contentType = typeof file?.type === 'string' ? file.type.toLowerCase().trim() : '';
    const size = file?.size;
    if (!DOCUMENT_CONTENT_TYPES.includes(contentType)) errors.push('Choose a JPEG, PNG, or WebP photo.');
    if (!Number.isSafeInteger(size) || size <= 0) errors.push('The photo is empty or its size is invalid.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) errors.push('The upload limit is invalid.');
    else if (size > maxBytes) errors.push(`The photo must be ${maxBytes === MAX_UPLOAD_BYTES ? '2' : maxBytes === MAX_INPUT_BYTES ? '10' : (maxBytes / 1024 / 1024).toFixed(1)} MB or smaller.`);
    let signatureVerified = false;
    if (bytes !== undefined) {
        const data = viewBytes(bytes);
        if (!data || data.length !== size) errors.push('The photo could not be read completely.');
        else {
            signatureVerified = detectDocumentContentType(data) === contentType;
            if (!signatureVerified) errors.push('The file contents do not match the photo format.');
        }
    } else if (requireSignature) errors.push('Read the photo before uploading it.');
    return {valid: errors.length === 0, errors, contentType, size, signatureVerified};
}

export function validateDocumentDraft(draft, today = new Date()) {
    const errors = [], warnings = [];
    const group = draft?.group;
    if (!DOCUMENT_GROUPS.includes(group)) errors.push('Choose a supported document.');
    const clearanceType = typeof draft?.clearanceType === 'string' ? draft.clearanceType.trim().toUpperCase() : null;
    if (group === 'clearance' && !CLEARANCE_TYPES.includes(clearanceType)) errors.push('Choose NBI or Police Clearance.');
    const expiry = draft?.expiresOn;
    const expiresOn = expiry === undefined || expiry === null || expiry === '' ? null : expiry;
    if (expiresOn !== null && !validDocumentDay(expiresOn)) errors.push('Use a valid expiry date.');
    else if (expiresOn !== null && expiresOn < philippineDocumentDay(today)) warnings.push('This document has expired. Upload a current document when available.');
    return {valid: errors.length === 0, errors, warnings, group, clearanceType: group === 'clearance' ? clearanceType : null, expiresOn};
}

export function validPrivateDocumentPath(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024
        && !/[\\:?#\u0000-\u001f\u007f]/.test(value)
        && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
        && !/%(?:2e|2f|5c)/i.test(value);
}

export function validateDocumentRecord(group, record, today = new Date()) {
    const errors = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) return {valid: false, errors: ['The document record is invalid.']};
    const draft = validateDocumentDraft({group, clearanceType: record.clearanceType, expiresOn: record.expiresOn}, today);
    errors.push(...draft.errors);
    if (record.group !== undefined && record.group !== group) errors.push('The document type does not match its record.');
    if (!DOCUMENT_STATUSES.includes(record.status)) errors.push('The document review status is invalid.');
    if (!validPrivateDocumentPath(record.storagePath)) errors.push('The private document file is missing.');
    if (['downloadURL', 'downloadUrl', 'url', 'publicUrl', 'token', 'profilePicUrl'].some(key => Boolean(record[key]))) errors.push('Public document links are not supported.');
    const file = validateDocumentFile({type: record.contentType, size: record.size}, {maxBytes: MAX_UPLOAD_BYTES});
    errors.push(...file.errors);
    return {...draft, valid: errors.length === 0, errors};
}

function state(group, code, label, message, extra = {}) {
    const urgent = ['missing', 'rejected', 'expired', 'invalid'].includes(code);
    return {group, documentLabel: DOCUMENT_LABELS[group] || 'Document', code, label, message,
        tone: urgent ? 'danger' : code === 'pending_review' ? 'warning' : 'success',
        urgent, needsUpload: urgent, needsReview: code === 'pending_review', complete: code === 'approved', ...extra};
}

export function documentState(group, record, today = new Date()) {
    if (!DOCUMENT_GROUPS.includes(group)) return state(group, 'invalid', 'Needs attention', 'This document type is not supported.');
    if (record === undefined || record === null) return state(group, 'missing', 'Upload required', `Upload your ${DOCUMENT_LABELS[group]}.`);
    const result = validateDocumentRecord(group, record, today);
    if (!result.valid) return state(group, 'invalid', 'Needs attention', 'The saved document details need to be checked.', {errors: result.errors});
    const extra = {expiresOn: result.expiresOn, clearanceType: result.clearanceType};
    if (result.expiresOn !== null && result.expiresOn < philippineDocumentDay(today)) return state(group, 'expired', 'Expired', 'Upload a current document.', extra);
    if (record.status === 'rejected') return state(group, 'rejected', 'Replacement required', 'Upload a replacement for review.', extra);
    if (record.status === 'pending_review') return state(group, 'pending_review', 'Awaiting review', 'Your photo has been uploaded for HQ review.', extra);
    return state(group, 'approved', 'Approved', 'HQ has approved this document.', extra);
}

// Missing/unloaded metadata must be represented by the caller's loading/error
// state. Call this only after an authenticated read completed successfully.
export function documentSummary(records = {}, today = new Date()) {
    const day = philippineDocumentDay(today);
    const items = DOCUMENT_GROUPS.map(group => documentState(group, records?.[group], day));
    const urgentCount = items.filter(item => item.urgent).length;
    const reviewCount = items.filter(item => item.needsReview).length;
    const approvedCount = items.filter(item => item.complete).length;
    return {items, urgentCount, reviewCount, approvedCount, uploadedCount: 3 - items.filter(item => ['missing', 'invalid'].includes(item.code)).length,
        allUploaded: items.every(item => !item.needsUpload), allApproved: approvedCount === DOCUMENT_GROUPS.length,
        tone: urgentCount > 0 ? 'danger' : reviewCount > 0 ? 'warning' : 'success'};
}
