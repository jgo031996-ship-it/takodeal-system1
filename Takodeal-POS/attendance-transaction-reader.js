// Reuse only document reads inside this one SDK transaction attempt. A retry
// gets a new map, so cached data can never authorize a later decision.
export function memoizedAttendanceTransaction(transaction){
 const scopes=new Map();let writing=false;
 const read=reference=>{if(writing)return Promise.reject(Error('Attendance transaction reads must finish before writes.'));const scope=reference?.firestore||null;let reads=scopes.get(scope);if(!reads){reads=new Map();scopes.set(scope,reads);}const key=reference?.path||reference;if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>transaction.get(reference)));return reads.get(key);};
 return new Proxy(transaction,{get(target,key){if(key==='get')return read;const value=Reflect.get(target,key,target);if(['set','update','delete'].includes(key)&&typeof value==='function')return(...args)=>{writing=true;return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});
}
