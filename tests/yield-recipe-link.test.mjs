import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {prepareInventoryYield,saveInventoryYield} from '../takodeal-manager/inventory-yield.js';
import {buildRecipeCostCatalog,summarizeRecipeCosts} from '../takodeal-manager/recipe-cost-model.js';

const cabbage={id:'hq-cabbage',name:'Cabbage',branch:'Main Office',purchaseUom:'Kilo',baseUom:'gram',uom:'gram',conversionRate:1000,baseCost:.1,purchaseCost:100,currentStock:25000};
const measurement={totalCost:100,rawQty:1,netYield:.8};
const recipe=[{ingredientName:'Cabbage',qty:40}];
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'yield-owner',email:OWNER_EMAIL}};h.api.sessionUser={uid:'yield-owner',email:OWNER_EMAIL,cashierName:'Fictional Owner'};
 h.put('hq_managers/owner',{email:OWNER_EMAIL,role:'Owner',permissions:['inventory','menu'],assignedBranch:'All'});
 h.api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 h.put('inventory/hq-cabbage',cabbage);
 h.put('inventory/maa-cabbage',{...cabbage,id:'maa-cabbage',branch:'Maa',purchaseUom:'Bag',conversionRate:500,baseCost:.09,purchaseCost:45,currentStock:3900});
 h.put('inventory/cabantian-cabbage',{...cabbage,id:'cabantian-cabbage',branch:'Cabantian',baseCost:.09,purchaseCost:90,currentStock:-500});
 h.put('menu/meal',{name:'Fictional Takoyaki',price:75,grabPrice:105,foodpandaPrice:105});
 h.put('bom/meal-cabbage',{menuItem:'Fictional Takoyaki',ingredientName:'Cabbage',qty:40});
 const inventory=()=>[...h.docs].filter(([path])=>path.startsWith('inventory/')).map(([path,row])=>({...row,id:path.slice(10)}));
 const cost=basis=>summarizeRecipeCosts(recipe,buildRecipeCostCatalog(inventory(),basis?{basis}:undefined));
 return{...h,inventory,cost};
}

test('a saved HQ yield cost reaches recipes using the HQ basis while shared store costing stays separate',async()=>{
 const f=fixture(),beforeMenu=structuredClone(f.get('menu/meal')),beforeBom=structuredClone(f.get('bom/meal-cabbage'));
 assert.equal(f.cost('Main Office').total,4);assert.ok(Math.abs(f.cost().total-3.6)<1e-10);
 const preview=await prepareInventoryYield(f.api,cabbage,measurement);await saveInventoryYield(f.api,preview);
 assert.equal(f.get('inventory/hq-cabbage').baseCost,.125);assert.equal(f.cost('Main Office').total,5);
 assert.ok(Math.abs(f.cost().total-3.6)<1e-10);assert.deepEqual(f.get('menu/meal'),beforeMenu);assert.deepEqual(f.get('bom/meal-cabbage'),beforeBom);
});

test('explicit shared yield recalculates every store recipe from the same base cost and preserves each purchase conversion',async()=>{
 const f=fixture(),beforeStock=f.inventory().map(row=>[row.id,row.currentStock]),preview=await prepareInventoryYield(f.api,cabbage,measurement,{copyToStores:true});
 await saveInventoryYield(f.api,preview);
 const catalog=buildRecipeCostCatalog(f.inventory());assert.equal(summarizeRecipeCosts(recipe,catalog).total,5);assert.equal(catalog.costs.Cabbage.cost,.125);
 assert.equal(f.get('inventory/maa-cabbage').purchaseCost,62.5);assert.equal(f.get('inventory/cabantian-cabbage').purchaseCost,125);
 assert.deepEqual(f.inventory().map(row=>[row.id,row.currentStock]),beforeStock);assert.equal(f.get('menu/meal').price,75);assert.equal(f.get('bom/meal-cabbage').qty,40);
});

test('a lost save acknowledgement advances the shared recipe revision and records the yield only once',async()=>{
 const f=fixture();f.put('settings/recipe_revision',{version:7,revisionId:'before-yield'});const preview=await prepareInventoryYield(f.api,cabbage,measurement,{copyToStores:true});
 f.loseNextAck();await assert.rejects(saveInventoryYield(f.api,preview),/Connection lost/);const savedRevision=structuredClone(f.get('settings/recipe_revision'));
 assert.equal(savedRevision.version,8);assert.equal(f.cost().total,5);assert.equal((await saveInventoryYield(f.api,preview)).status,'already-applied');
 assert.deepEqual(f.get('settings/recipe_revision'),savedRevision);assert.equal([...f.docs.keys()].filter(path=>path.startsWith('yield_logs/')).length,1);
});
