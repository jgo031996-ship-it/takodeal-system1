import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assessFaceGeometry,assessFacePixels,installAttendanceCamera,waitForCameraFrame,createAttendanceStreamSession} from '../takodeal-staff/attendance-camera.js';

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
    const video={srcObject:stream,readyState:4,videoWidth:640,videoHeight:480,currentTime:1,paused:false,ended:false,
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
test('real quality pipeline evaluates the captured canvas, uses tiny landmarks, shares checks and stores no descriptor',async()=>{
    const h=cameraHarness(),first=h.api.verifyAttendanceFace();assert.equal(h.api.verifyAttendanceFace(),first);
    const result=await first;assert.equal(h.detections,1);assert.equal(h.loads,2);assert.equal(result.faceCheck.faceCount,1);
    assert.equal(result.photoBase64,'data:image/jpeg;base64,captured-1');assert.equal(result.cameraStream,h.stream);
    assert.equal(h.status.dataset.state,'passed');assert.equal('descriptor'in result.faceCheck,false);assert.equal('landmarks'in result.faceCheck,false);
    await h.api.verifyAttendanceFace();assert.equal(h.loads,2);assert.equal(h.detections,2);
});
test('unavailable models, multiple people and blurry frames reject visibly without returning a photo',async()=>{
    for(const options of [{models:false},{results:[face(),face()]},{mode:'blur'}]){
        const h=cameraHarness(options);await assert.rejects(h.api.verifyAttendanceFace());assert.equal(h.status.dataset.state,'error');assert.ok(h.status.textContent.length>10);
    }
});
test('a stalled model download has a bounded visible failure rather than silently accepting a PIN',async()=>{
    const h=cameraHarness(),timers=new Map();let sequence=0;
    for(const net of Object.values(h.api.faceapi.nets))net.loadFromUri=()=>new Promise(()=>{});
    installAttendanceCamera(h.api,h.document,{schedule:fn=>{const id=++sequence;timers.set(id,fn);return id;},cancel:id=>timers.delete(id)});
    const check=h.api.verifyAttendanceFace();assert.equal(timers.size,1);[...timers.values()][0]();
    await assert.rejects(check,/Camera files could not load/);assert.equal(h.status.dataset.state,'error');assert.equal(h.detections,0);
});
test('dead, muted, hidden and paused camera cannot become successful Time In proof',async()=>{
    for(const scenario of ['dead','muted','hidden','paused']){
        const h=cameraHarness();if(scenario==='dead')h.track.readyState='ended';if(scenario==='muted')h.track.muted=true;if(scenario==='hidden')h.document.hidden=true;if(scenario==='paused')h.video.paused=true;
        await assert.rejects(h.api.verifyAttendanceFace(),/live camera/);assert.equal(h.detections,0);
    }
});
test('changed stream or hidden app while model inference runs invalidates the proof',async()=>{
    for(const scenario of ['stream','hidden']){
        const h=cameraHarness();let complete;h.api.faceapi.detectAllFaces=()=>({withFaceLandmarks:()=>new Promise(resolve=>complete=resolve)});
        const check=h.api.verifyAttendanceFace();while(!complete)await new Promise(resolve=>setImmediate(resolve));
        if(scenario==='stream')h.video.srcObject={...h.stream};else {h.document.hidden=true;h.events.get('visibilitychange')();}
        complete([face()]);await assert.rejects(check,/camera|expired/);
    }
});
test('freshness expires after five seconds and an invalid timestamp cannot be accepted',async()=>{
    const h=cameraHarness(),result=await h.api.verifyAttendanceFace();h.advance(5001);assert.throws(()=>h.api.assertAttendanceFaceFresh(result),/expired/);
    result.faceCheck.capturedAt='';assert.throws(()=>h.api.assertAttendanceFaceFresh(result),/expired/);
});
test('a stopped or hidden Clock screen cannot be used for a valid camera proof',async()=>{
    const h=cameraHarness(),modal={style:{display:'none'}},lookup=h.document.getElementById;
    h.document.getElementById=id=>id==='timeClockModal'?modal:lookup(id);
    await assert.rejects(h.api.verifyAttendanceFace(),/keep Clock open/);assert.equal(h.detections,0);
    modal.style.display='flex';const proof=await h.api.verifyAttendanceFace();modal.style.display='none';assert.throws(()=>h.api.assertAttendanceFaceFresh(proof),/keep Clock open/);
});
test('Time Out best-effort capture stays available when models or camera are missing',()=>{
    const h=cameraHarness({models:false});assert.match(h.api.captureOptionalAttendancePhoto(),/^data:image/);
    h.track.readyState='ended';assert.equal(h.api.captureOptionalAttendancePhoto(),'');assert.equal(h.loads,0);
});
test('frame callback requires advancement and a frozen feed times out; old browsers can use advancing currentTime',async()=>{
    const timers=new Map();let sequence=0,frameCallback;
    const schedule=fn=>{const id=++sequence;timers.set(id,fn);return id;},cancel=id=>timers.delete(id);
    const video={currentTime:1,requestVideoFrameCallback:fn=>{frameCallback=fn;return 4;},cancelVideoFrameCallback(){}};
    const blocked=waitForCameraFrame(video,{schedule,cancel});frameCallback(0,{mediaTime:1});assert.equal(timers.size,1);
    [...timers.values()][0]();await assert.rejects(blocked,/stopped updating/);assert.equal(timers.size,0);
    const old={currentTime:2},pending=waitForCameraFrame(old,{schedule,cancel});old.currentTime=2.2;[...timers.values()].at(-1)();await pending;assert.equal(timers.size,0);
});
test('native receiver-sensitive cancellation failures cannot strand a passed frame or its timeout',async()=>{
    for(const advanced of [true,false]){
        const timers=new Map();let sequence=0,frameCallback,cancellations=0;
        const schedule=fn=>{const id=++sequence;timers.set(id,fn);return id;};
        const video={currentTime:1,requestVideoFrameCallback:fn=>{frameCallback=fn;return 4;},cancelVideoFrameCallback(id){
            assert.equal(this,video,'the native video method retains its receiver');assert.equal(id,4);cancellations++;
            throw new TypeError('Illegal invocation');
        }};
        const pending=waitForCameraFrame(video,{schedule,cancel:()=>{throw new TypeError('Illegal invocation');}});
        if(advanced){video.currentTime=1.1;assert.doesNotThrow(()=>frameCallback(0,{mediaTime:1.1}));await pending;}
        else{assert.doesNotThrow(()=>[...timers.values()][0]());await assert.rejects(pending,/stopped updating/);}
        assert.equal(cancellations,1);
        assert.doesNotThrow(()=>frameCallback(0,{mediaTime:1.2}),'a late frame cannot restart a settled check');
        assert.equal(cancellations,1);
    }
});
test('the full camera check releases its pending slot after a frame cleanup error, so a second check can complete',async()=>{
    const h=cameraHarness();h.video.cancelVideoFrameCallback=function(){assert.equal(this,h.video);throw new TypeError('Illegal invocation');};
    const first=await h.api.verifyAttendanceFace();assert.equal(first.faceCheck.faceCount,1);assert.equal(h.status.dataset.state,'passed');
    const second=await h.api.verifyAttendanceFace();assert.equal(second.faceCheck.faceCount,1);assert.equal(h.detections,2);
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
