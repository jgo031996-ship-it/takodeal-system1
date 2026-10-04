import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {paymentMethods,paymentKind} from '../Takodeal-POS/cashier-payments.js';

test('Manager payment labels retain their exact names and duplicates are removed',()=>{
  assert.deepEqual(paymentMethods({payMethods:['Cash','GCash','Bank Transfer',"Owner's Bank",'GCash','cash','',null,'Split']}),['Cash','GCash','Bank Transfer',"Owner's Bank"]);
  assert.deepEqual(paymentMethods({paymentMethods:['GCash','GoTyme']}),['GCash','GoTyme']);
  assert.equal(paymentKind('G-Cash'),'gcash');assert.equal(paymentKind('Bank Transfer'),'bank');
});
test('empty or invalid cached payment lists render usable initial methods',()=>{
  for(const settings of [{},{payMethods:[]},{payMethods:'Cash'},{payMethods:[null,'']}]) assert.deepEqual(paymentMethods(settings),['Cash','GCash','Bank']);
});
test('payment rendering runs before menu hydration and cloud calls on a first boot',async()=>{
  const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
  const start=source.indexOf('window.loadPOSData = async function() {'),end=source.indexOf('// ☁️ 2. SILENT BACKGROUND SYNC',start);
  let calls=0;
  const context={window:{applySidebarLayout(){},getMenuFromLocalHardDrive:()=>[],renderOrderAndPaymentUI:()=>calls++},localStorage:{getItem:key=>key==='takodeal_cached_settings'?'invalid JSON':null}};
  vm.runInNewContext(source.slice(start,end)+'};',context);await context.window.loadPOSData();assert.equal(calls,1);
});
test('online configuration refresh preserves the current order type and platform lock',()=>{
  const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
  const start=source.indexOf('window.renderOrderAndPaymentUI = function() {'),end=source.indexOf('// --- UPGRADED CART & VARIANT LOGIC ---',start);
  const select={value:'Take-Out',options:[],replaceChildren(...options){this.options=options;this.value='';},removeEventListener(){},addEventListener(){}};
  let rendered;
  const context={window:{masterPOSData:{settings:{orderTypes:['Dine-In','Take-Out'],payMethods:['Cash','GCash']}}},document:{getElementById:()=>select},Option:function(text,value){return{text,value};},renderPayments:settings=>rendered=settings};
  vm.runInNewContext(source.slice(start,end),context);context.window.renderOrderAndPaymentUI();
  assert.equal(select.value,'Take-Out');assert.deepEqual(rendered.payMethods,['Cash','GCash']);
  context.window.posPlatform='Foodpanda';context.window.renderOrderAndPaymentUI();assert.equal(select.value,'Foodpanda');assert.ok(select.options.some(o=>o.value==='Foodpanda'));
});
