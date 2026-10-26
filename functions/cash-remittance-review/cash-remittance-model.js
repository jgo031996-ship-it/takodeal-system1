// One cash model for the Cashier preview, Owner review and trusted service.
// Amounts remain integer centavos; sourceCanonical deliberately excludes asOf.
export const MAX_CASH_CENTS = 1_000_000_000_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const clean=value=>String(value??'').trim();
const lower=value=>clean(value).toLowerCase().replace(/[_\s]+/g,' ');
const invalid=message=>{throw Error(message);};
export function cashCents(value,label='Amount'){
 if(typeof value==='string'){
  const text=value.trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))invalid(label+' must be a non-negative amount with at most 2 decimal places.');
  const [whole,fraction='']=text.split('.'),result=Number(whole)*100+Number((fraction+'00').slice(0,2));
  if(!Number.isSafeInteger(result)||result>MAX_CASH_CENTS)invalid(label+' is too large.');return result;
 }
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)invalid(label+' must be a non-negative finite amount.');
 const scaled=value*100,result=Math.round(scaled);
 // Arithmetic-generated numbers can contain insignificant binary noise, but a
 // genuine fraction of a cent must be reviewed rather than silently rounded.
 if(Math.abs(scaled-result)>0.000001)invalid(label+' has more than 2 decimal places.');
 if(!Number.isSafeInteger(result)||result>MAX_CASH_CENTS)invalid(label+' is too large.');return result;
}
function safeSum(values,label){const result=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(result)||Math.abs(result)>MAX_CASH_CENTS)invalid(label+' exceeds the supported cash amount.');return result;}
function signedCents(value,label){if(typeof value==='number'&&value<0)return -cashCents(-value,label);if(typeof value==='string'&&value.trim().startsWith('-'))return -cashCents(value.trim().slice(1),label);return cashCents(value,label);}
function key(value,label){if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(value))invalid(label+' needs a saved record ID.');return value;}
function text(value,label,max,{optional=false}={}){if(typeof value!=='string'||!optional&&!value.trim()||value.trim().length>max)invalid(label+' is required and must be at most '+max+' characters.');return value.trim();}
function day(value,label){const result=text(value,label,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||new Date(result+'T12:00:00Z').toISOString().slice(0,10)!==result)invalid(label+' must be a valid calendar date.');return result;}
export function normalizeCashTransferIntent(input){
 if(!object(input))invalid('Check the remittance details.');
 const result={branch:text(input.branch,'Branch',120),sourceShiftId:key(input.sourceShiftId,'Drawer'),channel:text(input.channel,'Transfer method',120),recipient:text(input.recipient,'Recipient',160),referenceNumber:text(input.referenceNumber??'','Transfer reference',200,{optional:true}),salesPeriodStart:day(input.salesPeriodStart,'Sales period start'),salesPeriodEnd:day(input.salesPeriodEnd,'Sales period end'),amountCents:cashCents(input.amount,'Cash being remitted')};
 if(!result.amountCents)invalid('Cash being remitted must be greater than zero.');if(result.salesPeriodEnd<result.salesPeriodStart)invalid('Sales period end must not precede its start.');return result;
}
export function cashCanonical(value){
 const normalize=(item)=>{
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(typeof item==='number'){if(!Number.isFinite(item))invalid('A cash source contains an invalid number.');return item;}
  if(Array.isArray(item))return item.map(normalize);
  if(object(item))return Object.fromEntries(Object.keys(item).sort().filter(name=>item[name]!==undefined).map(name=>[name,normalize(item[name])]));
  invalid('A cash source contains an unsupported value.');
 };return JSON.stringify(normalize(value));
}
function milliseconds(value,label,{optional=false}={}){
 if(value===undefined||value===null){if(optional)return null;invalid(label+' is missing.');}
 let stamp;if(typeof value?.toMillis==='function')stamp=value.toMillis();else if(typeof value?.toDate==='function')stamp=+value.toDate();else if(object(value)&&Number.isFinite(value.seconds))stamp=value.seconds*1000+Number(value.nanoseconds||0)/1e6;else stamp=typeof value==='number'?value:+new Date(value);
 if(!Number.isFinite(stamp)||!Number.isFinite(+new Date(stamp)))invalid(label+' is invalid.');return stamp;
}
const iso=(value,label,optional=false)=>{const at=milliseconds(value,label,{optional});return at===null?null:new Date(at).toISOString();};
function records(rows,label){if(!Array.isArray(rows)||rows.length>10000)invalid(label+' could not be confirmed within the review limit.');const seen=new Set();for(const row of rows){if(!object(row))invalid(label+' contains an invalid row.');key(row.id,label);if(seen.has(row.id))invalid(label+' contains duplicate saved IDs. Refresh the cash review.');seen.add(row.id);}return rows;}
const pendingStatuses=new Set(['voided','void','cancelled','canceled','parked','draft','unpaid','pending','pending sync','mobile queue','rejected','deleted']);
function excludedReceipt(row){return pendingStatuses.has(lower(row.status))||pendingStatuses.has(lower(row.paymentStatus))||row.isPendingSync===true;}
function receiptCash(row){
 if(excludedReceipt(row))return 0;
 const method=lower(row.paymentMethod);
 if(!own(row,'splitDetails')&&method&&method!=='cash'&&method!=='unknown'&&!method.startsWith('split'))return 0;
 if(row.status!==undefined&&row.status!==null&&clean(row.status)&&!['paid','completed','complete','settled','received'].includes(lower(row.status)))invalid('Receipt '+row.id+' has an unrecognized payment status. Ask HQ to review it.');
 const total=cashCents(row.netTotal,'Receipt '+row.id+' total');
 if(own(row,'splitDetails')){
  if(!Array.isArray(row.splitDetails)||!row.splitDetails.length||row.splitDetails.length>20)invalid('Receipt '+row.id+' has an invalid split payment.');
  let cash=0,sum=0;
  for(const split of row.splitDetails){if(!object(split)||!clean(split.method))invalid('Receipt '+row.id+' has an unidentified split payment.');const amount=cashCents(split.amount,'Receipt '+row.id+' split amount');sum=safeSum([sum,amount],'Split payment');if(lower(split.method)==='cash')cash=safeSum([cash,amount],'Cash sales');if(['unpaid','unpaid / deleted','unknown'].includes(lower(split.method)))invalid('Receipt '+row.id+' has an unpaid or unknown split.');}
  if(sum!==total)invalid('Receipt '+row.id+' split payments do not match its saved total. Ask HQ to review it.');return cash;
 }
 if(!method||method==='unknown'||method.startsWith('split'))invalid('Receipt '+row.id+' has no verified payment method. Ask HQ to review it.');
 if(method.startsWith('unpaid'))return 0;return method==='cash'?total:0;
}
function receiptProjection(row){return{id:row.id,branch:row.branch??null,shiftId:row.shiftId??null,status:row.status??null,paymentStatus:row.paymentStatus??null,isPendingSync:row.isPendingSync===true,paymentMethod:row.paymentMethod??null,netTotal:row.netTotal??null,splitDetails:row.splitDetails??null,timestamp:iso(row.timestamp??row.localTimestamp,'Receipt '+row.id+' timestamp',true)};}
function isRemittance(row){return Boolean(row.remittanceId)||lower(row.cashMovement)==='remittance'||lower(row.category)==='cash remittance'||/^\[REMITTANCE TO HQ\]/i.test(clean(row.description));}
function drawerFund(row){
 const sources=[row.paidFrom,row.sourceAccount,row.paymentSource].filter(value=>value!==undefined&&value!==null&&clean(value)).map(lower),drawer=sources.some(value=>['drawer','cash drawer','pos drawer'].includes(value)),manager=sources.some(value=>['manager fund',"manager's floating cash",'manager floating cash','manager floating'].includes(value));
 if(drawer&&manager)invalid('Expense '+row.id+' has conflicting cash sources. Ask HQ to review it.');
 if(manager)return false;
 // Explicit bank/HQ sources are not branch drawer withdrawals. Older expenses
 // with an exact drawer shift but no source follow their saved drawer link.
 if(sources.length&&!drawer)return false;return true;
}
function expenseProjection(row){return{id:row.id,branch:row.branch??null,shiftId:row.shiftId??null,cashSourceShiftId:row.cashSourceShiftId??null,amount:row.amount??null,paidFrom:row.paidFrom??null,sourceAccount:row.sourceAccount??null,paymentSource:row.paymentSource??null,category:row.category??null,cashMovement:row.cashMovement??null,remittanceId:row.remittanceId??null,carryAlreadyAdjusted:row.carryAlreadyAdjusted===true,description:isRemittance(row)?'[REMITTANCE TO HQ]':null,timestamp:iso(row.timestamp,'Expense '+row.id+' timestamp',true)};}
function shiftProjection(shift){const result={id:shift.id,branch:shift.branch,active:shift.active===true,status:shift.status??null,startTime:iso(shift.startTime,'Drawer start time',true),endTime:iso(shift.endTime,'Drawer close time',true)};for(const field of ['startingCash','expectedRetainedCash','retainedCash','declaredCash','actualCash','manualRemittanceCashOut','cashOut','expenses','salesRevision','cashMovementRevision','remittanceRevision','legacyCarryExpenseIds','remittedCash','remittanceId','cashPolicyVersion'])result[field]=shift[field]??null;return result;}
export function calculateDrawerSnapshot({shift,transactions=[],expenses=[],asOf,branch}={}){
 if(!object(shift))invalid('The saved drawer could not be confirmed.');const sourceShiftId=key(shift.id,'Drawer'),checkedBranch=text(branch,'Branch',120);if(shift.branch!==checkedBranch)invalid('The saved drawer belongs to another branch.');
 const instant=milliseconds(asOf,'Cash review time'),active=shift.active===true;if(!active&&(shift.active!==false||lower(shift.status)!=='closed'))invalid('The source drawer is neither active nor a verified closed drawer.');
 const started=milliseconds(shift.startTime,'Drawer start time',{optional:!active}),ended=active?null:milliseconds(shift.endTime,'Drawer close time');if(started!==null&&started>instant||ended!==null&&ended>instant)invalid('The saved drawer time is ahead of HQ. Ask HQ to review the drawer.');
 if(!Array.isArray(shift.legacyCarryExpenseIds??[])||(shift.legacyCarryExpenseIds??[]).some(value=>typeof value!=='string'))invalid('The saved legacy cash handover needs HQ review.');
 const sales=records(transactions,'Receipts'),costs=records(expenses,'Expenses'),sourceSales=[],sourceExpenses=[],cashValues=[],ordinary=[],remits=[],remitIds=new Set(),applied=new Set(shift.legacyCarryExpenseIds??[]);
 for(const sale of (active?sales:[])){
  if(sale.branch!==checkedBranch)continue;
  const linked=sale.shiftId===sourceShiftId,legacy=!clean(sale.shiftId)||sale.shiftId==='UNKNOWN';if(!linked&&!legacy)continue;
  // Completed receipts with an exact drawer link remain cash movements even if
  // the tablet's clock was wrong. Legacy unlinked receipts cannot be guessed.
  if(!linked){const at=milliseconds(sale.timestamp??sale.localTimestamp,'Receipt '+sale.id+' timestamp',{optional:true});if(at!==null&&started!==null&&at<started)continue;const amount=receiptCash(sale);if(amount)invalid('Cash receipt '+sale.id+' has no verified drawer link. Ask HQ to reconcile it before remitting.');continue;}
  if(active){const amount=receiptCash(sale);if(amount){sourceSales.push(receiptProjection(sale));cashValues.push(amount);}}
 }
 for(const cost of costs){
  if(cost.branch!==checkedBranch)continue;const linked=cost.shiftId===sourceShiftId||cost.cashSourceShiftId===sourceShiftId,floating=cost.shiftId==='Accumulated_Floating'&&!clean(cost.cashSourceShiftId);if(!linked&&!floating)continue;
  if(cost.shiftId===sourceShiftId&&clean(cost.cashSourceShiftId)&&cost.cashSourceShiftId!==sourceShiftId)invalid('Expense '+cost.id+' has conflicting drawer links. Ask HQ to review it.');
  if(!drawerFund(cost))continue;
  if(!active){if(applied.has(cost.id)||cost.carryAlreadyAdjusted===true){sourceExpenses.push(expenseProjection(cost));continue;}const at=milliseconds(cost.timestamp,'Expense '+cost.id+' timestamp');if(at<=ended)continue;if(at>instant)invalid('Expense '+cost.id+' has a future cash movement time. Ask HQ to review it.');if(!linked&&!isRemittance(cost))invalid('A post-close cash expense has no verified source drawer. Ask HQ to reconcile it.');}
  else if(!linked)invalid('A floating cash expense cannot be assigned to this active drawer. Ask HQ to reconcile it.');
  sourceExpenses.push(expenseProjection(cost));const amount=cashCents(cost.amount,'Expense '+cost.id+' amount');if(!active)applied.add(cost.id);if(isRemittance(cost)){if(cost.remittanceId){if(remitIds.has(cost.remittanceId))invalid('More than one drawer expense refers to remittance '+cost.remittanceId+'. Ask HQ to review the duplicate.');remitIds.add(cost.remittanceId);}remits.push(amount);}else ordinary.push(amount);
 }
 const openingCashCents=shift.startingCash===undefined||shift.startingCash===null?(active?invalid('The drawer opening cash is missing.'):0):cashCents(shift.startingCash,'Opening drawer cash'),cashSalesCents=safeSum(cashValues,'Cash sales'),drawerExpenseCents=safeSum(ordinary,'Drawer expenses'),priorRemittanceCents=safeSum(remits,'Previous remittances');
 let basis='active-ledger',closedBaselineCents=null,closedBaselineField=null;
 if(!active){basis='closed-handover';closedBaselineField=['expectedRetainedCash','retainedCash','declaredCash','actualCash'].find(field=>shift[field]!==undefined&&shift[field]!==null);if(!closedBaselineField)invalid('The closed drawer has no recorded retained cash. Ask HQ to reconcile it.');closedBaselineCents=closedBaselineField==='expectedRetainedCash'?signedCents(shift[closedBaselineField],'Expected closed drawer cash'):cashCents(shift[closedBaselineField],'Closed drawer cash');}
 const expectedBeforeCents=safeSum([active?openingCashCents:closedBaselineCents,active?cashSalesCents:0,-drawerExpenseCents,-priorRemittanceCents],'Expected drawer cash');
 const order=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0,sourceCanonical=cashCanonical({version:1,branch:checkedBranch,shift:shiftProjection(shift),transactions:sourceSales.sort(order),expenses:sourceExpenses.sort(order)});
 return{version:1,branch:checkedBranch,sourceShiftId,active,basis,asOf:new Date(instant).toISOString(),openingCashCents,cashSalesCents,drawerExpenseCents,priorRemittanceCents,closedBaselineCents,closedBaselineField,expectedBeforeCents,legacyCarryExpenseIds:[...applied].sort(),sourceCanonical};
}
export function reconcileCashCount(snapshot,{amount,countedRemaining,varianceReason='',countConfirmed}={}){
 if(!object(snapshot)||snapshot.version!==1||!Number.isSafeInteger(snapshot.expectedBeforeCents)||Math.abs(snapshot.expectedBeforeCents)>MAX_CASH_CENTS)invalid('Refresh the verified drawer cash before counting.');
 if(countConfirmed!==true)invalid('Confirm that the cash handed over and the remaining drawer cash were physically counted.');
 const sentCents=cashCents(amount,'Cash being remitted'),countedRemainingCents=cashCents(countedRemaining,'Counted cash remaining');if(!sentCents)invalid('Cash being remitted must be greater than zero.');
 const countedBeforeCents=safeSum([sentCents,countedRemainingCents],'Counted drawer cash'),expectedRemainingCents=safeSum([snapshot.expectedBeforeCents,-sentCents],'Expected cash remaining'),varianceCents=safeSum([countedBeforeCents,-snapshot.expectedBeforeCents],'Drawer variance'),note=text(varianceReason,'Variance explanation',1500,{optional:true});
 if(varianceCents!==0&&note.length<8)invalid('Explain the actual cash shortage or overage in at least 8 characters. The difference will be sent to the Owner for review.');
 return{sentCents,expectedRemainingCents,countedRemainingCents,countedBeforeCents,varianceCents,varianceReason:note,countConfirmed:true};
}
