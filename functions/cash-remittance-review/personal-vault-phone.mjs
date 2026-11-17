import {createHash} from 'node:crypto';
import {activeAccessStaff} from './access-model.mjs';
const row=snapshot=>snapshot?.exists?snapshot.data():null;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
// Pay/profile authority only. This never creates a document-upload grant,
// changes a login PIN, opens Pay, or enrolls a new Firebase identity.
export async function readPrivateStaffPhone(tx,db,{uid,staffId,deviceId},deny){
 if(!id(uid)||!id(staffId)||!device(deviceId))return deny();
 const read=path=>tx.get(db.doc(path));
 const [policy,grant,snapshot]=await Promise.all(['staff_document_config/current','staff_document_devices/'+uid,'cashiers/'+staffId].map(read));
 const config=row(policy),binding=row(grant),profile=row(snapshot);
 if(!activeAccessStaff(profile))return deny();
 if(config?.enabled===true&&config.policyVersion===2&&config.brokerEndpoint==='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'&&binding?.active===true&&binding.uid===uid&&binding.staffId===staffId&&binding.deviceId===deviceId&&binding.branch===profile.branch)return snapshot;
 const [setup,registration,index,mirror,credential,registry]=await Promise.all(['staff_app_setup_config/current','staff_app_bindings/'+uid,'staff_app_device_index/'+deviceId,'pos_devices/'+deviceId,'staff_setup_credentials/'+staffId,'staff_setup_device_slots/'+staffId].map(async path=>row(await read(path))));
 // Enrollment may be paused after a phone is activated. An existing active
 // registration remains authoritative until HQ disables its code or phone.
 if(setup?.protocolVersion!==1||typeof setup.enabled!=='boolean'||!Number.isSafeInteger(setup.revision)||setup.revision<0||registration?.protocolVersion!==1||registration.uid!==uid||registration.staffId!==staffId||registration.deviceId!==deviceId||registration.status!=='Active'||registration.branch!==profile.branch)return deny();
 if(credential?.enabled!==true||credential.staffId!==staffId||credential.deviceSlotsVersion!==1||!Number.isSafeInteger(credential.version)||credential.version<1||!Number.isSafeInteger(credential.deviceSlotsRevision)||credential.deviceSlotsRevision<1||!/^[a-f0-9]{64}$/.test(credential.deviceSlotsHash||''))return deny();
 if(registry?.protocolVersion!==1||registry.staffId!==staffId||registry.revision!==credential.deviceSlotsRevision||typeof registry.createdAt!=='string'||typeof registry.updatedAt!=='string'||!Array.isArray(registry.activeDevices)||registry.activeDevices.length<1||registry.activeDevices.length>2||Object.keys(registry).sort().join(',')!=='activeDevices,createdAt,protocolVersion,revision,staffId,updatedAt'||createHash('sha256').update(canonical(registry)).digest('hex')!==credential.deviceSlotsHash)return deny();
 const verifier=credential.verifier;
 if(verifier?.algorithm!=='scrypt-v1'||verifier.N!==16384||verifier.r!==8||verifier.p!==1||!/^[a-f0-9]{32}$/.test(verifier.salt||'')||!/^[a-f0-9]{64}$/.test(verifier.hash||''))return deny();
 const matches=(b,i,m,u,d)=>b?.protocolVersion===1&&b.uid===u&&b.staffId===staffId&&b.deviceId===d&&b.status==='Active'&&i?.protocolVersion===1&&i.uid===u&&i.staffId===staffId&&i.deviceId===d&&m?.appType==='Staff'&&m.setupVersion===1&&m.setupUid===u&&m.staffId===staffId&&m.deviceId===d&&m.branch===b.branch&&m.status==='Active';
 if(!matches(registration,index,mirror,uid,deviceId))return deny();
 const uids=new Set(),devices=new Set();let own=false;
 for(const slot of registry.activeDevices){
  if(!slot||Object.keys(slot).sort().join(',')!=='deviceId,uid'||!id(slot.uid)||!device(slot.deviceId)||uids.has(slot.uid)||devices.has(slot.deviceId))return deny();
  uids.add(slot.uid);devices.add(slot.deviceId);if(slot.uid===uid&&slot.deviceId===deviceId){own=true;continue;}
  const [b,i,m]=await Promise.all(['staff_app_bindings/'+slot.uid,'staff_app_device_index/'+slot.deviceId,'pos_devices/'+slot.deviceId].map(async path=>row(await read(path))));if(!matches(b,i,m,slot.uid,slot.deviceId))return deny();
 }
 if(!own)return deny();return snapshot;
}
