import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installAttendanceCamera,createAttendanceStreamSession} from '../Takodeal-POS/attendance-camera.js';
import {installStaffLocation,createClockCamera} from '../takodeal-staff/staff-location.js';

function harness(app) {
    const requests=[],nodes=new Map();let gpsAcquires=0,gpsStops=0,invalidations=0;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{display:id==='timeClockModal'?'flex':'none'},dataset:{},textContent:'',classList:{contains:()=>id==='view-timeclock'},play:()=>Promise.resolve()});return nodes.get(id);};
    const document={hidden:false,getElementById:node,addEventListener(){}},window={BRANCH_ZONES:{Maa:{lat:7,lng:125}},ALLOWED_RADIUS_METERS:50,addEventListener(){},invalidateAttendanceCamera:()=>{invalidations++;}};
    const navigator={geolocation:{},mediaDevices:{getUserMedia:()=>new Promise(resolve=>requests.push(resolve))}};
    const location={lat:7,lng:125,branch:'Maa',state:'verified',accuracy:10,distance:0,timestamp:Date.now()};
    const context=vm.createContext({window,document,navigator,installAttendanceCamera,createAttendanceStreamSession,console,setTimeout,clearTimeout,setInterval:()=>1});
    if(app==='staff') {
        context.createLocationSession=options=>({acquire:async()=>{gpsAcquires++;options.onState(location);return location;},stop:()=>{gpsStops++;}});
        new vm.Script(`${createClockCamera.toString()}\n${installStaffLocation.toString()}\ninstallStaffLocation();`).runInContext(context);
    } else {
        const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),from=source.indexOf('installAttendanceCamera(window, document);'),until=source.indexOf('let attendanceModalEpoch',from);
        assert.ok(from>0&&until>from);new vm.Script('let cameraStream=null;\n'+source.slice(from,until)).runInContext(context);
        window.currentLat=7;window.currentLng=125;window.staffLocationFix=location;
    }
    return {window,document,requests,node,gpsAcquires:()=>gpsAcquires,gpsStops:()=>gpsStops,invalidations:()=>invalidations};
}
function stream() {const track={readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';}};return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};}

for(const app of ['staff','cashier']) {
    test(`${app} actual restart hook stops late camera streams and preserves GPS state`,async()=>{
        const h=harness(app),first=app==='staff'?h.window.startCameraAndGPS():h.window.restartAttendanceCamera();assert.equal(h.requests.length,1);
        const before=h.window.staffLocationFix,lat=h.window.currentLat,gpsReads=h.gpsAcquires();const second=h.window.restartAttendanceCamera();assert.equal(h.requests.length,2);
        const late=stream();h.requests[0](late);await first;assert.equal(late.track.stops,1);assert.equal(h.node('clockVideo').srcObject,null);
        const current=stream();h.requests[1](current);assert.equal(await second,current);assert.equal(h.node('clockVideo').srcObject,current);
        assert.equal(h.window.staffLocationFix,before);assert.equal(h.window.currentLat,lat);assert.equal(h.gpsAcquires(),gpsReads);assert.equal(h.gpsStops(),0);
        const third=h.window.restartAttendanceCamera();assert.equal(current.track.stops,1);const replacement=stream();h.requests[2](replacement);await third;assert.equal(h.node('clockVideo').srcObject,replacement);
    });
    test(`${app} actual restart hook does nothing when Clock is hidden or closed`,async()=>{
        const h=harness(app);h.document.hidden=true;assert.equal(h.window.restartAttendanceCamera(),undefined);assert.equal(h.requests.length,0);
        h.document.hidden=false;if(app==='cashier')h.node('timeClockModal').style.display='none';else h.node('view-timeclock').classList.contains=()=>false;
        assert.equal(h.window.restartAttendanceCamera(),undefined);assert.equal(h.requests.length,0);assert.equal(h.gpsStops(),0);assert.equal(h.gpsAcquires(),0);
    });
    test(`${app} camera startup supports older play() returning no promise`,async()=>{
        const h=harness(app);h.node('clockVideo').play=()=>undefined;
        const pending=h.window.restartAttendanceCamera(),current=stream();h.requests[0](current);
        assert.equal(await pending,current);assert.equal(h.node('clockVideo').srcObject,current);
        const status=h.node(app==='staff'?'cameraStatus':'faceAiStatus');assert.equal(status.textContent,'Camera ready');
    });
}
