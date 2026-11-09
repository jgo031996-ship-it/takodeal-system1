import {activeAccessStaff,operationalStaffProfile,accessId} from './access-model.mjs';
const token=value=>value?String(value.seconds??value._seconds)+'|'+String(value.nanoseconds??value._nanoseconds):'';
export function createStaffDirectorySync(db,{serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted staff directory transaction is required.');
 return async staffId=>{
  if(!accessId(staffId))throw Error('The staff directory identity is invalid.');
  return db.runTransaction(async tx=>{
   const source=await tx.get(db.doc('cashiers/'+staffId));
   if(!source.exists){tx.delete(db.doc('staff_directory/'+staffId));return{removed:true};}
   const row=source.data(),active=activeAccessStaff(row);
   let projection;try{projection=operationalStaffProfile(staffId,row,{requireActive:false});}catch{projection={staffId,cashierName:'Account requires HQ review',branch:'',active:false};}
   if(!active)projection.active=false;
   // A trigger always reads the current source inside its transaction. Delayed
   // or repeated events cannot restore an older profile or expose other fields.
   tx.set(db.doc('staff_directory/'+staffId),{...projection,profileRevision:token(source.updateTime),syncedAt:serverTimestamp()});
   return{staffId,active:projection.active!==false&&active};
  });
 };
}
