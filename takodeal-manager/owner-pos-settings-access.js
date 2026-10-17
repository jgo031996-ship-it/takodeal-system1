import {installPOSSettingsPolicy} from './pos-settings-policy.js';
export function installOwnerPOSSettingsAccess(w,d) {
    const view=d.getElementById('view-posconfig'),section=d.getElementById('section-posSettingsAccess'),host=d.getElementById('posSettingsAccessHost');
    if(!view||!section||!host)return null;
    const policy=installPOSSettingsPolicy(w,d,host);
    let visible=false;
    const check=()=>{
        if(w.sidebarTabNames?.['nav-printer'])w.sidebarTabNames['nav-printer']={...w.sidebarTabNames['nav-printer'],name:'POS Settings'};
        const next=view.classList.contains('active')&&section.style.display!=='none'&&!d.hidden;
        if(next&&!visible)void policy.load();
        visible=next;
    };
    const observer=new w.MutationObserver(check);
    for(const target of [view,section])observer.observe(target,{attributes:true,attributeFilter:['class','style']});
    d.addEventListener('visibilitychange',check);
    w.addEventListener('pageshow',check);
    check();return {policy,stop(){observer.disconnect();d.removeEventListener('visibilitychange',check);w.removeEventListener('pageshow',check);}};
}
const boot=()=>installOwnerPOSSettingsAccess(window,document);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
