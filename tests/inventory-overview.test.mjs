import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryOverviewRow, inventoryOverviewModel, inventoryOverviewDirectory, latestHqInventoryAudit, installInventoryOverview} from '../takodeal-manager/inventory-overview.js';

const item = overrides => ({id:'sauce',name:'Sauce',branch:'Main Office',category:'Prepared Batch',currentStock:10,
    baseCost:2,purchaseUom:'Gallon',baseUom:'gram',conversionRate:100,lowStockAlert:5,...overrides});

test('display statuses preserve explicit zero alerts, zero counts, negative counts and invalid settings',()=>{
    assert.equal(inventoryOverviewRow(item({currentStock:2,reorderLevel:0,lowStockAlert:0})).statusKind,'in-stock');
    assert.equal(inventoryOverviewRow(item({currentStock:0,reorderLevel:0})).statusKind,'out-of-stock');
    const negative=inventoryOverviewRow(item({currentStock:-15}));assert.equal(negative.stock,-15);assert.equal(negative.statusKind,'negative');assert.equal(negative.value,0);
    assert.equal(inventoryOverviewRow(item({currentStock:5,lowStockAlert:5})).statusKind,'low-stock');
    for(const currentStock of ['',null,undefined,false,'not a number',Infinity])assert.equal(inventoryOverviewRow(item({currentStock})).statusKind,'review');
    for(const conversionRate of [0,-1,'bad',Infinity])assert.equal(inventoryOverviewRow(item({conversionRate})).statusKind,'review');
    assert.equal(inventoryOverviewRow(item({reorderLevel:-1})).statusKind,'review');
});

test('unit costs keep a real zero and honestly label conversion-derived or unavailable costs',()=>{
    const zero=inventoryOverviewRow(item({baseCost:0,purchaseCost:1000}));assert.equal(zero.baseCost,0);assert.equal(zero.value,0);
    const legacy=inventoryOverviewRow(item({baseCost:undefined,conversionRate:undefined,conversion:50,purchCost:63.39}));
    assert.equal(legacy.baseCost,63.39/50);assert.equal(legacy.costBasis,'Derived from purchase cost');
    assert.equal(inventoryOverviewRow(item({baseCost:undefined,purchaseCost:10,conversionRate:0})).baseCost,null);
    for(const baseCost of [-1,Infinity,'invalid',true])assert.equal(inventoryOverviewRow(item({baseCost})).baseCost,null);
    assert.equal(inventoryOverviewRow(item({baseCost:undefined,cost:undefined})).baseCost,null);
});

test('purchase-unit display follows the item editor saved-cost aliases and preserves base valuation',()=>{
    const weighted=inventoryOverviewRow(item({baseCost:63.39/50,purchaseUom:'Pack',conversionRate:50,purchaseCost:999,purchCost:888,cost:777}));
    assert.equal(weighted.purchaseUnitCost,999);assert.equal(weighted.purchaseUnit,'Pack');assert.equal(weighted.purchaseCostDiffers,true);
    assert.equal(weighted.baseCost,63.39/50);assert.equal(weighted.value,10*(63.39/50));
    const zero=inventoryOverviewRow(item({baseCost:2,purchaseCost:0,purchCost:999}));assert.equal(zero.purchaseUnitCost,0);assert.equal(zero.value,20);
    const legacy=inventoryOverviewRow(item({baseCost:undefined,purchaseUom:undefined,purchUom:'Sack',conversionRate:undefined,conversion:50,purchCost:63.39}));
    assert.equal(legacy.purchaseUnitCost,63.39);assert.equal(legacy.purchaseUnit,'Sack');assert.equal(legacy.baseCost,63.39/50);
    assert.equal(inventoryOverviewRow(item({purchaseCost:'',purchCost:25,cost:30})).purchaseUnitCost,25);
    assert.equal(inventoryOverviewRow(item({purchaseCost:undefined,purchCost:undefined,cost:30})).purchaseUnitCost,30);
    assert.equal(inventoryOverviewRow(item({purchaseCost:undefined,purchCost:undefined,cost:undefined})).purchaseUnitCost,200);
    for(const purchaseCost of [-1,Infinity,'invalid',true]){
        const invalid=inventoryOverviewRow(item({purchaseCost,purchCost:25}));assert.equal(invalid.purchaseUnitCost,null);assert.equal(invalid.purchaseCostIssue,'Cost needs review');assert.equal(invalid.value,20);
    }
});

test('purchase-unit display does not invent a conversion or unit while existing base valuation stays unchanged',()=>{
    for(const conversionRate of [0,-1,'bad',Infinity]){
        const row=inventoryOverviewRow(item({conversionRate}));assert.equal(row.purchaseUnitCost,null);assert.equal(row.purchaseCostIssue,'Conversion needs review');assert.equal(row.value,20);
        assert.equal(inventoryOverviewRow(item({conversionRate,purchaseCost:12})).purchaseUnitCost,12,'a saved purchase cost does not need conversion arithmetic');
    }
    const missing=inventoryOverviewRow(item({conversionRate:undefined}));
    assert.equal(missing.purchaseUnitCost,null);assert.equal(missing.purchaseCostIssue,'Conversion needs review');assert.equal(missing.baseCost,2);assert.equal(missing.value,20);
    const unlabeled=inventoryOverviewRow(item({purchaseUom:undefined}));assert.equal(unlabeled.purchaseUnitCost,null);assert.equal(unlabeled.purchaseCostIssue,'Purchase unit not set');
    const single=inventoryOverviewRow(item({purchaseUom:undefined,baseUom:'piece',conversionRate:undefined}));assert.equal(single.purchaseUnitCost,2);assert.equal(single.purchaseUnit,'piece');
    const same=inventoryOverviewRow(item({purchaseUom:'Gram',baseUom:'gram',conversionRate:undefined}));assert.equal(same.purchaseUnitCost,2);
    for(const baseCost of [-1,Infinity,'invalid',true])assert.equal(inventoryOverviewRow(item({baseCost})).purchaseUnitCost,null);
    const huge=inventoryOverviewRow(item({baseCost:Number.MAX_VALUE,conversionRate:1000,currentStock:0}));assert.equal(huge.purchaseUnitCost,null);assert.equal(huge.purchaseCostIssue,'Cost needs review');assert.equal(huge.value,0);
});

test('conflicting saved alert aliases require review rather than choosing one threshold',()=>{
    const conflicting=inventoryOverviewRow(item({currentStock:10,reorderLevel:0,lowStockAlert:20}));
    assert.equal(conflicting.thresholdConflict,true);assert.equal(conflicting.status,'Settings need review');
    assert.equal(inventoryOverviewRow(item({reorderLevel:'5',lowStockAlert:5})).thresholdConflict,false);
    assert.equal(inventoryOverviewRow(item({reorderLevel:undefined,lowStockAlert:5})).status,'In stock');
});

test('summary uses the same filtered rows, excludes negative value and reports unknown costs',()=>{
    const input=[item({id:'hq',name:'Sauce',currentStock:10}),item({id:'negative',name:'Sauce',currentStock:-10}),
        item({id:'unknown',name:'Sauce spicy',currentStock:10,baseCost:undefined}),item({id:'branch',name:'Sauce',branch:'Maa',currentStock:50}),
        item({id:'other',name:'Napkin',category:'Packaging',currentStock:100})];
    const model=inventoryOverviewModel(input,{branch:'Main Office',category:'Prepared Batch',search:'  SAUCE  '});
    assert.equal(model.rowCount,3);assert.equal(model.uniqueItemCount,2);assert.equal(model.totalValue,20);
    assert.equal(model.negativeCount,1);assert.equal(model.unvaluedStockCount,1);assert.equal(model.missingCostCount,1);
    const scoped=inventoryOverviewModel(input,{allowed:branch=>branch==='Maa'});assert.equal(scoped.rows.length,1);assert.equal(scoped.totalValue,100);
    assert.equal(input[1].currentStock,-10,'overview never changes raw ledger data');
});

test('directories include new empty branches, branches with historical stock and custom categories within access',()=>{
    const rows=[item({branch:'Retired branch'}),item({branch:'Agdao',category:'Custom supplies'}),item({branch:'Other branch',category:'Secret'})];
    const directory=inventoryOverviewDirectory(rows,[{name:'Agdao'},{name:'Maa'},{name:'Main Office'},{name:'Empty new branch'}],name=>name!=='Other branch');
    assert.deepEqual(directory.branches,['Main Office','Agdao','Empty new branch','Maa','Retired branch']);
    assert.deepEqual(directory.categories,['Custom supplies','Prepared Batch']);
    assert.deepEqual(inventoryOverviewDirectory([item({category:''})]).categories,['Uncategorized']);
});

test('last HQ audit is backed by a nonempty saved physical count and a valid submission timestamp',()=>{
    const count=[{name:'Sauce',physicalQty:0,systemQty:10}];
    const rows=[{id:'hq',branch:'Main Office',timestamp:{seconds:10},counts:count},
        {id:'branch',branch:'Agdao',timestamp:{seconds:100},counts:count},
        {id:'empty',branch:'Main Office',timestamp:{seconds:100},counts:[]},
        {id:'invalid-count',branch:'Main Office',timestamp:{seconds:100},counts:[{name:'Sauce',physicalQty:''}]},
        {id:'no-time',branch:'Main Office',counts:count}];
    assert.equal(latestHqInventoryAudit(rows).id,'hq');
    assert.equal(latestHqInventoryAudit(rows.slice(1)),null);
    assert.equal(latestHqInventoryAudit([...rows,{id:'new',branch:'Main Office',timestamp:new Date(20000),counts:[{name:'Sauce',actualQty:3}]}]).id,'new');
});

class FakeNode {
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.style={};this._text='';this.value='';}
    set id(value){this._id=value;this.doc.nodes.set(value,this);}get id(){return this._id;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    get previousElementSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)-1] || null;}
    append(...nodes){for(const node of nodes){if(node.tagName==='#FRAGMENT'){this.append(...node.children);continue;}if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
    before(node){if(!this.parentElement)return;const parent=this.parentElement,index=parent.children.indexOf(this);node.parentElement=parent;parent.children.splice(index,0,node);}
    setAttribute(name,value){this.attributes[name]=String(value);}
    addEventListener(name,listener){this.listeners.set(name,listener);}
}
function fixture({inventory=[item()],branches=[{name:'Main Office'},{name:'Maa'},{name:'Agdao'}],audit=[],withHeading=false}={}){
    const d={nodes:new Map(),createElement(tag){return new FakeNode(tag,this);},createDocumentFragment(){return new FakeNode('#fragment',this);},getElementById(id){return this.nodes.get(id)||null;}};
    const root=d.createElement('main'),create=(tag,id,parent=root)=>{const node=d.createElement(tag);node.id=id;parent.append(node);return node;};
    for(const id of ['invBranchFilter','invCategoryFilter'])create('select',id).value='All';
    create('input','liveInvSearch');create('input','selectAllInv');create('button','inventoryRefreshStocks');create('p','inventoryOverviewStatus');
    const table=create('table','inventoryTable'),body=create('tbody','inventoryTableBody',table);
    if(withHeading)table.tHead={rows:[{cells:Array.from({length:9},()=>d.createElement('th'))}]};
    for(const id of ['invTotalItems','invTotalValue','kpiLastAudit']){const card=create('article',id+'Card');create('div',id+'Label',card);create('div',id,card);}
    const calls=[],w={sessionUser:{uid:'owner',email:'jgo031996@gmail.com',permissions:['all'],allowedBranches:['All']},auth:{currentUser:{uid:'owner'}},
        isBranchAllowed:()=>true,fetchCachedCollection:async table=>table==='inventory'?inventory:branches,
        db:{},collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),
        getDocsFromServer:async ref=>{calls.push(['read',ref.table]);return {docs:(ref.table==='inventory'?inventory:ref.table==='branches'?branches:audit).map((data,index)=>({id:data.id||String(index),data:()=>data}))};},
        invalidateCache:async table=>calls.push(['invalidate',table]),showInventoryActions:(...args)=>calls.push(['actions',...args])};
    installInventoryOverview(w,d);return {w,d,calls,root,body,el:id=>d.getElementById(id)};
}
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('a pending load always renders the newest branch and search filters, without discarded changes',async()=>{
    const f=fixture(),pending=defer();f.w.fetchCachedCollection=table=>table==='inventory'?pending.promise:Promise.resolve([{name:'Main Office'},{name:'Maa'}]);
    const initial=f.w.loadInventoryData();f.el('invBranchFilter').value='Maa';f.el('liveInvSearch').value='Maa';const latest=f.w.loadInventoryData();
    pending.resolve([item({id:'hq',name:'HQ item'}),item({id:'maa',branch:'Maa',name:'Maa item'})]);await Promise.all([initial,latest]);
    assert.equal(f.el('invBranchFilter').value,'Maa');assert.match(f.body.textContent,/Maa item/);assert.doesNotMatch(f.body.textContent,/HQ item/);assert.equal(f.el('invTotalItems').textContent,'1');
    assert.equal(f.calls.filter(call=>call[0]==='read'&&call[1]==='stock_counts').length,1,'concurrent renders share one snapshot');
});

test('Refresh stocks bypasses saved collection data and still honors filters changed during refresh',async()=>{
    const f=fixture();await f.w.loadInventoryData();const pending=defer(),server=f.w.getDocsFromServer;
    f.w.getDocsFromServer=ref=>ref.table==='inventory'?pending.promise:server(ref);
    const refresh=f.w.refreshInventoryStocks();f.el('liveInvSearch').value='Updated';const filter=f.w.loadInventoryData();
    pending.resolve({docs:[{id:'updated',data:()=>item({id:'updated',name:'Updated Sauce',currentStock:99})}]});await Promise.all([refresh,filter]);
    assert.match(f.body.textContent,/Updated Sauce/);assert.match(f.body.textContent,/99 gram/);assert.equal(f.el('invTotalValue').textContent,'₱198.00');
    assert.ok(f.calls.some(call=>call[0]==='invalidate'&&call[1]==='inventory'));assert.equal(f.el('inventoryRefreshStocks').disabled,false);
    assert.match(f.el('inventoryOverviewStatus').textContent,/Server snapshot/);
});

test('existing inventory writers can invalidate then load without seeing the previous display cache',async()=>{
    const inventory=[item()],f=fixture({inventory});
    f.w.fetchCachedCollection=async table=>table==='inventory'?structuredClone(inventory):[];
    await f.w.loadInventoryData();assert.match(f.body.textContent,/10 gram/);
    inventory[0]=item({currentStock:4});
    f.w.invalidateCache('inventory');await f.w.loadInventoryData();
    assert.match(f.body.textContent,/4 gram/);assert.equal(f.el('invTotalValue').textContent,'₱8.00');
    assert.ok(f.calls.some(call=>call[0]==='read'&&call[1]==='inventory'),'the post-write refresh is server authoritative');
    assert.equal(f.el('inventoryRefreshStocks').disabled,false);
});

test('inventory invalidation discards an old saved snapshot even when it returns after a new load',async()=>{
    const f=fixture({inventory:[item({name:'New stock',currentStock:20})]}),pending=defer();
    f.w.fetchCachedCollection=table=>table==='inventory'?pending.promise:Promise.resolve([]);
    const oldLoad=f.w.loadInventoryData();
    f.w.invalidateCache('inventory');await f.w.loadInventoryData();
    assert.match(f.body.textContent,/New stock/);assert.equal(f.el('invTotalValue').textContent,'₱40.00');
    pending.resolve([item({name:'Old stock',currentStock:10})]);await oldLoad;
    assert.match(f.body.textContent,/New stock/);assert.doesNotMatch(f.body.textContent,/Old stock/);
});

test('a post-write fresh load cannot reuse a pre-write server request still in flight',async()=>{
    const f=fixture(),pending=defer(),read=f.w.getDocsFromServer;let inventoryReads=0;
    await f.w.loadInventoryData();
    f.w.getDocsFromServer=ref=>{
        if(ref.table!=='inventory')return read(ref);
        ++inventoryReads;
        return inventoryReads===1?pending.promise:Promise.resolve({docs:[{id:'new',data:()=>item({name:'After write',currentStock:25})}]});
    };
    const beforeWrite=f.w.refreshInventoryStocks();
    // Allow the first refresh to begin its server read before the completed write.
    for(let turn=0;inventoryReads===0&&turn<20;turn++)await Promise.resolve();
    assert.equal(inventoryReads,1);
    f.w.invalidateCache('inventory');await f.w.refreshInventoryStocks();
    assert.equal(inventoryReads,2);assert.match(f.body.textContent,/After write/);assert.equal(f.el('invTotalValue').textContent,'₱50.00');
    pending.resolve({docs:[{id:'old',data:()=>item({name:'Before write',currentStock:10})}]});await beforeWrite;
    assert.match(f.body.textContent,/After write/);assert.doesNotMatch(f.body.textContent,/Before write/);
    assert.equal(f.el('inventoryRefreshStocks').disabled,false);
});

test('untrusted names are rendered as text and action callbacks keep the exact record identity',async()=>{
    const name='Sauce \'"><img src=x onerror=bad()> & special',f=fixture({inventory:[item({id:'exact-id',name})]});
    await f.w.loadInventoryData();assert.equal(f.body.children[0].children[2].textContent,name);
    const action=f.body.children[0].children[8].children[0];assert.equal(action.attributes.onclick,undefined);action.listeners.get('click')();
    assert.deepEqual(f.calls.find(call=>call[0]==='actions').slice(1),['exact-id',name,10,'gram',2,'Main Office']);
    assert.equal(f.body.children[0].children[0].children[0].dataset.name,name);
});

test('rendered cost heading and cells identify purchase units while action costs and stock values stay in base units',async()=>{
    const original=item({id:'pack',baseCost:63.39/50,purchaseUom:'Pack',conversionRate:50,purchaseCost:63.39}),before=structuredClone(original),f=fixture({inventory:[original],withHeading:true});
    assert.equal(f.body.parentElement.tHead.rows[0].cells[6].textContent,'Cost / purchase unit');
    assert.ok(fixture().w.inventoryOverviewInstalled,'the installer also accepts a table without a heading');
    await f.w.loadInventoryData();const row=f.body.children[0],cost=row.children[6];
    assert.equal(cost.textContent,'₱63.39 / Pack');assert.equal(cost.attributes['data-label'],'Cost / purchase unit');
    assert.match(cost.title,/Recorded purchase-unit cost \/ Pack/);assert.equal(row.children[7].textContent,'₱12.68');
    assert.equal(f.el('invTotalValue').textContent,'₱12.68');row.children[8].children[0].listeners.get('click')();
    assert.equal(f.calls.find(call=>call[0]==='actions')[5],63.39/50);assert.deepEqual(original,before);
});

test('restricted branch data never enters rows, summaries, selectors or an HQ audit read',async()=>{
    const f=fixture({inventory:[item({branch:'Maa'}),item({id:'other',name:'Secret Sauce',branch:'Main Office',currentStock:999})]});
    f.w.sessionUser={uid:'branch',email:'manager@example.test',permissions:['overview'],allowedBranches:['Maa']};f.w.auth.currentUser.uid='branch';f.w.isBranchAllowed=()=>true;
    await f.w.loadInventoryData();assert.doesNotMatch(f.body.textContent,/Secret Sauce|999/);assert.equal(f.el('invTotalValue').textContent,'₱20.00');
    assert.deepEqual(f.el('invBranchFilter').children.map(option=>option.value),['All','Maa']);assert.equal(f.calls.some(call=>call[1]==='stock_counts'),false);
    assert.match(f.el('kpiLastAudit').textContent,/Outside your audit access/);
});

test('late snapshots after an account change are ignored and unauthorized loaders make no reads',async()=>{
    const f=fixture(),pending=defer();f.w.fetchCachedCollection=table=>table==='inventory'?pending.promise:Promise.resolve([]);
    const request=f.w.loadInventoryData();f.w.sessionUser={uid:'new-user',email:'new@example.test',permissions:[],allowedBranches:[]};
    pending.resolve([item({name:'Previous private stock'})]);await request;assert.doesNotMatch(f.body.textContent,/Previous private stock/);
    const count=f.calls.length;await f.w.loadInventoryData();assert.equal(f.calls.length,count);assert.match(f.body.textContent,/access/);assert.equal(f.el('invTotalValue').textContent,'—');
});

test('load errors never display a misleading zero value and HQ history errors differ from no audit',async()=>{
    const f=fixture();f.w.fetchCachedCollection=async()=>{throw Error('Offline');};await f.w.loadInventoryData();assert.equal(f.el('invTotalValue').textContent,'—');assert.match(f.el('inventoryOverviewStatus').textContent,/Offline/);
    const absent=fixture();await absent.w.loadInventoryData();assert.equal(absent.el('kpiLastAudit').textContent,'No HQ audit recorded');
    const failed=fixture(),read=failed.w.getDocsFromServer;failed.w.getDocsFromServer=ref=>ref.table==='stock_counts'?Promise.reject(Error('No permission')):read(ref);
    await failed.w.loadInventoryData();assert.equal(failed.el('kpiLastAudit').textContent,'HQ count unavailable');assert.equal(failed.el('invTotalItems').textContent,'1');
});
