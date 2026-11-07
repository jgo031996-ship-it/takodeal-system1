import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLateRequestWorkedShift,reviewLateRequestDatedAttendance} from '../takodeal-manager/late-request-worked-shift-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const context={requestId:'letter',action:'Approved',profile:{staffId:'crew'},request:{staffId:'crew',staffName:'Sample Crew',type:'Reason Letter',staffShiftProposal:{workDate:'2026-11-07'}}},attendance={id:'time-in',staffId:'crew',branch:'Maa'};
 const nodes=new Map(),mount=()=>{nodes.set('replyMessage',{value:''});nodes.set('replyStaffShiftDecision',{value:''});nodes.set('dynamicReplyModal',{remove(){nodes.delete('dynamicReplyModal');}});};mount();nodes.get('replyMessage').value='Swapped and approved. Please check the saved Night shift.';
 const calls={open:[],reload:[],preview:0,notices:[]},api={auth:{currentUser:{uid:'owner'}},sessionUser:{uid:'owner'},lateRequestOpenToken:Symbol('letter'),lateRequestContext:context,ManagerUI:{notify:message=>calls.notices.push(message)},invalidateCache(){},
  async handleRequest(...args){calls.reload.push(args);api.lateRequestOpenToken=Symbol('refreshed');api.lateRequestContext={...context,selectedLatePreview:null,proposalHoursReviewed:false};mount();},updateLateRequestPreview(){calls.preview++;},workedShiftCorrectionUI:{async open(input,options){calls.open.push({input,options});const dialog={listeners:new Map(),addEventListener(name,listener){this.listeners.set(name,listener);},close(){this.listeners.get('close')?.();}};return dialog;}}};
 return {api,d:{getElementById:id=>nodes.get(id)},nodes,calls,context,attendance};
}
test('Reason Letter opens the protected exact-record worked-shift review and returns to freshly read approval evidence after apply',async()=>{
 const f=fixture();await reviewLateRequestWorkedShift(f.api,f.d,f.context,f.attendance);
 assert.deepEqual(f.calls.open[0].input,{attendanceLogId:'time-in',staffId:'crew',branch:'Maa',workDate:'2026-11-07'});assert.equal(f.calls.reload.length,0);
 await f.calls.open[0].options.onApplied();assert.equal(f.calls.reload.length,1);assert.equal(f.calls.preview,1);assert.match(f.nodes.get('replyMessage').value,/Swapped and approved/);assert.equal(f.nodes.get('replyStaffShiftDecision').value,'');assert.equal(f.api.lateRequestContext.selectedLatePreview,null,'return cannot impersonate a verified approval');
});
test('cancelling worked-shift review preserves the explanation and rereads the letter without saving or waiving it',async()=>{
 const f=fixture();f.nodes.get('replyStaffShiftDecision').value='Keep original assigned hours';const dialog=await reviewLateRequestWorkedShift(f.api,f.d,f.context,f.attendance);dialog.close();await tick();
 assert.equal(f.calls.reload.length,1);assert.match(f.nodes.get('replyMessage').value,/saved Night shift/);assert.equal(f.nodes.get('replyStaffShiftDecision').value,'Keep original assigned hours');assert.equal(f.api.lateRequestContext.proposalHoursReviewed,false);
});
test('an unfinished or blocked worked-shift review restores the pending letter and its reply',async()=>{
 const f=fixture();f.api.workedShiftCorrectionUI.open=async()=>false;
 assert.equal(await reviewLateRequestWorkedShift(f.api,f.d,f.context,f.attendance),false);assert.equal(f.calls.reload.length,1);assert.match(f.nodes.get('replyMessage').value,/Swapped and approved/);assert.equal(f.api.lateRequestContext.proposalHoursReviewed,false);
});
test('an account or newer request change prevents a stale worked-shift return',async()=>{
 for(const change of ['account','request']){const f=fixture(),dialog=await reviewLateRequestWorkedShift(f.api,f.d,f.context,f.attendance);if(change==='account')f.api.auth.currentUser={uid:'other'};else f.api.lateRequestOpenToken=Symbol('other letter');dialog.close();await tick();assert.equal(f.calls.reload.length,0);assert.throws(()=>f.calls.open[0].options.assertCurrent(),/account or request/);}
});
test('dated attendance review supplies an explicit fresh return callback and retains the letter explanation',async()=>{
 const f=fixture();let recovery;f.api.openAttendanceRecovery=value=>{recovery=value;};reviewLateRequestDatedAttendance(f.api,f.d,f.context,{staffId:'crew',attendanceLogId:'time-in',from:'2026-11-06',to:'2026-11-07'});
 assert.equal(f.calls.reload.length,0);await recovery.returnToRequest();assert.equal(f.calls.reload.length,1);assert.equal(f.calls.preview,1);assert.match(f.nodes.get('replyMessage').value,/saved Night shift/);await recovery.returnToRequest();assert.equal(f.calls.reload.length,1);
});
