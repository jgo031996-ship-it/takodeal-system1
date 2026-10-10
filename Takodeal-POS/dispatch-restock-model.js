// Planning only: no inventory, invoice, payment or account writes occur here.
const MAIN_OFFICE='Main Office';
const stockFields=['branch','name','currentStock','uom','baseUom','purchaseUom','purchUom','conversionRate','conversion','baseCost','purchaseCost','purchCost','cost'];
const text=value=>typeof value==='string'?value.trim():'';
const unit=value=>text(value).toLowerCase();
const amount=value=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;
const close=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
function money(value){const result=Math.round((value+Number.EPSILON)*100)/100;if(!Number.isFinite(value)||value<0||!Number.isFinite(result))throw Error('The estimated restock cost is invalid or too large.');return result;}

export function canonicalDispatchIntent(value){
    const seen=new Set();
    function canonical(input){
        if(input===null||typeof input==='string'||typeof input==='boolean')return input;
        if(typeof input==='number'){if(!Number.isFinite(input))throw Error('Dispatch intent contains an invalid number.');return input;}
        if(input instanceof Date){if(!Number.isFinite(input.getTime()))throw Error('Dispatch intent contains an invalid date.');return input.toISOString();}
        if(!input||typeof input!=='object'||seen.has(input))throw Error('Dispatch intent contains an unsupported or circular value.');
        seen.add(input);let result;
        if(Array.isArray(input))result=input.map(canonical);
        else{if(![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error('Dispatch intent must use plain saved values.');result=Object.fromEntries(Object.keys(input).sort().filter(key=>input[key]!==undefined).map(key=>[key,canonical(input[key])]));}
        seen.delete(input);return result;
    }
    return JSON.stringify(canonical(value));
}
function fingerprintValue(value){
    if(value===undefined)return null;
    if(typeof value==='number'&&!Number.isFinite(value))return {invalidSavedNumber:String(value)};
    return value;
}
function fingerprint(row){return canonicalDispatchIntent({id:row.id,...Object.fromEntries(stockFields.map(key=>[key,fingerprintValue(row[key])]))});}
function stockUnits(row){
    const baseUom=text(row.uom)||text(row.baseUom),purchaseUom=text(row.purchaseUom)||text(row.purchUom)||baseUom;
    if(!baseUom||!purchaseUom)throw Error(`The saved stock units for ${row.name} are missing. Review this item before dispatch.`);
    const saved=row.conversionRate??row.conversion,conversionRate=saved==null&&unit(baseUom)===unit(purchaseUom)?1:amount(saved);
    if(!Number.isFinite(conversionRate)||conversionRate<=0||unit(baseUom)===unit(purchaseUom)&&!close(conversionRate,1))
        throw Error(`The saved package conversion for ${row.name} is invalid. Review this item before dispatch.`);
    return {baseUom,purchaseUom,conversionRate};
}
function stockCost(row,conversionRate){
    const base=amount(row.baseCost);if(Number.isFinite(base)&&base>=0)return {knownCost:true,baseCost:base};
    for(const key of ['purchaseCost','purchCost','cost']){const value=amount(row[key]);if(Number.isFinite(value)&&value>=0)return {knownCost:true,baseCost:value/conversionRate};}
    return {knownCost:false,baseCost:null};
}

export function planDispatchRestock(stockRows,items,{source}={}){
    if(typeof source!=='string'||!source.trim()||source!==source.trim()||!Array.isArray(stockRows)||!Array.isArray(items)||!items.length)
        throw Error('Choose a source branch and valid dispatch items before preparing the restock preview.');
    const rows=stockRows.filter(row=>row?.branch===source),byId=new Map();
    for(const row of rows){if(typeof row.id!=='string'||!row.id||row.id.includes('/')||byId.has(row.id))throw Error('Source inventory IDs are missing or duplicated. Refresh Dispatch.');byId.set(row.id,row);}
    const requested=new Map();
    for(const item of items){
        const name=item?.itemName||item?.name,qty=amount(item?.qty);
        if(typeof name!=='string'||!name.trim()||!Number.isFinite(qty)||qty<=0)throw Error('Enter a positive finite base quantity for every dispatched item.');
        const matches=rows.filter(row=>row.name===name);
        if(matches.length!==1)throw Error(`Missing or duplicate inventory item: ${name} (source: ${source}, matches: ${matches.length}).`);
        const row=matches[0];
        if(item.sourceId!==undefined&&item.sourceId!==null&&item.sourceId!==''&&item.sourceId!==row.id)throw Error(`The source stock for ${name} changed. Reload the delivery.`);
        const units=stockUnits(row),declared=item.baseUom||item.uom;
        if(declared!==undefined&&declared!==null&&declared!==''&&unit(declared)!==unit(units.baseUom))throw Error(`The dispatch base unit for ${name} does not match its source stock. Reload the delivery.`);
        const old=requested.get(row.id);if(old){old.dispatchQty+=qty;if(!Number.isFinite(old.dispatchQty))throw Error('The combined dispatch quantity is too large.');}
        else requested.set(row.id,{row,...units,dispatchQty:qty});
    }
    const lines=[...requested.values()].sort((a,b)=>a.row.id.localeCompare(b.row.id)).map(({row,dispatchQty,baseUom,purchaseUom,conversionRate})=>{
        const current=amount(row.currentStock);if(!Number.isFinite(current))throw Error(`The current stock for ${row.name} is unknown. Confirm the saved balance before dispatch.`);
        const auto=source===MAIN_OFFICE&&current<dispatchQty,correctionQty=auto?Math.max(0,-current):0,restockQty=auto?dispatchQty-Math.max(current,0):0;
        // A shortage plan purchases exactly its deficit, so its mathematical
        // remainder is zero even when decimal quantities have binary roundoff.
        const afterDispatchQty=auto?0:current-dispatchQty,cost=stockCost(row,conversionRate);
        if(!Number.isFinite(afterDispatchQty))throw Error('The resulting dispatch balance is too large.');
        const estimatedUnitCost=cost.knownCost?cost.baseCost*conversionRate:null;
        if(estimatedUnitCost!==null&&!Number.isFinite(estimatedUnitCost))throw Error(`The saved cost for ${row.name} is too large.`);
        return {id:row.id,name:row.name,oldQty:current,current,dispatchQty,correctionQty,restockQty,afterDispatchQty,baseUom,purchaseUom,conversionRate,...cost,
            estimatedUnitCost,estimatedSubtotal:cost.knownCost?money(restockQty*cost.baseCost):null,expectedFingerprint:fingerprint(row)};
    });
    const needed=lines.filter(line=>line.restockQty>0),hasUnknownCost=needed.some(line=>!line.knownCost);
    return {version:1,source,lines,needsRestock:needed.length>0,hasUnknownCost,estimatedTotal:hasUnknownCost?null:money(needed.reduce((sum,line)=>sum+line.estimatedSubtotal,0))};
}

export function assertDispatchRestockCurrent(plan,currentStockRows,items){
    if(!plan||plan.version!==1||!Array.isArray(plan.lines))throw Error('Reopen the dispatch restock preview.');
    const current=planDispatchRestock(currentStockRows,items,{source:plan.source});
    if(canonicalDispatchIntent(current)!==canonicalDispatchIntent(plan))throw Error('Source stock, units, prices or dispatch quantities changed. Review the restock preview again before sending.');
    return current;
}

// Dispatch-linked restocks cannot use the legacy standalone invoice rollback.
export function isDispatchAutoRestock(row){return row?.dispatchAutoRestock===true||typeof row?.dispatchBatchId==='string'&&row.dispatchBatchId.trim()!=='';}
