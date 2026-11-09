import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {getFirestore,collection,getDocs,getDocsFromServer,query,where,doc,updateDoc,onSnapshot,serverTimestamp,getDoc,getDocFromServer,runTransaction,arrayUnion} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import {getStorage,ref,uploadBytes,getMetadata,getDownloadURL} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import {uploadRiderPhoto} from './rider-photo-upload.js';
import {installRiderAccount} from './rider-account.js';
import {installRiderLayout} from './rider-layout.js';
import {renderRiderDispatch,riderMoney,escapeRiderText} from './rider-dispatch-view.js';
import {claimDeliveryAtomic,acceptPingAtomic,completeDeliveryAtomic,rejectPingAtomic,requestRiderTopUpAtomic,setRiderAvailabilityAtomic,riderPoolScope} from './rider-delivery-safety.js';
const firebaseConfig={apiKey:'AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4',authDomain:'takodeal-pos.firebaseapp.com',projectId:'takodeal-pos',storageBucket:'takodeal-pos.firebasestorage.app',messagingSenderId:'248826111383',appId:'1:248826111383:web:48bf1e2c172298079bd0d2'};
const app=initializeApp(firebaseConfig),db=getFirestore(app),storage=getStorage(app),auth=getAuth(app);
let authReady=null;
async function ensureAuth(){
 if(auth.currentUser)return auth.currentUser;
 if(!authReady)authReady=signInAnonymously(auth).then(value=>value.user).finally(()=>{authReady=null;});
 return authReady;
}
Object.assign(window,{db,storage,auth,ensureAuth,onAuthStateChanged,collection,getDocs,getDocsFromServer,query,where,doc,updateDoc,onSnapshot,serverTimestamp,getDoc,getDocFromServer,runTransaction,arrayUnion,ref,uploadBytes,getMetadata,getDownloadURL});
let riderAccountController=null;
window.currentRider=null;window.gpsInterval=null;window.activePingId=null;window.pingCountdown=null;window.riderLiveEpoch=0;window.activeDeliveries=[];window.currentRiderTab='Pending';window.riderActionBusy=false;
window.isRiderApproved=rider=>['active','approved'].includes(String(rider?.status||'').trim().toLowerCase()) && riderAccountController?.isActive()===true;
function riderStatus(message){const node=document.getElementById('riderOperationStatus');if(node)node.textContent=message;}
function liveApproved(){return window.isRiderApproved(window.currentRider) && navigator.onLine!==false;}
function visibleWallet(){const rider=window.currentRider;if(!rider)return;document.getElementById('profileName').textContent=rider.name||'Rider';document.getElementById('profileWallet').textContent=riderMoney(rider.walletBalance??0).replace(/^₱/,'');document.getElementById('profileRating').textContent=Number.isFinite(Number(rider.rating))?Number(rider.rating).toFixed(1):'—';const online=rider.isAcceptingOrders===true;const button=document.getElementById('statusToggle');button.textContent=online?'Online · Go offline':'Go online';button.setAttribute('aria-pressed',String(online));}
window.stopRiderLiveServices=function(){
 window.riderLiveEpoch++;
 if(window.gpsInterval!==null)clearInterval(window.gpsInterval);
 window.gpsInterval=null;window.riderGpsListenerKey=null;
 const stops=[...(window.riderDispatchUnsubscribes||[]),window.riderPingUnsubscribe].filter(Boolean);
 window.riderDispatchUnsubscribes=[];window.riderDispatchListenerKey=null;window.riderPingUnsubscribe=null;window.riderPingListenerKey=null;
 for(const stop of stops){try{stop();}catch{}}
 window.activeDeliveries=[];window.closePingModal?.();renderDispatchBoard();
};
function startActiveServices(){if(!liveApproved())return;const scope=riderPoolScope(window.currentRider);if(!scope.allowed){window.stopRiderLiveServices();riderStatus(scope.reason);return;}window.startLiveGPS();window.listenForPings();startDispatchListener();}
window.showRiderAuthView=function(view){if(window.isRiderOperationBusy?.())return;document.getElementById('loginView').style.display=view==='register'?'none':'block';document.getElementById('registerView').style.display=view==='register'?'block':'none';document.getElementById(view==='register'?'regName':'loginPhone').focus();};
function requireOnline(){if(navigator.onLine===false)throw Error('Reconnect to the internet before saving or accepting a delivery.');}
function actorNow(){requireOnline();if(!window.isRiderApproved(window.currentRider))throw Error('Manager approval is required before delivery actions.');const actor=window.captureRiderActor();window.assertRiderActor(actor,{active:true});return actor;}
function guardActor(actor){window.assertRiderActor(actor,{active:true});requireOnline();}
window.startLiveGPS=function(){
 const rider=window.currentRider,riderId=rider?.id;
 if(!liveApproved() || rider.isAcceptingOrders!==true)return;
 if(window.riderGpsListenerKey===riderId && window.gpsInterval!==null)return;
 if(window.gpsInterval!==null)clearInterval(window.gpsInterval);
 window.gpsInterval=null;window.riderGpsListenerKey=riderId;
 const epoch=window.riderLiveEpoch,current=()=>epoch===window.riderLiveEpoch && window.currentRider?.id===riderId && liveApproved() && window.currentRider.isAcceptingOrders===true;
 const locationStatus=document.getElementById('riderLocationStatus');
 if(!navigator.geolocation){if(locationStatus)locationStatus.textContent='This device cannot provide GPS. Contact Manager for dispatch help.';return;}
 let inFlight=false,last=null,lastWrite=0;
 const tick=()=>{
  if(!current() || inFlight || document.visibilityState==='hidden')return;
  let actor;try{actor=actorNow();}catch{return;}
  inFlight=true;
  navigator.geolocation.getCurrentPosition(async position=>{
   try{
    if(!current())return;guardActor(actor);
    const lat=position.coords.latitude,lng=position.coords.longitude;
    if(!Number.isFinite(lat)||!Number.isFinite(lng))throw Error('GPS returned an invalid location.');
    const now=Date.now(),moved=!last || Math.hypot((lat-last.lat)*111000,(lng-last.lng)*110000)>=20;
    if(moved || now-lastWrite>=60000){await runTransaction(db,async tx=>{const riderRef=doc(db,'riders',riderId),snapshot=await tx.get(riderRef);guardActor(actor);if(!snapshot.exists() || !window.isRiderApproved(snapshot.data()) || snapshot.data().isAcceptingOrders!==true||snapshot.data().riderAuthRevision!==actor.riderAuthRevision)throw Error('Go online with an approved account to share location.');tx.update(riderRef,{lastLat:lat,lastLng:lng,lastActive:serverTimestamp(),riderActionSessionId:actor.sessionId});});if(!current())return;last={lat,lng};lastWrite=now;}
    if(locationStatus)locationStatus.textContent='Location updates are on while you’re available.';
   }catch(error){if(current() && locationStatus)locationStatus.textContent=error.message||'Location update failed. Try again when connected.';}
   finally{inFlight=false;}
  },error=>{inFlight=false;if(current() && locationStatus)locationStatus.textContent=error.code===1?'Location access is blocked. Allow it in your browser settings, then go offline and online again.':'Waiting for GPS. Keep location enabled and try outdoors.';},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
 };
 window.gpsInterval=setInterval(tick,30000);tick();
};
function renderDispatchBoard(){renderRiderDispatch(window,document);}
window.renderDispatchBoard=renderDispatchBoard;
function startDispatchListener(){
 const riderId=window.currentRider?.id;if(!liveApproved())return;
 const scope=riderPoolScope(window.currentRider);if(!scope.allowed){window.stopRiderLiveServices();riderStatus(scope.reason);return;}const scopeKey=JSON.stringify([riderId,scope.global,scope.branches]);
 if(window.riderDispatchListenerKey===scopeKey && window.riderDispatchUnsubscribes?.length)return;
 for(const stop of window.riderDispatchUnsubscribes||[])stop();window.riderDispatchUnsubscribes=[];window.riderDispatchListenerKey=scopeKey;
 const run=window.riderDispatchListenerRun=(window.riderDispatchListenerRun||0)+1,epoch=window.riderLiveEpoch;
 const current=()=>epoch===window.riderLiveEpoch && run===window.riderDispatchListenerRun && window.currentRider?.id===riderId && liveApproved() && window.riderDispatchListenerKey===scopeKey && JSON.stringify([riderId,riderPoolScope(window.currentRider).global,riderPoolScope(window.currentRider).branches])===scopeKey;
 const streams={claimed:[]};
 const render=(kind,snapshot)=>{if(!current())return;streams[kind]=[];snapshot.forEach(entry=>{const order={...entry.data(),id:entry.id},scoped=scope.global||scope.branches.includes(order.branch);if(kind.startsWith('ready')?order.status==='ready'&&['Delivery','Advance Delivery'].includes(order.orderType)&&scoped:order.status==='out_for_delivery' && order.riderId===riderId)streams[kind].push(order);});const ready=Object.entries(streams).filter(([key])=>key.startsWith('ready')).flatMap(([,rows])=>rows);window.activeDeliveries=[...new Map([...streams.claimed,...ready].map(order=>[order.id,order])).values()];renderDispatchBoard();};
 const failed=error=>{if(!current())return;const stops=window.riderDispatchUnsubscribes||[];window.riderDispatchUnsubscribes=[];window.riderDispatchListenerKey=null;for(const stop of stops)stop();window.activeDeliveries=[];console.error('Rider delivery updates stopped:',error.code||'unavailable');document.getElementById('dispatchBoardContainer').style.display='block';document.getElementById('radarScreen').style.display='none';const board=document.getElementById('dispatchBoard');board.style.display='flex';board.innerHTML='<div class="rider-empty"><h2>Delivery updates stopped</h2><p>Check your connection and try again. Contact Manager if this continues.</p><button class="rider-button" onclick="window.refreshRiderDeliveries()">Retry delivery updates</button></div>';};
 const chunks=scope.global?[null]:Array.from({length:Math.ceil(scope.branches.length/10)},(_,index)=>scope.branches.slice(index*10,index*10+10));
 chunks.forEach((branches,index)=>{const filters=[where('status','==','ready'),where('orderType','in',['Delivery','Advance Delivery']),...(branches?[where('branch','in',branches)]:[])];window.riderDispatchUnsubscribes.push(onSnapshot(query(collection(db,'incoming_orders'),...filters),snapshot=>render('ready'+index,snapshot),failed));});
 window.riderDispatchUnsubscribes.push(onSnapshot(query(collection(db,'incoming_orders'),where('status','==','out_for_delivery'),where('riderId','==',riderId)),snapshot=>render('claimed',snapshot),failed));
}
window.startDispatchListener=startDispatchListener;
window.refreshRiderDeliveries=async()=>{if(window.riderActionBusy)return;try{requireOnline();await window.refreshRiderApproval();if(!liveApproved())return;window.stopRiderLiveServices();startActiveServices();riderStatus('Delivery updates refreshed.');}catch(error){riderStatus(error.message);}};
window.switchRiderTab=tab=>{window.currentRiderTab=tab==='Ongoing'?'Ongoing':'Pending';renderDispatchBoard();};
async function riderAction(task,{success}={}){
 if(window.riderActionBusy)return false;window.riderActionBusy=true;
 let actor;
 try{actor=actorNow();const result=await task(actor);guardActor(actor);if(success)riderStatus(success);return result;}
 catch(error){try{if(actor)window.assertRiderActor(actor,{active:true});riderStatus(error.message||'The save could not be confirmed. Reconnect and refresh before retrying.');await Swal.fire({title:'Please check this action',text:error.message||'Check your connection and try again.',icon:'warning'});}catch{}return false;}
 finally{window.riderActionBusy=false;}
}
window.toggleRiderStatus=()=>riderAction(async actor=>{const value=window.currentRider.isAcceptingOrders!==true;const result=await setRiderAvailabilityAtomic(window,{actor,isAcceptingOrders:value});guardActor(actor);window.currentRider={...window.currentRider,...result.rider,isAcceptingOrders:value};window.stopRiderLiveServices();visibleWallet();startActiveServices();return result;},{success:'Availability saved.'});
const deliveryAttempts=new Map();
function attemptFor(kind,id,actor){const key=JSON.stringify([actor.authUid,actor.sessionId,actor.riderId,kind,id]);let attempt=deliveryAttempts.get(key);if(!attempt){attempt={id:kind+'-'+crypto.randomUUID()};deliveryAttempts.set(key,attempt);}return attempt;}
window.claimDelivery=orderId=>riderAction(async actor=>{if(window.currentRider.isAcceptingOrders!==true)throw Error('Go online before accepting a new delivery.');const attempt=attemptFor('claim',orderId,actor);const result=await claimDeliveryAtomic(window,{orderId,operationId:attempt.id,actor});guardActor(actor);if(result.rider)window.currentRider={...window.currentRider,...result.rider};if(result.walletBalance!=null)window.currentRider.walletBalance=result.walletBalance;visibleWallet();window.switchRiderTab('Ongoing');await window.refreshRiderApproval();return result;},{success:'Delivery accepted. Open My deliveries for directions and completion.'});
function validatePhoto(file){if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || !(file.size>0) || file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP photo up to 5 MB.');return file;}
async function riderPhotoHash(file){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');}
window.completeDelivery=orderId=>riderAction(async actor=>{
 const mine=window.activeDeliveries.find(order=>order.id===orderId && order.status==='out_for_delivery' && order.riderId===actor.riderId);if(!mine)throw Error('Refresh My deliveries. This delivery is not currently assigned to you.');
 const answer=await Swal.fire({title:'Proof of delivery',text:'Choose a clear photo of the delivered order or drop-off location.',input:'file',inputAttributes:{accept:'image/jpeg,image/png,image/webp',capture:'environment'},showCancelButton:true,confirmButtonText:'Save delivery proof',inputValidator:file=>{try{validatePhoto(file);}catch(error){return error.message;}}});
 if(!answer.value)return {cancelled:true};guardActor(actor);const file=validatePhoto(answer.value),attempt=attemptFor('complete',orderId,actor),signature=await riderPhotoHash(file);guardActor(actor);
 if(attempt.photoSignature!==signature){attempt.photoSignature=signature;attempt.proofUrl=null;}
 if(!attempt.proofUrl){const path='deliveries/proofs/'+actor.authUid+'/'+actor.sessionId+'/'+orderId+'/'+attempt.id+'/'+signature+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type]);attempt.proofUrl=await uploadRiderPhoto(window,{path,file,metadata:{contentType:file.type,customMetadata:{riderUploadUid:actor.authUid,riderId:actor.riderId,riderSessionId:actor.sessionId,sha256:signature}},assertCurrent:()=>guardActor(actor)});guardActor(actor);}
 const result=await completeDeliveryAtomic(window,{orderId,operationId:attempt.id,proofUrl:attempt.proofUrl,actor});guardActor(actor);riderStatus('Delivery completed. Your proof was saved.');return result;
});
const topupAttempts=new Map();
window.requestTopUp=()=>riderAction(async actor=>{
 const answer=await Swal.fire({title:'Request a wallet top-up',html:'<p>Send your GCash payment to Manager using the confirmed payment details, then submit its reference and proof. Manager credits the wallet after review.</p><label for="topupRef">GCash reference number</label><input id="topupRef" class="swal2-input" inputmode="numeric" maxlength="60" autocomplete="off"><label for="topupProof">Payment screenshot</label><input type="file" id="topupProof" class="swal2-file" accept="image/jpeg,image/png,image/webp">',showCancelButton:true,confirmButtonText:'Submit for review',preConfirm:()=>{try{const entered=document.getElementById('topupRef').value.trim(),reference=entered.replace(/[ -]/g,''),file=validatePhoto(document.getElementById('topupProof').files?.[0]);if(!/^[0-9 -]{3,60}$/.test(entered) || !/^\d{3,60}$/.test(reference))throw Error('Enter the reference number shown on your GCash payment.');return {reference,file};}catch(error){Swal.showValidationMessage(error.message);return false;}}});
 if(!answer.value)return {cancelled:true};guardActor(actor);const file=answer.value.file,reference=answer.value.reference.replace(/[ -]/g,''),key=actor.riderId+':'+reference,attemptKey=JSON.stringify([actor.authUid,actor.sessionId,key]);
 let attempt=topupAttempts.get(attemptKey);if(!attempt){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));guardActor(actor);attempt={id:'topup-'+[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join(''),operationId:'topup-'+crypto.randomUUID()};topupAttempts.set(attemptKey,attempt);}
 const previous=await getDocFromServer(doc(db,'rider_topups',attempt.id));guardActor(actor);if(previous.exists()){const record=previous.data();if(record.riderId!==actor.riderId || String(record.reference||'').replace(/[ -]/g,'')!==reference)throw Error('This reference has conflicting saved details. Contact Manager before retrying.');const status=['pending','approved','rejected'].includes(record.status)?record.status:'needs Manager review';riderStatus('This top-up request is already '+status+'. No additional request was created.');return {alreadySaved:true,status,topupId:attempt.id};}
 if(!attempt.proofUrl){const photoHash=await riderPhotoHash(file);guardActor(actor);const path='riders/topups/'+actor.authUid+'/'+actor.sessionId+'/'+attempt.id+'/'+attempt.operationId+'/'+photoHash+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type]);attempt.proofUrl=await uploadRiderPhoto(window,{path,file,metadata:{contentType:file.type,customMetadata:{riderUploadUid:actor.authUid,riderId:actor.riderId,riderSessionId:actor.sessionId,sha256:photoHash}},assertCurrent:()=>guardActor(actor)});guardActor(actor);}
 const result=await requestRiderTopUpAtomic(window,{topupId:attempt.id,reference,proofUrl:attempt.proofUrl,operationId:attempt.operationId,actor});guardActor(actor);riderStatus('Top-up request submitted for Manager review.');return result;
});
window.listenForPings=function(){
 if(!liveApproved() || window.currentRider.isAcceptingOrders!==true)return;
 const riderId=window.currentRider.id,epoch=window.riderLiveEpoch;
 if(window.riderPingListenerKey===riderId && window.riderPingUnsubscribe)return;
 window.riderPingUnsubscribe?.();window.riderPingListenerKey=riderId;
 const current=()=>epoch===window.riderLiveEpoch && window.currentRider?.id===riderId && liveApproved() && window.currentRider.isAcceptingOrders===true && window.riderPingListenerKey===riderId;
 window.riderPingUnsubscribe=onSnapshot(query(collection(db,'incoming_orders'),where('pingedRider','==',riderId),where('status','==','looking_for_rider')),snapshot=>{if(!current())return;for(const change of snapshot.docChanges()){if(change.type==='removed'){if(window.activePingId===change.doc.id && !window.riderActionBusy)window.closePingModal();}else window.triggerIncomingPing(change.doc.id,change.doc.data());}},error=>{if(!current())return;window.riderPingUnsubscribe=null;window.riderPingListenerKey=null;window.closePingModal();riderStatus('Delivery alerts stopped. Refresh deliveries to reconnect.');console.error('Rider alerts stopped:',error.code||'unavailable');});
};
window.triggerIncomingPing=function(orderId,orderData){
 if(!liveApproved() || window.currentRider.isAcceptingOrders!==true || window.riderActionBusy || window.activePingId===orderId)return;
 window.closePingModal();window.activePingId=orderId;window.currentPingData=orderData;
 document.getElementById('pingDistance').textContent=orderData.deliveryFee==null?'Delivery fee not listed':riderMoney(orderData.deliveryFee)+' delivery fee';document.getElementById('pingStore').textContent=orderData.branch||'Confirm pickup with Manager';document.getElementById('pingAddress').textContent=orderData.deliveryAddress||'Confirm drop-off with Manager';document.getElementById('btnAcceptPing').textContent='Accept delivery';document.getElementById('btnAcceptPing').disabled=false;document.getElementById('incomingOrderPing').style.display='block';
 try{const audio=new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');audio.loop=true;audio.play().catch(()=>{});window.pingAudio=audio;}catch{}
 let time=15;document.getElementById('pingTimer').textContent=time+'s';window.pingCountdown=setInterval(()=>{document.getElementById('pingTimer').textContent=--time+'s';if(time<=0 && !window.riderActionBusy)window.rejectPing();},1000);
};
window.closePingModal=function(){document.getElementById('incomingOrderPing').style.display='none';if(window.pingCountdown)clearInterval(window.pingCountdown);window.pingAudio?.pause();window.pingCountdown=null;window.pingAudio=null;window.activePingId=null;window.currentPingData=null;document.getElementById('btnAcceptPing').disabled=false;document.getElementById('btnAcceptPing').textContent='Accept delivery';};
window.acceptPing=()=>riderAction(async actor=>{const orderId=window.activePingId;if(!orderId)throw Error('This delivery alert has expired.');const attempt=attemptFor('ping',orderId,actor);if(window.pingCountdown)clearInterval(window.pingCountdown);window.pingCountdown=null;document.getElementById('btnAcceptPing').disabled=true;let result;try{result=await acceptPingAtomic(window,{orderId,operationId:attempt.id,actor});}finally{if(window.activePingId===orderId)window.closePingModal();}guardActor(actor);if(result.walletBalance!=null)window.currentRider.walletBalance=result.walletBalance;visibleWallet();window.switchRiderTab('Ongoing');await window.refreshRiderApproval();return result;},{success:'Delivery accepted.'});
window.rejectPing=()=>riderAction(async actor=>{const orderId=window.activePingId;if(!orderId)return {cancelled:true};const attempt=attemptFor('pass',orderId,actor);window.closePingModal();return rejectPingAtomic(window,{orderId,operationId:attempt.id,actor});});
const account=installRiderAccount(window,document,{onActive:rider=>{const changed=window.currentRider?.id!==rider.id || !window.isRiderApproved(window.currentRider);if(changed)window.stopRiderLiveServices();window.currentRider=rider;document.getElementById('authOverlay').style.display='none';document.getElementById('accountStatusScreen').style.display='none';document.getElementById('mainApp').style.display='flex';visibleWallet();renderDispatchBoard();startActiveServices();},onRestricted:state=>{window.currentRider=state.rider;window.stopRiderLiveServices();document.getElementById('authOverlay').style.display='none';document.getElementById('mainApp').style.display='none';document.getElementById('accountStatusScreen').style.display='flex';},onSignedOut:()=>{window.currentRider=null;window.stopRiderLiveServices();document.getElementById('authOverlay').style.display='flex';document.getElementById('accountStatusScreen').style.display='none';document.getElementById('mainApp').style.display='none';},onStatusError:state=>{window.currentRider=state.rider;window.stopRiderLiveServices();document.getElementById('authOverlay').style.display='none';document.getElementById('mainApp').style.display='none';document.getElementById('accountStatusScreen').style.display='flex';riderStatus('Approval status could not be verified. Check approval status before continuing.');}});
riderAccountController=account;
window.captureRiderActor=()=>account.captureActor();window.assertRiderActor=(actor,options)=>account.assertActor(actor,options);
window.loginRider=()=>account.login();window.registerRider=()=>account.register();window.refreshRiderApproval=()=>account.refresh();window.checkLoginStatus=()=>account.refresh();
window.isRiderOperationBusy=()=>window.riderActionBusy || account.isBusy();
window.logoutRider=()=>{if(window.isRiderOperationBusy()){riderStatus('Wait for the current action to finish before signing out.');return;}account.logout();};
window.addEventListener('pagehide',()=>window.stopRiderLiveServices());
window.addEventListener('pageshow',event=>{if(event.persisted && window.currentRider)account.refresh();});
window.addEventListener('offline',()=>{window.stopRiderLiveServices();riderStatus('You’re offline. Reconnect to check deliveries and approval.');});
window.addEventListener('online',()=>{if(window.currentRider)account.refresh();});
installRiderLayout(document,window,{isBusy:()=>window.isRiderOperationBusy()});
