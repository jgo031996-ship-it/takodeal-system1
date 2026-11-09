import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStaffLoanLedgerSnapshot,normalizeStaffLoanLedger,staffLoanLedgerHTML} from '../takodeal-staff/staff-loan-ledger-model.js';
import {createStaffLoanLedgerClient,STAFF_LOAN_LEDGER_ENDPOINT} from '../takodeal-staff/staff-loan-ledger-client.js';
import {installStaffLoanLedger} from '../takodeal-staff/staff-loan-ledger-ui.js';
const info={staffId:'staff-a',staffName:'SAMPLE Staff',branch:'SAMPLE Branch',asOf:'2026-11-09T00:00:00.000Z'};
const ledger={id:'ledger-a',staffId:'staff-a',totalLoaned:1000.25,totalPaid:250.1,cutoffDeduction:150};
const issued={id:'issue-a',type:'Company Loan Issued',amount:1000.25,status:'Active',dateAdded:new Date('2026-10-01T00:00:00Z'),remarks:'Sample loan reason'};
const payment={id:'payroll-staff-a-2026-10-01-2026-10-15-loan',staffId:'staff-a',type:'Company Loan Payment',amount:250.1,status:'Paid',paidAt:new Date('2026-10-16T00:00:00Z'),remarks:'Auto-deducted from payslip',payrollRecordId:'payroll-staff-a-2026-10-01-2026-10-15'};
const snapshot=(extra={})=>buildStaffLoanLedgerSnapshot({...info,ledgers:[ledger],history:[issued,payment],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Owner saved ledger and payroll-linked repayment roundtrip preserves exact saved balance without a second debit',()=>{
 const before=JSON.stringify([ledger,issued,payment]),data=snapshot();
 assert.equal(data.ledger.remainingBalance,750.15);assert.equal(data.ledger.totalPaid,250.1);assert.equal(data.history[0].amount,250.1);
 assert.deepEqual(normalizeStaffLoanLedger(data,{staffId:info.staffId}),data);assert.equal(JSON.stringify([ledger,issued,payment]),before);
 const html=staffLoanLedgerHTML(data);assert.match(html,/₱750\.15/);assert.match(html,/₱150\.00/);assert.match(html,/saved payroll record/);assert.match(html,/not deducted again/);assert.match(html,/No separate loan agreement/);assert.doesNotMatch(html,/<button|<input|signature/i);
});
test('a verified absent ledger is distinct from explicit saved zero and incomplete history',()=>{
 const absent=snapshot({ledgers:[],history:[]});assert.equal(absent.ledger,null);assert.equal(absent.reviewRequired,false);assert.match(staffLoanLedgerHTML(absent),/No company loan ledger/);assert.doesNotMatch(staffLoanLedgerHTML(absent),/₱0\.00/);
 const zero=snapshot({ledgers:[{...ledger,totalLoaned:0,totalPaid:0}],history:[]});assert.equal(zero.ledger.remainingBalance,0);assert.match(staffLoanLedgerHTML(zero),/₱0\.00/);
 assert.match(staffLoanLedgerHTML(snapshot({historyComplete:false})),/history is incomplete/);
});
test('duplicate, missing, conflicting and malformed balances are held without choosing a record or guessing zero',()=>{
 for(const ledgers of [[ledger,{...ledger,id:'second'}],[{...ledger,totalPaid:undefined}],[{...ledger,totalLoaned:NaN}],[{...ledger,totalLoaned:-2}],[{...ledger,totalPaid:2.001}],[{...ledger,staffId:'another'}]]){
  const result=snapshot({ledgers});assert.equal(result.reviewRequired,true);assert.equal(result.ledger,null);assert.match(staffLoanLedgerHTML(result),/balance is unavailable/);assert.doesNotMatch(staffLoanLedgerHTML(result),/₱750\.15/);
 }
 assert.equal(snapshot({ledgers:[]}).reviewRequired,true);
});
test('explicit numeric legacy totals normalize to cents, overpayment remains a credit, and absent terms stay absent',()=>{
 const result=snapshot({ledgers:[{...ledger,totalLoaned:'10.10',totalPaid:'20.20',cutoffDeduction:undefined}],history:[]});
 assert.equal(result.ledger.remainingBalance,-10.1);assert.equal(result.ledger.cutoffDeduction,null);assert.match(staffLoanLedgerHTML(result),/Recorded credit balance/);assert.match(staffLoanLedgerHTML(result),/Not recorded/);
});
test('unknown deductions and unpaid draft figures never become loan payments; malformed loan history is explicitly held',()=>{
 const irrelevant={id:'draft',type:'Staff Meal',amount:9999};assert.deepEqual(snapshot({history:[irrelevant]}).history,[]);
 for(const row of [{...payment,status:'Unpaid'},{...payment,amount:'bad'},{...payment,staffId:'foreign'}]){const result=snapshot({history:[row]});assert.equal(result.reviewRequired,true);assert.equal(result.historyComplete,false);assert.deepEqual(result.history,[]);}
 const overflow=snapshot({history:Array.from({length:201},(_,n)=>({...payment,id:'payment-'+n}))});assert.equal(overflow.historyComplete,false);assert.equal(overflow.reviewRequired,true);
});
test('only explicit saved fields are projected and every visible name, branch and remark is escaped',()=>{
 const attack='<img src=x onerror="attack()">',result=snapshot({staffName:attack,branch:attack,ledgers:[{...ledger,pin:'PRIVATE_PIN',bank:'PRIVATE_BANK'}],history:[{...issued,remarks:attack,privateMedicalNote:'PRIVATE_HR'}]});
 const html=staffLoanLedgerHTML(result);assert.doesNotMatch(html,/<img|PRIVATE_PIN|PRIVATE_BANK|PRIVATE_HR/);assert.match(html,/&lt;img/);assert.match(html,/&quot;/);
 for(const modified of [{...result,staffId:'foreign'},{...result,ledger:{...result.ledger,remainingBalance:0}},{...result,secret:'extra'}])assert.throws(()=>normalizeStaffLoanLedger(modified,{staffId:info.staffId}));
});
function transport(options={}){
 let selectedId=info.staffId,selectedDevice='DEV-SAMPLE-PHONE',calls=0,watch;
 const user={uid:'private-phone-a',isAnonymous:true,getIdToken:async()=>'SAMPLE_TOKEN'},auth={currentUser:user};
 const api={auth,sdk:{onAuthStateChanged(_auth,fn){watch=fn;return()=>{watch=null;};}}};
 const client=createStaffLoanLedgerClient({createPrivateClient:async()=>api,identity:()=>selectedId,deviceId:()=>selectedDevice,fetcher:async(url,request)=>{calls++;assert.equal(url,STAFF_LOAN_LEDGER_ENDPOINT);assert.equal(request.method,'POST');assert.equal(request.cache,'no-store');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.deepEqual(JSON.parse(request.body),{staffId:info.staffId,deviceId:selectedDevice});return{ok:true,url,json:async()=>snapshot()};},...options});
 return{client,user,auth,api,get calls(){return calls;},changeId(value){selectedId=value;},changeDevice(value){selectedDevice=value;},changeAuth(value){auth.currentUser=value;watch?.(value);}};
}
test('private transport uses only the pinned read-only route and approved named anonymous account',async()=>{
 const h=transport();assert.equal((await h.client.read()).ledger.remainingBalance,750.15);assert.equal(h.calls,1);h.client.invalidate();
 const wrong=transport({createPrivateClient:async()=>({auth:{currentUser:{uid:'public',isAnonymous:false,getIdToken:async()=>'token'}}})});await assert.rejects(wrong.client.read(),{code:'loan-ledger-denied'});assert.equal(wrong.calls,0);
});
test('private access denied, unavailable, review and empty are distinguishable without echoing server text',async()=>{
 for(const [status,code]of [[403,'loan-ledger-denied'],[503,'loan-ledger-unavailable'],[409,'loan-ledger-review']]){
  const h=transport({fetcher:async()=>({ok:false,status,json:async()=>({error:{message:'SECRET_SERVER_TOKEN'}})})});await assert.rejects(h.client.read(),error=>error.code===code&&!error.message.includes('SECRET'));h.client.invalidate();
 }
 const h=transport({fetcher:async()=>({ok:true,json:async()=>snapshot({ledgers:[],history:[]})})});assert.equal((await h.client.read()).ledger,null);h.client.invalidate();
});
test('token, server response and auth replacement races cannot return another private identity',async()=>{
 const token=deferred(),h=transport();h.user.getIdToken=()=>token.promise;const reading=h.client.read();await tick();h.changeId('staff-b');token.resolve('OLD_TOKEN');await assert.rejects(reading,{code:'loan-ledger-account-changed'});assert.equal(h.calls,0);h.client.invalidate();
 const body=deferred(),other=transport({fetcher:async()=>({ok:true,json:()=>body.promise})});const pending=other.client.read();await tick();other.changeAuth({uid:'new-user',isAnonymous:true});body.resolve(snapshot());await assert.rejects(pending,{code:'loan-ledger-account-changed'});other.client.invalidate();
});
test('timeout is bounded, duplicate requests do not start, and late completion cannot return a snapshot',async()=>{
 const body=deferred();let expire;const h=transport({fetcher:async()=>({ok:true,json:()=>body.promise}),delay:fn=>{expire=fn;return 1;},cancelDelay:()=>{}});
 const pending=h.client.read();await tick();await assert.rejects(h.client.read(),{code:'loan-ledger-busy'});expire();await assert.rejects(pending,{code:'loan-ledger-timeout'});body.resolve(snapshot());await tick();h.client.invalidate();
});
function ui({locked=false,read=async()=>snapshot()}={}){
 const nodes=new Map(),events=new Map(),storage=new Map([['takodeal_staff_id',info.staffId],['takodeal_device_id','DEV-SAMPLE-PHONE']]);let requests=0,pin=0,invalidated=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{display:'none'},disabled:false,attrs:{},setAttribute(key,value){this.attrs[key]=value;},replaceChildren(){this.innerHTML='';},addEventListener(type,fn){events.set(id+':'+type,fn);}});return nodes.get(id);};
 const session={epoch:1,allows(id,epoch=1){return !locked&&id===info.staffId&&epoch===this.epoch;}};
 const w={localStorage:{getItem:key=>storage.get(key)||null},staffVaultSession:session,openVaultPin:async(mode,target)=>{assert.equal(mode,'unlock');assert.equal(target,'loans');pin++;},lockPayslipVault(){locked=true;w.clearStaffLoanLedger();},addEventListener:(type,fn)=>events.set('window:'+type,fn),setInterval(){},switchView(){},logoutStaff(){}};
 const d={hidden:false,getElementById:node,addEventListener:(type,fn)=>events.set('document:'+type,fn)};
 const api=installStaffLoanLedger(w,d,{createClient:()=>({invalidate(){invalidated++;},read:async options=>{requests++;const value=await read(options);options.assertCurrent();return value;}})});
 return{w,d,node,events,storage,session,api,get requests(){return requests;},get pin(){return pin;},get invalidated(){return invalidated;}};
}
test('My loans requires the existing financial PIN session before any private read',async()=>{
 const h=ui({locked:true});await h.w.loadMyLoanLedger();assert.equal(h.pin,1);assert.equal(h.requests,0);assert.equal(h.node('loansModal').style.display,'none');
});
test('actual UI shows saved amounts, closes and wipes them on lock, route, visibility, expiry and account changes',async()=>{
 for(const change of [h=>h.w.closeMyLoanLedger(),h=>h.w.switchView('timeclock'),h=>{h.d.hidden=true;h.events.get('document:visibilitychange')();},h=>{h.session.epoch++;h.api.check();},h=>{h.storage.set('takodeal_staff_id','staff-b');h.api.check();}]){
  const h=ui();await h.w.loadMyLoanLedger();assert.match(h.node('staffMyLoansContent').innerHTML,/₱750\.15/);change(h);assert.equal(h.node('staffMyLoansContent').innerHTML,'');assert.equal(h.node('loansModal').style.display,'none');assert.ok(h.invalidated>=1);
 }
});
test('close during private response suppresses late rendering, while a denied refresh removes the earlier balance',async()=>{
 const pending=deferred(),h=ui({read:()=>pending.promise});const loading=h.w.loadMyLoanLedger();await tick();h.w.closeMyLoanLedger();pending.resolve(snapshot());await loading;assert.equal(h.node('staffMyLoansContent').innerHTML,'');
 let denied=false;const other=ui({read:async()=>{if(denied)throw Object.assign(Error('Phone access denied'),{code:'loan-ledger-denied'});return snapshot();}});await other.w.loadMyLoanLedger();denied=true;await other.w.loadMyLoanLedger();assert.equal(other.node('staffMyLoansContent').innerHTML,'');assert.match(other.node('staffMyLoansStatus').textContent,/denied/);
});
