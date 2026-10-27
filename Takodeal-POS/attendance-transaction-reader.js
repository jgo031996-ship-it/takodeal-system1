// Reuse only document reads inside this one SDK transaction attempt. A retry
// gets a new map, so cached data can never authorize a later decision.
export function memoizedAttendanceTransaction(transaction){
 const scopes=new Map();let writing=false;
 const read=reference=>{if(writing)return Promise.reject(Error('Attendance transaction reads must finish before writes.'));const scope=reference?.firestore||null;let reads=scopes.get(scope);if(!reads){reads=new Map();scopes.set(scope,reads);}const key=reference?.path||reference;if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>transaction.get(reference)));return reads.get(key);};
 // Health guards expose a frozen transaction facade. Proxying that object and
 // replacing its non-writable own methods violates JavaScript's Proxy rules.
 // An empty facade has no own methods to contradict; every SDK call still uses
 // the original guarded transaction and its receiver.
 const facade=new Proxy(Object.freeze({}),{get(_target,key){if(key==='get')return read;const value=Reflect.get(transaction,key,transaction);if(['set','update','delete'].includes(key)&&typeof value==='function')return(...args)=>{writing=true;const result=value.apply(transaction,args);return result===transaction?facade:result;};return typeof value==='function'?value.bind(transaction):value;}});
 return facade;
}
