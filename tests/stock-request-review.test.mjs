import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderStockRequestReview,stockRequestReviewRows,stockRequestReviewSummary} from '../takodeal-manager/stock-request-review.js';

const base={branch:'Maa',requestedBy:'Synthetic cashier',status:'Pending',type:'Internal Request',timestamp:{seconds:Date.parse('2026-10-08T16:15:00Z')/1000}};
const manual={itemName:'Flour',qty:3000,rawQty:3,displayQty:3,uom:'g',baseUom:'g',purchaseUom:'Pack',displayUom:'Pack',physicalStock:1400,systemStock:1500,
    requestType:'Maintaining Stock (Auto-Fill)',countSnapshot:{version:1,baseUom:'g',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:400,totalBaseQty:1400}};
const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('manual auto-fill shows the real package plus loose count separately from its requested deficit despite newer HQ conversion',()=>{
    const po=freeze({...base,items:[structuredClone(manual)]}),before=structuredClone(po);
    const result=renderStockRequestReview(po,{poId:'manual-one',hqStock:freeze({Flour:9000}),hqDetails:freeze({Flour:{uom:'g',purchaseUom:'Pack',conversionRate:2000}})}),row=result.rows[0];
    assert.equal(row.reported.text,'1 Pack + 400 g');assert.equal(row.requested.text,'3 Pack');assert.equal(row.reported.baseQuantity,1400);
    assert.equal(row.requested.baseQuantity,3000);assert.equal(row.hqText,'9,000 g');assert.equal(row.system.text,'1.5 Pack');
    assert.match(result.html,/Reported count/);assert.match(result.html,/Restock requested/);assert.match(result.html,/1 Pack \+ 400 g/);
    assert.deepEqual(po,before);assert.equal(result.summary.itemCount,1);
});

test('legacy auto-fill can recover only its retained request ratio, never the current HQ package size',()=>{
    const legacy={...manual};delete legacy.countSnapshot;
    const [row]=stockRequestReviewRows({items:[legacy]},{Flour:20000},{Flour:{uom:'g',purchaseUom:'Pack',conversionRate:5000}});
    assert.equal(row.reported.text,'1.4 Pack');assert.equal(row.requested.text,'3 Pack');assert.equal(row.system.text,'1.5 Pack');
    assert.equal(row.reported.baseQuantity,1400);assert.equal(row.warnings.length,0);
});

test('emergency zero requests retain the actual reported base stock without relabeling displayQty as requested or counted stock',()=>{
    const item={name:'Sauce',qty:0,rawQty:0,displayQty:2.5,displayUom:'Pack',uom:'g',purchaseUom:'Pack',physicalStock:2500,systemStock:3000,convRate:1000,requestType:'Low Stock'};
    const result=renderStockRequestReview({...base,items:[item]},{poId:'emergency',hqStock:{Sauce:0},hqDetails:{Sauce:{uom:'g',conversionRate:5000}}}),row=result.rows[0];
    assert.equal(row.reported.baseQuantity,2500);assert.equal(row.reported.text,'2,500 g');assert.equal(row.requested.baseQuantity,0);
    assert.equal(row.requested.text,'0 g');assert.equal(row.hqQuantity,0);assert.equal(row.hqText,'0 g');assert.equal(row.status,'Low Stock');
    assert.match(result.html,/Package conversion was not retained/);assert.equal(result.html.includes('2.5 Pack'),false);
});

test('forecast restock is requested quantity and recorded branch stock, never an invented physical count',()=>{
    const result=renderStockRequestReview({...base,isForecast:true,items:[{itemName:'Tea',qty:3000,rawQty:3,uom:'g',baseUom:'g',purchaseUom:'Pack',displayUom:'Pack',isForecast:true,systemStock:1400,requestType:'Weekly Restock (AI Forecast)'}]});
    const row=result.rows[0];assert.equal(row.hasReported,false);assert.equal(row.reported,null);assert.equal(row.requested.text,'3 Pack');assert.equal(row.system.text,'1.4 Pack');
    assert.match(result.html,/Forecast request/);assert.match(result.html,/Recorded branch stock/);assert.equal(/<span[^>]*>Reported count<\/span>/.test(result.html),false);
    assert.equal(row.status,'Weekly Restock (AI Forecast)');
});

test('ordinary saved base requests remain explicit and numerical payloads are untouched',()=>{
    const po=freeze({...base,items:[{name:'Coffee',qty:1500,uom:'g',requestType:'Request'}]}),result=renderStockRequestReview(po,{hqStock:{Coffee:6250},hqDetails:{Coffee:{uom:'g',purchaseUom:'Bag',conversionRate:500}}});
    assert.equal(result.rows[0].requested.text,'1,500 g');assert.equal(result.rows[0].hqText,'6,250 g');assert.match(result.html,/>Requested</);
    assert.equal(po.items[0].qty,1500);assert.equal(po.items[0].rawQty,undefined);
});

test('backlogged physical zero remains out of stock, while positive physical stock is low and uncounted requests remain backlogged',()=>{
    const rows=stockRequestReviewRows({items:[{name:'Zero',qty:100,physicalStock:0,uom:'g',requestType:'Delayed / Backlogged'},
        {name:'Some',qty:100,physicalStock:10,uom:'g',requestType:'Delayed / Backlogged'},
        {name:'Unknown',qty:100,uom:'g',requestType:'Delayed / Backlogged'}]});
    assert.deepEqual(rows.map(row=>row.status),['Out of Stock','Low Stock','Delayed / Backlogged']);assert.equal(rows[0].reported.text,'0 g');
});

test('negative HQ stock stays negative and clearly needs review without changing the request reason',()=>{
    const result=renderStockRequestReview({...base,items:[{name:'Lids',qty:12,uom:'pcs',requestType:'Lost in Transit'}]},{hqStock:{Lids:-5},hqDetails:{Lids:{uom:'pcs'}}});
    const row=result.rows[0];assert.equal(row.hqQuantity,-5);assert.equal(row.hqText,'-5 pcs');assert.equal(row.status,'Lost in Transit');assert.equal(row.tone,'lost');
    assert.match(result.html,/Needs review/);assert.match(result.html,/HQ stock is negative and needs review/);
});

test('negative recorded branch stock remains its saved base amount despite changed HQ units',()=>{
    const item={...manual,systemStock:-1500},result=renderStockRequestReview({...base,items:[item]},{hqStock:{Flour:1200},hqDetails:{Flour:{uom:'kg',purchaseUom:'Bag',conversionRate:5000}}});
    assert.equal(result.rows[0].system.baseQuantity,-1500);assert.equal(result.rows[0].system.text,'-1,500 g');assert.equal(result.rows[0].hqText,'1,200 kg');
    assert.match(result.html,/Recorded branch stock is negative and needs review/);assert.match(result.html,/Recorded branch stock/);assert.match(result.html,/-1,500 g/);
});

test('missing, invalid and inherited HQ quantities are unknown rather than a fictional zero',()=>{
    const stocks=Object.create({Inherited:42});stocks.Invalid=NaN;stocks.Empty='';stocks.Infinite=Infinity;stocks.Zero=0;
    const names=['Missing','Inherited','Invalid','Empty','Infinite','Zero'],rows=stockRequestReviewRows({items:names.map(name=>({name,qty:1,uom:'pcs'}))},stocks);
    assert.deepEqual(rows.slice(0,-1).map(row=>row.hqText),['Unknown','Unknown','Unknown','Unknown','Unknown']);assert.equal(rows.at(-1).hqText,'0 pcs');
});

test('HQ lookup preserves exact saved item names rather than guessing a trimmed alias',()=>{
    const rows=stockRequestReviewRows({items:[{name:' Flour ',qty:100,uom:'g'},{name:'Flour',qty:100,uom:'g'}]},
        {' Flour ':1200,Flour:2},{' Flour ':{uom:'g'},Flour:{uom:'kg'}});
    assert.equal(rows[0].hqText,'1,200 g');assert.equal(rows[1].hqText,'2 kg');
    const [unknown]=stockRequestReviewRows({items:[{name:' Flour ',qty:100,uom:'g'}]},{Flour:2},{Flour:{uom:'kg'}});assert.equal(unknown.hqQuantity,null);
});

test('summary accepts retained timestamps and midnight dates use Philippine time instead of the browser timezone',()=>{
    const summary=stockRequestReviewSummary({...base,items:[manual,manual],originalRequestDate:'Oct 7, 2026'});
    assert.match(summary.submittedAt,/Oct 9/);assert.match(summary.submittedAt,/12:15/);assert.match(summary.submittedAt,/2026/);
    assert.equal(summary.itemCount,2);assert.equal(summary.originalRequestDate,'Oct 7, 2026');
    for(const timestamp of [undefined,'invalid',{}, {toDate(){throw Error('Malformed legacy value');}}])assert.equal(stockRequestReviewSummary({timestamp}).submittedAt,'Date not recorded');
});

test('all saved text is escaped and hostile request IDs reach only the two intended existing handlers',()=>{
    const hostile=`quote'\"<&><img src=x onerror=globalThis.pwned=true>`,id=`request'\");globalThis.pwned=true;//&`;
    // A slash is not a valid document ID: no action handler is emitted for it.
    assert.equal(renderStockRequestReview({items:[]},{poId:id}).html.includes('onclick='),false);
    const validId=`request'\");globalThis.pwned=true; &`,result=renderStockRequestReview({...base,branch:hostile,requestedBy:hostile,status:hostile,originalRequestDate:hostile,items:[{name:hostile,qty:1,uom:hostile,requestType:hostile}]},{poId:validId,hqStock:{[hostile]:5},hqDetails:{[hostile]:{uom:hostile}}});
    assert.equal(result.titleText,`Stock issue report · ${hostile}`);assert.equal(result.html.includes('<img'),false);assert.equal(result.html.includes('<&>'),false);
    assert.match(result.html,/&lt;img/);const calls=[],context={window:{processRejectRequest:value=>calls.push(['reject',value]),deleteStockRequest:value=>calls.push(['delete',value])},decodeURIComponent};
    const handlers=[...result.html.matchAll(/onclick="([^"]+)"/g)].map(match=>match[1]);assert.equal(handlers.length,2);
    handlers.forEach(handler=>vm.runInNewContext(handler,context));assert.equal(context.pwned,undefined);assert.deepEqual(calls,[['reject',validId],['delete',validId]]);
});

test('semantic table exposes every status and reason on labelled cells, with destructive controls under More actions',()=>{
    const {html}=renderStockRequestReview({...base,items:[manual,{name:'Cups',qty:0,physicalStock:0,uom:'pcs',requestType:'Out of Stock'}]},{poId:'review'});
    assert.equal((html.match(/scope="col"/g)||[]).length,4);assert.equal((html.match(/data-label="Status \/ reason"/g)||[]).length,2);
    assert.match(html,/<details class="stock-request-review__actions"><summary>More actions/);assert.match(html,/<caption[^>]*>Requested items/);
    assert.match(html,/Out of Stock/);assert.match(html,/Maintaining Stock \(Auto-Fill\)/);assert.equal(html.includes('overflow-x: hidden'),false);
    assert.match(html,/dispatch draft does not send stock/);assert.match(html,/HQ must choose amounts for reported-count items/);
    assert.match(html,/<table role="table"/);assert.equal((html.match(/role="columnheader"/g)||[]).length,4);assert.equal((html.match(/role="cell"/g)||[]).length,8);
});

test('empty and malformed item records have explicit review states without invented counts',()=>{
    const empty=renderStockRequestReview({},{poId:'empty'});assert.equal(empty.rows.length,0);assert.equal(empty.summary.itemCount,0);assert.match(empty.html,/No items were recorded/);
    const result=renderStockRequestReview({items:[null,{name:'Broken',physicalStock:'not a count',qty:'unknown',uom:'g'}]});
    assert.equal(result.rows[0].itemName,'Unnamed item');assert.equal(result.rows[1].reported,null);assert.match(result.html,/Reported count was not recorded clearly/);
    assert.equal(result.html.includes('NaN'),false);assert.equal(result.html.includes('undefined'),false);
});

test('Manager uses the identical tested saved-unit model and renderer contains no cloud or cart mutations',()=>{
    const original=readFileSync(new URL('../Takodeal-POS/stock-report-units.js',import.meta.url));
    assert.deepEqual(readFileSync(new URL('../takodeal-manager/stock-report-units.js',import.meta.url)),original);
    const source=readFileSync(new URL('../takodeal-manager/stock-request-review.js',import.meta.url),'utf8');
    assert.equal(/\b(?:setDoc|updateDoc|deleteDoc|runTransaction|dispatchCart|localStorage)\b/.test(source),false);
});
