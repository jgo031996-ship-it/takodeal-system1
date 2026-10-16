import {canOpenInventoryTab, OWNER_EMAIL} from './workspace-access-model.js';
import {millis, timestampLabel} from './operations-model.js';

const numeric = value => !['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const firstPresent = (...values) => values.find(value => value != null && String(value).trim() !== '');
const text = value => String(value ?? '').trim();
const money = value => '₱' + value.toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
const quantity = value => value.toLocaleString('en-PH', {maximumFractionDigits:10});

// These are display calculations only. Missing or invalid numbers never become
// a plausible zero count/cost, and negative ledger counts remain visible.
export function inventoryOverviewRow(item) {
    const stock = numeric(item.currentStock);
    const rawConversion = firstPresent(item.conversionRate, item.conversion);
    const conversion = rawConversion === undefined ? 1 : numeric(rawConversion);
    const validConversion = conversion !== null && conversion > 0;
    const rawBaseCost = firstPresent(item.baseCost);
    let baseCost = numeric(rawBaseCost), costBasis = 'Recorded base-unit cost';
    if (rawBaseCost === undefined) {
        const purchaseCost = numeric(firstPresent(item.purchaseCost, item.purchCost, item.cost));
        baseCost = purchaseCost !== null && purchaseCost >= 0 && validConversion ? purchaseCost / conversion : null;
        costBasis = baseCost === null ? 'Cost not recorded' : 'Derived from purchase cost';
    }
    if (baseCost !== null && (baseCost < 0 || !Number.isFinite(baseCost))) baseCost = null;
    if (baseCost === null) costBasis = 'Cost needs review';
    const savedPurchaseUnit = text(firstPresent(item.purchaseUom, item.purchUom));
    const savedBaseUnit = text(firstPresent(item.baseUom, item.uom));
    const purchaseUnit = savedPurchaseUnit || savedBaseUnit || 'unit';
    const sameUnit = savedPurchaseUnit && savedBaseUnit && savedPurchaseUnit.toLocaleLowerCase('en-PH') === savedBaseUnit.toLocaleLowerCase('en-PH');
    const purchaseUnitKnown = !!savedPurchaseUnit || conversion === 1 && !!savedBaseUnit;
    const purchaseConversionKnown = validConversion && (rawConversion !== undefined || sameUnit || !savedPurchaseUnit && !!savedBaseUnit);
    // Match the item's saved purchase-cost field. Derive a missing purchase cost
    // from the recorded base cost without repairing or changing either value.
    const rawPurchaseCost = firstPresent(item.purchaseCost, item.purchCost, item.cost);
    const recordedPurchaseCost = numeric(rawPurchaseCost);
    const derivedPurchaseCost = baseCost !== null && purchaseConversionKnown ? baseCost * conversion : null;
    const calculatedPurchaseCost = rawPurchaseCost === undefined ? derivedPurchaseCost : recordedPurchaseCost;
    const purchaseUnitCost = purchaseUnitKnown && calculatedPurchaseCost !== null && calculatedPurchaseCost >= 0 && Number.isFinite(calculatedPurchaseCost) ? calculatedPurchaseCost : null;
    const purchaseCostIssue = !purchaseUnitKnown ? 'Purchase unit not set'
        : rawPurchaseCost !== undefined ? purchaseUnitCost === null ? 'Cost needs review' : ''
        : !purchaseConversionKnown ? 'Conversion needs review' : baseCost === null ? 'Cost not set' : purchaseUnitCost === null ? 'Cost needs review' : '';
    const purchaseCostBasis = rawPurchaseCost === undefined ? 'Derived from recorded base cost' : 'Recorded purchase-unit cost';
    const purchaseCostDiffers = purchaseUnitCost !== null && derivedPurchaseCost !== null && Number.isFinite(derivedPurchaseCost)
        && Math.abs(purchaseUnitCost-derivedPurchaseCost) > Math.max(1e-9, Math.abs(derivedPurchaseCost)*1e-9);
    const rawThreshold = firstPresent(item.reorderLevel, item.lowStockAlert);
    const storedReorder = firstPresent(item.reorderLevel), storedAlert = firstPresent(item.lowStockAlert);
    const thresholdConflict = storedReorder !== undefined && storedAlert !== undefined
        && (numeric(storedReorder) === null || numeric(storedAlert) === null || numeric(storedReorder) !== numeric(storedAlert));
    const threshold = numeric(rawThreshold), validThreshold = !thresholdConflict && (rawThreshold === undefined || threshold !== null && threshold >= 0);
    let status = 'In stock', statusKind = 'in-stock';
    if (stock === null) { status = 'Count needs review'; statusKind = 'review'; }
    else if (stock < 0) { status = 'Negative · audit needed'; statusKind = 'negative'; }
    else if (stock === 0) { status = 'Out of stock'; statusKind = 'out-of-stock'; }
    else if (!validThreshold || !validConversion) { status = 'Settings need review'; statusKind = 'review'; }
    else if (threshold !== null && stock <= threshold) { status = 'Low stock'; statusKind = 'low-stock'; }
    const calculatedValue = stock !== null && baseCost !== null ? Math.max(0, stock) * baseCost : null;
    const value = calculatedValue !== null && Number.isFinite(calculatedValue) ? calculatedValue : null;
    return {...item, id:text(item.id), name:text(item.name) || 'Unnamed item', branch:text(item.branch) || 'Branch not recorded',
        category:text(item.category) || 'Uncategorized', stock, conversion:validConversion ? conversion : null,
        baseCost, costBasis, purchaseUnitCost, purchaseCostIssue, purchaseCostBasis, purchaseCostDiffers, value, threshold, thresholdConflict, status, statusKind,
        purchaseUnit,
        baseUnit:text(item.baseUom || item.uom) || 'unit'};
}

export function inventoryOverviewModel(items, {branch='All', category='All', search='', allowed=()=>true}={}) {
    const term = text(search).toLocaleLowerCase('en-PH');
    const rows = items.filter(item => allowed(text(item.branch))).map(inventoryOverviewRow)
        .filter(item => (branch === 'All' || item.branch === branch) && (category === 'All' || item.category === category)
            && (!term || item.name.toLocaleLowerCase('en-PH').includes(term)))
        .sort((a,b) => a.name.localeCompare(b.name) || a.branch.localeCompare(b.branch) || a.id.localeCompare(b.id));
    const totalValue = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    return {rows, rowCount:rows.length, uniqueItemCount:new Set(rows.map(row=>row.name)).size,
        totalValue:Number.isFinite(totalValue) ? totalValue : null,
        missingCostCount:rows.filter(row=>row.baseCost === null).length,
        unvaluedStockCount:rows.filter(row=>row.stock !== null && row.stock > 0 && row.value === null).length,
        derivedCostCount:rows.filter(row=>row.costBasis === 'Derived from purchase cost').length,
        negativeCount:rows.filter(row=>row.stock !== null && row.stock < 0).length,
        invalidCount:rows.filter(row=>row.stock === null).length};
}

export function inventoryOverviewDirectory(items, branches=[], allowed=()=>true) {
    const names = [...new Set([...branches.map(row=>text(row.name)), ...items.map(row=>text(row.branch))])]
        .filter(name=>name && allowed(name)).sort((a,b)=>a==='Main Office'?-1:b==='Main Office'?1:a.localeCompare(b));
    const categories = [...new Set(items.filter(row=>allowed(text(row.branch))).map(row=>text(row.category) || 'Uncategorized'))].sort((a,b)=>a.localeCompare(b));
    return {branches:names, categories};
}

// stock_counts is the existing finalized physical-count evidence. Do not call
// a movement log or an empty draft an audit, and do not invent a missing time.
export function latestHqInventoryAudit(rows) {
    return rows.filter(row=>row.branch === 'Main Office' && millis(row.timestamp) !== null
        && Array.isArray(row.counts) && row.counts.some(count=>text(count.name) && numeric(count.physicalQty ?? count.actualQty) !== null && numeric(count.physicalQty ?? count.actualQty) >= 0))
        .sort((a,b)=>millis(b.timestamp)-millis(a.timestamp))[0] || null;
}

export function installInventoryOverview(w=window, d=document) {
    if (w.inventoryOverviewInstalled) return w.inventoryOverviewInstalled;
    const el = id => d.getElementById(id);
    const costHeading = el('inventoryTableBody')?.parentElement?.tHead?.rows?.[0]?.cells?.[6];
    if (costHeading) costHeading.textContent = 'Cost / purchase unit';
    const allowed = branch => !!w.sessionUser
        && (text(w.sessionUser.email).toLowerCase() === OWNER_EMAIL || w.sessionUser.allowedBranches?.some(name=>name==='All' || name===branch))
        && (typeof w.isBranchAllowed !== 'function' || w.isBranchAllowed(branch) === true);
    const permitted = () => !!w.auth?.currentUser?.uid && (!w.sessionUser?.uid || w.sessionUser.uid === w.auth.currentUser.uid)
        && canOpenInventoryTab(w.sessionUser, 'Overview');
    const identity = () => JSON.stringify([w.auth?.currentUser?.uid, w.sessionUser?.uid, w.sessionUser?.email,
        w.sessionUser?.permissions, w.sessionUser?.allowedBranches]);
    let revision = 0, dataEpoch = 0, state = null, activeFlight = null, requiresFreshSnapshot = false;
    const inFlight = new Map();
    const originalInvalidate = typeof w.invalidateCache === 'function' ? w.invalidateCache : null;
    const invalidateShared = (name, ...args) => originalInvalidate?.call(w, name, ...args);
    // Existing inventory writers already announce a completed mutation through
    // this cache hook. Their next load must not reuse our pre-write display or
    // a pre-write server request that has not returned yet.
    if(originalInvalidate)w.invalidateCache=function(name,...args){
        if(name==='inventory' || name==='branches'){
            ++revision;++dataEpoch;state=null;activeFlight=null;requiresFreshSnapshot=true;
            if(el('inventoryRefreshStocks'))el('inventoryRefreshStocks').disabled=false;
        }
        return originalInvalidate.call(this,name,...args);
    };
    const create = (tag, content='', className='') => {const node=d.createElement(tag); if(content!=='')node.textContent=String(content); if(className)node.className=className; return node;};
    const setText = (id, value) => {if(el(id))el(id).textContent=value;};
    const setLabel = (id, value) => {const node=el(id)?.previousElementSibling;if(node)node.textContent=value;};
    let status = el('inventoryOverviewStatus');
    if (!status && el('inventoryTableBody')) {status=create('p','','inventory-overview-status');status.id='inventoryOverviewStatus';el('inventoryTableBody').parentElement?.parentElement?.before(status);}
    status?.setAttribute('role','status'); status?.setAttribute('aria-live','polite');
    const message = (value, error=false) => {if(status){status.textContent=value;status.className='inventory-overview-status'+(error?' inventory-overview-error':'');}};
    const placeholder = value => {const body=el('inventoryTableBody');if(body){const row=create('tr'),cell=create('td',value,'inventory-overview-empty');cell.colSpan=9;row.append(cell);body.replaceChildren(row);}};
    const note = (id, anchorId, value) => {let node=el(id);if(!node && el(anchorId)?.parentElement){node=create('small','','inventory-overview-note');node.id=id;el(anchorId).parentElement.append(node);}if(node)node.textContent=value;};
    const replaceOptions = (select, values, label) => {
        if(!select)return;const current=select.value;
        const nodes=[create('option',label),...values.map(value=>{const option=create('option',value);option.value=value;return option;})];nodes[0].value='All';
        select.replaceChildren(...nodes);select.value=values.includes(current)?current:'All';
        select.disabled=false;
    };
    const render = snapshot => {
        const directory=inventoryOverviewDirectory(snapshot.inventory,snapshot.branches,allowed);
        replaceOptions(el('invBranchFilter'),directory.branches,'All permitted branches');
        replaceOptions(el('invCategoryFilter'),directory.categories,'All categories');
        const model=inventoryOverviewModel(snapshot.inventory,{branch:el('invBranchFilter')?.value || 'All',category:el('invCategoryFilter')?.value || 'All',search:el('liveInvSearch')?.value,allowed});
        const body=el('inventoryTableBody'),fragment=d.createDocumentFragment();
        for(const item of model.rows){
            const row=create('tr','','inventory-overview-row'),checkCell=create('td','','inventory-overview-select'),check=create('input');
            check.type='checkbox';check.className='inv-bulk-checkbox';check.value=item.id;check.dataset.name=item.name;check.setAttribute('aria-label','Select '+item.name+' · '+item.branch);checkCell.append(check);row.append(checkCell);
            row.append(create('td',item.branch,'inventory-overview-branch'),create('td',item.name,'inventory-overview-name'),create('td',item.category,'inventory-overview-category'));
            const stockCell=create('td'),stock=create('strong',item.stock===null?'Not recorded':quantity(item.stock)+' '+item.baseUnit,'inventory-stock-count inventory-stock-'+item.statusKind);stockCell.append(stock);
            if(item.stock!==null && item.conversion && item.conversion!==1 && item.purchaseUnit.toLowerCase()!==item.baseUnit.toLowerCase())stockCell.append(create('small',quantity(item.stock/item.conversion)+' '+item.purchaseUnit,'inventory-overview-pack'));
            row.append(stockCell);const statusCell=create('td'),badge=create('span',item.status,'inventory-stock-status inventory-stock-'+item.statusKind);statusCell.append(badge);
            if(item.threshold===null && item.stock>0)statusCell.append(create('small','Low-stock alert not set','inventory-overview-note'));
            row.append(statusCell);const costCell=create('td',item.purchaseUnitCost===null?item.purchaseCostIssue:money(item.purchaseUnitCost)+' / '+item.purchaseUnit,'inventory-overview-cost');
            costCell.title=item.purchaseUnitCost===null?item.purchaseCostIssue:item.purchaseCostBasis+' / '+item.purchaseUnit
                +(item.purchaseCostDiffers?'. Stock value uses a different recorded base-unit cost.':'');
            costCell.setAttribute('data-label','Cost / purchase unit');
            row.append(costCell,create('td',item.value===null?'Not valued':money(item.value),'inventory-overview-value'));
            const actionCell=create('td','','inventory-overview-actions'),action=create('button','Actions','inventory-row-action action-menu-btn');action.type='button';action.setAttribute('aria-label','Actions for '+item.name+' · '+item.branch);
            action.addEventListener('click',()=>{if(permitted() && allowed(item.branch))w.showInventoryActions?.(item.id,item.name,item.stock,item.baseUnit,item.baseCost,item.branch);});actionCell.append(action);row.append(actionCell);fragment.append(row);
        }
        if(body){body.replaceChildren(fragment);if(!model.rows.length)placeholder('No stock items match these filters.');}
        const all=el('selectAllInv');if(all){all.checked=false;all.indeterminate=false;}
        setLabel('invTotalItems','Stock records shown');setText('invTotalItems',String(model.rowCount));
        note('inventoryItemCountDetail','invTotalItems',model.uniqueItemCount+' item names · current filters');
        setLabel('invTotalValue','Stock value shown');setText('invTotalValue',model.totalValue===null?'Value needs review':money(model.totalValue));
        const coverage=[];if(model.unvaluedStockCount)coverage.push(model.unvaluedStockCount+' positive-stock records excluded: cost needs review');
        if(model.missingCostCount>model.unvaluedStockCount)coverage.push((model.missingCostCount-model.unvaluedStockCount)+' other records have no valid cost');
        if(model.derivedCostCount)coverage.push(model.derivedCostCount+' costs derived from purchase units');
        coverage.push('Negative stock contributes ₱0 to value');note('inventoryValueCoverage','invTotalValue',coverage.join(' · '));
        const audit=snapshot.audit;
        setLabel('kpiLastAudit','Last HQ physical count');
        setText('kpiLastAudit',audit.state==='restricted'?'Outside your audit access':audit.state==='error'?'HQ count unavailable':audit.row?timestampLabel(audit.row.timestamp):'No HQ audit recorded');
        note('inventoryAuditDetail','kpiLastAudit',audit.row?(audit.row.counts.length+' items · '+(text(audit.row.cashier)||'Recorder not recorded')):audit.state==='error'?'Refresh stocks to retry the audit history.':'Saved physical-count evidence only');
        const attention=[];if(model.negativeCount)attention.push(model.negativeCount+' negative counts need an audit');if(model.invalidCount)attention.push(model.invalidCount+' counts need review');
        message((snapshot.fresh?'Server snapshot':'Saved snapshot')+' loaded '+timestampLabel(snapshot.loadedAt)+'. Use Refresh stocks for the latest counts.'+(attention.length?' '+attention.join(' · ')+'.':'')+(snapshot.branchError?' Branch directory unavailable; branches with saved stock are shown.':''));
        return model;
    };
    const read = async (table, fresh) => {
        if(!fresh && typeof w.fetchCachedCollection==='function')return w.fetchCachedCollection(table);
        const snap=await (w.getDocsFromServer || w.getDocs)(w.collection(w.db,table));return snap.docs.map(row=>({...row.data(),id:row.id}));
    };
    const snapshotFor = (fresh, key, epoch) => {
        const flightKey=key+'|'+epoch+'|'+(fresh?'server':'saved');if(inFlight.has(flightKey))return inFlight.get(flightKey);
        const job=(async()=>{
            // Internal cache maintenance is not a new inventory mutation.
            if(fresh && originalInvalidate)await Promise.allSettled(['inventory','branches'].map(name=>invalidateShared(name)));
            const readAudit=async()=>{
                if(!allowed('Main Office') || !canOpenInventoryTab(w.sessionUser,'Audits'))return {state:'restricted',row:null};
                try{const snap=await (w.getDocsFromServer || w.getDocs)(w.query(w.collection(w.db,'stock_counts'),w.where('branch','==','Main Office')));
                    return {state:'ready',row:latestHqInventoryAudit(snap.docs.map(row=>({...row.data(),id:row.id})))};
                }catch{return {state:'error',row:null};}
            };
            const [inventory,branches,audit]=await Promise.allSettled([read('inventory',fresh),read('branches',fresh),readAudit()]);
            if(inventory.status==='rejected')throw inventory.reason;
            return {inventory:inventory.value,branches:branches.status==='fulfilled'?branches.value:[],branchError:branches.status==='rejected',
                audit:audit.status==='fulfilled'?audit.value:{state:'error',row:null},loadedAt:Date.now(),fresh,key,epoch};
        })().finally(()=>inFlight.delete(flightKey));inFlight.set(flightKey,job);return job;
    };
    w.loadInventoryData=async function(options={}){
        const token=++revision,key=identity(),epoch=dataEpoch,fresh=options?.refresh===true || requiresFreshSnapshot;
        if(!permitted()){state=null;placeholder('Unlock an account with Live Stocks access.');setText('invTotalItems','—');setText('invTotalValue','—');message('Live Stocks access is required.',true);return null;}
        const ongoing=activeFlight?.key===key && activeFlight.epoch===epoch?activeFlight:null;
        if(state?.key===key && !fresh && !ongoing && Date.now()-state.loadedAt<60000)return render(state);
        message(fresh?'Refreshing stock counts from the server…':'Loading stock records…');if(!state)placeholder('Loading stock records…');const button=el('inventoryRefreshStocks');if(button)button.disabled=true;
        const request=!fresh && ongoing?ongoing.promise:snapshotFor(fresh,key,epoch);activeFlight={key,epoch,promise:request};
        try{const next=await request;if(token!==revision || epoch!==dataEpoch || key!==identity() || !permitted())return null;state=next;requiresFreshSnapshot=false;return render(state);}
        catch(error){if(token!==revision || key!==identity())return null;placeholder('Stock records could not load. Choose Refresh stocks to retry.');setText('invTotalItems','—');setText('invTotalValue','—');message('Stock records could not load: '+text(error?.message || 'Check your connection.'),true);return null;}
        finally{if(token===revision){if(activeFlight?.promise===request)activeFlight=null;if(button)button.disabled=false;}}
    };
    w.refreshInventoryStocks=()=>w.loadInventoryData({refresh:true});
    if(el('inventoryRefreshStocks'))el('inventoryRefreshStocks').addEventListener('click',w.refreshInventoryStocks);
    return w.inventoryOverviewInstalled={refresh:w.refreshInventoryStocks,render:()=>state&&permitted()?render(state):null};
}
