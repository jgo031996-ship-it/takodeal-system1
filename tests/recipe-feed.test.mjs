import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRecipeFeed,RECIPE_CACHE_KEY,recipeRows} from '../Takodeal-POS/recipe-feed.js';
import {createSaleEngine,receiptIngredientBurn} from '../Takodeal-POS/pos-safety.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadRecipeState,saveRecipePlan} from '../takodeal-manager/recipe-changes.js';
import {replacementPlan} from '../takodeal-manager/recipe-bulk-model.js';

const row = (ingredientName='Box',qty=1)=>({menuItem:'Takoyaki 6 Pcs',ingredientName,qty});
const store = value=>({value:value&&JSON.stringify(value),getItem(){return this.value;},setItem(key,value){assert.equal(key,RECIPE_CACHE_KEY);this.value=value;}});
function feedHarness() {
    let revision={version:1,revisionId:'first'},rows=[row()],revisionReads=0,bomReads=0,listener,afterBOM;
    const api={db:{},doc:()=>({id:'recipe_revision'}),collection:()=>({table:'bom'}),
        async getDocFromServer(){revisionReads++;return {exists:()=>true,data:()=>({...revision})};},
        async getDocsFromServer(){bomReads++;const docs=rows.map(value=>({data:()=>({...value})}));afterBOM?.();return {docs};},
        onSnapshot(ref,callback){listener=callback;return ()=>{listener=null;};}};
    return {api,edit(nextRows){rows=nextRows;revision={version:revision.version+1,revisionId:'change-'+revision.version};listener?.({exists:()=>true,data:()=>({...revision})});},
        announce(data){listener?.({exists:()=>true,data:()=>({...data})});},
        changeDuringBOM(fn){afterBOM=()=>{afterBOM=null;fn();};},reads:()=>({revisionReads,bomReads})};
}
test('capture freezes coherent receipt-time recipes and subsequent captures use replacement',async()=>{
    const h=feedHarness(),storage=store(),feed=createRecipeFeed(h.api,{storage});
    const old=await feed.capture();assert.equal(old.recipeSnapshot[0].ingredientName,'Box');
    h.edit([row('Paper Cup',2)]);
    const next=await feed.capture();assert.equal(next.recipeSnapshot[0].ingredientName,'Paper Cup');assert.equal(next.recipeVersion,2);
    assert.equal(old.recipeSnapshot[0].ingredientName,'Box');
    next.recipeSnapshot[0].qty=100;assert.equal(feed.rows().rows[0].qty,2);
    assert.equal(JSON.parse(storage.value).version,2);
});
test('unchanged recipes cost only a revision read at checkout, not the whole BOM',async()=>{
    const h=feedHarness(),feed=createRecipeFeed(h.api);await feed.capture();const before=h.reads();
    await feed.capture();assert.equal(h.reads().bomReads,before.bomReads);assert.equal(h.reads().revisionReads,before.revisionReads+1);
});
test('BOM edited between reads never publishes a mixed generation',async()=>{
    const h=feedHarness();h.changeDuringBOM(()=>h.edit([row('Spork',3)]));
    const captured=await createRecipeFeed(h.api).capture();assert.equal(captured.recipeSnapshot[0].ingredientName,'Spork');assert.equal(captured.recipeVersion,2);
});
test('offline boot uses only a validated cached generation',async()=>{
    const storage=store({schema:1,version:7,revisionId:'offline',rows:[row('Fork',1)]});
    const h=feedHarness(),feed=createRecipeFeed(h.api,{storage,online:()=>false});
    const captured=await feed.capture();assert.equal(captured.recipeVersion,7);assert.equal(captured.recipeSnapshotStatus,'cached');assert.equal(h.reads().bomReads,0);
    storage.value='bad';const empty=await createRecipeFeed(h.api,{storage,online:()=>false}).capture();assert.equal(empty.recipeSnapshotStatus,'unavailable');
    assert.throws(()=>recipeRows([row('Box',-1)]),/Invalid/);
});
test('slow network leaves checkout bounded and records cached status',async()=>{
    const h=feedHarness();h.api.getDocFromServer=()=>new Promise(()=>{});
    const feed=createRecipeFeed(h.api,{storage:store({schema:1,version:1,rows:[row()]}),captureWaitMs:1});
    assert.equal((await feed.capture()).recipeSnapshotStatus,'cached');
});
test('first-load server failure uploads a reviewable receipt without guessing new recipes',async()=>{
    const h=feedHarness();h.api.getDocFromServer=async()=>{throw new Error('offline');};
    assert.equal((await createRecipeFeed(h.api).capture()).recipeSnapshotStatus,'unavailable');
    const db=firestoreHarness(),engine=createSaleEngine(db.api);
    db.put('inventory/cup',{branch:'Maa',name:'Paper Cup',currentStock:30});
    const payload={saleId:'old-offline',saleVersion:2,receiptId:'old',branch:'Maa',netTotal:120,localTimestamp:'2026-10-07T03:00:00Z',
        cart:[{name:'Takoyaki 6 Pcs',qty:1}],recipeSnapshot:[],recipeSnapshotStatus:'unavailable'};
    const prepared=await engine.prepare(payload,[row('Paper Cup',2)]);
    assert.deepEqual(prepared.inventoryMovements,[]);assert.equal(prepared.recipeIssues.length,1);
    await engine.commit(prepared);await engine.commit(prepared);
    assert.equal(db.get('inventory/cup').currentStock,30);assert.equal(db.get('transactions/old-offline').netTotal,120);
    assert.equal(db.get('transactions/old-offline').inventoryReviewRequired,true);
    assert.equal(db.get('manager_alerts/inventory-review-old-offline').recipeIssues[0].menuItem,'Takoyaki 6 Pcs');
});
test('old queued snapshot and new replacement each deduct once despite lost acknowledgement',async()=>{
    const db=firestoreHarness(),engine=createSaleEngine(db.api);
    db.put('inventory/box',{branch:'Maa',name:'Box',currentStock:30});
    db.put('inventory/cup',{branch:'Maa',name:'Paper Cup',currentStock:30});
    const base={saleVersion:2,branch:'Maa',orderType:'Take-Out',netTotal:120,localTimestamp:'2026-10-07T03:00:00Z',cart:[{name:'Takoyaki 6 Pcs',qty:2}]};
    const old=await engine.prepare({...base,saleId:'old',receiptId:'old',recipeSnapshot:[row()]},[row('Paper Cup',2)]);
    const next=await engine.prepare({...base,saleId:'new',receiptId:'new',recipeSnapshot:[row('Paper Cup',2)]});
    db.loseNextAck();await assert.rejects(engine.commit(old),/Connection/);await engine.commit(old);await engine.commit(next);await engine.commit(next);
    assert.equal(db.get('inventory/box').currentStock,28);assert.equal(db.get('inventory/cup').currentStock,26);
    await engine.voidSale('old','Staff','Maa');assert.equal(db.get('inventory/box').currentStock,30);assert.equal(db.get('inventory/cup').currentStock,26);
});
test('checkout wiring never loads current BOM to remap a legacy receipt',async()=>{
    const source=await readFile(new URL('../Takodeal-POS/pos-checkout.js',import.meta.url),'utf8');
    assert.match(source,/recipeFeed\?\.capture/);assert.match(source,/legacy-unrecorded/);
    assert.doesNotMatch(source,/getDocsFromServer\(api\.collection\(api\.db, 'bom'\)\)/);
});
test('shift summary uses frozen receipt movements and never guesses a legacy recipe',()=>{
    assert.deepEqual(receiptIngredientBurn({inventoryMovements:[{ingredientName:'Box',quantity:2},{ingredientName:'Box',quantity:1}]}),{Box:3});
    assert.deepEqual(receiptIngredientBurn({cart:[{name:'Takoyaki 6 Pcs',qty:1}]}),{});
});
test('announced replacement racing an older refresh cannot be labelled verified',async()=>{
    const h=feedHarness(),feed=createRecipeFeed(h.api);await feed.capture();feed.start();
    await feed.refresh();
    let release,requested=false;
    const original=h.api.getDocFromServer;
    h.api.getDocFromServer=()=>{
        if(!requested){requested=true;return new Promise(resolve=>{release=()=>resolve({exists:()=>true,data:()=>({version:1,revisionId:'first'})});});}
        return original();
    };
    const old=feed.refresh();await Promise.resolve();h.edit([row('Cup',2)]);
    const receipt=feed.capture();release();await old;
    const captured=await receipt;
    assert.equal(captured.recipeVersion,2);assert.equal(captured.recipeSnapshotStatus,'verified');feed.stop();
});
test('older cached revision announcement does not downgrade newer server verification or add reads',async()=>{
    const h=feedHarness();h.edit([row('Cup',2)]);
    const feed=createRecipeFeed(h.api);feed.start();h.announce({version:1,revisionId:'first'});
    const captured=await feed.capture();assert.equal(captured.recipeVersion,2);assert.equal(captured.recipeSnapshotStatus,'verified');
    assert.equal(h.reads().revisionReads,2);feed.stop();
});
test('actual bulk save to coherent Cashier feed to queued and new sales preserves history and deducts each receipt once',async()=>{
    const h=firestoreHarness(),email='jgo031996@gmail.com';
    h.api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    h.api.auth={currentUser:{uid:'sample-owner',email,emailVerified:true}};
    h.api.sessionUser={uid:'sample-owner',email,permissions:['all'],allowedBranches:['All']};
    h.put('hq_managers/sample',{email,pin:'sample',permissions:['all'],assignedBranch:'All'});
    h.put('menu/six',{name:'Takoyaki 6 Pcs',category:'Takoyaki'});
    h.put('menu/eight',{name:'Takoyaki 8 Pcs',category:'Takoyaki'});
    h.put('menu/twelve',{name:'Takoyaki 12 Pcs',category:'Takoyaki'});
    h.put('bom/six',row('Box',1));h.put('bom/eight',{...row('Box',2),menuItem:'Takoyaki 8 Pcs'});
    h.put('bom/twelve',{...row('Box',3),menuItem:'Takoyaki 12 Pcs'});
    h.put('inventory/box',{branch:'Maa',name:'Box',currentStock:30,uom:'piece'});
    h.put('inventory/cup',{branch:'Maa',name:'Paper Cup',currentStock:30,uom:'piece'});
    const history={branch:'Maa',netTotal:100,cart:[{name:'Takoyaki 6 Pcs',qty:1}],inventoryMovements:[{inventoryId:'box',ingredientName:'Box',quantity:1}]};
    h.put('transactions/history',history);
    const feed=createRecipeFeed(h.api),oldSnapshot=await feed.capture();
    const state=await loadRecipeState(h.api),plan=replacementPlan(state,{selectedIds:['six','eight'],sourceName:'Box',targetName:'Paper Cup',quantities:{six:2,eight:3}});
    h.loseNextAck();await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'sample-bulk'}),/Connection/);
    assert.equal((await saveRecipePlan(h.api,plan,{operationId:'sample-bulk'})).status,'already-applied');
    assert.equal(h.get('inventory/box').currentStock,30);assert.equal(h.get('inventory/cup').currentStock,30);
    assert.deepEqual(h.get('transactions/history'),history);assert.equal(h.get('bom/twelve').ingredientName,'Box');
    const newSnapshot=await feed.capture(),engine=createSaleEngine(h.api),base={saleVersion:2,branch:'Maa',orderType:'Take-Out',netTotal:120,localTimestamp:'2026-10-07T03:00:00Z',cart:[{name:'Takoyaki 6 Pcs',qty:2}]};
    const old=await engine.prepare({...base,...oldSnapshot,saleId:'queued-before-edit',receiptId:'old'});
    const next=await engine.prepare({...base,...newSnapshot,saleId:'sold-after-edit',receiptId:'new'});
    await Promise.all(Array.from({length:6},()=>engine.commit(old)));await Promise.all(Array.from({length:6},()=>engine.commit(next)));
    assert.equal(h.get('inventory/box').currentStock,28);assert.equal(h.get('inventory/cup').currentStock,26);
    assert.equal(h.get('transactions/sold-after-edit').recipeVersion,1);assert.deepEqual(h.get('transactions/history'),history);
});
