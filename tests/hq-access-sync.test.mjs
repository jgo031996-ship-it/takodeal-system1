import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {protectedSavedAccess,readHQAccessState,planHQAccessChange,saveHQAccessChange,installHQAccessSync,accessOperation} from '../takodeal-manager/hq-access-sync.js';
import {installWorkspaceAccess} from '../takodeal-manager/workspace-access.js';
import {installHQProfile} from '../takodeal-manager/hq-profile.js';
import {resolveHQAccount} from '../takodeal-manager/hq-account-model.js';
import vm from 'node:vm';
import {accountRecord,groupAccounts,filterAccounts} from '../takodeal-manager/access-workspace-model.js';
const owner={uid:'owner-uid',email:'jgo031996@gmail.com',emailVerified:true};
const account={email:'co@example.test',role:'Co-Owner',assignedBranch:'Maa',permissions:['feed'],pin:'1234',profileUpdatedAt:{seconds:20},permissionsUpdatedAt:{seconds:10}};
const copy=value=>structuredClone(value);
function fixture(initial={'hq_managers/a':account}) {
    let records=new Map(Object.entries(initial).map(([key,value])=>[key,copy(value)])),writes=0,transactions=0,lose=false,readHook,transactionHook;
    const snapshot=(ref,map=records)=>({id:ref.path.split('/').at(-1),exists:()=>map.has(ref.path),data:()=>copy(map.get(ref.path))});
    const api={db:{},auth:{currentUser:copy(owner)},sessionUser:{...owner,permissions:['all'],allowedBranches:['All']},
        doc:(_db,...parts)=>({path:parts.join('/')}),collection:(_db,path)=>({path}),serverTimestamp:()=>({seconds:1000+transactions,nanoseconds:0}),
        getDocsFromServer:async ref=>{if(readHook)await readHook(ref);return {docs:[...records].filter(([path])=>path.startsWith(ref.path+'/') && path.split('/').length===2).map(([path])=>snapshot({path})),empty:false};},
        getDocFromServer:async ref=>{if(readHook)await readHook(ref);return snapshot(ref);},
        runTransaction:async(_db,fn)=>{transactions++;if(transactionHook)await transactionHook();const next=new Map([...records].map(([key,value])=>[key,copy(value)]));let beganWriting=false,count=0;
            const tx={get:async ref=>{assert.equal(beganWriting,false,'all transaction reads precede writes');return snapshot(ref,next);},
                set:(ref,data,options)=>{beganWriting=true;count++;next.set(ref.path,options?.merge?{...next.get(ref.path),...copy(data)}:copy(data));},
                update:(ref,patch)=>{assert.ok(next.has(ref.path));beganWriting=true;count++;next.set(ref.path,{...next.get(ref.path),...copy(patch)});},
                delete:ref=>{beganWriting=true;count++;next.delete(ref.path);}};
            const result=await fn(tx);records=next;writes+=count;if(lose){lose=false;throw Error('Acknowledgement lost');}return result;},
        ManagerUI:{notify(){},confirm:async()=>true},loadAdminDashboard:async()=>{},Swal:{isLoading:()=>false,showValidationMessage(){},fire:async()=>({isConfirmed:false})}};
    return {api,get:path=>copy(records.get(path)),put:(path,data)=>records.set(path,copy(data)),writes:()=>writes,transactions:()=>transactions,loseNextAck:()=>lose=true,onRead:hook=>readHook=hook,onTransaction:hook=>transactionHook=hook};
}
async function planned(h,intent) {const state=await readHQAccessState(h.api,{id:intent.id,email:intent.profile?.email,newEmail:intent.patch?.email});return {...planHQAccessChange(state,intent),actor:state.actor};}
const save=(h,plan,id='operation-1')=>saveHQAccessChange(h.api,plan,{operationId:id});
test('canonical profile scope and independent latest permissions are preserved without role or all-tab scope elevation',()=>{
    const rows=[{id:'a',data:{...account,permissions:['all'],profileUpdatedAt:{seconds:40},permissionsUpdatedAt:{seconds:1}}},{id:'b',data:{...account,role:'Manager',assignedBranch:'All',permissions:[' PAYROLL ','payroll'],profileUpdatedAt:{seconds:2},permissionsUpdatedAt:{seconds:30}}}];
    assert.deepEqual(protectedSavedAccess(rows),{active:true,allowedBranches:['Maa'],permissions:['payroll']});
    assert.deepEqual(protectedSavedAccess([{id:'a',data:{...account,permissions:['all']}}]).allowedBranches,['Maa']);
    assert.deepEqual(protectedSavedAccess([{id:'a',data:{...account,permissions:['ledger']}}]).permissions,['ledger']);
    assert.throws(()=>protectedSavedAccess([{id:'a',data:{...account,assignedBranch:''}}]),/explicit permitted branches/);
});
test('permission save atomically synchronizes mixed-case duplicates and protected bridge while preserving balances and unrelated bridge fields',async()=>{
    const h=fixture({'hq_managers/a':{...account,email:' Co@Example.Test ',balance:99},'hq_managers/b':{...account,permissions:['all'],profileUpdatedAt:{seconds:1}},'hq_email_access/co@example.test':{active:true,permissions:['all'],allowedBranches:['All'],monitorNote:'keep'}});
    const plan=await planned(h,{type:'update',id:'a',patch:{permissions:[' PAYROLL ','payroll']}});await save(h,plan);
    for(const id of ['a','b']){assert.deepEqual(h.get('hq_managers/'+id).permissions,['payroll']);assert.equal(h.get('hq_managers/'+id).email,'co@example.test');}
    const bridge=h.get('hq_email_access/co@example.test');assert.equal(bridge.active,true);assert.deepEqual(bridge.permissions,['payroll']);assert.deepEqual(bridge.allowedBranches,['Maa']);assert.equal(bridge.monitorNote,'keep');assert.equal(bridge.updatedByUid,owner.uid);assert.equal(bridge.accessVersion,1);assert.equal(bridge.pin,undefined);assert.equal(bridge.balance,undefined);assert.equal(h.get('hq_managers/a').balance,99);
});
test('one-time sync uses canonical saved duplicate authority instead of the selected older record',async()=>{
    const h=fixture({'hq_managers/a':{...account,permissions:['all'],permissionsUpdatedAt:{seconds:1},assignedBranch:'All',profileUpdatedAt:{seconds:1}},'hq_managers/b':{...account,permissionsUpdatedAt:{seconds:50}}});
    await save(h,await planned(h,{type:'sync',id:'a'}));assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,['feed']);assert.deepEqual(h.get('hq_email_access/co@example.test').allowedBranches,['Maa']);
    for(const id of ['a','b']){assert.equal(h.get('hq_managers/'+id).assignedBranch,'Maa');assert.deepEqual(h.get('hq_managers/'+id).permissions,['feed']);}
});
test('branch and role changes retain explicit tab permissions; invalid Franchise All transition cannot partially save',async()=>{
    const h=fixture(),state=await readHQAccessState(h.api,{id:'a'});assert.throws(()=>planHQAccessChange(state,{type:'update',id:'a',patch:{role:'Franchisee',assignedBranch:'All'}}),/Franchise/);assert.equal(h.writes(),0);
    await save(h,await planned(h,{type:'update',id:'a',patch:{role:'Franchisee',assignedBranch:['Cabantian']}}));assert.equal(h.get('hq_managers/a').role,'Franchisee');assert.deepEqual(h.get('hq_email_access/co@example.test').allowedBranches,['Cabantian']);assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,['feed']);
});
test('disable remains possible with conflicting duplicate PINs and closes protected authority atomically',async()=>{
    const h=fixture({'hq_managers/a':account,'hq_managers/b':{...account,pin:'5678'},'hq_email_access/co@example.test':{active:true,permissions:['all'],allowedBranches:['All']}});
    await save(h,await planned(h,{type:'update',id:'a',patch:{active:false,blocked:true,status:'Inactive'}}));assert.equal(h.get('hq_managers/a').active,false);assert.equal(h.get('hq_managers/b').active,false);assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,[]);assert.equal(h.get('hq_email_access/co@example.test').active,false);
});
test('single-account revocation deletes only the chosen HQ record and closes its bridge; duplicate deletion is held',async()=>{
    const h=fixture({'hq_managers/a':account,'cashiers/staff':{hourlyRate:500},'hq_email_access/co@example.test':{active:true,permissions:['all'],allowedBranches:['All']}});
    await save(h,await planned(h,{type:'revoke',id:'a'}));assert.equal(h.get('hq_managers/a'),undefined);assert.equal(h.get('hq_email_access/co@example.test').active,false);assert.deepEqual(h.get('cashiers/staff'),{hourlyRate:500});
    const duplicate=fixture({'hq_managers/a':account,'hq_managers/b':account});await assert.rejects(planned(duplicate,{type:'revoke',id:'a'}),/multiple records/);assert.equal(duplicate.writes(),0);
});
test('email reassignment revokes the old bridge and creates only explicitly saved authority at the new email',async()=>{
    const h=fixture({'hq_managers/a':account,'hq_email_access/co@example.test':{active:true,permissions:['all'],allowedBranches:['All']}});
    await save(h,await planned(h,{type:'update',id:'a',patch:{email:' Next@Example.Test '}}));assert.equal(h.get('hq_managers/a').email,'next@example.test');assert.equal(h.get('hq_email_access/co@example.test').active,false);assert.deepEqual(h.get('hq_email_access/next@example.test').permissions,['feed']);
    const collision=fixture({'hq_managers/a':account,'hq_managers/b':{...account,email:'next@example.test'}});await assert.rejects(planned(collision,{type:'update',id:'a',patch:{email:'next@example.test'}}),/already has access/);assert.equal(collision.writes(),0);
});
test('fresh verified Owner UID is required before reads and after identity changes during reads or transactions',async()=>{
    for(const actor of [{...owner,emailVerified:false},{...owner,uid:''},{...owner,email:'co@example.test'}]){const h=fixture();h.api.auth.currentUser=actor;await assert.rejects(readHQAccessState(h.api,{id:'a'}),/verified main Owner/);assert.equal(h.writes(),0);}
    const h=fixture(),plan=await planned(h,{type:'sync',id:'a'});h.onRead(()=>{h.api.auth.currentUser={...owner,uid:'different-owner'};});await assert.rejects(save(h,plan),/Owner account changed/);assert.equal(h.writes(),0);
    const t=fixture(),p=await planned(t,{type:'sync',id:'a'});t.onTransaction(()=>{t.api.auth.currentUser={...owner,emailVerified:false};});await assert.rejects(save(t,p),/verified main Owner/);assert.equal(t.writes(),0);
});
test('stale account and protected-bridge changes after preview or during transaction are held',async()=>{
    for(const duringTx of [false,true]){const h=fixture(),plan=await planned(h,{type:'update',id:'a',patch:{permissions:['payroll']}});const mutate=()=>h.put('hq_managers/a',{...account,permissions:['ledger']});if(duringTx)h.onTransaction(mutate);else mutate();await assert.rejects(save(h,plan),/changed/);assert.equal(h.writes(),0);}
    const h=fixture(),plan=await planned(h,{type:'sync',id:'a'});h.put('hq_email_access/co@example.test',{active:false});await assert.rejects(save(h,plan),/changed/);assert.equal(h.writes(),0);
});
test('lost acknowledgment and duplicate clicks reuse the same operation without repeating writes; different payload cannot reuse its ID',async()=>{
    const h=fixture(),plan=await planned(h,{type:'update',id:'a',patch:{permissions:['payroll']}});h.loseNextAck();await assert.rejects(save(h,plan),/Acknowledgement lost/);const writes=h.writes();assert.equal((await save(h,plan)).alreadySaved,true);assert.equal(h.writes(),writes);assert.equal(h.get('hq_email_access/co@example.test').accessVersion,1);
    const different=await planned(h,{type:'update',id:'a',patch:{permissions:['ledger']}});await assert.rejects(save(h,different),/belongs to another/);assert.equal(h.writes(),writes);
    assert.equal(accessOperation(h.api,plan),accessOperation(h.api,plan));
});
test('a newly reviewed Sync after a legacy Settings change uses a new operation and cannot mistake an old acknowledgment for fresh synchronization',async()=>{
    const h=fixture(),first=await planned(h,{type:'sync',id:'a'}),firstId=accessOperation(h.api,first);await save(h,first,firstId);
    h.put('hq_managers/a',{...h.get('hq_managers/a'),permissions:['ledger'],assignedBranch:'Cabantian',permissionsUpdatedAt:{seconds:5000}});
    const second=await planned(h,{type:'sync',id:'a'}),secondId=accessOperation(h.api,second);assert.notEqual(secondId,firstId);await save(h,second,secondId);assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,['ledger']);assert.deepEqual(h.get('hq_email_access/co@example.test').allowedBranches,['Cabantian']);
});
test('hardcoded verified main Owner may update its legacy PIN/profile without a branch assignment; other missing-scope accounts cannot gain access',async()=>{
    const h=fixture({'hq_managers/main':{email:owner.email,pin:'1234',role:'System Architect',permissions:['all']}});
    await save(h,await planned(h,{type:'update',id:'main',patch:{pin:'9876',fullName:'Sample Owner'}}));assert.equal(h.get('hq_managers/main').pin,'9876');assert.deepEqual(h.get('hq_email_access/'+owner.email).allowedBranches,['All']);
    const other=fixture({'hq_managers/a':{...account,assignedBranch:undefined,permissions:['all']}});await assert.rejects(planned(other,{type:'sync',id:'a'}),/explicit permitted branches/);assert.equal(other.writes(),0);
});
test('new-account registration and protected authority are one commit; a normalized existing email cannot register again',async()=>{
    const h=fixture({}),intent={type:'register',id:'hq_new',profile:{...account,email:'new@example.test',permissions:['ledger']}},plan=await planned(h,intent);await save(h,plan);assert.deepEqual(h.get('hq_email_access/new@example.test').permissions,['ledger']);assert.equal(h.get('hq_managers/hq_new').pin,'1234');
    const duplicate=fixture({'hq_managers/a':{...account,email:' New@Example.Test '}});await assert.rejects(planned(duplicate,intent),/already registered/);assert.equal(duplicate.writes(),0);
});
test('actual Settings permission editor saves canonical duplicate settings and bridge through the adapter',async()=>{
    const h=fixture({'hq_managers/a':{...account,permissions:['all'],permissionsUpdatedAt:{seconds:1}},'hq_managers/b':{...account,permissionsUpdatedAt:{seconds:30}}});let html='';
    h.api.Swal.fire=async opts=>{if(opts.preConfirm){html=opts.html;const result=await opts.preConfirm();return {isConfirmed:result!==false};}return {isConfirmed:true};};
    const d={getElementById:()=>({checked:false,style:{}}),querySelector:()=>null,querySelectorAll:selector=>selector==='.workspace-permission:checked'?[{value:'payroll'}]:[]};installWorkspaceAccess(h.api,d);await h.api.editManagerPermissions('a');
    assert.match(html,/value="feed" checked/);assert.deepEqual(h.get('hq_managers/a').permissions,['payroll']);assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,['payroll']);
});
function profileDom() {
    const nodes=new Map(),dialogs=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false});return nodes.get(id);};
    const d={getElementById:node,body:{append:dialog=>dialogs.push(dialog)},createElement:()=>{
        const fields=new Map(),parts=new Map();const form={elements:{namedItem:name=>fields.get(name)}};
        const dialog={addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){},querySelector:selector=>selector==='form'?form:parts.get(selector)||parts.set(selector,{textContent:'',hidden:false,disabled:false}).get(selector),querySelectorAll:()=>[{onclick:null},{onclick:null}]};
        Object.defineProperty(dialog,'innerHTML',{set:html=>{for(const tag of html.matchAll(/<(?:input|select)[^>]*\bname="([^"]+)"[^>]*>/g)){const value=tag[0].match(/\bvalue="([^"]*)"/);fields.set(tag[1],{value:value?.[1]||'',checked:/\bchecked\b/.test(tag[0]),type:'password',disabled:false});}}});
        dialog.fields=fields;dialog.form=form;return dialog;}};return {d,node,dialogs};
}
test('actual HQ Profile editor preserves role aliases, saves branch/active changes with bridge, and can disable conflicting PIN records',async()=>{
    for(const role of ['Franchise Owner','co_owner']){const h=fixture({'hq_managers/a':{...account,role}}),ui=profileDom();h.put('branches/maa',{name:'Maa'});h.put('branches/cabantian',{name:'Cabantian'});installHQProfile({window:h.api,document:ui.d});await h.api.editManagerProfile('a');const dialog=ui.dialogs.at(-1);assert.equal(dialog.fields.get('role').value,role==='Franchise Owner'?'Franchisee':'Co-Owner');dialog.fields.get('branchScope').value='Cabantian';dialog.fields.get('fullName').value='Sample';await dialog.form.onsubmit({preventDefault(){}});assert.deepEqual(h.get('hq_email_access/co@example.test').allowedBranches,['Cabantian']);assert.deepEqual(h.get('hq_email_access/co@example.test').permissions,['feed']);}
    const h=fixture({'hq_managers/a':account,'hq_managers/b':{...account,pin:'5678'}}),ui=profileDom();h.put('branches/maa',{name:'Maa'});installHQProfile({window:h.api,document:ui.d});await h.api.editManagerProfile('a');const dialog=ui.dialogs.at(-1);dialog.fields.get('accountActive').checked=false;await dialog.form.onsubmit({preventDefault(){}});assert.equal(h.get('hq_email_access/co@example.test').active,false);
});
test('updating the later-ID duplicate profile keeps its saved contact details as the actual sign-in winner; sync alone preserves that winner',async()=>{
    const h=fixture({'hq_managers/a':{...account,fullName:'Old A',phone:'old-a',profileUpdatedAt:{seconds:30}},'hq_managers/b':{...account,fullName:'Old B',phone:'old-b',profileUpdatedAt:{seconds:20}}});
    await save(h,await planned(h,{type:'update',id:'b',patch:{fullName:'New B',phone:'new-b'}}));let resolved=resolveHQAccount(['a','b'].map(id=>({id,data:h.get('hq_managers/'+id)})));assert.equal(resolved.fullName,'New B');assert.equal(resolved.phone,'new-b');
    await save(h,await planned(h,{type:'sync',id:'a'}),'sync-after-profile');resolved=resolveHQAccount(['a','b'].map(id=>({id,data:h.get('hq_managers/'+id)})));assert.equal(resolved.fullName,'New B');assert.equal(resolved.phone,'new-b');
});
test('explicit sync UI requires confirmation and legacy monitor grant is routed through the same safe preview',async()=>{
    const h=fixture();h.api.TKCashierStatus={grantMonitorAccess:()=>{throw Error('unsafe legacy helper');}};let preview;
    h.api.Swal.fire=async options=>{preview=options;return {isConfirmed:false};};installHQAccessSync(h.api);await h.api.TKCashierStatus.grantMonitorAccess('a');assert.equal(h.writes(),0);assert.match(preview.html,/Branches: Maa/);assert.match(preview.html,/Permissions: feed/);
    const source=readFileSync(new URL('../takodeal-manager/access-workspace.js',import.meta.url),'utf8');assert.match(source,/actionButton\('sync-access'/);assert.match(source,/runExisting\('syncSavedHQAccess'/);
});
test('legacy revoke export and actual access UI delegation cannot bypass the installed atomic handler',async()=>{
    const h=fixture();h.api.removeHqManager=()=>{throw Error('legacy delete must never run');};installHQAccessSync(h.api);await h.api.removeHqManager('a');assert.equal(h.get('hq_managers/a'),undefined);assert.equal(h.get('hq_email_access/co@example.test').active,false);
    const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.equal((main.match(/grantMonitorAccess\s*\(/g)||[]).length,1,'legacy helper has only its declaration, no closure-internal callers');assert.match(readFileSync(new URL('../takodeal-manager/access-workspace.js',import.meta.url),'utf8'),/runExisting\('removeHqManager'/);
});
test('actual auth branch guard follows explicit saved scope for Manager/Co-Owner including all-tab accounts',()=>{
    const source=readFileSync(new URL('../takodeal-manager/auth.js',import.meta.url),'utf8'),start=source.indexOf('window.isBranchAllowed ='),end=source.indexOf('\n};',start)+3;
    const context={window:{},MASTER_EMAIL:owner.email};vm.runInNewContext(source.slice(start,end),context);const allowed=context.window.isBranchAllowed;assert.equal(allowed('Maa'),false);
    for(const role of ['Manager','Co-Owner']){context.window.sessionUser={email:'co@example.test',role,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['Maa']};assert.equal(allowed('Maa'),true);assert.equal(allowed('Cabantian'),false);}
    context.window.sessionUser={email:owner.email,allowedBranches:[]};assert.equal(allowed('Cabantian'),true);context.window.sessionUser={email:'co@example.test',allowedBranches:['All']};assert.equal(allowed('Cabantian'),true);
});
test('actual Access directory displays and searches saved array branch scopes and normalized role aliases',()=>{
    const rows=[accountRecord('a',{...account,role:'co_owner',assignedBranch:['Maa','Cabantian']})];assert.equal(rows[0].branch,'Maa, Cabantian');assert.equal(rows[0].role,'Co-Owner');assert.equal(filterAccounts(groupAccounts(rows),'Maa').length,1);
    assert.equal(accountRecord('f',{...account,role:'Franchise Owner',assignedBranch:['Maa']}).role,'Franchise owner');
});
