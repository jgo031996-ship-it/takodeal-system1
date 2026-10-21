import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {reportDetailsHTML,purchaseQuantity,escapeStock} from '../takodeal-manager/stock-cycle.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8');
function actual(name){const from=source.indexOf('window.'+name+' = function'),to=source.indexOf('\n};',from);assert.ok(from>=0&&to>from,name);return source.slice(from,to+3);}
function fixture(cart,tagName='TBODY'){
 const nodes={dispatchCartBody:{tagName,innerHTML:''},btnSetAsideDispatch:{disabled:true},dispatch_send_text_0:{innerText:''}},saved=new Map([['takodeal_dispatch_cart',JSON.stringify(cart)],['takodeal_active_po','sample-pending-request']]);let writes=0;
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{writes++;saved.set(key,value);},removeItem:key=>{writes++;saved.delete(key);}},w={dispatchCart:structuredClone(cart),dispatchInventoryList:[]},document={getElementById:id=>nodes[id]||null},context=vm.createContext({window:w,document,localStorage:storage,reportDetailsHTML,purchaseQuantity,escapeStock});
 for(const name of ['renderDispatchCart','updateDispatchQty','updateDispatchUom','removeFromDispatchCart'])vm.runInContext(actual(name),context);return {w,nodes,saved,get writes(){return writes;}};
}
const item={sourceId:'sample-item',name:'A very long sample ingredient with delivery notes & <markup> '+('LongName'.repeat(24)),itemName:'Sample',rawQty:2.5,qty:2500,uom:'Gram',baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,convRate:1000,selectedUom:'purch',hqStock:100,physicalStock:200,maintainingStock:4000,restockCycle:'Weekly'};
test('actual cart render retains long names, shortages and branch count details without mutating or saving the pending draft',()=>{
 const h=fixture([item]),before=structuredClone(h.w.dispatchCart);h.w.renderDispatchCart();const markup=h.nodes.dispatchCartBody.innerHTML;
 assert.deepEqual(h.w.dispatchCart,before);assert.equal(h.writes,0);assert.equal(h.saved.get('takodeal_active_po'),'sample-pending-request');assert.ok(markup.includes(escapeStock(item.name)));assert.doesNotMatch(markup,/<markup>/);assert.match(markup,/Low Main Office stock/);assert.match(markup,/Branch reported count:/);assert.match(markup,/Stock needed to reach target:/);assert.match(markup,/id="cartQty_0" value="2.5"/);assert.match(markup,/id="dispatch_send_text_0"/);assert.equal(h.nodes.btnSetAsideDispatch.disabled,false);assert.doesNotMatch(markup,/clearDispatchCart/);
});
test('quantity/unit/removal callbacks keep the existing input IDs, conversion and local persistence after the compact render',()=>{
 const h=fixture([item]);h.w.renderDispatchCart();assert.match(h.nodes.dispatchCartBody.innerHTML,/window.updateDispatchQty\(0, this.value\)/);assert.match(h.nodes.dispatchCartBody.innerHTML,/window.updateDispatchUom\(0, this.value\)/);assert.match(h.nodes.dispatchCartBody.innerHTML,/window.removeFromDispatchCart\(0\)/);h.w.updateDispatchQty(0,'3.25');assert.equal(h.w.dispatchCart[0].qty,3250);assert.equal(JSON.parse(h.saved.get('takodeal_dispatch_cart'))[0].rawQty,3.25);h.w.updateDispatchUom(0,'base');assert.equal(h.w.dispatchCart[0].qty,3.25);assert.match(h.nodes.dispatchCartBody.innerHTML,/value="base" selected/);h.w.removeFromDispatchCart(0);assert.equal(h.w.dispatchCart.length,0);assert.equal(h.saved.get('takodeal_dispatch_cart'),'[]');assert.equal(h.nodes.btnSetAsideDispatch.disabled,true);assert.match(h.nodes.dispatchCartBody.innerHTML,/Cart is empty/);assert.equal(h.saved.get('takodeal_active_po'),'sample-pending-request');
});
test('Set Aside / Clear Cart is outside the table immediately after Send, and remains connected to the existing confirmation handler',()=>{
 const table=html.slice(html.indexOf('<table id="dispatchCartTable"'),html.indexOf('</table>',html.indexOf('<table id="dispatchCartTable"'))),send=html.indexOf('id="btnSubmitDispatch"'),clear=html.indexOf('id="btnSetAsideDispatch"'),nextPanel=html.indexOf('<!-- LOGISTICS FEED',send);
 assert.ok(send>0&&clear>send&&clear<nextPanel);assert.doesNotMatch(table,/clearDispatchCart|Set Aside/);assert.match(html.slice(clear,clear+160),/onclick="window.clearDispatchCart\(\)"/);assert.equal((html.match(/id="btnSetAsideDispatch"/g)||[]).length,1);
});
test('the non-table cart host uses the same accessible controls and readable metadata without creating a second clear action',()=>{
 const h=fixture([item],'DIV');h.w.renderDispatchCart();const markup=h.nodes.dispatchCartBody.innerHTML;assert.match(markup,/class="dispatch-cart-item"/);assert.match(markup,/for="cartQty_0"/);assert.match(markup,/for="cartUom_0"/);assert.match(markup,/aria-label="Remove /);assert.doesNotMatch(markup,/<tr|<td|clearDispatchCart/);assert.equal(h.writes,0);
});
