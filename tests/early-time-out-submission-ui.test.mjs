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
