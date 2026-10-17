import {POS_SETTINGS_POLICY_ID,posSettingsPolicy,hqPOSAccess,canUsePOSSetting,activePOSStaff,settingsApprovalFingerprint} from './pos-settings-model.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {installParkedRecovery} from './pos-parked-recovery.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bindings={toggleAuditMode:'audit',toggleKDS:'kds',kickCashDrawer:'manualDrawer',setAutoDrawer:'autoDrawer',
    parkOrder:'parkedOrders',parkOrderToDB:'parkedOrders',showParkedOrders:'parkedOrders',resumeOrder:'parkedOrders',printParkedReceipt:'parkedOrders',deleteParkedOrderManually:'parkedOrders',discardParkedOrder:'parkedOrders',deleteParkedOrder:'parkedOrders',
    openPrinterManager:'printerTools',setPrinterMode:'printerTools',setReceiptLogoMode:'printerTools',connectSpecificPrinter:'printerTools',testPrinterLogo:'printerTools',testPrint:'printerTools'};
export function installPOSSettingsHub(w,d,{primaryAuth,approveHQ,getApprovalUser,getApprovalAPI,now=Date.now,timeoutMs=25000}={}) {
    if(w.posSettingsHub)return w.posSettingsHub;
    let policy=null,staff=null,hq=null,approval=null,confirmation=null,epoch=0,busy=false,nextSession=0;
    const sessions=new WeakMap(),runs=new Map(),lockedActions=new Set(),pending=new Map();
    const sessionKey=()=>{const s=w.sessionUser;if(s&&!sessions.has(s))sessions.set(s,++nextSession);return JSON.stringify([primaryAuth?.currentUser?.uid,s&&sessions.get(s),s?.staffId,s?.cashierName,s?.branch,w.localStorage.getItem('takodeal_device_branch'),w.localStorage.getItem('takodeal_device_id')]);};
    const branch=()=>w.localStorage.getItem('takodeal_device_branch')||w.sessionUser?.branch||'';
    const notice=message=>{const el=d.getElementById('posSettingsStatus');if(el)el.textContent=message;};
    const message=error=>w.Swal?.fire?.('POS Settings',error.message||String(error),'info');
    async function read(api,reference,collection=false,queryKey='') {
        const key=JSON.stringify([sessionKey(),getApprovalUser?.()?.uid,queryKey||reference.path||'']);let physical=key&&pending.get(key),timer;
        if(!physical){try{physical=Promise.resolve((collection?api.getDocsFromServer:api.getDocFromServer)(reference));}catch(error){physical=Promise.reject(error);}if(key){pending.set(key,physical);physical.finally(()=>{if(pending.get(key)===physical)pending.delete(key);}).catch(()=>{});}}
        let result;try{result=await Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ, then refresh POS Settings to confirm access.')),timeoutMs);})]);}finally{clearTimeout(timer);}
        if(result.metadata?.fromCache || result.metadata?.hasPendingWrites)throw Error('Connect to HQ to confirm POS access.');
        return result;
    }
    async function loadStaff(key) {
        const s=w.sessionUser;if(!s?.cashierName)throw Error('Sign in to this branch before using POS tools.');
        if(!branch()||s.branch!==branch())throw Error('The signed-in cashier does not match this device’s branch. Sign in again.');
        const binding=primaryAuth?.currentUser?.uid?await read(w,w.doc(w.db,'pos_bindings',primaryAuth.currentUser.uid)):null;
        if(binding?.exists()){
            const device=binding.data();if(device.status!=='Active'||device.branch!==branch()||device.deviceId!==w.localStorage.getItem('takodeal_device_id'))throw Error('This device needs Owner approval for the selected branch.');
        }else{
            const deviceId=w.localStorage.getItem('takodeal_device_id');if(!deviceId)throw Error('Register this device before using POS controls.');
            const devices=await read(w,w.query(w.collection(w.db,'pos_devices'),w.where('deviceId','==',deviceId)),true,'device:'+deviceId);
            if(devices.docs.length!==1||devices.docs[0].data().status!=='Active'||devices.docs[0].data().branch!==branch())throw Error('This device needs Owner approval for the selected branch.');
        }
        let rows;
        if(s.staffId){const snap=await read(w,w.doc(w.db,'cashiers',s.staffId));rows=snap.exists()?[{...snap.data(),staffId:snap.id}]:[];}
        else {const snap=await read(w,w.query(w.collection(w.db,'cashiers'),w.where('cashierName','==',s.cashierName)),true,'staff:'+s.cashierName);rows=snap.docs.map(doc=>({...doc.data(),staffId:doc.id}));}
        const result=rows.length===1?activePOSStaff(rows[0],s):null;
        if(key!==sessionKey()||!result)throw Error('Your staff account changed. Sign in again before using POS tools.');
        return result;
    }
    async function loadPolicy(key) {
        const snap=await read(w,w.doc(w.db,'offline_policy',POS_SETTINGS_POLICY_ID));
        if(key!==sessionKey())throw Error('The branch or signed-in cashier changed. Reopen Settings.');
        return posSettingsPolicy(snap.exists()?snap.data().posSettings:null);
    }
    async function freshHQ(key) {
        if(!approval||now()>=approval.expires||approval.sessionKey!==key){approval=null;hq=null;return null;}
        const proof=approval;
        try {
        const user=getApprovalUser?.(),api=getApprovalAPI?.();
        if(!user||user.uid!==proof.uid||String(user.email).toLowerCase()!==proof.email){approval=null;hq=null;return null;}
        const snap=await read(api,api.query(api.collection(api.db,'hq_managers'),api.where('email','==',user.email)),true,'hq:'+user.email);
        const account=resolveHQAccount(snap.docs.map(doc=>({id:doc.id,data:doc.data()})));
        let grant=null;
        if(proof.email!=='jgo031996@gmail.com'){const gs=await read(api,api.doc(api.db,'hq_email_access',proof.email));grant=gs.exists()?gs.data():null;}
        const credential=await pinFingerprint(account,user);
        if(approval!==proof||key!==sessionKey()||getApprovalUser()?.uid!==user.uid||String(getApprovalUser()?.email).toLowerCase()!==proof.email||settingsApprovalFingerprint(account)!==proof.fingerprint||credential!==proof.credential)throw Error('HQ access changed. Unlock the approved account again.');
        const result=hqPOSAccess(user,account,grant,branch());
        if(!result)throw Error('This approved account cannot manage the selected branch.');
        return result;
        } catch(error) {if(approval===proof){approval=null;hq=null;notice('Manager controls locked. Unlock the approved account again.');}return null;}
    }
    async function pinFingerprint(account,user){
        const bytes=new TextEncoder().encode(JSON.stringify([user.uid,String(user.email).toLowerCase(),savedPin(account)]));
        const digest=await (w.crypto||globalThis.crypto).subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    async function authorize(action) {
        const key=sessionKey(),generation=epoch;
        let checkedStaff,checkedPolicy;
        try{checkedStaff=await loadStaff(key);checkedPolicy=await loadPolicy(key);}catch(error){if(generation===epoch&&key===sessionKey()){policy=null;staff=null;approval=null;hq=null;confirmation=null;paint();}throw error;}
        const checkedHQ=await freshHQ(key);
        if(key!==sessionKey()||generation!==epoch)throw Error('POS access changed. Reopen Settings and try again.');
        staff=checkedStaff;policy=checkedPolicy;hq=checkedHQ;
        const assertCurrent=()=>{if(key!==sessionKey()||generation!==epoch||!policy||approval&&(now()>=approval.expires||getApprovalUser()?.uid!==approval.uid||String(getApprovalUser()?.email).toLowerCase()!==approval.email))throw Error('POS access changed. Reopen Settings and try again.');};
        assertCurrent();
        if(!canUsePOSSetting(action,{policy,staff,hq}))throw Error('An approved Manager or Owner must unlock this control for your branch.');
        return {assertCurrent,branch:branch(),actor:hq?.email||staff.name,manageRecovery:hq?.kind==='owner'||hq?.kind==='manager'&&(hq.permissions.includes('posconfig')||hq.permissions.includes('all'))};
    }
    async function unlock() {
        if(busy)return;busy=true;const key=sessionKey(),generation=epoch;
        try {
            if(!w.sessionUser)throw Error('Sign in as the cashier before unlocking branch controls.');
            await approveHQ();const user=getApprovalUser(),api=getApprovalAPI();
            const snapshot=await read(api,api.query(api.collection(api.db,'hq_managers'),api.where('email','==',user.email)),true,'hq:'+user.email);
            const account=resolveHQAccount(snapshot.docs.map(doc=>({id:doc.id,data:doc.data()})));
            let grant=null;if(String(user.email).toLowerCase()!=='jgo031996@gmail.com'){const gs=await read(api,api.doc(api.db,'hq_email_access',String(user.email).toLowerCase()));grant=gs.exists()?gs.data():null;}
            const access=hqPOSAccess(user,account,grant,branch());if(!access)throw Error('This account has no saved settings access for this branch.');
            const pin=savedPin(account);if(!pin)throw Error('Set this account’s security PIN in the Owner app first.');
            const result=await w.Swal.fire({titleText:'Unlock branch controls',text:user.email,input:'password',inputLabel:'HQ security PIN',inputAttributes:{autocomplete:'off'},showCancelButton:true,confirmButtonText:'Unlock',preConfirm:value=>{if(String(value)!==pin){w.Swal.showValidationMessage('The security PIN does not match this account.');return false;}return true;}});
            if(!result.isConfirmed)return;
            const credential=await pinFingerprint(account,user);
            if(key!==sessionKey()||generation!==epoch||getApprovalUser()?.uid!==user.uid)throw Error('The signed-in cashier or branch changed. Unlock again.');
            approval={uid:user.uid,email:String(user.email).toLowerCase(),sessionKey:key,fingerprint:settingsApprovalFingerprint(account),credential,expires:now()+10*60000};
            await refresh();
        }catch(error){approval=null;hq=null;message(error);paint();}finally{busy=false;}
    }
    function lock(){epoch++;approval=null;hq=null;confirmation=null;paint();notice('Manager controls locked. Staff tools remain available.');}
    async function refresh(){const generation=++epoch,key=sessionKey();confirmation=null;notice('Confirming saved branch access…');
        try{const checkedStaff=await loadStaff(key),checkedPolicy=await loadPolicy(key),checkedHQ=await freshHQ(key);if(generation!==epoch||key!==sessionKey())return;staff=checkedStaff;policy=checkedPolicy;hq=checkedHQ;confirmation={key,epoch:generation,at:now()};paint();notice(hq?'Branch controls unlocked for '+hq.email+' · expires in 10 minutes.':'Staff tools ready. Unlock an approved HQ account to change branch controls.');}
        catch(error){if(generation!==epoch)return;policy=null;staff=null;approval=null;hq=null;confirmation=null;paint();notice(error.message);}}
    function paint(){const view=d.getElementById('view-settings');if(!view)return;
        for(const button of view.querySelectorAll('[data-pos-action]'))button.disabled=!policy||!canUsePOSSetting(button.dataset.posAction,{policy,staff,hq});
        const printer=d.getElementById('view-printer');if(printer)for(const control of printer.querySelectorAll('button,input,select,textarea'))control.disabled=!policy||!canUsePOSSetting('printerTools',{policy,staff,hq});
        const info=d.getElementById('posSettingsDevice');if(info)info.textContent=(w.localStorage.getItem('takodeal_device_name')||'This device')+' · '+(branch()||'Branch not selected');
        const audit=d.getElementById('posAuditState');if(audit)audit.textContent=w.isAuditModeActive?'Inventory deductions paused':'Inventory deductions active';
        const kds=d.getElementById('posKdsState');if(kds)kds.textContent=w.isKdsEnabled?'Kitchen tracking on':'Kitchen tracking off';
        const drawer=d.getElementById('posDrawerState');if(drawer)drawer.textContent=w.localStorage.getItem('takodeal_auto_drawer')==='false'?'Automatic drawer opening off':'Automatic drawer opening on';
    }
    w.setAutoDrawer=function(value){if(typeof value!=='boolean')throw Error('Choose a valid drawer setting.');w.localStorage.setItem('takodeal_auto_drawer',String(value));};
    for(const [name,action] of Object.entries(bindings)){const original=w[name];if(typeof original!=='function')continue;
        if(name==='connectSpecificPrinter'){
            // Bluetooth's chooser must retain the click's browser activation.
            w[name]=function(...args){
                const proof=confirmation;
                const assertChooser=()=>{if(!proof||confirmation!==proof||proof.key!==sessionKey()||proof.epoch!==epoch||now()-proof.at>60000||now()<proof.at||approval&&(now()>=approval.expires||getApprovalUser()?.uid!==approval.uid||String(getApprovalUser()?.email).toLowerCase()!==approval.email)||!policy||!canUsePOSSetting('printerTools',{policy,staff,hq})){const error=Error('Refresh access in POS Settings, then tap Connect printer again.');error.code='pos-settings-access-changed';throw error;}};
                try{assertChooser();return original.call(this,args[0],{...(args[1]||{}),assertCurrent:assertChooser});}catch(error){message(error);return false;}
            };
            continue;
        }
        w[name]=async function(...args){
            const preference=['setAutoDrawer','setPrinterMode','setReceiptLogoMode','toggleKDS'].includes(name),run=(runs.get(name)||0)+1;runs.set(name,run);
            if(!preference&&lockedActions.has(name))return false;
            if(!preference)lockedActions.add(name);
            try{const permit=await authorize(action);permit.assertCurrent();if(preference&&runs.get(name)!==run)return false;
                if(['resumeOrder','printParkedReceipt','deleteParkedOrderManually','discardParkedOrder','deleteParkedOrder'].includes(name)){
                    const snap=await read(w,w.doc(w.db,'parked_orders',args[0]));permit.assertCurrent();
                    if(!snap.exists()||snap.data().branch!==permit.branch)throw Error('This parked order belongs to another branch or is no longer available.');
                    permit.parkedOrder={...snap.data(),id:snap.id};
                }
                if(name==='parkOrderToDB'&&args[0]?.branch!==permit.branch)throw Error('The order no longer matches this device’s branch.');
                const forwarded=['toggleAuditMode','showParkedOrders','parkOrder'].includes(name)?[permit]:['resumeOrder','printParkedReceipt','deleteParkedOrderManually'].includes(name)?[args[0],permit]:name==='discardParkedOrder'?[...args.slice(0,4),permit.assertCurrent]:['deleteParkedOrder','parkOrderToDB'].includes(name)?[args[0],permit.assertCurrent]:args;
                const result=await original.apply(this,forwarded);permit.assertCurrent();paint();return result;}
            catch(error){message(error);paint();return false;}finally{lockedActions.delete(name);}
        };}
    // Receipt printing and sale-triggered drawer commands keep their existing pipeline.
    w.authorizePOSSetting=authorize;
    w.confirmPOSStaffSession=async()=>{const key=sessionKey(),result=await loadStaff(key);if(key!==sessionKey())throw Error('The signed-in cashier changed.');return result;};
    installParkedRecovery(w,d,{primaryAuth,now,timeoutMs});
    function open(section='operations'){const view=d.getElementById('view-settings');if(!view)return;
        w.switchView('settings');d.getElementById('topBarTitle').textContent='POS Settings';
        const activeNav=d.getElementById('nav-printer');activeNav?.classList.add('active');activeNav?.setAttribute('aria-current','true');
        const lockout=d.getElementById('globalShiftLockout');if(lockout)lockout.style.display='none';
        const printer=d.getElementById('view-printer');if(printer&&section==='printers'){printer.classList.remove('view-container');printer.style.display='block';d.getElementById('posSettingsPrinters').append(printer);}else if(printer)printer.style.display='none';
        for(const panel of view.querySelectorAll('[data-pos-section]'))panel.hidden=panel.dataset.posSection!==section;
        for(const tab of view.querySelectorAll('[data-pos-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.posTab===section));
        refresh();
    }
    const view=d.createElement('section');view.id='view-settings';view.className='view-container cashier-page pos-settings-page';
    view.innerHTML='<header class="cashier-page-heading"><h1>POS Settings</h1><p>Manage this branch’s tools without leaving your current order.</p></header><div class="pos-settings-summary"><strong id="posSettingsDevice"></strong><span id="posSettingsStatus" role="status">Open Settings to confirm access.</span><button type="button" id="posSettingsRefresh">Refresh access</button></div><div class="pos-settings-tabs" role="tablist"><button role="tab" data-pos-tab="operations">Operations</button><button role="tab" data-pos-tab="printers">Printers & receipts</button><button role="tab" data-pos-tab="access">Access</button></div><div data-pos-section="operations" class="pos-settings-grid"><article><h2>Parked orders</h2><p>Review unpaid orders, resume a cart or reprint its ticket.</p><button data-pos-action="parkedOrders" id="posParkedOpen">View parked orders <span id="posSettingsParkedCount"></span></button></article><article><h2>Inventory audit</h2><p id="posAuditState"></p><p>Pause deductions during a count. Recorded sales are recovered when you resume.</p><button data-pos-action="audit" id="posAuditToggle">Pause / resume inventory</button></article><article><h2>Kitchen tracking</h2><p id="posKdsState"></p><p>Show preparation progress on this device’s sales view.</p><button data-pos-action="kds" id="posKdsToggle">Change tracking</button></article><article><h2>Cash drawer</h2><p id="posDrawerState"></p><div class="pos-settings-actions"><button data-pos-action="autoDrawer" id="posAutoDrawerToggle">Change automatic opening</button><button data-pos-action="manualDrawer" id="posDrawerOpen">Open drawer</button></div></article></div><div data-pos-section="printers" id="posSettingsPrinters" hidden></div><div data-pos-section="access" class="pos-settings-access" hidden><article><h2>Branch control access</h2><p>Staff use the tools approved by the Owner. Managers must use their approved Google account and HQ PIN before changing branch controls.</p><p>Unlocking here leaves the cashier, cart and shift in place.</p><div class="pos-settings-actions"><button id="posSettingsUnlock">Unlock Manager / Owner controls</button><button id="posSettingsLock">Lock controls</button><a href="https://takodeal-owner.vercel.app/" target="_blank" rel="noopener">Owner policy settings</a></div></article></div>';
    d.querySelector('.content-area').append(view);
    view.querySelectorAll('[data-pos-tab]').forEach(tab=>tab.onclick=()=>open(tab.dataset.posTab));
    const handlers={posSettingsRefresh:refresh,posSettingsUnlock:unlock,posSettingsLock:lock,posParkedOpen:()=>w.showParkedOrders(),posAuditToggle:()=>w.toggleAuditMode(),posKdsToggle:()=>w.toggleKDS(),posAutoDrawerToggle:()=>w.setAutoDrawer(w.localStorage.getItem('takodeal_auto_drawer')==='false'),posDrawerOpen:()=>w.kickCashDrawer()};
    for(const [id,handler] of Object.entries(handlers))d.getElementById(id).onclick=handler;
    const dropdown=d.getElementById('posSettingsDropdown');if(dropdown){dropdown.style.display='none';dropdown.setAttribute('aria-hidden','true');}
    const top=d.getElementById('posSettingsButton');if(top)top.onclick=()=>open();
    const nav=d.getElementById('nav-printer');if(nav){nav.onclick=()=>open();const title=nav.querySelector('.nav-item-text');if(title)title.textContent='Settings';}
    const printerOpen=w.openPrinterManager;w.openPrinterManager=async()=>{await printerOpen?.();open('printers');};
    w.openPOSSettings=open;
    d.addEventListener('cashier-printer-state',paint);w.addEventListener?.('storage',event=>{if(['takodeal_device_branch','takodeal_device_id'].includes(event.key)){lock();policy=null;staff=null;paint();}});
    paint();w.posSettingsHub={open,refresh,unlock,lock,authorize};return w.posSettingsHub;
}
