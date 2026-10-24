import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {collectDeductions} from '../Takodeal-POS/pos-safety.js';

const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const menuName='Sample Takoyaki 6 Pcs';
const sauce={name:'Sample sauce',price:0,linkedIngredient:'Sauce',deductQty:5};
const cheese={name:'Extra cheese',price:15,linkedIngredient:'Cheese',deductQty:2};
const pearls={name:'Extra pearls',price:10,linkedIngredient:'Pearls',deductQty:3};
const bom=[{menuItem:menuName,ingredientName:'Batter',qty:50}];

function modal({qty=1,discount='none',discountValue=0,existing=null,baseRequired=true}={}){
 const nodes=new Map(),dialogs=[],closed=[],savedReceipt={id:'saved-receipt',cart:[{name:menuName,qty:3,lineTotalFinal:240,addons:{[sauce.name]:{...sauce,qty:3}}}]};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerText:'',innerHTML:'',style:{},disabled:false,parentElement:{style:{},parentElement:{style:{}}}});return nodes.get(id);};
 node('modalMainQty').innerText=String(qty);node('discountValueInput').value=String(discountValue);node('orderNotesInput').value='Sample note';node('baseFlavorSelect').value=sauce.name;node('modalItemOrderType').value='Take-Out';
 const api={cart:existing?[existing]:[],editIndex:existing?0:-1,pendingItem:existing?plain(existing):{name:menuName,realName:menuName,basePrice:80,variantPrice:80,qty,notes:'',addons:{},discountType:discount,discountVal:discountValue},
  posPlatform:'Store POS',currentBaseFlavorsInfo:baseRequired?[sauce]:[],currentExtraAddonsInfo:[cheese,pearls],extraAddonState:{[cheese.name]:2,[pearls.name]:1},mixMatchState:{},masterPOSData:{addons:[],phantomVariants:{}},
  renderCart(){api.renders=(api.renders||0)+1;},closeModal:id=>closed.push(id),query:(...args)=>args,collection:(_db,table)=>table,where:(...args)=>args,
  getDocs:async()=>({empty:false,docs:[{data:()=>({name:menuName,category:'Takoyaki',addons:[plain(sauce),plain(cheese),plain(pearls)]})}]})};
 const context=vm.createContext({window:api,document:{getElementById:node,querySelector:()=>null},Swal:{fire:options=>dialogs.push(options)},console,setTimeout:()=>{}});
 for(const name of ['openAddOrderModal','updateModalTotals','confirmAddOrUpdateToCart']){
  const start=source.indexOf('window.'+name+' = '+(name==='openAddOrderModal'?'async ':'')+'function'),end=source.indexOf('\n};',start)+3;assert.ok(start>=0&&end>start,name+' must select an actual final module handler');
  vm.runInContext(source.slice(start,end),context);
 }
 return {api,node,nodes,dialogs,closed,savedReceipt};
}
function deductions(line){return Object.fromEntries(collectDeductions({cart:[line]},bom).map(row=>[row.ingredientName,row.quantity]));}

for(const qty of [1,2,3])test('actual preview, confirmed total and ingredient quantities agree for '+qty+' parent item(s)',()=>{
 const h=modal({qty}),receiptBefore=plain(h.savedReceipt);h.api.updateModalTotals();assert.equal(h.node('modalLiveTotal').innerText,'₱ '+(120*qty).toFixed(2));h.api.confirmAddOrUpdateToCart();
 assert.equal(h.api.cart.length,1);const line=h.api.cart[0];assert.equal(line.qty,qty);assert.equal(line.lineTotalFinal,120*qty);assert.equal(line.addons[sauce.name].qty,1);assert.equal(line.addons[cheese.name].qty,2);assert.equal(line.addons[pearls.name].qty,1);
 assert.deepEqual(deductions(line),{Batter:50*qty,Sauce:5*qty,Cheese:4*qty,Pearls:3*qty});assert.equal(line.orderType,'Take-Out');assert.equal(line.notes,'Sample note');assert.deepEqual(h.closed,['variantModal']);assert.equal(h.api.renders,1);assert.deepEqual(h.savedReceipt,receiptBefore);
});

for(const [discount,value,total]of [['percentage',10,216],['fixed',25,215],['fixed',999,0]])test('actual '+discount+' discount '+value+' is applied to the full parent and add-on total once',()=>{
 const h=modal({qty:2,discount,discountValue:value});h.api.updateModalTotals();assert.equal(h.node('modalLiveTotal').innerText,'₱ '+total.toFixed(2));h.api.confirmAddOrUpdateToCart();assert.equal(h.api.cart[0].lineTotalFinal,total);assert.deepEqual(deductions(h.api.cart[0]),{Batter:100,Sauce:10,Cheese:8,Pearls:6});
});

test('actual mixed filling and extra selection uses per-parent quantities with one stock multiplier',()=>{
 const h=modal({qty:3});h.api.masterPOSData.addons=[{name:'Octopus',linkedIngredient:'Octopus',deductQty:2},{name:'Pork',linkedIngredient:'Pork',deductQty:4}];h.api.mixMatchState={Octopus:2,Pork:4};h.api.updateModalTotals();h.api.confirmAddOrUpdateToCart();const line=h.api.cart[0];
 assert.equal(line.lineTotalFinal,360);assert.equal(line.addons['Octopus Filling'].qty,2);assert.equal(line.addons['Pork Filling'].qty,4);assert.deepEqual(deductions(line),{Batter:150,Sauce:15,Octopus:12,Pork:48,Cheese:12,Pearls:9});assert.match(line.notes,/MIX: 2 Octopus, 4 Pork/);
});

test('actual required base-flavor validation still blocks an incomplete selection without changing the cart',()=>{
 const h=modal({qty:2});h.node('baseFlavorSelect').value='';const before=plain(h.api.cart);h.api.confirmAddOrUpdateToCart();assert.deepEqual(h.api.cart,before);assert.equal(h.api.renders,undefined);assert.equal(h.closed.length,0);assert.equal(h.dialogs[0].title,'Flavor Required');
});

test('actual optional extras work when the product has no free base-flavor selector',()=>{
 const h=modal({qty:2,baseRequired:false});h.api.updateModalTotals();h.api.confirmAddOrUpdateToCart();const line=h.api.cart[0];assert.equal(line.lineTotalFinal,240);assert.equal(line.addons[sauce.name],undefined);assert.deepEqual(deductions(line),{Batter:100,Cheese:8,Pearls:6});
});

test('opening an existing cart row preserves the original until confirmation and restores per-item extra counts',async()=>{
 const existing={name:menuName,realName:menuName,basePrice:80,variantPrice:80,qty:2,lineTotalFinal:240,notes:'Keep note',orderType:'Take-Out',discountType:'none',discountVal:0,addons:{[sauce.name]:{...sauce,qty:1},[cheese.name]:{...cheese,qty:2},[pearls.name]:{...pearls,qty:1}}};
 const h=modal({existing}),before=plain(existing);await h.api.openAddOrderModal(menuName,80,existing);assert.deepEqual(existing,before);assert.equal(h.api.editIndex,0);assert.equal(h.node('modalMainQty').innerText,2);assert.deepEqual(plain(h.api.extraAddonState),{[cheese.name]:2,[pearls.name]:1});assert.equal(h.node('modalLiveTotal').innerText,'₱ 240.00');
 h.node('modalMainQty').innerText='3';h.api.updateModalTotals();assert.equal(h.node('modalLiveTotal').innerText,'₱ 360.00');h.api.confirmAddOrUpdateToCart();assert.equal(h.api.cart.length,1);assert.equal(h.api.cart[0].lineTotalFinal,360);assert.equal(h.api.cart[0].addons[sauce.name].qty,1);assert.deepEqual(existing,before);assert.deepEqual(deductions(h.api.cart[0]),{Batter:150,Sauce:15,Cheese:12,Pearls:9});
});

test('editing an unsubmitted legacy cart normalizes only its new confirmed base-flavor count',async()=>{
 const existing={name:menuName,realName:menuName,basePrice:80,variantPrice:80,qty:3,lineTotalFinal:240,notes:'Legacy unsent cart',orderType:'Take-Out',discountType:'none',discountVal:0,addons:{[sauce.name]:{...sauce,qty:3}}};
 const h=modal({existing}),before=plain(existing),receiptBefore=plain(h.savedReceipt);await h.api.openAddOrderModal(menuName,80,existing);assert.deepEqual(existing,before);h.api.confirmAddOrUpdateToCart();const line=h.api.cart[0];assert.equal(line.addons[sauce.name].qty,1);assert.equal(line.lineTotalFinal,240);assert.deepEqual(deductions(line),{Batter:150,Sauce:15});assert.deepEqual(existing,before);assert.deepEqual(h.savedReceipt,receiptBefore);
});

test('platform order-type lock and parent channel price remain authoritative in the actual confirm handler',()=>{
 const h=modal({qty:2});h.api.posPlatform='Foodpanda';h.api.pendingItem.variantPrice=110;h.node('modalItemOrderType').value='Dine-In';h.api.updateModalTotals();h.api.confirmAddOrUpdateToCart();assert.equal(h.api.cart[0].lineTotalFinal,300);assert.equal(h.api.cart[0].variantPrice,110);assert.equal(h.api.cart[0].orderType,'Take-Out');
});
