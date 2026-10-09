import test from 'node:test';
import assert from 'node:assert/strict';
import {createCountSnapshot,stockReportQuantities} from '../Takodeal-POS/stock-report-units.js';

test('new count snapshots preserve packs plus loose base counts without changing base posting',()=>{
    const snapshot=createCountSnapshot({baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:250,totalBaseQty:1250});
    const row={qty:2000,rawQty:2,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack',physicalStock:1250,systemStock:1500,countSnapshot:snapshot};
    const before=JSON.stringify(row),result=stockReportQuantities(row);
    assert.equal(result.reported.text,'1 Pack + 250 Gram');assert.equal(result.reported.baseText,'1,250 Gram');assert.equal(result.requested.text,'2 Pack');assert.equal(result.system.text,'1.5 Pack');assert.equal(result.conversionSource,'snapshot');assert.equal(JSON.stringify(row),before);
});
test('legacy screenshot quantities recover saved request ratios and show physical count separately',()=>{
    const fixtures=[
        {name:'Chicken Powder',rate:1000,purchase:'Pack',base:'Gram',physical:1000,requested:1,expected:'1 Pack'},
        {name:'F1',rate:50000,purchase:'Sack',base:'Gram',physical:100000,requested:1,expected:'2 Sack'},
        {name:'Paper bowl',rate:50,purchase:'Pack',base:'Piece',physical:200,requested:2,expected:'4 Pack'},
        {name:'Milk',rate:1000,purchase:'Pack',base:'Milliliter',physical:2000,requested:1,expected:'2 Pack'},
        {name:'Ice',rate:1000,purchase:'Kilogram',base:'Gram',physical:36000,requested:5,expected:'36 Kilogram'}
    ];
    for(const item of fixtures) {
        const row={itemName:item.name,qty:item.requested*item.rate,rawQty:item.requested,uom:item.base,purchaseUom:item.purchase,displayUom:item.purchase,physicalStock:item.physical,requestType:'Maintaining Stock (Auto-Fill)'};
        const before=JSON.stringify(row),result=stockReportQuantities(row);assert.equal(result.reported.text,item.expected);assert.equal(result.requested.text,`${item.requested} ${item.purchase}`);assert.equal(result.reported.baseQuantity,item.physical);assert.equal(result.requested.baseQuantity,item.requested*item.rate);assert.equal(result.conversionSource,'saved-request-ratio');assert.equal(JSON.stringify(row),before);
    }
});
test('reporting uses saved ratio/snapshot and cannot depend on later inventory conversion changes',()=>{
    const row={qty:1000,rawQty:1,physicalStock:1000,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack',conversionRate:500};
    assert.equal(stockReportQuantities(row).reported.text,'1 Pack');
    const next={...row,conversionRate:2000,convRate:10000};assert.equal(stockReportQuantities(next).reported.text,'1 Pack');
});
test('physical zero is retained rather than replaced with the positive restock deficit',()=>{
    const result=stockReportQuantities({qty:3000,rawQty:3,physicalStock:0,systemStock:500,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack'});
    assert.equal(result.reported.text,'0 Pack');assert.equal(result.requested.text,'3 Pack');assert.equal(result.system.text,'0.5 Pack');
});
test('missing, zero or invalid ratio cannot label base quantities as packs or guess current catalog rates',()=>{
    for(const rawQty of [undefined,0,'',null,-1,'not-a-count']) {
        const result=stockReportQuantities({qty:1000,rawQty,physicalStock:1000,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack',conversionRate:1000});
        assert.equal(result.reported.text,'1,000 Gram');assert.equal(result.reported.baseQuantity,1000);assert.equal(result.conversionSource,'unavailable');assert.ok(result.warnings.length);
    }
});
test('a request without physical metadata is not presented as an actual reported count',()=>{
    const row={qty:50000,rawQty:1,uom:'Gram',purchaseUom:'Sack',displayUom:'Sack'};const result=stockReportQuantities(row);
    assert.equal(result.reported,null);assert.equal(result.requested.text,'1 Sack');
    const display=stockReportQuantities({qty:1000,uom:'Gram',displayQty:1,displayUom:'Pack'});assert.equal(display.reported,null);assert.equal(display.requested.text,'1 Pack');assert.equal(display.requested.baseQuantity,1000);
});
test('ordinary base-unit request and base selected mode retain matching quantities/units',()=>{
    assert.equal(stockReportQuantities({qty:2,uom:'Pack'}).requested.text,'2 Pack');
    const result=stockReportQuantities({qty:1250,rawQty:1250,selectedUom:'base',physicalStock:1000,uom:'Gram',purchaseUom:'Pack',displayUom:'Gram'});
    assert.equal(result.reported.text,'1,000 Gram');assert.equal(result.requested.text,'1,250 Gram');
});
test('invalid or conflicting snapshots fall back to retained base stock without rewriting history',()=>{
    const row={qty:1000,rawQty:1,physicalStock:2000,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack',countSnapshot:{version:1,baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:0,totalBaseQty:1000}};
    const result=stockReportQuantities(row);assert.equal(result.reported.text,'2,000 Gram');assert.equal(result.conversionSource,'unavailable');assert.match(result.warnings[0],/inconsistent/);
});
test('snapshot rejects negative/nonfinite/inconsistent counts before any save',()=>{
    const valid={baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:0,totalBaseQty:1000};
    for(const patch of [{purchaseCount:-1},{baseCount:Infinity},{conversionRate:0},{totalBaseQty:1},{baseUom:''},{purchaseUom:null}])assert.throws(()=>createCountSnapshot({...valid,...patch}),/Check the count/);
    assert.throws(()=>createCountSnapshot({...valid,baseUom:'Pack'}),/same name/);
});
test('zero/loose-only snapshot and numeric-string legacy values remain readable',()=>{
    const snapshot=createCountSnapshot({baseUom:'Piece',purchaseUom:'Pack',conversionRate:50,purchaseCount:0,baseCount:0,totalBaseQty:0});
    assert.equal(stockReportQuantities({physicalStock:0,qty:100,rawQty:2,countSnapshot:snapshot}).reported.text,'0 Piece');
    assert.equal(stockReportQuantities({physicalStock:'150',qty:'100',rawQty:'2',uom:'Piece',purchaseUom:'Pack',displayUom:'Pack'}).reported.text,'3 Pack');
});
test('same-unit count components add together rather than hiding the first component',()=>{
    const countSnapshot=createCountSnapshot({baseUom:'Piece',purchaseUom:'Piece',conversionRate:1,purchaseCount:2,baseCount:3,totalBaseQty:5});
    assert.equal(stockReportQuantities({physicalStock:5,countSnapshot}).reported.text,'5 Piece');
});
test('legacy same-name base and purchase units cannot recover a conflicting package conversion',()=>{
    const row={qty:1000,rawQty:1,physicalStock:1000,systemStock:1500,uom:'Pack',purchaseUom:' pack ',displayUom:'Pack'},before=JSON.stringify(row);
    const result=stockReportQuantities(row);
    assert.equal(result.conversionSource,'unavailable');assert.equal(result.reported.text,'1,000 Pack');assert.equal(result.requested.text,'1,000 Pack');assert.equal(result.system.text,'1,500 Pack');
    assert.match(result.warnings.join(' '),/same name.*quantities disagree/);assert.equal(JSON.stringify(row),before);
    const coherent=stockReportQuantities({...row,qty:1});assert.equal(coherent.conversionSource,'saved-request-ratio');assert.equal(coherent.requested.text,'1 Pack');assert.deepEqual(coherent.warnings,[]);
    const overflow=stockReportQuantities({...row,qty:1e308,rawQty:1e-308});assert.equal(overflow.conversionSource,'unavailable');assert.match(overflow.warnings.join(' '),/quantities disagree/);
});
