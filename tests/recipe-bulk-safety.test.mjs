import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadRecipeState,saveRecipePlan,recipePlan,createRecipeBatch,recipeOperationApplied,recipeOperationId,RECIPE_REVISION_ID,operationFor} from '../takodeal-manager/recipe-changes.js';
import {replacementPlan} from '../takodeal-manager/recipe-bulk-model.js';
import {recipeReplacementPreview,installRecipeReplacement} from '../takodeal-manager/recipe-bulk.js';
import {installMenuBulk,menuCsv} from '../takodeal-manager/menu-bulk.js';

function fixture() {
    const h=firestoreHarness();h.api.auth={currentUser:{uid:'manager-1',email:'allowed@test'}};h.api.sessionUser={uid:'manager-1',email:'allowed@test',permissions:['menu','inventory']};
    h.put('hq_managers/access',{email:'allowed@test',pin:'5678',role:'Manager',permissions:['menu','inventory']});
    h.api.getDocFromServer=async ref=>({id:ref.id,ref,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    for(const [id,name] of [['small','Takoyaki 6 Pcs'],['large','Takoyaki 8 Pcs'],['untouched','Takoyaki 12 Pcs']])h.put('menu/'+id,{name,category:'Takoyaki',price:100,image:'preserved.jpg'});
    for(const [id,menuItem,qty] of [['small-row','Takoyaki 6 Pcs',20],['large-row','Takoyaki 8 Pcs',35],['untouched-row','Takoyaki 12 Pcs',50]])h.put('bom/'+id,{menuItem,ingredientName:'Old Sauce',qty});
    for(const branch of ['Main Office','Maa'])for(const [id,name] of [['old','Old Sauce'],['new','New Sauce']])h.put('inventory/'+branch+'-'+id,{branch,name,uom:'gram',currentStock:500});
    h.put('transactions/historical',{receiptId:'old-receipt',netTotal:100,inventoryMovements:[{ingredientName:'Old Sauce',quantity:35,inventoryId:'Maa-old'}]});
    return h;
}
const request={selectedIds:['small','large'],sourceName:'Old Sauce',targetName:'New Sauce'};
const planFor=async h=>replacementPlan(await loadRecipeState(h.api),request);

test('preview retains different pack quantities and shows complete before/after recipes and base units',async()=>{
    const h=fixture(),plan=await planFor(h);assert.deepEqual(plan.affected.map(row=>[row.beforeQty,row.afterQty]),[[20,20],[35,35]]);
    assert.equal(plan.writes.length,2);assert.deepEqual(plan.writes.map(row=>row.id),['small-row','large-row']);
    const html=recipeReplacementPreview(plan);assert.match(html,/Takoyaki 6 Pcs/);assert.match(html,/20 gram/);assert.match(html,/35 gram/);assert.match(html,/Old Sauce/);assert.match(html,/New Sauce/);
    assert.equal(h.get('bom/small-row').ingredientName,'Old Sauce','preview writes nothing');
});

test('atomic replacement touches only selected recipe rows, preserves stocks, prices and historical movements',async()=>{
    const h=fixture(),history=structuredClone(h.get('transactions/historical')),plan=await planFor(h);
    const result=await saveRecipePlan(h.api,plan,{operationId:'selected-sauce'});assert.equal(result.version,1);
    assert.equal(h.get('bom/small-row').ingredientName,'New Sauce');assert.equal(h.get('bom/large-row').qty,35);assert.equal(h.get('bom/untouched-row').ingredientName,'Old Sauce');
    assert.equal(h.get('inventory/Maa-new').currentStock,500);assert.equal(h.get('menu/small').image,'preserved.jpg');assert.deepEqual(h.get('transactions/historical'),history);
    assert.equal(h.get('settings/'+RECIPE_REVISION_ID).revisionId,'selected-sauce');assert.equal(h.get('settings/'+recipeOperationId('selected-sauce')).actorEmail,'allowed@test');
});

test('individual quantities can be edited, while blank/zero/negative/nonfinite values are rejected',async()=>{
    const h=fixture(),state=await loadRecipeState(h.api);assert.equal(replacementPlan(state,{...request,quantities:{large:'30.25'}}).affected[1].afterQty,30.25);
    for(const value of ['',0,-1,'NaN','Infinity'])assert.throws(()=>replacementPlan(state,{...request,quantities:{large:value}}),/positive replacement/);
});

test('duplicate source or destination and ambiguous product/stock identities are rejected before saving',async()=>{
    for(const change of [h=>h.put('bom/duplicate',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Old Sauce',qty:2}),h=>h.put('bom/target',{menuItem:'Takoyaki 6 Pcs',ingredientName:'New Sauce',qty:2}),h=>h.put('menu/duplicate',{name:'Takoyaki 6 Pcs'}),h=>h.put('inventory/duplicate',{branch:'Maa',name:'New Sauce',uom:'gram'})]){
        const h=fixture();change(h);await assert.rejects(planFor(h),/duplicat|already present|unique/i);assert.equal(h.get('settings/'+RECIPE_REVISION_ID),undefined);
    }
});

test('unit mismatch, conflicting branch units, missing replacement stock and nonexact ingredient matches are explicit errors',async()=>{
    const h=fixture();h.put('inventory/Maa-new',{branch:'Maa',name:'New Sauce',uom:'ml'});await assert.rejects(planFor(h),/conflicting base units/);
    h.put('inventory/Main Office-new',{branch:'Main Office',name:'New Sauce',uom:'ml'});await assert.rejects(planFor(h),/base units differ/);
    h.docs.delete('inventory/Maa-new');h.put('inventory/Main Office-new',{branch:'Main Office',name:'New Sauce',uom:'gram'});await assert.rejects(planFor(h),/missing in Maa/);
    await assert.rejects(async()=>replacementPlan(await loadRecipeState(h.api),{...request,sourceName:'old sauce'}),/does not exist/);
});

test('an unrelated unchanged missing ingredient is warned about while a valid replacement can save',async()=>{
    const h=fixture();h.put('bom/legacy-missing',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Missing Octopus',qty:5});
    const plan=await planFor(h);assert.match(plan.warnings.join(' '),/Missing Octopus/);assert.match(recipeReplacementPreview(plan),/Unchanged recipe links/);
    await saveRecipePlan(h.api,plan,{operationId:'fix-sauce-only'});assert.equal(h.get('bom/legacy-missing').ingredientName,'Missing Octopus');assert.equal(h.get('bom/small-row').ingredientName,'New Sauce');
});

test('a deleted source ingredient can be replaced only with explicit target quantities and unit-review preview',async()=>{
    const h=fixture();h.docs.delete('inventory/Main Office-old');h.docs.delete('inventory/Maa-old');const state=await loadRecipeState(h.api);
    assert.throws(()=>replacementPlan(state,request),/explicit replacement quantity/);
    const plan=replacementPlan(state,{...request,quantities:{small:22,large:32}});assert.equal(plan.requiresUnitReview,true);assert.equal(plan.affected[0].sourceUnit,'unit unavailable');
    assert.match(recipeReplacementPreview(plan),/recipeConfirmUnknownUnits/);await saveRecipePlan(h.api,plan,{operationId:'deleted-source'});assert.equal(h.get('bom/large-row').qty,32);
});

test('simultaneous saves from one preview apply exactly one complete replacement and one revision',async()=>{
    const h=fixture(),plan=await planFor(h);const results=await Promise.all(Array.from({length:10},()=>saveRecipePlan(h.api,plan,{operationId:'double-click'})));
    assert.equal(results.filter(row=>row.status==='saved').length,1);assert.equal(h.get('settings/'+RECIPE_REVISION_ID).version,1);assert.equal(h.get('bom/large-row').ingredientName,'New Sauce');
});

test('lost acknowledgments retry with the same marker; changed content cannot reuse that operation ID',async()=>{
    const h=fixture(),plan=await planFor(h);h.loseNextAck();await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'retry'}),/Connection lost/);
    assert.equal((await saveRecipePlan(h.api,plan,{operationId:'retry'})).status,'already-applied');assert.equal(h.get('settings/'+RECIPE_REVISION_ID).version,1);
    await assert.rejects(saveRecipePlan(h.api,{...plan,fingerprint:'different'},{operationId:'retry'}),/different edits/);
});

test('rejected commits preserve every recipe, marker and revision',async()=>{
    const h=fixture(),plan=await planFor(h);h.failNextCommit();await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'fail'}),/Commit rejected/);
    assert.equal(h.get('bom/small-row').ingredientName,'Old Sauce');assert.equal(h.get('bom/large-row').ingredientName,'Old Sauce');assert.equal(h.get('settings/'+RECIPE_REVISION_ID),undefined);
});

test('a coordinated new BOM row, stock rename or another editor revision invalidates a stale preview',async()=>{
    for(const table of ['bom','inventory']){
        const h=fixture(),plan=await planFor(h),state=await loadRecipeState(h.api);
        const writes=table==='bom'?[{table,id:'added',mode:'set',data:{menuItem:'Takoyaki 6 Pcs',ingredientName:'New Sauce',qty:1}}]:[{table,id:'Maa-new',mode:'update',data:{name:'Renamed'}}];
        await saveRecipePlan(h.api,recipePlan(state,writes),{operationId:'other-editor',route:table==='inventory'?'inventory':'menu'});await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'stale'}),/after this preview/);
        assert.equal(h.get('bom/small-row').ingredientName,'Old Sauce');
    }
});

test('changes to affected product/units are held, while normal stock count movements do not stale recipe previews',async()=>{
    const h=fixture(),plan=await planFor(h);h.put('inventory/Maa-new',{...h.get('inventory/Maa-new'),currentStock:450});await saveRecipePlan(h.api,plan,{operationId:'count-safe'});assert.equal(h.get('inventory/Maa-new').currentStock,450);
    for(const change of [h=>h.put('menu/small',{...h.get('menu/small'),name:'Changed'}),h=>h.put('inventory/Maa-new',{...h.get('inventory/Maa-new'),uom:'ml'})]){
        const f=fixture(),p=await planFor(f);change(f);await assert.rejects(saveRecipePlan(f.api,p,{operationId:'metadata-change'}),/affected item changed/);
    }
});

test('fresh permission revocation and identity changes prevent all recipe mutations',async()=>{
    const h=fixture(),plan=await planFor(h);h.put('hq_managers/access',{...h.get('hq_managers/access'),permissions:['dashboard']});await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'revoked'}),/permissions/);
    assert.equal(h.get('bom/small-row').ingredientName,'Old Sauce');h.api.auth.currentUser.uid='different';await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'switched'}),/approved Google account/);
});

test('identity changes inside the transaction callback are held before writes',async()=>{
    const h=fixture(),plan=await planFor(h),run=h.api.runTransaction;
    h.api.runTransaction=(db,callback)=>run(db,async tx=>{h.api.auth.currentUser={uid:'other',email:'other@test'};return callback(tx);});
    await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'during-dialog'}),/account/);assert.equal(h.get('settings/'+RECIPE_REVISION_ID),undefined);
});

test('a freshly blocked HQ account cannot load, save or recover a recipe operation',async()=>{
    const h=fixture(),plan=await planFor(h);h.put('hq_managers/access',{...h.get('hq_managers/access'),blocked:true});
    await assert.rejects(loadRecipeState(h.api),/blocked/);await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'blocked'}),/blocked/);
    await assert.rejects(recipeOperationApplied(h.api,{operationId:'blocked',intent:request}),/blocked/);assert.equal(h.get('settings/'+RECIPE_REVISION_ID),undefined);
});

test('uncoordinated changes to unchanged preview rows are still held before replacement',async()=>{
    const h=fixture();h.put('bom/other',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Missing Octopus',qty:5});const plan=await planFor(h);
    h.put('bom/other',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Missing Octopus',qty:8});await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'stale-other'}),/affected item changed/);assert.equal(h.get('bom/small-row').ingredientName,'Old Sauce');
});

test('existing editor batch adapter coordinates updates/deletes/new rows and retries without duplicate revisions',async()=>{
    const h=fixture(),state=await loadRecipeState(h.api),intent={product:'small',quantity:25};
    const batch=await createRecipeBatch(h.api,{operationId:'editor',revision:state.revision,baseline:state,intent});
    batch.update(h.ref('menu','small'),{price:125});batch.update(h.ref('bom','small-row'),{qty:25});batch.delete(h.ref('bom','large-row'));batch.set(h.ref('bom','new-row'),{menuItem:'Takoyaki 6 Pcs',ingredientName:'New Sauce',qty:5});
    h.loseNextAck();await assert.rejects(batch.commit());assert.equal(await recipeOperationApplied(h.api,{operationId:'editor',intent}),true);assert.equal((await batch.commit()).status,'already-applied');
    assert.equal(h.get('menu/small').price,125);assert.equal(h.get('bom/new-row').qty,5);assert.equal(h.get('bom/large-row'),undefined);assert.equal(h.get('settings/'+RECIPE_REVISION_ID).version,1);
});

test('actual strict CSV upload and legacy alias update BOM atomically, leaving prices/images unrelated data intact',async()=>{
    const h=fixture(),notices=[];h.api.ManagerUI={confirm:async()=>true,notify:text=>notices.push(text)};h.api.invalidateCache=()=>{};h.api.loadMenuEditor=async()=>{};
    const original=globalThis.Swal;globalThis.Swal={fire:()=>{}};
    try{installMenuBulk(h.api);assert.equal(h.api.processBulkUpload,h.api.processRecipeCsvUpload);
        const csv=menuCsv([{id:'small',...h.get('menu/small')}],[{menuItem:'Takoyaki 6 Pcs',ingredientName:'New Sauce',qty:24}]);
        await h.api.processBulkUpload({target:{files:[{text:async()=>csv}],value:'file.csv'}});
        assert.equal(h.get('settings/'+RECIPE_REVISION_ID).version,1);assert.ok([...h.docs.values()].some(row=>row.menuItem==='Takoyaki 6 Pcs' && row.ingredientName==='New Sauce' && row.qty===24));assert.equal(h.get('menu/small').image,'preserved.jpg');assert.equal(notices.length,1);
    }finally{globalThis.Swal=original;}
});

test('actual selection dialog captures input without blur, retains hidden selected quantities and reads final visible edits on Preview',async()=>{
    const h=fixture(),nodes=new Map(),calls=[];
    const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},listeners:{},addEventListener(type,listener){this.listeners[type]=listener;}});return nodes.get(id);};
    const list=element('recipeBulkItems');let quantities=[];
    Object.defineProperty(list,'innerHTML',{set(html){quantities=[...html.matchAll(/data-recipe-qty="([^"]+)" value="([^"]*)"/g)].map(([,id,value])=>({dataset:{recipeQty:id},value}));}});
    list.querySelectorAll=()=>quantities;
    h.api.Swal={fire:options=>new Promise(resolve=>{calls.push({options,resolve});options.didOpen?.();}),showValidationMessage:text=>{throw Error(text);},isLoading:()=>false};
    installRecipeReplacement(h.api,{getElementById:element});const opened=h.api.openRecipeReplacement();
    for(let i=0;i<20 && !calls.length;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
    element('recipeBulkSource').value='Old Sauce';element('recipeBulkSource').listeners.change();element('recipeBulkTarget').value='New Sauce';
    for(const id of ['small','large'])list.listeners.change({target:{dataset:{recipeSelect:id},checked:true}});
    const large=quantities.find(input=>input.dataset.recipeQty==='large');large.value='29';list.listeners.input({target:large});
    element('recipeBulkSearch').value='6 Pcs';element('recipeBulkSearch').listeners.input();
    const small=quantities.find(input=>input.dataset.recipeQty==='small');small.value='22';// No input/change/blur event before Enter/Preview.
    const plan=calls[0].options.preConfirm();assert.deepEqual(plan.affected.map(row=>[row.id,row.afterQty]),[['small',22],['large',29]]);
    calls[0].resolve({isConfirmed:true,value:plan});for(let i=0;i<20 && calls.length<2;i++)await new Promise(resolve=>setImmediate(resolve));assert.match(calls[1].options.html,/29 gram/);
    calls[1].resolve({isConfirmed:false});await opened;assert.equal(h.get('bom/large-row').qty,35,'cancelled preview changes nothing');
});
