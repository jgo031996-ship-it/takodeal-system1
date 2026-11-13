// Public branch discovery only. This runtime never writes business or device data.
export function branchRows(snapshot) {
    if(snapshot?.metadata?.fromCache||snapshot?.metadata?.hasPendingWrites)return null;
    if(!Array.isArray(snapshot?.docs))throw Error('Branch directory is unavailable.');
    const names=new Set(),rows=[];
    for(const entry of snapshot.docs) {
        const data=entry.data(),name=typeof data.name==='string'?data.name.trim():'';
        if(!name)continue;
        if(names.has(name)||['__proto__','constructor','prototype'].includes(name))throw Error('Branch names need HQ review.');
        names.add(name);rows.push({...data,id:entry.id,name});
    }
    return rows.sort((a,b)=>{
        const stamp=row=>typeof row.createdAt?.toMillis==='function'?row.createdAt.toMillis():0;
        return stamp(a)-stamp(b)||a.name.localeCompare(b.name);
    });
}
export function syncBranchOptions(document,select,names,{special=[],preferred}={}) {
    if(!select)return;
    const value=preferred??select.value,disabled=select.disabled;
    const preserved=Array.from(select.options||[]).filter(option=>special.includes(option.value)).map(option=>({value:option.value,text:option.textContent,disabled:option.disabled}));
    if(!value&&!preserved.some(option=>option.value===''))preserved.unshift({value:'',text:'Choose branch',disabled:false});
    const entries=[...preserved,...names.map(name=>({value:name,text:name,disabled:false}))];
    if(value&&!entries.some(option=>option.value===value))entries.push({value,text:value+' · no longer listed',disabled:true});
    const signature=JSON.stringify(entries);
    if(select.dataset?.liveBranchOptions===signature&&select.value===value)return;
    const options=entries.map(row=>{const option=document.createElement('option');option.value=row.value;option.textContent=row.text;option.disabled=!!row.disabled;return option;});
    select.replaceChildren(...options);select.value=value||'';select.disabled=disabled;
    if(select.dataset)select.dataset.liveBranchOptions=signature;
}
const coordinate=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')?Number(value):NaN;
function updateZones(api,rows,fallback) {
    if(!api.BRANCH_ZONES)return;
    const zones=Object.create(null);
    for(const row of rows) {
        const prior=row.lat==null&&row.lng==null?fallback[row.name]:null;
        const lat=coordinate(prior?.lat??row.lat),lng=coordinate(prior?.lng??row.lng);
        if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)zones[row.name]={lat,lng};
    }
    for(const name of Object.keys(api.BRANCH_ZONES))delete api.BRANCH_ZONES[name];
    Object.assign(api.BRANCH_ZONES,zones);
}
export function applyBranchDirectory(api,document,rows,{kind,allBranches=false,fallback={}}) {
    const registered=rows.filter(row=>row.active!==false&&row.status!=='Inactive'),names=registered.map(row=>row.name);
    const sync=(id,list,options)=>syncBranchOptions(document,document.getElementById(id),list,options);
    if(kind==='owner') {
        const session=api.sessionUser;if(!session||session.uid!==api.auth?.currentUser?.uid)return;
        api.globalActiveBranches=names;
        api.globalBranchData=Object.fromEntries(registered.map(row=>[row.id,row]));
        const allowed=names.filter(name=>api.isBranchAllowed?.(name)===true);
        const standard=['empBranchAssign','manAttBranch','newAccBranch','newBudgetBranch','newInvBranch','editInvBranch','batchBranch','dispFrom','dispTo'];
        const filters=['dashBranchFilter','invBranchFilter','zReadingBranchFilter','transferBranchFilter','branchAlertFilter','histBranchFilter','burnRateBranch','auditModalBranch','forecasterBranchSelect','aiBranchSelect','sanctionBranchFilter','expenseBranchFilter','flowBranchFilter','cycleBranchSelect'];
        for(const id of [...standard,...filters])sync(id,allowed,{special:['','All']});
    } else if(kind==='staff'||kind==='cashier') {
        updateZones(api,registered,fallback);
        if(kind==='staff') {
            sync('deviceBranchInput',names,{special:['','Auto']});
            sync('sopBranchSelect',names,{preferred:api.sopActiveTimeIn?.branch});
        } else sync('setupBranchSelect',names,{special:['']});
        // Device approval, saved branch, active shift and current cart stay owned
        // by their existing guarded flows. Discovery never selects for them.
    } else if(kind==='franchise') {
        const session=api.sessionUser;if(!session||session.uid!==api.auth?.currentUser?.uid)return;
        const global=allBranches===true&&session.isFranchisee!==true&&(session.email==='jgo031996@gmail.com'||session.permissions?.includes('all'));
        const state=api.franchiseState;
        if(global&&(state?.pending||state?.cart?.length||state?.schedule?.dirty||api.franchiseHQ?.hasDraft?.()||api.franchiseHQ?.isPending?.()))return false;
        if(global)session.allowedBranches=[...new Set([...names,...(session.branch&&!names.includes(session.branch)?[session.branch]:[])])];
        const allowed=names.filter(name=>session.allowedBranches?.includes(name));
        const select=document.getElementById('franchiseBranchSelect');syncBranchOptions(document,select,allowed,{preferred:session.branch});
        if(select)select.disabled=allowed.length<2;
    } else if(kind==='customer') {
        // Refresh only the public locator. Do not switch a chosen branch or
        // rebuild a cart, checkout, order attempt or active delivery quote.
        const locator=document.getElementById('branchLocatorScreen');
        if(locator&&!locator.classList.contains('hidden')) {
            if(api.customerBranchesLoading)return false;
            try{Promise.resolve(api.loadBranchLocator?.()).catch(()=>{});}catch{}
        }
    }
}
export function installLiveBranchDirectory(api,document,{kind,subscribe,allBranches=false,delay=setTimeout,cancelDelay=clearTimeout}={}) {
    let rows=null,lastSignature='',unsubscribe=null,epoch=0,stopped=false,retry=null;
    const fallback=Object.assign(Object.create(null),api.BRANCH_ZONES||{});
    const options={kind,allBranches,fallback},listeners=[];
    const apply=()=>{
        if(!rows||stopped||document.hidden)return;
        try {
            if(applyBranchDirectory(api,document,rows,options)===false&&retry===null)retry=delay(()=>{retry=null;apply();},1000);
        } catch{api.branchDirectoryStatus='unavailable';}
    };
    const pause=()=>{epoch++;if(retry!==null)cancelDelay(retry);retry=null;const stop=unsubscribe;unsubscribe=null;try{stop?.();}catch{}};
    function start() {
        if(stopped||unsubscribe||document.hidden||api.navigator?.onLine===false)return;
        const token=++epoch;
        try {
            const stop=subscribe(snapshot=>{
                if(token!==epoch||stopped||document.hidden)return;
                try {
                    const next=branchRows(snapshot);if(!next)return;
                    const signature=JSON.stringify(next.map(row=>[row.id,row.name,row.lat,row.lng,row.active,row.status,row.operatingHours,row.openingDate]));
                    rows=next;api.branchDirectoryStatus='ready';
                    if(signature!==lastSignature){lastSignature=signature;apply();}
                } catch{api.branchDirectoryStatus='unavailable';}
            },()=>{if(token===epoch)api.branchDirectoryStatus='unavailable';});
            if(token===epoch&&!stopped)unsubscribe=stop;else stop?.();
        } catch{api.branchDirectoryStatus='unavailable';}
    }
    function listen(target,name,fn){target?.addEventListener?.(name,fn);listeners.push(()=>target?.removeEventListener?.(name,fn));}
    listen(document,'visibilitychange',()=>{if(document.hidden)pause();else start();});
    listen(api,'online',()=>{pause();start();});listen(api,'pagehide',pause);listen(api,'pageshow',start);
    start();
    return {apply,start,stop(){stopped=true;pause();for(const remove of listeners)remove();}};
}
