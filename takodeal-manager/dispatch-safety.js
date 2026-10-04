export async function commitDispatch(api, { id, source, destination, driver, actor, items, skipped = [], purchaseOrderIds = [], now = new Date() }) {
    if (!id || !source || !destination || source === destination || !driver || !items.length) throw new Error('Choose different source and destination branches, a driver, and items to send.');
    if (items.length * 4 + purchaseOrderIds.length > 430) throw new Error('Split this delivery into smaller batches.');
    const inventory = await api.getDocs(api.query(api.collection(api.db,'inventory'),api.where('branch','==',source)));
    const branchSnap = await api.getDocs(api.query(api.collection(api.db,'branches'),api.where('name','==',destination)));
    if (branchSnap.docs.length !== 1) throw new Error('Destination branch settings are missing or duplicated.');
    const resolved = items.map(item => {
        const name=item.itemName || item.name, quantity=Number(item.qty);
        if (!name || !Number.isFinite(quantity) || quantity<=0) throw new Error('Enter a positive quantity for every dispatched item.');
        const matches=inventory.docs.filter(row=>row.data().name===name);
        if (matches.length!==1) throw new Error(`Missing or duplicate inventory item: ${name} (source: ${source}, matches: ${matches.length})`);
        return {...item,name,quantity,reference:matches[0].ref};
    });
    const reference = (table,key) => api.doc(api.db,table,key);
    return api.runTransaction(api.db, async tx => {
        const marker=await tx.get(reference('dispatch_logs',id+'-0'));
        if (marker.exists()) return 'already-dispatched';
        const branchPolicy=await tx.get(branchSnap.docs[0].ref);
        if (!branchPolicy.exists() || branchPolicy.data().name !== destination) throw new Error("Destination branch changed.");
        const stocks=new Map();
        for (const item of resolved) if (!stocks.has(item.reference.id)) {
            const row=await tx.get(item.reference);
            if (!row.exists() || row.data().branch!==source || row.data().name!==item.name) throw new Error('Source stock changed. Reload the delivery.');
            stocks.set(item.reference.id,{reference:item.reference,data:row.data(),quantity:0});
        }
        const orders=[];
        for (const orderId of new Set(purchaseOrderIds.filter(Boolean))) {
            const orderRef=reference('purchase_orders',orderId), order=await tx.get(orderRef);
            if (!order.exists() || order.data().branch!==destination || !['Pending','Drafting','Delayed'].includes(order.data().status)) throw new Error('This stock request was already processed or changed. Reload the request.');
            orders.push(orderRef);
        }
        for (const item of resolved) stocks.get(item.reference.id).quantity+=item.quantity;
        for (const stock of stocks.values()) {
            const current=Number(stock.data.currentStock ?? 0);
            if (!Number.isFinite(current) || current<stock.quantity) throw new Error(`Not enough ${stock.data.name} at ${source}. Available: ${current}; requested: ${stock.quantity}.`);
            tx.update(stock.reference,{currentStock:current-stock.quantity});
        }
        resolved.forEach((item,index)=> {
            const stock=stocks.get(item.reference.id), key=id+'-'+index;
            tx.set(reference('dispatch_logs',key),{batchId:id,sourceBranch:source,toBranch:destination,details:`${source} ➡️ ${destination}`,item:item.name,qty:item.quantity,uom:item.baseUom || item.uom || stock.data.uom || 'units',displayQty:Number(item.rawQty || item.quantity),displayUom:item.friendlyUom || item.uom || stock.data.uom || 'units',convRate:Number(item.convRate || 1),category:item.category || stock.data.category || 'Uncategorized',driver,status:'In Transit',date:now.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),timestamp:now});
            tx.set(reference('stock_logs','out-'+key),{branch:source,item:item.name,uom:stock.data.uom || 'units',oldQty:stock.data.currentStock,newQty:stock.data.currentStock-stock.quantity,variance:-item.quantity,type:'Stock Dispatch',note:`Sent to ${destination} (Driver: ${driver})`,user:actor,timestamp:api.serverTimestamp()});
            tx.set(reference('stock_logs','in-'+key),{branch:destination,item:item.name,uom:item.baseUom || item.uom || 'units',oldQty:0,newQty:0,variance:0,type:'Incoming Dispatch',note:`From ${source}; awaiting cashier receipt.`,user:actor,timestamp:api.serverTimestamp()});
        });
        if (branchPolicy.data().isFranchise === true) {
            const amount = resolved.reduce((sum,item)=>sum + Number(item.cost ?? item.baseCost ?? stocks.get(item.reference.id).data.baseCost ?? 0)*item.quantity,0);
            if (!Number.isFinite(amount) || amount<0) throw new Error('Invalid franchise supply cost.');
            if (amount>0) tx.set(reference('franchise_ledger','supply-'+id),{branch:destination,type:'Charge',category:'B2B Supply Dispatch',amount,description:'Supplies dispatched '+id,loggedBy:actor,timestamp:api.serverTimestamp()});
        }
        for (const orderRef of orders) tx.update(orderRef,{status:'Completed',dispatchBatchId:id,completedAt:api.serverTimestamp()});
        if (skipped.length) tx.set(reference('purchase_orders','delayed-'+id),{branch:destination,items:skipped,status:'Delayed',type:'Delayed Delivery',requestedBy:actor,sourceRequestIds:purchaseOrderIds,timestamp:api.serverTimestamp()});
        return 'dispatched';
    });
}
