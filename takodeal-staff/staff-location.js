// Bounded location waits; one visible Clock watch keeps verified fixes current.
export const LOCATION_MAX_AGE = 60000;
export function distanceMeters(a, b) {
    const radians = x => x * Math.PI / 180;
    const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function locationAssessment(position, zones, radius = 50, now = Date.now()) {
    const c = position?.coords, stamp = Number(position?.timestamp);
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || !Number.isFinite(c.accuracy) || c.accuracy < 0 || !Number.isFinite(stamp)) return { state:'invalid' };
    if (now - stamp > LOCATION_MAX_AGE || stamp - now > 5000) return { state:'stale' };
    let branch = '', distance = Infinity;
    for (const [name, zone] of Object.entries(zones)) {
        const d = distanceMeters({lat:c.latitude,lng:c.longitude}, zone);
        if (d < distance) { distance = d; branch = name; }
    }
    return { state:!branch ? 'invalid' : c.accuracy > radius ? 'refining' : distance > radius ? 'outside' : 'verified', branch, distance, accuracy:c.accuracy, timestamp:stamp, lat:c.latitude, lng:c.longitude };
}
export function locationError(code) {
    if (code === 1) return {state:'permission', title:'Location permission is off', hint:'Allow Location for this site in your browser settings, then tap Refresh location.'};
    if (code === 2) return {state:'unavailable', title:'Your phone cannot find its location yet', hint:'Turn on phone Location and Wi-Fi scanning, then try near a window or the entrance.'};
    return {state:'timeout', title:'Location is taking longer than usual', hint:'Keep this screen open near a window. Check phone Location and Wi-Fi, then tap Refresh location.'};
}
export function createLocationSession({geolocation, zones, radius = 50, now = Date.now, delay = setTimeout, cancelDelay = clearTimeout, onState = () => {}, duration = 45000, keepWatching = false}) {
    let active = null, retained = null, current = null, latest = null;
    const cached = () => current && locationAssessment(current,zones,radius,now()).state === 'verified' ? locationAssessment(current,zones,radius,now()) : null;
    const clearRetained = () => {const session=retained;retained=null;if(session?.watch!=null)geolocation.clearWatch(session.watch);};
    const stop = () => { current = latest = null; if (active) active.finish({state:'cancelled'}); clearRetained(); };
    const acquire = ({force = false} = {}) => {
        // A background refresh must not make an already valid, fresh fix wait
        // for another provider response. Never extend its original timestamp.
        const ready=!force&&cached();if(ready){onState(ready);return Promise.resolve(ready);}
        if(!force&&retained&&latest){const state=locationAssessment(latest,zones,radius,now());if(state.state==='outside'){onState(state);return Promise.resolve(state);}}
        if (active) return active.promise;
        clearRetained();
        if (!geolocation) { const state={state:'unsupported',title:'Location is unavailable in this browser',hint:'Use an updated supported browser with phone Location enabled.'}; onState(state); return Promise.resolve(state); }
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        const session = {promise, watch:null, timer:null, best:null, lastError:3, done:false};
        session.finish = state => {
            if (session.done) return;
            session.done = true;
            const tracking=keepWatching&&!['cancelled','permission','unsupported'].includes(state.state);
            if(tracking)retained=session;else if(session.watch!==null)geolocation.clearWatch(session.watch);
            if(state.state==='permission')current=latest=null;
            cancelDelay(session.timer);
            if (active === session) active = null;
            if (state.state !== 'cancelled') onState(state);
            resolve(state);
        };
        active = session;
        onState({state:'searching',title:'Finding your branch location',hint:'Checking GPS and Wi-Fi location. Keep Clock open near a window while accuracy improves.'});
        const success = position => {
            if(session.done&&retained!==session)return;
            const result = locationAssessment(position, zones, radius, now());
            if (result.state === 'invalid' || result.state === 'stale') return;
            const previous=latest&&locationAssessment(latest,zones,radius,now()),decisive=previous&&['verified','outside'].includes(previous.state);
            if(decisive&&result.timestamp<Number(latest.timestamp))return;
            // An approximate response cannot replace newer accurate outside
            // evidence, or prevent a fresh accurate cached sample from arriving.
            if(result.state!=='refining'||!decisive)latest=position;
            if(session.done){
                if(result.state==='verified')current=position;
                else if(result.state==='outside')current=null;
                // A coarse update cannot erase a still-fresh accurate sample.
                // An accurate outside fix or permission denial always does.
                onState(result.state==='refining'&&cached()?cached():result);return;
            }
            if (session.best && result.accuracy > session.best.accuracy) return;
            session.best = result;
            if (result.state === 'verified' || result.state === 'outside') {
                current = result.state === 'verified' ? position : null;
                session.finish(result);
            } else onState(result);
        };
        const error = e => {
            if(session.done){if(retained!==session)return;if(e.code===1){current=latest=null;clearRetained();onState(locationError(1));}else if(!cached())onState(locationError(e.code));return;}
            session.lastError = e.code;
            if (e.code === 1) session.finish(locationError(1));
            // A transient provider timeout is not proof of a weak GPS receiver.
        };
        session.timer = delay(() => session.finish(session.best && now() - session.best.timestamp <= LOCATION_MAX_AGE ? session.best : locationError(session.lastError)), duration);
        try {
            const id = geolocation.watchPosition(success, error, {enableHighAccuracy:true,maximumAge:15000,timeout:30000});
            session.watch = id;
            if (session.done&&retained!==session) geolocation.clearWatch(id);
            if (!session.done) geolocation.getCurrentPosition(success, error, {enableHighAccuracy:false,maximumAge:LOCATION_MAX_AGE,timeout:10000});
        } catch (e) { session.finish(locationError(['SecurityError','NotAllowedError'].includes(e.name)?1:e.code||2)); }
        return promise;
    };
    return {acquire,stop};
}

export function createClockCamera({mediaDevices, onStream, onStatus}) {
    let epoch = 0, stream = null, pending = null;
    const stop = () => { epoch++; stream?.getTracks().forEach(t => t.stop()); stream = null; pending = null; onStream(null); };
    const start = () => {
        if (stream && stream.getVideoTracks?.().some(track => track.readyState === 'live')) return Promise.resolve(stream);
        if (stream) stop();
        if (pending) return pending;
        const token = epoch;
        onStatus('Starting camera…',false);
        pending = (async () => {
            try {
                if (!mediaDevices?.getUserMedia) throw {name:'NotSupportedError'};
                let next;
                try { next = await mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:480,max:640},height:{ideal:360,max:480},frameRate:{ideal:12,max:15}}}); }
                catch (e) {
                    if (token !== epoch) return null;
                    if (!['OverconstrainedError','NotFoundError'].includes(e.name)) throw e;
                    next = await mediaDevices.getUserMedia({audio:false,video:{facingMode:'user'}});
                }
                if (token !== epoch) { next.getTracks().forEach(t => t.stop()); return null; }
                stream = next; onStream(next); onStatus('Camera ready',true); return next;
            } catch (e) {
                if (token === epoch) onStatus(e.name === 'NotAllowedError' ? 'Allow camera access in browser settings' : 'Camera unavailable · check permissions or close other camera apps',false);
                return null;
            } finally { if (token === epoch) pending = null; }
        })();
        return pending;
    };
    return {start,stop};
}

export function installStaffLocation() {
    const el = id => document.getElementById(id);
    const clockVisible = () => !document.hidden && el('view-timeclock')?.classList.contains('active') && el('profileModal')?.style.display !== 'flex';
    const show = state => {
        window.currentLat = window.currentLng = null;
        window.staffLocationFix = state.state === 'verified' ? state : null;
        if (state.state === 'verified') { window.currentLat = state.lat; window.currentLng = state.lng; }
        const badge = el('gpsStatus'), hint = el('gpsHint');
        if (!badge) return;
        badge.dataset.state = state.state;
        const accuracy = Math.ceil(state.accuracy || 0), distance = Math.round(state.distance || 0);
        badge.textContent = state.title || (state.state === 'verified' ? `${state.branch} verified · ${distance} m away` : state.state === 'outside' ? `${state.branch} is ${distance} m away` : `Improving location accuracy · ±${accuracy} m`);
        if (hint) hint.textContent = state.hint || (state.state === 'verified' ? `Accuracy ±${accuracy} m. Location is checked again before attendance is saved.` : state.state === 'outside' ? `Clock in or out within ${window.ALLOWED_RADIUS_METERS} m of the branch. Refresh when you arrive.` : `Your phone has a location, but it is too approximate for attendance. Try near a window. Required accuracy: ${window.ALLOWED_RADIUS_METERS} m or better.`);
    };
    const gps = createLocationSession({geolocation:navigator.geolocation,zones:window.BRANCH_ZONES,radius:window.ALLOWED_RADIUS_METERS,onState:show,keepWatching:true});
    const camera = createClockCamera({mediaDevices:navigator.mediaDevices,onStream:stream => {window.invalidateAttendanceCamera?.();window.cameraStream = stream; if (el('clockVideo')) {el('clockVideo').srcObject = stream;if(stream)el('clockVideo').play?.()?.catch?.(()=>{});}},onStatus:(text,ready) => {const node=el('cameraStatus');if(node){node.textContent=text;node.style.background=ready?'#23744f':'#677a70';}}});
    window.refreshGPS = () => gps.acquire({force:true});
    window.startCameraAndGPS = () => { if (!clockVisible()) return; window.refreshGPS(); window.prepareAttendanceCamera?.().catch(()=>{}); return camera.start(); };
    window.restartAttendanceCamera = () => { if (!clockVisible()) return; camera.stop(); return camera.start(); };
    window.stopCamera = () => { camera.stop(); gps.stop(); window.currentLat = window.currentLng = window.staffLocationFix = null; };
    window.getAttendanceLocation = async () => {
        if (!clockVisible()) throw Error('Open Clock and keep the app visible while recording attendance.');
        const fix = await gps.acquire();
        if(!clockVisible())throw Error('Open Clock and keep the app visible while recording attendance.');
        if(fix.state==='verified'&&locationAssessment({timestamp:fix.timestamp,coords:{latitude:fix.lat,longitude:fix.lng,accuracy:fix.accuracy}},window.BRANCH_ZONES,window.ALLOWED_RADIUS_METERS).state!=='verified')throw Object.assign(Error('Location verification expired. Tap Refresh location and wait for the branch to be verified again.'),{code:'attendance/location-expired',locationState:'stale'});
        if (fix.state !== 'verified') {
            const problem=fix.title?fix:fix.state==='outside'?{title:`You must be within ${window.ALLOWED_RADIUS_METERS} m of ${fix.branch}.`,hint:'Return to the recorded branch and wait for the verified location badge before trying again.'}:{title:'An accurate location is needed.',hint:'Keep Clock open near a window. Turn on phone Location and Wi-Fi, then tap Refresh location.'};
            throw Object.assign(Error(problem.title+' '+(problem.hint||'')),{code:'attendance/location-'+fix.state,locationState:fix.state});
        }
        return fix;
    };
    window.startLiveClock = () => {
        if (window.staffClockTimer) return;
        window.staffClockTimer = setInterval(() => {
            if (!clockVisible()) return;
            const now = new Date();
            if(el('liveTime')) el('liveTime').textContent = now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
            if(el('liveDate')) el('liveDate').textContent = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
        },1000);
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) window.stopCamera(); else if (clockVisible()) window.startCameraAndGPS(); });
    window.addEventListener('pagehide', () => window.stopCamera());
    const openProfile = window.openProfile;
    window.openProfile = function(...args) { window.stopCamera(); return openProfile?.apply(this,args); };
    window.closeStaffProfile = () => { if(el('profileModal'))el('profileModal').style.display='none'; if(clockVisible())window.startCameraAndGPS(); };
    const logout = window.logoutStaff;
    window.logoutStaff = function(...args) { window.stopCamera(); return logout?.apply(this,args); };
}
