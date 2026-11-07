import test from 'node:test';
import assert from 'node:assert/strict';
import {installOwnerContractPrinting,ownerContractPrintHTML,renderOwnerContractVault} from '../takodeal-manager/owner-contract-print.js';

function fixture(){
 const person={cashierName:'Sample <Crew>',branch:'Maa',role:'Crew',hourlyRate:450,dateHired:'2025-01-01',signedContracts:{initial:'October 21, 2026',extension:'October 31, 2026'},contractTerms:{initial:{version:1,startDate:'2026-10-21',endDate:'2027-04-21'}}};
 const nodes={empProfileId:{value:'crew-id'},employeeProfileModal:{style:{display:'flex'}},contractVaultContainer:{style:{}},contractVaultButtons:{children:[],replaceChildren(){this.children=[];},append(value){this.children.push(value);}}},reads=[],dialogs=[],windows=[];
 const d={getElementById:id=>nodes[id]||null,createElement:()=>({style:{},textContent:'',onclick:null})};
 const api={auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',isOwner:true},staffProfileFormGeneration:1,db:{},doc:(_db,table,id)=>table+'/'+id,isBranchAllowed:branch=>branch==='Maa',Swal:{fire:(...args)=>dialogs.push(args)},
  async getDocFromServer(ref){reads.push(ref);return {exists:()=>true,data:()=>structuredClone(person),metadata:{fromCache:false,hasPendingWrites:false}};},
  open(){const popup={html:'',printed:0,closed:false,document:{open(){popup.html='';},write(html){popup.html+=html;},close(){}},print(){popup.printed++;},close(){popup.closed=true;}};windows.push(popup);return popup;}};
 installOwnerContractPrinting(api,d);return {api,d,nodes,person,reads,dialogs,windows};
}
test('Owner signed-contract buttons invoke the installed printer using only the staff ID',async()=>{
 const f=fixture();renderOwnerContractVault(f.api,f.d,'crew-id',f.person);assert.equal(f.nodes.contractVaultButtons.children.length,2);
 await f.nodes.contractVaultButtons.children[0].onclick();assert.deepEqual(f.reads,['cashiers/crew-id']);assert.equal(f.windows[0].printed,1);
 assert.match(f.windows[0].html,/2026-10-21/);assert.match(f.windows[0].html,/2027-04-21/);assert.match(f.windows[0].html,/October 21, 2026/);assert.match(f.windows[0].html,/Sample &lt;Crew&gt;/);assert.doesNotMatch(f.windows[0].html,/<Crew>|2025-01-01/);
});
test('Owner extension reprints remain six-month extensions rather than permanent contracts',async()=>{
 const f=fixture();await f.api.reprintContract('Extension',encodeURIComponent('crew-id'),'Forged caller date');
 assert.match(f.windows[0].html,/2026-10-31/);assert.match(f.windows[0].html,/2027-04-30/);assert.doesNotMatch(f.windows[0].html,/REGULAR \(PERMANENT\)|Forged caller date/);
});
test('missing acceptance, foreign branch and a profile switch prevent printing',async()=>{
 for(const defect of ['unsigned','foreign','switch']){const f=fixture();if(defect==='unsigned')f.person.signedContracts={};if(defect==='foreign')f.person.branch='Foreign';if(defect==='switch'){const read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const snap=await read(ref);f.nodes.empProfileId.value='other-id';return snap;};}
  assert.equal(await f.api.reprintContract('Initial','crew-id'),false);assert.equal(f.windows[0].printed,0);assert.equal(f.windows[0].closed,true);
 }
});
test('missing permission and arbitrary employee IDs fail before any profile read or document window',async()=>{
 const f=fixture();assert.equal(await f.api.reprintContract('Initial','other-id'),false);f.api.sessionUser={uid:'owner',email:'jgo031996@gmail.com',permissions:[]};f.api.auth.currentUser.email='manager@example.test';f.api.sessionUser.email='manager@example.test';
 assert.equal(await f.api.reprintContract('Initial','crew-id'),false);assert.equal(f.reads.length,0);assert.equal(f.windows.length,0);
});
test('dated wages require fresh salary history and use the stored contract work date',async()=>{
 const f=fixture();Object.assign(f.person,{salaryRateVersion:1,salaryRateRevision:1});const read=f.api.getDocFromServer;
 f.api.getDocFromServer=async ref=>{if(!ref.startsWith('staff_salary_rates/'))return read(ref);f.reads.push(ref);return {exists:()=>true,data:()=>({staffId:'crew-id',branch:'Maa',version:1,revision:1,baselineDailyRate:400,rates:{raise:{effectiveDate:'2026-11-01',dailyRate:450,sequence:1}}}),metadata:{fromCache:false,hasPendingWrites:false}};};
 assert.equal(await f.api.reprintContract('Initial','crew-id'),true);assert.deepEqual(f.reads,['cashiers/crew-id','staff_salary_rates/crew-id']);assert.match(f.windows[0].html,/₱400\.00/);
});
test('printable content escapes signed metadata and refuses an unknown wage',()=>{
 assert.throws(()=>ownerContractPrintHTML('Initial',{cashierName:'Sample',contractDailyRate:null},'signed'),/wage/);
 assert.doesNotMatch(ownerContractPrintHTML('Regularization',{cashierName:'<script>bad</script>',role:'Crew',contractDailyRate:450},'<img onerror=bad>'),/<script>|<img/);
});
test('invalid historical contract dates cannot print today’s wage',async()=>{
 const f=fixture();Object.assign(f.person,{salaryRateVersion:1,salaryRateRevision:1});f.person.contractTerms={};f.person.signedContracts.initial='invalid historical date';
 f.api.getDocFromServer=async ref=>({exists:()=>true,data:()=>ref.startsWith('staff_salary_rates/')?{staffId:'crew-id',branch:'Maa',version:1,revision:1,baselineDailyRate:400,rates:{raise:{effectiveDate:'2026-11-01',dailyRate:450,sequence:1}}}:structuredClone(f.person),metadata:{fromCache:false,hasPendingWrites:false}});
 assert.equal(await f.api.reprintContract('Initial','crew-id'),false);assert.equal(f.windows[0].printed,0);assert.match(f.dialogs.at(-1)[1],/historical wage/);
 assert.throws(()=>ownerContractPrintHTML('Initial',{...f.person,contractDailyRate:400,contractTerms:{initial:{version:1,startDate:'2026-02-30',endDate:'2026-08-30'}}},'signed'),/term dates/);
});
test('account or profile generation changes suppress a pending saved-contract print',async()=>{
 for(const defect of ['account','generation']){const f=fixture(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const snap=await read(ref);if(defect==='account')f.api.auth.currentUser={...f.api.auth.currentUser,uid:'another-owner'};else f.api.staffProfileFormGeneration++;return snap;};
  assert.equal(await f.api.reprintContract('Initial','crew-id'),false);assert.equal(f.windows[0].printed,0);assert.equal(f.windows[0].closed,true);
 }
});
test('in-place branch access removal during private salary loading prevents printing',async()=>{
 const f=fixture();Object.assign(f.person,{salaryRateVersion:1,salaryRateRevision:1});const read=f.api.getDocFromServer;
 f.api.getDocFromServer=async ref=>{if(!ref.startsWith('staff_salary_rates/'))return read(ref);f.api.isBranchAllowed=()=>false;return {exists:()=>true,data:()=>({staffId:'crew-id',branch:'Maa',version:1,revision:1,baselineDailyRate:400,rates:{raise:{effectiveDate:'2026-11-01',dailyRate:450,sequence:1}}}),metadata:{fromCache:false,hasPendingWrites:false}};};
 assert.equal(await f.api.reprintContract('Initial','crew-id'),false);assert.equal(f.windows[0].printed,0);assert.equal(f.windows[0].closed,true);assert.match(f.dialogs.at(-1)[1],/outside/);
});
