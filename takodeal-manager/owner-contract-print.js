import {canOpenWorkspacePage} from './workspace-access-model.js';
import {dailyStaffRate,staffRateForDate,loadStaffSalaryTimeline} from './staff-rate-model.js';
import {onboardingDay,addCalendarMonths} from './onboarding-model.js';

const types={Initial:{key:'initial',title:'Employment Contract',label:'📄 Initial'},Extension:{key:'extension',title:'Contract Renewal & Extension',label:'📄 6-Mo Ext'},Regularization:{key:'regularization',title:'Regularization of Employment',label:'📄 Regularization'}};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=1500&&!['.','..'].includes(id)&&!/[\/\0]/.test(id);
export function ownerContractPrintHTML(type,data,signDate){
 const spec=types[type];if(!spec)throw Error('Choose a saved contract type.');
 const term=data.contractTerms?.[spec.key],start=term?.version===1?onboardingDay(term.startDate):null,end=term?.version===1?onboardingDay(term.endDate):null,salary=data.contractDailyRate;
 if(term?.version===1&&(!start||!end||end<start))throw Error('The saved contract term dates need HR review before printing.');
 if(!Number.isFinite(salary)||salary<0)throw Error('The saved contract wage needs HR review.');
 const rate=salary.toFixed(2),name=esc(data.cashierName||data.fullName||'Employee'),role=esc(data.role||'Service Crew'),signed=esc(signDate);
 let content;
 if(type==='Initial')content=`<p><b>1. POSITION AND COMMENCEMENT</b><br>The Employer hereby employs the Employee as a <b>${role}</b>. Employment shall commence on <b>${esc(start||data.dateHired||signDate)}</b>${start&&end?' with the saved six-month term ending on <b>'+esc(end)+'</b>.':' and shall be valid for a period of six (6) months.'}</p><p><b>2. WORK SCHEDULE AND COMPENSATION</b><br>The Employee shall receive a daily basic salary of <b>₱${rate}</b>. Entitled to one (1) day off per week.</p><p><b>3. ATTENDANCE AND ABSENCES POLICY</b><br>Unexcused absences and tardiness are subject to progressive disciplinary action (Verbal Warning, Written Warning, Suspension, Termination).</p><p><b>4. CONFIDENTIALITY AGREEMENT</b><br>Strict maintenance of proprietary recipes under penalty of <b>₱1,000,000.00</b> for breaches.</p><p><b>5. HEALTH DECLARATION</b><br>Employee affirms physical fitness for a food-handling environment.</p><p><b>6. NOTICE OF RESIGNATION</b><br>Mandatory 30-day notice prior to voluntary resignation.</p><p><b>7. COMPANY UNIFORM AND PROPERTY</b><br>Obligation to care for and return provided items to avoid payroll deductions.</p>`;
 else if(type==='Extension'){
  const beginning=start||onboardingDay(signDate),ending=end||(beginning?addCalendarMonths(beginning,6):null);
  if(!beginning||!ending)throw Error('The saved extension dates need HR review before printing.');
  content=`<p><b>1. EXTENSION OF EMPLOYMENT</b><br>Employment is extended as <b>${role}</b> for an additional six (6) months from <b>${esc(beginning)}</b> to <b>${esc(ending)}</b>. This is the final probationary phase.</p><p><b>2. COMPENSATION</b><br>Daily basic salary remains <b>₱${rate}</b>.</p><p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p><p><b>4. PATHWAY TO REGULARIZATION</b><br>Upon successful completion, the Employee may be offered a regularized contract.</p>`;
 }else content=`<p><b>1. REGULARIZATION</b><br>Effective <b>${esc(start||signDate)}</b>, the Employer hereby grants the Employee <b>REGULAR (PERMANENT)</b> employment status.</p><p><b>2. COMPENSATION</b><br>Daily basic salary of <b>₱${rate}</b>.</p><p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p><p><b>4. TERMINATION</b><br>Employment may only be terminated for just or authorized causes as provided by the Philippine Labor Code.</p>`;
 return `<!doctype html><html><head><meta charset="utf-8"><title>${spec.title} - ${name}</title><style>body{font:14px/1.6 Arial,sans-serif;color:#1e293b;max-width:800px;margin:0 auto;padding:40px}h1,h2{text-align:center}h2{font-size:20px}footer{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:65px}footer div{border-top:1px solid;padding-top:6px}@media print{body{padding:15px}}</style></head><body><h1>TAKODEÁL</h1><p style="text-align:center">Davao City, Philippines</p><hr><h2>${spec.title}</h2><p>This Agreement is executed on <b>${signed}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${name.toUpperCase()}</b> ("Employee").</p>${content}<footer><div><b>${name}</b><br>Employee Signature / Digitally Accepted</div><div><b>Chery Ann R. Fonda</b><br>Owner / Employer</div></footer></body></html>`;
}
export function installOwnerContractPrinting(api=window,d=document){
 let generation=0;
 const identity=()=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||user.emailVerified!==true||session?.uid!==user.uid||String(user.email||'').toLowerCase()!==String(session.email||'').toLowerCase()||!canOpenWorkspacePage(session,'branches'))throw Error('Unlock Staff & Security before printing a saved contract.');return {user,session};};
 api.reprintContract=async(type,encodedStaffId)=>{
  const version=++generation;let popup,actor,staffId;
  try{
   actor=identity();if(!Object.hasOwn(types,type))throw Error('Choose a saved contract type.');
   staffId=decodeURIComponent(encodedStaffId);
   // Existing open profile buttons may still carry the legacy serialized profile.
   // Resolve only its ID from the current form; never trust its dates or wages.
   if(staffId.startsWith('{'))staffId=d.getElementById('empProfileId')?.value;
   if(!validId(staffId)||d.getElementById('empProfileId')?.value!==staffId)throw Error('Reopen the saved employee profile before printing.');
   const formGeneration=api.staffProfileFormGeneration;
   const current=()=>{const now=identity();if(version!==generation||now.user!==actor.user||now.session!==actor.session||api.staffProfileFormGeneration!==formGeneration||d.getElementById('empProfileId')?.value!==staffId||d.getElementById('employeeProfileModal')?.style.display==='none')throw Error('The account or employee profile changed. Reopen the saved contract.');};
   current();popup=api.open('','','width=850,height=900');if(!popup)throw Error('Allow the document window, then select the contract again.');
   popup.document.write('<!doctype html><title>Loading saved contract</title><p>Confirming the saved contract…</p>');
   const snap=await api.getDocFromServer(api.doc(api.db,'cashiers',staffId));current();
   if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the saved employee contract.');
   let data={...snap.data(),staffId};if(api.isBranchAllowed?.(data.branch)!==true)throw Error('This employee branch is outside your Staff & Security access.');
   const signDate=data.signedContracts?.[types[type].key];if(typeof signDate!=='string'||!signDate.trim())throw Error('This saved contract has no employee acceptance on file.');
   data=await loadStaffSalaryTimeline(api,data);current();
   const rateDate=onboardingDay(data.contractTerms?.[types[type].key]?.startDate)||onboardingDay(signDate);
   if(data.salaryRateVersion===1&&!rateDate)throw Error('The saved contract date needs HR review before its historical wage can be printed.');
   const rate=data.salaryRateVersion===1?staffRateForDate(data,rateDate):dailyStaffRate(data);
   const html=ownerContractPrintHTML(type,{...data,contractDailyRate:rate},signDate);current();
   if(api.isBranchAllowed?.(data.branch)!==true)throw Error('This employee branch is outside your Staff & Security access.');
   if(popup.closed)throw Error('The document window was closed. Select the contract again when ready.');
   popup.document.open();popup.document.write(html);popup.document.close();popup.focus?.();popup.print();return true;
  }catch(error){popup?.close?.();if(!actor||version===generation&&api.auth?.currentUser===actor.user&&api.sessionUser===actor.session)await api.Swal?.fire?.('Contract unavailable',error.message||'Reconnect and reopen the saved contract.','warning');return false;}
 };
 return {print:api.reprintContract};
}
export function renderOwnerContractVault(api,d,staffId,data){
 const container=d.getElementById('contractVaultContainer'),buttons=d.getElementById('contractVaultButtons');if(!container||!buttons)return;
 buttons.replaceChildren();for(const [type,spec]of Object.entries(types))if(data.signedContracts?.[spec.key]){const button=d.createElement('button');button.type='button';button.textContent=spec.label;button.style.cssText='background:#0f766e;color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px';button.onclick=()=>api.reprintContract(type,encodeURIComponent(staffId));buttons.append(button);}
 container.style.display=buttons.children.length?'block':'none';
}
