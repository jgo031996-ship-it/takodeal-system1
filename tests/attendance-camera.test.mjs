import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assessFaceGeometry,assessFacePixels,installAttendanceCamera,waitForCameraFrame,createAttendanceStreamSession,ATTENDANCE_CAMERA_POLICY,ATTENDANCE_PHOTO_MAX_AGE} from '../takodeal-staff/attendance-camera.js';

function face() {
    const positions=Array.from({length:68},()=>({x:320,y:240}));
    positions[0]={x:215,y:240};positions[16]={x:425,y:240};positions[30]={x:320,y:235};positions[48]={x:295,y:285};positions[54]={x:345,y:285};
    const eye=(start,x)=>{[[x-15,180],[x-7,175],[x+7,175],[x+15,180],[x+7,185],[x-7,185]].forEach(([px,py],offset)=>positions[start+offset]={x:px,y:py});};
    eye(36,280);eye(42,360);
    return {detection:{score:0.94,box:{x:210,y:110,width:220,height:270}},landmarks:{positions}};
}
function image(width=220,height=270,mode='clear') {
    const data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const v=mode==='dark'?10:mode==='bright'?252:mode==='blur'?120:((Math.floor(x/2)+Math.floor(y/2))%2?95:160),at=(y*width+x)*4;
        data[at]=data[at+1]=data[at+2]=v;data[at+3]=255;
    }return {width,height,data};
}

test('frontal landmarks pass; absent and multiple people fail rather than taking the highest confidence face',()=>{
    assert.equal(assessFaceGeometry([face()],640,480).ok,true);
    assert.equal(assessFaceGeometry([],640,480).code,'missing');
    assert.equal(assessFaceGeometry([face(),{...face(),detection:{...face().detection,score:0.55}}],640,480).code,'multiple');
});
test('small, cropped, off-center, low confidence and malformed landmark photos fail clearly',()=>{
    let f=face();f.detection.box={x:275,y:200,width:80,height:80};assert.equal(assessFaceGeometry([f],640,480).code,'small');
    f=face();f.detection.box.x=4;assert.equal(assessFaceGeometry([f],640,480).code,'cropped');
    f=face();f.detection.box.x=30;assert.equal(assessFaceGeometry([f],640,480).code,'center');
    f=face();f.detection.score=0.7;assert.equal(assessFaceGeometry([f],640,480).code,'unclear');
    f=face();f.landmarks.positions[22].x=NaN;assert.equal(assessFaceGeometry([f],640,480).code,'unclear');
    f=face();f.landmarks.positions.pop();assert.equal(assessFaceGeometry([f],640,480).code,'unclear');
});
test('turned, tilted, upward/downward and collapsed-eye landmarks cannot pass the frontal gate',()=>{
    let f=face();f.landmarks.positions[30].x+=32;assert.equal(assessFaceGeometry([f],640,480).code,'frontal');
    f=face();const angle=20*Math.PI/180;f.landmarks.positions=f.landmarks.positions.map(p=>({x:320+(p.x-320)*Math.cos(angle)-(p.y-240)*Math.sin(angle),y:240+(p.x-320)*Math.sin(angle)+(p.y-240)*Math.cos(angle)}));assert.equal(assessFaceGeometry([f],640,480).code,'tilt');
    for(const y of [190,280]){f=face();f.landmarks.positions[30].y=y;assert.equal(assessFaceGeometry([f],640,480).code,'frontal');}
    f=face();f.landmarks.positions[39]={...f.landmarks.positions[36]};f.landmarks.positions[45]={...f.landmarks.positions[42]};assert.equal(assessFaceGeometry([f],640,480).code,'frontal');
});
test('photo pixels reject poor light and blur while usable light with edges passes',()=>{
    assert.equal(assessFacePixels(image()).ok,true);
    for(const [mode,code]of [['dark','dark'],['bright','bright'],['blur','blur']])assert.equal(assessFacePixels(image(220,270,mode)).code,code);
    assert.equal(assessFacePixels({width:5,height:5,data:[]}).code,'image');
});

function cameraHarness({mode='clear',results=[face()],models=true}={}) {
    let clock=Date.parse('2026-10-07T09:00:00+08:00'),detections=0,loads=0;
    const track={readyState:'live',enabled:true,muted:false,stop(){this.readyState='ended';}};
    const stream={getVideoTracks:()=>[track],getTracks:()=>[track]},events=new Map(),status={textContent:'',dataset:{}};
    const video={style:{},srcObject:stream,readyState:4,videoWidth:640,videoHeight:480,currentTime:1,paused:false,ended:false,
        requestVideoFrameCallback(fn){queueMicrotask(()=>{video.currentTime+=0.05;fn(0,{mediaTime:video.currentTime});});return 1;},cancelVideoFrameCallback(){}};
    const frames=[];
    const document={hidden:false,getElementById:id=>id==='clockVideo'?video:id==='attendanceFaceStatus'?status:null,addEventListener:(name,fn)=>events.set(name,fn),createElement:()=>{
        const canvas={width:0,height:0,getContext:()=>({drawImage:input=>{canvas.input=input;},getImageData:(_x,_y,w,h)=>image(w,h,mode)}),toDataURL:()=>`data:image/jpeg;base64,captured-${frames.length}`};frames.push(canvas);return canvas;
    }};
    const net=()=>({isLoaded:false,async loadFromUri(path){assert.equal(path,'./vendor/face-models');loads++;this.isLoaded=true;}});
    const faceapi=models?{nets:{tinyFaceDetector:net(),faceLandmark68TinyNet:net()},TinyFaceDetectorOptions:class {constructor(options){assert.equal(options.inputSize,416);assert.equal(options.scoreThreshold,0.5);}},detectAllFaces:canvas=>{
        detections++;assert.equal(canvas.input,video);return {withFaceLandmarks(tiny){assert.equal(tiny,true);return Promise.resolve(results);}};
    }}:null;
    const api={faceapi,addEventListener:(name,fn)=>events.set(name,fn)};
    installAttendanceCamera(api,document,{now:()=>clock});
    return {api,document,video,stream,track,status,frames,events,get detections(){return detections;},get loads(){return loads;},advance:ms=>clock+=ms};
}
test('photo-only Time In captures natural canvas pixels, mirrors preview, deduplicates and never loads face models',async()=>{
    const h=cameraHarness(),first=h.api.verifyAttendanceFace();assert.equal(h.api.verifyAttendanceFace(),first);
    const result=await first;assert.equal(h.detections,0);assert.equal(h.loads,0);assert.equal(result.faceCheck.policyVersion,ATTENDANCE_CAMERA_POLICY);
    assert.equal(result.photoBase64,'data:image/jpeg;base64,captured-1');assert.equal(result.cameraStream,h.stream);assert.equal(h.video.style.transform,'scaleX(-1)');
    assert.equal(result.faceCheck.faceDetectionRequired,false);assert.equal(result.faceCheck.photoMirrored,false);assert.equal(result.faceCheck.previewMirrored,true);
    for(const key of ['descriptor','landmarks','confidence','faceCount','modelVersion'])assert.equal(key in result.faceCheck,false);
    assert.equal(h.frames[0].input,h.video);assert.equal(h.status.dataset.state,'passed');h.advance(500);await h.api.verifyAttendanceFace();assert.equal(h.frames.length,2);assert.equal(h.loads,0);
});
test('missing or stalled face models, multiple detected people and low-quality photos do not gate photo-based attendance',async()=>{
    for(const options of [{models:false},{results:[]},{results:[face(),face()]},{mode:'blur'},{mode:'dark'},{mode:'bright'}]){
        const h=cameraHarness(options);if(h.api.faceapi)for(const net of Object.values(h.api.faceapi.nets))net.loadFromUri=()=>{throw Error('Must not load optional face models.');};
        const result=await h.api.verifyAttendanceFace();assert.match(result.photoBase64,/^data:image\/jpeg;base64,/);assert.equal(h.status.dataset.state,'passed');assert.equal(h.loads,0);assert.equal(h.detections,0);
    }
});
test('usable decoded frames pass despite transient muted flag, multiple tracks or a stationary currentTime',async()=>{
    for(const scenario of ['muted','extra-track','stationary']){
        const h=cameraHarness();if(scenario==='muted')h.track.muted=true;if(scenario==='extra-track')h.stream.getVideoTracks=()=>[h.track,{readyState:'ended'}];
        if(scenario==='stationary')h.video.requestVideoFrameCallback=()=>{throw Error('Already decoded frame needs no advancing callback.');};
        const result=await h.api.verifyAttendanceFace();assert.equal(result.faceCheck.captureMode,'camera-photo');assert.equal(h.video.currentTime,1);
    }
});
test('absent, ended, disabled and hidden camera contexts cannot create a Time In photo',async()=>{
    for(const scenario of ['dead','disabled','hidden','no-stream']){
        const h=cameraHarness();if(scenario==='dead')h.track.readyState='ended';if(scenario==='disabled')h.track.enabled=false;if(scenario==='hidden')h.document.hidden=true;if(scenario==='no-stream')h.video.srcObject=null;
        await assert.rejects(h.api.verifyAttendanceFace(),/Camera unavailable|Clock open/);assert.equal(h.frames.length,0);assert.equal(h.status.dataset.state,'error');
    }
});
test('paused preview retries playback and captures once ready even if play promise never settles',async()=>{
    const h=cameraHarness(),timers=new Map();let n=0,plays=0;h.video.paused=true;h.video.requestVideoFrameCallback=()=>4;
    h.video.play=function(){assert.equal(this,h.video);plays++;this.paused=false;return new Promise(()=>{});};
    installAttendanceCamera(h.api,h.document,{schedule:(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
    const pending=h.api.verifyAttendanceFace();while(!timers.size)await new Promise(resolve=>setImmediate(resolve));
    [...timers.values()].find(t=>t.ms===80).fn();const result=await pending;assert.match(result.photoBase64,/^data:image/);assert.equal(plays,1);assert.equal(timers.size,0);
});
test('unrecoverable paused/undecoded preview times out visibly and releases the check for retry',async()=>{
    for(const scenario of ['paused','undecoded']){
        const h=cameraHarness(),timers=new Map();let n=0;if(scenario==='paused'){h.video.paused=true;h.video.play=()=>Promise.reject(Error('autoplay failed'));}else h.video.readyState=1;
        installAttendanceCamera(h.api,h.document,{schedule:(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
        const pending=h.api.verifyAttendanceFace();while(!timers.size)await new Promise(resolve=>setImmediate(resolve));[...timers.values()].find(t=>t.ms===2500).fn();
        await assert.rejects(pending,/Restart camera/);assert.equal(timers.size,0);assert.equal(h.frames.length,0);assert.equal(h.status.dataset.state,'error');
        h.video.paused=false;h.video.readyState=4;assert.match((await h.api.verifyAttendanceFace()).photoBase64,/^data:image/);
    }
});
test('stream change or hidden app during readiness waiting invalidates the old photo request',async()=>{
    for(const scenario of ['stream','hidden']){
        const h=cameraHarness(),timers=new Map();let n=0;h.video.readyState=1;h.video.requestVideoFrameCallback=()=>5;
        installAttendanceCamera(h.api,h.document,{schedule:(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
        const pending=h.api.verifyAttendanceFace();while(!timers.size)await new Promise(resolve=>setImmediate(resolve));
        if(scenario==='stream')h.video.srcObject={...h.stream};else {h.document.hidden=true;h.events.get('visibilitychange')();}
        h.video.readyState=4;[...timers.values()].find(t=>t.ms===80).fn();await assert.rejects(pending,/camera changed|Clock open/i);assert.equal(h.frames.length,0);
    }
});
test('stale photo, invalid timestamp, altered policy and replaced camera cannot be reused',async()=>{
    const h=cameraHarness(),result=await h.api.verifyAttendanceFace();h.advance(ATTENDANCE_PHOTO_MAX_AGE+1);assert.throws(()=>h.api.assertAttendanceFaceFresh(result),/expired/);
    result.faceCheck.capturedAt='';assert.throws(()=>h.api.assertAttendanceFaceFresh(result),/expired/);
    const good=cameraHarness(),proof=await good.api.verifyAttendanceFace();proof.faceCheck.policyVersion='frontal-photo-v1';assert.throws(()=>good.api.assertAttendanceFaceFresh(proof),/expired/);
    proof.faceCheck.policyVersion=ATTENDANCE_CAMERA_POLICY;good.video.srcObject={...good.stream};assert.throws(()=>good.api.assertAttendanceFaceFresh(proof),/expired/);
});
test('closed Clock screen cannot be used for a current photo; Time Out remains optional without camera/models',async()=>{
    const h=cameraHarness({models:false}),modal={style:{display:'none'}},lookup=h.document.getElementById;
    h.document.getElementById=id=>id==='timeClockModal'?modal:lookup(id);await assert.rejects(h.api.verifyAttendanceFace(),/Clock open/);
    modal.style.display='flex';assert.match(h.api.captureOptionalAttendancePhoto(),/^data:image/);h.track.readyState='ended';assert.equal(h.api.captureOptionalAttendancePhoto(),'');
    assert.equal(h.loads,0);assert.equal(h.detections,0);
});
test('already decoded frame needs no currentTime advancement; delayed decoding is bounded on old browsers',async()=>{
    await waitForCameraFrame({readyState:4,videoWidth:80,videoHeight:60,currentTime:1,paused:false,ended:false,requestVideoFrameCallback(){throw Error('not needed');}});
    const timers=new Map();let n=0;const schedule=(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;},cancel=id=>timers.delete(id);
    const old={readyState:1,videoWidth:320,videoHeight:240,currentTime:1,paused:false,ended:false},pending=waitForCameraFrame(old,{schedule,cancel});old.readyState=2;
    [...timers.values()].find(t=>t.ms===80).fn();await pending;assert.equal(timers.size,0);
});
test('native receiver-sensitive cancellation failures cannot strand decoded-frame completion or timeout',async()=>{
    for(const ready of [true,false]){
        const timers=new Map();let n=0,callback,cancellations=0;const schedule=(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;};
        const video={readyState:1,videoWidth:640,videoHeight:480,paused:false,ended:false,currentTime:1,requestVideoFrameCallback:fn=>{callback=fn;return 4;},cancelVideoFrameCallback(id){assert.equal(this,video);assert.equal(id,4);cancellations++;throw new TypeError('Illegal invocation');}};
        const pending=waitForCameraFrame(video,{schedule,cancel:()=>{throw new TypeError('Illegal invocation');}});
        if(ready){video.readyState=2;assert.doesNotThrow(()=>callback(0,{mediaTime:1}));await pending;}else{assert.doesNotThrow(()=>[...timers.values()].find(t=>t.ms===2500).fn());await assert.rejects(pending,/not ready/);}
        assert.equal(cancellations,1);assert.doesNotThrow(()=>callback(0,{mediaTime:1}));assert.equal(cancellations,1);
    }
});
test('a restarted capture owns its pending slot; late old request cannot clear the replacement or write its status',async()=>{
    const h=cameraHarness(),timers=new Map();let n=0;h.video.readyState=1;h.video.requestVideoFrameCallback=()=>5;
    installAttendanceCamera(h.api,h.document,{schedule:(fn,ms)=>{const id=++n;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
    const old=h.api.verifyAttendanceFace();while(!timers.size)await new Promise(resolve=>setImmediate(resolve));const oldPoll=[...timers.values()].find(t=>t.ms===80).fn;
    h.api.invalidateAttendanceCamera();h.video.srcObject={...h.stream};h.video.readyState=4;const fresh=h.api.verifyAttendanceFace();oldPoll();await assert.rejects(old,/camera changed/i);const result=await fresh;
    assert.equal(result.cameraStream,h.video.srcObject);assert.equal(h.status.dataset.state,'passed');assert.equal(h.frames.length,1);
});

test('camera sessions deduplicate opens, stop late streams, and replace a dead connection',async()=>{
    let complete,calls=0,stops=0;const seen=[];
    const track={readyState:'live',stop(){stops++;this.readyState='ended';}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
    const session=createAttendanceStreamSession({mediaDevices:{getUserMedia:options=>{calls++;assert.equal(options.audio,false);return new Promise(resolve=>complete=resolve);}},onStream:value=>seen.push(value)});
    const first=session.start();assert.equal(session.start(),first);session.stop();complete(stream);assert.equal(await first,null);assert.equal(stops,1);
    const second=session.start();track.readyState='live';complete(stream);await second;assert.equal(await session.start(),stream);assert.equal(calls,2);
    track.readyState='ended';const third=session.start();assert.equal(calls,3);complete(stream);await third;session.stop();assert.equal(seen.at(-1),null);
});
test('both offline model trees are byte-identical, immutable upstream assets with valid manifest shards',()=>{
    const hashes={'face-api.min.js':'5d66ec95338d7fcc365ce15481b8599baf4b6e22c9a624b76d4ca821a669a659','face-models/tiny_face_detector_model-shard1':'b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871','face-models/tiny_face_detector_model-weights_manifest.json':'14c60659a31b6b7b1320077171b8f8adcb24ef0e62dde62ce603bcb49a1b49b5','face-models/face_landmark_68_tiny_model-shard1':'b98e9f2f7da76f8a6dda9741a36ed485b224b889d552de2b2c1bb16217f67bfc','face-models/face_landmark_68_tiny_model-weights_manifest.json':'3c63b8984302c187b218d9ef5aa149ed8c2c7fa3fe54db078614692bc48d153c'};
    for(const app of ['takodeal-staff','Takodeal-POS'])for(const [file,hash]of Object.entries(hashes)){
        const bytes=readFileSync(new URL(`../${app}/vendor/${file}`,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
        if(file.endsWith('.json'))for(const group of JSON.parse(bytes))for(const shard of group.paths)assert.ok(readFileSync(new URL(`../${app}/vendor/face-models/${shard}`,import.meta.url)).length>0);
    }
    assert.deepEqual(readFileSync(new URL('../takodeal-staff/attendance-camera.js',import.meta.url)),readFileSync(new URL('../Takodeal-POS/attendance-camera.js',import.meta.url)));
});
