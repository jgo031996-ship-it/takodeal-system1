import {canOpenWorkspacePage} from './workspace-access-model.js';
const DAY=86400000,WINDOW=14,LIMIT=2000;
const text=value=>typeof value==='string'?value.trim():'';
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number(value).toLocaleString('en-PH',{maximumFractionDigits:2});
const stamp=value=>typeof value?.toMillis==='function'?value.toMillis():value instanceof Date?value.getTime():typeof value?.seconds==='number'?value.seconds*1000:typeof value==='string'?Date.parse(value):NaN;
function measure(value){const name=text(value).toLowerCase();for(const [family,scale,names]of [['mass',1,['g','gram','grams']],['mass',1000,['kg','kilogram','kilograms']],['volume',1,['ml','milliliter','milliliters','millilitre','millilitres']],['volume',1000,['l','liter','liters','litre','litres']],['count',1,['pc','pcs','piece','pieces','unit','units']]])if(names.includes(name))return {family,scale};return name?{family:name,scale:1}:null;}
export function convertRadarQuantity(value,from,to){const a=measure(from),b=measure(to),qty=number(value);return qty===null||!a||!b||a.family!==b.family?null:qty*a.scale/b.scale;}
export function deliveryRadarModel({inventory=[],deliveries=[],logs=[],item,branch,now=Date.now(),complete=true,burnComplete=true,hqComplete=true}){
 const start=now-WINDOW*DAY,matching=inventory.filter(row=>row.name===item),hq=matching.filter(row=>row.branch==='Main Office'),destination=matching.filter(row=>row.branch===branch);
 const source=hq.length===1?hq[0]:null,target=destination.length===1?destination[0]:null,unit=source?.uom||source?.baseUom||target?.uom||target?.baseUom||null;
 let sent=0,branchSent=0,pending=0,unknown=0,last=null;const seen=new Set();
 for(const row of deliveries){
  if(!row?.id||seen.has(row.id))continue;seen.add(row.id);
  const at=stamp(row.timestamp);if(row.item!==item||!Number.isFinite(at)||at<start||at>now)continue;
  const sourceName=text(row.sourceBranch)||text(row.fromBranch)||(/^Main Office\s*(?:➡️?|→|->)/u.test(text(row.details))?'Main Office':'');
  if(sourceName!=='Main Office'||!text(row.toBranch)||['Backloaded','Returned to HQ','Cancelled','Canceled','Draft'].includes(row.status))continue;
  const qty=convertRadarQuantity(row.qty,row.uom,unit);if(qty===null||qty<0){unknown++;continue;}
  sent+=qty;if(row.toBranch===branch){branchSent+=qty;last=last===null?at:Math.max(last,at);if(['In Transit','Arrived'].includes(row.status))pending+=qty;}
 }
 const hqStock=number(source?.currentStock),branchStock=target?convertRadarQuantity(target.currentStock,target.uom||target.baseUom,unit):null;
 const usable=complete&&unknown===0&&!!unit,daily=usable&&hqComplete?sent/WINDOW:null,branchDaily=usable?branchSent/WINDOW:null;
 let burn=0,burnUnknown=0;const logIds=new Set();
 for(const row of logs){if(!row.id||logIds.has(row.id))continue;logIds.add(row.id);const at=stamp(row.timestamp),v=number(row.variance),type=text(row.type).toLowerCase();if(row.branch!==branch||row.item!==item||!Number.isFinite(at)||at<start||at>now||v===null||v>=0||!/(sales|deduction|waste|spoilage|store use|prep|adjustment|voided|penalty|audit|count)/.test(type))continue;const converted=convertRadarQuantity(-v,row.uom||target?.uom||target?.baseUom,unit);if(converted===null)burnUnknown++;else burn+=converted;}
 const dailyBurn=burnComplete&&burnUnknown===0&&!!unit?burn/WINDOW:null;
 return {item,branch,unit,hqStock,branchStock,daily,branchDaily,pending:usable?pending:null,last,unknown,complete,sourceMissing:!source,targetMissing:!target,dailyBurn,
  hqDays:hqStock===null||daily===null||daily<=0?null:Math.max(0,hqStock)/daily,
  branchDays:branchStock===null||branchDaily===null||branchDaily<=0?null:Math.max(0,branchStock)/branchDaily,
  burnDays:branchStock===null||dailyBurn===null||dailyBurn<=0?null:Math.max(0,branchStock)/dailyBurn};
}
export function deliveryRadarHTML(model){
 const q=value=>value===null?'Not available':fmt(value)+' '+esc(model.unit||'units'),pace=value=>value===null?'Not available':q(value)+'/day';
 const days=(value,stock,daily)=>stock===null?'No stock record':stock<0?'Count needed':daily===null?'History needs review':daily===0?'No recent deliveries':fmt(value)+' days';
 const line=(label,value)=>'<div style="display:flex;justify-content:space-between;gap:14px"><span>'+esc(label)+'</span><strong style="text-align:right">'+value+'</strong></div>';
 const card=(title,body)=>'<section style="border:1px solid #d7e3db;border-radius:10px;padding:12px;margin:10px 0;background:#f7faf7;color:#264b3e;font-size:12px;display:grid;gap:6px;overflow-wrap:anywhere"><strong>'+esc(title)+'</strong>'+body+'</section>';
 const delivery=card('🚚 Main Office Delivery Radar · '+model.item,
  line('Main Office stock',q(model.hqStock))+line('Avg sent to all branches (14 days)',pace(model.daily))+line('Estimated Main Office runway',days(model.hqDays,model.hqStock,model.daily))+line('Avg sent to '+model.branch,pace(model.branchDaily))+line('Branch coverage at delivery pace',days(model.branchDays,model.branchStock,model.branchDaily))+line('Awaiting receipt · last 14 days',q(model.pending))+
  '<small>Delivery pace uses 14 calendar days of recorded HQ dispatches. It is a supply estimate, not measured branch use. Pending deliveries are not added to current branch stock.'+(!model.complete?' History exceeded the review limit; averages are withheld.':model.unknown?' Some delivery units need review; averages are withheld.':'')+'</small>');
 const burnDays=model.branchStock===null?'No stock record':model.branchStock<0?'Count needed':model.dailyBurn===null?'History unavailable':model.dailyBurn===0?'No recent use':fmt(model.burnDays)+' days';
 return delivery+card('🤖 AI Stock Radar ('+model.branch+')',line('Current live stock',q(model.branchStock))+line('Avg daily burn (14 days)',pace(model.dailyBurn))+line('Estimated runway',burnDays));
}
export function installDispatchDeliveryRadar(api,d,{delay=setTimeout,cancelDelay=clearTimeout,now=()=>Date.now()}={}){
 let epoch=0,timer=null;const cache=new Map();
 const el=id=>d.getElementById(id),key=()=>JSON.stringify([el('dispFrom')?.value,el('dispTo')?.value,el('dispItem')?.value?.trim()]);
 function identity(branch){const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||session?.uid!==user.uid||user.emailVerified!==true||!canOpenWorkspacePage(session,'dispatch')||api.isBranchAllowed?.(branch)!==true||api.isBranchAllowed?.('Main Office')!==true)throw Error('Open Dispatch with your approved account.');return {user,session,scope:JSON.stringify([session.allowedBranches,session.permissions])};}
 function container(){let panel=el('dispAiTracker');if(!panel){el('dispQty')?.parentElement?.parentElement?.insertAdjacentHTML('afterend','<div id="dispAiTracker" style="width:100%;margin-top:10px;flex-basis:100%" aria-live="polite"></div>');panel=el('dispAiTracker');}return panel;}
 function options(item){const select=el('dispUomSelect');if(!select)return;const prior=select.value,oldItem=select.dataset?.radarItem,base=item?.uom||item?.baseUom||'units',purchase=item?.purchaseUom||item?.purchUom||base;
  const entries=text(base).toLowerCase()===text(purchase).toLowerCase()?[['base',base]]:[['purch',purchase],['base',base]];
  select.replaceChildren(...entries.map(([value,label])=>{const option=d.createElement('option');option.value=value;option.textContent=label;return option;}));
  select.value=oldItem===item?.name&&entries.some(([value])=>value===prior)?prior:entries[0][0];if(select.dataset)select.dataset.radarItem=item?.name||'';
 }
 async function rows(table,filters){const result=await api.getDocsFromServer(api.query(api.collection(api.db,table),...filters,api.limit(LIMIT+1)));if(result.metadata?.fromCache||result.metadata?.hasPendingWrites)throw Error('A current server response is required.');return {complete:result.docs.length<=LIMIT,rows:result.docs.slice(0,LIMIT).map(doc=>({...doc.data(),id:doc.id}))};}
 async function load(token,route,actor,panel){
  const [source,branch,item]=JSON.parse(route),global=actor.session.email?.toLowerCase()==='jgo031996@gmail.com'||actor.session.allowedBranches?.includes('All'),current=()=>{try{const a=identity(branch);return epoch===token&&key()===route&&a.user===actor.user&&a.session===actor.session&&a.scope===actor.scope&&!d.hidden;}catch{return false;}};
  try{
   const dataKey=JSON.stringify([actor.user.uid,actor.scope,item,branch]),saved=cache.get(dataKey);let data=saved&&now()-saved.at<30000?saved.data:null;
   if(!data){const since=new Date(now()-WINDOW*DAY),deliveryFilters=[api.where('item','==',item),...(!global?[api.where('toBranch','==',branch)]:[])];const results=await Promise.allSettled([rows('inventory',[api.where('name','==',item),api.where('branch','==','Main Office')]),rows('inventory',[api.where('name','==',item),api.where('branch','==',branch)]),rows('dispatch_logs',deliveryFilters),rows('stock_logs',[api.where('branch','==',branch),api.where('item','==',item),api.where('timestamp','>=',since)])]);if(!current())return;if(results.slice(0,3).some(row=>row.status!=='fulfilled'))throw Error('Current stock or delivery history could not be read.');const inventory={complete:results[0].value.complete&&results[1].value.complete,rows:[...results[0].value.rows,...results[1].value.rows]},deliveries=results[2].value,burn=results[3].status==='fulfilled'?results[3].value:{complete:false,rows:[]};if(!inventory.complete)throw Error('The item has too many matching stock records to review safely.');data={inventory:inventory.rows,deliveries:deliveries.rows,logs:burn.rows,complete:deliveries.complete,burnComplete:burn.complete,hqComplete:global};cache.set(dataKey,{at:now(),data});if(cache.size>20)cache.delete(cache.keys().next().value);}
   if(current())panel.innerHTML=deliveryRadarHTML(deliveryRadarModel({...data,item,branch,now:now()}));
  }catch{if(current())panel.textContent='Current stock and delivery history could not be confirmed. Reselect the item when connected to retry.';}
 }
 api.updateDispatchUomLabel=()=>{const token=++epoch;if(timer!==null)cancelDelay(timer);timer=null;const panel=container(),name=el('dispItem')?.value?.trim(),source=el('dispFrom')?.value,branch=el('dispTo')?.value,item=api.dispatchInventoryList?.find(row=>row.name===name);options(item);if(!panel)return;if(!name){panel.textContent='';return;}if(!branch){panel.textContent='Select a destination branch to view stock and delivery history.';return;}if(!item){panel.textContent='Select an item from the current source inventory.';return;}if(source!=='Main Office'){panel.textContent='Select Main Office as the source to review HQ delivery history.';return;}let actor;try{actor=identity(branch);}catch{panel.textContent='Unlock Dispatch to review this branch.';return;}panel.textContent='Loading stock and delivery history…';const route=key();return new Promise(resolve=>{timer=delay(()=>{timer=null;Promise.resolve(load(token,route,actor,panel)).finally(resolve);},250);});};
 const previous=api.invalidateCache;api.invalidateCache=function(name,...args){if(['inventory','dispatch_logs','stock_logs'].includes(name))cache.clear();return previous?.call(this,name,...args);};
 return {clear(){epoch++;if(timer!==null)cancelDelay(timer);cache.clear();}};
}
