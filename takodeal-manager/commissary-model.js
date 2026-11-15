import {activeInventoryTemplate} from './branch-inventory-model.js';
// Weekly evidence reconciliation. Money is reported from actual handovers,
// never deducted from POS revenue or replayed into a drawer/account balance.
export const COMMISSARY_VERSION=1;
const text=(v,label,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw Error('Enter '+label+'.');return v.trim();};
const number=(v,label)=>{if(v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1e9)throw Error('Check '+label+'.');return Number(v);};
export const cashCents=(v,label='cash amount')=>{const n=number(v,label),c=Math.round(n*100);if(Math.abs(c/100-n)>1e-7)throw Error('Use at most two decimal places for '+label+'.');return c;};
export const phDay=(now=new Date())=>new Date(+now+28800000).toISOString().slice(0,10);
export const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function monday(day=phDay()){const n=new Date(day+'T00:00:00Z').getUTCDay();return addDays(day,-((n+6)%7));}
function date(v,label){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Check '+label+'.');return v;}
export const validId=v=>typeof v==='string'&&v.length>0&&v.length<200&&!/[\/\x00-\x1f]/.test(v)&&v!=='.'&&v!=='..';
export function normalizeCommissary(input,{today=phDay()}={}){
 const branch=text(input.branch,'the funding branch'),collector=text(input.collector,'the collector'),week=date(input.week,'week starting date');
 if(monday(week)!==week||week>today)throw Error('Choose a Monday starting this week or an earlier week.');
 const openingCents=cashCents(input.opening,'opening collector cash'),remittedCents=cashCents(input.remitted,'cash already remitted'),countedCents=cashCents(input.counted,'cash still held');
 if(!Array.isArray(input.collections)||input.collections.length!==7)throw Error('Review all seven daily cash collections.');
 const collections=input.collections.map((r,i)=>{const day=addDays(week,i),amountCents=cashCents(r.amount,'daily cash collected');if(day>today&&amountCents)throw Error('Future cash collections cannot be posted.');const reference=amountCents?text(r.reference,'a handover reference for '+day,200):'';return {day,amountCents,reference};});
 if(!Array.isArray(input.receipts)||input.receipts.length>250)throw Error('Use at most 250 receipt lines in one weekly review.');
 const handovers=collections.filter(r=>r.amountCents).map(r=>r.reference.toLowerCase());if(new Set(handovers).size!==handovers.length)throw Error('A handover reference is repeated. Record each physical collection once.');
 const receipts=input.receipts.map(r=>{
  const purchaseDate=date(r.purchaseDate,'purchase date');if(purchaseDate<week||purchaseDate>addDays(week,6)||purchaseDate>today)throw Error('Receipt dates must fall within the selected week and cannot be in the future.');
  if(!validId(r.inventoryId)||r.matchId&&!validId(r.matchId)||r.expenseId&&!validId(r.expenseId))throw Error('Select saved stock, restock and expense references.');
  const qty=number(r.qty,'received base quantity');if(qty<=0||Math.abs(qty*1e6-Math.round(qty*1e6))>1e-5)throw Error('Use a positive received quantity with at most six decimal places.');
  const collectorPaid=r.collectorPaid!==false;if(!collectorPaid&&!r.expenseId)throw Error('Link the existing expense for a purchase already paid from another account.');
  return {inventoryId:r.inventoryId,supplier:text(r.supplier,'the supplier'),reference:text(r.reference,'the receipt reference',200),purchaseDate,qty,costCents:cashCents(r.cost,'receipt line cost'),matchId:r.matchId==='__separate__'?'':r.matchId||'',expenseId:r.expenseId||'',collectorPaid,separatePurchase:r.separatePurchase===true||r.matchId==='__separate__'};
 });
 const collectionCents=collections.reduce((s,r)=>s+r.amountCents,0),purchaseCents=receipts.filter(r=>r.collectorPaid).reduce((s,r)=>s+r.costCents,0),receiptTotalCents=receipts.reduce((s,r)=>s+r.costCents,0),expectedCents=openingCents+collectionCents-purchaseCents-remittedCents,varianceCents=countedCents-expectedCents;
 if(expectedCents<0)throw Error('Purchases and remittance exceed the recorded opening cash and collections. Reconcile the funding before posting.');
 const note=String(input.note||'').trim();if(note.length>1000||varianceCents&&note.length<8)throw Error('Explain the cash difference in at least eight characters.');
 if(input.confirmed!==true)throw Error('Confirm actual cash handovers, physically received quantities and duplicate checks before posting.');
 return {version:COMMISSARY_VERSION,branch,collector,week,collections,receipts,openingCents,collectionCents,purchaseCents,receiptTotalCents,remittedCents,countedCents,expectedCents,varianceCents,note,confirmed:true};
}
export function planCommissaryStock(lines,inventory,restocks,expenseStocks=[]){
 const effects=new Map(),matches=new Map(),allocations=[];
 for(const line of lines){
  const stock=inventory.find(r=>r.id===line.inventoryId);if(!stock||!activeInventoryTemplate(stock)||!stock.branch||!stock.name)throw Error('A receipt stock item is missing or inactive. Refresh and review it.');
  const before=Number(stock.currentStock);if(stock.currentStock==null||!Number.isFinite(before))throw Error('A stock balance is unknown. Review '+stock.name+'.');
  let matchedQty=0;const encoded=expenseStocks.find(r=>r.expenseId===line.expenseId);if(encoded){if(line.matchId||encoded.inventoryId!==stock.id||encoded.branch!==stock.branch||Number(encoded.variance)!==line.qty||String(encoded.uom).toLowerCase()!==String(stock.uom||stock.baseUom).toLowerCase()||lines.filter(r=>r.expenseId===line.expenseId).length!==1)throw Error('The existing expense stock receipt does not match this exact item, quantity and unit. Review the original recorded stock.');matchedQty=line.qty;}
  if(line.matchId){
   const invoice=restocks.find(r=>r.id===line.matchId),item=invoice?.items?.find(r=>r.id===stock.id);
   if(!invoice?.dispatchAutoRestock||stock.branch!=='Main Office'||!item)throw Error('The selected estimated restock does not contain this Main Office item.');
   const key=line.matchId+'|'+stock.id,already=Number(invoice.commissaryMatched?.[stock.id]||0),claimed=matches.get(key)?.qty||0,total=Number(item.restockQty??item.baseQtyToAdd);
   if(!Number.isFinite(total)||total<=0||!Number.isFinite(already)||already<0||already+claimed>total+1e-6)throw Error('The estimated restock matching balance needs review.');
   matchedQty=Math.min(line.qty,Math.max(0,total-already-claimed));if(matchedQty<=0)throw Error('This estimated restock quantity was already matched. Select the correct receipt reference.');
   matches.set(key,{invoiceId:line.matchId,inventoryId:stock.id,qty:claimed+matchedQty,previous:already});
  }
  const delta=line.qty-matchedQty,old=effects.get(stock.id);allocations.push({inventoryId:stock.id,matchedQty,delta,purchaseDate:line.purchaseDate});
  if(old){old.delta+=delta;old.matchedQty+=matchedQty;old.receivedQty+=line.qty;old.after=old.before+old.delta;}
  else effects.set(stock.id,{id:stock.id,branch:stock.branch,name:stock.name,unit:stock.uom||stock.baseUom||'units',before,delta,matchedQty,receivedQty:line.qty,after:before+delta});
 }
 for(const [index,line]of lines.entries()){if(allocations[index].delta<=0||line.separatePurchase)continue;const pending=restocks.some(r=>r.dispatchAutoRestock&&r.items?.some(item=>item.id===line.inventoryId&&Number(item.restockQty??item.baseQtyToAdd)>Number(r.commissaryMatched?.[line.inventoryId]||0)+(matches.get(r.id+'|'+line.inventoryId)?.qty||0)+1e-6));if(pending)throw Error('This item has unmatched HQ estimated receipts. Match those recorded quantities, or explicitly select a separate new purchase.');}
 return {effects:[...effects.values()],matches:[...matches.values()],allocations};
}
