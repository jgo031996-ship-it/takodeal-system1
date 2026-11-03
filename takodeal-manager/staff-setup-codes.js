export const STAFF_SETUP_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDeviceSetup';
const OWNER_EMAIL='jgo031996@gmail.com';
const actorKey=api=>JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.auth?.currentUser?.emailVerified]);
export function isSetupOwner(user){return !!user?.uid&&user.emailVerified===true&&String(user.email||'').toLowerCase()===OWNER_EMAIL;}
export function generateStaffSetupCode(cryptoAPI=globalThis.crypto){
    if(!cryptoAPI?.getRandomValues)throw Error('Secure setup code generation is unavailable.');
    let result='';const bytes=new Uint8Array(32);
    while(result.length<10){cryptoAPI.getRandomValues(bytes);for(const value of bytes){if(value<250)result+=String(value%10);if(result.length===10)break;}}
    return result;
}
export function createSetupOwnerClient(api,{fetcher=globalThis.fetch,Controller=AbortController,delay=setTimeout,cancelDelay=clearTimeout}={}){
    return async function request(route,body){
        if(!['config','policy','code-status','issue-code','disable-code','device-action'].includes(route))throw Error('Unsupported Staff setup action.');
        const user=api.auth?.currentUser,key=actorKey(api);if(!isSetupOwner(user))throw Error('Sign in with the verified Owner account to manage Staff setup codes.');
        const controller=new Controller();let deadlineReject;
        const deadline=new Promise((_,reject)=>{deadlineReject=reject;});
        const timer=delay(()=>{controller.abort();const error=Error('Request deadline reached.');error.name='AbortError';deadlineReject(error);},25000);
        try{
            const token=await Promise.race([Promise.resolve().then(()=>user.getIdToken()),deadline]);if(controller.signal.aborted){const error=Error('Request deadline reached.');error.name='AbortError';throw error;}if(actorKey(api)!==key||api.auth.currentUser!==user)throw Error('Your account changed. Reopen this action.');
            if(typeof token!=='string'||!token)throw Error('Reconnect to verify your Owner account.');
            const response=await Promise.race([fetcher(STAFF_SETUP_ENDPOINT+'/'+route,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:controller.signal}),deadline]);
            if(actorKey(api)!==key||api.auth.currentUser!==user)throw Error('Your account changed. Reopen this action.');
            let result;try{result=await Promise.race([response.json(),deadline]);}catch(error){if(error.name==='AbortError')throw error;throw Error('Staff setup service is not available yet. No change was confirmed.');}
            if(!response.ok){const error=Error(typeof result.error==='string'?result.error:result.error?.message||'Staff setup action was not confirmed. Reconnect and retry.');error.status=response.status;if(typeof result.error?.code==='string')error.code=result.error.code;throw error;}
            if(!result||typeof result!=='object'||Array.isArray(result))throw Error('HQ returned an invalid setup response. No change was confirmed.');
            return result;
        }catch(error){if(error.name==='AbortError')throw Error('HQ has not confirmed this change yet. Retry the same action; do not create another code.');if(error.name==='TypeError')throw Error('The Staff setup service could not be reached. Check your connection; no change was confirmed.');throw error;}
        finally{cancelDelay(timer);}
    };
}
function operationID(cryptoAPI){if(typeof cryptoAPI?.randomUUID==='function')return cryptoAPI.randomUUID();if(!cryptoAPI?.getRandomValues)throw Error('Secure operation IDs are unavailable.');return [...cryptoAPI.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const codeStatus=result=>result&&Number.isSafeInteger(result.version)&&result.version>=0&&typeof result.enabled==='boolean';
export function setupDeviceUsage(result){return Number.isSafeInteger(result?.activeDevices)&&result.activeDevices>=0&&Number.isSafeInteger(result?.deviceLimit)&&result.deviceLimit>0?{activeDevices:result.activeDevices,deviceLimit:result.deviceLimit}:null;}
const policyStatus=result=>result&&result.protocolVersion===1&&Number.isSafeInteger(result.revision)&&result.revision>=0&&typeof result.enabled==='boolean';

export function installStaffSetupCodes(api=window,d=document,{request=createSetupOwnerClient(api),cryptoAPI=globalThis.crypto,observe=globalThis.MutationObserver}={}){
    if(api.staffSetupCodes)return api.staffSetupCodes;
    const el=id=>d.getElementById(id),profileID=()=>el('empProfileId')?.value||'',visible=()=>!d.hidden&&el('employeeProfileModal')?.style.display!=='none';
    let epoch=0,profileState=null,pending=null,secret='',profileBusy=false,policy=null,policyBusy=false,policyEpoch=0,pendingPolicy=null,usage=null,usageBusy=false,usageEpoch=0,usageError='';
    const devicePending=new Map();
    const text=(id,value)=>{const node=el(id);if(node)node.textContent=value;};
    const hideSecret=()=>{secret='';text('staffSetupCodeValue','');if(el('staffSetupCodeResult'))el('staffSetupCodeResult').hidden=true;};
    function renderUsage(){
        text('staffSetupDeviceUsage',usage?`${usage.activeDevices} of ${usage.deviceLimit} active phones`:'Phone usage not available');
        const advice=usage&&usage.activeDevices>=usage.deviceLimit?'Limit reached. Block or delete an old Staff phone in Staff & POS devices before another phone can activate.':'After clearing app data or replacing a phone, block or delete its old registration in Staff & POS devices to free its place.';
        text('staffSetupDeviceUsageNote',usageBusy?'Checking active phone registrations…':usageError?`${usageError}${usage?' Showing the last checked count.':''}`:usage?`Last checked · ${advice}`:'Refresh phone usage to check this employee’s limit. No count has been assumed.');
    }
    function profileControls(){
        const owner=isSetupOwner(api.auth?.currentUser),ready=owner&&!!profileID()&&codeStatus(profileState)&&!profileBusy;
        if(el('staffSetupCodeGenerate')){el('staffSetupCodeGenerate').disabled=!ready;el('staffSetupCodeGenerate').textContent=profileBusy?'Saving…':pending?'Retry same code':profileState?.version?'Replace setup code':'Generate setup code';}
        if(el('staffSetupCodeDisable'))el('staffSetupCodeDisable').disabled=!ready||!profileState?.enabled||!!pending;
        if(el('staffSetupCodeRefresh'))el('staffSetupCodeRefresh').disabled=profileBusy||!owner||!!pending;
        if(el('staffSetupCodeCopy'))el('staffSetupCodeCopy').disabled=!secret;
        if(el('staffSetupUsageRefresh'))el('staffSetupUsageRefresh').disabled=profileBusy||usageBusy||!owner||!profileID();
    }
    function clear(){epoch++;usageEpoch++;profileState=null;pending=null;profileBusy=false;usage=null;usageBusy=false;usageError='';hideSecret();renderUsage();profileControls();}
    const same=(token,id,key)=>token===epoch&&id===profileID()&&key===actorKey(api)&&visible();
    async function loadProfile(){
        clear();const token=epoch,id=profileID(),key=actorKey(api);
        if(!id){text('staffSetupCodeStatus','Save the employee profile before generating a personal setup code.');return;}
        if(!isSetupOwner(api.auth?.currentUser)){text('staffSetupCodeStatus','Only the verified Owner can generate or disable personal setup codes.');return;}
        text('staffSetupCodeStatus','Checking this employee’s setup code…');
        try{const result=await request('code-status',{staffId:id});if(!same(token,id,key))return;if(!codeStatus(result)||result.staffId!==id)throw Error('HQ returned an invalid code status. Refresh before continuing.');profileState=result;usage=setupDeviceUsage(result);renderUsage();text('staffSetupCodeStatus',result.enabled?'Personal setup code is enabled. The saved code is private; replace it if the staff member needs a new copy.':result.version?'Personal setup code is disabled. Existing activated phones remain separate.':'No personal setup code has been issued.');}
        catch(error){if(same(token,id,key))text('staffSetupCodeStatus',error.message||'Setup codes are unavailable. Reconnect and refresh.');}
        finally{if(same(token,id,key))profileControls();}
    }
    async function loadUsage(){
        if(usageBusy||profileBusy||!profileID()||!isSetupOwner(api.auth?.currentUser)||!visible())return;
        const token=epoch,id=profileID(),key=actorKey(api),read=++usageEpoch,startVersion=profileState?.version;usageBusy=true;usageError='';renderUsage();profileControls();
        try{
            const result=await request('code-status',{staffId:id});if(!same(token,id,key)||read!==usageEpoch)return;
            if(!codeStatus(result)||result.staffId!==id)throw Error('HQ could not confirm this employee’s phone usage.');
            const checked=setupDeviceUsage(result);if(!checked)throw Error('Phone usage is unavailable from HQ. Reconnect and refresh.');usage=checked;
            // A routine usage refresh leaves the one-time code visible. Only
            // an explicit newer code decision can invalidate that code; a read
            // started before local issuance cannot overwrite its newer state.
            if(!pending&&profileState?.version===startVersion&&(result.version!==startVersion||result.enabled!==profileState.enabled)){
                profileState=result;hideSecret();text('staffSetupCodeStatus','The personal setup code status changed at HQ. The shown code has been cleared; check the current status before giving out another code.');
            }
        }catch(error){if(same(token,id,key)&&read===usageEpoch)usageError=error.message||'Phone usage could not refresh.';}
        finally{if(same(token,id,key)&&read===usageEpoch){usageBusy=false;renderUsage();profileControls();}}
    }
    async function confirm(title,body,button){const result=await api.Swal.fire({title,text:body,icon:'question',showCancelButton:true,confirmButtonText:button,confirmButtonColor:'#146551'});return result.isConfirmed;}
    async function issue(){
        if(profileBusy||!codeStatus(profileState)||!isSetupOwner(api.auth?.currentUser))return;
        const token=epoch,id=profileID(),key=actorKey(api);if(!same(token,id,key))return;
        profileBusy=true;profileControls();hideSecret();
        try{
            if(!pending){
                if(profileState.version&&!await confirm('Replace this personal setup code?','The old code will stop activating new or reset phones. Already activated phones will stay active.','Replace code'))return;
                if(!same(token,id,key))return;
                pending={staffId:id,code:generateStaffSetupCode(cryptoAPI),expectedVersion:profileState.version,operationId:operationID(cryptoAPI)};
            }
            text('staffSetupCodeStatus','Saving the personal setup code with HQ…');
            const result=await request('issue-code',pending);if(!same(token,id,key))return;
            if(!codeStatus(result)||result.staffId!==id||result.enabled!==true||result.version!==pending.expectedVersion+1)throw Error('HQ has not confirmed this exact code. Retry the same code.');
            secret=pending.code;pending=null;profileState=result;text('staffSetupCodeValue',secret.slice(0,5)+' '+secret.slice(5));if(el('staffSetupCodeResult'))el('staffSetupCodeResult').hidden=false;
            text('staffSetupCodeStatus','Setup code saved. Give it privately to this employee. It is shown here only until you leave or close this profile.');
        }catch(error){if(same(token,id,key)){if(error.status===409){pending=null;hideSecret();await loadProfile();}else text('staffSetupCodeStatus',error.message||'No code change was confirmed. Retry the same code.');}}
        finally{if(same(token,id,key)){profileBusy=false;profileControls();}}
    }
    async function disable(){
        if(profileBusy||pending||!profileState?.enabled||!isSetupOwner(api.auth?.currentUser))return;
        const token=epoch,id=profileID(),key=actorKey(api),expectedVersion=profileState.version;profileBusy=true;profileControls();
        try{
            if(!await confirm('Disable this personal setup code?','New or reset phones will be unable to activate with this code. Existing phones stay active; block a phone separately in Staff & POS devices.','Disable code')||!same(token,id,key))return;
            hideSecret();const result=await request('disable-code',{staffId:id,expectedVersion,operationId:operationID(cryptoAPI)});if(!same(token,id,key))return;
            if(!codeStatus(result)||result.staffId!==id||result.enabled||result.version!==expectedVersion+1)throw Error('The disable action was not confirmed. Refresh the code status.');
            profileState=result;hideSecret();text('staffSetupCodeStatus','Personal setup code disabled. Existing phones have not been blocked.');
        }catch(error){if(same(token,id,key)){if(error.status===409){hideSecret();await loadProfile();}else text('staffSetupCodeStatus',error.message||'Disable was not confirmed. Refresh before retrying.');}}
        finally{if(same(token,id,key)){profileBusy=false;profileControls();}}
    }
    async function copy(){const id=profileID(),key=actorKey(api),value=secret,token=epoch;if(!value||!same(token,id,key))return;try{await api.navigator.clipboard.writeText(value);if(same(token,id,key))text('staffSetupCodeStatus','Code copied. Share it privately with this employee; do not post it in a group chat.');}catch{if(same(token,id,key))text('staffSetupCodeStatus','Copy is unavailable. Read the ten digits shown and give them privately to this employee.');}}
    function policyControls(){const owner=isSetupOwner(api.auth?.currentUser),ready=owner&&policyStatus(policy)&&!policyBusy;for(const id of ['staffSetupPolicyEnable','staffSetupPolicyPause'])if(el(id))el(id).disabled=!ready;if(el('staffSetupPolicyEnable'))el('staffSetupPolicyEnable').hidden=policy?.enabled===true;if(el('staffSetupPolicyPause'))el('staffSetupPolicyPause').hidden=policy?.enabled!==true;if(el('staffSetupPolicyRefresh'))el('staffSetupPolicyRefresh').disabled=policyBusy||!owner;}
    async function loadPolicy(){
        const token=++policyEpoch,key=actorKey(api);policy=null;pendingPolicy=null;policyBusy=false;policyControls();
        if(!isSetupOwner(api.auth?.currentUser)){text('staffSetupPolicyStatus','Only the verified Owner can change the Staff app setup requirement.');return;}
        text('staffSetupPolicyStatus','Checking Staff app setup requirements…');
        try{const result=await request('config',{});if(token!==policyEpoch||key!==actorKey(api))return;if(!policyStatus(result))throw Error('HQ returned an invalid setup policy.');policy=result;text('staffSetupPolicyStatus',result.enabled?'Required · staff activate their own phone with their personal setup code.':'Preparation mode · issue and distribute codes before requiring one setup check on all phones.');}
        catch(error){if(token===policyEpoch&&key===actorKey(api))text('staffSetupPolicyStatus',error.message||'Setup service is unavailable. The requirement has not been changed.');}
        finally{if(token===policyEpoch&&key===actorKey(api))policyControls();}
    }
    async function changePolicy(enabled){
        if(policyBusy||!policyStatus(policy)||!isSetupOwner(api.auth?.currentUser))return;
        const token=policyEpoch,key=actorKey(api);policyBusy=true;policyControls();
        try{
            if(!pendingPolicy){if(!await confirm(enabled?'Require personal setup codes?':'Pause the setup requirement?',enabled?'Confirm you have issued and privately distributed a code to every active staff member. Existing phones will need one setup-code check; new or reset phones activate automatically after the correct code.':'Unenrolled phones will use the legacy approval flow. Activated phones and individually blocked phones keep their protected device status.',enabled?'Codes distributed · require setup':'Pause requirement'))return;if(token!==policyEpoch||key!==actorKey(api))return;pendingPolicy={enabled,expectedRevision:policy.revision,operationId:operationID(cryptoAPI)};}
            const result=await request('policy',pendingPolicy);if(token!==policyEpoch||key!==actorKey(api))return;if(!policyStatus(result)||result.enabled!==pendingPolicy.enabled||result.revision!==pendingPolicy.expectedRevision+1)throw Error('HQ has not confirmed this policy change. Retry the same action.');
            policy=result;pendingPolicy=null;text('staffSetupPolicyStatus',result.enabled?'Required · correct personal codes activate staff phones automatically.':'Preparation mode · legacy approval remains for unenrolled phones. Existing protected phones keep their status.');
        }catch(error){if(token===policyEpoch&&key===actorKey(api)){if(error.status===409){pendingPolicy=null;await loadPolicy();}else text('staffSetupPolicyStatus',error.message||'No setup requirement change was confirmed.');}}
        finally{if(token===policyEpoch&&key===actorKey(api)){policyBusy=false;policyControls();}}
    }
    async function routeDeviceChange(deviceId,action,legacyAction,confirmProtected=async()=>true){
        if(!['block','unblock','delete'].includes(action))throw Error('Unsupported device action.');
        const key=actorKey(api),pendingKey=JSON.stringify([key,deviceId,action]);
        // A confirmed delete can lose its HTTP response after removing the
        // public fleet mirror. Retry the known server operation before looking
        // for that mirror; the server still verifies authority and its marker.
        const retry=devicePending.get(pendingKey);
        if(retry){try{const result=await request('device-action',retry);if(actorKey(api)!==key)throw Error('Your account changed. Refresh the device list.');devicePending.delete(pendingKey);return result;}catch(error){if(error.status===409){devicePending.delete(pendingKey);if(actorKey(api)===key)api.loadDeviceFleet?.();}throw error;}}
        const snap=await api.getDocFromServer(api.doc(api.db,'pos_devices',deviceId));
        if(actorKey(api)!==key)throw Error('Your account changed. Reopen the device list.');
        if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to confirm this device before changing it.');
        if(!snap.exists())throw Error('This device is no longer listed. Refresh the device list.');
        const data=snap.data(),protectedStaff=data.setupVersion===1||typeof data.setupUid==='string'&&!!data.setupUid;
        if(!protectedStaff)return legacyAction();
        if(data.appType!=='Staff')throw Error('The protected device record needs HQ review.');
        if(!await confirmProtected())return {cancelled:true};
        if(actorKey(api)!==key)throw Error('Your account changed. Reopen the device list.');
        const operation={deviceId,action,operationId:operationID(cryptoAPI)};devicePending.set(pendingKey,operation);
        try{const result=await request('device-action',operation);if(actorKey(api)!==key)throw Error('Your account changed. Refresh the device list.');devicePending.delete(pendingKey);return result;}
        catch(error){if(error.status===409){devicePending.delete(pendingKey);if(actorKey(api)===key)api.loadDeviceFleet?.();}throw error;}
    }
    el('staffSetupCodeGenerate')?.addEventListener('click',issue);el('staffSetupCodeDisable')?.addEventListener('click',disable);el('staffSetupCodeRefresh')?.addEventListener('click',loadProfile);el('staffSetupCodeCopy')?.addEventListener('click',copy);el('staffSetupUsageRefresh')?.addEventListener('click',loadUsage);
    el('staffSetupPolicyRefresh')?.addEventListener('click',loadPolicy);el('staffSetupPolicyEnable')?.addEventListener('click',()=>changePolicy(true));el('staffSetupPolicyPause')?.addEventListener('click',()=>changePolicy(false));
    const open=api.openEmployeeProfile;if(open)api.openEmployeeProfile=function(...args){clear();const result=open.apply(this,args);void loadProfile();return result;};
    const fresh=api.addNewStaff;if(fresh)api.addNewStaff=function(...args){clear();const result=fresh.apply(this,args);text('staffSetupCodeStatus','Save the employee profile before generating a personal setup code.');return result;};
    const switchView=api.switchView;if(switchView)api.switchView=function(view,...args){const result=switchView.call(this,view,...args);if(view==='branches')void loadPolicy();else{clear();policyEpoch++;pendingPolicy=null;policyBusy=false;}return result;};
    const invalidate=()=>{clear();policyEpoch++;pendingPolicy=null;policyBusy=false;policy=null;devicePending.clear();policyControls();};
    if(observe&&el('employeeProfileModal'))new observe(()=>{if(!visible())clear();}).observe(el('employeeProfileModal'),{attributes:true,attributeFilter:['style']});
    el('empProfileId')?.addEventListener('change',clear);d.addEventListener('visibilitychange',()=>{if(d.hidden)invalidate();else if(visible()&&profileID())void loadProfile();});api.addEventListener?.('pagehide',invalidate);api.auth?.onAuthStateChanged?.(invalidate);
    renderUsage();profileControls();policyControls();api.staffSetupCodes={loadProfile,loadUsage,loadPolicy,clear,invalidate,routeDeviceChange};return api.staffSetupCodes;
}
