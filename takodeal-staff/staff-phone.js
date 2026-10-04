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
    window.forceUpdateApp=async()=>{
        if(window.staffPunchBusy)return window.Swal.fire('Attendance is saving','Wait for your attendance to finish before updating.','info');
        if(!navigator.onLine)return window.Swal.fire('Connection needed','Connect to the internet to check for app updates.','info');
        try {
            const registration=await navigator.serviceWorker?.getRegistration();
            await registration?.update();
            // Reload the shell only; keep device registration, PIN cooldowns and offline attendance.
            window.location.reload();
        } catch {window.Swal.fire('Update check unavailable','Check your connection and try again.','warning');}
    };
}
