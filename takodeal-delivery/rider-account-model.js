export function normalizeRiderPhone(value) {
    const text=String(value ?? '').trim();
    if(!text || !/^[+\d\s()-]+$/.test(text))throw Error('Enter a valid Philippine mobile number, such as 09123456789.');
    let phone=text.replace(/\D/g,'');
    if(/^639\d{9}$/.test(phone))phone='0'+phone.slice(2);
    if(!/^09\d{9}$/.test(phone))throw Error('Enter an 11-digit Philippine mobile number beginning with 09.');
    return phone;
}
export function riderPhoneVariants(phone) {
    const normalized=normalizeRiderPhone(phone);
    return [normalized,'63'+normalized.slice(1),'+63'+normalized.slice(1)];
}
export function validateRiderPIN(value,confirmation) {
    const pin=String(value ?? '').trim();
    if(!/^\d{4}$/.test(pin))throw Error('Create a PIN with exactly 4 digits.');
    if(confirmation!==undefined && pin!==String(confirmation ?? '').trim())throw Error('The two PINs do not match.');
    return pin;
}
export function riderApproved(status) {return ['active','approved'].includes(String(status ?? '').trim().toLowerCase());}
export function riderStatus(status) {
    const value=String(status ?? '').trim().toLowerCase();
    if(riderApproved(value))return 'active';
    if(['pending_approval','pending','awaiting_approval'].includes(value))return 'pending';
    if(value==='rejected')return 'rejected';
    if(['banned','suspended','blocked','disabled','inactive','revoked'].includes(value))return 'suspended';
    return 'unknown';
}
export function riderStatusMessage(rider={},error='') {
    const status=error?'unavailable':riderStatus(rider.status);
    const reason=String(rider.approvalReason || rider.statusReason || '').trim().slice(0,1200);
    const messages={active:'Your account is approved for deliveries.',pending:'Your application is waiting for Manager approval. Delivery access opens after approval.',
        rejected:'Your application was not approved. Contact Manager to review the next steps.',suspended:'Your delivery access is suspended. Contact Manager for assistance.',
        unknown:'Manager approval could not be confirmed for this account. Contact Manager before accepting deliveries.',
        unavailable:'Approval could not be checked. Reconnect and refresh your status before accepting deliveries.'};
    return {status,label:({active:'Approved',pending:'Awaiting approval',rejected:'Not approved',suspended:'Access suspended',unknown:'Approval required',unavailable:'Status unavailable'})[status],
        message:messages[status]+(reason?' '+reason:'')};
}
export function riderSubmittedAt(value) {
    const millis=value?.toMillis?.() ?? (value?.seconds!=null?Number(value.seconds)*1000:value instanceof Date?value.getTime():Date.parse(value || ''));
    return Number.isFinite(millis)?new Date(millis).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Submission date not recorded';
}
export function publicRiderAccount(id,data) {
    const {pin,registrationFingerprint,registrationUid,...rider}=data;
    return {...rider,id};
}
export function validateRiderRegistration(values) {
    const name=String(values.name ?? '').trim(),vehicle=String(values.vehicle ?? '').trim(),plate=String(values.plate ?? '').trim().toUpperCase();
    if(!name || name.length>100)throw Error('Enter your full name, up to 100 characters.');
    if(!vehicle || vehicle.length>100)throw Error('Enter your motorcycle make and model.');
    if(!plate || plate.length>30)throw Error('Enter your plate number, up to 30 characters.');
    return {name,phone:normalizeRiderPhone(values.phone),vehicle,plateNumber:plate,pin:validateRiderPIN(values.pin,values.pinConfirm)};
}
export function validateRiderPhoto(file,label) {
    if(!file || !Number.isSafeInteger(file.size) || file.size<=0 || file.size>8*1024*1024)throw Error('Choose a '+label+' photo no larger than 8 MB.');
    const type=String(file.type || '').toLowerCase();
    if(!['image/jpeg','image/jpg','image/png','image/webp'].includes(type) && (type || !/\.(jpe?g|png|webp)$/i.test(String(file.name || ''))))throw Error('Choose a JPG, PNG or WebP image for your '+label+'.');
    if(typeof file.arrayBuffer!=='function')throw Error('This photo could not be read. Choose the file again.');
    return file;
}
