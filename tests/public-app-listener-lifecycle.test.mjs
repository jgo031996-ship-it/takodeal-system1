import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import {createScheduleHistoryStore} from '../takodeal-staff/schedule-history.js';
import * as sanctions from '../takodeal-staff/sanction-schedule.js';

const staff = readFileSync(new URL('../takodeal-staff/app.js', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
const customer = readFileSync(new URL('../Customer/index.html', import.meta.url), 'utf8');
const rider = readFileSync(new URL('../takodeal-delivery/main.js', import.meta.url), 'utf8');
const cashier = readFileSync(new URL('../Takodeal-POS/main.js', import.meta.url), 'utf8');
const registration = readFileSync(new URL('../takodeal-staff/staff-registration.js', import.meta.url), 'utf8');
const section = (source, start, end) => {const at=source.indexOf(start);assert.ok(at>=0,start);const until=source.indexOf(end,at);assert.ok(until>at,end);return source.slice(at,until);};
const snapshot = rows => ({empty:!rows.length, docs:rows.map(row=>({id:row.id, data:()=>row})), forEach(fn){this.docs.forEach(fn);}});

function harness() {
    const nodes=new Map(),storage=new Map(),subscriptions=[],intervals=new Map(),timeouts=new Map(),events=new Map(),writes=[],gps=[];
    let sequence=0,profileReads=0,serverReads=0;
    const node=id=>{
        if (!nodes.has(id)) {const classes=new Set(['hidden']);nodes.set(id,{id,value:'',dataset:{},style:{display:'none'},innerHTML:'',innerText:'',textContent:'',disabled:false,videoWidth:0,
            classList:{add:(...args)=>args.forEach(v=>classes.add(v)),remove:(...args)=>args.forEach(v=>classes.delete(v)),contains:v=>classes.has(v)},
            parentElement:{insertAdjacentElement(){}},insertBefore(){},getContext:()=>({clearRect(){}})});}
        return nodes.get(id);
    };
    const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
    const api={db:{},collection:(_db,table)=>({table}),doc:(ref,table,id)=>id===undefined?{table:ref.table,id:'auto-'+(++sequence)}:{table,id},
        query:(ref,...filters)=>({...ref,filters}),where:(field,op,value)=>({field,op,value}),orderBy:()=>({}),
        getDoc:async ref=>{if(ref.table==='cashiers'){profileReads++;return {exists:()=>true,data:()=>({cashierName:storage.get('takodeal_staff_name'),scheduleNickname:'Alias'})};}return {exists:()=>false};},
        getDocs:async()=>snapshot([]),getDocsFromServer:async q=>{serverReads++;if(h.serverError)throw h.serverError;return h.serverSnapshot || snapshot([]);},
        onSnapshot:(q,options,next,error)=>{if(typeof options==='function'){error=next;next=options;}const sub={q,next,error,active:true,stops:0};subscriptions.push(sub);return ()=>{sub.active=false;sub.stops++;};},
        serverTimestamp:()=>new Date(),updateDoc:async(ref,data)=>writes.push({ref,data}),
        writeBatch(){const changes=[];return {set:(ref,data)=>changes.push({ref,data}),async commit(){writes.push(...changes);}};}};
    const addEventListener=(name,callback)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(callback);};
    const window={...api,addEventListener,location:{reload(){}},initStaffAppSignaturePad(){},playNotificationPing(){},loadMyAttendance(){},
        getAttendanceLocation:async()=>({branch:'Maa',distance:1,accuracy:10,lat:7,lng:125,timestamp:Date.now()})};
    const context={...api,...payroll,...sanctions,createScheduleHistoryStore,window,localStorage,document:{getElementById:node,addEventListener,querySelector:()=>null,querySelectorAll:()=>[]},
        console:{error(){},warn(){},log(){}},Date,
        setInterval:(fn,delay)=>{const id=++sequence;intervals.set(id,{fn,delay});return id;},clearInterval:id=>intervals.delete(id),
        setTimeout:(fn,delay)=>{const id=++sequence;timeouts.set(id,{fn,delay});return id;},clearTimeout:id=>timeouts.delete(id),
        Swal:{fire:async()=>({isConfirmed:true}),getPopup:()=>null,close(){},showLoading(){},DismissReason:{cancel:'cancel'}},
        navigator:{geolocation:{getCurrentPosition:(ok,fail)=>gps.push({ok,fail})}},alert(){},confirm:()=>true,
        Audio:class {play(){return Promise.resolve();}pause(){this.paused=true;}}};
    const sandbox=vm.createContext(context);
    context.startPhilippineDayTimer=changed=>sanctions.startPhilippineDayTimer(changed,{schedule:context.setTimeout,cancel:context.clearTimeout});
    const h={window,context,sandbox,node,storage,subscriptions,intervals,timeouts,events,writes,gps,api,
        run:source=>vm.runInContext(source,sandbox),emit:(sub,rows)=>sub.next(snapshot(rows.map(row=>sub.q.table==='hr_sanctions'&&!Object.hasOwn(row,'status')?{...row,status:'Pending Reply'}:row))),
        event:(name,data={})=>events.get(name)?.forEach(fn=>fn(data)),get profileReads(){return profileReads;},get serverReads(){return serverReads;}};
    return h;
}
function staffApp() {
    const h=harness();h.storage.set('takodeal_staff_name','Staff A');h.storage.set('takodeal_staff_id','a');
    h.run(section(staff,'window.staffLiveListenerEpoch = 0;','// =======================================================\n// 🧠 TAKODEAL GLOBAL CACHE ENGINE'));
    h.run(section(staff,'window.startInboxListener = function()','// ==========================================\n// 📥 STAFF INBOX'));
    h.run(section(staff,'window.listenToIncomingSwaps = async function()','window.handleIncomingSwap = async function'));
    h.run(section(staff,'window.renderActiveSanctions = function','window.submitStaffAppSanctionReply = async function'));
    return h;
}
async function startStaff(h) {h.window.startInboxListener();await h.window.listenToIncomingSwaps();h.window.startSanctionListener(h.storage.get('takodeal_staff_name'));}

test('Staff login initialization creates one inbox, swap and staff-scoped sanction listener with no polling reads',async()=>{
    const h=staffApp();await Promise.all([startStaff(h),startStaff(h),startStaff(h)]);
    assert.equal(h.subscriptions.length,3);assert.equal(h.profileReads,1);assert.equal(h.serverReads,0);assert.equal(h.intervals.size,0);
    const sanction=h.subscriptions.find(s=>s.q.table==='hr_sanctions');
    assert.deepEqual(sanction.q.filters,[{field:'staffName',op:'==',value:'Staff A'}]);
    h.emit(sanction,[{id:'notice',type:'Notice'}]);h.node('sanctionStaffReply').value='My draft';h.window.hasSignedStaffNTE=true;
    h.emit(sanction,[{id:'notice',details:'Updated details'}]);
    assert.equal(h.node('sanctionStaffReply').value,'My draft');assert.equal(h.window.hasSignedStaffNTE,true);
});

test('Staff account switch releases all streams and old snapshots cannot replace the next staff notice',async()=>{
    const h=staffApp();await startStaff(h);const old=[...h.subscriptions];h.window.stopStaffLiveListeners();
    assert.equal(old.filter(s=>s.active).length,0);assert.equal(old.every(s=>s.stops===1),true);
    h.storage.set('takodeal_staff_id','b');h.storage.set('takodeal_staff_name','Staff B');await startStaff(h);
    const fresh=h.subscriptions.findLast(s=>s.q.table==='hr_sanctions');h.emit(fresh,[{id:'b-notice'}]);
    old.forEach(s=>h.emit(s,[{id:'a-old',status:'Approved'}]));
    assert.equal(h.node('activeSanctionId').value,'b-notice');assert.equal(h.subscriptions.filter(s=>s.active).length,3);
});

test('Staff deferred nickname lookup is deduplicated and cannot attach a listener after sign-out',async()=>{
    const h=staffApp();let finish;h.context.getDoc=()=>new Promise(resolve=>{finish=resolve;});
    const pending=h.window.listenToIncomingSwaps();await h.window.listenToIncomingSwaps();h.window.stopStaffLiveListeners();
    finish({exists:()=>true,data:()=>({scheduleNickname:'Alias'})});await pending;assert.equal(h.subscriptions.length,0);
});

test('Staff restores exactly one subscription set after browser back navigation',async()=>{
    const h=staffApp();await startStaff(h);h.event('pagehide');assert.equal(h.subscriptions.filter(s=>s.active).length,0);
    h.event('pageshow',{persisted:true});await new Promise(setImmediate);
    assert.equal(h.subscriptions.filter(s=>s.active).length,3);
});

test('Staff device approval or block checks detach the signed-in streams while the app is paused',async()=>{
    const h=staffApp();await startStaff(h);const old=[...h.subscriptions];h.context.AbortController=AbortController;
    h.context.registrationConfig={projectId:'fixture',apiKey:'public',fetcher:async()=>({ok:true,json:async()=>({fields:{status:{stringValue:'Pending'}}})})};
    h.run(registration.replace(/^export /gm,''));h.run('installStaffRegistration(registrationConfig);');
    await h.window.listenToDeviceStatus('DEV-MOCK-1234');
    assert.equal(old.every(s=>s.stops===1),true);assert.equal(h.node('appContainer').style.display,'none');
    assert.equal(h.subscriptions.filter(s=>s.active).length,1);h.event('pagehide');assert.equal(h.subscriptions.filter(s=>s.active).length,0);
});

test('Staff delayed fresh HR check refuses the previous identity after the account changes',async()=>{
    const h=staffApp();let finish;h.context.getDocsFromServer=()=>new Promise(resolve=>{finish=resolve;});
    const checking=h.window.checkActiveSanctions('Staff A',{requireFresh:true});h.window.stopStaffLiveListeners();h.storage.set('takodeal_staff_id','b');h.storage.set('takodeal_staff_name','Staff B');
    finish(snapshot([{id:'private-a'}]));await assert.rejects(checking,/session changed/);assert.equal(h.node('activeSanctionId').value,'');
});

test('Staff Time In checks the server despite an empty live cache and denies writes for a pending notice or offline check',async()=>{
    for (const failure of ['notice','offline']) {
        const h=staffApp();h.window.startSanctionListener('Staff A');h.emit(h.subscriptions[0],[]);
        if(failure==='notice')h.serverSnapshot=snapshot([{id:'new-notice',type:'NTE',status:'Pending Reply'}]);else h.serverError=Error('HQ is unavailable');
        h.run(section(staff,'window.punchTime = async function','// 📥 STAFF REQUESTS & INBOX ENGINE'));
        await h.window.punchTime('TIME IN');assert.equal(h.serverReads,1);assert.equal(h.writes.length,0);assert.equal(h.window.staffPunchBusy,false);
        if(failure==='notice')assert.equal(h.node('staffAppSanctionModal').style.display,'flex');
    }
    const h=staffApp();h.run(section(staff,'window.punchTime = async function','// 📥 STAFF REQUESTS & INBOX ENGINE'));
    await h.window.punchTime('TIME IN');assert.equal(h.serverReads,1);assert.equal(h.writes.filter(w=>w.ref.table==='attendance_logs').length,1);
});

test('Staff waits for a slow HR read before reacquiring final GPS and constructing the saved punch',async()=>{
    const h=staffApp(),order=[];let finish;
    h.window.getAttendanceLocation=async()=>{order.push('GPS');return {branch:'Maa',distance:1,accuracy:10,lat:7,lng:125,timestamp:Date.now()};};
    h.context.getDocsFromServer=()=>{order.push('HR pending');return new Promise(resolve=>{finish=()=>{order.push('HR completed');resolve(snapshot([]));};});};
    h.run(section(staff,'window.punchTime = async function','// 📥 STAFF REQUESTS & INBOX ENGINE'));
    const punching=h.window.punchTime('TIME IN');await new Promise(setImmediate);
    assert.deepEqual(order,['GPS','HR pending']);assert.equal(h.writes.length,0);
    finish();await punching;assert.deepEqual(order,['GPS','HR pending','HR completed','GPS']);assert.equal(h.writes.filter(w=>w.ref.table==='attendance_logs').length,1);
});
test('Staff can record Time Out without reading or requiring a reply to its due HR notice',async()=>{
    const h=staffApp();h.window.startSanctionListener('Staff A');h.emit(h.subscriptions[0],[{id:'due',status:'Pending Reply'}]);
    const history=async q=>snapshot(q.table==='attendance_logs'?[{id:'in',staffName:'Staff A',type:'TIME IN',timestamp:new Date(Date.now()-8*3600000)}]:q.table==='sop_logs'?[{id:'sop',staffName:'Staff A',timestamp:{toDate:()=>new Date()}}]:[]);h.window.getDocs=history;h.context.getDocs=history;
    h.serverError=Error('HR should not be fetched for Time Out');h.run(section(staff,'window.punchTime = async function','// 📥 STAFF REQUESTS & INBOX ENGINE'));
    await h.window.punchTime('TIME OUT');assert.equal(h.serverReads,0);assert.equal(h.writes.filter(w=>w.ref.table==='attendance_logs').length,1);assert.equal(h.writes.find(w=>w.ref.table==='attendance_logs').data.type,'TIME OUT');
});
test('Staff cached future notice is visible as due at midnight with no new cloud read, and cleanup cancels the timer',async()=>{
    const h=staffApp();let time=new Date('2026-10-07T15:59:00Z');h.context.pendingDueNotices=rows=>sanctions.pendingDueNotices(rows,time);
    h.context.startPhilippineDayTimer=changed=>sanctions.startPhilippineDayTimer(changed,{now:()=>time,schedule:h.context.setTimeout,cancel:h.context.clearTimeout});
    h.window.startSanctionListener('Staff A');h.emit(h.subscriptions[0],[{id:'future',status:'Pending Reply',effectiveDate:'2026-10-08'}]);assert.equal(h.node('staffAppSanctionModal').style.display,'none');
    const [midnightId,midnight]=[...h.timeouts].find(([,timer])=>timer.delay===60050);assert.ok(midnight);time=new Date('2026-10-07T16:00:01Z');h.timeouts.delete(midnightId);midnight.fn();assert.equal(h.node('staffAppSanctionModal').style.display,'flex');assert.equal(h.serverReads,0);
    h.window.stopStaffLiveListeners();assert.equal(h.timeouts.size,0);
});
test('Cashier uses one notice stream, responds at PH midnight and prevents stale account callbacks or timers',async()=>{
    const h=harness();h.storage.set('cashierName','Staff A');h.window.initSignaturePad=()=>{};let time=new Date('2026-10-07T15:59:00Z');h.context.pendingDueNotices=rows=>sanctions.pendingDueNotices(rows,time);
    h.context.startPhilippineDayTimer=changed=>sanctions.startPhilippineDayTimer(changed,{now:()=>time,schedule:h.context.setTimeout,cancel:h.context.clearTimeout});
    h.run(section(cashier,'window.stopCashierSanctions = function()','window.submitSanctionReply = async function'));
    await h.window.checkActiveSanctions('Staff A');await h.window.checkActiveSanctions('Staff A');assert.equal(h.subscriptions.length,1);const old=h.subscriptions[0];h.emit(old,[{id:'future',effectiveDate:'2026-10-08',status:'Pending Reply'}]);assert.equal(h.node('hrSanctionModal').style.display,'none');
    const [timerId,timer]=[...h.timeouts].find(([,row])=>row.delay===60050);h.timeouts.delete(timerId);time=new Date('2026-10-07T16:00:00Z');timer.fn();assert.equal(h.node('hrSanctionModal').style.display,'flex');const stalePad=[...h.timeouts.values()].find(row=>row.delay===300).fn;
    h.storage.set('cashierName','Staff B');await h.window.checkActiveSanctions('Staff B');h.emit(h.subscriptions[1],[{id:'b',status:'Pending Reply'}]);const newPad=h.window.cashierSanctionPadTimer;h.emit(old,[{id:'old-a',status:'Pending Reply'}]);stalePad();assert.equal(h.node('activeSanctionId').value,'b');assert.equal(h.window.cashierSanctionPadTimer,newPad);assert.equal(old.stops,1);assert.equal(h.serverReads,0);
    h.window.stopCashierSanctions();assert.equal(h.subscriptions[1].stops,1);assert.equal(h.timeouts.size,0);assert.equal(h.node('hrSanctionModal').style.display,'none');
});

function customerApp() {
    const h=harness();h.context.onAuthStateChanged=(_auth,fn)=>{h.authChanged=fn;};h.context.auth={};
    h.window.promptReview=()=>{};h.window.renderUserProfile=()=>{};
    h.run(section(customer,'window.customerTrackerEpoch = 0;','window.rawMenuCache = []'));
    h.run(section(customer,'window.startOrderTracker = function(email)','window.promptReview = function'));
    h.run(section(customer,'window.confirmOrderReceived = async function','window.loadReviewsPage = async function'));
    return h;
}
const user=(id='a')=>({uid:id,email:id+'@example.invalid',displayName:id});
const prep={id:'order-a',status:'preparing',acceptedAt:new Date(),prepTime:5,timestamp:new Date(),orderCode:'A'};

test('Customer tracker starts once for the current Google identity and sign-out stops its listener and timers',()=>{
    const h=customerApp();h.authChanged(user());h.authChanged(user());h.window.startOrderTracker(user().email);assert.equal(h.subscriptions.length,1);
    h.emit(h.subscriptions[0],[prep]);assert.equal(h.intervals.size,1);assert.equal(h.timeouts.size,1);
    h.authChanged(null);assert.equal(h.subscriptions[0].stops,1);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
    assert.equal(h.window.activeTrackedOrderId,null);assert.equal(h.node('liveOrderTracker').classList.contains('hidden'),true);
    h.emit(h.subscriptions[0],[prep]);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);assert.equal(h.window.activeTrackedOrderId,null);
});

test('Customer account switch invalidates queued old listener and timer callbacks and retains email-scoped queries',()=>{
    const h=customerApp();h.authChanged(user('a'));h.emit(h.subscriptions[0],[prep]);const timer=[...h.intervals.values()][0].fn,reveal=[...h.timeouts.values()][0].fn;
    h.authChanged(user('b'));h.emit(h.subscriptions[1],[{...prep,id:'order-b',orderCode:'B',status:'ready'}]);
    const currentText=h.node('trackerTime').innerText, currentReveal=h.window.customerTrackerRevealTimer;timer();reveal();h.emit(h.subscriptions[0],[prep]);
    assert.equal(h.window.activeTrackedOrderId,'order-b');assert.equal(h.node('trackerTime').innerText,currentText);assert.equal(h.intervals.size,0);
    assert.equal(h.window.customerTrackerRevealTimer,currentReveal);
    assert.equal(h.subscriptions[1].q.filters[0].value,'b@example.invalid');
});

test('Customer empty or finished order snapshots stop countdowns and cannot leave a confirmable old order',async()=>{
    const h=customerApp();h.authChanged(user());h.emit(h.subscriptions[0],[prep]);h.emit(h.subscriptions[0],[]);
    assert.equal(h.intervals.size,0);assert.equal(h.window.activeTrackedOrderId,null);
    h.emit(h.subscriptions[0],[prep]);h.emit(h.subscriptions[0],[{...prep,status:'completed',reviewPrompted:true}]);
    assert.equal(h.intervals.size,0);assert.equal(h.window.activeTrackedOrderId,null);await h.window.confirmOrderReceived();assert.equal(h.writes.length,0);
});

test('Customer slow order confirmation cannot leave the next account disabled or unlock its separate confirmation',async()=>{
    const h=customerApp(),finish=new Map(),calls=[];h.context.updateDoc=ref=>{calls.push(ref.id);return new Promise(resolve=>finish.set(ref.id,resolve));};
    h.authChanged(user('a'));h.emit(h.subscriptions[0],[{...prep,status:'ready'}]);h.node('btnOrderReceived').innerText='Order received';
    const first=h.window.confirmOrderReceived();assert.equal(h.node('btnOrderReceived').disabled,true);
    h.authChanged(user('b'));assert.equal(h.node('btnOrderReceived').disabled,false);assert.equal(h.node('btnOrderReceived').innerText,'Order received');
    h.emit(h.subscriptions[1],[{...prep,id:'order-b',status:'ready'}]);const second=h.window.confirmOrderReceived();
    finish.get('order-a')();await first;assert.equal(h.window.isConfirmingOrderReceived,true);assert.equal(h.node('btnOrderReceived').disabled,true);
    finish.get('order-b')();await second;assert.equal(h.window.isConfirmingOrderReceived,false);assert.equal(h.node('btnOrderReceived').disabled,false);assert.deepEqual(calls,['order-a','order-b']);
});

test('Customer old profile history fetch cannot render or fetch loyalty after an account switch',async()=>{
    const h=customerApp();h.authChanged(user('a'));let finish,reads=0;
    h.context.getDocs=()=>{reads++;return new Promise(resolve=>{finish=resolve;});};
    h.run(section(customer,'window.renderUserProfile = async function','window.logoutCustomer = async function'));
    const pending=h.window.renderUserProfile();h.authChanged(user('b'));finish(snapshot([{id:'private-a',orderCode:'private-a'}]));await pending;
    assert.equal(reads,1);assert.equal(h.node('orderHistoryList').innerHTML.includes('private-a'),false);
});

test('Customer back navigation restores one tracker instead of leaving a detached or duplicated stream',()=>{
    const h=customerApp();h.authChanged(user());h.event('pagehide');h.event('pageshow',{persisted:true});
    assert.equal(h.subscriptions.length,2);assert.equal(h.subscriptions.filter(s=>s.active).length,1);
});

function riderApp() {const h=harness();h.run(rider.slice(rider.indexOf('window.currentRider = null;')));h.window.currentRider={id:'rider-a',name:'Rider A',walletBalance:100};return h;}
function startRider(h) {h.window.startLiveGPS();h.window.listenForPings();h.run('startDispatchListener();');}
test('Rider repeated initialization starts one GPS timer, one ping listener and two correctly scoped dispatch streams',()=>{
    const h=riderApp();startRider(h);startRider(h);startRider(h);
    assert.equal(h.intervals.size,1);assert.equal(h.subscriptions.length,3);
    const claimed=h.subscriptions.find(s=>s.q.filters.some(f=>f.field==='riderId'));
    assert.deepEqual(claimed.q.filters,[{field:'status',op:'==',value:'out_for_delivery'},{field:'riderId',op:'==',value:'rider-a'}]);
    const ready=h.subscriptions.find(s=>s.q.filters.some(f=>f.value==='ready'));
    h.emit(ready,[{id:'any-branch',status:'ready',branch:'Cabantian'}]);
    h.emit(claimed,[{id:'mine',status:'out_for_delivery',riderId:'rider-a'},{id:'other',status:'out_for_delivery',riderId:'rider-b'}]);
    assert.deepEqual([...h.window.activeDeliveries].map(o=>o.id),['mine','any-branch']);
});

test('Rider manual login starts its dispatch board and logout releases every live service',async()=>{
    const h=riderApp();h.window.currentRider=null;h.node('loginPhone').value='09000000000';h.node('loginPin').value='fixture';
    h.context.getDocs=async()=>snapshot([{id:'manual',name:'Manual Rider',walletBalance:100,status:'approved'}]);
    await h.window.loginRider();assert.equal(h.window.currentRider.id,'manual');assert.equal(h.subscriptions.filter(s=>s.active).length,3);assert.equal(h.intervals.size,1);
    h.window.logoutRider();assert.equal(h.window.currentRider,null);assert.equal(h.subscriptions.filter(s=>s.active).length,0);assert.equal(h.intervals.size,0);
});

test('Rider dispatch error stops both feeds, offers retry and old callbacks cannot contaminate the restarted board',()=>{
    const h=riderApp();startRider(h);const old=h.subscriptions.filter(s=>!s.q.filters.some(f=>f.field==='pingedRider'));
    old.find(s=>s.q.filters.some(f=>f.field==='riderId')).error(Error('Temporary query failure'));
    assert.equal(old.every(s=>s.stops===1),true);assert.equal(h.window.riderDispatchListenerKey,null);assert.match(h.node('dispatchBoard').innerHTML,/Retry delivery updates/);
    h.window.startDispatchListener();assert.equal(h.subscriptions.filter(s=>s.active).length,3);assert.equal(h.intervals.size,1);
    const fresh=h.subscriptions.findLast(s=>s.q.filters.some(f=>f.field==='riderId'));
    h.emit(fresh,[{id:'current-job',status:'out_for_delivery',riderId:'rider-a'}]);
    old.forEach(s=>h.emit(s,[{id:'old-job',status:'ready'}]));assert.deepEqual([...h.window.activeDeliveries].map(o=>o.id),['current-job']);
    h.event('online');assert.equal(h.subscriptions.filter(s=>s.active).length,3);assert.equal(h.subscriptions.length,5);
});

test('Rider GPS does not overlap requests or write another account after a late location callback',async()=>{
    const h=riderApp();startRider(h);h.node('statusToggle').innerText='ONLINE';const tick=[...h.intervals.values()][0].fn;
    tick();tick();assert.equal(h.gps.length,1);
    h.window.stopRiderLiveServices();h.window.currentRider={id:'rider-b'};startRider(h);
    await h.gps[0].ok({coords:{latitude:7,longitude:125}});assert.equal(h.writes.length,0);
    assert.equal(h.subscriptions.filter(s=>s.active).length,3);assert.equal(h.intervals.size,1);
});

test('Rider stream callbacks from the previous identity cannot repopulate jobs or ring after cleanup',()=>{
    const h=riderApp();startRider(h);const old=[...h.subscriptions];h.window.stopRiderLiveServices();h.window.currentRider={id:'rider-b'};startRider(h);
    const ping=old.find(s=>s.q.filters.some(f=>f.field==='pingedRider'));
    ping.next({docChanges:()=>[{type:'added',doc:{id:'old-ping',data:()=>({})}}]});
    old.filter(s=>s!==ping).forEach(s=>h.emit(s,[{id:'old-job',status:'ready'}]));
    assert.equal(h.window.activePingId,null);assert.equal(h.window.activeDeliveries.length,0);assert.equal(old.every(s=>s.stops===1),true);
});

test('Rider ping updates do not duplicate timers and removing another ping does not close the active one',()=>{
    const h=riderApp();startRider(h);const ping=h.subscriptions.find(s=>s.q.filters.some(f=>f.field==='pingedRider'));
    const emit=(type,id)=>ping.next({docChanges:()=>[{type,doc:{id,data:()=>({branch:'Maa',deliveryAddress:'Test'})}}]});
    emit('added','first');emit('modified','first');assert.equal(h.intervals.size,2);
    emit('added','second');assert.equal(h.intervals.size,2);emit('removed','first');assert.equal(h.window.activePingId,'second');
    h.window.stopRiderLiveServices();assert.equal(h.intervals.size,0);assert.equal(h.window.activePingId,null);
});
