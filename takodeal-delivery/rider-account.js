import {normalizeRiderPhone,riderPhoneVariants,validateRiderRegistration,validateRiderPhoto,riderApproved,riderStatusMessage,riderSubmittedAt,publicRiderAccount} from './rider-account-model.js';

// Legacy phone/PIN authentication is retained. This client workflow does not
// replace server-side rider ownership/approval rules or persist a login token.
export function installRiderAccount(api,d=document,callbacks={}) {
    let session=null,sessionEpoch=0,watcher=null,watcherRun=0,confirmed=false,error='',loginBusy=false,registerBusy=false,refreshPending=null,attempt=null,operationAuthUid='';
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
    function isActive() {return Boolean(session && uid()===session.authUid && confirmed && !error && riderApproved(session.rider.status));}
    function state() {return {rider:session?{...session.rider}:null,sessionEpoch,confirmed,isActive:isActive(),error,busy:loginBusy || registerBusy || Boolean(refreshPending),
        status:session?riderStatusMessage(session.rider,error):null};}
    function captureActor() {
        if(!session || uid()!==session.authUid)throw Error('Sign in to your Rider account first.');
        return {authUid:session.authUid,riderId:session.rider.id,sessionEpoch};
    }
    function assertActor(actor,{active=true}={}) {
        if(!actor || !session || uid()!==actor.authUid || session.authUid!==actor.authUid || session.rider.id!==actor.riderId || sessionEpoch!==actor.sessionEpoch)
            throw Error('Your Rider session changed. Reopen this action.');
        if(active && !isActive())throw Error('Manager approval is required before accepting deliveries.');
    }
    function render() {
        if(!session)return;const summary=riderStatusMessage(session.rider,error);
        text('applicationName',session.rider.name);text('applicationPhone',session.rider.phone);text('applicationStatus',summary.label);
        text('applicationMessage',summary.message);text('applicationSubmittedAt',riderSubmittedAt(session.rider.joinedAt));
        if(isActive())call('onActive',{...session.rider});else if(error)call('onStatusError',state());else call('onRestricted',state());
    }
    function invalidate() {sessionEpoch++;stopWatcher();session=null;confirmed=false;error='';refreshPending=null;busy();}
    function applyRecord(actor,snapshot) {
        assertActor(actor,{active:false});
        if(!snapshot.exists())throw Error('This Rider account is no longer available. Contact Manager.');
        const row=snapshot.data();
        if(normalizeRiderPhone(row.phone)!==session.phone || String(row.pin ?? '').trim()!==session.pin)throw Error('Your sign-in details changed. Sign in again.');
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
    async function lookup(phone) {
        if(typeof api.getDocsFromServer!=='function')throw Error('Reconnect to check your phone number with Manager.');
        const snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'riders'),api.where('phone','in',riderPhoneVariants(phone))));
        if(snapshot.metadata?.fromCache===true)throw Error('Reconnect to confirm your account.');
        return snapshot.docs;
    }
    function adopt(id,row,authUid,pin) {
        assertUID(authUid);invalidate();session={authUid,phone:normalizeRiderPhone(row.phone),pin,rider:publicRiderAccount(id,row)};confirmed=true;
        message('riderAuthStatus','');message('registrationStatus','');render();startWatcher();return state();
    }
    async function login() {
        if(loginBusy || registerBusy)return false;
        let phone,pin;
        try{phone=normalizeRiderPhone(value('loginPhone'));pin=String(value('loginPin')).trim();if(!pin || pin.length>64)throw Error('Enter your Rider PIN.');}
        catch(reason){message('riderAuthStatus',reason.message);return false;}
        loginBusy=true;invalidate();const epoch=sessionEpoch;busy();call('onSignedOut');message('riderAuthStatus','Checking your account…');
        try{
            const authUid=await authReady();operationAuthUid=authUid;if(epoch!==sessionEpoch)throw Error('Sign-in was cancelled.');
            const rows=await lookup(phone);assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Sign-in was cancelled.');
            if(rows.length>1)throw Error('This phone has more than one Rider record. Ask Manager to resolve the duplicate before signing in.');
            if(!rows.length || String(rows[0].data().pin ?? '').trim()!==pin)throw Error('The phone number or PIN is incorrect.');
            const record=await fresh(api.doc(api.db,'riders',rows[0].id));assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Sign-in was cancelled.');
            if(!record.exists() || normalizeRiderPhone(record.data().phone)!==phone || String(record.data().pin ?? '').trim()!==pin)throw Error('The phone number or PIN changed. Try signing in again.');
            adopt(record.id || rows[0].id,record.data(),authUid,pin);return true;
        }catch(reason){if(epoch===sessionEpoch)message('riderAuthStatus',reason.message);return false;}
        finally{loginBusy=false;operationAuthUid='';busy();}
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
            files=[['license','regLicense','driver’s license'],['orcr','regORCR','OR/CR'],['selfie','regSelfie','selfie']].map(([key,id,label])=>({key,file:validateRiderPhoto(el(id)?.files?.[0],label)}));
        }catch(reason){message('registrationStatus',reason.message);return false;}
        registerBusy=true;busy();message('registrationStatus','Checking your application…');const epoch=sessionEpoch;
        try{
            const authUid=await authReady();operationAuthUid=authUid;if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
            const hashes=[];for(const {key,file} of files){const bytes=await file.arrayBuffer();assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');hashes.push({key,name:file.name,size:file.size,sha256:await digest(bytes)});assertUID(authUid);}
            const hash=await digest(new TextEncoder().encode(JSON.stringify({...values,files:hashes})));assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
            if(!attempt || attempt.hash!==hash || attempt.authUid!==authUid){const crypto=api.crypto || globalThis.crypto;attempt={id:'rider-reg-'+crypto.randomUUID(),hash,authUid,urls:{}};}
            const ownAttempt=attempt,id='rider-phone-'+values.phone,recordRef=api.doc(api.db,'riders',id),matches=await lookup(values.phone);assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
            const sameAttempt=row=>row.registrationId===ownAttempt.id && row.registrationUid===authUid && row.registrationFingerprint===hash
                && row.phone===values.phone && String(row.pin ?? '').trim()===values.pin;
            if(matches.some(row=>row.id!==id || !sameAttempt(row.data())))throw Error('An application already exists for this phone. Sign in with your PIN or contact Manager; do not submit another application.');
            for(const {key,file} of files){
                if(ownAttempt.urls[key])continue;
                if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');assertUID(authUid);message('registrationStatus','Uploading '+key+' photo…');
                const ext=String(file.name).split('.').pop().replace(/[^a-zA-Z0-9]/g,'').slice(0,10) || 'jpg';
                const folder=({license:'licenses',orcr:'orcr',selfie:'selfies'})[key];
                const uploaded=await api.uploadBytes(api.ref(api.storage,'riders/'+folder+'/'+ownAttempt.id+'.'+ext),file);assertUID(authUid);
                const url=await api.getDownloadURL(uploaded.ref);assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');ownAttempt.urls[key]=url;
            }
            message('registrationStatus','Submitting your application…');
            const latestMatches=await lookup(values.phone);assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
            if(latestMatches.some(row=>row.id!==id || !sameAttempt(row.data())))throw Error('An application already exists for this phone. Sign in with your PIN or contact Manager.');
            const result=await api.runTransaction(api.db,async tx=>{
                assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
                const current=await tx.get(recordRef),legacy=[];
                for(const row of latestMatches)if(row.id!==id)legacy.push(await tx.get(api.doc(api.db,'riders',row.id)));
                assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');
                if(legacy.some(row=>row.exists()))throw Error('An application already exists for this phone. Contact Manager.');
                if(current.exists()){if(!sameAttempt(current.data()))throw Error('An application already exists for this phone. Sign in with your PIN.');return current.data();}
                const row={...values,licenseUrl:ownAttempt.urls.license,orcrUrl:ownAttempt.urls.orcr,selfieUrl:ownAttempt.urls.selfie,status:'pending_approval',walletBalance:0,rating:5,totalDeliveries:0,
                    joinedAt:api.serverTimestamp(),fleetType:'Main Office',franchiseAccess:true,isAcceptingOrders:false,registrationId:ownAttempt.id,registrationUid:authUid,registrationFingerprint:hash};
                tx.set(recordRef,row);return row;
            });
            assertUID(authUid);if(epoch!==sessionEpoch)throw Error('Registration was cancelled.');adopt(id,result,authUid,values.pin);
            if(el('loginPhone'))el('loginPhone').value=values.phone;if(el('regPin'))el('regPin').value='';if(el('regPinConfirm'))el('regPinConfirm').value='';attempt=null;return true;
        }catch(reason){if(epoch===sessionEpoch)message('registrationStatus',reason.message);return false;}
        finally{registerBusy=false;operationAuthUid='';busy();}
    }
    function refresh() {
        if(refreshPending)return refreshPending;if(!session)return Promise.resolve(false);const actor=captureActor();
        const pending=(async()=>{try{const row=await fresh(api.doc(api.db,'riders',actor.riderId));applyRecord(actor,row);if(!watcher)startWatcher();return true;}
            catch(reason){unavailable(actor,reason);return false;}
            finally{if(refreshPending===pending){refreshPending=null;busy();}}})();
        refreshPending=pending;busy();return pending;
    }
    async function requireActive() {const actor=captureActor();await refresh();assertActor(actor);return {...session.rider};}
    function logout() {invalidate();attempt=null;operationAuthUid='';if(el('loginPin'))el('loginPin').value='';if(el('regPin'))el('regPin').value='';if(el('regPinConfirm'))el('regPinConfirm').value='';message('riderAuthStatus','Enter your phone and PIN to sign in.');call('onSignedOut');return true;}
    try{api.localStorage?.removeItem?.('takodeal_rider_id');}catch{}
    const authStop=api.onAuthStateChanged?.(api.auth,user=>{if(session && user?.uid!==session.authUid || operationAuthUid && user?.uid!==operationAuthUid)logout();});
    const stop=()=>{logout();authStop?.();};
    return {login,register,refresh,logout,stop,state,isActive,isBusy:()=>loginBusy || registerBusy || Boolean(refreshPending),requireActive,captureActor,assertActor};
}
