import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installCashShortageUI,cashShortageSummaryHTML} from '../takodeal-manager/cash-shortage-ui.js';
import {openCashShortageReview,approveCashShortageReview,dismissCashShortageReview} from '../takodeal-manager/cash-shortage.js';
import {sendStaffDeductionReply} from '../takodeal-staff/deduction-inbox.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {validateCashShortageLink} from '../takodeal-manager/cash-shortage-model.js';
import {isLatenessRequest} from '../takodeal-manager/payroll-safety.js';

// Real native-dialog UI and real transaction callbacks, with a minimal DOM and
// fictional in-memory records. No Firebase connection or real payroll actions.
const unescape=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element {
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.listeners={};this.disabled=false;this.hidden=false;this.open=false;this.checked=false;this._text='';this._value=undefined;this._html='';}
 append(...nodes){for(const node of nodes){node.remove?.();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
 set textContent(value){this._text=String(value);this.children=[];this._html='';}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set value(value){this._value=String(value);}
 get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT'){const option=this.querySelector('option');return option?.attributes.value??option?.textContent??'';}return this.tagName==='TEXTAREA'?this.textContent:'';}
 setAttribute(name,value){this.attributes[name]=String(value);if(['id','class'].includes(name))this[name==='class'?'className':name]=String(value);if(name==='value')this.value=value;if(name==='disabled')this.disabled=true;if(name==='hidden')this.hidden=true;if(name==='checked')this.checked=true;}
 getAttribute(name){return this.attributes[name]??null;}
 addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}
 emit(type){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const callback of this.listeners[type]||[])callback(event);return event;}
 showModal(){this.open=true;}
 close(){if(this.open){this.open=false;this.emit('close');}}
 matches(selector){if(selector[0]==='[')return Object.hasOwn(this.attributes,selector.slice(1,-1));if(selector[0]==='#')return this.id===selector.slice(1);return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const selectors=selector.split(',').map(value=>value.trim()),result=[];const walk=parent=>{for(const node of parent.children){if(selectors.some(one=>node.matches(one)))result.push(node);walk(node);}};walk(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceChildren(...nodes){this.children=[];this._text='';this._html='';this.append(...nodes);}
 get innerHTML(){return this._html;}
 set innerHTML(html){this.children=[];this._text='';this._html=String(html);const stack=[this];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1)._text+=unescape(token);continue;}const tag=/^<([\w-]+)/.exec(token)?.[1];if(!tag)continue;const node=new Element(tag,this.ownerDocument);for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(match[1],unescape(match[2]??''));stack.at(-1).append(node);if(!['input','br','img','hr','meta','link'].includes(tag))stack.push(node);}}
}
class Document {constructor(){this.body=new Element('body',this);this.listeners={};}createElement(tag){return new Element(tag,this);}querySelector(selector){return this.body.querySelector(selector);}addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}}
const node=(dialog,key)=>dialog.querySelector('[data-'+key+']');
const now=()=>new Date('2026-10-20T12:00:00+08:00');
const hold=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const shiftId='sample-closed-shift',caseId='cash-shortage-'+shiftId;
async function fixture({pending=false,response=false,read=false,actions:overrides={}}={}){
 const h=firestoreHarness(),document=new Document(),email='jgo031996@gmail.com',notified=[],invalidated=[];
 const auth={currentUser:{uid:'sample-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
 const api={...h.api,auth,sessionUser:{uid:'sample-owner',email,isOwner:true,role:'Owner',permissions:['all'],allowedBranches:['all']},limit:value=>({limit:value}),serverTimestamp:now,getDocFromServer:async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}}),ManagerUI:{notify:message=>notified.push(message)},invalidateCollectionCache:name=>invalidated.push(name)};
 h.put('hq_managers/sample-owner',{email,role:'Owner',permissions:['all'],assignedBranch:'Sample Branch',pin:'SAMPLE PIN',active:true});
 h.put('shifts/'+shiftId,{branch:'Sample Branch',status:'Closed',active:false,cashier:'Sample Alpha / Sample Beta',startTime:new Date('2026-10-20T09:00:00+08:00'),endTime:new Date('2026-10-20T11:00:00+08:00'),expectedCash:14355,declaredCash:14265});
 h.put('cashiers/sample-alpha',{cashierName:'Sample Alpha',branch:'Sample Branch',pin:'SAMPLE PIN',active:true});h.put('cashiers/sample-beta',{cashierName:'Sample Beta',branch:'Sample Branch',pin:'SAMPLE PIN',active:true});h.put('cashiers/sample-inactive',{cashierName:'Sample Inactive',branch:'Sample Branch',active:false});h.put('cashiers/sample-foreign',{cashierName:'Sample Other Branch',branch:'Another Branch',active:true});
 const initial={shiftId,staffId:'sample-beta',details:'Sample cash count requires an explanation.',evidence:'Sample signed count reference.'};
 const actual={open:input=>openCashShortageReview(api,input,{now}),approve:(id,input)=>approveCashShortageReview(api,id,input,{now}),dismiss:(id,input)=>dismissCashShortageReview(api,id,input,{now})};
 const calls={open:[],approve:[],dismiss:[]};const actions=Object.fromEntries(Object.keys(actual).map(name=>[name,async(...args)=>{calls[name].push(structuredClone(args));return (overrides[name]||actual[name])(...args);} ]));
 if(pending)await actual.open(initial);
 async function reply(message='Sample cashier explanation: I dispute responsibility pending cash reconciliation.') {await sendStaffDeductionReply({db:api.db,sdk:api,auth:{currentUser:{uid:'sample-approved-staff-phone'}}},{noticeId:caseId,staffId:'sample-beta',message});}
 if(response)await reply();
 if(read)h.put('staff_deduction_notices/'+caseId,{...h.get('staff_deduction_notices/'+caseId),readRevision:1,readAt:now()});
 const ui=installCashShortageUI(api,document,{actions,now});
 return {h,api,document,notified,invalidated,calls,ui,initial,reply,open:async()=>{await ui.review(shiftId);return document.querySelector('dialog');}};
}
function fillOpen(dialog,staffId='sample-beta'){node(dialog,'staff').value=staffId;node(dialog,'details').value='Sample cash count requires an explanation.';node(dialog,'evidence').value='Sample signed count reference.';}
function fillApproval(dialog,changes={}) {for(const [key,value]of Object.entries({amount:'70.00',date:'2026-10-20',basis:'Court / authorized agency order',authority:'Sample authority order and applicability reference.',finding:'Sample reviewed responsibility with the cashier explanation and reconciliation.',...changes}))node(dialog,key).value=value;node(dialog,'responsibility').checked=true;node(dialog,'lawful').checked=true;}
const linkedCount=h=>[...h.docs.keys()].filter(path=>/^(cash_shortage_reviews|staff_deductions|staff_deduction_notices)\//.test(path)).length;

test('joined cashier log is informational: actual UI requires explicit saved staff ID and filters inactive/other-branch accounts',async()=>{
 const f=await fixture(),dialog=await f.open();assert.equal(node(dialog,'staff').value,'');assert.match(node(dialog,'content').textContent,/Sample Alpha \/ Sample Beta/);assert.match(node(dialog,'content').textContent,/A shortage alone does not establish responsibility/);assert.doesNotMatch(node(dialog,'staff').textContent,/Inactive|Other Branch/);
 fillOpen(dialog,'');await node(dialog,'save').onclick();assert.equal(f.calls.open.length,0);assert.equal(linkedCount(f.h),0);assert.match(node(dialog,'status').textContent,/Select the staff account/);
 fillOpen(dialog);await node(dialog,'save').onclick();assert.equal(f.calls.open[0][0].staffId,'sample-beta');assert.equal(linkedCount(f.h),3);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).staffId,'sample-beta');assert.equal(f.h.get('staff_deductions/'+caseId).amount,0);assert.equal(f.h.get('staff_deductions/'+caseId).status,'Pending Review');
});

test('pending explanation and read acknowledgement cannot enable approval or authorize a deduction',async()=>{
 const f=await fixture({pending:true,read:true}),dialog=await f.open();assert.equal(node(dialog,'save').disabled,true);assert.match(node(dialog,'content').textContent,/A response or acknowledgement is not consent/);await node(dialog,'save').onclick();assert.equal(f.calls.approve.length,0);assert.equal(f.h.get('staff_deductions/'+caseId).amount,0);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).status,'Pending Review');
 await f.reply();await node(dialog,'refresh').onclick();assert.equal(node(dialog,'save').disabled,false);await node(dialog,'save').onclick();assert.equal(f.calls.approve.length,0);assert.match(node(dialog,'status').textContent,/both review confirmations/);
});

test('actual UI/service refuse excessive, invalid and historical amounts/dates and incomplete legal review',async()=>{
 for(const changes of [{amount:'91.00'},{amount:'0'},{amount:'garbage'},{date:'2026-10-19'},{date:''},{basis:''},{authority:'short'},{finding:'too short'}]) {const f=await fixture({pending:true,response:true}),dialog=await f.open(),before=structuredClone([...f.h.docs]);fillApproval(dialog,changes);await node(dialog,'save').onclick();assert.deepEqual([...f.h.docs],before,JSON.stringify(changes));assert.equal(f.h.get('cash_shortage_reviews/'+caseId).status,'Pending Review');assert.equal(node(dialog,'save').disabled,false);assert.equal(node(dialog,'status').getAttribute('role'),'alert');}
});

test('reviewed amount enters one approved linked deduction; paid records and original shift remain untouched',async()=>{
 const f=await fixture({pending:true,response:true}),dialog=await f.open(),shift=structuredClone(f.h.get('shifts/'+shiftId));f.h.put('payroll_records/sample-paid',{status:'Paid',finalNetPay:600,frozenData:{cashShortages:0,finalNetPay:600}});fillApproval(dialog);await node(dialog,'save').onclick();
 assert.equal(f.calls.approve.length,1);assert.equal(f.calls.approve[0][0],caseId);assert.equal(f.calls.approve[0][1].expectedReplyRevision,1);assert.equal(f.h.get('staff_deductions/'+caseId).amount,70);assert.equal(f.h.get('staff_deductions/'+caseId).status,'Unpaid');assert.equal(f.h.get('cash_shortage_reviews/'+caseId).status,'Approved');assert.equal(linkedCount(f.h),3);assert.match(node(dialog,'status').textContent,/appear once/);assert.equal(node(dialog,'save').hidden,true);assert.deepEqual(f.h.get('shifts/'+shiftId),shift);assert.equal(f.h.get('payroll_records/sample-paid').finalNetPay,600);
});

test('duplicate clicks during the real save create one review and prevent closing the dialog mid-commit',async()=>{
 const gate=hold();let realOpen;const f=await fixture({actions:{open:async input=>{await gate.promise;return realOpen(input);}}});realOpen=input=>openCashShortageReview(f.api,input,{now});const dialog=await f.open();fillOpen(dialog);const saving=node(dialog,'save').onclick();await node(dialog,'save').onclick();assert.equal(f.calls.open.length,1);assert.equal(node(dialog,'save').disabled,true);assert.equal(node(dialog,'close').disabled,true);assert.equal(dialog.emit('cancel').defaultPrevented,true);gate.resolve();await saving;assert.equal(linkedCount(f.h),3);assert.equal(node(dialog,'save').disabled,true);assert.equal(f.h.get('staff_deductions/'+caseId).amount,0);
});

test('Owner account switch blocks stale UI actions and an in-flight service refuses the changed session',async()=>{
 const f=await fixture(),dialog=await f.open();fillOpen(dialog);f.api.auth.currentUser={...f.api.auth.currentUser,uid:'another-owner'};await node(dialog,'save').onclick();assert.equal(f.calls.open.length,0);assert.equal(linkedCount(f.h),0);
 const gate=hold();const g=await fixture();const original=g.api.getDocsFromServer;g.api.getDocsFromServer=async query=>query.table==='hq_managers'?(await gate.promise,original(query)):original(query);const other=await g.open();fillOpen(other);const saving=node(other,'save').onclick();await tick();g.api.auth.currentUser={...g.api.auth.currentUser,uid:'another-owner'};gate.resolve();await saving;assert.equal(linkedCount(g.h),0);
});

test('lost save acknowledgement is recoverable by refreshing the same review without a duplicate charge',async()=>{
 const f=await fixture(),dialog=await f.open();fillOpen(dialog);f.h.loseNextAck();await node(dialog,'save').onclick();assert.equal(linkedCount(f.h),3);assert.match(node(dialog,'status').textContent,/Refresh this same review before retrying/);await node(dialog,'refresh').onclick();assert.match(node(dialog,'content').textContent,/Sample Beta · Pending Review/);assert.equal(node(dialog,'save').disabled,true);await f.reply();await node(dialog,'refresh').onclick();fillApproval(dialog);f.h.loseNextAck();await node(dialog,'save').onclick();assert.equal(f.h.get('cash_shortage_reviews/'+caseId).status,'Approved');await node(dialog,'refresh').onclick();assert.equal(node(dialog,'save').hidden,true);assert.equal(f.calls.open.length,1);assert.equal(linkedCount(f.h),3);assert.equal(f.h.get('staff_deductions/'+caseId).amount,70);assert.match(node(dialog,'status').textContent,/appear once/);
});

test('cash summary, directory, staff explanation and final review escape saved HTML text',async()=>{
 const html=cashShortageSummaryHTML({branch:'<script>branch</script>',cashier:'<img onerror=x>'},{expected:100,declared:10,shortage:90});assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img/);
 const f=await fixture();f.h.put('cashiers/sample-beta',{cashierName:'Sample <img onerror=x>',branch:'Sample Branch',active:true});let dialog=await f.open();assert.doesNotMatch(node(dialog,'content').innerHTML,/<img|<script>/);assert.match(node(dialog,'content').innerHTML,/&lt;img/);fillOpen(dialog);await node(dialog,'save').onclick();await f.reply('Sample response <script>unsafe</script> and <img onerror=x>');await node(dialog,'refresh').onclick();assert.match(node(dialog,'content').innerHTML,/&lt;script&gt;unsafe/);assert.doesNotMatch(node(dialog,'content').innerHTML,/<script>|<img/);fillApproval(dialog,{finding:'Sample finding <script>unsafe</script> responsibility reviewed.'});await node(dialog,'save').onclick();assert.doesNotMatch(node(dialog,'content').innerHTML,/<script>|<img/);assert.match(node(dialog,'content').innerHTML,/&lt;script&gt;unsafe/);
});


for(const decision of ['approve','dismiss'])test(`a new private Staff dispute holds the approved claim until explicit Owner ${decision} after a fresh review`,async()=>{
 const f=await fixture({pending:true,response:true});let dialog=await f.open();fillApproval(dialog);await node(dialog,'save').onclick();
 const paid={status:'Paid',finalNetPay:600,frozenData:{cashShortages:0,finalNetPay:600}};f.h.put('payroll_records/sample-paid',structuredClone(paid));
 const link=()=>validateCashShortageLink({id:caseId,...f.h.get('staff_deductions/'+caseId)},f.h.get('cash_shortage_reviews/'+caseId),f.h.get('staff_deduction_notices/'+caseId),{staffId:'sample-beta',name:'Sample Beta',branch:'Sample Branch',end:'2026-10-20',shift:f.h.get('shifts/'+shiftId)});
 assert.equal(link().amount,70);await f.reply('Sample new dispute: please recheck the closing cash and handover evidence.');
 assert.equal(f.h.get('staff_deduction_notices/'+caseId).replyRevision,2);assert.throws(link,/response or authorized amount changed/);node(dialog,'close').onclick();dialog=await f.open();
 assert.match(node(dialog,'status').textContent,/Payroll collection is on hold/);assert.match(node(dialog,'content').textContent,/Sample new dispute/);assert.match(node(dialog,'content').textContent,/A response or acknowledgement is not consent/);assert.equal(node(dialog,'save').hidden,false);assert.equal(node(dialog,'save').disabled,false);assert.equal(node(dialog,'responsibility').checked,false);assert.equal(node(dialog,'lawful').checked,false);assert.equal(node(dialog,'basis').value,'');assert.equal(node(dialog,'finding').value,'');
 await node(dialog,'save').onclick();assert.equal(f.calls.approve.length,1);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).revision,2);assert.throws(link);
 if(decision==='approve'){
  fillApproval(dialog,{amount:'60.00',finding:'Sample new dispute reviewed against the corrected closing cash evidence.'});await node(dialog,'save').onclick();assert.equal(f.calls.approve[1][1].expectedRevision,2);assert.equal(f.calls.approve[1][1].expectedReplyRevision,2);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).replyRevisionReviewed,2);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).revision,3);assert.equal(link().amount,60);assert.equal(node(dialog,'save').hidden,true);
 }else{
  node(dialog,'dismiss-reason').value='Sample new dispute resolved: the reconciliation does not establish personal responsibility.';await node(dialog,'dismiss').onclick();assert.equal(f.calls.dismiss[0][1].expectedRevision,2);assert.equal(f.h.get('cash_shortage_reviews/'+caseId).status,'Dismissed');assert.equal(f.h.get('cash_shortage_reviews/'+caseId).revision,3);assert.equal(f.h.get('staff_deductions/'+caseId).amount,0);assert.throws(link);assert.equal(node(dialog,'save').hidden,true);
 }
 assert.equal(linkedCount(f.h),3);assert.deepEqual(f.h.get('payroll_records/sample-paid'),paid);assert.equal(f.h.get('staff_deduction_notices/'+caseId).staffReply,'Sample new dispute: please recheck the closing cash and handover evidence.');
});

const ownerSource=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
test('actual legacy cash Reason Letter approval or rejection only records a reply and cannot create a cash deduction',async()=>{
 const start=ownerSource.indexOf('window.submitRequestReply = async function('),end=ownerSource.indexOf('window.openForecasterItemTrace =',start),handler=ownerSource.slice(start,end);assert.ok(start>=0&&end>start);assert.doesNotMatch(ownerSource,/replyPenaltyAmt|request-penalty-/);assert.match(ownerSource,/Replying to this letter does not create a payroll deduction/);
 for(const type of ['Reason Letter','Cash Shortage / Mishandling'])for(const action of ['Approved','Rejected']){
  const h=firestoreHarness(),errors=[],alerts=[],writes=[],request={type,staffName:'Sample Beta',branch:'Sample Branch',status:'Pending',explanationCause:'Cash Shortage / Mishandling',explanationMessage:'Sample cash reconciliation letter.',sourceShiftId:shiftId,timestamp:now()};h.put('staff_requests/sample-letter',request);h.put('payroll_records/sample-paid',{status:'Paid',finalNetPay:600});
  const get=async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path))}),elements={btnSubmitReply:{disabled:false,innerText:''},replyMessage:{value:'Sample explanation reviewed; use the protected Z-reading case for any claim.'},replyProofImage:{files:[]},replyPenaltyAmt:{value:'99999'},dynamicReplyModal:{remove(){}}};
  const api={...h.api,getDoc:get,isBranchAllowed:()=>true,sessionUser:{cashierName:'Sample Owner'},updateDoc:async(ref,patch)=>{writes.push(ref.path);return h.api.runTransaction(h.api.db,async tx=>{await tx.get(ref);tx.update(ref,patch);});},addDoc:async()=>{throw Error('Legacy letter attempted a new money record.');},loadInbox(){},loadLedger(){}};
  const context={window:api,document:{getElementById:id=>elements[id]||null},tkOwnerDoc:get,isLatenessRequest,issueScheduledSanction:()=>{throw Error('Legacy letter attempted a sanction charge.');},Swal:{fire:(...args)=>{alerts.push(args);return Promise.resolve({});}},console:{error:(...args)=>errors.push(args)},Date};vm.runInNewContext(handler,context);await api.submitRequestReply('sample-letter',action,type,99999,'Sample Beta');assert.deepEqual(errors,[]);assert.deepEqual(writes,['staff_requests/sample-letter']);assert.equal(h.get('staff_requests/sample-letter').status,action);assert.equal(h.get('staff_requests/sample-letter').penaltyCharged,0);assert.equal(linkedCount(h),0);assert.equal([...h.docs.keys()].some(path=>path.startsWith('hr_sanctions/')),false);assert.equal(h.get('payroll_records/sample-paid').finalNetPay,600);assert.equal(alerts.length,1);
 }
});
