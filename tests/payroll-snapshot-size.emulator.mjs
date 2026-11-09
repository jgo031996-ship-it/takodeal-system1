// Actual ordinary payroll, real Firebase SDK and unchanged compiled Rules.
// Only synthetic records in a fresh loopback demo project are used.
import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {finalizeOrdinaryPayroll, ordinaryPayrollId, PAYROLL_SETTLEMENT_LIMITS} from '../takodeal-manager/payroll-settlement.js';
import {createScheduleRevision, assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {payrollScheduleStamp, assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';

const host = '127.0.0.1', port = 8876, projectId = 'demo-payroll-snapshot-size';
const endpoint = host + ':' + port;
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== endpoint) {
    throw Error('Refusing a non-test Firestore endpoint.');
}
process.env.FIRESTORE_EMULATOR_HOST = endpoint;
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = resolve(process.env.TAKODEAL_TEST_TOOLS || resolve(root, '../staff-nextlevel-tools'));
const req = createRequire(resolve(tools, 'package.json'));
const {initializeTestEnvironment} = req('@firebase/rules-unit-testing');
const sdk = req('firebase/firestore');
sdk.setLogLevel('silent');
const {doc, setDoc, getDocFromServer, getDocsFromServer, collection, query, where, limit,
    runTransaction, serverTimestamp, Timestamp} = sdk;
const java = JSON.parse(readFileSync(resolve(tools, 'runtime.json'))).java;
const jar = resolve(tools, 'emulators/cloud-firestore-emulator-v1.22.0.jar');
if (!existsSync(java) || !existsSync(jar)) throw Error('Local emulator runtime missing.');
let env, child, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reachable = () => new Promise(resolve => {
    const socket = createConnection({host, port});
    socket.setTimeout(250);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
before(async () => {
    if (await reachable()) throw Error('Refusing an occupied emulator port.');
    child = spawn(java, ['-jar', jar, '--host', host, '--port', String(port), '--project_id', projectId], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', value => output = (output + value).slice(-16000));
    }
    const until = Date.now() + 30000;
    while (!await reachable()) {
        if (child.exitCode !== null || Date.now() > until) throw Error('Local emulator did not start: ' + output);
        await pause(100);
    }
    env = await initializeTestEnvironment({projectId, firestore: {
        host, port, rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8')
    }});
}, {timeout: 45000});
after(async () => {
    await env?.cleanup();
    if (child && child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, 'exit'), pause(3000)]);
    }
});
beforeEach(async () => { await env.clearFirestore(); });

const BRANCH = 'Synthetic Payroll Branch', STAFF = 'synthetic-payroll-staff';
const NAME = 'Fictional Payroll Crew', UID = 'synthetic-payroll-manager';
const EMAIL = 'payroll-manager@example.invalid', ACCOUNT = 'synthetic-payment-bank';
const cutoff = {start: '2030-01-01', end: '2030-01-15'};
const recordId = ordinaryPayrollId(STAFF, cutoff.start, cutoff.end);
const byteLength = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;

function canonicalScheduleHistory() {
    const branches = [BRANCH, 'Synthetic Branch Two', 'Synthetic Branch Three'];
    const branchConfig = Object.fromEntries(branches.map(branch => [branch,
        Array.from({length: 6}, (_, index) => ({id: 'shift-' + index, name: 'Fictional shift ' + index,
            startTime: '08:00', endTime: '17:00'}))]));
    const currentSchedule = Object.fromEntries(Array.from({length: 31}, (_, day) => [String(day + 1),
        Object.fromEntries(branches.map((branch, branchIndex) => [branch, {scheduled:
            Object.fromEntries(Array.from({length: 6}, (_, shift) => ['shift-' + shift, {
                staffId: 'fictional-crew-' + branchIndex + '-' + shift,
                staffName: 'Fictional Scheduled Crew ' + branchIndex + ' ' + shift,
                start: '08:00', end: '17:00'
            }]))}]))]));
    const snapshot = {currentYear: 2030, currentMonth: 1, branchConfig, currentSchedule, employees: [], holidays: {}};
    // Each immutable version is created by the production history writer and
    // remains below its own archive limit. Many relevant real versions make
    // the canonical preview stamp large without padding any payroll fact.
    const revisions = Array.from({length: 24}, (_, index) => ({
        ...createScheduleRevision(snapshot, {revisionId: 'synthetic-version-' + String(index).padStart(3, '0'),
            effectiveFrom: '2030-01-01', effectiveTo: '2030-01-31', savedAt: '2029-12-31T00:00:00Z',
            actor: EMAIL, cutover: '2030-01-01'}), sequence: index + 1
    }));
    return assembleScheduleHistory(snapshot, [{month: '2030-01', latestRevisionId: revisions.at(-1).revisionId,
        revisions, shiftAmendments: []}], {enforcedFrom: '2030-01-01'});
}
const originalHistory = canonicalScheduleHistory();
const originalStamp = payrollScheduleStamp(originalHistory, cutoff);
const admin = callback => env.withSecurityRulesDisabled(context => callback(context.firestore()));

async function fixture({loseAck = false} = {}) {
    const profile = {cashierName: NAME, branch: BRANCH, role: 'Crew', hourlyRate: 450,
        dateHired: '2029-01-01', customDeductions: []};
    const actor = {uid: UID, email: EMAIL, emailVerified: true, providerData: [{providerId: 'google.com'}]};
    const manager = {email: EMAIL, fullName: 'Fictional Payroll Manager', role: 'Manager',
        permissions: ['payroll'], assignedBranch: BRANCH, active: true};
    await admin(async db => {
        await setDoc(doc(db, 'hq_managers', UID), manager);
        await setDoc(doc(db, 'hq_email_access', EMAIL), {active: true, permissions: ['payroll'], allowedBranches: [BRANCH]});
        await setDoc(doc(db, 'cashiers', STAFF), profile);
        await setDoc(doc(db, 'cash_accounts', ACCOUNT), {name: 'Fictional Payment Bank', branch: BRANCH, balance: 1000});
        for (const [id, amount, day] of [['synthetic-food-a', 40, '02'], ['synthetic-food-b', 15, '03']]) {
            await setDoc(doc(db, 'staff_deductions', id), {staffId: STAFF, staffName: NAME, branch: BRANCH,
                type: 'Staff Meal (POS Auto)', amount, status: 'Unpaid',
                dateAdded: Timestamp.fromDate(new Date('2030-01-' + day + 'T12:00:00+08:00')),
                receiptId: 'FICTIONAL-' + id, items: [{name: 'Fictional meal', qty: 1}]});
        }
    });
    const db = env.authenticatedContext(UID, {email: EMAIL, email_verified: true,
        firebase: {sign_in_provider: 'google.com'}}).firestore();
    const history = structuredClone(originalHistory);
    const api = {db, doc, collection, query, where, limit, getDocFromServer, getDocsFromServer, serverTimestamp,
        auth: {currentUser: actor}, sessionUser: createWorkspaceSession(actor, manager),
        isBranchAllowed: branch => branch === BRANCH, loadPayrollScheduleHistory: async () => history,
        runTransaction: async (...args) => {
            const result = await runTransaction(...args);
            if (loseAck) { loseAck = false; throw Error('Synthetic acknowledgement lost after real payroll commit'); }
            return result;
        }};
    const data = {staffId: STAFF, name: NAME, branch: BRANCH, ...cutoff,
        profile: {...profile, staffId: STAFF}, scheduleEvidenceStamp: originalStamp,
        hours: 8, recordedHours: 8, shiftsWorked: 1, basicPay: 450, meals: 50,
        sourcePerfBonus: 0, customDeductions: [], customDeductionsTotal: 0,
        attendanceLogIds: ['synthetic-original-in', 'synthetic-original-out'],
        logs: [{date: 'Jan 1', in: '08:00 AM', out: '05:00 PM', hrs: '8.00', remark: 'Fictional original attendance',
            dailyRate: 450, rateWorkDate: '2030-01-01', scheduleSource: 'history',
            scheduleRevisionId: 'synthetic-version-023', scheduleAmendmentIds: ['synthetic-original-correction'],
            expectedStartAt: '2030-01-01T00:00:00.000Z', expectedEndAt: '2030-01-01T09:00:00.000Z'}]};
    return {api, data, history, pay: overrides => finalizeOrdinaryPayroll(api,
        {data, accountId: ACCOUNT, finalNetPay: 400, ...overrides})};
}

async function financialState() {
    let state;
    await admin(async db => {
        const rows = async table => (await getDocsFromServer(collection(db, table))).docs
            .map(snap => ({id: snap.id, ...snap.data()})).sort((a, b) => a.id.localeCompare(b.id));
        state = {accounts: await rows('cash_accounts'), payroll: await rows('payroll_records'),
            expenses: await rows('expenses'), deductions: await rows('staff_deductions')};
    });
    return state;
}

function assertOnePayment(state, data) {
    assert.equal(state.accounts[0].balance, 600);
    assert.equal(state.payroll.length, 1);
    assert.equal(state.expenses.length, 1);
    const saved = state.payroll[0];
    assert.equal(saved.id, recordId);
    assert.equal(saved.finalNetPay, 400);
    assert.equal(saved.frozenData.finalNetPay, 400);
    assert.equal(saved.frozenData.basicPay, 450);
    assert.equal(saved.frozenData.meals, 50);
    assert.equal(saved.frozenData.profile.hourlyRate, 450);
    assert.equal(saved.frozenData.isPaid, true);
    assert.deepEqual(saved.frozenData.logs, data.logs);
    assert.deepEqual(saved.frozenData.attendanceLogIds, data.attendanceLogIds);
    assert.equal(Object.hasOwn(saved.frozenData, 'scheduleEvidenceStamp'), false);
    assert.ok(byteLength(saved.frozenData) < PAYROLL_SETTLEMENT_LIMITS.documentBytes);
    assert.equal(saved.frozenData.deductionDetails.length, 2);
    assert.equal(saved.frozenData.deductionDetails[0].items[0].name, 'Fictional meal');
    assert.equal(state.expenses[0].payrollRecordId, recordId);
    assert.equal(state.expenses[0].amount, 400);
    const first = state.deductions.find(row => row.id === 'synthetic-food-a');
    const second = state.deductions.find(row => row.id === 'synthetic-food-b');
    assert.equal(first.status, 'Paid');
    assert.equal(first.payrollRecordId, recordId);
    assert.equal(first.amount, 40);
    assert.equal(second.status, 'Unpaid');
    assert.equal(second.amount, 5);
}

test('real SDK saves ordinary payroll with a canonical schedule stamp larger than 750KB and preserves its original frozen facts', async () => {
    assert.ok(byteLength(originalStamp) > PAYROLL_SETTLEMENT_LIMITS.documentBytes);
    assert.equal(JSON.parse(originalStamp).version, 2);
    const f = await fixture(), before = structuredClone(f.data);
    await assertPayrollScheduleFresh(f.api, f.data);
    const paid = await f.pay();
    assert.equal(paid.alreadyPaid, false);
    assertOnePayment(await financialState(), before);
    assert.deepEqual(f.data, before, 'the preview stamp and attendance facts remain untouched');
    const committed = await financialState();
    f.data.basicPay = 9999;
    f.data.meals = 0;
    const retry = await f.pay({finalNetPay: 9999});
    assert.equal(retry.alreadyPaid, true);
    assert.equal(retry.finalNetPay, 400);
    assert.deepEqual(retry.frozenData, paid.frozenData);
    assert.deepEqual(await financialState(), committed, 'saved history wins without another debit or deduction');
});

test('lost acknowledgement of the actual compact payroll commit retries without another debit or meal settlement', async () => {
    const f = await fixture({loseAck: true}), before = structuredClone(f.data);
    await assertPayrollScheduleFresh(f.api, f.data);
    await assert.rejects(f.pay(), /acknowledgement lost/);
    const committed = await financialState();
    assertOnePayment(committed, before);
    const recovered = await f.pay();
    assert.equal(recovered.alreadyPaid, true);
    assert.equal(recovered.finalNetPay, 400);
    assert.deepEqual(recovered.frozenData, committed.payroll[0].frozenData);
    assert.deepEqual(await financialState(), committed);
    assert.equal(f.data.scheduleEvidenceStamp, originalStamp);
});

test('large canonical evidence still holds an unpaid payment when its actual schedule changes', async () => {
    const f = await fixture(), before = await financialState();
    f.history.historyMonths['2030-01'].revisions[0].snapshot.branchConfig[BRANCH][0].endTime = '18:00';
    await assert.rejects(assertPayrollScheduleFresh(f.api, f.data), /saved shift times changed/);
    assert.deepEqual(await financialState(), before);
});

test('actual oversized attendance facts retain the original 750KB limit and cause no payroll or account write', async () => {
    const f = await fixture(), before = await financialState();
    f.data.logs[0].remark = 'x'.repeat(PAYROLL_SETTLEMENT_LIMITS.documentBytes + 1000);
    await assert.rejects(f.pay(), /too large for one payment/);
    assert.deepEqual(await financialState(), before);
    assert.equal(PAYROLL_SETTLEMENT_LIMITS.documentBytes, 750000);
});
