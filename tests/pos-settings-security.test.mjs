import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {installPOSSettingsHub} from '../Takodeal-POS/pos-settings-hub.js';
import {hqPOSAccess,canUsePOSSetting,posSettingsPolicy} from '../Takodeal-POS/pos-settings-model.js';
import {createSaleEngine,safeId} from '../Takodeal-POS/pos-safety.js';

const branch='Sample Branch',name='Sample Cashier',staffId='sample-crew';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r\n','\n');
function segment(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from,'The actual runtime handler is available');return text.slice(from,to);}

// Minimal DOM for the actual hub installer. It records elements parsed from its
// real markup; permission decisions and callbacks remain production code.
function documentFixture(){
    const elements=new Map(),all=[];
    class Node {
        constructor(tag='div'){this.tagName=tag.toUpperCase();this.style={};this.dataset={};this.children=[];this.attributes={};this.disabled=false;this.classList={add(){},remove(){}};all.push(this);}
        set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
        setAttribute(key,value){this.attributes[key]=value;}
        append(...nodes){this.children.push(...nodes);}
        set innerHTML(value){this.markup=value;this.children=[];for(const match of value.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){const child=new Node(match[1]);for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){if(attr[1]==='id')child.id=attr[2];else if(attr[1].startsWith('data-'))child.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attr[2];}this.children.push(child);}}
        get innerHTML(){return this.markup||'';}
        querySelectorAll(selector){const key=selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return key?this.children.filter(child=>key in child.dataset):this.children.filter(child=>selector.split(',').some(tag=>tag.toUpperCase()===child.tagName));}
        querySelector(){return null;}
    }
    const content=new Node(),printer=new Node();printer.id='view-printer';
    for(const id of ['topBarTitle','nav-printer','globalShiftLockout','posSettingsButton','posSettingsDropdown','mainOrderType']){const node=new Node();node.id=id;node.value='Dine-In';}
    return {elements,createElement:tag=>new Node(tag),getElementById:id=>elements.get(id)||null,querySelector:selector=>selector==='.content-area'?content:null,addEventListener(){}};
}

function fixture({anonymous=true,legacy=false,timeoutMs=25000}={}){
    const docs=new Map(),calls=[],reads=[],dialogs=[],hardware=[];
    const storage=new Map([['takodeal_device_branch',branch],['takodeal_device_id','sample-device'],['takodeal_device_name','Sample Tablet']]);
    const primaryAuth={currentUser:anonymous?{uid:'primary-device'}:null};
    let time=1000,approvalUser={uid:'approved-hq',email:'manager@example.test',emailVerified:true},gate=null;
    const profile={email:approvalUser.email,fullName:'Sample Manager',role:'Manager',permissions:['posconfig','audits'],assignedBranch:branch,pin:'6234',active:true};
    const grant={active:true,allowedBranches:[branch],permissions:['posconfig','audits']};
    docs.set('cashiers/'+staffId,{cashierName:name,branch,pin:'0420',role:'Staff',active:true});
    docs.set('hq_managers/sample-manager',profile);docs.set('hq_email_access/'+approvalUser.email,grant);
    if(!legacy)docs.set('pos_bindings/primary-device',{uid:'primary-device',deviceId:'sample-device',branch,status:'Active'});
    docs.set('pos_devices/legacy-device',{deviceId:'sample-device',branch,status:'Active'});
    docs.set('parked_orders/sample-order',{branch,cart:[{name:'Sample Item',qty:1,price:50}]});
    const snap=ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))});
    const api={db:{},doc:(_db,table,id)=>({path:table+'/'+id,id,table}),collection:(_db,table)=>({table}),where:(key,op,value)=>({key,op,value}),query:(base,...filters)=>({...base,filters})};
    async function read(ref,collection){reads.push({path:ref.path,table:ref.table,collection});if(gate)await gate(ref,collection);if(!collection)return snap(ref);const rows=[...docs.keys()].filter(path=>path.startsWith(ref.table+'/')&&(ref.filters||[]).every(filter=>docs.get(path)[filter.key]===filter.value));return {metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map(path=>snap({path,id:path.slice(ref.table.length+1)}))};}
    api.getDocFromServer=ref=>read(ref,false);api.getDocsFromServer=ref=>read(ref,true);
    const d=documentFixture(),w={...api,sessionUser:{staffId,cashierName:name,branch},cart:[{name:'Sample Cart',qty:1}],currentShift:{shiftId:'sample-shift',branch,active:true},crypto:webcrypto,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]||null,get length(){return storage.size;}},switchView(){},confirm:()=>true,addEventListener(){},
        Swal:{async fire(...args){dialogs.push(args);const options=args[0];if(options?.input==='password')return {isConfirmed:options.preConfirm('6234')===true};return {isConfirmed:false};},showValidationMessage(){}},
        connectSpecificPrinter(...args){hardware.push(args);return 'chooser-dispatched';},
        sendToBluetoothPrinter:async(bytes,...options)=>{hardware.push({bytes:[...bytes],options});return true;},
    };
    for(const handler of ['toggleAuditMode','toggleKDS','kickCashDrawer','showParkedOrders','resumeOrder','printParkedReceipt','deleteParkedOrderManually','discardParkedOrder','deleteParkedOrder','openPrinterManager','setPrinterMode','setReceiptLogoMode','testPrint','testPrinterLogo'])w[handler]=(...args)=>{calls.push({handler,args});return true;};
    const originals={cart:w.cart,shift:w.currentShift,session:w.sessionUser,user:primaryAuth.currentUser};
    let hub;
    const install=()=>hub=installPOSSettingsHub(w,d,{primaryAuth,approveHQ:async()=>{},getApprovalUser:()=>approvalUser,getApprovalAPI:()=>api,now:()=>time,timeoutMs});
    return {w,d,docs,profile,grant,primaryAuth,reads,calls,hardware,dialogs,storage,originals,install,get hub(){return hub;},setGate(value){gate=value;},setTime(value){time=value;},setHQ(value){approvalUser=value;},async unlock(){await hub.unlock();},async refresh(){await hub.refresh();},switchBranch(){storage.set('takodeal_device_branch','Another Branch');w.sessionUser={...w.sessionUser,branch:'Another Branch'};}};
}

test('a revoked protected grant cannot retain sensitive access through an allowed HQ profile',()=>{
    const user={uid:'hq',email:'manager@example.test',emailVerified:true},profile={email:user.email,role:'Manager',permissions:['all'],assignedBranch:branch,pin:'6234'};
    for(const permissions of [undefined,[],['history']]){const hq=hqPOSAccess(user,profile,{active:true,allowedBranches:[branch],...(permissions?{permissions}:{})},branch);for(const action of ['audit','kds','manualDrawer','autoDrawer'])assert.equal(canUsePOSSetting(action,{hq}),false);}
    const hq=hqPOSAccess(user,{...profile,permissions:['posconfig']},{active:true,allowedBranches:[branch],permissions:['all']},branch);assert.equal(canUsePOSSetting('kds',{hq}),true);assert.equal(canUsePOSSetting('audit',{hq}),false);
});

test('an existing PIN-only approved tablet keeps basic tools without gaining HQ or touching its cart/auth',async()=>{
    const h=fixture({anonymous:false,legacy:true});h.install();await h.refresh();await h.w.showParkedOrders();await h.w.setPrinterMode('ble');await h.w.toggleAuditMode();await h.w.toggleKDS();await h.w.kickCashDrawer();
    assert.deepEqual(h.calls.map(row=>row.handler),['showParkedOrders','setPrinterMode']);assert.equal(h.primaryAuth.currentUser,null);assert.equal(h.w.cart,h.originals.cart);assert.equal(h.w.currentShift,h.originals.shift);assert.equal(h.w.sessionUser,h.originals.session);assert.ok(h.reads.every(row=>row.table!=='hq_managers'&&row.table!=='hq_email_access'));
});

test('a revoked UID binding cannot fall back to an otherwise active legacy device record',async()=>{
    const h=fixture();h.docs.get('pos_bindings/primary-device').status='Revoked';h.install();await h.refresh();await h.w.showParkedOrders();await h.w.connectSpecificPrinter('main');assert.equal(h.calls.length,0);assert.equal(h.hardware.length,0);assert.equal(h.primaryAuth.currentUser,h.originals.user);
});

test('direct operational callbacks require the protected grant each time after HQ unlock',async()=>{
    const h=fixture();h.install();await h.unlock();await h.w.toggleKDS();assert.equal(h.calls.filter(row=>row.handler==='toggleKDS').length,1);
    h.docs.get('hq_email_access/manager@example.test').permissions=[];for(const method of ['toggleKDS','toggleAuditMode','kickCashDrawer','setAutoDrawer'])await h.w[method](false);
    assert.equal(h.calls.length,1);assert.equal(h.storage.has('takodeal_auto_drawer'),false);assert.equal(h.w.cart,h.originals.cart);assert.equal(h.primaryAuth.currentUser,h.originals.user);
});

test('PIN, role, status and Google account changes invalidate a previously unlocked HQ approval',async()=>{
    for(const change of [{pin:'8246'},{pin:'',securityPin:'BLOCKED'},{status:'Blocked'},{active:false},{role:'Staff'},{archived:true},'account']){
        const h=fixture();h.install();await h.unlock();if(change==='account')h.setHQ({uid:'another-hq',email:'other@example.test',emailVerified:true});else Object.assign(h.docs.get('hq_managers/sample-manager'),change);
        await h.w.toggleAuditMode();await h.w.kickCashDrawer();assert.equal(h.calls.length,0,JSON.stringify(change));assert.equal(h.hardware.length,0);assert.equal(h.w.cart,h.originals.cart);assert.equal(h.primaryAuth.currentUser,h.originals.user);
    }
});

test('expired HQ approval blocks direct drawer and audit calls while staff tools stay available',async()=>{
    const h=fixture();h.install();await h.unlock();h.setTime(601001);await h.w.toggleAuditMode();await h.w.kickCashDrawer();await h.w.showParkedOrders();assert.deepEqual(h.calls.map(row=>row.handler),['showParkedOrders']);assert.equal(h.hardware.length,0);
});

test('a branch switch during a held fresh grant read cannot invoke the old operational callback',async()=>{
    const h=fixture();h.install();await h.unlock();const gate=deferred(),entered=deferred();h.setGate((ref)=>{if(ref.table==='hq_email_access'){entered.resolve();return gate.promise;}});const work=h.w.toggleKDS();await entered.promise;h.switchBranch();gate.resolve();await work;assert.equal(h.calls.length,0);assert.equal(h.storage.has('takodeal_auto_drawer'),false);
});

test('only the newest preference selection is applied while access reads are still pending',async()=>{
    const h=fixture();h.install();await h.refresh();const first=deferred(),entered=deferred();let held=false;h.setGate(ref=>{if(ref.table==='offline_policy'&&!held){held=true;entered.resolve();return first.promise;}});
    const older=h.w.setReceiptLogoMode('raster');await entered.promise;const newer=h.w.setReceiptLogoMode('none');first.resolve();await Promise.all([older,newer]);assert.deepEqual(h.calls.filter(row=>row.handler==='setReceiptLogoMode').map(row=>row.args),[['none']]);
});

test('confirmed printer access preserves the synchronous Bluetooth click gesture and performs no new read',async()=>{
    let inGesture=true,called=false;
    const g=fixture();g.w.connectSpecificPrinter=role=>{assert.equal(inGesture,true);called=true;g.hardware.push(role);return 'chooser';};g.install();await g.refresh();const reads=g.reads.length;
    const result=g.w.connectSpecificPrinter('main');inGesture=false;assert.equal(called,true);assert.equal(result,'chooser');assert.equal(g.reads.length,reads);
});

test('expired printer confirmation and a changed branch refuse chooser dispatch',async()=>{
    for(const change of ['expiry','branch','device']){const h=fixture();h.install();await h.refresh();if(change==='expiry')h.setTime(61001);else if(change==='device')h.storage.set('takodeal_device_id','another-device');else h.switchBranch();assert.equal(h.w.connectSpecificPrinter('main'),false);assert.equal(h.hardware.length,0);}
});

test('automatic receipt drawer bytes remain independent of the blocked manual-drawer callback',async()=>{
    const h=fixture();h.w.stringToBuffer=text=>Uint8Array.from(Buffer.from(text,'latin1'));h.w.concatBuffers=parts=>Uint8Array.from(parts.flatMap(part=>[...part]));h.w.lastTransactionData={cart:[{name:'Sample Item',qty:1,price:50,category:'Food'}],netTotal:50,amountReceived:50,paymentMethod:'Cash',receiptId:'SAMPLE-RECEIPT',cashierName:name,orderType:'Dine-In'};h.w.getDocs=async()=>({empty:true,docs:[]});
    vm.runInNewContext(segment(source('../Takodeal-POS/index.html'),'window.printReceipt = async function(type)','window.currentParkedOrdersList = []'),{window:h.w,localStorage:h.w.localStorage,document:h.d,Uint8Array,console});h.install();await h.w.kickCashDrawer();assert.equal(h.calls.length,0);
    await h.w.printReceipt('receipt');assert.equal(h.hardware.length,1);assert.deepEqual(h.hardware[0].bytes.slice(3,8),[27,112,0,25,150]);assert.equal(h.primaryAuth.currentUser,h.originals.user);assert.equal(h.w.cart,h.originals.cart);
});

test('the actual manual drawer handler sends its exact bytes only after authorized dispatch',async()=>{
    const h=fixture();vm.runInNewContext(segment(source('../Takodeal-POS/main.js'),'window.kickCashDrawer = function()', '// ========================================================\n// 📱 SIDEBAR'),{window:h.w,Uint8Array});h.install();await h.w.kickCashDrawer();assert.equal(h.hardware.length,0);await h.unlock();await h.w.kickCashDrawer();assert.equal(h.hardware.length,1);assert.deepEqual(h.hardware[0].bytes,[27,64,27,112,0,25,150]);assert.deepEqual(h.hardware[0].options,[true,'main']);
});

test('blocked staff credentials and inactive profiles cannot use the basic-tool compatibility path',async()=>{
    for(const change of [{pin:'BLOCKED'},{pin:'',securityPin:'BLOCKED'},{pin:'REVOKED'},{status:'Blocked'},{archived:true},{role:'Owner'},{active:false}]){
        const h=fixture({anonymous:false,legacy:true});Object.assign(h.docs.get('cashiers/'+staffId),change);h.install();await h.refresh();await h.w.showParkedOrders();assert.equal(h.calls.length,0,JSON.stringify(change));assert.equal(h.primaryAuth.currentUser,null);
    }
});

test('the actual audit handler checks its original permit again before a delayed transaction write',async()=>{
    const h=fixture(),gate=deferred(),entered=deferred(),writes=[];
    const api={...h.w,serverTimestamp:()=>({seconds:1}),runTransaction:async(_db,callback)=>{entered.resolve();await gate.promise;return callback({set:(reference,value)=>writes.push({reference,value})});}};
    const engine=createSaleEngine(api),context={w:h.w,ls:h.w.localStorage,engine,environment:{document:h.d},safeId,console,updateAuditButton(){}};
    vm.runInNewContext(segment(source('../Takodeal-POS/pos-checkout.js'),'w.toggleAuditMode = async function(', 'function updateAuditButton()'),context);
    h.install();await h.unlock();const work=h.w.toggleAuditMode();await entered.promise;h.switchBranch();gate.resolve();await work;
    assert.equal(writes.length,0);assert.equal(h.storage.has('takodeal_audit_mode'),false);assert.equal(h.w.isAuditModeActive,undefined);assert.equal(h.w.isTogglingAudit,false);
});

test('the actual parked deletion transaction refuses a staff switch after its parked-order read',async()=>{
    const h=fixture(),gate=deferred(),entered=deferred(),writes=[];
    const api={...h.w,serverTimestamp:()=>({seconds:1}),runTransaction:async(_db,callback)=>callback({get:async reference=>{entered.resolve();await gate.promise;return {exists:()=>true,data:()=>structuredClone(h.docs.get(reference.path))};},set:(reference,value)=>writes.push({reference,value}),delete:reference=>writes.push({reference,deleted:true})})};
    const engine=createSaleEngine(api),context={w:h.w,engine};vm.runInNewContext(segment(source('../Takodeal-POS/pos-checkout.js'),'w.discardParkedOrder =', 'w.processAuditQueue ='),context);
    h.install();await h.refresh();const work=h.w.discardParkedOrder('sample-order',name,branch,'sample-shift');await entered.promise;h.w.sessionUser={...h.w.sessionUser,staffId:'another-staff',cashierName:'Another Cashier'};gate.resolve();await work;assert.equal(writes.length,0);assert.ok(h.docs.has('parked_orders/sample-order'));
});

test('the actual parked confirmation cannot replace the cart after its branch changes',async()=>{
    const h=fixture();h.w.currentParkedOrdersList=[{id:'sample-order',branch,items:[{name:'Sample Parked Item',qty:1}],orderType:'Dine-In'}];h.w.updateParkedBadge=()=>{};
    const context={window:h.w,cart:h.w.cart,document:h.d,localStorage:h.w.localStorage,confirm:()=>{h.switchBranch();return true;},renderCart(){throw Error('A stale confirmation must not render a replacement cart');},closeModal(){},Swal:h.w.Swal};
    vm.runInNewContext(segment(source('../Takodeal-POS/index.html'),'window.resumeOrder = async function(', 'window.isDeletingParkedOrder ='),context);h.install();await h.refresh();await h.w.resumeOrder('sample-order');assert.equal(context.cart,h.originals.cart);assert.equal(h.w.isResumedParkedOrder,undefined);assert.ok(h.docs.has('parked_orders/sample-order'));
});

function installActualResume(h,{confirm=()=>true,deleteDoc=async reference=>{h.docs.delete(reference.path);}}={}){
    h.w.currentParkedOrdersList=[{id:'sample-order',branch,items:[{name:'Old Listed Item',qty:1}],orderType:'Dine-In'}];h.w.updateParkedBadge=()=>{};
    const runTransaction=async(_db,callback)=>{const staged=[];const result=await callback({get:async reference=>({exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.docs.get(reference.path))}),delete:reference=>staged.push(reference)});for(const reference of staged)await deleteDoc(reference);return result;};
    const context={window:h.w,document:h.d,localStorage:h.w.localStorage,confirm,renderCart(){},closeModal(){},Swal:h.w.Swal,db:h.w.db,doc:h.w.doc,deleteDoc,runTransaction,console};
    Object.defineProperty(context,'cart',{get:()=>h.w.cart,set:value=>{h.w.cart=value;},configurable:true});
    vm.runInNewContext(segment(source('../Takodeal-POS/main.js'),'window.deleteParkedOrder = async function', '// --- VOID & DETAILS ENGINE'),context);
    vm.runInNewContext(segment(source('../Takodeal-POS/index.html'),'window.resumeOrder = async function(', 'window.isDeletingParkedOrder ='),context);
    h.install();return context;
}

test('a committed parked deletion followed by a session switch retains scoped recovery and leaves the other cart untouched',async()=>{
    const h=fixture(),gate=deferred(),dispatched=deferred();installActualResume(h,{deleteDoc:async reference=>{dispatched.resolve();await gate.promise;h.docs.delete(reference.path);}});await h.refresh();const work=h.w.resumeOrder('sample-order');await dispatched.promise;
    h.switchBranch();const otherCart=[{name:'Different Branch Cart',qty:2}];h.w.cart=otherCart;gate.resolve();await work;
    assert.equal(h.docs.has('parked_orders/sample-order'),false);assert.equal(h.w.cart,otherCart);assert.equal(h.w.parkedRecovery.activeId(),null);
    const store=h.w.parkedRecovery.store,originalScope={deviceId:'sample-device',branch,staffId,staffName:name};const retained=store.list(originalScope);assert.equal(retained.length,1);assert.equal(retained[0].order.cart[0].name,'Sample Item');assert.equal(store.list(h.w.parkedRecovery.scope()).length,0);assert.equal(store.list({...originalScope,staffId:'another-staff',staffName:'Another Cashier'}).length,0);
    h.storage.set('takodeal_device_branch',branch);h.w.sessionUser=h.originals.session;h.w.cart=[];assert.equal(await h.w.recoverParkedOrder(retained[0].id),true);assert.equal(h.w.cart[0].name,'Sample Item');assert.equal(h.w.parkedRecovery.activeId(),retained[0].id);
});

test('a lost parked-delete acknowledgement retains the order for review without resurrecting an unconfirmed transfer',async()=>{
    const h=fixture();installActualResume(h,{deleteDoc:async reference=>{h.docs.delete(reference.path);throw Error('Synthetic acknowledgement lost after commit');}});await h.refresh();await h.w.resumeOrder('sample-order');
    assert.equal(h.docs.has('parked_orders/sample-order'),false);assert.equal(h.w.cart,h.originals.cart);const retained=h.w.parkedRecovery.store.list(h.w.parkedRecovery.scope());assert.equal(retained.length,1);assert.notEqual(retained[0].deletionConfirmed,true);
    h.w.cart=[];assert.equal(await h.w.recoverParkedOrder(retained[0].id),false);assert.deepEqual(h.w.cart,[]);assert.equal(h.w.parkedRecovery.activeId(),null);assert.ok(h.w.parkedRecovery.store.get(retained[0].id));assert.match(JSON.stringify(h.dialogs.at(-1)),/not.confirmed|review|transfer/i);
});

test('storage refusal stops actual resume before deleting the cloud parked order or replacing the cart',async()=>{
    const h=fixture();let deletes=0;installActualResume(h,{deleteDoc:async()=>{deletes++;}});const set=h.w.localStorage.setItem;h.w.localStorage.setItem=(key,value)=>{if(key.startsWith('takodeal_parked_resume_v1:'))throw Error('Storage full');return set(key,value);};await h.refresh();await h.w.resumeOrder('sample-order');assert.equal(deletes,0);assert.equal(h.w.cart,h.originals.cart);assert.ok(h.docs.has('parked_orders/sample-order'));assert.equal(h.w.isResumedParkedOrder,undefined);
});

test('actual resume uses the confirmed server payload rather than an old displayed parked row',async()=>{
    const h=fixture();installActualResume(h);await h.refresh();await h.w.resumeOrder('sample-order');assert.deepEqual(h.w.cart,[{name:'Sample Item',qty:1,price:50}]);assert.equal(h.w.parkedRecovery.store.list(h.w.parkedRecovery.scope()).length,1);assert.equal(h.docs.has('parked_orders/sample-order'),false);
});

test('a linked checkout retry cannot silently overwrite changed amount, split details or discount reason with its earlier payload',async()=>{
    for(const change of [{amountReceived:100},{splitDetails:[{method:'GCash',amount:25},{method:'Cash',amount:25}]},{globalDiscountReason:'Changed reason'}]){
        const h=fixture();h.install();await h.refresh();const permit=await h.hub.authorize('parkedOrders'),recovery=h.w.parkedRecovery.capture({...h.docs.get('parked_orders/sample-order'),id:'sample-order'},permit);h.w.parkedRecovery.activate(recovery.id,permit);h.w.saleOutbox={list:async()=>[]};
        const prior={resumeRecoveryId:recovery.id,branch,cart:structuredClone(h.w.cart),netTotal:50,paymentMethod:'Cash',customerName:'Sample Customer',amountReceived:50,splitDetails:[],globalDiscountReason:'First reason',saleId:'sample-sale',receiptId:'SAMPLE-RECEIPT'};h.w.parkedRecovery.linkCheckout(prior);const retry={...structuredClone(prior),...change};
        await assert.rejects(h.w.parkedRecovery.prepareCheckout(retry),/earlier|different|changed|saved checkout/i);assert.equal(retry.amountReceived,change.amountReceived||prior.amountReceived);assert.ok(h.w.parkedRecovery.store.get(recovery.id));
    }
});

test('a timed-out access read never dispatches a preference or piles up retries before its physical read settles',async()=>{
    const h=fixture({timeoutMs:10}),gate=deferred();h.install();let policyReads=0;h.setGate(ref=>{if(ref.table==='offline_policy'){policyReads++;return gate.promise;}});
    await h.w.setPrinterMode('ble');assert.equal(h.calls.length,0);await h.w.setPrinterMode('rawbt');assert.equal(h.calls.length,0);assert.equal(policyReads,1);
    gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,0);h.setGate(null);await h.w.setPrinterMode('ble');assert.deepEqual(h.calls.map(row=>row.handler),['setPrinterMode']);
});
