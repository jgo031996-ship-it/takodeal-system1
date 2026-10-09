import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mealLevels,validateLevels,validateCheckoutFields,checkoutSelections,configurationPatch,requireMealLevel,mealDiscount} from '../takodeal-manager/pos-config-model.js';
import {resolveHQAccount,mealRole} from '../takodeal-manager/hq-account-model.js';
import {findMealIdentity,installMealCheckout} from '../Takodeal-POS/meal-checkout.js';
import {createUnlockGate} from '../takodeal-manager/unlock-gate.js';
import {createSaleEngine,SALE_VERSION} from '../Takodeal-POS/pos-safety.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const co={id:'meal_level_co',name:'Co-Owner',roles:['co_owner'],takoyakiPct:75,otherPct:50,enabled:true};
test('legacy rates migrate without granting Co-Owner the existing Manager level',()=>{
 const levels=mealLevels({staffMealTakoPct:30,staffMealOtherPct:15});assert.equal(levels[0].takoyakiPct,30);assert.equal(levels[0].otherPct,15);assert.ok(!levels[1].roles.includes('co_owner'));
 assert.deepEqual(mealLevels({mealDiscountLevels:[]}),[]);assert.throws(()=>requireMealLevel({mealDiscountLevels:[co]},co.id,'staff'),/not allowed/);
});
test('saving independent meal rates validates names, roles, IDs and percentages',()=>{
 assert.deepEqual(validateLevels([co]),[co]);
 for(const value of [-1,101,'',NaN,Infinity])assert.throws(()=>validateLevels([{...co,otherPct:value}]),/percentages/);
 for(const row of [{...co,roles:[]},{...co,roles:['untrusted-owner']},{...co,id:'percentage'}])assert.throws(()=>validateLevels([row]));
 assert.throws(()=>validateLevels([co,{...co,id:'meal_level_other'}]),/different name/);
 const patch=configurationPatch([...mealLevels({staffMealTakoPct:30}),co],[]);assert.equal(patch.staffMealTakoPct,30);assert.equal(patch.mealDiscountLevels[2].otherPct,50);
});
test('cart uses separate Takoyaki and other rates and rounds to currency cents',()=>{
 const cart=[{name:'Original',lineTotalFinal:100},{name:'Coffee',category:'Coffee',lineTotalFinal:90}];
 assert.equal(mealDiscount(cart,[{name:'Original',category:'Takoyaki'}],co,190),120);
 assert.equal(mealDiscount([{name:'Takoyaki',lineTotalFinal:1.99}],[],co,1.99),1.49);
 assert.throws(()=>mealDiscount([{lineTotalFinal:NaN}],[],co,1));
});
test('custom dropdown values are required, validated and persist their labels',()=>{
 const fields=validateCheckoutFields([{id:'checkout_source',name:'Order source',options:['Walk-in','Phone order'],required:true}]);
 assert.throws(()=>checkoutSelections(fields,{}),/Choose Order source/);assert.throws(()=>checkoutSelections(fields,{checkout_source:'Injected'}),/valid option/);
 assert.deepEqual(checkoutSelections(fields,{checkout_source:'Walk-in'}),[{id:'checkout_source',label:'Order source',value:'Walk-in'}]);
 assert.throws(()=>validateCheckoutFields([{...fields[0],options:['Phone','phone']}]),/duplicate/);
 assert.deepEqual(checkoutSelections([{...fields[0],enabled:false}],{}),[]);
});
test('duplicate HQ records use latest saved profile and reject conflicting legacy PINs',()=>{
 const old={id:'a',data:{email:'sample@example.test',pin:'1111',role:'Manager'}},next={id:'b',data:{...old.data,pin:'2222',pinUpdatedAt:{seconds:10},profileUpdatedAt:{seconds:10},role:'Co-Owner'}};
 assert.equal(resolveHQAccount([old,next]).pin,'2222');assert.equal(resolveHQAccount([old,next]).role,'Co-Owner');
 assert.throws(()=>resolveHQAccount([old,{...next,data:{...next.data,pinUpdatedAt:null}}]),/conflicting PIN/);
 assert.equal(mealRole({role:'assistant owner helper'},'hq_managers'),'');assert.equal(mealRole({role:'Co-Owner'},'hq_managers'),'co_owner');
});
test('an updated PIN unlocks without reopening login and the old PIN fails',async()=>{
 let pin='1111',reads=0,loads=0;const gate=createUnlockGate({verifyOnUnlock:true,verify:async()=>{reads++;return {pin};},load:async()=>loads++});
 await gate.identify({uid:'example'});pin='2222';assert.equal(await gate.unlock('1111'),false);assert.equal(loads,0);assert.equal(await gate.unlock('2222'),true);assert.equal(reads,3);assert.equal(loads,1);
});
test('revoked access, offline checks and concurrent unlocks cannot use a cached PIN',async()=>{
 let blocked=false,loads=0;const gate=createUnlockGate({verifyOnUnlock:true,verify:async()=>{if(blocked)throw Error('revoked');return {pin:'1111'};},load:async()=>loads++});
 await gate.identify({uid:'example'});blocked=true;assert.equal(await gate.unlock('1111'),false);assert.equal(gate.state().phase,'unavailable');assert.equal(loads,0);
});
function identityAPI(rows){return {read:async(source,field,value)=>rows.filter(row=>row.source===source&&row.data[field]===value)};}
test('HQ Co-Owner and Manager PINs resolve and roles enforce the chosen level',async()=>{
 const api=identityAPI([{source:'hq_managers',id:'co',data:{email:'co@example.test',fullName:'Sample Co-Owner',pin:'5678',role:'Co-Owner'}}]);
 const identity=await findMealIdentity(api,'5678',co);assert.equal(identity.role,'co_owner');assert.equal(identity.cashierName,'Sample Co-Owner');assert.ok(!('pin' in identity));
 await assert.rejects(findMealIdentity(api,'5678',mealLevels()[1]),/not allowed/);
 await assert.rejects(findMealIdentity(identityAPI([{source:'cashiers',id:'staff',data:{cashierName:'Sample Staff',pin:'5678',role:'Staff'}}]),'5678',co),/not allowed/);
});
test('PIN collisions and obsolete duplicate credentials cannot select a wrong person',async()=>{
 const rows=[{source:'hq_managers',id:'a',data:{email:'co@example.test',fullName:'Sample',pin:'5678',role:'Co-Owner'}},{source:'hq_managers',id:'b',data:{email:'co@example.test',fullName:'Sample',pin:'6789',role:'Co-Owner',pinUpdatedAt:{seconds:10}}}];
 await assert.rejects(findMealIdentity(identityAPI(rows),'5678',co),/not found/);
 rows[1].data={...rows[0].data,email:'other@example.test'};await assert.rejects(findMealIdentity(identityAPI(rows),'5678',co),/more than one/);
});
test('Staff-only meal verification does not read the protected HQ directory on a PIN-only Cashier',async()=>{
 const calls=[],staff={source:'cashiers',id:'staff-one',data:{cashierName:'Sample Staff',pin:'5678',role:'Staff'}};
 const api={read:async(source,field,value)=>{calls.push(source);if(source==='hq_managers')throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});return field==='pin'&&value==='5678'?[staff]:[];}};
 const identity=await findMealIdentity(api,'5678',mealLevels()[0]);
 assert.equal(identity.id,'staff-one');assert.equal(identity.role,'staff');assert.deepEqual(calls,['cashiers','cashiers']);
 await assert.rejects(findMealIdentity(api,'5678',mealLevels()[1]),/permissions/);
});
test('Staff and custom levels reject ambiguous eligible PINs while excluding a disallowed role',async()=>{
 const rows=[{source:'cashiers',id:'a',data:{cashierName:'Staff A',pin:'5678',role:'Staff'}},{source:'cashiers',id:'b',data:{cashierName:'Manager B',pin:'5678',role:'Manager'}}];
 assert.equal((await findMealIdentity(identityAPI(rows),'5678',mealLevels()[0])).id,'a');
 rows.push({source:'cashiers',id:'c',data:{cashierName:'Staff C',pin:'5678',role:'Crew'}});
 await assert.rejects(findMealIdentity(identityAPI(rows),'5678',mealLevels()[0]),/more than one/);
 const mixed={...co,roles:['staff','manager']};
 await assert.rejects(findMealIdentity(identityAPI(rows.slice(0,2)),'5678',mixed),/more than one/);
});
test('actual Staff meal authorization keeps fresh settings, daily-limit and outbox checks without an HQ read',async()=>{
 const calls=[],store=new Map(),w={masterPOSData:{settings:{}},db:{},localStorage:{getItem:()=>null},saleOutbox:{list:async()=>[]},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),where:(key,op,value)=>({key,op,value}),query:(collection,...filters)=>({...collection,filters}),getDocFromServer:async()=>({exists:()=>true,data:()=>({staffMealTakoPct:30})}),getDocsFromServer:async query=>{
  calls.push(query.table);if(query.table==='hq_managers')throw Error('Missing or insufficient permissions.');
  if(query.table==='staff_requests')return {docs:store.get('claimed')?[{data:()=>({status:'Approved',type:'Staff Meal'})}]:[]};
  return {docs:query.filters.some(filter=>filter.key==='pin'&&filter.value==='5678')?[{id:'staff-one',data:()=>({cashierName:'Sample Staff',pin:'5678',role:'Staff'})}]:[]};
 }};
 installMealCheckout({window:w,document:{}});const allowed=await w.authorizeMealPin('5678','staff_meal',{refresh:true});
 assert.equal(allowed.level.takoyakiPct,30);assert.equal(allowed.id,'staff-one');assert.equal(calls.includes('hq_managers'),false);assert.ok(calls.includes('staff_requests'));
 store.set('claimed',true);await assert.rejects(w.authorizeMealPin('5678','staff_meal'),/already claimed/);
 store.delete('claimed');w.saleOutbox.list=async()=>[{payload:{mealStaffName:'Sample Staff',mealRole:'staff',localTimestamp:new Date().toISOString()}}];await assert.rejects(w.authorizeMealPin('5678','staff_meal'),/awaiting synchronization/);
});
test('custom meal metadata and dropdowns survive sale retry exactly once, without PINs',async()=>{
 const h=firestoreHarness(),engine=createSaleEngine(h.api);
 const payload={saleId:'custom-meal',saleVersion:SALE_VERSION,receiptId:'SAMPLE-001',branch:'Maa',cashier:'Sample',netTotal:50,cart:[{name:'Coffee',qty:1,lineTotalFinal:100}],localTimestamp:new Date().toISOString(),inventoryMovements:[],globalDiscountType:co.id,mealLevelName:co.name,mealRole:'co_owner',mealStaffName:'Sample Co-Owner',customCheckoutSelections:[{id:'checkout_source',label:'Order source',value:'Walk-in'}]};
 await engine.commit(payload);await engine.commit(payload);
 assert.equal(h.get('staff_requests/meal-custom-meal').type,'Co-Owner Meal (POS Auto)');assert.equal(h.get('transactions/custom-meal').customCheckoutSelections[0].value,'Walk-in');assert.ok(!JSON.stringify(h.get('transactions/custom-meal')).includes('5678'));
});
test('independently hosted apps share the identical policy model and cache new modules',()=>{
 for(const name of ['pos-config-model.js','hq-account-model.js'])assert.equal(readFileSync(new URL('../Takodeal-POS/'+name,import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8'));
 for(const app of ['Takodeal-POS','takodeal-manager']){const sw=readFileSync(new URL('../'+app+'/sw.js',import.meta.url),'utf8');assert.match(sw,/pos-config-model\.js/);assert.match(sw,/hq-account-model\.js/);}
});
