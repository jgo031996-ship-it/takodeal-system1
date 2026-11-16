import test from 'node:test';
import assert from 'node:assert/strict';
import {createCashierOwnerWorkspace,CASHIER_OWNER_WORKSPACE} from '../Takodeal-POS/cashier-owner-workspace.js';
import {OWNER_PREVIEW_KEY} from '../Takodeal-POS/cashier-startup.js';
import {installPOSSettingsHub} from '../Takodeal-POS/pos-settings-hub.js';

const OWNER='jgo031996@gmail.com',deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(options={}){
 const values=new Map([['takodeal_device_id','DEV-FICTIONAL-WORKSPACE'],['takodeal_device_branch','Main Office'],['receipt-sentinel','original receipt'],['parked-sentinel','original parked order']]),writes=[],reads=[],events=[],nodes=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,String(value)]);values.set(key,String(value));},removeItem(){assert.fail('No stored records may be removed by Owner boot');},clear(){assert.fail('No storage clearing');},key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
 for(const id of ['displayCashierText','displayBranchText','loginBranchDisplay','displayDeviceLocation','loginOverlay','pinOverlay','ownerAccessBtnContainer'])nodes.set(id,{textContent:'Loading...',style:{display:'flex'}});
 const d={getElementById:id=>nodes.get(id)||null},config={projectId:'takodeal-pos',appId:'fictional-app',apiKey:'fictional-public-key',authDomain:'fixture.invalid'},ownerApp={name:'takodeal-pos-owner-preview-v1',options:config},primaryApp={name:'[DEFAULT]',options:config},primaryDb={app:primaryApp},ownerDb={app:ownerApp},primaryUser={uid:'fictional-anonymous',isAnonymous:true},primaryAuth={app:primaryApp,currentUser:primaryUser};
 let tokenCalls=0;const user={uid:'fictional-owner',email:OWNER,emailVerified:true,isAnonymous:false,displayName:'Fictional Owner',providerData:[{providerId:'google.com'}],async getIdTokenResult(force){assert.equal(force,true);tokenCalls++;await options.token?.();return{claims:{sub:user.uid,email:OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'},...options.claims}};}},ownerAuth={app:ownerApp,currentUser:user};
 const tables=new Map([['hq_managers',[{id:'fictional-hq',email:OWNER,role:'Owner',active:true,pin:'fictional-private-pin',securityPin:'fictional-private-security-pin'}]],['branches',[{id:'fictional-branch',name:'Agdao',active:true}]],['pos_devices',[]]]);
 const w={db:primaryDb,auth:primaryAuth,localStorage:storage,sessionUser:{email:'',branch:'Loading...',cashierName:'User',isOwner:false},cart:[],platformCarts:{Standard:[],Grab:[],Foodpanda:[]},offlineQueue:[{saleId:'ORIGINAL-PAID-ID',branch:'Main Office',cashier:'Original Crew'}],currentShift:null,
  doc:(db,table,id)=>({db,table,id}),collection:(db,table)=>({db,table}),where:(field,op,value)=>({field,op,value}),limit:value=>({limit:value}),query:(ref,...filters)=>({...ref,filters}),
  async getDocsFromServer(ref){assert.equal(ref.db,ownerDb,'Every authority query uses the named Owner database');reads.push(ref);await options.read?.(ref);const data=tables.get(ref.table)||[];return{metadata:{fromCache:false,hasPendingWrites:false,...options.metadata},docs:data.map(row=>({id:row.id,metadata:{fromCache:false,hasPendingWrites:false},data:()=>structuredClone(row)}))};},
  Event:class{constructor(type){this.type=type;}},dispatchEvent:event=>events.push(event.type),Swal:{fire:(...args)=>{events.push(args);return Promise.resolve({});}}};
 const original={primaryUser,primaryDb,session:w.sessionUser,cart:w.cart,carts:w.platformCarts,queue:w.offlineQueue,values:JSON.stringify([...values])},workspace=createCashierOwnerWorkspace(w,d,{primaryAuth,primaryDb,firebaseConfig:config,timeoutMs:options.timeoutMs??20000});
 w.getCashierOwnerWorkspaceContext=()=>workspace.current();
 return{w,d,workspace,values,writes,reads,events,nodes,tables,original,user,ownerAuth,ownerDb,primaryAuth,config,get tokenCalls(){return tokenCalls;},enter:()=>workspace.enter({auth:ownerAuth,db:ownerDb,user,branch:'Agdao'}),unchanged(){assert.equal(w.auth,primaryAuth);assert.equal(primaryAuth.currentUser,primaryUser);assert.equal(w.db,primaryDb);assert.equal(w.cart,original.cart);assert.equal(w.platformCarts,original.carts);assert.equal(w.offlineQueue,original.queue);assert.equal(values.get('receipt-sentinel'),'original receipt');assert.equal(values.get('parked-sentinel'),'original parked order');}};
}

test('fresh real-shaped named Owner claims and current records boot a tools session, labels and matching private context',async()=>{
 const f=fixture(),context=await f.enter();f.unchanged();assert.equal(f.tokenCalls,1);assert.equal(context.auth,f.ownerAuth);assert.equal(context.db,f.ownerDb);assert.equal(context.session,f.w.sessionUser);assert.equal(context.branch,'Agdao');assert.equal(context.actionActor,'Owner: Fictional Owner');assert.doesNotThrow(context.assertCurrent);
 assert.equal(f.w.sessionUser.workspaceKind,CASHIER_OWNER_WORKSPACE);assert.equal(f.w.sessionUser.cashierName,'Owner (System Test)');assert.equal(f.w.sessionUser.uid,f.user.uid);assert.equal(f.w.sessionUser.role,'Owner');assert.equal(Object.isFrozen(f.w.sessionUser),true);for(const key of ['staffId','sessionId','staffLoginSessionId','pin','token'])assert.equal(Object.hasOwn(f.w.sessionUser,key),false);
 assert.equal(f.nodes.get('displayCashierText').textContent,'Owner · Fictional Owner');assert.equal(f.nodes.get('displayBranchText').textContent,'Agdao');assert.equal(f.nodes.get('loginOverlay').style.display,'none');assert.equal(f.nodes.get('ownerAccessBtnContainer').style.display,'none');assert.equal(f.w.POS_BRANCH,'Agdao');
 assert.equal(JSON.parse(f.values.get(OWNER_PREVIEW_KEY)).originalBranch,'Main Office');assert.equal(f.values.get('cashierName'),'Owner (System Test)');assert.equal(JSON.stringify([...f.values]).includes('fictional-private'),false);assert.equal(f.events.filter(row=>row==='cashier-workspace-changed').length,1);
 assert.deepEqual(f.reads.map(ref=>[ref.table,ref.filters[0].field,ref.filters.at(-1).limit]).sort(),[['branches','name',2],['hq_managers','email',2],['pos_devices','deviceId',3]]);
});

for(const claims of [{sub:'different-owner'},{email:'other@example.invalid'},{email_verified:false},{firebase:{sign_in_provider:'password'}}])test('a refreshed token mismatch cannot change branch, session or login: '+JSON.stringify(claims),async()=>{
 const f=fixture({claims});await assert.rejects(f.enter(),/verified Google Owner/);assert.equal(f.w.sessionUser,f.original.session);assert.equal(JSON.stringify([...f.values]),f.original.values);assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');f.unchanged();
});

for(const change of ['local-owner-flag','wrong-app','wrong-db','anonymous','unverified','wrong-provider'])test('local display flags or mismatched account context cannot create an Owner permit: '+change,async()=>{
 const f=fixture();if(change==='local-owner-flag')f.w.sessionUser.isOwner=true;if(change==='wrong-app')f.ownerAuth.app.options={...f.config,projectId:'different-project'};if(change==='wrong-db')f.ownerDb.app={};if(change==='anonymous')f.user.isAnonymous=true;if(change==='unverified')f.user.emailVerified=false;if(change==='wrong-provider')f.user.providerData=[{providerId:'password'}];
 await assert.rejects(f.enter());assert.equal(f.writes.length,0);assert.equal(f.workspace.current(),null);f.unchanged();
});

for(const change of ['hq-inactive','hq-role-demoted','hq-other-uid','hq-duplicate','hq-security-pin-revoked','hq-pin-blocked','branch-inactive','branch-duplicate','known-device-revoked','cached','pending'])test('current source failure holds before every preview/local branch write: '+change,async()=>{
 const f=fixture({metadata:change==='cached'?{fromCache:true}:change==='pending'?{hasPendingWrites:true}:undefined}),hq=f.tables.get('hq_managers')[0],target=f.tables.get('branches')[0];
 if(change==='hq-inactive')hq.isActive=false;if(change==='hq-role-demoted')hq.role='Manager';if(change==='hq-other-uid')hq.uid='other-owner';if(change==='hq-duplicate')f.tables.get('hq_managers').push({...hq,id:'second-hq'});if(change==='hq-security-pin-revoked')hq.securityPin=' revoked ';if(change==='hq-pin-blocked')hq.pin=' BLOCKED ';if(change==='branch-inactive')target.status='Closed';if(change==='branch-duplicate')f.tables.get('branches').push({...target,id:'second-branch'});if(change==='known-device-revoked')f.tables.set('pos_devices',[{id:'fictional-device',deviceId:'DEV-FICTIONAL-WORKSPACE',status:'Revoked'}]);
 await assert.rejects(f.enter());assert.equal(f.writes.length,0);assert.equal(f.w.sessionUser,f.original.session);assert.equal(JSON.stringify([...f.values]),f.original.values);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');f.unchanged();
});

for(const change of ['primary-account','named-account','session','branch','device','cart','cached-cart-reference','handover','receiving'])test('late account or work changes abort before adopting the selected branch: '+change,async()=>{
 const gate=deferred(),f=fixture({token:()=>gate.promise}),pending=f.enter();
 if(change==='primary-account')f.primaryAuth.currentUser={uid:'other'};if(change==='named-account')f.ownerAuth.currentUser={...f.user};if(change==='session')f.w.sessionUser={...f.original.session};if(change==='branch')f.values.set('takodeal_device_branch','Other branch');if(change==='device')f.values.set('takodeal_device_id','OTHER-DEVICE');if(change==='cart')f.w.cart.push({name:'Kept order',qty:2});if(change==='cached-cart-reference')f.w.platformCarts.Grab=[];if(change==='handover')f.values.set('takodeal_cash_remittance_v4:fictional','original reference');if(change==='receiving')f.w.cashierDispatchReceiving=true;
 gate.resolve();await assert.rejects(pending,/changed/);assert.equal(f.writes.length,0);assert.equal(f.workspace.current(),null);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');
});

test('a timed-out authority check cannot adopt a branch after it completes late',async()=>{
 const gate=deferred(),f=fixture({token:()=>gate.promise,timeoutMs:5}),pending=f.enter();await assert.rejects(pending,/could not confirm/);assert.equal(f.writes.length,0);gate.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.workspace.current(),null);assert.equal(f.w.sessionUser,f.original.session);assert.equal(f.writes.length,0);f.unchanged();
});

test('initial null primary Auth may restore its retained user before the guarded final snapshot, without creating a sign-in',async()=>{
 const gate=deferred(),f=fixture();f.primaryAuth.currentUser=null;let ready=0;f.primaryAuth.authStateReady=async()=>{ready++;await gate.promise;f.primaryAuth.currentUser=f.original.primaryUser;};
 const pending=f.enter();assert.equal(ready,1);assert.equal(f.tokenCalls,0);assert.equal(f.writes.length,0);gate.resolve();const context=await pending;assert.doesNotThrow(context.assertCurrent);assert.equal(f.primaryAuth.currentUser,f.original.primaryUser);assert.equal(f.tokenCalls,1);f.unchanged();
});

for(const change of ['clear','replace'])test('a known primary account changing while Auth restores holds before Owner verification or branch writes: '+change,async()=>{
 const gate=deferred(),f=fixture();f.primaryAuth.authStateReady=()=>gate.promise;const pending=f.enter();f.primaryAuth.currentUser=change==='clear'?null:{uid:'fictional-other-account',isAnonymous:true};gate.resolve();await assert.rejects(pending,/changed/);assert.equal(f.tokenCalls,0);assert.equal(f.writes.length,0);assert.equal(f.w.sessionUser,f.original.session);assert.equal(f.workspace.current(),null);assert.equal(f.nodes.get('loginOverlay').style.display,'flex');
});

test('primary Auth readiness timeout never performs late Owner verification or preview writes',async()=>{
 const gate=deferred(),f=fixture({timeoutMs:5});f.primaryAuth.authStateReady=()=>gate.promise;const pending=f.enter();await assert.rejects(pending,/could not confirm/);gate.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.tokenCalls,0);assert.equal(f.writes.length,0);assert.equal(f.workspace.current(),null);assert.equal(f.w.sessionUser,f.original.session);f.unchanged();
});

test('established context loss throws rather than returning a fallback writer or anonymous permit',async()=>{
 for(const change of ['named','primary','session','branch','device']){const f=fixture(),context=await f.enter();if(change==='named')f.ownerAuth.currentUser=null;if(change==='primary')f.primaryAuth.currentUser={uid:'new'};if(change==='session')f.w.sessionUser={...f.w.sessionUser};if(change==='branch')f.values.set('takodeal_device_branch','Other branch');if(change==='device')f.values.set('takodeal_device_id','OTHER');assert.throws(context.assertCurrent,/changed/);assert.throws(()=>f.workspace.current(),/changed/);}
});

test('tools mode blocks new financial/staff callers while ordinary methods and paid queue sync retain exact identity',async()=>{
 const f=fixture(),calls=[],sync=()=>{calls.push('paid-sync');return f.w.offlineQueue;};for(const name of ['openCheckoutModal','submitFinalOrder','processCheckout','openShiftModal','openNewShift','openTimeClockModal','confirmPrepCart','voidTransaction','authorizeMealPin','toggleAuditMode','parkOrder'])f.w[name]=function(...args){calls.push([name,this,...args]);return args;};f.w.syncOfflineQueue=sync;f.workspace.installStaffActionGuards();
 assert.deepEqual(f.w.processCheckout('ordinary-paid-input'),['ordinary-paid-input']);calls.length=0;await f.enter();
 for(const name of ['openCheckoutModal','submitFinalOrder','processCheckout','openShiftModal','openNewShift','openTimeClockModal','confirmPrepCart','voidTransaction','authorizeMealPin','toggleAuditMode','parkOrder'])assert.equal(f.w[name]({new:'unpaid input'}),false,name);
 assert.deepEqual(calls,[]);assert.equal(f.w.syncOfflineQueue,sync);assert.equal(f.w.syncOfflineQueue(),f.original.queue);f.unchanged();
});

test('an active delivery prevents context exit; normal logout clears RAM only and retains both accounts and saved work',async()=>{
 const f=fixture(),context=await f.enter(),before=JSON.stringify([...f.values]);f.w.cashierDispatchReceiving=true;assert.equal(f.workspace.clear(),false);assert.equal(f.workspace.current().session,context.session);f.w.cashierDispatchReceiving=false;assert.equal(f.workspace.clear(),true);assert.equal(f.workspace.current(),null);assert.equal(f.w.sessionUser,null);assert.equal(JSON.stringify([...f.values]),before);assert.equal(f.ownerAuth.currentUser,f.user);assert.equal(f.workspace.isToolsMode(),false);f.unchanged();
});

for(const changed of ['owner','owner-role','branch','device'])test('stock action refresh and transaction authority each reject current source revocation: '+changed,async()=>{
 for(const at of ['before-action','inside-transaction']){const f=fixture();f.tables.set('pos_devices',[{id:'fictional-device',deviceId:'DEV-FICTIONAL-WORKSPACE',status:'Active'}]);const context=await f.enter();let permit;if(at==='inside-transaction')permit=await context.prepareAction();
  if(changed==='owner')f.tables.get('hq_managers')[0].securityPin=' BLOCKED ';if(changed==='owner-role')f.tables.get('hq_managers')[0].role='Staff';if(changed==='branch')f.tables.get('branches')[0].active=false;if(changed==='device')f.tables.get('pos_devices')[0].status='Revoked';
  if(at==='before-action')await assert.rejects(context.prepareAction(),/inactive|review/);else await assert.rejects(permit.checkTransaction({get:async ref=>{assert.equal(ref.db,f.ownerDb);const row=f.tables.get(ref.table).find(row=>row.id===ref.id);return{exists:()=>Boolean(row),data:()=>structuredClone(row)};}}),/inactive|review/);f.unchanged();
 }
});

test('stock action transaction reads only exact known authority docs with the named Owner database',async()=>{
 const f=fixture(),context=await f.enter(),permit=await context.prepareAction(),read=[];
 await permit.checkTransaction({get:async ref=>{assert.equal(ref.db,f.ownerDb);read.push(ref.table+'/'+ref.id);const row=f.tables.get(ref.table).find(row=>row.id===ref.id);return{exists:()=>Boolean(row),data:()=>structuredClone(row)};}});assert.deepEqual(read.sort(),['branches/fictional-branch','hq_managers/fictional-hq']);assert.equal(f.tokenCalls,2);f.unchanged();
});

function settingsDocument(f){
 const nodes=f.nodes;
 class Element{constructor(tag='div'){this.tagName=tag;this.style={};this.dataset={};this.children=[];this.classList={add(){},remove(){}};}set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}set innerHTML(value){this.markup=value;this.children=[];for(const match of value.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){const child=new Element(match[1]);for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){if(attr[1]==='id')child.id=attr[2];if(attr[1].startsWith('data-'))child.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attr[2];}this.children.push(child);}}get innerHTML(){return this.markup||'';}querySelectorAll(selector){const key=selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return key?this.children.filter(child=>key in child.dataset):this.children.filter(child=>selector.split(',').includes(child.tagName));}querySelector(){return null;}append(...children){this.children.push(...children);}setAttribute(){}}
 const content=new Element(),printer=new Element();printer.id='view-printer';for(const id of ['topBarTitle','nav-printer','globalShiftLockout','posSettingsDropdown','posSettingsButton']){const el=new Element();el.id=id;}
 return{createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='.content-area'?content:null,addEventListener(){}};
}

test('actual Settings permits verified Owner printer controls only, rechecks chooser identity and rejects a copied display session',async()=>{
 const f=fixture(),calls=[];for(const name of ['setPrinterMode','connectSpecificPrinter','toggleAuditMode','showParkedOrders','openPrinterManager'])f.w[name]=(...args)=>{calls.push([name,args]);return true;};f.w.switchView=()=>{};f.w.addEventListener=()=>{};
 const hub=installPOSSettingsHub(f.w,settingsDocument(f),{primaryAuth:f.primaryAuth});assert.equal(hub.refresh(),false);await f.enter();assert.equal(hub.refresh(),true);await f.w.setPrinterMode('rawbt');assert.equal(calls[0][0],'setPrinterMode');f.w.connectSpecificPrinter('receipt');const chooser=calls.at(-1)[1][1];assert.doesNotThrow(chooser.assertCurrent);assert.equal(await f.w.toggleAuditMode(),false);assert.equal(await f.w.showParkedOrders(),false);assert.equal(calls.length,2);
 f.w.sessionUser={...f.w.sessionUser};assert.throws(chooser.assertCurrent,/changed/);assert.equal(await f.w.setPrinterMode('rawbt'),false);assert.equal(calls.length,2);f.unchanged();
});

for(const mode of ['unregistered','revoked-tablet','stale-preview','registered'])test('portable verified Owner inspection needs no tablet setup and preserves physical data: '+mode,async()=>{
 const f=fixture();if(mode==='unregistered'){f.values.delete('takodeal_device_id');f.values.delete('takodeal_device_branch');}if(mode==='revoked-tablet')f.tables.set('pos_devices',[{id:'revoked',deviceId:'DEV-FICTIONAL-WORKSPACE',status:'Revoked'}]);if(mode==='stale-preview')f.values.set(OWNER_PREVIEW_KEY,'old preview preserved');const before=JSON.stringify([...f.values]);
 const context=await f.workspace.enter({auth:f.ownerAuth,db:f.ownerDb,user:f.user,branch:'Agdao',portable:true});assert.equal(context.branch,'Agdao');assert.equal(f.w.sessionUser.workspaceKind,CASHIER_OWNER_WORKSPACE);assert.equal(f.reads.some(q=>q.table==='pos_devices'),false);assert.equal(f.writes.length,0);assert.equal(JSON.stringify([...f.values]),before);assert.doesNotThrow(context.assertCurrent);f.unchanged();if(mode==='unregistered')await assert.rejects(context.prepareAction(),/Receiving deliveries requires/);if(mode==='revoked-tablet')await assert.rejects(context.prepareAction(),/inactive registration/);
});
test('portable Owner can switch branch with fresh authority and no storage writes; a rejected switch preserves the previous valid view',async()=>{
 const f=fixture(),enter=branch=>f.workspace.enter({auth:f.ownerAuth,db:f.ownerDb,user:f.user,branch,portable:true}),first=await enter('Agdao');f.tables.set('branches',[{id:'fictional-maa',name:'Maa',active:true}]);const second=await enter('Maa');assert.equal(second.branch,'Maa');assert.throws(first.assertCurrent,/changed/);f.tables.set('branches',[{id:'fictional-agdao',name:'Agdao',active:false}]);await assert.rejects(enter('Agdao'),/inactive/);assert.doesNotThrow(second.assertCurrent);assert.equal(f.w.sessionUser.branch,'Maa');assert.equal(f.writes.length,0);f.unchanged();
});
