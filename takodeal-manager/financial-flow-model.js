// Read-only report: classifications never edit expenses, balances, payroll or receipts.
import {billToday,billsForPeriod} from './monthly-bills.js';
import {saleIsPaid,milliseconds,paymentParts} from './dashboard-data.js';
export const finite=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
export const cents=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
export const cash=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(value)||0);
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=value=>String(value??'').trim().toLowerCase();
const compact=value=>key(value).replace(/[^a-z0-9]/g,'');
const sum=rows=>cents(rows.reduce((n,row)=>n+Number(row.amount),0));
const ratio=(amount,revenue)=>revenue>0?amount/revenue*100:null;
const dateAt=(day,time='00:00:00.000')=>new Date(day+'T'+time+'+08:00');
export function financialPeriod({type='month',month,year,now=new Date()}={}){
 const today=billToday(now),currentYear=Number(today.slice(0,4));let first,next,label;
 if(type==='month'){
  month||=today.slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid reporting month.');
  const [y,m]=month.split('-').map(Number);first=month+'-01';next=billToday(new Date(Date.UTC(y,m,1)));label=dateAt(first,'12:00:00.000').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',year:'numeric'});
 }else if(type==='year'){
  year=Number(year||currentYear);if(!Number.isInteger(year)||year<2024||year>2099)throw Error('Choose a reporting year from 2024 to 2099.');first=year+'-01-01';next=(year+1)+'-01-01';label=String(year);
 }else throw Error('Choose Month or Year.');
 const start=dateAt(first),end=dateAt(next),active=+now>=+start&&+now<+end,future=+now<+start;
 const through=new Date(Math.min(+end,+now+1));
 let priorStart,priorEnd;
 if(type==='month'){
  const [y,m]=first.split('-').map(Number);priorStart=dateAt(billToday(new Date(Date.UTC(y,m-2,1))));priorEnd=start;
 }else{priorStart=dateAt((Number(first.slice(0,4))-1)+'-01-01');priorEnd=start;}
 let priorThrough=priorEnd;
 if(active){
  const monthOffset=Number(today.slice(5,7))-Number(first.slice(5,7)),day=Number(today.slice(8,10));
  const base=billToday(priorStart).split('-').map(Number),targetMonth=type==='year'?monthOffset+1:base[1];
  const yearForPrior=base[0],last=new Date(Date.UTC(yearForPrior,targetMonth,0)).getUTCDate();
  const ph=new Date(+now+8*3600000).toISOString().slice(11,23);
  priorThrough=new Date(+dateAt(`${yearForPrior}-${String(targetMonth).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`,ph)+1);
  if(+priorThrough>+priorEnd)priorThrough=priorEnd;
 }
 if(future)priorThrough=new Date(Math.min(+priorEnd,+now+1));
 return {type,start,end,through,priorStart,priorEnd,priorThrough,label,active,future,asOf:new Date(now),comparisonLabel:future?'Previous period records available so far':active?'Previous period to the same Philippine date/time':'Previous full period',dateBasis:'Philippine calendar dates (UTC+8)'};
}
export function payrollBranch(row){
 const tagged=row.payrollBranch||row.staffBranch;
 if(tagged)return String(tagged).trim();
 const match=/ - Branch:\s*([^\r\n]+)\s*$/.exec(String(row.note||''));
 return match?match[1].trim():row.branch;
}
const recipeNames=bom=>new Set(bom.map(r=>key(r.ingredientName)).filter(Boolean));
export function expenseKind(row,{inventory=[],bom=[]}={}){
 const category=compact(row.category),note=String(row.description||row.note||'').trim();
 if(['cashremittance','internaltransfer','cashtransfer','fundtransfer'].includes(category)||/^\[REMITTANCE TO HQ\](?:\s|$)/i.test(note))return {kind:'transfer',reason:'Explicit HQ remittance / internal cash-transfer record'};
 if(category.includes('payroll'))return {kind:'payroll',reason:'Recorded payroll payment; net cash paid, not accrued labor cost'};
 if(category.includes('royalty'))return {kind:'royalty',reason:'Royalty treatment requires review; shown separately, as in the previous report'};
 const restock=/^Restock:\s*(.+?)(?:\s*\(Qty:.*\))?\s*$/i.exec(note),name=key(row.inventoryItemName||restock?.[1]);
 const matches=inventory.filter(i=>i.branch===row.branch&&key(i.name)===name);
 if(name&&matches.length===1&&recipeNames(bom).has(name))return {kind:'purchase',reason:'Matched stock item is an ingredient in the current recipes; purchase cash is separate from recipe usage cost'};
 return {kind:'operating',reason:category==='supplierpayment'?'Supplier invoice payment needs classification before treating the estimate as profit':row.category?'Recorded operating expense':'Uncategorized cash payment retained in operating costs pending review'};
}
function recipeCosts(transactions,inventory,bom){
 const byStock=new Map(),byRecipe=new Map(),issues=[],breakdown={},ingredientUses=new Set();let total=0,lines=0,complete=0,cancelledCost=0;
 for(const row of inventory){const k=row.branch+'\0'+key(row.name);if(!byStock.has(k))byStock.set(k,[]);byStock.get(k).push(row);}
 for(const row of bom){const k=key(row.menuItem);if(!byRecipe.has(k))byRecipe.set(k,[]);byRecipe.get(k).push(row);}
 const cost=(name,branch,problems)=>{
  ingredientUses.add(key(name));let matches=byStock.get(branch+'\0'+key(name))||[];
  if(!matches.length)matches=byStock.get('Main Office\0'+key(name))||[];
  if(matches.length!==1){problems.add((matches.length?'Duplicate':'Missing')+' ingredient record: '+name);return 0;}
  if(!finite(matches[0].baseCost)||Number(matches[0].baseCost)<0){problems.add('Missing or invalid unit cost: '+name);return 0;}
  return Number(matches[0].baseCost);
 };
 for(const tx of transactions){
  const prepared=tx.preparedCancellation?.prepared===true&&!saleIsPaid(tx);
  if(!saleIsPaid(tx)&&!prepared||tx.cancelledFoodSourceId)continue;
  const cart=tx.cart||tx.items;
  if(!Array.isArray(cart)||!cart.length){issues.push({item:'Receipt '+(tx.receiptNumber||tx.id||''),branch:tx.branch,problems:['No item breakdown for recipe costs']});continue;}
  for(const item of cart){
   lines++;const name=item.name||item.itemName||item.realName||'Unnamed item',problems=new Set(),qty=Number(item.qty??1),recipe=byRecipe.get(key(name))||byRecipe.get(key(item.realName))||[];
   if(!finite(item.qty??1)||qty<=0){problems.add('Invalid item quantity');issues.push({item:name,branch:tx.branch,problems:[...problems]});continue;}
   if(!recipe.length)problems.add('No recipe linked');let line=0;const seen=new Set();
   for(const r of recipe){
    if(seen.has(key(r.ingredientName))){problems.add('Duplicate recipe ingredient: '+r.ingredientName);continue;}seen.add(key(r.ingredientName));
    if(!finite(r.qty)||Number(r.qty)<=0){problems.add('Invalid recipe quantity: '+r.ingredientName);continue;}
    const unitCost=cost(r.ingredientName,tx.branch,problems),orderType=key(item.orderType||tx.orderType||'');
    const quantity=/box/i.test(r.ingredientName)&&orderType.includes('dine-in')?Number(r.qty)/2:Number(r.qty);
    line+=unitCost*quantity*qty;
   }
   for(const addon of Object.values(item.addons||{}))if(Number(addon?.qty)>0&&addon.linkedIngredient){
    if(!finite(addon.deductQty)||Number(addon.deductQty)<=0){problems.add('Invalid add-on ingredient quantity');continue;}
    line+=cost(addon.linkedIngredient,tx.branch,problems)*Number(addon.deductQty)*Number(addon.qty)*qty;
   }
   if(!problems.size)complete++;else issues.push({item:name,branch:tx.branch,problems:[...problems]});
   total+=line;if(prepared)cancelledCost+=line;
   const group=breakdown[name]||={qty:0,cogs:0};group.qty+=qty;group.cogs+=line;
  }
 }
 for(const row of Object.values(breakdown))row.cogs=cents(row.cogs);
 return {total:cents(total),lines,complete,issues,breakdown,cancelledCost:cents(cancelledCost),ingredientUses:[...ingredientUses]};
}
export function buildFinancialReport({transactions=[],expenses=[],inventory=[],bom=[],budgets=[],branch='All',period,allowedBranch=()=>true}={}){
 if(!period)throw Error('A reporting period is required.');
 const match=(row,start,end,attributed=false)=>allowedBranch(row.branch)&&(branch==='All'||(attributed?payrollBranch(row):row.branch)===branch)&&milliseconds(row.timestamp)>=+start&&milliseconds(row.timestamp)<+end;
 const selectedTransactions=transactions.filter(r=>match(r,period.start,period.through));
 const sales=selectedTransactions.filter(saleIsPaid),invalidSales=sales.filter(r=>!finite(r.netTotal));
 const revenue=cents(sales.reduce((n,r)=>n+(finite(r.netTotal)?Number(r.netTotal):0),0));
 const costs=recipeCosts(selectedTransactions,inventory.filter(r=>allowedBranch(r.branch)),bom);
 const groups={operating:[],payroll:[],transfer:[],purchase:[],royalty:[]},invalidExpenses=[],unposted=[];
 for(const row of expenses){
  const kind=expenseKind(row,{inventory,bom});if(!match(row,period.start,period.through,kind.kind==='payroll'))continue;
  if(['pending','unpaid','cancelled','canceled','rejected','voided'].includes(key(row.status))){unposted.push(row);continue;}
  if(!finite(row.amount)){invalidExpenses.push(row);continue;}
  groups[kind.kind].push({...row,classificationReason:kind.reason});
 }
 const breakdown={},trace={};for(const row of groups.operating){const category=String(row.category||'Uncategorized');breakdown[category]=(breakdown[category]||0)+Number(row.amount);(trace[category]||=[]).push(row);}
 for(const category of Object.keys(breakdown))breakdown[category]=cents(breakdown[category]);
 const totalPayroll=sum(groups.payroll),operating=sum(groups.operating),transfers=sum(groups.transfer),purchases=sum(groups.purchase),royalties=sum(groups.royalty);
 const result=cents(revenue-costs.total-totalPayroll-operating);
 const scopedBudgets=budgets.filter(r=>allowedBranch(r.branch)&&(branch==='All'||r.branch===branch));
 const due=billsForPeriod(scopedBudgets,branch,period.start,new Date(+period.end-1),period.asOf),unpaidBills=due.filter(r=>!r.payment&&finite(r.amount));
 const budgetLimits={};for(const row of scopedBudgets)if(finite(row.limit)&&Number(row.limit)>=0){const c=String(row.category||row.name||'Uncategorized');budgetLimits[c]=(budgetLimits[c]||0)+Number(row.limit)*(period.type==='year'?12:1);}
 const priorTransactions=transactions.filter(r=>match(r,period.priorStart,period.priorThrough)),priorSales=priorTransactions.filter(saleIsPaid);
 const priorRevenue=cents(priorSales.reduce((n,r)=>n+(finite(r.netTotal)?Number(r.netTotal):0),0));
 const uncategorized=groups.operating.filter(r=>!rowCategory(r)||key(r.category)==='uncategorized'),supplier=groups.operating.filter(r=>compact(r.category)==='supplierpayment');
 const unallocatedPayroll=branch==='All'?0:expenses.filter(r=>compact(r.category).includes('payroll')&&r.branch==='Main Office'&&payrollBranch(r)==='Main Office'&&allowedBranch(r.branch)&&milliseconds(r.timestamp)>=+period.start&&milliseconds(r.timestamp)<+period.through).length;
 return {branch,period,revenue,orders:sales.length,priorRevenue,priorOrders:priorSales.length,revenueChange:!period.future&&priorRevenue>0?(revenue-priorRevenue)/priorRevenue*100:null,
  average:sales.length?revenue/sales.length:null,cogs:costs.total,paidPayroll:totalPayroll,operating,result,margin:ratio(result,revenue),ratios:{food:ratio(costs.total,revenue),payroll:ratio(totalPayroll,revenue),operating:ratio(operating,revenue)},
  groups,breakdown,trace,transfers,purchases,royalties,costs,invalidSales,invalidExpenses,unposted,uncategorized,uncategorizedAmount:sum(uncategorized),supplier,unallocatedPayroll,
  unpaidBills,unpaidBillAmount:sum(unpaidBills),overdueBills:unpaidBills.filter(r=>r.state==='overdue'),unscheduledBills:scopedBudgets.filter(r=>!r.billStartDate).length,budgetLimits,
  recordedPayments:sales.flatMap(paymentParts).reduce((all,p)=>{all[p.method]=(all[p.method]||0)+p.amount;return all;},{}),partial:!!(costs.issues.length||uncategorized.length||supplier.length||invalidSales.length||invalidExpenses.length||royalties||unallocatedPayroll)};
}
function rowCategory(row){return String(row.category||'').trim();}
export function mentorFindings(report,targets={}){
 const r=report,findings=[];const add=(priority,title,evidence,action,route)=>findings.push({priority,title,evidence,action,route});
 if(r.costs.issues.length)add('review','Check recipe and ingredient costs',`${r.costs.complete} of ${r.costs.lines} item lines have complete recipe costs. ${r.costs.issues.length} item lines or receipts need review. Missing costs can overstate the result.`, 'Review the linked recipes, duplicate ingredients and missing unit costs.','menu');
 if(r.uncategorized.length||r.supplier.length)add('review','Classify cash payments',`${cash(r.uncategorizedAmount)} remains uncategorized. ${r.supplier.length} supplier payments also need a check. These payments are still included in the provisional operating costs.`, 'Match payments to invoices and receipts; distinguish ingredients, operating costs, refunds and assets.','expenses');
 if(r.royalties)add('review','Review royalty treatment',`${cash(r.royalties)} of royalty payments is shown separately and excluded from this estimate, preserving the previous report treatment.`, 'Confirm whether these are external costs or transfers within the reporting business before relying on the result.','expenses');
 if(r.unallocatedPayroll)add('review','Branch payroll allocation is incomplete',`${r.unallocatedPayroll} HQ payroll payments have no explicit branch tag. They have not been assigned to this branch.`, 'Review payroll records. Paid net salary also differs from total earned labor cost.','payroll');
 if(r.invalidExpenses.length||r.invalidSales.length)add('review','Some amounts are missing',`${r.invalidExpenses.length} payment records and ${r.invalidSales.length} receipts have invalid or missing amounts.`, 'Correct the source records through their existing review screens.','expenses');
 if(r.unpaidBills.length)add('plan','Plan unpaid scheduled bills',`${r.unpaidBills.length} unpaid bills total ${cash(r.unpaidBillAmount)} for the selected period; ${r.overdueBills.length} are overdue. They are planned obligations, not paid expenses.`, 'Review due dates and cash accounts before paying. The displayed result is not available bank cash.','accounts');
 if(r.transfers)add('info','HQ cash transfers are separate',`${cash(r.transfers)} of explicit internal cash transfers was kept out of operating costs.`, 'Trace these handovers in the transfer records; they move funds without creating an operating expense.','transfers');
 if(r.purchases)add('info','Ingredient purchases are separate',`${cash(r.purchases)} of restock payments matched ingredients in the current recipes. Recipe usage cost is shown once; purchase cash is listed separately.`, 'Check supplier invoices and stock records. Unmatched purchases remain in costs pending classification.','expenses');
 if(r.period.active)add('info','This period is still in progress',`Sales are compared with the previous period through the same Philippine date and time. Full monthly bills and payroll payment dates can make the cost ratios uneven.`, 'Use the comparison as a sales trend, not a forecast of full-month profit.','history');
 if(!r.orders)add('review','No paid sales in this period','No eligible paid receipts were found. Cost percentages and average order value are unavailable.', 'Check the branch, dates and uploaded sales before drawing conclusions.','history');
 else if(r.revenueChange!==null)add('info','Recorded sales comparison',`${cash(r.revenue)} versus ${cash(r.priorRevenue)}; ${r.revenueChange>=0?'+':''}${r.revenueChange.toFixed(1)}%.`, 'Review receipt volume and average order value. A trend alone does not identify its cause.','history');
 for(const [metric,label] of [['food','Recipe cost'],['payroll','Paid payroll'],['operating','Operating cost']])if(finite(targets[metric])&&Number(targets[metric])>=0&&Number(targets[metric])<=100&&r.ratios[metric]!==null&&r.ratios[metric]>Number(targets[metric]))add('plan',label+' is above your planning target',`${r.ratios[metric].toFixed(1)}% of recorded sales versus your ${Number(targets[metric])}% target.`, 'Check the underlying records and period timing before deciding on a change.');
 for(const [category,spent] of Object.entries(r.breakdown))if(finite(r.budgetLimits[category])&&spent>r.budgetLimits[category])add('plan','Above recorded budget: '+category,`${cash(spent)} paid versus ${cash(r.budgetLimits[category])} recorded budget.`, 'Review this category’s expense records and the saved budget.','accounts');
 if(r.result<0)add('review','Known costs exceed recorded sales',`The provisional result is ${cash(r.result)} after recipe estimates and recorded cash costs.`, 'Reconcile missing costs, transfers and payment timing before treating this as a final loss.','expenses');
 return findings.sort((a,b)=>['review','plan','info'].indexOf(a.priority)-['review','plan','info'].indexOf(b.priority));
}
