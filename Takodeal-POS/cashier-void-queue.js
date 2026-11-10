import {createCorrectionSaleEngine} from './cashier-correction-engine.js';
import {createOutbox,saleIdentity} from './pos-safety.js';
import {voidCanonical} from './cashier-void-model.js';
export const VOID_OUTBOX_DATABASE='takodeal_void_replacement_outbox_v1';

// Old Cashier tabs know only takodeal_sale_outbox_v2. They cannot consume or
// weakly acknowledge this correction-specific lane.
export function createCashierVoidQueue(engine,environment,getService,baseApi){
 const outbox=createOutbox(environment.indexedDB||null,{databaseName:VOID_OUTBOX_DATABASE}),owner=saleIdentity({},environment.crypto);let flight=null;
 const match=(expected,actual)=>{if(!actual?.voidCorrection||voidCanonical(expected)!==voidCanonical(actual))throw Error('The replacement receipt differs from its saved checkout. Keep its recovery reference for the Owner.');};
 return {outbox,list:()=>outbox.list(),
  async enqueue(payload){if(!payload?.voidCorrection)throw Error('Only a confirmed receipt correction can use its replacement queue.');const saved=await outbox.enqueue(payload);match(payload,saved);const rows=await outbox.list(),row=rows.find(row=>row.saleId===payload.saleId);if(!row)throw Error('The local replacement receipt is not confirmed. Check the same correction before taking another payment.');match(payload,row.payload);return saved;},
  sync(){if(flight)return flight;flight=(async()=>{const uploaded=[];if(environment.navigator?.onLine===false)return {changed:false,uploaded};const rows=await outbox.list();for(const row of rows){const payload=await outbox.claim(row.saleId,owner);if(!payload)continue;try{const service=getService();if(!service)throw Error('Receipt correction recovery is still loading. The replacement remains queued.');if(!await service.verifyQueued(payload))await (baseApi?createCorrectionSaleEngine(baseApi,service.saleConnection(payload)):engine).commit(payload);await service.acknowledge(payload);await outbox.acknowledge(payload.saleId);uploaded.push({saleId:payload.saleId,branch:payload.branch,auditDeferred:payload.auditDeferred===true});}catch(error){await outbox.noteError(payload.saleId,owner,error).catch(()=>{});console.warn('Replacement receipt remains safely queued:',error);}finally{await outbox.release(payload.saleId,owner);}}return {changed:rows.length>0,uploaded};})().finally(()=>{flight=null;});return flight;}
 };
}
