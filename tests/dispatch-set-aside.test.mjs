import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {commitSetAside} from '../takodeal-manager/dispatch-set-aside.js';

const copy=value=>structuredClone(value);
const user={uid:'synthetic-manager',email:'synthetic-manager@example.test',emailVerified:true};
const profile={email:user.email,fullName:'Synthetic Manager',permissions:['dispatch'],role:'Manager',assignedBranch:['Main Office','Maa','Cabantian','Citygate']};
const row={name:'Chicken Powder',itemName:'Chicken Powder',qty:2000,rawQty:2,convRate:1000,selectedUom:'purch',baseUom:'Gram',purchaseUom:'Pack',friendlyUom:'Pack',conversionRate:1000};
function fixture(){
    const h=firestoreHarness();['Main Office','Maa','Cabantian','Citygate'].forEach((name,index)=>h.put('branches/branch-'+index,{name,isCore:true}));
    h.put('inventory/hq',{branch:'Main Office',name:row.name,currentStock:9000});h.put('inventory/maa',{branch:'Maa',name:row.name,currentStock:500});
    h.put('cash_accounts/hq',{branch:'Main Office',balance:5000});
    const api={...h.api,auth:{currentUser:copy(user)},sessionUser:createWorkspaceSession(user,profile),isBranchAllowed:branch=>['Main Office','Maa','Cabantian','Citygate'].includes(branch)};
    const payload={id:'set-aside-synthetic-1',source:'Main Office',destination:'Maa',actor:{uid:user.uid,email:user.email,name:profile.fullName},items:[copy(row)],purchaseOrderIds:[]};
    return {h,api,payload,save:changes=>commitSetAside(api,{...payload,...changes})};
}
function linked(f,id,changes={}){const value={branch:'Maa',status:'Drafting',type:'AI Auto-Forecast',requestedBy:'Synthetic Staff',items:[copy(row)],...changes};f.h.put('purchase_orders/'+id,value);return copy(value);}
const snapshot=f=>copy([...f.h.docs]);

test('manual Set Aside saves the captured latest source/destination and exact quantities without inventory or financial changes',async()=>{
    const f=fixture(),inventory=copy(f.h.get('inventory/hq')),cash=copy(f.h.get('cash_accounts/hq'));
    // The API receives the current UI selection, not an old localStorage branch.
    const result=await f.save({source:'Cabantian',destination:'Citygate'});
    assert.equal(result.status,'set-aside');const saved=f.h.get('purchase_orders/'+f.payload.id);
    assert.equal(saved.branch,'Citygate');assert.equal(saved.sourceBranch,'Cabantian');assert.equal(saved.destinationBranch,'Citygate');assert.equal(saved.type,'Manual Set Aside');
    assert.equal(saved.status,'Pending');assert.equal(saved.requestedBy,profile.fullName);assert.deepEqual(saved.items,f.payload.items);assert.deepEqual(saved.sourcePurchaseOrderIds,[]);
    assert.match(saved.managerMessage,/Stock has not been dispatched/);assert.equal(saved.setAsideOperation.actorUid,user.uid);
    assert.deepEqual(f.h.get('inventory/hq'),inventory);assert.deepEqual(f.h.get('cash_accounts/hq'),cash);assert.equal(f.h.docs.has('dispatch_logs/'+f.payload.id),false);
});

test('only selected same-branch requests are merged atomically with preserved originals and a saved target link',async()=>{
    const f=fixture(),first=linked(f,'selected-a'),second=linked(f,'selected-b',{status:'Delayed',managerMessage:'Waiting for stock'});
    const unrelated=linked(f,'unrelated',{status:'Drafting'}),otherBranch=linked(f,'other-branch',{branch:'Cabantian'});
    await f.save({purchaseOrderIds:['selected-b','selected-a']});
    const saved=f.h.get('purchase_orders/'+f.payload.id);assert.equal(saved.type,'Merged Set Aside');assert.deepEqual(saved.sourcePurchaseOrderIds,['selected-a','selected-b']);
    for(const [id,original]of [['selected-a',first],['selected-b',second]]){
        const merged=f.h.get('purchase_orders/'+id);assert.equal(merged.status,'Merged');assert.equal(merged.mergedInto,f.payload.id);assert.deepEqual(merged.items,original.items);
        assert.equal(merged.requestedBy,original.requestedBy);assert.equal(merged.type,original.type);assert.equal(merged.setAsideMergeOperation.intent,saved.setAsideOperation.intent);
    }
    assert.deepEqual(f.h.get('purchase_orders/unrelated'),unrelated);assert.deepEqual(f.h.get('purchase_orders/other-branch'),otherBranch);
    assert.equal(f.h.get('purchase_orders/selected-b').managerMessage,'Waiting for stock');
});

test('same attempt and full payload retry returns already-set-aside without another document or changed audit fields',async()=>{
    const f=fixture();linked(f,'selected');f.payload.purchaseOrderIds=['selected'];await f.save();const before=snapshot(f);
    assert.equal((await f.save()).status,'already-set-aside');assert.deepEqual(snapshot(f),before);
});

test('a lost acknowledgement is recovered by the same stable attempt without duplication or permanent source deletion',async()=>{
    const f=fixture();linked(f,'selected');f.payload.purchaseOrderIds=['selected'];f.h.loseNextAck();
    await assert.rejects(f.save(),/Connection lost after commit/);assert.equal(f.h.get('purchase_orders/selected').status,'Merged');const before=snapshot(f);
    assert.equal((await f.save()).status,'already-set-aside');assert.deepEqual(snapshot(f),before);assert.equal(f.h.docs.has('purchase_orders/selected'),true);
});

test('concurrent same-attempt calls create one pending request and retry the contended transaction safely',async()=>{
    const f=fixture();linked(f,'selected');f.payload.purchaseOrderIds=['selected'];
    const run=f.api.runTransaction;let callbacks=0,release;const barrier=new Promise(resolve=>{release=resolve;});
    f.api.runTransaction=(db,callback)=>run(db,async tx=>{const result=await callback(tx);if(callbacks<2){callbacks++;if(callbacks===2)release();await barrier;}return result;});
    const results=await Promise.all([f.save(),f.save()]);assert.deepEqual(results.map(result=>result.status).sort(),['already-set-aside','set-aside']);
    assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('purchase_orders/')).length,2);assert.equal(f.h.get('purchase_orders/selected').mergedInto,f.payload.id);assert.ok(f.h.retries()>0);
});

test('an existing attempt cannot report success for changed quantities, branches, actor label or linked reference set',async()=>{
    for(const change of [{items:[{...row,qty:1000,rawQty:1}]},{source:'Cabantian'},{destination:'Citygate'},{actor:{uid:user.uid,email:user.email,name:'Different label'}},{purchaseOrderIds:['new-linked']}]){
        const f=fixture();linked(f,'new-linked');await f.save();const before=snapshot(f);await assert.rejects(f.save(change),/different draft/);assert.deepEqual(snapshot(f),before);
    }
});

test('unknown, blank, same or duplicated saved branches produce no request or linked-status writes',async()=>{
    for(const change of [{destination:''},{destination:'Unknown Branch'},{destination:'UnknownBranch'},{destination:'All'},{destination:'Main Office'},{destination:'Not Registered'}]){
        const f=fixture(),before=snapshot(f);await assert.rejects(f.save(change));assert.deepEqual(snapshot(f),before);
    }
    const f=fixture();f.h.put('branches/duplicate',{name:'Maa'});const before=snapshot(f);await assert.rejects(f.save(),/missing or duplicated/);assert.deepEqual(snapshot(f),before);
});

test('canonical Main Office remains a valid source without a Branch document, but duplicates and unregistered destinations are rejected',async()=>{
    const f=fixture();f.h.docs.delete('branches/branch-0');const stock=copy(f.h.get('inventory/hq'));
    assert.equal((await f.save()).status,'set-aside');assert.equal(f.h.get('purchase_orders/'+f.payload.id).sourceBranch,'Main Office');assert.deepEqual(f.h.get('inventory/hq'),stock);
    const duplicate=fixture();duplicate.h.put('branches/another-hq',{name:'Main Office'});const before=snapshot(duplicate);await assert.rejects(duplicate.save(),/missing or duplicated/);assert.deepEqual(snapshot(duplicate),before);
    const destination=fixture();destination.h.docs.delete('branches/branch-0');const original=snapshot(destination);await assert.rejects(destination.save({source:'Maa',destination:'Main Office'}),/registered Destination/);assert.deepEqual(snapshot(destination),original);
});

test('merging a previously saved request retains its original creation/retry marker and appends separate merge evidence',async()=>{
    const f=fixture();await f.save();const originalMarker=copy(f.h.get('purchase_orders/'+f.payload.id).setAsideOperation);
    await f.save({id:'second-set-aside',purchaseOrderIds:[f.payload.id]});
    const first=f.h.get('purchase_orders/'+f.payload.id);assert.equal(first.status,'Merged');assert.equal(first.mergedInto,'second-set-aside');
    assert.deepEqual(first.setAsideOperation,originalMarker);assert.equal(first.setAsideMergeOperation.id,'second-set-aside');
    assert.equal((await f.save()).status,'already-set-aside');
});

test('a linked request from another destination or an explicit different source is never silently moved',async()=>{
    for(const changes of [{branch:'Cabantian'},{sourceBranch:'Citygate'},{destinationBranch:'Cabantian'}]){
        const f=fixture();linked(f,'selected',changes);const before=snapshot(f);await assert.rejects(f.save({purchaseOrderIds:['selected']}),/different Source or Destination/);assert.deepEqual(snapshot(f),before);
    }
});

test('missing, processed or already-merged selected requests fail without touching the remaining linked request',async()=>{
    for(const state of ['missing','Sent','Rejected','Merged']){
        const f=fixture();linked(f,'good');if(state!=='missing')linked(f,'bad',{status:state,...(state==='Merged'?{mergedInto:'another-save'}:{})});
        const before=snapshot(f);await assert.rejects(f.save({purchaseOrderIds:['good','bad']}),/removed|already processed/);assert.deepEqual(snapshot(f),before);
    }
});

test('an incomplete or modified saved linkage cannot clear the caller cart by returning a false idempotent success',async()=>{
    const f=fixture();linked(f,'selected');f.payload.purchaseOrderIds=['selected'];await f.save();f.h.put('purchase_orders/selected',{...f.h.get('purchase_orders/selected'),status:'Pending'});
    const before=snapshot(f);await assert.rejects(f.save(),/changed after the draft was saved/);assert.deepEqual(snapshot(f),before);
});

test('a failed atomic commit preserves every source request and creates no pending master request',async()=>{
    const f=fixture();linked(f,'selected');const before=snapshot(f);f.h.failNextCommit();await assert.rejects(f.save({purchaseOrderIds:['selected']}),/Commit rejected/);assert.deepEqual(snapshot(f),before);
});

test('branch/draft change or cancellation detected by the caller baseline guard prevents all writes',async()=>{
    for(const message of ['The Destination selection changed.','The draft items changed.','Set Aside was cancelled.']){
        const f=fixture();linked(f,'selected');const read=f.api.getDocsFromServer;let changed=false;
        f.api.getDocsFromServer=async q=>{const result=await read(q);changed=true;return result;};
        const before=snapshot(f);await assert.rejects(f.save({purchaseOrderIds:['selected'],assertCurrent:()=>{if(changed)throw Error(message);}}),error=>error.message===message);assert.deepEqual(snapshot(f),before);
    }
});

test('branch identity is rechecked inside the transaction after the fresh name lookup',async()=>{
    const f=fixture(),read=f.api.getDocsFromServer;f.api.getDocsFromServer=async q=>{const result=await read(q);if(q.filters.some(filter=>filter.value==='Maa'))f.h.put('branches/branch-1',{name:'Renamed branch'});return result;};
    await assert.rejects(f.save(),/selected branch.*changed/);assert.equal(f.h.docs.has('purchase_orders/'+f.payload.id),false);
});

test('current account, unlock session, permission and branch scope are checked again after asynchronous reads',async()=>{
    for(const change of ['account','session','permission','scope']){
        const f=fixture(),read=f.api.getDocsFromServer;
        f.api.getDocsFromServer=async q=>{const result=await read(q);if(change==='account')f.api.auth.currentUser={...user,uid:'other'};
            else if(change==='session')f.api.sessionUser=createWorkspaceSession(user,profile);
            else if(change==='permission')f.api.sessionUser.permissions=[];else f.api.isBranchAllowed=()=>false;return result;};
        const before=snapshot(f);await assert.rejects(f.save(),/Unlock Dispatch|account changed|outside/);assert.deepEqual(snapshot(f),before);
    }
});

test('Franchise supply requests retain the canonical Main Office source while requiring their assigned destination',async()=>{
    const f=fixture();f.api.sessionUser=createWorkspaceSession(user,{...profile,role:'Franchisee',assignedBranch:'Maa'});f.api.isBranchAllowed=branch=>branch==='Maa';
    assert.equal((await f.save()).status,'set-aside');const before=snapshot(f);await assert.rejects(f.save({id:'different',destination:'Cabantian'}),/outside/);assert.deepEqual(snapshot(f),before);
});

test('zero reported-count rows retain their physical and unit snapshot, while invalid or empty manual quantities are refused',async()=>{
    const f=fixture(),count={...row,qty:0,rawQty:0,physicalStock:1250,countSnapshot:{version:1,baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:250,totalBaseQty:1250}};
    await f.save({items:[count]});assert.deepEqual(f.h.get('purchase_orders/'+f.payload.id).items,[count]);
    for(const items of [[],[{...row,qty:0,rawQty:0}],[{...row,qty:-1}],[{...row,qty:NaN}],[{...row,qty:1000,rawQty:2}],[{...row,qty:'2000'}]]){
        const invalid=fixture(),before=snapshot(invalid);await assert.rejects(invalid.save({items}));assert.deepEqual(snapshot(invalid),before);
    }
});

test('duplicate, invalid or self-referencing linked IDs are rejected before any request changes',async()=>{
    for(const purchaseOrderIds of [['same','same'],['bad/id'],[''],['set-aside-synthetic-1']]){const f=fixture(),before=snapshot(f);await assert.rejects(f.save({purchaseOrderIds}),/linked request IDs/);assert.deepEqual(snapshot(f),before);}
});
