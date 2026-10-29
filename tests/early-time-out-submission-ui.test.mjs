import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareEarlyTimeOut} from '../Takodeal-POS/early-time-out-ui.js';
const input={staffId:'fictional-staff',staffName:'Fictional Crew',start:{id:'fictional-time-in',branch:'Maa'},assertCurrent(){}};
function fixture({unknown=true,request=async()=>({id:'early-fictional-reference',status:'Pending'})}={}){
 const calls=[],messages=[],forms=[],values={earlyTimeOutReason:{value:'My assigned shift finishes at 5:30 PM.'},earlyTimeOutPin:{value:'synthetic-pin'}};
 const service={inspect:async()=>({unknown,early:!unknown,scheduledEndAt:unknown?null:'2030-01-10T09:30:00Z',minutesEarly:30}),request:async value=>{calls.push(value);return request(value);}};
 const api={document:{getElementById:id=>values[id]},Swal:{showValidationMessage:message=>messages.push(message),fire:async options=>{forms.push(options);if(options.preConfirm){const result=await options.preConfirm();return {isConfirmed:!!result,value:result};}return {isConfirmed:true};}}};
 return {api,service,calls,messages,forms,values};
}
test('unknown assignment does not call the employee early and confirms the exact committed inbox reference',async()=>{
 const f=fixture(),result=await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(result.proceed,false);assert.equal(f.calls.length,1);assert.equal(f.forms[0].titleText,'Request schedule review');assert.equal(f.forms[0].confirmButtonText,'Send schedule review');assert.match(f.forms[0].html,/does not mean you are leaving early/);assert.match(f.forms[0].html,/Explain your assigned shift or clock-out issue/);assert.doesNotMatch(f.forms[0].html,/Reason for finishing early/);assert.match(f.forms[1].html,/early-fictional-reference/);assert.match(f.forms[1].html,/Fictional Crew · Maa/);assert.match(f.forms[1].html,/Owner or Manager app/);assert.equal(f.forms[1].titleText,'Request saved to management inbox');
});
test('a rejected or unconfirmed save keeps the form and typed reason open without claiming delivery',async()=>{
 const f=fixture({request:async()=>{throw Error('Synthetic connection failure');}}),result=await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(result.proceed,false);assert.equal(f.forms.length,1);assert.deepEqual(f.messages,['Synthetic connection failure']);assert.equal(f.values.earlyTimeOutReason.value,'My assigned shift finishes at 5:30 PM.');assert.equal(f.calls.length,1);
});
test('invalid staff input never sends a request and a verified early shift retains approval wording',async()=>{
 const f=fixture({unknown:false});f.values.earlyTimeOutReason.value='';await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(f.calls.length,0);assert.equal(f.forms.length,1);assert.match(f.messages[0],/reason and your staff PIN/);assert.match(f.forms[0].html,/Reason for finishing early/);assert.equal(f.forms[0].confirmButtonText,'Send approval request');
});
test('pending schedule review shows its saved reference and approved or completed shifts skip request entry',async()=>{
 const f=fixture();f.service.inspect=async()=>({unknown:true,scheduleFingerprint:'unknown',request:{id:'early-existing',status:'Pending',scheduleFingerprint:'unknown',requestedDepartureAt:'2030-01-10T09:00:00Z'}});f.api.Swal.fire=async options=>{f.forms.push(options);return {isConfirmed:false};};await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(f.calls.length,0);assert.equal(f.forms[0].titleText,'Schedule review awaiting management');assert.match(f.forms[0].html,/early-existing/);
 for(const flag of ['complete','closed','approved']){const normal=fixture();normal.service.inspect=async()=>({[flag]:true});assert.equal((await prepareEarlyTimeOut(normal.api,input,{service:normal.service})).proceed,true);assert.equal(normal.forms.length,0);assert.equal(normal.calls.length,0);}
});
test('only a confirmed server result may produce the sent receipt, and staff-controlled text is escaped',async()=>{
 const f=fixture({request:async()=>({id:'<img onerror=bad()>',status:'Pending'})});await prepareEarlyTimeOut(f.api,{...input,staffName:'<script>bad()</script>'},{service:f.service});assert.match(f.forms[1].html,/&lt;script&gt;/);assert.match(f.forms[1].html,/&lt;img/);assert.doesNotMatch(f.forms[1].html,/<script>|<img/);
 const invalid=fixture({request:async()=>({})});await assert.rejects(prepareEarlyTimeOut(invalid.api,input,{service:invalid.service}),/was not confirmed/);assert.equal(invalid.forms.length,1);
});
test('Owner, Staff and POS submission forms remain byte-identical',()=>{
 const source=readFileSync(new URL('../Takodeal-POS/early-time-out-ui.js',import.meta.url),'utf8');for(const app of ['takodeal-manager','takodeal-staff'])assert.equal(readFileSync(new URL('../'+app+'/early-time-out-ui.js',import.meta.url),'utf8'),source);
});

test('unknown pending rechecks and cancellation use schedule-review wording rather than an early-departure finding',async()=>{
 const pending={unknown:true,scheduleFingerprint:'unverified',request:{id:'early-unknown',status:'Pending',scheduleFingerprint:'unverified',requestedDepartureAt:'2026-10-29T03:06:00+08:00'}};
 const f=fixture();f.service.inspect=async()=>pending;f.api.Swal.fire=async(...args)=>{f.forms.push(args);return args[0]?.showDenyButton?{isConfirmed:true}:{};};const result=await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(result.proceed,false);assert.equal(f.forms[0][0].confirmButtonText,'Check schedule review');assert.equal(f.forms[0][0].cancelButtonText,'Back to Time Clock');assert.equal(f.forms[1][0],'Schedule review still pending');assert.match(f.forms[1][1],/not a finding of early departure/);assert.doesNotMatch(f.forms[1][0],/approval/);assert.equal(f.calls.length,0);
 const cancelled=fixture(),cancels=[];cancelled.service.inspect=async()=>pending;cancelled.service.cancel=async value=>cancels.push(value);cancelled.api.Swal.fire=async options=>{cancelled.forms.push(options);if(options.showDenyButton)return {isDenied:true};if(options.input)return {isConfirmed:true,value:'synthetic-pin'};return {};};await prepareEarlyTimeOut(cancelled.api,input,{service:cancelled.service});assert.equal(cancelled.forms[1].titleText,'Cancel schedule review request');assert.equal(cancels.length,1);assert.equal(cancels[0].pin,'synthetic-pin');assert.equal(cancelled.calls.length,0);
});

test('a fresh proven overnight finish after a pending review proceeds normally without sending or approving a request',async()=>{
 const f=fixture();let reads=0;f.service.inspect=async()=>++reads===1?{unknown:true,scheduleFingerprint:'unverified',request:{id:'early-existing',status:'Pending',scheduleFingerprint:'unverified'}}:{unknown:false,complete:true,early:false,scheduledEndAt:'2026-10-29T03:00:00+08:00'};f.api.Swal.fire=async options=>{f.forms.push(options);return {isConfirmed:true};};const result=await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(result.proceed,true);assert.equal(reads,2);assert.equal(f.forms.length,1);assert.equal(f.calls.length,0);
});

test('unknown explanations are bounded without calling the employee early or sending an invalid request',async()=>{
 const f=fixture();f.values.earlyTimeOutReason.value='x'.repeat(1501);await prepareEarlyTimeOut(f.api,input,{service:f.service});assert.equal(f.calls.length,0);assert.equal(f.forms.length,1);assert.match(f.forms[0].html,/maxlength="1500"/);assert.match(f.messages[0],/assigned shift or clock-out issue/);assert.doesNotMatch(f.messages[0],/finish early/);
});
