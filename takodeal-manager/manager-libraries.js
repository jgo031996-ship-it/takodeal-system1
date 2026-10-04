// Dashboard tools load after the PIN. Maps, images, PDFs and Excel wait until used.
const scripts = {
    Chart:'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    Swal:'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.6/dist/sweetalert2.all.min.js',
    html2canvas:'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    html2pdf:'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    XLSX:'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    L:'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
};
const pending = new Map();
export function ensureManagerLibrary(name, w = window, d = document) {
    if (w[name]) return Promise.resolve();
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve,reject) => {
        const script=d.createElement('script');script.src=scripts[name];script.async=true;
        const timer=setTimeout(()=>{script.remove();reject(new Error('This tool timed out. Check your connection and try again.'));},20000);
        script.onload=()=>{clearTimeout(timer);resolve();};
        script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('This tool could not load. Reconnect and try again.'));};
        d.head.appendChild(script);
    }).then(()=> {
        if(name==='L' && !d.getElementById('manager-map-style')) {
            const link=d.createElement('link');link.id='manager-map-style';link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';d.head.appendChild(link);
        }
    }).catch(error=>{pending.delete(name);throw error;});
    pending.set(name,promise);return promise;
}
export function loadManagerLibraries(w=window,d=document) {
    return Promise.all(['Chart','Swal'].map(name=>ensureManagerLibrary(name,w,d)));
}
export function prepareManagerTools(w=window,d=document) {
    const tools={downloadPayslipImage:'html2canvas',downloadScheduleImage:'html2canvas',generateCOEImage:'html2canvas',
        generateFranchiseSOA:'html2canvas',generateIDCard:'html2canvas',exportProspectusPDF:'html2pdf',downloadContractPDF:'html2pdf',openArchiveSalesModal:'XLSX',openAddBranchModal:'L'};
    for(const [action,library] of Object.entries(tools)) {
        const original=w[action];if(typeof original!=='function') continue;
        let busy=false;
        w[action]=async function(...args) {
            if(busy) return;busy=true;
            try {
                const waiting=!w[library];
                if(waiting) w.Swal.fire({title:'Preparing your tools…',text:'This tool saves on your device after its first use.',allowOutsideClick:false,didOpen:()=>w.Swal.showLoading()});
                await ensureManagerLibrary(library,w,d);
                if(waiting) w.Swal.close();
                return await original.apply(this,args);
            }
            catch(error) { await w.Swal.fire({icon:'warning',title:'Tool unavailable',text:error.message}); }
            finally {busy=false;}
        };
    }
}
