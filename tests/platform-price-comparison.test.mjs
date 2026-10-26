import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlatformPriceReport,PLATFORM_PRICE_BASIS,PLATFORM_PRICE_DISCOUNT_BASIS} from '../takodeal-manager/platform-price-comparison.js';

const product=(patch={})=>({id:'sample-food',name:'Sample Takoyaki 6 Pcs',price:75,basePrice:75,grabPrice:105,foodpandaPrice:110,...patch});
const ingredient=(name='Batter',patch={})=>({id:'sample-'+name,branch:'Maa',name,baseUom:'gram',uom:'gram',purchaseUom:'Pack',purchUom:'Pack',conversionRate:1000,conversion:1000,purchaseCost:100,baseCost:2,...patch});
const item=(patch={})=>({name:'Sample Takoyaki 6 Pcs',realName:'Sample Takoyaki 6 Pcs',qty:1,basePrice:105,variantPrice:105,lineTotalFinal:105,discountType:'none',discountVal:0,addons:{},...patch});
const sale=(patch={})=>({id:'sample-sale',receiptId:'SAMPLE-ORDER',branch:'Maa',paymentMethod:'Grab',orderType:'Grab',netTotal:105,subTotalBeforeDiscount:105,globalDiscountType:'none',globalDiscountValue:0,globalDiscountAmount:0,cart:[item()],...patch});
const catalog=(patch={})=>({menu:[product()],inventory:[ingredient(),ingredient('Sauce',{baseCost:1})],recipes:[{menuItem:'Sample Takoyaki 6 Pcs',ingredientName:'Batter',qty:5}],...patch});
const report=(rows=[sale()],data=catalog())=>buildPlatformPriceReport(rows,data);
const first=(saved=sale(),data=catalog())=>report([saved],data).rows[0];
const cents=value=>Math.round(value*100);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

for(const [paymentMethod,charged]of [['Grab',105],['Foodpanda',110],[' foodpanda ',110],['panda',110]])test('compares '+paymentMethod+' at standard price while retaining its actual saved platform total',()=>{
 const saved=sale({paymentMethod,netTotal:charged,subTotalBeforeDiscount:charged,cart:[item({basePrice:charged,variantPrice:charged,lineTotalFinal:charged})]}),row=first(saved);
 assert.equal(row.included,true);assert.equal(row.platform,paymentMethod.trim().toLowerCase()==='grab'?'Grab':'Foodpanda');assert.equal(row.source,saved);assert.equal(row.id,saved.id);
 assert.equal(row.recordedSubtotal,charged);assert.equal(row.recordedTotal,charged);assert.equal(row.baseSales,75);assert.equal(row.priceDifference,charged-75);assert.equal(row.cogs,10);assert.equal(row.afterCogs,65);assert.equal(row.basis,PLATFORM_PRICE_BASIS);assert.deepEqual(row.priceIssues,[]);assert.deepEqual(row.costIssues,[]);
});

test('the report is read-only, its current-price estimate changes with the current catalog, and payout fields do not enter its calculations',()=>{
 const saved=freeze(sale({amountReceived:105,platformCommission:30,actualPayout:50,payoutReceived:50})),data=freeze(catalog()),before=JSON.stringify({saved,data});
 assert.equal(first(saved,data).baseSales,75);assert.equal(first(saved,catalog({menu:[product({price:80,basePrice:80})]})).baseSales,80);
 assert.equal(first(saved,data).afterCogs,65);assert.equal(JSON.stringify({saved,data}),before);assert.match(PLATFORM_PRICE_DISCOUNT_BASIS,/payouts are separate/);
});

test('free standard products and real zero ingredient costs remain valid zeros rather than falling back to platform or HQ prices',()=>{
 const row=first(sale({netTotal:0,subTotalBeforeDiscount:0,cart:[item({variantPrice:0,basePrice:0,lineTotalFinal:0})]}),catalog({menu:[product({price:0,basePrice:0})],inventory:[ingredient('Batter',{baseCost:0}),ingredient('Batter',{id:'hq',branch:'Main Office',baseCost:99})]}));
 assert.equal(row.baseSales,0);assert.equal(row.recordedTotal,0);assert.equal(row.priceDifference,0);assert.equal(row.cogs,0);assert.equal(row.afterCogs,0);
});

test('saved addon counts multiply the parent quantity once and percentage discounts apply at the line and order levels once',()=>{
 const cart=[item({qty:3,lineTotalFinal:310.5,discountType:'percentage',discountVal:10,addons:{Sauce:{name:'Sauce',price:5,qty:2,linkedIngredient:'Sauce',deductQty:2}}})];
 const row=first(sale({cart,subTotalBeforeDiscount:310.5,globalDiscountType:'percentage',globalDiscountValue:20,globalDiscountAmount:62.1,netTotal:248.4}));
 assert.equal(row.items[0].savedAddonTotal,10);assert.equal(row.items[0].currentBaseUnitPrice,75);assert.equal(row.baseSales,183.6);assert.equal(row.priceDifference,64.8);assert.equal(row.cogs,42);assert.equal(row.afterCogs,141.6);assert.equal(row.items[0].recordedLineTotal,310.5);assert.equal(row.items[0].recordedLineNet,248.4);
});

test('fixed discounts are reapplied and capped at zero without reducing physical ingredient cost',()=>{
 const row=first(sale({cart:[item({discountType:'fixed',discountVal:10,lineTotalFinal:95})],subTotalBeforeDiscount:95,globalDiscountType:'fixed',globalDiscountValue:90,globalDiscountAmount:90,netTotal:5}));
 assert.equal(row.recordedSubtotal,95);assert.equal(row.recordedTotal,5);assert.equal(row.baseSales,0);assert.equal(row.priceDifference,5);assert.equal(row.cogs,10);assert.equal(row.afterCogs,-10);
});

test('once-only order discounts allocate exact cents across saved lines and all public detail totals sum to their receipt',()=>{
 const row=first(sale({cart:[item({notes:'First portion'}),item({notes:'Second portion'})],subTotalBeforeDiscount:210,globalDiscountType:'fixed',globalDiscountValue:.01,globalDiscountAmount:.01,netTotal:209.99}));
 assert.equal(row.baseSales,149.99);assert.deepEqual(row.items.map(item=>item.baseSales),[74.99,75]);assert.equal(row.priceDifference,60);assert.equal(row.cogs,20);assert.equal(row.afterCogs,129.99);
 for(const field of ['baseSales','priceDifference','cogs','afterCogs'])assert.equal(row.items.reduce((sum,item)=>sum+cents(item[field]),0),cents(row[field]),field);
 assert.equal(row.items.reduce((sum,item)=>sum+cents(item.recordedLineNet),0),cents(row.recordedTotal));
});

test('missing or duplicate current product names cannot use the misleading saved cart basePrice as a standard-price snapshot',()=>{
 for(const menu of [[],[product(),product({id:'duplicate',price:90,basePrice:90})],[product({name:'sample takoyaki 6 pcs'})]]){
  const row=first(sale(),catalog({menu}));assert.equal(row.recordedTotal,105);assert.equal(row.baseSales,null);assert.equal(row.priceDifference,null);assert.equal(row.cogs,10);assert.equal(row.afterCogs,null);assert.ok(row.priceIssues.length);
 }
});

test('a unique explicit menu ID supports a renamed product and disambiguates equal names without guessing an absent or duplicate ID',()=>{
 const saved=sale({cart:[item({menuId:'renamed-food'})]}),renamed=product({id:'renamed-food',name:'Renamed current food'}),data=catalog({menu:[renamed],recipes:[{menuItem:renamed.name,ingredientName:'Batter',qty:5}]});
 assert.equal(first(saved,data).baseSales,75);assert.equal(first(saved,data).cogs,10);
 const duplicateNames=catalog({menu:[product(),product({id:'other-food',price:90,basePrice:90})]});assert.equal(first(sale({cart:[item({menuId:'sample-food'})]}),duplicateNames).baseSales,75);
 for(const menu of [[],[product({id:'renamed-food'}),product({id:'renamed-food'})]])assert.equal(first(saved,catalog({menu})).baseSales,null);
 assert.equal(first(sale({cart:[item({menuId:'sample-food',menuItemId:'other-food'})]})).baseSales,null);
});

test('missing, conflicting, negative or fractional-cent standard prices stay unknown while original totals are retained',()=>{
 for(const patch of [{price:undefined,basePrice:undefined},{price:null,basePrice:null},{price:''},{price:-1,basePrice:-1},{price:Infinity,basePrice:Infinity},{price:75,basePrice:76},{price:75.005,basePrice:75.005}]){
  const row=first(sale(),catalog({menu:[product(patch)]}));assert.equal(row.recordedTotal,105);assert.equal(row.baseSales,null);assert.equal(row.cogs,10);assert.ok(row.priceIssues.length);
 }
});

test('missing recipes, missing branch stock, duplicate inventory and incompatible saved units never become a zero cost or HQ fallback',()=>{
 const cases=[catalog({recipes:[]}),catalog({inventory:[]}),catalog({inventory:[ingredient('Batter',{branch:'Main Office'})]}),catalog({inventory:[ingredient(),ingredient('Batter',{id:'duplicate'})]}),catalog({inventory:[ingredient('Batter',{baseUom:'gram',uom:'ml'})]}),catalog({inventory:[ingredient('Batter',{baseCost:null})]}),catalog({recipes:[{menuItem:product().name,ingredientName:'Batter',qty:5,uom:'kg'}]}),catalog({recipes:[{menuItem:product().name,ingredientName:'Batter',qty:5},{menuItem:product().name,ingredientName:'Batter',qty:1}]})];
 for(const data of cases){const row=first(sale(),data);assert.equal(row.baseSales,75);assert.equal(row.cogs,null);assert.equal(row.afterCogs,null);assert.ok(row.costIssues.length);}
 const noBranch=first(sale({branch:''}));assert.equal(noBranch.cogs,null);assert.ok(noBranch.costIssues.some(issue=>issue.includes('branch')));
});

test('saved filling and extra ingredient links contribute cost even when their saved price is zero',()=>{
 const row=first(sale({cart:[item({addons:{Filling:{price:0,qty:2,linkedIngredient:'Sauce',deductQty:3}}})]}));
 assert.equal(row.baseSales,75);assert.equal(row.cogs,16);assert.equal(row.afterCogs,59);
});

test('unknown addon price affects pricing and unknown ingredient use affects costing independently',()=>{
 const missingPrice=first(sale({cart:[item({addons:{Sauce:{qty:1,linkedIngredient:'Sauce',deductQty:2}}})]}));assert.equal(missingPrice.baseSales,null);assert.equal(missingPrice.cogs,12);
 const missingCost=first(sale({cart:[item({lineTotalFinal:110,addons:{Sauce:{qty:1,price:5}}})],subTotalBeforeDiscount:110,netTotal:110}));assert.equal(missingCost.baseSales,80);assert.equal(missingCost.cogs,null);
 const invalid=first(sale({cart:[item({addons:[]})]}));assert.equal(invalid.baseSales,null);assert.equal(invalid.cogs,null);
});

test('cancelled originals, separate cancelled-food purchases, unpaid and pending orders are excluded without hiding the original recorded amount',()=>{
 const patches=[{status:'Voided'},{status:'Cancelled'},{status:'Parked'},{status:'Draft'},{status:'Pending Sync'},{status:'Unpaid'},{paymentStatus:'unpaid'},{isPendingSync:true},{preparedCancellation:{prepared:true}},{cancelledFoodSourceId:'original',paymentMethod:'Salary Deduction',sourcePlatform:'Grab'},{status:'mystery'},{paymentMethod:'Cash',orderType:'Dine-In'}];
 for(const patch of patches){const row=first(sale(patch));assert.equal(row.included,false);assert.equal(row.recordedTotal,105);assert.equal(row.baseSales,null);assert.equal(row.cogs,null);assert.ok(row.exclusionReason);}
 const summary=report(patches.map((patch,i)=>sale({...patch,id:'excluded-'+i}))).summary;assert.equal(summary.includedCount,0);assert.equal(summary.excludedCount,patches.length);assert.equal(summary.recordedTotal,0);assert.equal(summary.baseSales,0);
});

test('normal legacy receipts with missing status remain included and missing item detail stays explicitly unknown',()=>{
 const legacy=sale();delete legacy.status;assert.equal(first(legacy).included,true);
 const missing=first(sale({cart:[]}));assert.equal(missing.included,true);assert.equal(missing.recordedTotal,105);assert.equal(missing.baseSales,null);assert.equal(missing.cogs,null);assert.match(missing.priceIssues.join(' '),/No saved item breakdown/);
 for(const qty of [undefined,0,-1,true,'',Infinity]){const row=first(sale({cart:[item({qty})]}));assert.equal(row.baseSales,null);assert.equal(row.cogs,null);}
});

test('invalid or inconsistent saved discount rules hold the price comparison without altering the known recorded amount or cost',()=>{
 const patches=[{globalDiscountType:'staff_meal',globalDiscountValue:10,globalDiscountAmount:10,netTotal:95},{globalDiscountType:'percentage',globalDiscountValue:undefined},{globalDiscountType:'percentage',globalDiscountValue:110},{globalDiscountType:'none',globalDiscountAmount:5},{globalDiscountType:'percentage',globalDiscountValue:10,globalDiscountAmount:1,netTotal:104},{subTotalBeforeDiscount:1}];
 for(const patch of patches){const saved=sale(patch),row=first(saved);assert.equal(row.recordedTotal,saved.netTotal);assert.equal(row.baseSales,null);assert.equal(row.cogs,10);assert.ok(row.priceIssues.length);}
 for(const patch of [{discountType:'percentage',discountVal:undefined},{discountType:'fixed',discountVal:-1},{discountType:'unknown',discountVal:10},{discountType:'percentage',discountVal:10,lineTotalFinal:105}])assert.equal(first(sale({cart:[item(patch)]})).baseSales,null);
});

test('valid platform splits keep receipt totals intact while malformed, unpaid and mismatched split details do not claim a complete comparison',()=>{
 const valid=first(sale({paymentMethod:'Split (Grab & Cash)',splitDetails:[{method:'Grab',amount:75},{method:'Cash',amount:30}]}));assert.equal(valid.platform,'Grab');assert.equal(valid.recordedTotal,105);assert.equal(valid.baseSales,75);
 for(const splitDetails of [[],null,[{method:'Grab',amount:100}],[{method:'Grab',amount:105},{method:'Cash',amount:-1}],[{method:'Unpaid',amount:105}],[{method:'Cash',amount:105}]]){const row=first(sale({splitDetails}));assert.equal(row.recordedTotal,105);assert.equal(row.baseSales,null);assert.equal(row.cogs,10);assert.match(row.priceIssues.join(' '),/split/i);}
});

test('summary completeness and matched populations never subtract unrelated partial price and cost totals',()=>{
 const missingPriceName='Missing current product',missingCostName='No current recipe';
 const rows=[sale(),sale({id:'price-unknown',netTotal:90,subTotalBeforeDiscount:90,cart:[item({name:missingPriceName,realName:missingPriceName,qty:2,variantPrice:45,basePrice:45,lineTotalFinal:90})]}),sale({id:'cost-unknown',netTotal:40,subTotalBeforeDiscount:40,cart:[item({name:missingCostName,realName:missingCostName,variantPrice:40,basePrice:40,lineTotalFinal:40})]})];
 const data=catalog();data.menu.push(product({id:'no-recipe',name:missingCostName,price:30,basePrice:30}));data.recipes.push({menuItem:missingPriceName,ingredientName:'Batter',qty:5});
 const summary=report(rows,data).summary;
 assert.equal(summary.includedCount,3);assert.equal(summary.completeCount,1);assert.equal(summary.priceIncompleteCount,1);assert.equal(summary.costIncompleteCount,1);assert.equal(summary.recordedTotal,235);assert.equal(summary.baseSales,null);assert.equal(summary.cogs,null);assert.equal(summary.afterCogs,null);assert.equal(summary.priceDifference,null);
 assert.deepEqual(summary.known,{recordedTotal:235,baseSales:105,cogs:30,priceDifference:40,afterCogs:65});assert.deepEqual(summary.knownCounts,{recordedTotal:3,baseSales:2,cogs:2,priceDifference:2,afterCogs:1});
 assert.deepEqual(summary.matched.price,{count:2,recordedTotal:145,baseSales:105,priceDifference:40});assert.deepEqual(summary.matched.margin,{count:1,baseSales:75,cogs:10,afterCogs:65});
});

test('missing actual totals remain unknown and cannot be silently fabricated from the current menu',()=>{
 const row=first(sale({netTotal:null}));assert.equal(row.included,true);assert.equal(row.recordedTotal,null);assert.equal(row.baseSales,null);assert.equal(row.priceDifference,null);assert.equal(row.cogs,10);assert.equal(report([sale({netTotal:null})]).summary.recordedIncompleteCount,1);
});

test('empty reports have complete zero totals with no orders and invalid source lists are refused',()=>{
 const result=report([]);assert.equal(result.summary.includedCount,0);assert.equal(result.summary.baseSales,0);assert.equal(result.summary.afterCogs,0);assert.equal(result.summary.knownCounts.baseSales,0);
 for(const input of [null,{},[null]])assert.throws(()=>buildPlatformPriceReport(input,catalog()),/requires|invalid/);
});
