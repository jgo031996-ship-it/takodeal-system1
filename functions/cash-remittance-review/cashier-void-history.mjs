import {voidRevision,voidMillis,voidHold,voidFail,voidUnitIdentity} from './cashier-void-model.mjs';
// No PITR/configuration changes. Only exact retained commit-time reads within
// the database's ordinary one-hour window; never round to a minute or a nearby
// version. The response readTime AND inventory writeTime must prove the point.
export function createCashierVoidHistoricalReader(db,{now=Date.now}={}){
 return async({sourceTime,branch,movements})=>{
  const at=voidMillis(sourceTime),age=now()-at;
  if(!Number.isFinite(at)||age<0||!Array.isArray(movements)||movements.length>150)voidHold('The original stock-unit history reference is invalid. Ask the Owner to review it.');
  if(age>3600000)voidFail(409,'unit-history-unavailable','This older receipt has no retained original stock-unit proof. Ask the Owner to review a documented stock reversal.');
  if(!movements.length)return [];
  try{return await db.runTransaction(async tx=>{
   const snapshots=await tx.getAll(...movements.map(row=>db.doc('inventory/'+row.inventoryId)));
   return snapshots.map((snapshot,index)=>{const movement=movements[index],row=snapshot.exists?snapshot.data():null;
    if(!row)voidFail(409,'unit-history-unavailable','The original inventory version is unavailable. Ask the Owner to review a documented stock reversal.');
    if(row.branch!==branch||row.name!==movement.ingredientName||voidRevision(snapshot.readTime)!==voidRevision(sourceTime)||voidRevision(snapshot.updateTime)!==voidRevision(sourceTime))voidHold('The retained inventory version cannot prove this receipt’s original units. Ask the Owner to review the stock reversal.');
    return {id:movement.inventoryId,unitSnapshot:voidUnitIdentity(row),evidence:'retained-commit-time',sourceRevision:voidRevision(sourceTime)};
   });
  },{readOnly:true,readTime:sourceTime});}
  catch(error){if(typeof error?.code==='string'&&error.code.startsWith('cashier-void/'))throw error;if([5,9,11,'not-found','failed-precondition','out-of-range'].includes(error?.code))voidFail(409,'unit-history-unavailable','The original inventory version is unavailable or outside retained history. Ask the Owner to review a documented stock reversal.');throw error;}
 };
}
