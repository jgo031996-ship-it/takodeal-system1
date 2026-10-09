import {CUSTOMER_SITE_PROFILE_DOC,customerSiteProfile,validateCustomerSiteProfile,customerSiteFooter,branchOpeningNotice,validateBranchOpeningNotice} from './customer-site-settings.js';
import {canOpenWorkspacePage,createWorkspaceSession,OWNER_EMAIL} from './workspace-access-model.js';
import {resolveHQAccount} from './hq-account-model.js';

const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields={site:['businessName','location','sinceYear','aboutText'],branch:['operatingHours','publicContact','publicAddress','grabLink','foodpandaLink','customerSoonToOpen','customerOpeningLabel']};
const project=(data,keys)=>Object.fromEntries(keys.map(key=>[key,data?.[key] ?? null]));
const fingerprint=data=>JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(key=>[key,data[key]])));
function currentActor(api) {
    const user=api.auth?.currentUser,session=api.sessionUser,email=String(user?.email || '').trim().toLowerCase();
    if(!user?.uid || !email || user.emailVerified!==true || !session || session.uid!==user.uid || String(session.email || '').trim().toLowerCase()!==email || !canOpenWorkspacePage(session,'customerapp'))
        throw Error('Unlock Customer App Hub with your approved Google account before changing these settings.');
    return {uid:user.uid,email};
}
function permitted(api,actor,records,branch='') {
    if(!same(currentActor(api),actor))throw Error('Your account changed. Reopen Customer App Hub.');
    const saved=resolveHQAccount(records);
    if(saved.blocked===true)throw Error('Your account is blocked. Ask the owner to review access.');
    const session=createWorkspaceSession(actor,saved);
    if(!canOpenWorkspacePage(session,'customerapp'))throw Error('Your saved permissions do not allow Customer App Hub changes.');
    if(branch && (typeof api.isBranchAllowed!=='function' || !api.isBranchAllowed(branch) || actor.email!==OWNER_EMAIL && !session.allowedBranches.some(name=>name==='All' || name===branch)))
        throw Error('This branch is outside your saved account permissions.');
    return session;
}
async function access(api,actor,branch='') {
    const snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email)));
    const records=snapshot.docs.map(row=>({id:row.id,data:row.data()}));permitted(api,actor,records,branch);return records;
}
export function assertCustomerHubSession(api,actor) {
    if(!same(currentActor(api),actor))throw Error('Your account changed. Reopen Customer App Hub.');
}
export async function loadCustomerHubState(api,{kind='site',id=''}={}) {
    if(!Object.hasOwn(fields,kind) || kind==='branch' && (typeof id!=='string' || !id || id.includes('/')))throw Error('Choose an existing branch profile.');
    const actor=currentActor(api),records=await access(api,actor);
    const ref=api.doc(api.db,kind==='site'?'settings':'branches',kind==='site'?CUSTOMER_SITE_PROFILE_DOC:id),snapshot=await api.getDocFromServer(ref);
    const data=snapshot.exists()?snapshot.data():{},branch=kind==='branch'?data.name:'';
    if(kind==='branch' && (!snapshot.exists() || typeof branch!=='string' || !branch || branch==='Main Office'))throw Error('This storefront branch could not be confirmed. Refresh profiles.');
    permitted(api,actor,records,branch);
    return {kind,id:ref.id,ref,actor,records,branch,exists:snapshot.exists(),data};
}
export async function saveCustomerHubState(api,state,patch,{operationId}={}) {
    if(!state || !Object.hasOwn(fields,state.kind) || typeof operationId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId))throw Error('Reload these settings before saving.');
    const allowed=fields[state.kind];
    if(Object.keys(patch).some(key=>!allowed.includes(key) && !(state.kind==='branch' && key==='storefrontImage')))throw Error('This save contains an unsupported profile field.');
    if(state.kind==='site')patch=validateCustomerSiteProfile(patch);
    else patch={...patch,...validateBranchOpeningNotice(patch)};
    const actor=currentActor(api);if(!same(actor,state.actor))throw Error('Your account changed. Reload saved settings.');
    const records=await access(api,actor,state.branch),hash=fingerprint(patch);
    return api.runTransaction(api.db,async tx=>{
        const liveRecords=[];
        for(const record of records){const row=await tx.get(api.doc(api.db,'hq_managers',record.id));if(row.exists())liveRecords.push({id:record.id,data:row.data()});}
        permitted(api,actor,liveRecords,state.branch);
        const snapshot=await tx.get(state.ref),data=snapshot.exists()?snapshot.data():{};
        if(state.kind==='branch' && (!snapshot.exists() || data.name!==state.branch))throw Error('This branch changed. Refresh its profile before saving.');
        const marker=data.customerHubOperation;
        if(marker?.id===operationId){
            if(marker.actorUid!==actor.uid || marker.hash!==hash || !same(project(data,Object.keys(patch)),project(patch,Object.keys(patch))))throw Error('These settings changed after the save. Reload before editing again.');
            permitted(api,actor,liveRecords,state.branch);return {alreadySaved:true,data};
        }
        const watched=[...allowed,...(Object.hasOwn(patch,'storefrontImage')?['storefrontImage']:[])];
        if(snapshot.exists()!==state.exists || !same(project(data,watched),project(state.data,watched)))throw Error('Another account changed these settings. Reload saved settings before saving your draft.');
        permitted(api,actor,liveRecords,state.branch);
        const next={...patch,customerHubRevision:(Number.isSafeInteger(data.customerHubRevision)?data.customerHubRevision:0)+1,
            customerHubOperation:{id:operationId,hash,actorUid:actor.uid},customerHubUpdatedAt:api.serverTimestamp(),customerHubUpdatedBy:actor.email};
        if(state.kind==='site')tx.set(state.ref,next,{merge:true});else tx.update(state.ref,next);
        return {saved:true,data:{...data,...next}};
    });
}

export function installCustomerHubSettings(api=window,d=document) {
    if(api.customerHubSettings)return api.customerHubSettings;
    let aboutEpoch=0,aboutState=null,aboutBusy=false,aboutAttempt=null,profileEpoch=0,profileBusy=false;
    const profileAttempts=new Map(),el=id=>d.getElementById(id);
    const notice=(message,error=false)=>{const node=el('customerSiteSettingsStatus');if(node){node.textContent=message;node.dataset.error=String(error);}};
    const input=()=>({businessName:el('customerSiteBusinessName').value,location:el('customerSiteLocation').value,sinceYear:el('customerSiteSinceYear').value,aboutText:el('customerSiteAboutText').value});
    const preview=()=>{if(el('customerSiteFooterPreview'))el('customerSiteFooterPreview').textContent=customerSiteFooter(input());if(el('customerSiteAboutPreview'))el('customerSiteAboutPreview').textContent=customerSiteProfile(input()).aboutText;};
    const aboutFields=['customerSiteBusinessName','customerSiteLocation','customerSiteSinceYear','customerSiteAboutText'];
    const disableAbout=busy=>{for(const id of [...aboutFields,'btnSaveCustomerSiteProfile','btnReloadCustomerSiteProfile'])if(el(id))el(id).disabled=busy;};
    const operation=()=>`customer-hub-${api.crypto?.randomUUID?.() || globalThis.crypto.randomUUID()}`;
    const live=actor=>{try{assertCustomerHubSession(api,actor);return true;}catch{return false;}};
    api.loadCustomerSiteProfile=async()=>{
        if(aboutBusy)return false;const epoch=++aboutEpoch;aboutState=null;disableAbout(true);notice('Loading saved customer information…');
        try{
            const state=await loadCustomerHubState(api);if(epoch!==aboutEpoch || !live(state.actor))return false;
            const value=customerSiteProfile(state.data);for(const [id,key] of aboutFields.map((id,index)=>[id,fields.site[index]]))el(id).value=value[key];
            aboutState=state;aboutAttempt=null;preview();notice(state.exists?'Saved information loaded.':'Default information shown. Save to apply your changes.');return true;
        }catch(error){if(epoch===aboutEpoch)notice(error.message,true);return false;}
        finally{if(epoch===aboutEpoch)disableAbout(!aboutState);}
    };
    api.saveCustomerSiteProfile=async()=>{
        if(aboutBusy || !aboutState)return false;const epoch=aboutEpoch,state=aboutState;
        try{
            const patch=validateCustomerSiteProfile(input()),signature=fingerprint(patch);assertCustomerHubSession(api,state.actor);
            if(!aboutAttempt || aboutAttempt.signature!==signature)aboutAttempt={signature,id:operation()};
            aboutBusy=true;disableAbout(true);notice('Saving customer information…');
            const result=await saveCustomerHubState(api,state,patch,{operationId:aboutAttempt.id});
            if(epoch!==aboutEpoch || !live(state.actor))return false;
            aboutState={...state,exists:true,data:result.data};aboutAttempt=null;preview();notice('Customer information saved.');return true;
        }catch(error){if(epoch===aboutEpoch && live(state.actor))notice(error.message,true);return false;}
        finally{aboutBusy=false;if(epoch===aboutEpoch && live(state.actor))disableAbout(false);}
    };
    for(const id of aboutFields)el(id)?.addEventListener('input',preview);
    async function loadProfiles() {
        const tbody=el('storefrontProfilesTableBody');if(!tbody)return false;const epoch=++profileEpoch;
        try{
            const actor=currentActor(api),records=await access(api,actor);tbody.innerHTML='<tr><td colspan="4">Loading branch profiles…</td></tr>';
            const snapshot=await api.getDocsFromServer(api.collection(api.db,'branches'));permitted(api,actor,records);
            if(epoch!==profileEpoch)return false;const session=createWorkspaceSession(actor,resolveHQAccount(records));
            tbody.innerHTML=snapshot.docs.filter(row=>{const branch=row.data().name;return branch && branch!=='Main Office' && api.isBranchAllowed?.(branch) && (actor.email===OWNER_EMAIL || session.allowedBranches.includes('All') || session.allowedBranches.includes(branch));}).map(row=>{
                const data=row.data(),opening=branchOpeningNotice(data),encoded=encodeURIComponent(JSON.stringify({id:row.id})).replace(/'/g,'%27');
                return `<tr><td><strong>${esc(data.name)}</strong>${opening.soonToOpen?`<div class="customer-hub-opening-label">${esc(opening.label)}</div>`:''}</td><td>${data.storefrontImage?`<img class="customer-hub-profile-image" src="${esc(data.storefrontImage)}" alt="${esc(data.name)} storefront">`:'No image'}</td><td><div>Hours: ${esc(data.operatingHours || 'Not set')}</div><div>Phone: ${esc(data.publicContact || data.contact || 'Not set')}</div><div>Address: ${esc(data.publicAddress || data.address || 'Not set')}</div><div>${data.grabLink?'GrabFood link set':''}${data.grabLink && data.foodpandaLink?' · ':''}${data.foodpandaLink?'foodpanda link set':''}</div></td><td><button type="button" class="customer-hub-button" onclick="window.editStorefrontProfile('${encoded}')">Edit profile</button></td></tr>`;
            }).join('') || '<tr><td colspan="4">No storefront branches within your permissions.</td></tr>';return true;
        }catch(error){if(epoch===profileEpoch){tbody.innerHTML='<tr><td colspan="4"></td></tr>';tbody.querySelector?.('td')?.appendChild?.(d.createTextNode(error.message));}return false;}
    }
    async function editProfile(encodedData) {
        if(profileBusy)return false;profileBusy=true;const epoch=++profileEpoch;
        try{
            const {id}=JSON.parse(decodeURIComponent(encodedData)),state=await loadCustomerHubState(api,{kind:'branch',id});if(epoch!==profileEpoch || !live(state.actor))return false;
            const data=state.data,opening=branchOpeningNotice(data);
            const answer=await api.Swal.fire({titleText:`Edit ${data.name} profile`,html:`<div class="customer-hub-profile-form">
                <label>Operating hours<input id="sfHours" class="input-box" value="${esc(data.operatingHours || '10:00 AM - 9:00 PM')}"></label>
                <label>Public contact number<input id="sfContact" class="input-box" value="${esc(data.publicContact || data.contact || '')}"></label>
                <label>Public address<textarea id="sfAddress" class="input-box">${esc(data.publicAddress || data.address || '')}</textarea></label>
                <label>GrabFood URL<input type="url" id="sfGrab" class="input-box" value="${esc(data.grabLink || '')}"></label>
                <label>foodpanda URL<input type="url" id="sfFp" class="input-box" value="${esc(data.foodpandaLink || '')}"></label>
                <fieldset><legend>Opening notice</legend><label class="customer-hub-toggle"><input type="checkbox" id="sfSoonToOpen" ${opening.soonToOpen?'checked':''}>Show “Soon to open” on this branch</label><label>Watermark text<input id="sfOpeningLabel" class="input-box" maxlength="60" value="${esc(opening.label)}"></label><p>The branch is shown in the Customer App and cannot accept new orders while this notice is enabled.</p></fieldset>
                <label>Upload storefront image<input type="file" id="sfImage" accept="image/*" class="input-box"></label></div>`,showCancelButton:true,confirmButtonText:'Save profile',showLoaderOnConfirm:true,allowOutsideClick:()=>!api.Swal.isLoading(),preConfirm:async()=>{
                try{
                    const openingPatch=validateBranchOpeningNotice({customerSoonToOpen:el('sfSoonToOpen').checked,customerOpeningLabel:el('sfOpeningLabel').value});
                    const patch={operatingHours:el('sfHours').value.trim(),publicContact:el('sfContact').value.trim(),publicAddress:el('sfAddress').value.trim(),grabLink:el('sfGrab').value.trim(),foodpandaLink:el('sfFp').value.trim(),...openingPatch},file=el('sfImage').files?.[0];
                    const signature=fingerprint({...patch,file:file?{name:file.name,size:file.size,lastModified:file.lastModified}:null}),key=state.actor.uid+':'+state.id;
                    let attempt=profileAttempts.get(key);if(!attempt || attempt.signature!==signature){attempt={signature,id:operation()};profileAttempts.set(key,attempt);}
                    await access(api,state.actor,state.branch);if(epoch!==profileEpoch)throw Error('The profile changed. Reopen it before saving.');
                    if(file && !attempt.imageURL){
                        const ext=String(file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g,'').slice(0,10) || 'jpg';
                        assertCustomerHubSession(api,state.actor);const uploaded=await api.uploadBytes(api.ref(api.storage,`storefronts/${state.id}_${attempt.id}.${ext}`),file);assertCustomerHubSession(api,state.actor);
                        attempt.imageURL=await api.getDownloadURL(uploaded.ref);assertCustomerHubSession(api,state.actor);
                    }
                    if(file)patch.storefrontImage=attempt.imageURL;
                    const result=await saveCustomerHubState(api,state,patch,{operationId:attempt.id});if(epoch!==profileEpoch || !live(state.actor))return false;
                    profileAttempts.delete(key);return result;
                }catch(error){api.Swal.showValidationMessage(error.message);return false;}
            }});
            if(answer.isConfirmed && answer.value && epoch===profileEpoch && live(state.actor)){await loadProfiles();return true;}return false;
        }catch(error){api.ManagerUI?.notify?.(error.message);return false;}
        finally{profileBusy=false;}
    }
    api.customerHubSettings={loadProfiles,editProfile,preview};return api.customerHubSettings;
}
