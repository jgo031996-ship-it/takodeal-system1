import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPendingPaymentTally} from '../Takodeal-POS/pending-payment-tally.js';
test('one change among a thousand fictional receipts decodes only one receipt, including repeated callbacks and shift changes',()=>{
 const tally=createPendingPaymentTally();let reads=0;
 const change=(i,shiftId,type='added',extra={})=>({type,doc:{id:String(i),data:()=>{reads++;return{shiftId,paymentMethod:'GCash',status:'Paid',...extra};}}});
 const submit=(changes,scope='one')=>tally({docChanges:()=>changes},scope);
 assert.deepEqual(submit(Array.from({length:1000},(_,i)=>change(i,i%2?'one':'two'))),{total:1000,shift:500});reads=0;
 const changed=change(0,'one','modified');assert.deepEqual(submit([changed]),{total:1000,shift:501});assert.equal(reads,1);
 assert.deepEqual(submit([changed]),{total:1000,shift:501});assert.deepEqual(submit([],'two'),{total:1000,shift:499});
 assert.deepEqual(submit([change(1,'one','modified',{status:'Voided'}),change(3,'one','removed')]),{total:998,shift:499});
 assert.deepEqual(submit([change(3,'one','removed'),change(5,'one','modified',{paymentVerified:true})]),{total:997,shift:498});
});
test('menu render visits each recipe once and preserves stock flags, layout, platform prices and hidden categories',()=>{
 const source=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
 const begin=source.indexOf('window.renderMenuItems = function() {'),body=source.slice(begin,source.indexOf('\n    };',begin)+7);
 const items=Array.from({length:100},(_,i)=>({name:'Item '+i,id:String(i),category:i===99?'Hidden':'Menu',price:80,grabPrice:95}));
 let examined=0;const bom=items.flatMap(item=>Array.from({length:4},()=>({get menuItem(){examined++;return item.name;},ingredientName:item.id,qty:2})));
 const grid={},w={masterPOSData:{items,bom,stockLevels:Object.fromEntries(items.map(it=>[it.id,it.id==='3'?0:50]))},globalItemLayout:['7','3'],posPlatform:'Grab',sessionUser:{branch:'Fictional'}};
 vm.runInNewContext(body,{window:w,document:{getElementById:id=>id==='menuGrid'?grid:null},hiddenCategories:['hidden']});w.renderMenuItems();
 assert.ok(examined<=bom.length*3,'one index build, independent of menu item count');assert.match(grid.innerHTML,/SOLD OUT/);assert.match(grid.innerHTML,/95\)/);assert.doesNotMatch(grid.innerHTML,/data-name="item 99"/);assert.ok(grid.innerHTML.indexOf('data-name="item 7"')<grid.innerHTML.indexOf('data-name="item 3"'));
});
