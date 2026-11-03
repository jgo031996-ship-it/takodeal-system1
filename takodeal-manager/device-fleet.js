import {isCashierFleetDevice} from './cashier-device-approval.js';
import {waitForAppUpdate} from './owner-app-update.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const milliseconds = value => value?.toMillis ? value.toMillis() : value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime() || 0;
export function fleetRows(devices, allowed = () => true) {
 return devices.filter(d=>allowed(d.branch)).sort((a,b)=>(b.status==='Pending')-(a.status==='Pending')||milliseconds(b.registeredAt)-milliseconds(a.registeredAt)).map(d=>{
  const approved=['Active','Approved'].includes(d.status),pending=d.status==='Pending',cashier=isCashierFleetDevice(d),bindings=Array.isArray(d.cashierBindings)?d.cashierBindings:null,secureActive=bindings?.some(b=>b.status==='Active');
  const status=d.cashierSetupChecking?'Checking Cashier setup':pending?'Pending approval':approved?(cashier&&bindings?(secureActive?'Approved for Cashier features':bindings.some(b=>b.status==='Pending')?'Setup approval pending':'Finish Cashier setup'):'Active'):d.status==='Blocked'?'Blocked':'Needs review';
  const date=milliseconds(d.registeredAt)?new Date(milliseconds(d.registeredAt)).toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Date unavailable';
  const button=(label,action,value='')=>'<button class="btn-refresh" data-fleet-action="'+action+'" data-device-id="'+escape(d.id)+'" data-status="'+value+'">'+label+'</button>';
  const secure=cashier&&bindings?'<div class="fleet-secure-identities">'+(bindings.length?bindings.map(b=>'<div><small>Approval UID: '+escape(b.uid)+' · '+escape(b.status)+'</small>'+((b.status==='Pending'||d.status==='Blocked'&&['Revoked','Blocked','Active'].includes(b.status))?'<br><button class="btn-refresh" data-fleet-action="approve-cashier" data-device-id="'+escape(d.id)+'" data-binding-uid="'+escape(b.uid)+'">'+(b.status==='Pending'?'Approve matched tablet':'Restore matched tablet')+'</button>':'')+'</div>').join(''):'<small>Open or update this Cashier tablet to finish setup automatically.</small>')+'</div>':'';
  let actions;
  if(cashier&&(d.cashierSetupChecking||d.cashierOwnerOnly))actions=d.cashierOwnerOnly?'<small>Owner approval required for Cashier setup.</small>':button('Check setup','refresh');
  else if(cashier&&bindings)actions=pending?button('Reject','status','Blocked'):approved?button('Block','status','Blocked'):'';
  else actions=pending?button('Approve','status','Active')+button('Reject','status','Blocked'):approved?button('Block','status','Blocked'):button('Unblock','status','Active');
  return '<tr class="'+(pending?'fleet-pending':'')+'"><td><input type="checkbox" class="device-bulk-cb" value="'+escape(d.id)+'" aria-label="Select '+escape(d.deviceName)+'"></td><td><strong>'+escape(d.deviceName||'Unnamed device')+'</strong><br><small>Device ID: '+escape(d.deviceId||d.id)+'</small>'+(d.deviceId?'<br><small>Registration: '+escape(d.id)+'</small>':'')+secure+(d.setupVersion===1?'<br><small>Personal setup'+(d.staffName?' · '+escape(d.staffName):'')+'</small>':'')+'</td><td>'+escape(d.branch||'Unassigned')+'</td><td>'+escape(date)+'</td><td><span class="fleet-status '+(pending?'pending':approved?'active':'paused')+'">'+status+'</span></td><td><div class="fleet-actions">'+actions+button('Delete','delete')+'</div></td></tr>';
 }).join('');
}
export function createFleetReader({projectId,apiKey,getToken=async()=>null,fetcher=fetch,delay=setTimeout,cancelDelay=clearTimeout}) {
    return async()=>{
        const controller=new AbortController(),timer=delay(()=>controller.abort(),20000);
        const rows=[];let page='';
        try {
            const token=await getToken();
            do {
                const url=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pos_devices?key=${encodeURIComponent(apiKey)}&pageSize=100${page?'&pageToken='+encodeURIComponent(page):''}`;
                const response=await fetcher(url,{signal:controller.signal,cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}});
                const data=await response.json();
                if(!response.ok)throw Error(data.error?.message || 'HQ device list is unavailable.');
                for(const record of data.documents || []) {
                    const f=record.fields || {},string=name=>f[name]?.stringValue;
                    rows.push({id:record.name.split('/').pop(),deviceId:string('deviceId'),deviceName:string('deviceName'),appType:string('appType'),setupUid:string('setupUid'),branch:string('branch'),status:string('status'),registeredAt:f.registeredAt?.timestampValue,setupVersion:Number(f.setupVersion?.integerValue||0),staffName:string('staffName')});
                }
                page=data.nextPageToken || '';
            } while(page);
            return rows;
        } finally {cancelDelay(timer);}
    };
}
export function installDeviceFleet(config) {
    const readHQ=config?createFleetReader(config):null;
    let unsubscribe = null, bindingUnsubscribe=null, epoch = 0, timer=null;
    const status=text=>{const node=document.getElementById('deviceFleetStatus');if(node)node.textContent=text;};
    const stop = () => {epoch++;unsubscribe?.();unsubscribe=null;bindingUnsubscribe?.();bindingUnsubscribe=null;clearTimeout(timer);};
    let updating=false;
    window.checkManagerAppUpdate=async()=>{
        if(updating)return;
        if(!navigator.onLine){status('Connect to the internet to update the Manager app.');return;}
        updating=true;status('Checking for app updates…');
        try {await waitForAppUpdate(await navigator.serviceWorker?.getRegistration(),{serviceWorker:navigator.serviceWorker});window.location.reload();}
        catch(e){status(e.message || 'Update unavailable. Check your connection and try again.');}
        finally{updating=false;}
    };
    window.loadDeviceFleet = () => {
        stop(); const token=epoch, body=document.getElementById('deviceFleetBody'); if(!body)return;
        let serverConnected=false,httpConfirmed=false,revision=0,lastRows=[],lastCached=false,bindingRows=null;
        const user=window.auth?.currentUser,owner=!!user&&user.email?.toLowerCase()==='jgo031996@gmail.com'&&user.emailVerified===true&&window.sessionUser?.uid===user.uid&&window.sessionUser?.isOwner===true;
        const sameOwner=()=>owner&&window.auth.currentUser===user&&window.sessionUser?.uid===user.uid&&window.sessionUser?.isOwner===true;
        status('Connecting to HQ…');
        body.innerHTML='<tr><td colspan="6">Connecting to live Device Fleet…</td></tr>';
        function render(rows,cached=false) {
            lastRows=rows;lastCached=cached;
            const allowed=rows.filter(row=>window.isBranchAllowed(row.branch)).map(row=>{if(!isCashierFleetDevice(row))return row;if(!sameOwner())return {...row,cashierOwnerOnly:true};if(bindingRows===null)return {...row,cashierSetupChecking:true};return {...row,cashierBindings:bindingRows.filter(b=>b.legacyDeviceDocId===row.id&&b.deviceId===row.deviceId&&b.branch===row.branch&&b.storedUid===b.uid)};});
            const pending=allowed.filter(row=>row.status==='Pending').length;
            status(cached?'Saved device list · reconnecting to HQ':`${pending} pending approval · ${allowed.length} devices · synced with HQ`);
            const html=fleetRows(allowed);
            body.innerHTML=(cached?'<tr><td colspan="6">Showing saved records while reconnecting. New registrations appear after HQ reconnects.</td></tr>':'')+(html || '<tr><td colspan="6">No devices for your assigned branches.</td></tr>');
        }
        async function fallback() {
            if(token!==epoch || serverConnected || !readHQ)return;
            const readRevision=revision;
            try {
                const rows=await readHQ();
                if(token!==epoch || serverConnected || readRevision!==revision)return;
                httpConfirmed=true;render(rows);
            } catch {
                if(token===epoch && !serverConnected && readRevision===revision)status('HQ connection delayed · showing the last received devices. Refresh to retry.');
            } finally {
                if(token===epoch && !serverConnected && !document.hidden)timer=setTimeout(fallback,30000);
            }
        }
        if(owner){
            const target=window.query(window.collection(window.db,'pos_bindings'),window.limit(201));
            void window.getDocsFromServer(target).then(snapshot=>{
                if(token!==epoch||!sameOwner())return;
                if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites){bindingRows=null;return;}
                if(snapshot.docs.length>=201){bindingRows=null;status('Cashier setups need HQ review before approval.');return;}
                bindingRows=snapshot.docs.map(s=>({...s.data(),storedUid:s.data().uid,uid:s.id}));render(lastRows,lastCached);
            }).catch(()=>{if(token===epoch){bindingRows=null;status('Cashier setup could not connect. Refresh Device Fleet before approval.');}});
        }
        if(readHQ)timer=setTimeout(fallback,5000);
        unsubscribe=window.onSnapshot(window.collection(window.db,'pos_devices'),{includeMetadataChanges:true},snapshot=>{
            if(token!==epoch)return;
            if(snapshot.metadata.fromCache) {
                if(serverConnected){serverConnected=false;clearTimeout(timer);if(readHQ)timer=setTimeout(fallback,5000);}
                if(httpConfirmed)return;
            }
            const rows=[];snapshot.forEach(doc=>rows.push({...doc.data(),id:doc.id}));
            if(!snapshot.metadata.fromCache){revision++;serverConnected=true;clearTimeout(timer);}
            render(rows,snapshot.metadata.fromCache);
        },()=>{if(token===epoch){serverConnected=false;clearTimeout(timer);if(readHQ)timer=setTimeout(fallback,0);else status('Device Fleet could not connect. Refresh to retry.');}});
        body.onclick=event=>{
            const button=event.target.closest('[data-fleet-action]');if(!button)return;
            if(button.dataset.fleetAction==='refresh')window.loadDeviceFleet();
            else if(button.dataset.fleetAction==='approve-cashier')window.approveCashierFleetDevice(button.dataset.deviceId,button.dataset.bindingUid);
            else if(button.dataset.fleetAction==='status')window.toggleDeviceStatus(button.dataset.deviceId,button.dataset.status);
            else window.deleteDevice(button.dataset.deviceId);
        };
    };
    const switchView=window.switchView;
    window.switchView=function(view,...args){if(view!=='devices')stop();const result=switchView.apply(this,[view,...args]);if(view==='devices')window.loadDeviceFleet();return result;};
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden)stop();
        else if(document.getElementById('view-devices')?.classList.contains('active'))window.loadDeviceFleet();
    });
    window.addEventListener('pagehide',stop);
}
