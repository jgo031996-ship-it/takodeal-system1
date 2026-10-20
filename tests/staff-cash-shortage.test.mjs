import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {deductionNoticeHTML,deductionFallbackHTML,sendStaffDeductionReply,staffDeductionReplyMessage} from '../takodeal-staff/deduction-inbox.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const notice={id:'cash-shortage-sample-shift',type:'Cash Shortage',staffId:'sample-crew',staffName:'Sample Crew',branch:'Sample Branch',sourcePlatform:'Z-reading',sourceReceiptId:'sample-shift',sourceShiftId:'sample-shift',sourceShortageCents:9000,reasonLabel:'Closed shift cash variance for review',details:'Sample expected cash differs from declared cash.',evidence:'Sample closing count and handover record.',status:'Pending Review',amount:0,noticeRevision:1,readRevision:0,replyRevision:0};
test('Staff shortage review reports variance separately and creates no appearance of an approved charge',()=>{
 const html=deductionNoticeHTML(notice,'sample-crew');
 assert.match(html,/Reported Z-reading shortage: <strong>₱90\.00/);
 assert.match(html,/No payroll deduction has been approved/);
 assert.match(html,/Opening this notice or sending a response does not authorize a salary deduction/);
 assert.match(html,/Your response or dispute/);assert.match(html,/A new response before payment pauses collection until the Owner reviews it again/);assert.match(html,/Replies after payment request review; your saved payslip remains unchanged/);assert.doesNotMatch(html,/Owner-reviewed payroll amount/);
});
test('approved private notice identifies amount, effective date and Owner legal review without inferring consent',()=>{
 const html=deductionNoticeHTML({...notice,status:'Approved',amount:70,effectiveDate:'2026-10-20',lawfulBasis:'Sample basis <script>x</script>',authorityReference:'Sample authority & document',finding:'Sample finding <img src=x>',ownerReply:'Sample finding',staffReply:'I dispute <b>this</b>'},'sample-crew');
 assert.match(html,/Owner-reviewed payroll amount: <strong>₱70\.00/);assert.match(html,/2026-10-20/);assert.match(html,/Sample authority &amp; document/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/I dispute &lt;b&gt;this&lt;\/b&gt;/);assert.match(html,/Saved paid payslips keep their recorded amounts/);assert.doesNotMatch(html,/<script>|<img/);
});
test('dismissed notices show no charge and public shortage ledger cannot vouch for approval or amount',()=>{
 assert.match(deductionNoticeHTML({...notice,status:'Dismissed'},'sample-crew'),/No payroll deduction/);
 assert.match(deductionNoticeHTML({...notice,status:'Paid',amount:70},'sample-crew'),/₱70\.00<\/strong> · Paid/);
 const publicHtml=deductionFallbackHTML({...notice,status:'Unpaid',amount:9999},'sample-crew');assert.match(publicHtml,/protected review/);assert.doesNotMatch(publicHtml,/9999|Unpaid/);
 assert.equal(deductionNoticeHTML(notice,'another-crew'),'');assert.equal(deductionFallbackHTML(notice,'another-crew'),'');
});
test('existing refund notice still displays its original payroll status and response control',()=>{
 const html=deductionNoticeHTML({...notice,type:'Online Order Refund',sourcePlatform:'Sample Platform',status:'Approved',amount:25},'sample-crew');assert.match(html,/Payroll deduction: <strong>₱25\.00/);assert.match(html,/data-send-reply=/);assert.doesNotMatch(html,/Cash shortage under review|Deduction basis/);
});
function replyHarness(row=notice){const h=firestoreHarness();h.put('staff_deduction_notices/'+notice.id,structuredClone(row));const vault={db:h.api.db,sdk:h.api,auth:{currentUser:{uid:'sample-approved-phone'}}};return {h,vault,input:{noticeId:notice.id,staffId:'sample-crew',message:'  Sample explanation and dispute.  '}};}
test('actual private Staff reply transaction only updates explanation, revision and authenticated audit fields',async()=>{
 const {h,vault,input}=replyHarness();await sendStaffDeductionReply(vault,input);const after=h.get('staff_deduction_notices/'+notice.id),changes=Object.keys(after).filter(key=>JSON.stringify(after[key])!==JSON.stringify(notice[key]));assert.deepEqual(changes.sort(),['repliedAt','repliedByUid','replyRevision','staffReply'].sort());assert.equal(after.amount,0);assert.equal(after.status,'Pending Review');assert.equal(after.staffReply,'Sample explanation and dispute.');assert.equal(after.repliedByUid,'sample-approved-phone');assert.equal(after.replyRevision,1);assert.equal(after.consent,undefined);
});
test('reply uses fresh identity, rejects stale account/ownership and failed commit cannot change protected review',async()=>{
 for(const failure of ['owner','account','invalid','commit','unauthenticated']){const {h,vault,input}=replyHarness();const before=structuredClone(h.get('staff_deduction_notices/'+notice.id));if(failure==='owner')h.put('staff_deduction_notices/'+notice.id,{...notice,staffId:'someone-else'});if(failure==='invalid')input.message=' ';if(failure==='account')input.stillCurrent=()=>false;if(failure==='commit')h.failNextCommit();if(failure==='unauthenticated')vault.auth.currentUser=null;await assert.rejects(sendStaffDeductionReply(vault,input));assert.equal(h.get('staff_deduction_notices/'+notice.id).replyRevision,0);assert.equal(h.get('staff_deduction_notices/'+notice.id).amount,before.amount);assert.equal(h.get('staff_deduction_notices/'+notice.id).status,before.status);}
});
const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
function payslipRender(data,signature=false){let popup;const context={window:{staffVaultSession:{epoch:1,allows:()=>true}},localStorage:{getItem:()=>notice.staffId},Swal:{fire:options=>{popup=options;return Promise.resolve({isConfirmed:false});}},Date,console};const name=signature?'openPayslipSignatureModal':'viewPastPayslip',start=source.indexOf('window.'+name+' = function('),end=source.indexOf(signature?'window.loadMyLoanLedger =':'// 🔥 NEW: DEDICATED IMAGE DOWNLOADER',start);assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);const encoded=encodeURIComponent(JSON.stringify(data));if(signature)context.window[name]('sample-paid',encoded);else context.window[name](encoded);return popup.html;}
test('actual frozen Staff payslip and signature preview show Cash Shortages once in deductions and preserve saved net',()=>{
 const data={name:'Sample Crew',basicPay:1000,start:'2026-10-01',end:'2026-10-15',lateDeduction:10,cashShortages:90,onlineRefunds:10,finalNetPay:777,isPaid:true,cashShortageRows:[{id:notice.id,amount:90}]},before=structuredClone(data);
 const full=payslipRender(data),sign=payslipRender(data,true);assert.match(full,/CASH SHORTAGES<\/span><span>90\.00/);assert.match(full,/TOTAL DEDUCTIONS<\/span> <span>110\.00/);assert.match(full,/777\.00/);assert.match(sign,/Cash Shortages:<\/span> <span>₱90\.00/);assert.match(sign,/DEDUCT:<\/span> <span>₱110\.00/);assert.match(sign,/NET PAY:[\s\S]*?777\.00/);assert.deepEqual(data,before);
});
test('zero saved payroll net remains zero instead of falling back to recalculated pay',()=>{
 const html=payslipRender({name:'Sample Crew',basicPay:1000,finalNetPay:0,cashShortages:90,isPaid:true});assert.match(html,/NET PAY[\s\S]*?>\s+0\.00\s+</);assert.doesNotMatch(html,/>\s+910\.00\s+</);
});


test('Staff response confirmation follows fresh protected status and explains the collection hold or frozen paid payroll',async()=>{
 for(const status of ['Pending Review','Approved','Paid']){
  const {h,vault,input}=replyHarness({...notice,status,amount:status==='Pending Review'?0:70});
  const result=await sendStaffDeductionReply(vault,input),message=staffDeductionReplyMessage(result);
  assert.equal(result.type,'Cash Shortage');assert.equal(result.status,status);
  if(status==='Approved')assert.equal(message,'Response sent. Collection is on hold until the Owner reviews your new response.');
  else if(status==='Paid')assert.equal(message,'Response sent for review. Your saved payslip remains unchanged.');
  else assert.equal(message,'Response sent. The Owner can read it in the incident review.');
  assert.equal(h.get('staff_deduction_notices/'+notice.id).status,status);assert.equal(h.get('staff_deduction_notices/'+notice.id).amount,status==='Pending Review'?0:70);
 }
 assert.equal(staffDeductionReplyMessage({type:'Online Order Refund',status:'Approved'}),'Response sent. The Owner can read it in the incident review.');
});
