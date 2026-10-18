import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {installPOSSettingsHub} from '../Takodeal-POS/pos-settings-hub.js';
import {createSaleEngine,safeId} from '../Takodeal-POS/pos-safety.js';

const branch='Sample Branch',name='Sample Cashier',staffId='sample-crew';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r\n','\n');
function segment(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from,'The actual runtime handler is available');return text.slice(from,to);}

// Minimal DOM for the actual hub installer. It records elements parsed from its
// real markup; session checks and callbacks remain production code.
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
    let time=1000,gate=null;const approvalUser={uid:'approved-hq',email:'manager@example.test',emailVerified:true};
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
    const install=()=>hub=installPOSSettingsHub(w,d,{primaryAuth,now:()=>time,timeoutMs});
    return {w,d,docs,profile,grant,primaryAuth,reads,calls,hardware,dialogs,storage,originals,install,get hub(){return hub;},setGate(value){gate=value;},setTime(value){time=value;},async refresh(){await hub.refresh();},switchBranch(){storage.set('takodeal_device_branch','Another Branch');w.sessionUser={...w.sessionUser,branch:'Another Branch'};}};
}

test('signed-in cashiers use routine settings directly without approval reads, another PIN or cart/auth changes',async()=>{
    const h=fixture();h.install();await h.w.showParkedOrders();await h.w.setPrinterMode('ble');await h.w.toggleAuditMode();await h.w.toggleKDS();await h.w.kickCashDrawer();await h.w.setAutoDrawer(false);
    assert.deepEqual(h.calls.map(row=>row.handler),['showParkedOrders','setPrinterMode','toggleAuditMode','toggleKDS','kickCashDrawer']);assert.equal(h.storage.get('takodeal_auto_drawer'),'false');assert.equal(h.reads.length,0);assert.equal(h.dialogs.length,0);
    assert.equal(h.w.cart,h.originals.cart);assert.equal(h.w.currentShift,h.originals.shift);assert.equal(h.w.sessionUser,h.originals.session);assert.equal(h.primaryAuth.currentUser,h.originals.user);
});

test('an existing PIN-only signed-in tablet needs no added device or HQ approval for routine tools',async()=>{
    const h=fixture({anonymous:false,legacy:true});h.docs.clear();h.install();await h.w.setPrinterMode('ble');await h.w.toggleAuditMode();await h.w.toggleKDS();await h.w.kickCashDrawer();
    assert.deepEqual(h.calls.map(row=>row.handler),['setPrinterMode','toggleAuditMode','toggleKDS','kickCashDrawer']);assert.equal(h.primaryAuth.currentUser,null);assert.equal(h.reads.length,0);assert.equal(h.dialogs.length,0);assert.equal(h.w.cart,h.originals.cart);
});

test('old saved policy and missing or revoked extra approval records cannot disable direct settings',async()=>{
    const h=fixture();h.docs.set('offline_policy/pos_settings_global',{posSettings:{staff:{parkedOrders:false,printerTools:false},manager:{audit:false,kds:false,manualDrawer:false,autoDrawer:false}}});h.docs.get('pos_bindings/primary-device').status='Revoked';h.docs.delete('pos_devices/legacy-device');h.grant.active=false;h.profile.active=false;h.install();
    await h.w.setPrinterMode('rawbt');await h.w.toggleAuditMode();await h.w.toggleKDS();await h.w.kickCashDrawer();assert.deepEqual(h.calls.map(row=>row.handler),['setPrinterMode','toggleAuditMode','toggleKDS','kickCashDrawer']);assert.equal(h.reads.length,0);assert.equal(h.dialogs.length,0);
});

test('freeform staff job titles use settings without creating cross-staff recovery authority',async()=>{
    for(const role of ['Kitchen Lead','Officer in Charge','Owner']){const h=fixture();h.w.sessionUser.role=role;h.docs.get('cashiers/'+staffId).role=role;h.install();await h.w.toggleKDS();await h.w.kickCashDrawer();assert.deepEqual(h.calls.map(row=>row.handler),['toggleKDS','kickCashDrawer']);const permit=await h.hub.authorize('parkedOrders');assert.notEqual(permit.manageRecovery,true);assert.equal(h.reads.length,0);}
});

test('a missing cashier session or a mismatched selected branch cannot dispatch tools or the chooser',async()=>{
    for(const change of ['logout','branch']){const h=fixture();h.install();if(change==='logout')h.w.sessionUser=null;else h.storage.set('takodeal_device_branch','Another Branch');await h.w.setPrinterMode('ble');await h.w.toggleAuditMode();await h.w.kickCashDrawer();assert.equal(h.w.connectSpecificPrinter('main'),false);assert.equal(h.calls.length,0);assert.equal(h.hardware.length,0);assert.equal(h.reads.length,0);assert.equal(h.w.cart,h.originals.cart);}
});

test('local settings work immediately offline and do not expire after a minute or ten minutes',async()=>{
    const h=fixture();h.setGate(()=>{throw Error('Synthetic offline server');});h.install();h.setTime(86400000);await h.w.setPrinterMode('ble');await h.w.setReceiptLogoMode('none');await h.w.toggleKDS();await h.w.kickCashDrawer();assert.equal(h.w.connectSpecificPrinter('main'),'chooser-dispatched');assert.equal(h.calls.length,4);assert.equal(h.reads.length,0);assert.equal(h.hardware.length,1);assert.equal(h.dialogs.length,0);
});

test('the first printer click preserves synchronous Bluetooth activation without a settings refresh',()=>{
    let inGesture=true,called=false,chooserGuard;
    const h=fixture();h.w.connectSpecificPrinter=(role,options)=>{assert.equal(inGesture,true);called=true;chooserGuard=options.assertCurrent;h.hardware.push(role);return 'chooser';};h.setGate(()=>{throw Error('No server should be needed for the chooser');});h.install();
    const result=h.w.connectSpecificPrinter('main');inGesture=false;assert.equal(called,true);assert.equal(result,'chooser');assert.equal(h.reads.length,0);h.setTime(86400000);assert.doesNotThrow(chooserGuard);
    h.w.sessionUser={...h.w.sessionUser};assert.throws(chooserGuard,/changed|sign.in|cashier|session/i);
});

test('a chooser result held across logout or a branch switch is rejected before it can save a connection',()=>{
    for(const change of ['logout','branch']){const h=fixture();let guard;h.w.connectSpecificPrinter=(_role,options)=>{guard=options.assertCurrent;return 'chooser';};h.install();assert.equal(h.w.connectSpecificPrinter('main'),'chooser');if(change==='logout')h.w.sessionUser=null;else h.switchBranch();assert.throws(guard,/changed|sign.in|cashier|session|branch/i);assert.equal(h.w.cart,h.originals.cart);}
});

test('a branch change during a held parked-order read cannot invoke the old callback',async()=>{
    const h=fixture();h.install();const gate=deferred(),entered=deferred();h.setGate(ref=>{if(ref.table==='parked_orders'){entered.resolve();return gate.promise;}});const work=h.w.printParkedReceipt('sample-order');await entered.promise;h.switchBranch();gate.resolve();await work;assert.equal(h.calls.length,0);assert.equal(h.w.cart,h.originals.cart);
});

test('a wrong-branch parked order remains inaccessible while local printer tools stay direct',async()=>{
    const h=fixture();h.docs.get('parked_orders/sample-order').branch='Another Branch';h.install();await h.w.resumeOrder('sample-order');await h.w.printParkedReceipt('sample-order');await h.w.deleteParkedOrder('sample-order');await h.w.setPrinterMode('ble');assert.deepEqual(h.calls.map(row=>row.handler),['setPrinterMode']);assert.ok(h.docs.has('parked_orders/sample-order'));assert.equal(h.w.cart,h.originals.cart);
});

test('sequential preference changes apply the most recent value without added access reads',async()=>{
    const h=fixture();h.install();await h.w.setReceiptLogoMode('raster');await h.w.setReceiptLogoMode('none');assert.deepEqual(h.calls.filter(row=>row.handler==='setReceiptLogoMode').map(row=>row.args),[['raster'],['none']]);assert.equal(h.reads.length,0);
});

test('a superseded preference call cannot apply after the newer selection in the same click sequence',async()=>{
    const h=fixture();h.install();const older=h.w.setReceiptLogoMode('raster'),newer=h.w.setReceiptLogoMode('none');await Promise.all([older,newer]);assert.deepEqual(h.calls.filter(row=>row.handler==='setReceiptLogoMode').map(row=>row.args),[['none']]);assert.equal(h.reads.length,0);
});

test('leave confirmation still reads the exact active staff identity without inferring a role or requiring a home-branch match',async()=>{
    const h=fixture({anonymous:false,legacy:true});h.docs.get('cashiers/'+staffId).branch='Home Branch';h.docs.get('cashiers/'+staffId).role='Kitchen Lead';h.install();const staff=await h.w.confirmPOSStaffSession();assert.deepEqual(staff,{staffId,name});assert.deepEqual(h.reads.map(row=>row.path),['cashiers/'+staffId]);assert.equal(h.primaryAuth.currentUser,null);assert.equal(h.w.sessionUser,h.originals.session);
    for(const update of [{active:false},{pin:'BLOCKED'},{pin:'REVOKED'},{cashierName:'Different Staff'},{status:'Archived'}]){const h=fixture();Object.assign(h.docs.get('cashiers/'+staffId),update);h.install();await assert.rejects(h.w.confirmPOSStaffSession(),/saved staff account|sign.in/i);}
});

test('a legacy name-only leave confirmation requires a unique saved identity',async()=>{
    const h=fixture();delete h.w.sessionUser.staffId;h.docs.set('cashiers/duplicate',{...h.docs.get('cashiers/'+staffId)});h.install();await assert.rejects(h.w.confirmPOSStaffSession(),/saved staff account|sign.in/i);assert.equal(h.reads.length,1);assert.equal(h.reads[0].table,'cashiers');assert.equal(h.reads[0].collection,true);
});

test('a saved leave-profile read held across a cashier switch cannot return another session identity',async()=>{
    const h=fixture(),gate=deferred(),entered=deferred();h.install();h.setGate(ref=>{if(ref.table==='cashiers'){entered.resolve();return gate.promise;}});const work=h.w.confirmPOSStaffSession();await entered.promise;h.w.sessionUser={...h.w.sessionUser,staffId:'another-staff',cashierName:'Another Staff'};gate.resolve();await assert.rejects(work,/changed|cashier|session/i);assert.equal(h.w.cart,h.originals.cart);assert.equal(h.primaryAuth.currentUser,h.originals.user);
});

test('automatic receipt drawer bytes keep their existing receipt pipeline',async()=>{
    const h=fixture();h.w.stringToBuffer=text=>Uint8Array.from(Buffer.from(text,'latin1'));h.w.concatBuffers=parts=>Uint8Array.from(parts.flatMap(part=>[...part]));h.w.lastTransactionData={cart:[{name:'Sample Item',qty:1,price:50,category:'Food'}],netTotal:50,amountReceived:50,paymentMethod:'Cash',receiptId:'SAMPLE-RECEIPT',cashierName:name,orderType:'Dine-In'};h.w.getDocs=async()=>({empty:true,docs:[]});
    vm.runInNewContext(segment(source('../Takodeal-POS/index.html'),'window.printReceipt = async function(type)','window.currentParkedOrdersList = []'),{window:h.w,localStorage:h.w.localStorage,document:h.d,Uint8Array,console});h.install();await h.w.printReceipt('receipt');assert.equal(h.hardware.length,1);assert.deepEqual(h.hardware[0].bytes.slice(3,8),[27,112,0,25,150]);assert.equal(h.calls.filter(row=>row.handler==='kickCashDrawer').length,0);assert.equal(h.primaryAuth.currentUser,h.originals.user);assert.equal(h.w.cart,h.originals.cart);
});

test('the actual manual drawer handler sends its exact bytes directly for the current cashier',async()=>{
    const h=fixture();vm.runInNewContext(segment(source('../Takodeal-POS/main.js'),'window.kickCashDrawer = function()', '// ========================================================\n// 📱 SIDEBAR'),{window:h.w,Uint8Array});h.install();await h.w.kickCashDrawer();assert.equal(h.hardware.length,1);assert.deepEqual(h.hardware[0].bytes,[27,64,27,112,0,25,150]);assert.deepEqual(h.hardware[0].options,[true,'main']);assert.equal(h.reads.length,0);
});

test('the actual settings page and Owner guide install no approval tab, account unlock or policy editor',()=>{
    const h=fixture();h.install();const view=h.d.getElementById('view-settings');assert.ok(view);assert.equal(view.querySelectorAll('[data-pos-tab]').some(node=>node.dataset.posTab==='access'),false);assert.equal(h.d.getElementById('posSettingsUnlock'),null);assert.equal(h.d.getElementById('posSettingsLock'),null);
    const host=h.d.createElement('div');host.id='posSettingsAccessHost';const w={sidebarTabNames:{'nav-printer':{name:'Old name'}},installPolicy(){throw Error('The old access editor must not be installed');},getDocFromServer(){throw Error('The guide must not read saved policy');},setDoc(){throw Error('The guide must not save policy');}};
    const script=source('../takodeal-manager/owner-pos-settings-access.js').split('const boot=')[0].replace('export function','function');const context={w,d:h.d};vm.runInNewContext(script+'\nresult=installOwnerPOSSettingsAccess(w,d);',context);assert.equal(context.result.directSettings,true);assert.equal(host.querySelectorAll('button,input,select').length,0);assert.match(host.innerHTML,/No extra Owner approval/);assert.equal(w.sidebarTabNames['nav-printer'].name,'POS Settings');
});

test('the actual audit handler checks its original permit again before a delayed transaction write',async()=>{
    const h=fixture(),gate=deferred(),entered=deferred(),writes=[];
    const api={...h.w,serverTimestamp:()=>({seconds:1}),runTransaction:async(_db,callback)=>{entered.resolve();await gate.promise;return callback({set:(reference,value)=>writes.push({reference,value})});}};
    const engine=createSaleEngine(api),context={w:h.w,ls:h.w.localStorage,engine,environment:{document:h.d},safeId,console,updateAuditButton(){}};
    vm.runInNewContext(segment(source('../Takodeal-POS/pos-checkout.js'),'w.toggleAuditMode = async function(', 'function updateAuditButton()'),context);
    h.install();const work=h.w.toggleAuditMode();await entered.promise;h.switchBranch();gate.resolve();await work;
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

test('a timed-out parked read never dispatches or piles up retries while local printer tools remain usable',async()=>{
    const h=fixture({timeoutMs:10}),gate=deferred();h.install();let parkedReads=0;h.setGate(ref=>{if(ref.table==='parked_orders'){parkedReads++;return gate.promise;}});
    await h.w.printParkedReceipt('sample-order');assert.equal(h.calls.length,0);await h.w.printParkedReceipt('sample-order');assert.equal(h.calls.length,0);assert.equal(parkedReads,1);assert.equal(h.w.connectSpecificPrinter('main'),'chooser-dispatched');await h.w.setPrinterMode('ble');assert.deepEqual(h.calls.map(row=>row.handler),['setPrinterMode']);
    gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.filter(row=>row.handler==='printParkedReceipt').length,0);h.setGate(null);await h.w.printParkedReceipt('sample-order');assert.equal(h.calls.filter(row=>row.handler==='printParkedReceipt').length,1);
});
