import test from 'node:test';
import assert from 'node:assert/strict';
import {installAttendanceProofUploader,createProofUpload} from '../takodeal-staff/attendance-proof.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function flush(){for(let step=0;step<16;step++)await Promise.resolve();}
const screenshot={name:'synthetic-proof.png',type:'image/png',size:1536*1024};
const prepared={blob:new Blob([new Uint8Array(80*1024)],{type:'image/jpeg'}),originalBytes:screenshot.size,uploadBytes:80*1024};

function harness() {
    const h={preparations:[],references:[],uploads:[],dialogs:[],closes:0,loading:0,unsubscribes:0,urls:0,currentIdentity:true,timers:new Map(),delayCloseDismissal:false};
    let timerId=0,shown=null;
    const node=()=>({textContent:''});
    const document={getElementById:id=>shown?.nodes.get(id)||null};
    const Swal={
        fire(options){const dialog={options:{...options},result:deferred(),nodes:new Map([['attendanceProofProgress',node()],['attendanceProofSize',node()]]),closed:false};h.dialogs.push(dialog);shown=dialog;options.didOpen?.();return dialog.result.promise;},
        update(options){assert.ok(shown,'Only a visible uploader may change its title.');Object.assign(shown.options,options);},
        showLoading(){h.loading++;},
        close(){h.closes++;const dialog=shown;if(!dialog)return;dialog.closed=true;shown=null;if(!h.delayCloseDismissal)dialog.result.resolve({isDismissed:true,dismiss:'close'});}
    };
    const api={storage:{synthetic:true},db:{app:{synthetic:true}}};
    const uploadBytesResumable=(reference,blob,metadata)=>{
        const entry={reference,blob,metadata,cancels:0,handlers:null};
        const task={snapshot:{ref:reference,totalBytes:blob.size,bytesTransferred:0,state:'running'},
            on(event,progress,error,complete){assert.equal(event,'state_changed');entry.handlers={progress,error,complete};return ()=>h.unsubscribes++;},
            cancel(){entry.cancels++;entry.handlers?.error(Object.assign(Error('Synthetic SDK cancellation'),{code:'storage/canceled'}));return true;}};
        entry.task=task;entry.progress=bytes=>{task.snapshot={...task.snapshot,bytesTransferred:bytes};entry.handlers.progress(task.snapshot);};
        entry.complete=()=>{task.snapshot={...task.snapshot,bytesTransferred:blob.size,state:'success'};entry.handlers.complete();};
        h.uploads.push(entry);return task;
    };
    const options={Swal,ref(storage,path){assert.equal(storage,api.storage);const reference={path};h.references.push(reference);return reference;},getStorage(){throw Error('The provided Storage instance must be retained.');},
        uploadBytesResumable,getDownloadURL:async reference=>{h.urls++;assert.ok(h.references.includes(reference));return 'https://example.invalid/synthetic-proof.jpg';},
        prepare(file,options){h.preparations.push({file,options});return h.prepare?h.prepare(file,options):Promise.resolve(prepared);},
        createUpload(options){return createProofUpload({...options,schedule:(callback,ms)=>{const id=++timerId;h.timers.set(id,{callback,ms});return id;},cancel:id=>h.timers.delete(id)});}};
    installAttendanceProofUploader(api,document,options);
    const assertCurrent=()=>{if(!h.currentIdentity)throw Error('The synthetic staff session changed.');};
    return Object.assign(h,{api,document,
        begin:()=>api.uploadAttendanceProof({file:screenshot,path:'staff_requests/late_synthetic-id.jpg',assertCurrent}),
        cancelDialog:dialog=>dialog.result.resolve({isDismissed:true,dismiss:'cancel'}),
        text:(id,dialog=h.dialogs.at(-1))=>dialog.nodes.get(id).textContent,
        resolveClosed:dialog=>dialog.result.resolve({isDismissed:true,dismiss:'close'})});
}

test('Cancel during image preparation aborts immediately, starts no SDK upload, and allows another explicit attempt',async()=>{
    const h=harness(),gate=deferred();h.prepare=()=>gate.promise;
    const pending=h.begin(),failure=assert.rejects(pending,error=>error.code==='attendance/proof-cancelled');
    await flush();assert.equal(h.preparations.length,1);const signal=h.preparations[0].options.signal;
    assert.equal(signal.aborted,false);assert.equal(h.dialogs[0].options.showCancelButton,true);assert.equal(h.dialogs[0].options.cancelButtonText,'Cancel upload');
    h.cancelDialog(h.dialogs[0]);await failure;assert.equal(signal.aborted,true);assert.equal(h.uploads.length,0);assert.equal(h.references.length,0);
    // A slow decoder completing after cancellation may not begin an upload.
    gate.resolve(prepared);await flush();assert.equal(h.uploads.length,0);
    h.prepare=null;const retry=h.begin();await flush();assert.equal(h.preparations.length,2);assert.equal(h.uploads.length,1);
    h.uploads[0].complete();const result=await retry;assert.equal(result.url,'https://example.invalid/synthetic-proof.jpg');assert.equal(h.timers.size,0);
});

test('Cancel during transfer reaches the real upload controller and cancels the SDK task once without URL confirmation',async()=>{
    const h=harness(),pending=h.begin(),failure=assert.rejects(pending,error=>error.code==='attendance/proof-cancelled');
    await flush();assert.equal(h.uploads.length,1);const entry=h.uploads[0];entry.progress(16*1024);
    h.cancelDialog(h.dialogs[0]);await failure;
    assert.equal(entry.cancels,1);assert.equal(h.unsubscribes,1);assert.equal(h.urls,0);assert.equal(h.timers.size,0);
    entry.complete();entry.progress(80*1024);await flush();assert.equal(h.urls,0);assert.equal(entry.cancels,1);
});

test('duplicate invocations while preparing or uploading cannot open another dialog or start another preparation',async()=>{
    const h=harness(),gate=deferred();h.prepare=()=>gate.promise;const pending=h.begin();await flush();
    await assert.rejects(h.begin(),/already being prepared/);assert.equal(h.preparations.length,1);assert.equal(h.dialogs.length,1);assert.equal(h.uploads.length,0);
    gate.resolve(prepared);await flush();assert.equal(h.uploads.length,1);
    await assert.rejects(h.begin(),/already being prepared/);assert.equal(h.preparations.length,1);assert.equal(h.dialogs.length,1);assert.equal(h.uploads.length,1);
    h.uploads[0].complete();await pending;assert.equal(h.timers.size,0);
});

test('the actual installer presents reduced size, real byte progress and separate URL confirmation, then closes and cleans up',async()=>{
    const h=harness(),pending=h.begin();await flush();
    assert.equal(h.loading,1);assert.equal(h.dialogs[0].options.title,'Uploading screenshot…');
    assert.equal(h.text('attendanceProofSize'),'1536 KB reduced to 80 KB. Keep this screen open.');
    assert.match(h.text('attendanceProofProgress'),/Uploading: 0%/);
    const entry=h.uploads[0];assert.equal(entry.reference.path,'staff_requests/late_synthetic-id.jpg');assert.equal(entry.blob,prepared.blob);assert.equal(entry.metadata.contentType,'image/jpeg');
    entry.progress(40*1024);assert.equal(h.text('attendanceProofProgress'),'Uploading: 50% · 40 KB of 80 KB');
    entry.complete();assert.equal(h.text('attendanceProofProgress'),'Upload complete. Confirming screenshot…');
    const result=await pending;assert.equal(result.url,'https://example.invalid/synthetic-proof.jpg');assert.equal(result.originalBytes,screenshot.size);assert.equal(result.uploadBytes,80*1024);
    assert.equal(h.closes,1);assert.equal(h.dialogs[0].closed,true);assert.equal(h.document.getElementById('attendanceProofProgress'),null);
    assert.equal(h.urls,1);assert.equal(h.unsubscribes,1);assert.equal(entry.cancels,0);assert.equal(h.timers.size,0);
});

test('a staff session change while image preparation is pending refuses the result before constructing any SDK request',async()=>{
    const h=harness(),gate=deferred();h.prepare=()=>gate.promise;const pending=h.begin(),failure=assert.rejects(pending,/staff session changed/);
    await flush();h.currentIdentity=false;gate.resolve(prepared);await failure;
    assert.equal(h.uploads.length,0);assert.equal(h.references.length,0);assert.equal(h.urls,0);assert.equal(h.closes,1);
    h.currentIdentity=true;h.prepare=null;const retry=h.begin();await flush();assert.equal(h.uploads.length,1);h.uploads[0].complete();await retry;
});

test('programmatic closure of a finished dialog cannot cancel the next operation, even when its dismissal callback arrives late',async()=>{
    const h=harness();h.delayCloseDismissal=true;
    const first=h.begin();await flush();h.uploads[0].complete();await first;const oldDialog=h.dialogs[0];assert.equal(oldDialog.closed,true);
    const gate=deferred();h.prepare=()=>gate.promise;const next=h.begin();await flush();const nextSignal=h.preparations[1].options.signal;
    h.resolveClosed(oldDialog);await flush();assert.equal(nextSignal.aborted,false);
    await assert.rejects(h.begin(),/already being prepared/);assert.equal(h.preparations.length,2);
    gate.resolve(prepared);await flush();assert.equal(h.uploads.length,2);assert.equal(h.uploads[1].cancels,0);
    h.uploads[1].complete();await next;assert.equal(h.uploads[0].cancels,0);assert.equal(h.uploads[1].cancels,0);assert.equal(h.timers.size,0);
    h.resolveClosed(h.dialogs[1]);await flush();
});

test('an image preparation failure releases the visible busy state without an SDK request and supports an immediate retry',async()=>{
    const h=harness();h.prepare=async()=>{throw Error('Synthetic screenshot cannot be decoded.');};
    await assert.rejects(h.begin(),/cannot be decoded/);assert.equal(h.uploads.length,0);assert.equal(h.references.length,0);assert.equal(h.closes,1);assert.equal(h.dialogs[0].closed,true);
    h.prepare=null;const retry=h.begin();await flush();assert.equal(h.preparations.length,2);assert.equal(h.uploads.length,1);
    h.uploads[0].complete();await retry;assert.equal(h.closes,2);assert.equal(h.timers.size,0);
});
