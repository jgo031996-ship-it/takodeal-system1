import {VaultSession} from './staff-privacy.js';
export function profileDailyRate(profile) {
    const value=profile?.hourlyRate ?? profile?.dailyRate;
    if(value==null || String(value).trim()==='')return null;
    const rate=Number(value);return Number.isFinite(rate) && rate>=0?rate:null;
}
export function installStaffRatePrivacy(api,d,storage,{now=()=>Date.now(),setIntervalFn=setInterval}={}) {
    const $=id=>d.getElementById(id),identity=()=>storage.getItem('takodeal_staff_id'),session=new VaultSession(now,120000);
    let epoch=0,profileId=null,waiting=null;
    const visible=()=>!d.hidden && $('profileModal')?.style.display!=='none';
    const text=(id,value)=>{const node=$(id);if(node){node.textContent=value;if('value' in node)node.value='';}};
    const renderLocked=()=>{text('profileDailyRate','Locked');text('profileRateState','Private · Payslip PIN required');if($('profileRateUnlock'))$('profileRateUnlock').hidden=false;if($('profileRateLock'))$('profileRateLock').hidden=true;};
    function lock({preserveRequest=false}={}) {
        session.lock();epoch++;renderLocked();
        d.querySelectorAll?.('[data-rate-export]').forEach(node=>node.remove());api.onStaffRateLocked?.();
        if(waiting && (!preserveRequest || waiting.id!==identity())){waiting.resolve(false);waiting=null;}
    }
    function notice(profile,id) {
        const event=profile?.latestRateRaise?.eventId;
        const seen=storage.getItem('takodeal_rate_seen_'+id);
        // Only the amount-free marker is public. Firestore requires a matching,
        // immutable positive-change audit from verified HQ to issue this marker.
        const confirmed=typeof event==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(event) && profile.latestRateRaise.version===1;
        text('profileRateCongratulations',confirmed && seen!==event?'Congratulations on your daily rate increase. Thank you for your contribution.':'');
        if($('profileRateCongratulations'))$('profileRateCongratulations').hidden=!confirmed || seen===event;
    }
    async function open() {
        lock();profileId=identity();text('profileRateCongratulations','');if($('profileRateCongratulations'))$('profileRateCongratulations').hidden=true;
        const id=profileId,token=epoch;if(!id || !visible())return;
        try{const row=await api.getDocFromServer(api.doc(api.db,'cashiers',id));if(epoch!==token || identity()!==id || !visible())return;if(row.exists())notice(row.data(),id);}
        catch{if(epoch===token && identity()===id)text('profileRateState','Private · reconnect to verify your rate');}
    }
    function reveal(id,profile) {
        if(identity()!==id || !visible() || profileId!==id)return false;
        session.unlock(id);const rate=profileDailyRate(profile);
        text('profileDailyRate',rate==null?'Rate not yet set':'₱'+rate.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+' / day');
        text('profileRateState','Unlocked · locks in 2 minutes');if($('profileRateUnlock'))$('profileRateUnlock').hidden=true;if($('profileRateLock'))$('profileRateLock').hidden=false;
        notice(profile,id);if(profile.latestRateRaise?.eventId)storage.setItem('takodeal_rate_seen_'+id,profile.latestRateRaise.eventId);
        if(waiting){waiting.resolve(waiting.id===id);waiting=null;}return true;
    }
    api.staffRateSession=session;api.lockProfileRate=lock;api.staffRateProfileOpened=open;
    api.ensureStaffRateUnlocked=async()=>{
        const id=identity();if(!id)return false;
        if(!visible()){await api.openProfile?.();if(identity()!==id || !visible())return false;}
        if(session.allows(id))return true;
        if(waiting && waiting.id===id)return waiting.promise;
        let resolve;const promise=new Promise(done=>{resolve=done;});waiting={id,resolve,promise};
        Promise.resolve(api.openVaultPin('unlock','rate')).catch(()=>lock());return promise;
    };
    d.addEventListener('visibilitychange',()=>{if(d.hidden)lock();});api.addEventListener('pagehide',()=>lock());
    api.addEventListener('storage',event=>{if(!event.key || event.key==='takodeal_staff_id'){lock();profileId=null;text('profileRateCongratulations','');if($('profileRateCongratulations'))$('profileRateCongratulations').hidden=true;}});
    const timer=setIntervalFn(()=>{if(session.staffId && (!session.allows(identity()) || !visible()) || waiting && waiting.id!==identity())lock();},1000);timer?.unref?.();
    lock();return {open,lock,reveal,session};
}
