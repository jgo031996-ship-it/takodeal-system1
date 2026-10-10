import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {loadStockRequestDraft} from '../takodeal-manager/dispatch-request-draft.js';

const copy=value=>structuredClone(value);
const row={name:'Chicken Powder',qty:2000,rawQty:2,baseUom:'Gram',purchaseUom:'Pack',convRate:1000};
const hq={'Chicken Powder':{uom:'Gram',purchaseUom:'Pack',conversionRate:1000,currentStock:10000}};
function fixture({source='Cabantian',cart=[],initial={}}={}){
    const h=firestoreHarness(),user={uid:'synthetic-manager',email:'synthetic@example.test',emailVerified:true};
    const po={branch:'Maa',status:'Pending',type:'Manual Set Aside',requestedBy:'Synthetic Manager',items:[copy(row)],...(source===null?{}:{sourceBranch:source,destinationBranch:'Maa'})};h.put('purchase_orders/po',po);
    const data={...initial},storage={getItem:key=>Object.hasOwn(data,key)?data[key]:null,setItem:(key,value)=>{data[key]=String(value);},removeItem:key=>{delete data[key];}};
    const nodes={dispFrom:{value:'Main Office',options:['Main Office','Cabantian','Citygate','Maa'].map(value=>({value}))},dispTo:{value:'Maa'}};
    const api={...h.api,auth:{currentUser:user},sessionUser:createWorkspaceSession(user,{email:user.email,role:'Manager',permissions:['dispatch'],assignedBranch:['Maa','Cabantian','Citygate']}),crypto:globalThis.crypto,
        isBranchAllowed:branch=>['Main Office','Maa','Cabantian','Citygate'].includes(branch),dispatchCart:copy(cart)};
    const f={h,api,po:copy(po),nodes,storage,data,document:{getElementById:id=>nodes[id]||null}};
    f.load=()=>loadStockRequestDraft(api,{poId:'po',po:f.po,hqDetails:hq},{storage:f.storage,document:f.document});return f;
}

test('loading a saved non-HQ source restores its source selection and metadata without changing base quantities',async()=>{
    const f=fixture();const result=await f.load();assert.equal(result.loaded,true);assert.equal(result.source,'Cabantian');assert.equal(f.nodes.dispFrom.value,'Cabantian');assert.equal(f.nodes.dispTo.value,'Maa');
    assert.equal(f.data.takodeal_dispatch_from,'Cabantian');assert.equal(f.data.takodeal_dispatch_to,'Maa');assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.api.dispatchCart[0].rawQty,2);
    assert.equal(f.h.get('purchase_orders/po').sourceBranch,'Cabantian');assert.equal(f.h.get('purchase_orders/po').status,'Drafting');
});

test('legacy requests without source metadata retain the existing Main Office supply source and save it for reload',async()=>{
    const f=fixture({source:null});f.api.isBranchAllowed=branch=>branch==='Maa';await f.load();assert.equal(f.nodes.dispFrom.value,'Main Office');assert.equal(f.data.takodeal_dispatch_from,'Main Office');assert.equal(f.data.takodeal_dispatch_to,'Maa');
});

test('another saved or currently selected source cannot be silently merged into an existing manual cart',async()=>{
    for(const storedSource of ['Citygate',null]){
        const cart=[{name:'Other item',qty:2}],f=fixture({cart,initial:{takodeal_dispatch_to:'Maa',takodeal_dispatch_cart:JSON.stringify(cart),...(storedSource?{takodeal_dispatch_from:storedSource}:{})}});f.nodes.dispFrom.value='Citygate';
        const before=copy(f.data),result=await f.load();assert.equal(result.blockedSource,true);assert.equal(result.source,'Citygate');assert.equal(result.requestedSource,'Cabantian');
        assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(f.data,before);assert.equal(f.h.get('purchase_orders/po').status,'Pending');assert.equal(f.nodes.dispFrom.value,'Citygate');
    }
});

test('linked source provenance survives removal of all cart rows and blocks a different source',async()=>{
    const f=fixture({initial:{takodeal_active_po:'previous',takodeal_dispatch_to:'Maa',takodeal_dispatch_from:'Main Office',takodeal_dispatch_cart:'[]'}}),before=copy(f.data);
    assert.equal((await f.load()).blockedSource,true);assert.deepEqual(f.data,before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
});

test('source and destination metadata participate in the transaction request fingerprint',async()=>{
    for(const change of [{sourceBranch:'Citygate'},{destinationBranch:'Cabantian'}]){
        const f=fixture();f.h.put('purchase_orders/po',{...f.h.get('purchase_orders/po'),...change});
        await assert.rejects(f.load(),/request changed/);assert.deepEqual(f.data,{});assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
    }
});

test('unavailable or invalid saved sources and conflicting destination metadata are rejected before loading',async()=>{
    const unavailable=fixture();unavailable.nodes.dispFrom.options=[{value:'Main Office'}];await assert.rejects(unavailable.load(),/source is unavailable/);assert.deepEqual(unavailable.data,{});assert.equal(unavailable.h.get('purchase_orders/po').status,'Pending');
    for(const source of ['', 'Unknown Branch','UnknownBranch','All']){const f=fixture({source});await assert.rejects(f.load(),/invalid Source/);assert.deepEqual(f.data,{});assert.equal(f.h.get('purchase_orders/po').status,'Pending');}
    const destination=fixture();destination.po.destinationBranch='Cabantian';await assert.rejects(destination.load(),/invalid Source or Destination/);assert.deepEqual(destination.data,{});
});

test('fresh non-HQ source permissions remain required for loading a saved source',async()=>{
    const f=fixture();f.api.isBranchAllowed=branch=>branch==='Maa';await assert.rejects(f.load(),/source is outside/);assert.deepEqual(f.data,{});assert.equal(f.h.get('purchase_orders/po').status,'Pending');
});

test('a source or destination selection change during loading cannot overwrite the new selection or local draft',async()=>{
    for(const id of ['dispFrom','dispTo']){
        const f=fixture(),run=f.api.runTransaction;f.api.runTransaction=(db,callback)=>{f.nodes[id].value='Citygate';return run(db,callback);};
        await assert.rejects(f.load(),/draft changed/);assert.equal(f.nodes[id].value,'Citygate');assert.deepEqual(f.data,{});assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
    }
});

test('transaction failure keeps the original source storage and local cart intact',async()=>{
    const f=fixture({initial:{takodeal_dispatch_from:'Main Office',takodeal_dispatch_cart:'[]'}}),before=copy(f.data);f.h.failNextCommit();await assert.rejects(f.load(),/Commit rejected/);assert.deepEqual(f.data,before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.nodes.dispFrom.value,'Main Office');
});

test('local source persistence failure rolls back every draft key and publishes no local cart',async()=>{
    const f=fixture({initial:{takodeal_dispatch_from:'Main Office',takodeal_draft_qty_0:'7'}}),before=copy(f.data),set=f.storage.setItem;let fail=true;
    f.storage.setItem=(key,value)=>{if(fail&&key==='takodeal_dispatch_from'){fail=false;throw Error('Synthetic storage quota');}set(key,value);};
    await assert.rejects(f.load(),/could not save the draft/);assert.deepEqual(f.data,before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.nodes.dispFrom.value,'Main Office');assert.equal(f.h.get('purchase_orders/po').status,'Drafting');
});

test('lost draft-status acknowledgement retries once and restores the saved non-HQ source without double quantities',async()=>{
    const f=fixture();f.h.loseNextAck();await assert.rejects(f.load(),/Connection lost/);assert.deepEqual(f.data,{});assert.deepEqual(f.api.dispatchCart,[]);
    assert.equal((await f.load()).loaded,true);assert.equal(f.data.takodeal_dispatch_from,'Cabantian');assert.equal(f.nodes.dispFrom.value,'Cabantian');assert.equal(f.api.dispatchCart[0].qty,2000);
    assert.equal((await f.load()).alreadyLoaded,true);assert.equal(f.api.dispatchCart[0].qty,2000);
});
