import {historyMillis,historyNumber,safeHistoryProof} from './inventory-history-model.js';
const text=value=>typeof value==='string'?value.trim():'';
export const isWasteReport=row=>text(typeof row==='string'?row:row?.type).toLowerCase()==='waste report';
export const wasteUnitKey=value=>({grams:'gram',g:'gram',pieces:'piece',pcs:'piece',pc:'piece',units:'unit',shots:'shot',milliliters:'ml',milliliter:'ml'}[text(value).toLowerCase()]||text(value).toLowerCase());
export function wasteReportLines(row){
 if(!isWasteReport(row)||!Array.isArray(row.items)||!row.items.length||row.items.length>150)throw Error('This waste report needs its original item details reviewed.');
 return row.items.map(item=>{const quantity=historyNumber(item.qty),id=text(item.id),name=text(item.name),unit=text(item.uom||item.baseUom),reason=text(item.reason);
  if(!id||id.includes('/')||!name||!unit||quantity===null||quantity<=0||quantity>Number.MAX_SAFE_INTEGER||!reason)throw Error('A reported waste item has missing or invalid stock details. No stock was changed.');
  return {id,name,quantity,unit,reason,proof:safeHistoryProof(item.photoUrl),rawQty:historyNumber(item.rawQty),displayUnit:text(item.displayUom)};
 });
}
export function normalizeWasteReport(row){
 const items=(Array.isArray(row.items)?row.items:[]).filter(item=>item&&typeof item==='object').map(item=>({name:text(item.name)||'Item not recorded',quantity:historyNumber(item.qty),unit:text(item.uom||item.baseUom)||'Unit not recorded',reason:text(item.reason),proof:safeHistoryProof(item.photoUrl),rawQty:historyNumber(item.rawQty),displayUnit:text(item.displayUom)}));
 const status=text(row.status)||'Status not recorded',requestedValue=historyNumber(row.totalValueLost),timestamp=row.timestamp??row.createdAt??row.date;
 return {id:row.id,key:'staff_requests/'+row.id,source:'staff_requests',branch:text(row.branch)||null,timestamp,time:historyMillis(timestamp),actor:text(row.staffName)||'Staff not recorded',reason:text(row.managerReply)||items.map(item=>item.reason).filter(Boolean).join(' · '),proof:'',raw:row,name:items.map(item=>item.name).join(', ')||'Waste report · items need review',type:'Waste report · '+status,status,items,quantity:null,unit:'',recordedValue:null,estimatedValue:null,requestedValue:requestedValue!==null&&requestedValue>=0?requestedValue:null,excludeFromTotals:true,valueBasis:status==='Pending'?'Pending review · stock has not been deducted':status==='Approved'?'Approved report · recorded stock movements are listed separately':'No stock deduction from this decision'};
}
