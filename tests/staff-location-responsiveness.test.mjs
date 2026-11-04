import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createLocationSession,locationAssessment,installStaffLocation,LOCATION_MAX_AGE} from '../takodeal-staff/staff-location.js';

const start=1800000000000,zones={Fictional:{lat:7,lng:125}};
const fix=(at=start,{accuracy=12,offset=0}={})=>({timestamp:at,coords:{latitude:7+offset,longitude:125,accuracy}});
function harness({keepWatching=true}={}){
 let now=start,next=0;const watches=[],quick=[],cleared=[],timers=new Map(),states=[];
 const geolocation={watchPosition(ok,fail,options){const row={id:++next,ok,fail,options};watches.push(row);return row.id;},getCurrentPosition(ok,fail,options){quick.push({ok,fail,options});},clearWatch:id=>cleared.push(id)};
 const session=createLocationSession({geolocation,zones,keepWatching,now:()=>now,delay:fn=>{const id=++next;timers.set(id,fn);return id;},cancelDelay:id=>timers.delete(id),onState:state=>states.push(state)});
 return{session,geolocation,watches,quick,cleared,states,advance:ms=>now+=ms,now:()=>now,expire(){const fn=[...timers.values()][0];assert.ok(fn);fn();}};
}
test('a valid browser-cached location up to the existing 60-second limit is used without changing its timestamp or geofence',async()=>{
 const h=harness(),pending=h.session.acquire();assert.equal(h.quick[0].options.maximumAge,LOCATION_MAX_AGE);assert.equal(h.watches[0].options.maximumAge,15000);h.quick[0].ok(fix(start-50000));const first=await pending;assert.equal(first.state,'verified');assert.equal(first.timestamp,start-50000);assert.equal(first.accuracy,12);assert.ok(first.distance<50);assert.equal(h.cleared.length,0);h.session.stop();assert.equal(h.cleared.length,1);
});
test('an in-flight forced refresh cannot hold a still-fresh verified attendance location for another 45 seconds',async()=>{
 const h=harness(),first=h.session.acquire();h.watches[0].ok(fix());await first;h.advance(1000);const refresh=h.session.acquire({force:true});assert.equal(h.watches.length,2);assert.equal(h.session.acquire({force:true}),refresh);const cached=await h.session.acquire();assert.equal(cached.state,'verified');assert.equal(cached.timestamp,start);assert.equal(h.watches.length,2);h.watches[1].ok(fix(start+1000));assert.equal((await refresh).timestamp,start+1000);h.session.stop();
});
test('one visible watch supplies newly captured fixes after a long proof delay without opening a second location request',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix());await pending;h.advance(70000);h.watches[0].ok(fix(start+70000,{accuracy:9}));const refreshed=await h.session.acquire();assert.equal(refreshed.timestamp,start+70000);assert.equal(refreshed.accuracy,9);assert.equal(h.watches.length,1);assert.equal(h.quick.length,1);assert.equal(h.cleared.length,0);h.session.stop();assert.deepEqual(h.cleared,[h.watches[0].id]);
});
test('a later accurate outside fix invalidates the earlier verified coordinates and only a new inside fix can restore them',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix(start,{accuracy:5}));await pending;h.advance(1000);h.watches[0].ok(fix(start+1000,{accuracy:40,offset:0.001}));const outside=await h.session.acquire();assert.equal(outside.state,'outside');assert.ok(outside.distance>50);assert.equal(h.watches.length,1);h.advance(1000);h.watches[0].ok(fix(start+2000,{accuracy:10}));assert.equal((await h.session.acquire()).timestamp,start+2000);h.session.stop();
});
test('a coarse provider update keeps only the original still-valid fix and cannot extend its 60-second lifetime',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix());await pending;h.advance(1000);h.watches[0].ok(fix(start+1000,{accuracy:300}));assert.equal((await h.session.acquire()).timestamp,start);h.advance(60000);const retry=h.session.acquire();assert.equal(h.watches.length,2);assert.deepEqual(h.cleared,[h.watches[0].id]);h.watches[1].fail({code:1});assert.equal((await retry).state,'permission');h.session.stop();
});
test('permission revocation immediately clears the retained watch and prevents fallback to its earlier verified sample',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix());await pending;h.watches[0].fail({code:1});assert.equal(h.states.at(-1).state,'permission');assert.deepEqual(h.cleared,[h.watches[0].id]);const retry=h.session.acquire();assert.equal(h.watches.length,2);h.watches[1].fail({code:1});assert.equal((await retry).state,'permission');h.session.stop();
});
test('leaving Clock cancels one pending request, releases its watch, and ignores all late callbacks from an earlier screen',async()=>{
 const h=harness(),pending=h.session.acquire(),old=h.watches[0];h.session.stop();assert.equal((await pending).state,'cancelled');const count=h.states.length;old.ok(fix());old.fail({code:1});assert.equal(h.states.length,count);assert.deepEqual(h.cleared,[old.id]);
 const retry=h.session.acquire();h.watches[1].ok(fix());await retry;h.session.stop();h.watches[1].ok(fix());assert.equal(h.watches.length,2);assert.equal(h.cleared.length,2);
});
test('the 45-second wait stays bounded while the visible watch can recover afterward for an explicit retry',async()=>{
 const h=harness(),pending=h.session.acquire();h.advance(45000);h.expire();assert.equal((await pending).state,'timeout');assert.equal(h.cleared.length,0);h.watches[0].ok(fix(start+45000));assert.equal((await h.session.acquire()).state,'verified');assert.equal(h.watches.length,1);h.session.stop();
});
test('stale, future, malformed and inaccurate fixes never become verified attendance coordinates',async()=>{
 const h=harness(),pending=h.session.acquire();for(const position of [fix(start-61000),fix(start+6000),fix(start,{accuracy:100}),{timestamp:start,coords:{latitude:7,longitude:125}}])h.watches[0].ok(position);h.expire();assert.equal((await pending).state,'refining');assert.equal(h.states.some(state=>state.state==='verified'),false);h.session.stop();
});
test('a synchronous native watch callback is retained and its real ID is released once when Clock closes',async()=>{
 const cleared=[];const session=createLocationSession({geolocation:{watchPosition(ok){ok(fix());return 42;},clearWatch:id=>cleared.push(id),getCurrentPosition(){assert.fail('No second acquisition after an immediate valid fix');}},zones,keepWatching:true,now:()=>start});assert.equal((await session.acquire()).state,'verified');assert.deepEqual(cleared,[]);session.stop();assert.deepEqual(cleared,[42]);
});
test('a browser security exception cannot reuse coordinates captured before its permission was revoked',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix());await pending;h.geolocation.watchPosition=()=>{throw Object.assign(Error('Synthetic permission revoked'),{name:'SecurityError'});};assert.equal((await h.session.acquire({force:true})).state,'permission');assert.equal((await h.session.acquire()).state,'permission');h.session.stop();
});
test('a newer coarse response cannot suppress a still-fresh accurate cached location arriving afterward',async()=>{
 const h=harness(),pending=h.session.acquire();h.quick[0].ok(fix(start,{accuracy:300}));h.watches[0].ok(fix(start-1000,{accuracy:8}));const verified=await pending;assert.equal(verified.state,'verified');assert.equal(verified.timestamp,start-1000);assert.equal(verified.accuracy,8);h.session.stop();
});
test('coarse updates cannot erase newer accurate outside evidence and allow an older inside fix to pass',async()=>{
 const h=harness(),pending=h.session.acquire();h.watches[0].ok(fix());await pending;h.advance(2000);h.watches[0].ok(fix(start+1000,{offset:0.001,accuracy:20}));h.watches[0].ok(fix(start+2000,{accuracy:300}));h.watches[0].ok(fix(start+500,{accuracy:5}));assert.equal((await h.session.acquire()).state,'outside');h.watches[0].ok(fix(start+2000,{accuracy:10}));assert.equal((await h.session.acquire()).state,'verified');h.session.stop();
});

function installation(acquire){
 const nodes=new Map(),listeners=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},dataset:{},textContent:'',classList:{contains:()=>id==='view-timeclock'}});return nodes.get(id);};
 const document={hidden:false,getElementById:node,addEventListener:(name,fn)=>listeners.set(name,fn)},window={BRANCH_ZONES:zones,ALLOWED_RADIUS_METERS:50,addEventListener:(name,fn)=>listeners.set(name,fn)};
 const context={window,document,navigator:{},locationAssessment,createLocationSession:()=>({acquire,stop(){}}),createClockCamera:()=>({start(){},stop(){}}),setInterval:()=>0,Date};vm.runInNewContext('('+installStaffLocation.toString()+')()',context);return{window,document,node,listeners};
}
test('the actual Staff location getter includes actionable permission guidance and a structured failure code',async()=>{
 const h=installation(async()=>({state:'permission',title:'Location permission is off',hint:'Allow Location for this site, then tap Refresh location.'}));await assert.rejects(h.window.getAttendanceLocation(),error=>error.code==='attendance/location-permission'&&/Allow Location.*Refresh location/.test(error.message));
});
test('a closed Clock or a verified result whose original timestamp expired cannot pass the actual Staff getter',async()=>{
 const position={state:'verified',branch:'Fictional',lat:7,lng:125,accuracy:10,distance:0,timestamp:Date.now()-61000},h=installation(async()=>position);await assert.rejects(h.window.getAttendanceLocation(),error=>error.code==='attendance/location-expired');
 let finish;const hidden=installation(()=>new Promise(resolve=>finish=resolve));const pending=hidden.window.getAttendanceLocation();hidden.document.hidden=true;finish({...position,timestamp:Date.now()});await assert.rejects(pending,/keep the app visible/);
});
