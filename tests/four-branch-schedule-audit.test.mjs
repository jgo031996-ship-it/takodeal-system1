// Run from the Owner repository: node --test tests/four-branch-schedule-audit.test.mjs
// The assertions express the proposed acceptance criteria. An unmet criterion is a failing test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as directory from '../takodeal-manager/schedule-staff-directory.js';
import * as relief from '../takodeal-manager/schedule-relief-staff.js';
import * as leave from '../takodeal-manager/leave-model.js';
import {scheduleShiftHours} from '../takodeal-manager/schedule-layout.js';
import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
import {createScheduleHistoryStore, scheduleDateKey, monthKey} from '../takodeal-manager/schedule-history.js';
import {loadScheduleMonthView} from '../takodeal-manager/schedule-sync.js';
import {createOwnerScheduleSync} from '../takodeal-manager/owner-schedule-sync.js';
import {validateShiftConfig} from '../takodeal-manager/payroll-safety.js';
import {assertLocalScheduleChoice} from '../takodeal-manager/schedule-assignment-integrity.js';
import {isScheduleCoOwner,submitRosterReview,decideRosterReview} from '../takodeal-manager/schedule-owner-review.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';

const src = readFileSync(new URL('../takodeal-manager/main.js', import.meta.url), 'utf8');
const city = 'CityGate Gaisano Grand Buhangin';
const branches = ['Cabantian', city, 'Maa', 'Agdao'];
const now = new Date('2026-11-16T12:00:00+08:00');
const copy = structuredClone;
const phDate = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } };
const normalize = object => JSON.parse(JSON.stringify(object));

function installHandler(name, context) {
  const start = src.indexOf('\nwindow.' + name + ' = ');
  const end = src.indexOf('\n};', start + 1);
  assert.ok(start >= 0 && end > start, 'Missing production handler ' + name);
  vm.runInContext(src.slice(start + 1, end + 3), context);
}

function sample(callback = () => {}) {
  const staff = [
    ['iris', 'Iris Sample', 'Cabantian'], ['milo', 'Milo Sample', 'Maa'],
    ['nova', 'Nova Sample', 'Unassigned'], ['sol', 'Sol Sample', city],
    ['uma', 'Uma Sample', 'Agdao'], ['ret', 'Remy Sample', 'Maa']
  ].map(([id, name, branch]) => directory.toScheduleEmployee({
    cashierName: name, scheduleNickname: name, branch, active: id !== 'ret', archived: id === 'ret'
  }, id));
  const times = [['m1', 'Morning 1', '05:00', '13:00'], ['m2', 'Morning 2', '07:00', '15:00'],
    ['mid', 'Mid', '12:00', '20:00'], ['n1', 'Night 1', '21:00', '06:00'], ['n2', 'Night 2', '22:00', '07:00']];
  const branchConfig = Object.fromEntries(branches.map(branch => [branch, times.map(([id,name,startTime,endTime]) =>
    ({id,name,startTime,endTime,active:true,days:[0,1,2,3,4,5,6]}))]));
  const day = () => Object.fromEntries(branches.map(branch => [branch, {
    scheduled: Object.fromEntries(times.map(([id]) => [id, 'UNFILLED'])), rest: [], unavailable: [], swaps: {}
  }]));
  const schedule = {currentYear:2026,currentMonth:11,branchConfig,employees:staff.filter(person=>person.active),
    currentSchedule:Object.fromEntries([15,16,17,18,19,30].map(d => [d, day()])),unavailability:{},holidays:{}};
  callback(schedule);
  return {staff, schedule};
}

// In-memory Firestore-shaped storage with staged writes, atomic commit and serialized transactions.
async function database(customize) {
  const {staff, schedule} = sample(customize);
  const docs = new Map(staff.map(profile => ['cashiers/' + profile.staffId, copy(profile)]));
  const paths = [];
  const snap = (key) => ({id:key.split('/').at(-1),exists:()=>docs.has(key),data:()=>copy(docs.get(key)),
    metadata:{fromCache:false,hasPendingWrites:false}});
  let tail = Promise.resolve();
  const api = {db:{},serverTimestamp:()=>now.toISOString(),doc:(_db, coll, id)=>coll+'/'+id, collection:(_db, coll)=>coll,
    where:(field,op,value)=>({field,op,value}),query:(coll,...filters)=>({coll,filters}),
    getDocFromServer:async key => snap(key),
    getDocsFromServer:async source => {
      const {coll,filters}=typeof source==='string'?{coll:source,filters:[]}:source;
      const rows=[...docs.keys()].filter(key=>key.startsWith(coll+'/')).map(snap);
      return {metadata:{fromCache:false,hasPendingWrites:false},docs:rows.filter(row=>filters.every(({field,op,value})=>{
        assert.equal(op,'==','Extend the fake query only when the production query changes');
        return row.data()[field]===value;
      }))};
    },
    runTransaction(_db, fn) {
      const commit = tail.then(async () => {
        const writes = new Map();
        const result = await fn({get:async key=>{assert.equal(writes.size,0);return snap(key);},
          set:(key,value)=>writes.set(key,copy(value))});
        for (const [key,value] of writes) { docs.set(key,value); paths.push(key); }
        return result;
      });
      tail = commit.catch(()=>{});
      return commit;
    }};
  api.runScheduleTransaction=callback=>api.runTransaction(api.db,tx=>callback({...tx,
    readApprovedLeaves:async()=>[...docs].filter(([key,row])=>key.startsWith('staff_requests/')&&row.type==='Leave'&&row.status==='Approved').map(([,row])=>copy(row))}));
  const store = createScheduleHistoryStore(api,{now:()=>now});
  await store.save(schedule,{revisionId:'seed',effectiveFrom:'2026-11-16',expectedRevisionId:null,actor:'fixture@example.test'});
  paths.length = 0;
  return {api,docs,paths,store,head:()=>docs.get('settings/global_schedule')};
}

async function device(db, {coOwner=false, allow=()=>true, confirmMove=true}={}) {
  const messages=[], dialogs=[], leaveReviews=[];
  const user={uid:coOwner?'fixture-coowner':'fixture-owner',email:coOwner?'coowner@example.test':OWNER_EMAIL,emailVerified:true};
  const session={...user,role:coOwner?'Co-Owner':'Owner',isOwner:!coOwner,isFranchisee:false,
    permissions:[coOwner?'schedule':'all'],allowedBranches:['All']};
  const nodes = new Map();
  const document = {getElementById(id) {
    if(!nodes.has(id)) nodes.set(id,{value:id==='monthSelector'?'2026-11':'',style:{},textContent:''});
    return nodes.get(id);
  }};
  const localDrafts=new Map();
  const w={...db.api,assertLocalScheduleChoice,auth:{currentUser:user},sessionUser:session,isBranchAllowed:allow,
    getScheduleHistoryStore:()=>db.store, ManagerUI:{notify:msg=>messages.push(msg)},
    renderConfigUI(){},updateHolidayList(){},renderTables(){},switchTab(){},updateStaffDisplay(){},
    updateAvailDropdown(){},updateUnavailabilityList(){},captureTempShiftConfig(){},
    applyWorkedShiftFromRoster:(...args)=>{messages.push('worked shift review');return args;}};
  const Swal={async fire(options) {
    dialogs.push(options);
    return {isConfirmed: options.title==='Move staff between branches?' && confirmMove};
  },close(){},showLoading(){}};
  const ctx=vm.createContext({...directory,...relief,...leave,scheduleShiftHours,activeStaffProfile,canOpenWorkspacePage,
    validateShiftConfig,scheduleDateKey,monthKey,structuredClone,Swal,window:w,document,Date:phDate,
    escapeHtml:String,employees:[],branchConfig:{},currentSchedule:{},unavailability:{},
    currentYear:2026,currentMonth:11,currentActiveTab:'Maa',swapData:null,
    scheduleMemoryUI:null,scheduleMemoryExpectedRevision:undefined,
    projectWorkedShiftCorrections:view=>view,openSavedScheduleLeave:(_api,{marker})=>leaveReviews.push(marker),
    loadScheduleMonthView:(api,options)=>loadScheduleMonthView(api,{...options,now}),
    installOwnerScheduleSync(_window,_document,options){
      return createOwnerScheduleSync({...options,now:()=>now,getEffectiveFrom:()=>'2026-11-16',
        draftStore:{write:async r=>{localDrafts.set(r.key,copy(r));return r;},list:async()=>[],remove:async key=>localDrafts.delete(key)},
        onStatus:msg=>{messages.push(msg);document.getElementById('ownerScheduleSyncStatus').textContent=msg;}});
    }});
  // Use a plain host object for the IndexedDB boundary, as in a single browser JS realm.
  w.getScheduleMemorySnapshot=()=>({currentYear:ctx.currentYear,currentMonth:ctx.currentMonth,employees:ctx.employees,
    branchConfig:ctx.branchConfig,currentSchedule:ctx.currentSchedule,unavailability:ctx.unavailability,holidays:w.scheduleHolidays});
  w.scheduleApprovalRequired=()=>isScheduleCoOwner(w.sessionUser);
  w.submitRosterReview=(snapshot,view,date)=>submitRosterReview(w,snapshot,view,date);
  for(const name of ['applyScheduleMemorySnapshot','getOwnerScheduleSync','saveToCloud','markScheduleDraftEdited','saveManualSchedule',
    'findEmployeeProfile','reviewOwnedScheduleLeave','confirmActiveScheduleStaff','openSwapModal','executeSwap']) installHandler(name,ctx);
  const sync=w.getOwnerScheduleSync();
  assert.ok(await sync.load(), messages.join('\n'));
  async function open(branch,slot='m1',d=17){
    await w.openSwapModal(d,branch,slot);
    return dialogs.findLast(dialog=>dialog.title?.includes('Reassign / Swap Shift'))?.html||'';
  }
  async function choose(branch, slot, option, d=17) {
    const html=await open(branch,slot,d);
    assert.ok(html.includes('value="'+option+'"'), 'Option unavailable: '+option);
    return w.executeSwap(option,false);
  }
  return {w,ctx,dialogs,messages,leaveReviews,localDrafts,open,choose,save:()=>w.saveManualSchedule(),sync};
}

test('available and Unassigned staff cover all four locations without an HR write; Save Edits commits once',async()=>{
  const db=await database(), editor=await device(db);
  const hr=normalize([...db.docs].filter(([k])=>k.startsWith('cashiers/')));
  for(const [branch,staff,slot,d] of [['Agdao','iris','m1',17],['Cabantian','nova','m2',18],[city,'milo','mid',17],['Maa','sol','n1',18]]){
    assert.equal(await editor.choose(branch,slot,'relief_'+staff,d),true);
  }
  assert.deepEqual(db.paths,[]);
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m1,'UNFILLED');
  assert.equal(await editor.save(),true,editor.messages.join('\n'));
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m1,'Iris Sample');
  assert.equal(db.head().currentSchedule[18].Cabantian.scheduled.m2,'Nova Sample');
  assert.equal(db.head().currentSchedule[17][city].scheduled.mid,'Milo Sample');
  assert.equal(db.head().currentSchedule[18].Maa.scheduled.n1,'Sol Sample');
  assert.deepEqual(normalize([...db.docs].filter(([k])=>k.startsWith('cashiers/'))),hr);
  assert.equal(db.paths.filter(k=>k.startsWith('settings/schedule_revision_')).length,1);
});

test('move review identifies both slots; cancellation preserves all rows; confirmation clears only the source assignment',async()=>{
  const db=await database(s=>{
    s.currentSchedule[17].Cabantian.scheduled.mid='Milo Sample';
    s.currentSchedule[17].Cabantian.swaps.mid='Iris Sample';
    s.currentSchedule[18].Cabantian.scheduled.mid='Milo Sample';
    s.currentSchedule[17][city].scheduled.m2='Sol Sample';
    s.currentSchedule[17].Agdao.scheduled.n2='Uma Sample';
  });
  const cancelled=await device(db,{confirmMove:false});
  const before=copy(cancelled.ctx.currentSchedule);
  assert.equal(await cancelled.choose('Agdao','n2','transfer_milo'),false);
  assert.deepEqual(copy(cancelled.ctx.currentSchedule),before);
  const editor=await device(db);
  assert.equal(await editor.choose('Agdao','n2','transfer_milo'),true);
  const html=editor.dialogs.find(d=>d.title==='Move staff between branches?').html;
  assert.match(html,/Cabantian.*Mid.*12:00 PM.*8:00 PM/);
  assert.match(html,/Agdao.*Night 2.*10:00 PM.*7:00 AM/);
  const expected=copy(before);
  expected[17].Cabantian.scheduled.mid='UNFILLED';delete expected[17].Cabantian.swaps.mid;
  expected[17].Agdao.scheduled.n2='Milo Sample';expected[17].Agdao.rest=['Uma Sample'];
  assert.deepEqual(copy(editor.ctx.currentSchedule),expected);
  assert.deepEqual(db.paths,[]);
  assert.equal(await editor.save(),true);
  assert.deepEqual(db.head().currentSchedule,expected);
  assert.equal(db.docs.get('cashiers/milo').branch,'Maa');
});

test('linked leave across branches blocks selection and preserves the underlying leave marker',async()=>{
  const marker={staffId:'iris',name:'Iris Sample',status:'Leave',leaveRequestId:'fixture-leave'};
  const db=await database(s=>{s.currentSchedule[17].Cabantian.unavailable.push(marker);
    s.unavailability['2026-11-17']={'Iris Sample':marker};});
  const editor=await device(db), html=await editor.open('Agdao');
  assert.doesNotMatch(html,/value="(?:transfer|relief)_iris"/);
  assert.ok(html.includes('value="unavail_Iris Sample"'));
  await editor.w.executeSwap('unavail_Iris Sample',false);
  assert.equal(editor.leaveReviews[0].leaveRequestId,'fixture-leave');
  assert.equal(editor.ctx.currentSchedule[17].Agdao.scheduled.m1,'UNFILLED');
  assert.deepEqual(copy(editor.ctx.unavailability['2026-11-17']['Iris Sample']),marker);
  assert.deepEqual(db.paths,[]);
});

test('two existing same-date assignments and a source outside scheduling scope are ineligible for a move',async()=>{
  const db=await database(s=>{
    s.currentSchedule[17].Maa.scheduled.mid='Iris Sample';
    s.currentSchedule[17][city].scheduled.m1='Iris Sample';
    s.currentSchedule[17][city].scheduled.m2='Sol Sample';
  });
  const editor=await device(db,{allow:branch=>branch!==city});
  assert.doesNotMatch(await editor.open('Cabantian'),/value="(?:transfer|relief)_(?:iris|sol)"/);
  assert.deepEqual(db.paths,[]);
});

test('inactive names project as vacancies today and ahead; both past and saved historical views preserve the name',async()=>{
  const db=await database(s=>{for(const d of [15,16,17])s.currentSchedule[d].Maa.scheduled.m1='Remy Sample';});
  const editor=await device(db), view=directory.createScheduleRosterView(editor.w.scheduleDirectoryProfiles);
  for(const d of [16,17]) assert.equal(view.day(editor.ctx.currentSchedule[d].Maa).scheduled.m1,'UNFILLED');
  for(const d of [15,16,17]) assert.equal(view.day(editor.ctx.currentSchedule[d].Maa,{historical:true}).scheduled.m1,'Remy Sample');
  assert.doesNotMatch(await editor.open('Maa'),/value="(?:pool|relief|transfer)_ret"/);
  assert.equal(await editor.choose('Maa','m1','relief_nova'),true);
  assert.ok(!editor.ctx.currentSchedule[17].Maa.rest.includes('Remy Sample'));
  assert.equal(await editor.save(),true);
  assert.equal(db.docs.get('settings/schedule_revision_seed').snapshot.currentSchedule[17].Maa.scheduled.m1,'Remy Sample');
  assert.equal(db.head().currentSchedule[15].Maa.scheduled.m1,'Remy Sample');
});

test('a second editor cannot overwrite a newer revision and keeps the rejected draft',async()=>{
  const db=await database(), owner=await device(db), co=await device(db,{coOwner:true});
  assert.equal(await co.choose('Cabantian','m2','relief_nova'),true);
  assert.equal(await owner.choose('Agdao','m1','relief_iris'),true);
  assert.equal(await owner.save(),true);
  const after=copy(db.head()), count=db.paths.length;
  assert.equal(await co.save(),false);
  assert.match(co.sync.lastError().message,/another session/);
  assert.deepEqual(db.head(),after);assert.equal(db.paths.length,count);
  assert.equal(co.ctx.currentSchedule[17].Cabantian.scheduled.m2,'Nova Sample');
  assert.ok(co.sync.isDirty());assert.ok(co.localDrafts.size>0);
});

test('proposed Owner sign-off: a Co-owner Save Edits keeps the published schedule intact pending Owner confirmation',async()=>{
  const db=await database(), co=await device(db,{coOwner:true});
  await co.choose('Cabantian','m2','relief_nova');
  const prior=copy(db.head());
  assert.equal(await co.save(),true);
  assert.equal(db.head().scheduleRevisionId,prior.scheduleRevisionId,'Co-owner advanced the shared revision before any Owner confirmation');
});

test('an incoming relief shift cannot overlap the previous work date at another branch',async()=>{
  const db=await database(s=>{s.currentSchedule[16].Maa.scheduled.n1='Iris Sample';});
  const editor=await device(db);
  const html=await editor.open('Agdao','m1');
  if(html.includes('value="relief_iris"'))await editor.w.executeSwap('relief_iris',false);
  await editor.save();
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m1,'UNFILLED','05:00–06:00 was double-booked');
});

test('a back-to-back relief shift is allowed when the previous shift ends at the new start',async()=>{
  const db=await database(s=>{s.currentSchedule[16].Maa.scheduled.n2='Iris Sample';});
  const editor=await device(db);
  assert.equal(await editor.choose('Agdao','m2','relief_iris'),true);
  assert.equal(await editor.save(),true);
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m2,'Iris Sample');
});

test('moving a shift to overnight must check the following work date before saving',async()=>{
  const db=await database(s=>{
    s.currentSchedule[17][city].scheduled.mid='Sol Sample';
    s.currentSchedule[18].Cabantian.scheduled.m1='Sol Sample';
  });
  const editor=await device(db), before=copy(db.head().currentSchedule);
  if((await editor.open('Maa','n1')).includes('value="transfer_sol"'))await editor.w.executeSwap('transfer_sol',false);
  await editor.save();
  assert.deepEqual(db.head().currentSchedule,before,'Move created a 05:00–06:00 conflict with the following work date');
});

test('an old Standby entry cannot double-book someone currently scheduled at another branch',async()=>{
  const db=await database(s=>{s.currentSchedule[17].Agdao.rest=['Milo Sample'];s.currentSchedule[17].Maa.scheduled.mid='Milo Sample';});
  const editor=await device(db), html=await editor.open('Agdao','m1');
  if(html.includes('value="rest_0"'))await editor.w.executeSwap('rest_0',false);
  await editor.save();
  assert.ok(!(db.head().currentSchedule[17].Maa.scheduled.mid==='Milo Sample'&&db.head().currentSchedule[17].Agdao.scheduled.m1==='Milo Sample'),
    'Standby selection retained the original shift and committed a second overlapping shift');
});

test('a profile archived after assignment confirmation cannot be newly committed by Save Edits',async()=>{
  const db=await database(), editor=await device(db);
  assert.equal(await editor.choose('Agdao','m1','relief_iris'),true);
  Object.assign(db.docs.get('cashiers/iris'),{archived:true,active:false,scheduleEligible:false});
  await editor.save();
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m1,'UNFILLED','An archived staff member was committed to a new shift');
});

test('a new overnight assignment checks an already saved shift on day one of the next month',async()=>{
  const db=await database();
  const {schedule:dec}=sample();
  dec.currentMonth=12;
  dec.currentSchedule={1:dec.currentSchedule[17]};
  dec.currentSchedule[1][city].scheduled.m1='Iris Sample';
  await db.store.save(dec,{revisionId:'december',effectiveFrom:'2026-12-01',expectedRevisionId:null,actor:'fixture@example.test'});
  const editor=await device(db);
  if((await editor.open('Agdao','n1',30)).includes('value="relief_iris"'))await editor.w.executeSwap('relief_iris',false);
  await editor.save();
  assert.equal(db.head().currentSchedule[30].Agdao.scheduled.n1,'UNFILLED','An overlapping December 1 shift was already saved at CityGate');
});

test('a dated approved leave record still blocks manual relief when a legacy schedule lacks its marker',async()=>{
  const db=await database();
  const approved={type:'Leave',status:'Approved',staffId:'iris',staffName:'Iris Sample',branch:'Cabantian',
    startDate:'2026-11-17',endDate:'2026-11-17',leaveType:'Approved leave'};
  db.docs.set('staff_requests/fixture-approved',approved);
  const editor=await device(db);
  if((await editor.open('Agdao','m1')).includes('value="relief_iris"'))await editor.w.executeSwap('relief_iris',false);
  await editor.save();
  assert.equal(db.head().currentSchedule[17].Agdao.scheduled.m1,'UNFILLED','A dated approved leave without a roster marker was missed');
  assert.deepEqual(db.docs.get('staff_requests/fixture-approved'),approved);
});

test('a legacy current-head change without a revision bump cannot be overwritten by an unrelated draft',async()=>{
  const db=await database(), editor=await device(db);
  await editor.choose('Agdao','m1','relief_iris');
  // projectScheduleMonth explicitly supports this older writer format.
  const legacy=copy(db.head());
  legacy.currentSchedule[18].Maa.scheduled.m2='Uma Sample';
  db.docs.set('settings/global_schedule',legacy);
  await editor.save();
  assert.equal(db.head().currentSchedule[18].Maa.scheduled.m2,'Uma Sample','The newer edit disappeared from the shared head');
});

test('a changed source while a move dialog is open requires a fresh selection',async()=>{
  const db=await database(s=>{s.currentSchedule[17].Cabantian.scheduled.mid='Milo Sample';});
  const editor=await device(db);
  assert.match(await editor.open('Agdao','m1'),/value="transfer_milo"/);
  editor.ctx.currentSchedule[17].Cabantian.scheduled.mid='Uma Sample';
  assert.equal(await editor.w.executeSwap('transfer_milo',false),false);
  assert.equal(editor.ctx.currentSchedule[17].Agdao.scheduled.m1,'UNFILLED');
  assert.equal(editor.ctx.currentSchedule[17].Cabantian.scheduled.mid,'Uma Sample');
  assert.deepEqual(db.paths,[]);
});

test('read-only history refuses Save Edits and earlier dates route to worked-shift review',async()=>{
  const db=await database(), editor=await device(db);
  await editor.w.openSwapModal(15,'Cabantian','m1');
  assert.ok(editor.messages.includes('worked shift review'));
  editor.w.scheduleMemoryReadOnly=true;
  assert.equal(await editor.save(),false);
  assert.deepEqual(db.paths,[]);
});
