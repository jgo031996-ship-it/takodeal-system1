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
        ['takodeal-manager','CORE_ASSETS',['recipe-bulk-model.js','recipe-bulk.js','recipe-changes.js','sanction-actions.js','sanction-schedule.js','sanction-scheduling-ui.js']],
        ['Takodeal-POS','required',['recipe-feed.js','sanction-schedule.js']],
        ['takodeal-staff','SHELL',['sanction-schedule.js']],
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
    assert.match(worker,/staff-pos-repair-20261008-r12/);
    assert.match(worker,/const PHOTOS = 'takodeal-pos-photos-offline02'/);
    assert.doesNotMatch(worker,/deleteDatabase|localStorage\.clear/);
    assert.match(source('Takodeal-POS/index.html'),/cashier-tablet\.css\?v=staff-pos-repair-20261008-r12/);
    assert.match(source('takodeal-manager/auth.js'),/main\.js\?v=staff-pos-repair-20261008-r12/);
});
