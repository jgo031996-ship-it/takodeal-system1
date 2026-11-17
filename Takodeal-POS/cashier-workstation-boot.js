// Each remembered workstation has its own cashier preferences and receipt queues.
// Firebase Auth uses a named app for its server-approved anonymous device identity.
(function boot(w){
    const storage=w.localStorage,selectedKey='takodeal_remembered_cashier_station_v1',recordPrefix='takodeal_cashier_station_v1:';
    const valid=id=>typeof id==='string'&&/^DEV-[A-F0-9-]{36}$/.test(id);
    function record(id){
        if(!valid(id))return null;
        try{const r=JSON.parse(storage.getItem(recordPrefix+id));return r?.id===id&&typeof r.branch==='string'&&r.branch&&typeof r.ownerUid==='string'?r:null;}catch{return null;}
    }
    function profileStorage(id){
        const prefix='takodeal_station_data:'+id+':';
        const keys=()=>Object.keys(storage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));
        return {get length(){return keys().length;},key:i=>keys()[i]??null,getItem:k=>storage.getItem(prefix+k),
            setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k),clear:()=>keys().forEach(k=>storage.removeItem(prefix+k))};
    }
    const url=new URL(w.location.href),current=url.searchParams.get('owner')==='1'?null:record(url.searchParams.get('station')||storage.getItem(selectedKey));
    w.cashierWorkstation={
        current,requireOwnerLogin:!!record(storage.getItem(selectedKey))||url.searchParams.get('reauth')==='1',
        suggestRemember:!storage.getItem('takodeal_device_id')||storage.getItem('takodeal_cashier_owner_preview_v1')!==null,
        appName:id=>'takodeal-cashier-station-'+id,
        find(ownerUid,branch){return Object.keys(storage).filter(k=>k.startsWith(recordPrefix)).map(k=>record(k.slice(recordPrefix.length))).find(r=>r?.ownerUid===ownerUid&&r.branch===branch);},
        remember(r){
            if(!valid(r.id)||!r.ownerUid||!r.branch)throw Error('Invalid cashier workstation.');
            const profile=profileStorage(r.id);profile.setItem('takodeal_device_branch',r.branch);profile.setItem('takodeal_device_id',r.id);profile.setItem('takodeal_device_name','Owner workstation · '+r.branch);
            storage.setItem(recordPrefix+r.id,JSON.stringify(r));storage.setItem(selectedKey,r.id);
        },
        open(r){const next=new URL(w.location.href);next.search='';next.searchParams.set('station',r.id);w.location.assign(next.href);},
        original(){const next=new URL(w.location.href);next.search='?owner=1&reauth=1';w.location.assign(next.href);},
        outbox(factory){return current&&factory?{open:(name,version)=>factory.open(name+'_'+current.id,version)}:factory;}
    };
    if(current){
        const scoped=profileStorage(current.id);
        Object.defineProperty(w,'localStorage',{configurable:true,value:scoped});
        // Firebase may use its local-storage fallback on browsers without IDB. Keep the
        // same named-app credential visible in both the enrolling and operating pages.
        const get=scoped.getItem,set=scoped.setItem,remove=scoped.removeItem;
        const namedAuth=k=>String(k).startsWith('firebase:')&&String(k).endsWith(':'+w.cashierWorkstation.appName(current.id));
        scoped.getItem=k=>namedAuth(k)?storage.getItem(k):get(k);
        scoped.setItem=(k,v)=>namedAuth(k)?storage.setItem(k,v):set(k,v);
        scoped.removeItem=k=>namedAuth(k)?storage.removeItem(k):remove(k);
    }
})(window);
