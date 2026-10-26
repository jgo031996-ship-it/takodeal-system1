import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cashCents,cashCanonical,normalizeCashTransferIntent,calculateDrawerSnapshot,reconcileCashCount,MAX_CASH_CENTS} from '../Takodeal-POS/cash-remittance-model.js';
const at='2026-10-26T12:00:00Z',start='2026-10-26T01:00:00Z',closedAt='2026-10-26T09:00:00Z';
const active=()=>({id:'drawer_1',branch:'Maa',active:true,startTime:start,startingCash:2000,salesRevision:3});
const closed=()=>({id:'drawer_1',branch:'Maa',active:false,status:'Closed',startTime:start,endTime:closedAt,startingCash:2000,declaredCash:26000});
const sale=(id,patch={})=>({id,branch:'Maa',shiftId:'drawer_1',timestamp:'2026-10-26T02:00:00Z',paymentMethod:'Cash',netTotal:1000,...patch});
const expense=(id,patch={})=>({id,branch:'Maa',shiftId:'drawer_1',amount:400,paidFrom:'Drawer',timestamp:'2026-10-26T03:00:00Z',...patch});
const snapshot=(patch={})=>calculateDrawerSnapshot({shift:active(),transactions:[],expenses:[],asOf:at,branch:'Maa',...patch});
const intent=(patch={})=>({branch:'Maa',sourceShiftId:'drawer_1',channel:'Cash',recipient:'HQ cashier',referenceNumber:'',salesPeriodStart:'2026-10-01',salesPeriodEnd:'2026-10-26',amount:'22500.00',...patch});
test('cash values become exact centavos without accepting meaningful fractions, coercions or unsafe totals',()=>{
 for(const [value,wanted]of [[0,0],['0.00',0],['001.20',120],['12327.75',1232775],[0.1+0.2,30],[MAX_CASH_CENTS/100,MAX_CASH_CENTS]])assert.equal(cashCents(value),wanted);
 for(const value of ['',null,undefined,true,{},[],NaN,Infinity,-1,'-0','1.001','1e3','₱100','1,000',1.001,MAX_CASH_CENTS/100+1])assert.throws(()=>cashCents(value));
});
test('intent normalizes transfer details and rejects invalid cash, dates, source IDs and missing recipients',()=>{
 const normalized=normalizeCashTransferIntent(intent({branch:' Maa ',referenceNumber:' REF-1 '}));assert.equal(normalized.amountCents,2250000);assert.equal(normalized.branch,'Maa');assert.equal(normalized.referenceNumber,'REF-1');assert.equal('cashier'in normalized,false);
 for(const patch of [{amount:0},{amount:'2.345'},{salesPeriodStart:'2026-02-30'},{salesPeriodEnd:'2026-01-01'},{sourceShiftId:'../bad'},{recipient:''},{channel:''}])assert.throws(()=>normalizeCashTransferIntent(intent(patch)));
});
test('active drawer includes opening float, every cash split, drawer expenses and earlier transfers exactly once',()=>{
 const s=snapshot({transactions:[sale('cash'),sale('split',{netTotal:1000,paymentMethod:'Split',splitDetails:[{method:'Cash',amount:300},{method:' cash ',amount:200},{method:'GCash',amount:500}]}),sale('digital',{paymentMethod:'Grab',netTotal:4000})],expenses:[expense('supplies'),expense('remittance',{amount:200,remittanceId:'transfer_1',cashMovement:'Remittance'}),expense('fund',{amount:9999,paidFrom:'Manager Fund'}),expense('bank',{amount:500,paidFrom:'PNB'})]});
 assert.equal(s.openingCashCents,200000);assert.equal(s.cashSalesCents,150000);assert.equal(s.drawerExpenseCents,40000);assert.equal(s.priorRemittanceCents,20000);assert.equal(s.expectedBeforeCents,290000);assert.equal(s.basis,'active-ledger');
});
test('partial remittance with counted cash retained is balanced rather than a fictitious shortage',()=>{
 const s=snapshot({shift:{...active(),startingCash:34827.75}}),count=reconcileCashCount(s,{amount:22500,countedRemaining:12327.75,countConfirmed:true});
 assert.equal(count.varianceCents,0);assert.equal(count.expectedRemainingCents,1232775);assert.equal(count.countedBeforeCents,3482775);
});
test('counted retained cash detects a genuine shortage and overage, requires a reason and preserves signed results',()=>{
 const s=snapshot();assert.throws(()=>reconcileCashCount(s,{amount:1000,countedRemaining:500,countConfirmed:true}),/Explain/);
 const shortage=reconcileCashCount(s,{amount:1000,countedRemaining:500,varianceReason:'Cash recounted; drawer is short.',countConfirmed:true});assert.equal(shortage.varianceCents,-50000);assert.equal(shortage.expectedRemainingCents,100000);
 const overage=reconcileCashCount(s,{amount:2250,countedRemaining:0,varianceReason:'Actual cash exceeds recorded receipts.',countConfirmed:true});assert.equal(overage.varianceCents,25000);assert.equal(overage.expectedRemainingCents,-25000);
 for(const input of [{amount:0,countedRemaining:0,countConfirmed:true},{amount:100,countedRemaining:'',countConfirmed:true},{amount:100,countedRemaining:1900,countConfirmed:false},{amount:100,countedRemaining:1900.001,countConfirmed:true}])assert.throws(()=>reconcileCashCount(s,input));
});
test('negative recorded cash is kept visible instead of silently becoming zero',()=>{
 const s=snapshot({shift:{...active(),startingCash:0},expenses:[expense('large',{amount:100})]});assert.equal(s.expectedBeforeCents,-10000);
 const count=reconcileCashCount(s,{amount:1,countedRemaining:0,varianceReason:'Recorded expense needs HQ reconciliation.',countConfirmed:true});assert.equal(count.varianceCents,10100);
});
test('parked, draft, voided, unpaid and locally pending receipts do not become cash sales',()=>{
 const transactions=['Parked','Draft','Voided','Unpaid','Pending','Pending Sync','mobile_queue','Cancelled'].map((status,i)=>sale('excluded_'+i,{status,netTotal:'invalid-excluded-value'}));transactions.push(sale('notuploaded',{isPendingSync:true}),sale('unpaidmethod',{paymentMethod:'UNPAID'}),sale('salary',{paymentMethod:'Salary Deduction'}));assert.equal(snapshot({transactions}).cashSalesCents,0);
});
test('explicit foreign branches and drawer IDs cannot contaminate cash totals',()=>{
 const s=snapshot({transactions:[sale('foreign',{branch:'Cabantian'}),sale('old',{shiftId:'previous'})],expenses:[expense('foreign',{branch:'Cabantian'}),expense('old',{shiftId:'previous'})]});assert.equal(s.expectedBeforeCents,200000);
});
test('unlinked same-branch legacy cash is held for reconciliation, while old and known digital records cannot inflate the drawer',()=>{
 for(const shiftId of [undefined,'','UNKNOWN'])assert.throws(()=>snapshot({transactions:[sale('legacy',{shiftId})]}),/no verified drawer link/);
 assert.equal(snapshot({transactions:[sale('old',{shiftId:'UNKNOWN',timestamp:'2026-10-25T10:00:00Z'}),sale('digital',{shiftId:undefined,paymentMethod:'GCash'})]}).expectedBeforeCents,200000);
});
test('explicit receipt drawer IDs survive inaccurate tablet clocks, rather than dropping already committed cash',()=>{
 for(const timestamp of ['2026-10-25T02:00:00Z','2026-10-27T02:00:00Z'])assert.equal(snapshot({transactions:[sale('clock',{timestamp})]}).cashSalesCents,100000);
});
test('ambiguous methods, unknown statuses and inconsistent split totals cannot claim a verified drawer balance',()=>{
 for(const patch of [{paymentMethod:undefined},{paymentMethod:'Unknown'},{paymentMethod:'Split',splitDetails:[]},{status:'Possibly Paid'},{paymentMethod:'Split',splitDetails:[{method:'Cash',amount:999}]},{paymentMethod:'Split',splitDetails:[{method:'Cash',amount:-1},{method:'GCash',amount:1001}]},{paymentMethod:'Split',splitDetails:[{amount:1000}]}])assert.throws(()=>snapshot({transactions:[sale('bad',patch)]}));
});
test('normal posted cash receipts without a status field remain supported',()=>{assert.equal(snapshot({transactions:[sale('normal')]}).expectedBeforeCents,300000);});
test('closed drawer uses actual retained cash and does not deduct an already adjusted remittance again',()=>{
 const s=snapshot({shift:{...closed(),retainedCash:2000},expenses:[expense('posted',{shiftId:'Accumulated_Floating',cashSourceShiftId:'drawer_1',amount:24000,remittanceId:'transfer_1',carryAlreadyAdjusted:true,timestamp:'2026-10-26T10:00:00Z'})]});assert.equal(s.expectedBeforeCents,200000);assert.equal(s.priorRemittanceCents,0);assert.equal(s.closedBaselineField,'retainedCash');
});
test('legacy post-close remittances reduce carry once, retaining references needed for migration',()=>{
 const legacy=expense('legacy',{shiftId:'Accumulated_Floating',amount:24000,description:'[REMITTANCE TO HQ] - Cash to HQ',timestamp:'2026-10-26T10:00:00Z'});
 const before=snapshot({shift:closed(),expenses:[legacy]});assert.equal(before.expectedBeforeCents,200000);assert.equal(before.priorRemittanceCents,2400000);assert.deepEqual(before.legacyCarryExpenseIds,['legacy']);
 const after=snapshot({shift:{...closed(),retainedCash:1000,legacyCarryExpenseIds:['legacy']},expenses:[legacy]});assert.equal(after.expectedBeforeCents,100000);assert.equal(after.priorRemittanceCents,0);
});
test('a closed physical handover does not recount historical receipts or invent a positive expected checkpoint',()=>{
 const s=snapshot({shift:{...closed(),expectedRetainedCash:-250,retainedCash:0},transactions:[sale('old-unlinked',{shiftId:'UNKNOWN'})]});assert.equal(s.expectedBeforeCents,-25000);assert.equal(s.cashSalesCents,0);
});
test('closed expected checkpoint takes precedence while its actual retained count stays in the source fingerprint',()=>{
 const s=snapshot({shift:{...closed(),expectedRetainedCash:5000,retainedCash:4500}});assert.equal(s.expectedBeforeCents,500000);assert.equal(s.closedBaselineField,'expectedRetainedCash');assert.match(s.sourceCanonical,/"retainedCash":4500/);
});
test('closed post-close drawer expenses are included; old boundary expenses and manager funds are excluded',()=>{
 const s=snapshot({shift:closed(),expenses:[expense('boundary',{timestamp:closedAt}),expense('before',{timestamp:'2026-10-26T08:59:59Z'}),expense('after',{cashSourceShiftId:'drawer_1',timestamp:'2026-10-26T10:00:00Z'}),expense('manager',{paidFrom:'Manager Fund',timestamp:'2026-10-26T10:30:00Z'})]});assert.equal(s.expectedBeforeCents,2560000);assert.equal(s.drawerExpenseCents,40000);
});
test('missing closed cash, conflicting fund/drawer links and unassigned post-close expenses require HQ review',()=>{
 for(const s of [{...closed(),declaredCash:undefined},{...closed(),active:false,status:'Opening'}])assert.throws(()=>snapshot({shift:s}));
 for(const e of [expense('mixed',{paidFrom:'Drawer',sourceAccount:'Manager Fund'}),expense('wrong',{cashSourceShiftId:'other'}),expense('floating',{shiftId:'Accumulated_Floating',timestamp:'2026-10-26T10:00:00Z'}),expense('future',{timestamp:'2026-10-27T10:00:00Z'})])assert.throws(()=>snapshot({shift:closed(),expenses:[e]}));
});
test('duplicate source IDs or linked remittance expenses cannot be silently summed twice',()=>{
 assert.throws(()=>snapshot({transactions:[sale('duplicate'),sale('duplicate')]}),/duplicate saved IDs/);assert.throws(()=>snapshot({expenses:[expense('duplicate'),expense('duplicate')]}),/duplicate saved IDs/);
 assert.throws(()=>snapshot({expenses:[expense('one',{remittanceId:'same'}),expense('two',{remittanceId:'same'})]}),/More than one drawer expense/);
});
test('source fingerprint is stable across later quote times and input order but changes with every financial source mutation',()=>{
 const one=sale('one'),two=sale('two',{netTotal:500}),cost=expense('cost'),a=snapshot({transactions:[one,two],expenses:[cost]}),b=snapshot({transactions:[two,one],expenses:[cost],asOf:'2026-10-26T13:00:00Z'});assert.equal(a.sourceCanonical,b.sourceCanonical);assert.notEqual(a.asOf,b.asOf);
 for(const patch of [{transactions:[one,{...two,netTotal:600}],expenses:[cost]},{transactions:[one,{...two,status:'Voided'}],expenses:[cost]},{transactions:[one,two],expenses:[{...cost,amount:401}]},{shift:{...active(),startingCash:2001},transactions:[one,two],expenses:[cost]},{shift:{...active(),salesRevision:4},transactions:[one,two],expenses:[cost]}])assert.notEqual(snapshot(patch).sourceCanonical,a.sourceCanonical);
});
test('irrelevant stock/UI changes and non-cash receipts do not invalidate a counted cash source',()=>{
 const a=snapshot({transactions:[sale('cash')]}),b=snapshot({shift:{...active(),cashier:'Different display log',physicalStockCount:[{name:'Food'}]},transactions:[sale('cash'),sale('digital',{paymentMethod:'Foodpanda'})]});assert.equal(a.sourceCanonical,b.sourceCanonical);
});
test('timestamps and malformed source amounts fail closed instead of fabricating a balance',()=>{
 for(const patch of [{asOf:'not-a-date'},{shift:{...active(),startTime:'not-a-date'}},{shift:{...active(),branch:'Other'}},{shift:{...active(),startingCash:undefined}},{expenses:[expense('fraction',{amount:1.001})]},{transactions:[sale('fraction',{netTotal:'1.001'})]}])assert.throws(()=>snapshot(patch));
});
test('canonical serialization rejects unsupported values and is stable across object key ordering',()=>{assert.equal(cashCanonical({b:2,a:{y:3,x:1}}),cashCanonical({a:{x:1,y:3},b:2}));for(const value of [NaN,Infinity,undefined,()=>1])assert.throws(()=>cashCanonical(value));});
test('Cashier, Owner and verification service use byte-identical money and drawer calculations',()=>{
 const source=readFileSync(new URL('../Takodeal-POS/cash-remittance-model.js',import.meta.url),'utf8');assert.equal(source,readFileSync(new URL('../takodeal-manager/cash-remittance-model.js',import.meta.url),'utf8'));assert.equal(source,readFileSync(new URL('../functions/cash-remittance-review/cash-remittance-model.js',import.meta.url),'utf8'));
});
