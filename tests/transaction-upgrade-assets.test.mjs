import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function assets(app,name){
    const script=source(app+'/sw.js'),literal=script.match(new RegExp('const '+name+'\\s*=\\s*(\\[[^;]+\\]);'))?.[1];
    assert.ok(literal);const result=vm.runInNewContext(literal);
    for(const match of script.matchAll(new RegExp(name+'\\.push\\(([^;]+)\\);','g')))result.push(...vm.runInNewContext('['+match[1]+']'));
    return result.map(path=>path.replace(/^\.\//,''));
}
test('installed shells contain all new recipe and scheduling dependencies',()=>{
    for(const [app,name,required] of [
        ['takodeal-manager','CORE_ASSETS',['monthly-schedule-model.js','monthly-schedule-ui.js','monthly-schedule-integration.js','monthly-schedule.css','recipe-bulk-model.js','recipe-bulk.js','recipe-changes.js','sanction-actions.js','sanction-schedule.js','sanction-scheduling-ui.js','audit-modal.css','audit-modal-layout.js','owner-time-out-correction.js','owner-time-out-correction-ui.js','owner-time-out-correction.css']],
        ['Takodeal-POS','required',['recipe-feed.js','sanction-schedule.js','franchise-dispatch-pricing.js','franchise-supply-model.js','franchise-cost-model.js','operations-model.js']],
        ['takodeal-staff','SHELL',['sanction-schedule.js','attendance-proof.js']],
        ['takodeal-franchise','CORE',['sanction-schedule.js','sanction-actions.js','sanction-scheduling-ui.js','workspace-access-model.js']]
    ]){
        const cached=assets(app,name);
        for(const file of required)assert.ok(cached.includes(file),app+'/'+file+' is cached');
        for(const file of cached)assert.ok(existsSync(new URL('../'+app+'/'+(file||'index.html'),import.meta.url)),app+'/'+file+' is deployable');
        const js=cached.filter(file=>file.endsWith('.js'));
        for(const file of js)for(const match of source(app+'/'+file).matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+\.js)(?:\?[^'"]*)?['"]/g)) {
            assert.ok(cached.includes(match[1]),app+'/'+file+' imports cached '+match[1]);
        }
    }
});
test('sanction date decisions are identical across apps',()=>{
    const model=source('takodeal-manager/sanction-schedule.js');
    for(const app of ['Takodeal-POS','takodeal-staff','takodeal-franchise'])assert.equal(source(app+'/sanction-schedule.js'),model);
});
test('upgrade keeps paid receipts, photos and the offline sale ledger through Cashier update',()=>{
    const worker=source('Takodeal-POS/sw.js');
    assert.match(worker,/const CORE = 'takodeal-pos-core-payroll-timeout-repair-20261030'/);
    for(const [app,list] of [['Takodeal-POS','required'],['takodeal-staff','SHELL'],['takodeal-manager','CORE_ASSETS']])assert.ok(assets(app,list).includes('clock-out-schedule.js'),app+' can verify a completed shift offline after installation');
    assert.ok(assets('Takodeal-POS','required').includes('checkout-controls.js'),'checkout resets work offline');
    assert.match(worker,/dispatch-restock-model\.js/);
    assert.match(worker,/workspace-access-model\.js/);
    assert.ok(assets('Takodeal-POS','required').includes('printer-logo.js'),'new logo encoder is available offline');
    assert.match(worker,/const PHOTOS = 'takodeal-pos-photos-offline02'/);
    assert.match(source('takodeal-manager/sw.js'),/takodeal-manager-core-v110-monthly-schedule-20261030/);
    assert.match(source('takodeal-manager/owner-update-notice.js'),/takodeal-manager-core-v110-monthly-schedule-20261030/);
    for(const file of ['schedule-workspace.js','schedule-workspace.css'])assert.ok(assets('takodeal-manager','CORE_ASSETS').includes(file),'Schedule workspace is available after app update');
    assert.match(source('takodeal-staff/sw.js'),/takodeal-staff-v38-payroll-timeout-repair-20261030/);
    for(const [app,list] of [['takodeal-manager','CORE_ASSETS'],['takodeal-staff','SHELL']])assert.ok(assets(app,list).includes('time-out-request-display.js'),app+' caches schedule-review labels');
    assert.doesNotMatch(worker,/deleteDatabase|localStorage\.clear/);
    assert.match(source('Takodeal-POS/index.html'),/cashier-tablet\.css\?v=tablet-attendance-stock-20261009-r1/);
    assert.match(source('takodeal-manager/auth.js'),/main\.js\?v=staff-pos-repair-20261008-r12/);
});

test('photo-only attendance and stock report units install offline without requiring face models',()=>{
    for(const [app,name,required] of [
        ['Takodeal-POS','required',['attendance-camera.js','attendance-camera.css','stock-report-units.js']],
        ['takodeal-staff','SHELL',['attendance-camera.js','attendance-camera.css','staff-document-broker.js']]
    ]){
        const cached=assets(app,name);
        for(const file of required)assert.ok(cached.includes(file),app+'/'+file+' is cached');
        assert.ok(!cached.some(file=>file.startsWith('vendor/face-')),'optional models cannot block '+app+' installation');
        const page=source(app+'/index.html');
        assert.match(page,/attendance-camera\.css\?v=tablet-attendance-stock-20261009-r1/);
        assert.match(page,/onclick="window\.restartAttendanceCamera\(\)"/);
        assert.doesNotMatch(page,/Time In requires one clear, forward-facing/);
    }
});

test('attendance speed upgrade installs fresh schedule and transaction readers in every attendance app',()=>{
 for(const [app,list] of [['Takodeal-POS','required'],['takodeal-staff','SHELL'],['takodeal-manager','CORE_ASSETS']])for(const name of ['attendance-schedule-reader.js','attendance-transaction-reader.js'])assert.ok(assets(app,list).includes(name),app+'/'+name+' is cached');
 assert.ok(assets('takodeal-manager','CORE_ASSETS').includes('owner-inbox.js'));
 for(const name of ['attendance-schedule-reader.js','attendance-transaction-reader.js','early-time-out-actions.js'])for(const app of ['Takodeal-POS','takodeal-staff'])assert.equal(source(app+'/'+name),source('takodeal-manager/'+name));
});

test('emergency shift evidence installs identically across attendance apps',()=>{for(const [app,list] of [['takodeal-manager','CORE_ASSETS'],['Takodeal-POS','required'],['takodeal-staff','SHELL']]){assert.ok(assets(app,list).includes('emergency-shift-model.js'));assert.equal(source(app+'/emergency-shift-model.js'),source('takodeal-manager/emergency-shift-model.js'));assert.equal(source(app+'/early-time-out-actions.js'),source('takodeal-manager/early-time-out-actions.js'));}});

test('assigned-hour previews install in Staff and Cashier without changing protected ledgers',()=>{for(const [app,list] of [['Takodeal-POS','required'],['takodeal-staff','SHELL']])assert.ok(assets(app,list).includes('attendance-schedule-preview.js'));assert.equal(source('takodeal-staff/attendance-schedule-preview.js'),source('Takodeal-POS/attendance-schedule-preview.js'));});
