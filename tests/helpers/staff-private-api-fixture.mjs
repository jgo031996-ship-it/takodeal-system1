// Explicit approved-private API boundary for extracted Staff UI unit harnesses.
// The transport, real grant checks and real Admin projection have separate tests.
import {loadStaffSalaryTimeline} from '../../takodeal-staff/staff-rate-model.js';
import {projectPrivatePayrollRecord,privatePayrollFingerprint,projectPrivatePayrollInput} from '../../functions/cash-remittance-review/access-payroll-store.mjs';
export function installStaffPrivateAPIFixture(window,api,{staffId='sample',staffName='Test Staff',branch='Maa',paidRecords=[]}={}){
 window.readPrivateStaffProfile=async(id,{assertCurrent=()=>{}}={})=>{assertCurrent();const snapshot=await api.getDocFromServer(api.doc(api.db,'cashiers',id));assertCurrent();return snapshot;};
 window.readStaffDirectoryProfile=window.readPrivateStaffProfile;
 window.patchOwnStaffProfile=async(patch,{assertCurrent=()=>{}}={})=>{assertCurrent();await api.updateDoc(api.doc(api.db,'cashiers',staffId),patch);assertCurrent();};
 window.loadPrivateStaffSalaryProfile=profile=>loadStaffSalaryTimeline(api,profile);
 window.readPrivatePayrollInputs=async({assertCurrent=()=>{}}={})=>{
  assertCurrent();let profile={};try{profile=(await window.readPrivateStaffProfile(staffId)).data();}catch{}const names=[staffName,profile.cashierName,profile.fullName,profile.scheduleNickname,...(profile.scheduleAliases||[])].filter(Boolean);
  const read=async table=>{const saved=await api.getDocsFromServer(api.query(api.collection(api.db,table),api.where('staffName','in',names))),own=await api.getDocsFromServer(api.query(api.collection(api.db,table),api.where('staffId','==',staffId))),rows=new Map();for(const document of [...saved.docs,...own.docs]){const row=document.data();if(row.staffId?row.staffId===staffId:names.includes(row.staffName))rows.set(document.id,projectPrivatePayrollInput({...row,id:document.id,staffId}));}assertCurrent();return[...rows.values()];};
  return{schemaVersion:1,staffId,asOf:'2026-11-09T00:00:00.000Z',complete:true,staffDeductions:await read('staff_deductions'),staffBonuses:await read('staff_bonuses')};
 };
 window.readStaffPaidHistory=async({assertCurrent=()=>{}}={})=>{
  assertCurrent();const records=[],held=[];
  for(const [index,row]of paidRecords.entries()){const ids=[row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId,row.frozenData?.profile?.id].filter(Boolean);if(ids.length&&!ids.includes(staffId))continue;try{const projected=projectPrivatePayrollRecord({...row,id:row.id??String(index)});if(!ids.length)projected.staffId=staffId;projected.fingerprint=privatePayrollFingerprint(projected);records.push(projected);}catch{held.push({recordId:row.id,message:'The saved Owner payslip needs HQ review.'});}}
  return{schemaVersion:1,staffId,staffName,branch,asOf:'2026-11-09T00:00:00.000Z',records,held,complete:true};
 };
}
