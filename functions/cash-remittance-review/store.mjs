import {FieldPath} from 'firebase-admin/firestore';
const permittedWrite=path=>/^(cash_remittance_quotes|cash_remittance_operations|cash_remittance_attempts|cash_drawer_reviews)\/[A-Za-z0-9_-]{1,180}$/.test(path)||/^(remittances|expenses|shifts|cash_accounts|account_logs)\/[A-Za-z0-9_-]{1,180}$/.test(path);
const permittedRead=path=>/^(cashiers|pos_bindings|pos_devices|cash_remittance_quotes|cash_remittance_operations|cash_drawer_reviews|remittances|expenses|shifts|cash_accounts|account_logs|cash_remittance_attempts)\/[A-Za-z0-9_-]{1,180}$/.test(path);
const permittedQuery=new Set(['shifts','transactions','expenses','remittances','cash_accounts','cashier_presence']);

// Shared by the production wrapper and the real Admin SDK emulator flow.
export function createCashRemittanceStore(db){
 if(!db||typeof db.runTransaction!=='function'||typeof db.doc!=='function'||typeof db.collection!=='function')throw Error('A trusted Firestore database is required.');
 return {transaction:callback=>db.runTransaction(async tx=>{
  let wrote=false,reads=0;const cache=new Map();
  return callback({get(path){if(wrote||!permittedRead(path))throw Error('Read only the allowed cash sources before writing.');if(!cache.has(path)){if(++reads>5000)throw Error('Cash review needs a smaller verified scope.');cache.set(path,tx.get(db.doc(path)).then(row=>row.exists?row.data():null));}return cache.get(path);},async query(spec){
   if(wrote||!permittedQuery.has(spec.collection)||!Array.isArray(spec.filters)||!Number.isSafeInteger(spec.limit)||spec.limit<1||spec.limit>1501)throw Error('Use a bounded cash source query before writing.');
   let q=db.collection(spec.collection);for(const f of spec.filters){if(!['==','>=','<='].includes(f.op)||typeof f.field!=='string')throw Error('Invalid cash query.');q=q.where(f.field,f.op,f.value);}
   for(const o of spec.orderBy||[])q=q.orderBy(o.field==='__name__'?FieldPath.documentId():o.field,o.direction);
   if(spec.startAfter)q=q.startAfter(spec.startAfter.timestamp,db.doc(spec.collection+'/'+spec.startAfter.id));q=q.limit(spec.limit);
   const snap=await tx.get(q);reads+=snap.size;if(reads>5000)throw Error('Cash review needs a smaller verified scope.');return snap.docs.map(row=>({...row.data(),id:row.id}));
  },set(path,data){if(!permittedWrite(path))throw Error('This service may write cash reconciliation paths only.');wrote=true;tx.set(db.doc(path),data);}});
 })};
}
