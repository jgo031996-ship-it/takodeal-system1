// Franchise documents contain selling prices only. HQ ingredient costs and
// markup calculations stay out of order, invoice and receipt snapshots.
export const MAX_SUPPLY_LINES=80;
const fail=message=>{throw Error(message);};
const numeric=(value,label,{positive=false}={})=>typeof value==='number'&&Number.isFinite(value)&&value>=(positive?Number.MIN_VALUE:0)?value:fail('A valid '+label+' is required.');
const label=(value,name)=>typeof value==='string'&&value.trim()&&value.length<=240?value:fail('A saved '+name+' is required.');
const cents=(value,name='supply price')=>{numeric(value,name);const rounded=Math.round(value*100);if(!Number.isSafeInteger(rounded)||rounded>10000000000||Math.abs(value*100-rounded)>0.00001)fail('The saved '+name+' needs HQ review.');return rounded;};
const totalCents=(unitPrice,quantity)=>{const result=Math.round(cents(unitPrice)*numeric(quantity,'quantity',{positive:true}));if(!Number.isSafeInteger(result)||result<0||result>10000000000)fail('The supply total needs HQ review.');return result;};
const adjustment=quote=>{const value=quote.roundingAdjustmentCents??0;if(!Number.isSafeInteger(value)||Math.abs(value)>100)fail('The saved cent allocation needs HQ review.');return value;};
const quotedCents=(quote,quantity)=>{const base=quote.version===1?Math.round(quote.unitPrice*quantity*100):totalCents(quote.unitPrice,quantity),amount=base+(quote.version===1?0:adjustment(quote));if(!Number.isSafeInteger(amount)||amount<0)fail('The saved supply total needs HQ review.');return amount;};
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const supplyFingerprint=value=>JSON.stringify(canonical(value));
export function priceOnlySupplyQuote(quote,{quantity,conversionRate,unit}={}){
 if(quote==null)return null;
 const qty=numeric(quantity??quote.quantity,'quoted quantity',{positive:true}),rate=numeric(conversionRate??quote.conversionRate,'unit conversion',{positive:true}),price=quote.unitPrice;
 cents(price);if(quote.quantity!=null&&quote.quantity!==qty||quote.conversionRate!=null&&quote.conversionRate!==rate)fail('The saved supply quote has different quantities or units.');
 const version=quote.version===2?2:1,total=quotedCents({...quote,version},qty)/100;if(quote.total!=null&&quote.total!==total)fail('The saved supply quote total needs HQ review.');
 return {version,currency:'PHP',unitPrice:price,quantity:qty,total,conversionRate:rate,unit:label(unit??quote.unit??'units','supply unit'),source:'Saved HQ supply pricing',...(version===2?{roundingAdjustmentCents:adjustment(quote)}:{})};
}
export function cleanSupplyItem(item){
 const displayQty=numeric(item.displayQty??item.rawQty,'requested quantity',{positive:true}),convRate=numeric(item.convRate??item.supplyQuote?.conversionRate,'unit conversion',{positive:true}),displayUom=label(item.displayUom,'supply unit'),baseUom=label(item.baseUom,'base unit'),name=label(item.name??item.itemName,'item name'),hqItemId=label(item.hqItemId,'HQ item link');
 if(hqItemId.includes('/'))fail('The saved HQ item link needs review.');
 const qty=displayQty*convRate;if(!Number.isFinite(qty)||qty<=0||item.qty!=null&&Math.abs(item.qty-qty)>1e-8)fail('The saved supply quantities need HQ review.');
 const supplyQuote=priceOnlySupplyQuote(item.supplyQuote,{quantity:displayQty,conversionRate:convRate,unit:displayUom});
 return {hqItemId,name,itemName:name,rawQty:displayQty,displayQty,displayUom,baseUom,qty,convRate,requestType:'Franchise Restock Order',supplyQuote,pricingStatus:supplyQuote?'Quoted at submission':'HQ quote required'};
}
// Public purchase-order rows are logistics only. Prices, supplier costs,
// account emails and recipient signatures stay in franchise_supply_orders.
export function supplyDispatchItems(items){
 if(!Array.isArray(items)||!items.length||items.length>MAX_SUPPLY_LINES)fail('Add 1–80 supply lines to a request.');
 return items.map(item=>{const {hqItemId,name,itemName,rawQty,displayQty,displayUom,baseUom,qty,convRate,requestType}=cleanSupplyItem(item);return {hqItemId,name,itemName,rawQty,displayQty,displayUom,baseUom,qty,convRate,requestType};});
}
// Before an invoice exists, HQ manages only the linked public logistics status.
// Display that fresh status without changing the immutable private quotation.
export function supplyOrderDisplay(order,stub){
 if(order?.quoteVersion!==2||order.dispatchInvoice||order.deliveryReceipt)return order;
 if(!order.id||stub?.id!==order.id||stub.quoteVersion!==2||stub.branch!==order.branch||stub.type!=='Franchise Order'||supplyFingerprint(stub.items)!==supplyFingerprint(order.dispatchItems)||supplyFingerprint(order.dispatchItems)!==supplyFingerprint(supplyDispatchItems(order.items)))fail('This supply order’s logistics request needs HQ review.');
 if(!['Pending','Drafting','Delayed','Approved','Rejected','Cancelled','Canceled'].includes(stub.status)||stub.dispatchBatchId||stub.completedAt)fail('This supply order’s delivery status needs HQ review.');
 return {...order,status:stub.status};
}
export function supplyTotals(items){
 if(!Array.isArray(items)||!items.length||items.length>MAX_SUPPLY_LINES)fail('Add 1–80 supply lines to a request.');
 let quoted=0,unpricedItems=0;
 for(const item of items){const quote=item.supplyQuote;if(!quote){unpricedItems++;continue;}const qty=numeric(item.displayQty??quote.quantity,'requested quantity',{positive:true});cents(quote.unitPrice);const amount=quotedCents(quote,qty);if(quote.total!==amount/100)fail('The saved supply quote total needs HQ review.');quoted+=amount;}
 if(!Number.isSafeInteger(quoted)||quoted>10000000000)fail('The supply total needs HQ review.');
 return {version:1,currency:'PHP',quotedSubtotal:quoted/100,subtotal:unpricedItems?null:quoted/100,grandTotal:unpricedItems?null:quoted/100,unpricedItems,chargesIncluded:false};
}
export function supplyOrderView(order){
 if(!order||!Array.isArray(order.items)||!order.items.length)fail('This supply order has no saved item details.');
 const items=order.items.map(item=>{
  // Old orders can be displayed without inventing prices or package links.
  if(order.quoteVersion!==2)return {name:String(item.name??item.itemName??'Item'),displayQty:item.displayQty??item.rawQty??item.qty??null,displayUom:String(item.displayUom??item.uom??''),supplyQuote:item.supplyQuote?priceOnlySupplyQuote(item.supplyQuote,{quantity:item.displayQty??item.supplyQuote.quantity,conversionRate:item.convRate??item.supplyQuote.conversionRate,unit:item.displayUom??item.uom??'units'}):null};
  if(item.supplyQuote&&item.supplyQuote.version!==2)fail('This saved supply order price version needs HQ review.');return cleanSupplyItem(item);
 });
 const totals=supplyTotals(items);if(order.supplyInvoice&&supplyFingerprint(order.supplyInvoice)!==supplyFingerprint(totals))fail('This saved order quotation needs HQ review.');
 return {id:String(order.id??''),branch:String(order.branch??''),items,totals,legacy:order.quoteVersion!==2};
}
export function priceOrderDeliveryLine(orderItem,baseQty,{priorBaseQty=0}={}){
 const item=cleanSupplyItem(orderItem),quantity=numeric(baseQty,'dispatched quantity',{positive:true}),prior=numeric(priorBaseQty,'previous dispatched quantity');
 if(prior+quantity>item.qty+1e-8)fail('A delivery quantity exceeds the saved supply order.');
 const displayQty=quantity/item.convRate,quote=item.supplyQuote;
 const amount=quote?(Math.round(cents(quote.total,'saved line total')*(prior+quantity)/item.qty)-Math.round(cents(quote.total,'saved line total')*prior/item.qty))/100:null;
 return {hqItemId:item.hqItemId,name:item.name,baseQty:quantity,baseUom:item.baseUom,displayQty,displayUom:item.displayUom,conversionRate:item.convRate,unitPrice:quote?.unitPrice??null,total:amount};
}
export function allocateFranchiseDispatchInvoices(orders,deliveries,{dispatchBatchId,actorUid,actorEmail}={}){
 label(dispatchBatchId,'delivery batch');label(actorUid,'HQ issuer');label(actorEmail,'HQ issuer email');
 if(!Array.isArray(orders)||!orders.length||!Array.isArray(deliveries)||!deliveries.length||deliveries.length>MAX_SUPPLY_LINES)fail('Review the linked supply orders and delivery lines.');
 const lookup=new Map(),branch=label(orders[0]?.branch,'destination branch');
 for(const order of orders){if(order.quoteVersion!==2)fail('Legacy and new priced requests must be dispatched separately.');if(order.branch!==branch)fail('A linked supply order belongs to a different destination branch.');const view=supplyOrderView(order);if(!order.id||lookup.has(order.id))fail('A linked supply order is missing or duplicated.');lookup.set(order.id,{order,view,lines:[],used:new Map()});}
 const ids=new Set();
 for(const delivery of deliveries){const dispatchLogId=label(delivery.dispatchLogId,'delivery line link');if(ids.has(dispatchLogId))fail('A delivery line is duplicated.');ids.add(dispatchLogId);
  const orderId=delivery.purchaseOrderId??delivery.orderId,index=delivery.purchaseOrderLineIndex??delivery.orderLineIndex;
  const candidates=[];for(const [id,entry]of lookup){if(orderId&&orderId!==id)continue;entry.view.items.forEach((item,lineIndex)=>{if(index!=null&&lineIndex!==index)return;const linked=delivery.hqItemId??delivery.sourceId??delivery.reference?.id;const name=delivery.itemName??delivery.name??delivery.item;if(linked?linked===item.hqItemId:name===item.name)candidates.push({entry,lineIndex,item});});}
  if(candidates.length!==1)fail('The delivery item has missing or ambiguous order links. Reload the original request before sending.');
  const {entry,lineIndex,item}=candidates[0];if(delivery.baseUom!=null&&delivery.baseUom!==item.baseUom||delivery.uom!=null&&delivery.uom!==item.baseUom)fail('The delivery base unit differs from the saved order. Ask HQ to review it.');
  const previous=entry.used.get(lineIndex)??0,priced=priceOrderDeliveryLine(item,numeric(delivery.qty??delivery.quantity,'dispatched quantity',{positive:true}),{priorBaseQty:previous});entry.used.set(lineIndex,previous+priced.baseQty);entry.lines.push({dispatchLogId,orderLineIndex:lineIndex,...priced});
 }
 return [...lookup].map(([orderId,entry])=>{
  if(!entry.lines.length)fail('A linked order has no dispatched items. Remove that order from this delivery.');
  const unknown=entry.lines.filter(line=>line.total===null).length,known=entry.lines.reduce((sum,line)=>sum+(line.total===null?0:cents(line.total,'delivery line total')),0)/100;
  const remaining=entry.view.items.flatMap((item,index)=>{const used=entry.used.get(index)??0,left=item.qty-used;if(left<=1e-8)return [];const qty=left/item.convRate;let supplyQuote=null;if(item.supplyQuote){const original=cents(item.supplyQuote.total,'saved line total'),remainingCents=original-Math.round(original*used/item.qty);supplyQuote={...item.supplyQuote,quantity:qty,total:remainingCents/100,roundingAdjustmentCents:remainingCents-totalCents(item.supplyQuote.unitPrice,qty)};}return [cleanSupplyItem({...item,rawQty:qty,displayQty:qty,qty:left,supplyQuote})];});
  const dispatchInvoice={version:1,currency:'PHP',orderId,branch:entry.order.branch,dispatchBatchId,lines:entry.lines,quotedSubtotal:known,subtotal:unknown?null:known,grandTotal:unknown?null:known,unpricedItems:unknown,chargesIncluded:false,approvedByUid:actorUid,approvedByEmail:actorEmail};
  return {orderId,dispatchLogIds:entry.lines.map(line=>line.dispatchLogId),dispatchInvoice,residualItems:remaining,residualInvoice:remaining.length?supplyTotals(remaining):null};
 });
}
export function validateSupplyDispatchInvoice(order){
 const invoice=order?.dispatchInvoice,ids=order?.dispatchLogIds;
 if(!invoice||invoice.version!==1||invoice.orderId!==order.id||invoice.branch!==order.branch||!invoice.dispatchBatchId||invoice.dispatchBatchId!==order.dispatchBatchId||!Array.isArray(invoice.lines)||!invoice.lines.length||invoice.lines.length>MAX_SUPPLY_LINES||!Array.isArray(ids)||ids.length!==invoice.lines.length||new Set(ids).size!==ids.length)fail('HQ must issue and link the final delivery invoice before it can be signed.');
 const rebuilt=allocateFranchiseDispatchInvoices([order],invoice.lines.map(line=>({dispatchLogId:line.dispatchLogId,hqItemId:line.hqItemId,purchaseOrderId:order.id,purchaseOrderLineIndex:line.orderLineIndex,qty:line.baseQty})),{dispatchBatchId:invoice.dispatchBatchId,actorUid:invoice.approvedByUid,actorEmail:invoice.approvedByEmail})[0].dispatchInvoice;
 const {recordedAt,...saved}=invoice;if(!recordedAt||supplyFingerprint(saved)!==supplyFingerprint(rebuilt))fail('This final delivery invoice needs HQ review before signing.');
 if(invoice.lines.some(line=>!ids.includes(line.dispatchLogId)))fail('The final invoice delivery links need HQ review.');return invoice;
}
export function deliveryReceiptVerification(order,rows){
 const invoice=validateSupplyDispatchInvoice(order),ids=order.dispatchLogIds;
 if(!Array.isArray(rows)||rows.length!==ids.length||new Set(rows.map(row=>row.id)).size!==ids.length||ids.some(id=>!rows.some(row=>row.id===id)))fail('Some saved delivery lines could not be confirmed. Refresh this shipment.');
 return invoice.lines.map(line=>{
  const row=rows.find(entry=>entry.id===line.dispatchLogId);if(!row||!ids.includes(line.dispatchLogId)||row.toBranch!==order.branch||(row.batchId??row.dispatchId)!==order.dispatchBatchId||row.item!==line.name||row.sourceId!==line.hqItemId||row.uom!==line.baseUom||typeof row.qty!=='number'||!Number.isFinite(row.qty)||Math.abs(row.qty-line.baseQty)>1e-8||row.convRate!==line.conversionRate)fail('A delivered item no longer matches the HQ invoice. Ask HQ to review it.');
  if(!['Received','Discrepancy','Lost in Transit'].includes(row.status)||!row.receivedAt||!row.receivedBy||typeof row.receivedQty!=='number'||!Number.isFinite(row.receivedQty)||row.receivedQty<0||typeof row.receivedDisplayQty!=='number'||!Number.isFinite(row.receivedDisplayQty)||row.receivedDisplayQty<0)fail('Verify and receive every delivery line before signing. In-transit or unverified items cannot be acknowledged.');
  const variance=row.receivedQty-line.baseQty;if(row.status==='Received'&&Math.abs(variance)>1e-8||row.status==='Discrepancy'&&Math.abs(variance)<=1e-8||row.status==='Lost in Transit'&&row.receivedQty!==0)fail('The delivery status and received quantities need HQ review.');
  const rate=numeric(line.conversionRate,'invoice unit conversion',{positive:true});if(Math.abs(row.receivedDisplayQty*rate-row.receivedQty)>1e-8)fail('The saved receiving quantities need HQ review.');
  return {id:row.id,status:row.status,expectedQty:line.baseQty,receivedQty:row.receivedQty,baseUom:line.baseUom,displayUom:line.displayUom,receivedDisplayQty:row.receivedDisplayQty};
 });
}
export function validateSupplySignature(value){if(typeof value!=='string'||value.length<80||value.length>200000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))fail('Draw a clear signature using the signing box.');return value;}
