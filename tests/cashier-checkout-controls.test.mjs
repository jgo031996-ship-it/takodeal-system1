import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {updateBlocker} from '../Takodeal-POS/cashier-data.js';
const html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
function checkout(){
 const elements={};
 for(const id of ['checkoutDiscountType','checkoutDiscountValue','checkoutDiscountReason','checkoutStaffPinContainer','checkoutStaffPin','standardPaymentArea','finalCustomerName','checkoutKeypadTitle','checkoutDecimalKey','checkoutExactKey','checkoutPaymentTitle','splitPaymentContainer'])elements[id]={value:'',style:{},focus(){},disabled:false};
 elements.checkoutDiscountType.value='none';
 const numpad={style:{}},payments={style:{}},buttons=[{classList:{remove(){},add(){}}}];let displays=0;
 const context={document:{getElementById:id=>elements[id],querySelector:s=>s.includes('numpad')?numpad:payments,querySelectorAll:()=>buttons},window:{posPlatform:'Store POS',amountReceivedStr:'100',currentGrandTotal:180,updateNumpadDisplay:()=>displays++,query:(...args)=>args,collection:(db,name)=>name,where:(...args)=>args,getDocs:async()=>({empty:true})},Swal:{fire(){}},console,Date};
 const start=html.indexOf('window.checkoutPinKeypadActive = function()'),end=html.indexOf('window.updateNumpadDisplay = function()',start);
 vm.runInNewContext(html.slice(start,end),context);
 return {context,elements,numpad,payments,displays:()=>displays};
}
test('meal keypad stays visible, enters only PIN digits and retains salary deduction',()=>{
 const {context,elements,numpad,payments}=checkout();let verifications=0;context.window.verifyStaffMealPin=()=>verifications++;
 elements.checkoutDiscountType.value='staff_meal';context.window.handleDiscountTypeChange();
 assert.equal(elements.standardPaymentArea.style.display,'block');assert.equal(numpad.style.display,'grid');assert.equal(payments.style.display,'none');assert.equal(elements.checkoutExactKey.disabled,true);
 for(const digit of ['0','1','2','3','.'])context.window.appendNumpad(digit);
 assert.equal(elements.checkoutStaffPin.value,'0123');assert.equal(context.window.amountReceivedStr,'100');assert.equal(verifications,4);
 context.window.setExactAmount();context.window.setPaymentMethod({},'Cash');assert.equal(context.window.selectedPaymentMethod,'Salary Deduction');
 context.window.clearNumpadOne();assert.equal(elements.checkoutStaffPin.value,'012');context.window.clearNumpadAll();assert.equal(elements.checkoutStaffPin.value,'');
});
test('ordinary cash controls recover after meal PIN mode without retaining the PIN',()=>{
 const {context,elements,payments}=checkout();elements.checkoutDiscountType.value='manager_meal';context.window.handleDiscountTypeChange();elements.checkoutStaffPin.value='0123';
 elements.checkoutDiscountType.value='none';context.window.handleDiscountTypeChange();assert.equal(elements.checkoutStaffPin.value,'');assert.equal(payments.style.display,'grid');assert.equal(elements.checkoutDecimalKey.disabled,false);
 context.window.clearNumpadAll();context.window.appendNumpad('5');context.window.appendNumpad('.');context.window.appendNumpad('5');assert.equal(context.window.amountReceivedStr,'5.5');context.window.setExactAmount();assert.equal(context.window.amountReceivedStr,'180');
});
test('delivery payment lock survives switching out of the meal keypad',()=>{
 const {context,elements,payments}=checkout();context.window.posPlatform='Foodpanda';elements.checkoutDiscountType.value='staff_meal';context.window.handleDiscountTypeChange();assert.equal(elements.standardPaymentArea.style.display,'block');
 elements.checkoutDiscountType.value='none';context.window.handleDiscountTypeChange();assert.equal(elements.standardPaymentArea.style.display,'none');assert.equal(payments.style.display,'none');assert.equal(context.window.selectedPaymentMethod,'Foodpanda');
});
test('a late identity lookup cannot accept a cleared or changed PIN',async()=>{
 const {context,elements}=checkout();let complete;context.window.getDocs=()=>new Promise(resolve=>complete=resolve);
 elements.checkoutDiscountType.value='manager_meal';elements.checkoutStaffPin.value='1234';const lookup=context.window.verifyStaffMealPin();
 context.window.clearNumpadAll();complete({empty:false,docs:[{data:()=>({cashierName:'Wrong identity'})}]});await lookup;assert.equal(elements.finalCustomerName.value,'');
});
test('payment icons retain readable method labels and escape markup',()=>{
 const context={window:{}};const start=html.indexOf('window.paymentButtonContent = function('),end=html.indexOf('window.sessionUser =',start);vm.runInNewContext(html.slice(start,end),context);
 for(const method of ['Cash','Gcash','Bank']){const markup=context.window.paymentButtonContent(method);assert.match(markup,/aria-hidden="true"/);assert.match(markup,/<svg/);assert.equal(markup.replace(/<[^>]+>/g,''),method==='Gcash'?'GCash':method);}
 assert.ok(!context.window.paymentButtonContent('<img src=x>').includes('<img'));
});
test('owner branch options include Main Office and branch names from the server',()=>{
 const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');const start=source.indexOf('let branchOptions = {};',source.indexOf('// 3. SUCCESS! Fetch active branches'));const end=source.indexOf('// 4. Show the Teleporter Dropdown',start);
 const context={bSnap:{forEach:fn=>['Main Office','Maa','Cabantian'].forEach(name=>fn({data:()=>({name})}))}};
 vm.runInNewContext(source.slice(start,end)+'globalThis.options=branchOptions;',context);assert.deepEqual(Object.keys(context.options),['Main Office','Maa','Cabantian']);
});
function updates(registration){
 const source=readFileSync(new URL('../Takodeal-POS/cashier-workspace.js',import.meta.url),'utf8'),elements={};
 for(const id of ['updateAppBanner','cashierUpdateTitle','cashierUpdateText','cashierUpdateSymbol','cashierUpdateNow','cashierUpdateDismiss','cashierUpdateClose'])elements[id]={style:{},dataset:{},setAttribute(){},removeAttribute(){}};
 const context={el:id=>elements[id],window:{addEventListener(){},setInterval(){}},document:{body:{append(){}}},navigator:{onLine:true,serviceWorker:{getRegistration:async()=>registration,addEventListener(){},controller:{}}},updateBlocker,localStorage:{getItem:()=> 'test-release',setItem(){}},CASHIER_RELEASE:'test-release',console};
 vm.runInNewContext('let releaseRegistration, activateRequested = false;'+source.slice(source.indexOf('function showCashierUpdateNotice('),source.indexOf('function install(){')),context);vm.runInNewContext('installUpdates();',context);
 return {context,elements};
}
test('successful update check displays an up-to-date title and enabled check button',async()=>{
 const {context,elements}=updates({update:async()=>{},addEventListener(){}});await context.window.checkCashierUpdate();assert.equal(elements.updateAppBanner.dataset.updateState,'current');assert.match(elements.cashierUpdateTitle.textContent,/up to date/);assert.equal(elements.cashierUpdateNow.disabled,false);
});
test('work started during update checking prevents activation of the waiting release',async()=>{
 let activated=0,context;const app=updates({update:async()=>{context.window.isBluetoothPrinting=true;},waiting:{postMessage:()=>activated++},addEventListener(){}});context=app.context;
 await context.window.checkCashierUpdate();assert.equal(activated,0);assert.equal(app.elements.updateAppBanner.dataset.updateState,'blocked');assert.equal(app.elements.cashierUpdateNow.disabled,false);
});
