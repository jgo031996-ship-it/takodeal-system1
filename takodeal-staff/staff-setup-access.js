// Setup-code verification is performed by the trusted service. No code or
// verifier is written to browser storage, public profiles or the device mirror.
export const STAFF_SETUP_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDeviceSetup';
export const STAFF_SETUP_DRAFT='takodeal_staff_setup_draft_v1';
const key=value=>typeof value==='string' && /^[-A-Za-z0-9_]{1,128}$/.test(value);
const deviceKey=value=>typeof value==='string' && /^DEV-[A-Z0-9-]{6,50}$/.test(value);
export function normalizeSetupCode(value){const code=String(value??'').replace(/[ -]/g,'');if(!/^\d{10}$/.test(code))throw Error('Enter the 10-digit setup code given to you by the Owner.');return code;}
export function freshSetupId(cryptoAPI=globalThis.crypto){if(typeof cryptoAPI?.randomUUID==='function')return cryptoAPI.randomUUID();if(typeof cryptoAPI?.getRandomValues!=='function')throw Error('Secure device setup is unavailable in this browser.');const bytes=cryptoAPI.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
function withinSetupDeadline(action,{delay=setTimeout,cancelDelay=clearTimeout,Controller=AbortController},message){
    const controller=new Controller();let finished=false,expired=false,rejectTimeout;
    const timeout=new Promise((_,reject)=>{rejectTimeout=reject;});
    const failure=()=>Error(message),guard=()=>{if(expired||finished)throw failure();};
    const timer=delay(()=>{expired=true;controller.abort();rejectTimeout(failure());},20000);
    return Promise.race([Promise.resolve().then(()=>{guard();return action({signal:controller.signal,guard});}),timeout]).finally(()=>{finished=true;cancelDelay(timer);});
}
export function createStaffSetupTransport({auth,ensureUser,fetcher=fetch,delay=setTimeout,cancelDelay=clearTimeout,Controller=AbortController}){
    let flight;
    const timing={delay,cancelDelay,Controller};
    const ready=()=>{
        if(flight)return flight;let pending;
        pending=withinSetupDeadline(async context=>{const user=await ensureUser(context);context.guard();if(!user?.uid || auth.currentUser?.uid!==user.uid)throw Error('The staff device session changed. Check again.');return user;},timing,'The staff device session could not be confirmed in time. Check your connection and choose Check again.').finally(()=>{if(flight===pending)flight=null;});
        flight=pending;return pending;
    };
    async function call(route,body){
        if(!['/config','/activate','/device-status'].includes(route))throw Error('Unsupported device setup action.');
        try{
            return await withinSetupDeadline(async({signal,guard})=>{
                const user=await ready();guard();const uid=user.uid,token=await user.getIdToken();guard();
                if(!token || auth.currentUser?.uid!==uid)throw Error('The staff device session changed. Check again.');
                const response=await fetcher(STAFF_SETUP_ENDPOINT+route,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal});guard();
                let data;try{data=await response.json();}catch{guard();throw Error('The Staff setup service is not available. Check your connection and choose Check again.');}guard();
                if(auth.currentUser?.uid!==uid)throw Error('The staff device session changed. Check again.');
                if(!response.ok){const message=typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:null,error=Error(message?.slice(0,350)||'Device setup could not be confirmed. Check your code or contact the Owner.');error.status=response.status;throw error;}
                return data;
            },timing,'HQ has not confirmed this action yet. Check again before starting another setup.');
        }catch(error){if(error.name==='AbortError')throw Error('HQ has not confirmed this action yet. Check again before starting another setup.');throw error;}
    }
    return {ready,call};
}
export function validateSetupStatus(data,deviceId){
    if(typeof data?.enabled!=='boolean' || !['legacy','protected'].includes(data.mode) || data.mode==='legacy' && data.enabled)throw Error('HQ returned an unsupported setup status. Contact the Owner.');
    if(data.mode==='legacy'){if(data.device!==null)throw Error('HQ returned an unsupported device status.');return {enabled:false,mode:'legacy',device:null};}
    if(data.device===null)return {enabled:data.enabled,mode:'protected',device:null};
    const d=data.device;
    if(!key(d.staffId) || !deviceKey(d.deviceId) || d.deviceId!==deviceId || typeof d.staffName!=='string' || !d.staffName.trim() || typeof d.branch!=='string' || !d.branch.trim() || !['Active','Blocked','Deleted','Revoked'].includes(d.status))throw Error('HQ could not confirm this phone’s staff account.');
    return {enabled:data.enabled,mode:'protected',device:{staffId:d.staffId,staffName:d.staffName,branch:d.branch,deviceId:d.deviceId,status:d.status}};
}
export function createStaffSetupAuthority({transport,getUid,now=Date.now,maxAgeMs=60000}){
    let state=null,authorityEpoch=0,readEpoch=0;
    function invalidate(){state=null;authorityEpoch++;readEpoch++;}
    const current=()=>state && state.uid===getUid() && now()-state.checkedAt>=0 && now()-state.checkedAt<=maxAgeMs ? state : null;
    const isVerified=()=>{const value=current();return !!value && (value.mode==='legacy' || value.device?.status==='Active');};
    async function confirm(deviceId){
        if(!deviceKey(deviceId))throw Error('This phone’s setup ID is invalid. Contact the Owner.');
        const token=++readEpoch;
        try{
            const user=await transport.ready(),uid=user.uid,data=await transport.call('/device-status',{deviceId});
            if(token!==readEpoch || uid!==getUid())throw Error('The staff device session changed. Check again.');
            const next=validateSetupStatus(data,deviceId),fingerprint=value=>JSON.stringify([value?.uid,value?.mode,value?.device?.staffId,value?.device?.deviceId,value?.device?.status]);
            const value={...next,uid,checkedAt:now()};if(fingerprint(state)!==fingerprint(value))authorityEpoch++;
            state=value;return {...next,device:next.device?{...next.device}:null};
        }catch(error){if(token===readEpoch)invalidate();throw error;}
    }
    function assertStaff(staffId){if(!isVerified())throw Error('Reconnect to confirm this phone before signing in.');const value=current();if(value.mode==='protected' && value.device.staffId!==staffId)throw Error('This phone is set up for a different staff account. Use your own staff login PIN.');return true;}
    function capture(){if(!isVerified())throw Error('Reconnect to confirm this phone before signing in.');return {epoch:authorityEpoch,uid:state.uid,mode:state.mode,staffId:state.device?.staffId||null};}
    function assert(snapshot,staffId){if(!snapshot || snapshot.epoch!==authorityEpoch || snapshot.uid!==getUid())throw Error('The device or staff session changed. Sign in again.');return assertStaff(staffId);}
    return {confirm,invalidate,isVerified,assertStaff,capture,assert,binding:()=>current()?.mode==='protected'&&current().device?{...current().device}:null,mode:()=>current()?.mode||null};
}
export async function readSetupStaffDirectory({projectId,apiKey,getToken,fetcher=fetch,Controller=AbortController,delay=setTimeout,cancelDelay=clearTimeout}){
    const rows=[];
    const fields=['cashierName','branch','status','active','archived','blocked'];let pageToken='';
    try{
      return await withinSetupDeadline(async({signal,guard})=>{
        const token=await getToken();guard();
        for(let page=0;page<20;page++){
            const params=new URLSearchParams({key:apiKey,pageSize:'100'});for(const field of fields)params.append('mask.fieldPaths',field);if(pageToken)params.set('pageToken',pageToken);
            const response=await fetcher(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/cashiers?${params}`,{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token},signal});guard();
            const data=await response.json();guard();if(!response.ok)throw Error('The staff list could not load. Check your connection and try again.');
            for(const doc of data.documents||[]){const f=doc.fields||{},staffId=doc.name?.split('/').pop(),name=f.cashierName?.stringValue,branch=f.branch?.stringValue,status=f.status?.stringValue||'';if(key(staffId)&&name?.trim()&&branch?.trim()&&f.active?.booleanValue!==false&&f.archived?.booleanValue!==true&&f.blocked?.booleanValue!==true&&!/^(Blocked|Revoked|Terminated|Resigned|Inactive|Disabled|Archived|Deleted)$/i.test(status))rows.push({staffId,name,branch});}
            pageToken=data.nextPageToken||'';if(!pageToken)return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.branch.localeCompare(b.branch));
        }
        throw Error('The staff list is too large to load safely. Contact the Owner.');
      },{delay,cancelDelay,Controller},'The staff list took too long to load. Check your connection and try again.');
    }catch(error){if(error.name==='AbortError')throw Error('The staff list took too long to load. Check your connection and try again.');throw error;}
}
export function installStaffSetupGate(config,{legacyRequest,legacyListen,stopLegacy},environment=globalThis){
    const w=environment.window||environment,d=environment.document,ls=environment.localStorage,nav=environment.navigator;
    const el=id=>d.getElementById(id),transport=createStaffSetupTransport({...config,fetcher:config.fetcher||environment.fetch?.bind(environment)});
    const authority=createStaffSetupAuthority({transport,getUid:()=>config.auth.currentUser?.uid});
    w.staffSetupAccess=authority;
    let busy=false,startFlight=null,pollTimer,visibleEpoch=0,protectedMode=false,directoryEpoch=0,enteredKey='';
    const saved=()=>{try{return JSON.parse(ls.getItem(STAFF_SETUP_DRAFT)||'null');}catch{return null;}};
    const message=text=>{if(el('deviceRegistrationStatus'))el('deviceRegistrationStatus').textContent=text;};
    const clearCode=()=>{if(el('staffSetupCode'))el('staffSetupCode').value='';};
    function stop(){visibleEpoch++;directoryEpoch++;clearTimeout(pollTimer);stopLegacy?.();authority.invalidate();clearCode();startFlight=null;enteredKey='';}
    function lock(){w.stopStaffLiveListeners?.();w.lockPayslipVault?.();for(const id of ['appContainer','loginOverlay','deviceBlockedOverlay'])if(el(id))el(id).style.display='none';if(el('deviceAuthOverlay'))el('deviceAuthOverlay').style.display='flex';}
    function checking(text){lock();if(el('registerCard'))el('registerCard').style.display='none';if(el('pendingCard'))el('pendingCard').style.display='block';if(el('devicePendingTitle'))el('devicePendingTitle').textContent='Checking your device';if(el('devicePendingText'))el('devicePendingText').textContent=text;if(el('deviceRetryButton'))el('deviceRetryButton').hidden=false;}
    function deviceId(){const draft=saved(),value=(draft?.setupVersion===1?draft.deviceId:null)||ls.getItem('takodeal_device_id')||draft?.deviceId;if(deviceKey(value))return value;const id='DEV-'+freshSetupId(w.crypto).toUpperCase();ls.setItem(STAFF_SETUP_DRAFT,JSON.stringify({deviceId:id,setupVersion:1}));return id;}
    function enrollmentId(previousId){const draft=saved();if(draft?.setupVersion===1&&deviceKey(draft.deviceId))return draft.deviceId;const id='DEV-'+freshSetupId(w.crypto).toUpperCase();ls.setItem(STAFF_SETUP_DRAFT,JSON.stringify({deviceId:id,setupVersion:1,...(previousId?{previousLegacyDeviceId:previousId}:{})}));return id;}
    function form(required){protectedMode=required;lock();if(el('pendingCard'))el('pendingCard').style.display='none';if(el('registerCard'))el('registerCard').style.display='block';if(el('staffSetupFields'))el('staffSetupFields').hidden=!required;if(el('legacyBranchFields'))el('legacyBranchFields').hidden=required;if(el('deviceSetupIntro'))el('deviceSetupIntro').textContent=required?'Choose your staff account and enter the personal setup code given to you by the Owner. A correct code activates this phone automatically.':'Give this device a name and choose your branch. HQ will review your request before you sign in.';const button=d.querySelector('#registerCard .btn-primary');if(button)button.textContent=required?'Activate my Staff app':'Request access';}
    async function directory(){
        const token=++directoryEpoch,select=el('setupStaffInput');if(!select)return;
        select.disabled=true;message('Loading staff accounts…');
        try{const uid=(await transport.ready()).uid,rows=await readSetupStaffDirectory({...config,getToken:async()=>(await transport.ready()).getIdToken(),fetcher:config.directoryFetcher||config.fetcher||environment.fetch?.bind(environment)});if(token!==directoryEpoch||uid!==config.auth.currentUser?.uid||!protectedMode)return;const previous=select.value||saved()?.staffId;select.replaceChildren();const first=d.createElement('option');first.value='';first.textContent='Choose your name';select.append(first);for(const row of rows){const option=d.createElement('option');option.value=row.staffId;option.textContent=`${row.name} · ${row.branch}`;select.append(option);}if(rows.some(row=>row.staffId===previous))select.value=previous;message(rows.length?'Your setup code is separate from your daily Staff login PIN and Payslip PIN.':'No eligible staff accounts found. Ask the Owner to check your profile.');}
        catch(error){if(token===directoryEpoch)message(error.message);}
        finally{if(token===directoryEpoch)select.disabled=false;}
    }
    function apply(result,id){
        if(result.mode==='legacy'){
            protectedMode=false;if(el('staffSetupFields'))el('staffSetupFields').hidden=true;if(el('legacyBranchFields'))el('legacyBranchFields').hidden=false;
            const legacyId=ls.getItem('takodeal_device_id');
            if(legacyId){if(enteredKey==='legacy:'+legacyId)return;enteredKey='legacy:'+legacyId;return legacyListen(legacyId);}
            form(false);return;
        }
        protectedMode=true;
        // Invalidate the preceding public mirror subscription even when this
        // transition was discovered by a quiet policy/status refresh.
        stopLegacy?.();
        if(!result.device){enrollmentId(ls.getItem('takodeal_device_id'));enteredKey='';form(true);const draft=saved();if(draft?.deviceName&&el('deviceNameInput'))el('deviceNameInput').value=draft.deviceName;void directory();return;}
        if(result.device.status!=='Active'){checking('This phone’s access is paused. Contact the Owner before signing in.');if(el('devicePendingTitle'))el('devicePendingTitle').textContent='Device access paused';return;}
        const old=ls.getItem('takodeal_staff_id'),wrongStaff=old&&old!==result.device.staffId;if(wrongStaff){w.stopStaffLiveListeners?.();for(const key of ['takodeal_staff_name','takodeal_staff_id','takodeal_staff_pic'])ls.removeItem(key);}
        ls.setItem('takodeal_device_id',id);if(saved()?.deviceId===id)ls.removeItem(STAFF_SETUP_DRAFT);if(el('deviceAuthOverlay'))el('deviceAuthOverlay').style.display='none';
        const nextKey=JSON.stringify([config.auth.currentUser?.uid,id,result.device.staffId]);if(enteredKey!==nextKey||wrongStaff){enteredKey=nextKey;w.checkNormalLogin();}
    }
    function schedule(){clearTimeout(pollTimer);if(!d.hidden&&authority.isVerified())pollTimer=setTimeout(()=>start(false),30000);}
    async function run(showChecking){
        const token=++visibleEpoch;if(showChecking){enteredKey='';stopLegacy?.();checking('Connecting to HQ to confirm this phone.');}
        try{const id=deviceId(),result=await authority.confirm(id);if(token!==visibleEpoch||d.hidden)return;await apply(result,id);}
        catch(error){if(token===visibleEpoch&&!d.hidden){checking(error.message||'HQ could not confirm this phone. Reconnect and choose Check again.');if(el('devicePendingTitle'))el('devicePendingTitle').textContent='Connection to HQ needed';}}
        finally{if(token===visibleEpoch)schedule();}
    }
    function start(showChecking=true){if(startFlight)return startFlight;let pending;pending=run(showChecking).finally(()=>{if(startFlight===pending)startFlight=null;});startFlight=pending;return pending;}
    w.startStaffDeviceSetup=start;
    w.listenToDeviceStatus=()=>start();
    w.requestDeviceAccess=async()=>{
        if(busy)return;
        if(authority.mode()==='legacy'&&!protectedMode)return legacyRequest();
        const deviceName=el('deviceNameInput')?.value.trim(),staffId=el('setupStaffInput')?.value;
        if(!deviceName || !key(staffId)){message('Enter a device name and choose your staff account.');return;}
        let code;try{code=normalizeSetupCode(el('staffSetupCode')?.value);}catch(error){message(error.message);return;}
        busy=true;w.staffDeviceRegistrationBusy=true;const button=d.querySelector('#registerCard .btn-primary');if(button){button.disabled=true;button.textContent='Activating securely…';}const token=++visibleEpoch;
        try{
            if(nav?.onLine===false)throw Error('Connect to the internet to activate this Staff app.');
            const user=await transport.ready(),uid=user.uid,id=enrollmentId(ls.getItem('takodeal_device_id')),previous=saved();
            const draft={deviceId:id,deviceName,staffId,setupVersion:1,...(previous?.previousLegacyDeviceId?{previousLegacyDeviceId:previous.previousLegacyDeviceId}:{}),operationId:previous?.staffId===staffId&&previous?.deviceName===deviceName&&previous?.operationId?previous.operationId:freshSetupId(w.crypto)};
            ls.setItem(STAFF_SETUP_DRAFT,JSON.stringify(draft));
            await transport.call('/activate',{deviceId:id,deviceName,staffId,operationId:draft.operationId,code});
            if(token!==visibleEpoch||uid!==config.auth.currentUser?.uid)throw Error('The device session changed. Check again.');
            const result=await authority.confirm(id);
            if(token!==visibleEpoch||uid!==config.auth.currentUser?.uid)return;
            if(result.mode!=='protected'||result.device?.status!=='Active'||result.device.staffId!==staffId)throw Error('HQ has not confirmed activation for this staff account. Check again.');
            ls.setItem('takodeal_device_id',id);ls.removeItem(STAFF_SETUP_DRAFT);message('This phone is activated. Continue with your Staff login PIN.');await apply(result,id);schedule();
        }catch(error){if(token===visibleEpoch)message(error.message||'Activation was not confirmed. Check again or re-enter your setup code.');}
        finally{code='';clearCode();busy=false;w.staffDeviceRegistrationBusy=false;if(button){button.disabled=false;button.textContent=protectedMode?'Activate my Staff app':'Request access';}}
    };
    w.retryDeviceRegistration=()=>start();
    el('setupStaffReload')?.addEventListener('click',()=>directory());
    el('setupStaffInput')?.addEventListener('change',clearCode);
    d.addEventListener('visibilitychange',()=>{if(d.hidden){stop();lock();}else if(!busy)void start();});
    w.addEventListener('online',()=>{if(!busy)void start();});
    w.addEventListener('pagehide',()=>{stop();lock();});
    config.onAuthChange?.(()=>{stop();checking('The device session changed. Choose Check again to reconnect.');});
    return {authority,start,stop,transport};
}
