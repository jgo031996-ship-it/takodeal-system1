import test from 'node:test';
import assert from 'node:assert/strict';
import {planDispatchRestock,assertDispatchRestockCurrent,canonicalDispatchIntent,isDispatchAutoRestock} from '../takodeal-manager/dispatch-restock-model.js';

const stock=(patch={})=>({id:'hq-chicken',branch:'Main Office',name:'Chicken Powder',currentStock:-82500,uom:'Gram',purchaseUom:'Pack',conversionRate:1000,baseCost:0.2,purchaseCost:200,...patch});
const dispatch=(patch={})=>({sourceId:'hq-chicken',name:'Chicken Powder',qty:7500,baseUom:'Gram',rawQty:7.5,friendlyUom:'Pack',convRate:1000,...patch});
const plan=(rows=[stock()],items=[dispatch()],source='Main Office')=>planDispatchRestock(rows,items,{source});

test('negative HQ balance is corrected separately and only the new7500g is restocked and costed',()=>{
    const result=plan(),line=result.lines[0];assert.equal(result.needsRestock,true);assert.equal(line.oldQty,-82500);assert.equal(line.current,-82500);assert.equal(line.correctionQty,82500);assert.equal(line.restockQty,7500);assert.equal(line.dispatchQty,7500);assert.equal(line.afterDispatchQty,0);assert.equal(line.estimatedSubtotal,1500);assert.equal(result.estimatedTotal,1500);assert.equal(line.estimatedUnitCost,200);assert.equal(line.knownCost,true);assert.equal(line.oldQty+line.correctionQty+line.restockQty-line.dispatchQty,line.afterDispatchQty);
});
test('positive partial balance buys only the uncovered quantity; sufficient stock is never restocked',()=>{
    for(const [current,restock,after]of [[2000,5500,0],[0,7500,0],[7500,0,0],[9000,0,1500]]){const result=plan([stock({currentStock:current})]);assert.equal(result.lines[0].correctionQty,0);assert.equal(result.lines[0].restockQty,restock);assert.equal(result.lines[0].afterDispatchQty,after);assert.equal(result.needsRestock,restock>0);assert.equal(result.estimatedTotal,restock*0.2);}
});
test('a branch transfer cannot reset a negative balance or auto-restock outside Main Office',()=>{
    const result=plan([stock({branch:'Maa'})],[dispatch()],'Maa'),line=result.lines[0];assert.equal(line.correctionQty,0);assert.equal(line.restockQty,0);assert.equal(line.afterDispatchQty,-90000);assert.equal(result.needsRestock,false);assert.equal(result.estimatedTotal,0);
});
test('duplicate dispatch rows aggregate before shortage and retain one inventory identity',()=>{
    const result=plan([stock({currentStock:5000})],[dispatch({qty:3000}),dispatch({qty:4500})]);assert.equal(result.lines.length,1);assert.equal(result.lines[0].dispatchQty,7500);assert.equal(result.lines[0].restockQty,2500);assert.equal(result.lines[0].estimatedSubtotal,500);
});
test('fractional package quantities cannot leave a tiny negative HQ remainder through floating-point roundoff',()=>{
    const line=plan([stock({currentStock:0.01})],[dispatch({qty:0.1})]).lines[0];assert.equal(line.restockQty,0.09000000000000001);assert.equal(line.afterDispatchQty,0);assert.ok(line.afterDispatchQty>=0);
});
test('each item uses its own saved package conversion and monetary estimates round per line',()=>{
    const rows=[stock({currentStock:0,baseCost:0.333333}),stock({id:'hq-bowl',name:'Paper Bowl',currentStock:1,uom:'Piece',purchaseUom:'Pack',conversionRate:50,baseCost:2.25})],items=[dispatch({qty:3}),dispatch({sourceId:'hq-bowl',name:'Paper Bowl',qty:4,baseUom:'Piece'})],result=plan(rows,items);
    const chicken=result.lines.find(row=>row.id==='hq-chicken'),bowl=result.lines.find(row=>row.id==='hq-bowl');assert.equal(chicken.estimatedSubtotal,1);assert.equal(bowl.estimatedUnitCost,112.5);assert.equal(bowl.estimatedSubtotal,6.75);assert.equal(result.estimatedTotal,7.75);
});
test('explicit saved base cost0 is valid and wins over a nonzero purchase-price fallback',()=>{
    const result=plan([stock({baseCost:'0',purchaseCost:200})]);assert.equal(result.lines[0].knownCost,true);assert.equal(result.lines[0].baseCost,0);assert.equal(result.estimatedTotal,0);assert.equal(result.hasUnknownCost,false);
});
test('missing or invalid base price derives estimates from the first valid saved purchase price',()=>{
    for(const patch of [{baseCost:undefined,purchaseCost:'250'},{baseCost:-1,purchaseCost:'',purchCost:250},{baseCost:NaN,purchaseCost:Infinity,purchCost:null,cost:250}]){const line=plan([stock(patch)]).lines[0];assert.equal(line.knownCost,true);assert.equal(line.baseCost,0.25);assert.equal(line.estimatedUnitCost,250);assert.equal(line.estimatedSubtotal,1875);}
});
test('absent, blank, negative or nonfinite prices remain unknown rather than becoming free stock',()=>{
    for(const patch of [{baseCost:undefined,purchaseCost:undefined},{baseCost:'',purchaseCost:null,cost:''},{baseCost:-1,purchaseCost:NaN,purchCost:Infinity,cost:-1}]){const result=plan([stock(patch)]),line=result.lines[0];assert.equal(line.knownCost,false);assert.equal(line.baseCost,null);assert.equal(line.estimatedUnitCost,null);assert.equal(line.estimatedSubtotal,null);assert.equal(result.hasUnknownCost,true);assert.equal(result.estimatedTotal,null);}
});
test('unknown price on an item without a restock does not turn a zero-purchase plan into an expense',()=>{
    const result=plan([stock({currentStock:9000,baseCost:undefined,purchaseCost:undefined})]);assert.equal(result.lines[0].knownCost,false);assert.equal(result.needsRestock,false);assert.equal(result.hasUnknownCost,false);assert.equal(result.estimatedTotal,0);
});
test('legacy same-unit stock defaults a missing conversion to1 without inventing a package conversion',()=>{
    const line=plan([stock({uom:'Piece',purchaseUom:'Piece',conversionRate:undefined,currentStock:0})],[dispatch({baseUom:'Piece'})]).lines[0];assert.equal(line.conversionRate,1);assert.equal(line.restockQty,7500);
});
test('invalid/missing package units and explicit conflicting base units fail before producing a plan',()=>{
    for(const patch of [{conversionRate:0},{conversionRate:-1},{conversionRate:NaN},{conversionRate:''},{conversionRate:undefined},{uom:'',baseUom:undefined},{purchaseUom:'Gram',conversionRate:1000}])assert.throws(()=>plan([stock(patch)]),/unit|conversion/i);
    assert.throws(()=>plan([stock()],[dispatch({baseUom:'Milliliter'})]),/base unit/i);
});
test('stock is resolved by exact source name and ID, never another branch or a trimmed-name alias',()=>{
    assert.throws(()=>plan([stock({name:'Chicken Powder '})]),/Missing or duplicate/);assert.throws(()=>plan([stock({branch:'Maa'})]),/Missing or duplicate/);assert.throws(()=>plan([stock()],[dispatch({sourceId:'different-stock'})]),/source stock/i);
    assert.throws(()=>plan([stock(),stock({id:'other-hq'})]),/duplicate/);assert.throws(()=>plan([stock(),stock({name:'Other name'})]),/IDs.*duplicated/i);
});
test('unknown or malformed stock balances and nonpositive/nonfinite request quantities are refused',()=>{
    for(const currentStock of [undefined,null,'',NaN,Infinity,'not a balance'])assert.throws(()=>plan([stock({currentStock})]),/current stock/i);
    for(const qty of [0,-1,'',null,NaN,Infinity,'bad'])assert.throws(()=>plan([stock()],[dispatch({qty})]),/positive finite/i);
    assert.throws(()=>plan([stock()],[dispatch({qty:Number.MAX_VALUE}),dispatch({qty:Number.MAX_VALUE})]),/too large/i);
});
test('planning keeps all original inventory cost fields and cart metadata unchanged',()=>{
    const rows=[stock()],items=[dispatch()],beforeRows=structuredClone(rows),beforeItems=structuredClone(items);plan(rows,items);assert.deepEqual(rows,beforeRows);assert.deepEqual(items,beforeItems);
});
test('fresh comparison accepts reordered stock and duplicate request rows with the same aggregated intent',()=>{
    const rows=[stock(),stock({id:'unrequested',name:'Other ingredient'})],initial=plan(rows,[dispatch({qty:3000}),dispatch({qty:4500})]);assert.deepEqual(assertDispatchRestockCurrent(initial,[...rows].reverse(),[dispatch()]),initial);
});
test('fresh comparison rejects changed balance, price, identity, units, conversion or requested quantity',()=>{
    const initial=plan();for(const patch of [{currentStock:-80000},{baseCost:0.3},{purchaseCost:201},{purchCost:0},{name:'Renamed item'},{branch:'Maa'},{uom:'Kilogram'},{purchaseUom:'Sack'},{conversionRate:500},{id:'replacement-id'}])assert.throws(()=>assertDispatchRestockCurrent(initial,[stock(patch)],[dispatch()]));
    assert.throws(()=>assertDispatchRestockCurrent(initial,[stock()],[dispatch({qty:7501})]),/changed/i);
    assert.throws(()=>assertDispatchRestockCurrent({...initial,lines:[{...initial.lines[0],restockQty:90000}]},[stock()],[dispatch()]),/changed/i);
});
test('unrelated inventory fields do not invalidate the exact quantity and cost preview',()=>{
    const initial=plan();assert.deepEqual(assertDispatchRestockCurrent(initial,[stock({image:'new sample URL',category:'Packaging',note:'Unrelated'})],[dispatch()]),initial);
});
test('canonical intent is stable across object-key insertion but preserves array order and rejects unsafe values',()=>{
    assert.equal(canonicalDispatchIntent({b:2,a:{d:4,c:3},optional:undefined}),canonicalDispatchIntent({a:{c:3,d:4},b:2}));assert.notEqual(canonicalDispatchIntent([1,2]),canonicalDispatchIntent([2,1]));for(const value of [Infinity,NaN,[undefined],()=>{},new Map()])assert.throws(()=>canonicalDispatchIntent(value));const cyclic={};cyclic.self=cyclic;assert.throws(()=>canonicalDispatchIntent(cyclic),/circular/);
});
test('auto-restock or any dispatch-linked invoice is protected from standalone legacy reversal',()=>{
    assert.equal(isDispatchAutoRestock({dispatchAutoRestock:true}),true);assert.equal(isDispatchAutoRestock({dispatchBatchId:'dispatch-sample'}),true);assert.equal(isDispatchAutoRestock({dispatchAutoRestock:false,dispatchBatchId:'dispatch-sample'}),true);for(const row of [null,{}, {dispatchBatchId:''},{dispatchAutoRestock:false}])assert.equal(isDispatchAutoRestock(row),false);
});
