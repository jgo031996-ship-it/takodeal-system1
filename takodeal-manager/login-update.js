import {waitForAppUpdate} from './owner-app-update.js';

// App-file maintenance is available before account verification. It never
// reads credentials, changes storage, or opens the protected workspace.
export function installOwnerLoginUpdate(w,d,nav,{getRegistration=()=>nav.serviceWorker.getRegistration(),waitForUpdate=waitForAppUpdate,timeoutMs=40000}={}){
 const button=d.getElementById('loginUpdateButton'),status=d.getElementById('loginUpdateStatus'),overlay=d.getElementById('loginOverlay');
 if(!button||!status||!overlay)return {dispose(){}};
 let busy=false,disposed=false;
 const locked=()=>!overlay.hidden&&overlay.style.display!=='none'&&!w.isLoggingIn;
 const say=(message,error=false)=>{if(disposed)return;status.textContent=message;status.classList.toggle('error',error);};
 async function update(){
  if(disposed||busy||!locked())return;
  if(!nav.onLine){say('Connect to the internet, then choose Update Owner App.',true);return;}
  if(!nav.serviceWorker){say('Open the Owner app in Edge or Chrome to update its saved app files.',true);return;}
  busy=true;button.disabled=true;button.textContent='Updating Owner App…';button.setAttribute('aria-busy','true');say('Checking and preparing the latest app files. This page will reload when ready.');
  let timer;
  try{
   await Promise.race([(async()=>{
    const registration=await getRegistration();
    if(!registration)throw Error('App files are still being prepared. Wait a moment, then try again.');
    await waitForUpdate(registration,{serviceWorker:nav.serviceWorker});
   })(),new Promise((_,reject)=>{timer=w.setTimeout(()=>reject(Error('The update could not be confirmed yet. Check your connection and try again.')),timeoutMs);})]);
   if(disposed)return;
   // Signing in may complete while an update downloads. Never discard a
   // newly opened workspace or reload during an in-progress PIN unlock.
   if(!locked()){say('The workspace is opening. Save your work before reloading for the update.');void w.ownerUpdateNotice?.check?.();return;}
   if(!nav.onLine)throw Error('The connection was lost. Reconnect, then try updating again.');
   say('App files are ready. Reloading the Owner app…');w.location.reload();
  }catch{say('Unable to confirm the update. Check your connection and choose Update Owner App again.',true);}
  finally{w.clearTimeout(timer);busy=false;if(!disposed){button.disabled=false;button.textContent='Update Owner App';button.removeAttribute('aria-busy');}}
 }
 button.addEventListener('click',update);
 return {dispose(){disposed=true;button.removeEventListener('click',update);}};
}
