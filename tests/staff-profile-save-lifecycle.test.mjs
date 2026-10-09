import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dailyStaffRate, staffProfileOperation} from '../takodeal-manager/staff-rate-changes.js';

const main = fs.readFileSync(new URL('../takodeal-manager/main.js', import.meta.url), 'utf8');
function actualFunction(name) {
    const start = main.indexOf(`window.${name} =`);
    assert.notEqual(start, -1, `${name} exists in Manager`);
    return main.slice(start, main.indexOf('\n};', start) + 3);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({missingId = false, deferredHistory = false} = {}) {
    const nodes = new Map(), saves = [], queries = [], notices = [], histories = [];
    let deductions = [], nextId = 0;
    const profiles = {
        A: {cashierName:'Employee A', branch:'Maa', role:'Crew', pin:'1111', hourlyRate:450,
            empId:missingId ? '' : 'A-ID', phone:'A-phone', address:'A-address', dateHired:'2026-01-01',
            emergencyName:'A-contact', emergencyPhone:'A-emergency', email:'a@example.test',
            bloodType:'A+', customDeductions:[{name:'A deduction', amount:10}]},
        B: {cashierName:'Employee B', branch:'Maa', role:'Crew', pin:'2222', hourlyRate:500,
            empId:'B-ID', phone:'B-phone', address:'B-address', dateHired:'2026-02-02',
            emergencyName:'B-contact', emergencyPhone:'B-emergency', email:'b@example.test',
            bloodType:'B+', customDeductions:[{name:'B deduction', amount:20}]}
    };
    const node = id => {
        if (!nodes.has(id)) {
            let value = '', html = '';
            nodes.set(id, {
                get value() { return value; }, set value(next) { value = String(next ?? ''); },
                get innerHTML() { return html; }, set innerHTML(next) { html = next; if(id === 'customDeductionsContainer') deductions = []; },
                checked:false, disabled:false, hidden:false, isConnected:true,
                style:{display:'none'}, innerText:'', textContent:'',
                setAttribute() {}, removeAttribute() {}
            });
        }
        return nodes.get(id);
    };
    const empty = {forEach() {}};
    const api = {
        db:{}, sessionUser:{}, globalStaffData:profiles, crypto,
        auth:{currentUser:{uid:'owner', email:'owner@example.test', emailVerified:true}},
        ManagerUI:{notify:message => notices.push(message)}, loadHRModule() {},
        collection:(_, table) => ({table}),
        query:(collection, ...clauses) => ({...collection, clauses}),
        where:(field, op, value) => ({field, op, value}), orderBy:() => ({}), limit:() => ({}),
        doc:(...args) => args.length === 1 ? {id:`new-${++nextId}`, table:args[0].table} : {id:args[2], table:args[1]},
        getDocs:q => q.table === 'cashiers' ? new Promise(resolve => queries.push(() => resolve(empty))) : deferredHistory && q.table === 'staff_deductions' ? new Promise((resolve, reject) => {
            histories.push({
                name:q.clauses.find(clause => clause.field === 'staffName')?.value,
                finish:type => resolve({forEach:visit => visit({id:type, data:() => ({type, status:'Unpaid', amount:10, dateAdded:'2026-10-08'})})}),
                fail:() => reject(Error('Simulated history read failure'))
            });
        }) : Promise.resolve(empty),
        addCustomDeductionRow:(name, amount) => deductions.push({querySelector:selector => ({value:selector === '.cd-name' ? name : String(amount)})})
    };
    const atomic = async (_, id, payload, options) => new Promise((resolve, reject) => {
        saves.push({id, payload:structuredClone(payload), options:structuredClone(options),
            finish:() => resolve({profile:{...profiles[id], ...payload}}), fail:() => reject(Error('Simulated old save failure'))});
    });
    const context = {
        window:api, document:{getElementById:node, querySelectorAll:() => deductions},
        dailyStaffRate, staffProfileOperation, saveStaffProfileAtomic:atomic,
        Swal:{fire:(...args) => notices.push(args)}, installSanctionScheduling() {},
        isPenaltyDeduction:() => false, console:{error() {}}, Date, crypto, structuredClone
    };
    vm.runInNewContext(['addNewStaff', 'openEmployeeProfile', 'saveEmployeeProfile'].map(actualFunction).join('\n'), context);
    return {api, node, saves, queries, notices, histories, async waitForSave(count = 1) {
        for(let i = 0; i < 10 && saves.length < count; i++) await tick();
        assert.equal(saves.length, count, 'captured save reached transport');
    }};
}

test('a slow employee ID query saves only the captured employee fields after a different employee is opened', async () => {
    const f = fixture({missingId:true});
    f.api.openEmployeeProfile('A');
    const pending = f.api.saveEmployeeProfile();
    assert.equal(f.queries.length, 1);
    f.api.openEmployeeProfile('B');
    f.queries[0]();
    await f.waitForSave();
    const saved = f.saves[0];
    assert.equal(saved.id, 'A');
    assert.equal(saved.payload.cashierName, 'Employee A');
    assert.equal(saved.payload.phone, 'A-phone');
    assert.equal(saved.payload.address, 'A-address');
    assert.equal(saved.payload.dateHired, '2026-01-01');
    assert.equal(saved.payload.emergencyName, 'A-contact');
    assert.equal(saved.payload.email, 'a@example.test');
    assert.equal(saved.payload.bloodType, 'A+');
    assert.deepEqual(saved.payload.customDeductions, [{name:'A deduction', amount:10}]);
    assert.equal(f.node('profEmpId').value, 'B-ID');
    saved.finish(); await pending;
    assert.equal(f.node('empProfileId').value, 'B');
    assert.equal(f.api.staffProfileBaseline.id, 'B');
});

test('successful old save cannot overwrite the next employee selection or new staff draft', async () => {
    for(const next of ['B', 'new']) {
        const f = fixture(); f.api.openEmployeeProfile('A');
        const pending = f.api.saveEmployeeProfile(); await f.waitForSave();
        if(next === 'B') f.api.openEmployeeProfile('B');
        else { f.api.addNewStaff(); f.node('empFullName').value = 'New draft'; }
        const baseline = f.api.staffProfileBaseline;
        f.saves[0].finish(); await pending;
        assert.equal(f.node('empProfileId').value, next === 'B' ? 'B' : '');
        assert.equal(f.api.staffProfileBaseline, baseline, 'new form baseline identity is retained');
        assert.equal(f.node('empFullName').value, next === 'B' ? 'Employee B' : 'New draft');
        assert.equal(f.node('employeeProfileModal').style.display, 'flex');
        assert.equal(f.api.globalStaffData.A.phone, 'A-phone', 'legitimate captured save still finishes');
    }
});

test('an old save completion or failure cannot release the shared button while the next employee save is pending', async () => {
    for(const failOld of [false, true]) {
        const f = fixture(); f.api.openEmployeeProfile('A');
        const oldSave = f.api.saveEmployeeProfile(); await f.waitForSave();
        f.api.openEmployeeProfile('B');
        assert.equal(f.node('btnSaveEmpProfile').disabled, false, 'opening another form releases only the old UI ownership');
        const nextSave = f.api.saveEmployeeProfile(); await f.waitForSave(2);
        assert.equal(f.node('btnSaveEmpProfile').disabled, true);
        if(failOld) f.saves[0].fail(); else f.saves[0].finish();
        await oldSave;
        assert.equal(f.node('btnSaveEmpProfile').disabled, true, 'old finally cannot unlock the newer save');
        assert.equal(f.node('empProfileId').value, 'B');
        assert.equal(f.api.staffProfileBaseline.id, 'B');
        f.saves[1].finish(); await nextSave;
        assert.equal(f.node('btnSaveEmpProfile').disabled, false);
        assert.equal(f.api.staffProfileBaseline.id, 'B');
    }
});

test('successful old save preserves a newer new-staff reference and lost-ack operation identity', async () => {
    const f = fixture(); f.api.openEmployeeProfile('A');
    const oldSave = f.api.saveEmployeeProfile(); await f.waitForSave();
    f.api.addNewStaff();
    for(const [id, value] of Object.entries({empFullName:'New Employee', empHourlyRate:'480', empPin:'3333', profEmpId:'NEW-ID'})) f.node(id).value=value;
    const nextSave = f.api.saveEmployeeProfile(); await f.waitForSave(2);
    const reference=f.api.pendingEmployeeProfileRef, operation=f.saves[1].options.operationId;
    assert.equal(reference.id, f.saves[1].id);
    f.saves[0].finish(); await oldSave;
    assert.equal(f.node('empProfileId').value, '');
    assert.equal(f.api.pendingEmployeeProfileRef, reference);
    assert.ok([...f.api.staffProfilePending.values()].includes(operation), 'newer operation survives old success');
    assert.equal(f.node('btnSaveEmpProfile').disabled, true);
    f.saves[1].fail(); await nextSave;
    assert.equal(f.api.pendingEmployeeProfileRef, reference, 'failed acknowledgment retains the same document');
    const retry=f.api.saveEmployeeProfile(); await f.waitForSave(3);
    assert.equal(f.saves[2].id, reference.id);
    assert.equal(f.saves[2].options.operationId, operation);
    f.saves[2].finish(); await retry;
    assert.equal(f.node('empProfileId').value, reference.id);
});

test('a Google account switch during ID generation stops the mutation before its transport starts', async () => {
    const f = fixture({missingId:true}); f.api.openEmployeeProfile('A');
    const pending=f.api.saveEmployeeProfile();
    f.api.auth.currentUser={uid:'another', email:'another@example.test', emailVerified:true};
    f.queries[0]();
    await tick();
    assert.equal(f.saves.length, 0, 'the old account payload is not submitted under a new account');
    await pending;
    assert.equal(f.api.globalStaffData.A.phone, 'A-phone');
});

test('slow deduction history success or failure cannot replace another employee history', async () => {
    for(const failOld of [false, true]) {
        const f=fixture({deferredHistory:true});
        f.api.openEmployeeProfile('A'); f.api.openEmployeeProfile('B');
        assert.deepEqual(f.histories.map(row => row.name), ['Employee A', 'Employee B']);
        f.histories[1].finish('B-only deduction'); await tick();
        const current=f.node('empProfileHistoryBody').innerHTML;
        assert.match(current, /B-only deduction/);
        if(failOld) f.histories[0].fail(); else f.histories[0].finish('A-only deduction');
        await tick();
        assert.equal(f.node('empProfileHistoryBody').innerHTML, current);
    }
});

test('deduction history completion cannot render after an account switch, new draft, or closed modal', async () => {
    for(const change of ['account', 'new', 'closed']) for(const fail of [false, true]) {
        const f=fixture({deferredHistory:true}); f.api.openEmployeeProfile('A');
        if(change === 'account') f.api.auth.currentUser={uid:'another', email:'another@example.test', emailVerified:true};
        if(change === 'new') f.api.addNewStaff();
        if(change === 'closed') f.node('employeeProfileModal').style.display='none';
        const before=f.node('empProfileHistoryBody').innerHTML;
        if(fail) f.histories[0].fail(); else f.histories[0].finish('A-only deduction');
        await tick();
        assert.equal(f.node('empProfileHistoryBody').innerHTML, before);
        assert.equal(f.node('empProfileHistoryBody').innerHTML.includes('A-only deduction'), false);
    }
});
