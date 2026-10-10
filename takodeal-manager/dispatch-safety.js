import {planDispatchRestock,assertDispatchRestockCurrent,canonicalDispatchIntent} from './dispatch-restock-model.js';
import {canOpenWorkspacePage} from './workspace-access-model.js';

export function captureDispatchAuthority(api,{source,destination,restock=false}={}) {
    const user=api.auth?.currentUser,session=api.sessionUser,email=String(user?.email||'').trim().toLowerCase();
    if(!user?.uid||!email||user.emailVerified!==true||!session||session.uid!==user.uid||String(session.email||'').toLowerCase()!==email||!canOpenWorkspacePage(session,'dispatch')) throw Error('Unlock Dispatch with your approved Google account before saving.');
    if(typeof api.isBranchAllowed!=='function'||!api.isBranchAllowed(destination)||!api.isBranchAllowed(source)&&!(session.isFranchisee&&source==='Main Office')) throw Error('A selected branch is outside your Dispatch access.');
    if(restock&&(session.isFranchisee||!canOpenWorkspacePage(session,'inventory'))) throw Error('HQ inventory access is required to record an automatic restock. Ask an HQ manager to send this delivery.');
    return {uid:user.uid,email,name:String(session.cashierName||email),session};
}

export async function prepareDispatchRestock(api,{source,destination,items}) {
    const authority=captureDispatchAuthority(api,{source,destination});
    if(source!=='Main Office')return null;
    const result=await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',source)));
    const plan=planDispatchRestock(result.docs.map(row=>({...row.data(),id:row.id})),items,{source});
    const current=captureDispatchAuthority(api,{source,destination,restock:plan.needsRestock});
    if(current.session!==authority.session||current.uid!==authority.uid||current.email!==authority.email)throw Error('Your account changed. Reopen the delivery.');
    return plan;
}

export async function commitDispatch(api, { id, source, destination, driver, actor, items, skipped = [], purchaseOrderIds = [], now = new Date(), autoRestock=null, assertCurrent=()=>{} }) {
    if (!id || !source || !destination || source === destination || !driver || !items.length) throw new Error('Choose different source and destination branches, a driver, and items to send.');
    if (items.length * (autoRestock?7:4) + purchaseOrderIds.length > 430) throw new Error('Split this delivery into smaller batches.');
    const identity=autoRestock?captureDispatchAuthority(api,{source,destination,restock:autoRestock.needsRestock}):null;
    if(autoRestock&&autoRestock.source!==source)throw Error('The restock preview belongs to another source.');
    const guard=()=>{assertCurrent();if(identity){const current=captureDispatchAuthority(api,{source,destination,restock:autoRestock.needsRestock});if(current.session!==identity.session||current.uid!==identity.uid||current.email!==identity.email||current.name!==identity.name)throw Error('Your account changed. Reopen the delivery.');}};
    guard();
    const intent=canonicalDispatchIntent({source,destination,driver,actor,actorUid:identity?.uid,items,skipped,purchaseOrderIds:[...new Set(purchaseOrderIds.filter(Boolean))].sort(),autoRestock});
    const read=autoRestock?api.getDocsFromServer:api.getDocs;
    const inventory = await read(api.query(api.collection(api.db,'inventory'),api.where('branch','==',source)));
    const branchSnap = await read(api.query(api.collection(api.db,'branches'),api.where('name','==',destination)));
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
        guard();
        if (commit.exists() || marker.exists()) {
            if(commit.exists()&&commit.data().intent&&commit.data().intent!==intent)throw Error('This delivery ID belongs to different quantities, prices or branches. Reopen the saved delivery.');
            if(autoRestock&&(!commit.exists()||commit.data().intent!==intent))throw Error('This delivery ID has an older or different saved operation. Review it before resending.');
            return 'already-dispatched';
        }
        const branchPolicy=await tx.get(branchSnap.docs[0].ref);
        if (!branchPolicy.exists() || branchPolicy.data().name !== destination || branchPolicy.data().active===false) throw new Error("Destination branch changed.");
        const stocks=new Map();
        for (const item of resolved) if (!stocks.has(item.reference.id)) {
            const row=await tx.get(item.reference);
            if (!row.exists() || row.data().branch!==source || row.data().name!==item.name) throw new Error('Source stock changed. Reload the delivery.');
            stocks.set(item.reference.id,{reference:item.reference,data:row.data(),quantity:0});
        }
        const orders=[];
        for (const orderId of new Set(purchaseOrderIds.filter(Boolean))) {
            const orderRef=reference('purchase_orders',orderId), order=await tx.get(orderRef);
            if (!order.exists() || order.data().branch!==destination || order.data().sourceBranch&&order.data().sourceBranch!==source || !['Pending','Drafting','Delayed'].includes(order.data().status)) throw new Error('This stock request was already processed or changed. Reload the request.');
            orders.push(orderRef);
        }
        for (const item of resolved) stocks.get(item.reference.id).quantity+=item.quantity;
        const plan=autoRestock?assertDispatchRestockCurrent(autoRestock,[...stocks].map(([id,stock])=>({...stock.data,id})),items):null;
        const planned=new Map((plan?.lines||[]).map(line=>[line.id,line]));
        const invoiceRef=reference('hq_restocks','dispatch-'+id);
        if(plan?.needsRestock&&(await tx.get(invoiceRef)).exists())throw Error('A linked restock already exists without its delivery marker. Ask HQ to review it.');
        guard();
        for (const stock of stocks.values()) {
            const current=Number(stock.data.currentStock ?? 0);
            const line=planned.get(stock.reference.id);
            if (!Number.isFinite(current) || current<stock.quantity&&!line?.restockQty) throw new Error(`Not enough ${stock.data.name} at ${source}. Available: ${current}; requested: ${stock.quantity}.`);
            // Saved purchase/base cost fields are deliberately retained. The new invoice is an estimate.
            tx.update(stock.reference,{currentStock:line?line.afterDispatchQty:current-stock.quantity});
            if(line?.correctionQty>0)tx.set(reference('stock_logs','correction-'+id+'-'+stock.reference.id),{branch:source,item:line.name,uom:line.baseUom,oldQty:current,newQty:0,variance:line.correctionQty,type:'HQ Negative Balance Correction',note:'Old negative balance reset before dispatch; excluded from purchase estimate.',dispatchBatchId:id,user:actor,timestamp:api.serverTimestamp()});
            if(line?.restockQty>0)tx.set(reference('stock_logs','restock-'+id+'-'+stock.reference.id),{branch:source,item:line.name,uom:line.baseUom,oldQty:Math.max(0,current),newQty:Math.max(0,current)+line.restockQty,variance:line.restockQty,type:'HQ Auto Restock (Estimated)',note:'Restock linked to dispatch using the last saved price. No cash payment recorded.',estimatedCost:line.estimatedSubtotal,dispatchBatchId:id,user:actor,timestamp:api.serverTimestamp()});
        }
        if(plan?.needsRestock)tx.set(invoiceRef,{branch:'Main Office',toBranch:destination,sourceBranch:source,dispatchAutoRestock:true,dispatchBatchId:id,costStatus:plan.hasUnknownCost?'Needs price review':'Estimated',estimated:true,totalCost:plan.estimatedTotal,supplier:'Automatic restock for '+destination,user:actor,actorUid:identity.uid,timestamp:api.serverTimestamp(),items:plan.lines.filter(line=>line.restockQty>0).map(line=>({id:line.id,name:line.name,restockQty:line.restockQty,baseQtyToAdd:line.restockQty,qty:line.restockQty,baseUom:line.baseUom,purchaseQty:line.restockQty/line.conversionRate,purchQty:line.restockQty/line.conversionRate,purchaseUom:line.purchaseUom,purchUom:line.purchaseUom,conversionRate:line.conversionRate,estimatedUnitCost:line.estimatedUnitCost,estimatedSubtotal:line.estimatedSubtotal,subtotal:line.estimatedSubtotal,knownCost:line.knownCost,correctionQty:line.correctionQty,oldQty:line.oldQty})),note:'Last saved prices are estimates. Old negative balances are corrected separately. No supplier payment or cash movement is created.'});
        tx.set(commitRef,{id,source,destination,intent,committedAt:api.serverTimestamp()});
        const outgoing=new Map([...stocks].map(([stockId,stock])=>[stockId,planned.has(stockId)?Math.max(0,planned.get(stockId).oldQty)+planned.get(stockId).restockQty:Number(stock.data.currentStock)]));
        resolved.forEach((item,index)=> {
            const stock=stocks.get(item.reference.id), key=id+'-'+index;
            const line=planned.get(item.reference.id),unitCost=line?line.baseCost:Number(item.cost ?? item.baseCost ?? stock.data.baseCost ?? 0);
            if(branchPolicy.data().isFranchise===true&&unitCost===null)throw Error('A saved supply price is required before charging a franchise delivery.');
            tx.set(reference('dispatch_logs',key),{batchId:id,sourceBranch:source,fromBranch:source,sourceId:item.reference.id,toBranch:destination,unitCost,franchiseCharged:branchPolicy.data().isFranchise === true,details:`${source} ➡️ ${destination}`,item:item.name,qty:item.quantity,uom:item.baseUom || item.uom || stock.data.uom || 'units',displayQty:Number(item.rawQty || item.quantity),displayUom:item.friendlyUom || item.uom || stock.data.uom || 'units',convRate:Number(item.convRate || 1),category:item.category || stock.data.category || 'Uncategorized',driver,status:'In Transit',date:now.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),timestamp:now});
            const before=outgoing.get(item.reference.id),after=before-item.quantity;outgoing.set(item.reference.id,after);
            tx.set(reference('stock_logs','out-'+key),{branch:source,item:item.name,uom:stock.data.uom || 'units',oldQty:before,newQty:after,variance:-item.quantity,type:'Stock Dispatch',dispatchBatchId:id,note:`Sent to ${destination} (Driver: ${driver})`,user:actor,timestamp:api.serverTimestamp()});
            tx.set(reference('stock_logs','in-'+key),{branch:destination,item:item.name,uom:item.baseUom || item.uom || 'units',oldQty:0,newQty:0,variance:0,type:'Incoming Dispatch',note:`From ${source}; awaiting cashier receipt.`,user:actor,timestamp:api.serverTimestamp()});
        });
        if (branchPolicy.data().isFranchise === true) {
            const amount = resolved.reduce((sum,item)=>sum + (planned.has(item.reference.id)?planned.get(item.reference.id).baseCost:Number(item.cost ?? item.baseCost ?? stocks.get(item.reference.id).data.baseCost ?? 0))*item.quantity,0);
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
