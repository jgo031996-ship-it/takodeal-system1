import {normalizeStockAuditReport,stockAuditWasteEvidence,stockAuditMillis} from './stock-audit-model.js';
const safeId=id=>{if(!/^[-\w]{1,180}$/.test(id||''))throw Error('The saved count reference is invalid.');return id;};
// Read only after a successful count commit. Any failure means unknown evidence,
// never a failed count save and never proof that staff did not record waste.
export function createStockCountEvidenceReader(api,{timeoutMs=6000,cap=300}={}){
 const current=()=>api.assertStockAuditCurrent?.();
 async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Waste history is still loading.')),timeoutMs);})]);}finally{clearTimeout(timer);}}
 function server(snapshot){if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Only confirmed server history can explain this count.');return snapshot;}
 return{
  async report({id,branch,staffId,cashier,actorUid}){
   safeId(id);current();const snap=server(await bounded(api.getDocFromServer(api.doc(api.db,'inventory_audit_reports',id))));current();
   if(!snap.exists())throw Error('The saved count report is unavailable.');const report={...snap.data(),id:snap.id};
   if(report.version!==3||report.branch!==branch||report.staffId!==staffId||report.cashier!==cashier||report.actorUid!==actorUid||normalizeStockAuditReport(report).issues.length)throw Error('The saved count does not match the submitting staff and tablet.');return report;
  },
  async waste(report){
   current();const period=stockAuditWasteEvidence(report).period;if(!period)return stockAuditWasteEvidence(report);
   const tables=['stock_logs','inventory_logs','staff_requests'];
   const results=await Promise.allSettled(tables.map(async table=>{
    current();const snapshot=server(await bounded(api.getDocsFromServer(api.query(api.collection(api.db,table),api.where('branch','==',report.branch),...(table==='staff_requests'?[api.where('type','==','Waste Report')]:[]),api.where('timestamp','>=',new Date(period.start)),api.where('timestamp','<',new Date(period.end)),api.limit(cap+1)))));current();
    if(!Array.isArray(snapshot.docs)||snapshot.docs.length>cap)throw Error('The bounded waste history is incomplete.');
    const seen=new Set();return snapshot.docs.map(doc=>{server(doc);if(!doc.id||seen.has(doc.id))throw Error('Waste history has duplicate or missing references.');seen.add(doc.id);const row={...doc.data(),id:doc.id},time=stockAuditMillis(row.timestamp);if(row.branch!==report.branch||time===null||time<period.start||time>=period.end)throw Error('Waste history returned an invalid branch or period.');return row;});
   }));current();
   return stockAuditWasteEvidence(report,{stockLogs:results[0].status==='fulfilled'?results[0].value:[],inventoryLogs:results[1].status==='fulfilled'?results[1].value:[],wasteRequests:results[2].status==='fulfilled'?results[2].value:[],complete:results.every(result=>result.status==='fulfilled')});
  }
 };
}
