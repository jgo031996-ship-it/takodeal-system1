const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const milliseconds = value => value?.toMillis ? value.toMillis() : value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime() || 0;
export function fleetRows(devices, allowed = () => true) {
    return devices.filter(d=>allowed(d.branch)).sort((a,b)=>(b.status==='Pending')-(a.status==='Pending') || milliseconds(b.registeredAt)-milliseconds(a.registeredAt)).map(d=>{
        const approved = ['Active','Approved'].includes(d.status), pending = d.status==='Pending';
        const status = pending ? 'Pending approval' : approved ? 'Active' : d.status==='Blocked' ? 'Blocked' : 'Needs review';
        const date = milliseconds(d.registeredAt) ? new Date(milliseconds(d.registeredAt)).toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Date unavailable';
        const button = (label, action, value='') => `<button class="btn-refresh" data-fleet-action="${action}" data-device-id="${escape(d.id)}" data-status="${value}">${label}</button>`;
        return `<tr class="${pending?'fleet-pending':''}"><td><input type="checkbox" class="device-bulk-cb" value="${escape(d.id)}" aria-label="Select ${escape(d.deviceName)}"></td><td><strong>${escape(d.deviceName || 'Unnamed device')}</strong><br><small>Device ID: ${escape(d.id)}</small></td><td>${escape(d.branch || 'Unassigned')}</td><td>${escape(date)}</td><td><span class="fleet-status ${pending?'pending':approved?'active':'paused'}">${status}</span></td><td><div class="fleet-actions">${pending?button('Approve','status','Active')+button('Reject','status','Blocked'):approved?button('Block','status','Blocked'):button('Unblock','status','Active')}${button('Delete','delete')}</div></td></tr>`;
    }).join('');
}
export function installDeviceFleet() {
    let unsubscribe = null, epoch = 0;
    const stop = () => {epoch++;unsubscribe?.();unsubscribe=null;};
    window.loadDeviceFleet = () => {
        stop(); const token=epoch, body=document.getElementById('deviceFleetBody'); if(!body)return;
        body.innerHTML='<tr><td colspan="6">Connecting to live Device Fleet…</td></tr>';
        unsubscribe=window.onSnapshot(window.collection(window.db,'pos_devices'),{includeMetadataChanges:true},snapshot=>{
            if(token!==epoch)return;
            const rows=[];snapshot.forEach(doc=>rows.push({...doc.data(),id:doc.id}));
            const html=fleetRows(rows,branch=>window.isBranchAllowed(branch));
            body.innerHTML=(snapshot.metadata.fromCache?'<tr><td colspan="6">Showing saved records while reconnecting. New registrations appear after HQ reconnects.</td></tr>':'')+(html || '<tr><td colspan="6">No devices for your assigned branches.</td></tr>');
        },()=>{if(token===epoch)body.innerHTML='<tr><td colspan="6">Device Fleet could not connect. Check your internet connection, then refresh devices.</td></tr>';});
        body.onclick=event=>{
            const button=event.target.closest('[data-fleet-action]');if(!button)return;
            if(button.dataset.fleetAction==='status')window.toggleDeviceStatus(button.dataset.deviceId,button.dataset.status);
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
