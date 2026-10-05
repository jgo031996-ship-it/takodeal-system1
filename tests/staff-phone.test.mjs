import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {locationAssessment,createLocationSession,createClockCamera,installStaffLocation} from '../takodeal-staff/staff-location.js';
import {createDeviceConnection,createDeviceRegistration,installStaffRegistration} from '../takodeal-staff/staff-registration.js';
import {createFleetReader,fleetRows,installDeviceFleet} from '../takodeal-manager/device-fleet.js';
import {waitForAppUpdate} from '../takodeal-staff/app-update.js';
import {installStaffPhone} from '../takodeal-staff/staff-phone.js';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import {createScheduleHistoryStore} from '../takodeal-staff/schedule-history.js';

const zones={Maa:{lat:7.0786417726231425,lng:125.58344120162646}},time=1800000000000;
const position=(accuracy=12,stamp=time,offset=0)=>({timestamp:stamp,coords:{latitude:zones.Maa.lat+offset,longitude:zones.Maa.lng,accuracy}});
function locationHarness(){
    let now=time,watch,quick,timer;const states=[],cleared=[];
    const geolocation={watchPosition:(ok,fail,options)=>{watch={ok,fail,options};return 7;},clearWatch:id=>cleared.push(id),getCurrentPosition:(ok,fail,options)=>{quick={ok,fail,options};}};
    const session=createLocationSession({geolocation,zones,now:()=>now,delay:fn=>{timer=fn;return 1;},cancelDelay(){},onState:s=>states.push(s)});
    return {session,states,cleared,watch:()=>watch,quick:()=>quick,advance:ms=>now+=ms,expire:()=>timer()};
}
test('location rejects stale, missing accuracy, inaccurate and out-of-boundary samples',()=>{
    assert.equal(locationAssessment(position(),zones,50,time).state,'verified');
    assert.equal(locationAssessment(position(200),zones,50,time).state,'refining');
    assert.equal(locationAssessment(position(5,time,.001),zones,50,time).state,'outside');
    assert.equal(locationAssessment(position(5,time-61000),zones,50,time).state,'stale');
    assert.equal(locationAssessment({timestamp:time,coords:{latitude:7,longitude:125}},zones,50,time).state,'invalid');
    assert.equal(locationAssessment(position(5,time+6000),zones,50,time).state,'stale');
});
test('a slow phone can refine a coarse network location after the old six-second deadline',async()=>{
    const h=locationHarness(),pending=h.session.acquire();h.quick().ok(position(900));
    h.advance(16000);h.watch().fail({code:3});assert.equal(h.cleared.length,0);
    h.watch().ok(position(18,time+16000));assert.equal((await pending).state,'verified');assert.deepEqual(h.cleared,[7]);
    assert.equal(h.quick().options.enableHighAccuracy,false);assert.equal(h.watch().options.timeout,30000);
});
test('permission denial stops immediately and never falls back to previously verified coordinates',async()=>{
    const h=locationHarness();let pending=h.session.acquire();h.watch().ok(position());await pending;
    pending=h.session.acquire({force:true});h.watch().fail({code:1});assert.equal((await pending).state,'permission');
    const next=h.session.acquire();h.expire();assert.equal((await next).state,'timeout');
});
test('one bounded watch serves repeated taps and cancelled callbacks cannot revive location',async()=>{
    const h=locationHarness(),pending=h.session.acquire();assert.equal(h.session.acquire({force:true}),pending);
    const old=h.watch();h.session.stop();assert.equal((await pending).state,'cancelled');
    old.ok(position());assert.notEqual(h.states.at(-1).state,'verified');
    const next=h.session.acquire();h.quick().ok(position(100));h.expire();assert.equal((await next).state,'refining');assert.deepEqual(h.cleared,[7,7]);
});
test('attendance must reacquire a location once its timestamp expires',async()=>{
    const h=locationHarness(),first=h.session.acquire();h.watch().ok(position());await first;
    assert.equal((await h.session.acquire()).state,'verified');h.advance(61000);
    const renewed=h.session.acquire();h.watch().ok(position(10,time+61000));assert.equal((await renewed).timestamp,time+61000);
});
test('camera requests are shared, constrained for low-end phones, and late streams are stopped',async()=>{
    let finish,options,calls=0,stopped=0;const streams=[];
    const camera=createClockCamera({mediaDevices:{getUserMedia:o=>{calls++;options=o;return new Promise(r=>finish=r);}},onStream:s=>streams.push(s),onStatus(){}});
    const pending=camera.start();assert.equal(camera.start(),pending);assert.equal(calls,1);
    assert.equal(options.audio,false);assert.equal(options.video.frameRate.max,15);
    camera.stop();finish({getTracks:()=>[{stop(){stopped++;}}]});await pending;assert.equal(stopped,1);assert.deepEqual(streams,[null]);
});
test('an old camera can fall back from unsupported resolution constraints',async()=>{
    let calls=0;const camera=createClockCamera({mediaDevices:{getUserMedia:async()=>{if(!calls++)throw {name:'OverconstrainedError'};return {getTracks:()=>[]};}},onStream(){},onStatus(){}});
    assert.ok(await camera.start());assert.equal(calls,2);camera.stop();
});
function globals(values,body){
    const saved=new Map(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
    for(const [k,value]of Object.entries(values))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
    return Promise.resolve().then(body).finally(()=>{for(const [k,d]of saved)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
}
function domHarness(){
    const nodes=new Map(),listeners=new Map(),store=new Map(),alerts=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,style:{},textContent:'',innerHTML:'',dataset:{},classList:{contains:()=>id==='view-timeclock'}});return nodes.get(id);};
    const document={hidden:false,getElementById:node,querySelector:()=>node('registerButton'),addEventListener:(k,fn)=>listeners.set(k,fn)};
    const window={BRANCH_ZONES:zones,ALLOWED_RADIUS_METERS:50,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789000'},addEventListener:(k,fn)=>listeners.set(k,fn),Swal:{fire:(...args)=>alerts.push(args)},getClosestBranch:()=> 'Maa',lockPayslipVault(){},db:{},doc:()=>null};
    const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
    return {nodes,node,listeners,store,alerts,document,window,localStorage};
}
test('GPS begins while the camera is still waiting and hiding Clock releases resources',async()=>{
    const h=domHarness();let started=0,finish,watch;
    await globals({...h,navigator:{geolocation:{watchPosition:ok=>{started++;watch=ok;return 1;},clearWatch(){},getCurrentPosition(){}},mediaDevices:{getUserMedia:()=>new Promise(r=>finish=r)}},setInterval:()=>1},async()=>{
        installStaffLocation();const pending=h.window.startCameraAndGPS();assert.equal(started,1);
        watch(position(12,Date.now()));h.document.hidden=true;h.listeners.get('visibilitychange')();
        let stopped=0;finish({getTracks:()=>[{stop:()=>stopped++}]});await pending;
        assert.equal(stopped,1);assert.equal(h.window.currentLat,null);assert.equal(h.window.cameraStream,null);
    });
});
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
test('document tools load only on demand, share downloads and preserve original export guards',async()=>{
    const h=domHarness(),scripts=[];let exports=0;
    h.document.createElement=()=>({remove(){}});h.document.head={appendChild:script=>scripts.push(script)};
    for(const name of ['downloadStaffPayslipImage','generateCOE','generateVirtualID'])h.window[name]=()=>exports++;
    await globals({...h,navigator:{},setTimeout:()=>1,clearTimeout(){}},async()=>{
        installStaffPhone();assert.equal(scripts.length,0);
        const first=h.window.generateCOE(),second=h.window.generateVirtualID();
        assert.equal(scripts.length,1);assert.equal(exports,0);
        h.window.html2canvas=()=>{};scripts[0].onload();await Promise.all([first,second]);
        assert.equal(exports,2);await h.window.downloadStaffPayslipImage();assert.equal(scripts.length,1);assert.equal(exports,3);
    });
});
const registration={deviceId:'DEV-123456789',name:'Sample phone',branch:'Maa'};
test('registration creates a pending device with server dates and an existence precondition',async()=>{
    let request;const submit=createDeviceRegistration({projectId:'example',apiKey:'public',fetcher:async(url,options)=>{request={url,options};return response(200,{commitTime:'now'});}});
    assert.equal(await submit(registration),registration.deviceId);
    const write=JSON.parse(request.options.body).writes[0];assert.equal(write.currentDocument.exists,false);
    assert.equal(write.update.fields.status.stringValue,'Pending');assert.equal(write.update.fields.branch.stringValue,'Maa');
    assert.equal(write.updateTransforms[0].setToServerValue,'REQUEST_TIME');
});
test('retry after a lost response reads the same approved device and never rewrites approval',async()=>{
    const calls=[];const submit=createDeviceRegistration({projectId:'example',apiKey:'public',fetcher:async(url,options)=>{calls.push(options);return calls.length===1?response(409,{error:{message:'exists'}}):response(200,{fields:{deviceId:{stringValue:registration.deviceId},status:{stringValue:'Active'}}});}});
    await submit(registration);assert.deepEqual(calls.map(c=>c.method),['POST','GET']);assert.equal(JSON.parse(calls[0].body).writes[0].currentDocument.exists,false);
});
test('registration deadline aborts, provides a useful retry, and clears its timer',async()=>{
    let expire,cleared=0;const submit=createDeviceRegistration({projectId:'example',apiKey:'public',delay:fn=>{expire=fn;return 7;},cancelDelay:()=>cleared++,fetcher:(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject({name:'AbortError'})))});
    const pending=submit(registration);expire();await assert.rejects(pending,/same device ID/);assert.equal(cleared,1);
});
test('manual branch registration works without GPS and failures retain a retryable request',async()=>{
    const h=domHarness();h.node('deviceNameInput').value='Sample phone';h.node('deviceBranchInput').value='Maa';let requests=0,approval;
    h.window.onSnapshot=(_,options,ok)=>{approval=ok;return ()=>{};};h.window.checkNormalLogin=()=>requests++;h.window.listenToIncomingSwaps=()=>{};
    await globals({...h,navigator:{},setTimeout:()=>1,clearTimeout(){}},async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:async()=>{throw Error('offline');}});
        await h.window.requestDeviceAccess();assert.ok(h.store.get('takodeal_staff_registration_draft'));assert.equal(h.store.has('takodeal_device_id'),false);
        assert.equal(h.node('registerButton').disabled,false);assert.match(h.node('deviceRegistrationStatus').textContent,/Not confirmed/);
        h.store.set('takodeal_device_id','DEV-OLD123456');h.window.listenToDeviceStatus('DEV-OLD123456');
        approval({exists:()=>false,metadata:{fromCache:true,hasPendingWrites:false}});assert.equal(h.store.get('takodeal_device_id'),'DEV-OLD123456');
        approval({exists:()=>true,data:()=>({status:'Active'}),metadata:{fromCache:true,hasPendingWrites:true}});assert.equal(requests,0);
        approval({exists:()=>true,data:()=>({status:'Approved'}),metadata:{fromCache:false,hasPendingWrites:false}});assert.equal(requests,1);
    });
});
test('GPS failure in automatic registration never writes a default branch',async()=>{
    const h=domHarness();h.node('deviceNameInput').value='Sample phone';h.node('deviceBranchInput').value='Auto';let writes=0;
    await globals({...h,navigator:{geolocation:{getCurrentPosition:(_,fail)=>fail({message:'Location denied'})}}},async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:async()=>{writes++;return response(200,{});}});
        await h.window.requestDeviceAccess();assert.equal(writes,0);assert.equal(h.store.size,0);assert.equal(h.node('registerButton').disabled,false);
    });
});
test('Fleet keeps older pending requests and undated records, sorts pending first and respects branch access',()=>{
    const devices=Array.from({length:70},(_,i)=>({id:String(i),deviceName:'Phone '+i,branch:'Maa',status:'Active',registeredAt:new Date(time+i)}));
    devices.push({id:'old-pending',deviceName:'Older phone',branch:'Maa',status:'Pending'});
    devices.push({id:'denied',deviceName:'Private branch',branch:'Cabantian',status:'Pending'});
    const html=fleetRows(devices,branch=>branch==='Maa');assert.equal((html.match(/<tr /g)||[]).length,71);assert.match(html.slice(0,1000),/Older phone/);assert.equal(html.includes('Private branch'),false);
    assert.match(fleetRows([{id:'unknown',deviceName:'<script>',status:'Wrong'}]),/Needs review/);assert.equal(fleetRows([{id:'unknown',deviceName:'<script>'}]).includes('<script>'),false);
});
test('live Fleet receives new records without refresh and releases subscription when leaving',async()=>{
    const h=domHarness();let receive,cleared=0;h.window.collection=()=>null;h.window.isBranchAllowed=()=>true;h.window.switchView=()=>{};
    h.window.onSnapshot=(_,options,fn)=>{receive=fn;return ()=>cleared++;};
    await globals({...h},async()=>{
        installDeviceFleet();h.window.switchView('devices');
        const snap=rows=>({metadata:{fromCache:false},forEach:fn=>rows.forEach(d=>fn({id:d.id,data:()=>d}))});
        receive(snap([]));assert.match(h.node('deviceFleetBody').innerHTML,/No devices/);
        receive(snap([{id:'new',deviceName:'New phone',branch:'Maa',status:'Pending'}]));assert.match(h.node('deviceFleetBody').innerHTML,/New phone/);
        h.window.switchView('dashboard');assert.equal(cleared,1);
    });
});
const engine=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
test('Profile history and contracts render without the removed public payroll fields',async()=>{
    const h=domHarness(),errors=[];
    const removed=new Set(['viewSssDed','viewPhDed','viewPagibigDed','viewCustomDed']);
    h.document.getElementById=id=>removed.has(id)?null:h.node(id);
    const source=engine.slice(engine.indexOf('window.openProfile = async function'),engine.indexOf('window.saveProfileData = async function'));
    const context={...h,doc:()=>null,db:{},getDoc:async()=>({exists:()=>true,data:()=>({cashierName:'Sample Staff',role:'Crew'})}),console:{error:(...args)=>errors.push(args)}};
    vm.runInNewContext(source,context);await h.window.openProfile();
    assert.deepEqual(errors,[]);assert.match(h.node('profRoleHistory').innerHTML,/Crew/);
    assert.match(h.node('profContracts').innerHTML,/No signed contracts/);
    assert.equal(h.node('profileModal').style.display,'flex');
});
function punchHarness(fixes){
    let writes=0;const records=[],alerts=[],nodes=new Map();
    const window={getAttendanceLocation:async()=>{const next=fixes.shift();if(next instanceof Error)throw next;return next;},loadMyAttendance(){}};
    const context={...payroll,createScheduleHistoryStore,window,document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,videoWidth:0});return nodes.get(id);}},localStorage:{getItem:key=>key.endsWith('_id')?'staff-id':'Sample Staff'},
        Swal:{fire:(...args)=>alerts.push(args)},doc:()=>({id:'sample'}),collection:()=>({}),query:()=>({}),where:()=>({}),db:{},getDocs:async()=>({forEach(){}}),getDoc:async()=>({exists:()=>false}),serverTimestamp:()=>null,
        writeBatch:()=>({set:(_,record)=>records.push(record),commit:async()=>writes++}),Date,console:{error(){}}};
    Object.assign(window,{db:context.db,query:context.query,collection:context.collection,where:context.where,getDocs:context.getDocs,doc:context.doc,getDoc:context.getDoc});
    const start=engine.indexOf('window.punchTime = async function'),end=engine.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',start);
    vm.runInNewContext(engine.slice(start,end),context);return {window,context,records,alerts,writes:()=>writes};
}
test('attendance never writes on GPS failure or a branch change during proof verification',async()=>{
    const fix=locationAssessment(position(),zones,50,time);
    const failed=punchHarness([Error('Location permission is off')]);await failed.window.punchTime('TIME IN');assert.equal(failed.writes(),0);assert.equal(failed.window.staffPunchBusy,false);
    const moved=punchHarness([fix,{...fix,branch:'Cabantian'}]);await moved.window.punchTime('TIME IN');assert.equal(moved.writes(),0);
    const successful=punchHarness([fix,fix]);await successful.window.punchTime('TIME IN');assert.equal(successful.writes(),1);assert.equal(successful.records[0].locationAccuracyMeters,12);assert.equal(successful.records[0].locationLat,fix.lat);
    assert.equal(successful.records[0].sourceApp,'staff');assert.equal(successful.records[0].recordedByStaffId,'staff-id');
    assert.equal(successful.records[0].scheduleSnapshot.needsScheduleReview,true);
});
test('an unsupported staff punch type cannot create an attendance record or a manual edit',async()=>{
    const h=punchHarness([]);await h.window.punchTime('TIME IN (Manual Edit: System Error)');assert.equal(h.writes(),0);assert.equal(h.records.length,0);
});

const restRecord=(id,status='Pending')=>({name:'projects/example/databases/(default)/documents/pos_devices/'+id,fields:{deviceName:{stringValue:'Sample phone (Staff)'},branch:{stringValue:'Maa'},status:{stringValue:status},registeredAt:{timestampValue:'2026-10-04T10:00:00Z'}}});
function registrationHarness(h){
    h.window.onSnapshot=()=>()=>{};h.window.checkNormalLogin=()=>{h.logins=(h.logins||0)+1;};h.window.listenToIncomingSwaps=()=>{};
    h.store.set('takodeal_device_id',registration.deviceId);
    return {...h,navigator:{},setTimeout:()=>1,clearTimeout(){}};
}
test('an orphaned phone ID recovers the setup form and resubmits the same ID into Fleet',async()=>{
    const h=domHarness(),records=new Map(),calls=[];h.store.set('takodeal_staff_registration_receipt',JSON.stringify(registration));
    const fetcher=async(url,options)=>{
        calls.push(options.method);
        if(options.method==='POST'){
            const write=JSON.parse(options.body).writes[0];
            assert.equal(write.currentDocument.exists,false);
            const id=write.update.name.split('/').pop();records.set(id,{...write.update,fields:{...write.update.fields,registeredAt:{timestampValue:'2026-10-04T10:00:00Z'}}});
            return response(200,{commitTime:'now'});
        }
        const record=records.get(registration.deviceId);return record?response(200,record):response(404,{error:{message:'Not found'}});
    };
    await globals(registrationHarness(h),async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher});
        await h.window.listenToDeviceStatus(registration.deviceId);
        assert.equal(h.store.get('takodeal_device_id'),registration.deviceId);
        assert.equal(h.node('registerCard').style.display,'block');assert.equal(h.node('deviceNameInput').value,registration.name);
        assert.match(h.node('deviceRegistrationStatus').textContent,/HQ has not received/);
        await h.window.requestDeviceAccess();
        assert.equal(h.store.get('takodeal_device_id'),registration.deviceId);assert.equal(records.size,1);
        assert.equal(h.node('devicePendingTitle').textContent,'Request received by HQ');assert.equal(h.logins||0,0);
        const rows=await createFleetReader({projectId:'example',apiKey:'public',fetcher:async()=>response(200,{documents:[...records.values()]})})();
        assert.match(fleetRows(rows),/Pending approval/);assert.match(fleetRows(rows),new RegExp(registration.deviceId));
        assert.deepEqual(calls,['GET','POST','GET']);
    });
});
test('HTTP approval checks work when realtime provides only a cached result',async()=>{
    const h=domHarness();let realtime;
    const context=registrationHarness(h);h.window.onSnapshot=(_,options,fn)=>{realtime=fn;return ()=>{};};
    await globals(context,async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:async()=>response(200,restRecord(registration.deviceId,'Blocked'))});
        const checking=h.window.listenToDeviceStatus(registration.deviceId);
        realtime({metadata:{fromCache:true,hasPendingWrites:false},exists:()=>true,data:()=>({status:'Active'})});
        await checking;assert.equal(h.logins||0,0);assert.equal(h.node('devicePendingTitle').textContent,'Device access paused');
    });
});
test('network failure cannot turn an existing device into an unregistered phone',async()=>{
    const h=domHarness();
    await globals(registrationHarness(h),async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:async()=>{throw Error('offline');}});
        await h.window.listenToDeviceStatus(registration.deviceId);
        assert.equal(h.store.get('takodeal_device_id'),registration.deviceId);assert.equal(h.node('registerCard').style.display,'none');
        assert.equal(h.node('devicePendingTitle').textContent,'Connection to HQ delayed');assert.equal(h.node('deviceRetryButton').hidden,false);
    });
});
test('a newer realtime block wins over a late HTTP approval response',async()=>{
    const h=domHarness();let realtime,finish;
    const context=registrationHarness(h);h.window.onSnapshot=(_,options,fn)=>{realtime=fn;return ()=>{};};
    await globals(context,async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:()=>new Promise(resolve=>finish=resolve)});
        const checking=h.window.listenToDeviceStatus(registration.deviceId);
        realtime({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({status:'Blocked'})});
        finish(response(200,restRecord(registration.deviceId,'Active')));await checking;
        assert.equal(h.logins||0,0);assert.equal(h.node('devicePendingTitle').textContent,'Device access paused');
    });
});
test('an abandoned approval read cannot overwrite the current registration check',async()=>{
    const h=domHarness(),pending=[];
    await globals(registrationHarness(h),async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:()=>new Promise(resolve=>pending.push(resolve))});
        const old=h.window.listenToDeviceStatus(registration.deviceId),current=h.window.listenToDeviceStatus(registration.deviceId);
        pending[1](response(200,restRecord(registration.deviceId,'Pending')));await current;
        pending[0](response(200,restRecord(registration.deviceId,'Active')));await old;
        assert.equal(h.logins||0,0);assert.equal(h.node('devicePendingTitle').textContent,'Request received by HQ');
    });
});
test('permission errors during approval checks are not interpreted as a missing registration',async()=>{
    const read=createDeviceConnection({projectId:'example',apiKey:'public',fetcher:async()=>response(403,{error:{message:'Permission denied'}})}).read;
    await assert.rejects(read(registration.deviceId),/Permission denied/);
});
test('Fleet HTTP fallback loads every page and keeps pending, undated and branch-restricted rows',async()=>{
    const calls=[];const read=createFleetReader({projectId:'example',apiKey:'public',getToken:async()=> 'sample-token',fetcher:async(url,options)=>{
        calls.push({url,options});return response(200,calls.length===1?{documents:[restRecord('older','Active')],nextPageToken:'next/page'}:{documents:[restRecord('pending'),{name:'projects/example/databases/(default)/documents/pos_devices/private',fields:{branch:{stringValue:'Cabantian'},status:{stringValue:'Pending'}}}]});
    }});
    const rows=await read();assert.equal(rows.length,3);assert.match(calls[1].url,/pageToken=next%2Fpage/);assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.headers.Authorization,'Bearer sample-token');
    const html=fleetRows(rows,b=>b==='Maa');assert.match(html.slice(0,900),/pending/);assert.equal(html.includes('private'),false);
});
test('a stalled Fleet uses HTTP confirmation and ignores subsequent stale cache snapshots',async()=>{
    const h=domHarness(),timers=new Map();let next=0,receive;
    h.window.collection=()=>null;h.window.isBranchAllowed=()=>true;h.window.switchView=()=>{};h.window.onSnapshot=(_,options,fn)=>{receive=fn;return ()=>{};};
    await globals({...h,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)},async()=>{
        installDeviceFleet({projectId:'example',apiKey:'public',fetcher:async()=>response(200,{documents:[restRecord('new-pending')]})});
        h.window.loadDeviceFleet();const [id,run]=timers.entries().next().value;timers.delete(id);await run();
        assert.match(h.node('deviceFleetBody').innerHTML,/new-pending/);assert.match(h.node('deviceFleetStatus').textContent,/1 pending approval/);
        receive({metadata:{fromCache:true},forEach(){}});assert.match(h.node('deviceFleetBody').innerHTML,/new-pending/);
        h.window.switchView('dashboard');assert.equal(timers.size,0);
    });
});
test('app update waits for activation and does not reload an installing shell',async()=>{
    let changed,removed=0,cleared=0,finished=false;
    const worker={state:'installing',addEventListener:(name,fn)=>changed=fn,removeEventListener:()=>removed++};
    const pending=waitForAppUpdate({update:async()=>{},installing:worker},{delay:()=>1,cancelDelay:()=>cleared++}).then(()=>finished=true);
    await Promise.resolve();await Promise.resolve();assert.equal(finished,false);
    worker.state='installed';changed();await Promise.resolve();assert.equal(finished,false);
    worker.state='activated';changed();await pending;assert.equal(finished,true);assert.equal(removed,1);assert.equal(cleared,1);
});
test('Staff and Manager ship the same update guard and cache the new helper',()=>{
    const staff=readFileSync(new URL('../takodeal-staff/app-update.js',import.meta.url),'utf8');
    assert.equal(readFileSync(new URL('../takodeal-manager/app-update.js',import.meta.url),'utf8'),staff);
    for(const app of ['takodeal-staff','takodeal-manager'])assert.match(readFileSync(new URL('../'+app+'/sw.js',import.meta.url),'utf8'),/app-update.js/);
});
test('a live approval listener losing its cloud connection resumes HTTP checks',async()=>{
    const h=domHarness(),timers=new Map();let receive,next=0,reads=0;
    const context=registrationHarness(h);context.setTimeout=fn=>{timers.set(++next,fn);return next;};context.clearTimeout=id=>timers.delete(id);
    h.window.onSnapshot=(_,options,fn)=>{receive=fn;return ()=>{};};
    await globals(context,async()=>{
        installStaffRegistration({projectId:'example',apiKey:'public',fetcher:async()=>response(200,restRecord(registration.deviceId,++reads===1?'Pending':'Active'))});
        await h.window.listenToDeviceStatus(registration.deviceId);
        receive({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({status:'Pending'})});
        assert.equal(timers.size,0);
        receive({metadata:{fromCache:true,hasPendingWrites:false},exists:()=>true,data:()=>({status:'Pending'})});
        const [id,run]=timers.entries().next().value;timers.delete(id);await run();
        assert.equal(reads,2);assert.equal(h.logins,1);h.listeners.get('pagehide')();assert.equal(timers.size,0);
    });
});
test('an update timeout leaves no listener and cannot activate a late shell update',async()=>{
    let expire,changed,removed=0;
    const worker={state:'installing',addEventListener:(_,fn)=>changed=fn,removeEventListener:()=>removed++};
    const pending=waitForAppUpdate({update:async()=>{},installing:worker},{delay:fn=>{expire=fn;return 1;},cancelDelay(){}});
    await Promise.resolve();expire();await assert.rejects(pending,/too long/);assert.equal(removed,1);assert.equal(typeof changed,'function');
});
