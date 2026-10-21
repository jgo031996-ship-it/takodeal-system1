import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as deductionDetails from '../takodeal-staff/payroll-deduction-details.js';
import {deductionNoticeHTML,deductionFallbackHTML,sendStaffDeductionReply,staffDeductionReplyMessage,acknowledgeCashShortagePayslip} from '../takodeal-staff/deduction-inbox.js';
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
function payslipRender(data,signature=false){let popup;const context={...deductionDetails,window:{staffVaultSession:{epoch:1,allows:()=>true}},localStorage:{getItem:()=>notice.staffId},Swal:{fire:options=>{popup=options;return Promise.resolve({isConfirmed:false});}},Date,console};const name=signature?'openPayslipSignatureModal':'viewPastPayslip',start=source.indexOf('window.'+name+' = function('),end=source.indexOf(signature?'window.loadMyLoanLedger =':'// 🔥 NEW: DEDICATED IMAGE DOWNLOADER',start);assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);const encoded=encodeURIComponent(JSON.stringify(data));if(signature)context.window[name]('sample-paid',encoded);else context.window[name](encoded);return popup.html;}
test('actual frozen Staff payslip and signature preview show Cash Shortages once in deductions and preserve saved net',()=>{
 const data={name:'Sample Crew',basicPay:1000,start:'2026-10-01',end:'2026-10-15',lateDeduction:10,cashShortages:90,onlineRefunds:10,finalNetPay:777,isPaid:true,cashShortageRows:[{id:notice.id,amount:90}]},before=structuredClone(data);
 const full=payslipRender(data),sign=payslipRender(data,true);assert.match(full,/Approved cash shortages<\/span><strong[^>]*>₱90\.00/);assert.match(full,/TOTAL DEDUCTIONS<\/span> <span>110\.00/);assert.match(full,/777\.00/);assert.match(sign,/Approved cash shortages<\/span><strong[^>]*>₱90\.00/);assert.match(sign,/DEDUCT:<\/span> <span>₱110\.00/);assert.match(sign,/NET PAY:[\s\S]*?777\.00/);assert.deepEqual(data,before);
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


const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=';
function acknowledgementHarness(change={}){
 const h=firestoreHarness(),record={staffId:'sample-crew',staffName:'Sample Crew',finalNetPay:777,accountId:'sample-account',accountName:'Sample Account',cashShortageSettlements:{[notice.id]:90},acknowledged:false,frozenData:{staffId:'sample-crew',name:'Sample Crew',branch:'Sample Branch',isPaid:true,finalNetPay:777,basicPay:1000,cashShortages:90,cashShortageRows:[{id:notice.id,amount:90}],profile:{staffId:'sample-crew',hourlyRate:500}},...change};
 h.put('payroll_records/sample-paid',record);h.put('cash_accounts/sample-account',{balance:1000});
 const vault={db:h.api.db,sdk:h.api,auth:{currentUser:{uid:'sample-approved-phone'}}};return {h,vault,record,input:{recordId:'sample-paid',staffId:'sample-crew',signature:png}};
}
test('private Staff cash-backed payslip acknowledgement writes only its three signature fields and freezes finances',async()=>{
 const {h,vault,record,input}=acknowledgementHarness(),before=structuredClone(record);assert.deepEqual(await acknowledgeCashShortagePayslip(vault,input),{alreadySaved:false});const after=h.get('payroll_records/sample-paid');assert.deepEqual(Object.keys(after).filter(key=>JSON.stringify(after[key])!==JSON.stringify(before[key])).sort(),['acknowledged','acknowledgedAt','signatureBase64']);assert.equal(after.acknowledged,true);assert.equal(after.signatureBase64,png);assert.deepEqual(after.frozenData,before.frozenData);assert.equal(after.finalNetPay,777);assert.deepEqual(after.cashShortageSettlements,before.cashShortageSettlements);assert.equal(h.get('cash_accounts/sample-account').balance,1000);
});
test('own paid record, stable approved-phone auth and PNG signature are required before acknowledgement',async()=>{
 for(const failure of ['foreign','conflicting','unpaid','nocash','missing','switched','auth','unauthenticated']){
  const {h,vault,input}=acknowledgementHarness();if(failure==='foreign')input.staffId='another-person';if(failure==='conflicting')h.put('payroll_records/sample-paid',{...h.get('payroll_records/sample-paid'),frozenData:{...h.get('payroll_records/sample-paid').frozenData,staffId:'another-person'}});if(failure==='unpaid')h.put('payroll_records/sample-paid',{...h.get('payroll_records/sample-paid'),frozenData:{...h.get('payroll_records/sample-paid').frozenData,isPaid:false}});if(failure==='nocash')h.put('payroll_records/sample-paid',{...h.get('payroll_records/sample-paid'),frozenData:{...h.get('payroll_records/sample-paid').frozenData,cashShortages:0,cashShortageRows:[]}});if(failure==='missing')input.recordId='missing-record';if(failure==='switched')input.stillCurrent=()=>false;if(failure==='auth'){let checks=0;input.stillCurrent=()=>{if(++checks===2)vault.auth.currentUser.uid='changed-phone';return true;};}if(failure==='unauthenticated')vault.auth.currentUser=null;const before=structuredClone([...h.docs]);await assert.rejects(acknowledgeCashShortagePayslip(vault,input),undefined,failure);assert.deepEqual([...h.docs],before,failure);
 }
 for(const invalid of ['',png.replace('image/png','image/jpeg'),'data:image/png;base64,AA==',png+'?',png.slice(0,-1),png+'A'.repeat(500000)]){const {h,vault,input}=acknowledgementHarness(),before=structuredClone([...h.docs]);await assert.rejects(acknowledgeCashShortagePayslip(vault,{...input,signature:invalid}),/signature/);assert.deepEqual([...h.docs],before);}
});
test('failed save leaves acknowledgement unset and lost acknowledgement retry never replaces the saved signature',async()=>{
 const f=acknowledgementHarness();f.h.failNextCommit();await assert.rejects(acknowledgeCashShortagePayslip(f.vault,f.input),/Commit rejected/);assert.equal(f.h.get('payroll_records/sample-paid').acknowledged,false);f.h.loseNextAck();await assert.rejects(acknowledgeCashShortagePayslip(f.vault,f.input),/Connection lost/);assert.equal(f.h.get('payroll_records/sample-paid').signatureBase64,png);
 const replacement=png.replace('P8/x8A','P8/w8A');assert.deepEqual(await acknowledgeCashShortagePayslip(f.vault,{...f.input,signature:replacement}),{alreadySaved:true});assert.equal(f.h.get('payroll_records/sample-paid').signatureBase64,png);assert.equal(f.h.get('payroll_records/sample-paid').finalNetPay,777);
 const g=acknowledgementHarness(),results=await Promise.all(Array.from({length:12},()=>acknowledgeCashShortagePayslip(g.vault,g.input)));assert.equal(results.filter(row=>!row.alreadySaved).length,1);assert.equal(g.h.get('payroll_records/sample-paid').signatureBase64,png);
});
function signatureHandlerFixture({data={},createClient,legacy=false}={}){
 const f=acknowledgementHarness(),identity={id:'sample-crew'},alerts=[],errors=[],calls={privateClient:0,publicWrites:0,reload:0};
 const api={staffVaultSession:{epoch:1,allows:()=>true},loadPayslipVault(){calls.reload++;}},context={...deductionDetails,window:api,localStorage:{getItem:()=>identity.id},firebaseConfig:{sample:true},createStaffDocumentFirebase:async(config,currentIdentity)=>{calls.privateClient++;assert.equal(config.sample,true);assert.equal(currentIdentity(),identity.id);return createClient?createClient(f,identity):f.vault;},acknowledgeCashShortagePayslip,db:{legacy:true},doc:(_db,table,id)=>({table,id}),updateDoc:async()=>{calls.publicWrites++;if(!legacy)throw Error('Cash-backed signature used the public database.');},serverTimestamp:()=>({seconds:1}),Swal:{fire:options=>{alerts.push(options);return Promise.resolve(options?.title?.includes('Acknowledge Payslip')?{isConfirmed:true,value:png}:{isConfirmed:false});}},Date,console:{error:error=>errors.push(error)}};
 const start=source.indexOf('window.openPayslipSignatureModal = function('),end=source.indexOf('window.loadMyLoanLedger =',start);vm.runInNewContext(source.slice(start,end),context);return {...f,api,identity,alerts,errors,calls,sign:()=>api.openPayslipSignatureModal('sample-paid',encodeURIComponent(JSON.stringify({...f.record.frozenData,...data})))};
}
test('actual Staff signature handler uses existing private approved phone client for cash-backed payroll',async()=>{
 const f=signatureHandlerFixture(),before=structuredClone(f.record);await f.sign();assert.deepEqual(f.errors,[]);assert.equal(f.calls.privateClient,1);assert.equal(f.calls.publicWrites,0);assert.equal(f.calls.reload,1);assert.equal(f.h.get('payroll_records/sample-paid').signatureBase64,png);assert.deepEqual(f.h.get('payroll_records/sample-paid').frozenData,before.frozenData);assert.match(f.alerts.at(-1).title,/Payslip Acknowledged/);
 const g=signatureHandlerFixture({data:{cashShortages:0}});await g.sign();assert.equal(g.calls.privateClient,1);assert.equal(g.calls.publicWrites,0);assert.equal(g.h.get('payroll_records/sample-paid').acknowledged,true);
});
test('actual signature handler stops after a staff switch while private client connects and keeps legacy path unchanged',async()=>{
 const f=signatureHandlerFixture({createClient:async(f,identity)=>{identity.id='another-person';return f.vault;}});await f.sign();assert.equal(f.calls.privateClient,1);assert.equal(f.calls.publicWrites,0);assert.equal(f.calls.reload,0);assert.equal(f.h.get('payroll_records/sample-paid').acknowledged,false);assert.deepEqual(f.errors,[]);
 const g=signatureHandlerFixture({legacy:true,data:{cashShortages:0,cashShortageRows:[]}});await g.sign();assert.equal(g.calls.privateClient,0);assert.equal(g.calls.publicWrites,1);assert.equal(g.calls.reload,1);assert.deepEqual(g.errors,[]);
});
