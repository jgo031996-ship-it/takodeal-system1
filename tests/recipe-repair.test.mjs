import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { firestoreHarness } from './helpers/firestore-harness.mjs';
import { createSaleEngine, saleFingerprint, SALE_VERSION } from '../Takodeal-POS/pos-safety.js';
import { recipeProblems, ingredientUses } from '../takodeal-manager/recipe-integrity.js';
import { createLiveReport } from '../takodeal-manager/live-report.js';

function sauceSale() {
    const h = firestoreHarness();
    h.put('inventory/sauce-office', { name: 'Takoyaki Sauce Regular', branch: 'Main Office', currentStock: 1000 });
    h.put('inventory/sauce-other', { name: 'Takoyaki Sauce Regular', branch: 'Cabantian', currentStock: 10000 });
    const payload = { saleVersion: SALE_VERSION, saleId: 'sale-held', receiptId: 'TEST-HELD-SAUCE',
        branch: 'Main Office', netTotal: 280, localTimestamp: '2026-10-03T10:46:00Z',
        recipeSnapshot: [{ menuItem: 'Takoyaki 8 Pcs', ingredientName: 'T.Reg.Sauce', qty: 35 }],
        cart: [{ name: 'Takoyaki 8 Pcs', qty: 2, addons: { sauce: { linkedIngredient: 'Takoyaki Sauce Regular', deductQty: 5, qty: 1 } } }] };
    return { h, payload, engine: createSaleEngine(h.api) };
}
test('held recipe snapshot resolves confirmed sauce replacement and merges exact quantities by stock ID', async () => {
    const { h, payload, engine } = sauceSale();
    const before = structuredClone(payload);
    const prepared = await engine.prepare(payload, [{ menuItem: 'Takoyaki 8 Pcs', ingredientName: 'Wrong Ingredient', qty: 500 }]);
    assert.deepEqual(payload, before);
    assert.equal(saleFingerprint(prepared), saleFingerprint(before));
    assert.deepEqual(prepared.inventoryMovements, [{ ingredientName: 'Takoyaki Sauce Regular', quantity: 80, inventoryId: 'sauce-office' }]);
    await Promise.all(Array.from({ length: 20 }, () => createSaleEngine(h.api).commit(prepared)));
    assert.equal(h.get('inventory/sauce-office').currentStock, 920);
    assert.equal(h.get('inventory/sauce-other').currentStock, 10000);
    assert.equal([...h.docs.keys()].filter(k => k.startsWith('transactions/')).length, 1);
    assert.equal([...h.docs.keys()].filter(k => k.startsWith('pos_sale_commits/')).length, 1);
});
test('sauce recovery survives lost acknowledgment and uses recorded canonical stock for repeat voids', async () => {
    const { h, payload, engine } = sauceSale();
    const prepared = await engine.prepare(payload);
    h.loseNextAck(); await assert.rejects(engine.commit(prepared));
    assert.equal(await engine.alreadyCommitted(payload), true);
    await engine.commit(prepared);
    await engine.voidSale(payload.receiptId, 'Owner', payload.branch);
    await engine.voidSale(payload.receiptId, 'Owner', payload.branch);
    assert.equal(h.get('inventory/sauce-office').currentStock, 1000);
});
test('replacement never deducts ambiguous or other-branch stock and preserves missing quantities for review', async () => {
    const { h, payload, engine } = sauceSale();
    h.put('inventory/sauce-copy', { name: 'Takoyaki Sauce Regular', branch: 'Main Office', currentStock: 100 });
    const duplicate = await engine.prepare(payload);
    assert.equal(duplicate.inventoryIssues[0].reason, 'duplicate');
    assert.equal(duplicate.inventoryIssues[0].quantity, 70);
    h.docs.delete('inventory/sauce-copy'); h.docs.delete('inventory/sauce-office');
    assert.equal((await engine.prepare(payload)).inventoryMovements.length, 0);
    const unknown = { ...payload, recipeSnapshot: [{ menuItem: 'Takoyaki 8 Pcs', ingredientName: 'Unknown Sauce', qty: 35 }] };
    assert.equal((await engine.prepare(unknown)).inventoryIssues[0].ingredientName, 'Unknown Sauce');
    assert.equal(h.get('inventory/sauce-other').currentStock, 10000);
});
test('an existing old ingredient is preferred, but duplicate old records are sent to review', async () => {
    const { h, payload, engine } = sauceSale();
    h.put('inventory/old', { name: 'T.Reg.Sauce', branch: 'Main Office', currentStock: 100 });
    const prepared = await engine.prepare(payload);
    assert.equal(prepared.inventoryMovements.find(m => m.inventoryId === 'old').quantity, 70);
    h.put('inventory/old-copy', { name: 'T.Reg.Sauce', branch: 'Main Office', currentStock: 100 });
    const duplicate = await engine.prepare(payload);
    assert.equal(duplicate.inventoryIssues[0].ingredientName, 'T.Reg.Sauce');
    assert.ok(!duplicate.inventoryMovements.some(row => ['old','old-copy'].includes(row.inventoryId)));
});

test('extra spaces in actual stock names recover the same receipt and deduct once across retries', async () => {
    const { h, payload, engine } = sauceSale();
    h.put('inventory/sauce-office', { name: 'Takoyaki Sauce  Regular', branch: 'Main Office', currentStock: 1000 });
    const fingerprint = saleFingerprint(payload);
    const prepared = await engine.prepare(payload);
    assert.deepEqual(prepared.inventoryMovements, [{ ingredientName: 'Takoyaki Sauce  Regular', quantity: 80, inventoryId: 'sauce-office' }]);
    assert.equal(saleFingerprint(prepared), fingerprint);
    h.loseNextAck(); await assert.rejects(engine.commit(prepared));
    await Promise.all(Array.from({ length: 20 }, () => createSaleEngine(h.api).commit(prepared)));
    assert.equal(h.get('inventory/sauce-office').currentStock, 920);
    assert.equal(h.get('inventory/sauce-other').currentStock, 10000);
    assert.equal([...h.docs.keys()].filter(k => k.startsWith('transactions/')).length, 1);
    await engine.voidSale(payload.receiptId, 'Owner', payload.branch);
    await engine.voidSale(payload.receiptId, 'Owner', payload.branch);
    assert.equal(h.get('inventory/sauce-office').currentStock, 1000);
});

test('whitespace fallback flags multiple matches and cannot cross branches or ignore letter case', async () => {
    const { h, payload, engine } = sauceSale();
    h.put('inventory/sauce-office', { name: 'Takoyaki Sauce  Regular', branch: 'Main Office', currentStock: 1000 });
    h.put('inventory/sauce-copy', { name: ' Takoyaki Sauce Regular ', branch: 'Main Office', currentStock: 100 });
    assert.equal((await engine.prepare(payload)).inventoryIssues[0].matches, 2);
    h.docs.delete('inventory/sauce-copy'); h.docs.delete('inventory/sauce-office');
    assert.equal((await engine.prepare(payload)).inventoryMovements.length, 0);
    h.put('inventory/sauce-office', { name: 'takoyaki sauce regular', branch: 'Main Office', currentStock: 1000 });
    assert.equal((await engine.prepare(payload)).inventoryIssues[0].matches, 0);
    assert.equal(h.get('inventory/sauce-other').currentStock, 10000);
});

test('whitespace fallback downloads branch inventory at most once per preparation', async () => {
    const { h, payload } = sauceSale();
    h.put('inventory/sauce-office', { name: 'Takoyaki Sauce  Regular', branch: 'Main Office', currentStock: 1000 });
    const queries = [], getDocs = h.api.getDocsFromServer;
    h.api.getDocsFromServer = async q => { queries.push(q); return getDocs(q); };
    await createSaleEngine(h.api).prepare(payload);
    assert.equal(queries.filter(q => q.table === 'inventory' && q.filters.length === 1).length, 1);
});
test('recipe checks distinguish missing links, invalid quantities and duplicate ingredients', () => {
    assert.deepEqual(recipeProblems([{ ingredientName: 'Sauce', qty: 35 }], new Set(['Sauce'])), []);
    const problems = recipeProblems([{ ingredientName: 'Old', qty: 0 }, { ingredientName: 'Old', qty: 35 }], new Set(['Sauce']));
    assert.ok(problems.includes('Missing ingredient: Old'));
    assert.ok(problems.includes('Invalid quantity: Old'));
    assert.ok(problems.includes('Duplicate recipe ingredient: Old'));
});
test('deletion checks include recipes, menu add-ons, global add-ons, legacy recipes and flavor mappings', () => {
    const uses = ingredientUses(new Set(['Sauce']), [{ ingredientName: 'Sauce', menuItem: 'A' }],
        [{ name: 'B', addons: [{ linkedIngredient: 'Sauce', name: 'extra' }], recipe: [{ item: 'Sauce' }], mixMatchConfig: [{ linkedIngredient: 'Sauce', flavor: 'Bacon' }] }],
        [{ linkedIngredient: 'Sauce', name: 'topper' }], [{ linkedIngredient: 'Sauce', flavor: 'Pork' }]);
    assert.equal(uses.length, 6);
    assert.deepEqual(ingredientUses(new Set(['Unused']), [], [], [], []), []);
});

test('live report cancels old listeners and ignores late snapshots after filters or views change', async () => {
    const listeners = [], rendered = [], statuses = []; let stopped = 0;
    const live = createLiveReport({ subscribe: (...args) => { listeners.push(args); return () => stopped++; }, status: s => statuses.push(s) });
    const first = live.start(); first.watch('today', (snap, update) => rendered.push([snap.id, update]));
    listeners[0][2]({ id: 'initial', metadata: { fromCache: false } }); await Promise.resolve();
    listeners[0][2]({ id: 'new-sale', metadata: { fromCache: false } }); await Promise.resolve();
    const second = live.start(); second.watch('yesterday', snap => rendered.push([snap.id]));
    listeners[0][2]({ id: 'late-old-sale' }); await Promise.resolve();
    assert.equal(first.active(), false); assert.equal(stopped, 1);
    listeners[1][2]({ id: 'cached', metadata: { fromCache: true } }); await Promise.resolve();
    assert.equal(statuses.at(-1), 'Offline / cached sales');
    live.stop(); listeners[1][2]({ id: 'after-leaving' }); await Promise.resolve();
    assert.equal(stopped, 2);
    assert.deepEqual(rendered, [['initial', false], ['new-sale', true], ['cached']]);
});

const main = readFileSync(new URL('../takodeal-manager/main.js', import.meta.url), 'utf8');
function managerFunction(name, context) {
    const start = main.indexOf('window.' + name + ' =');
    const end = main.indexOf('\n};', start) + 3;
    assert.ok(start >= 0 && end > start);
    // These DOM tests exercise row staging/retained input; the real revision,
    // permission and transaction adapter is exercised in recipe-bulk-safety.
    if(name==='saveAdvancedProduct'){
        context.window.advRecipeState ||= {revision:{version:0,revisionId:''},documents:{}};
        context.createRecipeBatch=async api=>api.writeBatch(api.db);
        context.operationFor=()=> 'test-product-operation';
    }
    vm.runInNewContext(main.slice(start, end), context);
    return context.window[name];
}
test('failed recipe save retains deletions and a new product stays new; retry commits both links together', async () => {
    const elements = Object.fromEntries(Object.entries({ btnSaveAdvProd: '', advProdId: '', advProdName: 'A', advProdCat: 'Food', advProdPrice: '10', advProdGrabPrice: '12', advProdFpPrice: '13', advProdMixMatch: '', advancedProductModal: '' }).map(([id, value]) => [id, { value, style: {}, disabled: false }]));
    let fail = true, saves = [], invalidations = [];
    const context = { console: { error() {} }, alert() {}, recipeProblems,
        document: { getElementById: id => elements[id], querySelectorAll: () => [] },
        Swal: { fire() {} },
        window: { ManagerUI:{notify(){}}, query:(...args)=>args, where:()=>({}), db: {}, currentAdvRecipe: [{ docId: 'bom-1', ingredientName: 'Sauce', qty: 35 }], deletedAdvRecipes: ['remove-1'],
            collection: (_, name) => name, doc: (...args) => args.length === 1 ? { id: 'new-menu' } : { id: args[2] },
            getDocsFromServer: async q => q === 'inventory' ? ({ docs: [{ data: () => ({ name: 'Sauce' }) }] }) : ({docs:[]}),
            writeBatch: () => { const writes = []; return { update: (ref, data) => writes.push(['update', ref.id, data]), set: (ref, data) => writes.push(['set', ref.id, data]), delete: ref => writes.push(['delete', ref.id]), commit: async () => { saves.push(writes); if(fail) throw new Error('offline'); } }; },
            invalidateCache: name => invalidations.push(name), loadMenuEditor() {} } };
    const save = managerFunction('saveAdvancedProduct', context);
    await save();
    assert.equal(elements.advProdId.value, '');
    assert.deepEqual(context.window.deletedAdvRecipes, ['remove-1']);
    assert.equal(elements.btnSaveAdvProd.disabled, false);
    fail = false; await save();
    assert.equal(elements.advProdId.value, 'new-menu');
    assert.equal(context.window.deletedAdvRecipes.length, 0);
    assert.deepEqual(structuredClone(saves[1].find(w => w[0] === 'update')[2]), { menuItem: 'A', ingredientName: 'Sauce', qty: 35 });
    assert.ok(saves[1].some(w => w[0] === 'delete' && w[1] === 'remove-1'));
    assert.deepEqual(invalidations, ['menu', 'bom']);
});
test('single and bulk deletion never execute a write when dependency checks fail', async () => {
    let writes = 0, confirmed = 0;
    const context = { console: { error() {} }, alert() {}, confirm: () => { confirmed++; return true; },
        operationFor:()=> 'refused-delete',recipeOperationApplied:async()=>false,
        document: { querySelectorAll: () => [{ value: 'stock-1' }] },
        deleteDoc: async () => writes++, doc() {}, db: {},
        window: { ManagerUI:{notify(){},confirm:()=>{confirmed++;return true;}}, checkInventoryDeletion: async () => { throw new Error('Ingredient used by A'); }, writeBatch: () => { writes++; } } };
    await managerFunction('deleteInventoryItem', context)('stock-1', 'Sauce');
    await managerFunction('bulkDeleteInventory', context)();
    assert.equal(writes, 0); assert.equal(confirmed, 0);
});

test('opening a different recipe or a new product clears abandoned deletion intent', async () => {
    const elements = new Map();
    const context = { document: { getElementById: id => { if(!elements.has(id)) elements.set(id, { style: {}, value: '', replaceChildren() {} }); return elements.get(id); } },
        window: { deletedAdvRecipes: ['old-recipe'], preloadInventoryForAddons: async () => { throw new Error('offline'); } } };
    await assert.rejects(managerFunction('openBomEditor', context)('Other product'), /offline/);
    assert.equal(context.window.deletedAdvRecipes.length, 0);
    context.window.deletedAdvRecipes = ['another-recipe'];
    await assert.rejects(managerFunction('openNewProductModal', context)(), /offline/);
    assert.equal(context.window.deletedAdvRecipes.length, 0);
});

test('actual history renderer receives new sales without downloading reference collections again', async () => {
    const elements = new Map();
    const el = id => { if(!elements.has(id)) elements.set(id, { value: '', style: {}, innerText: '', innerHTML: '' }); return elements.get(id); };
    el('histStartDate').value = '2026-10-03'; el('histEndDate').value = '2026-10-03';
    el('histBranchFilter').value = 'All'; el('histArchiveSelect').value = 'LIVE';
    let readCount = 0, receivedQuery, listener;
    const empty = { docs: [], forEach() {} };
    const live = createLiveReport({ status() {}, subscribe: (q, options, next) => { receivedQuery = q; listener = next; return () => {}; } });
    const context = { console, historyLive: live, Date,
        document: { getElementById: el },
        window: { query: (ref, ...filters) => ({ ...ref, filters }), collection: (_, table) => ({ table }), where: (field, op, value) => ({ field, op, value }), orderBy: () => ({}),
            getDocs: async () => { readCount++; return empty; }, globalShiftReports: {} } };
    await managerFunction('loadSalesHistoryTab', context)();
    assert.equal(readCount, 6);
    assert.equal(receivedQuery.table, 'transactions');
    assert.deepEqual(receivedQuery.filters.map(f => [f.field, f.op]), [['timestamp', '>='], ['timestamp', '<=']]);
    const tx = { receiptId: 'OR-1', branch: 'Main Office', customerName: 'Guest', status: 'Paid', netTotal: 280, paymentMethod: 'Cash', cart: [],
        timestamp: { toDate: () => new Date('2026-10-03T10:46:00Z'), toMillis: () => Date.parse('2026-10-03T10:46:00Z') } };
    const snap = rows => ({ metadata: { fromCache: false }, forEach: fn => rows.forEach(data => fn({ id: data.receiptId, data: () => data })) });
    listener(snap([tx])); await new Promise(resolve => setImmediate(resolve));
    assert.ok(el('historyTableBody').innerHTML.includes('OR-1'));
    assert.ok(el('histSumNet').innerText.includes('280'));
    listener(snap([tx, { ...tx, receiptId: 'OR-2', netTotal: 125 }])); await new Promise(resolve => setImmediate(resolve));
    assert.ok(el('historyTableBody').innerHTML.includes('OR-2'));
    assert.ok(el('histSumNet').innerText.includes('405'));
    assert.equal(readCount, 6);
    live.stop();
});


test('new product and recipe retries reuse the same IDs after a lost server acknowledgment', async () => {
    const elements = Object.fromEntries(Object.entries({btnSaveAdvProd:'',advProdId:'',advProdName:'A',advProdCat:'Food',advProdPrice:'10',advProdGrabPrice:'12',advProdFpPrice:'13',advProdMixMatch:'',advancedProductModal:''}).map(([id,value])=>[id,{value,style:{},disabled:false}]));
    const committed = new Map(); let counter=0,attempts=0;
    const context={console:{error(){}},recipeProblems,document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},Swal:{fire(){}},window:{db:{},ManagerUI:{notify(){}},currentAdvRecipe:[{ingredientName:'Sauce',qty:35,isNew:true}],deletedAdvRecipes:[],collection:(_,name)=>name,doc:(...args)=>({id:args.length===1?args[0]+'-'+(++counter):args[2]}),query:()=>({}),where:()=>({}),getDocsFromServer:async q=>q==='inventory'?{docs:[{data:()=>({name:'Sauce'})}]}:{docs:[...committed.keys()].filter(id=>id.startsWith('menu-')).map(id=>({id}))},invalidateCache(){},loadMenuEditor(){},writeBatch:()=>{const writes=[];return {set:(ref,data)=>writes.push([ref.id,data]),update:(ref,data)=>writes.push([ref.id,data]),delete:ref=>writes.push([ref.id,null]),commit:async()=>{for(const [id,data] of writes)committed.set(id,data);if(++attempts===1)throw Error('Lost acknowledgment');}};}}};
    const save=managerFunction('saveAdvancedProduct',context);await save();await save();
    assert.equal(committed.size,2);assert.equal(counter,2);assert.equal(elements.advProdId.value,'menu-1');
    assert.equal(committed.get('bom-2').qty,35);
});

test('unified editor refuses missing add-on stock and invalid prices before any write', async()=>{
    const elements=Object.fromEntries(Object.entries({btnSaveAdvProd:'',advProdId:'item',advProdName:'A',advProdCat:'Food',advProdPrice:'10',advProdGrabPrice:'12',advProdFpPrice:'13',advProdMixMatch:'',advancedProductModal:''}).map(([id,value])=>[id,{value,style:{},disabled:false}]));
    let writes=0,message='';const addon={querySelector:selector=>({value:({'.addon-name':'Extra sauce','.addon-price':'-1','.addon-ingredient':'Deleted sauce','.addon-qty':'5'})[selector]})};
    const context={console:{error(){}},recipeProblems,document:{getElementById:id=>elements[id],querySelectorAll:selector=>selector==='#addonTableBody tr'?[addon]:[]},Swal:{fire(){}},window:{db:{},ManagerUI:{notify:text=>message=text},currentAdvRecipe:[],deletedAdvRecipes:[],collection:(_,name)=>name,query:()=>({}),where:()=>({}),getDocsFromServer:async q=>q==='inventory'?{docs:[{data:()=>({name:'Sauce'})}]}:{docs:[]},writeBatch:()=>writes++}};
    await managerFunction('saveAdvancedProduct',context)();assert.equal(writes,0);assert.match(message,/Invalid add-on price/);assert.match(message,/Missing ingredient: Deleted sauce/);
});
