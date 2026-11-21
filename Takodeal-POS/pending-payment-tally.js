// The query tracks pending payments across shifts. Keep per-shift counts as individual receipts change.
export function createPendingPaymentTally(){
    const byReceipt=new Map(),byShift=new Map();
    function remove(id){
        if(!byReceipt.has(id))return;
        const shift=byReceipt.get(id),count=byShift.get(shift)-1;
        byReceipt.delete(id);if(count)byShift.set(shift,count);else byShift.delete(shift);
    }
    return (snapshot,shiftId)=>{
        for(const change of snapshot.docChanges()){
            const {id}=change.doc;remove(id);
            if(change.type==='removed')continue;
            const row=change.doc.data(),method=String(row.paymentMethod||'').toLowerCase();
            if(row.status==='Voided'||row.paymentVerified===true||!method||method==='cash')continue;
            byReceipt.set(id,row.shiftId);byShift.set(row.shiftId,(byShift.get(row.shiftId)||0)+1);
        }
        return {total:byReceipt.size,shift:byShift.get(shiftId)||0};
    };
}
