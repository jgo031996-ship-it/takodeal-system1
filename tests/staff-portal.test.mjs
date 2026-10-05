import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { VaultSession, createPinVerifier, verifyPin, validVerifier, validVaultPin, attendanceHistory, belongsToStaff } from '../takodeal-staff/staff-privacy.js';
import * as payroll from '../takodeal-staff/payroll-safety.js';
import {createScheduleHistoryStore} from '../takodeal-staff/schedule-history.js';

test('separate PIN verifier uses unique salts and rejects incorrect, malformed and unsafe input', async () => {
    const a = await createPinVerifier('246810', webcrypto), b = await createPinVerifier('246810', webcrypto);
    assert.notEqual(a.hash, b.hash); assert.notEqual(a.salt, b.salt);
    assert.equal(JSON.stringify(a).includes('246810'), false);
    assert.equal(await verifyPin('246810', a, webcrypto), true);
    assert.equal(await verifyPin('246811', a, webcrypto), false);
    assert.equal(await verifyPin('246810', { ...a, iterations:1 }, webcrypto), false);
    assert.equal(validVerifier({ ...a, hash:'tampered' }), false);
    await assert.rejects(createPinVerifier('1234', webcrypto));
    await assert.rejects(createPinVerifier('letters', webcrypto));
});
test('vault authorization expires, cannot cross staff, and invalidates outstanding work after relock', () => {
    let clock = 0; const vault = new VaultSession(() => clock);
    assert.equal(vault.allows('one'), false);
    const oldToken = vault.unlock('one');
    assert.equal(vault.allows('two'), false);
    clock = 110000; vault.touch('one'); clock = 220000;
    assert.equal(vault.allows('one', oldToken), true);
    clock = 230000; assert.equal(vault.allows('one'), false);
    vault.unlock('one'); assert.equal(vault.allows('one', oldToken), false);
    vault.lock(); assert.equal(vault.allows('one'), false);
});
test('attendance pairs overnight work, identifies missing punches, and excludes similarly named people', () => {
    const row = (type,time,extra={}) => ({staffName:'Ann',type,timestamp:new Date(time),branch:'Test',...extra});
    const data = [row('TIME IN','2026-10-03T18:36:00+08:00',{lateMinutes:6}),row('TIME OUT','2026-10-04T03:05:00+08:00'),
        row('TIME IN','2026-10-04T18:30:00+08:00'),row('TIME OUT','2026-10-04T19:00:00+08:00',{staffName:'Joann'}),
        row('TIME IN','2026-10-02T10:00:00+08:00'),row('TIME IN','2026-10-01T10:00:00+08:00',{staffId:'another-person'})];
    const results = attendanceHistory(data,'ann-id','Ann',new Date('2026-10-04T20:00:00+08:00'));
    assert.equal(results.length,3); assert.equal(results[0].status,'On duty');
    assert.equal(results[1].status,'Complete'); assert.equal(results[1].in.lateMinutes,6);
    assert.equal(results[1].hours.toFixed(2),'8.48'); assert.equal(results[2].status,'Missing time out');
    assert.equal(belongsToStaff({staffId:'another-person',staffName:'Ann'},'ann-id','Ann'),false);
    assert.deepEqual(attendanceHistory([row('TIME OUT','2026-10-01T18:00:00+08:00')],'ann-id','Ann')[0].status,'Missing time in');
});
test('an unrelated time out a week later cannot complete a missing shift', () => {
    const rows = attendanceHistory([{staffName:'Ann',type:'TIME IN',timestamp:'2026-10-01T10:00:00+08:00'},
        {staffName:'Ann',type:'TIME OUT',timestamp:'2026-10-08T18:00:00+08:00'}],'id','Ann');
    assert.deepEqual(rows.map(r=>r.status),['Missing time in','Missing time out']);
});
const engine = readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
test('unlocked Staff estimates include the same POS meals in current and pending cutoff deductions',async()=>{
    const nodes=new Map(),errors=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',innerText:'',style:{},parentElement:{insertAdjacentHTML(){},querySelector(){return null;}},appendChild(){},prepend(){}});return nodes.get(id);};
    class FixedDate extends Date { constructor(...args){super(...(args.length?args:['2026-10-04T12:00:00+08:00']));} }
    const meal=(amount,day,status='Unpaid',staffName='Test Staff')=>({type:'Staff Meal (POS Auto)',amount,status,staffName,dateAdded:{toDate:()=>new Date(`2026-${day}T12:00:00+08:00`)}});
    const deductions=[meal(224,'09-23'),meal(106.25,'09-28'),meal(136,'09-09','Paid'),meal(50,'10-16'),meal(99,'09-23','Unpaid','Other Staff')];
    const snapshot=rows=>({docs:rows.map((row,i)=>({id:String(i),data:()=>row})),forEach:fn=>rows.forEach((row,i)=>fn({id:String(i),data:()=>row}))});
    const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:ref=>ref,where:()=>({}),orderBy:()=>({}),
        getDoc:async ref=>({exists:()=>true,data:()=>ref.table==='cashiers'?{hourlyRate:450,scheduleNickname:'TEST'}:{}}),
        getDocs:async ref=>snapshot(ref.table==='staff_deductions'?deductions:[])};
    const context={...api,...payroll,createScheduleHistoryStore,Date:FixedDate,console:{error:(...e)=>errors.push(e)},
        window:{...api,staffVaultSession:{epoch:1,allows:()=>true}},localStorage:{getItem:key=>key.endsWith('_id')?'sample':'Test Staff'},document:{getElementById:node}};
    const start=engine.indexOf('window.loadPayslipVault = async function() {'),end=engine.indexOf('// 🧾 THE UPGRADED PAYSLIP UI ENGINE',start);
    vm.runInNewContext(engine.slice(start,end),context);await context.window.loadPayslipVault();
    assert.deepEqual(errors,[]);assert.equal(node('liveEstVales').innerText,'-₱330.25');
    assert.match(node('payslipPendingList').innerHTML,/-₱330\.25/);
    assert.match(node('liveCutoffDetailedLogs').innerHTML,/Staff Meal \(POS Auto\)/);
});
test('locked Pay entry makes zero payroll reads even if its loader is called directly', async () => {
    const start=engine.indexOf('window.loadPayslipVault = async function() {'), end=engine.indexOf('// 🧾 THE UPGRADED PAYSLIP UI ENGINE',start);
    let reads=0; const context={window:{staffVaultSession:new VaultSession()},localStorage:{getItem:key=>key.endsWith('_id')?'id':'Ann'},
        getDoc:()=>{reads++;throw Error('unexpected read');},document:{getElementById:()=>{throw Error('must not render');}},Date,console};
    vm.runInNewContext(engine.slice(start,end),context);
    await context.window.loadPayslipVault(); assert.equal(reads,0);
});
test('relocking during a slow payroll fetch prevents old pay from returning to the screen', async () => {
    const start=engine.indexOf('window.loadPayslipVault = async function() {'), end=engine.indexOf('// 🧾 THE UPGRADED PAYSLIP UI ENGINE',start);
    let finish; const vault=new VaultSession(); vault.unlock('id');
    const context={window:{staffVaultSession:vault},localStorage:{getItem:key=>key.endsWith('_id')?'id':'Ann'},
        getDoc:()=>new Promise(resolve=>{finish=resolve;}),doc:()=>null,db:{},document:{getElementById:id=>{if(id==='liveCutoffDates')return {};throw Error('stale pay rendered');}},Date,console};
    vm.runInNewContext(engine.slice(start,end),context);
    const pending=context.window.loadPayslipVault(); vault.lock(); finish({exists:()=>true,data:()=>({})}); await pending;
});
test('payroll reads target staff names rather than whole staff payroll collections', () => {
    const pay=engine.slice(engine.indexOf('window.loadPayslipVault = async'),engine.indexOf('// 🧾 THE UPGRADED PAYSLIP UI ENGINE'));
    assert.equal(pay.includes('n.includes(strippedNameLower)'),false);
    for(const collection of ['payroll_records','staff_ledger','attendance_logs','staff_bonuses','staff_deductions']) {
        assert.match(pay,new RegExp('collection\\(db, "'+collection+'"\\), where\\("staffName", "in"'));
    }
    assert.match(engine,/staffId: localStorage.getItem\('takodeal_staff_id'\)/);
});
test('viewer, image export and signature require a currently open vault', () => {
    for(const fn of ['viewPastPayslip','downloadStaffPayslipImage','openPayslipSignatureModal']) {
        assert.match(engine,new RegExp('window\\.'+fn+' = function\\([^)]*\\) \\{\\s+if \\(!window.staffVaultSession'));
    }
});
test('install icon assets really have the declared PNG dimensions and the shell registers its cache', () => {
    const manifest=JSON.parse(readFileSync(new URL('../takodeal-staff/manifest.json',import.meta.url),'utf8'));
    for(const icon of manifest.icons) {
        const image=readFileSync(new URL('../takodeal-staff/'+icon.src,import.meta.url));
        assert.equal(image.subarray(1,4).toString(),'PNG');
        assert.equal(icon.sizes,`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`);
    }
    assert.match(readFileSync(new URL('../takodeal-staff/staff-portal.js',import.meta.url),'utf8'),/serviceWorker.register\('\.\/sw.js'\)/);
});

function portalHarness(initialPin) {
    const nodes=new Map(), listeners=new Map(), storage=new Map([['takodeal_staff_id','demo'],['takodeal_staff_name','Demo Staff']]);
    const node=id=>{
        if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,innerHTML:id==='vaultContent'?'zero-value template':'',textContent:'',style:{},focus(){},setAttribute(){},remove(){},classList:{contains:()=>id==='view-payslip'}});
        return nodes.get(id);
    };
    let staff={pin:'1111',cashierName:'Demo Staff',payslipPin:initialPin}, writes=0, loads=0;
    const context={VaultSession,createPinVerifier,verifyPin,validVerifier,validVaultPin,attendanceHistory,escapeHtml:x=>x,Date,console,crypto:webcrypto,
        setInterval:()=>0,navigator:{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        document:{hidden:false,getElementById:node,querySelectorAll:()=>[],querySelector:()=>({scrollTop:0}),addEventListener:(event,fn)=>listeners.set(event,fn)}};
    context.window={db:{},doc:()=>null,getDoc:async()=>({exists:()=>true,data:()=>({...staff})}),updateDoc:async(ref,data)=>{writes++;Object.assign(staff,data);},
        switchView(){},checkNormalLogin(){},loginStaff:async()=>{},logoutStaff(){},openProfile(){},loadPayslipVault(){loads++;},addEventListener:(event,fn)=>listeners.set(event,fn),Swal:{close(){}}};
    const source=readFileSync(new URL('../takodeal-staff/staff-portal.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
    vm.runInNewContext(source+'\ninstallStaffPortal();',context);
    return {context,node,listeners,writes:()=>writes,loads:()=>loads,staff:()=>staff};
}
test('Pay entry without a PIN directs staff to Profile without creating or unlocking one', async () => {
    const h=portalHarness(); let opened=0;
    h.context.window.openProfile=()=>opened++;
    await h.context.window.openVaultPin('unlock');
    assert.equal(opened,1); assert.equal(h.writes(),0); assert.equal(h.loads(),0);
    assert.equal(h.node('vaultPinModal').style.display,'none');
});
test('first setup requires the staff login PIN and refuses to reuse it', async () => {
    const h=portalHarness(); await h.context.window.openVaultPin('change');
    h.node('vaultCurrentPin').value='wrong';h.node('vaultNewPin').value='123456';h.node('vaultConfirmPin').value='123456';
    await h.context.window.submitVaultPin();assert.equal(h.writes(),0);assert.equal(h.loads(),0);
    h.node('vaultCurrentPin').value='1111';h.node('vaultNewPin').value='123456';h.node('vaultConfirmPin').value='123456';
    await h.context.window.submitVaultPin();assert.equal(h.writes(),1);assert.equal(h.loads(),1);
    assert.equal(await verifyPin('123456',h.staff().payslipPin),true);
    h.context.window.lockPayslipVault();assert.equal(h.node('vaultContent').hidden,true);
    assert.equal(h.node('vaultContent').innerHTML,'zero-value template');assert.equal(h.node('vaultNewPin').value,'');
    const same=portalHarness();same.staff().pin='123456'; await same.context.window.openVaultPin('change');
    same.node('vaultCurrentPin').value='123456';same.node('vaultNewPin').value='123456';same.node('vaultConfirmPin').value='123456';
    await same.context.window.submitVaultPin();assert.equal(same.writes(),0);assert.match(same.node('vaultError').textContent,/different/);
});
test('hidden app relocks, and changing a vault PIN requires its previous PIN', async () => {
    const original=await createPinVerifier('246810'),h=portalHarness(original);
    await h.context.window.openVaultPin('change');
    h.node('vaultCurrentPin').value='1111';h.node('vaultNewPin').value='135790';h.node('vaultConfirmPin').value='135790';
    await h.context.window.submitVaultPin();assert.equal(h.writes(),0);
    h.node('vaultCurrentPin').value='246810';await h.context.window.submitVaultPin();assert.equal(h.writes(),1);
    assert.equal(await verifyPin('246810',h.staff().payslipPin),false);
    assert.equal(await verifyPin('135790',h.staff().payslipPin),true);
    h.context.document.hidden=true;h.listeners.get('visibilitychange')();
    assert.equal(h.node('vaultContent').hidden,true);assert.equal(h.context.window.staffVaultSession.allows('demo'),false);
});
test('five failed attempts trigger a local cooldown before another profile read or unlock', async () => {
    const h=portalHarness(await createPinVerifier('246810'));await h.context.window.openVaultPin();
    h.node('vaultCurrentPin').value='246811';
    for(let i=0;i<5;i++)await h.context.window.submitVaultPin();
    h.node('vaultCurrentPin').value='246810';await h.context.window.submitVaultPin();
    assert.equal(h.loads(),0);assert.match(h.node('vaultError').textContent,/Wait one minute/);
});
