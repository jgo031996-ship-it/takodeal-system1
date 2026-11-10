// Confirmed broker saves refresh from the server. Ordinary Sales reads retain
// their existing online/offline behavior; failures never invent a voided row.
export async function refreshSavedVoidSales(w,d,api,view){
 if(view?.state!=='saved')throw Error('A saved receipt result is required.');
 const person=w.sessionUser,user=api.auth.currentUser,shift=w.currentShift;
 const branch=person?.branch,shiftId=shift?.shiftId,active=shift?.active,staffId=person?.staffId||person?.id,name=person?.cashierName;
 const guard=()=>{api.assertCurrent?.();if(w.sessionUser!==person||api.auth.currentUser!==user||w.currentShift!==shift||person?.branch!==branch||(person?.staffId||person?.id)!==staffId||person?.cashierName!==name||shift?.shiftId!==shiftId||shift?.active!==active||view.branch!==branch||view.shiftId!==shiftId)throw Error('The sales account or shift changed.');};
 guard();if(!shift?.active||!d.getElementById('view-sales')?.classList.contains('active'))return;
 const start=shift.startTime?.toDate?.()||new Date(shift.startTime);
 if(!Number.isFinite(+start))throw Error('The saved shift start is unavailable.');
 const query=api.query(api.collection(api.db,'transactions'),api.where('branch','==',branch),api.where('timestamp','>=',start));
 const snapshot=await api.getDocsFromServer(query);guard();
 if(snapshot?.metadata?.fromCache!==false||snapshot.metadata.hasPendingWrites!==false)throw Error('The saved receipt refresh is not yet confirmed.');
 const rows=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(row=>row.branch===branch&&(!row.shiftId||row.shiftId==='UNKNOWN'||row.shiftId===shiftId));
 guard();if(d.getElementById('view-sales')?.classList.contains('active'))await w.loadSalesDashboard(rows);
}
