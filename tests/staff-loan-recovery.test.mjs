import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createStaffLoanLedgerClient,STAFF_LOAN_LEDGER_ENDPOINT} from '../takodeal-staff/staff-loan-ledger-client.js';
import {installStaffLoanLedger} from '../takodeal-staff/staff-loan-ledger-ui.js';
import {buildStaffLoanLedgerSnapshot} from '../takodeal-staff/staff-loan-ledger-model.js';

const app=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
const factory=app.split('\n').find(line=>line.startsWith('installStaffLoanLedger(window,document,'));
const entryAt=app.indexOf('window.openReqForm = function(type) {');
const entry=app.slice(entryAt,app.indexOf('\n};',entryAt)+4);
const snapshot=()=>buildStaffLoanLedgerSnapshot({staffId:'employee',staffName:'Synthetic Staff',branch:'Synthetic Branch',asOf:'2026-11-09T00:00:00.000Z',ledgers:[{id:'ledger',staffId:'employee',totalLoaned:1000,totalPaid:250,cutoffDeduction:125}],history:[]});

function fixture({locked=false,response=()=>({ok:true,status:200,json:async()=>snapshot()})}={}){
 const nodes=new Map(),storage=new Map([['takodeal_staff_id','employee'],['takodeal_device_id','DEV-SYNTHETIC-PHONE']]),events=new Map(),calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{display:'none'},disabled:false,setAttribute(){},replaceChildren(){this.innerHTML='';},addEventListener(type,fn){events.set(id+':'+type,fn);}});return nodes.get(id);};
 const user={uid:'approved-private-phone',isAnonymous:true,getIdToken:async()=>'SYNTHETIC_PRIVATE_TOKEN'},primary={uid:'ordinary-login-unchanged'};
 const privateBinding={uid:user.uid,staffId:'employee',deviceId:'DEV-SYNTHETIC-PHONE',branch:'Synthetic Branch',active:true},privateClient={auth:{currentUser:user},db:{},sdk:{doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>{assert.equal(ref.table,'staff_document_devices');assert.equal(ref.id,user.uid);return{metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({...privateBinding})};},onAuthStateChanged(){return()=>{};}}};
 const w={auth:{currentUser:primary},localStorage:{getItem:key=>storage.get(key)||null},staffVaultSession:{epoch:1,allows:id=>!locked&&id==='employee'},openVaultPin:async(...args)=>calls.push(['pin',...args]),lockPayslipVault(){locked=true;w.clearStaffLoanLedger();},switchView(){},stopStaffLiveListeners(){},logoutStaff(){},addEventListener(type,fn){events.set('window:'+type,fn);},setInterval(){return 0;}};
 const d={hidden:false,getElementById:node,addEventListener(type,fn){events.set('document:'+type,fn);}};
 const context={window:w,document:d,localStorage:w.localStorage,firebaseConfig:{projectId:'synthetic-only'},installStaffLoanLedger,createStaffLoanLedgerClient:options=>createStaffLoanLedgerClient({...options,fetcher:async(url,request)=>{calls.push(['http',url,request]);return response();}}),createStaffDocumentFirebase:async(config,identity)=>{assert.equal(config.projectId,'synthetic-only');assert.equal(identity(),'employee');calls.push(['private']);return privateClient;}};
 assert.ok(factory);assert.ok(entryAt>=0);vm.runInNewContext(factory+'\n'+entry,context);
 return{w,d,node,storage,events,calls,primary,privateClient,privateBinding};
}

test('actual stable app Loans entry and installed factory use only the existing private account and read-only endpoint',async()=>{
 const h=fixture();await h.w.openReqForm('Loans');
 assert.match(h.node('staffMyLoansContent').innerHTML,/₱750\.00/);
 const http=h.calls.filter(row=>row[0]==='http');assert.equal(http.length,1);
 assert.equal(http[0][1],STAFF_LOAN_LEDGER_ENDPOINT);
 assert.equal(http[0][2].headers.Authorization,'Bearer SYNTHETIC_PRIVATE_TOKEN');
 assert.deepEqual(JSON.parse(http[0][2].body),{staffId:'employee',deviceId:'DEV-SYNTHETIC-PHONE'});
 assert.equal(h.w.auth.currentUser,h.primary);assert.equal(h.storage.size,2);
 assert.doesNotMatch(app,/window\.loadMyLoanLedger\s*=\s*async function/);
 h.w.clearStaffLoanLedger();
});

test('actual Loans entry never exposes its modal or sends a request before the existing financial PIN unlock',async()=>{
 const h=fixture({locked:true});await h.w.openReqForm('Loans');
 assert.deepEqual(h.calls,[['pin','unlock','loans']]);
 assert.equal(h.node('loansModal').style.display,'none');assert.equal(h.node('staffMyLoansContent').innerHTML,'');
 assert.equal(h.w.auth.currentUser,h.primary);
});
test('actual installed Loans factory preserves the approved private ID when personal setup replaces only the operational ID',async()=>{const h=fixture();h.storage.set('takodeal_device_id','DEV-NEW-OPERATIONAL');await h.w.openReqForm('Loans');const http=h.calls.find(row=>row[0]==='http');assert.ok(http);assert.deepEqual(JSON.parse(http[2].body),{staffId:'employee',deviceId:'DEV-SYNTHETIC-PHONE'});assert.match(h.node('staffMyLoansContent').innerHTML,/₱750\.00/);assert.equal(h.w.auth.currentUser,h.primary);h.w.clearStaffLoanLedger();});

test('unapproved private phone shows an honest hold without a zero balance, raw Firestore fallback or ordinary-login change',async()=>{
 const h=fixture({response:()=>({ok:false,status:403,json:async()=>({code:'staff-loans/approval',message:'PRIVATE_SOURCE_NOT_FOR_UI'})})});
 await h.w.openReqForm('Loans');assert.match(h.node('staffMyLoansStatus').textContent,/not approved.*HQ/);
 assert.equal(h.node('staffMyLoansContent').innerHTML,'');assert.doesNotMatch(h.node('staffMyLoansStatus').textContent,/PRIVATE_SOURCE|₱0/);
 assert.equal(h.calls.filter(row=>row[0]==='http').length,1);assert.equal(h.w.auth.currentUser,h.primary);assert.equal(h.storage.size,2);
 h.w.clearStaffLoanLedger();
});

test('loan assets are installed in the stable shell and its worker still bypasses cross-origin private responses',()=>{
 const html=readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8'),worker=readFileSync(new URL('../takodeal-staff/sw.js',import.meta.url),'utf8');
 for(const asset of ['staff-loan-ledger-client.js','staff-loan-ledger-model.js','staff-loan-ledger-ui.js','staff-loan-ledger.css']){
  assert.ok(worker.includes('./'+asset));assert.ok(readFileSync(new URL('../takodeal-staff/'+asset,import.meta.url)).length);
 }
 assert.match(html,/staffMyLoansStatus/);assert.match(html,/staffMyLoansClose/);assert.match(html,/staffMyLoansRefresh/);
 assert.match(html,/staff-branch-locations-20261113-r1/);assert.match(worker,/takodeal-staff-v59-branch-locations-20261113-r1/);assert.ok(worker.includes('./private-phone-identity.js'));assert.ok(worker.includes('./document-metadata-client.js'));
 assert.match(worker,/request\.method!=='GET'/);assert.match(worker,/url\.origin!==SHELL_ROOT\.origin/);
 assert.doesNotMatch(app,/from '\.\/staff-(?:operational-records|private-profile)\.js'/);
});
