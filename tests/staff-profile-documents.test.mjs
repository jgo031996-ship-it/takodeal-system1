import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ReviewDocument,ReviewElement,deferred} from './helpers/review-dom.mjs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {staffDirectoryActorKey} from '../takodeal-manager/staff-directory-reader.js';
import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import {payrollActorKey,syncPayslipImageButton} from '../takodeal-manager/payroll-completion.js';
import {readPayrollSnapshot} from '../takodeal-manager/payroll-preview-guard.js';
import {renderPayslipOptionalDeductions,renderRecurringPayslipDeductions} from '../takodeal-manager/payslip-optional-deductions.js';
const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),index=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8');
const extract=name=>{const from=main.indexOf('\nwindow.'+name+' = '),to=main.indexOf('\n};',from+1);assert.ok(from>=0&&to>from);return main.slice(from+1,to+3);};
const part=(start,end)=>index.slice(index.indexOf(start),index.indexOf(end,index.indexOf(start)));
Object.defineProperty(ReviewElement.prototype,'style',{get(){return this._style||={};},configurable:true});
Object.defineProperty(ReviewElement.prototype,'innerText',{get(){return this.textContent;},set(value){this.textContent=value;},configurable:true});
ReviewElement.prototype.matches=function(selector){if(selector[0]==='.')return String(this.className||this.attributes.class||'').split(/\s+/).includes(selector.slice(1));if(selector[0]==='[')return Object.hasOwn(this.attributes,selector.slice(1,-1));if(selector[0]==='#')return this.id===selector.slice(1);return this.tagName.toLowerCase()===selector;};
for(const [name,offset]of [['before',0],['after',1]])ReviewElement.prototype[name]=function(node){node.parentElement=this.parentElement;this.parentElement.children.splice(this.parentElement.children.indexOf(this)+offset,0,node);};
const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const profile=extra=>({cashierName:'Sample Crew',branch:'Sample Branch',role:'Crew',dateHired:'2024-02-03',hourlyRate:99999,status:'Active',...extra});
const paid=extra=>({staffId:'staff',staffName:'Original Saved Name',branch:'Sample Branch',startDate:'2026-09-16',endDate:'2026-09-30',acknowledged:true,processedAt:new Date('2026-10-01T23:00:00Z'),acknowledgedAt:new Date('2026-10-02T01:00:00Z'),signatureBase64:signature,finalNetPay:4580.25,frozenData:{name:'Original Saved Name',staffId:'staff',branch:'Sample Branch',start:'2026-09-16',end:'2026-09-30',profile:{staffId:'staff',dateHired:'2023-01-02',customDeductions:[{name:'Original saved deduction',amount:5}]},isPaid:true,shiftsWorked:1,basicPay:4800.5,nightBonus:120,straightBonus:20,holidayPayTotal:100,perfBonus:33.25,lateDeduction:13,sss:50,philhealth:20,pagibig:10,advances:50,loans:100,meals:75,ownerDeductions:30,onlineRefunds:25,cashShortages:15,customDeductionsTotal:5,finalNetPay:4580.25,logs:[{date:'Sep 16',in:'09:00 AM',out:'05:00 PM',hrs:8,remark:'Original saved attendance'}]},...extra});
function fixture(options={}){
 const h=firestoreHarness(),d=new ReviewDocument(),dialogs=[],reads=[],writes=[],captures=[],downloads=[];
 d.querySelectorAll=selector=>d.body.querySelectorAll(selector);
 d.body.innerHTML=part('<div id="employeeProfileModal"','<div id="photoViewerModal"')+part('<div id="payslipModal"','<div id="selectiveResetModal"')+part('<div id="coeTemplate"','<div id="issueSanctionModal"');
 const node=id=>d.getElementById(id);node('employeeProfileModal').style.display='flex';node('empProfileId').value='staff';node('empFullName').value='Unsaved edited name';node('empRole').value='Unsaved edited role';node('empDateHired').value='2099-01-01';
 const create=d.createElement.bind(d);d.createElement=tag=>{const el=create(tag);if(tag==='a')el.onclick=()=>downloads.push({name:el.download,href:el.href});return el;};
 h.put('cashiers/staff',profile(options.profile));h.put('payroll_records/paid-original',paid());h.put('payroll_records/wrong-staff',paid({staffId:'other',staffName:'Sample Crew',frozenData:{...paid().frozenData,staffId:'other',name:'OTHER PERSON PRIVATE'}}));h.put('payroll_records/unsigned',paid({acknowledged:false}));
 const user={uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true};
 Object.assign(h.api,{auth:{currentUser:user},sessionUser:{uid:user.uid,email:user.email,isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']},staffProfileFormGeneration:1,isBranchAllowed:branch=>h.api.sessionUser.allowedBranches.includes('All')||h.api.sessionUser.allowedBranches.includes(branch),globalPayrollCache:{unrelated:{name:'Unrelated current preview',basicPay:9876}},requirePayrollPreview:()=>assert.fail('Saved history must not require or regenerate a current payroll preview.'),ManagerUI:{notify:text=>dialogs.push({notice:text})}});
 h.api.getDocFromServer=async ref=>{reads.push(ref.path);if(options.read)return options.read(ref,h);return {id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}};};
 const readMany=h.api.getDocsFromServer;h.api.getDocsFromServer=async query=>{reads.push(query.table);return readMany(query);};
 for(const name of ['runTransaction','addDoc','setDoc','updateDoc','deleteDoc'])h.api[name]=async()=>{writes.push(name);assert.fail('Profile document actions must not write business records.');};
 const Swal={fire:async(...args)=>{dialogs.push(args[0]);const value=args[0];if(value?.html)h.popup=value.html;return{};},close:()=>{h.popup='';h.closed=(h.closed||0)+1;},showLoading(){}};
 const context=vm.createContext({window:h.api,document:d,Swal,staffDirectoryActorKey,payrollActorKey,activeStaffProfile,readPayrollSnapshot,renderPayslipOptionalDeductions,renderRecurringPayslipDeductions,syncPayslipImageButton,Date,console,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),html2canvas:async()=>{captures.push(Object.fromEntries(['coeName','coeRole','coeDateHired','coeDateToday','coeEmploymentStatus','coeServiceVerb'].map(id=>[id,node(id).innerText])));if(options.capture)await options.capture();return {toDataURL:()=>signature};}});
 const documentsStart=main.indexOf('const signedPayslipSnapshots=');vm.runInContext(main.slice(documentsStart,main.indexOf('\nwindow.viewReceiptDetails =',documentsStart)),context);
 for(const name of ['openPayslipModal','recalcPayslip','generateCOEImage'])vm.runInContext(extract(name),context);
 const click=async button=>{assert.ok(button);return vm.runInContext(button.attributes.onclick,context);};
 const footerButton=action=>node('employeeProfileModal').querySelectorAll('button').find(button=>button.attributes.onclick==='window.'+action+'()');
 return {h,w:h.api,d,node,context,dialogs,reads,writes,captures,downloads,click,async list(){await click(footerButton('viewStaffSignedPayslips'));return h.popup;},async view(){const list=d.createElement('div');list.innerHTML=await this.list();return click(list.querySelector('button'));},coe:()=>click(footerButton('generateStaffCOE'))};
}

test('actual profile footer and View Document open original signed frozen figures above the profile without a payroll preview',async()=>{
 const f=fixture(),before=structuredClone([...f.h.docs]),cache=f.w.globalPayrollCache;await f.view();
 assert.equal(typeof f.w.viewPastPayslip,'function');assert.ok(f.h.closed);assert.equal(f.h.popup,'');
 assert.equal(f.node('payslipModal').style.display,'flex');assert.equal(f.node('payslipModal').style.zIndex,'11000');assert.equal(f.node('employeeProfileModal').style.display,'flex');
 assert.equal(f.node('psName').innerText,'Original Saved Name');assert.equal(f.node('psBasicPay').innerText,'4,800.50');assert.equal(f.node('psFoods').value,'75');assert.equal(f.node('psSSS').value,'50');assert.equal(f.node('psNetPay').innerText,'4,580.25');assert.equal(f.node('psDateHired').innerText,'2023-01-02');assert.equal(f.node('psPayDistributed').value,'2026-10-02');
 assert.match(f.node('psAttendanceBody').innerHTML,/Original saved attendance/);assert.equal(f.node('psSavedSignature').querySelector('img').attributes.src,signature);assert.equal(f.node('psSavedSignature').hidden,false);
 assert.equal(f.node('btnFinalizePayslip').hidden,true);assert.equal(f.node('btnCheckSavedPayslip').hidden,true);assert.ok(f.node('printablePayslip').querySelectorAll('input').every(input=>input.disabled));
 assert.equal(f.node('printablePayslip').dataset.savedHistory,'true');assert.equal(f.node('psDaysWorked').innerText,'1');assert.equal(f.w.currentPayslipData.shiftsWorked,1);
 assert.equal(f.node('empFullName').value,'Unsaved edited name');assert.equal(f.w.globalPayrollCache,cache);assert.ok(f.reads.includes('payroll_records/paid-original'));assert.deepEqual([...f.h.docs],before);assert.deepEqual(f.writes,[]);
});

test('signed history excludes another staff ID and unsigned data while keeping unambiguous legacy records',async()=>{
 const f=fixture();f.h.put('payroll_records/legacy',paid({staffId:undefined,staffName:'Sample Crew',frozenData:{...paid().frozenData,staffId:undefined,profile:{dateHired:'2023-01-02'}}}));const html=await f.list();assert.match(html,/viewPastPayslip\('paid-original'\)/);assert.match(html,/viewPastPayslip\('legacy'\)/);assert.doesNotMatch(html,/wrong-staff|unsigned|OTHER PERSON PRIVATE/);
 f.h.put('cashiers/duplicate',profile());const ambiguous=await f.list();assert.doesNotMatch(ambiguous,/viewPastPayslip\('legacy'\)/);assert.match(ambiguous,/viewPastPayslip\('paid-original'\)/);assert.deepEqual(f.writes,[]);
});

test('saved history rechecks the record and refuses a changed identity or stale profile before opening',async()=>{
 for(const change of ['record','selection','account']){const f=fixture();await f.list();if(change==='record')f.h.put('payroll_records/paid-original',paid({staffId:'other'}));else if(change==='selection')f.node('empProfileId').value='other';else f.w.auth.currentUser={...f.w.auth.currentUser,uid:'other'};await f.w.viewPastPayslip('paid-original');assert.notEqual(f.node('payslipModal').style.display,'flex');assert.equal(f.w.currentPayslipData,undefined);assert.deepEqual(f.writes,[]);}
});

test('actual Generate COE footer downloads the saved active profile using the existing company template and present tense',async()=>{
 const f=fixture(),before=structuredClone([...f.h.docs]);await f.coe();assert.equal(f.captures.length,1);assert.deepEqual(f.captures[0],{coeName:'SAMPLE CREW',coeRole:'Crew',coeDateHired:'February 3, 2024',coeDateToday:'present',coeEmploymentStatus:'is currently employed',coeServiceVerb:'They serve'});assert.equal(f.downloads[0].name,'COE_Sample_Crew.png');assert.equal(f.node('coeTemplate').style.display,'none');assert.match(f.node('coeTemplate').textContent,/Jostuart Omangay/);assert.match(f.node('coeTemplate').textContent,/Davao City, Philippines/);assert.equal(f.node('empFullName').value,'Unsaved edited name');assert.deepEqual([...f.h.docs],before);assert.deepEqual(f.writes,[]);
});

test('former employee COE uses the recorded resignation date and cannot substitute today for a missing end date',async()=>{
 const f=fixture({profile:{status:'Resigned',dateResigned:'2026-09-20'}});await f.coe();assert.equal(f.captures[0].coeDateToday,'September 20, 2026');assert.equal(f.captures[0].coeEmploymentStatus,'was employed');assert.equal(f.captures[0].coeServiceVerb,'They served');assert.equal(f.downloads.length,1);
 const missing=fixture({profile:{status:'Archived',archivedAt:new Date('2026-09-20T00:00:00Z')}});await missing.coe();assert.equal(missing.downloads.length,0);assert.equal(missing.captures.length,0);assert.ok(missing.dialogs.includes('Could not generate COE'));assert.deepEqual(missing.writes,[]);
});

test('COE guards missing or invalid saved employment data and account changes during capture without any business writes',async()=>{
 for(const data of [{dateHired:'2026-02-30'},{role:''},{status:'Resigned',dateResigned:'2023-01-01'}]){const f=fixture({profile:data});await f.coe();assert.equal(f.captures.length,0);assert.equal(f.downloads.length,0);assert.deepEqual(f.writes,[]);}
 const gate=deferred(),f=fixture({capture:()=>gate.promise}),pending=f.coe();await new Promise(setImmediate);assert.equal(f.captures.length,1);f.w.auth.currentUser={...f.w.auth.currentUser,uid:'other'};gate.resolve();await pending;assert.equal(f.downloads.length,0);assert.equal(f.node('coeTemplate').style.display,'none');assert.deepEqual(f.writes,[]);
});

test('existing offboarding completes its saved-profile cleanup once when the awaited COE image fails',async()=>{
 const f=fixture({capture:async()=>{throw Error('Fictional image encoding failure.');}}),dialogs=[];let refreshes=0;
 f.node('empFullName').value='Sample Crew';f.node('empRole').value='Crew';f.node('empDateHired').value='2024-02-03';
 f.context.Swal.fire=async(...args)=>{dialogs.push(args);return args[0]?.title==='Offboard Staff Member?'?{isConfirmed:true,value:'Finished contract'}:{};};
 f.context.console={...console,error(){}};f.context.db=f.w.db;f.context.doc=f.w.doc;
 f.context.updateDoc=async(ref,patch)=>{f.writes.push({path:ref.path,patch});f.h.put(ref.path,{...f.h.get(ref.path),...patch});};
 f.w.loadHRModule=()=>refreshes++;vm.runInContext(extract('processResignation'),f.context);await f.w.processResignation();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'cashiers/staff');assert.equal(f.h.get('cashiers/staff').status,'Resigned');assert.equal(f.h.get('cashiers/staff').pin,'REVOKED');
 assert.equal(refreshes,1);assert.equal(f.node('employeeProfileModal').style.display,'none');assert.equal(f.node('coeTemplate').style.display,'none');assert.equal(f.downloads.length,0);
 assert.equal(dialogs.at(-1)[0],'Offboarding saved');assert.match(dialogs.at(-1)[1],/COE download failed.*Generate COE/);assert.equal(dialogs.at(-1)[2],'warning');assert.ok(!dialogs.some(args=>args[0]==='Error'));
});
