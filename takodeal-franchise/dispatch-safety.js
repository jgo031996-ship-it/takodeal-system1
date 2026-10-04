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
        const commitRef=reference('settings','dispatch_commit_'+id);
        const commit=await tx.get(commitRef);
        const marker=await tx.get(reference('dispatch_logs',id+'-0'));
        if (commit.exists() || marker.exists()) return 'already-dispatched';
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
        tx.set(commitRef,{id,source,destination,committedAt:api.serverTimestamp()});
        resolved.forEach((item,index)=> {
            const stock=stocks.get(item.reference.id), key=id+'-'+index;
            tx.set(reference('dispatch_logs',key),{batchId:id,sourceBranch:source,fromBranch:source,sourceId:item.reference.id,toBranch:destination,unitCost:Number(item.cost ?? item.baseCost ?? stock.data.baseCost ?? 0),franchiseCharged:branchPolicy.data().isFranchise === true,details:`${source} ➡️ ${destination}`,item:item.name,qty:item.quantity,uom:item.baseUom || item.uom || stock.data.uom || 'units',displayQty:Number(item.rawQty || item.quantity),displayUom:item.friendlyUom || item.uom || stock.data.uom || 'units',convRate:Number(item.convRate || 1),category:item.category || stock.data.category || 'Uncategorized',driver,status:'In Transit',date:now.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),timestamp:now});
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

// Keep the delivery record as the return marker. Retries never refund it twice.
export async function transitionDispatch(api, {ids, mode, actor}) {
    const unique=[...new Set(ids.filter(Boolean))];
    if (!unique.length || unique.length>80 || !['arrive','return'].includes(mode)) throw new Error('Select up to 80 delivery items.');
    const ref=(table,id)=>api.doc(api.db,table,id), resolved=[];
    for (const id of unique) {
        const snapshot=await api.getDocFromServer(ref('dispatch_logs',id));
        if (!snapshot.exists()) throw new Error('This delivery record is missing. Reload the feed.');
        const data=snapshot.data(), source=data.sourceBranch || data.fromBranch || 'Main Office';
        let stockRef=null;
        if (mode==='return' && data.status!=='Backloaded') {
            const stocks=await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',source),api.where('name','==',data.item)));
            if (stocks.docs.length!==1) throw new Error('Missing or duplicate source stock: '+data.item+' ('+source+').');
            stockRef=stocks.docs[0].ref;
        }
        resolved.push({id,source,stockRef});
    }
    return api.runTransaction(api.db,async tx=>{
        const deliveries=[], stocks=new Map();
        for (const entry of resolved) {
            const reference=ref('dispatch_logs',entry.id), snapshot=await tx.get(reference);
            if (!snapshot.exists()) throw new Error('Delivery changed. Reload the feed.');
            const data=snapshot.data();
            if (mode==='return' && data.status==='Backloaded') continue;
            if (mode==='arrive' && data.status!=='In Transit') continue;
            if (!['In Transit','Arrived'].includes(data.status) || Number(data.receivedQty || 0)>0) throw new Error('The cashier has already processed this delivery. Use discrepancy review instead.');
            if ((data.sourceBranch || data.fromBranch || 'Main Office')!==entry.source) throw new Error('Delivery source changed. Reload the feed.');
            const quantity=Number(data.qty);
            if (!Number.isFinite(quantity) || quantity<=0) throw new Error('Invalid saved delivery quantity.');
            if (mode==='return') {
                if (!entry.stockRef) throw new Error('Source stock changed. Reload the feed.');
                if (!stocks.has(entry.stockRef.id)) {
                    const stock=await tx.get(entry.stockRef);
                    if (!stock.exists() || stock.data().branch!==entry.source || stock.data().name!==data.item || !Number.isFinite(Number(stock.data().currentStock))) throw new Error('Source stock changed. Reload the feed.');
                    stocks.set(entry.stockRef.id,{reference:entry.stockRef,data:stock.data(),quantity:0});
                }
                stocks.get(entry.stockRef.id).quantity+=quantity;
                if (data.franchiseCharged && (!Number.isFinite(data.unitCost) || data.unitCost<0)) throw new Error('Invalid saved supply charge.');
            }
            deliveries.push({reference,data,quantity,entry});
        }
        for (const stock of stocks.values()) tx.update(stock.reference,{currentStock:Number(stock.data.currentStock)+stock.quantity});
        for (const {reference,data,quantity,entry} of deliveries) {
            if (mode==='arrive') tx.update(reference,{status:'Arrived',arrivedAt:api.serverTimestamp()});
            else {
                const stock=stocks.get(entry.stockRef.id);
                tx.update(reference,{status:'Backloaded',receivedQty:0,receivedDisplayQty:0,returnedAt:api.serverTimestamp(),returnedBy:actor});
                tx.set(ref('stock_logs','return-'+entry.id),{branch:entry.source,item:data.item,uom:stock.data.uom || 'units',oldQty:Number(stock.data.currentStock),newQty:Number(stock.data.currentStock)+stock.quantity,variance:quantity,type:'Delivery Backload',note:'Delivery returned from '+data.toBranch,user:actor,timestamp:api.serverTimestamp()});
                if (data.franchiseCharged && data.unitCost*quantity>0) tx.set(ref('franchise_ledger','supply-return-'+entry.id),{branch:data.toBranch,type:'Credit',category:'B2B Supply Return',amount:data.unitCost*quantity,description:'Credit for returned delivery '+entry.id,loggedBy:actor,timestamp:api.serverTimestamp()});
            }
        }
        return deliveries.map(({data,entry})=>({...data,id:entry.id}));
    });
}

export async function receiveDispatch(api,{branch,actor,items}) {
    if (!branch || !items.length || items.length>80 || new Set(items.map(row=>row.id)).size!==items.length) throw new Error('Select up to 80 unique delivery items.');
    const ref=(table,id)=>api.doc(api.db,table,id), resolved=[];
    for (const input of items) {
        if (!Number.isFinite(input.actualDisplayQty) || input.actualDisplayQty<0) throw new Error('Enter a valid received quantity.');
        const snapshot=await api.getDocFromServer(ref('dispatch_logs',input.id));
        if (!snapshot.exists() || snapshot.data().toBranch!==branch) throw new Error('Delivery branch changed. Reload the shipment.');
        const data=snapshot.data();
        let stockRef=null, master={};
        if (data.status==='Arrived') {
            const stock=await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',branch),api.where('name','==',data.item)));
            if (stock.docs.length>1) throw new Error('Duplicate branch stock: '+data.item);
            stockRef=stock.docs[0]?.ref || ref('inventory','receive-'+encodeURIComponent(branch)+'--'+encodeURIComponent(data.item));
            if (!stock.docs.length) {
                const source=data.sourceBranch || data.fromBranch || 'Main Office';
                const original=await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',source),api.where('name','==',data.item)));
                if (original.docs.length!==1) throw new Error('Missing or duplicate source stock: '+data.item);
                master=original.docs[0].data();
            }
        }
        resolved.push({input,stockRef,master});
    }
    return api.runTransaction(api.db,async tx=>{
        const rows=[],stocks=new Map();
        for (const {input,stockRef,master} of resolved) {
            const reference=ref('dispatch_logs',input.id), snapshot=await tx.get(reference);
            if (!snapshot.exists() || snapshot.data().toBranch!==branch) throw new Error('Delivery changed. Reload the shipment.');
            const data=snapshot.data(), display=input.isMissing?0:input.actualDisplayQty;
            if (['Received','Discrepancy','Lost in Transit'].includes(data.status)) {
                if (Number(data.receivedDisplayQty)!==display) throw new Error('This item was already received with a different quantity.');
                continue;
            }
            if (data.status!=='Arrived' || !stockRef) throw new Error('This delivery is not available for receipt. Reload the shipment.');
            const rate=Number(data.convRate || 1),expected=Number(data.qty),quantity=display*rate;
            if (!Number.isFinite(rate) || rate<=0 || !Number.isFinite(expected) || expected<=0 || !Number.isFinite(quantity)) throw new Error('Invalid saved delivery units.');
            if (!stocks.has(stockRef.id)) {
                const stock=await tx.get(stockRef);
                if (stock.exists() && (stock.data().branch!==branch || stock.data().name!==data.item || !Number.isFinite(Number(stock.data().currentStock)))) throw new Error('Branch stock changed. Reload the shipment.');
                stocks.set(stockRef.id,{reference:stockRef,data:stock.exists()?stock.data():{...master,branch,name:data.item,currentStock:0,uom:master.uom || data.uom || 'units'},exists:stock.exists(),quantity:0});
            }
            stocks.get(stockRef.id).quantity+=quantity;
            rows.push({reference,input,data,quantity,expected,display,stockRef});
        }
        for (const stock of stocks.values()) if (stock.quantity>0) {
            const currentStock=Number(stock.data.currentStock)+stock.quantity;
            if (stock.exists) tx.update(stock.reference,{currentStock});
            else tx.set(stock.reference,{...stock.data,currentStock});
        }
        for (const {reference,input,data,quantity,expected,display,stockRef} of rows) {
            const variance=quantity-expected,status=input.isMissing?'Lost in Transit':variance!==0?'Discrepancy':'Received';
            tx.update(reference,{status,receivedQty:quantity,variance,receivedDisplayQty:display,receivedAt:api.serverTimestamp(),receivedBy:actor,receivingRemarks:input.remarks || ''});
            if (quantity>0) {
                const stock=stocks.get(stockRef.id);
                tx.set(ref('stock_logs','received-'+input.id),{branch,item:data.item,uom:data.uom || 'units',oldQty:Number(stock.data.currentStock),newQty:Number(stock.data.currentStock)+stock.quantity,variance:quantity,type:'Delivery Received',note:'Shipment confirmed; previous stock balance retained.',user:actor,timestamp:api.serverTimestamp()});
            }
            if (variance!==0) tx.set(ref('manager_alerts','delivery-'+input.id),{type:'DELIVERY_DISCREPANCY',branch,cashier:actor,message:`${data.item}: ${status}. Expected ${expected} base units, received ${quantity}. ${input.remarks || ''}`,timestamp:api.serverTimestamp()});
        }
        return rows.length;
    });
}
