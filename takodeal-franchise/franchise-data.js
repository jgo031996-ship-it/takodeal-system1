import { resolveAttendanceShift, attendanceLateMinutes, latePay, earnedNightBonus } from './payroll-safety.js';
import { resolveScheduleForDate } from './schedule-history.js';

export const RELEASE = 'franchise-workspace-20261005-r1';
export const ROUTES = {
 dashboard: ['Store Dashboard','Sales, expenses and staff activity for your branch.','loadDashboard',true],
 accounts: ['Cash & Budget','Manage branch cash accounts and monthly spending.','loadAccountsView',false],
 'hq-billing': ['HQ Billing & Royalties','Review charges, payments and your balance with Main Office.','loadHQBilling',false],
 payroll: ['Payroll & Time Feed','Review attendance and payroll estimates for the selected dates.','loadPayrollGenerator',true,'hr'],
 schedule: ['Schedule Manager','Plan and save staff assignments for your branch.','loadScheduleFromCloud',false,'hr'],
 inbox: ['Request Inbox','Review pending staff requests and past decisions.','loadInbox',false,'hr'],
 sanctions: ['Disciplinary Actions','Track notices, staff replies and resolutions.','loadSanctionsDashboard',false,'hr'],
 'inv-overview': ['Inventory Overview','Search current stock, categories and stock availability.','loadLiveInventory',false,'inventory'],
 'inv-audits': ['Audits & Accuracy','Review physical stock counts and recorded variances.','loadInventoryAudits',true,'inventory'],
 'inv-waste': ['Waste & Spoilage','Track waste quantities and reasons.','loadInventoryWaste',true,'inventory'],
 'inv-prep': ['Prep Batch Logs','Review prepared batches and kitchen production.','loadPrepBatchLogs',true,'inventory'],
 'inv-logs': ['Stock History','Trace receipts, usage and stock adjustments.','loadStockLogs',true,'inventory'],
 'inv-alerts': ['Low Stock Alerts','Review items below their saved reorder levels.','loadPurchasesAndAlerts',false,'inventory'],
 b2b: ['B2B Supply Orders','Request approved supplies and receive deliveries from HQ.','loadB2BSupply',false],
 history: ['Sales History','Review receipts, payment methods and voided orders.','loadSalesHistory',true],
 zreadings: ['Z-Reading Reports','Review closed shifts, cash counts and digital sales.','loadZReadings',true],
 expenses: ['Expense Logs','Review branch expenses and account deductions.','loadExpenses',true],
 bulletin: ['HQ Announcements','Read HQ notices and track your acknowledgments.','loadAnnouncements',false]
};
export const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const money = value => '₱' + n(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ms = value => value?.toMillis ? value.toMillis() : value?.toDate ? +value.toDate() : value?.seconds != null ? value.seconds*1000 : value == null ? 0 : +new Date(value) || 0;
export const calendarDay = (value=Date.now()) => new Date(ms(value)+8*3600000).toISOString().slice(0,10);
export const businessDay = (value=Date.now()) => calendarDay(ms(value)-8.5*3600000);
export const addDays = (day,count) => new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);
export function range(start,end) {
 const valid=day=>/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10)===day;
 if (!valid(start) || !valid(end) || start>end) throw new Error('Choose a valid start and end date.');
 if ((Date.parse(end)-Date.parse(start))/86400000>366) throw new Error('Choose a date range of one year or less.');
 return {start:new Date(start+'T08:30:00+08:00'),end:new Date(addDays(end,1)+'T08:30:00+08:00')};
}
export const dateText = value => ms(value) ? new Date(ms(value)).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Time unavailable';
export const stockQty = item => n(item.currentStock ?? item.quantity);
export const itemName = item => String(item.name ?? item.itemName ?? item.item ?? 'Unnamed item');
export function lowStock(item) { return stockQty(item)<=n(item.reorderLevel ?? item.lowStockAlert ?? 0); }
export function isPaid(tx) {
 return !['voided','void','cancelled','canceled','pending','pending sync','parked','mobile_queue'].includes(String(tx.status || '').toLowerCase()) && String(tx.paymentStatus || '').toLowerCase()!=='unpaid' && tx.isPendingSync!==true && (tx.netTotal!=null || String(tx.status).toLowerCase()==='paid');
}
// Matches the Manager/Cashier ball counter; packaging and sauces never count as sales.
export function countBalls(cart=[]) {
 return cart.reduce((sum,item)=>{
  const name=[item.realName,item.name,item.itemName].filter(Boolean).join(' '), category=String(item.category || '');
  if (!/takoyaki/i.test(name+' '+category) || /extra|sauce|take\s*out|packaging|box/i.test(name)) return sum;
  const pack=(name+' '+(item.variantName || '')).match(/(\d+)\s*(?:pcs|pieces)\b/i),qty=Number(item.qty ?? 1);
  return !pack || !Number.isFinite(qty) || qty<=0 ? sum : sum+Number(pack[1])*qty;
 },0);
}
export function summarizeSales(rows) {
 const paid=rows.filter(isPaid),mix={},result={gross:0,net:0,discount:0,balls:0,orders:paid.length,mix};
 for (const row of paid) {
  const net=n(row.netTotal), gross=n(row.subTotalBeforeDiscount ?? row.subtotal ?? row.subTotal ?? net);
  result.gross+=gross;result.net+=net;result.discount+=Math.max(0,gross-net);
  const items=row.cart || row.items || [];result.balls+=n(row.ballsCounted ?? countBalls(items));
  for (const item of items) { const name=itemName(item);mix[name]=(mix[name] || 0)+n(item.qty ?? 1); }
 }
 return result;
}
export function closedShift(row) { return String(row.status || '').toLowerCase()==='closed' || (row.active===false && !!row.endTime); }
export function shiftReport(row) {
 const expected=n(row.expectedCash ?? row.cashExpected),declared=n(row.declaredCash ?? row.actualCash ?? row.cashActual),cash=n(row.totalCashSales),digital=n(row.totalDigitalSales);
 return {...row,expected,declared,variance:Math.round((declared-expected)*100)/100,cash,digital,net:n(row.netSales ?? row.netTotal ?? (cash+digital)),closedAt:row.endTime || row.timestamp || row.startTime};
}
export function branchScope(data,email,registered=[],masterEmail='jgo031996@gmail.com') {
 const role=String(data.role || '').toLowerCase(),master=email.toLowerCase()===masterEmail;
 const assigned=Array.isArray(data.assignedBranch) ? data.assignedBranch : String(data.assignedBranch || '').split(',');
 const branches=[...new Set(assigned.map(s=>String(s).trim()).filter(s=>s && s.toLowerCase()!=='all'))];
 if (master || (role!=='franchisee' && data.permissions?.includes('all') && assigned.some(s=>String(s).trim().toLowerCase()==='all'))) return [...new Set(registered.filter(Boolean))];
 return branches;
}
export function canVisit(session,route) {
 if (!session || !ROUTES[route] || !session.allowedBranches?.includes(session.branch)) return false;
 if (session.isOwner || session.permissions?.includes('all')) return true;
 const permission=ROUTES[route][4] || route;
 return route==='dashboard' || session.permissions?.includes(route) || session.permissions?.includes(permission) || (route==='expenses' && session.permissions?.includes('accounts'));
}
export function ledgerRows(rows) {
 let balance=0;
 return [...rows].sort((a,b)=>ms(a.timestamp)-ms(b.timestamp) || String(a.id).localeCompare(String(b.id))).map(row=>{
  const charge=['charge','debit'].includes(String(row.type).toLowerCase()),payment=['payment','credit'].includes(String(row.type).toLowerCase());
  balance+=charge?n(row.amount):payment?-n(row.amount):0;
  return {...row,charge:charge?n(row.amount):0,payment:payment?n(row.amount):0,balance};
 });
}
export function attendanceEstimate({logs,profiles,deductions=[],bonuses=[],ledgers=[],schedule={},holidays={},start,end,branch}) {
 const {start:from,end:to}=range(start,end),active=new Map(),people=new Map();
 const profileMap=Object.fromEntries(profiles.map(p=>[p.cashierName,p]));
 const person=name=>{if (!people.has(name)) people.set(name,{name,hours:0,shifts:0,basic:0,bonus:0,late:0,meals:0,advances:0,logs:[],review:0});return people.get(name);};
 for (const log of [...logs].filter(l=>l.branch===branch).sort((a,b)=>ms(a.timestamp)-ms(b.timestamp))) {
  const name=log.staffName;if (!name || !profileMap[name]) continue;
  const type=String(log.type || '').toUpperCase(),at=ms(log.timestamp),p=person(name);
  if (type==='TIME IN' && at>=+from && at<+to) {
   if (active.has(name)) { p.review++;p.logs.push({in:active.get(name).timestamp,out:null,remark:'Missing time out; review required'}); }
   active.set(name,log);
  } else if (type.startsWith('TIME OUT') && active.has(name)) {
   const entry=active.get(name),hours=(at-ms(entry.timestamp))/3600000;active.delete(name);
   if (hours<=0 || hours>18 || (hours<1 && type!=='TIME OUT (AUTO)')) {p.review++;p.logs.push({in:entry.timestamp,out:log.timestamp,remark:'Invalid attendance duration; review required'});continue;}
   const profile=profileMap[name],matched=resolveAttendanceShift(entry,schedule,profileMap);
   const multiplier=hours>=13.5?2:1,night=earnedNightBonus(profile,matched,new Date(at));
   const basic=n(profile.hourlyRate)*multiplier,straight=hours>=13.5?50:0;
   const holiday=resolveScheduleForDate(schedule,calendarDay(entry.timestamp))?.holidays?.[calendarDay(entry.timestamp)] ?? holidays[calendarDay(entry.timestamp)],holidayBonus=(basic+night)*(holiday==='Regular'?0.5:holiday==='Special'?0.1:0);
   const late=latePay(attendanceLateMinutes(entry,matched?.lateMinutes ?? 0),profile,matched,entry.lateExempted===true).amount+n(entry.penaltyAmount)+n(log.penaltyAmount);
   p.hours+=hours;p.shifts+=multiplier;p.basic+=basic;p.bonus+=night+straight+holidayBonus;p.late+=late;
   if(matched.needsScheduleReview)p.review++;
   p.logs.push({in:entry.timestamp,out:log.timestamp,hours,basic,bonus:night+straight+holidayBonus,late,remark:(type.includes('AUTO')?'Auto closed; review attendance':'Complete')+(matched.needsScheduleReview?' · Schedule reference needs review':'')});
  }
 }
 for (const [name,log] of active) {const p=person(name);p.review++;p.logs.push({in:log.timestamp,out:null,remark:'Missing time out; review required'});}
 for (const d of deductions) {
  if (!profileMap[d.staffName] || (d.branch && d.branch!==branch) || d.status!=='Unpaid' || ms(d.dateAdded)>=+to) continue;
  const p=person(d.staffName);if (/meal/i.test(d.type)) p.meals+=n(d.amount);else if (d.type==='Cash Advance') p.advances+=n(d.amount);
 }
 for (const b of bonuses) if (profileMap[b.staffName] && (!b.branch || b.branch===branch) && ms(b.dateAdded)>=+from && ms(b.dateAdded)<+to) person(b.staffName).bonus+=n(b.amount);
 return [...people.values()].map(p=>{
  const profile=profileMap[p.name],ledger=ledgers.find(l=>l.staffName===p.name && (!l.branch || l.branch===branch));
  const loan=ledger?Math.max(0,Math.min(n(ledger.cutoffDeduction),n(ledger.totalLoaned)-n(ledger.totalPaid))):0;
  const fixed=n(profile.sssAmount)+n(profile.pagibigAmount)+n(profile.philHealthAmount)+(profile.customDeductions || []).reduce((sum,d)=>sum+n(d.amount),0);
  const totalDeductions=p.late+p.meals+p.advances+loan+fixed;
  return {...p,loan,fixed,totalDeductions,gross:p.basic+p.bonus,net:p.basic+p.bonus-totalDeductions};
 });
}
