import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
import {normalizeStockAuditReport,stockAuditWasteEvidence,stockAuditMillis} from '../takodeal-manager/stock-audit-model.js';
import {createStockAuditReader} from '../takodeal-manager/stock-audit-reader.js';
import {installStockAudits,stockAuditVarianceHTML} from '../takodeal-manager/stock-audit-ui.js';
import {installOwnerStockAudits} from '../takodeal-manager/owner-stock-audits.js';
import {renderStockRequestReview,stockRequestVarianceButton} from '../takodeal-manager/stock-request-review.js';

const cutoff='2026-11-08T12:00:00+08:00',report={version:3,id:'saved-count',branch:'Maa',selectedCycle:'Weekly',periodStart:'2026-11-02',periodEnd:'2026-11-08',cutoff,timestamp:cutoff,counts:[{itemId:'flour',name:'Flour',systemQty:8,physicalQty:3,variance:-5,cost:null,uom:'g'}]},request={branch:'Maa',countSubmissionId:report.id,status:'Pending',items:[{name:'Flour',qty:100,uom:'g'}]};
const log={id:'waste-one',branch:'Maa',inventoryId:'flour',item:'Flour',uom:'g',variance:-2,type:'Waste',timestamp:'2026-11-06T11:00:00+08:00'};
const clone=value=>structuredClone(value);
function fixture({onDocument,onQuery,timeoutMs=15000}={}){
 const documents=new Map([['purchase_orders/count-request-saved-count',clone(request)],['inventory_audit_reports/saved-count',clone(report)]]),tables={stock_logs:[clone(log)],inventory_logs:[],staff_requests:[],transactions:[],stock_counts:[]},calls=[];
 const snapshot=(path,value=documents.get(path))=>({id:path.split('/').at(-1),metadata:{fromCache:false,hasPendingWrites:false},exists:()=>value!==undefined,data:()=>clone(value)});
 const w={db:{},auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',isOwner:true,branch:'Maa',permissions:['all'],allowedBranches:['All']},isBranchAllowed:branch=>['Maa','Cabantian'].includes(branch),
  doc:(_,table,id)=>({path:table+'/'+id}),collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:field=>({order:field}),limit:cap=>({cap}),query:(ref,...clauses)=>({...ref,clauses}),
  async getDocFromServer(ref){calls.push(ref);return onDocument?onDocument(ref,{documents,snapshot,calls,w}):snapshot(ref.path);},
  async getDocsFromServer(q){calls.push(q);if(onQuery)return onQuery(q,{tables,calls});assert.equal(q.clauses.find(row=>row.field==='branch').value,'Maa');assert.equal(q.clauses.find(row=>row.cap).cap,301);let rows=tables[q.table]||[];
   for(const clause of q.clauses.filter(row=>row.field))rows=rows.filter(row=>clause.op==='=='?row[clause.field]===clause.value:clause.op==='>='?stockAuditMillis(row[clause.field])>=+clause.value:stockAuditMillis(row[clause.field])<+clause.value);
   return {metadata:{fromCache:false,hasPendingWrites:false},docs:rows.slice(0,301).map(row=>({id:row.id,data:()=>clone(row)}))};},
  setDoc(){assert.fail('Variance review must not write');},updateDoc(){assert.fail('Variance review must not write');},runTransaction(){assert.fail('Variance review must not transact');}};
 const reader=createStockAuditReader(w,{timeoutMs});return {w,reader,calls,documents,tables,snapshot};
}
function dom(){const d=new ReviewDocument(),create=d.createElement.bind(d);d.createElement=tag=>{const node=create(tag);node.classList={add(){}};node.remove=function(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(row=>row!==this);};node.replaceChildren=function(...nodes){this.children=[];this.append(...nodes);};return node;};for(const id of ['stockAuditReports','stockAuditBranch','stockAuditBranchStatus']){const node=d.createElement('section');node.id=id;d.body.append(node);}return d;}

test('one glance keeps frozen expected, actual and shortage separate from already posted waste and never sums different units',()=>{
 const source=normalizeStockAuditReport({...report,counts:[...report.counts,{itemId:'cups',name:'Cups',uom:'pcs',systemQty:10,physicalQty:0},{itemId:'water',name:'Water',uom:'litre',systemQty:null,physicalQty:2}]}),waste=stockAuditWasteEvidence(source,{stockLogs:[log],complete:true}),html=stockAuditVarianceHTML(source,waste);
 assert.equal(source.counts[0].systemQty,8);assert.equal(source.counts[0].variance,-5);assert.equal(waste.items[0].appliedQuantity,2);assert.match(html,/8 g/);assert.match(html,/3 g/);assert.match(html,/5 g/);assert.match(html,/Posted stock deduction: 2 g/);assert.match(html,/10 pcs/);assert.match(html,/Not established/);assert.match(html,/never deducted again/);assert.match(html,/Different item units are not added together/);assert.doesNotMatch(html,/Short[^<]*15/);
});
test('bounded weekly waste reads stop at the exact saved cutoff, reject foreign or later events and preserve unknown sources',async()=>{
 const f=fixture();f.tables.stock_logs.push({...log,id:'later',variance:-900,timestamp:'2026-11-08T13:00:00+08:00'},{...log,id:'foreign',branch:'Cabantian',variance:-800});const result=await f.reader.waste(report);assert.equal(result.items[0].appliedQuantity,2);assert.equal(result.complete,true);assert.equal(f.calls.length,3);
 for(const q of f.calls){assert.equal(+q.clauses.find(row=>row.op==='>=').value,Date.parse('2026-11-02T00:00:00+08:00'));assert.equal(+q.clauses.find(row=>row.op==='<').value,Date.parse(cutoff)+1);}
 const denied=fixture({onQuery:async()=>{throw Error('Unavailable');}}),unknown=await denied.reader.waste(report);assert.equal(unknown.complete,false);assert.equal(unknown.items[0].complete,false);assert.doesNotMatch(stockAuditVarianceHTML(normalizeStockAuditReport(report),unknown),/No waste logged/);
});
test('a capped waste sample cannot certify no logged waste or label the week complete',async()=>{
 const f=fixture();f.tables.stock_logs=Array.from({length:301},(_,i)=>({...log,id:'count-'+i,type:'Staff Physical Count'}));const result=await f.reader.waste(report);assert.equal(result.complete,false);assert.equal(result.shouldWarn,false);assert.equal(result.items[0].complete,false);assert.match(result.coverage[0].error,/incomplete/);
});
test('out-of-scope source responses cannot be filtered into a falsely complete zero-waste result',async()=>{
 const f=fixture({onQuery:async()=>({metadata:{fromCache:false,hasPendingWrites:false},docs:[{id:'foreign',data:()=>({...log,branch:'Cabantian'})}]})}),result=await f.reader.waste(report);assert.equal(result.complete,false);assert.equal(result.items[0].complete,false);assert.match(result.coverage[0].error,/scope/);assert.doesNotMatch(stockAuditVarianceHTML(normalizeStockAuditReport(report),result),/No waste logged/);
});
test('request review follows its saved immutable report ID, rechecks the request link and performs no inventory query or write',async()=>{
 const f=fixture(),result=await f.reader.request({requestId:'count-request-saved-count'});assert.equal(result.id,report.id);assert.equal(result.branch,'Maa');assert.deepEqual(f.calls.map(row=>row.path),['purchase_orders/count-request-saved-count','inventory_audit_reports/saved-count','purchase_orders/count-request-saved-count']);assert.deepEqual(f.documents.get('purchase_orders/count-request-saved-count'),request);
});
test('older forecast and malformed report links never guess a variance or fall back to current inventory',async()=>{
 for(const link of [undefined,'wrong/path']){const f=fixture();f.documents.set('purchase_orders/count-request-saved-count',{...request,countSubmissionId:link,isForecast:true});await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/No immutable count|valid saved count/);assert.equal(f.calls.length,1);}
 const html=renderStockRequestReview({branch:'Maa',isForecast:true,items:[]},{poId:'old-forecast'}).html;assert.match(html,/No saved physical count report is linked/);assert.match(html,/do not establish a variance/);
});
test('wrong-branch, mutable-version, mismatched-ID and cached reports are refused before showing figures',async()=>{
 for(const patch of [{branch:'Cabantian'},{version:2},{id:'different'}]){const f=fixture();f.documents.set('inventory_audit_reports/saved-count',{...report,...patch});await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/does not match/);}
 const f=fixture({onDocument:(ref,{snapshot})=>({...snapshot(ref.path),metadata:{fromCache:true}})});await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/server/);
});
test('a request relinked while its immutable report loads cannot show the previous report as the current request variance',async()=>{
 const f=fixture({onDocument:(ref,{snapshot,documents})=>{const result=snapshot(ref.path);if(ref.path.startsWith('inventory_audit_reports/'))documents.set('purchase_orders/count-request-saved-count',{...request,countSubmissionId:'new-report'});return result;}});await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/changed while loading/);
});
test('account replacement and removed branch permissions during a read suppress the old report',async()=>{
 for(const change of ['account','permissions']){const hold=deferred(),f=fixture({onDocument:()=>hold.promise}),pending=f.reader.request({requestId:'count-request-saved-count'});await drain();if(change==='account')f.w.auth.currentUser={...f.w.auth.currentUser};else f.w.sessionUser.permissions=[];hold.resolve(f.snapshot('purchase_orders/count-request-saved-count'));await assert.rejects(pending,/account|review changed/i);assert.equal(f.calls.length,1);}
});
test('timed-out physical request reads remain coalesced and cannot stack retries',async()=>{
 const hold=deferred(),f=fixture({timeoutMs:3,onDocument:()=>hold.promise});await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/too long/);await assert.rejects(f.reader.request({requestId:'count-request-saved-count'}),/still pending/);assert.equal(f.calls.length,1);hold.resolve(f.snapshot('purchase_orders/count-request-saved-count'));await drain();
});
test('the visible Dispatch button is escaped, opens the exact linked report without modifying draft state, and preserves request review controls',async()=>{
 const f=fixture(),d=dom(),draft={items:[{name:'Existing draft',qty:20}]};f.w.dispatchCart=draft.items;const before=clone(draft);const adapter=installOwnerStockAudits(f.w,d),holder=d.createElement('section');holder.innerHTML=renderStockRequestReview(request,{poId:'count-request-saved-count'}).html;d.body.append(holder);
 holder.querySelector('[data-stock-request-variance]').click();await drain();const dialog=d.querySelector('dialog');assert.equal(dialog.open,true);assert.match(dialog.textContent,/Stock variance at a glance/);assert.match(dialog.textContent,/saved-count/);assert.match(dialog.textContent,/5 g/);let stopped=0;for(const listener of dialog.listeners.keydown||[])listener({key:'Enter',stopPropagation(){stopped++;}});assert.equal(stopped,1,'Keys in the read-only native dialog cannot confirm the underlying request dialog.');assert.deepEqual(f.w.dispatchCart,before.items);assert.equal(holder.querySelector('[data-stock-request-variance]').textContent,'Check count variance');assert.deepEqual(f.documents.get('purchase_orders/count-request-saved-count'),request);adapter.dispose();
 const hostile=`request'\"<&`;assert.equal(stockRequestVarianceButton(hostile).includes('onclick='),false);assert.match(stockRequestVarianceButton(hostile),/&quot;|&lt;|&amp;/);
});
test('closing an exact-report lookup or replacing its account cannot reopen a late report',async()=>{
 for(const change of ['close','account']){const hold=deferred(),f=fixture({onDocument:()=>hold.promise}),d=dom(),ui=installStockAudits(f.w,d),pending=ui.openRequest('count-request-saved-count');await drain();const dialog=d.querySelector('dialog');if(change==='close')dialog.querySelector('[data-audit-close]').click();else f.w.auth.currentUser={...f.w.auth.currentUser};hold.resolve(f.snapshot('purchase_orders/count-request-saved-count'));await pending;assert.equal(change==='close'?d.querySelector('dialog'):dialog.textContent.includes('5 g'),change==='close'?null:false);ui.dispose();}
});
test('both actual Dispatch feed layouts use the exact PO button helper while preserving Review and Dispatch controls',()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.match(main,/stockRequestVarianceButton\(docSnap\.id\)/);assert.match(main,/stockRequestVarianceButton\(req\.id\)/);assert.match(main,/window\.reviewPurchaseOrder\(/);assert.match(main,/window\.dispatchB2BOrder\(/);
});
