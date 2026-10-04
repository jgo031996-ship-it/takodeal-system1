const tabs=[['Performance','Perf'],['Ledger','Ledger'],['Chat','Chat'],['Leads','Leads'],['Simulator','Simulator']];

// Keep the former management and planning permissions when sharing one workspace.
export function allowedFranchiseTabs(user) {
    const permissions=user?.permissions || [];
    const owner=user?.isOwner || permissions.includes('all');
    const management=owner || user?.isFranchisee || permissions.includes('franchise-hub');
    const simulator=!user?.isFranchisee && (owner || permissions.includes('franchise'));
    return tabs.map(([name])=>name).filter(name=>name==='Simulator'?simulator:name==='Performance'?management && !user?.isFranchisee:management);
}

export function installFranchiseWorkspace() {
    let selected=null;
    const el=id=>document.getElementById(id);
    const previousTab=window.switchFranTab,previousView=window.switchView;
    const stopChat=()=>{window.franChatUnsubscribe?.();window.franChatUnsubscribe=null;};
    function permissions() {
        const allowed=allowedFranchiseTabs(window.sessionUser);
        for(const [name,suffix] of tabs) {
            const button=el('tabFran'+suffix);
            if(button){button.hidden=!allowed.includes(name);button.style.display=button.hidden?'none':'';}
        }
        if(el('btnFranManualLog'))el('btnFranManualLog').style.display=window.sessionUser?.isFranchisee?'none':'block';
        return allowed;
    }
    window.switchFranTab=function(name) {
        if(!permissions().includes(name))return false;
        selected=name;
        if(name!=='Chat')stopChat();
        if(name==='Simulator') {
            for(const [tab] of tabs)if(el('franSec'+tab))el('franSec'+tab).style.display=tab===name?'block':'none';
        } else {
            if(el('franSecSimulator'))el('franSecSimulator').style.display='none';
            previousTab.call(this,name);
        }
        for(const [tab,suffix] of tabs) {
            const button=el('tabFran'+suffix),panel=el('franSec'+tab),active=tab===name;
            if(button){button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;button.style.borderBottomColor='';button.style.color='';}
            if(panel){panel.hidden=!active;panel.setAttribute('aria-hidden',String(!active));}
        }
        return true;
    };
    window.loadFranchiseHub=function(preferred=selected) {
        const allowed=permissions();
        if(!allowed.length)return false;
        return window.switchFranTab(allowed.includes(preferred)?preferred:allowed[0]);
    };
    window.switchView=function(view,...args) {
        const legacySimulator=view==='franchise';
        if(legacySimulator)view='franchise-hub';
        if(view==='franchise-hub' && !allowedFranchiseTabs(window.sessionUser).length)return false;
        if(view!=='franchise-hub')stopChat();
        const result=previousView.call(this,view,...args);
        if(view==='franchise-hub')window.loadFranchiseHub(legacySimulator?'Simulator':selected);
        return result;
    };
    el('franchiseWorkspaceTabs')?.addEventListener('keydown',event=>{
        if(event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        const allowed=permissions(),index=allowed.indexOf(selected);
        const next=event.key==='Home'?allowed[0]:event.key==='End'?allowed.at(-1):allowed[(index+(event.key==='ArrowRight'?1:-1)+allowed.length)%allowed.length];
        if(!next)return;
        event.preventDefault();window.switchFranTab(next);
        el('tabFran'+tabs.find(([name])=>name===next)[1])?.focus();
    });
    window.addEventListener('pagehide',stopChat);
}
