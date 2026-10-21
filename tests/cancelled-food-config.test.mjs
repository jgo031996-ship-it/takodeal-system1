
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cancelledFoodPolicy,configurationPatch,mealLevels} from '../takodeal-manager/pos-config-model.js';
import {initPosConfigWorkspace} from '../takodeal-manager/pos-config-workspace.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {installCancelledOrders} from '../Takodeal-POS/cancelled-orders-ui.js';
import {saleFingerprint} from '../Takodeal-POS/pos-safety.js';

test('missing cancelled-food settings default to enabled with a 20 percent discount without mutating input',()=>{
    const settings=Object.freeze({staffMealTakoPct:35});
    assert.deepEqual(cancelledFoodPolicy(settings),{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:20});
    assert.deepEqual(settings,{staffMealTakoPct:35});
    assert.deepEqual(cancelledFoodPolicy(),cancelledFoodPolicy({}));
});
test('explicit disabled and zero/full/decimal discounts survive normalization',()=>{
    for(const value of [0,100,12.5,'0','100',' 12.50 ']){
        assert.deepEqual(cancelledFoodPolicy({cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:value}),
            {cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:Number(value)});
    }
});
test('invalid stored enabled flags cannot silently enable purchases',()=>{
    for(const value of [null,0,1,'true','false',[],{}])assert.throws(()=>cancelledFoodPolicy({cancelledFoodPurchaseEnabled:value}),/whether/);
    for(const value of [null,[],false,'bad'])assert.throws(()=>cancelledFoodPolicy(value),/valid/);
});
test('discount validation rejects blank, nonfinite, negative, oversized and coercible nonnumbers',()=>{
    for(const value of ['', ' ',null,true,false,[],{},NaN,Infinity,-1,100.01,'n/a']){
        assert.throws(()=>cancelledFoodPolicy({cancelledFoodDiscountPct:value}),/between/);
    }
});
test('legacy two-argument patches retain their exact old schema',()=>{
    const levels=mealLevels({staffMealTakoPct:35,staffMealOtherPct:7});
    assert.deepEqual(configurationPatch(levels,[]),{mealDiscountLevels:levels,customCheckoutFields:[],
        staffMealTakoPct:35,staffMealOtherPct:7,managerMealTakoPct:100,managerMealOtherPct:100});
    assert.deepEqual(configurationPatch([],[]),{mealDiscountLevels:[],customCheckoutFields:[]});
});
test('explicit policy patch adds only its two keys and keeps daily meal rates independent',()=>{
    const policy={cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:'50',untrustedField:'discard'};
    const levels=mealLevels(),patch=configurationPatch(levels,[],policy);
    assert.equal(patch.cancelledFoodPurchaseEnabled,false);assert.equal(patch.cancelledFoodDiscountPct,50);
    assert.equal(patch.staffMealTakoPct,20);assert.equal(patch.staffMealOtherPct,10);
    assert.equal(patch.untrustedField,undefined);policy.cancelledFoodDiscountPct='0';assert.equal(patch.cancelledFoodDiscountPct,50);
    assert.deepEqual(configurationPatch([],[],{}),{mealDiscountLevels:[],customCheckoutFields:[],cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:20});
});
test('Cashier and Manager use the same cancelled-food validation model',()=>{
    assert.equal(readFileSync(new URL('../Takodeal-POS/pos-config-model.js',import.meta.url),'utf8'),
        readFileSync(new URL('../takodeal-manager/pos-config-model.js',import.meta.url),'utf8'));
});

// Rendered controls are supplied to the real installer. Persistence uses the
// existing in-memory Firestore transaction harness; no Firebase SDK is loaded.
const decode=value=>String(value??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function attributes(raw){return Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],decode(match[2]??'')]));}
function control(tag,attrs){return {tag,attrs,dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),
    value:attrs.value??'',checked:Object.hasOwn(attrs,'checked'),disabled:false,textContent:''};}
class Controls {
    constructor(html='',attrs={}){this.dataset=control('',attrs).dataset;this.innerHTML=html;}
    set innerHTML(html){
        this.html=html;this.nodes=[...html.matchAll(/<(input|button|textarea|select|p)\b([^>]*)>/g)].map(match=>control(match[1],attributes(match[2])));
        this.rows=[...html.matchAll(/<tr\b([^>]*\bdata-level="[^"]*"[^>]*)>([\s\S]*?)<\/tr>/g)].map(match=>new Controls(match[2],attributes(match[1])));
    }
    get innerHTML(){return this.html;}
    querySelectorAll(selector){
        if(selector==='[data-level]')return this.rows;
        if(selector==='[data-field]')return [];
        const selectors=selector.split(',');
        return this.nodes.filter(node=>selectors.some(part=>{
            const attr=part.match(/^\[([\w-]+)(?:="([^"]*)")?\](:checked)?$/);
            return attr?Object.hasOwn(node.attrs,attr[1])&&(attr[2]===undefined||node.attrs[attr[1]]===attr[2])&&(!attr[3]||node.checked):node.tag===part;
        }));
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
function workspace(settings={},separate=false){
    const h=firestoreHarness(),host=new Controls(),w={...h.api,auth:{currentUser:{uid:'synthetic-hq'}},sessionUser:{permissions:['posconfig'],cashierName:'Synthetic HQ'}};
    h.put('settings/global_pos_config',structuredClone(settings));let transactions=0;
    const run=w.runTransaction;w.runTransaction=(...args)=>{transactions++;return run(...args);};
    w.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    const purchaseHost=separate?new Controls():host;
    const installed=initPosConfigWorkspace({window:w,document:{getElementById:id=>id==='section-master'?host:id==='section-purchasedCancelledOrders'&&separate?purchaseHost:null}});
    return {h,w,host,purchaseHost,load:installed.load,save:()=>host.querySelector('[data-save-config]').onclick(),savePurchase:()=>purchaseHost.querySelector('[data-save-config]').onclick(),get transactions(){return transactions;},
        enabled:()=>purchaseHost.querySelector('[data-cancelled-food-enabled]'),discount:()=>purchaseHost.querySelector('[data-cancelled-food-discount]'),status:()=>purchaseHost.querySelector('[data-pc-status]')};
}

test('dedicated cancelled-order Save ignores an unfinished Master draft and preserves ordinary meal settings',async()=>{
    const f=workspace({staffMealTakoPct:30,cancelledFoodDiscountPct:20},true);await f.load();
    f.host.querySelectorAll('[data-level]')[0].querySelector('[data-name]').value='';f.discount().value='35';await f.savePurchase();
    const saved=f.h.get('settings/global_pos_config');assert.equal(saved.cancelledFoodDiscountPct,35);assert.equal(saved.staffMealTakoPct,30);assert.equal(saved.mealDiscountLevels,undefined);assert.equal(f.host.querySelectorAll('[data-level]')[0].querySelector('[data-name]').value,'');
    assert.match(f.host.className,/pos-config-section/);assert.match(f.purchaseHost.className,/pos-config-section/);
});
test('Master Save leaves an unsaved invalid cancelled-order percentage intact without changing that policy',async()=>{
    const f=workspace({staffMealTakoPct:30,cancelledFoodDiscountPct:20},true);await f.load();f.discount().value='101';await f.save();
    assert.equal(f.h.get('settings/global_pos_config').cancelledFoodDiscountPct,20);assert.equal(f.h.get('settings/global_pos_config').configEditorRevision,1);assert.equal(f.discount().value,'101');
});
test('a failed reload clears stale purchase controls and exposes a retry in both sections',async()=>{
    const f=workspace({},true);await f.load();f.w.getDocFromServer=()=>Promise.reject(Error('Synthetic network failure'));await f.load();
    assert.equal(f.enabled(),null);assert.ok(f.purchaseHost.querySelector('[data-retry]'));assert.ok(f.host.querySelector('[data-retry]'));assert.equal(f.transactions,0);
});
test('opening the real config editor shows defaults and makes no persistence call until Save',async()=>{
    const f=workspace({unrelatedSavedValue:'keep'});await f.load();
    assert.equal(f.enabled().checked,true);assert.equal(f.discount().value,'20');assert.equal(f.transactions,0);
    assert.deepEqual(f.h.get('settings/global_pos_config'),{unrelatedSavedValue:'keep'});
    await f.save();const saved=f.h.get('settings/global_pos_config');
    assert.equal(saved.cancelledFoodPurchaseEnabled,true);assert.equal(saved.cancelledFoodDiscountPct,20);
    assert.equal(saved.configEditorRevision,1);assert.equal(saved.unrelatedSavedValue,'keep');
});
test('the real editor loads disabled settings and saves a zero discount without changing daily meals',async()=>{
    const f=workspace({configEditorRevision:4,cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:37.5,staffMealTakoPct:35,staffMealOtherPct:7});
    await f.load();assert.equal(f.enabled().checked,false);assert.equal(f.discount().value,'37.5');f.discount().value='0';await f.save();
    const saved=f.h.get('settings/global_pos_config');assert.equal(saved.cancelledFoodPurchaseEnabled,false);assert.equal(saved.cancelledFoodDiscountPct,0);
    assert.equal(saved.staffMealTakoPct,35);assert.equal(saved.staffMealOtherPct,7);assert.equal(saved.configEditorRevision,5);
});
test('adding a meal level keeps unsaved cancelled-food controls intact through the actual rerender',async()=>{
    const f=workspace();await f.load();f.enabled().checked=false;f.discount().value='45.5';
    f.host.querySelector('[data-add-level]').onclick();assert.equal(f.enabled().checked,false);assert.equal(f.discount().value,'45.5');
    assert.equal(f.host.querySelectorAll('[data-level]').length,3);assert.equal(f.transactions,0);
});
test('an invalid discount retains the draft and never starts a settings transaction',async()=>{
    const f=workspace();await f.load();f.discount().value='101';await f.save();
    assert.equal(f.transactions,0);assert.equal(f.discount().value,'101');assert.match(f.status().textContent,/between/);
    assert.deepEqual(f.h.get('settings/global_pos_config'),{});
});
test('a stale config revision cannot overwrite a newer policy and keeps the typed draft',async()=>{
    const f=workspace({configEditorRevision:2});await f.load();f.discount().value='60';
    const newer={configEditorRevision:3,cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:5};f.h.put('settings/global_pos_config',newer);
    await f.save();assert.deepEqual(f.h.get('settings/global_pos_config'),newer);assert.equal(f.discount().value,'60');assert.match(f.status().textContent,/Another manager/);
});
test('a revoked editor session cannot save a policy even when its handler is invoked directly',async()=>{
    const f=workspace();await f.load();f.w.auth.currentUser=null;await f.save();
    assert.equal(f.transactions,0);assert.deepEqual(f.h.get('settings/global_pos_config'),{});assert.match(f.status().textContent,/cannot change/);
});
test('invalid existing policy settings fail loading rather than showing enabled defaults',async()=>{
    const f=workspace({cancelledFoodPurchaseEnabled:'true'});await f.load();
    assert.equal(f.enabled(),null);assert.equal(f.host.querySelector('[data-save-config]'),null);
    assert.match(f.host.querySelector('p').textContent,/whether/);assert.equal(f.transactions,0);
});

function purchaseDialogFixture(change=()=>{}){
    const h=firestoreHarness(),auth={currentUser:{uid:'approved-sample-device'}},pin={value:'5678'},consent={checked:true},messages=[];
    const sale={saleVersion:2,saleId:'prepared-sample',receiptId:'SAMPLE-1',branch:'Maa',shiftId:'open-sample',status:'Voided',paymentMethod:'Grab',netTotal:100,subTotalBeforeDiscount:100,cart:[{name:'Sample food',qty:1,price:100}],inventoryMovements:[],inventoryState:'applied',preparedCancellation:{reason:'customer',platform:'Grab',prepared:true}};
    h.put('transactions/prepared-sample',sale);h.put('pos_sale_commits/prepared-sample',{saleId:sale.saleId,branch:sale.branch,receiptId:sale.receiptId,fingerprint:saleFingerprint(sale)});
    h.put('shifts/open-sample',{branch:'Maa',active:true,status:'Open',salesRevision:1});
    h.put('cashiers/sample-person',{cashierName:'Current Staff Name',fullName:'Older Alias',pin:'5678',role:'Staff',branch:'Maa',active:true});
    const local=new Map(),qty={dataset:{cancelledFoodQty:'0'},value:'1',addEventListener:()=>{}};
    const w={sessionUser:{branch:'Maa',cashierName:'Sample Cashier'},currentShift:{shiftId:'open-sample',active:true},localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},loadSalesDashboard:()=>{},Swal:{isLoading:()=>false,showValidationMessage:message=>messages.push(message),fire:async options=>{
        if(options.title==='Staff purchase of prepared food'){change(w,auth);const value=await options.preConfirm();return value?{isConfirmed:true,value}:{isConfirmed:false};}
        messages.push(options.title);return {isConfirmed:false};
    }}};
    installCancelledOrders({...h.api,auth},{window:w,document:{getElementById:id=>id==='cancelledFoodPin'?pin:consent,querySelectorAll:()=>[qty]}});
    return {h,w,auth,pin,messages};
}
test('installed staff purchase uses the exact Staff profile canonical name when a legacy fullName differs',async()=>{
    const f=purchaseDialogFixture();await f.w.purchaseCancelledFood('prepared-sample');
    const charges=[...f.h.docs.values()].filter(row=>row.type==='Cancelled Food Purchase');
    assert.equal(charges.length,1);assert.equal(charges[0].staffName,'Current Staff Name');assert.equal(charges[0].amount,80);assert.equal(f.pin.value,'');
});
for(const [name,change] of [
    ['Firebase UID',(_w,auth)=>{auth.currentUser={uid:'different-sample-device'};}],
    ['same-name Cashier session',w=>{w.sessionUser={...w.sessionUser};}],
    ['same-ID shift session',w=>{w.currentShift={...w.currentShift};}]
])test(`installed purchase rejects a replaced ${name} before identity lookup or salary writes`,async()=>{
    const f=purchaseDialogFixture(change);await f.w.purchaseCancelledFood('prepared-sample');
    assert.equal([...f.h.docs.values()].filter(row=>row.type==='Cancelled Food Purchase').length,0);
    assert.equal(f.h.get('transactions/prepared-sample').cancelledFoodPurchaseId,undefined);assert.equal(f.h.get('shifts/open-sample').salesRevision,1);
    assert.ok(f.messages.some(message=>/branch or shift changed/.test(message)));assert.equal(f.pin.value,'');
});
