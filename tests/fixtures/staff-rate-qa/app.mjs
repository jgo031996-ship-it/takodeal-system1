import {installStaffPortal} from './modules/takodeal-staff/staff-portal.js';
import {createPinVerifier} from './modules/takodeal-staff/staff-privacy.js';
import {saveStaffProfileAtomic} from './modules/takodeal-manager/staff-rate-changes.js';
// Isolated sample store only. No Firebase or external network client is loaded.
const docs=new Map(),versions=new Map(),copy=value=>structuredClone(value),storage=new Map([['takodeal_staff_id','sample'],['takodeal_staff_name','Sample Staff']]);
Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},configurable:true});
const ref=(table,id)=>({path:table+'/'+id,id}),put=(path,row)=>{docs.set(path,copy(row));versions.set(path,(versions.get(path)||0)+1);};
const snapshot=reference=>{const row=copy(docs.get(reference.path));return {id:reference.id,exists:()=>row!==undefined,data:()=>copy(row)};};
let loseAck=false;
Object.assign(window,{db:{},auth:{currentUser:{uid:'sample-manager',email:'manager@example.test',emailVerified:true}},sessionUser:{uid:'sample-manager',email:'manager@example.test',permissions:['payroll'],allowedBranches:['All'],cashierName:'Sample Manager'},
    doc:(_,table,id)=>ref(table,id),collection:(_,table)=>({table}),query:(table,...filters)=>({...table,filters}),where:(key,_op,value)=>({key,value}),serverTimestamp:()=>({seconds:Date.now()/1000}),
    getDocFromServer:async reference=>snapshot(reference),getDocsFromServer:async query=>({docs:[...docs.keys()].filter(path=>path.startsWith(query.table+'/') && (query.filters||[]).every(filter=>docs.get(path)[filter.key]===filter.value)).map(path=>snapshot(ref(query.table,path.slice(query.table.length+1))))}),
    updateDoc:async(reference,data)=>put(reference.path,{...docs.get(reference.path),...data}),
    runTransaction:async(_,callback)=>{
        for(let attempt=0;attempt<20;attempt++){
            const reads=new Map(),writes=[];
            const tx={get:async reference=>{if(writes.length)throw Error('Read after write');reads.set(reference.path,versions.get(reference.path)||0);await Promise.resolve();return snapshot(reference);},set:(reference,data)=>writes.push({reference,data}),update:(reference,data)=>writes.push({reference,data,merge:true})};
            const result=await callback(tx);if([...reads].some(([path,version])=>(versions.get(path)||0)!==version))continue;
            const staged=new Map(docs);for(const write of writes)staged.set(write.reference.path,{...(write.merge?staged.get(write.reference.path):{}),...copy(write.data)});docs.clear();for(const [path,row] of staged)docs.set(path,row);for(const write of writes)versions.set(write.reference.path,(versions.get(write.reference.path)||0)+1);
            checks();if(loseAck && writes.length){loseAck=false;throw Error('Sample connection lost after commit. Retry Save raise.');}return result;
        }throw Error('Too much sample contention');
    },switchView(){},checkNormalLogin(){},loginStaff:async()=>{},logoutStaff(){},openProfile:async()=>{document.getElementById('profileModal').style.display='flex';},closeStaffProfile:()=>{document.getElementById('profileModal').style.display='none';},loadPayslipVault(){},Swal:{close(){}}});
put('hq_managers/sample',{email:'manager@example.test',role:'Manager',pin:'1111',permissions:['payroll'],assignedBranch:'All'});
put('hq_email_access/manager@example.test',{active:true,permissions:['payroll'],allowedBranches:['All']});
put('cashiers/sample',{cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:450,pin:'1111',payslipPin:await createPinVerifier('246810')});
put('payroll_records/paid',{staffName:'Sample Staff',status:'Paid',totalPay:4500});const oldPayroll=copy(docs.get('payroll_records/paid'));
function checks(){const profile=docs.get('cashiers/sample');document.getElementById('checks').textContent=JSON.stringify({paidPayrollUnchanged:JSON.stringify(docs.get('payroll_records/paid'))===JSON.stringify(oldPayroll),auditCount:[...docs.keys()].filter(path=>path.startsWith('staff_rate_changes/')).length,raiseHistoryCount:[...docs.entries()].filter(([path,row])=>path.startsWith('staff_rate_changes/') && row.eventType==='increase').length,noPublicRateHistory:!Object.hasOwn(profile,'rateHistory'),profileRateLocked:!window.staffRateSession?.allows('sample'),payVaultLocked:!window.staffVaultSession?.allows('sample')},null,2);}
installStaffPortal();
document.getElementById('openProfile').onclick=()=>window.openProfile().then(checks);
document.getElementById('saveRaise').onclick=async()=>{try{const row=docs.get('cashiers/sample');await saveStaffProfileAtomic(window,'sample',{cashierName:row.cashierName,branch:row.branch,role:row.role,hourlyRate:500,pin:row.pin},{operationId:'sample-raise',expectedRate:450,expectedExists:true});document.getElementById('notice').textContent='Sample raise saved. The Profile message contains no amount while locked.';await window.staffRateProfileOpened();checks();}catch(error){document.getElementById('notice').textContent=error.message;}};
document.getElementById('loseAck').onclick=()=>{loseAck=true;document.getElementById('notice').textContent='The next sample save will lose its acknowledgment. Retry it to verify one audit and one raise.';};
document.getElementById('reset').onclick=()=>location.reload();
window.addEventListener('visibilitychange',checks);setInterval(checks,1000);checks();window.rateQa={docs,checks};window.rateQaReady=true;
