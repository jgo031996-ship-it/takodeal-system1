// Preserve the section route for installed Owner shells. POS tools no longer
// use an approval policy; saved policy documents remain untouched.
export function installOwnerPOSSettingsAccess(w,d) {
    const host=d.getElementById('posSettingsAccessHost');
    if(!host)return null;
    if(w.sidebarTabNames?.['nav-printer'])w.sidebarTabNames['nav-printer']={...w.sidebarTabNames['nav-printer'],name:'POS Settings'};
    host.classList.add('pos-settings-policy');
    host.innerHTML='<h3>POS Settings</h3><p>Signed-in staff can use printers, receipts and branch tools directly from Settings in the Cashier app. No extra Owner approval, Google sign-in or HQ PIN is required.</p><p>Receipt content, branch configuration and device registration are still managed in their existing Owner pages.</p><a href="https://takodeal-cashier.vercel.app/" target="_blank" rel="noopener">Open Cashier app</a>';
    return {directSettings:true};
}
const boot=()=>installOwnerPOSSettingsAccess(window,document);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
