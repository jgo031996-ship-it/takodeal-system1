import {attendanceMillis} from './attendance-reconcile.js';
import {cashShortageStaff} from './cash-shortage-model.js';
const text=value=>typeof value==='string'?value.trim():'';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unknown=()=>({kind:'unknown',name:'Not recorded',staffId:null,branch:null,recordedAt:null});

// The saved closing account is operational context, never a responsibility finding.
export function savedShiftCloser(shift){
 const row=shift?.closedBy;
 if(!row||row.version!==1||row.branch!==shift.branch||!text(row.branch)||!Number.isFinite(attendanceMillis(row.recordedAt)))return unknown();
 if(row.actorType==='staff'&&row.source==='pos-session'&&(row.authUid==null||text(row.authUid))&&typeof row.staffId==='string'&&/^[-A-Za-z0-9_]{1,160}$/.test(row.staffId)&&text(row.staffName))return {kind:'staff',name:row.staffName,staffId:row.staffId,branch:row.branch,recordedAt:row.recordedAt};
 if(row.actorType==='hq'&&row.source==='owner-review'&&text(row.authUid)&&row.staffId===null&&row.staffName===null&&text(row.email))return {kind:'hq',name:text(row.displayName)||row.email,staffId:null,branch:row.branch,recordedAt:row.recordedAt};
 return unknown();
}
export function activeShortageStaff(person){
 try{cashShortageStaff(person,person?.id);return !/^(REVOKED|BLOCKED)$/i.test(String(person.pin||''));}catch{return false;}
}
export function suggestedShiftCloser(shift,people){
 const closer=savedShiftCloser(shift);if(closer.kind!=='staff')return null;
 const person=people.find(row=>row.id===closer.staffId&&row.cashierName===closer.name&&activeShortageStaff(row));
 return person||null;
}
export function shiftCloserSummaryHTML(shift,{compact=false}={}){
 const closer=savedShiftCloser(shift);
 if(closer.kind==='staff')return `<p class="cash-shortage-closer"><strong>Closed by: ${esc(closer.name)}</strong>${compact?'<br>':' · '}Saved staff closing account${compact?'':'<br><span class="cash-shortage-note">This records who closed the shift. Cash responsibility still requires review of the cash handling, evidence and staff explanation.</span>'}</p>`;
 if(closer.kind==='hq')return `<p class="cash-shortage-closer"><strong>Closed by: ${esc(closer.name)}</strong>${compact?'<br>':' · '}HQ closure${compact?'':'<br><span class="cash-shortage-note">HQ closed this shift. No staff closing account is assigned by this record.</span>'}</p>`;
 return `<p class="cash-shortage-closer"><strong>Closed by: Not recorded</strong>${compact?'':'<br><span class="cash-shortage-note">This record has no saved closing account. The shared POS user log does not identify who closed the shift.</span>'}</p>`;
}
