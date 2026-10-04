import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createShiftCloseDraftStore, countValue} from '../Takodeal-POS/shift-close-draft.js';

const scope = {branch:'Maa', shiftId:'shift-1'};
const storage = () => {
    const values = new Map();
    return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key), values};
};
test('cash and stock drafts survive an app restart with zero and blank values intact', () => {
    const local = storage(), store = createShiftCloseDraftStore(local,()=>123);
    assert.equal(store.save(scope, {1000:'15',500:'16',100:''}, {'Egg L_purch':'0','Egg L_base':'20'}).persistent,true);
    const draft = createShiftCloseDraftStore(local).load(scope);
    assert.deepEqual(draft.cash,{1000:'15',500:'16',100:''});
    assert.deepEqual(draft.stock,{'Egg L_purch':'0','Egg L_base':'20'});
    assert.equal(draft.savedAt,123);
});
test('another branch or another shift never inherits the drawer or stock draft', () => {
    const store=createShiftCloseDraftStore(storage());store.save(scope,{1000:15},{'Egg L_base':20});
    assert.equal(store.load({branch:'Cabantian',shiftId:'shift-1'}),null);
    assert.equal(store.load({branch:'Maa',shiftId:'shift-2'}),null);
});
test('clearing a successfully closed shift only removes that shift draft', () => {
    const local=storage(),store=createShiftCloseDraftStore(local), other={branch:'Maa',shiftId:'shift-2'};
    store.save(scope,{1000:15},{});store.save(other,{500:2},{});store.clear(scope);
    assert.equal(createShiftCloseDraftStore(local).load(scope),null);
    assert.deepEqual(store.load(other).cash,{500:'2'});
});
test('invalid stored data does not interrupt opening clearance', () => {
    const local=storage();local.setItem('takodeal_shift_close_draft_v1:'+JSON.stringify(['Maa','shift-1']),'{broken');
    assert.equal(createShiftCloseDraftStore(local).load(scope),null);
    assert.equal(countValue('-2',true),'');assert.equal(countValue('1.5',true),'');assert.equal(countValue('1.5'),'1.5');
    assert.equal(countValue('<img>'),'');assert.equal(countValue('Infinity'),'');
});
test('blocked storage preserves counts within the open app and reports persistence failure', () => {
    const local={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
    const store=createShiftCloseDraftStore(local);
    assert.deepEqual(store.save(scope,{1000:'15'},{}),{saved:true,persistent:false});
    assert.deepEqual(store.load(scope).cash,{1000:'15'});store.clear(scope);assert.equal(store.load(scope),null);
});

function realClearance(local, shift='shift-1') {
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    const start=source.indexOf('const shiftCloseDraftStore = createShiftCloseDraftStore(localStorage);');
    const end=source.indexOf('// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE',start);
    const inputs=[], cashRows=[], status={style:{},setAttribute(){},textContent:''};
    const blind={innerHTML:'',replaceChildren(){inputs.splice(0,inputs.length);}};
    const elements={shiftCloseDraftStatus:status,dynamicBlindCountList:blind,endShiftModal:{style:{}},grandTotalCash:{},denominationTable:{set innerHTML(value){
        cashRows.splice(0,cashRows.length);
        for(const match of value.matchAll(/data-val="(\d+)" placeholder="0" value="([^"]*)"/g))cashRows.push({dataset:{val:match[1]},value:match[2],getAttribute:()=>match[1],parentElement:{nextElementSibling:{}}});
    }}};
    const document={getElementById:id=>elements[id]||null,addEventListener(){},querySelectorAll:selector=>selector.includes('denom-input')?cashRows:inputs};
    const context={createShiftCloseDraftStore,countValue,localStorage:local,document,sessionUser:{branch:'Maa'},activeShiftDetails:{logId:shift},window:{addEventListener(){}},Swal:{fire(){}},getDoc:async()=>({exists:()=>false}),doc(){},db:{}};
    vm.runInNewContext(source.slice(start,end),context);
    return {context,cashRows,inputs,status};
}
test('actual clearance restores the drawer after dismissing and restarting the app',async()=>{
    const local=storage(),app=realClearance(local);await app.context.window.openEndShiftClearance();
    app.cashRows.find(row=>row.dataset.val==='1000').value='15';
    app.cashRows.find(row=>row.dataset.val==='500').value='16';
    app.context.window.calculateGrandTotalCash();
    await app.context.window.openEndShiftClearance();
    assert.equal(app.cashRows.find(row=>row.dataset.val==='1000').value,'15');
    const restarted=realClearance(local);await restarted.context.window.openEndShiftClearance();
    assert.equal(restarted.cashRows.find(row=>row.dataset.val==='500').value,'16');
    assert.match(restarted.status.textContent,/Draft saved on this device/);
});
test('opening a different shift clears old rendered stock before saving its draft',async()=>{
    const app=realClearance(storage());await app.context.window.openEndShiftClearance();
    app.inputs.push({dataset:{name:'Egg L'},value:'999',classList:{contains:()=>false}});
    app.context.activeShiftDetails.logId='shift-2';
    await app.context.window.openEndShiftClearance();
    assert.equal(app.inputs.length,0);assert.deepEqual(Object.keys(app.context.window.blindCountMemory),[]);
    assert.ok(app.cashRows.every(row=>row.value===''));
});
