import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleProductMatchesFilter,categoryBundleDescription,bundleProductSizes,bundleProductMatchesFilling,bundleCategoryFacets} from '../takodeal-manager/bundle-category-ui.js';

test('size filters use the saved size token rather than a letter in a flavor name',()=>{
 assert.equal(bundleProductMatchesFilter('Fruit Shake Mango M','M'),true);
 assert.equal(bundleProductMatchesFilter('Fruit Shake Mango L','M'),false);
 assert.equal(bundleProductMatchesFilter('Milk Tea Matcha XL','L'),false);
 assert.equal(bundleProductMatchesFilter('Milk Tea Matcha XL','XL'),true);
 assert.equal(bundleProductMatchesFilter('Fruit Shake Mango M','mango M'),true);
});
test('piece filters tolerate spacing and exclude a different quantity',()=>{
 assert.equal(bundleProductMatchesFilter('Bonito Takoyaki 8Pcs','8 pcs'),true);
 assert.equal(bundleProductMatchesFilter('Bonito Takoyaki 8 Pcs','8pcs'),true);
 assert.equal(bundleProductMatchesFilter('Bonito Takoyaki 18Pcs','8pcs'),false);
 assert.equal(bundleProductMatchesFilter('Original Takoyaki 6Pcs','8pcs'),false);
 assert.equal(bundleProductMatchesFilter('Bonito Takoyaki 8Pcs','8pcs bonito'),true);
 assert.equal(bundleProductMatchesFilter('Bonito Takoyaki 8Pcs',''),true);
});
test('category draft cards explain quantities and reviewed choices',()=>{
 assert.equal(categoryBundleDescription({slots:[{category:'Takoyaki',qty:1,menuIds:['a','b']},{category:'Fruit Shake',qty:2,menuIds:['c']}]}),'1 × Takoyaki (2 choices) + 2 × Fruit Shake (1 choice)');
});
test('size facets come from product names and normalize piece counts and drink suffixes',()=>{
 assert.deepEqual(bundleProductSizes('Pork Takoyaki 6 Pcs'),['6Pcs']);
 assert.deepEqual(bundleProductSizes('Pork Takoyaki 18Pcs'),['18Pcs']);
 assert.deepEqual(bundleProductSizes('Mango Shake M'),['M']);
 assert.deepEqual(bundleProductSizes('Fries Solo'),['Solo']);
 assert.deepEqual(bundleProductSizes('Milk Tea Large bottle'),[]);
 const facets=bundleCategoryFacets([{name:'Original 8Pcs'},{name:'Pork 6 Pcs'},{name:'Pork 8Pcs'}],['Pork','Bacon','Original','pork']);
 assert.deepEqual(facets,{sizes:['6Pcs','8Pcs'],fillings:['Pork','Original']});
});
test('filling facets use configured whole names present in the category and do not add charges',()=>{
 assert.equal(bundleProductMatchesFilling('Takoyaki Pork 6Pcs','Pork'),true);
 assert.equal(bundleProductMatchesFilling('Takoyaki Porky 6Pcs','Pork'),false);
 assert.equal(bundleProductMatchesFilling('Takoyaki Cream-Cheese 6Pcs','Cream Cheese'),true);
 assert.equal(bundleProductMatchesFilling('Takoyaki Octopus 6Pcs',''),true);
 assert.deepEqual(bundleCategoryFacets([{name:'Mango Shake M'}],['Pork','Bacon']).fillings,[]);
 assert.deepEqual(bundleCategoryFacets([{name:'New Flavor 6Pcs'}],['New Flavor']).fillings,['New Flavor']);
});
