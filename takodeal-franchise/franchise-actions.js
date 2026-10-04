import { n, stockQty } from './franchise-data.js';
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
export async function saveBranchSchedule(api,{branch,year,month,days,original,actor}) {
 requireBranch(branch);
 return api.runTransaction(api.db,async tx=>{
  const ref=reference(api,'settings','global_schedule'),snap=await tx.get(ref),data=snap.exists()?snap.data():{};
  if (JSON.stringify(scheduleBranch(data,branch,year,month))!==JSON.stringify(original)) throw new Error('Your branch schedule changed in another session. Reload it before saving.');
  if ((data.currentYear!==year || data.currentMonth!==month) && Object.keys(data.currentSchedule || {}).length) throw new Error('HQ has a different month active. Ask HQ to open this month before saving.');
  const schedule=structuredClone(data.currentSchedule || {});
  for (const [day,value] of Object.entries(days)) schedule[day]={...(schedule[day] || {}),[branch]:value};
  tx.set(ref,{...data,currentYear:year,currentMonth:month,currentSchedule:schedule,lastUpdatedBy:actor,lastUpdatedAt:api.serverTimestamp()});
  return 'saved';
 });
}
