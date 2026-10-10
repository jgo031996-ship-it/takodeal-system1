import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDispatchRestockEstimates,renderDispatchRestockEstimates} from '../takodeal-manager/dispatch-restock-finance.js';

const start = new Date('2026-10-01T00:00:00+08:00'), end = new Date('2026-10-31T23:59:59.999+08:00');
const item = changes => ({name:'Flour',restockQty:3000,baseUom:'g',purchaseQty:3,purchaseUom:'Pack',estimatedSubtotal:150,correctionQty:500,...changes});
const row = changes => ({id:'restock-one',dispatchAutoRestock:true,dispatchBatchId:'dispatch-one',toBranch:'Maa',timestamp:new Date('2026-10-10T08:00:00+08:00'),totalCost:150,costStatus:'Estimated',items:[item()],...changes});
const collect = (rows, options = {}) => collectDispatchRestockEstimates(rows,{start,end,branch:'All',...options});
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('only explicitly linked automatic restocks appear; ordinary invoices and missing links do not change totals',()=>{
    const result=collect([row(),row({dispatchAutoRestock:false,dispatchBatchId:'manual'}),row({dispatchAutoRestock:'true',dispatchBatchId:'string-flag'}),row({dispatchBatchId:''}),{totalCost:999}]);
    assert.equal(result.recordCount,1);assert.equal(result.itemCount,1);assert.equal(result.totalEstimatedCost,150);assert.equal(result.knownEstimatedTotal,150);
});

test('period is inclusive, supports actual Firestore timestamps and omits undated or malformed rows',()=>{
    const result=collect([row({dispatchBatchId:'at-start',timestamp:{toDate:()=>start}}),row({dispatchBatchId:'at-end',timestamp:{seconds:Math.floor(end.getTime()/1000),nanoseconds:999000000}}),
        row({dispatchBatchId:'before',timestamp:new Date(start.getTime()-1)}),row({dispatchBatchId:'after',timestamp:{toMillis:()=>end.getTime()+1}}),row({dispatchBatchId:'undated',timestamp:null}),row({dispatchBatchId:'invalid',timestamp:{toDate(){throw Error('bad timestamp');}}})]);
    assert.deepEqual(result.records.map(record=>record.dispatchBatchId),['at-end','at-start']);assert.equal(result.totalEstimatedCost,300);
});

test('All and Main Office include every HQ-origin estimate while a destination filter stays exact',()=>{
    const rows=[row(),row({dispatchBatchId:'city',toBranch:'Citygate'}),row({dispatchBatchId:'prefix',toBranch:'Maa Annex'})];
    assert.equal(collect(rows).recordCount,3);assert.equal(collect(rows,{branch:'Main Office'}).recordCount,3);
    assert.equal(collect(rows,{branch:'Maa'}).recordCount,1);assert.equal(collect(rows,{branch:'Citygate'}).recordCount,1);assert.equal(collect(rows,{branch:'Unknown'}).recordCount,0);
});

test('unknown item cost holds the full total but retains an explicitly partial known-price subtotal',()=>{
    const result=collect([row(),row({dispatchBatchId:'unknown',totalCost:null,costStatus:'Needs price review',items:[item({estimatedSubtotal:20}),item({name:'Tea',estimatedSubtotal:null})]})]);
    assert.equal(result.totalEstimatedCost,null);assert.equal(result.hasUnknownCosts,true);assert.equal(result.knownEstimatedTotal,170);assert.equal(result.pricedRecordCount,1);assert.equal(result.needsPriceReviewCount,1);
    const html=renderDispatchRestockEstimates(result);assert.match(html,/Complete estimate unavailable/);assert.match(html,/partial subtotal/);assert.match(html,/₱170\.00/);assert.match(html,/Unpriced items are excluded; they are not valued at zero/);
});

test('unknown, invalid, blank and numeric-string prices remain unknown; a saved numeric zero remains distinguishable',()=>{
    for(const price of [null,undefined,NaN,Infinity,-1,'','150']) {
        const result=collect([row({totalCost:price,items:[item({estimatedSubtotal:price})]})]);
        assert.equal(result.totalEstimatedCost,null);assert.equal(result.needsPriceReviewCount,1);assert.equal(result.records[0].items[0].estimatedSubtotal,null);
    }
    const zero=collect([row({totalCost:0,items:[item({estimatedSubtotal:0})]})]);assert.equal(zero.totalEstimatedCost,0);assert.equal(zero.hasUnknownCosts,false);
});

test('incomplete status, inconsistent total and missing quantity cannot silently become complete estimates',()=>{
    for(const record of [row({costStatus:'Needs price review'}),row({totalCost:151}),row({items:[]}),row({items:[item({restockQty:null})]})]) {
        assert.equal(collect([record]).totalEstimatedCost,null);
    }
});

test('old negative correction is separate from added stock and never adds a purchase cost',()=>{
    const result=collect([row({items:[item({correctionQty:999000})]})]);
    assert.equal(result.totalEstimatedCost,150);assert.equal(result.records[0].items[0].restockQty,3000);assert.equal(result.records[0].items[0].correctionQty,999000);
    const html=renderDispatchRestockEstimates(result);assert.match(html,/Restock added: 3,000 g/);assert.match(html,/Old negative-stock correction:/);assert.match(html,/999,000 g/);assert.match(html,/Separate from the restock quantity and its estimate/);
    assert.match(html,/do not deduct cash, create an expense, or change the profit shown above/);
});

test('repeated document IDs and batch IDs cannot count the same committed dispatch twice',()=>{
    const original=row(),copy=row({id:'duplicate-doc'}),result=collect([original,copy,original]);
    assert.equal(result.recordCount,1);assert.equal(result.duplicateCount,2);assert.equal(result.totalEstimatedCost,150);assert.equal(result.records[0].hasDuplicateConflict,false);
});

test('conflicting invoices for one dispatch require review instead of choosing a price from input order',()=>{
    for(const rows of [[row(),row({totalCost:300,items:[item({estimatedSubtotal:300})]})],[row({totalCost:300,items:[item({estimatedSubtotal:300})]}),row()]]) {
        const result=collect(rows);assert.equal(result.recordCount,1);assert.equal(result.totalEstimatedCost,null);assert.equal(result.knownEstimatedTotal,0);assert.equal(result.records[0].hasDuplicateConflict,true);
        assert.match(renderDispatchRestockEstimates(result),/Conflicting records share this dispatch ID/);
    }
});

test('collection and rendering preserve original records and create independent read-only report objects',()=>{
    const input=freeze([row()]),before=structuredClone(input),result=collect(input);renderDispatchRestockEstimates(result);
    assert.deepEqual(input,before);result.records[0].items[0].correctionQty=0;assert.equal(input[0].items[0].correctionQty,500);
});

test('all saved names, destinations, batch IDs and units are escaped without executable handlers or token URLs',()=>{
    const hostile='<img src=x onerror="alert(1)">&\'',result=collect([row({dispatchBatchId:hostile,toBranch:hostile,items:[item({name:hostile,baseUom:hostile,purchaseUom:hostile})]})]);
    const html=renderDispatchRestockEstimates(result);assert.doesNotMatch(html,/<img|<script|onclick=|getDownloadURL|href=/);assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;/);
    assert.match(html,/aria-label="Dispatch restock estimates"/);assert.doesNotMatch(html,/<table/);
});

test('empty reports and invalid periods stay explicit instead of widening the selected time range',()=>{
    const summary=collect([]);assert.equal(summary.totalEstimatedCost,0);assert.equal(summary.recordCount,0);
    const html=renderDispatchRestockEstimates(summary);assert.match(html,/No linked automatic HQ restocks/);assert.doesNotMatch(html,/₱0\.00/);
    assert.throws(()=>collect([],{start:'invalid'}),/valid start date/);assert.throws(()=>collect([],{start:end,end:start}),/ends before it starts/);
});
