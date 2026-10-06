// Registration and approval checks use bounded HTTP requests even if realtime sync stalls.
export function createDeviceConnection({projectId,apiKey,fetcher=fetch,delay=setTimeout,cancelDelay=clearTimeout,Controller=AbortController}) {
    const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    async function request(url,options) {
        const controller=new Controller(),timer=delay(()=>controller.abort(),20000);
        try {
            const response=await fetcher(url,{cache:'no-store',...options,signal:controller.signal});
            const data=await response.json();
            if(!response.ok){const error=Error(data.error?.message || 'HQ could not receive the request.');error.status=response.status;throw error;}
            return data;
        } catch(e) {
            if(e.name==='AbortError')throw Error('HQ has not confirmed the request yet. Check your connection, then retry using the same device ID.');
            throw e;
        } finally {cancelDelay(timer);}
    }
    const validID=id=>/^DEV-[A-Z0-9-]{6,50}$/.test(id);
    async function read(id) {
        if(!validID(id))throw Error('This device ID is invalid. Contact HQ.');
        try {
            const record=await request(`${root}/pos_devices/${encodeURIComponent(id)}?key=${encodeURIComponent(apiKey)}`,{method:'GET'});
            const status=record.fields?.status?.stringValue;
            if(!status)throw Error('HQ could not confirm this device status. Contact HQ with this device ID.');
            return {status,deviceName:record.fields.deviceName?.stringValue,branch:record.fields.branch?.stringValue};
        } catch(e) {if(e.status===404)return null;throw e;}
    }
    async function submit(draft) {
        if(!validID(draft.deviceId) || !draft.name?.trim() || !draft.branch)throw Error('Enter a device name and choose your branch.');
        const name=`projects/${projectId}/databases/(default)/documents/pos_devices/${draft.deviceId}`;
        const fields={deviceId:{stringValue:draft.deviceId},deviceName:{stringValue:draft.name+' (Staff)'},branch:{stringValue:draft.branch},status:{stringValue:'Pending'},appType:{stringValue:'Staff'}};
        try {
            await request(`${root}:commit?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name,fields},currentDocument:{exists:false},updateTransforms:[{fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'lastActive',setToServerValue:'REQUEST_TIME'}]}]})});
        } catch(e) {
            if(![409,400].includes(e.status))throw e;
            // A retry reads an existing record; it never overwrites HQ's approval or block.
            if(!await read(draft.deviceId))throw e;
        }
        return draft.deviceId;
    }
    return {submit,read};
}
export const createDeviceRegistration=config=>createDeviceConnection(config).submit;

export function installStaffRegistration(config) {
    const {submit,read}=createDeviceConnection(config);
    const key='takodeal_staff_registration_draft',receiptKey='takodeal_staff_registration_receipt';
    const el=id=>document.getElementById(id);
    let busy=false,unsubscribe=null,readTimer=null,epoch=0,cloudConnected=false;
    const stop=()=>{epoch++;unsubscribe?.();unsubscribe=null;clearTimeout(readTimer);};
    const saved=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
    const draft=()=>saved(key);
    function message(text){if(el('deviceRegistrationStatus'))el('deviceRegistrationStatus').textContent=text;}
    function pendingScreen(id,title,text,retry=false) {
        window.stopStaffLiveListeners?.();
        window.lockPayslipVault?.();
        for(const node of ['loginOverlay','appContainer','registerCard','deviceBlockedOverlay'])if(el(node))el(node).style.display='none';
        if(el('deviceAuthOverlay'))el('deviceAuthOverlay').style.display='flex';
        if(el('pendingCard'))el('pendingCard').style.display='block';
        if(el('devicePendingTitle'))el('devicePendingTitle').textContent=title;
        if(el('devicePendingText'))el('devicePendingText').textContent=text;
        if(el('devicePendingId'))el('devicePendingId').textContent=`Device ID: ${id}`;
        if(el('deviceRetryButton'))el('deviceRetryButton').hidden=!retry;
    }
    window.requestDeviceAccess=async function() {
        if(busy)return;
        const name=el('deviceNameInput')?.value.trim(),selected=el('deviceBranchInput')?.value;
        if(!name)return window.Swal.fire('Device name required','Give this phone a name so HQ can identify it.','warning');
        busy=true;window.staffDeviceRegistrationBusy=true;stop();
        const button=document.querySelector('#registerCard .btn-primary');
        if(button){button.disabled=true;button.textContent='Sending request…';}
        message('Connecting to HQ. Please keep this page open.');
        try {
            let branch=selected;
            if(selected==='Auto') {
                if(!navigator.geolocation)throw Error('Choose your branch manually. Location is unavailable.');
                const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,maximumAge:15000,timeout:15000}));
                window.currentLat=position.coords.latitude;window.currentLng=position.coords.longitude;branch=window.getClosestBranch();
            }
            if(!Object.prototype.hasOwnProperty.call(window.BRANCH_ZONES,branch))throw Error('Choose your branch manually and try again.');
            const registration={deviceId:draft()?.deviceId || localStorage.getItem('takodeal_device_id') || 'DEV-'+(window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)+Date.now().toString(36)).toUpperCase(),name,branch};
            localStorage.setItem(key,JSON.stringify(registration));
            await submit(registration);
            localStorage.setItem('takodeal_device_id',registration.deviceId);
            localStorage.setItem(receiptKey,JSON.stringify(registration));
            localStorage.removeItem(key);
            message('Request received by HQ. Waiting for approval.');
            return window.listenToDeviceStatus(registration.deviceId);
        } catch(e) {
            const registration=draft();
            message(registration?`Not confirmed by HQ yet. Your request is saved on this phone. Retry with ${registration.deviceId}; no duplicate request will be created.`:'Request not sent. Choose your branch manually if location is unavailable.');
            window.Swal.fire('Request not confirmed',e.message || 'Check your connection and retry.','warning');
        } finally {busy=false;window.staffDeviceRegistrationBusy=false;if(button){button.disabled=false;button.textContent='Request access';}}
    };
    window.retryDeviceRegistration=()=>{
        const registration=draft();
        if(registration){el('deviceNameInput').value=registration.name;el('deviceBranchInput').value=registration.branch;return window.requestDeviceAccess();}
        const id=localStorage.getItem('takodeal_device_id');if(id)return window.listenToDeviceStatus(id);
    };
    window.listenToDeviceStatus=function(id) {
        stop();const token=epoch;cloudConnected=false;let entered=false,revision=0,reading=false;
        pendingScreen(id,'Checking your device','Connecting to HQ to check approval.',true);
        function apply(record) {
            if(token!==epoch)return;
            if(!record) {
                stop();
                if(el('pendingCard'))el('pendingCard').style.display='none';
                if(el('registerCard'))el('registerCard').style.display='block';
                const registration=draft() || saved(receiptKey);
                if(registration?.deviceId===id){el('deviceNameInput').value=registration.name;el('deviceBranchInput').value=registration.branch;}
                // Keep the original ID when an older app saved it before HQ received the write.
                message(`HQ has not received this phone yet. Enter its name and branch, then request access again. Device ID: ${id}.`);
                return;
            }
            const status=record.status;
            if(status==='Active' || status==='Approved') {
                if(el('deviceAuthOverlay'))el('deviceAuthOverlay').style.display='none';
                if(!entered){entered=true;window.checkNormalLogin();window.listenToIncomingSwaps();}
            } else {
                entered=false;
                pendingScreen(id,status==='Pending'?'Request received by HQ':'Device access paused',status==='Pending'?'Your request is in the Manager’s Device Fleet. Ask HQ to approve this device.':'HQ approval is required before you can sign in.',true);
            }
        }
        async function checkHQ() {
            if(reading)return;
            reading=true;const readRevision=revision;
            try {
                const record=await read(id);
                if(token!==epoch || cloudConnected || readRevision!==revision)return;
                apply(record);
            } catch(e) {
                if(token===epoch && !cloudConnected && readRevision===revision)pendingScreen(id,'Connection to HQ delayed',e.message || 'Check your connection and tap Check again. Your device ID is preserved.',true);
            } finally {
                reading=false;
                if(token===epoch && !cloudConnected && !document.hidden)readTimer=setTimeout(checkHQ,30000);
            }
        }
        const checking=checkHQ();
        unsubscribe=window.onSnapshot(window.doc(window.db,'pos_devices',id),{includeMetadataChanges:true},snapshot=>{
            if(token!==epoch)return;
            if(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
                if(cloudConnected){cloudConnected=false;clearTimeout(readTimer);readTimer=setTimeout(checkHQ,5000);}
                return;
            }
            revision++;cloudConnected=true;clearTimeout(readTimer);apply(snapshot.exists()?snapshot.data():null);
        },()=>{if(token===epoch){cloudConnected=false;clearTimeout(readTimer);readTimer=setTimeout(checkHQ,0);}});
        return checking;
    };
    document.addEventListener('DOMContentLoaded',()=>{
        const registration=draft();
        if(registration && !localStorage.getItem('takodeal_device_id')){el('deviceNameInput').value=registration.name;el('deviceBranchInput').value=registration.branch;message(`Request not confirmed yet. Tap Request access to retry ${registration.deviceId}.`);}
    });
    window.addEventListener('online',()=>{if(draft())window.retryDeviceRegistration();else{const id=localStorage.getItem('takodeal_device_id');if(id)window.listenToDeviceStatus(id);}});
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden)stop();else if(!busy){const id=localStorage.getItem('takodeal_device_id');if(id)window.listenToDeviceStatus(id);}
    });
    window.addEventListener('pagehide',stop);
}
