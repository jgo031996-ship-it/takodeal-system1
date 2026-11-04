import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewDocument,drain} from './helpers/review-dom.mjs';
import {installOwnerTimeOutCorrectionUI,ownerTimeOutDepartureFields,ownerTimeOutDepartureValue} from '../takodeal-manager/owner-time-out-correction-ui.js';
const original='2026-10-19T09:30:00.000Z',base=()=>({timeInAt:original,request:null,existingTimeOut:null});
function fixture(patch={}){
 const document=new ReviewDocument(),create=document.createElement.bind(document);
 document.createElement=tag=>{const node=create(tag);node.remove=function(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;};return node;};
 const email='jgo031996@gmail.com',calls=[],w={auth:{currentUser:{uid:'sample-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-owner',email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,ManagerUI:{notify:()=>{}}};
 const view={...base(),context:{attendanceLogId:'sample-time-in',staffId:'sample-staff',staffName:'Sample Employee',branch:'Maa',requestId:'sample-request'},expectedFingerprint:'a'.repeat(64),staffName:'Sample Employee',staffId:'sample-staff',branch:'Maa',paidCutoffs:[],canSave:true,...patch};
 const service={inspect:async()=>structuredClone(view),isSaving:()=>false,save:async input=>{calls.push(structuredClone(input));return {saved:true,id:'sample-time-out',timestamp:new Date(input.dateTimeRaw+'+08:00').toISOString()};}};
 const ui=installOwnerTimeOutCorrectionUI(w,document,{service});return {view,w,document,ui,calls,open:()=>ui.open(view.context),node:selector=>document.querySelector(selector)};
}
test('old morning Time In anchors its own Philippine date without a current-month default or invented departure time',()=>{
 const result=ownerTimeOutDepartureFields({timeInAt:'2026-10-19T00:58:00.000Z'});
 assert.equal(result.date,'2026-10-19');assert.equal(result.time,'');assert.equal(result.minDate,'2026-10-19');assert.equal(result.maxDate,'2026-10-20');assert.equal(result.maxTime,'02:58:00');
});
test('a bounded overnight request date opens on the following original work date, keeping its unverified time blank',()=>{
 const result=ownerTimeOutDepartureFields({...base(),request:{requestedDepartureAt:'2026-10-19T18:35:00.000Z',scheduledEndAt:'2026-10-19T18:30:00.000Z'}});
 assert.equal(result.date,'2026-10-20');assert.equal(result.time,'');assert.match(result.basis,/request.*reference/i);
});
test('a saved overnight finish can anchor only the date and is never substituted for actual Time Out',()=>{
 const result=ownerTimeOutDepartureFields({...base(),request:{scheduledEndAt:'2026-10-19T18:30:00.000Z'}});
 assert.equal(result.date,'2026-10-20');assert.equal(result.time,'');assert.match(result.basis,/scheduled finish.*do not establish/i);
 assert.throws(()=>ownerTimeOutDepartureValue(result.date,result.time,base()),/actual departure time/);
});
test('a much later request submission and invalid or reversed references cannot move an October shift to November',()=>{
 for(const requestedDepartureAt of ['2026-11-04T12:00:00.000Z','2026-10-19T08:00:00.000Z','invalid']){
  const result=ownerTimeOutDepartureFields({...base(),request:{requestedDepartureAt}});assert.equal(result.date,'2026-10-19');assert.equal(result.time,'');
 }
 const anchored=ownerTimeOutDepartureFields({...base(),request:{requestedDepartureAt:'2026-11-04T12:00:00.000Z',scheduledEndAt:'2026-10-19T18:30:00.000Z'}});assert.equal(anchored.date,'2026-10-20');assert.equal(anchored.time,'');
});
test('only an already saved valid departure supplies an initial time, without accepting any correction',()=>{
 const result=ownerTimeOutDepartureFields({...base(),existingTimeOut:{timestamp:'2026-10-19T18:35:06.000Z'},request:{requestedDepartureAt:'2026-10-19T17:00:00.000Z'}});
 assert.equal(result.date,'2026-10-20');assert.equal(result.time,'02:35:06');assert.match(result.basis,/currently saved.*Verify/i);
});
test('full Philippine date/time combination retains exact entered seconds and validates original-punch bounds',()=>{
 assert.equal(ownerTimeOutDepartureValue('2026-10-20','02:35:06',base()),'2026-10-20T02:35:06');
 assert.equal(ownerTimeOutDepartureValue('2026-10-20','11:30',base()),'2026-10-20T11:30');
 for(const [date,time]of [['2026-10-19','17:30'],['2026-10-20','11:30:01'],['2026-11-04','02:35'],['2026-02-30','02:35'],['2026-10-20','24:00'],['','02:35'],['2026-10-20','']])assert.throws(()=>ownerTimeOutDepartureValue(date,time,base()));
});
test('opening actual split controls is read-only and incomplete time cannot become a confirmation even with the checkbox checked',async()=>{
 const f=fixture();await f.open();assert.equal(f.node('[data-actual-date]').attributes.type,'date');assert.equal(f.node('[data-actual-time]').attributes.type,'time');assert.equal(f.node('[data-actual-date]').value,'2026-10-19');assert.equal(f.node('[data-actual-time]').value,'');
 f.node('[data-verified]').checked=true;f.node('[data-prepare]').click();await drain();assert.match(f.node('[data-status]').textContent,/Enter the actual departure time/);assert.equal(f.node('[data-confirm]'),null);assert.equal(f.calls.length,0);
});
test('following-day shortcut changes only the date, clears verification and preserves the original date bounds',async()=>{
 const f=fixture();await f.open();f.node('[data-verified]').checked=true;const buttons=f.node('[data-date-shortcuts]').querySelectorAll('button');assert.equal(buttons.length,2);buttons[1].click();
 assert.equal(f.node('[data-actual-date]').value,'2026-10-20');assert.equal(f.node('[data-actual-date]').min,'2026-10-19');assert.equal(f.node('[data-actual-date]').max,'2026-10-20');assert.equal(f.node('[data-actual-time]').max,'11:30:00');assert.equal(f.node('[data-actual-time]').value,'');assert.equal(f.node('[data-verified]').checked,false);assert.equal(f.calls.length,0);
});
test('entering an exact overnight departure creates the unchanged service payload only after explicit review and confirm',async()=>{
 const f=fixture({request:{status:'Pending',requestedDepartureAt:'2026-10-19T18:35:00.000Z'}});await f.open();f.node('[data-actual-time]').value='02:35';f.node('[data-actual-time]').emit('input');f.node('[data-verified]').checked=true;f.node('[data-prepare]').click();await drain();assert.equal(f.calls.length,0);assert.match(f.node('[data-review]').textContent,/Oct 20, 2026/);f.node('[data-confirm]').click();await drain();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].dateTimeRaw,'2026-10-20T02:35');assert.equal(f.calls[0].confirmActualDeparture,true);assert.equal(f.calls[0].context.attendanceLogId,'sample-time-in');
});
test('changing the date after review clears the confirmation and cannot save the earlier reviewed timestamp',async()=>{
 const f=fixture();await f.open();f.node('[data-actual-time]').value='18:30';f.node('[data-verified]').checked=true;f.node('[data-prepare]').click();await drain();assert.ok(f.node('[data-confirm]'));
 f.node('[data-actual-date]').value='2026-10-20';f.node('[data-actual-date]').emit('change');assert.equal(f.node('[data-confirm]'),null);assert.equal(f.node('[data-verified]').checked,false);assert.equal(f.calls.length,0);
});
test('refresh retains entered date/time but removes verification when the authoritative source changes',async()=>{
 const f=fixture();await f.open();f.node('[data-actual-time]').value='18:35';f.node('[data-actual-time]').emit('input');f.node('[data-verified]').checked=true;f.view.expectedFingerprint='b'.repeat(64);f.node('[data-refresh]').click();await drain();
 assert.equal(f.node('[data-actual-date]').value,'2026-10-19');assert.equal(f.node('[data-actual-time]').value,'18:35');assert.equal(f.node('[data-verified]').checked,false);assert.equal(f.calls.length,0);
});
