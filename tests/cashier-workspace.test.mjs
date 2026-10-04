import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {businessDate,dayWindow,attendanceRows,imageFor,updateBlocker,labelSettings,drinkLabels} from '../Takodeal-POS/cashier-data.js';
const punch=(name,branch,type,time)=>({staffName:name,branch,type,timestamp:new Date(time)});
const now=+new Date('2026-10-04T14:00:00+08:00');
test('calendar dates use Philippine time around UTC midnight',()=>{assert.equal(businessDate(new Date('2026-10-03T17:00:00Z')),'2026-10-04');assert.equal(dayWindow('2026-10-04').start,+new Date('2026-10-03T16:00:00Z'));assert.throws(()=>dayWindow('2026-02-30'));});
test('attendance pairs overnight shifts and identifies people currently on duty',()=>{
 const logs=[punch('Ana','Maa','TIME IN','2026-10-03T18:30:00+08:00'),punch('Ana','Maa','TIME OUT','2026-10-04T03:00:00+08:00'),punch('Bea','Cabantian','TIME IN','2026-10-04T09:00:00+08:00')];
 const rows=attendanceRows(logs,'2026-10-04','All',now);assert.equal(rows.length,2);assert.equal(rows[0].status,'On duty');assert.equal(rows[1].hours,8.5);assert.equal(rows[1].carryIn,true);
 const previous=attendanceRows(logs,'2026-10-03','All',now);assert.equal(previous[0].status,'Completed');assert.equal(previous[0].hours,8.5);
});
test('unmatched and stale punches are never advertised as on duty',()=>{
 const rows=attendanceRows([punch('Ana','Maa','TIME IN','2026-10-03T01:00:00+08:00'),punch('Bea','Maa','TIME OUT','2026-10-04T10:00:00+08:00')],'2026-10-04','All',now);
 assert.equal(rows.length,1);assert.equal(rows[0].status,'Missing time in');
});
test('attendance never pairs people across branches or a second clock in',()=>{
 const rows=attendanceRows([punch('Ana','Maa','TIME IN','2026-10-04T09:00:00+08:00'),punch('Ana','Maa','TIME IN','2026-10-04T10:00:00+08:00'),punch('Ana','Cabantian','TIME OUT','2026-10-04T11:00:00+08:00')],'2026-10-04','All',now);
 assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.status==='Completed').length,0);assert.equal(attendanceRows([punch('Ana','Maa','TIME IN','2026-10-04T09:00:00+08:00')],'2026-10-04','Cabantian',now).length,0);
});
test('future records and malformed timestamps do not affect attendance',()=>{
 assert.deepEqual(attendanceRows([punch('Ana','Maa','TIME IN','2026-10-04T15:00:00+08:00'),{staffName:'Ana',timestamp:'broken'}],'2026-10-04','All',now),[]);
});
test('all platform carts, operational drafts and active writes block updates',()=>{
 for(const w of [{cart:[{}]},{platformCarts:{Grab:[{}]}},{prepCart:[{}]},{kitchenPrepCart:[{}]},{wasteCart:[{}]},{consumablesCart:[{}]},{expenseCart:[{}]},{isProcessingOrder:true},{isSubmittingOrder:true},{isSubmittingWasteCart:true},{cashierRemitSubmitting:true},{isProcessingAttendance:true},{isBluetoothPrinting:true},{bluetoothPrintQueue:[{}]}])assert.ok(updateBlocker(w),JSON.stringify(w));
 assert.equal(updateBlocker({offlineQueue:[{}],cart:[],platformCarts:{Grab:[]}}),'');
});
test('consumable photos use legacy and current fields and exact names',()=>{
 assert.equal(imageFor({name:'Fork',imageUrl:'https://example.test/fork.png'}),'https://example.test/fork.png');assert.equal(imageFor({name:' Fork '},[{name:'fork',image:'https://example.test/a.png'}]),'https://example.test/a.png');assert.equal(imageFor({name:'Fork'},[{name:'Spork',image:'https://example.test/wrong.png'}]),'');assert.equal(imageFor({image:'javascript:alert(1)'}),'');
});
test('CT221B label settings enforce manufacturer width and bitmap resolution',()=>{
 assert.deepEqual(labelSettings(),{width:50,height:30,dpi:203});for(const width of [0,55,NaN])assert.throws(()=>labelSettings({width}));assert.throws(()=>labelSettings({height:0}));
});
test('drink labels preserve copy count and customizations and exclude cancelled orders',()=>{
 const receipt={receiptId:'OR-123',customerName:'Ana',items:[{name:'Latte',category:'Iced Coffee',qty:2,size:'Large',addons:[{name:'Pearls'}],notes:'Less ice'},{name:'Original',category:'Takoyaki',qty:1}]};
 const labels=drinkLabels(receipt);assert.equal(labels.length,2);assert.equal(labels[1].copy,'2/2');assert.match(labels[0].detail,/Less ice/);assert.equal(labels[0].order,'OR-123');assert.deepEqual(drinkLabels({...receipt,status:'Parked'}),[]);assert.deepEqual(drinkLabels({...receipt,paymentMethod:'UNPAID'}),[]);
});
test('label copies reject malformed or unbounded quantities',()=>{for(const qty of [-1,1.2,101,'bad'])assert.equal(drinkLabels({items:[{category:'Coffee',qty}]}).length,0);});
test('service worker stages a complete release and activates only on explicit message',async()=>{
 const listeners={},puts=[],messages=[];let skipped=0;
 const context={URL,Request,Set,console,self:{location:{href:'https://pos.test/sw.js'},clients:{claim:async()=>{}},skipWaiting:async()=>{skipped++;},addEventListener:(name,fn)=>listeners[name]=fn},caches:{open:async()=>({put:async u=>puts.push(u)})},fetch:async()=>({ok:true,type:'basic',clone(){return this;},text:async()=>''})};
 vm.runInNewContext(readFileSync(new URL('../Takodeal-POS/sw.js',import.meta.url),'utf8'),context);
 let installed;listeners.install({waitUntil:p=>installed=p});await installed;assert.equal(skipped,0);assert.ok(puts.some(u=>u.endsWith('/cashier-workspace.js')));
 listeners.message({data:{type:'TK_ACTIVATE_UPDATE'},waitUntil:p=>messages.push(p)});await Promise.all(messages);assert.equal(skipped,1);
});

 test('actual POS receipt labels recover menu categories and object add-ons',()=>{
  const labels=drinkLabels({cart:[{name:'Latte',qty:2,variantName:'Large',addons:{'Extra shot':20},notes:'Less ice'},{name:'Takoyaki',qty:1}]},[],[{name:'Latte',category:'Iced Coffee'},{name:'Takoyaki',category:'Bonito Takoyaki'}]);
  assert.equal(labels.length,2);assert.equal(labels[0].detail,'Large · Extra shot · Less ice');
 });
