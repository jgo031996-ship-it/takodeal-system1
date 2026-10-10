// Late-arrival evidence only. Government documents use the private document server.
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 160 * 1024;
const proofError = (code, message) => Object.assign(new Error(message), {code});
const cancelledError = () => proofError('attendance/proof-cancelled', 'Screenshot upload cancelled. Your reason and selected screenshot are kept for another attempt. Attendance has not been saved.');

function imageType(file) {
    const type = String(file?.type || '').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].includes(type)) return type;
    if (!type && /\.(jpe?g|png|webp)$/i.test(String(file?.name || ''))) return 'image';
    throw proofError('attendance/proof-type', 'Choose a JPG, PNG or WebP screenshot. On an older phone, use a JPG or PNG.');
}
function dataURLBlob(data) {
    if (typeof data !== 'string' || !data.startsWith('data:image/jpeg;base64,')) throw Error('JPEG encoding is unavailable.');
    const binary = atob(data.slice(data.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], {type: 'image/jpeg'});
}

export async function prepareAttendanceProof(file, {
    document = globalThis.document, Image = globalThis.Image, URL = globalThis.URL,
    schedule = setTimeout, cancel = clearTimeout, decodeTimeoutMs = 12000, encodeTimeoutMs = 8000, signal
} = {}) {
    imageType(file);
    if (!Number.isFinite(file?.size) || file.size <= 0) throw proofError('attendance/proof-empty', 'The selected screenshot is empty. Choose it again.');
    if (file.size > MAX_INPUT_BYTES) throw proofError('attendance/proof-large', 'This image is too large for an older phone. Take a screenshot of the message and choose that image instead (up to 12 MB).');
    if (!document?.createElement || typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') throw proofError('attendance/proof-browser', 'This browser cannot prepare the screenshot. Open the Staff app in an updated Chrome or Safari browser.');
    let objectURL = null, image = null, canvas = null, stopStep = null;
    const checkCancelled = () => { if (signal?.aborted) throw cancelledError(); };
    const onAbort = () => stopStep?.(cancelledError());
    signal?.addEventListener?.('abort', onAbort);
    try {
        checkCancelled();
        objectURL = URL.createObjectURL(file);
        image = new Image();
        await new Promise((resolve, reject) => {
            let done = false, timer;
            const finish = error => {
                if (done) return; done = true; cancel(timer);
                if (stopStep === finish) stopStep = null;
                image.onload = image.onerror = null;
                error ? reject(error) : resolve();
            };
            stopStep = finish;
            timer = schedule(() => finish(proofError('attendance/proof-decode-timeout', 'The phone could not open this image in time. Choose a smaller JPG or PNG screenshot.')), decodeTimeoutMs);
            image.onload = () => finish();
            image.onerror = () => finish(proofError('attendance/proof-decode', 'The selected image could not be opened. Choose a JPG or PNG screenshot.'));
            try { image.src = objectURL; } catch (error) { finish(error); }
        });
        checkCancelled();
        const width = Number(image.naturalWidth || image.width), height = Number(image.naturalHeight || image.height);
        if (![width, height].every(n => Number.isFinite(n) && n > 0) || width * height > 24000000) throw proofError('attendance/proof-dimensions', 'This image is too large to prepare on an older phone. Choose a screenshot of the message instead.');
        canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw proofError('attendance/proof-browser', 'The screenshot could not be prepared. Restart the browser and choose a JPG or PNG.');
        for (const [edge, quality] of [[1280, 0.76], [1040, 0.66], [800, 0.58]]) {
            checkCancelled();
            const scale = Math.min(1, edge / width, edge / height);
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((resolve, reject) => {
                let done = false, timer;
                const finish = (error, value) => {
                    if (done) return; done = true; cancel(timer);
                    if (stopStep === finish) stopStep = null;
                    error ? reject(error) : resolve(value);
                };
                stopStep = finish;
                timer = schedule(() => finish(proofError('attendance/proof-encode-timeout', 'Preparing this image is taking too long. Choose a smaller JPG or PNG screenshot.')), encodeTimeoutMs);
                try {
                    if (typeof canvas.toBlob === 'function') canvas.toBlob(value => value ? finish(null, value) : finish(proofError('attendance/proof-encode', 'The screenshot could not be prepared. Choose a different JPG or PNG.')), 'image/jpeg', quality);
                    else finish(null, dataURLBlob(canvas.toDataURL('image/jpeg', quality)));
                } catch (error) { finish(error); }
            });
            checkCancelled();
            if (blob?.type !== 'image/jpeg' || !Number.isFinite(blob.size) || blob.size <= 0) throw proofError('attendance/proof-encode', 'The browser could not prepare a JPG screenshot. Choose a different image.');
            if (blob.size <= MAX_UPLOAD_BYTES) return {blob, originalBytes: file.size, uploadBytes: blob.size, width: canvas.width, height: canvas.height};
        }
        throw proofError('attendance/proof-large', 'The screenshot is still too large. Crop it to show the message and choose it again.');
    } finally {
        signal?.removeEventListener?.('abort', onAbort);
        stopStep = null;
        if (image) { image.onload = image.onerror = null; image.src = ''; }
        if (objectURL) URL.revokeObjectURL(objectURL);
        if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
}

export function createProofUpload({
    uploadBytesResumable, getDownloadURL, reference, blob, metadata = {contentType: 'image/jpeg'},
    onProgress = () => {}, assertCurrent = () => {}, now = Date.now,
    schedule = setTimeout, cancel: clear = clearTimeout, stallMs = 180000, timeoutMs = 180000, urlTimeoutMs = 15000
}) {
    let task = null, unsubscribe = null, settled = false, stage = 'upload';
    let overallTimer, stallTimer, urlTimer, transferred = -1, resolvePromise, rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const cleanup = () => {
        [overallTimer, stallTimer, urlTimer].forEach(timer => { if (timer != null) clear(timer); });
        if (unsubscribe) { const off = unsubscribe; unsubscribe = null; try { off(); } catch {} }
    };
    const fail = error => {
        if (settled) return; settled = true; cleanup();
        try { task?.cancel(); } catch {}
        rejectPromise(error);
    };
    const ensureCurrent = () => { if (settled) return false; try { assertCurrent(); return true; } catch (error) { fail(error); return false; } };
    const emit = data => { try { onProgress(data); } catch {} };
    const timeoutError = () => proofError('attendance/proof-timeout', 'The screenshot upload is taking too long. Your reason and selected screenshot are kept. Check your connection and try Time In again; attendance has not been saved.');
    const resetStall = () => { if (stallTimer != null) clear(stallTimer); stallTimer = schedule(() => fail(timeoutError()), stallMs); };
    try {
        assertCurrent();
        if (!blob || !Number.isFinite(blob.size) || blob.size <= 0 || blob.size > MAX_UPLOAD_BYTES || blob.type !== 'image/jpeg') throw proofError('attendance/proof-size', 'Prepare a smaller JPG screenshot before uploading.');
        const startedAt = now();
        task = uploadBytesResumable(reference, blob, metadata);
        overallTimer = schedule(() => fail(timeoutError()), timeoutMs);
        resetStall();
        emit({stage: 'upload', percent: 0, bytesTransferred: 0, totalBytes: blob.size});
        unsubscribe = task.on('state_changed', snapshot => {
            if (stage !== 'upload' || !ensureCurrent()) return;
            const bytes = Number(snapshot.bytesTransferred), total = Number(snapshot.totalBytes);
            if (bytes > transferred) { transferred = bytes; resetStall(); }
            if (Number.isFinite(bytes) && Number.isFinite(total) && total > 0) emit({stage: 'upload', percent: Math.min(100, Math.max(0, Math.floor(bytes / total * 100))), bytesTransferred: bytes, totalBytes: total, elapsedMs: Math.max(0, now() - startedAt)});
        }, error => fail(error?.code === 'storage/canceled' ? cancelledError() : error), () => {
            if (stage !== 'upload' || !ensureCurrent()) return;
            stage = 'url';
            clear(overallTimer); clear(stallTimer);
            emit({stage: 'url', percent: 100, bytesTransferred: blob.size, totalBytes: blob.size});
            urlTimer = schedule(() => fail(proofError('attendance/proof-url-timeout', 'The screenshot uploaded, but its confirmation is taking too long. Your reason is kept. Check your connection and try Time In again; attendance has not been saved.')), urlTimeoutMs);
            Promise.resolve().then(() => { if (!ensureCurrent()) return null; return getDownloadURL(task.snapshot.ref); }).then(url => {
                if (!ensureCurrent()) return;
                if (typeof url !== 'string' || !url.startsWith('https://')) { fail(proofError('attendance/proof-url', 'The screenshot could not be confirmed. Try again before recording attendance.')); return; }
                settled = true; cleanup(); resolvePromise({url, snapshot: task.snapshot});
            }, fail);
        });
        if (settled) cleanup();
    } catch (error) { fail(error); }
    return {promise, cancel: () => fail(cancelledError())};
}

export function installAttendanceProofUploader(api, document, {
    uploadBytesResumable, getDownloadURL, ref, getStorage,
    prepare = prepareAttendanceProof, createUpload = createProofUpload, Swal = globalThis.Swal
}) {
    let active = null;
    const bytesLabel = bytes => Math.max(0, Math.round(bytes / 1024)) + ' KB';
    api.uploadAttendanceProof = async ({file, path, assertCurrent = () => {}}) => {
        if (active) throw Error('A screenshot is already being prepared. Please wait or cancel it.');
        const operation = {cancelled: false, finished: false, upload: null};
        active = operation;
        const preparationListeners = new Set();
        const signal = {aborted:false, addEventListener:(name, listener)=>{if(name==='abort')preparationListeners.add(listener);}, removeEventListener:(name, listener)=>{if(name==='abort')preparationListeners.delete(listener);}};
        let rejectPreparation;
        const cancelled = new Promise((_, reject) => { rejectPreparation = reject; });
        const current = () => { if (operation.cancelled) throw cancelledError(); assertCurrent(); };
        const stop = () => {
            if (operation.finished || operation.cancelled) return;
            operation.cancelled = true;
            signal.aborted = true;
            for (const listener of [...preparationListeners]) listener();
            if (operation.upload) operation.upload.cancel();
            else rejectPreparation(cancelledError());
        };
        const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
        try {
            current();
            const dialog = Swal.fire({
                title: 'Preparing screenshot…',
                html: '<p id="attendanceProofProgress" role="status" aria-live="polite">Reducing the image size for your phone…</p><p id="attendanceProofSize" style="font-size:13px;color:#64748b">Your reason and screenshot stay selected if you cancel.</p>',
                showConfirmButton: false, showCancelButton: true, cancelButtonText: 'Cancel upload',
                allowOutsideClick: false, allowEscapeKey: false,
                didOpen: () => Swal.showLoading()
            });
            Promise.resolve(dialog).then(result => { if (result?.isDismissed) stop(); }, stop);
            const prepared = await Promise.race([prepare(file, {document, Image: api.Image || globalThis.Image, URL: api.URL || globalThis.URL, signal}), cancelled]);
            current();
            Swal.update({title: 'Uploading screenshot…'});
            text('attendanceProofSize', bytesLabel(prepared.originalBytes) + ' reduced to ' + bytesLabel(prepared.uploadBytes) + '. Keep this screen open.');
            const reference = ref(api.storage || getStorage(api.db.app), path);
            operation.upload = createUpload({uploadBytesResumable, getDownloadURL, reference, blob: prepared.blob, assertCurrent: current,
                onProgress: progress => text('attendanceProofProgress', progress.stage === 'url' ? 'Upload complete. Confirming screenshot…' : 'Uploading: ' + progress.percent + '% · ' + bytesLabel(progress.bytesTransferred) + ' of ' + bytesLabel(progress.totalBytes))});
            const result = await operation.upload.promise;
            current();
            return {...result, originalBytes: prepared.originalBytes, uploadBytes: prepared.uploadBytes};
        } finally {
            operation.finished = true;
            if (active === operation) active = null;
            if (document.getElementById('attendanceProofProgress')) Swal.close();
        }
    };
    return api.uploadAttendanceProof;
}
