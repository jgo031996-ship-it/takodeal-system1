import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateInventoryYield} from '../takodeal-manager/inventory-yield.js';
test('yield holds contradictory unit aliases instead of costing against whichever was read first',()=>{
 const item={id:'sample',purchaseUom:'Kilo',baseUom:'gram',conversionRate:1000};
 const values={totalCost:100,rawQty:2,netYield:1};
 for(const fields of [{uom:'ml'},{purchUom:'Bottle'},{conversion:500}])assert.throws(()=>calculateInventoryYield({...item,...fields},values),/Conflicting/);
 assert.equal(calculateInventoryYield({...item,uom:' Gram ',purchUom:'kilo',conversion:'1000'},values).baseCost,.1);
});
