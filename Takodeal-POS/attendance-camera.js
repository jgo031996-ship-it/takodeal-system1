// Local photo quality only. PIN/session identity remains separate; no biometric enrollment.
export const ATTENDANCE_CAMERA_POLICY = 'attendance-photo-v2';
export const ATTENDANCE_PHOTO_MAX_AGE = 15000;
export const FACE_MODEL_VERSION = 'face-api.js-0.22.2-tiny';
const mean = points => ({x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const failure = (code,message) => ({ok:false,code,message});

export function assessFaceGeometry(results,width,height) {
    if (!Array.isArray(results) || !results.length) return failure('missing','No face found. Look straight at the camera in good light.');
    if (results.length !== 1) return failure('multiple','Only one person should be in the camera frame.');
    const result=results[0],box=result?.detection?.box,score=result?.detection?.score;
    const points=result?.landmarks?.positions || result?.landmarks?._positions;
    if (!box || !Number.isFinite(score) || score<0.8 || !Array.isArray(points) || points.length!==68 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) return failure('unclear','Your face is not clear enough. Improve the light and look straight ahead.');
    if (![width,height,box.x,box.y,box.width,box.height].every(Number.isFinite) || width<160 || height<120 || box.width<90 || box.width/width<0.22 || box.height/height<0.3) return failure('small','Move closer until your face fills the guide.');
    if (box.width/width>0.72 || box.height/height>0.9 || box.x<8 || box.y<8 || box.x+box.width>width-8 || box.y+box.height>height-8) return failure('cropped','Move back slightly. Your full face must fit inside the camera frame.');
    const cx=(box.x+box.width/2)/width,cy=(box.y+box.height/2)/height;
    if (Math.abs(cx-0.5)>0.16 || Math.abs(cy-0.5)>0.2) return failure('center','Center your face inside the guide.');
    const left=mean(points.slice(36,42)),right=mean(points.slice(42,48)),eyes=mean([left,right]),nose=points[30],mouth=mean([points[48],points[54]]);
    const eyeDistance=distance(left,right),roll=Math.abs(Math.atan2(right.y-left.y,right.x-left.x))*180/Math.PI;
    if (eyeDistance<22 || roll>15) return failure('tilt','Keep your head upright and look straight at the camera.');
    // Landmark symmetry in the eye-aligned coordinate system rejects a turned/profile face.
    const axis={x:(right.x-left.x)/eyeDistance,y:(right.y-left.y)/eyeDistance};
    const yaw=Math.abs((nose.x-eyes.x)*axis.x+(nose.y-eyes.y)*axis.y)/eyeDistance;
    const leftSpan=distance(points[0],nose),rightSpan=distance(points[16],nose);
    const eyeWidths=[distance(points[36],points[39]),distance(points[42],points[45])];
    const eyeRatio=Math.min(...eyeWidths)/Math.max(...eyeWidths);
    const vertical=p=>(p.y-eyes.y)*axis.x-(p.x-eyes.x)*axis.y;
    const mouthDepth=vertical(mouth),noseDepth=vertical(nose),pitch=noseDepth/mouthDepth;
    if (yaw>0.22 || Math.min(leftSpan,rightSpan)/Math.max(leftSpan,rightSpan)<0.6 || !Number.isFinite(eyeRatio) || Math.min(...eyeWidths)<eyeDistance*0.12 || eyeRatio<0.6 || mouthDepth<eyeDistance*0.5 || !Number.isFinite(pitch) || pitch<0.3 || pitch>0.78) return failure('frontal','Turn your face toward the camera. Keep both eyes and your mouth visible.');
    return {ok:true,box,score,roll,yaw};
}

export function assessFacePixels(image) {
    const {width,height,data}=image||{};
    if (!width || !height || !data || data.length!==width*height*4) return failure('image','Camera image could not be checked. Restart the camera and try again.');
    const step=2,w=Math.floor(width/step),h=Math.floor(height/step),pixels=new Float32Array(w*h);
    let total=0,dark=0,bright=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const at=((y*step)*width+x*step)*4,v=0.299*data[at]+0.587*data[at+1]+0.114*data[at+2];
        pixels[y*w+x]=v;total+=v;if(v<25)dark++;if(v>245)bright++;
    }
    const count=w*h,average=total/count;
    if(average<45 || dark/count>0.5) return failure('dark','Your face is too dark. Face a light or move to a brighter place.');
    if(average>230 || bright/count>0.5) return failure('bright','Your face is washed out. Move away from the bright light behind you.');
    let sum=0,squared=0,n=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const at=y*w+x,lap=4*pixels[at]-pixels[at-1]-pixels[at+1]-pixels[at-w]-pixels[at+w];sum+=lap;squared+=lap*lap;n++;
    }
    const sharpness=n?squared/n-(sum/n)**2:0;
    if(sharpness<18) return failure('blur','Hold still. Clean the camera lens and wait for the image to focus.');
    return {ok:true,brightness:Math.round(average),sharpness:Math.round(sharpness)};
}

// Attendance uses a current camera photo, not mandatory face recognition.
// The optional geometry utilities above do not authorize or block a punch.
function cameraProblem(video,document,active=true) {
    if(!active || document.hidden) return Error('Keep Clock open while recording attendance.');
    const tracks=video?.srcObject?.getVideoTracks?.() || [];
    if(!video || !video.srcObject || video.ended || !tracks.some(track=>track.readyState==='live' && track.enabled!==false)) return Error('Camera unavailable. Allow camera access or choose Restart camera before Time In.');
    return null;
}
function decodedFrame(video) {
    return Boolean(video && !video.paused && !video.ended && video.readyState>=2 && Number.isFinite(video.videoWidth) && Number.isFinite(video.videoHeight) && video.videoWidth>0 && video.videoHeight>0);
}
export function waitForCameraFrame(video,{timeout=2500,schedule=setTimeout,cancel=clearTimeout}={}) {
    if(decodedFrame(video))return Promise.resolve();
    return new Promise((resolve,reject)=>{
        let frameId=null,timer=null,poll=null,done=false;
        const finish=error=>{
            if(done)return;done=true;
            try{cancel(timer);}catch{}
            try{cancel(poll);}catch{}
            try{if(frameId!==null)video.cancelVideoFrameCallback?.(frameId);}catch{}
            error?reject(error):resolve();
        };
        const check=()=>{
            if(done)return;
            if(decodedFrame(video)){finish();return;}
            poll=schedule(check,80);
        };
        timer=schedule(()=>finish(Error('Camera preview is not ready. Choose Restart camera and try again.')),timeout);
        if(typeof video?.requestVideoFrameCallback==='function'){
            try{frameId=video.requestVideoFrameCallback(()=>{if(!done && decodedFrame(video))finish();});}catch{}
        }
        poll=schedule(check,80);
        // play() can resolve late or reject under tablet autoplay restrictions.
        // Readiness polling has its own bound; never wait indefinitely on play().
        if(video?.paused && typeof video.play==='function'){
            try{Promise.resolve(video.play()).then(()=>{if(!done && decodedFrame(video))finish();},()=>{});}catch{}
        }
    });
}
function capturePhoto(video,document,max=640,quality=0.75) {
    if(!decodedFrame(video))throw Error('Camera preview is not ready. Choose Restart camera and try again.');
    const scale=Math.min(1,max/video.videoWidth,max/video.videoHeight),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('The camera photo could not be saved. Restart the camera and try again.');
    // Mirroring is preview-only. Save the original camera image for attendance.
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const photo=canvas.toDataURL('image/jpeg',quality);
    if(typeof photo!=='string' || !photo.startsWith('data:image/jpeg;base64,') || photo.length<='data:image/jpeg;base64,'.length)throw Error('The camera photo is empty. Restart the camera and try again.');
    return {photo,width:canvas.width,height:canvas.height};
}
export function installAttendanceCamera(api,document,{now=Date.now,schedule=setTimeout,cancel=clearTimeout,isActive=()=>{
    const modal=document.getElementById('timeClockModal');if(modal)return modal.style.display==='flex';
    const view=document.getElementById('view-timeclock');return view?view.classList?.contains('active') && document.getElementById('profileModal')?.style.display!=='flex':true;
}}={}) {
    let epoch=0,pendingCheck=null;
    const status=(message,state='ready')=>{const node=document.getElementById('attendanceFaceStatus') || document.getElementById('faceAiStatus');if(node){node.textContent=message;if(node.dataset)node.dataset.state=state;}};
    const mirror=()=>{const video=document.getElementById('clockVideo');if(video?.style)video.style.transform='scaleX(-1)';};
    api.prepareAttendanceCamera=async()=>{mirror();status('Position yourself in the preview. Time In saves a current photo; your PIN and location verify attendance.');return true;};
    api.invalidateAttendanceCamera=()=>{epoch++;pendingCheck=null;status('Camera photo will be captured when you choose Time In.');};
    api.assertAttendanceFaceFresh=result=>{
        const video=document.getElementById('clockVideo'),problem=cameraProblem(video,document,isActive());if(problem)throw problem;
        const capturedAt=Date.parse(result?.faceCheck?.capturedAt);
        if(!result || result.faceCheck?.policyVersion!==ATTENDANCE_CAMERA_POLICY || !Number.isFinite(capturedAt) || result.cameraEpoch!==epoch || result.cameraStream!==video.srcObject || now()-capturedAt>ATTENDANCE_PHOTO_MAX_AGE || now()<capturedAt)throw Error('The camera photo expired. Keep Clock open and record Time In again.');
        return true;
    };
    api.captureOptionalAttendancePhoto=()=>{
        try{const video=document.getElementById('clockVideo');if(cameraProblem(video,document,isActive()))return '';return capturePhoto(video,document,480,0.7).photo;}catch{return '';}
    };
    api.verifyAttendanceFace=()=>{
        if(pendingCheck)return pendingCheck;
        const token=epoch;
        const check=(async()=>{
            try{
                await api.prepareAttendanceCamera();
                const video=document.getElementById('clockVideo'),problem=cameraProblem(video,document,isActive());if(problem)throw problem;
                const stream=video.srcObject;status('Preparing your camera photo…','checking');
                await waitForCameraFrame(video,{schedule,cancel});
                if(token!==epoch || stream!==video.srcObject)throw Error('The camera changed. Keep Clock open and choose Time In again.');
                const changed=cameraProblem(video,document,isActive());if(changed)throw changed;
                const photo=capturePhoto(video,document),capturedAt=now();
                const result={photoBase64:photo.photo,cameraEpoch:token,cameraStream:stream,faceCheck:{policyVersion:ATTENDANCE_CAMERA_POLICY,captureMode:'camera-photo',capturedAt:new Date(capturedAt).toISOString(),faceDetectionRequired:false,previewMirrored:true,photoMirrored:false,width:photo.width,height:photo.height}};
                api.assertAttendanceFaceFresh(result);status('Photo captured. Saving your Time In…','passed');return result;
            }catch(error){if(token===epoch)status(error.message,'error');throw error;}
        })();
        const owned=check.finally(()=>{if(pendingCheck===owned)pendingCheck=null;});
        pendingCheck=owned;return owned;
    };
    mirror();
    document.addEventListener?.('visibilitychange',()=>{if(document.hidden)api.invalidateAttendanceCamera();});
    api.addEventListener?.('pagehide',()=>api.invalidateAttendanceCamera());
    return {prepare:api.prepareAttendanceCamera,verify:api.verifyAttendanceFace,invalidate:api.invalidateAttendanceCamera};
}

export function createAttendanceStreamSession({mediaDevices,onStream=()=>{},onStatus=()=>{}}) {
    let epoch=0,stream=null,pending=null;
    const stop=()=>{epoch++;stream?.getTracks().forEach(track=>track.stop());stream=null;pending=null;onStream(null);};
    const start=()=>{
        if(stream && stream.getVideoTracks?.().some(track=>track.readyState==='live'))return Promise.resolve(stream);
        if(stream)stop();if(pending)return pending;const token=epoch;
        onStatus('Starting camera…',false);
        pending=(async()=>{
            try{
                if(!mediaDevices?.getUserMedia)throw {name:'NotSupportedError'};let next;
                try{next=await mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640,max:640},height:{ideal:480,max:480},frameRate:{ideal:12,max:15}}});}
                catch(error){if(token!==epoch)return null;if(!['OverconstrainedError','NotFoundError'].includes(error.name))throw error;next=await mediaDevices.getUserMedia({audio:false,video:{facingMode:'user'}});}
                if(token!==epoch){next.getTracks().forEach(track=>track.stop());return null;}
                stream=next;onStream(next);onStatus('Camera ready',true);return next;
            }catch(error){if(token===epoch)onStatus(error.name==='NotAllowedError'?'Allow camera access in browser settings. Time Out remains available.':'Camera unavailable. Close other camera apps and try again. Time Out remains available.',false);return null;}
            finally{if(token===epoch)pending=null;}
        })();return pending;
    };return {start,stop};
}
