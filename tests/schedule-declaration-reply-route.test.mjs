import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reviewOrdinaryStaffRequest,ordinaryStaffRequestNeedsRecovery,quoteOrdinaryStaffRequestRecovery} from '../takodeal-manager/request-review-service.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.submitRequestReply = async function('),handler=source.slice(start,source.indexOf('\n};',start)+3);
function harness({changedOnSecondRead=false,proof=true}={}){
 const h=firestoreHarness(),saved={type:'Schedule Declaration',status:'Pending',branch:'Synthetic Branch'};h.put('staff_requests/synthetic',saved);
 const calls={reads:0,uploads:0,writes:[],alerts:[]},button={innerText:'Confirm Approved',disabled:false},modal={remove(){calls.removed=true;}},nodes={btnSubmitReply:button,dynamicReplyModal:modal,replyMessage:{value:'A stale generic form reply'},replyProofImage:{files:proof?[{name:'synthetic.png'}]:[]}};
 const api={...h.api,auth:{currentUser:{uid:'owner'}},sessionUser:{uid:'owner'},lateRequestContext:null,isBranchAllowed:()=>true,ref:()=>({}),uploadBytes:async()=>{calls.uploads++;return{ref:{}};},getDownloadURL:async()=>'/synthetic',serverTimestamp:()=>new Date(),runTransaction:(db,callback)=>h.api.runTransaction(db,tx=>callback({...tx,get:ref=>{calls.reads++;return tx.get(ref);},update:(...args)=>{calls.writes.push(['update',...args]);tx.update(...args);},set:(...args)=>{calls.writes.push(['set',...args]);tx.set(...args);}})),updateDoc:async(...args)=>calls.writes.push(['update',...args]),addDoc:async(...args)=>calls.writes.push(['add',...args])};
 const document={getElementById:id=>nodes[id]||null},context=vm.createContext({window:api,document,Date,console:{error(){}},isLatenessRequest:()=>false,reviewOrdinaryStaffRequest,ordinaryStaffRequestNeedsRecovery,quoteOrdinaryStaffRequestRecovery,tkOwnerDoc:async()=>{calls.reads++;return{exists:()=>true,data:()=>({...saved,...(changedOnSecondRead&&calls.reads===1?{type:'Cash Advance',amount:500,staffId:'synthetic-staff'}:{type:'Schedule Declaration'})})};},Swal:{fire:(...args)=>calls.alerts.push(args)}});vm.runInContext(handler,context);return{api,calls,button,h,saved};
}
for(const type of ['Cash Advance','Staff Meal','Reason Letter'])test('a stale '+type+' reply cannot approve a saved Schedule Declaration or upload proof/create deductions',async()=>{
 const f=harness();await f.api.submitRequestReply('synthetic','Approved',type,999,'Untrusted retained name');assert.equal(f.calls.reads,1);assert.equal(f.calls.uploads,0);assert.deepEqual(f.calls.writes,[]);assert.match(f.calls.alerts.at(-1)[1],/Review declaration/);assert.equal(f.button.disabled,false);
});
test('a saved type changing before the second server gate cannot receive ordinary status or financial writes',async()=>{
 const f=harness({changedOnSecondRead:true,proof:false});await f.api.submitRequestReply('synthetic','Approved','Cash Advance',999,'Synthetic Crew');assert.equal(f.calls.reads,2);assert.equal(f.calls.uploads,0);assert.deepEqual(f.calls.writes,[]);assert.deepEqual([...f.h.docs],[['staff_requests/synthetic',f.saved]]);assert.match(f.calls.alerts.at(-1)[1],/linked specialist review/);assert.equal(f.button.disabled,false);
});
