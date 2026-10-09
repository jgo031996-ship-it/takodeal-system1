// A bounded location session: network fixes can arrive quickly while GPS refines them.
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
export function createLocationSession({geolocation, zones, radius = 50, now = Date.now, delay = setTimeout, cancelDelay = clearTimeout, onState = () => {}, duration = 45000}) {
    let active = null, current = null;
    const stop = () => { current = null; if (active) active.finish({state:'cancelled'}); };
    const acquire = ({force = false} = {}) => {
        if (active) return active.promise;
        if (!force && current && locationAssessment(current, zones, radius, now()).state === 'verified') return Promise.resolve(locationAssessment(current, zones, radius, now()));
        current = null;
        if (!geolocation) { const state={state:'unsupported',title:'Location is unavailable in this browser',hint:'Use an updated supported browser with phone Location enabled.'}; onState(state); return Promise.resolve(state); }
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        const session = {promise, watch:null, timer:null, best:null, lastError:3, done:false};
        session.finish = state => {
            if (session.done) return;
            session.done = true;
            if (session.watch !== null) geolocation.clearWatch(session.watch);
            cancelDelay(session.timer);
            if (active === session) active = null;
            if (state.state !== 'cancelled') onState(state);
            resolve(state);
        };
        active = session;
        onState({state:'searching',title:'Finding your branch location',hint:'Keep Clock open. Older phones may need up to 45 seconds for an accurate fix.'});
        const success = position => {
            if (session.done) return;
            const result = locationAssessment(position, zones, radius, now());
            if (result.state === 'invalid' || result.state === 'stale') return;
            if (session.best && result.accuracy > session.best.accuracy) return;
            session.best = result;
            if (result.state === 'verified' || result.state === 'outside') {
                current = result.state === 'verified' ? position : null;
                session.finish(result);
            } else onState(result);
        };
        const error = e => {
            if (session.done) return;
            session.lastError = e.code;
            if (e.code === 1) session.finish(locationError(1));
            // A transient provider timeout is not proof of a weak GPS receiver.
        };
        session.timer = delay(() => session.finish(session.best && now() - session.best.timestamp <= LOCATION_MAX_AGE ? session.best : locationError(session.lastError)), duration);
        try {
            const id = geolocation.watchPosition(success, error, {enableHighAccuracy:true,maximumAge:15000,timeout:30000});
            session.watch = id;
            if (session.done) geolocation.clearWatch(id);
            if (!session.done) geolocation.getCurrentPosition(success, error, {enableHighAccuracy:false,maximumAge:15000,timeout:10000});
        } catch (e) { session.finish(locationError(e.code || 2)); }
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
    const gps = createLocationSession({geolocation:navigator.geolocation,zones:window.BRANCH_ZONES,radius:window.ALLOWED_RADIUS_METERS,onState:show});
    const camera = createClockCamera({mediaDevices:navigator.mediaDevices,onStream:stream => {window.invalidateAttendanceCamera?.();window.cameraStream = stream; if (el('clockVideo')) {el('clockVideo').srcObject = stream;if(stream)el('clockVideo').play?.()?.catch?.(()=>{});}},onStatus:(text,ready) => {const node=el('cameraStatus');if(node){node.textContent=text;node.style.background=ready?'#23744f':'#677a70';}}});
    window.refreshGPS = () => gps.acquire({force:true});
    window.startCameraAndGPS = () => { if (!clockVisible()) return; window.refreshGPS(); window.prepareAttendanceCamera?.().catch(()=>{}); return camera.start(); };
    window.restartAttendanceCamera = () => { if (!clockVisible()) return; camera.stop(); return camera.start(); };
    window.stopCamera = () => { camera.stop(); gps.stop(); window.currentLat = window.currentLng = window.staffLocationFix = null; };
    window.getAttendanceLocation = async () => {
        if (!clockVisible()) throw Error('Open Clock and keep the app visible while recording attendance.');
        const fix = await gps.acquire();
        if (fix.state !== 'verified') throw Error(fix.title || (fix.state === 'outside' ? `You must be within ${window.ALLOWED_RADIUS_METERS} m of ${fix.branch}.` : 'An accurate location is needed. Try near a window and refresh location.'));
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
