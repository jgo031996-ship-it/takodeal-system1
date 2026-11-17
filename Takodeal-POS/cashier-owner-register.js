// The Owner register and its receipts use the selected branch's verified connection.
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
 let range='auto',date='',pageSize=100,registerPhase='checking',registerMessage='',salesKey='';
 const zone={timeZone:'Asia/Manila'};
 const dayBounds=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose a valid sales date.');const start=new Date(value+'T00:00:00+08:00');if(!Number.isFinite(+start)||new Date(+start+8*3600000).toISOString().slice(0,10)!==value)throw Error('Choose a valid sales date.');return [start,new Date(+start+86400000)];};
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
  for(const id of ['globalUnverifiedBanner','unverifiedWarningBanner']){const banner=d.getElementById(id);if(banner)banner.style.display='none';}
  const top=d.getElementById('btnTopShift'),lock=d.getElementById('globalShiftLockout'),heading=lock?.querySelector('h2'),note=lock?.querySelector('p'),button=lock?.querySelector('button');
  const open=!!context&&!!state.shift&&registerPhase==='open';
  if(top){top.textContent=open?'🟢 Branch register open':registerPhase==='none'?'⏳ No open register synced':'⏳ Checking branch register';top.style.background=open?'#dcfce7':'#f1f5f9';top.style.color=open?'#15803d':'#475569';top.disabled=false;top.onclick=()=>{if(activeSales())refresh();else w.switchView?.('sales');};}
  const ready=open&&w.cashierOwnerPOS?.isReady()===true;
  const posVisible=d.getElementById('view-pos')?.classList?.contains('active');
  const ordersVisible=d.getElementById('view-mobilehub')?.classList?.contains('active');
  if(lock&&posVisible)lock.style.display=ready?'none':'flex';
  if(lock&&ordersVisible)lock.style.display=open?'none':'flex';
  if(heading)heading.textContent=open&&!ready?'Loading branch menu':'Branch register';
  const quote=d.getElementById('lockoutQuote');if(quote)quote.textContent=state.message;
  if(note)note.textContent='The selected branch needs an open register and a live menu before checkout.';
  if(button){
   button.textContent=open&&!ready?'Reload branch menu':'View branch sales';
   button.onclick=open&&!ready?()=>w.cashierOwnerPOS.loadMenu(capture()).catch(error=>w.Swal.fire('Branch menu',error.message,'info')):()=>w.switchView?.('sales');
  }
  const place=d.getElementById('btnMainPlaceOrder');if(place)place.disabled=!ready;
 }
 function render(){
  paintStatus();if(!activeSales())return;
  const table=d.getElementById('tbTransBody');if(!table)return;
  const mode=state.range||'current';
  const controls='<tr class="tk-sales-message"><td colspan="7" style="padding:12px;white-space:normal;"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">'+
   '<button type="button" data-owner-range="current" '+(!state.shift?'disabled':'')+'>Current shift</button><button type="button" data-owner-range="latest">Latest sales</button>'+
   '<label>Sales date <input type="date" data-owner-sales-date value="'+escape(date)+'"></label><button type="button" data-owner-show-date>Show date</button>'+
   '<button type="button" data-owner-switch>Switch branch</button><button type="button" data-owner-staff>Staff PIN sign-in</button><button type="button" data-owner-refresh>Refresh Sales</button></div></td></tr>';
  const savedPayment=w.cashierOwnerPOS?.hasPending()?'<tr><td colspan="7"><button class="btn" type="button" data-owner-pending>Check saved payment</button></td></tr>':'';
  const banner=controls+savedPayment+'<tr class="tk-sales-message"><td colspan="7" style="padding:16px;white-space:normal;" role="status">'+escape(state.message)+'</td></tr>';
  if(state.phase!=='ready'){table.innerHTML=banner;return;}
  const totals=ownerSalesTotals(state.rows),start=state.shift?new Date(millis(state.shift.startTime)).toLocaleString('en-PH',zone):null;
  const summary='<tr class="tk-sales-summary"><td colspan="7" style="padding:16px;white-space:normal;line-height:1.8;">'+
   '<strong>'+escape(state.branch)+' · '+(state.hasMore?'Shown receipts total ':'Total sales ')+money(totals.total)+'</strong> · '+totals.count+' paid receipt(s)<br>'+['Cash','GCash','Grab','Foodpanda','Other'].map(key=>escape(key)+': '+money(totals[key])).join(' · ')+
   '<br>'+escape(mode==='current'?'Current shift':mode==='date'?'Sales on '+date+' (Philippine time)':'Latest uploaded receipts')+(start?' · Register opened '+escape(start)+' · '+escape(state.shift.startedBy||'Cashier'):'')+
   '<br><small>Uploaded receipts only. Pending branch-tablet uploads appear after syncing.</small>'+(state.hasMore?'<br><button type="button" data-owner-more>Show 100 more receipts</button>':'')+'</td></tr>';
  table.innerHTML=banner+summary+(state.rows.length?state.rows.map((row,index)=>{
   const time=Number.isFinite(millis(row.timestamp))?new Date(millis(row.timestamp)):null;
   return '<tr class="tk-sale-row" tabindex="0" data-owner-receipt="'+escape(row.id)+'" aria-label="Receipt '+escape(row.receiptId||row.id)+'"><td data-label="Receipt" style="padding:15px;">'+escape(row.receiptId||row.id)+'</td><td data-label="Customer">'+ escape(row.customerName||'Guest')+'</td><td data-label="Payment">'+ escape(row.paymentMethod||'Cash')+'</td><td data-label="Status">'+ escape(row.status||'Paid')+'</td><td data-label="Date">'+ escape(time?.toLocaleDateString('en-PH',zone)||'')+'</td><td data-label="Time">'+ escape(time?.toLocaleTimeString('en-PH',zone)||'')+'</td><td data-label="Amount">'+ money(row.netTotal)+'</td></tr>';
  }).join(''):'<tr class="tk-sales-message"><td colspan="7" style="padding:20px;">No uploaded receipts in this view. Choose Latest sales or another date.</td></tr>');
 }
 function publish(next){state=next;render();}
 function endSales(){salesGeneration++;stopSales?.();stopSales=null;salesKey='';}
 function disconnect(){generation++;stopShift?.();stopShift=null;endSales();context=null;}
 function sales(value,run,shift){
  const mode=range==='date'?'date':range==='latest'?'latest':shift?'current':'latest';
  const key=JSON.stringify([mode,date,pageSize,mode==='current'?shift?.shiftId:null,mode==='current'?millis(shift?.startTime):null]);
  if(key===salesKey&&stopSales){state={...state,shift,message:registerMessage};render();return;}
  endSales();salesKey=key;const salesRun=salesGeneration;
  publish({phase:'sales-loading',branch:value.branch,shift,range:mode,rows:[],message:registerMessage+' Loading uploaded sales…'});
  const valid=()=>same(value,run)&&salesRun===salesGeneration;
  try{
   const filters=[w.where('branch','==',value.branch)];
   if(mode==='current')filters.push(w.where('timestamp','>=',new Date(millis(shift.startTime))));
   else{if(mode==='date'){const [from,to]=dayBounds(date);filters.push(w.where('timestamp','>=',from),w.where('timestamp','<',to));}filters.push(w.orderBy('timestamp','desc'),w.limit(pageSize+1));}
   const query=w.query(w.collection(value.db,'transactions'),...filters);
   const stop=subscribe(query,snapshot=>{
    if(!valid())return;
    try{
     if(!Array.isArray(snapshot?.docs))throw Error('Incomplete sales response.');
     if(cached(snapshot)){publish({phase:'sales-loading',branch:value.branch,shift,rows:[],range:mode,message:registerMessage+' Reconnecting to confirm uploaded sales…'});return;}
     const rows=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(row=>{
      if(row.branch!==value.branch||!Number.isFinite(millis(row.timestamp)))return false;
      if(mode==='current')return millis(row.timestamp)>=millis(shift.startTime)&&(!row.shiftId||row.shiftId==='UNKNOWN'||row.shiftId===shift.shiftId);
      if(mode==='date'){const [from,to]=dayBounds(date);return millis(row.timestamp)>=+from&&millis(row.timestamp)<+to;}return true;
     }).sort((a,b)=>millis(b.timestamp)-millis(a.timestamp));
     publish({phase:'ready',branch:value.branch,shift:state.shift,range:mode,rows:mode==='current'?rows:rows.slice(0,pageSize),hasMore:mode!=='current'&&rows.length>pageSize,message:registerMessage});
    }catch{publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:registerMessage+' Sales could not be loaded. Use Refresh Sales to retry.'});}
   },()=>{if(valid())publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:registerMessage+' Sales could not be loaded. Use Refresh Sales to retry.'});});
   if(typeof stop!=='function')throw Error('Sales connection unavailable.');if(valid())stopSales=stop;else stop();
  }catch{if(valid())publish({phase:'sales-error',branch:value.branch,shift,rows:[],message:registerMessage+' Sales could not be loaded. Use Refresh Sales to retry.'});}
 }
 function start({force=false}={}){
  if(!ownerMode()){stop();return false;}
  let value;try{value=capture();}catch{disconnect();publish({phase:'error',branch:w.sessionUser?.branch||'',shift:null,rows:[],message:'Owner Access changed. Reopen it before checking branch sales.'});return false;}
  if(!force&&context?.session===value.session&&context?.db===value.db&&same(context,generation)&&stopShift){paintStatus();return true;}
  disconnect();context=value;const run=generation;
  // Invalidate old staff renders without attaching this view to a live drawer.
  w.stopShiftSalesFeed?.();w.shiftSalesRenderGeneration=(w.shiftSalesRenderGeneration||0)+1;w.shiftStatusGeneration=(w.shiftStatusGeneration||0)+1;
  w.currentShift=null;w.activeShiftDetails=null;
  registerPhase='checking';registerMessage='Checking the live register at '+value.branch+'…';
  publish({phase:'loading',branch:value.branch,shift:null,rows:[],message:registerMessage});
  if(timer===null&&typeof every==='function'){timer=every(check,1000);timer?.unref?.();}
  try{
   const query=w.query(w.collection(value.db,'shifts'),w.where('branch','==',value.branch),w.where('active','==',true),w.limit(2));
   const stop=subscribe(query,snapshot=>{
    if(!same(value,run))return;
    try{
     if(!Array.isArray(snapshot?.docs))throw Error('Incomplete register response.');
     if(cached(snapshot)){registerPhase='checking';registerMessage='Waiting for a live register check at '+value.branch+'.';sales(value,run,null);return;}
     if(snapshot.docs.length>1)throw Error('More than one open register was found. Review this branch in the Owner App.');
     if(!snapshot.docs.length){registerPhase='none';registerMessage='No open register is synced at '+value.branch+'. Sales history remains available.';sales(value,run,null);return;}
     const doc=snapshot.docs[0],row=doc.data();
     if(!doc.id||row.branch!==value.branch||row.active!==true||!Number.isFinite(millis(row.startTime)))throw Error('This branch register needs review in the Owner App.');
     const shift={shiftId:doc.id,startTime:row.startTime,startedBy:row.cashier,active:true};
     registerPhase='open';registerMessage='Register open at '+value.branch;
     sales(value,run,shift);
    }catch(error){registerPhase='error';registerMessage=error.message+' Register status is unconfirmed.';sales(value,run,null);}
   },()=>{if(same(value,run)){registerPhase='error';registerMessage='The live register at '+value.branch+' could not be confirmed. Sales history remains available.';sales(value,run,null);}});
   if(typeof stop!=='function')throw Error('Register connection unavailable.');if(same(value,run))stopShift=stop;else stop();
  }catch{if(same(value,run)){registerPhase='error';registerMessage='The branch register connection is unavailable. Sales history remains available.';sales(value,run,null);}}
  return true;
 }
 function stop(){
  const wasOwner=state.phase!=='signed-out';disconnect();if(timer!==null)clear(timer);timer=null;
  if(savedUI){for(const {node,text,click}of savedUI.nodes){node.textContent=text;node.onclick=click;}if(savedUI.top){savedUI.top.innerHTML=savedUI.topHTML;savedUI.top.onclick=savedUI.topClick;savedUI.top.disabled=savedUI.topDisabled;Object.assign(savedUI.top.style,savedUI.topStyle);}savedUI=null;}
  state={phase:'signed-out',branch:'',shift:null,rows:[],message:''};
  if(wasOwner&&!ownerMode())w.startUnverifiedListener?.();
  if(wasOwner){w.shiftSalesRenderGeneration=(w.shiftSalesRenderGeneration||0)+1;const table=d.getElementById('tbTransBody');if(table){table.innerHTML='';table.textContent='Sign in to view branch sales.';}}
 }
 function check(){if(!ownerMode()){stop();return;}if(!context){start();return;}if(!same(context,generation))start({force:true});}
 function refresh(){return start({force:true});}
 function setRange(next,day=''){if(!['current','latest','date'].includes(next))return false;if(next==='date')dayBounds(day);capture();range=next;date=day;pageSize=100;if(context)sales(context,generation,state.shift);return true;}
 d.getElementById('tbTransBody')?.addEventListener?.('click',async event=>{
  try{capture();}catch{check();return;}
  if(event.target.closest?.('[data-owner-pending]')?.hasAttribute?.('data-owner-pending')){w.cashierOwnerPOS?.reviewPending().catch(error=>w.Swal.fire('Saved payment',error.message,'info'));return;}
  const rangeButton=event.target.closest?.('[data-owner-range]');if(rangeButton?.dataset?.ownerRange){setRange(rangeButton.dataset.ownerRange);return;}
  if(event.target.closest?.('[data-owner-show-date]')?.hasAttribute?.('data-owner-show-date')){try{setRange('date',d.querySelector?.('[data-owner-sales-date]')?.value||'');}catch(error){w.Swal?.fire?.('Sales date',error.message,'info');}return;}
  if(event.target.closest?.('[data-owner-staff]')?.hasAttribute?.('data-owner-staff')){w.openRememberedStaffSignIn?.();return;}
  if(event.target.closest?.('[data-owner-switch]')?.hasAttribute?.('data-owner-switch')){w.ownerBypassLogin?.();return;}
  if(event.target.closest?.('[data-owner-refresh]')?.hasAttribute?.('data-owner-refresh')){refresh();return;}
  if(event.target.closest?.('[data-owner-more]')?.hasAttribute?.('data-owner-more')){capture();pageSize+=100;sales(context,generation,state.shift);return;}
  const button=event.target.closest?.('[data-owner-receipt]');if(!button||state.phase!=='ready'||button.dataset?.ownerReceipt===undefined)return;
  try{capture();}catch{check();return;}
  const c=capture(),row=state.rows.find(r=>r.id===button.dataset.ownerReceipt);if(!row)return;
  const current=()=>{try{c.assertCurrent();}catch{return false;}return activeSales()&&state.branch===c.branch&&state.rows.some(r=>r.id===row.id&&r.receiptId===row.receiptId);};
  const lines=(Array.isArray(row.cart)?row.cart:[]).map(item=>escape(item.qty??1)+' × '+escape(item.name||item.item||'Item')).join('<br>');
  const resume=row.status==='Voided'&&row.voidReason==='WrongPunched'&&row.voidOwnerUid===c.user.uid;
  let replacement=null,lookupFailed=false;
  if(resume){
   replacement=state.rows.find(r=>r.voidCorrection?.sourceSaleId===row.id);
   if(!replacement)try{const snap=await w.getDocFromServer(w.doc(c.db,'transactions','sale-owner-void-'+row.id));if(snap.exists())replacement=snap.data();}catch{lookupFailed=true;}
  }
  if(!current())return;
  const linked=['manualVerification','paymentReconciliationId','refund','refundId','splitDetails','preparedCancellation','cancelledFoodSourceId','cancelledFoodPurchaseId'];
  const canChange=registerPhase==='open'&&row.shiftId===state.shift?.shiftId&&row.status!=='Parked'&&
   !linked.some(k=>row[k]!=null)&&!row.mealStaffName&&!row.isMobileOrder&&!row.mobileOrderId&&row.orderType!=='Delivery'&&
   !/salary|split|refund|return/i.test(row.paymentMethod||'')&&!(row.paymentVerified===true&&!/^cash$/i.test(row.paymentMethod||''))&&
   (row.status!=='Voided'||resume&&!replacement&&!lookupFailed);
  const checked=/^gcash$/i.test(row.paymentMethod||'')?'<p>GCash verification: '+(row.paymentVerified?'Verified':'Awaiting verification')+'</p>':'';
  const detail='<strong>'+escape(row.receiptId||row.id)+'</strong><p>'+escape(c.branch)+' · '+escape(row.cashier||'')+'</p><p>'+escape(row.customerName||'Guest')+' · '+escape(row.paymentMethod||'Cash')+' · '+escape(row.status||'Paid')+'</p>'+lines+'<p><strong>'+money(row.netTotal)+'</strong></p>'+checked+
   (replacement?'<p>Corrected receipt: '+escape(replacement.receiptId||replacement.id)+'</p>':lookupFailed?'<p>Reconnect to check the corrected receipt.</p>':'');
  const answer=await w.Swal?.fire?.({title:'Receipt details',html:detail,confirmButtonText:'Close',showDenyButton:canChange,denyButtonText:resume?'Continue correction':'Void / correct order'});
  if(answer?.isDenied&&canChange&&current())await w.cashierOwnerPOS?.changeReceipt(row.id,row.receiptId);
 });
 d.getElementById('tbTransBody')?.addEventListener?.('change',event=>{if(event.target.hasAttribute?.('data-owner-sales-date')){try{capture();date=event.target.value;}catch{check();}}});
 w.addEventListener?.('cashier-workspace-changed',check);
 w.addEventListener?.('storage',check);
 w.addEventListener?.('online',()=>{if(ownerMode())refresh();});
 w.addEventListener?.('offline',()=>{if(ownerMode()){disconnect();publish({phase:'loading',branch:w.sessionUser?.branch||'',shift:null,rows:[],message:'Connection unavailable. Reconnect to check the branch register and sales.'});}});
 return {start,stop,refresh,setRange,render,paintStatus,openShift:()=>context&&same(context,generation)&&registerPhase==='open'?state.shift:null,state:()=>({...state,rows:state.rows.map(row=>({...row}))})};
}
