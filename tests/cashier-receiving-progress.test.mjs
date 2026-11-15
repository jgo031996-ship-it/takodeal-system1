import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDeliveryReceiptProgress} from '../Takodeal-POS/cashier-incoming-deliveries.js';

const main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const start=main.indexOf('window.submitGroupedDispatch = async function('),end=main.indexOf('\n};',start)+3;
assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function turn(){await Promise.resolve();await Promise.resolve();}
function fixture({receive=async()=>84,confirm=true,render=()=>{}}={}){
 let clock=0,tick=null,cleared=0,calls=0,sheetReads=0,changed=false;
 const notices=[],api={},button={disabled:false,innerText:'Confirm'},nodes=new Map([
  ['btn_submit_dispatch_fiction-batch',button],['incomingDeliveriesStatus',{textContent:''}],
  ['recv_val_line',{value:'1.5',placeholder:'2'}],['missing_check_line',{checked:false}],['remark_val_line',{value:'Physical count retained'}]
 ]);
 const permit={api,branch:'Fictional Branch',actor:'Fictional Receiver',assertCurrent(){if(changed)throw Error('Workspace changed.');}};
 const w={incomingDeliveriesFeed:{receiveContext:()=>permit},incomingDeliveryDrafts:{isHeld:()=>false,discard(){}},invalidateCache(){},renderDeliveriesTab:render,loadStockRequestUI:()=>{sheetReads++;return new Promise(()=>{});}};
 const progress=(source,options)=>createDeliveryReceiptProgress(source,{...options,now:()=>clock,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{cleared++;tick=null;}});
 vm.runInNewContext(main.slice(start,end),{window:w,document:{getElementById:id=>nodes.get(id)},Swal:{fire:async(...args)=>{notices.push(args);return{isConfirmed:confirm};}},createDeliveryReceiptProgress:progress,receiveDispatch:async(...args)=>{calls++;return receive(...args);},JSON,decodeURIComponent,Number,Error,String});
 const submit=()=>w.submitGroupedDispatch('fiction-batch',encodeURIComponent(JSON.stringify([{id:'line',item:'Fictional Ingredient'}])));
 return{w,nodes,notices,button,api,submit,get calls(){return calls;},get sheetReads(){return sheetReads;},get cleared(){return cleared;},elapsed(ms){clock=ms;tick?.();},change(){changed=true;}};
}

test('actual caller reports definitive receipt ACK without waiting for an unrelated hanging inventory sheet', {timeout:1000},async()=>{
 const f=fixture();await f.submit();
 assert.equal(f.calls,1);assert.equal(f.sheetReads,0);assert.equal(f.w.cashierDispatchReceiving,false);
 assert.equal(f.notices.filter(row=>row[0]==='Shipment received').length,1);
 assert.match(f.nodes.get('incomingDeliveriesStatus').textContent,/Receipt saved.*Fictional Branch.*fiction-batch/);
 assert.equal(f.button.disabled,true);assert.equal(f.button.innerText,'Shipment received');assert.equal(f.cleared,1);
});
test('elapsed waiting notice never settles or retries the physical stock request and duplicate clicks remain held',async()=>{
 const physical=deferred(),f=fixture({receive:()=>physical.promise}),pending=f.submit();await turn();
 f.elapsed(45000);assert.equal(f.w.cashierDispatchReceiving,true);assert.equal(f.button.disabled,true);
 assert.match(f.nodes.get('incomingDeliveriesStatus').textContent,/45s elapsed.*Still waiting.*do not receive this shipment again/);
 await f.submit();assert.equal(f.calls,1);assert.equal(f.notices.filter(row=>row[0]==='Shipment received').length,0);
 physical.resolve(1);await pending;assert.equal(f.w.cashierDispatchReceiving,false);assert.equal(f.cleared,1);
});
test('physical rejection retains counts and original receipt reference, disables stale submission, and does not auto-retry',async()=>{
 const physical=deferred(),f=fixture({receive:()=>physical.promise}),pending=f.submit();await turn();f.elapsed(30000);
 physical.reject(Error('Fictional connection reply lost.'));await pending;
 assert.equal(f.calls,1);assert.equal(f.button.disabled,true);assert.equal(f.w.cashierDispatchReceiving,false);
 assert.equal(f.nodes.get('recv_val_line').value,'1.5');assert.equal(f.nodes.get('remark_val_line').value,'Physical count retained');
 const error=f.notices.find(row=>row[0]==='Receipt result not confirmed');assert.match(error[1],/original Fictional Branch shipment fiction-batch.*may already be saved/);
 assert.match(f.nodes.get('incomingDeliveriesStatus').textContent,/unconfirmed.*Fictional Branch.*fiction-batch/);
 await f.submit();assert.equal(f.calls,1);assert.equal(f.cleared,1);
});
test('definitive ACK remains saved if the local screen render fails; no stock resubmission is offered',async()=>{
 const f=fixture({render(){throw Error('Fictional local screen failed.');}});await f.submit();
 assert.equal(f.calls,1);assert.equal(f.button.disabled,true);
 assert.ok(f.notices.some(row=>row[0]==='Shipment received'&&/were saved/.test(row[1])));
 assert.ok(f.notices.some(row=>/screen could not refresh/.test(String(row[1]))));
 assert.equal(f.sheetReads,0);
});
test('cancel and context change preserve original safeguards without starting or falsely confirming a receipt',async()=>{
 const cancel=fixture({confirm:false});await cancel.submit();assert.equal(cancel.calls,0);assert.equal(cancel.button.disabled,false);assert.equal(cancel.cleared,0);
 const physical=deferred(),f=fixture({receive:()=>physical.promise}),pending=f.submit();await turn();f.change();
 f.nodes.get('incomingDeliveriesStatus').textContent='New workspace';f.elapsed(30000);assert.equal(f.nodes.get('incomingDeliveriesStatus').textContent,'New workspace');
 physical.resolve(1);await pending;assert.equal(f.calls,1);assert.equal(f.button.disabled,true);
 assert.match(f.nodes.get('incomingDeliveriesStatus').textContent,/Receipt saved.*original Fictional Branch shipment fiction-batch/);
});
test('progress wrapper delegates the exact read/transaction objects and only observes their completion',async()=>{
 let tick,clock=0,cleared=0;const messages=[],db={},reference={path:'dispatch_logs/fiction'},snapshot={},transaction={},work=()=>{};
 const api={db,getDocFromServer:async ref=>{assert.equal(ref,reference);return snapshot;},runTransaction:async(database,callback)=>{assert.equal(database,db);assert.equal(callback,work);return transaction;}};
 const progress=createDeliveryReceiptProgress(api,{itemCount:84,onProgress:message=>messages.push(message),now:()=>clock,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>cleared++});
 assert.equal(progress.api.db,db);assert.equal(await progress.api.getDocFromServer(reference),snapshot);assert.match(messages.at(-1),/Checking shipment 1 of 84/);
 assert.equal(await progress.api.runTransaction(db,work),transaction);assert.match(messages.at(-1),/Saving stock and the delivery record together/);
 clock=16000;tick();assert.match(messages.at(-1),/16s elapsed.*waiting for confirmation/);progress.finish();progress.finish();assert.equal(cleared,1);
 const count=messages.length;tick();assert.equal(messages.length,count);
});
