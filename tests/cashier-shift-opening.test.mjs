import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
function section(source,start){const at=source.indexOf(start);assert.ok(at>=0);return source.slice(at,source.indexOf('\n};',at)+3);}
function fixture(){
 const nodes=new Map([
  ['btnOpenShiftSubmit',{innerText:'Open Shift',disabled:false}],['inputStartingCash',{value:'2000'}],
  ['btnTopShift',{innerText:'Shift Closed',innerHTML:'Shift Closed',style:{}}],['globalShiftLockout',{style:{display:'flex'}}],
  ['btnMainPlaceOrder',{disabled:true}],['shiftModal',{style:{display:'flex'}}],['lockoutQuote',{innerText:''}]
 ]),saved=new Map([['takodeal_device_branch','Maa'],['cashierName','John']]),errors=[],warnings=[];
 let opens=0,policy=async()=>({isMallBranch:false}),open=async()=> 'new-shift',failLocal=false;
 const context={sessionUser:{branch:'Maa',cashierName:'John'},currentShift:null,activeShiftDetails:null,systemReady:true,
  localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(failLocal&&key==='currentShiftId')throw Error('Local cache full');saved.set(key,value);}},
  document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],querySelector:()=>({id:'view-pos'})},
  db:{},collection:(_,table)=>({table}),where:(...parts)=>parts,orderBy:(...parts)=>parts,limit:n=>n,query:(...parts)=>parts,
  getDocsFromServer:async()=>({docs:[]}),readBranchPolicy:(...args)=>policy(...args),readMallOpeningCash:async()=>2000,
  readClosedCashCarry:async()=>0,recordOpeningCashReview:async()=>{},
  openNewShift:async(...args)=>{opens++;return open(...args);},checkShiftStatus:async()=>({active:false}),
  closeModal:id=>{nodes.get(id).style.display='none';},alert:message=>errors.push(message),
  console:{error(){},warn:(...args)=>warnings.push(args)},Swal:{fire:async()=>({isConfirmed:true})}
 };
 context.window=context;
 const uiStart=page.indexOf('    async function checkCurrentShift() {'),uiEnd=page.indexOf('    function openShiftModal() {',uiStart);
 vm.createContext(context);vm.runInContext(page.slice(uiStart,uiEnd),context);
 vm.runInContext(section(main,'window.submitOpenShift = async function()'),context);
 return{context,nodes,saved,errors,warnings,opens:()=>opens,setPolicy:value=>{policy=value;},setOpen:value=>{open=value;},failLocal:()=>{failLocal=true;}};
}
test('actual opening handler uses authoritative UI state to hide the real register lock and enable checkout',async()=>{
 const f=fixture();await f.context.submitOpenShift();
 assert.equal(f.opens(),1);assert.equal(f.context.currentShift.shiftId,'new-shift');assert.equal(f.context.activeShiftDetails,f.context.currentShift);
 assert.equal(f.nodes.get('globalShiftLockout').style.display,'none');assert.equal(f.nodes.get('btnMainPlaceOrder').disabled,false);
 assert.match(f.nodes.get('btnTopShift').innerHTML,/Active Shift/);assert.equal(f.nodes.get('shiftModal').style.display,'none');assert.deepEqual(f.errors,[]);
 assert.equal(f.saved.get('currentShiftId'),'new-shift');assert.equal(f.nodes.get('btnOpenShiftSubmit').disabled,false);
});
test('an older closed-register response cannot relock a shift confirmed open while the read was pending',async()=>{
 const f=fixture();let finish;f.context.checkShiftStatus=()=>new Promise(resolve=>finish=resolve);
 const read=f.context.checkCurrentShift();await f.context.submitOpenShift();finish({active:false});await read;
 assert.equal(f.context.currentShift.shiftId,'new-shift');assert.equal(f.nodes.get('globalShiftLockout').style.display,'none');
 assert.equal(f.nodes.get('btnMainPlaceOrder').disabled,false);assert.match(f.nodes.get('btnTopShift').innerHTML,/Active Shift/);
});
test('failed shift creation keeps the register locked and preserves the retry controls',async()=>{
 const f=fixture();f.setOpen(async()=>null);await f.context.submitOpenShift();
 assert.equal(f.context.currentShift,null);assert.equal(f.nodes.get('globalShiftLockout').style.display,'flex');
 assert.equal(f.nodes.get('btnMainPlaceOrder').disabled,true);assert.equal(f.nodes.get('shiftModal').style.display,'flex');
 assert.equal(f.nodes.get('btnOpenShiftSubmit').disabled,false);assert.match(f.errors[0],/Failed to open shift/);
});
test('a branch or cashier change during opening checks cannot create or unlock a stale shift',async()=>{
 for(const change of ['branch','cashier']){
  const f=fixture();let finish;f.setPolicy(()=>new Promise(resolve=>finish=resolve));const opening=f.context.submitOpenShift();
  if(change==='branch'){f.saved.set('takodeal_device_branch','Citygate');f.context.sessionUser.branch='Citygate';}else f.context.sessionUser.cashierName='Jenny';
  finish({isMallBranch:false});await opening;
  assert.equal(f.opens(),0);assert.equal(f.context.currentShift,null);assert.equal(f.nodes.get('globalShiftLockout').style.display,'flex');assert.match(f.errors[0],/cashier or branch changed/);
 }
});
test('a session changed during the server write cannot unlock its new session using the previous shift',async()=>{
 const f=fixture();f.setOpen(async()=>{f.context.sessionUser.cashierName='Jenny';return 'old-session-shift';});await f.context.submitOpenShift();
 assert.equal(f.opens(),1);assert.equal(f.context.currentShift,null);assert.equal(f.nodes.get('globalShiftLockout').style.display,'flex');
 assert.equal(f.saved.has('currentShiftId'),false);assert.match(f.errors[0],/cashier or branch changed/);
});
test('blank, nonnumeric and negative drawer counts do not create shifts; an explicit empty drawer does',async()=>{
 for(const value of ['', 'abc', '-1']){const f=fixture();f.nodes.get('inputStartingCash').value=value;await f.context.submitOpenShift();assert.equal(f.opens(),0);assert.match(f.errors[0],/starting cash amount/);}
 const f=fixture();f.nodes.get('inputStartingCash').value='0';await f.context.submitOpenShift();assert.equal(f.opens(),1);assert.equal(f.context.currentShift.startingCash,0);
});
test('a local cache failure after the confirmed server write does not report failure or leave a closed register',async()=>{
 const f=fixture();f.failLocal();await f.context.submitOpenShift();
 assert.equal(f.opens(),1);assert.equal(f.context.currentShift.shiftId,'new-shift');assert.equal(f.nodes.get('globalShiftLockout').style.display,'none');
 assert.equal(f.nodes.get('btnMainPlaceOrder').disabled,false);assert.deepEqual(f.errors,[]);assert.equal(f.warnings.length,1);
});
test('opening an already active local shift does not create another financial shift record',async()=>{
 const f=fixture();f.context.currentShift={active:true,shiftId:'already-open'};await f.context.submitOpenShift();
 assert.equal(f.opens(),0);assert.equal(f.context.currentShift.shiftId,'already-open');assert.equal(f.nodes.get('globalShiftLockout').style.display,'none');
});
test('the actual server-open function rechecks its captured session immediately before writing',async()=>{
 const f=fixture();let writes=0;f.context.addDoc=async()=>{writes++;return{id:'created'};};f.context.serverTimestamp=()=>1;
 vm.runInContext(section(main,'window.openNewShift ='),f.context);
 await f.context.openNewShift('Maa','John',2000,{isCurrent:()=>false});assert.equal(writes,0);
});
test('the actual server-open function preserves the verified cashier instead of overriding it with a stale cached name',async()=>{
 const f=fixture();let created;f.saved.set('cashierName','Previous Staff');f.context.addDoc=async(_,payload)=>{created=payload;return{id:'created'};};f.context.serverTimestamp=()=>1;
 vm.runInContext(section(main,'window.openNewShift ='),f.context);
 assert.equal(await f.context.openNewShift('Maa','Verified Current Staff',2000),'created');assert.equal(created.cashier,'Verified Current Staff');
});
