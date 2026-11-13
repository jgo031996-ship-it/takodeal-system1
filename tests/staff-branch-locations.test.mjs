import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createBranchZoneLoader,createLocationSession,createClockCamera,installStaffLocation,locationAssessment} from '../takodeal-staff/staff-location.js';

const agdao={lat:7.092761,lng:125.6319357},citygate={lat:7.111076870173231,lng:125.61288375028629},maa={lat:7.078632967828137,lng:125.58344165239423};
const position=(pin=agdao,accuracy=12)=>({timestamp:Date.now(),coords:{latitude:pin.lat,longitude:pin.lng,accuracy}});
const snapshot=rows=>({metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map(row=>({data:()=>row}))});
const rows=()=>[{name:'Agdao',...agdao},{name:'Citygate',...citygate},{name:'Maa',...maa}];
test('Agdao changes from outside-nearest-Citygate to verified using the saved new-branch pin',async()=>{
    const zones={Citygate:{...citygate},Maa:{...maa}},before=locationAssessment(position(),zones);
    assert.equal(before.state,'outside');assert.equal(before.branch,'Citygate');assert.ok(before.distance>1000);
    const original=zones,load=createBranchZoneLoader({zones,read:async()=>snapshot(rows())});await load();
    assert.equal(zones,original);const after=locationAssessment(position(),zones);assert.equal(after.state,'verified');assert.equal(after.branch,'Agdao');assert.equal(after.distance,0);
    assert.equal(locationAssessment(position(agdao,80),zones).state,'refining');
    assert.equal(locationAssessment(position({...agdao,lat:agdao.lat+.001}),zones).state,'outside');
});
test('concurrent location taps share one server read and the memory copy expires within a minute',async()=>{
    let resolve,reads=0,now=100;const zones={},load=createBranchZoneLoader({zones,now:()=>now,read:()=>{reads++;return new Promise(done=>resolve=done);}});
    const first=load(),second=load();await Promise.resolve();assert.equal(reads,1);resolve(snapshot(rows()));await Promise.all([first,second]);
    await load();assert.equal(reads,1);now+=60000;const refreshed=load();await Promise.resolve();assert.equal(reads,2);resolve(snapshot(rows()));await refreshed;
});
test('explicit refresh updates moved pins and removes deleted branches instead of reviving hardcoded coordinates',async()=>{
    const zones={Citygate:{...citygate},Maa:{...maa}};let saved=rows();const load=createBranchZoneLoader({zones,read:async()=>snapshot(saved)});await load();
    saved=[{name:'Agdao',lat:7.2,lng:125.7}];await load({force:true});assert.deepEqual(Object.keys(zones),['Agdao']);assert.deepEqual(zones.Agdao,{lat:7.2,lng:125.7});
});
test('only existing records with both coordinates absent retain an established fallback',async()=>{
    const zones={Maa:{...maa},Citygate:{...citygate},'Main Office':{lat:7.15,lng:125.59}};
    const load=createBranchZoneLoader({zones,read:async()=>snapshot([{name:'Main Office'},{name:'Maa',lat:'',lng:''},{name:'Agdao',...agdao}])});await load();
    assert.deepEqual(Object.keys(zones).sort(),['Agdao','Main Office']);
});
test('strings containing valid coordinates work while null, empty, nonfinite and out-of-range pins never verify',async()=>{
    const zones={};const load=createBranchZoneLoader({zones,read:async()=>snapshot([{name:'Agdao',lat:String(agdao.lat),lng:String(agdao.lng)},{name:'Blank',lat:null,lng:''},{name:'Bad',lat:'NaN',lng:'125'},{name:'Range',lat:91,lng:181},{name:'Boolean',lat:true,lng:false}])});await load();
    assert.deepEqual(Object.keys(zones),['Agdao']);assert.equal(locationAssessment(position(),zones).branch,'Agdao');
});
test('a failed forced refresh invalidates the prior memory result and cannot silently accept old pins on retry',async()=>{
    const zones={};let failure=false,reads=0;const load=createBranchZoneLoader({zones,read:async()=>{reads++;if(failure)throw Error('Synthetic offline');return snapshot(rows());}});
    await load();failure=true;await assert.rejects(load({force:true}),/offline/);await assert.rejects(load(),/offline/);assert.equal(reads,3);
});
test('cache-only, pending-write and duplicate-name maps leave the prior map untouched and never report a refresh',async()=>{
    for(const kind of ['cache','pending','duplicate']) {
        const zones={Maa:{...maa}},saved=snapshot(kind==='duplicate'?[{name:'Agdao',...agdao},{name:'Agdao',...citygate}]:rows());
        saved.metadata.fromCache=kind==='cache';saved.metadata.hasPendingWrites=kind==='pending';
        await assert.rejects(createBranchZoneLoader({zones,read:async()=>saved})());assert.deepEqual(zones,{Maa:maa});
    }
});
test('a bounded loading timeout discards its late server response instead of changing the active map',async()=>{
    let expire,resolve;const zones={Maa:{...maa}},load=createBranchZoneLoader({zones,read:()=>new Promise(done=>resolve=done),delay:fn=>{expire=fn;return 1;},cancelDelay(){}});
    const pending=load();await Promise.resolve();expire();await assert.rejects(pending,/could not be refreshed/);resolve(snapshot(rows()));await new Promise(done=>setImmediate(done));assert.deepEqual(zones,{Maa:maa});
});
function installation(read) {
    const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},dataset:{},textContent:'',classList:{contains:()=>id==='view-timeclock'}});return nodes.get(id);};
    const document={hidden:false,getElementById:node,addEventListener(){}},window={BRANCH_ZONES:{Citygate:{...citygate},Maa:{...maa}},ALLOWED_RADIUS_METERS:50,staffProfile:{branch:'Maa'},addEventListener(){}};
    const geolocation={watchPosition(ok){ok(position());return 1;},getCurrentPosition(){},clearWatch(){}};
    vm.runInNewContext('('+installStaffLocation.toString()+')({loadBranches:read})',{window,document,navigator:{geolocation},read,createBranchZoneLoader,createLocationSession,createClockCamera,locationAssessment,setInterval:()=>0});
    return {window,document,node};
}
test('the actual installed attendance getter loads Agdao before GPS and ignores the home-branch label',async()=>{
    let reads=0;const h=installation(async()=>{reads++;return snapshot(rows());});const fix=await h.window.getAttendanceLocation();
    assert.equal(reads,1);assert.equal(fix.branch,'Agdao');assert.equal(fix.state,'verified');assert.equal(h.window.staffProfile.branch,'Maa');assert.match(h.node('gpsStatus').textContent,/Agdao verified/);
    await h.window.getAttendanceLocation();assert.equal(reads,1);await h.window.refreshGPS();assert.equal(reads,2);h.window.stopCamera();
});
test('unavailable current branch pins stop attendance with a useful error instead of a false Citygate assignment',async()=>{
    const h=installation(async()=>{throw Error('Connect to HQ and retry.');});await assert.rejects(h.window.getAttendanceLocation(),error=>error.code==='attendance/location-branches'&&/Connect to HQ/.test(error.message));
    assert.equal(h.window.currentLat,null);assert.equal(h.window.staffLocationFix,null);assert.match(h.node('gpsStatus').textContent,/Branch locations need attention/);
});
test('leaving Clock while pins load cannot resume a background GPS acquisition',async()=>{
    let resolve;const h=installation(()=>new Promise(done=>resolve=done)),pending=h.window.getAttendanceLocation();await Promise.resolve();h.document.hidden=true;resolve(snapshot(rows()));
    await assert.rejects(pending,/keep the app visible/);assert.equal(h.window.staffLocationFix,null);
});
test('the outside warning describes a nearest saved pin and does not claim it is the staff recorded branch',async()=>{
    const h=installation(async()=>snapshot([{name:'Citygate',...citygate}]));await assert.rejects(h.window.getAttendanceLocation(),error=>error.code==='attendance/location-outside'&&/Nearest saved branch: Citygate/.test(error.message)&&!/Return to the recorded branch/.test(error.message));h.window.stopCamera();
});
test('the actual application supplies a server-only public branch query to location setup',()=>{
    const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');assert.match(source,/installStaffLocation\(\{loadBranches:\(\)=>getDocsFromServer\(collection\(db,'branches'\)\)\}\)/);
});
