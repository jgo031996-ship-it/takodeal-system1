import {createStaffDocumentFirebase} from './staff-document-firebase.js';
import {documentCards,decodeDocumentPhoto} from './staff-documents.js';
import {DOCUMENT_LABELS} from './staff-document-model.js';
const html=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const ms=value=>value?.toMillis?.() ?? (value?.seconds?value.seconds*1000+Math.floor((value.nanoseconds||0)/1000000):0);
export function installMasterEmployeeDocuments(api=window,{d=document,createVault}={}) {
    const el=id=>d.getElementById(id),identity=()=>el('empProfileId')?.value||'';
    const visible=()=>!d.hidden && el('employeeProfileModal')?.style.display!=='none';
    let epoch=0,vaultPromise,records={},requests=new Map(),objectUrls=new Set(),busy=false,stopAuth;
    const vault=()=>vaultPromise||(vaultPromise=(createVault?createVault():createStaffDocumentFirebase(null,identity,{isHQ:true})).then(client=>{if(!stopAuth){let previousUid=client.auth.currentUser?.uid;stopAuth=client.sdk.onAuthStateChanged?.(client.auth,user=>{if(user?.uid!==previousUid){previousUid=user?.uid;clear();}});}return client;}).catch(error=>{vaultPromise=null;throw error;}));
    const text=message=>{if(el('masterStaffDocumentStatus'))el('masterStaffDocumentStatus').textContent=message;};
    const same=(token,id,uid)=>token===epoch && identity()===id && visible() && api.auth.currentUser?.uid===uid;
    function clear() {epoch++;records={};requests.clear();busy=false;for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();el('masterStaffDocumentPreview')?.close();el('masterStaffDocumentPreviewImage')?.removeAttribute('src');if(el('masterStaffDocumentCards'))el('masterStaffDocumentCards').innerHTML='';if(el('masterStaffDocumentRequests'))el('masterStaffDocumentRequests').innerHTML='';}
    async function admin(client) {
        const user=client.auth.currentUser;if(!user?.uid || !user.emailVerified)return false;
        if(user.email?.toLowerCase()==='jgo031996@gmail.com')return true;
        const snap=await client.sdk.getDocFromServer(client.sdk.doc(client.db,'hq_email_access',user.email.toLowerCase()));
        const data=snap.exists()?snap.data():{};return data.active===true && data.permissions?.includes('all') && data.allowedBranches?.includes('All');
    }
    async function load() {
        clear();const id=identity(),uid=api.auth.currentUser?.uid,token=epoch;if(!id){text('Save this employee profile before collecting documents.');return;}
        text('Checking private staff documents…');
        try {
            const client=await vault();await client.store.ready();
            const data=await client.store.records();if(!same(token,id,uid))return;
            records=data;el('masterStaffDocumentCards').innerHTML=documentCards(data,{hq:true});text('View or download these photos to attach them to the employee’s contract.');
            if(await admin(client)) {
                const snap=await client.sdk.getDocsFromServer(client.sdk.query(client.sdk.collection(client.db,'staff_document_requests'),client.sdk.where('staffId','==',id)));
                if(!same(token,id,uid))return;
                const pending=snap.docs.filter(row=>row.data().status==='pending');
                el('masterStaffDocumentRequests').innerHTML=pending.length?'<h4>Phones awaiting upload access</h4>'+pending.map(row=>{const value={...row.data(),id:row.id};requests.set(row.id,value);return `<article class="document-device-request"><strong>${html(value.deviceName||'Staff phone')}</strong><p>Employee: ${html(el('empFullName')?.value||'Selected employee')} · Device ${html((value.deviceId||'').slice(-12)||'not recorded')}</p><p>Approve only after confirming this is the employee’s phone. Approval gives this device access to this employee’s private documents.</p><button type="button" data-document-device="${html(row.id)}" data-device-action="approve">Approve phone</button><button type="button" data-document-device="${html(row.id)}" data-device-action="reject">Decline request</button></article>`;}).join(''):'<p class="document-meta">No phones waiting for approval.</p>';
            }
        } catch(error) {if(same(token,id,uid))text(error.message||'Documents could not load. Check your account permissions and connection.');}
    }
    async function decideDevice(button) {
        if(busy)return;const request=requests.get(button.dataset.documentDevice),id=identity(),uid=api.auth.currentUser?.uid,token=epoch;if(!request || request.staffId!==id)return;
        const approve=button.dataset.deviceAction==='approve';
        busy=true;button.disabled=true;
        try {
            const confirmed=await api.Swal.fire({title:approve?'Approve this employee’s phone?':'Decline this phone request?',text:approve?'Only approve after confirming the phone belongs to the selected employee. This gives it private document upload and viewing access.':'The employee can ask HQ to review their phone before uploading documents.',icon:'question',showCancelButton:true,confirmButtonText:approve?'Approve phone':'Decline request'});
            if(!confirmed.isConfirmed || !same(token,id,uid))return;
            const client=await vault();if(!await admin(client))throw Error('Only the owner or an approved account with full access can approve phones.');
            const sdk=client.sdk,operationId=crypto.randomUUID(),profile=await sdk.getDocFromServer(sdk.doc(client.db,'cashiers',id));
            const expectedBranch=profile.exists()?profile.data().branch:'';if(!expectedBranch)throw Error('Set the employee’s branch before approving their phone.');
            await sdk.runTransaction(client.db,async tx=>{
                const requestRef=sdk.doc(client.db,'staff_document_requests',request.id),bindingRef=sdk.doc(client.db,'staff_document_devices',request.id),scopeRef=sdk.doc(client.db,'staff_private_documents',id);
                const live=await tx.get(requestRef),binding=await tx.get(bindingRef),scope=await tx.get(scopeRef),staff=await tx.get(sdk.doc(client.db,'cashiers',id));
                if(!same(token,id,uid))throw Error('Your account or selected employee changed.');
                if(!live.exists() || live.data().staffId!==id || live.data().status!=='pending' || ms(live.data().requestedAt)!==ms(request.requestedAt))throw Error('This phone request changed. Refresh before approving.');
                if(!staff.exists() || staff.data().branch!==expectedBranch)throw Error('The employee’s branch changed. Refresh their profile.');
                if(binding.exists() && (binding.data().staffId!==id || binding.data().branch!==expectedBranch))throw Error('This phone is linked to another employee or branch. Review its existing approval.');
                if(scope.exists() && scope.data().branch!==expectedBranch)throw Error('The private document branch differs. Review the existing private access before moving it.');
                tx.update(requestRef,{status:approve?'approved':'rejected',reviewedAt:sdk.serverTimestamp(),reviewedByUid:uid,reviewNote:approve?'Employee phone confirmed by HQ':'Phone access needs HQ review'});
                if(approve) {
                    const before=binding.exists()?binding.data():{};
                    const approval={active:true,updatedAt:sdk.serverTimestamp(),updatedByUid:uid,audit:{...(before.audit||{}),[operationId]:{active:true,actorUid:uid,recordedAt:sdk.serverTimestamp()}}};
                    // A renewed request cannot rewrite the original phone approval or its identity.
                    if(binding.exists())tx.update(bindingRef,approval);
                    else tx.set(bindingRef,{uid:request.id,staffId:id,branch:expectedBranch,deviceId:live.data().deviceId,deviceName:live.data().deviceName,approvedAt:sdk.serverTimestamp(),approvedByUid:uid,...approval});
                    tx.set(scopeRef,{staffId:id,branch:expectedBranch,version:1,updatedAt:sdk.serverTimestamp(),updatedByUid:uid});
                }
            });
            if(same(token,id,uid)){busy=false;await load();}
        } catch(error){if(same(token,id,uid))text(error.message);}finally{if(same(token,id,uid)){busy=false;button.disabled=false;}}
    }
    async function documentAction(button) {
        if(busy)return;const kind=button.dataset.group,record=records[kind],id=identity(),uid=api.auth.currentUser?.uid,token=epoch;if(!record)return;
        busy=true;button.disabled=true;
        try {
            const client=await vault();if(!same(token,id,uid))return;
            if(['view','download'].includes(button.dataset.docAction)) {
                const blob=await client.store.file(record,{validatePhoto:async photo=>{const decoded=await decodeDocumentPhoto(photo);const valid=decoded.width>0 && decoded.height>0;decoded.close?.();if(!valid)throw Error('This photo could not be opened. Ask for a replacement.');}});if(!same(token,id,uid))return;
                const url=URL.createObjectURL(blob);objectUrls.add(url);
                if(button.dataset.docAction==='download') {const link=d.createElement('a');link.href=url;link.download=`TAKODEAL_${String(el('empFullName')?.value||'Employee').replace(/[^A-Za-z0-9 _-]/g,'').slice(0,70)}_${kind}.jpg`;d.body.append(link);link.click();link.remove();text('Photo downloaded. Attach it to the employee’s contract as needed.');}
                else {el('masterStaffDocumentPreviewTitle').textContent=DOCUMENT_LABELS[kind];el('masterStaffDocumentPreviewImage').src=url;el('masterStaffDocumentPreview').showModal();}
            } else {
                const reject=button.dataset.docAction==='reject';
                const result=await api.Swal.fire({title:reject?'Ask for a replacement photo':'Mark this document reviewed?',text:reject?'Explain which photo or details the employee needs to upload again.':'This records your review of the uploaded photo.',input:reject?'text':undefined,showCancelButton:true,confirmButtonText:reject?'Request replacement':'Mark reviewed'});
                if(!result.isConfirmed || !same(token,id,uid))return;
                await client.store.review(kind,record.version,reject?'rejected':'approved',reject?result.value:'');
                if(same(token,id,uid)){busy=false;await load();}
            }
        } catch(error){if(same(token,id,uid))text(error.message||'The document action could not finish. Reconnect and try again.');}
        finally {if(same(token,id,uid)){busy=false;button.disabled=false;}}
    }
    el('masterStaffDocumentCards')?.addEventListener('click',event=>{const button=event.target.closest('[data-doc-action]');if(button)documentAction(button);});
    el('masterStaffDocumentRequests')?.addEventListener('click',event=>{const button=event.target.closest('[data-document-device]');if(button)decideDevice(button);});
    el('masterStaffDocumentRefresh')?.addEventListener('click',load);el('masterStaffDocumentPreviewClose')?.addEventListener('click',()=>{el('masterStaffDocumentPreview').close();el('masterStaffDocumentPreviewImage').removeAttribute('src');});
    const open=api.openEmployeeProfile;api.openEmployeeProfile=function(...args){const result=open.apply(this,args);load();return result;};
    const fresh=api.addNewStaff;if(fresh)api.addNewStaff=function(...args){clear();text('Save the employee profile before collecting private documents.');return fresh.apply(this,args);};
    if(el('employeeProfileModal'))new MutationObserver(()=>{if(!visible())clear();}).observe(el('employeeProfileModal'),{attributes:true,attributeFilter:['style']});
    d.addEventListener('visibilitychange',()=>{if(d.hidden)clear();});api.addEventListener('pagehide',clear);
    api.masterStaffDocuments={load,clear};return api.masterStaffDocuments;
}
