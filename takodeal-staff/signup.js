import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,signInAnonymously} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import {createStaffSelfService} from './staff-self-service.js';
import {createStaffSetupTransport} from './staff-setup-access.js';
import {confirmStaffSignupPhone} from './staff-signup-handoff.js';
import {initialContract,CONTRACT_VERSION} from './employment-contract.mjs';
import {firebaseConfig} from './signup-config.js';
const app=getApps().find(app=>app.name==='[DEFAULT]')||initializeApp(firebaseConfig),auth=getAuth(app),$=id=>document.getElementById(id),form=$('hireForm');
let authReady;
const ensureUser=async()=>{if(!authReady)authReady=(async()=>{await auth.authStateReady();await setPersistence(auth,browserLocalPersistence);if(!auth.currentUser)await signInAnonymously(auth);return auth.currentUser;})().catch(error=>{authReady=null;throw error;});await authReady;return auth.currentUser;};
const service=createStaffSelfService({auth,ensureUser}),transport=createStaffSetupTransport({auth,ensureUser});
const groups=[
 ['Personal details','Your name and nickname will stay linked to your employee record.',[['cashierName','Full name',true],['scheduleNickname','Schedule nickname',true]]],
 ['Contact details','How we can reach you.',[['phone','Phone number',true],['email','Email (optional)',false],['address','Home address',true]]],
 ['Emergency contact','Who we should contact in an emergency.',[['emergencyName','Contact name',true],['emergencyPhone','Contact number',true]]],
 ['Salary payment accounts','Optional — enter the accounts you use to receive pay.',[['gcashName','GCash account name',false],['gcashNum','GCash number',false],['gotymeName','GoTyme account name',false],['gotymeNum','GoTyme number',false]]],
 ['Government records','Optional — you can complete these in your profile later.',[['sss','SSS number',false],['philhealth','PhilHealth number',false],['pagibig','Pag-IBIG number',false]]]
];
const definitions=groups.flatMap(([, ,fields])=>fields);
for(const [title,description,fields] of groups){
 const section=document.createElement('fieldset'),legend=document.createElement('legend'),note=document.createElement('p'),grid=document.createElement('div');
 section.className='signup-group';legend.textContent=title;note.textContent=description;grid.className='fields';section.append(legend,note,grid);
 for(const [name,label,required]of fields){const box=document.createElement('label');box.textContent=label;const input=document.createElement('input');input.name=name;input.required=required;input.maxLength=name==='address'?2000:name==='scheduleNickname'?80:160;input.type=name==='email'?'email':/phone|num$/i.test(name)?'tel':'text';if(name==='address')box.className='wide-field';box.append(input);grid.append(box);}
 $('hireFields').append(section);
}
let invitation,offer,draft,pending,busy=false,signed=false,drawing=false,signedCopy=null,completed=null,checkingPhone=false;
const status=message=>$('signupStatus').textContent=message;
function parse(value){const fragment=value.includes('#')?value.split('#')[1]:value,match=/^(?:hire=)?([A-Za-z0-9_-]{1,100})\.([a-f0-9]{64})$/.exec(fragment);if(!match)throw Error('Paste the complete hiring link shared by the Owner.');return{inviteId:match[1],token:match[2]};}
async function load(value){try{invitation=parse(value);const result=await service.call('hire-preview',invitation);if(result.contractVersion!==CONTRACT_VERSION)throw Error('Refresh this signup page before continuing.');offer=result.offer;$('linkEntry').hidden=true;form.hidden=false;status(`${offer.role==='Crew'?'Service Crew':offer.role} · ${offer.branch} · Starts ${offer.dateHired} · ₱${Number(offer.dailyRate).toFixed(2)} / day`);}catch(error){status(error.message);$('linkEntry').hidden=false;}}
const canvas=$('hireSignature'),ctx=canvas.getContext('2d');ctx.lineWidth=3;ctx.strokeStyle='#173e35';ctx.lineCap='round';
function point(event){const rect=canvas.getBoundingClientRect();return[(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height];}
canvas.addEventListener('pointerdown',event=>{if(busy||pending)return;drawing=true;canvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.moveTo(...point(event));});canvas.addEventListener('pointermove',event=>{if(!drawing)return;ctx.lineTo(...point(event));ctx.stroke();signed=true;});for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{drawing=false;});
function clear(){ctx.clearRect(0,0,canvas.width,canvas.height);signed=false;$('hireConsent').checked=false;}
$('clearHireSignature').onclick=()=>{if(!busy&&!pending)clear();};
form.onsubmit=event=>{event.preventDefault();const values=new FormData(form);if(values.get('dailyPin')!==values.get('confirmPin')){status('The two daily PINs must match.');return;}draft={details:Object.fromEntries(definitions.map(([key])=>[key,String(values.get(key)).trim()])),dailyPin:values.get('dailyPin')};$('contractPreview').innerHTML=initialContract(offer,draft.details);clear();form.hidden=true;$('hireReview').hidden=false;$('hireReview').scrollIntoView({behavior:'smooth'});};
$('editHireDetails').onclick=()=>{if(busy||pending)return;$('hireReview').hidden=true;form.hidden=false;clear();};
async function confirmPhone(){
 if(!completed||checkingPhone)return false;checkingPhone=true;$('retryStaffPhone').disabled=true;$('continueStaffSignIn').disabled=true;status('Your profile and signed contract are saved. Confirming this phone for sign-in…');
 try{await confirmStaffSignupPhone({result:completed.result,auth,uid:completed.uid,transport,storage:localStorage});$('retryStaffPhone').hidden=true;$('continueStaffSignIn').disabled=false;status('Your phone is ready. Continue to Staff sign-in and enter the daily PIN you chose. The Owner has been notified.');return true;}
 catch(error){$('retryStaffPhone').hidden=false;status(error.message+' Your employee profile is already saved; you do not need to sign up again.');return false;}
 finally{checkingPhone=false;$('retryStaffPhone').disabled=false;}
}
$('retryStaffPhone').onclick=confirmPhone;
$('continueStaffSignIn').onclick=async()=>{if(await confirmPhone())location.assign('./?signup=complete');};
$('submitHire').onclick=async()=>{
 if(busy||completed)return;if(!pending&&(!$('hireConsent').checked||!signed)){status('Read the contract, tick the agreement and draw your signature.');return;}
 if(!pending){const random=new Uint32Array(10);crypto.getRandomValues(random);pending={...invitation,details:draft.details,dailyPin:draft.dailyPin,setupCode:Array.from(random,value=>String(value%10)).join(''),deviceId:'DEV-'+crypto.randomUUID().toUpperCase(),operationId:crypto.randomUUID(),signature:canvas.toDataURL('image/png'),contractVersion:CONTRACT_VERSION,accepted:true};}
 busy=true;$('submitHire').disabled=true;$('editHireDetails').disabled=true;$('clearHireSignature').disabled=true;status('Saving your profile and signed contract.');
 try{
  const uid=(await ensureUser()).uid,result=await service.call('hire-submit',pending);completed={result,uid};$('hireSetupCode').textContent=pending.setupCode;$('hireReview').hidden=true;$('hireDone').hidden=false;history.replaceState(null,'',location.pathname);form.reset();draft=null;pending=null;clear();
  await confirmPhone();
  try{signedCopy=await service.call('contract',{staffId:result.staffId,deviceId:result.deviceId});$('downloadHireContract').disabled=!signedCopy?.found;$('printHireContract').disabled=!signedCopy?.found;}catch{$('contractDownloadStatus').textContent='Your signed copy is saved. Sign in and open Employment → My Signed Contracts to download it.';}
 }catch(error){status(error.message);$('submitHire').textContent='Retry the same submission';if(error.status===400||error.status===409){pending=null;$('editHireDetails').disabled=false;$('clearHireSignature').disabled=false;}}
 finally{busy=false;$('submitHire').disabled=false;}
};
const contractDocument=()=> '<!doctype html><html><head><meta charset="utf-8"><title>TAKODEAL signed employment contract</title></head><body>'+signedCopy.html+'</body></html>';
$('downloadHireContract').onclick=()=>{if(!signedCopy?.found)return;const blob=new Blob([contractDocument()],{type:'text/html'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='TAKODEAL-signed-employment-contract.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('printHireContract').onclick=async()=>{if(!signedCopy?.found)return;const popup=window.open('','','width=900,height=1000');if(!popup){$('contractDownloadStatus').textContent='Allow the document window, then choose Print / save PDF again.';return;}popup.document.write(contractDocument());popup.document.close();await Promise.all([...popup.document.images].map(img=>img.decode?.().catch(()=>{})||Promise.resolve()));popup.focus();popup.print();};
$('openHiringLink').onclick=()=>load($('hiringLink').value.trim());
if(location.hash)void load(location.hash.slice(1));else{status('Open the hiring link shared by the Owner, or paste it below.');$('linkEntry').hidden=false;}
