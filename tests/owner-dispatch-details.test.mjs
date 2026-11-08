import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installOwnerDispatchDetails} from '../takodeal-manager/owner-dispatch-details.js';
import {deferred,tick} from './helpers/review-dom.mjs';
const branch='Sample Branch',owner='jgo031996@gmail.com',encode=rows=>encodeURIComponent(JSON.stringify(rows));
function fixture({timeoutMs=1000,read}={}){
 const nodes=new Map();for(const id of ['dispatchDetailsModal','dispatchDetailsHeader','dispatchDetailsBody','dispatchDetailsFooter'])nodes.set(id,{style:{display:'none'},innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';}});
 const reads=[],writes=[],row={id:'sample',toBranch:branch,driver:'Sample Driver',date:'2026-11-08',time:'12:30',item:'Sample sauce',qty:5,uom:'L',status:'In Transit'};
 const api={auth:{currentUser:{uid:'owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'owner',email:owner,permissions:['all'],allowedBranches:[branch]},isBranchAllowed:b=>api.sessionUser.allowedBranches.includes(b),db:{},doc:(_,table,id)=>({table,id}),getDocFromServer:async ref=>{reads.push(ref);if(read)return read(ref);return {id:ref.id,exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>row};},updateDoc:()=>writes.push('update'),setDoc:()=>writes.push('set')};
 installOwnerDispatchDetails(api,{getElementById:id=>nodes.get(id)},{timeoutMs});return {api,nodes,reads,writes,row,open:(items=[{id:'sample'}],b=branch)=>api.viewDispatchDetails(encode(items),b)};
}
test('delivery details use fresh exact saved records and expose no stock mutation actions',async()=>{
 const f=fixture();f.row.item='<img src=x onerror=bad()> sauce';f.row.receivingRemarks='<script>private()</script>';f.row.receivedBy='<svg onload=bad()>';
 assert.equal(await f.open(),true);assert.deepEqual(f.reads,[{table:'dispatch_logs',id:'sample'}]);const html=f.nodes.get('dispatchDetailsBody').innerHTML;assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script|<svg|onclick/);assert.match(html,/Not recorded/);assert.equal(f.nodes.get('dispatchDetailsFooter').textContent,'Read-only delivery details');assert.deepEqual(f.writes,[]);
});
test('explicit saved zero quantities remain zero, while missing received values never invent zero',async()=>{
 const f=fixture();Object.assign(f.row,{displayQty:0,displayUom:'L',receivedDisplayQty:0,variance:0});assert.equal(await f.open(),true);assert.match(f.nodes.get('dispatchDetailsBody').innerHTML,/>0 L</);delete f.row.receivedDisplayQty;await f.open();assert.match(f.nodes.get('dispatchDetailsBody').innerHTML,/Not recorded L/);
});
test('converted dispatch and legacy received quantities retain their own saved units',async()=>{
 const f=fixture();Object.assign(f.row,{displayQty:2,displayUom:'Pack',qty:2000,uom:'Gram',receivedQty:1000,variance:-1000});assert.equal(await f.open(),true);const html=f.nodes.get('dispatchDetailsBody').innerHTML;assert.match(html,/>2 Pack</);assert.match(html,/>1000 Gram</);assert.match(html,/>-1000 Gram</);assert.doesNotMatch(html,/1000 Pack/);delete f.row.displayQty;await f.open();assert.match(f.nodes.get('dispatchDetailsBody').innerHTML,/>2000 Gram</);
});
test('malformed, duplicate and overfull item identities are refused before any read',async()=>{
 for(const items of [[],[null],[{id:'../../other'}],[{id:'sample'},{id:'sample'}],Array.from({length:151},(_,i)=>({id:'i'+i}))]){const f=fixture();assert.equal(await f.open(items),false);assert.equal(f.reads.length,0);assert.equal(f.nodes.get('dispatchDetailsModal').style.display,'none');}
});
test('foreign branch, cache data, wrong record identity and missing records never render a delivery',async()=>{
 for(const kind of ['branch','cache','id','missing']){const f=fixture({read:async ref=>({id:kind==='id'?'different':ref.id,exists:()=>kind!=='missing',metadata:{fromCache:kind==='cache',hasPendingWrites:false},data:()=>({toBranch:kind==='branch'?'Other Branch':branch})})});assert.equal(await f.open(),false);assert.equal(f.nodes.get('dispatchDetailsBody').innerHTML,'');assert.equal(f.writes.length,0);}
});
test('account replacement, in-place scope revocation and closing a held view prevent late rendering',async()=>{
 for(const change of ['account','session','scope','closed']){const gate=deferred(),f=fixture({read:()=>gate.promise}),pending=f.open();if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser};if(change==='session')f.api.sessionUser={...f.api.sessionUser};if(change==='scope')f.api.sessionUser.allowedBranches=[];if(change==='closed')f.nodes.get('dispatchDetailsModal').style.display='none';gate.resolve({id:'sample',exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>f.row});assert.equal(await pending,false);assert.equal(f.nodes.get('dispatchDetailsBody').innerHTML,'');assert.equal(f.nodes.get('dispatchDetailsModal').style.display,'none');}
});
test('a timed-out read cannot replace the error with a late saved row',async()=>{
 const gate=deferred(),f=fixture({timeoutMs:1,read:()=>gate.promise});assert.equal(await f.open(),false);const message=f.nodes.get('dispatchDetailsHeader').textContent;assert.match(message,/too long/);gate.resolve({id:'sample',exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>f.row});await tick();assert.equal(f.nodes.get('dispatchDetailsHeader').textContent,message);assert.equal(f.nodes.get('dispatchDetailsBody').innerHTML,'');
});
test('starting a newer delivery view supersedes a held previous selection',async()=>{
 const gate=deferred();let calls=0;const f=fixture({read:async ref=>++calls===1?gate.promise:{id:ref.id,exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>({...f.row,item:'Current item'})}}),old=f.open();assert.equal(await f.open([{id:'next'}]),true);gate.resolve({id:'sample',exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>({...f.row,item:'Old item'})});assert.equal(await old,false);assert.match(f.nodes.get('dispatchDetailsBody').innerHTML,/Current item/);assert.doesNotMatch(f.nodes.get('dispatchDetailsBody').innerHTML,/Old item/);
});
test('Owner renderers no longer emit dead direct Dispatch or prep Undo controls',()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.doesNotMatch(main,/window\.dispatchB2BOrder\(/);assert.doesNotMatch(main,/window\.undoKitchenPrep\(/);assert.match(main,/window\.reviewPurchaseOrder\(/);assert.match(main,/Review to add quantities to the dispatch draft/);assert.match(main,/Review stock corrections separately/);
});
test('actual Logistics Feed safely binds quote-containing branch names and exact canonical item IDs to the new details handler',async()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=main.indexOf('window.loadDispatchLogs ='),source=main.slice(start,main.indexOf('window.renderLogisticsFeed =',start)),branch="O'Hare Branch",calls=[];
 const api={sessionUser:{isFranchisee:false},renderLogisticsFeed(){},viewDispatchDetails:(encoded,selectedBranch)=>calls.push({rows:JSON.parse(decodeURIComponent(encoded)),branch:selectedBranch})};const rows={purchase_orders:[],dispatch_logs:[{id:'sample',toBranch:branch,driver:"Driver's name",date:'2026-11-08',time:'12:30',status:'In Transit',timestamp:new Date()}]};
 const context=vm.createContext({window:api,document:{getElementById:()=>({innerHTML:''})},db:{},collection:(_,table)=>({table}),query:ref=>ref,where(){},orderBy(){},getDocs:async q=>({forEach:fn=>rows[q.table].forEach(row=>fn({id:row.id,data:()=>row}))}),stockRequestVarianceButton:()=>'',console});vm.runInContext(source,context);await api.loadDispatchLogs();const onclick=/onclick="(window\.viewDispatchDetails[^"\n]+)"/.exec(api.globalDeliveryHtml)?.[1];assert.ok(onclick);vm.runInContext(onclick,context);assert.equal(calls.length,1);assert.equal(calls[0].branch,branch);assert.equal(calls[0].rows[0].id,'sample');
});
