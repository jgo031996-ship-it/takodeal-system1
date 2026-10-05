import { n, stockQty, canVisit } from './franchise-data.js';
import { createScheduleHistoryStore, monthKey, scheduleDateKey, resolveScheduleForDate, assembleScheduleHistory } from './schedule-history.js';
const reference=(api,table,id)=>api.doc(api.db,table,id);
function requireBranch(branch) { if (!branch || branch==='All') throw new Error('Select an assigned branch first.'); }
const cents=value=>Math.round(n(value)*100);

export async function logExpense(api,{id,branch,accountId,accountTable='cash_accounts',category,amount,description,actor}) {
 requireBranch(branch);
 if (!id || !accountId || !category || !description?.trim() || !Number.isFinite(Number(amount)) || cents(amount)<=0) throw new Error('Enter an account, category, positive amount and description.');
 if (!['cash_accounts','franchise_accounts'].includes(accountTable)) throw new Error('Invalid cash account source.');
 const expense=reference(api,'expenses',id),account=reference(api,accountTable,accountId);
 return api.runTransaction(api.db,async tx=>{
  const [saved,balance]=await Promise.all([tx.get(expense),tx.get(account)]);
  if (saved.exists()) {
   const d=saved.data();if (d.branch!==branch || d.accountId!==accountId || d.accountTable!==accountTable || cents(d.amount)!==cents(amount) || d.description!==description.trim()) throw new Error('This expense reference was already used.');
   return 'already-saved';
  }
  if (!balance.exists() || balance.data().branch!==branch) throw new Error('This cash account is unavailable for your branch.');
  if (!Number.isFinite(Number(balance.data().balance))) throw new Error('This account balance needs correction in HQ.');
  const next=(cents(balance.data().balance)-cents(amount))/100;
  tx.update(account,{balance:next});
  const name=balance.data().name || balance.data().accountName || 'Cash account';
  tx.set(expense,{branch,accountId,accountTable,accountName:name,category,amount:cents(amount)/100,description:description.trim(),loggedBy:actor,timestamp:api.serverTimestamp(),source:'Franchisee',balanceAfter:next});
  tx.set(reference(api,accountTable==='cash_accounts'?'account_logs':'franchise_account_logs',id),{branch,accountId,accountName:name,action:'Franchisee Expense',amount:-cents(amount)/100,newBalance:next,balanceAfter:next,description:description.trim(),user:actor,timestamp:api.serverTimestamp()});
  return 'saved';
 });
}
export async function adjustInventory(api,{id,branch,itemId,type,quantity,reason,observedStock,actor}) {
 requireBranch(branch);
 if (!id || !itemId || !['Audit','Waste'].includes(type) || !Number.isFinite(Number(quantity)) || Number(quantity)<0 || (type==='Waste' && (!reason?.trim() || Number(quantity)<=0))) throw new Error('Enter a valid count and reason.');
 const stock=reference(api,'inventory',itemId),log=reference(api,'inventory_logs',id);
 return api.runTransaction(api.db,async tx=>{
  const [saved,snapshot]=await Promise.all([tx.get(log),tx.get(stock)]);
  if (saved.exists()) {const d=saved.data();if (d.branch!==branch || d.itemId!==itemId || d.type!==type || Number(d.inputQuantity)!==Number(quantity)) throw new Error('This stock adjustment reference was already used.');return 'already-saved';}
  if (!snapshot.exists() || snapshot.data().branch!==branch) throw new Error('This item is unavailable for your branch.');
  const item=snapshot.data(),before=stockQty(item);
  if (type==='Audit' && before!==Number(observedStock)) throw new Error('Stock changed while you were counting. Reload and review the count before saving.');
  if (type==='Waste' && Number(quantity)>before) throw new Error('Waste exceeds the current stock. Reload the item.');
  const after=type==='Audit'?Number(quantity):before-Number(quantity),variance=after-before;
  tx.update(stock,{currentStock:after,quantity:after});
  tx.set(log,{branch,itemId,type,itemName:item.name || item.itemName,systemQty:before,actualQty:after,variance,qtyWasted:type==='Waste'?Number(quantity):0,inputQuantity:Number(quantity),reason:reason || '',unit:item.uom || 'units',loggedBy:actor,timestamp:api.serverTimestamp()});
  tx.set(reference(api,'stock_logs',id),{branch,item:item.name || item.itemName,oldQty:before,newQty:after,variance,type:type==='Audit'?'Franchise Stock Audit':'Franchise Waste',uom:item.uom || 'units',note:reason || '',user:actor,timestamp:api.serverTimestamp()});
  return 'saved';
 });
}
export async function reviewRequest(api,{id,branch,action,reply,actor}) {
 requireBranch(branch);
 if (!['Approved','Rejected'].includes(action)) throw new Error('Choose an approval or rejection.');
 return api.runTransaction(api.db,async tx=>{
  const ref=reference(api,'staff_requests',id),snapshot=await tx.get(ref);
  if (!snapshot.exists() || snapshot.data().branch!==branch) throw new Error('This request is unavailable for your branch.');
  const row=snapshot.data();
  if (row.status!=='Pending') {if (row.status===action) return 'already-saved';throw new Error('Another reviewer has already processed this request.');}
  if (row.type==='Reason Letter' && /late|tardiness/i.test(row.explanationCause || '')) throw new Error('Review this attendance letter in the Manager app to link the correct clock-in.');
  tx.update(ref,{status:action,managerReply:reply || '',processedBy:actor,processedAt:api.serverTimestamp()});
  if (action==='Approved' && (row.type==='Cash Advance' || /meal/i.test(row.type || '')) && n(row.amount)>0) tx.set(reference(api,'staff_deductions','request-'+id),{branch,staffName:row.staffName,type:row.type,amount:n(row.amount),requestId:id,status:'Unpaid',dateAdded:api.serverTimestamp()});
  return 'saved';
 });
}
export function scheduleBranch(data,branch,year,month) {
 if (data?.currentYear!==year || data?.currentMonth!==month) return {};
 return Object.fromEntries(Object.entries(data.currentSchedule || {}).map(([day,row])=>[day,row[branch] || null]));
}
const scheduleKeys=['branchConfig','employees','unavailability','currentSchedule','currentYear','currentMonth','holidays'];
function signature(value) {
 if(Array.isArray(value))return '['+value.map(signature).join(',')+']';
 if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+signature(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const scheduleSignature=data=>signature(Object.fromEntries(scheduleKeys.filter(k=>data?.[k]!==undefined).map(k=>[k,data[k]])));
function scheduleAccess(api,branch,authorize) {
 requireBranch(branch);
 if(authorize && authorize(branch)===false || api.sessionUser && (api.sessionUser.branch!==branch || !canVisit(api.sessionUser,'schedule')))throw new Error('This schedule is outside your assigned access.');
}
// Reading a past or future month never changes the live schedule or creates history.
export async function loadBranchSchedule(api,{branch,year,month,now=new Date(),store=createScheduleHistoryStore(api),authorize}={}) {
 scheduleAccess(api,branch,authorize);
 const selectedMonth=monthKey({currentYear:year,currentMonth:month}),today=scheduleDateKey(now),read=api.getDocFromServer || api.getDoc;
 const [snap,archive]=await Promise.all([read(reference(api,'settings','global_schedule')),store.loadMonth(selectedMonth)]);
 scheduleAccess(api,branch,authorize);
 const current=snap.exists()?snap.data():{},headMonth=current.currentYear!==undefined?monthKey(current):null;
 const latest=archive.latestRevision,headPreserved=archive.revisions.some(r=>r.revisionId===current.scheduleRevisionId && scheduleSignature(r.snapshot)===scheduleSignature(current));
 const base=headMonth===selectedMonth && !headPreserved && !(latest?.effectiveFrom>today)?current:latest?.snapshot || (headMonth===selectedMonth?current:{...current,currentYear:year,currentMonth:month,currentSchedule:{},holidays:{}});
 const original=scheduleBranch(base,branch,year,month),days=structuredClone(original),dayShifts={},unverifiedDays=[];
 const readOnly=selectedMonth<today.slice(0,7),effectiveFrom=readOnly?latest?.effectiveFrom || selectedMonth+'-01':[selectedMonth+'-01',today,latest?.effectiveFrom || ''].sort().at(-1);
 const history=assembleScheduleHistory(current,[archive]),count=new Date(Date.UTC(year,month,0)).getUTCDate();
 for(let day=1;day<=count;day++) {
  const date=selectedMonth+'-'+String(day).padStart(2,'0'),saved=resolveScheduleForDate(history,date);
  if(date<effectiveFrom || readOnly) {
   days[day]=saved?.currentSchedule?.[day]?.[branch] || (headMonth===selectedMonth?current.currentSchedule?.[day]?.[branch]:null);
   dayShifts[day]=saved?.branchConfig?.[branch] || (headMonth===selectedMonth?current.branchConfig?.[branch]:[]) || [];
   if(!saved)unverifiedDays.push(day);
  } else dayShifts[day]=base.branchConfig?.[branch] || [];
 }
 return {month:selectedMonth,year,monthNumber:month,branch,original,days,shifts:base.branchConfig?.[branch] || [],dayShifts,unverifiedDays,readOnly,effectiveFrom,expectedRevisionId:archive.latestRevisionId,base,headSignature:scheduleSignature(current)};
}
export async function saveBranchSchedule(api,{branch,year,month,days,original,actor,effectiveFrom,expectedRevisionId,revisionId,now=new Date(),store=createScheduleHistoryStore(api),authorize}) {
 scheduleAccess(api,branch,authorize);
 const editor=await loadBranchSchedule(api,{branch,year,month,now,store,authorize}),from=scheduleDateKey(effectiveFrom || editor.effectiveFrom),count=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(!actor?.trim())throw new Error('Sign in before saving the schedule.');
 if(api.sessionUser?.email && actor!==api.sessionUser.email)throw new Error('Your Google identity changed. Reload the schedule.');
 if(from.slice(0,7)!==editor.month)throw new Error('Choose an effective date in the selected schedule month.');
 const validDays=Object.entries(days || {}).filter(([day])=>{
  if(!/^\d{1,2}$/.test(day) || Number(day)<1 || Number(day)>count)throw new Error('A schedule day does not belong to this month.');
  return editor.month+'-'+String(day).padStart(2,'0')>=from;
 });
 for(const [,value] of validDays) {
  if(!value || typeof value!=='object' || Array.isArray(value) || !value.scheduled || typeof value.scheduled!=='object')throw new Error('Reload the branch schedule before saving.');
  const names=Object.values(value.scheduled).filter(name=>name && !['UNFILLED','N/A'].includes(name));
  if(names.length!==new Set(names).size)throw new Error('A staff member cannot cover two shifts on the same day.');
 }
 // A repeated save after a lost acknowledgment reuses the same immutable revision.
 const existing=revisionId && (await store.loadMonth(editor.month)).revisions.find(r=>r.revisionId===revisionId);
 if(existing) {
  if(existing.source!=='franchise-save' || existing.actor!==actor || existing.effectiveFrom!==from || validDays.some(([day,value])=>signature(existing.snapshot.currentSchedule?.[day]?.[branch])!==signature(value)))throw new Error('This schedule save reference was already used. Reload before saving.');
  scheduleAccess(api,branch,authorize);
  return {revision:existing,latestRevisionId:editor.expectedRevisionId,alreadySaved:true,publishedCurrent:editor.month===scheduleDateKey(now).slice(0,7) && from<=scheduleDateKey(now)};
 }
 if(editor.readOnly || from<editor.effectiveFrom)throw new Error('Past schedule dates are read-only. Choose the saved plan date or a later date.');
 if(!validDays.length)throw new Error('There are no branch assignments to save for the selected dates.');
 if(signature(editor.original)!==signature(original) || expectedRevisionId!==undefined && editor.expectedRevisionId!==expectedRevisionId)throw new Error('Your branch schedule changed in another session. Reload it before saving.');
 const snapshot=structuredClone(editor.base);snapshot.currentSchedule ||= {};
 for(const [day,value] of validDays)snapshot.currentSchedule[day]={...(snapshot.currentSchedule[day] || {}),[branch]:structuredClone(value)};
 return store.save(snapshot,{actor,source:'franchise-save',effectiveFrom:from,expectedRevisionId:editor.expectedRevisionId,...(revisionId?{revisionId}:{}),readExtra:(_tx,{current})=>{
  scheduleAccess(api,branch,authorize);
  if(scheduleSignature(current || {})!==editor.headSignature)throw new Error('HQ changed the schedule settings. Reload before saving.');
 }});
}
