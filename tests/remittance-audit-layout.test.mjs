import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
import {legacyRemittanceDuplicates} from '../takodeal-manager/remittance-review.js';

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const functionSource=name=>{const start=source.indexOf('window.'+name+' = async function('),end=source.indexOf('\n};',start)+3;assert.ok(start>=0&&end>start,'actual '+name+' handler is available');return source.slice(start,end);};
const at=day=>new Date('2026-10-'+String(day).padStart(2,'0')+'T12:00:00+08:00');
const stamp=date=>({toDate:()=>new Date(+date),toMillis:()=>+date,valueOf:()=>+date});
const sdkValue=value=>value instanceof Date?stamp(value):Array.isArray(value)?value.map(sdkValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sdkValue(item)])):value;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

class Element{
 constructor(tag,attributes={},ownerDocument){this.tagName=tag.toUpperCase();this.attributes=attributes;this.id=attributes.id||'';this.ownerDocument=ownerDocument;this.children=[];this.style={};this.innerText='';this.textContent='';this.value='';this._html='';for(const pair of (attributes.style||'').split(';')){const at=pair.indexOf(':');if(at>0)this.style[pair.slice(0,at).trim().replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=pair.slice(at+1).trim();}}
 set innerHTML(value){this._html=String(value);this.children=this.ownerDocument.parse(this._html,this);}
 get innerHTML(){return this._html;}
 insertAdjacentHTML(_position,markup){this.ownerDocument.insertions.push(String(markup));this.children.push(...this.ownerDocument.parse(String(markup),this));}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 focus(){this.ownerDocument.focused=this;}
 querySelectorAll(selector){const nodes=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);return nodes.filter(node=>selector==='*'||selector==='button'&&node.tagName==='BUTTON'||selector.startsWith('#')&&node.id===selector.slice(1)||selector==='[onclick]'&&node.attributes.onclick);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function fixture({queryFailure=false,branchAllowed=true}={}){
 const nodes=new Map(),reads=[],writes=[],approvals=[],notices=[],errors=[],insertions=[];
 const d={nodes,insertions,focused:null,getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag,{},d),parse(markup,parent){
  const parsed=[];for(const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){const attributes={};for(const attr of match[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attributes[attr[1]]=attr[2]??attr[3];const node=new Element(match[1],attributes,d);node.parentNode=parent;if(node.id)nodes.set(node.id,node);parsed.push(node);}return parsed;
 }};d.body=new Element('body',{},d);
 for(const [id,tag]of [['branchTransferHistoryModal','div'],['bthModalTitle','h2'],['bthModalBody','tbody'],['transferStartDate','input'],['transferEndDate','input']])nodes.set(id,new Element(tag,{id},d));nodes.get('branchTransferHistoryModal').style.display='none';
 const store={
  shifts:[{id:'closed-one',branch:'Maa',status:'Closed',active:false,totalCashSales:10000,cashOut:1000,startingCash:999999},{id:'closed-legacy',branch:'Maa',status:'Closed',active:false,totalCashSales:5000,expenses:300},{id:'active-one',branch:'Maa',status:'Open',active:true,startTime:at(20),startingCash:777777},{id:'foreign-shift',branch:'Cabantian',status:'Closed',totalCashSales:999999}],
  transactions:[{id:'cash',branch:'Maa',timestamp:at(21),paymentMethod:'Cash',netTotal:700},{id:'split',branch:'Maa',timestamp:at(21),paymentMethod:'Split',netTotal:1000,splitDetails:[{method:'Cash',amount:400},{method:'GCash',amount:600}]},{id:'legacy-cash',branch:'Maa',timestamp:at(21),netTotal:500},{id:'voided',branch:'Maa',timestamp:at(21),status:'Voided',paymentMethod:'Cash',netTotal:9000},{id:'digital',branch:'Maa',timestamp:at(21),paymentMethod:'GCash',netTotal:6000},{id:'too-early',branch:'Maa',timestamp:at(19),paymentMethod:'Cash',netTotal:8888},{id:'foreign-sale',branch:'Cabantian',timestamp:at(21),paymentMethod:'Cash',netTotal:999999}],
  expenses:[{id:'active-expense',shiftId:'active-one',branch:'Maa',amount:120,timestamp:at(21)},{id:'mall-purchase',branch:'Maa',paidFrom:'Manager Fund',amount:300,description:'Sample mall supplies',timestamp:at(21)},{id:'old-mall-purchase',branch:'Maa',paidFrom:'Manager Fund',amount:200,description:'Older sample supplies',timestamp:at(1)},{id:'foreign-expense',branch:'Cabantian',paidFrom:'Manager Fund',amount:9999,timestamp:at(21)}],
  remittances:[{id:'current',branch:'Maa',cashier:'Sample Cashier',channel:'Cash',amount:12000,status:'Pending',salesPeriodStart:'2026-10-20',salesPeriodEnd:'2026-10-22',referenceNumber:'SAMPLE-CURRENT',timestamp:at(22)},{id:'received',branch:'Maa',amount:2000,status:'Received',timestamp:at(19)},{id:'previous-pending',branch:'Maa',amount:300,status:'Pending',timestamp:at(18)},{id:'rejected',branch:'Maa',amount:500,status:'Rejected',timestamp:at(17)},{id:'foreign-remit',branch:'Cabantian',amount:999999,status:'Received',timestamp:at(21)}],
  cash_accounts:[{id:'bank',balance:50000}],staff_deductions:[{id:'deduction',amount:123,status:'Unpaid'}]
 };
 const sdk={db:{sample:true},collection:(_db,table)=>({table}),where:(key,op,value)=>({kind:'where',key,op,value}),orderBy:(key,order)=>({kind:'order',key,order}),limit:count=>({kind:'limit',count}),query:(reference,...filters)=>({...reference,filters}),getDocs:async reference=>{
  reads.push(reference);if(queryFailure&&reference.table==='shifts')throw Error('Synthetic unavailable audit data');let rows=(store[reference.table]||[]).filter(row=>(reference.filters||[]).filter(filter=>filter.kind==='where').every(filter=>filter.op==='=='?row[filter.key]===filter.value:filter.op==='>='?row[filter.key]>=filter.value:row[filter.key]<=filter.value));for(const filter of reference.filters||[]){if(filter.kind==='order')rows=[...rows].sort((a,b)=>(a[filter.key]-b[filter.key])*(filter.order==='desc'?-1:1));if(filter.kind==='limit')rows=rows.slice(0,filter.count);}const docs=rows.map(row=>({id:row.id,data:()=>sdkValue({...row})}));return {docs,empty:!docs.length,forEach:callback=>docs.forEach(callback)};
 }};
 const denyWrite=name=>(...args)=>{writes.push({name,args});assert.fail('Viewing and closing an audit must not call '+name);};for(const name of ['updateDoc','setDoc','addDoc','deleteDoc','runTransaction','writeBatch'])sdk[name]=denyWrite(name);
 const w={...sdk,sessionUser:{email:'sample-reviewer@example.test',uid:'sample-reviewer',permissions:['transfers'],allowedBranches:['Maa']},isBranchAllowed:()=>branchAllowed,ManagerUI:{notify:message=>notices.push(message)},approveRemittance:(...args)=>{approvals.push(args);assert.fail('Closing an audit must not approve the remittance');},rejectRemittance:denyWrite('rejectRemittance')};
 const context=vm.createContext({...sdk,window:w,document:d,canOpenWorkspacePage,legacyRemittanceDuplicates,escapeHtml,console:{error:error=>errors.push(error)},setTimeout,clearTimeout,requestAnimationFrame:callback=>callback()});vm.runInContext(functionSource('openBranchTransferHistory')+'\n'+functionSource('viewRemittanceAudit'),context);
 const execute=code=>vm.runInContext(code,context),auditButton=()=>nodes.get('bthModalBody').querySelectorAll('[onclick]').find(node=>node.getAttribute('onclick').includes("viewRemittanceAudit('current'")),closeButton=()=>d.body.querySelectorAll('[onclick]').find(node=>node.getAttribute('onclick').includes('remitAuditModal')&&!node.getAttribute('onclick').includes('approveRemittance'));
 return {w,d,nodes,store,reads,writes,approvals,notices,errors,insertions,execute,auditButton,closeButton};
}

test('actual branch history opens its audit without closing history or changing ledger data, then the actual close control returns to history',async()=>{
 const f=fixture(),before=JSON.stringify(f.store);await f.w.openBranchTransferHistory('Maa');const history=f.nodes.get('bthModalBody').innerHTML;assert.equal(f.nodes.get('branchTransferHistoryModal').style.display,'flex');assert.match(history,/SAMPLE-CURRENT/);assert.ok(f.auditButton(),'current pending remittance has its actual Audit control');
 await f.execute(f.auditButton().getAttribute('onclick'));assert.deepEqual(f.errors,[]);assert.equal(f.nodes.get('remitAuditModal').style.display,'flex');assert.equal(f.nodes.get('branchTransferHistoryModal').style.display,'flex');assert.equal(f.nodes.get('bthModalBody').innerHTML,history);
 const audit=f.nodes.get('remitAuditBody').innerHTML;assert.match(audit,/TRUE LEDGER AUDIT/);assert.match(audit,/₱12,380\.00/);assert.match(audit,/₱12,000\.00/);assert.match(audit,/Shorting Detected/);assert.match(audit,/₱380\.00/);assert.match(audit,/Sample mall supplies/);assert.doesNotMatch(audit,/Older sample supplies|999,999/);assert.match(audit,/Recent Remittance History/);assert.match(audit,/Received/);assert.match(audit,/Rejected/);assert.ok(f.closeButton(),'audit has an actual close control');
 f.execute(f.closeButton().getAttribute('onclick'));assert.equal(f.nodes.get('remitAuditModal').style.display,'none');assert.equal(f.nodes.get('branchTransferHistoryModal').style.display,'flex');assert.equal(f.nodes.get('bthModalBody').innerHTML,history);assert.equal(JSON.stringify(f.store),before);assert.equal(f.writes.length,0);assert.equal(f.approvals.length,0);
});
test('reopening the existing actual audit reuses one overlay and preserves variance math and the pending source record',async()=>{
 const f=fixture();await f.w.openBranchTransferHistory('Maa');await f.execute(f.auditButton().getAttribute('onclick'));f.execute(f.closeButton().getAttribute('onclick'));await f.w.viewRemittanceAudit('current','Maa','2026-10-20','2026-10-22',12380,'Cash');assert.equal(f.insertions.length,1);assert.equal(f.nodes.get('remitAuditModal').style.display,'flex');assert.match(f.nodes.get('remitAuditBody').innerHTML,/Perfect Match/);assert.match(f.nodes.get('remitAuditBody').innerHTML,/\(₱0\.00\)/);assert.equal(f.store.remittances.find(row=>row.id==='current').status,'Pending');assert.equal(f.store.cash_accounts[0].balance,50000);assert.equal(f.writes.length,0);assert.equal(f.approvals.length,0);
});
test('an audit read failure keeps history available and its close control cannot approve or mutate financial records',async()=>{
 const f=fixture({queryFailure:true}),before=JSON.stringify(f.store);await f.w.openBranchTransferHistory('Maa');const history=f.nodes.get('bthModalBody').innerHTML;await f.execute(f.auditButton().getAttribute('onclick'));assert.equal(f.errors.length,1);assert.match(f.nodes.get('remitAuditBody').innerHTML,/Failed to run audit/);assert.equal(f.nodes.get('branchTransferHistoryModal').style.display,'flex');f.execute(f.closeButton().getAttribute('onclick'));assert.equal(f.nodes.get('remitAuditModal').style.display,'none');assert.equal(f.nodes.get('bthModalBody').innerHTML,history);assert.equal(JSON.stringify(f.store),before);assert.equal(f.writes.length,0);assert.equal(f.approvals.length,0);
});
