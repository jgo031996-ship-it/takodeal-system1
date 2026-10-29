import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';
import {ReviewDocument,drain,deferred} from './helpers/review-dom.mjs';

const url=new URL('../takodeal-manager/hr-review-ui.js',import.meta.url),source=readFileSync(url,'utf8').replace(/import \{createStaffDocumentFirebase\} from '\.\/staff-document-firebase.js';/,"const createStaffDocumentFirebase=async()=>{throw Error('Synthetic private adapter unavailable');};").replace(/from '(\.\/[^']+)'/g,(_,path)=>"from '"+new URL(path,url).href+"'");
const {installHRReviewCenter,heldPayrollReviewHTML}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
async function fixture({save=async()=>({saved:true}),review=async()=>({saved:true}),readAttendance,wait=25000,profile={},context={}}={}){
 const h=await amendmentFixture({name:'Sample Established Crew'}),d=new ReviewDocument(),calls={save:[],review:[],globalConfirm:0,payroll:[]};
 Object.assign(h.get('cashiers/'+h.staffId),profile);
 Object.assign(h.api,{loadPayrollScheduleHistory:async()=>h.history,ManagerUI:{notify(){},confirm:async()=>{calls.globalConfirm++;throw Error('Body confirmation must not be opened from a native modal.');}},openPayrollFromHR:value=>calls.payroll.push(value)});
 const ui=installHRReviewCenter(h.api,d,{readAttendance:async()=>readAttendance?readAttendance(h):[h.withId()],readDocuments:async()=>({}),saveWaitMs:wait,saveOnboarding:async(api,value)=>{calls.save.push(value);return save(value,api);},confirmReview:async(api,value)=>{calls.review.push(value);return review(value,api);}});
 const state={...h,d,calls,ui,context:{staffId:h.staffId,staffName:h.name,branch:h.branch,from:'2026-10-16',to:'2026-10-31',...context}};
 state.find=id=>d.getElementById(id);state.button=name=>d.querySelector('[data-'+name+']');state.open=()=>ui.open(state.context);
 state.fill=(date='2026-02-25',reason='Reviewed')=>{state.find('hrRecoveryStart').value=date;state.find('hrRecoveryStartReason').value=reason;};
 return state;
}
test('valid eight-character Reviewed reason clears an earlier error and opens an enabled in-dialog review',async()=>{
 const f=await fixture();await f.open();f.fill('','');f.button('onboarding').click();assert.match(f.find('hrRecoveryStatus').textContent,/valid actual employment start date/);
 f.fill();f.button('onboarding').click();assert.match(f.find('hrRecoveryStartReview').textContent,/2026-02-25/);assert.match(f.find('hrRecoveryStartReview').textContent,/Reviewed/);
 assert.match(f.find('hrRecoveryStatus').textContent,/No employment action has been sent/);assert.equal(f.button('start-confirm').disabled,false);assert.equal(f.button('close').disabled,false);assert.equal(f.find('hrRecoveryStart').disabled,false);
 assert.equal(f.calls.globalConfirm,0);assert.equal(f.calls.save.length,0);f.button('start-cancel').click();assert.equal(f.find('hrRecoveryStartReview').textContent,'');assert.equal(f.calls.save.length,0);
});
test('employment validation distinguishes dates and reason limits without locking the modal',async()=>{
 const f=await fixture();await f.open();for(const [date,reason,error]of [['2026-02-30','Reviewed',/valid actual/],['2099-01-01','Reviewed',/future/],['2026-02-25','Review',/at least 8 characters/],['2026-02-25','x'.repeat(1501),/1,500 characters/]]){f.fill(date,reason);f.button('onboarding').click();assert.match(f.find('hrRecoveryStatus').textContent,error);assert.equal(f.find('hrRecoveryStart').disabled,false);assert.equal(f.button('close').disabled,false);assert.equal(f.button('start-confirm'),null);}assert.equal(f.calls.save.length,0);
});
test('only the in-dialog final confirmation sends one action with the reviewed employee date and reason',async()=>{
 const f=await fixture();await f.open();f.fill();f.button('onboarding').click();assert.equal(f.calls.save.length,0);f.button('start-confirm').click();await drain();assert.equal(f.calls.save.length,1);
 const value=f.calls.save[0];assert.equal(value.staffId,f.staffId);assert.equal(value.startDate,'2026-02-25');assert.equal(value.reason,'Reviewed');assert.equal(value.action,'confirm-start');assert.match(value.operationId,/^[0-9a-f-]{36}$/);assert.equal(f.calls.globalConfirm,0);assert.match(f.find('hrRecoveryStatus').textContent,/Employment start confirmed/);
});
test('editing a reviewed date or changing the employee session cannot send a stale confirmation',async()=>{
 for(const change of ['date','account']){const f=await fixture();await f.open();f.fill();f.button('onboarding').click();if(change==='date')f.find('hrRecoveryStart').value='2026-02-26';else f.api.auth.currentUser.uid='changed-owner';f.button('start-confirm').click();await drain();assert.equal(f.calls.save.length,0);}
});
test('a stalled physical save is uncertain, stays single-flight and leaves Close and Refresh available',async()=>{
 const pending=deferred(),f=await fixture({save:()=>pending.promise,wait:2});await f.open();f.fill();f.button('onboarding').click();f.button('start-confirm').click();await new Promise(resolve=>setTimeout(resolve,12));await drain();
 assert.equal(f.calls.save.length,1);assert.match(f.find('hrRecoveryStatus').textContent,/not confirmed the save outcome.*may still finish/);assert.equal(f.button('close').disabled,false);assert.equal(f.find('hrRecoveryRefresh').disabled,false);assert.equal(f.button('start-confirm').disabled,true);assert.equal(f.button('onboarding').disabled,true);
 f.button('start-confirm').click();assert.equal(f.calls.save.length,1);f.button('close').click();assert.equal(f.d.querySelector('dialog').open,false);await f.open();assert.match(f.find('hrRecoveryStatus').textContent,/still waiting for HQ/);assert.equal(f.button('onboarding').disabled,true);
 pending.resolve({saved:true});await drain();assert.doesNotMatch(f.find('hrRecoveryStatus').textContent,/Employment start confirmed/);assert.equal(f.calls.save.length,1);
 f.find('hrRecoveryRefresh').click();await drain();assert.equal(f.button('onboarding').disabled,false);
});
test('retrying the same uncertain failed action reuses its operation ID',async()=>{
 let attempts=0;const f=await fixture({save:async()=>{if(++attempts===1)throw Error('Synthetic response could not be confirmed.');return {alreadySaved:true};}});await f.open();f.fill();f.button('onboarding').click();f.button('start-confirm').click();await drain();assert.match(f.find('hrRecoveryStatus').textContent,/could not be confirmed/);assert.equal(f.find('hrRecoveryStartReason').value,'Reviewed');
 f.button('start-confirm').click();await drain();assert.equal(f.calls.save.length,2);assert.equal(f.calls.save[0].operationId,f.calls.save[1].operationId);assert.equal(f.calls.globalConfirm,0);
});
test('the payroll route retains cutoff and staff, displays real holds and does not release them through employment review',async()=>{
 const f=await fixture({context:{payrollReviewReasons:['The private salary history could not be confirmed.','A conflicting Time Out needs review.'],attendanceLogIds:['sample-in','affected-private-id'],recordedHours:98.75}});await f.open();const text=f.find('hrRecoveryContent').textContent;
 assert.match(text,/98.75 hours/);assert.match(text,/private salary history/);assert.match(text,/conflicting Time Out/);assert.match(text,/affected-private-id/);assert.match(text,/does not clear a salary or attendance hold/);
 f.button('payroll').click();assert.equal(f.d.querySelector('dialog').open,false);assert.deepEqual(f.calls.payroll,[{staffId:f.staffId,staffName:f.name,branch:f.branch,from:'2026-10-16',to:'2026-10-31'}]);assert.equal(f.calls.save.length,0);
 const link=heldPayrollReviewHTML({staffId:f.staffId,name:f.name,branch:f.branch,start:'2026-10-16',end:'2026-10-31',attendanceLogIds:['a','b'],attendanceReviewReasons:['Salary unavailable'],hours:98.75});assert.match(link,/payrollReviewReasons/);assert.match(link,/Salary unavailable/);assert.match(link,/attendanceLogIds/);assert.match(link,/98.75/);
});
test('an established saved-hire baseline is labelled separately and never offers an automatic new initial contract',async()=>{
 const f=await fixture({profile:{dateHired:'2026-02-25'}});await f.open();const section=f.find('hrRecoveryOnboarding').textContent;assert.match(section,/Saved hire date/);assert.match(section,/Reminder reference/);assert.match(section,/2026-02-25/);assert.match(section,/Existing employee record/);assert.doesNotMatch(section,/Review six-month initial contract/);assert.equal(f.calls.save.length,0);
});
for(const action of ['employment','dated-attendance'])test('an old '+action+' success refresh cannot overwrite a reopened same-employee cutoff',async()=>{
 const pending=deferred();let reads=0;const f=await fixture({readAttendance:h=>++reads===2?pending.promise:[h.withId()]});await f.open();const before=structuredClone([...f.docs]);
 if(action==='employment'){f.fill();f.button('onboarding').click();f.button('start-confirm').click();}
 else {f.button('reason').value='Reviewed the saved dated attendance decision.';f.button('review').click();}
 await drain();assert.equal(reads,2);assert.equal(f.calls.save.length+f.calls.review.length,1);
 f.button('close').click();f.context.from='2026-10-17';await f.open();const currentStatus=f.find('hrRecoveryStatus').textContent;assert.match(currentStatus,/HQ attendance read complete/);
 pending.resolve([f.withId()]);await drain();assert.equal(f.find('hrRecoveryStatus').textContent,currentStatus);assert.equal(f.find('hrRecoveryFrom').value,'2026-10-17');assert.equal(f.d.querySelector('dialog').open,true);assert.equal(f.button('close').disabled,false);assert.equal(f.calls.save.length+f.calls.review.length,1);assert.deepEqual([...f.docs],before);
});
