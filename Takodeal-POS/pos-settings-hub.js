import {activePOSStaff} from './pos-settings-model.js';
import {installParkedRecovery} from './pos-parked-recovery.js';
const bindings={toggleAuditMode:'audit',toggleKDS:'kds',kickCashDrawer:'manualDrawer',setAutoDrawer:'autoDrawer',
    parkOrder:'parkedOrders',parkOrderToDB:'parkedOrders',showParkedOrders:'parkedOrders',resumeOrder:'parkedOrders',printParkedReceipt:'parkedOrders',deleteParkedOrderManually:'parkedOrders',discardParkedOrder:'parkedOrders',deleteParkedOrder:'parkedOrders',
    openPrinterManager:'printerTools',setPrinterMode:'printerTools',setReceiptLogoMode:'printerTools',connectSpecificPrinter:'printerTools',testPrinterLogo:'printerTools',testPrint:'printerTools'};
export function installPOSSettingsHub(w,d,{primaryAuth,now=Date.now,timeoutMs=25000}={}) {
    if(w.posSettingsHub)return w.posSettingsHub;
    let epoch=0,nextSession=0;
    const sessions=new WeakMap(),runs=new Map(),lockedActions=new Set(),pending=new Map();
    const branch=()=>w.localStorage.getItem('takodeal_device_branch')||'';
    const sessionKey=()=>{const s=w.sessionUser;if(s&&!sessions.has(s))sessions.set(s,++nextSession);return JSON.stringify([primaryAuth?.currentUser?.uid,s&&sessions.get(s),s?.staffId,s?.cashierName,s?.branch,branch(),w.localStorage.getItem('takodeal_device_id')]);};
    const notice=message=>{const el=d.getElementById('posSettingsStatus');if(el)el.textContent=message;};
    const message=error=>w.Swal?.fire?.('POS Settings',error.message||String(error),'info');
    function checkSession(){const s=w.sessionUser;if(!s||!String(s.cashierName||'').trim()||!branch()||s.branch!==branch())throw Error('Sign in to the Cashier app for the selected branch before using Settings.');return s;}
    function authorize(){const key=sessionKey(),generation=epoch,s=checkSession();
        const assertCurrent=()=>{checkSession();if(key!==sessionKey()||generation!==epoch)throw Error('The signed-in cashier or branch changed. Reopen Settings before continuing.');};
        return {assertCurrent,branch:branch(),actor:s.cashierName,manageRecovery:false};
    }
    // Saved order/leave details still require a confirmed read. Local device
    // preferences and Bluetooth's chooser do not depend on this cloud helper.
    async function read(api,reference,collection=false,queryKey='') {
        const key=JSON.stringify([sessionKey(),queryKey||reference.path||'']);let physical=pending.get(key),timer;
        if(!physical){try{physical=Promise.resolve((collection?api.getDocsFromServer:api.getDocFromServer)(reference));}catch(error){physical=Promise.reject(error);}pending.set(key,physical);physical.finally(()=>{if(pending.get(key)===physical)pending.delete(key);}).catch(()=>{});}
        let result;try{result=await Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ, then retry loading the saved order or staff details.')),timeoutMs);})]);}finally{clearTimeout(timer);}
        if(result.metadata?.fromCache||result.metadata?.hasPendingWrites||(result.docs||[]).some(row=>row.metadata?.hasPendingWrites||row.metadata?.fromCache))throw Error('Connect to HQ to confirm the saved order or staff details.');
        return result;
    }
    async function confirmStaff(){const permit=authorize(),s=w.sessionUser;let rows;
        if(s.staffId){const snap=await read(w,w.doc(w.db,'cashiers',s.staffId));rows=snap.exists()?[{...snap.data(),staffId:snap.id}]:[];}
        else {const snap=await read(w,w.query(w.collection(w.db,'cashiers'),w.where('cashierName','==',s.cashierName)),true,'staff:'+s.cashierName);rows=snap.docs.map(doc=>({...doc.data(),staffId:doc.id}));}
        permit.assertCurrent();const staff=rows.length===1?activePOSStaff(rows[0],s):null;if(!staff)throw Error('Your saved staff account changed. Sign in again before updating leave requests.');return staff;
    }
    function refresh(){try{checkSession();paint();notice('Settings ready for '+w.sessionUser.cashierName+' · '+branch()+'.');return true;}catch(error){paint();notice(error.message);return false;}}
    function paint(){const view=d.getElementById('view-settings');if(!view)return;let ready=false;try{checkSession();ready=true;}catch{}
        for(const button of view.querySelectorAll('[data-pos-action]'))button.disabled=!ready;
        const printer=d.getElementById('view-printer');if(printer)for(const control of printer.querySelectorAll('button,input,select,textarea'))control.disabled=!ready;
        const info=d.getElementById('posSettingsDevice');if(info)info.textContent=(w.localStorage.getItem('takodeal_device_name')||'This device')+' · '+(branch()||'Branch not selected');
        const audit=d.getElementById('posAuditState');if(audit)audit.textContent=w.isAuditModeActive?'Inventory deductions paused':'Inventory deductions active';
        const kds=d.getElementById('posKdsState');if(kds)kds.textContent=w.isKdsEnabled?'Kitchen tracking on':'Kitchen tracking off';
        const drawer=d.getElementById('posDrawerState');if(drawer)drawer.textContent=w.localStorage.getItem('takodeal_auto_drawer')==='false'?'Automatic drawer opening off':'Automatic drawer opening on';
    }
    w.setAutoDrawer=function(value){if(typeof value!=='boolean')throw Error('Choose a valid drawer setting.');w.localStorage.setItem('takodeal_auto_drawer',String(value));};
    for(const [name,action] of Object.entries(bindings)){const original=w[name];if(typeof original!=='function')continue;
        if(name==='connectSpecificPrinter'){
            // Invoke synchronously from the click, retaining browser activation.
            w[name]=function(...args){try{const permit=authorize(action);const assertChooser=()=>{try{permit.assertCurrent();}catch(error){error.code='pos-settings-access-changed';throw error;}};assertChooser();return original.call(this,args[0],{...(args[1]||{}),assertCurrent:assertChooser});}catch(error){message(error);return false;}};
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
    w.confirmPOSStaffSession=confirmStaff;
    installParkedRecovery(w,d,{primaryAuth,now,timeoutMs});
    function open(section='operations'){section=section==='printers'?'printers':'operations';const view=d.getElementById('view-settings');if(!view)return;
        w.switchView('settings');d.getElementById('topBarTitle').textContent='POS Settings';
        const activeNav=d.getElementById('nav-printer');activeNav?.classList.add('active');activeNav?.setAttribute('aria-current','true');
        const lockout=d.getElementById('globalShiftLockout');if(lockout)lockout.style.display='none';
        const printer=d.getElementById('view-printer');if(printer&&section==='printers'){printer.classList.remove('view-container');printer.style.display='block';d.getElementById('posSettingsPrinters').append(printer);}else if(printer)printer.style.display='none';
        for(const panel of view.querySelectorAll('[data-pos-section]'))panel.hidden=panel.dataset.posSection!==section;
        for(const tab of view.querySelectorAll('[data-pos-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.posTab===section));
        refresh();
    }
    const view=d.createElement('section');view.id='view-settings';view.className='view-container cashier-page pos-settings-page';
    view.innerHTML='<header class="cashier-page-heading"><h1>POS Settings</h1><p>Manage this branch’s tools without leaving your current order.</p></header><div class="pos-settings-summary"><strong id="posSettingsDevice"></strong><span id="posSettingsStatus" role="status">Settings ready for the signed-in cashier.</span><button type="button" id="posSettingsRefresh">Refresh</button></div><div class="pos-settings-tabs" role="tablist"><button role="tab" data-pos-tab="operations">Operations</button><button role="tab" data-pos-tab="printers">Printers & receipts</button></div><div data-pos-section="operations" class="pos-settings-grid"><article><h2>Parked orders</h2><p>Review unpaid orders, resume a cart or reprint its ticket.</p><button data-pos-action="parkedOrders" id="posParkedOpen">View parked orders <span id="posSettingsParkedCount"></span></button></article><article><h2>Inventory audit</h2><p id="posAuditState"></p><p>Pause deductions during a count. Recorded sales are recovered when you resume.</p><button data-pos-action="audit" id="posAuditToggle">Pause / resume inventory</button></article><article><h2>Kitchen tracking</h2><p id="posKdsState"></p><p>Show preparation progress on this device’s sales view.</p><button data-pos-action="kds" id="posKdsToggle">Change tracking</button></article><article><h2>Cash drawer</h2><p id="posDrawerState"></p><div class="pos-settings-actions"><button data-pos-action="autoDrawer" id="posAutoDrawerToggle">Change automatic opening</button><button data-pos-action="manualDrawer" id="posDrawerOpen">Open drawer</button></div></article></div><div data-pos-section="printers" id="posSettingsPrinters" hidden></div>';
    d.querySelector('.content-area').append(view);
    view.querySelectorAll('[data-pos-tab]').forEach(tab=>tab.onclick=()=>open(tab.dataset.posTab));
    const handlers={posSettingsRefresh:refresh,posParkedOpen:()=>w.showParkedOrders(),posAuditToggle:()=>w.toggleAuditMode(),posKdsToggle:()=>w.toggleKDS(),posAutoDrawerToggle:()=>w.setAutoDrawer(w.localStorage.getItem('takodeal_auto_drawer')==='false'),posDrawerOpen:()=>w.kickCashDrawer()};
    for(const [id,handler] of Object.entries(handlers))d.getElementById(id).onclick=handler;
    const dropdown=d.getElementById('posSettingsDropdown');if(dropdown){dropdown.style.display='none';dropdown.setAttribute('aria-hidden','true');}
    const top=d.getElementById('posSettingsButton');if(top)top.onclick=()=>open();
    const nav=d.getElementById('nav-printer');if(nav){nav.onclick=()=>open();const title=nav.querySelector('.nav-item-text');if(title)title.textContent='Settings';}
    const printerOpen=w.openPrinterManager;w.openPrinterManager=async()=>{await printerOpen?.();open('printers');};
    w.openPOSSettings=open;
    d.addEventListener('cashier-printer-state',paint);w.addEventListener?.('storage',event=>{if(['takodeal_device_branch','takodeal_device_id'].includes(event.key)){epoch++;refresh();}});
    refresh();w.posSettingsHub={open,refresh,authorize};return w.posSettingsHub;
}
