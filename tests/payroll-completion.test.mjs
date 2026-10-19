import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollActorKey,loadPayrollAccounts,applyConfirmedPayroll,exportPayslipImage,syncPayslipImageButton} from '../takodeal-manager/payroll-completion.js';
const held=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.innerText='';this.textContent='';this.value='';this.id='';this.disabled=false;}
 appendChild(node){this.children.push(node);node.parentNode=this;return node;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 replaceChild(next,old){const at=this.children.indexOf(old);this.children[at]=next;next.parentNode=this;old.parentNode=null;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='input'&&child.tagName==='INPUT'?[child]:[]),...child.querySelectorAll(selector)]);}
 cloneNode(){const next=new Node(this.tagName);Object.assign(next,{innerText:this.innerText,textContent:this.textContent,value:this.value,id:this.id,style:{...this.style}});for(const child of this.children)next.appendChild(child.cloneNode(true));return next;}
 click(){this.onClick?.();}
}
function fixture(){
 const nodes=new Map(),downloads=[],captures=[],urls=[],timers=[];
 const node=id=>{if(!nodes.has(id)){const value=new Node();value.id=id;nodes.set(id,value);}return nodes.get(id);};
 const d={getElementById:node,body:new Node('body'),createElement:tag=>{const value=new Node(tag);if(tag==='a')value.onClick=()=>downloads.push({filename:value.download,url:value.href});return value;}};
 const data={name:'Employee A',staffId:'A',branch:'Maa',start:'2030-01-01',end:'2030-01-15',basicPay:500,hours:8,meals:20};
 const api={auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',permissions:['all'],allowedBranches:['All']},currentPayslipData:data,globalPayrollCache:{[data.name]:data},liveAccounts:[{id:'bank',balance:5000}],requestAnimationFrame:fn=>fn(),setTimeout:fn=>timers.push(fn),URL:{createObjectURL:blob=>{const url='blob:sample-'+urls.length;urls.push({url,size:blob.size});return url;},revokeObjectURL:url=>{const item=urls.find(value=>value.url===url);if(item)item.revoked=true;}}};
 node('psName').innerText=data.name;node('payrollStart').value=data.start;node('payrollEnd').value=data.end;node('payslipModal').style.display='flex';node('btnDownloadPayslip').innerText='⬇️ Download Image';
 const input=new Node('input');input.id='psFoods';input.value='20';node('printablePayslip').appendChild(input);
 const canvas=()=>({width:1600,height:2200,toBlob:fn=>fn(new Blob(['sample PNG'],{type:'image/png'}))});
 const capture=async wrapper=>{captures.push(wrapper.cloneNode(true));return canvas();};
 const load=async()=>{};
 return {api,d,node,nodes,data,downloads,captures,urls,timers,capture,load,input};
}
test('one confirmed employee updates its row and total without rebuilding payroll, ledger or budget',()=>{
 const h=fixture(),button=new Node('button'),row={cells:[{textContent:h.data.name},{},{},{textContent:''}],style:{},querySelector:()=>button};
 h.node('payrollGeneratorBody').querySelectorAll=()=>[row];
 h.api.globalPayrollCache.Other={name:'Other',basicPay:400};
 for(const action of ['generateAutoPayslips','loadLedger','loadAccountsAndBudget'])h.api[action]=()=>assert.fail('No hidden full refresh');
 assert.equal(applyConfirmedPayroll(h.api,h.d,h.data,{frozenData:{...h.data,meals:10},finalNetPay:490,accountId:'bank',accountBalance:4510},{actorKey:payrollActorKey(h.api)}),true);
 assert.equal(h.data.isPaid,true);assert.equal(button.textContent,'✅ View Paid Payslip');assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱890.00');assert.equal(h.api.liveAccounts[0].balance,4510);assert.equal(h.api.globalPayrollCache.Other.isPaid,undefined);
});
test('a completed payment cannot replace another account, cutoff or newly generated preview',()=>{
 for(const change of ['account','cutoff','cache']){
  const h=fixture(),key=payrollActorKey(h.api);h.node('payrollGrandTotalAmount').innerText='New screen';
  if(change==='account')h.api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};
  if(change==='cutoff')h.node('payrollEnd').value='2030-01-31';
  if(change==='cache')h.api.globalPayrollCache[h.data.name]={...h.data};
  assert.equal(applyConfirmedPayroll(h.api,h.d,h.data,{frozenData:{...h.data},finalNetPay:480},{actorKey:key}),false);
  assert.equal(h.node('payrollGrandTotalAmount').innerText,'New screen');assert.equal(h.data.isPaid,true,'the captured confirmed payment remains marked complete');
 }
});
test('account picker reads just fresh permitted cash accounts, without opening budget or ledger',async()=>{
 const h=fixture(),reads=[];h.api.collection=(_,table)=>({table});h.api.getDocsFromServer=async ref=>{reads.push(ref.table);return {docs:[{id:'real-id',data:()=>({id:'spoof',branch:'Maa',balance:100,name:'Branch cash'})},{id:'other',data:()=>({branch:'Citygate',balance:200})}],metadata:{fromCache:false}};};
 h.api.auth.currentUser.email=h.api.sessionUser.email='manager@example.test';h.api.sessionUser.allowedBranches=['Maa'];
 const rows=await loadPayrollAccounts(h.api);assert.deepEqual(reads,['cash_accounts']);assert.equal(rows.length,1);assert.equal(rows[0].id,'real-id');
});
test('image work returns its real pending promise, deduplicates clicks and releases resources',async()=>{
 const h=fixture(),gate=held();let loads=0;const options={capture:h.capture,load:()=>{loads++;return gate.promise;}};
 const first=exportPayslipImage(h.api,h.d,options),second=exportPayslipImage(h.api,h.d,options);assert.equal(first,second);assert.equal(h.node('btnDownloadPayslip').disabled,true);
 for(let i=0;i<6&&!loads;i++)await Promise.resolve();assert.equal(loads,1);gate.resolve();const result=await first;
 assert.equal(result.filename,'Payslip_Employee_A_2030-01-15.png');assert.equal(h.downloads.length,1);assert.equal(h.d.body.children.length,0);assert.equal(h.node('btnDownloadPayslip').disabled,false);h.timers.forEach(fn=>fn());assert.ok(h.urls.every(value=>value.revoked));
});
test('queued payslips preserve captured names and values and cannot close another employee form',async()=>{
 const h=fixture(),gate=held();let number=0;const captures=[];
 const capture=async wrapper=>{captures.push(wrapper.cloneNode(true));if(number++===0)await gate.promise;return {width:1600,height:2200,toBlob:fn=>fn(new Blob(['png']))};};
 const first=exportPayslipImage(h.api,h.d,{load:h.load,capture});
 for(let i=0;i<6&&!captures.length;i++)await Promise.resolve();
 h.api.currentPayslipData={...h.data,name:'Employee B',staffId:'B'};h.node('psName').innerText='Employee B';h.input.value='99';syncPayslipImageButton(h.api,h.d);
 assert.equal(h.node('btnDownloadPayslip').disabled,false);
 gate.resolve();await first;assert.equal(h.node('payslipModal').style.display,'flex');assert.equal(h.downloads[0].filename,'Payslip_Employee_A_2030-01-15.png');
 const second=exportPayslipImage(h.api,h.d,{load:h.load,capture});await second;assert.equal(h.downloads[1].filename,'Payslip_Employee_B_2030-01-15.png');assert.equal(h.node('payslipModal').style.display,'none');
});
test('account changes and failed image rendering produce no file or leaked clone',async()=>{
 for(const change of ['account','render']){
  const h=fixture(),gate=held(),work=exportPayslipImage(h.api,h.d,{load:()=>gate.promise,capture:async()=>{if(change==='render')throw Error('render failure');return h.capture();}});
  if(change==='account')h.api.auth.currentUser={uid:'another',email:'another@example.test',emailVerified:true};
  gate.resolve();await assert.rejects(work);assert.equal(h.downloads.length,0);assert.equal(h.d.body.children.length,0);
 }
});
test('edits made during image generation remain open instead of being dismissed by its old completion',async()=>{
 const h=fixture(),gate=held(),work=exportPayslipImage(h.api,h.d,{load:()=>gate.promise,capture:h.capture});h.input.value='30';gate.resolve();await work;assert.equal(h.node('payslipModal').style.display,'flex');
});
