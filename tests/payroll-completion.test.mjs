import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollActorKey,loadPayrollAccounts,applyConfirmedPayroll,checkSavedPayslipPayment,exportPayslipImage,syncPayslipImageButton} from '../takodeal-manager/payroll-completion.js';
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
test('confirmed cash shortage payroll updates its row and remaining total from the frozen full amount',()=>{
 const h=fixture(),button=new Node('button'),row={cells:[{textContent:h.data.name},{},{},{textContent:''}],style:{},querySelector:()=>button};h.node('payrollGeneratorBody').querySelectorAll=()=>[row];h.api.globalPayrollCache.Other={name:'Other',basicPay:400,cashShortages:90};
 assert.equal(applyConfirmedPayroll(h.api,h.d,h.data,{frozenData:{...h.data,cashShortages:90,cashShortageRows:[{id:'cash-shortage-sample',amount:90}]},finalNetPay:390,accountId:'bank',accountBalance:4610},{actorKey:payrollActorKey(h.api)}),true);
 assert.equal(row.cells[3].textContent,'Total: ₱110.00 · Paid and saved');assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱700.00');assert.equal(h.data.cashShortages,90);assert.equal(h.api.liveAccounts[0].balance,4610);
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

function paymentCheckFixture(){
 const h=fixture(),notifications=[];h.api.ManagerUI={notify:text=>notifications.push(text)};h.node('btnCheckSavedPayslip').innerText='Check saved payment';
 for(const action of ['updateDoc','setDoc','addDoc','deleteDoc','writeBatch','generateAutoPayslips','loadLedger','loadAccountsAndBudget'])h.api[action]=()=>assert.fail('A read-only payment check must not write or rebuild financial data');
 const saved={status:'paid',id:'saved-payment',alreadyPaid:true,finalNetPay:410,accountId:'original-bank',accountName:'Original PNB',frozenData:{staffId:h.data.staffId,name:h.data.name,branch:h.data.branch,start:h.data.start,end:h.data.end,basicPay:430,meals:20,hours:7,finalNetPay:410,isPaid:true}};
 return {...h,notifications,saved};
}

test('saved payment check restores the exact original snapshot without inheriting newer preview charges or debiting an account',async()=>{
 const h=paymentCheckFixture();Object.assign(h.data,{cashShortages:90,cashShortageRows:[{id:'cash-shortage-new',amount:90}],onlineRefunds:30,refundRows:[{id:'refund-new',amount:30}],profile:{private:'preview'},basicPay:900});let opened=0;
 const result=await checkSavedPayslipPayment(h.api,h.d,{inspect:async()=>h.saved,onFound:saved=>{assert.equal(saved.accountId,'original-bank');opened++;}});
 assert.equal(result,h.saved);assert.equal(h.data.finalNetPay,410);assert.equal(h.data.basicPay,430);assert.equal(h.data.cashShortages,undefined);assert.equal(h.data.onlineRefunds,undefined);assert.equal(h.data.cashShortageRows,undefined);assert.equal(h.data.refundRows,undefined);assert.equal(h.data.profile,undefined);assert.equal(h.data.isPaid,true);assert.equal(h.api.liveAccounts[0].balance,5000);assert.equal(opened,1);assert.ok(h.api.paidPayrollSnapshots.has(h.data));
 assert.match(h.notifications[0],/₱410\.00 · Original PNB/);assert.match(h.notifications[0],/No new payment or deduction/);assert.equal(h.node('btnCheckSavedPayslip').disabled,false);assert.equal(h.node('btnCheckSavedPayslip').innerText,'Check saved payment');
});

test('read-only saved-payment UI coalesces repeated checks and opens the confirmed result once',async()=>{
 const h=paymentCheckFixture(),gate=held();let calls=0,opened=0;const options={inspect:async(api,{assertCurrent})=>{calls++;assertCurrent();await gate.promise;assertCurrent();return h.saved;},onFound:()=>opened++};
 const first=checkSavedPayslipPayment(h.api,h.d,options),second=checkSavedPayslipPayment(h.api,h.d,options);assert.equal(first,second);assert.equal(h.node('btnCheckSavedPayslip').disabled,true);assert.equal(h.node('btnCheckSavedPayslip').innerText,'Checking saved payment…');
 await Promise.resolve();assert.equal(calls,1);gate.resolve();await first;assert.equal(opened,1);assert.equal(h.notifications.length,1);assert.equal(h.node('btnCheckSavedPayslip').disabled,false);
});

test('no saved payment leaves the preview and finances unchanged and never marks outside-app payment as paid',async()=>{
 const h=paymentCheckFixture(),before=structuredClone(h.data);const result=await checkSavedPayslipPayment(h.api,h.d,{inspect:async()=>({status:'not-recorded',alreadyPaid:false}),onFound:()=>assert.fail('No paid snapshot to open')});
 assert.equal(result.status,'not-recorded');assert.deepEqual(h.data,before);assert.equal(h.api.liveAccounts[0].balance,5000);assert.match(h.notifications[0],/No confirmed payment record/);assert.match(h.notifications[0],/Nothing was marked paid or deducted/);assert.match(h.notifications[0],/outside the app/);
});

test('network failure and timed-out saved-payment checks remain unconfirmed and ignore late results',async()=>{
 for(const failure of ['network','timeout']){
  const h=paymentCheckFixture(),before=structuredClone(h.data),gate=held();let opened=0;
  const result=await checkSavedPayslipPayment(h.api,h.d,{timeoutMs:5,inspect:failure==='network'?async()=>{throw Error('HQ is unavailable. Reconnect and check again.');}:()=>gate.promise,onFound:()=>opened++});
  assert.equal(result.status,'unconfirmed');assert.deepEqual(h.data,before);assert.equal(opened,0);assert.equal(h.node('btnCheckSavedPayslip').disabled,false);assert.equal(h.notifications.length,1);assert.doesNotMatch(h.notifications[0],/No confirmed payment record was found/);
  if(failure==='timeout'){gate.resolve(h.saved);await Promise.resolve();await Promise.resolve();assert.deepEqual(h.data,before);assert.equal(h.notifications.length,1);assert.equal(opened,0);}
 }
});

test('a synchronous inspection failure releases the pending check so reconnection can retry',async()=>{
 const h=paymentCheckFixture();let calls=0;const inspect=()=>{if(++calls===1)throw Error('Connection is not ready.');return Promise.resolve(h.saved);};
 assert.equal((await checkSavedPayslipPayment(h.api,h.d,{inspect})).status,'unconfirmed');assert.equal(h.node('btnCheckSavedPayslip').disabled,false);assert.equal((await checkSavedPayslipPayment(h.api,h.d,{inspect})).status,'paid');assert.equal(calls,2);assert.equal(h.notifications.length,2);
});

test('actor, branch, cutoff, selection and regenerated-cache changes prevent stale payment recovery or notifications',async()=>{
 for(const change of ['account','branch','cutoff','selection','cache']){
  const h=paymentCheckFixture(),gate=held(),before=structuredClone(h.data);let opened=0;
  const work=checkSavedPayslipPayment(h.api,h.d,{inspect:()=>gate.promise,onFound:()=>opened++});await Promise.resolve();
  if(change==='account')h.api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};
  if(change==='branch')h.api.sessionUser.allowedBranches=['Citygate'];
  if(change==='cutoff')h.node('payrollEnd').value='2030-01-31';
  if(change==='selection')h.api.currentPayslipData={...h.data,name:'Employee B',staffId:'B'};
  if(change==='cache')h.api.globalPayrollCache[h.data.name]={...h.data};
  h.node('btnCheckSavedPayslip').innerText='New selection';h.node('btnCheckSavedPayslip').disabled=false;gate.resolve(h.saved);assert.equal((await work).status,'unconfirmed');assert.deepEqual(h.data,before);assert.equal(opened,0);assert.equal(h.notifications.length,0);assert.equal(h.node('btnCheckSavedPayslip').innerText,'New selection');assert.equal(h.node('btnCheckSavedPayslip').disabled,false);
 }
});

test('a view-render error after read-only confirmation cannot misreport the saved payment as failed',async()=>{
 const h=paymentCheckFixture();const result=await checkSavedPayslipPayment(h.api,h.d,{inspect:async()=>h.saved,onFound:()=>{throw Error('Could not render the modal');}});
 assert.equal(result.status,'paid');assert.equal(h.data.finalNetPay,410);assert.equal(h.data.isPaid,true);assert.equal(h.api.liveAccounts[0].balance,5000);assert.equal(h.notifications.length,1);assert.match(h.notifications[0],/Saved payment confirmed/);assert.match(h.notifications[0],/Reopen View Paid Payslip/);assert.doesNotMatch(h.notifications[0],/Could not render/);assert.equal(h.node('btnCheckSavedPayslip').disabled,false);
});
