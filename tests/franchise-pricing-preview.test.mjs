import test from 'node:test';
import assert from 'node:assert/strict';
import {franchisePricingPreview} from '../takodeal-manager/franchise-supply-pricing.js';

const target={id:'sauce',name:'Sauce',branch:'Main Office',baseCost:.5,conversionRate:1000};
const ingredient={id:'ingredient',name:'Ingredient',branch:'Main Office',baseCost:2};
const recipe={id:'recipe',menuItem:'Sauce',ingredientName:'Ingredient',qty:50};

test('supply-price preview shows saved cost without silently setting an empty markup',()=>{
 const view=franchisePricingPreview(target,[],[],'','recorded');
 assert.equal(view.cost,500);
 assert.equal(view.quote,null);
 assert.equal(Object.hasOwn(target,'franchiseMarkupPercent'),false);
 assert.equal(franchisePricingPreview(target,[],[],0,'recorded').quote.unitPrice,500);
});

test('pricing preview and comparisons both follow the chosen saved cost basis',()=>{
 const recorded=franchisePricingPreview(target,[target,ingredient],[recipe],25,'recorded');
 const bom=franchisePricingPreview(target,[target,ingredient],[recipe],25,'bom');
 assert.equal(recorded.cost,500);
 assert.equal(recorded.quote.unitPrice,625);
 assert.equal(bom.cost,100);
 assert.equal(bom.quote.unitPrice,125);
 assert.equal(bom.scenarios.find(q=>q.markupPercent===25).unitPrice,bom.quote.unitPrice);
 assert.equal(target.baseCost,.5);
});

test('pricing preview does not fabricate a quote for invalid costs, recipes or markups',()=>{
 assert.throws(()=>franchisePricingPreview(target,[],[],-1,'recorded'),/Owner-approved/);
 assert.throws(()=>franchisePricingPreview(target,[],[],301,'recorded'),/Owner-approved/);
 assert.throws(()=>franchisePricingPreview(target,[],[],25,'bom'),/No saved BOM/);
 assert.throws(()=>franchisePricingPreview({...target,baseCost:null},[],[],25,'recorded'),/cost is missing/);
});
