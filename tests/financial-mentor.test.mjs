import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financialPeriod,expenseKind,buildFinancialReport,mentorFindings,payrollBranch} from '../takodeal-manager/financial-flow-model.js';
import {createFinancialFlow,renderFinancialReview,renderMentor,scheduleFinancialFlow} from '../takodeal-manager/financial-flow-ui.js';
const at=date=>new Date(date+'T12:00:00+08:00');
const period=()=>financialPeriod({month:'2026-10',now:at('2026-10-14')});
const sale=(extra={})=>({id:'one',branch:'Cabantian',timestamp:at('2026-10-03'),netTotal:100,status:'Paid',cart:[{name:'Food',qty:2}],...extra});
const expense=(extra={})=>({id:'expense',branch:'Cabantian',timestamp:at('2026-10-03'),amount:10,category:'Rent',...extra});
const inventory=[{branch:'Cabantian',name:'Sauce',baseCost:2},{branch:'Main Office',name:'Sauce',baseCost:10},{branch:'Cabantian',name:'LPG',baseCost:20}];
const bom=[{menuItem:'Food',ingredientName:'Sauce',qty:3}];
const report=extra=>buildFinancialReport({transactions:[sale()],expenses:[],inventory,bom,budgets:[],period:period(),...extra});
test('Financial Flow dates use Philippine month boundaries and equal elapsed comparison, independent of host timezone',()=>{
 const p=period();assert.equal(p.start.toISOString(),'2026-09-30T16:00:00.000Z');assert.equal(p.end.toISOString(),'2026-10-31T16:00:00.000Z');assert.equal(p.priorStart.toISOString(),'2026-08-31T16:00:00.000Z');assert.equal(p.priorThrough.toISOString(),'2026-09-14T04:00:00.001Z');assert.equal(p.active,true);
 const january=financialPeriod({month:'2026-01',now:at('2026-01-14')});assert.equal(january.priorStart.toISOString(),'2025-11-30T16:00:00.000Z');
});
test('Financial period clamps shorter prior months and leap-year comparisons without using future sales',()=>{
 const march=financialPeriod({month:'2026-03',now:at('2026-03-31')});assert.equal(march.priorThrough.toISOString(),'2026-02-28T04:00:00.001Z');
 const leap=financialPeriod({type:'year',year:2024,now:at('2024-02-29')});assert.equal(leap.priorThrough.toISOString(),'2023-02-28T04:00:00.001Z');
 assert.throws(()=>financialPeriod({month:'2026-13'}),/valid/);assert.throws(()=>financialPeriod({type:'year',year:3000}),/2024/);
});
test('Explicit HQ handovers are transfers even without a category; transfer fees remain operating costs',()=>{
 assert.equal(expenseKind(expense({category:'Cash Remittance'})).kind,'transfer');
 assert.equal(expenseKind(expense({category:undefined,description:'[REMITTANCE TO HQ] - Physical Handover'})).kind,'transfer');
 assert.equal(expenseKind(expense({category:'Bank Charges',note:'Transfer Fee'})).kind,'operating');
 assert.equal(expenseKind(expense({category:'Delivery',note:'Remittance service charge'})).kind,'operating');
});
test('Known recipe ingredient purchases are separate; fuel, ambiguous items and unknown restocks stay in costs',()=>{
 assert.equal(expenseKind(expense({category:undefined,description:'Restock: Sauce (Qty: 2 Gallon)'}),{inventory,bom}).kind,'purchase');
 for(const name of ['LPG','Unknown'])assert.equal(expenseKind(expense({description:'Restock: '+name,category:undefined}),{inventory,bom}).kind,'operating');
 assert.equal(expenseKind(expense({description:'Restock: Sauce',category:undefined}),{inventory:[...inventory,inventory[0]],bom}).kind,'operating');
});
test('Report fixes the screenshot remittance error without deleting or mutating expense records',()=>{
 const expenses=[expense({amount:40500,category:'Cash Remittance'}),expense({amount:24000,category:undefined,description:'[REMITTANCE TO HQ] - Handover'}),expense({amount:50,category:undefined,description:'Restock: Sauce'}),expense({amount:30,category:undefined,description:'Restock: LPG'}),expense({amount:10})];
 const before=JSON.stringify(expenses),r=report({transactions:[sale({netTotal:100000})],expenses});
 assert.equal(r.transfers,64500);assert.equal(r.purchases,50);assert.equal(r.operating,40);assert.equal(r.cogs,12);assert.equal(r.result,99948);assert.equal(JSON.stringify(expenses),before);
 assert.equal(r.uncategorizedAmount,30);assert.equal(r.groups.transfer.length,2);assert.equal(r.partial,true);
});
test('Explicit HQ payroll branch tags allocate cash paid once to the selected branch while retaining the payer branch',()=>{
 const pay=expense({branch:'Main Office',category:'Payroll',amount:25,note:'Payslip for Staff (dates) - Branch: Cabantian'});
 assert.equal(payrollBranch(pay),'Cabantian');assert.equal(report({branch:'Cabantian',expenses:[pay]}).paidPayroll,25);assert.equal(report({branch:'Maa',expenses:[pay]}).paidPayroll,0);
 const raw=expense({branch:'Main Office',category:'Payroll',amount:25,note:'Payroll'});assert.equal(report({branch:'Cabantian',expenses:[raw]}).unallocatedPayroll,1);assert.equal(report({branch:'Cabantian',expenses:[raw]}).paidPayroll,0);
});
test('Branch and access scope constrain every record; unauthorized HQ costs do not become a fallback',()=>{
 const r=report({branch:'Cabantian',allowedBranch:b=>b==='Cabantian',transactions:[sale(),sale({branch:'Maa',netTotal:999})],expenses:[expense(),expense({branch:'Maa',amount:999})],inventory:inventory.filter(i=>i.branch==='Main Office')});
 assert.equal(r.revenue,100);assert.equal(r.operating,10);assert.equal(r.cogs,0);assert.match(r.costs.issues[0].problems[0],/Missing ingredient/);
});
test('Valid zero branch unit costs do not silently fall back to the more expensive HQ cost',()=>{
 const r=report({inventory:inventory.map(i=>i.branch==='Cabantian'&&i.name==='Sauce'?{...i,baseCost:0}:i)});assert.equal(r.cogs,0);assert.equal(r.costs.complete,1);
});
test('Duplicate ingredients, missing recipes and bad quantities produce checks instead of a confident margin diagnosis',()=>{
 const duplicate=report({inventory:[...inventory,inventory[0]]});assert.match(duplicate.costs.issues[0].problems[0],/Duplicate/);assert.equal(duplicate.cogs,0);
 const missing=report({bom:[]});assert.equal(missing.partial,true);assert.equal(missing.costs.complete,0);
 const bad=report({transactions:[sale({cart:[{name:'Food',qty:0}]})]});assert.match(bad.costs.issues[0].problems[0],/quantity/);
 assert.doesNotMatch(renderMentor(missing),/over.staffed|Excellent recipe management|highly.tuned|Food Cost Optimal/i);
});
test('Prepared cancellation retains cost once; a linked staff purchase adds sales without another ingredient cost',()=>{
 const r=report({transactions:[sale({status:'Voided',preparedCancellation:{prepared:true}}),sale({id:'resale',netTotal:60,cancelledFoodSourceId:'one'})]});assert.equal(r.revenue,60);assert.equal(r.cogs,12);assert.equal(r.costs.cancelledCost,12);assert.equal(r.orders,1);
 assert.equal(report({transactions:[sale({status:'Voided'})]}).cogs,0);
});
test('Unpaid receipts, rejected payments and future records are not counted as paid business',()=>{
 const r=report({transactions:[sale({status:'Pending'}),sale({timestamp:at('2026-10-20')})],expenses:[expense({status:'Rejected'}),expense({timestamp:at('2026-10-20')})]});assert.equal(r.revenue,0);assert.equal(r.operating,0);assert.equal(r.margin,null);assert.equal(r.average,null);
 assert.match(renderFinancialReview(r),/Estimated margin/);assert.doesNotMatch(renderFinancialReview(r),/NaN|Infinity/);
});
test('Same elapsed comparison does not compare October to all of September',()=>{
 const r=report({transactions:[sale({netTotal:100}),sale({timestamp:at('2026-09-03'),netTotal:80}),sale({timestamp:at('2026-09-20'),netTotal:999})]});assert.equal(r.priorRevenue,80);assert.equal(r.revenueChange,25);
});
test('Unpaid scheduled bills are planned obligations rather than another paid deduction',()=>{
 const r=report({budgets:[{id:'rent',branch:'Cabantian',category:'Rent',limit:30,billStartDate:'2026-10-10',billDay:10,billReminderDays:2,billReminderTime:'09:00'}]});assert.equal(r.unpaidBillAmount,30);assert.equal(r.result,88);assert.equal(r.overdueBills.length,1);assert.match(mentorFindings(r).find(f=>f.title.includes('bills')).evidence,/planned obligations/);
});
test('Royalty treatment and supplier payments stay explicit rather than being silently reclassified',()=>{
 const r=report({expenses:[expense({category:'Royalty',amount:25}),expense({category:'Supplier Payment',amount:10})]});assert.equal(r.royalties,25);assert.equal(r.operating,10);assert.equal(r.partial,true);assert.ok(mentorFindings(r).some(f=>f.title==='Review royalty treatment'));
});
test('Whitespace, boolean and missing amounts are flagged, and a future month does not show a sales decline',()=>{
 const r=report({expenses:[expense({amount:'   '}),expense({amount:true})],transactions:[sale({netTotal:null})]});assert.equal(r.invalidExpenses.length,2);assert.equal(r.invalidSales.length,1);assert.equal(r.operating,0);
 const future=report({period:financialPeriod({month:'2026-11',now:at('2026-10-14')})});assert.equal(future.revenueChange,null);assert.equal(future.priorRevenue,100);
});
test('Mentor uses owner-supplied targets only and does not infer the cause or make payroll decisions',()=>{
 const r=report();assert.ok(!mentorFindings(r).some(f=>f.title.includes('planning target')));assert.ok(mentorFindings(r,{food:5}).some(f=>f.title.includes('planning target')));assert.ok(!mentorFindings(r,{food:101}).some(f=>f.title.includes('planning target')));
});
test('Report and mentor escape source labels and distinguish estimates from cash',()=>{
 const r=report({branch:'<img src=x onerror=alert(1)>',transactions:[],expenses:[]});assert.ok(!renderFinancialReview(r).includes('<img src=x'));assert.match(renderFinancialReview(r),/not available cash/);assert.match(renderMentor(r),/No external AI connection/);
});
function fixture({permissions=['all'],allowed=['Cabantian','Maa','Main Office'],delay}={}){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',options:[{value:'All'},{value:'Cabantian'},{value:'Maa'}],classList:{contains:()=>true},getContext:()=>id,insertAdjacentHTML(position,html){this.innerHTML+=html;}});return nodes.get(id);};
 node('flowBranchFilter').value='All';node('flowTimeFilter').value='month';node('flowMonthPicker').value='2026-10';node('flowYearPicker').value='2026';
 const data={transactions:[sale()],expenses:[expense()],inventory,bom,budgets:[{branch:'Cabantian',category:'Utilities',limit:30}],hq_restocks:[]},reads=[],charts=[];
 const w={auth:{currentUser:{uid:'owner'}},sessionUser:{isOwner:true,permissions,allowedBranches:allowed},isBranchAllowed:b=>allowed.includes(b),db:{},setTimeout,clearTimeout,console:{warn(){}},localStorage:{getItem:()=>null},collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),fetchCachedCollection:async name=>data[name],getDocsFromServer:async ref=>{reads.push(ref);if(delay)await delay(ref);return {docs:(data[ref.table]||[]).filter(row=>(ref.filters||[]).every(f=>f.op==='>='?+row[f.field]>=+f.value:f.op==='<'?+row[f.field]<+f.value:row[f.field]===f.value)).map((data,id)=>({id:String(id),data:()=>data}))};},Chart:class{constructor(ctx,config){charts.push(config);}destroy(){}}};
 const flow=createFinancialFlow(w,{getElementById:node});return {w,node,flow,data,reads,charts};
}
test('Actual report controller reads selected records, renders both charts and includes zero-spend budget categories',async()=>{
 const f=fixture();await f.flow.load();assert.equal(f.flow.getReport().revenue,100);assert.equal(f.charts.length,2);assert.ok(f.charts[1].data.labels.includes('Utilities'));assert.match(f.node('financialAiMentorContent').innerHTML,/Calculated analysis/);assert.ok(f.reads.every(r=>['transactions','expenses','budgets','hq_restocks'].includes(r.table)));
});
test('Changing the filter during a delayed read cannot render the old branch over the new report',async()=>{
 let release,once=true;const f=fixture({delay:async ref=>{if(once&&ref.table==='transactions'){once=false;await new Promise(resolve=>release=resolve);}}});
 const first=f.flow.load();f.node('flowBranchFilter').value='Maa';await f.flow.load();release();await first;assert.equal(f.flow.getReport().branch,'Maa');assert.equal(f.flow.getReport().revenue,0);
});
test('Revoking report access or switching identity during an in-flight read prevents financial data rendering',async()=>{
 let release,once=true;const f=fixture({delay:async ref=>{if(once&&ref.table==='transactions'){once=false;await new Promise(resolve=>release=resolve);}}});
 const pending=f.flow.load();f.w.auth.currentUser.uid='different';release();await pending;assert.equal(f.flow.getReport(),null);assert.ok(!f.node('financialFlowchartContainer').innerHTML.includes('Recorded net sales'));
 const denied=fixture({permissions:['history']});await denied.flow.load();assert.equal(denied.reads.length,0);
});
test('A read failure clears analysis rather than leaving old profit advice on the screen',async()=>{
 const f=fixture();await f.flow.load();f.w.getDocsFromServer=async()=>{throw Error('Missing connection');};await f.flow.load();assert.equal(f.flow.getReport(),null);assert.match(f.node('financialAiMentorContent').textContent,/unavailable/);assert.match(f.node('financialFlowchartContainer').innerHTML,/Missing connection/);
});
test('Only the Owner finance shell loads the upgrade; no external AI endpoint or business-write API is added',()=>{
 const workspace=readFileSync(new URL('../takodeal-manager/manager-workspace.js',import.meta.url),'utf8'),worker=readFileSync(new URL('../takodeal-manager/sw.js',import.meta.url),'utf8'),ui=readFileSync(new URL('../takodeal-manager/financial-flow-ui.js',import.meta.url),'utf8');
 assert.match(workspace,/import '\.\/financial-flow-ui.js'/);assert.match(ui,/link.href='\.\/financial-flow.css'/);for(const file of ['financial-flow-model.js','financial-flow-ui.js','financial-flow.css'])assert.ok(worker.includes(file));assert.doesNotMatch(ui,/addDoc|updateDoc|runTransaction|api\.openai|generativelanguage/);
});
test('Deferred post-PIN installation runs after main defines its legacy loader and keeps report authorization',async()=>{
 const f=fixture(),scheduled=[],listeners=[],view=f.node('view-financial-flow');view.dataset={};view.classList={contains:()=>false};view.addEventListener=(...args)=>listeners.push(args);
 const d={readyState:'complete',getElementById:id=>id==='financialFlowStyles'?{}:id==='view-financial-flow'?view:id==='flowSpendChart'||id==='flowBudgetChart'||id==='financialAiMentorContent'?null:f.node(id)};
 const before=async()=>{},legacyAfterDependency=async()=>{};f.w.loadFinancialFlow=before;
 const flow=scheduleFinancialFlow(f.w,d,callback=>scheduled.push(callback));assert.equal(f.w.loadFinancialFlow,before);
 f.w.loadFinancialFlow=legacyAfterDependency;scheduled[0]();assert.equal(f.w.loadFinancialFlow,flow.load);assert.equal(view.dataset.financialReviewInstalled,'true');
 f.w.sessionUser.permissions=['history'];await f.w.loadFinancialFlow();assert.equal(f.reads.length,0);
});
