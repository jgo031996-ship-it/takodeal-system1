import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {OWNER_PREVIEW_KEY,cashierStartupBusy,beginCashierOwnerPreview,refreshCashierBranchLabel,createCashierBranchRecovery} from '../Takodeal-POS/cashier-startup.js';
import {CASHIER_RELEASE} from '../Takodeal-POS/cashier-data.js';
import {cashierOwnerEntryProof,restoreCashierOwnerEntry} from './helpers/cashier-owner-entry-inverse.mjs';

const BASE='dfa305e3ed9267eb41c1ade0ab2c613b10b2821e';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const baseline=file=>execFileSync('git',['show',BASE+':'+file],{cwd:new URL('../',import.meta.url),encoding:'utf8',windowsHide:true,maxBuffer:3e6});
const page=read('Takodeal-POS/index.html'),main=read('Takodeal-POS/main.js');
const boot=page.match(/^[ \t]*window\.sessionUser = [^\r\n]+;[ \t]*$/m)?.[0];
assert.ok(boot,'Use the actual live static shell initializer');
const bootstrap=w=>{vm.runInNewContext(boot,{window:w});return w.sessionUser;};
const start=main.indexOf('window.ownerBypassLogin = async function() {'),end=main.indexOf('\n};',start)+3;
assert.ok(start>0&&end>start);const ownerHandler=main.slice(start,end);

function fixture(options={}){
 const values=new Map([['takodeal_device_id','DEV-FICTIONAL1'],['takodeal_device_branch','Registered branch'],['paid-receipts-sentinel','kept exact'],['parked-orders-sentinel','kept exact']]),writes=[],messages=[],nodes=new Map();
 const storage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,String(value)]);values.set(key,String(value));},removeItem(){assert.fail('Owner entry must not erase a saved record');},clear(){assert.fail('Owner entry must not clear storage');}};
 for(const id of ['loginOverlay','pinOverlay','loginBranchDisplay','displayDeviceLocation'])nodes.set(id,{style:{display:'flex'}});
 const d={getElementById:id=>nodes.get(id)||null},primary={uid:'fictional-tablet',isAnonymous:true},primaryAuth={currentUser:primary};
 const owner={uid:'fictional-owner',email:'jgo031996@gmail.com',emailVerified:true,...options.owner},ownerAuth={currentUser:owner},config={projectId:'fictional-project',appId:'fictional-app',apiKey:'fictional-public-key',authDomain:'fixture.invalid'},app={name:'takodeal-pos-owner-preview-v1',options:config},ownerDb={app};
 const state={popups:0,reads:0,loads:0,messages,writes},w={auth:primaryAuth,localStorage:storage,cart:[],platformCarts:{Standard:[],Grab:[],Foodpanda:[]},currentShift:null,
  query:value=>value,collection:(db,table)=>{assert.equal(db,ownerDb);assert.equal(table,'branches');return{db,table};},
  getDocs:async()=>{state.reads++;await options.read?.(f);return{forEach:callback=>callback({data:()=>({name:'Preview branch'})})};},
  loadPOSData:()=>state.loads++};
 bootstrap(w);
 const f={w,d,state,values,storage,nodes,primary,primaryAuth,owner,ownerAuth,ownerDb,writes,placeholder:w.sessionUser};
 class Provider{setCustomParameters(value){assert.equal(value.prompt,'select_account');}}
 const Swal={showLoading(){},async fire(...args){messages.push(args);if(args[0]?.input==='select'){await options.select?.(f);return{value:options.cancel?undefined:'Preview branch'};}return{};}};
 vm.runInNewContext(ownerHandler,{window:w,document:d,localStorage:storage,firebaseConfig:config,getApps:()=>[app],initializeApp:()=>assert.fail('Reuse only the isolated Owner app'),
  getAuth:value=>{assert.equal(value,app);return ownerAuth;},getFirestore:value=>{assert.equal(value,app);return ownerDb;},GoogleAuthProvider:Provider,
  signInWithPopup:async auth=>{assert.equal(auth,ownerAuth,'Never sign the Cashier Auth in as Owner');state.popups++;await options.popup?.(f);return{user:owner};},
  cashierStartupBusy,beginCashierOwnerPreview,refreshCashierBranchLabel,Swal,console:{error(){}}});
 f.enter=()=>w.ownerBypassLogin();f.retained=()=>{assert.equal(primaryAuth.currentUser,primary);assert.equal(values.get('paid-receipts-sentinel'),'kept exact');assert.equal(values.get('parked-orders-sentinel'),'kept exact');};
 return f;
}

test('the actual live shell initializer reproduces the old false busy state; only that empty placeholder is now clear',async()=>{
 const old=await import('data:text/javascript;base64,'+Buffer.from(baseline('Takodeal-POS/cashier-startup.js')).toString('base64'));
 const f=fixture();assert.equal(old.cashierStartupBusy(f.w),true);assert.equal(cashierStartupBusy(f.w),false);
 assert.equal(f.w.sessionUser,f.placeholder);assert.equal(f.writes.length,0);assert.equal(f.state.popups,0);f.retained();
});

test('actual shell plus actual Owner handler reaches isolated verified Google login and a branch preview without changing Cashier Auth',async()=>{
 const f=fixture();f.w.currentShift={status:'Closed',active:false};await f.enter();
 assert.equal(f.state.popups,1);assert.equal(f.state.reads,1);assert.equal(f.state.loads,1);assert.equal(f.nodes.get('loginOverlay').style.display,'none');
 assert.equal(f.w.sessionUser,f.placeholder);assert.equal(f.values.get('takodeal_device_branch'),'Preview branch');
 const marker=JSON.parse(f.values.get(OWNER_PREVIEW_KEY));assert.equal(marker.originalBranch,'Registered branch');assert.equal(marker.previewBranch,'Preview branch');
 assert.equal(f.values.get('cashierName'),'Owner (System Test)');f.retained();
});

for(const change of ['email','branch','name','owner','extra','hidden-extra','symbol-extra','empty','array','real-cashier'])test('a non-placeholder session stays blocked even with a closed register: '+change,async()=>{
 const f=fixture();if(change==='email')f.w.sessionUser.email='cashier@fixture.invalid';if(change==='branch')f.w.sessionUser.branch='Registered branch';if(change==='name')f.w.sessionUser.cashierName='Fictional Staff';if(change==='owner')f.w.sessionUser.isOwner=true;if(change==='extra')f.w.sessionUser.staffId='STAFF_FIXTURE';if(change==='hidden-extra')Object.defineProperty(f.w.sessionUser,'staffId',{value:'STAFF_FIXTURE'});if(change==='symbol-extra')f.w.sessionUser[Symbol('staff')]='STAFF_FIXTURE';if(change==='empty')f.w.sessionUser={};if(change==='array')f.w.sessionUser=[];if(change==='real-cashier')f.w.sessionUser={staffId:'STAFF_FIXTURE',cashierName:'Fictional Staff',branch:'Registered branch'};
 f.w.currentShift={status:'Closed',active:false};await f.enter();assert.equal(cashierStartupBusy(f.w),true);assert.equal(f.state.popups,0);assert.equal(f.state.reads,0);assert.equal(f.writes.length,0);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');f.retained();
});

for(const kind of ['cart','Standard','Grab','Foodpanda','count','handover-submit','checkout','submit','shift-opening','handover-v4','handover-legacy','storage'])test('real work remains guarded with the actual empty login placeholder: '+kind,async()=>{
 const f=fixture(),originalCart=f.w.cart,originalCarts=f.w.platformCarts;
 if(kind==='cart')f.w.cart.push({name:'Kept customer item',qty:3,notes:'Keep notes'});
 if(['Standard','Grab','Foodpanda'].includes(kind))f.w.platformCarts[kind].push({name:'Kept platform draft',qty:2});
 const flags={count:'cashierCashCountActive','handover-submit':'cashierRemitSubmitting',checkout:'isProcessingOrder',submit:'isSubmittingOrder','shift-opening':'cashierShiftOpening'};if(flags[kind])f.w[flags[kind]]=true;
 if(kind==='handover-v4')f.values.set('takodeal_cash_remittance_v4:fictional','malformed but preserved');
 if(kind==='handover-legacy')f.values.set('takodeal_remittance_attempt_v1:fictional','original reference');
 if(kind==='storage')f.storage.key=()=>{throw Error('Fictional unavailable storage');};
 const before=JSON.stringify([...f.values]);await f.enter();assert.equal(f.state.popups,0);assert.equal(f.state.reads,0);assert.equal(f.writes.length,0);assert.equal(JSON.stringify([...f.values]),before);assert.equal(f.w.cart,originalCart);assert.equal(f.w.platformCarts,originalCarts);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');f.retained();
});

for(const kind of ['cashier','cart','handover'])test('new work during Owner authentication/dialog still holds before any branch mutation: '+kind,async()=>{
 const f=fixture({select(f){if(kind==='cashier')f.w.sessionUser={staffId:'STAFF_OTHER'};if(kind==='cart')f.w.cart.push({name:'New order',qty:2});if(kind==='handover')f.values.set('takodeal_cash_remittance_v4:late','keep original');}});
 await f.enter();assert.equal(f.state.popups,1);assert.equal(f.state.loads,0);assert.equal(f.writes.length,0);assert.equal(f.values.get('takodeal_device_branch'),'Registered branch');assert.equal(f.nodes.get('loginOverlay').style.display,'flex');f.retained();
});

for(const owner of [{email:'other@fixture.invalid'},{emailVerified:false}])test('recognizing the empty shell does not weaken verified Owner authorization: '+JSON.stringify(owner),async()=>{
 const f=fixture({owner});await f.enter();assert.equal(f.state.popups,1);assert.equal(f.state.reads,0);assert.equal(f.state.loads,0);assert.equal(f.writes.length,0);assert.equal(f.state.messages.at(-1)[0],'Access Denied');f.retained();
});

test('cancelled branch choice keeps both accounts and all tablet data without a preview',async()=>{
 const f=fixture({cancel:true}),before=JSON.stringify([...f.values]);await f.enter();assert.equal(f.state.popups,1);assert.equal(f.state.reads,1);assert.equal(f.state.loads,0);assert.equal(f.writes.length,0);assert.equal(JSON.stringify([...f.values]),before);assert.equal(f.ownerAuth.currentUser,f.owner);f.retained();
});

test('Owner identity changing in the branch dialog cannot hide sign-in or change a branch',async()=>{
 const f=fixture({select(f){f.ownerAuth.currentUser={uid:'other',email:'other@fixture.invalid',emailVerified:true};}});await f.enter();assert.equal(f.state.loads,0);assert.equal(f.writes.length,0);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');assert.match(f.state.messages.at(-1)[1],/Owner account changed/);f.retained();
});

test('the actual login placeholder permits only existing fresh-binding branch recovery after a previous Owner preview',async()=>{
 const f=fixture();await f.enter();const user=f.primary,rows=new Map([
  ['pos_bindings/'+user.uid,{uid:user.uid,deviceId:'DEV-FICTIONAL1',branch:'Registered branch',legacyDeviceDocId:'FLEET_FIXTURE',status:'Active'}],
  ['pos_devices/FLEET_FIXTURE',{deviceId:'DEV-FICTIONAL1',branch:'Registered branch',status:'Active',appType:'POS'}]
 ]),reads=[];
 const deviceApi={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>{reads.push(ref);return{metadata:{fromCache:false,hasPendingWrites:false},exists:()=>rows.has(ref),data:()=>structuredClone(rows.get(ref))};}};
 // The recovery module alone owns removal of its known, verified preview marker.
 f.storage.removeItem=key=>{assert.equal(key,OWNER_PREVIEW_KEY);f.writes.push([key,null]);f.values.delete(key);};
 const recovery=createCashierBranchRecovery(f.w,f.d,{deviceContext:{resolve:async({assertCurrent})=>{assertCurrent();return{auth:f.primaryAuth,deviceApi};}}});
 const result=await recovery.recover();assert.equal(result.status,'Restored');assert.equal(f.values.get('takodeal_device_branch'),'Registered branch');assert.equal(f.values.has(OWNER_PREVIEW_KEY),false);assert.deepEqual(reads,['pos_bindings/'+user.uid,'pos_devices/FLEET_FIXTURE']);f.retained();
});

test('the live Owner authentication, sale and logout code remains byte-exact; the guard patch has an exact inverse',()=>{
 assert.equal(main,baseline('Takodeal-POS/main.js'),'Owner auth and ordinary financial/logout paths unchanged');
 const source=read('Takodeal-POS/cashier-startup.js'),before=baseline('Takodeal-POS/cashier-startup.js'),insertion="// The static login shell has this exact display placeholder before a PIN login.\n// Every other retained session still requires an explicit Cashier sign-out.\nconst loginPlaceholder=user=>user&&typeof user==='object'&&!Array.isArray(user)&&Reflect.ownKeys(user).length===4&&['email','branch','cashierName','isOwner'].every(name=>Object.hasOwn(user,name))&&user.email===''&&user.branch==='Loading...'&&user.cashierName==='User'&&user.isOwner===false;\n";
 assert.equal(source.split(insertion).length,2);const restored=source.replace(insertion,'').replace('if(w.sessionUser&&!loginPlaceholder(w.sessionUser)||','if(w.sessionUser||');assert.equal(restored,before);
 assert.equal(boot,baseline('Takodeal-POS/index.html').match(/^[ \t]*window\.sessionUser = [^\r\n]+;[ \t]*$/m)[0],'Static initializer itself remains unchanged');
});

test('the Owner entry release has four exact inverses to live dfa and no cache-policy or historical-proof changes',()=>{
 assert.equal(cashierOwnerEntryProof.base,BASE);assert.equal(cashierOwnerEntryProof.release,'cashier-owner-entry-20261115-r1');assert.equal(CASHIER_RELEASE,cashierOwnerEntryProof.release);
 assert.deepEqual(Object.keys(cashierOwnerEntryProof.files).sort(),['Takodeal-POS/cashier-startup.js','Takodeal-POS/index.html','Takodeal-POS/sw.js','Takodeal-POS/cashier-data.js'].sort());
 for(const file of Object.keys(cashierOwnerEntryProof.files)){const source=read(file);assert.equal(restoreCashierOwnerEntry(source,file),baseline(file),file);assert.throws(()=>restoreCashierOwnerEntry(source+'\n// unreviewed change',file));}
 const sw=read('Takodeal-POS/sw.js');assert.ok(sw.includes("const CORE = 'takodeal-pos-core-"+CASHIER_RELEASE+"';"));assert.ok(page.includes('main.js?v='+CASHIER_RELEASE));assert.ok(sw.includes("'./cashier-startup.js'"));
 for(const file of ['Takodeal-POS/index.html','Takodeal-POS/sw.js','Takodeal-POS/cashier-data.js'])assert.equal(read(file).replaceAll(CASHIER_RELEASE,'cashier-large-delivery-20261114-r1'),baseline(file),'Only the release label changes: '+file);
 for(const file of ['tests/fixtures/live-branch-directory-inverse.json','tests/fixtures/large-delivery-status-inverse.json','tests/fixtures/cashier-measured-prep-inverse.json','tests/fixtures/cashier-actual-prep-inverse.json'])assert.equal(read(file),baseline(file),file);
});

