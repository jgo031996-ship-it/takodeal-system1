// Presentation only: inventory/report quantities remain in their saved base units.
const value=input=>{
    if(typeof input!=='number' && typeof input!=='string' || typeof input==='string' && !input.trim())return null;
    const number=Number(input);return Number.isFinite(number) && number>=0?number:null;
};
const unit=input=>typeof input==='string' && input.trim().length<=64?input.trim():'';
const sameUnit=(a,b)=>a.toLowerCase()===b.toLowerCase();
const close=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
export const formatStockQuantity=number=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:6}).format(number);
const text=(quantity,uom)=>`${formatStockQuantity(quantity)} ${uom || 'base units (unit not recorded)'}`;
export function createCountSnapshot({baseUom,purchaseUom,conversionRate,purchaseCount,baseCount,totalBaseQty}) {
    const b=unit(baseUom),p=unit(purchaseUom),rate=value(conversionRate),whole=value(purchaseCount),loose=value(baseCount),total=value(totalBaseQty);
    if(!b || !p || rate===null || rate<=0 || whole===null || loose===null || total===null || !Number.isFinite(whole*rate+loose) || !close(whole*rate+loose,total))throw Error('Check the count quantities and saved unit conversion before submitting.');
    if(sameUnit(b,p) && rate!==1 && whole>0)throw Error('Purchase and base units have the same name but different quantities. Ask HQ to correct the item units.');
    return {version:1,baseUom:b,purchaseUom:p,conversionRate:rate,purchaseCount:whole,baseCount:loose,totalBaseQty:total};
}
function snapshotOf(item,warnings) {
    if(!item.countSnapshot)return null;
    try {
        if(item.countSnapshot.version!==1)throw Error('Unknown count snapshot version.');
        const saved=createCountSnapshot(item.countSnapshot),physical=value(item.physicalStock);
        if(physical!==null && !close(physical,saved.totalBaseQty))throw Error('Saved count does not match physical stock.');
        return saved;
    } catch {warnings.push('Saved count units are inconsistent; base stock is shown.');return null;}
}
export function stockReportQuantities(item={}) {
    const warnings=[],snapshot=snapshotOf(item,warnings);
    const baseUom=snapshot?.baseUom || unit(item.baseUom) || unit(item.uom);
    const purchaseUom=snapshot?.purchaseUom || unit(item.purchaseUom) || unit(item.purchUom) || unit(item.displayUom) || baseUom;
    const baseRequested=value(item.qty),rawRequested=value(item.rawQty),physical=value(item.physicalStock),system=value(item.systemStock);
    const selectedBase=item.selectedUom==='base';
    const requestedUom=selectedBase?baseUom:unit(item.displayUom) || unit(item.friendlyUom) || purchaseUom;
    // Historical manual auto-fill records omitted conversion metadata, but kept
    // base qty and purchase rawQty together. Recover only that saved ratio.
    const rawRatio=!selectedBase && baseUom && purchaseUom && requestedUom && sameUnit(requestedUom,purchaseUom) && baseRequested!==null && rawRequested!==null && rawRequested>0 && baseRequested>0?baseRequested/rawRequested:null;
    const sameNameMismatch=rawRatio!==null && sameUnit(baseUom,purchaseUom) && (!Number.isFinite(rawRatio) || !close(rawRatio,1));
    const ratio=sameNameMismatch?null:rawRatio;
    if(sameNameMismatch)warnings.push('Saved base and purchase units have the same name but their quantities disagree; saved base quantities are shown.');
    const inconsistent=Boolean(item.countSnapshot && !snapshot);
    let conversion=snapshot?.conversionRate || (!inconsistent && ratio>0 && Number.isFinite(ratio)?ratio:null);
    const conversionSource=snapshot?'snapshot':conversion?'saved-request-ratio':'unavailable';
    if(!conversion && physical!==null && baseUom && purchaseUom && !sameUnit(baseUom,purchaseUom))warnings.push('Package conversion was not retained; the reported base-unit count is shown.');
    const baseDisplay=quantity=>quantity===null?null:{text:text(quantity,baseUom),baseText:text(quantity,baseUom),baseQuantity:quantity,unit:baseUom || null};
    const converted=quantity=>{
        if(quantity===null)return null;
        const display=baseDisplay(quantity);
        if(conversion && purchaseUom && baseUom && !sameUnit(baseUom,purchaseUom)) {display.text=text(quantity/conversion,purchaseUom);display.unit=purchaseUom;}
        return display;
    };
    let reported=converted(physical),requested=baseDisplay(baseRequested);
    if(snapshot && reported) {
        const parts=[];
        if(sameUnit(snapshot.purchaseUom,snapshot.baseUom))parts.push(text(snapshot.totalBaseQty,snapshot.baseUom));
        else {
            if(snapshot.purchaseCount>0)parts.push(text(snapshot.purchaseCount,snapshot.purchaseUom));
            if(snapshot.baseCount>0 || !parts.length)parts.push(text(snapshot.baseCount,snapshot.baseUom));
        }
        reported.text=parts.join(' + ');
    }
    if(rawRequested!==null && requestedUom && baseRequested!==null && (selectedBase && close(rawRequested,baseRequested) || conversion && sameUnit(requestedUom,purchaseUom) && close(rawRequested*conversion,baseRequested))) {
        requested={...requested,text:text(rawRequested,requestedUom),unit:requestedUom};
    } else if(rawRequested===null && value(item.displayQty)!==null && unit(item.displayUom)) {
        // Explicit display quantities on ordinary requests carry their own unit.
        // They are not treated as a physical count or conversion evidence.
        requested={...(requested || {baseText:null,baseQuantity:null}),text:text(value(item.displayQty),unit(item.displayUom)),unit:unit(item.displayUom)};
    } else if(rawRequested!==null && baseRequested!==null && !selectedBase && conversion && !close(rawRequested*conversion,baseRequested))warnings.push('Requested quantity units disagree; the saved base request is shown.');
    if(!requested && rawRequested!==null && requestedUom)requested={text:text(rawRequested,requestedUom),baseText:null,baseQuantity:null,unit:requestedUom};
    return {reported,requested,system:converted(system),conversionSource,warnings,baseUom:baseUom || null,purchaseUom:purchaseUom || null};
}
