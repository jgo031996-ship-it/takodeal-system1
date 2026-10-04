// Create-only registration over a bounded HTTP request. A retry must never reset HQ approval.
export function createDeviceRegistration({projectId,apiKey,fetcher = fetch,delay = setTimeout,cancelDelay = clearTimeout,Controller = AbortController}) {
    const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    async function request(url, options) {
        const controller = new Controller();
        const timer = delay(() => controller.abort(),20000);
        try {
            const response = await fetcher(url,{...options,signal:controller.signal});
            const data = await response.json();
            if (!response.ok) { const error = Error(data.error?.message || 'HQ could not receive the request.'); error.status=response.status; throw error; }
            return data;
        } catch(e) { if (e.name === 'AbortError') throw Error('HQ has not confirmed the request yet. Check your connection, then retry using the same device ID.'); throw e; }
        finally { cancelDelay(timer); }
    }
    return async draft => {
        if (!/^DEV-[A-Z0-9-]{6,50}$/.test(draft.deviceId) || !draft.name?.trim() || !draft.branch) throw Error('Enter a device name and choose your branch.');
        const name = `projects/${projectId}/databases/(default)/documents/pos_devices/${draft.deviceId}`;
        const fields = {deviceId:{stringValue:draft.deviceId},deviceName:{stringValue:draft.name+' (Staff)'},branch:{stringValue:draft.branch},status:{stringValue:'Pending'},appType:{stringValue:'Staff'}};
        try {
            await request(`${root}:commit?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name,fields},currentDocument:{exists:false},updateTransforms:[{fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'lastActive',setToServerValue:'REQUEST_TIME'}]}]})});
        } catch(e) {
            if (![409,400].includes(e.status)) throw e;
            // A lost response or a second tap may follow a successful create. Read, never overwrite.
            const existing = await request(`${root}/pos_devices/${encodeURIComponent(draft.deviceId)}?key=${encodeURIComponent(apiKey)}`,{method:'GET'});
            if (existing.fields?.deviceId?.stringValue !== draft.deviceId) throw e;
        }
        return draft.deviceId;
    };
}

export function installStaffRegistration(config) {
    const submit = createDeviceRegistration(config), key = 'takodeal_staff_registration_draft';
    const el = id => document.getElementById(id);
    let busy = false, unsubscribe = null, readTimer = null;
    function message(text) { const node=el('deviceRegistrationStatus'); if(node) node.textContent=text; }
    function draft() { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
    const pendingScreen = (id,title,text,retry=false) => {
        window.lockPayslipVault?.();
        for(const node of ['loginOverlay','appContainer','registerCard']) if(el(node)) el(node).style.display='none';
        if(el('deviceBlockedOverlay')) el('deviceBlockedOverlay').style.display='none';
        if(el('deviceAuthOverlay')) el('deviceAuthOverlay').style.display='flex';
        if(el('pendingCard')) el('pendingCard').style.display='block';
        if(el('devicePendingTitle')) el('devicePendingTitle').textContent=title;
        if(el('devicePendingText')) el('devicePendingText').textContent=text;
        if(el('devicePendingId')) el('devicePendingId').textContent=`Device ID: ${id}`;
        if(el('deviceRetryButton')) el('deviceRetryButton').hidden=!retry;
    };
    window.requestDeviceAccess = async function() {
        if (busy) return;
        const name=el('deviceNameInput')?.value.trim(), selected=el('deviceBranchInput')?.value;
        if (!name) return window.Swal.fire('Device name required','Give this phone a name so HQ can identify it.','warning');
        busy=true;
        const button=document.querySelector('#registerCard .btn-primary');
        if(button){button.disabled=true;button.textContent='Sending request…';}
        message('Connecting to HQ. Please keep this page open.');
        try {
            let branch=selected;
            if(selected==='Auto') {
                if(!navigator.geolocation) throw Error('Choose your branch manually. Location is unavailable.');
                const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,maximumAge:15000,timeout:15000}));
                window.currentLat=position.coords.latitude;window.currentLng=position.coords.longitude;
                branch=window.getClosestBranch();
            }
            if(!Object.prototype.hasOwnProperty.call(window.BRANCH_ZONES,branch)) throw Error('Choose your branch manually and try again.');
            const saved=draft();
            const registration=saved || {deviceId:localStorage.getItem('takodeal_device_id') || 'DEV-'+(window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)+Date.now().toString(36)).toUpperCase(),name,branch};
            localStorage.setItem(key,JSON.stringify(registration));
            await submit(registration);
            localStorage.setItem('takodeal_device_id',registration.deviceId);
            localStorage.removeItem(key);
            message('Request received by HQ. Waiting for approval.');
            window.listenToDeviceStatus(registration.deviceId);
        } catch(e) {
            const saved=draft();
            message(saved ? `Not confirmed by HQ yet. Your request is saved on this phone. Retry with ${saved.deviceId}; no duplicate request will be created.` : 'Request not sent. Choose your branch manually if location is unavailable.');
            window.Swal.fire('Request not confirmed',e.message || 'Check your connection and retry.','warning');
        } finally { busy=false; if(button){button.disabled=false;button.textContent='Request access';} }
    };
    window.retryDeviceRegistration = () => {
        const saved=draft();
        if(saved) {el('deviceNameInput').value=saved.name;el('deviceBranchInput').value=saved.branch; return window.requestDeviceAccess();}
        const id=localStorage.getItem('takodeal_device_id'); if(id) window.listenToDeviceStatus(id);
    };
    window.listenToDeviceStatus = function(id) {
        unsubscribe?.();clearTimeout(readTimer);
        pendingScreen(id,'Checking your device','Connecting to HQ to check approval.',true);
        readTimer=setTimeout(()=>pendingScreen(id,'Connection to HQ delayed','Check your internet connection and tap Check again. Your device ID is preserved.',true),20000);
        unsubscribe=window.onSnapshot(window.doc(window.db,'pos_devices',id),{includeMetadataChanges:true},snapshot=>{
            if(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
                pendingScreen(id,'Waiting for cloud confirmation','Your phone is reconnecting to HQ. A locally saved request is not an approval.',true);
                return;
            }
            clearTimeout(readTimer);
            if(!snapshot.exists()) {
                localStorage.removeItem('takodeal_device_id');unsubscribe?.();unsubscribe=null;
                if(el('pendingCard'))el('pendingCard').style.display='none';
                if(el('registerCard'))el('registerCard').style.display='block';
                const saved=draft(); if(saved){el('deviceNameInput').value=saved.name;el('deviceBranchInput').value=saved.branch;}
                message('This phone is not registered with HQ yet. Submit or retry your request.');return;
            }
            const status=snapshot.data().status;
            if(status==='Active' || status==='Approved') {
                if(el('deviceAuthOverlay'))el('deviceAuthOverlay').style.display='none';
                window.checkNormalLogin();window.listenToIncomingSwaps();
            } else pendingScreen(id,status==='Pending'?'Request received by HQ':'Device access paused',status==='Pending'?'HQ can now review this phone in Device Fleet. This page updates automatically after approval.':'Contact HQ to review this phone in Device Fleet.',true);
        },error=>{clearTimeout(readTimer);pendingScreen(id,'Cannot check approval',error.code==='permission-denied'?'HQ access could not be checked. Contact HQ with this device ID.':'Connection to HQ was interrupted. Check your internet and try again.',true);});
    };
    document.addEventListener('DOMContentLoaded',()=>{
        const saved=draft();
        if(saved && !localStorage.getItem('takodeal_device_id')) {el('deviceNameInput').value=saved.name;el('deviceBranchInput').value=saved.branch;message(`Request not confirmed yet. Tap Request access to retry ${saved.deviceId}.`);}
    });
    window.addEventListener('online',()=>{const saved=draft();if(saved) window.retryDeviceRegistration();});
}
