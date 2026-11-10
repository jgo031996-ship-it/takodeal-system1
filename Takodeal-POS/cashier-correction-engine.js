import {createSaleEngine} from './pos-safety.js';
// Only the correction lane uses this captured identity/database. Ordinary sales
// keep their original engine and outbox. Legacy receipt metadata is not proof
// of the SDK writer's identity; the private broker still verifies the full ACK.
export function createCorrectionSaleEngine(baseApi,connection){
 const {api,user,uid}=connection||{},auth=api?.auth,db=api?.db;
 const current=()=>{if(!auth?.app||db?.app!==auth.app||auth.currentUser!==user||!uid||user?.uid!==uid)throw Error('The original receipt correction account changed. Keep its exact saved checkout and reconnect that account; no other writer will be used.');};
 current();
 const guarded=(value,target,args)=>{current();const result=value.apply(target,args);if(result&&typeof result.then==='function')return result.then(row=>{current();return row;});current();return result;};
 return createSaleEngine({...baseApi,db,
  getDocsFromServer:async query=>{current();const result=await baseApi.getDocsFromServer(query);current();return result;},
  runTransaction:async(database,work)=>{current();if(database!==db)throw Error('The correction database changed. Keep its original receipt reference.');const result=await baseApi.runTransaction(db,async transaction=>{current();const tx=new Proxy(transaction,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?(...args)=>guarded(value,target,args):value;}});const value=await work(tx);current();return value;});current();return result;}
 });
}
