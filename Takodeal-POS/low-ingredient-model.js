// Read-only alerts use posted movement identities and saved base-unit balances.
const text=value=>typeof value==='string'?value.trim():'';
const numeric=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const id=value=>/^[-\w]{1,180}$/.test(value||'')?value:null;
const saleDocumentId=value=>typeof value==='string'&&value.length>0&&value.length<=1500&&!/[\/\u0000-\u001f]/.test(value)&&!['.','..'].includes(value);
const unit=value=>text(value).toLowerCase();
export function postedIngredientIds(sale,saleId,branch){
 if(!saleDocumentId(saleId)||!branch||sale?.saleId!==saleId||sale?.branch!==branch||sale.saleVersion!==2||sale.statsApplied!==true||sale.inventoryState!=='applied'||sale.status!==undefined&&!['Paid','Completed'].includes(sale.status))return [];
 if(!Array.isArray(sale.inventoryMovements)||sale.inventoryMovements.length>200)return [];
 const found=new Map();
 for(const row of sale.inventoryMovements){if(!id(row?.inventoryId)||!text(row.ingredientName)||numeric(row.quantity)===null||numeric(row.quantity)<=0)return [];const previous=found.get(row.inventoryId);if(previous&&previous.name!==row.ingredientName)return [];found.set(row.inventoryId,{id:row.inventoryId,name:row.ingredientName});}
 return [...found.values()];
}
export function lowIngredientPosition(item,{id:inventoryId,branch,name}={}){
 const base=text(item?.baseUom)||text(item?.uom),stock=numeric(item?.currentStock),values=['lowStockAlert','reorderLevel'].filter(key=>item?.[key]!=null&&String(item[key]).trim()!=='').map(key=>numeric(item[key]));
 const unknown=reason=>({id:inventoryId,name,branch,status:'unknown',reason});
 if(!id(inventoryId)||item?.branch!==branch||item?.name!==name)return unknown('Ingredient identity changed');
 if(!base||base.length>64||item.baseUom&&item.uom&&unit(item.baseUom)!==unit(item.uom))return unknown('Saved base units need HQ review');
 if(stock===null||!values.length||values.some(value=>value===null||value<0)||values.some(value=>value!==values[0]))return unknown('Saved balance or low-stock alert needs HQ review');
 const threshold=values[0],status=stock<=threshold?'low':'sufficient';
 return {id:inventoryId,name,branch,stock,threshold,baseUom:base,status,fingerprint:JSON.stringify([inventoryId,branch,name,stock,threshold,base])};
}
export function createLowIngredientReader(api){
 const current=()=>api.assertStockAuditCurrent?.(),confirmed=snapshot=>snapshot?.metadata?.fromCache===false&&snapshot.metadata.hasPendingWrites===false;
 return {async read({saleId,branch,assertCurrent=()=>{}}){
  const guard=()=>{current();assertCurrent();};guard();
  if(!saleDocumentId(saleId)||!text(branch))throw Error('The saved sale identity is unavailable.');
  const snapshot=await api.getDocFromServer(api.doc(api.db,'transactions',saleId));guard();
  if(!snapshot.exists()||!confirmed(snapshot))throw Error('The posted sale could not be confirmed.');
  const identities=postedIngredientIds(snapshot.data(),saleId,branch),rows=[];
  // Limit simultaneous reads while retaining the exact posted200-item bound.
  for(let at=0;at<identities.length;at+=8){const batch=identities.slice(at,at+8),snapshots=await Promise.all(batch.map(item=>api.getDocFromServer(api.doc(api.db,'inventory',item.id))));guard();
   for(let index=0;index<batch.length;index++){const item=batch[index],row=snapshots[index];if(!row.exists()||!confirmed(row))throw Error('Current ingredient balances could not be confirmed.');rows.push(lowIngredientPosition(row.data(),{...item,branch}));}
  }
  return rows;
 }};
}
