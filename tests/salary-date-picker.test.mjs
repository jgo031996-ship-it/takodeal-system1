import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic} from '../takodeal-manager/staff-rate-changes.js';
import * as salary from '../takodeal-manager/staff-rate-model.js';

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=source.indexOf('window.saveEmployeeProfile = async function()'),end=source.indexOf('\n};',start)+3;
assert.ok(start>=0&&end>start,'Exercise the actual Manager profile save handler.');
const handler=source.slice(start,end);
function fixture({date='2099-01-01',missingDate=false,newProfile=false,rate='500'}={}){
 const h=firestoreHarness(),nodes=new Map(),alerts=[],activity=[];
 const element=id=>{if(id==='empRateEffectiveDate'&&missingDate)return null;if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,checked:false,style:{},innerText:'Save Data'});return nodes.get(id);};
 const api=h.api;api.auth={currentUser:{uid:'sample-hq',email:'hr@example.test',emailVerified:true}};api.sessionUser={uid:'sample-hq',email:'hr@example.test',cashierName:'Sample HQ',permissions:['payroll'],allowedBranches:['All']};
 h.put('hq_managers/sample-hq',{email:'hr@example.test',role:'Manager',pin:'1234',permissions:['payroll'],assignedBranch:'All'});h.put('hq_email_access/hr@example.test',{active:true,permissions:['payroll'],allowedBranches:['All']});
 const profile={cashierName:'Sample Staff',branch:'Sample Branch',role:'Crew',hourlyRate:450,pin:'1111',empId:'S001',phone:'Before'};
 if(!newProfile)h.put('cashiers/sample-staff',profile);
 h.put('payroll_records/sample-paid',{status:'Paid',frozenData:{basicPay:4500,finalNetPay:4000,profile:{hourlyRate:450}}});
 api.globalStaffData=newProfile?{}:{'sample-staff':structuredClone(profile)};api.staffProfileBaseline={id:newProfile?'':'sample-staff',exists:!newProfile,rate:newProfile?null:450,rateRevision:null};api.staffProfileFormGeneration=1;
 api.ManagerUI={notify:message=>alerts.push(message)};api.loadHRModule=()=>activity.push('refresh');
 const originalDoc=api.doc;api.doc=(...args)=>{activity.push('reference');return args.length===1?h.ref(args[0].table,'sample-new'):originalDoc(...args);};
 const originalRead=api.getDocsFromServer;api.getDocsFromServer=q=>{activity.push('query');return originalRead(q);};api.getDocs=api.getDocsFromServer;
 api.getDocFromServer=async ref=>{activity.push('read');return {exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))};};
 const originalTransaction=api.runTransaction;api.runTransaction=(...args)=>{activity.push('transaction');return originalTransaction(...args);};
 const values={empProfileId:newProfile?'':'sample-staff',empFullName:'Sample Staff',empBranchAssign:'Sample Branch',empHourlyRate:rate,empRole:'Crew',empPin:'1111',empNightDiffRate:'0',profEmpId:'S001',empPhone:'After',empRateEffectiveDate:date};for(const[id,value]of Object.entries(values))if(element(id))element(id).value=value;
 const document={getElementById:element,querySelectorAll:()=>[]};
 const context={window:api,document,...salary,dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic,Swal:{fire:(...args)=>alerts.push(args)},console:{error(){}},Date};
 vm.runInNewContext(handler,context);
 return {...h,api,element,alerts,activity,save:()=>api.saveEmployeeProfile()};
}

test('missing salary date control in an older shell blocks the actual save before queries, generated IDs or writes',async()=>{
 for(const newProfile of [false,true]){const h=fixture({missingDate:true,newProfile}),before=structuredClone([...h.docs]);await h.save();assert.deepEqual([...h.docs],before);assert.deepEqual(h.activity,[]);assert.equal(h.api.pendingEmployeeProfileRef,undefined);assert.equal(h.element('btnSaveEmpProfile').disabled,false);assert.match(JSON.stringify(h.alerts),/salary|date|refresh|reload/i);}
});

test('blank or invalid effective date cannot turn an actual wage edit into a legacy save',async()=>{
 for(const date of ['', '2026-02-30']){const h=fixture({date}),before=structuredClone([...h.docs]);await h.save();assert.deepEqual([...h.docs],before);assert.equal(h.element('btnSaveEmpProfile').disabled,false);assert.match(JSON.stringify(h.alerts),/date/i);}
});

test('actual selected future salary date preserves the earlier wage baseline and paid payroll',async()=>{
 const h=fixture(),paid=structuredClone(h.get('payroll_records/sample-paid'));await h.save();const profile=await salary.loadStaffSalaryTimeline(h.api,{...h.get('cashiers/sample-staff'),staffId:'sample-staff'});
 assert.equal(salary.staffRateForDate(profile,'2098-12-31'),450);assert.equal(salary.staffRateForDate(profile,'2099-01-01'),500);assert.equal(profile.hourlyRate,450);assert.deepEqual(h.get('payroll_records/sample-paid'),paid);assert.equal(Object.values(profile.salaryRateTimeline.rates)[0].effectiveDate,'2099-01-01');assert.equal(h.element('btnSaveEmpProfile').disabled,false);
});

test('unchanged wage permits an ordinary contact edit with a present blank date, without inventing a dated change',async()=>{
 const h=fixture({date:'',rate:'450'});await h.save();assert.equal(h.get('cashiers/sample-staff').hourlyRate,450);assert.equal(h.get('cashiers/sample-staff').phone,'After');assert.equal(h.get('staff_salary_rates/sample-staff'),undefined);assert.equal([...h.docs].filter(([path])=>path.startsWith('staff_rate_changes/')).length,1);
});
