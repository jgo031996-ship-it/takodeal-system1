import {waitForAppUpdate} from './owner-app-update.js';

// App-file maintenance is available before account verification. It never
// reads credentials, changes storage, or opens the protected workspace.
export function installOwnerLoginUpdate(w,d,nav,{getRegistration=()=>nav.serviceWorker.getRegistration(),waitForUpdate=waitForAppUpdate,timeoutMs=40000,slowMs=12000}={}){
 const button=d.getElementById('loginUpdateButton'),status=d.getElementById('loginUpdateStatus'),overlay=d.getElementById('loginOverlay');
 if(!button||!status||!overlay)return {dispose(){}};
 const progress=d.getElementById('loginUpdateProgress');
 let busy=false,disposed=false,attempt=null;
 const locked=()=>!overlay.hidden&&overlay.style.display!=='none'&&!w.isLoggingIn;
 const say=(message,error=false)=>{if(disposed)return;status.textContent=message;status.classList.toggle('error',error);};
 async function update(){
  if(disposed||busy||!locked())return;
  if(!nav.onLine){say('Connect to the internet, then choose Update Owner App.',true);return;}
  if(!nav.serviceWorker){say('Open the Owner app in Edge or Chrome to update its saved app files.',true);return;}
  const current={controller:new AbortController(),slow:false,timedOut:false};attempt=current;
  const live=()=>!disposed&&attempt===current&&!current.controller.signal.aborted;
  let phase='Finding this device’s saved Owner app files…',removeAbort=()=>{},retry=false;
  const paint=()=>{if(live())say(phase+(current.slow?' This is taking longer than usual. This check will stop after '+Math.ceil(timeoutMs/1000)+' seconds if it cannot finish.':''));};
  busy=true;button.disabled=true;button.textContent='Updating Owner App…';button.setAttribute('aria-busy','true');if(progress)progress.hidden=false;paint();
  const deadline=new Promise((_,reject)=>{
   const canceled=()=>reject(Error('Update check canceled.'));
   current.controller.signal.addEventListener('abort',canceled,{once:true});removeAbort=()=>current.controller.signal.removeEventListener('abort',canceled);
   current.timer=w.setTimeout(()=>{current.timedOut=true;current.controller.abort();},timeoutMs);
  });
  current.slowTimer=w.setTimeout(()=>{current.slow=true;paint();},slowMs);
  try{
   await Promise.race([deadline,(async()=>{
    const registration=await getRegistration();
    // A timed-out lookup must never start a later worker update, including
    // after the user has already begun a fresh explicit attempt.
    if(!live())throw Error('Update check canceled.');
    if(!registration)throw Error('App files are still being prepared. Wait a moment, then try again.');
    if(!locked())return;
    await waitForUpdate(registration,{serviceWorker:nav.serviceWorker,signal:current.controller.signal,onProgress:event=>{if(live()&&event?.message){phase=event.message;paint();}}});
   })()]);
   if(!live())return;
   // Signing in may complete while an update downloads. Never discard a
   // newly opened workspace or reload during an in-progress PIN unlock.
   if(!locked()){say('The workspace is opening. Save your work before reloading for the update.');void w.ownerUpdateNotice?.check?.();return;}
   if(!nav.onLine)throw Error('The connection was lost. Reconnect, then try updating again.');
   say('App files are ready. Reloading the Owner app…');w.location.reload();
  }catch{
   if(!disposed&&attempt===current){retry=true;say(current.timedOut?'The update check stopped after '+Math.ceil(timeoutMs/1000)+' seconds. Your page is still open. Check your connection and choose Retry update.':'Unable to confirm the update. Check your connection and choose Retry update.',true);}
  }
  finally{
   removeAbort();w.clearTimeout(current.timer);w.clearTimeout(current.slowTimer);current.controller.abort();
   if(attempt===current){attempt=null;busy=false;if(!disposed){button.disabled=false;button.textContent=retry?'Retry update':'Update Owner App';button.removeAttribute('aria-busy');if(progress)progress.hidden=true;}}
  }
 }
 button.addEventListener('click',update);
 return {dispose(){disposed=true;button.removeEventListener('click',update);attempt?.controller.abort();}};
}
