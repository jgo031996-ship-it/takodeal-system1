import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activePOSStaff} from '../Takodeal-POS/pos-settings-model.js';
import {installPOSSettingsHub} from '../Takodeal-POS/pos-settings-hub.js';
const branch='Sample Branch',name='Sample Crew',staffId='sample-staff';
function fixture(){
    const nodes=new Map();
    class Element{
        constructor(tag='div'){this.tagName=tag;this.style={};this.dataset={};this.children=[];this.classList={add(){},remove(){}};}
        set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
        set innerHTML(value){this.markup=value;this.children=[];for(const match of value.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){const child=new Element(match[1]);for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){if(attr[1]==='id')child.id=attr[2];if(attr[1].startsWith('data-'))child.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attr[2];}this.children.push(child);}}
        get innerHTML(){return this.markup||'';}
        querySelectorAll(selector){const key=selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return key?this.children.filter(child=>key in child.dataset):this.children.filter(child=>selector.split(',').includes(child.tagName));}
        querySelector(){return null;}append(...children){this.children.push(...children);}setAttribute(){}
    }
    const content=new Element(),printer=new Element();printer.id='view-printer';
    for(const id of ['topBarTitle','nav-printer','globalShiftLockout','posSettingsDropdown','posSettingsButton']){const node=new Element();node.id=id;}
    const d={createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='.content-area'?content:null,addEventListener(){}};
    const values=new Map([['takodeal_device_branch',branch],['takodeal_device_id','sample-desktop'],['takodeal_device_name','Main Office Desktop']]),calls=[],reads=[],dialogs=[],documents=new Map();
    const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),key:i=>[...values.keys()][i],get length(){return values.size;}};
    const primaryAuth={currentUser:null};
    const w={sessionUser:{staffId,cashierName:name,branch},localStorage:storage,cart:[{name:'Current cart',qty:1}],currentShift:{shiftId:'current-shift'},switchView(){},addEventListener(){},
        Swal:{fire:async(...args)=>{dialogs.push(args);}},db:{},doc:(_db,table,id)=>({path:table+'/'+id,id,table}),collection:(_db,table)=>({table}),where:(key,op,value)=>({key,op,value}),query:(reference,...filters)=>({...reference,filters}),
        getDocFromServer:async reference=>{reads.push(reference);return {id:reference.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>documents.has(reference.path),data:()=>documents.get(reference.path)};},
        getDocsFromServer:async reference=>{reads.push(reference);return {metadata:{fromCache:false,hasPendingWrites:false},docs:[...documents].filter(([path,row])=>path.startsWith(reference.table+'/')&&reference.filters.every(filter=>row[filter.key]===filter.value)).map(([path,row])=>({id:path.split('/').at(-1),data:()=>row}))};}
    };
    for(const handler of ['toggleAuditMode','toggleKDS','kickCashDrawer','parkOrder','parkOrderToDB','showParkedOrders','resumeOrder','printParkedReceipt','deleteParkedOrderManually','discardParkedOrder','deleteParkedOrder','openPrinterManager','setPrinterMode','setReceiptLogoMode','connectSpecificPrinter','testPrinterLogo','testPrint'])w[handler]=(...args)=>{calls.push({handler,args,inGesture:w.userGesture===true});return true;};
    const hub=installPOSSettingsHub(w,d,{primaryAuth,approveHQ(){throw Error('The removed approval flow must never run');},getApprovalAPI(){throw Error('No HQ permission reads');}});
    return {w,d,nodes,hub,values,calls,reads,dialogs,documents,primaryAuth};
}
test('routine Settings controls work directly for an existing PIN cashier without policy, device or HQ reads',async()=>{
    const f=fixture(),cart=f.w.cart,shift=f.w.currentShift,session=f.w.sessionUser;
    f.w.getDocFromServer=f.w.getDocsFromServer=async()=>{throw Error('Offline');};
    await f.w.toggleKDS();await f.w.setAutoDrawer(false);await f.w.kickCashDrawer();await f.w.setPrinterMode('rawbt');await f.w.setReceiptLogoMode('none');
    assert.deepEqual(f.calls.map(row=>row.handler),['toggleKDS','kickCashDrawer','setPrinterMode','setReceiptLogoMode']);assert.equal(f.values.get('takodeal_auto_drawer'),'false');
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.dialogs,[]);assert.equal(f.w.cart,cart);assert.equal(f.w.currentShift,shift);assert.equal(f.w.sessionUser,session);assert.equal(f.primaryAuth.currentUser,null);
});
test('Settings contains Operations and Printers without an Access tab or approval popup',()=>{
    const f=fixture(),markup=f.nodes.get('view-settings').innerHTML;assert.match(markup,/data-pos-tab="operations"/);assert.match(markup,/data-pos-tab="printers"/);assert.doesNotMatch(markup,/data-pos-tab="access"|Unlock|HQ PIN|Owner policy/);
    assert.equal(f.nodes.has('posSettingsUnlock'),false);assert.equal(f.hub.unlock,undefined);assert.equal(f.hub.lock,undefined);
    assert.equal(f.hub.refresh(),true);assert.equal(f.reads.length,0);
});
test('Bluetooth chooser retains the immediate click gesture without an access refresh or time expiry',()=>{
    const f=fixture();f.w.userGesture=true;f.w.connectSpecificPrinter('receipt');f.w.userGesture=false;assert.equal(f.calls.at(-1).handler,'connectSpecificPrinter');assert.equal(f.calls.at(-1).inGesture,true);assert.equal(f.reads.length,0);
    const permit=f.calls.at(-1).args[1];assert.equal(typeof permit.assertCurrent,'function');assert.doesNotThrow(permit.assertCurrent);
    f.w.sessionUser={...f.w.sessionUser,cashierName:'Other Crew'};assert.throws(permit.assertCurrent,/cashier or branch changed/);
});
test('a missing cashier or mismatched selected branch cannot dispatch direct local controls',async()=>{
    for(const change of [f=>f.w.sessionUser=null,f=>f.w.sessionUser.branch='Another Branch',f=>f.values.delete('takodeal_device_branch')]){
        const f=fixture();change(f);assert.equal(await f.w.setPrinterMode('rawbt'),false);assert.equal(f.w.connectSpecificPrinter('receipt'),false);assert.equal(f.calls.length,0);assert.equal(f.values.has('takodeal_auto_drawer'),false);assert.equal(f.reads.length,0);
    }
});
test('fresh leave identity accepts real saved job titles without treating them as HQ grants',async()=>{
    for(const role of ['Staff','Kitchen Lead','OIC','Co-Owner','Branch Supervisor']){
        const f=fixture();f.documents.set('cashiers/'+staffId,{cashierName:name,branch:'Saved Employee Branch',role,pin:'7281',status:'Active',staffId:'untrusted-saved-id'});
        assert.deepEqual(await f.w.confirmPOSStaffSession(),{staffId,name});assert.deepEqual(f.reads.map(row=>row.path),['cashiers/'+staffId]);assert.equal(f.w.sessionUser.branch,branch);assert.equal(f.dialogs.length,0);
    }
});
test('fresh leave identity still denies blocked credentials, inactive staff and changed document identity',async()=>{
    const base={staffId,cashierName:name,role:'Kitchen Lead',pin:'7281',active:true},session={staffId,cashierName:name};
    assert.ok(activePOSStaff(base,session));
    for(const change of [{pin:'BLOCKED'},{pin:''},{pin:'',securityPin:'REVOKED'},{active:false},{archived:true},{isArchived:true},{status:'terminated'},{status:'Suspended'},{staffId:'another'},{cashierName:'Another Name'}])assert.equal(activePOSStaff({...base,...change},session),null);
    const f=fixture();f.documents.set('cashiers/'+staffId,{...base,active:false});await assert.rejects(f.w.confirmPOSStaffSession(),/staff account changed/);
});
test('legacy leave identity requires a unique exact staff record and never reads access policy or registrations',async()=>{
    const f=fixture();delete f.w.sessionUser.staffId;f.documents.set('cashiers/legacy-one',{cashierName:name,pin:'7281',role:'OIC',branch:'Original Saved Branch'});
    assert.deepEqual(await f.w.confirmPOSStaffSession(),{staffId:'legacy-one',name});assert.equal(f.reads[0].table,'cashiers');
    f.documents.set('cashiers/legacy-two',{cashierName:name,pin:'5678',role:'Staff'});await assert.rejects(f.w.confirmPOSStaffSession(),/staff account changed/);
});
test('Settings routing and automatic receipt drawer bytes keep the existing pipeline',()=>{
    const html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8'),hub=readFileSync(new URL('../Takodeal-POS/pos-settings-hub.js',import.meta.url),'utf8'),main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    assert.match(html,/id="posSettingsButton" onclick="window\.openPOSSettings\(\)"/);assert.match(hub,/view\.id='view-settings'/);assert.equal((html.match(/kickCashDrawer\(/g)||[]).length,1);
    assert.match(main,/window\.kickCashDrawer = function\(\) \{[\s\S]*?new Uint8Array\(\[0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0x96\]\)/);assert.match(html,/localStorage\.getItem\('takodeal_auto_drawer'\) !== 'false'/);
    assert.doesNotMatch(hub,/approveHQ|getApprovalUser|getApprovalAPI|loadPolicy|pos_bindings|pos_devices|hq_email_access/);
});
