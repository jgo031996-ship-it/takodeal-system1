import {uploadRiderPhoto} from './rider-photo-upload.js';
import {normalizeRiderPhone,validateRiderRegistration,validateRiderPhoto,riderApproved,riderStatusMessage,riderSubmittedAt,publicRiderAccount} from './rider-account-model.js';
import {createRiderAccessClient,riderAccessCanonical} from './rider-access-client.js';

// A protected server-issued UID session authorizes exact own-profile reads.
// PINs remain only in the submitted form/request and are never saved in state.
export function installRiderAccount(api,d=document,callbacks={},options={}) {
    const access=options.access||api.riderAccess||createRiderAccessClient(api),now=options.now||Date.now;
    api.readRiderReceipt=input=>access.receipt(input);
    const schedule=options.setTimeout||globalThis.setTimeout,unschedule=options.clearTimeout||globalThis.clearTimeout;
    let expiryTimer=null;
    let session=null,sessionEpoch=0,watcher=null,watcherRun=0,confirmed=false,error='',loginBusy=false,registerBusy=false,refreshPending=null,attempt=null,operationAuthUid='',operationSessionId='';
    const el=id=>d.getElementById(id),value=id=>el(id)?.value ?? '',uid=()=>api.auth?.currentUser?.uid || '';
    const call=(name,...args)=>{try{callbacks[name]?.(...args);}catch(e){api.console?.error?.('Rider account display:',e);}};
    const text=(id,message)=>{if(el(id))el(id).textContent=String(message ?? '');};
    const message=(id,content)=>text(id,content);
    const busy=()=>{if(el('btnLoginRider'))el('btnLoginRider').disabled=loginBusy || registerBusy;if(el('btnRegisterRider'))el('btnRegisterRider').disabled=loginBusy || registerBusy;
        if(el('btnRefreshApproval'))el('btnRefreshApproval').disabled=Boolean(refreshPending);};
    const stopWatcher=()=>{watcherRun++;const old=watcher;watcher=null;if(old)old();};
    const fresh=async reference=>{
        if(typeof api.getDocFromServer!=='function')throw Error('Reconnect to check your account with Manager.');
        const snapshot=await api.getDocFromServer(reference);
        if(snapshot.metadata?.fromCache===true)throw Error('Reconnect to confirm your latest approval.');return snapshot;
    };
    function assertUID(expected) {if(!expected || uid()!==expected)throw Error('Your account changed. Sign in again.');}
    async function authReady() {
        await api.ensureAuth();const current=uid();if(!current)throw Error('Connection to the sign-in service failed. Reconnect and try again.');return current;
    }
    function isActive() {return Boolean(session && uid()===session.authUid && now()<session.expiresAt && confirmed && !error && riderApproved(session.rider.status));}
    function state() {return {rider:session?{...session.rider}:null,sessionEpoch,confirmed,isActive:isActive(),error,busy:loginBusy || registerBusy || Boolean(refreshPending),
        status:session?riderStatusMessage(session.rider,error):null};}
    function captureActor() {
        if(!session || uid()!==session.authUid)throw Error('Sign in to your Rider account first.');
        return {authUid:session.authUid,riderId:session.rider.id,sessionEpoch,sessionId:session.sessionId,riderAuthRevision:session.riderAuthRevision};
    }
    function assertActor(actor,{active=true}={}) {
        if(!actor || !session || uid()!==actor.authUid || session.authUid!==actor.authUid || session.rider.id!==actor.riderId || sessionEpoch!==actor.sessionEpoch || actor.sessionId!==session.sessionId || actor.riderAuthRevision!==session.riderAuthRevision || now()>=session.expiresAt)
            throw Error('Your Rider session changed. Reopen this action.');
        if(active && !isActive())throw Error('Manager approval is required before accepting deliveries.');
    }
    function render() {
        if(!session)return;const summary=riderStatusMessage(session.rider,error);
        text('applicationName',session.rider.name);text('applicationPhone',session.rider.phone);text('applicationStatus',summary.label);
        text('applicationMessage',summary.message);text('applicationSubmittedAt',riderSubmittedAt(session.rider.joinedAt));
        if(isActive())call('onActive',{...session.rider});else if(error)call('onStatusError',state());else call('onRestricted',state());
    }
    function invalidate() {sessionEpoch++;stopWatcher();if(expiryTimer!==null)unschedule(expiryTimer);expiryTimer=null;session=null;confirmed=false;error='';refreshPending=null;busy();}
    function applyRecord(actor,snapshot) {
        assertActor(actor,{active:false});
        if(!snapshot.exists())throw Error('This Rider account is no longer available. Contact Manager.');
        const row=snapshot.data();
        if(row.active===false||row.archived===true||row.deleted===true||row.blocked===true)throw Error('Manager disabled this Rider account. Contact HQ before accepting deliveries.');
        if(normalizeRiderPhone(row.phone)!==session.phone || Object.hasOwn(row,'pin') || row.riderPinManaged!==true || row.riderAuthRevision!==session.riderAuthRevision)throw Error('Your sign-in details changed. Sign in again.');
        session.rider=publicRiderAccount(snapshot.id || actor.riderId,row);confirmed=true;error='';render();
    }
    function unavailable(actor,reason) {
        try{assertActor(actor,{active:false});}catch{return;}
        confirmed=false;error=String(reason?.message || 'Approval could not be confirmed.');render();
    }
    function startWatcher() {
        if(!session || typeof api.onSnapshot!=='function')return;
        stopWatcher();const actor=captureActor(),run=watcherRun;
        const current=()=>run===watcherRun && sessionEpoch===actor.sessionEpoch && uid()===actor.authUid && session?.rider.id===actor.riderId;
        const stop=api.onSnapshot(api.doc(api.db,'riders',actor.riderId),{includeMetadataChanges:true},snapshot=>{
            if(!current())return;
            if(snapshot.metadata?.fromCache===true){unavailable(actor,Error('Waiting for the latest Manager approval.'));return;}
            try{applyRecord(actor,snapshot);}catch(reason){unavailable(actor,reason);}
        },reason=>{if(!current())return;stopWatcher();unavailable(actor,reason);});
        if(current())watcher=stop;else stop?.();
    }
    function adopt(id,row,authUid,grant) {
        if(row.active===false||row.archived===true||row.deleted===true||row.blocked===true)throw Error('Manager disabled this Rider account. Contact HQ before accepting deliveries.');
        assertUID(authUid);if(!grant||grant.uid!==authUid||grant.riderId!==id||typeof grant.sessionId!=='string'||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now()||Object.hasOwn(row,'pin')||row.riderPinManaged!==true||row.riderAuthRevision!==grant.riderAuthRevision)throw Error('The protected Rider session could not be confirmed. Sign in again.');
        invalidate();session={authUid,phone:normalizeRiderPhone(row.phone),sessionId:grant.sessionId,riderAuthRevision:grant.riderAuthRevision,expiresAt:Date.parse(grant.expiresAt),rider:publicRiderAccount(id,row)};confirmed=true;
        message('riderAuthStatus','');message('registrationStatus','');render();startWatcher();
        const sessionId=session.sessionId;expiryTimer=schedule(()=>{if(session?.sessionId!==sessionId)return;confirmed=false;error='Your protected Rider sign-in expired. Sign in again.';stopWatcher();render();},Math.max(0,session.expiresAt-now()));expiryTimer?.unref?.();return state();
    }
    async function login() {
        if(loginBusy || registerBusy)return false;
        let phone,pin;
        try{phone=normalizeRiderPhone(value('loginPhone'));pin=String(value('loginPin')).trim();if(!pin || pin.length>64)throw Error('Enter your Rider PIN.');}
        catch(reason){message('riderAuthStatus',reason.message);return false;}
        const previous=session?.sessionId;if(previous)void access.cancel(previous).catch(()=>{});
        loginBusy=true;invalidate();const epoch=sessionEpoch;busy();call('onSignedOut');message('riderAuthStatus','Checking your protected account…');let sid='';
        try{
            const authUid=await authReady();operationAuthUid=authUid;sid=operationSessionId=access.newSession();
            const current=()=>{assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Sign-in was cancelled.');};current();
            const result=await access.login({phone,pin},{sessionId:sid,assertCurrent:current});current();
            const record=await fresh(api.doc(api.db,'riders',result.rider.id));current();
            if(!record.exists())throw Error('Your Rider profile is unavailable. Contact Manager.');
            adopt(record.id || result.rider.id,record.data(),authUid,result.session);operationSessionId='';
            if(el('loginPin'))el('loginPin').value='';return true;
        }catch(reason){if(sid)void access.cancel(sid).catch(()=>{});if(epoch===sessionEpoch)message('riderAuthStatus',reason.message);return false;}
        finally{loginBusy=false;operationAuthUid='';if(operationSessionId===sid)operationSessionId='';busy();}
    }
    async function digest(bytes) {
        const crypto=api.crypto || globalThis.crypto;
        if(!crypto?.subtle?.digest)throw Error('This browser cannot verify your upload. Update your browser and try again.');
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    async function register() {
        if(registerBusy || loginBusy)return false;let values,files;
        try{
            values=validateRiderRegistration({name:value('regName'),phone:value('regPhone'),vehicle:value('regVehicle'),plate:value('regPlate'),pin:value('regPin'),pinConfirm:value('regPinConfirm')});
            files=[['license','regLicense','driver’s license'],['orcr','regORCR','OR/CR'],['selfie','regSelfie','selfie']].map(([key,id,label])=>({key,id,file:validateRiderPhoto(el(id)?.files?.[0],label)}));
        }catch(reason){message('registrationStatus',reason.message);return false;}
        const previous=session?.sessionId;if(previous)void access.cancel(previous).catch(()=>{});invalidate();
        registerBusy=true;busy();message('registrationStatus','Checking your application…');const epoch=sessionEpoch;let sid='';
        try{
            const authUid=await authReady();operationAuthUid=authUid;sid=operationSessionId=access.newSession();
            const current=()=>{assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');const fresh=validateRiderRegistration({name:value('regName'),phone:value('regPhone'),vehicle:value('regVehicle'),plate:value('regPlate'),pin:value('regPin'),pinConfirm:value('regPinConfirm')});if(riderAccessCanonical(fresh)!==riderAccessCanonical(values)||files.some(row=>el(row.id)?.files?.[0]!==row.file))throw Error('The application form changed. Review its details and photos again.');};current();
            const hashes=[];for(const {key,file}of files){let mime=String(file.type||'').toLowerCase();if(mime==='image/jpg')mime='image/jpeg';if(!mime)mime=/\.png$/i.test(file.name)?'image/png':/\.webp$/i.test(file.name)?'image/webp':'image/jpeg';const bytes=await file.arrayBuffer();current();hashes.push({key,mime,size:file.size,sha256:await digest(bytes)});current();}
            const profile={name:values.name,phone:values.phone,vehicle:values.vehicle,plateNumber:values.plateNumber};
            const fingerprint=await digest(new TextEncoder().encode(riderAccessCanonical({profile,files:hashes})));current();
            const privateIntent=await digest(new TextEncoder().encode(riderAccessCanonical({fingerprint,pin:values.pin})));current();
            if(!attempt||attempt.hash!==privateIntent||attempt.authUid!==authUid)attempt={id:'rider-reg-'+(api.crypto||globalThis.crypto).randomUUID(),hash:privateIntent,authUid,uploads:{}};
            const ownAttempt=attempt,check=await access.preflight({registrationId:ownAttempt.id,phone:values.phone,pin:values.pin,fingerprint},{sessionId:sid,assertCurrent:current});current();
            let result=check;
            if(!check.alreadyRegistered){
                for(const {key,file}of files){if(ownAttempt.uploads[key])continue;current();message('registrationStatus','Uploading '+key+' photo…');const info=hashes.find(row=>row.key===key),ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[info.mime],folder=({license:'licenses',orcr:'orcr',selfie:'selfies'})[key],path='riders/'+folder+'/'+ownAttempt.id+'.'+ext;
                    const url=await uploadRiderPhoto(api,{path,file,metadata:{contentType:info.mime,customMetadata:{riderRegistrationUid:authUid,riderRegistrationId:ownAttempt.id,sha256:info.sha256}},assertCurrent:current});current();ownAttempt.uploads[key]={path,url,size:info.size,mime:info.mime,sha256:info.sha256};
                }
                message('registrationStatus','Submitting your application for Manager review…');
                result=await access.register({registrationId:ownAttempt.id,fingerprint,...profile,pin:values.pin,uploads:ownAttempt.uploads},{sessionId:sid,assertCurrent:current});current();
            }
            const record=await fresh(api.doc(api.db,'riders',result.rider.id));current();if(!record.exists())throw Error('The saved application is unavailable. Retry these same details.');
            adopt(record.id||result.rider.id,record.data(),authUid,result.session);operationSessionId='';
            if(el('loginPhone'))el('loginPhone').value=values.phone;if(el('regPin'))el('regPin').value='';if(el('regPinConfirm'))el('regPinConfirm').value='';attempt=null;return true;
        }catch(reason){if(sid)void access.cancel(sid).catch(()=>{});if(epoch===sessionEpoch)message('registrationStatus',reason.message);return false;}
        finally{registerBusy=false;operationAuthUid='';if(operationSessionId===sid)operationSessionId='';busy();}
    }
    function refresh() {
        if(refreshPending)return refreshPending;if(!session)return Promise.resolve(false);const actor=captureActor();
        const pending=(async()=>{try{const row=await fresh(api.doc(api.db,'riders',actor.riderId));applyRecord(actor,row);if(!watcher)startWatcher();return true;}
            catch(reason){unavailable(actor,reason);return false;}
            finally{if(refreshPending===pending){refreshPending=null;busy();}}})();
        refreshPending=pending;busy();return pending;
    }
    async function requireActive() {const actor=captureActor();await refresh();assertActor(actor);return {...session.rider};}
    function logout() {const ids=[session?.sessionId,operationSessionId].filter(Boolean);invalidate();const epoch=sessionEpoch;for(const id of new Set(ids))void access.cancel(id).catch(()=>{if(epoch===sessionEpoch)message('riderAuthStatus','Signed out on this screen. Reconnect before signing in again to confirm the server sign-out.');});attempt=null;operationAuthUid='';operationSessionId='';if(el('loginPin'))el('loginPin').value='';if(el('regPin'))el('regPin').value='';if(el('regPinConfirm'))el('regPinConfirm').value='';message('riderAuthStatus','Enter your phone and PIN to sign in.');call('onSignedOut');return true;}
    try{api.localStorage?.removeItem?.('takodeal_rider_id');}catch{}
    const authStop=api.onAuthStateChanged?.(api.auth,user=>{if(session && user?.uid!==session.authUid || operationAuthUid && user?.uid!==operationAuthUid)logout();});
    const stop=()=>{logout();authStop?.();};
    return {login,register,refresh,logout,stop,state,isActive,isBusy:()=>loginBusy || registerBusy || Boolean(refreshPending),requireActive,captureActor,assertActor};
}
