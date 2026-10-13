import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installAttendanceCamera,createAttendanceStreamSession} from '../Takodeal-POS/attendance-camera.js';

function setup(){
  const nodes=new Map(),events=new Map();let cameraStarts=0,photos=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{display:'none'},dataset:{},value:'',textContent:'',innerHTML:'',className:'',
    classList:{contains:()=>id==='view-timeclock',add(){}},append(){},after(){},play:()=>Promise.resolve()});return nodes.get(id);};
  const video=node('clockVideo');Object.assign(video,{readyState:4,paused:false,ended:false,videoWidth:640,videoHeight:480});
  const document={hidden:false,getElementById:node,addEventListener:(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);},createElement:type=>type==='canvas'?{width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=>{photos++;return 'data:image/jpeg;base64,sample-photo';}}:node('created-'+nodes.size)};
  const window={addEventListener(){},switchView(){}},navigator={mediaDevices:{getUserMedia:async()=>{cameraStarts++;const track={readyState:'live',enabled:true,stop(){this.readyState='ended';}};return {getTracks:()=>[track],getVideoTracks:()=>[track]};}}};
  const context=vm.createContext({window,document,navigator,installAttendanceCamera,createAttendanceStreamSession,console,
    query:()=>({}),collection:()=>({}),db:{},getDocs:async()=>({forEach:fn=>fn({id:'sample-staff',data:()=>({cashierName:'Sample staff'})})}),alert:message=>{throw Error(message);},
    el:node,page:()=>node('view-timeclock'),mountLegacy(){},businessDate:()=> '2026-10-13',startAttendance(){},paintAttendance(){}});
  const main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),from=main.indexOf('installAttendanceCamera(window, document);'),until=main.indexOf('window.isProcessingAttendance = false;',from);
  vm.runInContext('let cameraStream=null,currentBranchStaffCache=[];\n'+main.slice(from,until),context);
  const workspace=readFileSync(new URL('../Takodeal-POS/cashier-workspace.js',import.meta.url),'utf8');
  vm.runInContext(workspace.slice(workspace.indexOf('function installClock()'),workspace.indexOf('function stopAttendance()'))+'\ninstallClock();',context);
  async function visibility(hidden){document.hidden=hidden;for(const fn of events.get('visibilitychange')||[])fn();await new Promise(resolve=>setImmediate(resolve));}
  return {window,document,node,visibility,cameraStarts:()=>cameraStarts,photos:()=>photos};
}
test('actual Cashier Clock wrapper remains compatible with attendance capture and legacy save guards',async()=>{
  const h=setup();await h.window.openTimeClockModal();
  const result=await h.window.verifyAttendanceFace();assert.match(result.photoBase64,/sample-photo/);
  assert.equal(h.node('timeClockModal').style.display,'flex');assert.equal(h.window.assertAttendanceFaceFresh(result),true);
  assert.equal(h.cameraStarts(),1);assert.equal(h.photos(),1);
});
test('Clock can restart the camera after a completed punch leaves its inline page open',async()=>{
  const h=setup();await h.window.openTimeClockModal();h.window.closeTimeClock();assert.equal(h.node('clockVideo').srcObject,null);
  await h.window.restartAttendanceCamera();assert.equal(h.cameraStarts(),2);assert.match((await h.window.verifyAttendanceFace()).photoBase64,/sample-photo/);
});
test('returning to visible Clock reacquires the camera and rejects the old proof',async()=>{
  const h=setup();await h.window.openTimeClockModal();const first=await h.window.verifyAttendanceFace();
  await h.visibility(true);assert.throws(()=>h.window.assertAttendanceFaceFresh(first),/Clock open/);
  await h.visibility(false);assert.equal(h.cameraStarts(),2);assert.throws(()=>h.window.assertAttendanceFaceFresh(first),/expired/);
  assert.match((await h.window.verifyAttendanceFace()).photoBase64,/sample-photo/);
});
