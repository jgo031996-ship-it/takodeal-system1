import {waitForAppUpdate} from './owner-app-update.js';

export const OWNER_DOCUMENT_RELEASE='takodeal-manager-core-v143-actual-prep-warnings-20261111-r1';
const installations=new WeakMap();
const validRelease=value=>typeof value==='string'&&/^takodeal-manager-core-v[1-9]\d{0,5}-[a-z0-9][a-z0-9-]{0,100}$/.test(value);
const noticeText='App update ready. Save open edits, then reload to use the latest fixes.';

// The document's imported generation stays fixed for this window. A new worker
// can replace its cache/controller, but cannot replace already imported code.
export function installOwnerUpdateNotice(w,d,nav,registration,{loadedRelease=OWNER_DOCUMENT_RELEASE,timeoutMs=3000,updateTimeoutMs=40000,slowMs=12000,waitForUpdate=waitForAppUpdate}={}){
 if(installations.has(d))return installations.get(d);
 const serviceWorker=nav?.serviceWorker,Channel=w.MessageChannel;
 if(!serviceWorker||typeof serviceWorker.addEventListener!=='function'||typeof Channel!=='function'||!validRelease(loadedRelease))return {check:async()=>null,dispose(){}};
 let stopped=false,seenUpdate=false,dirty=false,editEpoch=0,matchEpoch=0,busy=false,confirmation=false,checkEpoch=0,banner=null,message=null,button=null,progress=null,attempt=null,retry=false;
 const listeners=[],ports=new Set(),pending=new Map(),watched=new WeakSet();
 const listen=(target,type,fn)=>{target?.addEventListener?.(type,fn);listeners.push(()=>target?.removeEventListener?.(type,fn));};
 const visible=node=>{if(!node||node.hidden)return false;const style=w.getComputedStyle?.(node);return style?.display!=='none'&&style?.visibility!=='hidden'&&Boolean(node.getClientRects?.().length||node.open);};
 const dialogs=()=>[...d.querySelectorAll('dialog[open], [role="dialog"], .modal, .modal-overlay, .swal2-container, [id$="Modal"]')].filter(node=>node!==banner&&visible(node));
 function resetNotice(){matchEpoch++;seenUpdate=false;confirmation=false;retry=false;attempt?.controller.abort();banner?.remove();banner=null;message=null;button=null;progress=null;}
 function paint(text=busy?attempt?.message||'Checking the Owner app update…':noticeText){
  if(stopped)return;
  if(!banner){
   banner=d.createElement('aside');banner.setAttribute('data-owner-update-notice','');banner.setAttribute('aria-label','App update');banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
   Object.assign(banner.style,{position:'fixed',left:'12px',right:'12px',bottom:'12px',zIndex:'2147483000',maxWidth:'760px',margin:'0 auto',padding:'14px 16px',border:'1px solid #b7d3c5',borderRadius:'12px',background:'#f4fbf6',color:'#173f32',boxShadow:'0 6px 24px #0003',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap',font:'14px/1.5 system-ui, sans-serif'});
   message=d.createElement('span');Object.assign(message.style,{flex:'1 1 320px'});
   button=d.createElement('button');button.type='button';Object.assign(button.style,{padding:'10px 14px',border:'0',borderRadius:'8px',background:'#14634f',color:'#fff',font:'600 14px system-ui, sans-serif',cursor:'pointer'});
   progress=d.createElement('progress');progress.setAttribute('aria-label','Owner app update');Object.assign(progress.style,{width:'100%',height:'8px',flexBasis:'100%',accentColor:'#14634f'});
   banner.append(message,button,progress);d.body.append(banner);listen(button,'click',reload);
  }
  message.textContent=text;button.textContent=busy?'Preparing update…':confirmation?'I saved my edits — reload':retry?'Retry update':'Reload updated app';button.disabled=busy;progress.hidden=!busy;
 }
 function changed(event){
  const target=event.target;if(!target||banner?.contains(target)||!['INPUT','TEXTAREA','SELECT'].includes(target.tagName)&&!target.isContentEditable)return;
  if(target.type==='password'||target.id==='managerPinInput'||target.closest?.('#loginOverlay'))return;
  // Never retain or inspect the field value, password, PIN or business data.
  dirty=true;editEpoch++;confirmation=false;if(seenUpdate&&!busy)paint();
 }
 function ask(worker){
  if(!worker||typeof worker.postMessage!=='function')return Promise.resolve(null);
  if(pending.has(worker))return pending.get(worker);
  const task=new Promise(resolve=>{
   let channel,timer,done=false;
   const finish=value=>{if(done)return;done=true;w.clearTimeout(timer);if(channel){ports.delete(cancel);channel.port1.onmessage=null;channel.port1.close();channel.port2.close();}resolve(value);};
   const cancel=()=>finish(null);
   try{
    channel=new Channel();ports.add(cancel);timer=w.setTimeout(cancel,timeoutMs);
    channel.port1.onmessage=event=>{const data=event.data;if(stopped||serviceWorker.controller!==worker||data?.type!=='OWNER_RELEASE'||!validRelease(data.release)){finish(null);return;}finish(data.release);};
    channel.port1.start?.();worker.postMessage({type:'OWNER_RELEASE_CHECK'},[channel.port2]);
   }catch{finish(null);}
  });
  pending.set(worker,task);task.finally(()=>{if(pending.get(worker)===task)pending.delete(worker);});return task;
 }
 async function check(){
  const epoch=++checkEpoch,worker=serviceWorker.controller,release=await ask(worker);
  if(stopped||epoch!==checkEpoch||serviceWorker.controller!==worker)return null;
  if(release===loadedRelease)resetNotice();
  else if(release){seenUpdate=true;paint();}
  return release;
 }
 async function reload(){
  if(stopped||busy||!seenUpdate)return;
  if((dirty||dialogs().length)&&!confirmation){confirmation=true;paint('Save your open edits first. When they are saved, confirm below to reload the updated app.');return;}
  const epoch=editEpoch,generation=matchEpoch,open=new Set(dialogs()),current={controller:new AbortController(),message:'Checking for the latest Owner app files…',timedOut:false};attempt=current;busy=true;retry=false;paint();
  const live=()=>!stopped&&attempt===current&&!current.controller.signal.aborted&&seenUpdate&&generation===matchEpoch;
  let removeAbort=()=>{};
  const deadline=new Promise((_,reject)=>{const canceled=()=>reject(Error('Update check canceled.'));current.controller.signal.addEventListener('abort',canceled,{once:true});removeAbort=()=>current.controller.signal.removeEventListener('abort',canceled);current.timer=w.setTimeout(()=>{current.timedOut=true;current.controller.abort();},updateTimeoutMs);});
  current.slowTimer=w.setTimeout(()=>{if(live()){current.message+=' This is taking longer than usual. This check will stop after '+Math.ceil(updateTimeoutMs/1000)+' seconds if it cannot finish.';paint();}},slowMs);
  try{
   await Promise.race([deadline,(async()=>{
   await waitForUpdate(registration,{serviceWorker,signal:current.controller.signal,onProgress:event=>{if(live()&&event?.message){current.message=event.message;paint();}}});
   if(!live())return;
   if(editEpoch!==epoch||dialogs().some(node=>!open.has(node))){confirmation=false;paint('Your open work changed while the update was checked. Save it before reloading.');return;}
   const worker=serviceWorker.controller,release=await ask(worker);
   if(!live())return;
   if(editEpoch!==epoch||dialogs().some(node=>!open.has(node))){confirmation=false;paint('Your open work changed while the update was checked. Save it before reloading.');return;}
   if(!release||serviceWorker.controller!==worker)throw Error('The updated app files could not be confirmed. Keep your edits open and try again.');
   if(release===loadedRelease){resetNotice();return;}
   w.location.reload();
   })()]);
  }catch(error){if(!stopped&&attempt===current&&seenUpdate&&generation===matchEpoch){retry=true;paint(current.timedOut?'The update check stopped after '+Math.ceil(updateTimeoutMs/1000)+' seconds. Keep your edits open and choose Retry update.':error?.message||'The update could not be confirmed. Keep your edits open and choose Retry update.');}}
  finally{removeAbort();w.clearTimeout(current.timer);w.clearTimeout(current.slowTimer);current.controller.abort();if(attempt===current){attempt=null;busy=false;if(!stopped&&button){button.disabled=false;button.textContent=confirmation?'I saved my edits — reload':retry?'Retry update':'Reload updated app';progress.hidden=true;}}}
 }
 function watch(){
  const worker=registration?.installing||registration?.waiting;
  if(worker&&!watched.has(worker)){watched.add(worker);listen(worker,'statechange',()=>{if(['installed','activated'].includes(worker.state))void check();});}
  void check();
 }
 listen(d,'input',changed);listen(d,'change',changed);listen(registration,'updatefound',watch);listen(serviceWorker,'controllerchange',watch);
 const installation={check,dispose(){if(stopped)return;stopped=true;checkEpoch++;attempt?.controller.abort();for(const cancel of [...ports])cancel();for(const remove of listeners)remove();banner?.remove();installations.delete(d);}};
 installations.set(d,installation);watch();return installation;
}
