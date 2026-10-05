import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateManualAttendance,saveManualAttendance} from '../takodeal-manager/attendance-audit.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=source.indexOf('let manualAttendanceBusy = false;'),end=source.indexOf('window.otCache =',start);
function harness({allowed=true,branchAllowed=true,confirmed=true,fail=false}={}){
 const nodes=new Map(),messages=[],records=new Map();let confirmations=0,writes=0,refreshes=0;
 const values={manAttStaff:'Sample Staff',manAttBranch:'Maa',manAttType:'TIME IN',manAttDateTime:'2026-10-06T09:00',manAttRemarks:'Verified missing punch'};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]||'',style:{}});return nodes.get(id);};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-06T12:00:00+08:00']));}}
 const api={db:{},auth:{currentUser:{uid:'sample-owner',email:'owner@example.test'}},sessionUser:{cashierName:'Sample Owner'},
  isBranchAllowed:()=>branchAllowed,ManagerUI:{notify:value=>messages.push(value)},getDocsFromServer:async()=>({docs:[{id:'sample-staff',data:()=>({cashierName:'Sample Staff',branch:'Maa'})}]}),
  collection:(_,name)=>name,query:ref=>ref,where:()=>null,doc:(_,name,id)=>name+'/'+id,serverTimestamp:()=>new Date('2026-10-06T04:00:00Z'),
  runTransaction:async(_,fn)=>{const staged=new Map();const result=await fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,data)=>staged.set(ref,data)});if(fail)throw Error('offline');for(const entry of staged){records.set(...entry);writes++;}return result;},
  loadPayrollScheduleHistory:async()=>({}),loadAttendanceLogs:()=>refreshes++,invalidateCache(){}};
 const context={window:api,document:{getElementById:node},Date:FixedDate,crypto:{randomUUID:()=> 'sample-operation-123'},
  canOpenWorkspacePage:()=>allowed,validateManualAttendance:(input,options)=>validateManualAttendance(input,{...options,now:new FixedDate()}),saveManualAttendance:(api,payload,options)=>saveManualAttendance(api,payload,{...options,now:new FixedDate()}),
  scheduleDateKey:()=> '2026-10-06',resolveAttendanceShift:()=>({scheduleSource:'missing-history',needsScheduleReview:true}),
  Swal:{fire:async()=>{confirmations++;return{isConfirmed:confirmed};}},console:{error(){}}};
 vm.runInNewContext(source.slice(start,end),context);return{api,nodes,node,messages,records,writes:()=>writes,confirmations:()=>confirmations,refreshes:()=>refreshes};
}
test('the actual Owner handler cannot save without attendance permission or branch access',async()=>{
 for(const options of [{allowed:false},{branchAllowed:false}]){const h=harness(options);await h.api.submitManualAttendance();assert.equal(h.writes(),0);assert.equal(h.confirmations(),0);assert.equal(h.node('btnSaveManualAtt').disabled,false);}
});
test('cancelling the actual confirmation leaves every attendance record unchanged',async()=>{
 const h=harness({confirmed:false});await h.api.submitManualAttendance();assert.equal(h.confirmations(),1);assert.equal(h.writes(),0);assert.equal(h.refreshes(),0);
});
test('repeated taps in the actual handler confirm once and save one attributed correction',async()=>{
 const h=harness();await Promise.all([h.api.submitManualAttendance(),h.api.submitManualAttendance()]);assert.equal(h.confirmations(),1);assert.equal(h.writes(),1);assert.equal(h.records.size,1);
 const [row]=h.records.values();assert.equal(row.actorEmail,'owner@example.test');assert.equal(row.loggedBy,'owner@example.test');assert.equal(row.staffId,'sample-staff');assert.equal(row.source,'manager-correction');assert.equal(h.node('manualAttendanceModal').style.display,'none');
});
test('recorded corrections retain the same operation reference on acknowledgement retry',async()=>{
 const h=harness();await h.api.submitManualAttendance();await h.api.submitManualAttendance();assert.equal(h.records.size,1);assert.equal(h.writes(),1);assert.equal(h.api.manualAttendanceOperationId,'sample-operation-123');
});
