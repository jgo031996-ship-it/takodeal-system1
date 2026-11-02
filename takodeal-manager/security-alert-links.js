import {canOpenWorkspacePage,canOpenInventoryTab,fullWorkspaceAccess} from './workspace-access-model.js';
export const escapeSecurityAlertText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const clean=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value)?value:null;
const receipt=value=>typeof value==='string'&&/^\d{8}-[A-Za-z0-9_-]{1,120}$/.test(value)?value:null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value))?Number(value):null;
const money=value=>numeric(value)!==null?'₱'+numeric(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):'Not recorded';
function receiptDay(value){if(!value)return null;const text=value.slice(0,8),iso=text.slice(0,4)+'-'+text.slice(4,6)+'-'+text.slice(6,8),date=new Date(iso+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===iso?iso:null;}
export function securityAlertDay(value){if(value===null||value===undefined||value===''||typeof value==='boolean')return null;let date;try{date=value?.toDate?.()||new Date(value?.seconds!=null?value.seconds*1000:value);}catch{return null;}if(!Number.isFinite(+date))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function securityAlertTarget(alert){
 const message=clean(alert?.message,8000),type=clean(alert?.type,80),branch=clean(alert?.branch,120);
 const receiptId=receipt(alert?.receiptId)||receipt(/\b(?:Receipt\s+|Order\s*#)(\d{8}-[A-Za-z0-9_-]+)/i.exec(message)?.[1]);
 const shiftId=id(alert?.shiftId)||id(alert?.previousShiftId),saleId=id(alert?.saleId);
 const ingredients=Array.isArray(alert?.inventoryIssues)?alert.inventoryIssues.map(i=>({name:clean(i?.ingredientName,180),quantity:typeof i?.quantity==='number'?i.quantity:clean(i?.quantity,40),reason:clean(i?.reason,160),matches:Number.isSafeInteger(i?.matches)?i.matches:null})).filter(i=>i.name).slice(0,50):[];
 // Earlier alerts stored the receipt and ingredient only in their message.
 if(!ingredients.length&&/stock deductions need review/i.test(message)){const part=message.split(/Stock deductions need review:\s*/i)[1]?.split(/\. These unmatched quantities/i)[0];for(const match of part?.matchAll(/(?:^|,\s*)([^()]{1,180})\s*\(([^;()]{1,30});\s*([^,()]{1,100}),\s*(\d+) matches\)/g)||[])ingredients.push({name:clean(match[1],180),quantity:clean(match[2],40),reason:clean(match[3],160),matches:Number(match[4])});}
 const kind=type==='INVENTORY_REVIEW'||ingredients.length?'inventory':shiftId?'shift':receiptId||saleId?'sale':'details';
 return {kind,branch,type,message,receiptId,saleId,shiftId,ingredients,day:receiptDay(receiptId)||securityAlertDay(alert?.timestamp),id:clean(alert?.id,200)};
}
function permittedBranch(w,branch){const s=w.sessionUser;if(!branch)return false;if(fullWorkspaceAccess(s))return true;if(s?.isFranchisee)return s.branch===branch;return Array.isArray(s?.allowedBranches)&&s.allowedBranches.some(b=>b===branch||String(b).toLowerCase()==='all');}
function actor(w){const u=w.auth?.currentUser,s=w.sessionUser;if(!u?.uid||s?.uid!==u.uid||!canOpenWorkspacePage(s,'alerts'))throw Error('Unlock an account with Security Alerts access.');return JSON.stringify([u.uid,s.uid,s.email,s.permissions,s.allowedBranches,s.branch,s.isFranchisee]);}
function allowed(w,target){actor(w);if(!permittedBranch(w,target.branch))throw Error('This alert is outside your permitted branches.');}
async function sourceRead(work,{setTimeout:delay=setTimeout,clearTimeout:cancel=clearTimeout}={}){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=delay(()=>reject(Error('The source check took too long. Reconnect and reopen this alert.')),10000);})]);}finally{cancel(timer);}}
const confirmed=s=>{if(!s||s.metadata?.fromCache||s.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the saved source record.');return s;};
export async function loadSecurityAlertContext(w,alert){
 const target=securityAlertTarget(alert);allowed(w,target);const identity=actor(w),guard=()=>{if(actor(w)!==identity)throw Error('The account changed. Reopen this alert.');allowed(w,target);};
 const result={target,source:null,sourceId:null,note:null};
 const table=target.shiftId?'shifts':target.saleId||target.receiptId?'sales':null,route=table==='shifts'?'zreadings':'history';
 if(!table)return result;if(!canOpenWorkspacePage(w.sessionUser,route)){result.note='The source requires '+(table==='shifts'?'Z-Reading Reports':'Sales History')+' access. Ask the Owner to review this record.';return result;}
 const sourceId=table==='shifts'?target.shiftId:target.saleId;
 try{
  let records;
  if(sourceId){const snap=confirmed(await sourceRead(()=>w.getDocFromServer(w.doc(w.db,table,sourceId)),w));guard();records=snap.exists()?[{...snap.data(),id:snap.id||sourceId}]:[];}
  else {const snap=confirmed(await sourceRead(()=>w.getDocsFromServer(w.query(w.collection(w.db,'sales'),w.where('branch','==',target.branch),w.where('receiptId','==',target.receiptId),w.limit(2))),w));guard();records=snap.docs.map(doc=>({...doc.data(),id:doc.id}));}
  if(records.length!==1){result.note=records.length?'More than one saved receipt matches. Review Sales History before deciding.':'The linked record was not found in live data. It may be archived; the alert remains on file.';return result;}
  const source=records[0];if(source.branch!==target.branch)throw Error('The source branch does not match this alert. Review the reference with HQ.');if(table==='sales'&&target.receiptId&&source.receiptId!==target.receiptId)throw Error('The source receipt does not match this alert. Review it with HQ.');
  result.source=source;result.sourceId=source.id;result.target.day=securityAlertDay(table==='shifts'?source.startTime:source.timestamp)||target.day;return result;
 }catch(error){guard();result.note=error.message||'The saved source could not be confirmed.';return result;}
}
function setFilter(d,id,value){const node=d.getElementById(id);if(!node)return false;if(node.tagName==='SELECT'&&value&&!Array.from(node.options||[]).some(o=>o.value===value)){const option=d.createElement('option');option.value=value;option.textContent=value;node.append(option);}node.value=value;return true;}
export function navigateSecurityAlertSource(w,d,target,where,{ingredient=null}={}){
 allowed(w,target);
 if(where==='inventory'){
  if(!canOpenInventoryTab(w.sessionUser,'Overview'))throw Error('Inventory Overview access is required for this ingredient.');
  setFilter(d,'invBranchFilter',target.branch);setFilter(d,'invCategoryFilter','All');setFilter(d,'liveInvSearch',clean(ingredient,180));w.switchInvTab('Overview');return {route:'inventory',branch:target.branch,ingredient:clean(ingredient,180)};
 }
 if(where==='history'){
  if(!canOpenWorkspacePage(w.sessionUser,'history'))throw Error('Sales History access is required.');
  if(!target.day)throw Error('This alert has no reliable work date. Check its source details first.');
  setFilter(d,'histBranchFilter',target.branch);setFilter(d,'histStartDate',target.day);setFilter(d,'histEndDate',target.day);setFilter(d,'histArchiveSelect','LIVE');setFilter(d,'histShiftSelect','');const dates=d.getElementById('histDateFilters');if(dates)dates.style.display='flex';
  const identity=actor(w);w.switchView('history');w.switchHistoryTab?.('Tx');
  // The actual History tab switcher changes visibility only; explicitly load this date's transactions once.
  const current=()=>{try{return (!d.getElementById('view-history')||d.getElementById('view-history').classList.contains('active'))&&actor(w)===identity&&permittedBranch(w,target.branch)&&canOpenWorkspacePage(w.sessionUser,'history')&&d.getElementById('histBranchFilter')?.value===target.branch&&d.getElementById('histStartDate')?.value===target.day&&d.getElementById('histEndDate')?.value===target.day;}catch{return false;}};
  void Promise.resolve().then(()=>{if(current()&&typeof w.loadSalesHistoryTab==='function')return sourceRead(()=>{if(current())return w.loadSalesHistoryTab();},w);}).catch(error=>{if(current())w.ManagerUI?.notify?.('Sales History could not refresh: '+error.message);});
  return {route:'history',branch:target.branch,day:target.day,receiptId:target.receiptId};
 }
 if(where==='zreadings'){
  if(!canOpenWorkspacePage(w.sessionUser,'zreadings'))throw Error('Z-Reading Reports access is required.');
  setFilter(d,'zReadingBranchFilter',target.branch);setFilter(d,'zReadingDateFilter',target.day||'');w.switchView('zreadings');return {route:'zreadings',branch:target.branch,day:target.day,shiftId:target.shiftId};
 }
 throw Error('No verified source page was recorded for this alert.');
}
export function installSecurityAlertLinks(w=window,d=document){
 if(w.securityAlertLinks)return w.securityAlertLinks;const bound=new WeakSet();let dialog,body,status,actions,epoch=0,openedActor;
 const node=(tag,text,cls)=>{const el=d.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;};
 function ensure(){if(dialog)return;dialog=node('dialog',undefined,'security-issue-dialog');dialog.setAttribute('aria-labelledby','securityIssueTitle');const header=node('header'),title=node('h2','Review security alert');title.id='securityIssueTitle';const close=node('button','Close');close.type='button';close.onclick=()=>{epoch++;dialog.close();};header.append(title,close);status=node('p',undefined,'security-issue-status');status.setAttribute('role','status');body=node('div',undefined,'security-issue-body');actions=node('footer');dialog.append(header,status,body,actions);d.body.append(dialog);dialog.addEventListener('cancel',()=>{epoch++;});}
 function pair(label,value,host=body){const line=node('p');line.append(node('strong',label+': '),node('span',value??'Not recorded'));host.append(line);}
 function button(label,action,host=actions){const b=node('button',label,'security-issue-button');b.type='button';b.onclick=()=>{try{if(actor(w)!==openedActor)throw Error('The account changed. Reopen this alert.');const result=action();dialog.close();return result;}catch(error){status.textContent=error.message;}};host.append(b);return b;}
 async function open(alertId){
  const alert=(w.globalSecurityAlerts||[]).find(a=>a.id===alertId);if(!alert)throw Error('Refresh Security Alerts before opening this issue.');const target=securityAlertTarget(alert);allowed(w,target);ensure();openedActor=actor(w);const token=++epoch;body.replaceChildren();actions.replaceChildren();status.textContent='Checking the saved source. Opening an issue does not resolve it or change stock, cash or payroll.';if(!dialog.open)dialog.showModal();pair('Branch',target.branch);pair('Alert',target.message);if(target.receiptId)pair('Receipt',target.receiptId);if(target.shiftId)pair('Shift ID',target.shiftId);if(alert.cashier)pair('Reported by',clean(alert.cashier,180));
  let result;try{result=await loadSecurityAlertContext(w,alert);}catch(error){if(token!==epoch||!dialog.open)return false;body.replaceChildren();actions.replaceChildren();status.textContent=error.message||'Reopen this alert after unlocking the approved account.';return false;}if(token!==epoch||!dialog.open)return false;if(actor(w)!==openedActor){body.replaceChildren();actions.replaceChildren();status.textContent='The account changed. Close and reopen this alert.';return false;}
  const {source}=result;if(result.note)pair('Source check',result.note);
  if(source&&target.shiftId){const expected=numeric(source.expectedCash??source.expected),declared=numeric(source.declaredCash??source.actualCash),difference=numeric(source.difference)??(expected!==null&&declared!==null?declared-expected:null);pair('Expected drawer cash',money(expected));pair('Declared drawer cash',money(declared));pair('Difference',money(difference));pair('Saved status',clean(source.status,80));}
  if(source&&!target.shiftId){pair('Saved status',clean(source.status,80)||'Not recorded');pair('Total',money(source.netTotal??source.totalAmount));const items=Array.isArray(source.cart)?source.cart:Array.isArray(source.items)?source.items:[];if(items.length){const list=node('ul');for(const item of items.slice(0,100))list.append(node('li',String(item.qty??item.quantity??'?')+' × '+clean(item.name||item.itemName,180)));body.append(list);}}
  if(target.ingredients.length){const heading=node('h3','Stock deductions that need review');body.append(heading);for(const item of target.ingredients){const card=node('article',undefined,'security-issue-ingredient');card.append(node('strong',item.name),node('p',String(item.quantity??'Quantity not recorded')+' · '+item.reason+(item.matches!==null?' · '+item.matches+' matches':'')));if(canOpenInventoryTab(w.sessionUser,'Overview'))button('Open '+item.name,()=>navigateSecurityAlertSource(w,d,result.target,'inventory',{ingredient:item.name}),card);body.append(card);}}
  if(target.receiptId&&canOpenWorkspacePage(w.sessionUser,'history')&&result.target.day)button('Open Sales History · '+target.receiptId,()=>navigateSecurityAlertSource(w,d,result.target,'history'));
  if(target.shiftId&&canOpenWorkspacePage(w.sessionUser,'zreadings'))button('Open Z-Reading Reports',()=>navigateSecurityAlertSource(w,d,result.target,'zreadings'));
  if(!target.ingredients.length&&!target.receiptId&&!target.shiftId)pair('Reference','This older alert has no verified source link. Review the message with the branch before marking it resolved.');
  status.textContent='Review the source first, then return to Security Alerts to choose Resolve. This view makes no changes.';return true;
 }
 function bind(tbody){if(!tbody||bound.has(tbody))return;bound.add(tbody);tbody.addEventListener('click',event=>{const b=event.target.closest?.('[data-alert-issue]');if(!b||!tbody.contains(b))return;event.preventDefault();b.disabled=true;Promise.resolve(open(b.dataset.alertIssue)).catch(error=>w.ManagerUI?.notify?.(error.message)).finally(()=>{b.disabled=false;});});}
 const controller={open,bind};w.securityAlertLinks=controller;return controller;
}
