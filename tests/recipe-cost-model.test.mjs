import test from 'node:test';
import assert from 'node:assert/strict';
import {STORE_SHARED_COST_BASIS,buildRecipeCostCatalog,summarizeRecipeCosts} from '../takodeal-manager/recipe-cost-model.js';

const ice=(branch,cost=15,extra={})=>({id:branch+'-ice',name:'Ice Cubes',branch,purchaseUom:'Kilo',baseUom:'gram',uom:'gram',conversionRate:1000,conversion:1000,purchaseCost:cost,cost,baseCost:cost/1000,...extra});
const recipe=[{ingredientName:'Ice Cubes',qty:170}];
test('170 grams uses the explicitly selected store cost and never the highest other-store or HQ cost',()=>{
 const rows=[ice('Main Office',80),ice('Maa',100),ice('Cabantian',15)];
 const cab=buildRecipeCostCatalog(rows,{basis:'Cabantian'}),maa=buildRecipeCostCatalog(rows,{basis:'Maa'});
 assert.equal(summarizeRecipeCosts(recipe,cab).total,2.55);assert.equal(summarizeRecipeCosts(recipe,maa).total,17);assert.equal(cab.basisLabel,'Cabantian');
});
test('shared store costs calculate only when existing store rows agree and exclude independent HQ cost',()=>{
 const catalog=buildRecipeCostCatalog([ice('Main Office',100),ice('Maa'),ice('Cabantian'),ice('Citygate')]);
 assert.equal(catalog.basis,STORE_SHARED_COST_BASIS);assert.equal(catalog.basisLabel,'Stores · shared cost');assert.equal(summarizeRecipeCosts(recipe,catalog).total,2.55);assert.deepEqual(catalog.costs['Ice Cubes'].branches,['Cabantian','Citygate','Maa']);
});
test('different store costs stay unknown until an exact branch is chosen',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa',100),ice('Cabantian',15)]),summary=summarizeRecipeCosts(recipe,catalog);
 assert.equal(summary.valid,false);assert.equal(summary.total,null);assert.match(summary.problems[0],/Store costs differ/);assert.equal(catalog.costs['Ice Cubes'],undefined);
});
test('Main Office is available only as an explicit independent costing basis',()=>{
 const rows=[ice('Main Office',30)];assert.equal(summarizeRecipeCosts(recipe,buildRecipeCostCatalog(rows)).total,null);assert.equal(summarizeRecipeCosts(recipe,buildRecipeCostCatalog(rows,{basis:'Main Office'})).total,5.1);
});
test('shared costs consider saved store rows without inventing a missing branch record',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa'),{...ice('Citygate'),name:'Other ingredient'}]);assert.deepEqual(catalog.costs['Ice Cubes'].branches,['Maa']);assert.equal(summarizeRecipeCosts(recipe,catalog).total,2.55);
});
test('recorded baseCost remains authoritative when a legitimate weighted cost differs from purchase price',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa',100,{baseCost:.015,purchaseCost:100,purchCost:80,cost:90})],{basis:'Maa'});assert.equal(summarizeRecipeCosts(recipe,catalog).total,2.55);
});
test('a real zero base cost remains zero and does not fall back to a purchase price',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa',100,{baseCost:0})]);const summary=summarizeRecipeCosts(recipe,catalog);assert.equal(summary.valid,true);assert.equal(summary.total,0);assert.equal(summary.rows[0].unitCost,0);
});
for(const invalid of [undefined,null,'',NaN,Infinity,-1,'wrong'])test('missing or invalid base cost stays unknown: '+String(invalid),()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa',15,{baseCost:invalid})]);assert.equal(summarizeRecipeCosts(recipe,catalog).total,null);assert.match(catalog.issues['Ice Cubes'],/Base-unit cost/);
});
test('duplicate exact same-name inventory rows in one branch prevent a plausible cost',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa'),ice('Maa',100,{id:'duplicate'})]);assert.equal(summarizeRecipeCosts(recipe,catalog).valid,false);assert.match(catalog.issues['Ice Cubes'],/Duplicate inventory records in Maa/);
});
test('case variants remain separate ingredient links instead of a fuzzy match',()=>{
 const catalog=buildRecipeCostCatalog([{...ice('Maa'),name:'ice cubes'}]);assert.equal(summarizeRecipeCosts(recipe,catalog).total,null);
});
for(const fields of [{baseUom:'gram',uom:'ml'},{purchaseUom:'Kilo',purchUom:'Pack'},{conversionRate:1000,conversion:100},{conversionRate:0},{baseUom:'',uom:''}])test('conflicting or missing saved units are flagged: '+JSON.stringify(fields),()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa',15,fields)]);assert.equal(summarizeRecipeCosts(recipe,catalog).valid,false);assert.match(catalog.issues['Ice Cubes'],/unit|conversion/i);
});
test('safe equivalent unit spellings agree but different base units across stores do not',()=>{
 assert.equal(summarizeRecipeCosts(recipe,buildRecipeCostCatalog([ice('Maa'),ice('Cabantian',15,{baseUom:'grams',uom:'g'})])).total,2.55);
 const catalog=buildRecipeCostCatalog([ice('Maa'),ice('Cabantian',15,{baseUom:'ml',uom:'ml'})]);assert.match(catalog.issues['Ice Cubes'],/Store base units differ/);
});
test('stored recipe unit mismatches, duplicate ingredients and invalid quantities hold totals',()=>{
 const catalog=buildRecipeCostCatalog([ice('Maa')]);
 for(const rows of [[{...recipe[0],uom:'kg'}],[...recipe,...recipe],[{...recipe[0],qty:0}],[{...recipe[0],qty:''}],[{...recipe[0],qty:Infinity}],[]])assert.equal(summarizeRecipeCosts(rows,catalog).total,null);
});
test('a later fresh inventory list recomputes display cost without changing recipe or selling inputs',()=>{
 const rows=structuredClone(recipe),product={price:100,grabPrice:150,foodpandaPrice:155};const before=JSON.stringify({rows,product});
 assert.equal(summarizeRecipeCosts(rows,buildRecipeCostCatalog([ice('Maa',100)])).total,17);assert.equal(summarizeRecipeCosts(rows,buildRecipeCostCatalog([ice('Maa',15)])).total,2.55);assert.equal(JSON.stringify({rows,product}),before);
});
test('unsafe record names are ordinary own keys rather than prototype properties',()=>{
 const row={...ice('Maa'),name:'__proto__'},catalog=buildRecipeCostCatalog([row]);assert.equal(summarizeRecipeCosts([{ingredientName:'__proto__',qty:1}],catalog).total,.015);assert.equal(Object.getPrototypeOf(catalog.costs),null);
});
