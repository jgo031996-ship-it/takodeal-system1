// The original receipt row index is the identity: equal names with different
// sizes, notes or extras must never be merged. Currency is apportioned in cents
// across the original units so the last portion cannot create or lose pennies.
export const MAX_CANCELLED_FOOD_LINES=6;
export const cancelledFoodAllocationId=sourceSaleId=>sourceSaleId;
const integer=(value,label,{positive=false}={})=>{if(!Number.isSafeInteger(value)||value<(positive?1:0))throw Error(`Invalid ${label}. Ask HQ to review the original receipt.`);return value;};
export function cancelledFoodLineCents(item){
    const qty=integer(item.qty,'item quantity',{positive:true});
    if(qty>100000)throw Error('The original item quantity needs HQ review.');
    const amount=item.lineTotalFinal??Number(item.price??item.variantPrice??item.basePrice)*qty;
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100))||Math.round(amount*100)>10000000000)throw Error('The original item price needs HQ review.');
    return Math.round(amount*100);
}
export function cancelledFoodAvailableLine(sourceSaleId,item,lineIndex,allocation){
    integer(item.qty,'item quantity',{positive:true});
    const purchasedQty=allocation?integer(allocation.purchasedQuantities[String(lineIndex)]??0,'purchased quantity'):0;
    if(purchasedQty>item.qty)throw Error('The saved food allocation needs HQ review.');
    return {lineIndex,allocationId:cancelledFoodAllocationId(sourceSaleId,lineIndex),item:structuredClone(item),originalQty:item.qty,purchasedQty,remainingQty:item.qty-purchasedQty,lineBaseCents:cancelledFoodLineCents(item)};
}
export function createCancelledFoodOperationId(cryptoApi=globalThis.crypto){
    if(!cryptoApi?.getRandomValues)throw Error('Secure purchase IDs are unavailable. Reload this device.');
    const bytes=new Uint8Array(16);cryptoApi.getRandomValues(bytes);return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function quoteCancelledFoodPortion(offer,chosen,operationId){
    if(!/^[a-f0-9]{32}$/.test(operationId))throw Error('Reopen this receipt to start a new staff purchase.');
    if(!Array.isArray(chosen)||!chosen.length)throw Error('Choose at least one available item.');
    if(chosen.length>MAX_CANCELLED_FOOD_LINES)throw Error(`Choose up to ${MAX_CANCELLED_FOOD_LINES} different receipt lines per purchase. You can make another purchase for more items.`);
    const percent=offer.discountPct;
    if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)throw Error('The saved discount needs HQ review.');
    const seen=new Set();
    const selection=chosen.map(choice=>{
        const lineIndex=integer(choice.lineIndex,'receipt line'),qty=integer(choice.qty,'selected quantity',{positive:true}),line=offer.lines.find(row=>row.lineIndex===lineIndex);
        if(!line||seen.has(lineIndex)||qty>line.remainingQty)throw Error('One of these items is no longer available. Refresh the receipt and choose the remaining quantities.');
        seen.add(lineIndex);
        const start=Math.round(line.lineBaseCents*line.purchasedQty/line.originalQty),end=Math.round(line.lineBaseCents*(line.purchasedQty+qty)/line.originalQty);
        const baseCents=end-start,discountCents=Math.round(end*percent/100)-Math.round(start*percent/100);
        integer(baseCents,'portion price');integer(discountCents,'portion discount');
        return {lineIndex,qty,allocationId:line.allocationId,priorPurchasedQty:line.purchasedQty,baseCents,discountCents};
    }).sort((a,b)=>a.lineIndex-b.lineIndex);
    const base=selection.reduce((sum,row)=>sum+row.baseCents,0),discount=selection.reduce((sum,row)=>sum+row.discountCents,0);
    integer(base,'purchase total');integer(discount,'purchase discount');
    return {portionVersion:1,operationId,sourceSaleId:offer.sourceSaleId,branch:offer.branch,shiftId:offer.shiftId,sourceReceiptId:offer.sourceReceiptId,platform:offer.platform,baseAmount:base/100,discountPct:percent,discountAmount:discount/100,amount:(base-discount)/100,fingerprint:offer.fingerprint,selection};
}
export function cancelledFoodPortionCart(sale,quote){return quote.selection.map(row=>({...structuredClone(sale.cart[row.lineIndex]),qty:row.qty,lineTotalFinal:row.baseCents/100,sourceLineIndex:row.lineIndex,sourceOriginalQty:sale.cart[row.lineIndex].qty,baseAmount:row.baseCents/100,discountAmount:row.discountCents/100,amount:(row.baseCents-row.discountCents)/100}));}
export function cancelledFoodPurchasedItems(sale,quote){return cancelledFoodPortionCart(sale,quote);}
