import {CASHIER_RELEASE, updateBlocker} from './cashier-data.js';

export const CASHIER_UPDATE_TIMEOUTS = Object.freeze({lookup:15000, check:30000, download:120000, opening:30000, slow:8000});
const retained = 'Saved offline sales, device settings and printer settings stay on this device.';
const listen = (target, name, callback) => {
  target?.addEventListener?.(name, callback);
  return () => target?.removeEventListener?.(name, callback);
};

// A timeout stops this screen waiting. Browser-owned update/download work cannot
// be cancelled, so its promise is retained and retries observe that same work.
export function createCashierUpdateController({serviceWorker, online=()=>true, blocker=()=>'', render=()=>{},
  reload=()=>{}, now=()=>Date.now(), setTimer=(fn,ms)=>setTimeout(fn,ms), clearTimer=id=>clearTimeout(id), timeouts={}}={}) {
  const limits={...CASHIER_UPDATE_TIMEOUTS,...timeouts}, initialController=serviceWorker?.controller;
  let registration, lookup, physicalUpdate, active, tick, disposed=false, restartWorker, installedWorker, latestWorker;
  let state={phase:'idle',title:'Check for a Cashier update',message:'Finish or park your order before updating.',busy:false,action:'Check for update',elapsed:0};
  const watched=new Map(), cleanups=[], pendingWaits=new Set();
  const publish=view=>{if(!disposed){state={elapsed:0,busy:false,action:'Try again',...view};render({...state});}};
  const present=(view,attempt)=>{if(attempt){attempt.view=view;if(attempt.silent)return;}publish(view);};
  const stopTick=()=>{clearTimer(tick);tick=undefined;};
  const phase=(attempt,name,title,message)=>{
    stopTick();const started=now();
    const update=()=>{
      if(disposed || active!==attempt)return;
      const elapsed=Math.floor((now()-started)/1000);
      present({phase:name,title,message:message+(now()-started>=limits.slow?' This is taking longer than usual. A retry option will appear if it does not finish.':''),busy:true,action:'Please wait',elapsed},attempt);
      tick=setTimer(update,1000);
    };update();
  };
  const blocked=attempt=>{
    const reason=blocker();if(!reason)return false;
    present({phase:'blocked',title:'Finish your current work',message:reason+' '+retained},attempt);return true;
  };
  const bounded=(promise,ms,stage)=>new Promise((resolve,reject)=>{
    const finish=(callback,value)=>{clearTimer(timer);pendingWaits.delete(cancel);callback(value);};
    const cancel=()=>finish(reject,new Error('Update screen closed'));
    const timer=setTimer(()=>{const error=new Error(stage+' timed out');error.updateStage=stage;finish(reject,error);},ms);
    pendingWaits.add(cancel);
    Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
  const readyWorker=()=>{
    if(restartWorker?.state==='activated' && serviceWorker?.controller===restartWorker)return restartWorker;
    if(registration?.waiting?.state!=='redundant' && registration?.waiting)return registration.waiting;
    if(registration?.installing?.state==='installed')return registration.installing;
    if(installedWorker?.state==='installed')return installedWorker;
    return null;
  };
  const showReady=attempt=>{
    const worker=readyWorker();if(!worker)return false;
    if(attempt)attempt.silent=false;
    present({phase:'ready',title:'Cashier update ready',message:'Finish or park your order, then open the updated app. '+retained,
      action:worker.state==='activated'?'Open updated app':'Update app'},attempt);return true;
  };
  function watch(worker){
    if(!worker || watched.has(worker))return;
    watched.set(worker,listen(worker,'statechange',()=>{
      if(disposed)return;
      if(worker.state==='activated' && initialController && serviceWorker?.controller===worker)restartWorker=worker;
      if(!active && ['installed','activated'].includes(worker.state))showReady();
      if(!active && worker.state==='redundant' && state.phase==='ready')publish({phase:'error',title:'Update did not finish',message:'Check your connection and try again. '+retained});
    }));
  }
  function observeRegistration(value){
    if(disposed || !value)return;
    if(registration!==value){
      registration=value;
      cleanups.push(listen(value,'updatefound',()=>{
        latestWorker=value.installing;
        watch(value.installing);
        if(!active)void check();
      }));
    }
    watch(value.installing);watch(value.waiting);
    if(!active){
      if(!showReady() && value.installing && value.installing.state!=='redundant')void check();
    }
  }
  function lookupRegistration(){
    if(registration)return Promise.resolve(registration);
    if(!lookup){
      const pending=Promise.resolve().then(()=>serviceWorker?.getRegistration?.());
      lookup=pending;
      pending.then(value=>{if(lookup===pending)lookup=null;if(!registration)observeRegistration(value);},()=>{if(lookup===pending)lookup=null;});
    }
    return lookup;
  }
  function updateRegistration(value){
    if(!physicalUpdate){
      const pending=Promise.resolve().then(()=>value.update());physicalUpdate=pending;
      pending.then(()=>{if(physicalUpdate===pending)physicalUpdate=null;},()=>{if(physicalUpdate===pending)physicalUpdate=null;});
    }
    return physicalUpdate;
  }
  async function waitWorker(worker,opening,stage=opening?'opening':'download'){
    let stopState=()=>{},stopController=()=>{};
    const completion=new Promise((resolve,reject)=>{
      const inspect=()=>{
        if(worker.state==='redundant')reject(new Error('The update could not be installed.'));
        else if(opening ? worker.state==='activated' && serviceWorker?.controller===worker : ['installed','activated'].includes(worker.state))resolve();
      };
      stopState=listen(worker,'statechange',inspect);stopController=listen(serviceWorker,'controllerchange',inspect);inspect();
    });
    try {await bounded(completion,stage==='opening'?limits.opening:limits.download,stage);}
    finally {stopState();stopController();}
  }
  function failure(error,attempt){
    if(error.updateStage){
      const titles={lookup:'App lookup is taking too long',check:'Update check is taking too long',download:'Update download is taking too long',opening:'The updated app has not opened yet'};
      present({phase:'error',title:titles[error.updateStage],message:'The browser may still be working. Try again to check its progress. '+retained},attempt);
    }else present({phase:'error',title:'Could not finish the update',message:'Check your connection and try again. '+retained},attempt);
  }
  function run(kind,silent=false){
    if(disposed)return Promise.resolve();
    if(active){active.silent=false;if(active.view)publish(active.view);return active.promise;}
    const attempt={silent};active=attempt;
    attempt.promise=Promise.resolve().then(async()=>{
      if(blocked(attempt))return;
      if(!serviceWorker){present({phase:'error',title:'Updates are unavailable here',message:'Open the installed Cashier app in a supported browser. '+retained},attempt);return;}
      if(kind==='open'){
        const worker=readyWorker();if(!worker){present({phase:'error',title:'Check for the update again',message:'The ready update has changed. Check again before opening it. '+retained},attempt);return;}
        // Capture this exact worker; a different tab or newer update cannot
        // satisfy this opening attempt and trigger an unrelated reload.
        restartWorker=worker;phase(attempt,'opening','Opening the updated app','Waiting for the installed update to take control. '+retained);
        if(worker.state!=='activated')worker.postMessage({type:'TK_ACTIVATE_UPDATE'});
        await waitWorker(worker,true);
        if(disposed || active!==attempt || blocked(attempt))return;
        if(worker.state!=='activated' || serviceWorker?.controller!==worker){
          present({phase:'error',title:'The ready update changed',message:'Check for updates again before reopening the app. '+retained},attempt);return;
        }
        reload();
        // Navigation can be cancelled by the browser or a beforeunload prompt.
        // Keep an explicit reopen action rather than an endless opening spinner.
        present({phase:'ready',title:'Opening the updated app',message:'If this page stays open, choose Open updated app again. '+retained,action:'Open updated app'},attempt);return;
      }
      if(!online()){present({phase:'offline',title:'Waiting for a connection',message:'Connect to the internet, then try again. '+retained},attempt);return;}
      phase(attempt,'checking','Checking for updates','Looking for the Cashier app installation.');
      const value=await bounded(lookupRegistration(),limits.lookup,'lookup');
      if(disposed || active!==attempt)return;
      if(!value){present({phase:'error',title:'App setup is incomplete',message:'Reopen the app when online to finish installation. '+retained},attempt);return;}
      observeRegistration(value);
      if(blocked(attempt) || showReady(attempt))return;
      let worker=value.installing;
      if(!worker || worker.state==='redundant'){
        phase(attempt,'checking','Checking for updates','Contacting the update service.');
        const previousWorker=latestWorker;
        await bounded(updateRegistration(value),limits.check,'check');
        if(disposed || active!==attempt)return;
        if(blocked(attempt) || showReady(attempt))return;
        worker=value.installing || (latestWorker!==previousWorker?latestWorker:null);
        if(worker?.state==='redundant')throw new Error('The update could not be installed.');
      }
      if(worker && worker.state!=='redundant'){
        watch(worker);phase(attempt,'downloading','Downloading the Cashier update','Waiting for all required app files to finish downloading.');
        await waitWorker(worker,false);
        if(disposed || active!==attempt || blocked(attempt))return;
        if(worker.state==='installed' && !value.waiting)restartWorker=null;
        if(worker.state==='activated'){
          restartWorker=worker;
          if(serviceWorker?.controller!==worker){
            phase(attempt,'downloading','Finishing the Cashier update','The files are installed. Waiting for the browser to confirm the updated app is ready.');
            await waitWorker(worker,true,'download');
            if(disposed || active!==attempt || blocked(attempt))return;
          }
        }
        if(showReady(attempt))return;
        // installed is the browser's confirmation of the complete SW shell,
        // even in the small interval before registration.waiting is assigned.
        if(worker.state==='installed'){
          installedWorker=worker;
          present({phase:'ready',title:'Cashier update ready',message:'Finish or park your order, then open the updated app. '+retained,action:'Update app'},attempt);return;
        }
      }
      present({phase:'current',title:'Your Cashier app is up to date',message:'The update check finished. You are ready to continue.',action:'Check again'},attempt);
    }).catch(error=>{if(!disposed && active===attempt)failure(error,attempt);}).finally(()=>{
      if(active===attempt){stopTick();active=null;}
    });
    return attempt.promise;
  }
  const check=({silent=false}={})=>run('check',silent);
  cleanups.push(listen(serviceWorker,'controllerchange',()=>{
    const worker=serviceWorker?.controller;watch(worker);
    if(initialController && worker && worker!==initialController){restartWorker=worker;if(!active)showReady();}
  }));
  return {
    check,
    open:()=>run('open'),
    observeRegistration,
    primeRegistration:()=>{void lookupRegistration().catch(()=>{});},
    notice:(phase,title,message)=>{if(!active && state.phase!=='ready')publish({phase,title,message,action:'Check for update'});},
    get state(){return {...state};},
    dispose(){disposed=true;active=null;stopTick();for(const cancel of [...pendingWaits])cancel();for(const stop of [...cleanups,...watched.values()])stop();}
  };
}

export function cashierWorkflowBlocker(window,document,closing=false){
  const existing=updateBlocker(window);if(existing)return existing;
  if(closing || window.expenseSubmissionFlight)return 'Please wait for shift closing or expense submission to finish before updating.';
  // Inspect visibility only: no PIN, payment, attendance or draft field values
  // are read. The ordinary sign-in overlay is intentionally not a work dialog.
  for(const id of ['checkoutModal','endShiftModal','expenseModal','shiftModal','remittanceModal']){
    const node=document.getElementById(id);if(!node || node.hidden)continue;
    const visible=typeof node.getClientRects==='function'?node.getClientRects().length>0:!!node.style?.display && node.style.display!=='none';
    if(visible)return 'Finish or close the open checkout, shift, expense or remittance form before updating.';
  }
  return '';
}

export function installCashierUpdates({window=globalThis.window, document=window.document, navigator=window.navigator,
  storage=window.localStorage, release=CASHIER_RELEASE, timeouts}={}){
  if(window.cashierAppUpdates)return window.cashierAppUpdates;
  const banner=document.getElementById('updateAppBanner');if(!banner)return null;
  banner.removeAttribute('onclick');banner.className='cashier-update-notice';document.body.append(banner);
  banner.setAttribute('role','region');banner.setAttribute('aria-label','Cashier app update');
  banner.innerHTML='<div class="cashier-update-symbol" id="cashierUpdateSymbol" aria-hidden="true">↻</div><div class="cashier-update-copy"><div role="status" aria-live="polite" aria-atomic="true"><strong id="cashierUpdateTitle"></strong><span id="cashierUpdateText"></span></div><span id="cashierUpdateElapsed" aria-live="off"></span><div class="cashier-update-progress" id="cashierUpdateProgress" role="progressbar" aria-label="App update in progress" hidden><i></i></div></div><button id="cashierUpdateClose" aria-label="Dismiss update notice">×</button><div class="cashier-update-actions"><button class="cashier-button" id="cashierUpdateDismiss">Dismiss</button><button class="cashier-button primary" id="cashierUpdateNow">Check for update</button></div>';
  const el=id=>document.getElementById(id), text=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
  let closing=0, dismissed=false, renderedPhase;
  const originalClose=window.MASTER_CloseShift;
  const trackedClose=typeof originalClose==='function'?function(...args){
    closing++;
    try{return Promise.resolve(originalClose.apply(this,args)).finally(()=>closing--);}
    catch(error){closing--;throw error;}
  }:null;
  if(trackedClose)window.MASTER_CloseShift=trackedClose;
  const controller=createCashierUpdateController({serviceWorker:navigator.serviceWorker,online:()=>navigator.onLine!==false,
    blocker:()=>cashierWorkflowBlocker(window,document,closing>0),timeouts,
    reload:()=>{try{if(window.TARGET_UPDATE_VERSION)storage.setItem('takodeal_local_version',String(window.TARGET_UPDATE_VERSION));}catch{}window.location.reload();},
    render:view=>{
      if(renderedPhase!==view.phase)dismissed=false;renderedPhase=view.phase;
      banner.dataset.updateState=view.phase;banner.style.display=dismissed?'none':'flex';
      window.CASHIER_UPDATE_WAITING=!['idle','current','updated'].includes(view.phase);
      text('cashierUpdateTitle',view.title);text('cashierUpdateText',view.message);text('cashierUpdateSymbol',['current','updated'].includes(view.phase)?'✓':'↻');
      text('cashierUpdateElapsed',view.busy?`Elapsed: ${view.elapsed} seconds`:'');
      text('cashierUpdateNow',view.action);el('cashierUpdateNow').disabled=view.busy;
      el('cashierUpdateProgress').hidden=!view.busy;el('cashierUpdateProgress').setAttribute('aria-label',view.title);el('cashierUpdateProgress').setAttribute('aria-busy',String(view.busy));
    }
  });
  el('cashierUpdateDismiss').onclick=el('cashierUpdateClose').onclick=()=>{dismissed=true;banner.style.display='none';};
  el('cashierUpdateNow').onclick=()=>{dismissed=false;return controller.state.phase==='ready'?controller.open():controller.check();};
  window.showCashierUpdateNotice=(...args)=>controller.notice(...args);
  window.checkCashierUpdate=window.forceAppUpdate=window.manualHardUpdate=window.executeCacheWipe=()=>{dismissed=false;return controller.check();};
  const stopReady=listen(window,'cashier-worker-ready',event=>controller.observeRegistration(event.detail));
  const interval=window.setInterval(()=>{if(document.visibilityState==='visible' && navigator.onLine!==false)void controller.check({silent:true});},15*60*1000);
  const dispose=controller.dispose;controller.dispose=()=>{stopReady();window.clearInterval(interval);dispose();if(trackedClose && window.MASTER_CloseShift===trackedClose)window.MASTER_CloseShift=originalClose;if(window.cashierAppUpdates===controller)delete window.cashierAppUpdates;};
  window.cashierAppUpdates=controller;
  try{if(storage.getItem('takodeal_cashier_seen_release')!==release){controller.notice('updated','Cashier update checks improved','Check here to see update progress. '+retained);storage.setItem('takodeal_cashier_seen_release',release);}}catch{}
  controller.primeRegistration();return controller;
}
