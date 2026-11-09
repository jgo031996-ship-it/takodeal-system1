import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecipeCostCatalog,summarizeRecipeCosts} from '../takodeal-manager/recipe-cost-model.js';
import {recipeReviewRows,installRecipeReviewUI} from '../takodeal-manager/recipe-review.js';
import {ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
const stock=(branch='Maa',extra={})=>({id:branch+'-flour',branch,name:'Flour',baseUom:'gram',uom:'gram',baseCost:.02,...extra});
function fixture(){
 const document=new ReviewDocument(),create=document.createElement.bind(document);document.createElement=tag=>{const node=create(tag);node.remove=()=>{if(node.parentElement){node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=null;}};node.after=other=>{other.parentElement=node.parentElement;node.parentElement.children.splice(node.parentElement.children.indexOf(node)+1,0,other);};return node;};document.querySelectorAll=selector=>document.body.querySelectorAll(selector);const summary=document.createElement('div');summary.id='menuWorkspaceSummary';document.body.append(summary);
 const menu=[{id:'missing',name:'Needs <recipe>'},{id:'good',name:'Good'}],recipes=[{menuItem:'Good',ingredientName:'Flour',qty:25}],catalog=buildRecipeCostCatalog([stock()]),edits=[],notifications=[],reads=[],w={auth:{currentUser:{uid:'hq-owner',email:'owner@example.test'}},sessionUser:{uid:'hq-owner',email:'owner@example.test',role:'Owner',permissions:['menu'],allowedBranches:['All']},globalMenuItemsCache:menu,menuRecipeRows:recipes,recipeCostUI:{recipeSummary:rows=>summarizeRecipeCosts(rows,catalog)},renderMenuEditorUI(){},editMenuItem:id=>edits.push(id),invalidateCache:table=>reads.push(table),loadMenuEditor:async()=>{},ManagerUI:{notify:text=>notifications.push(text)}};
 const controller=installRecipeReviewUI(w,document);return {w,document,controller,menu,recipes,edits,notifications,reads,dialog:()=>document.querySelector('dialog'),button:text=>document.querySelectorAll('button').find(node=>node.textContent===text)};
}
test('review reasons distinguish duplicate/cost-basis inventory issues from missing recipe quantities without inventing repairs',()=>{
 const menu=[{id:'x',name:'Drink'}],recipe=[{menuItem:'Drink',ingredientName:'Flour',qty:25}],duplicate=buildRecipeCostCatalog([stock(),stock('Maa',{id:'duplicate'})]);
 const warnings=recipeReviewRows(menu,recipe,rows=>summarizeRecipeCosts(rows,duplicate));assert.equal(warnings[0].kind,'Stock / cost review');assert.match(warnings[0].reasons[0],/Duplicate inventory/);
 const missing=recipeReviewRows(menu,[],rows=>summarizeRecipeCosts(rows,duplicate));assert.equal(missing[0].kind,'Recipe review');assert.deepEqual(missing[0].reasons,['No recipe ingredients are recorded']);
 const differing=buildRecipeCostCatalog([stock(),stock('Citygate',{baseCost:.04})]);assert.match(recipeReviewRows(menu,recipe,rows=>summarizeRecipeCosts(rows,differing))[0].reasons[0],/Store costs differ/);
});
test('the actual review uses safe text, preserves recipe/price data and opens only the existing explicit editor',async()=>{
 const f=fixture(),before=structuredClone([f.menu,f.recipes]);assert.match(f.document.getElementById('reviewRecipeWarnings').textContent,/1/);f.controller.open();assert.match(f.dialog().textContent,/Needs <recipe>/);assert.match(f.dialog().textContent,/No recipe ingredients/);assert.equal(f.dialog().querySelector('script'),null);assert.deepEqual(f.edits,[]);assert.deepEqual([f.menu,f.recipes],before);
 f.button('Review item & recipe').click();await drain();assert.deepEqual(f.edits,['missing']);assert.equal(f.dialog(),null);assert.deepEqual(f.reads,[]);
});
test('an account/permission change or replaced menu identity cannot open a stale recipe editor',()=>{
 const f=fixture();f.controller.open();const button=f.button('Review item & recipe');f.w.sessionUser={...f.w.sessionUser,permissions:[]};button.click();assert.deepEqual(f.edits,[]);assert.equal(f.dialog(),null);
 f.w.sessionUser={...f.w.sessionUser,permissions:['menu']};f.controller.open();f.menu[0].name='Renamed';f.button('Review item & recipe').click();assert.deepEqual(f.edits,[]);assert.match(f.notifications.at(-1),/changed/);
});
test('an explicit refresh invalidates only menu/recipe/inventory caches and cancels on a changed account',async()=>{
 const f=fixture(),gate=deferred();f.w.loadMenuEditor=()=>gate.promise;f.controller.open();f.button('Refresh menu and costs').click();await drain();assert.deepEqual(f.reads,['menu','bom','inventory']);f.w.auth.currentUser={uid:'different',email:'different@example.test'};gate.resolve();await drain();assert.equal(f.dialog(),null);assert.deepEqual(f.edits,[]);assert.deepEqual(f.recipes,[{menuItem:'Good',ingredientName:'Flour',qty:25}]);
});
test('valid recipes do not enter the queue and stale unverified costs remain honestly labeled',()=>{
 const catalog=buildRecipeCostCatalog([stock()]);assert.deepEqual(recipeReviewRows([{id:'good',name:'Good'}],[{menuItem:'Good',ingredientName:'Flour',qty:25}],rows=>summarizeRecipeCosts(rows,catalog)),[]);
 const unknown=recipeReviewRows([{id:'x',name:'X'}],[],()=>({valid:false,problems:['Refresh inventory costs to verify this estimate.']}));assert.deepEqual(unknown[0].reasons,['Refresh inventory costs to verify this estimate.']);
});
