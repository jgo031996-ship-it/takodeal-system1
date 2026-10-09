import {DOCUMENT_GROUPS,DOCUMENT_LABELS,MAX_INPUT_BYTES,MAX_UPLOAD_BYTES,validateDocumentFile,validateDocumentDraft,documentSummary} from './staff-document-model.js';
const html=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export async function decodeDocumentPhoto(blob) {
    if(typeof createImageBitmap==='function')return createImageBitmap(blob);
    const image=new Image(),url=URL.createObjectURL(blob);image.src=url;
    try {await image.decode();image.close=()=>{image.removeAttribute('src');URL.revokeObjectURL(url);};return image;}
    catch(error){URL.revokeObjectURL(url);throw error;}
}
export async function prepareDocumentPhoto(file,{decode=decodeDocumentPhoto,canvas=()=>document.createElement('canvas')}={}) {
    const checked=validateDocumentFile(file,{bytes:new Uint8Array(await file.arrayBuffer()),maxBytes:MAX_INPUT_BYTES,requireSignature:true});
    if(!checked.valid)throw Error(checked.errors.join(' '));
    const image=await decode(file);
    try {
        if(!image.width || !image.height || image.width*image.height>40000000)throw Error('Choose a smaller, clear photo of the document.');
        const surface=canvas(),scale=Math.min(1,2200/Math.max(image.width,image.height));
        surface.width=Math.round(image.width*scale);surface.height=Math.round(image.height*scale);
        const context=surface.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,surface.width,surface.height);context.drawImage(image,0,0,surface.width,surface.height);
        const encode=quality=>new Promise(resolve=>surface.toBlob(resolve,'image/jpeg',quality));
        let blob=await encode(0.88);if(blob?.size>MAX_UPLOAD_BYTES)blob=await encode(0.68);
        if(!blob)throw Error('This photo could not be processed. Choose JPEG, PNG or WebP.');
        const normalized=validateDocumentFile(blob,{bytes:new Uint8Array(await blob.arrayBuffer()),maxBytes:MAX_UPLOAD_BYTES,requireSignature:true});
        if(!normalized.valid)throw Error(normalized.errors.join(' '));return blob;
    } finally {image.close?.();}
}
export function documentCards(records,{hq=false}={}) {
    const summary=documentSummary(records);
    return summary.items.map(item=>`<article class="staff-document-card" data-group="${item.group}"><div class="document-card-heading"><h4>${html(DOCUMENT_LABELS[item.group])}</h4><span class="document-pill ${item.tone}">${html(item.label)}</span></div><p>${html(item.message)}</p>${item.expiresOn?`<p class="document-meta">Expiry on file: ${html(item.expiresOn)}</p>`:''}${records[item.group]?.reviewNote?`<p class="document-review-note">HQ: ${html(records[item.group].reviewNote)}</p>`:''}<div class="document-actions">${records[item.group]?`<button type="button" data-doc-action="view" data-group="${item.group}">View photo</button>${hq?`<button type="button" data-doc-action="download" data-group="${item.group}">Download for contract</button><button type="button" data-doc-action="approve" data-group="${item.group}">Mark reviewed</button><button type="button" data-doc-action="reject" data-group="${item.group}">Request replacement</button>`:''}`:''}</div>${!hq?`<label class="document-file-label">${records[item.group]?'Replace photo':'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-doc-file="${item.group}"></label><img class="document-photo-preview" data-doc-preview="${item.group}" hidden alt="Selected document photo">${item.group==='clearance'?'<label>Clearance type<select data-doc-clearance="clearance"><option value="NBI">NBI Clearance</option><option value="POLICE">Police Clearance</option></select></label>':''}<label>Expiry date (if printed on the document)<input type="date" data-doc-expiry="${item.group}" value="${html(records[item.group]?.expiresOn||'')}"></label><button type="button" class="document-upload-button" data-doc-action="upload" data-group="${item.group}" disabled>Upload photo</button><p class="document-meta">JPEG, PNG or WebP · up to 10 MB. Photos are resized before saving.</p>`:''}</article>`).join('');
}
export function installStaffDocuments(api=window,{d=document,createVault,normalize=prepareDocumentPhoto,now=()=>Date.now()}={}) {
    const el=id=>d.getElementById(id),identity=()=>api.localStorage.getItem('takodeal_staff_id');
    let vaultPromise,vaultClient,watchingAuth=false,epoch=0,cached=null,loadedAt=0,selected=new Map(),selectionEpoch=new Map(),urls=new Set(),busy=false,busyOwner=null;
    const privateUid=()=>vaultClient?.auth?.currentUser?.uid||null;
    const same=(token,id,uid)=>token===epoch && identity()===id && (uid===undefined || privateUid()===uid);
    const releaseBusy=()=>{busy=false;busyOwner=null;};
    const status=text=>{if(el('staffDocumentsStatus'))el('staffDocumentsStatus').textContent=text;};
    const vault=()=>vaultPromise||(vaultPromise=Promise.resolve().then(createVault).then(client=>{
        vaultClient=client;
        if(!watchingAuth && client.auth && typeof client.sdk?.onAuthStateChanged==='function'){
            watchingAuth=true;let previousUid=client.auth.currentUser?.uid||null;
            client.sdk.onAuthStateChanged(client.auth,user=>{const nextUid=user?.uid||null;if(nextUid!==previousUid){previousUid=nextUid;reset();}});
        }
        return client;
    }).catch(error=>{vaultPromise=null;throw error;}));
    function clearPhotos() {for(const url of urls)URL.revokeObjectURL(url);urls.clear();selected.clear();el('staffDocumentPreview')?.close();const box=el('staffDocumentPreviewImage');if(box)box.removeAttribute('src');el('staffDocumentCards')?.querySelectorAll('img').forEach(img=>{img.removeAttribute('src');img.hidden=true;});}
    function reset() {epoch++;releaseBusy();cached=null;loadedAt=0;clearPhotos();if(el('staffDocumentCards'))el('staffDocumentCards').innerHTML='';if(el('staffDocumentReminder'))el('staffDocumentReminder').hidden=true;status('Open your profile to check required documents.');}
    function reminder() {
        if(!cached || cached.id!==identity() || cached.uid!==privateUid())return;
        const summary=documentSummary(cached.records),button=el('staffDocumentReminder');if(!button)return;
        button.hidden=summary.urgentCount===0 && summary.reviewCount===0;button.dataset.tone=summary.tone;
        button.textContent=summary.urgentCount?`${summary.urgentCount} required document${summary.urgentCount===1?'':'s'} need attention · Upload as soon as possible`:`${summary.reviewCount} document${summary.reviewCount===1?'':'s'} awaiting HQ review`;
    }
    async function load(force=false) {
        const id=identity();if(!id)return reset();const token=++epoch;releaseBusy();clearPhotos();status('Checking your required documents…');
        let uid;
        try {
            const client=await vault();if(!same(token,id))return;uid=privateUid();let records;
            if(client.auth && !uid)throw Error('Private document access changed. Reopen your profile when this device is signed in.');
            if(!force && cached?.id===id && cached.uid===uid && now()-loadedAt<180000)records=cached.records;else records=await client.store.records();
            if(!same(token,id,uid))return;cached={id,uid,records};loadedAt=now();
            const summary=documentSummary(records);status(summary.urgentCount?`${summary.urgentCount} required document${summary.urgentCount===1?'':'s'} need a photo.`:summary.reviewCount?'Your photos are uploaded and awaiting HQ review.':'Your required documents are complete.');
            if(el('staffDocumentCards'))el('staffDocumentCards').innerHTML=documentCards(records);
            if(records.clearance && el('staffDocumentCards'))el('staffDocumentCards').querySelector('[data-doc-clearance]')?.value && (el('staffDocumentCards').querySelector('[data-doc-clearance]').value=records.clearance.clearanceType||'NBI');
            if(el('staffDocumentDeviceRequest'))el('staffDocumentDeviceRequest').hidden=true;reminder();
        } catch(error) {
            if(!same(token,id,uid))return;cached=null;status(error.message || 'Reconnect to check your private documents.');
            if(el('staffDocumentCards'))el('staffDocumentCards').innerHTML='';if(el('staffDocumentDeviceRequest'))el('staffDocumentDeviceRequest').hidden=!error.message?.includes('approve this device');
            const button=el('staffDocumentReminder');if(button){button.hidden=false;button.dataset.tone='danger';button.textContent='Required documents · Open your profile to finish setup';}
        }
    }
    async function choose(input) {
        const group=input.dataset.docFile,file=input.files?.[0];if(!file || busy)return;
        const id=identity(),token=epoch,uid=privateUid(),sequence=(selectionEpoch.get(group)||0)+1;selectionEpoch.set(group,sequence);status('Preparing your photo…');
        const old=selected.get(group);if(old?.url){URL.revokeObjectURL(old.url);urls.delete(old.url);}selected.delete(group);
        const preview=el('staffDocumentCards').querySelector(`[data-doc-preview="${group}"]`);preview?.removeAttribute('src');if(preview)preview.hidden=true;
        el('staffDocumentCards').querySelector(`[data-doc-action="upload"][data-group="${group}"]`).disabled=true;
        try {
            const blob=await normalize(file);if(!same(token,id,uid) || selectionEpoch.get(group)!==sequence)return;
            const previous=selected.get(group);if(previous?.url){URL.revokeObjectURL(previous.url);urls.delete(previous.url);}
            const url=URL.createObjectURL(blob);urls.add(url);selected.set(group,{blob,url,operationId:crypto.randomUUID()});
            const image=el('staffDocumentCards').querySelector(`[data-doc-preview="${group}"]`);image.src=url;image.hidden=false;
            el('staffDocumentCards').querySelector(`[data-doc-action="upload"][data-group="${group}"]`).disabled=false;status('Check that every detail is readable, then select Upload photo.');
        } catch(error){if(same(token,id,uid) && selectionEpoch.get(group)===sequence)status(error.message);}finally {if(selectionEpoch.get(group)===sequence)input.value='';}
    }
    async function action(button) {
        if(busy)return;const group=button.dataset.group,type=button.dataset.docAction,id=identity(),token=epoch,uid=privateUid();
        if(!DOCUMENT_GROUPS.includes(group) || cached?.id!==id || cached.uid!==uid)return;
        const owner={token,id,uid};busyOwner=owner;busy=true;button.disabled=true;
        try {
            const client=await vault();if(!same(token,id,uid))return;
            if(type==='upload') {
                const choice=selected.get(group);if(!choice)throw Error('Choose a photo first.');
                const draft={group,clearanceType:el('staffDocumentCards').querySelector(`[data-doc-clearance="${group}"]`)?.value||'',expiresOn:el('staffDocumentCards').querySelector(`[data-doc-expiry="${group}"]`).value};
                const checked=validateDocumentDraft(draft);if(!checked.valid)throw Error(checked.errors.join(' '));
                status('Uploading your private photo…');await client.store.upload(group,choice.blob,draft,cached.records[group]?.version||0,choice.operationId);
                if(same(token,id,uid)){releaseBusy();await load(true);}
            } else if(type==='view') {
                const blob=await client.store.file(cached.records[group]);if(!same(token,id,uid) || el('profileModal').style.display==='none')return;
                const url=URL.createObjectURL(blob);urls.add(url);el('staffDocumentPreviewImage').src=url;el('staffDocumentPreviewTitle').textContent=DOCUMENT_LABELS[group];el('staffDocumentPreview').showModal();
            }
        } catch(error){if(same(token,id,uid))status(error.message||'The photo could not be saved. Reconnect and try again.');}
        finally {if(busyOwner===owner){releaseBusy();button.disabled=false;}}
    }
    el('staffDocumentCards')?.addEventListener('change',event=>{if(event.target.dataset.docFile)choose(event.target);else if(event.target.dataset.docExpiry || event.target.dataset.docClearance){const group=event.target.dataset.docExpiry||event.target.dataset.docClearance;const choice=selected.get(group);if(choice)choice.operationId=crypto.randomUUID();}});
    el('staffDocumentCards')?.addEventListener('click',event=>{const button=event.target.closest('[data-doc-action]');if(button)action(button);});
    el('staffDocumentRefresh')?.addEventListener('click',()=>load(true));el('staffDocumentReminder')?.addEventListener('click',()=>api.openProfile());
    el('staffDocumentPreviewClose')?.addEventListener('click',()=>{el('staffDocumentPreview').close();el('staffDocumentPreviewImage').removeAttribute('src');});
    el('staffDocumentDeviceRequest')?.addEventListener('click',async()=>{const id=identity(),token=epoch,uid=privateUid();try {const client=await vault();if(!same(token,id,uid))return;await client.store.requestDevice({deviceId:api.localStorage.getItem('takodeal_device_id')||'',deviceName:'Staff phone'});if(same(token,id,uid))status('Request sent. HQ can approve this phone inside your Master Employee Profile.');}catch(error){if(same(token,id,uid))status(error.message);}});
    const open=api.openProfile;api.openProfile=async function(...args){await open.apply(this,args);return load();};
    for(const name of ['checkNormalLogin','loginStaff']) {const prior=api[name];api[name]=async function(...args){const result=await prior.apply(this,args);if(identity())load();else reset();return result;};}
    const stop=api.stopStaffLiveListeners;api.stopStaffLiveListeners=function(...args){reset();return stop?.apply(this,args);};
    d.addEventListener('visibilitychange',()=>{if(d.hidden){epoch++;releaseBusy();clearPhotos();}else if(identity() && now()-loadedAt>180000)load(true);});api.addEventListener('pagehide',reset);
    api.addEventListener('storage',event=>{if(!event.key || event.key==='takodeal_staff_id')reset();});
    if(el('profileModal'))new MutationObserver(()=>{if(el('profileModal').style.display==='none'){epoch++;releaseBusy();clearPhotos();}}).observe(el('profileModal'),{attributes:true,attributeFilter:['style']});
    const timer=setInterval(reminder,60000);timer?.unref?.();api.staffDocuments={load,reset};return api.staffDocuments;
}
