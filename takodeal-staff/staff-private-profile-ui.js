import {showStaffProfilePhoto} from './staff-profile-photo.js';
import {installEmployeeProfileSections} from './staff-employee-sections.js';
import {prepareDocumentPhoto} from './staff-documents.js';
const fields={profFullName:'cashierName',profNickname:'scheduleNickname',profPhone:'phone',profAddress:'address',profEmergName:'emergencyName',profEmergNum:'emergencyNumber',profEmail:'email',profGcashName:'gcashName',profGcashNum:'gcashNumber',profGotymeName:'gotymeName',profGotymeNum:'gotymeNumber',profSss:'sssNumber',profPhilhealth:'philhealthNumber',profPagibig:'pagibigNumber'};
const governments=[{group:'sss_id',input:'imgSss',view:'linkSss',label:'SSS ID',legacy:'sss'},{group:'philhealth_id',input:'imgPhilhealth',view:'linkPhilhealth',label:'PhilHealth ID',legacy:'philhealth'},{group:'pagibig_id',input:'imgPagibig',view:'linkPagibig',label:'Pag-IBIG ID',legacy:'pagibig'}];
// The first key in each group is the Owner directory's preferred spelling.
const contactGroups={
 emergencyNumber:['emergencyPhone','emergencyNumber','emergencyContactNumber','emergNum','emergencyContact'],
 gotymeName:['gotymeName','goTymeName','gotyme'],
 gotymeNumber:['gotymeNum','gotymeNumber','gotymeAcc','gotymeAccount','goTymeNumber','goTymeAccount','gotymeAccountNumber'],
 sssNumber:['sss','sssNumber'],philhealthNumber:['philhealth','philhealthNumber'],pagibigNumber:['pagibig','pagibigNumber']
};
function displayContact(profile,key){
 for(const field of contactGroups[key]||[key]){
  if(profile[field]!=null)return String(profile[field]).trim();
 }
 return '';
}
export function captureContactFields(d,baseline){
 const patch={};
 for(const [input,key] of Object.entries(fields)){
  const value=d.getElementById(input).value.trim();
  if(baseline && value===displayContact(baseline,key))continue;
  for(const field of contactGroups[key]||[key])patch[field]=value;
 }
 return patch;
}
export function installStaffPrivateProfileUI(api=window,d=document,{client,access,createPrivateClient,createPinClient=createPrivateClient,normalize=prepareDocumentPhoto,uuid=()=>crypto.randomUUID()}={}){
 const $=id=>d.getElementById(id),identity=()=>api.localStorage.getItem('takodeal_staff_id');let epoch=0,loaded=null,contactFlight=null,pinFlight=null,pendingContact=null,pendingPin=null,photoModal=null;const documentChoices=new Map(),documentFlights=new Map(),urls=new Set();
 const visible=()=>!d.hidden&&$('profileModal')?.style.display!=='none',status=message=>{if($('staffProfileStatus'))$('staffProfileStatus').textContent=message;};
 const guardFor=(id,generation)=>()=>{if(epoch!==generation||identity()!==id||!visible())throw Error('Your profile closed or changed. Reopen it.');};
 const sections=installEmployeeProfileSections(d);
 function showRetry(show){const button=$('retryStaffProfile');if(button)button.hidden=!show;}
 $('retryStaffProfile')?.addEventListener('click',()=>api.openProfile());
 const activate=$('activateProfilePhone');
 activate?.addEventListener('click',async()=>{
  const id=identity();activate.disabled=true;
  try{if(await api.choosePersonalCodeActivation() && identity()===id)api.closeStaffProfile();}
  catch(error){if(visible() && identity()===id)status(error.message);}
  finally{activate.disabled=false;}
 });
 let syncTimer=null,resumeDraft=null;
 function clear(){api.clearTimeout?.(syncTimer);syncTimer=null;if(activate)activate.hidden=true;showRetry(true);sections.clear();epoch++;loaded=null;client.invalidate();status('Private profile locked. Reopen it to load saved details.');const ownedPhoto=photoModal;photoModal=null;if(ownedPhoto){const image=api.Swal.getImage?.()||d.querySelector?.('.swal2-popup img.swal2-image');if(image?.src===ownedPhoto.url){image.removeAttribute('src');api.Swal.close?.();}}pendingContact=null;pendingPin=null;documentChoices.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();for(const input of Object.keys(fields))if($(input)){$(input).value='';$(input).disabled=true;}for(const id of ['profPin','profFullName','profNickname'])if($(id))$(id).value='';$('profRoleHistory')?.replaceChildren();$('profContracts')?.replaceChildren();for(const item of governments){$(item.input).value='';$(item.view).removeAttribute('href');$(item.view).style.display='none';}if($('btnSaveProfileData'))$('btnSaveProfileData').disabled=true;}
 function renderHistory(profile,id){
  const history=$('profRoleHistory');history.replaceChildren();if(profile.roleHistory?.length){const ul=d.createElement('ul');for(const row of profile.roleHistory){const li=d.createElement('li');li.textContent='Promoted to '+(row.role||'Role not recorded')+' · Effective: '+(row.date||'Date not recorded');ul.append(li);}history.append(ul);}else history.textContent='Current role: '+(profile.role||'Crew');
  const contracts=$('profContracts');contracts.replaceChildren();for(const [key,label,type]of [['initial','Initial Employment Contract','Initial'],['extension','6-Month Extension','Extension'],['regularization','Regularization Contract','Regularization']]){const date=profile.signedContracts?.[key];if(!date)continue;const button=d.createElement('button');button.type='button';button.className='btn-outline';button.textContent=label+' · Signed: '+date;button.addEventListener('click',()=>{if(loaded?.staffId===id&&identity()===id&&visible())return api.reprintContract(type,encodeURIComponent(id),date);});contracts.append(button);}if(!contracts.children.length)contracts.textContent='No signed contracts on file yet.';
 }
 async function refreshHead(){
  if(!loaded||!visible())return false;const id=identity(),generation=epoch,guard=guardFor(id,generation),before=loaded;
  try{const fresh=await client.read(id,{assertCurrent:guard});guard();const keys=Object.keys(captureContactFields(d)),changed=keys.some(key=>(fresh.profile[key]??'')!==(before.profile[key]??''));loaded={...fresh,documents:before.documents,needsRefresh:before.needsRefresh||changed};$('btnSaveProfileData').disabled=loaded.needsRefresh===true;showRetry(loaded.needsRefresh===true);if(changed)status('The saved profile changed again. Reopen it before saving more contact details.');return !loaded.needsRefresh;}catch(error){try{guard();loaded={...before,needsRefresh:true};showRetry(true);$('btnSaveProfileData').disabled=true;status('Your PIN action finished. Reopen your profile to confirm current contact details before saving more changes.');}catch{}return false;}
 }
 async function loadGovernment(id,generation){const guard=guardFor(id,generation);try{const vault=await createPrivateClient({assertCurrent:guard});guard();const user=vault.auth.currentUser,records=await vault.store.records({groups:governments.map(row=>row.group)});guard();if(vault.auth.currentUser!==user)throw Error('Your private account changed.');loaded.documents=records;for(const item of governments){const link=$(item.view);link.removeAttribute('href');link.style.display=records[item.group]?'inline-block':'none';link.textContent='View private '+item.label;const hint=$('status-'+item.group);if(hint)hint.textContent=records[item.group]?'Private photo saved · '+records[item.group].status:loaded.legacyDocumentPresent[item.legacy]?'An earlier ID exists. Upload a private copy here; the old record is retained.':'Optional private photo · Upload separately from contact details.';}}catch(error){try{guard();for(const item of governments)if($('status-'+item.group))$('status-'+item.group).textContent=error.message;}catch{}}}
 function scheduleSync(id,generation){
  api.clearTimeout?.(syncTimer);
  if(!api.setTimeout||!visible()||epoch!==generation||identity()!==id)return;
  syncTimer=api.setTimeout(async()=>{
   const guard=guardFor(id,generation),before=loaded;
   try{
    guard();if(!before||before.needsRefresh||contactFlight||pinFlight||pendingContact)return;
    const fresh=await client.read(id,{assertCurrent:guard});guard();
    if(before!==loaded||contactFlight||pinFlight||pendingContact||fresh.expectedFingerprint===before.expectedFingerprint)return;
    let conflict=false;
    for(const [input,key] of Object.entries(fields)){
     const node=$(input),old=displayContact(before.profile,key),latest=displayContact(fresh.profile,key);
     if(node.value.trim()===old||node.value.trim()===latest)node.value=latest;
     else if(old!==latest)conflict=true;
    }
    loaded={...fresh,documents:before.documents,needsRefresh:conflict};sections.show(fresh.profile);renderHistory(fresh.profile,id);
    // Name inputs are refreshed with the same draft-preserving merge as contact fields.
    if(conflict){$('btnSaveProfileData').disabled=true;showRetry(true);status('HQ updated a field you are editing. Reload your profile to review it.');}
   }catch(error){
    if(epoch===generation && identity()===id && visible()){
     if(['private-profile/approval','private-profile/changed','private-profile/review'].includes(error.code)){clear();status(error.message);}
     else status('Live refresh interrupted. Your edits are kept while Staff reconnects.');
    }
   }finally{if(epoch===generation)scheduleSync(id,generation);}
  },30000);
 }
 api.openProfile=async()=>{
  clear();const id=identity(),generation=epoch;if(!id)return;$('profileModal').style.display='flex';status('Checking your phone and employee profile…');const guard=guardFor(id,generation);
  const pic=api.localStorage.getItem('takodeal_staff_pic'),preview=$('profilePreview'),placeholder=$('profilePlaceholder');if(preview&&placeholder){if(pic){preview.src=pic;preview.style.display='block';placeholder.style.display='none';}else{preview.removeAttribute('src');preview.style.display='none';placeholder.style.display='flex';}}
  api.selectedProfileFile=null;
  try{await api.prepareStaffProfilePhone?.({assertCurrent:guard});guard();const result=await client.read(id,{assertCurrent:guard});guard();loaded=result;showStaffProfilePhoto(api,d,result.profile.profilePicUrl);sections.show(result.profile);for(const [input,key]of Object.entries(fields)){$(input).value=displayContact(result.profile,key);$(input).disabled=false;}$('profFullName').value=result.profile.cashierName||'';$('profNickname').value=result.profile.scheduleNickname||'';renderHistory(result.profile,id);$('btnSaveProfileData').disabled=false;status('Contact details, daily PIN and government photos save separately.');scheduleSync(id,generation);void loadGovernment(id,generation);}catch(error){try{guard();showRetry(true);if(activate)activate.hidden=error.code!=='private-profile/approval'||api.staffSetupAccess?.mode()!=='legacy';status(error.message);}catch{}}
 };
 api.saveProfileData=()=>{
  if(contactFlight)return contactFlight;
  const id=identity(),generation=epoch,guard=guardFor(id,generation);
  try{guard();if(loaded?.staffId!==id||loaded.needsRefresh)throw Error('Reload your profile before saving.');}
  catch(error){status(error.message);return Promise.resolve(false);}
  const before=loaded.profile,patch=captureContactFields(d,before);
  if(!Object.keys(patch).length&&!pendingContact){status('Your contact details are up to date.');return Promise.resolve(true);}
  // Resolve an uncertain previous save with its original operation ID before sending later edits.
  pendingContact??={staffId:id,patch,expectedFingerprint:loaded.expectedFingerprint,operationId:uuid()};
  let input=pendingContact;
  const save=async()=>{
   const button=$('btnSaveProfileData');button.disabled=true;status('Saving contact details…');
   try{
    try{await client.update(input,{assertCurrent:guard});}
    catch(error){
     guard();
     if(error.code!=='private-profile/changedProfile')throw error;
     const latest=await client.read(id,{assertCurrent:guard});guard();
     if(Object.keys(input.patch).some(key=>latest.profile[key]!==before[key]))throw error;
     // An unrelated employee-record edit advanced the revision. Retain only our edited fields.
     input={...input,expectedFingerprint:latest.expectedFingerprint,operationId:uuid()};pendingContact=input;
     await client.update(input,{assertCurrent:guard});
    }
    guard();
    const fresh=await client.read(id,{assertCurrent:guard});guard();
    pendingContact=null;
    api.localStorage.setItem?.('takodeal_staff_name',fresh.profile.cashierName);if($('loggedInName'))$('loggedInName').textContent=fresh.profile.cashierName;
    const changedAgain=Object.entries(input.patch).some(([key,value])=>fresh.profile[key]!==value);
    loaded={...fresh,documents:loaded.documents,needsRefresh:changedAgain};
    if(changedAgain){showRetry(true);status('Your contact submission was saved, but the record changed again. Reload your profile to review it.');return true;}
    for(const [field,key] of Object.entries(fields)){
     const node=$(field);
     if(node.value.trim()===displayContact(before,key) && !Object.hasOwn(input.patch,key))node.value=displayContact(fresh.profile,key);
    }
    const dirty=Object.keys(captureContactFields(d,fresh.profile)).length>0;
    status(dirty?'The submitted details were saved. You have newer unsaved edits. Tap Save again.':'Contact details saved to your employee record.');
    return true;
   }catch(error){
    try{guard();if(error.code==='private-profile/changedProfile'){pendingContact=null;loaded.needsRefresh=true;showRetry(true);}status(error.message);}catch{}
    return false;
   }finally{if(epoch===generation&&identity()===id)button.disabled=loaded?.needsRefresh===true;}
  };
  const action=save();contactFlight=action;action.finally(()=>{if(contactFlight===action)contactFlight=null;});return action;
 };
 api.changeDailyStaffPin=()=>{
  if(pinFlight)return pinFlight;const id=identity(),generation=epoch,guard=guardFor(id,generation),newPin=$('profPin').value.trim();if(!/^\d{4,10}$/.test(newPin)){status('Use 4–10 digits for your daily login PIN. Your separate Payslip PIN stays unchanged.');return Promise.resolve(false);}
  const action=(async()=>{try{guard();if(loaded?.staffId!==id||loaded.needsRefresh)throw Error('Reopen your private profile first.');const approved=await api.Swal.fire({title:'Change daily Staff PIN?',text:'This changes your next Staff login. It does not change your separate Payslip PIN.',icon:'question',showCancelButton:true,confirmButtonText:'Change daily PIN'});guard();if(!approved.isConfirmed)return false;if($('profPin').value.trim()!==newPin)throw Error('The new PIN changed. Check it and confirm again.');if(!pendingPin||pendingPin.staffId!==id||pendingPin.newPin!==newPin)pendingPin={staffId:id,newPin,operationId:uuid(),expectedVersion:loaded.profile.loginPinVersion??0};status('Saving daily Staff PIN…');await access.changePin({...pendingPin,createPrivateClient:createPinClient,assertCurrent:guard});guard();pendingPin=null;if($('profPin').value.trim()===newPin)$('profPin').value='';const fresh=await refreshHead();guard();if(fresh)status('Daily Staff PIN saved. Your Payslip PIN and recorded attendance are unchanged.');return true;}catch(error){try{guard();status(error.message);}catch{}return false;}})();pinFlight=action;action.finally(()=>{if(pinFlight===action)pinFlight=null;});return action;
 };
 for(const item of governments){
  $(item.input)?.addEventListener('change',()=>{documentChoices.delete(item.group);});
  $('upload-'+item.group)?.addEventListener('click',()=>{if(documentFlights.has(item.group))return;const id=identity(),generation=epoch,guard=guardFor(id,generation),file=$(item.input).files?.[0],hint=$('status-'+item.group);const action=(async()=>{try{guard();if(!file||loaded?.staffId!==id)throw Error('Choose a photo and wait for your private profile to load.');hint.textContent='Preparing private photo…';let choice=documentChoices.get(item.group);if(!choice||choice.file!==file){choice={file,blob:await normalize(file),operationId:uuid()};guard();if($(item.input).files?.[0]!==file)throw Error('The selected photo changed. Choose it again.');documentChoices.set(item.group,choice);}const vault=await createPrivateClient({assertCurrent:guard});guard();const records=await vault.store.records({groups:[item.group]});guard();choice.expectedVersion??=records[item.group]?.version??0;hint.textContent='Saving this private photo…';await vault.store.upload(item.group,choice.blob,{group:item.group,clearanceType:'',expiresOn:''},choice.expectedVersion,choice.operationId);guard();if($(item.input).files?.[0]===file)$(item.input).value='';documentChoices.delete(item.group);await loadGovernment(id,generation);guard();hint.textContent=loaded.documents?.[item.group]?.status==='approved'?'Private photo saved · HQ approved.':loaded.documents?.[item.group]?.status==='rejected'?'Private photo saved · HQ requested a replacement.':'Private photo saved · Awaiting HQ document review.';}catch(error){try{guard();hint.textContent=error.message;}catch{}}})();documentFlights.set(item.group,action);action.finally(()=>{if(documentFlights.get(item.group)===action)documentFlights.delete(item.group);});});
  $(item.view)?.addEventListener('click',event=>{event.preventDefault();const id=identity(),generation=epoch,guard=guardFor(id,generation);void(async()=>{let url;try{guard();const vault=await createPrivateClient({assertCurrent:guard});guard();const records=await vault.store.records({groups:[item.group]});guard();if(!records[item.group])throw Error('Upload a private photo before viewing it.');const blob=await vault.store.file(records[item.group]);guard();url=URL.createObjectURL(blob);urls.add(url);photoModal={url};await api.Swal.fire({title:item.label,imageUrl:url,imageAlt:item.label,confirmButtonText:'Close'});}catch(error){try{guard();$('status-'+item.group).textContent=error.message;}catch{}}finally{if(url){if(photoModal?.url===url)photoModal=null;URL.revokeObjectURL(url);urls.delete(url);}}})();});
 }
 $('btnChangeDailyPin')?.addEventListener('click',()=>api.changeDailyStaffPin());
 const close=api.closeStaffProfile;api.closeStaffProfile=function(...args){resumeDraft=null;clear();$('profileModal').style.display='none';return close?.apply(this,args);};
 const stop=api.stopStaffLiveListeners;api.stopStaffLiveListeners=function(...args){if(d.hidden&&loaded&&$('profileModal')?.style.display!=='none')resumeDraft={staffId:identity(),patch:captureContactFields(d,loaded.profile),tab:Array.from(d.querySelectorAll?.('[data-profile-tab]')||[]).find(node=>node.getAttribute('aria-pressed')==='true')?.dataset.profileTab};clear();return stop?.apply(this,args);};
 api.addEventListener('pagehide',clear);api.addEventListener('storage',event=>{if(!event.key||['takodeal_staff_id','takodeal_device_id'].includes(event.key))clear();});d.addEventListener('visibilitychange',()=>{if(d.hidden){if(loaded&&$('profileModal')?.style.display!=='none')resumeDraft={staffId:identity(),patch:captureContactFields(d,loaded.profile)};clear();}else if(visible()&&api.staffSetupAccess?.isVerified?.()){if(resumeDraft)void resume();else void api.openProfile();}});
 async function resume(){const saved=resumeDraft;if(!saved||saved.staffId!==identity()||d.hidden)return;resumeDraft=null;await api.openProfile();if(loaded?.staffId!==saved.staffId)return;for(const [input,key]of Object.entries(fields))if(Object.hasOwn(saved.patch,key))$(input).value=saved.patch[key];if(saved.tab)d.querySelector?.('[data-profile-tab="'+saved.tab+'"]')?.click();if(Object.keys(saved.patch).length)status('Profile reconnected. Your unsaved edits are kept.');}
 return{clear,refreshHead,resume,get loaded(){return loaded;}};
}
