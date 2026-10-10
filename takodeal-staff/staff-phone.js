import {waitForAppUpdate} from './app-update.js';
const updateHandlerKey=Symbol.for('takodeal.staff.appUpdate');

async function updateRegistration(serviceWorker) {
    let timer,finished=false;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The app update check took too long. Check your connection and try again.')),15000);});
    const lookup=async()=>{
        let registration=await serviceWorker.getRegistration();
        if(finished)return null;
        if(!registration){
            if(typeof serviceWorker.register!=='function')throw Error('App files are not ready yet. Reload the Staff app online and try again.');
            registration=await serviceWorker.register('./sw.js',{updateViaCache:'none'});
            if(finished)return null;
            if(registration && !registration.active && !registration.installing && !registration.waiting && serviceWorker.ready)registration=await serviceWorker.ready;
        }
        if(!registration || typeof registration.update!=='function')throw Error('App files are not ready yet. Reload the Staff app online and try again.');
        return registration;
    };
    try{return await Promise.race([lookup(),deadline]);}
    finally{finished=true;clearTimeout(timer);}
}

// This small installer can run on the login page without Firebase or staff data.
// A shared page key also retains the lock if two module URLs install it later.
export function installStaffAppUpdate(w=window,d=document,nav=navigator) {
    if(w[updateHandlerKey]){w.forceUpdateApp=w[updateHandlerKey];return w.forceUpdateApp;}
    let updating=false;
    const status=text=>{for(const node of d.querySelectorAll?.('[data-staff-update-status]') || []){node.textContent=text;node.hidden=!text;}};
    const explain=async(title,text,icon='warning')=>{status(text);try{if(w.Swal?.fire)await w.Swal.fire(title,text,icon);}catch{/* The inline status remains usable if the dialog library fails. */}return false;};
    const protectedWork=()=>w.staffPunchBusy?['Attendance is saving','Wait for your attendance to finish before updating.']:w.staffDeviceRegistrationBusy?['Request is sending','Wait for your device request to finish before updating.']:null;
    const check=async()=>{
        if(updating)return false;
        const blocked=protectedWork();if(blocked)return explain(...blocked,'info');
        if(!nav.onLine)return explain('Connection needed','Connect to the internet to check for app updates.','info');
        if(typeof nav.serviceWorker?.getRegistration!=='function')return explain('Update check unavailable','This browser cannot check app updates. Reload the Staff app while online.');
        updating=true;
        const buttons=[...(d.querySelectorAll?.('[data-staff-update]') || [])],previous=buttons.map(button=>({button,disabled:button.disabled,text:button.textContent}));
        for(const button of buttons){button.disabled=true;button.textContent='Checking for app updates…';button.setAttribute?.('aria-busy','true');}
        status('Checking app files. Your device registration and saved data will stay here.');
        try {
            const registration=await updateRegistration(nav.serviceWorker);
            await waitForAppUpdate(registration);
            // Work may have started while the update was downloading.
            const pendingWork=protectedWork();if(pendingWork)return await explain(...pendingWork,'info');
            if(!nav.onLine)return await explain('Connection needed','The connection was lost. Reconnect and check for app updates again.','info');
            status('Reloading the Staff app…');
            // Reload only the shell; never reset auth, PINs, registration or saved attendance.
            w.location.reload();return true;
        } catch(error){return await explain('Update check unavailable',error?.message || 'Check your connection and try again.');}
        finally{updating=false;for(const {button,disabled,text} of previous){button.disabled=disabled;button.textContent=text;button.removeAttribute?.('aria-busy');}}
    };
    Object.defineProperty(w,updateHandlerKey,{value:check,configurable:true});w.forceUpdateApp=check;return check;
}

// Heavy download libraries are only needed when staff export a document.
export function installStaffPhone() {
    const loading = new Map();
    function library(name,url) {
        if(window[name])return Promise.resolve();
        if(loading.has(name))return loading.get(name);
        const pending=new Promise((resolve,reject)=>{
            const script=document.createElement('script');script.src=url;script.async=true;
            const timer=setTimeout(()=>{script.remove();loading.delete(name);reject(Error('Download tools took too long to load. Check your internet and try again.'));},20000);
            script.onload=()=>{clearTimeout(timer);if(window[name])resolve();else{loading.delete(name);reject(Error('Download tools are unavailable. Try again.'));}};
            script.onerror=()=>{clearTimeout(timer);script.remove();loading.delete(name);reject(Error('Connect to the internet to load download tools.'));};
            document.head.appendChild(script);
        });loading.set(name,pending);return pending;
    }
    for(const [fn,name,url] of [
        ['downloadContractPDF','html2pdf','https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'],
        ['downloadStaffPayslipImage','html2canvas','https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
        ['generateCOE','html2canvas','https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
        ['generateVirtualID','html2canvas','https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js']]) {
        const original=window[fn];if(!original)continue;
        window[fn]=async function(...args){
            try{await library(name,url);return original.apply(this,args);}
            catch(e){window.Swal.fire('Download unavailable',e.message,'warning');}
        };
    }
    installStaffAppUpdate();
}
