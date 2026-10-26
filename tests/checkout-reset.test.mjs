import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {installSaleSafety} from '../Takodeal-POS/pos-checkout.js';
import {installCheckoutControls,resetCheckoutForNextOrder,syncPaymentButtons} from '../Takodeal-POS/checkout-controls.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
// Reuse the asynchronous storage fixture; the actual durable outbox queues these sales.
const fixture=readFileSync(new URL('./staff-meal-index.test.mjs',import.meta.url),'utf8');
const storageCode=fixture.slice(fixture.indexOf('function memoryIndexedDB()'),fixture.indexOf('function checkout(',fixture.indexOf('function memoryIndexedDB()')));
function memoryIndexedDB(){return vm.runInNewContext(storageCode+';memoryIndexedDB();',{Map,queueMicrotask,structuredClone});}
function button(method){const classes=new Set(['pay-btn',...(method==='Split'?['split-btn']:[])]),attrs={};return {textContent:method,dataset:method==='Split'?{}:{paymentMethod:method.toLowerCase()},style:{},classList:{contains:v=>classes.has(v),toggle(v,on){on?classes.add(v):classes.delete(v);},add:v=>classes.add(v),remove:v=>classes.delete(v)},setAttribute:(k,v)=>attrs[k]=v,getAttribute:k=>attrs[k],querySelector(){return this.innerHTML?.includes('data-split-label')?{}:null;}};}
function checkout(){
    const h=firestoreHarness(),nodes={},payments=['Gcash','Cash','Bank','Grab','Foodpanda','Split'].map(button),alerts=[],saved=new Map([['takodeal_device_branch','Maa']]);
    for(const id of ['btnSubmitFinal','checkoutModal','checkoutDiscountType','checkoutStaffPin','checkoutDiscountValue','checkoutDiscountReason','finalCustomerName','mainOrderType','posPlatformSelect','finalDeliveryAddress','finalContactNumber','rcptId','rcptDate','rcptTime','rcptTotal','rcptPaid','rcptChange','receiptModal','splitPaymentContainer','splitAmount1','splitAmount2','splitMethod1','splitMethod2'])nodes[id]={value:'',innerText:'',style:{}};
    nodes.checkoutTotalPayable={innerText:''};nodes.checkoutModal.style.display='none';nodes.splitPaymentContainer.style.display='none';nodes.posPlatformSelect.value='Standard';nodes.mainOrderType.value='Dine-In';nodes.checkoutDiscountType.value='none';
    for(const id of ['splitMethod1','splitMethod2']){nodes[id].options=[{value:'Cash'},{value:'Gcash'}];nodes[id].value='Cash';}
    const d={getElementById:id=>nodes[id]||null,querySelectorAll:selector=>selector.includes('pay-btn')?payments:[],querySelector:()=>({style:{}}),addEventListener(){}};
    const ls={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v))};
    const w={...h.api,cart:[{name:'Sample food',qty:1,lineTotalFinal:70}],sessionUser:{branch:'Maa',cashierName:'Sample cashier'},currentShift:{shiftId:'sample-shift'},currentGrandTotal:70,finalCheckoutAmount:70,finalCheckoutDiscount:0,amountReceivedStr:'0',selectedPaymentMethod:'Cash',masterPOSData:{bom:[],settings:{}},addEventListener(){},isMealDiscount:()=>false,checkoutPinKeypadActive:()=>false,collectCustomCheckoutSelections:()=>[],syncMealDiscountOptions(){},renderCustomCheckoutFields(){},renderCart(){},updateReceiptSyncStatus(){},closeModal:id=>nodes[id].style.display='none',Swal:{fire:(...args)=>{alerts.push(args);return Promise.resolve({});}},updateNumpadDisplay(){},handleDiscountTypeChange(){w.selectedPaymentMethod=['Grab','Foodpanda'].includes(w.posPlatform)?w.posPlatform:'Cash';},setExactAmount(){w.amountReceivedStr=String(w.currentGrandTotal);}};
    const context={window:w,document:d,Swal:w.Swal,console,Date,alert:text=>alerts.push(text)};
    w.collectCustomCheckoutFields=()=>[];
    let begin=html.indexOf('window.setPaymentMethod = function('),end=html.indexOf('// ========================================================',begin);vm.runInNewContext(html.slice(begin,end),context);
    begin=html.indexOf('window.openCheckoutModal = function(');end=html.indexOf('function openCheckoutModal()',begin);vm.runInNewContext(html.slice(begin,end),context);
    begin=html.indexOf('window.submitFinalOrder = async function()');end=html.indexOf('window.updateReceiptSyncStatus = function',begin);vm.runInNewContext(html.slice(begin,end),context);
    const environment={window:w,localStorage:ls,indexedDB:memoryIndexedDB(),crypto:webcrypto,navigator:{onLine:false},document:d,setTimeout(){},setInterval(){}};
    installSaleSafety(h.api,environment);
    return {w,d,nodes,payments,alerts,environment,cash:payments[1],gcash:payments[0],split:payments[5]};
}
test('two consecutive GCash orders save Gcash both times and each completed order returns to Select Type and Cash',async()=>{
    const f=checkout(); // Store POS is deliberately uninitialized, as on the affected tablet.
    for(let i=0;i<2;i++){
        f.nodes.mainOrderType.value='Take-Out';f.w.cart=[{name:'Sample food',qty:1,lineTotalFinal:70}];
        f.w.openCheckoutModal();assert.equal(f.w.selectedPaymentMethod,'Cash');assert.equal(f.cash.getAttribute('aria-pressed'),'true');
        f.w.setPaymentMethod(f.gcash,'Gcash');f.nodes.finalCustomerName.value='SAMPLE-REF-'+i;
        assert.equal(f.gcash.getAttribute('aria-pressed'),'true');await f.w.submitFinalOrder();
        assert.equal(f.w.lastTransactionData.paymentMethod,'Gcash');assert.equal(f.w.lastTransactionData.orderType,'Take-Out');
        assert.equal(f.w.selectedPaymentMethod,'Cash');assert.equal(f.cash.getAttribute('aria-pressed'),'true');assert.equal(f.gcash.getAttribute('aria-pressed'),'false');assert.equal(f.nodes.mainOrderType.value,'');
    }
    const rows=await f.w.saleOutbox.list();assert.equal(rows.length,2);assert.ok(rows.every(row=>row.payload.paymentMethod==='Gcash'));
});
test('the next order cannot open payment until the cashier chooses its order type',async()=>{
    const f=checkout();f.w.amountReceivedStr='70';await f.w.submitFinalOrder();f.w.cart=[{name:'Next order',qty:1,lineTotalFinal:70}];f.w.openCheckoutModal();
    assert.equal(f.nodes.checkoutModal.style.display,'none');assert.ok(f.alerts.some(args=>Array.isArray(args)&&args[0]==='Order Type Required'));
});
test('an unsuccessful local save keeps the selected GCash method, order type and draft intact',async()=>{
    const f=checkout();f.nodes.mainOrderType.value='Dine-In';f.w.openCheckoutModal();f.w.setPaymentMethod(f.gcash,'Gcash');f.nodes.finalCustomerName.value='SAMPLE-REF';f.environment.indexedDB=null;
    // A serialization error occurs before the actual durable enqueue.
    f.w.cart[0].circular=f.w.cart[0];await f.w.submitFinalOrder();
    assert.equal(f.w.selectedPaymentMethod,'Gcash');assert.equal(f.gcash.getAttribute('aria-pressed'),'true');assert.equal(f.nodes.mainOrderType.value,'Dine-In');assert.equal(f.w.cart.length,1);assert.equal((await f.w.saleOutbox.list()).length,0);
});
test('Split payment has a readable label, saves its amounts, and resets them before the next order',async()=>{
    const f=checkout();syncPaymentButtons(f.w,f.d);assert.match(f.split.innerHTML,/>Split payment<\/span>/);
    f.nodes.splitPaymentContainer.style.display='block';f.nodes.splitMethod1.value='Cash';f.nodes.splitMethod2.value='Gcash';f.nodes.splitAmount1.value='20';f.nodes.splitAmount2.value='50';f.w.selectedPaymentMethod='Split';f.w.amountReceivedStr='70';
    await f.w.submitFinalOrder();assert.equal(f.w.lastTransactionData.paymentMethod,'Split (Cash & Gcash)');assert.deepEqual(f.w.lastTransactionData.splitDetails,[{method:'Cash',amount:20},{method:'Gcash',amount:50}]);
    assert.equal(f.nodes.splitAmount1.value,'');assert.equal(f.nodes.splitAmount2.value,'');assert.equal(f.nodes.splitPaymentContainer.style.display,'none');assert.equal(f.cash.getAttribute('aria-pressed'),'true');
});
test('dedicated Grab and Foodpanda registers keep their locked order type and payment method after a sale',()=>{
    for(const platform of ['Grab','Foodpanda']){const f=checkout();f.w.posPlatform=platform;f.nodes.mainOrderType.value=platform;resetCheckoutForNextOrder(f.w,f.d);assert.equal(f.nodes.mainOrderType.value,platform);assert.equal(f.w.selectedPaymentMethod,platform);assert.equal(f.w.amountReceivedStr,'70');}
});
test('a programmatic discount reset refreshes the highlighted payment choice as well',()=>{
    const f=checkout();f.w.setPaymentMethod(f.gcash,'Gcash');f.w.handleDiscountTypeChange();assert.equal(f.w.selectedPaymentMethod,'Cash');assert.equal(f.cash.getAttribute('aria-pressed'),'true');assert.equal(f.gcash.getAttribute('aria-pressed'),'false');
    installCheckoutControls(f.w,f.d);assert.equal(f.split.querySelector('[data-split-label]')!==null,true);
});
test('payment choice cannot change while the current sale is being saved',()=>{
    const f=checkout();f.w.isSubmittingOrder=true;f.w.setPaymentMethod(f.gcash,'Gcash');assert.equal(f.w.selectedPaymentMethod,'Cash');assert.equal(f.cash.getAttribute('aria-pressed'),'true');
    f.w.isSubmittingOrder=false;f.w.setPaymentMethod(f.gcash,'Gcash');assert.equal(f.w.selectedPaymentMethod,'Gcash');assert.equal(f.gcash.getAttribute('aria-pressed'),'true');
});
test('cash counting pauses the real checkout pipeline before any receipt is queued and resumes after the count is released',async()=>{
    for(const flag of ['cashierRemitSubmitting','cashierCashCountActive']){
        const f=checkout(),payload={branch:'Maa',cart:[{name:'Sample food',qty:1,lineTotalFinal:70}],netTotal:70,paymentMethod:'Cash'},cart=JSON.stringify(f.w.cart);
        f.w[flag]=true;const stopped=await f.w.processCheckout(payload);assert.equal(stopped.status,'failed');assert.match(stopped.error,/cash remittance count/);assert.equal((await f.w.saleOutbox.list()).length,0);assert.equal(JSON.stringify(f.w.cart),cart);
        f.w[flag]=false;const resumed=await f.w.processCheckout(payload);assert.equal(resumed.status,'queued');assert.equal((await f.w.saleOutbox.list()).length,1);
    }
});
test('a durable unconfirmed transfer blocks checkout after restart even without an in-memory counting flag',async()=>{const f=checkout();f.w.hasPendingCashRemittance=()=>true;const result=await f.w.processCheckout({branch:'Maa',cart:[{name:'Sample food',qty:1}],netTotal:70,paymentMethod:'Cash'});assert.equal(result.status,'failed');assert.match(result.error,/earlier cash transfer/);assert.equal((await f.w.saleOutbox.list()).length,0);assert.equal(f.w.isProcessingOrder,false);});
