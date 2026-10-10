import test from 'node:test';
import assert from 'node:assert/strict';
import {installDispatchDestinationRepair} from '../takodeal-manager/dispatch-destination-repair.js';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const copy=value=>structuredClone(value);
const originalPO={branch:'Unknown Branch',status:'Pending',type:'Internal Request',requestedBy:'System (Merged / Set Aside)',
    timestamp:new Date('2026-10-04T12:00:00+08:00'),items:[{name:'Flour',qty:3000,rawQty:3,baseUom:'g',purchaseUom:'Pack',conversionRate:1000}],managerMessage:'Keep saved note'};
function fixture({po=originalPO,savedPatch={},authPatch={},scope=['Maa','Citygate'],harness}={}) {
    const h=harness || firestoreHarness(),user={uid:'hq-one',email:'sample-hq@example.test',emailVerified:true,providerData:[{providerId:'google.com'}],...authPatch};
    const saved={email:user.email,role:'Manager',permissions:['dispatch'],assignedBranch:['Maa','Citygate'],pin:'1234',...savedPatch};
    if(!harness) {
        h.put('purchase_orders/request',copy(po));h.put('hq_managers/manager',copy(saved));
        h.put('branches/hq',{name:'Main Office'});h.put('branches/maa',{name:'Maa',active:true});h.put('branches/city',{name:'Citygate',active:true});
        h.put('inventory/hq',{name:'Flour',branch:'Main Office',currentStock:10});h.put('cash_accounts/hq',{balance:5000});
    }
    const calls=[],dialogs=[],writes=[];
    const api={...h.api,auth:{currentUser:user},sessionUser:createWorkspaceSession(user,{...saved,permissions:['dispatch']}),crypto:globalThis.crypto,
        isBranchAllowed:branch=>scope.includes(branch),
        getDocFromServer:async ref=>({exists:()=>h.docs.has(ref.path),data:()=>copy(h.get(ref.path))}),
        reviewPurchaseOrder:async function(...args){calls.push({handler:'purchase',args,context:this});return 'purchase reviewed';},
        reviewStockRequest:async function(...args){calls.push({handler:'stock',args,context:this});return 'stock reviewed';}};
    const f={h,api,calls,dialogs,writes,choose:async()=>({isConfirmed:true,value:'maa'}),transactionHook:null};
    const txRun=api.runTransaction;
    api.runTransaction=(db,callback)=>txRun(db,async tx=>{
        if(f.transactionHook)await f.transactionHook();
        return callback({...tx,update:(ref,patch)=>{writes.push({path:ref.path,patch:copy(patch)});tx.update(ref,patch);}});
    });
    const dialogApi={fire:async options=>{dialogs.push(options);return options.input==='select'?f.choose(options):{};}};
    f.installer=installDispatchDestinationRepair(api,{document:{},dialogs:dialogApi});
    f.dialogApi=dialogApi;f.before=()=>new Map([...h.docs].map(([key,value])=>[key,copy(value)]));
    return f;
}
const assertOnlyRequestChanged=(f,before)=>{
    assert.deepEqual([...f.h.docs.keys()],[...before.keys()]);
    for(const [path,data] of before)if(path!=='purchase_orders/request')assert.deepEqual(f.h.get(path),data);
    assert.ok(f.writes.every(write=>write.path==='purchase_orders/request'));
};

test('repair chooses an explicit destination and preserves all original items, dates, status and notes',async()=>{
    const f=fixture(),before=f.before();assert.equal(await f.api.reviewPurchaseOrder('request','extra'),'purchase reviewed');
    const after=f.h.get('purchase_orders/request');assert.equal(after.branch,'Maa');assert.equal(after.destinationBranch,'Maa');assert.equal(after.sourceBranch,'Main Office');
    for(const field of ['items','timestamp','status','type','requestedBy','managerMessage'])assert.deepEqual(after[field],originalPO[field]);
    assert.equal(after.destinationRepair.previousBranch,'Unknown Branch');assert.equal(after.destinationRepair.actorUid,'hq-one');assert.equal(after.destinationRepair.actorEmail,'sample-hq@example.test');
    assert.match(after.destinationRepair.requestHash,/^[a-f0-9]{64}$/);assert.match(after.destinationRepair.operationId,/^destination-repair-/);
    assert.equal(f.writes.length,1);assert.deepEqual(f.calls[0].args,['request','extra']);assert.equal(f.calls[0].context,f.api);assertOnlyRequestChanged(f,before);
    const dialog=f.dialogs[0];assert.equal(dialog.titleText,'Choose the destination for this saved draft');assert.equal(dialog.inputValue,'');assert.equal(dialog.inputPlaceholder,'Select the correct branch');
    assert.deepEqual(dialog.inputOptions,{city:'Citygate',maa:'Maa'});assert.equal(Object.hasOwn(dialog.inputOptions,'Cabantian'),false);
});

test('cancellation leaves the whole database unchanged and does not open the old reviewer',async()=>{
    const f=fixture(),before=f.before();f.choose=async()=>({isConfirmed:false});assert.equal(await f.api.reviewStockRequest('request'),false);
    assert.deepEqual(f.h.docs,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);assert.equal(f.dialogs.length,1);assert.equal(f.installer.busy(),false);
});

test('both entry points are wrapped once and a valid saved destination delegates without a repair write',async()=>{
    const f=fixture({po:{...originalPO,branch:'Maa',destinationBranch:'Maa'}}),installed=f.api.reviewPurchaseOrder;
    assert.equal(installDispatchDestinationRepair(f.api,{dialogs:f.dialogApi}),f.installer);assert.equal(f.api.reviewPurchaseOrder,installed);
    assert.equal(await f.api.reviewStockRequest('request'),'stock reviewed');assert.equal(await f.api.reviewPurchaseOrder('request'),'purchase reviewed');
    assert.equal(f.calls.length,2);assert.equal(f.dialogs.length,0);assert.equal(f.writes.length,0);
});

test('normal Franchise and completed request reviews delegate immediately without new repair authority or branch queries',async()=>{
    for(const status of ['Pending','Completed']) {
        const f=fixture({po:{...originalPO,branch:'Maa',status}});f.api.auth.currentUser=null;f.api.sessionUser={isFranchisee:true,branch:'Maa'};
        f.api.getDocsFromServer=async()=>{throw Error('Normal review must not read repair authority or branches');};
        assert.equal(await f.api.reviewPurchaseOrder('request'),'purchase reviewed');assert.equal(await f.api.reviewStockRequest('request'),'stock reviewed');
        assert.equal(f.calls.length,2);assert.equal(f.dialogs.length,0);assert.equal(f.writes.length,0);
    }
});

test('blank ManualSetAside drafts qualify without broadening unrelated forecast repairs',async()=>{
    const f=fixture({po:{...originalPO,branch:'',type:'Manual Set Aside',requestedBy:'Sample manager'}});
    assert.equal(await f.api.reviewStockRequest('request'),'stock reviewed');assert.equal(f.h.get('purchase_orders/request').destinationRepair.previousBranch,'');
    const compact=fixture({po:{...originalPO,requestedBy:'System(Merged/SetAside)'}});assert.equal(await compact.api.reviewPurchaseOrder('request'),'purchase reviewed');
    for(const po of [{...originalPO,type:'AI Auto-Forecast'},{...originalPO,isForecast:true},{...originalPO,requestedBy:'System (Forecast)'},{...originalPO,requestedBy:'Staff',type:'Internal Request'}]) {
        const blocked=fixture({po}),before=blocked.before();assert.equal(await blocked.api.reviewPurchaseOrder('request'),false);assert.deepEqual(blocked.h.docs,before);assert.equal(blocked.calls.length,0);
    }
});

test('completed, rejected, dispatch-linked, corrupted and conflicting destinations are refused before a choice',async()=>{
    for(const patch of [{status:'Completed'},{status:'Rejected'},{status:'Drafting',dispatchBatchId:'batch'},{completedAt:new Date()},
        {branch:'Unknown Branch',destinationBranch:'Citygate'},{branch:42},{sourceBranch:{name:'Main Office'}}]) {
        const f=fixture({po:{...originalPO,...patch}}),before=f.before();assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.deepEqual(f.h.docs,before);
        assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);assert.equal(f.dialogs.some(dialog=>dialog.input==='select'),false);
    }
});

test('a current canonical non-HQ source is preserved and cannot also be chosen as destination',async()=>{
    const f=fixture({po:{...originalPO,sourceBranch:'Citygate'}});assert.equal(await f.api.reviewStockRequest('request'),'stock reviewed');
    assert.equal(f.h.get('purchase_orders/request').sourceBranch,'Citygate');assert.deepEqual(f.dialogs[0].inputOptions,{maa:'Maa'});
});

test('duplicate and inactive branch records are never offered as guessed destinations',async()=>{
    const f=fixture();f.h.put('branches/maa-copy',{name:'Maa',active:true});f.h.put('branches/closed',{name:'Closed branch',status:'Closed'});
    f.choose=async options=>{assert.deepEqual(options.inputOptions,{city:'Citygate'});return {isConfirmed:true,value:'city'};};
    assert.equal(await f.api.reviewPurchaseOrder('request'),'purchase reviewed');assert.equal(f.h.get('purchase_orders/request').branch,'Citygate');
});

test('a forged option, unavailable branches and unsafe request IDs make no repair writes',async()=>{
    const forged=fixture(),before=forged.before();forged.choose=async()=>({isConfirmed:true,value:'Cabantian'});assert.equal(await forged.api.reviewPurchaseOrder('request'),false);assert.deepEqual(forged.h.docs,before);
    const unavailable=fixture();unavailable.h.put('branches/maa',{name:'Maa',active:false});unavailable.h.put('branches/city',{name:'Citygate',active:false});assert.equal(await unavailable.api.reviewStockRequest('request'),false);assert.equal(unavailable.writes.length,0);
    for(const id of ['','bad/path',null]) {const f=fixture();assert.equal(await f.api.reviewPurchaseOrder(id),false);assert.equal(f.writes.length,0);}
});

test('unverified, non-Google, mismatched, unauthorized and Franchise sessions fail closed',async()=>{
    for(const mutate of [f=>{f.api.auth.currentUser.emailVerified=false;},f=>{f.api.auth.currentUser.providerData=[{providerId:'password'}];},
        f=>{f.api.sessionUser.uid='another';},f=>{f.api.sessionUser.email='other@example.test';},f=>{f.api.sessionUser.permissions=[];},f=>{f.api.sessionUser.isFranchisee=true;}]) {
        const f=fixture(),before=f.before();mutate(f);assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.deepEqual(f.h.docs,before);assert.equal(f.calls.length,0);
    }
});

test('fresh saved HQ permissions and destination scope override a permissive local session',async()=>{
    for(const patch of [{permissions:['dashboard']},{active:false},{blocked:true},{role:'Franchisee',assignedBranch:'Maa'}]) {
        const f=fixture(),before=f.before();f.h.put('hq_managers/manager',{...f.h.get('hq_managers/manager'),...patch});
        assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
        assert.deepEqual(f.h.get('purchase_orders/request'),before.get('purchase_orders/request'));
    }
    const scoped=fixture({savedPatch:{assignedBranch:['Maa']}});scoped.choose=async options=>{assert.deepEqual(options.inputOptions,{maa:'Maa'});return {isConfirmed:true,value:'city'};};
    assert.equal(await scoped.api.reviewPurchaseOrder('request'),false);assert.equal(scoped.writes.length,0);
    const apiRestricted=fixture({scope:[]});assert.equal(await apiRestricted.api.reviewPurchaseOrder('request'),false);assert.equal(apiRestricted.writes.length,0);
});

test('the verified Owner can choose a branch but a forged Owner session cannot impersonate that Google identity',async()=>{
    const owner=fixture({authPatch:{email:'jgo031996@gmail.com'},savedPatch:{permissions:[],assignedBranch:[]}});
    assert.equal(await owner.api.reviewPurchaseOrder('request'),'purchase reviewed');
    const forged=fixture();forged.api.sessionUser.email='jgo031996@gmail.com';forged.api.sessionUser.isOwner=true;
    assert.equal(await forged.api.reviewPurchaseOrder('request'),false);assert.equal(forged.writes.length,0);
});

test('account switching while a choice is open prevents both mutation and the original reviewer',async()=>{
    const f=fixture(),before=f.before();f.choose=async()=>{f.api.auth.currentUser={...f.api.auth.currentUser,uid:'other'};return {isConfirmed:true,value:'maa'};};
    assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.deepEqual(f.h.docs,before);assert.equal(f.calls.length,0);assert.match(f.dialogs.at(-1).text,/account|approved Google/);
});

test('identity replacement during a transaction read cannot commit the destination',async()=>{
    const f=fixture(),before=f.before();f.transactionHook=async()=>{f.api.sessionUser={...f.api.sessionUser};f.transactionHook=null;};
    assert.equal(await f.api.reviewStockRequest('request'),false);assert.deepEqual(f.h.docs,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
});

test('an edited or processed request while the chooser is open is not overwritten',async()=>{
    for(const patch of [{items:[{name:'Flour',qty:7}]},{status:'Completed'},{branch:'Citygate'},{managerMessage:'Edited by other HQ account'}]) {
        const f=fixture();f.choose=async()=>{f.h.put('purchase_orders/request',{...f.h.get('purchase_orders/request'),...patch});return {isConfirmed:true,value:'maa'};};
        assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
        for(const [key,value] of Object.entries(patch))assert.deepEqual(f.h.get('purchase_orders/request')[key],value);
    }
});

test('branch duplication or deactivation after selection is checked again against fresh records',async()=>{
    for(const mutate of [f=>f.h.put('branches/maa',{name:'Maa',active:false}),f=>f.h.put('branches/new-maa',{name:'Maa',active:true}),f=>f.h.put('branches/maa',{name:'Renamed branch',active:true})]) {
        const f=fixture();f.choose=async()=>{mutate(f);return {isConfirmed:true,value:'maa'};};assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
    }
});

test('saved permissions and branch state are reread transactionally before the only write',async()=>{
    for(const mutate of [f=>f.h.put('hq_managers/manager',{...f.h.get('hq_managers/manager'),permissions:['dashboard']}),f=>f.h.put('branches/maa',{name:'Maa',active:false})]) {
        const f=fixture();f.transactionHook=async()=>{mutate(f);f.transactionHook=null;};assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
    }
});

test('a rejected commit preserves the request and releases the busy guard for a later retry',async()=>{
    const f=fixture(),before=f.before();f.h.failNextCommit();assert.equal(await f.api.reviewPurchaseOrder('request'),false);assert.deepEqual(f.h.docs,before);assert.equal(f.calls.length,0);assert.equal(f.installer.busy(),false);
    assert.equal(await f.api.reviewPurchaseOrder('request'),'purchase reviewed');assert.equal(f.h.get('purchase_orders/request').branch,'Maa');
});

test('a lost acknowledgement can be reopened without writing another audit or moving stock or money',async()=>{
    const f=fixture(),before=f.before();f.h.loseNextAck();assert.equal(await f.api.reviewPurchaseOrder('request'),false);
    const repaired=copy(f.h.get('purchase_orders/request'));assert.equal(repaired.branch,'Maa');assert.equal(f.calls.length,0);
    assert.equal(await f.api.reviewStockRequest('request'),'stock reviewed');assert.deepEqual(f.h.get('purchase_orders/request'),repaired);assert.equal(f.writes.length,1);assertOnlyRequestChanged(f,before);
});

test('concurrent conflicting destinations cannot overwrite the first committed repair',async()=>{
    const first=fixture(),second=fixture({harness:first.h});second.choose=async()=>({isConfirmed:true,value:'city'});
    const result=await Promise.all([first.api.reviewPurchaseOrder('request'),second.api.reviewStockRequest('request')]);
    assert.equal(result.filter(value=>value!==false).length,1);assert.ok(['Maa','Citygate'].includes(first.h.get('purchase_orders/request').branch));
    assert.equal(first.calls.length+second.calls.length,1);assert.ok(first.h.retries()>0);assert.match((first.dialogs.at(-1).text || '')+(second.dialogs.at(-1).text || ''),/edited or repaired/);
});

test('a pending chooser blocks duplicate entry-point clicks and never defaults to the first branch',async()=>{
    const f=fixture();let release,opened;
    const ready=new Promise(resolve=>opened=resolve);f.choose=()=>new Promise(resolve=>{release=resolve;opened();});
    const pending=f.api.reviewPurchaseOrder('request');await ready;assert.equal(f.installer.busy(),true);assert.equal(await f.api.reviewStockRequest('request'),false);
    assert.equal(f.dialogs[0].inputValue,'');release({isConfirmed:false});assert.equal(await pending,false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
});
