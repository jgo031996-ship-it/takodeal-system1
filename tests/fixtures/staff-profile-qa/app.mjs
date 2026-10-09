import {installStaffPortal} from './modules/takodeal-staff/staff-portal.js';
import {createPinVerifier} from './modules/takodeal-staff/staff-privacy.js';
import {installStaffDocuments,prepareDocumentPhoto} from './modules/takodeal-staff/staff-documents.js';
import {createDocumentStore} from './modules/takodeal-staff/staff-document-store.js';
import {installMasterEmployeeDocuments} from './modules/takodeal-manager/staff-document-hq.js';
import {installStaffRateHistory,saveStaffProfileAtomic} from './modules/takodeal-manager/staff-rate-changes.js';
// Everything below is a local-only sample SDK. There is no Firebase client or external request.
const records=new Map(),versions=new Map(),objects=new Map(),copy=value=>structuredClone(value),el=id=>document.getElementById(id);
const local=new Map([['takodeal_staff_id','sample'],['takodeal_staff_name','Sample Staff'],['takodeal_device_id','sample-phone']]);
Object.defineProperty(window,'localStorage',{value:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,String(value)),removeItem:key=>local.delete(key)},configurable:true});
const staffAuth={currentUser:{uid:'sample-phone',isAnonymous:true}},owner={uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true,displayName:'Sample Owner'},hqAuth={currentUser:owner};
const db={},storage={},authListeners=new Set();let rejectUpload=false,loseUploadAck=false,transactionTail=Promise.resolve();
const stats={reads:0,normalizedPhotos:0,storageUploads:0,uploadCommits:0,reviewCommits:0,deviceCommits:0,rateCommits:0,downloads:0};
const put=(path,row)=>{records.set(path,copy(row));versions.set(path,(versions.get(path)||0)+1);};
const ref=(...parts)=>({path:parts.join('/'),id:parts.at(-1)}),snap=reference=>{const row=copy(records.get(reference.path));return{id:reference.id,exists:()=>row!==undefined,data:()=>copy(row)};};
function permission(role,path,write=false){
  if(path.startsWith('staff_rate_changes/') && (role!=='hq' || hqAuth.currentUser?.uid!==owner.uid))throw Error('Sample private rate audit requires authorized HQ.');
  if(!path.startsWith('staff_private_documents/'))return;
  if(role==='hq'){if(hqAuth.currentUser?.uid!==owner.uid)throw Error('Sample permission denied: this HQ account is not allowed private employee documents.');return;}
  const id=path.split('/')[1],binding=records.get('staff_document_devices/'+staffAuth.currentUser?.uid);
  if(!binding?.active || binding.staffId!==id)throw Error('Sample permission denied: the phone approval was revoked or belongs to another employee.');
  if(write && id!==local.get('takodeal_staff_id'))throw Error('Sample employee changed before saving.');
}
function sdkFor(role){
  return {
    doc:(_,...parts)=>ref(...parts),collection:(_,...parts)=>({path:parts.join('/')}),where:(key,op,value)=>({key,op,value}),query:(collection,...filters)=>({...collection,filters}),
    serverTimestamp:()=>({seconds:Math.floor(Date.now()/1000),nanoseconds:0}),
    getDocFromServer:async reference=>{stats.reads++;permission(role,reference.path);return snap(reference);},
    getDocsFromServer:async query=>{stats.reads++;if(query.path==='staff_rate_changes')permission(role,'staff_rate_changes/query');if(query.path==='staff_document_requests' && hqAuth.currentUser?.uid!==owner.uid)throw Error('Sample Owner approval required.');return{docs:[...records.keys()].filter(path=>path.startsWith(query.path+'/') && path.slice(query.path.length+1).indexOf('/')<0 && (query.filters||[]).every(filter=>records.get(path)[filter.key]===filter.value)).map(path=>snap(ref(...path.split('/'))))};},
    updateDoc:async(reference,patch)=>{permission(role,reference.path,true);put(reference.path,{...records.get(reference.path),...copy(patch)});},
    runTransaction:async(_,callback)=>{
      let release;const before=transactionTail;transactionTail=new Promise(resolve=>release=resolve);await before;
      try{
        const reads=new Map(),writes=[];
        const tx={get:async reference=>{if(writes.length)throw Error('Sample transaction attempted a read after write.');permission(role,reference.path);reads.set(reference.path,versions.get(reference.path)||0);return snap(reference);},set:(reference,row)=>writes.push({reference,row}),update:(reference,row)=>writes.push({reference,row,merge:true})};
        const result=await callback(tx);for(const [path,version] of reads)if((versions.get(path)||0)!==version)throw Error('Sample changed during transaction. Retry.');
        for(const write of writes)permission(role,write.reference.path,true);
        const staged=new Map(records);for(const write of writes)staged.set(write.reference.path,{...(write.merge?staged.get(write.reference.path):{}),...copy(write.row)});
        for(const write of writes){records.set(write.reference.path,staged.get(write.reference.path));versions.set(write.reference.path,(versions.get(write.reference.path)||0)+1);}
        const upload=writes.some(write=>write.reference.path.includes('/files/') && write.row.status==='pending_review'),review=writes.some(write=>write.reference.path.includes('/reviews/'));
        if(upload)stats.uploadCommits++;if(review)stats.reviewCommits++;if(writes.some(write=>write.reference.path.startsWith('staff_document_devices/')))stats.deviceCommits++;if(writes.some(write=>write.reference.path.startsWith('staff_rate_changes/')))stats.rateCommits++;
        checks();if(upload && loseUploadAck){loseUploadAck=false;throw Error('SAMPLE lost acknowledgment after upload was committed. Retry the same Upload photo to confirm one saved version.');}return result;
      }finally{release();}
    },
    ref:(_,path)=>({path}),
    getMetadata:async reference=>{const object=objects.get(reference.path);if(!object){const error=Error('Sample photo does not exist');error.code='storage/object-not-found';throw error;}return copy(object.metadata);},
    uploadBytes:async(reference,blob,metadata)=>{const id=reference.path.split('/')[2];permission(role,'staff_private_documents/'+id+'/files',true);if(rejectUpload){rejectUpload=false;throw Error('SAMPLE upload rejected before any image or metadata was saved. Retry when ready.');}objects.set(reference.path,{blob,metadata:{...copy(metadata),size:blob.size}});stats.storageUploads++;checks();return{metadata};},
    getBlob:async(reference,max)=>{permission(role,'staff_private_documents/'+reference.path.split('/')[2]+'/files');const object=objects.get(reference.path);if(!object || object.blob.size>max)throw Error('Sample private photo is unavailable.');return object.blob;},
    onAuthStateChanged:(_auth,listener)=>{authListeners.add(listener);listener(_auth.currentUser);return()=>authListeners.delete(listener);}
  };
}
const staffSdk=sdkFor('staff'),hqSdk=sdkFor('hq');
const staffStore=createDocumentStore({sdk:staffSdk,db,storage,auth:staffAuth,identity:()=>local.get('takodeal_staff_id')});
const hqStore=createDocumentStore({sdk:hqSdk,db,storage,auth:hqAuth,identity:()=>el('empProfileId').value,isHQ:true});
const staffClient={sdk:staffSdk,store:staffStore,auth:staffAuth,db,storage},hqClient={sdk:hqSdk,store:hqStore,auth:hqAuth,db,storage};
const say=text=>{el('qaNotice').textContent=text;};
let dialogPending;
const swal={close(){if(dialogPending){dialogPending({isConfirmed:false});dialogPending=null;}el('qaConfirm').close();},fire(options){if(dialogPending){dialogPending({isConfirmed:false});}el('qaConfirmTitle').textContent=options.title||'Confirm';el('qaConfirmText').textContent=options.text||'';el('qaConfirmLabel').hidden=!options.input;el('qaConfirmInput').value='';el('qaConfirmYes').textContent=options.confirmButtonText||'Confirm';el('qaConfirm').showModal();return new Promise(resolve=>{dialogPending=resolve;});}};
function finishConfirmation(confirmed){const result={isConfirmed:confirmed,value:el('qaConfirmInput').value};const pending=dialogPending;dialogPending=null;el('qaConfirm').close();pending?.(result);}
el('qaConfirmYes').onclick=()=>finishConfirmation(true);el('qaConfirmCancel').onclick=()=>finishConfirmation(false);el('qaConfirm').addEventListener('cancel',event=>{event.preventDefault();finishConfirmation(false);});
Object.assign(window,{db,doc:staffSdk.doc,collection:staffSdk.collection,query:staffSdk.query,where:staffSdk.where,getDocFromServer:staffSdk.getDocFromServer,getDocsFromServer:staffSdk.getDocsFromServer,getDocs:staffSdk.getDocsFromServer,updateDoc:staffSdk.updateDoc,Swal:swal,switchView(){},checkNormalLogin(){},loginStaff:async()=>{},logoutStaff(){local.delete('takodeal_staff_id');},stopStaffLiveListeners(){},loadPayslipVault(){},
  openProfile:async()=>{el('qaStaffName').textContent=local.get('takodeal_staff_name')||'Sample Staff';el('profileModal').style.display='flex';},closeStaffProfile:()=>{el('profileModal').style.display='none';}});
const hqApi={...hqSdk,db,auth:hqAuth,Swal:swal,sessionUser:{...owner,cashierName:'Sample Owner',permissions:['all'],allowedBranches:['All']},addEventListener:window.addEventListener.bind(window),
  openEmployeeProfile(id){const row=records.get('cashiers/'+id);el('empProfileId').value=id;el('empFullName').value=row?.cashierName||'Sample Staff';el('empHourlyRate').value=row?.hourlyRate??'';el('employeeProfileModal').style.display='flex';},
  addNewStaff(){el('empProfileId').value='';el('empFullName').value='New SAMPLE employee';el('empHourlyRate').value='';el('employeeProfileModal').style.display='flex';}};
const verifier=await createPinVerifier('246810');
put('staff_document_config/current',{enabled:true,policyVersion:1});
put('staff_document_devices/sample-phone',{uid:'sample-phone',staffId:'sample',branch:'Maa',active:true,deviceId:'sample-phone',deviceName:'SAMPLE approved phone',approvedAt:{seconds:1},approvedByUid:owner.uid,audit:{initial:{active:true}}});
put('staff_private_documents/sample',{staffId:'sample',branch:'Maa',version:1});put('staff_private_documents/other',{staffId:'other',branch:'Citygate',version:1});
put('cashiers/sample',{cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:450,pin:'1111',payslipPin:verifier});
put('cashiers/other',{cashierName:'Other SAMPLE Employee',branch:'Citygate',role:'Crew',hourlyRate:375,pin:'1111',payslipPin:verifier});
put('hq_managers/sample-owner',{email:owner.email,role:'System Architect',permissions:['all'],assignedBranch:'All',pin:'1111'});
put('payroll_records/old',{staffName:'Sample Staff',status:'Paid',totalPay:4500});const payrollBefore=copy(records.get('payroll_records/old'));
installStaffPortal();
installStaffDocuments(window,{createVault:async()=>staffClient,normalize:async file=>{stats.normalizedPhotos++;const blob=await prepareDocumentPhoto(file);checks();return blob;}});
installStaffRateHistory(hqApi,document);installMasterEmployeeDocuments(hqApi,{d:document,createVault:async()=>hqClient});
function checks(){const id=local.get('takodeal_staff_id'),selected=el('empProfileId').value,kindDocs=[...records.keys()].filter(path=>path.startsWith('staff_private_documents/sample/files/')),profile=records.get('cashiers/sample');el('qaChecks').textContent=JSON.stringify({sampleOnly:true,firebaseImports:false,staffAccount:id,selectedHqEmployee:selected,staffRateLocked:!window.staffRateSession?.allows(id),payVaultLocked:!window.staffVaultSession?.allows(id),approvedPhone:records.get('staff_document_devices/sample-phone')?.active===true,storedCurrentDocuments:kindDocs.length,immutableUploadVersions:[...records.keys()].filter(path=>path.startsWith('staff_private_documents/sample/versions/')).length,reviewAuditCount:[...records.keys()].filter(path=>path.startsWith('staff_private_documents/sample/reviews/')).length,actualIncreaseCount:[...records.entries()].filter(([path,event])=>path.startsWith('staff_rate_changes/') && event.staffId==='sample' && event.eventType==='increase').length,noPublicRateHistory:!Object.hasOwn(profile,'rateHistory'),pastPayrollUnchanged:JSON.stringify(records.get('payroll_records/old'))===JSON.stringify(payrollBefore),...stats},null,2);}
async function samplePhoto(){const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#f7f4e9';ctx.fillRect(0,0,1400,800);ctx.strokeStyle='#9b422e';ctx.lineWidth=14;ctx.strokeRect(24,24,1352,752);ctx.fillStyle='#9b422e';ctx.textAlign='center';ctx.font='bold 58px Arial';ctx.fillText('SAMPLE DOCUMENT — NOT REAL ID',700,180);ctx.fillStyle='#183e32';ctx.font='42px Arial';ctx.fillText('LOCAL VERIFICATION ONLY',700,290);ctx.fillText('FICTIONAL SAMPLE STAFF',700,380);ctx.font='32px Arial';ctx.fillText('No personal identity or official document',700,490);ctx.fillText('Production normalization and private upload test',700,550);ctx.fillStyle='#9b422e';ctx.font='bold 42px Arial';ctx.fillText('SAMPLE / DO NOT USE',700,690);return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.93));}
el('qaOpen').onclick=()=>window.openProfile().then(checks);
el('qaCloseStaff').onclick=()=>{window.closeStaffProfile();checks();};
el('qaSample').onclick=async()=>{try{if(el('profileModal').style.display==='none')await window.openProfile();const chooser=el('staffDocumentCards').querySelector('[data-doc-file="valid_id"]');if(!chooser)throw Error('Open the approved SAMPLE Staff Profile first.');const blob=await samplePhoto(),files=new DataTransfer();files.items.add(new File([blob],'SAMPLE-NOT-REAL-ID.jpg',{type:'image/jpeg'}));chooser.files=files.files;chooser.dispatchEvent(new Event('change',{bubbles:true}));say('The SAMPLE JPEG was placed in the actual file chooser. Check its preview, then choose Upload photo.');}catch(error){say(error.message);}};
el('qaRejectUpload').onclick=()=>{rejectUpload=true;say('The next Storage upload is rejected before saving. Metadata, reminder count and immutable version count must stay unchanged.');};
el('qaLostAck').onclick=()=>{loseUploadAck=true;say('The next upload commits locally, then loses its acknowledgment. Retry the SAME Upload photo: one version and one Storage write should remain.');};
el('qaRevoke').onclick=async()=>{const key='staff_document_devices/sample-phone';put(key,{...records.get(key),active:false});say('SAMPLE phone approval revoked. The next private read/upload must be denied.');await window.staffDocuments.load(true);checks();};
el('qaApprove').onclick=async()=>{const key='staff_document_devices/sample-phone';put(key,{...records.get(key),active:true});say('SAMPLE phone approval restored.');await window.staffDocuments.load(true);checks();};
el('qaChangeStaff').onclick=async()=>{const id=local.get('takodeal_staff_id')==='sample'?'other':'sample';window.stopStaffLiveListeners();window.lockPayslipVault();local.set('takodeal_staff_id',id);local.set('takodeal_staff_name',records.get('cashiers/'+id).cashierName);await window.loginStaff();await window.openProfile();say(id==='other'?'Other SAMPLE employee selected; this phone is not approved for their private records.':'Original SAMPLE staff account restored.');checks();};
el('qaRaise').onclick=async()=>{try{const row=records.get('cashiers/sample');await saveStaffProfileAtomic(hqApi,'sample',{cashierName:row.cashierName,branch:row.branch,role:row.role,hourlyRate:500,pin:row.pin},{operationId:'sample-rate-increase',expectedRate:450,expectedExists:true});await window.staffRateProfileOpened();hqApi.openEmployeeProfile('sample');say('The actual Manager transaction saved the sample increase. Staff congratulations contain no pay amount while locked; old payroll is unchanged.');checks();}catch(error){say(error.message);}};
el('qaOpenHQ').onclick=()=>{hqApi.openEmployeeProfile('sample');checks();};
el('qaOtherEmployee').onclick=()=>{hqApi.openEmployeeProfile(el('empProfileId').value==='sample'?'other':'sample');checks();};
el('qaNewEmployee').onclick=()=>{hqApi.addNewStaff();checks();};
el('qaCloseHQ').onclick=()=>{el('employeeProfileModal').style.display='none';checks();};
el('qaHQAccount').onclick=()=>{hqAuth.currentUser={uid:'unapproved-account',email:'unapproved@example.test',emailVerified:true};hqApi.sessionUser={...hqAuth.currentUser,permissions:[],allowedBranches:[]};for(const listener of authListeners)listener(hqAuth.currentUser);say('Changed to an unapproved SAMPLE Google account. Private previews must clear and new reads must be denied.');checks();};
el('qaHQRestore').onclick=()=>{hqAuth.currentUser=owner;hqApi.sessionUser={...owner,cashierName:'Sample Owner',permissions:['all'],allowedBranches:['All']};for(const listener of authListeners)listener(owner);hqApi.openEmployeeProfile('sample');say('SAMPLE Owner account restored.');checks();};
el('qaReset').onclick=()=>location.reload();
document.addEventListener('visibilitychange',checks);setInterval(checks,1000);
await window.openProfile();hqApi.openEmployeeProfile('sample');checks();document.body.dataset.qaReady='true';
