import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.addToDispatchCart = function () {'),end=source.indexOf('\nwindow.removeFromDispatchCart =',start);
test('adding the same item in kilograms and grams preserves the sum in base units and the editable quantity in both directions',()=>{
 for(const [selected,qty,oldRaw,oldBase,oldRate,expectedRaw,expectedRate]of [['base','500',1,1000,1000,1500,1],['purch','1',500,500,1,1.5,1000]]){
  const row={name:'Synthetic stock',itemName:'Synthetic stock',qty:oldBase,rawQty:oldRaw,convRate:oldRate},window={dispatchCart:[row],dispatchInventoryList:[{id:'stock',name:'Synthetic stock',currentStock:2000,uom:'gram',purchaseUom:'Kilogram',conversionRate:1000}],renderDispatchCart(){},ManagerUI:{notify(){assert.fail('Valid mixed-unit addition');}}},nodes={dispItem:{value:'Synthetic stock'},dispQty:{value:qty},dispUomSelect:{value:selected}},saved=new Map();
  vm.runInNewContext(source.slice(start,end),{window,document:{getElementById:id=>nodes[id]},localStorage:{setItem:(key,value)=>saved.set(key,value)}});window.addToDispatchCart();
  assert.equal(row.qty,1500);assert.equal(row.rawQty,expectedRaw);assert.equal(row.convRate,expectedRate);assert.equal(row.rawQty*row.convRate,row.qty);assert.equal(JSON.parse(saved.get('takodeal_dispatch_cart'))[0].qty,1500);
 }
});
