import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic,staffRateHistoryMarkup,installStaffRateHistory} from '../takodeal-manager/staff-rate-changes.js';
import {configuredPermissions} from '../takodeal-manager/workspace-access-model.js';
import {profileDailyRate,installStaffRatePrivacy} from '../takodeal-staff/staff-rate-privacy.js';
import {VaultSession,createPinVerifier,verifyPin,validVaultPin,validVerifier,attendanceHistory,escapeHtml} from '../takodeal-staff/staff-privacy.js';
const manager=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const portal=readFileSync(new URL('../takodeal-staff/staff-portal.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace('export function','function');
function rateFixture() {
    const h=firestoreHarness();h.api.auth={currentUser:{uid:'manager',email:'hr@example.test',emailVerified:true}};h.api.sessionUser={uid:'manager',email:'hr@example.test',permissions:['payroll'],allowedBranches:['All'],cashierName:'Sample HQ'};
    h.api.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    h.put('hq_email_access/hr@example.test',{active:true,permissions:['payroll'],allowedBranches:['All']});
    h.put('hq_managers/manager',{email:'hr@example.test',role:'Manager',pin:'1234',permissions:['payroll'],assignedBranch:'All'});
    h.put('cashiers/staff',{cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:450,payslipPin:{private:'preserved'},phone:'unchanged'});
    h.put('payroll_records/paid',{staffName:'Sample Staff',status:'Paid',dailyRate:450,totalPay:4500});
    return h;
}
const payload=(rate=500)=>({cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:rate,pin:'1111',empId:'S001'});
const save=(h,rate,operationId,options={})=>saveStaffProfileAtomic(h.api,'staff',payload(rate),{operationId,...options});

test('daily rate helpers preserve the stored daily amount and never multiply hourlyRate by eight',()=>{
    assert.equal(dailyStaffRate({hourlyRate:450}),450);assert.equal(profileDailyRate({hourlyRate:450}),450);assert.equal(profileDailyRate({dailyRate:400}),400);
    for(const rate of [NaN,-1,Infinity,''])assert.equal(profileDailyRate({hourlyRate:rate}),null);
});

test('actual increases keep amounts in the immutable private audit and only an amount-free marker in the profile',async()=>{
    const h=rateFixture(),paid=structuredClone(h.get('payroll_records/paid'));await save(h,500,'raise-one',{expectedRate:450,expectedExists:true});
    const row=h.get('cashiers/staff'),audit=h.get('staff_rate_changes/raise-one');assert.equal(row.hourlyRate,500);assert.deepEqual(row.latestRateRaise,{eventId:'raise-one',version:1});assert.equal(Object.hasOwn(row,'rateHistory'),false);assert.equal(audit.fromDailyRate,450);assert.equal(audit.toDailyRate,500);assert.equal(row.staffRateAuditId,'raise-one');
    assert.equal(audit.actorEmail,'hr@example.test');assert.equal(audit.eventType,'increase');assert.equal(Object.hasOwn(audit,'pin'),false);assert.match(audit.inputHash,/^[a-f0-9]{64}$/);assert.deepEqual(row.payslipPin,{private:'preserved'});assert.deepEqual(h.get('payroll_records/paid'),paid);
});

test('first saved rate, legacy missing/zero baseline, equal rate and a decrease do not create congratulations',async()=>{
    for(const [old,rate,kind] of [[null,450,'baseline'],[0,450,'baseline'],[450,450,'unchanged'],[450,400,'decrease']]){
        const h=rateFixture();if(old==null)delete h.get('cashiers/staff').hourlyRate;else h.put('cashiers/staff',{...h.get('cashiers/staff'),hourlyRate:old});
        await save(h,rate,'no-raise');assert.equal(h.get('staff_rate_changes/no-raise').eventType,kind);assert.ok(!h.get('cashiers/staff').latestRateRaise);
    }
    const h=rateFixture();h.docs.delete('cashiers/staff');await saveStaffProfileAtomic(h.api,'new-staff',payload(450),{operationId:'new-baseline',expectedExists:false,expectedRate:null});assert.equal(h.get('staff_rate_changes/new-baseline').eventType,'baseline');assert.equal(h.get('cashiers/new-staff').latestRateRaise,null);
});

test('a decrease clears the old raise marker while every immutable audit stays outside the public profile',async()=>{
    const h=rateFixture();for(let i=0;i<24;i++)await save(h,451+i,'raise-'+i);assert.equal(Object.hasOwn(h.get('cashiers/staff'),'rateHistory'),false);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('staff_rate_changes/')).length,24);
    await save(h,440,'decrease');assert.equal(h.get('cashiers/staff').latestRateRaise,null);assert.equal(h.get('staff_rate_changes/decrease').eventType,'decrease');
});

test('simultaneous retries and lost acknowledgments save one rate change with one audit and unchanged historic payroll',async()=>{
    const h=rateFixture();h.loseNextAck();await assert.rejects(save(h,500,'one-save'),/Connection lost/);
    const rows=await Promise.all(Array.from({length:15},()=>save(h,500,'one-save',{expectedRate:450})));assert.ok(rows.every(row=>row.alreadySaved));assert.equal(Object.hasOwn(h.get('cashiers/staff'),'rateHistory'),false);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('staff_rate_changes/')).length,1);
    await assert.rejects(save(h,550,'one-save'),/different staff edits/);assert.equal(h.get('cashiers/staff').hourlyRate,500);
});

test('different concurrent operations from a stale opened rate cannot overwrite the first confirmed raise',async()=>{
    const h=rateFixture(),results=await Promise.allSettled(Array.from({length:8},(_,i)=>save(h,500+i,'separate-'+i,{expectedRate:450})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('staff_rate_changes/')).length,1);assert.ok(results.filter(result=>result.status==='rejected').every(result=>/changed after/.test(result.reason.message)));
});

test('commit failure preserves profile, private history and all audit records',async()=>{
    const h=rateFixture(),before=structuredClone(h.get('cashiers/staff'));h.failNextCommit();await assert.rejects(save(h,500,'failed'),/Commit rejected/);assert.deepEqual(h.get('cashiers/staff'),before);assert.equal(h.get('staff_rate_changes/failed'),undefined);
});

test('fresh blocked/revoked access, wrong branch and an identity switch inside the transaction prevent rate writes',async()=>{
    for(const change of [h=>h.put('hq_managers/manager',{...h.get('hq_managers/manager'),blocked:true}),h=>h.put('hq_managers/manager',{...h.get('hq_managers/manager'),permissions:['dashboard']}),h=>h.put('hq_managers/manager',{...h.get('hq_managers/manager'),assignedBranch:'Cabantian'})]){
        const h=rateFixture();change(h);await assert.rejects(save(h,500,'denied'),/blocked|permissions|branch/);assert.equal(h.get('cashiers/staff').hourlyRate,450);
    }
    const h=rateFixture(),run=h.api.runTransaction;h.api.runTransaction=(db,callback)=>run(db,async tx=>{h.api.auth.currentUser={uid:'other',email:'other@example.test'};return callback(tx);});await assert.rejects(save(h,500,'switched'),/account/);assert.equal(h.get('staff_rate_changes/switched'),undefined);
});

function uiFixture(profile={hourlyRate:450}) {
    const nodes=new Map(),events=new Map(),stored=new Map([['takodeal_staff_id','staff'],['takodeal_staff_name','Sample Staff']]);let time=0,tick,reads=0,locked=0;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{display:id==='profileModal'?'flex':'none'},hidden:false,textContent:'',innerHTML:'',value:''});return nodes.get(id);};
    const storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
    const document={hidden:false,getElementById:node,querySelectorAll:()=>[],addEventListener:(type,handler)=>events.set(type,handler)};
    const api={db:{},doc:(_,table,id)=>({table,id}),getDocFromServer:async()=>{reads++;return {exists:()=>true,data:()=>structuredClone(profile)};},addEventListener:(type,handler)=>events.set(type,handler),onStaffRateLocked:()=>locked++};
    const control=installStaffRatePrivacy(api,document,storage,{now:()=>time,setIntervalFn:handler=>{tick=handler;return 0;}});api.openVaultPin=async()=>control.lock({preserveRequest:true});
    return {api,control,node,nodes,storage,stored,document,events,reads:()=>reads,locked:()=>locked,setTime:value=>{time=value;},tick:()=>tick(),profile};
}
const raiseProfile={hourlyRate:500,latestRateRaise:{eventId:'confirmed-raise',version:1},staffRateAuditId:'confirmed-raise'};

test('locked Profile DOM and congratulations contain no rate, while unlock uses the exact daily amount',async()=>{
    const u=uiFixture(raiseProfile);await u.control.open();assert.equal(u.node('profileDailyRate').textContent,'Locked');assert.match(u.node('profileRateCongratulations').textContent,/Congratulations/);
    assert.ok(!JSON.stringify([...u.nodes.values()]).includes('500'));assert.equal(u.control.reveal('staff',raiseProfile),true);assert.equal(u.node('profileDailyRate').textContent,'₱500.00 / day');assert.equal(u.node('profileDailyRate').textContent.includes('4,000'),false);
    u.control.lock();assert.equal(u.node('profileDailyRate').textContent,'Locked');assert.ok(!JSON.stringify([...u.nodes.values()]).includes('500'));await u.control.open();assert.equal(u.node('profileRateCongratulations').hidden,true);
});

test('rate authorization is an absolute two-minute bound and reopening/backgrounding/account switching removes the amount',async()=>{
    const u=uiFixture();await u.control.open();u.control.reveal('staff',u.profile);u.setTime(120001);u.tick();assert.equal(u.api.staffRateSession.allows('staff'),false);assert.equal(u.node('profileDailyRate').textContent,'Locked');
    await u.control.open();u.control.reveal('staff',u.profile);u.document.hidden=true;u.events.get('visibilitychange')();assert.equal(u.node('profileDailyRate').textContent,'Locked');assert.ok(u.locked()>1);
    u.document.hidden=false;await u.control.open();u.control.reveal('staff',u.profile);u.stored.set('takodeal_staff_id','other');u.events.get('storage')({key:'takodeal_staff_id'});assert.equal(u.node('profileDailyRate').textContent,'Locked');assert.equal(u.api.staffRateSession.allows('other'),false);
});

test('slow Profile reads cannot restore congratulations or rate after closing or changing account',async()=>{
    const u=uiFixture(raiseProfile);let complete;u.api.getDocFromServer=()=>new Promise(resolve=>{complete=resolve;});const loading=u.control.open();u.control.lock();u.node('profileModal').style.display='none';complete({exists:()=>true,data:()=>raiseProfile});await loading;assert.equal(u.node('profileRateCongratulations').textContent,'');assert.equal(u.node('profileDailyRate').textContent,'Locked');
});

test('missing or malformed amount-free notification markers cannot produce congratulations',async()=>{
    for(const profile of [{hourlyRate:400},{...raiseProfile,latestRateRaise:null},{...raiseProfile,latestRateRaise:{eventId:'',version:1}},{...raiseProfile,latestRateRaise:{eventId:'unsafe/id',version:1}},{...raiseProfile,latestRateRaise:{eventId:'confirmed-raise',version:2}}]){
        const u=uiFixture(profile);await u.control.open();assert.equal(u.node('profileRateCongratulations').textContent,'');assert.equal(u.node('profileDailyRate').textContent,'Locked');
    }
});

test('numeric-string legacy rates retain their actual baseline while unknown nonnumeric rates cannot become raises',async()=>{
    const h=rateFixture();h.put('cashiers/staff',{...h.get('cashiers/staff'),hourlyRate:' 450.50 '});await save(h,500,'numeric-string');assert.equal(h.get('staff_rate_changes/numeric-string').fromDailyRate,450.50);
    for(const value of ['unknown',true,'0x100',-1,Infinity]){const bad=rateFixture();bad.put('cashiers/staff',{...bad.get('cashiers/staff'),hourlyRate:value});await assert.rejects(save(bad,500,'unknown-baseline'),/existing daily rate/);assert.equal(bad.get('staff_rate_changes/unknown-baseline'),undefined);}
});

test('fresh protected HQ permission and branch revocation prevent saves despite public HQ profile permissions',async()=>{
    for(const fields of [{active:false},{permissions:['dashboard']},{allowedBranches:['Citygate']}]){const h=rateFixture();h.put('hq_email_access/hr@example.test',{...h.get('hq_email_access/hr@example.test'),...fields});await assert.rejects(save(h,500,'revoked-bridge'),/verified HQ payroll access/);assert.equal(h.get('cashiers/staff').hourlyRate,450);}
    const h=rateFixture();await assert.rejects(saveStaffProfileAtomic(h.api,'staff',{...payload(),rateHistory:[]},{operationId:'forged-history'}),/audit fields/);assert.equal(h.get('staff_rate_changes/forged-history'),undefined);
});

test('ensureStaffRateUnlocked resolves only on successful current-profile reveal; relock/cancellation resolves false',async()=>{
    const u=uiFixture();await u.control.open();const request=u.api.ensureStaffRateUnlocked();u.control.reveal('staff',u.profile);assert.equal(await request,true);assert.equal(await u.api.ensureStaffRateUnlocked(),true);
    u.control.lock();const cancelled=u.api.ensureStaffRateUnlocked();u.control.lock();assert.equal(await cancelled,false);assert.equal(u.api.staffRateSession.allows('staff'),false);
});

function portalFixture(profile) {
    const nodes=new Map(),events=new Map(),stored=new Map([['takodeal_staff_id','staff'],['takodeal_staff_name','Sample Staff']]);let loads=0,read=profile;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,innerHTML:id==='vaultContent'?'zero template':'',textContent:'',style:{display:id==='profileModal'?'flex':'none'},focus(){},setAttribute(){},classList:{contains:()=>false}});return nodes.get(id);};
    const context={VaultSession,createPinVerifier,verifyPin,validVaultPin,validVerifier,attendanceHistory,escapeHtml,installStaffRatePrivacy,setInterval:()=>0,navigator:{},console,Date,
        localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},document:{hidden:false,getElementById:node,querySelectorAll:()=>[],querySelector:()=>({scrollTop:0}),addEventListener:(type,handler)=>events.set(type,handler)}};
    context.window={db:{},doc:()=>({}),getDocFromServer:async()=>({exists:()=>true,data:()=>({...read})}),updateDoc:async()=>{},addEventListener:(type,handler)=>events.set(type,handler),Swal:{close(){}},switchView(){},checkNormalLogin(){},loginStaff:async()=>{},logoutStaff(){},openProfile:async()=>{node('profileModal').style.display='flex';},loadPayslipVault:()=>loads++};
    vm.runInNewContext(portal+'\ninstallStaffPortal();',context);return {api:context.window,node,context,stored,events,loads:()=>loads,setProfile:value=>{read=value;}};
}

test('actual shared PIN modal rejects staff login/wrong PIN, unlocks only Profile rate with fresh Payslip PIN and leaves Pay locked',async()=>{
    const pin=await createPinVerifier('246810'),u=portalFixture({...raiseProfile,pin:'1111',payslipPin:pin});await u.api.openProfile();await u.api.openProfileRatePin();
    u.node('vaultCurrentPin').value='1111';await u.api.submitVaultPin();assert.equal(u.node('profileDailyRate').textContent,'Locked');u.node('vaultCurrentPin').value='246811';await u.api.submitVaultPin();assert.equal(u.node('profileDailyRate').textContent,'Locked');
    u.node('vaultCurrentPin').value='246810';await u.api.submitVaultPin();assert.equal(u.node('profileDailyRate').textContent,'₱500.00 / day');assert.equal(u.api.staffVaultSession.allows('staff'),false);assert.equal(u.loads(),0);assert.equal(u.node('vaultCurrentPin').value,'');
    u.api.closeStaffProfile();assert.equal(u.node('profileDailyRate').textContent,'Locked');
});

test('a Payslip PIN changed on another device or account switch during the unlock attempt cannot reveal an old rate',async()=>{
    const original=await createPinVerifier('246810'),next=await createPinVerifier('135790'),u=portalFixture({hourlyRate:450,payslipPin:original});await u.api.openProfile();await u.api.openProfileRatePin();u.setProfile({hourlyRate:500,payslipPin:next});u.node('vaultCurrentPin').value='246810';await u.api.submitVaultPin();assert.equal(u.node('profileDailyRate').textContent,'Locked');
    u.node('vaultCurrentPin').value='135790';let finish;u.api.getDocFromServer=()=>new Promise(resolve=>{finish=resolve;});const pending=u.api.submitVaultPin();u.stored.set('takodeal_staff_id','other');u.events.get('storage')({key:'takodeal_staff_id'});finish({exists:()=>true,data:()=>({hourlyRate:500,payslipPin:next})});await pending;assert.equal(u.node('profileDailyRate').textContent,'Locked');
});

test('actual Manager staff-save route keeps new profile IDs stable after a lost acknowledgment and records no first-save raise',async()=>{
    const h=rateFixture(),nodes=new Map();let nextId=0;const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,checked:false,style:{}});return nodes.get(id);};
    const api=h.api,doc=api.doc;api.doc=(...args)=>args.length===1?h.ref(args[0].table,'new-'+(++nextId)):doc(...args);api.globalStaffData={};api.staffProfileBaseline={id:'',exists:false,rate:null};api.loadHRModule=()=>{};
    const values={empProfileId:'',empFullName:'New Staff',empBranchAssign:'Maa',empHourlyRate:'450',empRole:'Crew',empPin:'1111',empNightDiffRate:'0',profEmpId:'S001'};for(const [id,value] of Object.entries(values))el(id).value=value;
    const context={window:api,document:{getElementById:el,querySelectorAll:()=>[]},dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic,Swal:{fire(){}},console:{error(){}},Date};const start=manager.indexOf('window.saveEmployeeProfile ='),end=manager.indexOf('\n};',start)+3;vm.runInNewContext(manager.slice(start,end),context);
    h.loseNextAck();await api.saveEmployeeProfile();await api.saveEmployeeProfile();assert.equal(nextId,1);assert.equal(el('empProfileId').value,'new-1');assert.equal([...h.docs.keys()].filter(path=>path.startsWith('staff_rate_changes/')).length,1);assert.equal(h.get('cashiers/new-1').latestRateRaise,null);assert.equal(el('btnSaveEmpProfile').disabled,false);
});

test('ensure opens Profile for a document request outside it and still waits for the same Payslip PIN gate',async()=>{
    const u=uiFixture();u.node('profileModal').style.display='none';let opened=0;u.api.openProfile=async()=>{opened++;u.node('profileModal').style.display='flex';await u.control.open();};
    const pending=u.api.ensureStaffRateUnlocked();for(let i=0;i<10 && !opened;i++)await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,1);assert.equal(u.node('profileDailyRate').textContent,'Locked');u.control.reveal('staff',u.profile);assert.equal(await pending,true);
});

test('Master rate history displays recorded before/after daily values and safely escapes metadata',()=>{
    const html=staffRateHistoryMarkup(raiseProfile,[{id:'confirmed-raise',eventType:'increase',fromDailyRate:450,toDailyRate:500,recordedAt:'2026-10-07',actorEmail:'<script>alert(1)</script>'}]);assert.match(html,/Latest increase recorded/);assert.match(html,/₱450\.00 \/ day/);assert.match(html,/₱500\.00 \/ day/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);
    assert.match(staffRateHistoryMarkup({hourlyRate:450}),/No recorded daily rate changes/);
});

test('Master history reads the employee and branch scoped private audit rather than any public history field',async()=>{
    const h=rateFixture();await save(h,500,'private-history');
    h.put('cashiers/staff',{...h.get('cashiers/staff'),rateHistory:[{eventType:'increase',fromDailyRate:1,toDailyRate:99999}]});
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{display:'flex'}});return nodes.get(id);};
    const reads=[],read=h.api.getDocsFromServer;h.api.getDocsFromServer=q=>{reads.push(q);return read(q);};
    h.api.openEmployeeProfile=id=>{el('empProfileId').value=id;};installStaffRateHistory(h.api,{getElementById:el});h.api.openEmployeeProfile('staff');await new Promise(resolve=>setImmediate(resolve));
    const auditRead=reads.find(row=>row.table==='staff_rate_changes');assert.deepEqual(auditRead.filters,[{key:'staffId',value:'staff'},{key:'branch',value:'Maa'}]);
    assert.match(el('masterRateHistory').innerHTML,/₱450\.00 \/ day/);assert.match(el('masterRateHistory').innerHTML,/₱500\.00 \/ day/);assert.doesNotMatch(el('masterRateHistory').innerHTML,/99,999/);
});

test('a slow private history query cannot restore another account’s or employee’s salary history',async()=>{
    const h=rateFixture();await save(h,500,'private-history');
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{display:'flex'}});return nodes.get(id);};let finish;
    const read=h.api.getDocsFromServer;h.api.getDocsFromServer=q=>q.table==='staff_rate_changes'?new Promise(resolve=>finish=()=>read(q).then(resolve)):read(q);
    h.api.openEmployeeProfile=id=>{el('empProfileId').value=id;};installStaffRateHistory(h.api,{getElementById:el});h.api.openEmployeeProfile('staff');await new Promise(resolve=>setImmediate(resolve));
    h.api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(el('masterRateHistory').innerHTML,'');
});

test('Master rate history suppresses a slow result when another employee is opened or the account changes',async()=>{
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{display:'flex'}});return nodes.get(id);};let complete;
    const api={auth:{currentUser:{uid:'hq'}},sessionUser:{email:'hr@example.test',permissions:['payroll']},openEmployeeProfile:id=>{el('empProfileId').value=id;},getDocFromServer:()=>new Promise(resolve=>{complete=resolve;}),doc:()=>({}),db:{}};
    installStaffRateHistory(api,{getElementById:el});api.openEmployeeProfile('staff');api.auth.currentUser={uid:'another'};complete({exists:()=>true,data:()=>raiseProfile});await new Promise(resolve=>setImmediate(resolve));assert.equal(el('masterRateHistory').innerHTML,'');
});

test('Master history refreshes a cached opened rate from the server without overwriting a rate already typed by the user',async()=>{
    for(const edited of [false,true]){
        const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{display:'flex'}});return nodes.get(id);};let complete;
        const api={auth:{currentUser:{uid:'hq'}},sessionUser:{email:'hr@example.test',permissions:['payroll']},staffProfileBaseline:{id:'staff',rate:450},openEmployeeProfile:id=>{el('empProfileId').value=id;el('empHourlyRate').value='450';},getDocFromServer:()=>new Promise(resolve=>{complete=resolve;}),doc:()=>({}),db:{}};
        installStaffRateHistory(api,{getElementById:el});api.openEmployeeProfile('staff');if(edited)el('empHourlyRate').value='525';complete({exists:()=>true,data:()=>raiseProfile});await new Promise(resolve=>setImmediate(resolve));assert.equal(Number(el('empHourlyRate').value),edited?525:500);assert.equal(api.staffProfileBaseline.rate,edited?450:500);
    }
});

test('Owner HQ access bridge writes normalized saved permissions, branch scope and inactive state using a fresh read',async()=>{
    const start=manager.indexOf('  async function grantMonitorAccess(managerId)'),end=manager.indexOf('\n  window.TKCashierStatus',start),writes=[];
    let data={email:' Manager@Example.Test ',role:'Manager',permissions:[' PAYROLL ','feed','payroll'],assignedBranch:['Maa','Maa',' Cabantian ']};
    const api={auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},db:{},doc:(_,table,id)=>({table,id}),getDocFromServer:async()=>({exists:()=>true,data:()=>data}),setDoc:async(ref,payload)=>writes.push({ref,payload}),serverTimestamp:()=>({seconds:1})};
    const context={window:api,configuredPermissions,owner:()=>api.auth.currentUser?.email==='jgo031996@gmail.com' && api.auth.currentUser.emailVerified===true};vm.runInNewContext(manager.slice(start,end)+'\nwindow.testGrant=grantMonitorAccess;',context);await api.testGrant('manager');
    assert.equal(writes[0].ref.id,'manager@example.test');assert.deepEqual(structuredClone(writes[0].payload.permissions),['payroll','feed']);assert.deepEqual(structuredClone(writes[0].payload.allowedBranches),['Maa','Cabantian']);assert.equal(writes[0].payload.active,true);
    data={...data,blocked:true};await api.testGrant('manager');assert.equal(writes[1].payload.active,false);api.auth.currentUser.email='manager@example.test';await assert.rejects(api.testGrant('manager'),/Only the owner/);assert.equal(writes.length,2);
});

test('Owner HQ bridge cannot give all-branch access to a franchise account or complete after the Owner account changes',async()=>{
    const start=manager.indexOf('  async function grantMonitorAccess(managerId)'),end=manager.indexOf('\n  window.TKCashierStatus',start);let writes=0;
    const api={auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},db:{},doc:()=>({}),getDocFromServer:async()=>({exists:()=>true,data:()=>({email:'franchise@example.test',role:'Franchise Owner',permissions:['all'],assignedBranch:'All'})}),setDoc:async()=>writes++,serverTimestamp:()=>({})};
    const context={window:api,configuredPermissions,owner:()=>api.auth.currentUser?.email==='jgo031996@gmail.com' && api.auth.currentUser.emailVerified===true};vm.runInNewContext(manager.slice(start,end)+'\nwindow.testGrant=grantMonitorAccess;',context);await assert.rejects(api.testGrant('franchise'),/permitted branches/);
    api.getDocFromServer=async()=>{api.auth.currentUser={...api.auth.currentUser,uid:'different-owner'};return {exists:()=>true,data:()=>({})};};await assert.rejects(api.testGrant('manager'),/account changed/);assert.equal(writes,0);
});
