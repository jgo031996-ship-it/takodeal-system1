import test from 'node:test';
import assert from 'node:assert/strict';
import {installManagerEarlyTimeOutUI,earlyTimeOutSummaryHTML} from '../takodeal-manager/early-time-out-review-ui.js';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService} from '../takodeal-manager/early-time-out-review.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Native dialog lifecycle and user events are exercised by the real UI module.
// Unit cases replace the protected service; integration cases use a synthetic
// in-memory backend. These tests never write live business records.
const unescape=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.listeners={};this.disabled=false;this.hidden=false;this.open=false;this._text='';this.value='';}
 append(...nodes){for(const node of nodes){node.remove?.();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 setAttribute(name,value){this.attributes[name]=String(value);if(['id','class'].includes(name))this[name==='class'?'className':name]=String(value);if(name==='disabled')this.disabled=true;if(name==='hidden')this.hidden=true;}
 getAttribute(name){return this.attributes[name]??null;}
 addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}
 emit(type){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const callback of this.listeners[type]||[])callback(event);return event;}
 showModal(){this.open=true;}
 close(){if(this.open){this.open=false;this.emit('close');}}
 matches(selector){if(selector[0]==='[')return Object.hasOwn(this.attributes,selector.slice(1,-1));if(selector[0]==='#')return this.id===selector.slice(1);return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const result=[];const walk=parent=>{for(const node of parent.children){if(node.matches(selector))result.push(node);walk(node);}};walk(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 set innerHTML(html){this.children=[];this._text='';const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1)._text+=unescape(token);continue;}const tag=/^<([\w-]+)/.exec(token)?.[1];if(!tag)continue;const node=new Element(tag,this.ownerDocument);for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(match[1],unescape(match[2]??''));stack.at(-1).append(node);if(!['input','br','img','hr','meta','link'].includes(tag))stack.push(node);}}
}
class Document{constructor(){this.body=new Element('body',this);}createElement(tag){return new Element(tag,this);}querySelector(selector){return this.body.querySelector(selector);}}
const hold=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const document=new Document(),row={type:'Early Time Out',status:'Pending',branch:'Sample Branch',staffId:'sample-staff',staffName:'Sample Crew',timeInLogId:'sample-time-in',timeInAt:'2026-10-19T09:30:00+08:00',requestVersion:2,requestToken:'sample-request-token',reason:'Please review the scheduled finish.',requiresScheduleReview:true,scheduledEndAt:null,...options.row};
 const calls={read:[],inspect:[],review:[],dismiss:[],confirmShift:[],messages:[],reload:0,operations:0};
 const api={auth:{currentUser:{uid:'sample-manager',email:'manager@example.test',emailVerified:true}},sessionUser:{uid:'sample-manager',email:'manager@example.test',role:'Manager',permissions:['inbox'],allowedBranches:['Sample Branch']},db:{},doc:(_db,...parts)=>parts.join('/'),getDocFromServer:async ref=>{calls.read.push(ref);return options.read?options.read(ref):{exists:()=>true,data:()=>structuredClone(row),metadata:{fromCache:false,hasPendingWrites:false}};},loadInbox:async()=>{calls.reload++;},Swal:{fire:async(...args)=>calls.messages.push(args)}};
 api.crypto={randomUUID:()=> 'sample-operation-'+(++calls.operations)};
 const service={includesVerifiedRequest:options.verifiedRequest===true,inspect:async input=>{calls.inspect.push(input);return options.inspect?options.inspect(input):{request:structuredClone(row),unknown:false,early:true,complete:false,closed:false,scheduledEndAt:'2026-10-19T18:00:00+08:00',minutesEarly:60,scheduleFingerprint:'verified-v1',scheduleChanged:false,emergencyShiftVersion:0,emergencyShiftRevisionId:null,emergencyShiftSourceFingerprint:'verified-source-v1',...options.state};},review:async input=>{calls.review.push(input);return options.save?options.save(input):{decision:input.decision};},dismiss:async input=>{calls.dismiss.push(input);return options.dismiss?options.dismiss(input):{decision:'Not Required'};},confirmShift:async input=>{calls.confirmShift.push(input);return options.confirmShift?options.confirmShift(input):{version:1,revisionId:'replacement-v1'};}};
 const ui=installManagerEarlyTimeOutUI(api,document,{service});
 return{api,document,row,calls,ui,open:async decision=>{await ui.review('sample-request',decision||'Approved');return document.querySelector('dialog');},dialog:()=>document.querySelector('dialog')};
}
const node=(dialog,key)=>dialog.querySelector('[data-'+key+']');
const replacement=(dialog,change={})=>{for(const [key,value]of Object.entries({date:'2026-10-19',start:'09:30',end:'18:00',name:'Replacement cashier',reason:'Emergency cover verified with the branch.',...change}))node(dialog,'shift-'+key).value=value;};
const unknownState={unknown:true,early:false,complete:false,closed:false,scheduledEndAt:null,scheduleFingerprint:'unknown-v1',scheduleChanged:false,emergencyShiftVersion:0,emergencyShiftRevisionId:null,emergencyShiftSourceFingerprint:'verified-source-v1'};
const shiftHead={version:1,revisionId:'replacement-v1',workDate:'2026-10-19',expectedStartAt:'2026-10-19T09:30:00+08:00',expectedEndAt:'2026-10-19T18:00:00+08:00',shiftName:'Replacement cashier',reviewedByEmail:'manager@example.test'};

for(const kind of ['attendance','schedule'])test(`unknown schedule has a direct ${kind} action for the exact saved workday without making any decision`,async()=>{
 const f=fixture({state:unknownState}),opened=[];f.api[kind==='attendance'?'openAttendanceRecovery':'openScheduleRecovery']=async context=>opened.push(context);const dialog=await f.open(),button=node(dialog,'open-'+kind);assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(node(dialog,'confirm').disabled,true);await button.onclick();assert.equal(dialog.open,false);assert.deepEqual(opened,[{attendanceLogId:'sample-time-in',staffId:'sample-staff',staffName:'Sample Crew',branch:'Sample Branch',workDate:'2026-10-19',requestId:'sample-request',requestVersion:2,requestToken:'sample-request-token'}]);assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss.length,0);assert.equal(f.calls.confirmShift.length,0);
});
test('the visible replacement action opens the protected form while keeping both scheduled times blank',async()=>{const f=fixture({state:unknownState,row:{reason:'9:30 AM to 6 PM was requested.'}}),dialog=await f.open();assert.equal(node(dialog,'open-replacement').hidden,false);await node(dialog,'open-replacement').onclick();assert.equal(node(dialog,'shift-panel').open,true);assert.equal(node(dialog,'shift-start').value,'');assert.equal(node(dialog,'shift-end').value,'');assert.equal(f.calls.confirmShift.length,0);assert.equal(f.calls.review.length,0);});
test('a fresh request can still open its linked attendance when the schedule inspection fails',async()=>{const f=fixture({inspect:async()=>{throw Error('Synthetic schedule query failure.');}}),opened=[];f.api.openAttendanceRecovery=async context=>opened.push(context);const dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'open-attendance').hidden,false);await node(dialog,'open-attendance').onclick();assert.equal(opened[0].attendanceLogId,'sample-time-in');assert.equal(f.calls.review.length,0);});
test('navigation cannot use an old account or a malformed attendance link',async()=>{for(const malformed of [false,true]){const f=fixture({state:unknownState,row:malformed?{timeInLogId:'../different-record'}:{}}),opened=[];f.api.openAttendanceRecovery=async context=>opened.push(context);const dialog=await f.open();if(!malformed)f.api.auth.currentUser.uid='another-account';await node(dialog,'open-attendance').onclick();assert.deepEqual(opened,[]);assert.equal(f.calls.review.length,0);assert.equal(f.calls.confirmShift.length,0);}});

test('replacement confirmation is visible only for an open fresh unknown or changed schedule, with times left blank',async()=>{
 for(const state of [unknownState,{scheduleChanged:true}]){const f=fixture({state,row:{reason:'Morning shift 9:30 to 6 PM.'}}),dialog=await f.open();assert.equal(node(dialog,'shift-panel').hidden,false);assert.equal(node(dialog,'shift-date').value,'2026-10-19');assert.equal(node(dialog,'shift-start').value,'');assert.equal(node(dialog,'shift-end').value,'');assert.equal(node(dialog,'shift-reason').value,'');assert.equal(node(dialog,'shift-confirm').disabled,true);assert.equal(f.calls.confirmShift.length,0);if(state.unknown)assert.match(node(dialog,'guidance').textContent,/open Confirm replacement shift/);}
 for(const state of [{},{unknown:true,closed:true}]){const f=fixture({state}),dialog=await f.open();assert.equal(node(dialog,'shift-panel').hidden,true);assert.equal(node(dialog,'shift-confirm').disabled,state.unknown===true);}
});
test('replacement bounds and a meaningful reason must be entered explicitly before the protected service is called',async()=>{
 const f=fixture({state:unknownState}),dialog=await f.open();await node(dialog,'shift-confirm').onclick();assert.match(node(dialog,'shift-status').textContent,/both the scheduled start and finish/);assert.equal(f.calls.confirmShift.length,0);
 for(const change of [{date:'2026-02-30'},{start:'09:30',end:'10:00'},{start:'09:30',end:'09:30'},{reason:'short'},{date:'2026-10-18'}]){replacement(dialog,change);await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,0);assert.equal(node(dialog,'shift-reason').value,change.reason||'Emergency cover verified with the branch.');assert.equal(node(dialog,'shift-status').getAttribute('role'),'alert');}
});
test('one action confirms replacement hours and finishes the completed request with one shared message',async()=>{
 let f;f=fixture({inspect:async()=>({request:structuredClone(f.row),...(f.calls.confirmShift.length?{...unknownState,unknown:false,complete:true,scheduledEndAt:shiftHead.expectedEndAt,scheduleChanged:true,emergencyShiftVersion:1,emergencyShiftRevisionId:'replacement-v1',emergencyShift:shiftHead}:unknownState)})});const dialog=await f.open();replacement(dialog);node(dialog,'reply').value='Preserve this review reply.';await node(dialog,'shift-confirm').onclick();
 assert.equal(f.calls.confirmShift.length,1);assert.deepEqual(f.calls.confirmShift[0],{requestId:'sample-request',expectedRequestVersion:2,expectedRequestToken:'sample-request-token',expectedScheduleFingerprint:'unknown-v1',expectedConfirmationVersion:0,expectedSourceFingerprint:'verified-source-v1',operationId:'sample-operation-1',workDate:'2026-10-19',startTime:'09:30',endTime:'18:00',shiftName:'Replacement cashier',reason:'Preserve this review reply.'});assert.equal(f.calls.inspect.length,2);assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.dismiss[0].reviewNote,'Preserve this review reply.');assert.equal(f.calls.reload,1);assert.equal(f.calls.messages.length,1);assert.equal(node(dialog,'reply').value,'Preserve this review reply.');assert.equal(dialog.open,false);assert.match(node(dialog,'details').textContent,/Confirmed replacement shift · version 1/);assert.equal(f.calls.messages.at(-1)[0],'Time-out review completed');assert.equal(node(dialog,'shift-reason'),node(dialog,'reply'));assert.equal(node(dialog,'shift-confirm'),node(dialog,'confirm'));
});
test('a confirmed replacement still before its finish requires staff to reopen Time Out before a new early decision',async()=>{
 let f;f=fixture({inspect:async()=>({request:structuredClone(f.row),...(f.calls.confirmShift.length?{...unknownState,unknown:false,early:true,complete:false,scheduledEndAt:shiftHead.expectedEndAt,scheduleChanged:true,emergencyShiftVersion:1,emergencyShiftRevisionId:'replacement-v1',emergencyShift:shiftHead}:unknownState)})});const dialog=await f.open();replacement(dialog);await node(dialog,'shift-confirm').onclick();assert.match(node(dialog,'guidance').textContent,/refresh and reopen Time Out/);assert.match(node(dialog,'guidance').textContent,/review that new request separately/);assert.equal(node(dialog,'confirm').disabled,true);await node(dialog,'confirm').onclick();assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss.length,0);assert.equal(node(dialog,'shift-panel').hidden,false);
});
test('replacement confirmation blocks duplicate taps and retries a lost acknowledgement with the exact same operation',async()=>{
 const gate=hold();let attempt=0;const f=fixture({state:unknownState,confirmShift:()=>++attempt===1?gate.promise:Promise.resolve({alreadySaved:true,version:1,revisionId:'replacement-v1'})}),dialog=await f.open();replacement(dialog);node(dialog,'reply').value='Management reply stays.';const saving=node(dialog,'shift-confirm').onclick();await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'shift-reason').disabled,true);assert.equal(dialog.emit('cancel').defaultPrevented,true);gate.reject(Error('Acknowledgement lost after commit.'));await saving;assert.equal(dialog.open,true);assert.equal(node(dialog,'shift-confirm').disabled,false);assert.equal(node(dialog,'shift-reason').value,'Management reply stays.');assert.equal(node(dialog,'reply').value,'Management reply stays.');await node(dialog,'shift-confirm').onclick();assert.deepEqual(f.calls.confirmShift[1],f.calls.confirmShift[0]);assert.equal(f.calls.operations,1);
});
test('changed replacement details after a failed save receive a new operation reference',async()=>{
 const f=fixture({state:unknownState,confirmShift:async()=>{throw Error('Synthetic unavailable HQ');}}),dialog=await f.open();replacement(dialog);await node(dialog,'shift-confirm').onclick();node(dialog,'shift-reason').value='Revised verified explanation for replacement.';await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,2);assert.notEqual(f.calls.confirmShift[0].operationId,f.calls.confirmShift[1].operationId);assert.equal(f.calls.confirmShift[1].reason,'Revised verified explanation for replacement.');
});
test('post-confirmation schedule read failure preserves fields and reports that the replacement was saved',async()=>{
 let f;f=fixture({inspect:async()=>{if(f.calls.confirmShift.length)throw Error('Synthetic follow-up read failed.');return{request:structuredClone(f.row),...unknownState};}});const dialog=await f.open();replacement(dialog);node(dialog,'reply').value='Keep this reply.';await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(dialog.open,true);assert.match(node(dialog,'status').textContent,/replacement shift is saved/);assert.equal(node(dialog,'retry').hidden,false);assert.equal(node(dialog,'shift-reason').value,'Keep this reply.');assert.equal(node(dialog,'reply').value,'Keep this reply.');assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Retry finish review');assert.equal(f.calls.messages.length,0);
});
test('late replacement saves cannot update a different account or replacement dialog',async()=>{
 for(const change of [f=>{f.api.auth.currentUser.uid='another-account';},f=>{f.api.sessionUser.allowedBranches=[];},f=>{f.api.auth.currentUser.emailVerified=false;}]){const gate=hold(),f=fixture({state:unknownState,confirmShift:()=>gate.promise}),dialog=await f.open();replacement(dialog);const saving=node(dialog,'shift-confirm').onclick();change(f);gate.resolve({version:1,revisionId:'replacement-v1'});await saving;assert.equal(f.calls.inspect.length,1);assert.doesNotMatch(node(dialog,'status').textContent,/Replacement shift saved/);assert.equal(f.calls.messages.length,0);assert.equal(node(dialog,'confirm').disabled,true);}
});
test('missing source/version evidence cannot confirm a replacement and a closed shift never offers editing',async()=>{
 for(const missing of [{emergencyShiftVersion:undefined},{emergencyShiftSourceFingerprint:''},{scheduleFingerprint:''}]){const f=fixture({state:{...unknownState,...missing}}),dialog=await f.open();replacement(dialog);await node(dialog,'shift-confirm').onclick();assert.equal(node(dialog,'shift-confirm').disabled,true);assert.equal(f.calls.confirmShift.length,0);}
});
test('overnight replacement hours use the selected Philippine work date without moving the original Time In',async()=>{
 const f=fixture({row:{timeInAt:'2026-10-19T19:25:00+08:00'},state:unknownState}),dialog=await f.open();replacement(dialog,{start:'19:30',end:'04:00'});await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.confirmShift[0].workDate,'2026-10-19');assert.equal(f.calls.confirmShift[0].endTime,'04:00');assert.equal(f.row.timeInAt,'2026-10-19T19:25:00+08:00');
});
test('replacement preview shows October 22 5:30 PM through October 23 2:30 AM before saving nine hours',async()=>{
 const f=fixture({row:{timeInAt:'2026-10-22T17:30:00+08:00'},state:unknownState}),dialog=await f.open();replacement(dialog,{date:'2026-10-22',start:'17:30',end:'02:30'});node(dialog,'shift-end').emit('input');
 const preview=node(dialog,'shift-preview'),formatted=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)';
 assert.ok(preview.textContent.includes(formatted('2026-10-22T17:30:00+08:00')));assert.ok(preview.textContent.includes(formatted('2026-10-23T02:30:00+08:00')));assert.match(preview.textContent,/next day.*9 hours/);assert.equal(preview.getAttribute('role'),'status');assert.equal(f.calls.confirmShift.length,0);
 await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.confirmShift[0].startTime,'17:30');assert.equal(f.calls.confirmShift[0].endTime,'02:30');assert.equal(f.calls.confirmShift[0].workDate,'2026-10-22');
});
test('AM-to-next-AM 21-hour preview warns and the protected confirmation is never submitted',async()=>{
 const f=fixture({row:{timeInAt:'2026-10-22T05:30:00+08:00'},state:unknownState}),dialog=await f.open();replacement(dialog,{date:'2026-10-22',start:'05:30',end:'02:30'});node(dialog,'shift-start').emit('change');assert.match(node(dialog,'shift-preview').textContent,/21 hours.*Outside the allowed 1–18 hours/);assert.equal(node(dialog,'shift-preview').getAttribute('role'),'alert');await node(dialog,'shift-confirm').onclick();assert.equal(f.calls.confirmShift.length,0);assert.match(node(dialog,'shift-status').textContent,/no more than 18 hours/);
});

test('confirmed decisions show success immediately while their single saved row refresh is pending',async()=>{
 const gate=hold(),f=fixture(),ids=[];f.api.applyConfirmedInboxRequest=id=>{ids.push(id);return gate.promise;};const dialog=await f.open();await node(dialog,'confirm').onclick();
 assert.equal(dialog.open,false);assert.equal(f.calls.review.length,1);assert.deepEqual(ids,['sample-request']);assert.equal(f.calls.reload,0);assert.equal(f.calls.messages.at(-1)[2],'success');gate.resolve();await tick();
});
test('a row refresh failure after confirmed dismissal cannot report a failed decision or retry it',async()=>{
 const gate=hold(),f=fixture({state:{early:false,complete:true}}),notices=[];f.api.applyConfirmedInboxRequest=()=>gate.promise;f.api.ManagerUI={notify:message=>notices.push(message)};const dialog=await f.open();await node(dialog,'confirm').onclick();gate.reject(Error('Synthetic connection loss'));await tick();
 assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.messages.at(-1)[2],'success');assert.equal(dialog.open,false);assert.match(notices[0],/decision is saved/);assert.equal(f.calls.reload,0);
});
test('a previous account receives no row refresh failure message after sign-out',async()=>{
 const gate=hold(),f=fixture(),notices=[];f.api.applyConfirmedInboxRequest=()=>gate.promise;f.api.ManagerUI={notify:message=>notices.push(message)};const dialog=await f.open();await node(dialog,'confirm').onclick();f.api.auth.currentUser.uid='new-account';gate.reject(Error('Synthetic late failure'));await tick();assert.deepEqual(notices,[]);assert.equal(f.calls.review.length,1);
});

test('unverified Inbox summaries use schedule review wording and escape staff-provided text',()=>{
 const html=earlyTimeOutSummaryHTML({requiresScheduleReview:true,reason:'<script>bad()</script>',managerReply:'<img onerror=bad()>',scheduledEndAt:null});
 assert.match(html,/Time-out schedule review/);assert.doesNotMatch(html,/Early time-out approval|<script>|<img|1970/);assert.match(html,/&lt;script&gt;/);assert.match(html,/not a recorded Time Out/);
});

test('a verified early shift displays fresh finish and saves the exact reviewed token and manual reply',async()=>{
 const f=fixture(),dialog=await f.open();assert.equal(f.calls.inspect.length,1);assert.deepEqual(f.calls.inspect[0],{requestId:'sample-request',expectedRequestVersion:2,expectedRequestToken:'sample-request-token'});
 assert.match(node(dialog,'details').textContent,/Verified scheduled finish:/);assert.doesNotMatch(node(dialog,'details').textContent,/Needs schedule review/);assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'dismiss').hidden,true);
 node(dialog,'reply').value='  Please finish the handover.  ';await node(dialog,'confirm').onclick();assert.deepEqual(f.calls.review,[{requestId:'sample-request',decision:'Approved',reviewNote:'Please finish the handover.',expectedRequestVersion:2,expectedRequestToken:'sample-request-token',expectedScheduleFingerprint:'verified-v1'}]);assert.equal(f.calls.dismiss.length,0);assert.equal(f.calls.reload,1);assert.equal(dialog.open,false);
});

test('9:30 AM to 6 PM after the scheduled finish has an enabled primary review confirmation that only closes the request',async()=>{
 const f=fixture({state:{early:false,complete:true,minutesEarly:0}}),dialog=await f.open();
 assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(dialog.querySelector('#earlyReviewTitle').textContent,'Confirm time-out review');assert.match(node(dialog,'status').textContent,/finish has already passed/);assert.doesNotMatch(node(dialog,'status').textContent,/schedule changed|cannot be verified/i);assert.match(node(dialog,'guidance').textContent,/tap normal Time Out/);assert.match(node(dialog,'guidance').textContent,/not a recorded Time Out/);assert.equal(node(dialog,'dismiss').hidden,true);assert.equal(f.calls.dismiss.length,0);
 node(dialog,'reply').value='Scheduled finish was 6 PM.';await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss[0].expectedRequestToken,'sample-request-token');assert.equal(f.calls.dismiss[0].expectedScheduleFingerprint,'verified-v1');assert.equal(f.calls.dismiss[0].reviewNote,'Scheduled finish was 6 PM.');assert.equal(f.calls.messages.at(-1)[0],'Time-out review completed');assert.match(f.calls.messages.at(-1)[1],/Attendance, actual worked hours and payroll were not changed/);
});

test('already closed attendance is distinguished from an open shift and never asks staff to clock out again',async()=>{
 const f=fixture({state:{early:false,complete:false,closed:true}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'status').textContent,/already has a recorded Time Out/);assert.doesNotMatch(node(dialog,'guidance').textContent,/tap normal Time Out/);await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.review.length,0);
});

test('a completed shift with a changed or previously unknown request reference needs no early approval',async()=>{
 const f=fixture({state:{early:false,complete:true,scheduleChanged:true,minutesEarly:0}}),dialog=await f.open();
 assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'status').textContent,/No early time-out approval is needed/);assert.doesNotMatch(node(dialog,'status').textContent,/differs|cannot authorize|cannot be verified/);assert.equal(node(dialog,'status').getAttribute('role'),'status');assert.match(node(dialog,'guidance').textContent,/tap normal Time Out/);await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.review.length,0);
});

test('conservative completion evidence labels the latest matching finish without inventing an assigned shift',async()=>{
 const f=fixture({state:{early:false,complete:true,scheduleChanged:true,clockOutCompleteOnly:true}}),dialog=await f.open();
 assert.match(node(dialog,'details').textContent,/Latest matching shift finish:/);assert.doesNotMatch(node(dialog,'details').textContent,/Verified scheduled finish:/);assert.match(node(dialog,'status').textContent,/All matching saved shifts have finished\. No early time-out approval is needed\./);assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'guidance').textContent,/not a recorded Time Out/);
});

test('unknown reference does not accuse staff of early departure or claim the schedule changed; rejection remains available',async()=>{
 const f=fixture({state:{early:false,unknown:true,scheduledEndAt:null}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'status').textContent,/does not establish that the staff member left early/);assert.doesNotMatch(node(dialog,'status').textContent,/schedule changed|differs from/i);assert.match(node(dialog,'details').textContent,/Needs schedule review/);
 const rejected=await f.open('Rejected');assert.equal(node(rejected,'confirm').disabled,false);node(rejected,'reply').value='Please check the saved assignment.';await node(rejected,'confirm').onclick();assert.equal(f.calls.review[0].decision,'Rejected');assert.equal(f.calls.dismiss.length,0);
});

test('confirmed schedule changes expose current finish and original finish separately and block old approval',async()=>{
 const f=fixture({row:{requiresScheduleReview:false,scheduledEndAt:'2026-10-19T17:00:00+08:00'},state:{scheduleChanged:true}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.match(node(dialog,'status').textContent,/verified saved schedule differs/);assert.match(node(dialog,'details').textContent,/Verified scheduled finish:/);assert.match(node(dialog,'details').textContent,/request originally listed:/);assert.equal(node(dialog,'dismiss').hidden,true);
 const rejected=await f.open('Rejected');assert.equal(node(rejected,'confirm').disabled,false);await node(rejected,'confirm').onclick();assert.equal(f.calls.review[0].decision,'Rejected');
});

test('schedule inspection is read-only and a pending inspection cannot approve or dismiss',async()=>{
 const gate=hold(),f=fixture({inspect:()=>gate.promise}),opening=f.open();await tick();const dialog=f.dialog();assert.equal(node(dialog,'confirm').disabled,true);await node(dialog,'confirm').onclick();await node(dialog,'dismiss').onclick();assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss.length,0);gate.resolve({request:f.row,unknown:false,early:true,complete:false,closed:false,scheduledEndAt:'2026-10-19T18:00:00+08:00'});await opening;assert.equal(node(dialog,'confirm').disabled,false);
});

test('a different request revision, token or branch returned during inspection cannot enable a decision',async()=>{
 for(const change of [{requestVersion:3},{requestToken:'replacement'},{branch:'Other Branch'},{staffId:'another-staff'},{status:'Approved'}]){const f=fixture({inspect:async()=>({request:{...f.row,...change},early:true,scheduledEndAt:'2026-10-19T18:00:00+08:00'})}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);await node(dialog,'confirm').onclick();assert.equal(f.calls.review.length,0);assert.match(node(dialog,'status').textContent,/saved request changed/);}
});

test('account or branch access changes while inspection is pending prevent stale actions',async()=>{
 for(const change of [f=>{f.api.auth.currentUser.uid='another-user';},f=>{f.api.sessionUser.allowedBranches=[];},f=>{f.api.sessionUser.role='Staff';}]){const gate=hold(),f=fixture({inspect:()=>gate.promise}),opening=f.open();await tick();const dialog=f.dialog();change(f);gate.resolve({request:f.row,early:true,scheduledEndAt:'2026-10-19T18:00:00+08:00'});await opening;await node(dialog,'confirm').onclick();assert.equal(f.calls.review.length,0);assert.equal(f.calls.dismiss.length,0);assert.equal(node(dialog,'confirm').disabled,true);}
});

test('failed saves preserve the reply and retry the same request; pending taps cannot duplicate a decision',async()=>{
 const gate=hold();let attempts=0;const f=fixture({save:()=>{attempts++;return attempts===1?gate.promise:Promise.resolve({alreadySaved:true});}}),dialog=await f.open();node(dialog,'reply').value='Approved for handover.';const pending=node(dialog,'confirm').onclick();await node(dialog,'confirm').onclick();assert.equal(f.calls.review.length,1);assert.equal(node(dialog,'close').disabled,true);assert.equal(dialog.emit('cancel').defaultPrevented,true);gate.reject(Error('Acknowledgement lost; retry this review.'));await pending;assert.equal(dialog.open,true);assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'reply').value,'Approved for handover.');await node(dialog,'confirm').onclick();assert.deepEqual(f.calls.review[0],f.calls.review[1]);assert.match(f.calls.messages.at(-1)[1],/already saved/);
});

test('a failed fresh schedule read is retryable and retains a typed management reply',async()=>{
 let attempts=0;const f=fixture({inspect:async()=>{if(++attempts===1)throw Error('Synthetic offline HQ');return{request:f.row,early:true,scheduledEndAt:'2026-10-19T18:00:00+08:00'};}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'retry').hidden,false);node(dialog,'reply').value='My note remains.';await node(dialog,'retry').onclick();assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'reply').value,'My note remains.');assert.equal(f.calls.read.length,2);assert.equal(f.calls.review.length,0);
});

test('the complete inspection deadline releases the dialog and late service results or request callbacks cannot enable a decision',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gate=hold();let input;const f=fixture({verifiedRequest:true,inspect:value=>{input=value;return gate.promise;}}),opening=f.open();await tick();assert.equal(f.calls.read.length,0);assert.equal(f.calls.inspect.length,1);t.mock.timers.tick(25001);const dialog=await opening,status=node(dialog,'status').textContent;assert.match(status,/retry the schedule check/);assert.equal(node(dialog,'retry').hidden,false);assert.equal(node(dialog,'confirm').disabled,true);input.onVerifiedRequest(f.row);gate.resolve({request:f.row,unknown:false,early:true,complete:false,closed:false,scheduledEndAt:'2026-10-19T18:00:00+08:00',scheduleFingerprint:'late-result'});await tick();assert.equal(node(dialog,'status').textContent,status);assert.equal(node(dialog,'confirm').disabled,true);assert.equal(f.calls.review.length,0);
});

test('a replacement dialog cannot be changed by an older pending inspection',async()=>{
 const gate=hold();let count=0;const f=fixture({inspect:async()=>++count===1?gate.promise:{request:f.row,early:false,complete:true,scheduledEndAt:'2026-10-19T18:00:00+08:00'}}),first=f.open();await tick();const original=f.dialog(),second=await f.open();assert.equal(original.open,false);gate.resolve({request:f.row,early:true,scheduledEndAt:'2026-10-19T18:00:00+08:00'});await first;assert.equal(f.dialog(),second);assert.equal(node(second,'confirm').disabled,false);assert.equal(node(second,'confirm').textContent,'Confirm review');assert.match(node(second,'status').textContent,/finish has already passed/);assert.equal(f.calls.review.length,0);
});

test('unverified server snapshots and foreign branch requests never reach protected inspection',async()=>{
 for(const options of [{read:async()=>({exists:()=>true,data:()=>({}),metadata:{fromCache:true}})},{row:{branch:'Other Branch'}}]){const f=fixture(options),dialog=await f.open();assert.equal(f.calls.inspect.length,0);assert.equal(node(dialog,'confirm').disabled,true);assert.equal(f.calls.review.length,0);}
});

test('missing verified finish fails closed even when an inspection claims early eligibility',async()=>{
 const f=fixture({state:{early:true,scheduledEndAt:null}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'status').textContent,/could not be verified/);
});

test('completed overnight October 20 4 AM finish has one usable review action and sends no early approval',async()=>{
 const f=fixture({row:{requiresScheduleReview:false,scheduledEndAt:'2026-10-20T04:00:00+08:00'},state:{early:false,complete:true,scheduledEndAt:'2026-10-20T04:00:00+08:00',minutesEarly:0}}),dialog=await f.open();
 assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'dismiss').hidden,true);assert.match(node(dialog,'details').textContent,/Oct 20, 2026/);assert.match(node(dialog,'details').textContent,/4:00 AM/);
 node(dialog,'reply').value='  Reviewed the overnight finish.  ';await node(dialog,'confirm').onclick();
 assert.equal(f.calls.review.length,0);assert.deepEqual(f.calls.dismiss,[{requestId:'sample-request',reviewNote:'Reviewed the overnight finish.',expectedRequestVersion:2,expectedRequestToken:'sample-request-token',expectedScheduleFingerprint:'verified-v1'}]);assert.equal(dialog.open,false);
});

test('opening a completed open shift as a rejection preserves the selected rejection intent',async()=>{
 const f=fixture({state:{early:false,complete:true}}),dialog=await f.open('Rejected');assert.equal(node(dialog,'confirm').textContent,'Reject request');assert.equal(node(dialog,'confirm').disabled,false);
 node(dialog,'reply').value='Reject this duplicate request.';await node(dialog,'confirm').onclick();assert.equal(f.calls.review.length,1);assert.equal(f.calls.review[0].decision,'Rejected');assert.equal(f.calls.dismiss.length,0);
});

test('unverified completed or closed results cannot enable the primary review confirmation',async()=>{
 for(const state of [{complete:true,closed:false},{complete:false,closed:true}]){
  const f=fixture({state:{...state,early:false,unknown:true}}),dialog=await f.open();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'dismiss').hidden,true);await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,0);assert.equal(f.calls.review.length,0);
 }
});

test('review confirmation keeps its note and action across a failed save and pending taps cannot duplicate it',async()=>{
 const gate=hold();let attempts=0;const f=fixture({state:{early:false,complete:true},dismiss:()=>++attempts===1?gate.promise:Promise.resolve({alreadySaved:true,decision:'Not Required'})}),dialog=await f.open();
 node(dialog,'reply').value='Verified the saved finish.';const pending=node(dialog,'confirm').onclick();await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.review.length,0);assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'close').disabled,true);assert.equal(dialog.emit('cancel').defaultPrevented,true);
 gate.reject(Error('Synthetic protected save failure'));await pending;assert.equal(dialog.open,true);assert.equal(node(dialog,'confirm').disabled,false);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'reply').value,'Verified the saved finish.');assert.equal(f.calls.messages.length,0);
 await node(dialog,'confirm').onclick();assert.deepEqual(f.calls.dismiss[0],f.calls.dismiss[1]);assert.equal(f.calls.review.length,0);assert.match(f.calls.messages.at(-1)[1],/already saved/);assert.equal(f.calls.messages.at(-1)[0],'Time-out review completed');
});

test('a new schedule inspection replaces completed mode and cannot reuse the old confirmation after a schedule change',async()=>{
 let inspection=0;const f=fixture({inspect:async()=>({request:f.row,unknown:false,early:++inspection>1,complete:inspection===1,closed:false,scheduledEndAt:inspection===1?'2026-10-20T04:00:00+08:00':'2026-10-20T07:00:00+08:00',scheduleChanged:inspection>1,scheduleFingerprint:'verified-'+inspection}),dismiss:async()=>{throw Error('The verified finishing time changed. Reopen the review.');}}),dialog=await f.open();
 assert.equal(node(dialog,'confirm').textContent,'Confirm review');await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(node(dialog,'retry').hidden,false);node(dialog,'reply').value='Please check the revised finish.';
 await node(dialog,'retry').onclick();assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'confirm').textContent,'Approve early time-out');assert.equal(node(dialog,'dismiss').hidden,true);assert.equal(node(dialog,'reply').value,'Please check the revised finish.');await node(dialog,'confirm').onclick();assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.review.length,0);
});

// End-to-end UI/service cases use the actual protected transaction service and
// an in-memory SDK harness. They never connect to a live Firebase project.
async function protectedFixture(){
 const h=firestoreHarness(),document=new Document(),branch='Sample Branch',staffId='sample-staff',name='Sample Crew',email='manager@example.test',messages=[];let clock=new Date('2026-10-19T23:00:00+08:00'),reloads=0;
 h.api.auth={currentUser:{uid:'sample-manager',email,emailVerified:true}};h.api.sessionUser={uid:'sample-manager',email,role:'Manager',permissions:['inbox'],allowedBranches:[branch]};h.api.serverTimestamp=()=>new Date(clock);
 const serverQuery=h.api.getDocsFromServer;h.api.getDocsFromServer=async query=>{const snapshot=await serverQuery(query);return {...snapshot,metadata:{fromCache:false,hasPendingWrites:false},docs:snapshot.docs.map(row=>({...row,metadata:{fromCache:false,hasPendingWrites:false}}))};};
 h.api.getDocFromServer=async reference=>({exists:()=>h.get(reference.path)!==undefined,data:()=>structuredClone(h.get(reference.path)),metadata:{fromCache:false,hasPendingWrites:false}});
 h.api.loadInbox=async()=>{reloads++;};h.api.Swal={fire:async(...args)=>messages.push(args)};
 h.put('hq_managers/sample-manager',{email,role:'Manager',permissions:['inbox'],assignedBranch:branch,pin:'4829',active:true});h.put('hq_email_access/'+email,{active:true,permissions:['inbox'],allowedBranches:[branch]});h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true});h.put('payroll_records/saved',{status:'Paid',frozenData:{paidHours:80,netPay:4500}});
 const begin=new Date('2026-10-19T19:30:00+08:00'),end=new Date('2026-10-20T04:00:00+08:00'),start={id:'sample-time-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:begin,scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,clockInAt:begin.toISOString(),expectedStartAt:begin.toISOString(),expectedEndAt:end.toISOString(),shiftId:'night-slot',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'sample-revision'}};
 h.put('attendance_logs/'+start.id,start);
 const staff=createEarlyTimeOutService(h.api,{now:()=>new Date(clock),makeToken:()=> 'sample-request-token'}),request=await staff.request({staffId,staffName:name,start,reason:'Please review the overnight finish.',pin:'7281'});
 clock=new Date('2026-10-20T05:00:00+08:00');
 const service=createEarlyTimeOutReviewService(h.api,{now:()=>new Date(clock)}),ui=installManagerEarlyTimeOutUI(h.api,document,{service});
 return {h,start,request,messages,document,ui,service,email,get reloads(){return reloads;},open:async()=>{await ui.review(request.id,'Approved');return document.querySelector('dialog');}};
}

test('the real protected confirmation closes only the request as Not Required, preserving attendance and saved payroll',async()=>{
 const f=await protectedFixture(),before=structuredClone([...f.h.docs]),dialog=await f.open();assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'confirm').disabled,false);node(dialog,'reply').value='Reviewed after the 4 AM finish.';
 await node(dialog,'confirm').onclick();const request=f.h.get('staff_requests/'+f.request.id);assert.equal(request.status,'Not Required');assert.equal(request.managerReply,'Reviewed after the 4 AM finish.');assert.equal(request.timeOutReview.verifiedFinishAt,new Date('2026-10-20T04:00:00+08:00').toISOString());assert.equal(request.timeOutReview.existingTimeOutLogId,null);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
 for(const [path,value]of before)if(path!=='staff_requests/'+f.request.id)assert.deepEqual(f.h.get(path),value,path);assert.equal(dialog.open,false);assert.equal(f.reloads,1);assert.equal(f.messages.at(-1)[0],'Time-out review completed');
});

test('the actual production preview reads the request once and opens completed review without an SDK transaction',async()=>{
 const f=await protectedFixture(),get=f.h.api.getDocFromServer,run=f.h.api.runTransaction,before=structuredClone([...f.h.docs]);let requests=0,transactions=0;f.h.api.getDocFromServer=ref=>{if(ref.path==='staff_requests/'+f.request.id)requests++;return get(ref);};f.h.api.runTransaction=(...args)=>{transactions++;return run(...args);};const dialog=await f.open();assert.equal(requests,1);assert.equal(transactions,0);assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'confirm').disabled,false);assert.deepEqual([...f.h.docs],before);
});

test('a protected grant revoked after preview leaves the request and attendance unchanged',async()=>{
 const f=await protectedFixture(),dialog=await f.open();f.h.put('hq_email_access/'+f.email,{active:false,permissions:['inbox'],allowedBranches:['Sample Branch']});const before=structuredClone([...f.h.docs]);node(dialog,'reply').value='Review note stays on failure.';await node(dialog,'confirm').onclick();assert.equal(dialog.open,true);assert.match(node(dialog,'status').textContent,/not granted/);assert.equal(node(dialog,'reply').value,'Review note stays on failure.');assert.deepEqual([...f.h.docs],before);assert.equal(f.messages.length,0);
});

test('a new finish after preview blocks protected completion and a fresh inspection cannot approve the stale request',async()=>{
 const f=await protectedFixture(),dialog=await f.open(),start=structuredClone(f.start);start.scheduleSnapshot.expectedEndAt='2026-10-20T07:00:00+08:00';f.h.put('attendance_logs/'+start.id,start);const before=structuredClone([...f.h.docs]);await node(dialog,'confirm').onclick();assert.equal(dialog.open,true);assert.match(node(dialog,'status').textContent,/finishing time changed/);assert.deepEqual([...f.h.docs],before);assert.equal(f.messages.length,0);
 await node(dialog,'retry').onclick();assert.equal(node(dialog,'confirm').textContent,'Save hours & finish review');assert.equal(node(dialog,'confirm').disabled,true);assert.equal(node(dialog,'dismiss').hidden,true);await node(dialog,'confirm').onclick();assert.deepEqual([...f.h.docs],before);
});

test('a protected confirmation with a lost acknowledgement retries without creating approval or changing attendance',async()=>{
 const f=await protectedFixture(),dialog=await f.open(),before=structuredClone([...f.h.docs]);f.h.loseNextAck();await node(dialog,'confirm').onclick();assert.equal(dialog.open,true);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Not Required');assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(f.messages.length,0);
 const confirmed=structuredClone([...f.h.docs]);await node(dialog,'confirm').onclick();assert.equal(dialog.open,false);assert.deepEqual([...f.h.docs],confirmed);assert.match(f.messages.at(-1)[1],/already saved/);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);
 for(const [path,value]of before)if(path!=='staff_requests/'+f.request.id)assert.deepEqual(f.h.get(path),value,path);
});

async function emergencyProtectedFixture(){
 const f=await protectedFixture(),start=structuredClone(f.h.get('attendance_logs/'+f.start.id));start.scheduleSnapshot.wasScheduled=false;start.scheduleSnapshot.needsScheduleReview=true;f.h.put('attendance_logs/'+start.id,start);return{...f,unknownStart:start};
}
test('the real protected combined action saves confirmed hours and closes the completed review without touching punches or payroll',async()=>{
 const f=await emergencyProtectedFixture(),before=structuredClone([...f.h.docs]),dialog=await f.open();assert.equal(node(dialog,'shift-panel').hidden,false);assert.equal(node(dialog,'confirm').disabled,true);replacement(dialog,{date:'2026-10-19',start:'19:30',end:'04:00'});node(dialog,'reply').value='Confirmed the emergency covering hours.';await node(dialog,'shift-confirm').onclick();
 const head=f.h.get('attendance_shift_confirmations/'+f.start.id);assert.equal(head.version,1);assert.equal(head.reviewedByEmail,f.email);assert.equal(head.expectedStartAt.toISOString(),'2026-10-19T11:30:00.000Z');assert.equal(head.expectedEndAt.toISOString(),'2026-10-19T20:00:00.000Z');assert.equal(f.h.get('attendance_shift_confirmation_events/'+head.revisionId).reason,'Confirmed the emergency covering hours.');assert.equal(node(dialog,'shift-reason'),node(dialog,'reply'));assert.equal(node(dialog,'reply').value,'Confirmed the emergency covering hours.');assert.equal(dialog.open,false);assert.equal(f.messages.length,1);
 for(const [path,value]of before)if(path!=='staff_requests/'+f.request.id)assert.deepEqual(f.h.get(path),value,path);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
 assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Not Required');assert.equal(f.h.get('staff_requests/'+f.request.id).managerReply,'Confirmed the emergency covering hours.');assert.equal(dialog.open,false);assert.equal(f.messages.at(-1)[0],'Time-out review completed');assert.deepEqual(f.h.get('payroll_records/saved'),before.find(([path])=>path==='payroll_records/saved')[1]);
});
test('real emergency confirmation never approves the old early request; staff must renew it before management approval',async()=>{
 const f=await emergencyProtectedFixture(),dialog=await f.open();replacement(dialog,{date:'2026-10-19',start:'19:30',end:'06:00'});await node(dialog,'shift-confirm').onclick();assert.equal(node(dialog,'confirm').disabled,true);assert.match(node(dialog,'guidance').textContent,/reopen Time Out/);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);const oldRequest=structuredClone(f.h.get('staff_requests/'+f.request.id));assert.equal(oldRequest.requestVersion,1);assert.equal(oldRequest.status,'Pending');await node(dialog,'confirm').onclick();assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.equal(node(dialog,'shift-reason').value,'Emergency cover verified with the branch.');assert.equal(node(dialog,'shift-title').textContent,'Update confirmed shift');assert.equal(node(dialog,'shift-panel').open,false);await node(dialog,'shift-confirm').onclick();assert.equal(f.h.get('attendance_shift_confirmations/'+f.start.id).version,1);assert.equal(node(dialog,'confirm').textContent,'Review pending');
 const staff=createEarlyTimeOutService(f.h.api,{now:()=>new Date('2026-10-20T05:00:00+08:00'),makeToken:()=> 'renewed-request-token'});await staff.request({staffId:f.start.staffId,staffName:f.start.staffName,start:f.unknownStart,reason:'Please approve leaving before the confirmed six AM finish.',pin:'7281'});assert.equal(f.h.get('staff_requests/'+f.request.id).requestVersion,2);await f.ui.review(f.request.id,'Approved');const renewed=f.document.querySelector('dialog');assert.equal(node(renewed,'confirm').disabled,false);assert.equal(node(renewed,'shift-panel').hidden,false);assert.equal(node(renewed,'shift-panel').open,false);await node(renewed,'confirm').onclick();assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id).requestVersion,2);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Approved');assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
});
test('real replacement confirmation retries a lost acknowledgement once and then finishes the same review',async()=>{
 const f=await emergencyProtectedFixture(),dialog=await f.open();replacement(dialog,{date:'2026-10-19',start:'19:30',end:'04:00'});f.h.loseNextAck();await node(dialog,'shift-confirm').onclick();assert.equal(dialog.open,true);assert.equal(node(dialog,'shift-confirm').disabled,false);assert.match(node(dialog,'shift-status').textContent,/could not be confirmed/);const confirmed=structuredClone([...f.h.docs]);assert.equal(f.h.get('attendance_shift_confirmations/'+f.start.id).version,1);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Pending');await node(dialog,'shift-confirm').onclick();for(const [path,value]of confirmed)if(path!=='staff_requests/'+f.request.id)assert.deepEqual(f.h.get(path),value,path);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Not Required');assert.equal(dialog.open,false);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_shift_confirmation_events/')).length,1);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);
});
test('revoked protected access or a changed source punch prevents the real replacement save and preserves the entered hours',async()=>{
 for(const change of [f=>f.h.put('hq_email_access/'+f.email,{active:false,permissions:['inbox'],allowedBranches:['Sample Branch']}),f=>{const changed=structuredClone(f.unknownStart);changed.scheduleSnapshot.expectedEndAt='2026-10-20T08:00:00+08:00';f.h.put('attendance_logs/'+f.start.id,changed);}]){
  const f=await emergencyProtectedFixture(),dialog=await f.open();replacement(dialog,{date:'2026-10-19',start:'19:30',end:'04:00'});change(f);const before=structuredClone([...f.h.docs]);await node(dialog,'shift-confirm').onclick();assert.deepEqual([...f.h.docs],before);assert.equal(node(dialog,'shift-start').value,'19:30');assert.equal(node(dialog,'shift-end').value,'04:00');assert.equal(node(dialog,'shift-reason').value,'Emergency cover verified with the branch.');assert.equal(node(dialog,'shift-confirm').disabled,false);assert.equal(f.messages.length,0);assert.equal(dialog.open,true);
 }
});

test('message choices are explicit, editable and match the selected decision without choosing hours',async()=>{
 const f=fixture({state:unknownState}),dialog=await f.open(),select=node(dialog,'message-template'),reply=node(dialog,'reply');
 assert.equal(reply,node(dialog,'shift-reason'));assert.equal(reply.value,'');assert.equal(select.querySelectorAll('option').length,4);assert.equal(select.querySelectorAll('option').some(option=>option.value==='decline'),false);
 select.value='schedule-corrected';select.emit('change');assert.match(reply.value,/confirmed the assigned shift/);assert.equal(node(dialog,'shift-start').value,'');assert.equal(node(dialog,'shift-end').value,'');assert.equal(f.calls.confirmShift.length,0);assert.equal(f.calls.review.length,0);
 reply.value='We verified this emergency cover with the branch lead.';reply.emit('input');replacement(dialog,{reason:reply.value});node(dialog,'shift-end').emit('input');assert.equal(node(dialog,'confirm').disabled,false);await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift[0].reason,'We verified this emergency cover with the branch lead.');
 const rejected=await f.open('Rejected'),decline=node(rejected,'message-template');assert.equal(decline.querySelectorAll('option').length,2);assert.equal(decline.querySelectorAll('option')[1].value,'decline');decline.value='decline';decline.emit('change');assert.match(node(rejected,'reply').value,/cannot approve/);assert.equal(node(rejected,'confirm').textContent,'Reject request');
});

test('a failed recheck after acknowledged hours retries only inspection and completion with the saved shared message',async()=>{
 let f,checks=0;f=fixture({inspect:async()=>{checks++;if(checks===2)throw Error('Synthetic follow-up read failure');return {request:structuredClone(f.row),...(f.calls.confirmShift.length?{...unknownState,unknown:false,complete:true,scheduledEndAt:shiftHead.expectedEndAt,scheduleChanged:true,emergencyShiftVersion:1,emergencyShiftRevisionId:shiftHead.revisionId,emergencyShift:shiftHead}:unknownState)};}});
 const dialog=await f.open();replacement(dialog);await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.dismiss.length,0);assert.equal(dialog.open,true);assert.equal(node(dialog,'reply').readOnly,true);assert.equal(node(dialog,'shift-start').disabled,true);assert.equal(node(dialog,'confirm').textContent,'Retry finish review');
 node(dialog,'reply').value='A programmatic edit cannot replace the acknowledged audit message.';node(dialog,'shift-start').value='10:00';await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.inspect.length,3);assert.equal(f.calls.dismiss.length,1);assert.equal(f.calls.dismiss[0].reviewNote,'Emergency cover verified with the branch.');assert.equal(dialog.open,false);
});

test('an ambiguous final decision retries the exact protected input without another inspection or confirmation version',async()=>{
 let f,attempt=0;f=fixture({inspect:async()=>({request:structuredClone(f.row),...(f.calls.confirmShift.length?{...unknownState,unknown:false,complete:true,scheduledEndAt:shiftHead.expectedEndAt,scheduleChanged:true,emergencyShiftVersion:1,emergencyShiftRevisionId:shiftHead.revisionId,emergencyShift:shiftHead}:unknownState)}),dismiss:async()=>{if(++attempt===1)throw Error('Synthetic reply lost after commit');return {alreadySaved:true};}});
 const dialog=await f.open();replacement(dialog);await node(dialog,'confirm').onclick();assert.equal(dialog.open,true);assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.inspect.length,2);assert.equal(f.calls.dismiss.length,1);assert.equal(node(dialog,'confirm').textContent,'Retry finish review');
 node(dialog,'reply').value='This cannot rewrite the saved response.';await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.inspect.length,2);assert.equal(f.calls.dismiss.length,2);assert.deepEqual(f.calls.dismiss[0],f.calls.dismiss[1]);assert.equal(dialog.open,false);
});

test('a changed confirmation head or request identity after saving hours cannot be automatically completed',async()=>{
 for(const change of [{emergencyShiftVersion:2,emergencyShiftRevisionId:'other-confirmation'},{emergencyShiftRevisionId:'different-head'},{request:{requestToken:'renewed-token',requestVersion:3}}]){
  let f;f=fixture({inspect:async()=>{const after=f.calls.confirmShift.length>0;if(!after)return{request:structuredClone(f.row),...unknownState};const request={...f.row,...(change.request||{})};return {request,...unknownState,unknown:false,complete:true,scheduledEndAt:shiftHead.expectedEndAt,emergencyShiftVersion:1,emergencyShiftRevisionId:shiftHead.revisionId,emergencyShift:shiftHead,...change,request};}});
  const dialog=await f.open();replacement(dialog);await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.dismiss.length,0);assert.equal(f.calls.review.length,0);assert.equal(node(dialog,'confirm').disabled,true);assert.match(node(dialog,'status').textContent,/changed during review|saved request changed/);assert.equal(dialog.open,true);
 }
});

test('reopening already confirmed hours shows their summary and collapsed form without requiring another reason',async()=>{
 const f=fixture({state:{early:false,complete:true,scheduleChanged:true,emergencyShiftVersion:1,emergencyShiftRevisionId:shiftHead.revisionId,emergencyShift:shiftHead}}),dialog=await f.open();assert.match(node(dialog,'details').textContent,/Confirmed replacement shift · version 1/);assert.equal(node(dialog,'shift-panel').hidden,false);assert.equal(node(dialog,'shift-panel').open,false);assert.equal(node(dialog,'shift-start').value,'09:30');assert.equal(node(dialog,'shift-end').value,'18:00');assert.equal(node(dialog,'confirm').textContent,'Confirm review');assert.equal(node(dialog,'confirm').disabled,false);await node(dialog,'confirm').onclick();assert.equal(f.calls.confirmShift.length,0);assert.equal(f.calls.dismiss.length,1);
});

test('a combined action cannot continue after the reviewer loses identity while rechecking saved hours',async()=>{
 const gate=hold();let f;f=fixture({inspect:async()=>f.calls.confirmShift.length?gate.promise:{request:structuredClone(f.row),...unknownState}});const dialog=await f.open();replacement(dialog);const pending=node(dialog,'confirm').onclick();await tick();f.api.auth.currentUser.uid='another-reviewer';gate.resolve({request:f.row,unknown:false,complete:true,scheduledEndAt:shiftHead.expectedEndAt,emergencyShiftVersion:1,emergencyShiftRevisionId:shiftHead.revisionId,emergencyShift:shiftHead});await pending;assert.equal(f.calls.confirmShift.length,1);assert.equal(f.calls.dismiss.length,0);assert.equal(f.calls.review.length,0);assert.equal(f.calls.messages.length,0);assert.equal(node(dialog,'confirm').disabled,true);
});

test('real combined completion recovers a committed but unacknowledged dismissal without a non-Pending inspection',async()=>{
 const f=await emergencyProtectedFixture(),dismiss=f.service.dismiss,inspect=f.service.inspect;let attempts=0,inspections=0;f.service.inspect=input=>{inspections++;return inspect(input);};f.service.dismiss=input=>{if(++attempts===1)f.h.loseNextAck();return dismiss(input);};
 const dialog=await f.open();replacement(dialog,{date:'2026-10-19',start:'19:30',end:'04:00'});await node(dialog,'confirm').onclick();assert.equal(dialog.open,true);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Not Required');assert.equal(node(dialog,'confirm').textContent,'Retry finish review');assert.equal(inspections,2);const committed=structuredClone([...f.h.docs]);
 await node(dialog,'confirm').onclick();assert.equal(dialog.open,false);assert.equal(inspections,2);assert.equal(attempts,2);assert.deepEqual([...f.h.docs],committed);assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('attendance_shift_confirmation_events/')).length,1);assert.equal(f.h.get('attendance_shift_confirmations/'+f.start.id).version,1);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.match(f.messages.at(-1)[1],/already saved/);
});

test('a real newer confirmation between save and reinspection blocks composed completion of the older version',async()=>{
 const f=await emergencyProtectedFixture(),confirm=f.service.confirmShift,inspect=f.service.inspect;let concurrent=false;f.service.confirmShift=async input=>{const result=await confirm(input);if(!concurrent){concurrent=true;const current=await inspect({requestId:f.request.id});await confirm({...input,operationId:'concurrent-confirmation-v2',expectedConfirmationVersion:current.emergencyShiftVersion,expectedScheduleFingerprint:current.scheduleFingerprint,expectedSourceFingerprint:current.emergencyShiftSourceFingerprint,shiftName:'Other confirmed shift'});}return result;};
 const dialog=await f.open();replacement(dialog,{date:'2026-10-19',start:'19:30',end:'04:00'});await node(dialog,'confirm').onclick();assert.equal(f.h.get('attendance_shift_confirmations/'+f.start.id).version,2);assert.equal(f.h.get('staff_requests/'+f.request.id).status,'Pending');assert.equal(node(dialog,'confirm').disabled,true);assert.match(node(dialog,'status').textContent,/changed during review/);assert.equal(f.h.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.equal(f.messages.length,0);assert.equal(dialog.open,true);
});
