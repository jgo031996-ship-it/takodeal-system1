import {validateSetupStatus,STAFF_SETUP_DRAFT} from './staff-setup-access.js';

// A saved signup is not a usable login until the real setup service confirms it.
// Keep Firebase Auth and pending attendance intact; never create a second phone.
export async function confirmStaffSignupPhone({result,auth,uid,transport,storage}) {
    if (!uid || auth.currentUser?.uid !== uid || !result?.saved) throw Error('Return to the browser where you completed signup to continue signing in.');
    const status = validateSetupStatus(await transport.call('/device-status', {deviceId:result.deviceId}), result.deviceId);
    if (auth.currentUser?.uid !== uid || status.mode !== 'protected' || status.device?.status !== 'Active' || status.device.staffId !== result.staffId) throw Error('Your signup is saved. Check this phone again before continuing to Staff sign-in.');
    storage.setItem('takodeal_device_id', result.deviceId);
    if (storage.getItem('takodeal_device_id') !== result.deviceId) throw Error('Allow app storage, then check this phone again. Your signup is already saved.');
    // A draft made before signup must not override the freshly confirmed phone.
    storage.removeItem(STAFF_SETUP_DRAFT);
    return status.device;
}
