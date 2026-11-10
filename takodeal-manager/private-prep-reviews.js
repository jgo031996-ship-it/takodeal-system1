import {canOpenWorkspacePage,canOpenInventoryTab} from './workspace-access-model.js';
import {navigateSecurityAlertSource} from './security-alert-links.js';

export const PRIVATE_PREP_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/prep/';
const OWNER='jgo031996@gmail.com';
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
const fields=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max,{empty=false,multiline=false}={})=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const summaryKeys=['operationId','branch','outputInventoryId','outputName','qty','status','stockPosted','createdAt'];
function summary(value){
 if(!fields(value,summaryKeys)||!id(value.operationId)||!id(value.outputInventoryId)||!text(value.branch,128)||value.branch.trim()!==value.branch||/^all$/i.test(value.branch)||!text(value.outputName,160)||typeof value.qty!=='number'||!Number.isFinite(value.qty)||value.qty<=0||value.qty>1e6||value.status!=='Pending'||value.stockPosted!==false||!date(value.createdAt))throw Error('The private prep response could not be confirmed. Refresh after reconnecting.');
 return value;
}
export function validatePrivatePrepPage(value){
 if(!fields(value,['schemaVersion','reviews','hasMore','nextAfterOperationId'])||value.schemaVersion!==1||!Array.isArray(value.reviews)||value.reviews.length>20||typeof value.hasMore!=='boolean')throw Error('The private prep list could not be confirmed.');
 const rows=value.reviews.map(summary);if(new Set(rows.map(row=>row.operationId)).size!==rows.length||value.hasMore&&(rows.length!==20||value.nextAfterOperationId!==rows.at(-1)?.operationId)||!value.hasMore&&value.nextAfterOperationId!==null)throw Error('The private prep page reference could not be confirmed.');
 return value;
}
export function validatePrivatePrepDetail(value,operationId){
 if(!fields(value,['schemaVersion','review'])||value.schemaVersion!==1)throw Error('The private review could not be confirmed.');
 const row=value.review,keys=[...summaryKeys,'declaredName','reason','note','issue','reportedBy','sourceFingerprint'];
 if(!fields(row,keys)||row.operationId!==operationId)throw Error('The private review reference changed. Reopen the saved item.');
 summary(Object.fromEntries(summaryKeys.map(key=>[key,row[key]])));
 const detailKeys=['inventoryId','itemName','ingredientName','role','recordedStock','matches'];
 if(!text(row.declaredName,160)||!text(row.reason,1000,{empty:true})||!text(row.note,500,{empty:true,multiline:true})||!fields(row.issue,['code','message','details'])||!text(row.issue.message,2000)||!/^[-a-z0-9]{1,80}$/.test(row.issue.code)||!plain(row.issue.details)||Object.keys(row.issue.details).some(key=>!detailKeys.includes(key))||!fields(row.reportedBy,['staffId','staffName'])||!id(row.reportedBy.staffId)||!text(row.reportedBy.staffName,200)||!(/^[a-f0-9]{64}$/).test(row.sourceFingerprint))throw Error('The private review details could not be confirmed.');
 for(const[key,entry]of Object.entries(row.issue.details))if(!(['recordedStock','matches'].includes(key)?typeof entry==='number'&&Number.isFinite(entry):key==='inventoryId'?entry===null||id(entry):text(entry,200)))throw Error('The private issue details could not be confirmed.');
 return row;
}

export function installPrivatePrepReviews(w=window,d=document,{fetcher=w.fetch?.bind(w),now=Date.now,setTimer=w.setTimeout?.bind(w)||setTimeout,clearTimer=w.clearTimeout?.bind(w)||clearTimeout,refreshMs=60000,guardMs=1000,timeoutMs=10000}={}){
 if(w.ownerPrepReviews)return w.ownerPrepReviews;
 const host=d.getElementById('privatePrepReviewsHost'),view=d.getElementById('view-alerts');if(!host||!view||typeof fetcher!=='function')return null;
 const node=(tag,value,className)=>{const item=d.createElement(tag);if(value!==undefined)item.textContent=String(value);if(className)item.className=className;return item;};
 const heading=node('div',undefined,'private-prep-heading'),title=node('h3','Private prep reviews'),count=node('span','Not loaded','private-prep-count'),refresh=node('button','Refresh recent','private-prep-button');refresh.type='button';
 heading.append(title,count,refresh);const status=node('p','Unlock the verified Owner account to view private prep reviews.','private-prep-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const notice=node('p',undefined,'private-prep-notice');notice.setAttribute('role','status');notice.hidden=true;
 const list=node('div',undefined,'private-prep-list'),footer=node('div',undefined,'private-prep-actions'),older=node('button','Load older','private-prep-button'),recent=node('button','Back to recent','private-prep-button');older.type=recent.type='button';older.hidden=recent.hidden=true;footer.append(older,recent);
 const details=node('section',undefined,'private-prep-details');details.setAttribute('aria-label','Private prep review details');details.hidden=true;
 host.replaceChildren(heading,status,notice,list,footer,details);host.classList.add('private-prep-reviews');host.hidden=true;
 let stopped=false,epoch=0,key=null,currentActor=null,guardTimer=null,nextRefresh=0,listFlight=null,detailFlight=null,detailId=null,detailEpoch=0,page=0,cursor=null,hasMore=false,held=false,heldScope=null,seenRecent=null,notificationScope=null,panelActive=false,panelVersion=0;
 const controllers=new Set(),listeners=[];
 const listen=(target,type,fn)=>{target?.addEventListener?.(type,fn);listeners.push(()=>target?.removeEventListener?.(type,fn));};
 function identity(){
  const user=w.auth?.currentUser,session=w.sessionUser,overlay=d.getElementById('loginOverlay');
  if(!user?.uid||String(user.email||'').toLowerCase()!==OWNER||user.emailVerified!==true||typeof user.getIdToken!=='function'||!Array.isArray(user.providerData)||!user.providerData.some(provider=>provider.providerId==='google.com')||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==OWNER||session.isOwner!==true||session.isFranchisee||!canOpenWorkspacePage(session,'alerts')||!overlay||overlay.style.display!=='none')return null;
  return{user,session,key:JSON.stringify([user.uid,user.email,user.emailVerified,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches])};
 }
 const visible=()=>!stopped&&d.visibilityState!=='hidden';
 const panelVisible=()=>visible()&&!view.hidden&&view.classList.contains('active')&&view.style.display!=='none';
 function allowed(){const actor=identity();return visible()?actor:null;}
 function capture({requirePanel=false}={}){const actor=allowed();if(!actor||requirePanel&&!panelVisible())throw Error('Unlock the verified Owner account and open Security Alerts.');const generation=epoch,version=panelVersion;return{actor,current(){const current=allowed();if(generation!==epoch||!current||current.user!==actor.user||current.session!==actor.session||current.key!==actor.key||requirePanel&&(!panelVisible()||version!==panelVersion))throw Error('The Owner account or locked workspace changed. Reopen private prep reviews.');}};}
 function closeDetails(){detailEpoch++;detailId=null;details.hidden=true;details.replaceChildren();}
 function clearPanel(){panelVersion++;closeDetails();page=0;cursor=null;hasMore=false;list.replaceChildren();count.textContent='Not loaded';notice.hidden=true;notice.textContent='';older.hidden=recent.hidden=true;}
 function clear(message='Unlock the verified Owner account to view private prep reviews.',{preserveNotice=false,preserveHold=false}={}){
  epoch++;for(const controller of controllers)controller.abort();controllers.clear();listFlight=null;detailFlight=null;if(!preserveNotice){seenRecent=null;notificationScope=null;}if(!preserveHold){held=false;heldScope=null;}nextRefresh=0;key=null;currentActor=null;panelActive=false;clearPanel();refresh.disabled=false;status.textContent=message;
 }
 function errorStatus(error){return error?.status===401||error?.status===403;}
 function showError(error){if(errorStatus(error)){const actor=allowed();clear('Owner access must be confirmed again. Unlock the Owner account, then refresh.');held=true;if(actor){heldScope=actor.key;key=actor.key;currentActor=actor;}return;}status.textContent='Private prep reviews could not refresh. Reconnect, then choose Refresh recent. Any shown records are from the previous confirmed check.';}
 function failure(error,context,generation){if(generation!==epoch)return;try{context.current();}catch{const actor=allowed();if(actor&&actor.user===context.actor.user&&actor.session===context.actor.session&&actor.key===context.actor.key&&!panelVisible()){clearPanel();host.hidden=true;return;}clear();host.hidden=true;return;}showError(error);}
 async function request(route,body,context){
  const controller=new AbortController();controllers.add(controller);let timer;
  const check=()=>{context.current();if(controller.signal.aborted)throw Error('The earlier private request was cancelled.');};
  const work=(async()=>{check();const token=await context.actor.user.getIdToken();check();const url=PRIVATE_PREP_ENDPOINT+route,response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});check();if(response.redirected||response.type==='opaque'||response.url&&response.url!==url)throw Error('The private service address changed.');if(response.status===401||response.status===403)throw Object.assign(Error('Owner access must be confirmed.'),{status:response.status});const raw=await response.text();check();if(raw.length>100000)throw Error('The private response exceeds its safe size.');let value;try{value=JSON.parse(raw);}catch{throw Error('The private service response was incomplete.');}if(!response.ok)throw Object.assign(Error('The private prep request was not confirmed.'),{status:response.status});return value;})();
  work.catch(()=>{});
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(Error('The private check took too long.'));},timeoutMs);})]);}finally{clearTimer(timer);controllers.delete(controller);}
 }
 function renderRows(rows){list.replaceChildren();if(!rows.length)list.append(node('p','No pending prep reviews were returned by this recent check.'));
  for(const row of rows){const card=node('article',undefined,'private-prep-row'),open=node('button','View private issue','private-prep-button');open.type='button';open.onclick=()=>{void api.open(row.operationId);};card.append(node('strong',row.outputName),node('p',row.branch+' · Requested quantity: '+row.qty+' · No stock posted'),node('small',new Date(row.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})),open);list.append(card);}
  count.textContent='Showing '+rows.length+' '+(page?'older reviews · page '+(page+1):'recent reviews');older.hidden=!hasMore;recent.hidden=page===0;
 }
 async function load(mode='recent',automatic=false){
  if(listFlight)return listFlight;let context;try{context=capture({requirePanel:mode==='older'});}catch{return false;}if(w.navigator?.onLine===false){status.textContent='Reconnect to load private prep reviews.';nextRefresh=now()+refreshMs;return false;}
  const after=mode==='older'?cursor:null;if(mode==='older'&&(!after||!hasMore))return false;
  const generation=epoch;refresh.disabled=older.disabled=true;status.textContent='Checking the private Owner review queue…';
  const work=(async()=>{try{const result=validatePrivatePrepPage(await request('reviews',after?{afterOperationId:after}:{},context));context.current();
   const ids=new Set(result.reviews.map(row=>row.operationId));if(!after){const hasNew=seenRecent?[...ids].some(value=>!seenRecent.has(value)):ids.size>0;seenRecent=ids;notificationScope=context.actor.key;if(hasNew){w.ManagerUI?.notify?.('Private prep reviews need attention. Open Security Alerts → Private prep reviews.');notice.textContent=page||detailId?'New recent prep reviews are available. Choose Back to recent or Refresh recent.':'New prep reviews have arrived.';notice.hidden=false;}}
   if(!panelVisible()){status.textContent='Open Security Alerts to view the private prep queue.';return true;}
   if(automatic&&(page>0||detailId)){status.textContent='Recent reviews checked. This loaded page or open detail stays unchanged until you refresh.';return true;}
   if(after){if(result.nextAfterOperationId===after)throw Error('The older-page reference did not advance.');page++;}else{page=0;if(!automatic){notice.hidden=true;notice.textContent='';}}
   cursor=result.nextAfterOperationId;hasMore=result.hasMore;closeDetails();renderRows(result.reviews);status.textContent='Private Owner queue · saved issues only. Nothing here prepares stock or confirms an adjustment.';held=false;return true;
  }catch(error){failure(error,context,generation);return false;}finally{if(generation===epoch){refresh.disabled=older.disabled=false;nextRefresh=now()+refreshMs;}if(listFlight===work)listFlight=null;}})();listFlight=work;return work;
 }
 function pair(label,value){const line=node('p');line.append(node('strong',label+': '),node('span',value));details.append(line);}
 async function open(operationId){
  if(!id(operationId))return false;if(detailFlight?.id===operationId)return detailFlight.work;let context;try{context=capture({requirePanel:true});}catch{return false;}const generation=epoch,detailGeneration=++detailEpoch;detailId=operationId;details.hidden=false;details.replaceChildren(node('p','Loading private review…'));const work=(async()=>{try{const row=validatePrivatePrepDetail(await request('review-read',{operationId},context),operationId);context.current();if(detailGeneration!==detailEpoch)return false;details.replaceChildren();const close=node('button','Close details','private-prep-button');close.type='button';close.onclick=closeDetails;details.append(node('h4',row.outputName),close);pair('Branch',row.branch);if(row.declaredName!==row.outputName)pair('Original requested item',row.declaredName);pair('Requested quantity',row.qty+' · no stock posted');pair('Reported by',row.reportedBy.staffName);pair('Reported at',new Date(row.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}));pair('Saved issue',row.issue.message);if(row.note)pair('Cashier note',row.note);if(row.reason)pair('Saved reason',row.reason);
   for(const[label,field]of[['Ingredient','itemName'],['Ingredient reference','ingredientName'],['Recorded stock at report','recordedStock'],['Matching source records','matches']])if(row.issue.details[field]!==undefined)pair(label,String(row.issue.details[field]));
   details.append(node('p','This is a saved issue report, not a current stock count. Review Live Stocks before making any separately confirmed correction.','private-prep-status'));
   const inventory=node('button','Open current inventory','private-prep-button');inventory.type='button';inventory.onclick=()=>{try{context.current();if(w.isBranchAllowed?.(row.branch)!==true||!canOpenInventoryTab(w.sessionUser,'Overview'))throw Error('This branch or Inventory Overview is outside the current workspace permissions.');navigateSecurityAlertSource(w,d,{branch:row.branch,type:'INVENTORY_REVIEW'},'inventory',{ingredient:row.outputName});check();}catch{status.textContent='The linked inventory page could not open under this account. Recheck the branch and workspace access.';}};details.append(inventory);return true;
  }catch(error){if(generation===epoch&&detailGeneration===detailEpoch){closeDetails();failure(error,context,generation);}return false;}finally{if(detailFlight?.work===work)detailFlight=null;}})();detailFlight={id:operationId,work};return work;
 }
 function schedule(){if(guardTimer!==null)clearTimer(guardTimer);guardTimer=allowed()?setTimer(()=>{guardTimer=null;check();},guardMs):null;}
 function check(){if(stopped)return;const actor=allowed();if(!actor){const owner=identity(),sameHidden=d.visibilityState==='hidden'&&owner&&(key===owner.key||notificationScope===owner.key||heldScope===owner.key);if(key||!host.hidden||notificationScope&&!sameHidden||heldScope&&!sameHidden)clear(undefined,{preserveNotice:!!sameHidden&&notificationScope===owner.key,preserveHold:!!sameHidden&&heldScope===owner.key});host.hidden=true;if(guardTimer!==null)clearTimer(guardTimer);guardTimer=null;return;}if(key!==actor.key||currentActor?.user!==actor.user||currentActor?.session!==actor.session){clear(undefined,{preserveNotice:notificationScope===actor.key,preserveHold:heldScope===actor.key});key=actor.key;currentActor=actor;}
  const inPanel=panelVisible();if(panelActive!==inPanel){clearPanel();panelActive=inPanel;if(inPanel)nextRefresh=0;}host.hidden=!inPanel;
  if(!held&&!listFlight&&now()>=nextRefresh)void load('recent',true);schedule();
 }
 const previousClear=w.clearManagerMemoryCache,clearWrapper=function(...args){clear();return previousClear?.apply(this,args);};w.clearManagerMemoryCache=clearWrapper;
 const api={refresh(){held=false;heldScope=null;return load('recent');},loadOlder:()=>load('older'),open,reset:()=>{clear();check();},check,dispose(){stopped=true;clear();if(guardTimer!==null)clearTimer(guardTimer);guardTimer=null;observer?.disconnect();listeners.splice(0).forEach(stop=>stop());host.hidden=true;if(w.clearManagerMemoryCache===clearWrapper)w.clearManagerMemoryCache=previousClear;if(w.ownerPrepReviews===api)delete w.ownerPrepReviews;}};
 refresh.onclick=()=>{void api.refresh();};recent.onclick=()=>{void api.refresh();};older.onclick=()=>{void api.loadOlder();};
 const observer=typeof w.MutationObserver==='function'?new w.MutationObserver(check):null;observer?.observe(view,{attributes:true,attributeFilter:['class','style','hidden']});const overlay=d.getElementById('loginOverlay');if(overlay)observer?.observe(overlay,{attributes:true,attributeFilter:['class','style','hidden']});
 listen(d,'visibilitychange',check);listen(w,'focus',check);listen(w,'online',()=>{nextRefresh=0;check();});listen(w,'pagehide',()=>{clear();host.hidden=true;});w.ownerPrepReviews=api;check();return api;
}
