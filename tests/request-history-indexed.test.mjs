import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHistory,historyTime} from '../takodeal-manager/request-history.js';
import {isMealDeduction} from '../takodeal-manager/payroll-safety.js';

// Frozen prior behavior is the comparison oracle: explicit links win, receipt
// matches need no amount match, and each ledger meal consumes at most one row.
function original(requests,deductions,branch=null){
 const name=value=>String(value||'').trim().toLowerCase(),rows=requests.filter(row=>!branch||row.branch===branch).map(row=>({...row})),paired=new Set();
 const same=(r,d)=>{if(d.requestId)return r.id===d.requestId;if(r.deductionId)return r.deductionId===d.id;if(!isMealDeduction(r.type)||name(r.staffName)!==name(d.staffName))return false;if(r.branch&&d.branch&&r.branch!==d.branch)return false;if(r.receiptId&&d.receiptId)return r.receiptId===d.receiptId;const time=historyTime(r.timestamp);return time>0&&Math.floor(time/1000)===Math.floor(historyTime(d.dateAdded)/1000)&&Number(r.amount)===Number(d.amount)&&/^manager/i.test(r.type)===/^manager/i.test(d.type);};
 for(const d of deductions){if(!isMealDeduction(d.type)||!/\(\s*pos\s+auto\s*\)/i.test(d.type)||branch&&d.branch!==branch)continue;const match=rows.find(r=>r.status!=='Pending'&&!paired.has(r)&&r.historySource!=='deduction'&&same(r,d));if(match){paired.add(match);match.deductionStatus=d.status||'Unpaid';}else rows.push({...d,historySource:'deduction',status:'Recorded',deductionStatus:d.status||'Unpaid',timestamp:d.dateAdded||d.timestamp});}
 return rows.sort((a,b)=>historyTime(b.timestamp)-historyTime(a.timestamp));
}
const at=n=>new Date(1900000000000+n*1000),meal=(id,extra={})=>({id,type:'Staff Meal (POS Auto)',staffName:'Sample Crew',branch:'Sample Branch',status:'Approved',amount:40,timestamp:at(1),...extra}),deduct=(id,extra={})=>({...meal(id),status:'Unpaid',dateAdded:at(1),...extra});
test('indexed pairing preserves first-eligible links, receipts, branch wildcards, status and partial legacy evidence',()=>{
 const requests=[meal('linked',{type:'Other',status:'Approved',branch:'Other'}),meal('by-ded',{deductionId:'exact',receiptId:'wrong'}),meal('first',{receiptId:'receipt',amount:999,timestamp:at(9)}),meal('second',{receiptId:'receipt'}),meal('blank',{branch:'',receiptId:''}),meal('pending',{status:'Pending'}),meal('explicit-mismatch',{deductionId:'never'}),meal('invalid',{amount:'invalid'})];
 const deductions=[deduct('link',{requestId:'linked',amount:1,staffName:'Different'}),deduct('exact',{amount:2}),deduct('receipt-1',{receiptId:'receipt'}),deduct('receipt-2',{receiptId:'receipt'}),deduct('blank-1',{branch:'Other'}),deduct('extra',{receiptId:'another'}),deduct('non-auto',{type:'Staff Meal'})];
 assert.deepEqual(requestHistory(requests,deductions),original(requests,deductions));assert.equal(requests.some(r=>r.deductionStatus),false);
});
test('randomized legacy histories exactly match prior one-to-one reconciliation and order',()=>{
 let seed=0x12345678;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},pick=values=>values[random(values.length)];
 for(let run=0;run<250;run++){
  const requests=Array.from({length:80},(_,i)=>meal('r'+i,{staffName:pick(['Sample Crew',' sample crew ','Other',null]),type:pick(['Staff Meal','Staff Meal (POS Auto)','Manager Meal (POS Auto)','Other']),branch:pick(['Sample Branch','Other','']),status:pick(['Approved','Rejected','Pending','Recorded']),timestamp:at(random(5)),amount:pick([0,20,40,'40','invalid',null]),receiptId:pick(['','receipt-1','receipt-2',null]),deductionId:pick([null,null,null,'d'+random(80)]),historySource:pick([undefined,undefined,'deduction'])}));
  const deductions=Array.from({length:80},(_,i)=>deduct('d'+i,{staffName:pick(['Sample Crew','sample crew','Other',null]),type:pick(['Staff Meal (POS Auto)','Manager Meal (POS Auto)','Staff Meal','Other']),branch:pick(['Sample Branch','Other','']),dateAdded:at(random(5)),amount:pick([0,20,40,'40','invalid',null]),receiptId:pick(['','receipt-1','receipt-2',null]),requestId:pick([null,null,null,'r'+random(80)]),status:pick(['Paid','Unpaid',null])}));
  for(const branch of [null,'Sample Branch','Other'])assert.deepEqual(requestHistory(requests,deductions,branch),original(requests,deductions,branch),'run '+run+' branch '+branch);
 }
});
test('large unrelated automatic meal histories retain every orphan and source record',()=>{
 const requests=Array.from({length:3000},(_,i)=>meal('r'+i,{staffName:'Staff '+i})),deductions=Array.from({length:3000},(_,i)=>deduct('d'+i,{staffName:'Legacy '+i}));
 const rows=requestHistory(requests,deductions);assert.equal(rows.length,6000);assert.equal(rows.filter(row=>row.historySource==='deduction').length,3000);assert.equal(new Set(rows.map(row=>row.id)).size,6000);
});
