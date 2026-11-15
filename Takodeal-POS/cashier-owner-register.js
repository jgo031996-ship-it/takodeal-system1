// Read-only branch monitoring uses the verified, isolated Owner connection.
// It never adopts a remote drawer as this device's operational currentShift.
import {CASHIER_OWNER_WORKSPACE} from './cashier-owner-workspace.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const millis=value=>value==null?NaN:+(value.toDate?.()||new Date(value));
const money=value=>'₱'+(Number.isFinite(Number(value))?Number(value):0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const cached=snapshot=>snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true||snapshot.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites);
const paid=row=>!['voided','parked','cancelled','canceled'].includes(String(row.status||'').trim().toLowerCase());
export function ownerSalesTotals(rows){
 const result={total:0,count:0,Cash:0,GCash:0,Grab:0,Foodpanda:0,Other:0};
 const category=value=>{const name=String(value||'Cash').trim().toLowerCase();return name==='cash'?'Cash':name==='gcash'?'GCash':name==='grab'?'Grab':['foodpanda','panda'].includes(name)?'Foodpanda':'Other';};
 for(const row of rows.filter(paid)){
  const amount=Number(row.netTotal);if(!Number.isFinite(amount))continue;result.total+=amount;result.count++;
  if(Array.isArray(row.splitDetails)&&row.splitDetails.length){let allocated=0;for(const split of row.splitDetails){const part=Number(split.amount);if(!Number.isFinite(part))continue;result[category(split.method)]+=part;allocated+=part;}result.Other+=amount-allocated;}
  else result[category(row.paymentMethod)]+=amount;
 }return result;
}
export function installCashierOwnerRegister(w,d,{subscribe=(query,next,error)=>w.onSnapshot(query,{includeMetadataChanges:true},next,error),setInterval:every=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
 let context=null,generation=0,salesGeneration=0,stopShift=null,stopSales=null,timer=null,savedUI=null;
 let state={phase:'signed-out',branch:'',shift:null,rows:[],message:''};
 const ownerMode=()=>w.sessionUser?.workspaceKind===CASHIER_OWNER_WORKSPACE||w.isCashierOwnerToolsMode?.()===true;
 function capture(){
  const value=w.getCashierOwnerWorkspaceContext?.();
  if(!value||value.session!==w.sessionUser||value.branch!==w.sessionUser?.branch||value.user!==value.auth?.currentUser||!value.db||typeof value.assertCurrent!=='function')throw Error('Reopen verified Owner Access to check this branch.');
  value.assertCurrent();return value;
 }
 function same(value,run){try{const current=capture();return run===generation&&current.session===value.session&&current.auth===value.auth&&current.db===value.db&&current.user===value.user&&current.branch===value.branch;}catch{return false;}}
 const activeSales=()=>d.getElementById('view-sales')?.classList?.contains('active');
 function saveUI(){
  if(savedUI)return;
  const lock=d.getElementById('globalShiftLockout'),top=d.getElementById('btnTopShift');
  const nodes=[lock?.querySelector('h2'),d.getElementById('lockoutQuote'),lock?.querySelector('p'),lock?.querySelector('button')].filter(Boolean);
  savedUI={top,topHTML:top?.innerHTML,topClick:top?.onclick,topDisabled:top?.disabled,topStyle:top?{background:top.style.background,color:top.style.color,borderColor:top.style.borderColor}:null,nodes:nodes.map(node=>({node,text:node.textContent,click:node.onclick}))};
 }
 function paintStatus(){
  if(!ownerMode())return;saveUI();
  const top=d.getElementById('btnTopShift'),lock=d.getElementById('globalShiftLockout'),heading=lock?.querySelector('h2'),note=lock?.querySelector('p'),button=lock?.querySelector('button');
  const open=!!state.shift&&['ready','sales-loading','sales-error'].includes(state.phase),closed=state.phase==='closed';
  if(top){top.textContent=open?'🟢 Branch register open':closed?'🔴 Branch register closed':'⏳ Checking branch register';top.style.background=open?'#dcfce7':'#f1f5f9';top.style.color=open?'#15803d':'#475569';top.disabled=false;top.onclick=()=>{w.switchView?.('sales');refresh();};}
  if(heading)heading.textContent='Owner branch view';
  const quote=d.getElementById('lockoutQuote');if(quote)quote.textContent=state.message;
  if(note)note.textContent='View this branch’s live register and uploaded sales. Use a Staff PIN to operate the register.';
  if(button){button.textContent='View branch sales';button.onclick=()=>w.switchView?.('sales');}
  const place=d.getElementById('btnMainPlaceOrder');if(place)place.disabled=true;
 }
 function render(){
  paintStatus();if(!activeSales())return;
  const table=d.getElementById('tbTransBody');if(!table)return;
  const banner='<tr><td colspan="8" style="padding:16px;white-space:normal;" role="status">'+escape(state.message)+'</td></tr>';
  if(state.phase!=='ready'){table.innerHTML=banner;return;}
  const totals=ownerSalesTotals(state.rows),start=new Date(millis(state.shift.startTime)).toLocaleString();
  const summary='<tr><td colspan="8" style="padding:16px;white-space:normal;line-height:1.8;">'+
   '<strong>'+escape(state.branch)+' · Total sales '+money(totals.total)+'</strong> · '+totals.count+' paid receipt(s)<br>'+['Cash','GCash','Grab','Foodpanda','Other'].map(key=>escape(key)+': '+money(totals[key])).join(' · ')+
   '<br>Opened '+escape(start)+' · '+escape(state.shift.startedBy||'Cashier')+'<br><small>Live uploaded sales. Receipts awaiting upload on the branch tablet appear after it syncs.</small></td></tr>';
  table.innerHTML=banner+summary+(state.rows.length?state.rows.map((row,index)=>{
   const time=Number.isFinite(millis(row.timestamp))?new Date(millis(row.timestamp)):null;
   return '<tr><td style="padding:15px;">'+escape(row.receiptId||row.id)+'</td><td>'+escape(row.customerName||'Guest')+'</td><td>'+escape(row.paymentMethod||'Cash')+'</td><td>'+escape(row.status||'Paid')+'</td><td>'+escape(time?.toLocaleDateString()||'')+'</td><td>'+escape(time?.toLocaleTimeString()||'')+'</td><td>'+money(row.netTotal)+'</td><td><button type="button" data-owner-receipt="'+index+'">View details</button></td></tr>';
  }).join(''):'<tr><td colspan="8" style="padding:20px;">No uploaded transactions for this open register yet.</td></tr>');
 }
 function publish(next){state=next;render();}
 function endSales(){salesGeneration++;stopSales?.();stopSales=null;}
 function disconnect(){generation++;stopShift?.();stopShift=null;endSales();context=null;}
 function sales(value,run,shift){
  endSales();const salesRun=salesGeneration;
  publish({phase:'sales-loading',branch:value.branch,shift,rows:[],message:'Register open at '+value.branch+'. Loading uploaded sales…'});
  const valid=()=>same(value,run)&&salesRun===salesGeneration;
  try{
   const query=w.query(w.collection(value.db,'transactions'),w.where('branch','==',value.branch),w.where('timestamp','>=',new Date(millis(shift.startTime))));
   const stop=subscribe(query,snapshot=>{
    if(!valid())return;
    try{
     if(!Array.isArray(snapshot?.docs))throw Error('Incomplete sales response.');
     if(cached(snapshot)){publish({phase:'sales-loading',branch:value.branch,shift,rows:[],message:'Register open at '+value.branch+'. Reconnecting to confirm uploaded sales…'});return;}
     const rows=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(row=>row.branch===value.branch&&Number.isFinite(millis(row.timestamp))&&millis(row.timestamp)>=millis(shift.startTime)&&(!row.shiftId||row.shiftId==='UNKNOWN'||row.shiftId===shift.shiftId)).sort((a,b)=>millis(b.timestamp)-millis(a.timestamp));
     publish({phase:'ready',branch:value.branch,shift,rows,message:'Register open at '+value.branch+' · live sales view'});
    }catch{publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:'Register open at '+value.branch+'. Sales could not be confirmed. Use Refresh Sales to retry.'});}
   },()=>{if(valid())publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:'Register open at '+value.branch+'. Sales could not be loaded. Check the connection or account, then use Refresh Sales.'});});
   if(typeof stop!=='function')throw Error('Sales connection unavailable.');if(valid())stopSales=stop;else stop();
  }catch{if(valid())publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:'Register open at '+value.branch+'. Sales could not be loaded. Use Refresh Sales to retry.'});}
 }
 function start({force=false}={}){
  if(!ownerMode()){stop();return false;}
  let value;try{value=capture();}catch{disconnect();publish({phase:'error',branch:w.sessionUser?.branch||'',shift:null,rows:[],message:'Owner Access changed. Reopen it before checking branch sales.'});return false;}
  if(!force&&context?.session===value.session&&context?.db===value.db&&same(context,generation)&&stopShift){paintStatus();return true;}
  disconnect();context=value;const run=generation;
  // Invalidate old staff renders without attaching this view to a live drawer.
  w.stopShiftSalesFeed?.();w.shiftSalesRenderGeneration=(w.shiftSalesRenderGeneration||0)+1;w.shiftStatusGeneration=(w.shiftStatusGeneration||0)+1;
  w.currentShift=null;w.activeShiftDetails=null;
  publish({phase:'loading',branch:value.branch,shift:null,rows:[],message:'Checking the live register at '+value.branch+'…'});
  if(timer===null&&typeof every==='function'){timer=every(check,1000);timer?.unref?.();}
  try{
   const query=w.query(w.collection(value.db,'shifts'),w.where('branch','==',value.branch),w.where('active','==',true),w.limit(2));
   const stop=subscribe(query,snapshot=>{
    if(!same(value,run))return;
    try{
     if(!Array.isArray(snapshot?.docs))throw Error('Incomplete register response.');
     if(cached(snapshot)){endSales();publish({phase:'loading',branch:value.branch,shift:null,rows:[],message:'Waiting for a live register check at '+value.branch+'. Reconnect or use Refresh Sales.'});return;}
     if(snapshot.docs.length>1)throw Error('More than one open register was found. Review this branch in the Owner App.');
     if(!snapshot.docs.length){endSales();publish({phase:'closed',branch:value.branch,shift:null,rows:[],message:'The live register at '+value.branch+' is closed.'});return;}
     const doc=snapshot.docs[0],row=doc.data();
     if(!doc.id||row.branch!==value.branch||row.active!==true||!Number.isFinite(millis(row.startTime)))throw Error('This branch register needs review in the Owner App.');
     const shift={shiftId:doc.id,startTime:row.startTime,startedBy:row.cashier,active:true};
     if(state.shift?.shiftId===shift.shiftId&&millis(state.shift.startTime)===millis(shift.startTime)&&stopSales){state={...state,shift};render();return;}
     sales(value,run,shift);
    }catch(error){endSales();publish({phase:'error',branch:value.branch,shift:null,rows:[],message:error.message+' Use Refresh Sales to retry.'});}
   },()=>{if(same(value,run)){endSales();publish({phase:'error',branch:value.branch,shift:null,rows:[],message:'The live register at '+value.branch+' could not be confirmed. Check the connection or account, then use Refresh Sales.'});}});
   if(typeof stop!=='function')throw Error('Register connection unavailable.');if(same(value,run))stopShift=stop;else stop();
  }catch{if(same(value,run))publish({phase:'error',branch:value.branch,shift:null,rows:[],message:'The branch register connection is unavailable. Use Refresh Sales to retry.'});}
  return true;
 }
 function stop(){
  const wasOwner=state.phase!=='signed-out';disconnect();if(timer!==null)clear(timer);timer=null;
  if(savedUI){for(const {node,text,click}of savedUI.nodes){node.textContent=text;node.onclick=click;}if(savedUI.top){savedUI.top.innerHTML=savedUI.topHTML;savedUI.top.onclick=savedUI.topClick;savedUI.top.disabled=savedUI.topDisabled;Object.assign(savedUI.top.style,savedUI.topStyle);}savedUI=null;}
  state={phase:'signed-out',branch:'',shift:null,rows:[],message:''};
  if(wasOwner){w.shiftSalesRenderGeneration=(w.shiftSalesRenderGeneration||0)+1;const table=d.getElementById('tbTransBody');if(table){table.innerHTML='';table.textContent='Sign in to view branch sales.';}}
 }
 function check(){if(!ownerMode()){stop();return;}if(!context){start();return;}if(!same(context,generation))start({force:true});}
 function refresh(){return start({force:true});}
 d.getElementById('tbTransBody')?.addEventListener?.('click',event=>{
  const button=event.target.closest?.('[data-owner-receipt]');if(!button||state.phase!=='ready')return;
  try{capture();}catch{check();return;}
  const row=state.rows[Number(button.dataset.ownerReceipt)];if(!row)return;
  const lines=(Array.isArray(row.cart)?row.cart:[]).map(item=>escape(item.qty??1)+' × '+escape(item.name||item.item||'Item')).join('<br>');
  w.Swal?.fire?.({title:'Receipt details',html:'<strong>'+escape(row.receiptId||row.id)+'</strong><br>'+escape(state.branch)+'<br>'+escape(row.cashier||'')+'<br>'+lines+'<br><strong>'+money(row.netTotal)+'</strong>',confirmButtonText:'Close'});
 });
 w.addEventListener?.('cashier-workspace-changed',check);
 w.addEventListener?.('storage',check);
 w.addEventListener?.('online',()=>{if(ownerMode())refresh();});
 w.addEventListener?.('offline',()=>{if(ownerMode()){disconnect();publish({phase:'loading',branch:w.sessionUser?.branch||'',shift:null,rows:[],message:'Connection unavailable. Reconnect to check the branch register and sales.'});}});
 return {start,stop,refresh,render,paintStatus,state:()=>({...state,rows:state.rows.map(row=>({...row}))})};
}
