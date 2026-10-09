const layouts=new WeakMap();

// Presentation and browser lifecycle only. No account, location or cloud writes.
export function installRiderLayout(doc=document,win=window,{isBusy=()=>true}={}) {
    if(layouts.has(doc))return layouts.get(doc);
    const listeners=[],el=id=>doc.getElementById(id),root=doc.documentElement;
    const viewport=win.visualViewport,service=win.navigator?.serviceWorker;
    const installButton=el('riderInstallButton'),notice=el('riderUpdateNotice');
    let disposed=false,frame=null,prompt=null,registration=null,waiting=null,activationRequested=false,pendingReload=false,previousController=null,installed=false,revealSuppressedFor=null;
    const activePointers=new Set();
    const seen=new WeakSet();
    const busy=()=>{try{return isBusy()!==false;}catch{return true;}};
    const listen=(target,type,fn,options)=>{if(target?.addEventListener){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}};
    const message=doc.createElement('p'),updateButton=doc.createElement('button'),controls=doc.createElement('div');
    message.id='riderUpdateMessage';updateButton.type='button';updateButton.className='rider-button secondary';updateButton.textContent='Update app';controls.className='rider-update-controls';controls.append(message,updateButton);notice?.append(controls);
    const showUpdate=(text,apply=true)=>{if(disposed||!notice)return;message.textContent=text;updateButton.hidden=!apply;notice.hidden=false;};
    const clearViewport=()=>{for(const key of ['--rider-viewport-height','--rider-viewport-top','--rider-keyboard-inset'])root.style.removeProperty(key);};
    const refreshViewport=()=>{
        if(disposed)return;
        // Respect deliberate pinch zoom and its browser-controlled panning.
        if(viewport&&Math.abs(Number(viewport.scale||1)-1)>.05){clearViewport();return;}
        const height=Number(viewport?.height||win.innerHeight),top=Math.max(0,Number(viewport?.offsetTop||0));
        if(!Number.isFinite(height)||height<=0||!Number.isFinite(top))return;
        root.style.setProperty('--rider-viewport-height',height+'px');root.style.setProperty('--rider-viewport-top',top+'px');
        root.style.setProperty('--rider-keyboard-inset',Math.max(0,Number(win.innerHeight)-height-top)+'px');
        const input=doc.activeElement;
        // A queued keyboard resize must not move a button between pointer-down
        // and click. Some mobile browsers leave the old PIN focused after a
        // button tap; keep that old focus suppressed until an input is refocused.
        if(activePointers.size || input===revealSuppressedFor)return;
        if(!input?.matches('input,textarea,select')||input.disabled||input.readOnly)return;
        const scroller=input.closest('.rider-auth,.rider-account,.swal2-popup');
        if(!scroller)return;
        const bounds=scroller.getBoundingClientRect(),field=input.getBoundingClientRect();
        const visibleTop=Math.max(top,bounds.top)+12,visibleBottom=Math.min(top+height,bounds.bottom)-16;
        if(visibleBottom<=visibleTop)return;
        const delta=field.bottom>visibleBottom?field.bottom-visibleBottom:field.top<visibleTop?field.top-visibleTop:0;
        if(delta)scroller.scrollTop=Math.max(0,Math.min(Math.max(0,scroller.scrollHeight-scroller.clientHeight),scroller.scrollTop+delta));
    };
    const schedule=()=>{if(disposed||frame!==null)return;frame=win.requestAnimationFrame(()=>{frame=null;refreshViewport();});};
    const connection=()=>{if(disposed)return;const node=el('riderConnectionStatus');if(node){const online=win.navigator?.onLine!==false;node.textContent=online?'Connection available':'Offline · reconnect to continue';node.dataset.online=String(online);}};
    const mode=win.matchMedia?.('(display-mode: standalone)');
    const renderInstall=()=>{if(installButton)installButton.hidden=Boolean(installed||mode?.matches||win.navigator?.standalone);};
    const installHelp=doc.createElement('p');installHelp.id='riderInstallHelp';installHelp.className='rider-notice';installHelp.setAttribute('role','status');installHelp.hidden=true;installButton?.after(installHelp);
    const requestInstall=async()=>{
        if(disposed)return false;
        if(busy()){installHelp.textContent='Finish your current action before installing the app.';installHelp.hidden=false;return false;}
        if(!prompt){installHelp.textContent='Open your browser menu and choose Install app or Add to Home Screen.';installHelp.hidden=false;return false;}
        const current=prompt;prompt=null;
        try{await current.prompt();await current.userChoice;if(disposed)return false;renderInstall();return true;}
        catch{if(disposed)return false;installHelp.textContent='Installation could not open. Try Install app or Add to Home Screen in your browser menu.';installHelp.hidden=false;return false;}
    };
    const ready=worker=>{if(!worker)return;waiting=worker;showUpdate('A Rider app update is ready. Finish the current action, then update.');};
    const reload=()=>{
        if(busy()||doc.visibilityState!=='visible'){pendingReload=true;showUpdate('The update is ready. Finish your current action, then select Update app.');return false;}
        activationRequested=false;pendingReload=false;win.location.reload();return true;
    };
    const applyUpdate=()=>{
        if(disposed)return false;
        if(busy()){showUpdate('Finish your current action, then select Update app.');return false;}
        if(pendingReload)return reload();
        const worker=registration?.waiting||waiting;
        if(!worker||worker.state==='redundant'){showUpdate('No update is waiting. Reopen the app to check again.',false);return false;}
        try{previousController=service?.controller;activationRequested=true;worker.postMessage({type:'SKIP_WAITING'});showUpdate('Opening the updated Rider app…',false);return true;}
        catch{activationRequested=false;showUpdate('The update could not start. Try Update app again.');return false;}
    };
    const watchRegistration=reg=>{
        if(disposed||!reg)return;registration=reg;if(reg.waiting)ready(reg.waiting);if(seen.has(reg))return;seen.add(reg);
        const watch=()=>{const worker=reg.installing;if(!worker)return;listen(worker,'statechange',()=>{if(worker.state==='installed'&&service?.controller)ready(reg.waiting||worker);});};
        listen(reg,'updatefound',watch);watch();
    };
    const checkUpdate=async()=>{
        if(disposed)return false;
        try{registration ||= await service?.getRegistration?.();if(disposed||!registration)return false;await registration.update();if(disposed)return false;watchRegistration(registration);if(!registration.waiting&&!waiting)showUpdate('The Rider app is up to date.',false);return true;}
        catch{showUpdate('Connect to the internet, then check for an app update again.',false);return false;}
    };
    listen(doc,'pointerdown',event=>{activePointers.add(event.pointerId??'pointer');revealSuppressedFor=event.target?.closest?.('input,textarea,select')?null:doc.activeElement;},true);
    const finishPointer=event=>{activePointers.delete(event.pointerId??'pointer');schedule();};
    listen(doc,'pointerup',finishPointer,true);listen(doc,'pointercancel',finishPointer,true);
    listen(win,'blur',()=>{activePointers.clear();schedule();});
    listen(doc,'focusin',()=>{revealSuppressedFor=null;schedule();});listen(doc,'focusout',schedule);listen(win,'resize',schedule);listen(viewport,'resize',schedule);listen(viewport,'scroll',schedule);
    listen(win,'online',connection);listen(win,'offline',connection);listen(doc,'visibilitychange',()=>{connection();schedule();});
    listen(win,'beforeinstallprompt',event=>{event.preventDefault();prompt=event;renderInstall();});listen(win,'appinstalled',()=>{installed=true;prompt=null;installHelp.hidden=true;renderInstall();});listen(mode,'change',renderInstall);
    listen(installButton,'click',requestInstall);listen(updateButton,'click',applyUpdate);listen(win,'rider-worker-ready',event=>watchRegistration(event.detail));
    listen(service,'controllerchange',()=>{if(activationRequested&&service.controller!==previousController)reload();});
    service?.getRegistration?.().then(watchRegistration).catch(()=>{});
    refreshViewport();connection();renderInstall();
    const layout={refreshViewport,requestInstall,watchRegistration,checkUpdate,applyUpdate,dispose(){
        disposed=true;listeners.forEach(remove=>remove());if(frame!==null)win.cancelAnimationFrame(frame);clearViewport();controls.remove();installHelp.remove();layouts.delete(doc);
    }};
    layouts.set(doc,layout);return layout;
}
