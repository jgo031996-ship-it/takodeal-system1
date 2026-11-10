import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {voidUI} from './helpers/cashier-void-fixture.mjs';
import {restoreCashierOwnerDesktop} from './helpers/cashier-owner-desktop-inverse.mjs';
const start=f=>f.controller.start('SAMPLE_SOURCE','SAMPLE-OLD-RECEIPT');

test('four exact platform-only changes restore every other void byte to the live f8 component',()=>{
 const proof=JSON.parse(readFileSync(new URL('./fixtures/cashier-void-platform-inverse.json',import.meta.url))),sha=s=>createHash('sha256').update(s).digest('hex');assert.equal(proof.base,'f8f56b31ba4db3b5a7dabe42dab79198294df5b1');assert.equal(proof.edits.length,4);let source=restoreCashierOwnerDesktop(readFileSync(new URL('../'+proof.file,import.meta.url),'utf8'),proof.file);assert.equal(sha(source),proof.candidateSha256);for(const edit of [...proof.edits].reverse()){assert.equal(source.split(edit.after).length,2);source=source.replace(edit.after,()=>edit.before);}assert.equal(sha(source),'defa754887581196ff708228db24d37bb7ddff695489c09faf466138958c0f46');assert.equal(sha(source),proof.baselineSha256);
});

test('untouched Store POS uses the actual Standard selector before window.posPlatform is initialized, including replacement checkout',async()=>{
 const source=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');assert.match(source,/<option value="Standard">[^<]*Store POS/);
 const f=voidUI();delete f.w.posPlatform;f.elements.set('posPlatformSelect',{value:'Standard'});const result=await start(f);assert.equal(result.restored,true,JSON.stringify(result));assert.equal(f.backend.commits,1);assert.equal(f.w.posPlatform,undefined);
 const payload={branch:f.backend.branch,shiftId:'SAMPLE_SHIFT',cart:f.w.cart,paymentMethod:'Cash',netTotal:85},reserved=await f.controller.prepareCheckout(payload);Object.assign(payload,{saleId:reserved.saleId,receiptId:reserved.receiptId});const frozen=await f.controller.freezeCheckout(payload);assert.equal(frozen.saleId,reserved.saleId);assert.equal(frozen.receiptId,reserved.receiptId);assert.equal(f.backend.commits,1);
});

test('Store POS default with no selector or global value uses the same existing checkout fallback',async()=>{
 const f=voidUI();delete f.w.posPlatform;assert.equal(f.elements.has('posPlatformSelect'),false);assert.equal((await start(f)).restored,true);assert.equal(f.backend.commits,1);
});

test('uninitialized global never treats a Grab, Foodpanda or unknown selector as Standard',async()=>{
 for(const value of ['Grab','Foodpanda','Store POS','UNKNOWN']){const f=voidUI();delete f.w.posPlatform;f.elements.set('posPlatformSelect',{value});const cart=f.w.cart,result=await start(f);assert.match(result.error,/empty Store POS cart|channel controls/,value);assert.equal(f.backend.commits,0,value);if(['Store POS','UNKNOWN'].includes(value))assert.equal(f.calls.length,0,value);assert.equal(f.w.cart,cart,value);}
});

test('selector mode changing during PIN verification cannot void or restore under the old mode',async()=>{
 const f=voidUI();delete f.w.posPlatform;const select={value:'Standard'};f.elements.set('posPlatformSelect',select);const fire=f.w.Swal.fire;f.w.Swal.fire=async options=>{const answer=await fire(options);if(options.input==='password')select.value='Grab';return answer;};const result=await start(f);assert.ok(result.error);assert.equal(f.backend.commits,0);assert.equal(f.calls.some(call=>call.path.startsWith('/cashier-void/')),false);assert.equal(f.w.cart.length,0);
});

test('Order cancelled preserves an occupied current order, hidden platform carts, customer, mobile and parked context',async()=>{
 const f=voidUI();f.reason='OrderCancelled';delete f.w.posPlatform;const cart=f.w.cart=[{name:'CURRENT CUSTOMER',qty:3,notes:'Keep instructions',addons:{Extra:{qty:2,price:5}}}];f.w.platformCarts={Standard:cart,Grab:[{name:'OTHER PLATFORM',qty:2}]};f.w.isActiveOrderMobile=true;f.w.activeMobileOrderId='KEEP-MOBILE';f.w.activeMobileOrderCode='KEEP-CODE';f.w.activeMobileDelivery={fee:25,orderId:'KEEP-MOBILE'};f.w.isResumedParkedOrder=true;f.w.parkedRecovery={activeId:()=> 'KEEP-PARKED'};f.w.parkOrder=()=>assert.fail('No auto-park');const before=JSON.stringify({cart:f.w.cart,platforms:f.w.platformCarts,mobile:f.w.activeMobileDelivery,fields:[...f.elements].map(([id,el])=>[id,el.value])});
 assert.equal((await start(f)).saved,true);assert.equal(f.w.cart,cart);assert.equal(JSON.stringify({cart:f.w.cart,platforms:f.w.platformCarts,mobile:f.w.activeMobileDelivery,fields:[...f.elements].map(([id,el])=>[id,el.value])}),before);assert.equal(f.w.activeMobileOrderId,'KEEP-MOBILE');assert.equal(f.w.activeMobileOrderCode,'KEEP-CODE');assert.equal(f.w.isActiveOrderMobile,true);assert.equal(f.w.isResumedParkedOrder,true);assert.equal(f.w.parkedRecovery.activeId(),'KEEP-PARKED');assert.equal(f.backend.commits,1);
});

test('genuinely occupied Wrong punched keeps the existing safeguards without auto-parking or any PIN request',async()=>{
 const f=voidUI();delete f.w.posPlatform;f.elements.set('posPlatformSelect',{value:'Standard'});const cart=f.w.cart=[{name:'KEEP CUSTOMER',qty:2,addons:{Extra:{qty:1,price:5}},notes:'KEEP NOTES'}],before=JSON.stringify(cart),customer=f.elements.get('finalCustomerName').value;f.w.parkOrder=()=>assert.fail('No auto-park');assert.match((await start(f)).error,/park it first/);assert.equal(f.w.cart,cart);assert.equal(JSON.stringify(f.w.cart),before);assert.equal(f.elements.get('finalCustomerName').value,customer);assert.equal(f.calls.length,0);assert.equal(f.backend.commits,0);
});
