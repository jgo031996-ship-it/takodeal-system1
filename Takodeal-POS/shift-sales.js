// Financial upload is required for close; unresolved stock links are retained
// on uploaded receipts and reviewed separately in HQ.
export async function ensureShiftSalesUploaded(w, { branch, shiftId, startTime }) {
    if (!w.getPendingSales || !w.syncOfflineQueue) throw new Error('Sale upload is not ready. Reopen the app and retry.');
    const start = +(startTime?.toDate?.() || new Date(startTime));
    const forShift = row => {
        if (row.branch && row.branch !== branch) return false;
        if (row.shiftId && row.shiftId !== 'UNKNOWN') return row.shiftId === shiftId;
        const time = +new Date(row.localTimestamp);
        // Unknown legacy records cannot be silently excluded from this drawer.
        return !Number.isFinite(time) || !Number.isFinite(start) || time >= start;
    };
    let pending = (await w.getPendingSales()).filter(forShift);
    for (let attempt = 0; attempt < 2 && (pending.length || w.isSyncing); attempt++) {
        await w.syncOfflineQueue();
        pending = (await w.getPendingSales()).filter(forShift);
    }
    if (pending.length) {
        const details = pending.slice(0, 3).map(row => `${row.receiptId || row.saleId || 'Saved sale'}: ` +
            (row.needsReconciliation ? 'older sale requires Manager review' : row.syncError?.message || 'waiting for connection')).join('\n');
        const error = new Error(`${pending.length} sale(s) still awaiting upload.\n${details}\nKeep the app connected, then retry. View them in Shift Sales or Settings → Sales awaiting upload.`);
        error.code = 'sales-pending';
        throw error;
    }
}

export function createShiftSalesFeed(api, onChange, onError = console.warn) {
    let scope, unsubscribe, generation = 0, currentRows=null;
    const scopeKey=(branch,startTime,shiftId)=>JSON.stringify([branch, +(startTime?.toDate?.() || new Date(startTime)), shiftId]);
    return {
        start(branch, startTime, shiftId) {
            const start = startTime?.toDate?.() || new Date(startTime);
            if (!branch || !shiftId || !Number.isFinite(+start)) { this.stop(); return; }
            const key = JSON.stringify([branch, +start, shiftId]);
            if (scope === key) return;
            this.stop(); scope = key;
            const current = generation;
            const q = api.query(api.collection(api.db, 'transactions'), api.where('branch', '==', branch), api.where('timestamp', '>=', start));
            unsubscribe = api.onSnapshot(q, snapshot => {
                if (current !== generation || scope !== key) return;
                const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row =>
                    row.branch === branch && (!row.shiftId || row.shiftId === 'UNKNOWN' || row.shiftId === shiftId));
                currentRows=rows;
                Promise.resolve(onChange(rows)).catch(onError);
            }, error => {
                if (current !== generation) return;
                // Let Refresh retry a failed listener for the same shift.
                scope = null;
                onError(error);
            });
        },
        rows(branch,startTime,shiftId) {return scope===scopeKey(branch,startTime,shiftId)&&currentRows!==null?currentRows.map(row=>({...row})):null;},
        stop() { generation++; unsubscribe?.(); unsubscribe = null; scope = null; currentRows=null; }
    };
}

// Parked orders change independently of paid sales. One live branch query
// supplies every Sales render, including orders without a legacy timestamp.
export function createParkedOrdersFeed(api,onChange,onError=console.warn) {
    let scope=null,unsubscribe,generation=0,currentRows=null,pending;
    return {
        start(branch) {
            if(!branch){this.stop();return Promise.resolve([]);}
            if(scope===branch)return currentRows!==null?Promise.resolve(currentRows.map(row=>({...row}))):pending.promise;
            this.stop();scope=branch;
            const current=generation;
            let resolve,reject;
            const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
            // A rejected listener may happen after its first render was done.
            promise.catch(()=>{});pending={promise,resolve,reject};
            const q=api.query(api.collection(api.db,'parked_orders'),api.where('branch','==',branch));
            try{unsubscribe=api.onSnapshot(q,snapshot=>{
                if(current!==generation||scope!==branch)return;
                currentRows=snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(row=>row.branch===branch);
                pending.resolve(currentRows.map(row=>({...row})));
                Promise.resolve(onChange(currentRows.map(row=>({...row})))).catch(onError);
            },error=>{
                if(current!==generation||scope!==branch)return;
                pending.reject(error);scope=null;onError(error);
            });}catch(error){pending.reject(error);scope=null;onError(error);}
            return promise;
        },
        rows(branch) {return scope===branch&&currentRows!==null?currentRows.map(row=>({...row})):null;},
        stop() {generation++;unsubscribe?.();unsubscribe=null;pending?.resolve([]);pending=null;scope=null;currentRows=null;}
    };
}

export function mergeParkedOrders(transactions,orders,branch,startTime) {
    const start=+(startTime?.toDate?.() || new Date(startTime)),result=[...transactions];
    const existing=new Set(transactions.map(row=>row.id).filter(Boolean));
    for(const order of orders){
        if(order.branch!==branch||existing.has(order.id))continue;
        const timestamp=order.timestamp?.toDate?.() || (Number.isFinite(order.timestamp?.seconds)?new Date(order.timestamp.seconds*1000):order.timestamp?new Date(order.timestamp):null);
        // Keep undated legacy orders visible; only a known older date excludes one.
        if(timestamp&&Number.isFinite(+timestamp)&&Number.isFinite(start)&&+timestamp<start)continue;
        result.push({id:order.id,receiptId:'PARKED-'+order.id.substring(0,4).toUpperCase(),customerName:order.name||order.customerName||'Guest',
            netTotal:order.total||order.netTotal||0,status:'Parked',paymentMethod:'Unpaid',cart:order.items||order.cart||[],
            timestamp:timestamp&&Number.isFinite(+timestamp)?timestamp:null,cashier:order.cashier||'Unknown',orderType:order.orderType||'Dine-In',branch:order.branch});
        existing.add(order.id);
    }
    return result;
}
