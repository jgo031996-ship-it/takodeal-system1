import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAttendanceProof,createProofUpload} from '../takodeal-staff/attendance-proof.js';

const KiB=1024,MiB=1024*KiB;
const bytes=(size=100)=>{const data=new Uint8Array(size);if(size>=3)data.set([0xff,0xd8,0xff]);return data;};
function sampleFile({size=600*KiB,type='image/jpeg',name='sample-photo.jpg'}={}){
    const file=new Blob([bytes(size)],{type});Object.defineProperty(file,'name',{value:name});return file;
}
async function flush(){for(let turn=0;turn<12;turn++)await Promise.resolve();}
function clock(){
    let time=0,next=0;const timers=new Map();
    const schedule=(callback,delay)=>{const id=++next;timers.set(id,{callback,at:time+delay});return id;};
    const cancel=id=>timers.delete(id);
    async function advance(amount){const end=time+amount;await flush();for(;;){const entry=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)break;time=entry[1].at;timers.delete(entry[0]);entry[1].callback();await flush();}time=end;await flush();}
    return {schedule,cancel,advance,now:()=>time,timers};
}
function cancellationSignal(){
    const listeners=new Set(),signal={aborted:false,addEventListener(name,callback){assert.equal(name,'abort');listeners.add(callback);},removeEventListener(name,callback){assert.equal(name,'abort');listeners.delete(callback);}};
    return {signal,listeners,abort(){signal.aborted=true;for(const callback of [...listeners])callback();}};
}
function imageHarness({width=2400,height=1800,decode='ok',legacy=false,encode='ok',outputSize=()=>80*KiB,context=true}={}){
    const timer=clock(),images=[],canvases=[],draws=[],created=[],revoked=[];
    class Image{
        constructor(){this.naturalWidth=width;this.naturalHeight=height;this.width=width;this.height=height;images.push(this);}
        set src(value){this.source=value;if(!value)return;if(decode==='hang')return;queueMicrotask(()=>decode==='error'?this.onerror?.(Error('Synthetic bad image')):this.onload?.());}
        get src(){return this.source;}
    }
    const document={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>context?{drawImage(...args){canvas.drawArgs=args;draws.push(args);},fillRect(){}}:null,toDataURL(type,quality){assert.equal(type,'image/jpeg');canvas.quality=quality;return 'data:image/jpeg;base64,'+Buffer.from(bytes(outputSize(canvas,quality))).toString('base64');}};if(!legacy)canvas.toBlob=(callback,type,quality)=>{assert.equal(type,'image/jpeg');canvas.quality=quality;canvas.encodeCallback=callback;if(encode!=='hang')queueMicrotask(()=>callback(new Blob([bytes(outputSize(canvas,quality))],{type})));};canvases.push(canvas);return canvas;}};
    const URL={createObjectURL(file){assert.ok(file instanceof Blob);const url='blob:sample-only-'+created.length;created.push(url);return url;},revokeObjectURL(url){revoked.push(url);}};
    const options={document,Image,URL,schedule:timer.schedule,cancel:timer.cancel,decodeTimeoutMs:100};
    return {options,timer,images,canvases,draws,created,revoked};
}

test('normalizes a phone photo into bounded JPEG with proportional 1280px maximum and releases its decode URL',async()=>{
    const h=imageHarness(),file=sampleFile(),result=await prepareAttendanceProof(file,h.options);
    assert.equal(result.originalBytes,file.size);assert.equal(result.uploadBytes,result.blob.size);assert.equal(result.blob.type,'image/jpeg');assert.ok(result.uploadBytes>0&&result.uploadBytes<=160*KiB);
    assert.deepEqual([result.width,result.height],[1280,960]);assert.deepEqual(h.revoked,h.created);assert.equal(h.timer.timers.size,0);assert.ok(h.canvases[0].drawArgs);
});
test('portrait PNG and legacy WebP file decoding preserve aspect ratio without enlarging small images',async()=>{
    for(const example of [{width:1800,height:2400,type:'image/png',name:'sample.png',expected:[960,1280]},{width:480,height:640,type:'image/webp',name:'sample.webp',expected:[480,640]}]){
        const h=imageHarness(example),result=await prepareAttendanceProof(sampleFile(example),h.options);assert.deepEqual([result.width,result.height],example.expected);assert.equal(result.blob.type,'image/jpeg');assert.deepEqual(h.revoked,h.created);
    }
});
test('old photo pickers with an empty MIME type use a recognized filename extension but unknown files are refused',async()=>{
    const h=imageHarness(),result=await prepareAttendanceProof(sampleFile({type:'',name:'SAMPLE.JPEG'}),h.options);assert.equal(result.blob.type,'image/jpeg');assert.deepEqual(h.revoked,h.created);
    for(const name of ['sample','sample.txt']){const fail=imageHarness();await assert.rejects(prepareAttendanceProof(sampleFile({type:'',name}),fail.options));assert.equal(fail.created.length,0);}
});
test('old canvas without toBlob uses its JPEG data URL fallback and still enforces the upload cap',async()=>{
    const h=imageHarness({legacy:true}),result=await prepareAttendanceProof(sampleFile({type:'image/png',name:'sample.png'}),h.options);assert.equal(result.blob.type,'image/jpeg');assert.equal(result.uploadBytes,80*KiB);assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer()).slice(0,3)],[255,216,255]);assert.deepEqual(h.revoked,h.created);assert.equal(h.timer.timers.size,0);
});
test('reduces image dimensions when encoding at 1280 and 1040 cannot meet the cap, without returning oversized proof',async()=>{
    const h=imageHarness({outputSize:canvas=>canvas.width>800?200*KiB:120*KiB}),result=await prepareAttendanceProof(sampleFile(),h.options);assert.deepEqual([result.width,result.height],[800,600]);assert.equal(result.uploadBytes,120*KiB);assert.deepEqual(h.draws.map(args=>args[3]),[1280,1040,800]);assert.deepEqual(h.revoked,h.created);
    const fail=imageHarness({outputSize:()=>200*KiB});await assert.rejects(prepareAttendanceProof(sampleFile(),fail.options));assert.deepEqual(fail.revoked,fail.created);assert.equal(fail.timer.timers.size,0);
});
test('empty, unsupported, non-image MIME disguised with an image extension and over-12MiB input is rejected before decoding',async()=>{
    for(const file of [sampleFile({size:0}),sampleFile({type:'application/pdf',name:'sample.pdf'}),sampleFile({type:'application/octet-stream',name:'sample.jpg'}),sampleFile({size:12*MiB+1})]){const h=imageHarness();await assert.rejects(prepareAttendanceProof(file,h.options));assert.equal(h.images.length,0);assert.equal(h.created.length,0);assert.equal(h.timer.timers.size,0);}
});
test('decode failures, invalid pixel size and absent canvas context settle and release all temporary resources',async()=>{
    for(const options of [{decode:'error'},{width:0,height:0},{width:6000,height:5000},{context:false}]){const h=imageHarness(options);await assert.rejects(prepareAttendanceProof(sampleFile(),h.options));assert.deepEqual(h.revoked,h.created);assert.equal(h.timer.timers.size,0);}
});
test('a hung decoder is bounded and its late load callback cannot create an upload image',async()=>{
    const h=imageHarness({decode:'hang'}),pending=prepareAttendanceProof(sampleFile(),h.options),rejected=assert.rejects(pending);await h.timer.advance(100);await rejected;assert.deepEqual(h.revoked,h.created);assert.equal(h.timer.timers.size,0);h.images[0].onload?.();await flush();assert.equal(h.canvases.length,0);
});
test('a missing old-browser toBlob callback cannot hang photo preparation and late encoding is ignored',async()=>{
    const h=imageHarness({encode:'hang'}),pending=prepareAttendanceProof(sampleFile(),h.options),rejected=assert.rejects(pending);await h.timer.advance(8000);await rejected;assert.deepEqual(h.revoked,h.created);assert.equal(h.timer.timers.size,0);const encoded=h.canvases.length;h.canvases[0].encodeCallback?.(new Blob([bytes(80)],{type:'image/jpeg'}));await flush();assert.equal(h.canvases.length,encoded);assert.equal(h.timer.timers.size,0);
});
test('aborting a hung decoder immediately releases its object URL and timer without waiting for the deadline',async()=>{
    const h=imageHarness({decode:'hang'}),stop=cancellationSignal(),pending=prepareAttendanceProof(sampleFile(),{...h.options,signal:stop.signal}),rejected=assert.rejects(pending,{code:'attendance/proof-cancelled'}),lateLoad=h.images[0].onload;
    assert.equal(h.timer.timers.size,1);assert.equal(stop.listeners.size,1);stop.abort();await rejected;assert.deepEqual(h.revoked,h.created);assert.equal(h.images[0].src,'');assert.equal(h.timer.timers.size,0);assert.equal(stop.listeners.size,0);assert.equal(h.timer.now(),0);lateLoad();await flush();assert.equal(h.canvases.length,0);assert.equal(h.timer.timers.size,0);
});
test('aborting a hung encoder immediately clears canvas pixels and ignores its late toBlob callback',async()=>{
    const h=imageHarness({encode:'hang'}),stop=cancellationSignal(),pending=prepareAttendanceProof(sampleFile(),{...h.options,signal:stop.signal}),rejected=assert.rejects(pending,{code:'attendance/proof-cancelled'});await flush();assert.equal(h.canvases.length,1);assert.ok(h.canvases[0].width>0);const lateEncode=h.canvases[0].encodeCallback;
    assert.equal(h.timer.timers.size,1);stop.abort();await rejected;assert.deepEqual(h.revoked,h.created);assert.deepEqual([h.canvases[0].width,h.canvases[0].height],[0,0]);assert.equal(h.timer.timers.size,0);assert.equal(stop.listeners.size,0);assert.equal(h.timer.now(),0);lateEncode(new Blob([bytes(80)],{type:'image/jpeg'}));await flush();assert.equal(h.canvases.length,1);assert.deepEqual([h.canvases[0].width,h.canvases[0].height],[0,0]);assert.equal(h.timer.timers.size,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function uploadHarness({url='https://sample.invalid/proof.jpg',urlPending=false}={}){
    const timer=clock(),urlWait=deferred(),events=[],uploads=[],state={current:true,cancels:0,unsubscribes:0,urlReads:0},ref={path:'attendance_photos/synthetic.jpg'},blob=new Blob([bytes(80)],{type:'image/jpeg'}),metadata={contentType:'image/jpeg'};
    let handlers;
    const task={snapshot:{ref,bytesTransferred:0,totalBytes:blob.size,state:'running'},on(event,progress,error,complete){assert.equal(event,'state_changed');handlers={progress,error,complete};return ()=>{state.unsubscribes++;};},cancel(){state.cancels++;return true;}};
    const options={uploadBytesResumable(reference,data,meta){uploads.push({reference,data,meta});assert.equal(reference,ref);assert.equal(data,blob);assert.equal(meta,metadata);return task;},getDownloadURL:async reference=>{assert.equal(reference,ref);state.urlReads++;return urlPending?urlWait.promise:url;},reference:ref,blob,metadata,onProgress:progress=>events.push(progress),assertCurrent(){if(!state.current)throw Error('Synthetic session changed');},now:timer.now,schedule:timer.schedule,cancel:timer.cancel,stallMs:100,timeoutMs:300,urlTimeoutMs:60};
    const operation=createProofUpload(options);
    return {timer,urlWait,events,uploads,state,task,operation,handlers:()=>handlers,progress(bytes){task.snapshot={...task.snapshot,bytesTransferred:bytes};handlers.progress(task.snapshot);},complete(){task.snapshot={...task.snapshot,bytesTransferred:blob.size,state:'success'};handlers.complete();},error(error){handlers.error(error);}};
}
test('successful resumable upload reports SDK bytes, fetches its URL once and cleans timers/listener',async()=>{
    const h=uploadHarness();h.progress(20);h.progress(80);h.complete();const result=await h.operation.promise;assert.equal(result.url,'https://sample.invalid/proof.jpg');assert.equal(result.snapshot,h.task.snapshot);assert.equal(h.uploads.length,1);assert.equal(h.state.urlReads,1);assert.equal(h.state.cancels,0);assert.equal(h.state.unsubscribes,1);assert.equal(h.timer.timers.size,0);assert.ok(h.events.some(event=>event.stage==='upload'&&event.percent===25&&event.bytesTransferred===20&&event.totalBytes===80));assert.ok(h.events.some(event=>event.stage==='url'));
});
test('actual byte progress resets the stall deadline; missing progress cancels the real SDK task once',async()=>{
    const h=uploadHarness(),rejected=assert.rejects(h.operation.promise);await h.timer.advance(90);h.progress(10);await h.timer.advance(90);assert.equal(h.state.cancels,0);await h.timer.advance(10);await rejected;assert.equal(h.state.cancels,1);assert.equal(h.state.unsubscribes,1);assert.equal(h.timer.timers.size,0);assert.equal(h.uploads.length,1);assert.equal(h.state.urlReads,0);
});
test('repeated notifications without increased bytes cannot keep a stalled upload alive forever',async()=>{
    const h=uploadHarness(),rejected=assert.rejects(h.operation.promise);h.progress(0);await h.timer.advance(90);h.progress(0);await h.timer.advance(10);await rejected;assert.equal(h.state.cancels,1);assert.equal(h.timer.timers.size,0);
});
test('overall deadline cancels an upload even when bytes keep moving; there is no automatic retry',async()=>{
    const h=uploadHarness(),rejected=assert.rejects(h.operation.promise);for(const value of [10,20,30]){await h.timer.advance(90);h.progress(value);}await h.timer.advance(30);await rejected;assert.equal(h.state.cancels,1);assert.equal(h.uploads.length,1);assert.equal(h.timer.timers.size,0);
});
test('external cancellation stops the task, settles once and ignores late completion/error callbacks',async()=>{
    const h=uploadHarness(),rejected=assert.rejects(h.operation.promise);h.operation.cancel();h.operation.cancel();await rejected;const eventCount=h.events.length;h.complete();h.error(Error('Synthetic late transport error'));h.progress(80);await flush();assert.equal(h.state.cancels,1);assert.equal(h.state.unsubscribes,1);assert.equal(h.state.urlReads,0);assert.equal(h.events.length,eventCount);assert.equal(h.timer.timers.size,0);
});
test('SDK errors settle without replay and leave no listeners or deadline callbacks',async()=>{
    const h=uploadHarness(),failure=Error('Synthetic upload refused');h.error(failure);await assert.rejects(h.operation.promise,/Synthetic upload refused/);assert.equal(h.uploads.length,1);assert.equal(h.state.urlReads,0);assert.equal(h.state.unsubscribes,1);assert.equal(h.timer.timers.size,0);h.complete();await flush();assert.equal(h.state.urlReads,0);
});
test('URL resolution has its own bounded deadline and a late URL cannot turn failure into success',async()=>{
    const h=uploadHarness({urlPending:true}),rejected=assert.rejects(h.operation.promise);h.complete();await flush();assert.equal(h.state.urlReads,1);await h.timer.advance(60);await rejected;assert.equal(h.timer.timers.size,0);const count=h.events.length;h.urlWait.resolve('https://sample.invalid/late.jpg');await flush();assert.equal(h.events.length,count);assert.equal(h.uploads.length,1);
});
test('a changed session before upload prevents the SDK write entirely',async()=>{
    const timer=clock();let writes=0;const operation=createProofUpload({uploadBytesResumable(){writes++;throw Error('Must not upload');},getDownloadURL:async()=>'',reference:{},blob:sampleFile(),assertCurrent(){throw Error('Synthetic account changed');},schedule:timer.schedule,cancel:timer.cancel,now:timer.now});await assert.rejects(operation.promise,/Synthetic account changed/);assert.equal(writes,0);assert.equal(timer.timers.size,0);
});
test('unprepared, empty or oversized proof is refused before any SDK upload write',async()=>{
    for(const blob of [new Blob([],{type:'image/jpeg'}),new Blob([bytes(80)],{type:'image/png'}),new Blob([bytes(160*KiB+1)],{type:'image/jpeg'})]){const timer=clock();let writes=0;const operation=createProofUpload({uploadBytesResumable(){writes++;throw Error('Must not upload');},getDownloadURL:async()=>'',reference:{},blob,schedule:timer.schedule,cancel:timer.cancel,now:timer.now});await assert.rejects(operation.promise);assert.equal(writes,0);assert.equal(timer.timers.size,0);}
});
test('failed or non-HTTPS URL confirmation cannot return a successful attendance proof',async()=>{
    const failed=uploadHarness({urlPending:true}),rejected=assert.rejects(failed.operation.promise,/Synthetic URL refusal/);failed.complete();await flush();failed.urlWait.reject(Error('Synthetic URL refusal'));await rejected;assert.equal(failed.timer.timers.size,0);assert.equal(failed.state.unsubscribes,1);assert.equal(failed.uploads.length,1);
    for(const url of ['', 'http://sample.invalid/photo.jpg','javascript:sample-only']){const h=uploadHarness({url});h.complete();await assert.rejects(h.operation.promise);assert.equal(h.timer.timers.size,0);assert.equal(h.state.unsubscribes,1);assert.equal(h.uploads.length,1);}
});
test('cancelling during URL confirmation settles once and ignores its later resolution',async()=>{
    const h=uploadHarness({urlPending:true}),rejected=assert.rejects(h.operation.promise);h.complete();await flush();h.operation.cancel();await rejected;h.urlWait.resolve('https://sample.invalid/late.jpg');await flush();assert.equal(h.state.cancels,1);assert.equal(h.state.unsubscribes,1);assert.equal(h.timer.timers.size,0);assert.equal(h.uploads.length,1);
});
test('session change during progress cancels the upload and cannot start URL fetch',async()=>{
    const h=uploadHarness(),rejected=assert.rejects(h.operation.promise,/Synthetic session changed/);h.state.current=false;h.progress(40);await rejected;assert.equal(h.state.cancels,1);assert.equal(h.state.urlReads,0);assert.equal(h.timer.timers.size,0);h.complete();await flush();assert.equal(h.state.urlReads,0);
});
test('session changes after upload completion or while URL resolution waits refuse the proof result',async()=>{
    for(const stage of ['complete','url']){const h=uploadHarness({urlPending:true}),rejected=assert.rejects(h.operation.promise,/Synthetic session changed/);if(stage==='complete'){h.state.current=false;h.complete();}else{h.complete();await flush();h.state.current=false;h.urlWait.resolve('https://sample.invalid/proof.jpg');}await rejected;assert.equal(h.uploads.length,1);assert.equal(h.timer.timers.size,0);assert.equal(h.state.unsubscribes,1);if(stage==='complete')assert.equal(h.state.urlReads,0);}
});
