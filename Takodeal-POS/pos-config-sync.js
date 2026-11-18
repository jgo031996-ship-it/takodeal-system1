// The same saved configuration drives cached boot, live checkout and split choices.
export const posList=(values,fallback=[])=>{
 if(!Array.isArray(values)||!values.length||values.length>100)return [...fallback];
 const list=values.map(value=>typeof value==='string'?value.trim():'');
 return list.some(value=>!value||value.length>100)||new Set(list.map(value=>value.toLowerCase())).size!==list.length?[...fallback]:list;
};
export function posSettings(config={},previous={}){
 return {...previous,...config,orderTypes:posList(config.orderTypes,previous.orderTypes||['Dine-In','Take-Out','Delivery','Grab']),payMethods:posList(config.paymentMethods,previous.payMethods||['Cash','GCash'])};
}
export function startPosConfigSync(w,{db=w.db,assertCurrent=()=>{},cache=true}={}){
 w.posConfigFeed?.stop?.();let stopped=false,timer,pending,unsubscribe;
 const apply=()=>{
  if(stopped||!pending)return;
  try{assertCurrent();if(w.isSubmittingOrder||w.isProcessingOrder){timer=setTimeout(apply,250);return;}
   w.masterPOSData ||= {};w.masterPOSData.settings=posSettings(pending,w.masterPOSData.settings);pending=null;
   if(cache)try{(w.localStorage||globalThis.localStorage)?.setItem('takodeal_cached_settings',JSON.stringify(w.masterPOSData.settings));}catch{}
   w.renderOrderAndPaymentUI?.();
  }catch{stop();}
 };
 function stop(){if(stopped)return;stopped=true;pending=null;clearTimeout(timer);unsubscribe?.();}
 const feed={stop};w.posConfigFeed=feed;
 if(typeof w.onSnapshot!=='function')return feed;
 unsubscribe=w.onSnapshot(w.doc(db,'settings','global_pos_config'),{includeMetadataChanges:true},snapshot=>{
  if(stopped||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||!snapshot.exists())return;
  pending=snapshot.data();clearTimeout(timer);apply();
 },()=>{ /* Keep the last confirmed choices while offline. */ });
 return feed;
}
