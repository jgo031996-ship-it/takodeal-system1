const PREFIX='takodeal_parked_resume_v1:';
const clone=value=>JSON.parse(JSON.stringify(value));
const sameStaff=(row,scope)=>row.staffId&&scope.staffId?row.staffId===scope.staffId:row.staffName===scope.staffName;
const generatedSaleKeys=new Set(['saleId','receiptId','localTimestamp','saleVersion','auditDeferred','recipeSnapshot','recipeSnapshotStatus','recipeSnapshotReason','recipeVersion','recipeRevisionId']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const intent=(payload,omit)=>JSON.stringify(canonical(Object.fromEntries(Object.entries(payload).filter(([key])=>!omit.has(key)))));
const saleIntent=payload=>intent(payload,generatedSaleKeys);
const parkIntent=payload=>intent(payload,new Set(['timestamp','id','resumeRecoveryId']));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Each recovery occupies its own durable key; writing one order cannot replace
// a different tab's orders. No account PIN, access grant or permission is saved.
export function createParkedRecoveryStore(storage,{now=Date.now}={}) {
    function get(id){const raw=storage.getItem(id);if(!raw)return null;const row=JSON.parse(raw);if(row.version!==1||row.id!==id||!id.startsWith(PREFIX)||!row.branch||!row.deviceId||!row.order?.id)throw Error('This parked recovery needs management review.');return row;}
    function put(row){const value=JSON.stringify(row);try{storage.setItem(row.id,value);if(storage.getItem(row.id)!==value)throw Error('Storage verification failed.');}catch(error){throw Error('This device could not safely retain the parked order. Ask a Manager to review it before continuing.');}return clone(row);}
    function allowed(row,scope,management=false){return !!row&&row.deviceId===scope.deviceId&&row.branch===scope.branch&&(management||sameStaff(row,scope));}
    return {get,put,allowed,
        capture(scope,order){if(!scope.deviceId||!scope.branch||!scope.staffName||order.branch!==scope.branch||!order.id||!Array.isArray(order.items||order.cart)||(order.items||order.cart).length===0)throw Error('Refresh this parked order before resuming it.');
            const id=PREFIX+[scope.deviceId,scope.branch,order.id].map(encodeURIComponent).join(':');const old=get(id);
            if(old){if(!allowed(old,scope,true))throw Error('This order has a different recovery scope.');return old;}
            return put({version:1,id,...scope,order:clone(order),savedAt:now(),linkedSaleId:null,linkedParkedId:null});},
        list(scope,management=false){const rows=[];for(let i=0;i<(storage.length||0);i++){const id=storage.key(i);if(!id?.startsWith(PREFIX))continue;const row=get(id);if(allowed(row,scope,management))rows.push(row);}return rows.sort((a,b)=>b.savedAt-a.savedAt);},
        remove(id){storage.removeItem(id);if(storage.getItem(id)!==null)throw Error('The recovery remains on this device.');}
    };
}

export function installParkedRecovery(w,d,{primaryAuth,now=Date.now,timeoutMs=25000}={}) {
    if(w.parkedRecovery)return w.parkedRecovery;
    const store=createParkedRecoveryStore(w.localStorage,{now}),pending=new Map();let active=null,activeSession=null,activeCart=null,settledId=null,settledCart=null;
    const scope=()=>({deviceId:w.localStorage.getItem('takodeal_device_id'),branch:w.localStorage.getItem('takodeal_device_branch'),staffId:w.sessionUser?.staffId||'',staffName:w.sessionUser?.cashierName||''});
    const session=()=>JSON.stringify([primaryAuth?.currentUser?.uid,...Object.values(scope()),w.sessionUser?.branch]);
    const current=(row,permit,activeUse=false)=>{permit?.assertCurrent();if(!row||!store.allowed(row,scope(),!!permit?.manageRecovery||activeUse&&active===row.id&&activeSession===session())||w.sessionUser?.branch!==row.branch)throw Error('Open this recovery in its original branch with the original cashier or an approved Manager.');};
    async function server(table,id){const key=JSON.stringify([session(),table,id]);let physical=pending.get(key),timer;if(!physical){physical=Promise.resolve(w.getDocFromServer(w.doc(w.db,table,id)));pending.set(key,physical);physical.finally(()=>{if(pending.get(key)===physical)pending.delete(key);}).catch(()=>{});}
        let snap;try{snap=await Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ to confirm whether this order is already saved.')),timeoutMs);})]);}finally{clearTimeout(timer);}if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Connect to HQ to confirm whether this order is already saved.');return snap.exists()?{...snap.data(),id:snap.id}:null;}
    async function proof(row){
        const cancelled=await server('transactions','parked-delete-'+encodeURIComponent(row.order.id).replace(/\./g,'%2E'));if(cancelled){if(cancelled.branch!==row.branch||cancelled.parkedOrderId!==row.order.id)throw Error('This cancelled parked order needs management review.');return true;}
        if(row.linkedSaleId){const queued=await w.saleOutbox?.list();if(!Array.isArray(queued))throw Error('Local sales could not be checked. Refresh Settings before recovering this order.');
            const local=queued.find(sale=>sale.saleId===row.linkedSaleId);if(local){if(local.payload?.branch!==row.branch)throw Error('This linked receipt needs management review.');return true;}
            const sale=await server('transactions',row.linkedSaleId);if(sale){if(sale.branch!==row.branch||sale.saleId&&sale.saleId!==row.linkedSaleId)throw Error('This linked receipt needs management review.');return true;}
        }
        if(row.linkedParkedId){const parked=await server('parked_orders',row.linkedParkedId);if(parked){if(parked.branch!==row.branch||parked.resumeRecoveryId!==row.id)throw Error('This reparked order needs management review.');return true;}}
        return false;
    }
    function remove(row){if(active===row.id){settledId=row.id;settledCart=activeCart;active=null;activeSession=null;activeCart=null;}try{store.remove(row.id);}catch(error){console.warn('Parked order remains recoverable; its linked receipt will be checked.',error);}}
    function checkoutRow(payload){if(!payload.resumeRecoveryId)return null;if(payload.resumeRecoveryId===settledId&&w.cart===settledCart)throw Error('This order is already saved. Clear this completed cart before entering another order.');const row=store.get(payload.resumeRecoveryId);if(!row)throw Error('The resumed order’s recovery is unavailable. Refresh Settings before checkout.');current(row,null,true);if(active!==row.id||activeSession!==session()||payload.branch!==row.branch)throw Error('The resumed order changed branch or cashier.');return row;}
    function activate(row,permit){current(row,permit);active=row.id;activeSession=session();w.cart=clone(row.order.items||row.order.cart);activeCart=w.cart;w.isResumedParkedOrder=true;
        const order=row.order;w.isActiveOrderMobile=!!order.isMobileOrder;w.activeMobileOrderCode=order.mobileOrderCode||null;w.activeMobileOrderId=order.mobileOrderId||null;
        w.activeMobileDelivery=order.isMobileOrder?{orderId:order.mobileOrderId,branch:order.branch,fee:Number(order.deliveryFee)||0}:null;
        for(const [id,value] of [['finalDeliveryAddress',order.deliveryAddress||''],['finalContactNumber',order.contactNumber||''],['mainOrderType',(order.orderType||'').replace(' (PARKED)','').trim()],['finalCustomerName',order.name||order.customerName||'']]){const input=d.getElementById(id);if(input)input.value=value;}
        w.renderCart?.();w.closeModal?.('parkedModal');w.updateParkedBadge?.();return true;
    }
    async function recover(id){const permit=await w.authorizePOSSetting('parkedOrders'),row=store.get(id);current(row,permit);const captured=session();
        if(await proof(row)){permit.assertCurrent();remove(row);await w.Swal.fire('Order already saved','Its receipt is already saved or the order has been parked again. The cart was left unchanged.','info');return false;}
        const original=await server('parked_orders',row.order.id);current(row,permit);if(captured!==session())throw Error('The signed-in cashier changed. Reopen Settings.');
        if(original)return w.resumeOrder(row.order.id);
        if(!row.deletionConfirmed)throw Error('The original order is no longer parked, but its transfer was not confirmed. Keep this recovery for management review; another cashier may already be serving it.');
        if(w.cart?.length&&!w.confirm('Replace the current cart with this recovered unpaid order?'))return false;
        current(row,permit);return activate(row,permit);
    }
    async function render(permit){const container=d.getElementById('parkedListContainer');if(!container)return;
        const rows=store.list(scope(),!!permit?.manageRecovery);if(!rows.length)return;const captured=session();const section=d.createElement('section');section.className='pos-parked-recovery';
        const heading=d.createElement('h3');heading.textContent='Orders retained on this device';section.append(heading);
        for(const row of rows){current(row,permit);let status='',available=false;
            try{if(await proof(row)){current(row,permit);remove(row);continue;}const original=await server('parked_orders',row.order.id);current(row,permit);if(original)continue;available=!!row.deletionConfirmed;status=available?'Unpaid order · retained safely during resume':'Transfer not confirmed · management review needed before recovering';}
            catch(error){status=error.message;}
            if(captured!==session())return;const card=d.createElement('article');card.className='pos-leave-card';card.innerHTML='<strong>'+escape(row.order.name||row.order.customerName||'Unpaid order')+'</strong><p>'+escape(row.staffName)+' · '+escape(status)+'</p>';
            const button=d.createElement('button');button.type='button';button.textContent=active===row.id&&w.cart?.length?'Already in the current cart':'Recover unpaid order';button.disabled=!available||active===row.id&&!!w.cart?.length;button.onclick=()=>recover(row.id).catch(error=>w.Swal.fire('Parked order recovery',error.message,'info'));card.append(button);section.append(card);
        }
        permit?.assertCurrent();if(captured===session()&&section.children.length>1)container.append(section);
    }
    const service={store,scope,session,capture(order,permit){permit?.assertCurrent();const row=store.capture(scope(),order);current(row,permit);return row;},
        pendingResume(orderId){const row=store.list(scope()).find(row=>row.order.id===orderId);return row?{acknowledge:()=>store.put({...store.get(row.id),deletionConfirmed:true})}:null;},
        acknowledgeResume(id){const row=store.get(id);if(row)store.put({...row,deletionConfirmed:true});},
        activate(id,permit){const row=store.get(id);current(row,permit);if(row.linkedSaleId||row.linkedParkedId)throw Error('This order has a saved attempt. Use its recovery card to check it before checkout.');return activate(row,permit);},
        activeId(){if(settledId&&w.cart===settledCart&&w.cart.length)return settledId;const row=active&&store.get(active);return row&&w.cart===activeCart&&w.cart.length?active:null;},render,recover,
        async prepareCheckout(payload){const row=checkoutRow(payload);if(!row)return;const captured=session();if(row.linkedParkedId)throw Error('This order has a park attempt. Check its recovery card before payment.');
            if(row.linkedSaleId){if(await proof(row))throw Error('This order already has a saved receipt. Open Parked orders to confirm it.');current(row,null,true);if(captured!==session())throw Error('The signed-in cashier changed.');if(saleIntent(payload)!==saleIntent(row.salePayload))throw Error('This order has an earlier checkout attempt. Recover the original order and review its saved checkout before changing it.');Object.assign(payload,clone(row.salePayload));}},
        linkCheckout(payload){const row=checkoutRow(payload);if(!row)return;if(!payload.saleId||!payload.receiptId)throw Error('The resumed receipt identity is missing.');if(row.linkedSaleId&&row.linkedSaleId!==payload.saleId)throw Error('This order already has a different checkout attempt.');store.put({...row,linkedSaleId:payload.saleId,salePayload:clone(payload)});},
        acknowledgeCheckout(payload){if(!payload.resumeRecoveryId)return;const row=store.get(payload.resumeRecoveryId);if(row&&row.branch===payload.branch&&row.linkedSaleId===payload.saleId)remove(row);},
        async preparePark(payload){const id=service.activeId();if(!id)return null;const row=store.get(id);current(row,null,true);const captured=session();if(row.linkedSaleId){if(await proof(row))throw Error('This order already has a saved receipt.');throw Error('Resolve its earlier checkout attempt before parking it again.');}
            if(row.linkedParkedId&&parkIntent(row.parkPayload)!==parkIntent(payload))throw Error('This order has an earlier park attempt with different details.');current(row,null,true);if(captured!==session())throw Error('The signed-in cashier changed.');const parkedId=row.linkedParkedId||w.crypto.randomUUID();
            payload.resumeRecoveryId=row.id;store.put({...row,linkedParkedId:parkedId,parkPayload:clone(payload)});return {id:parkedId,matchesSaved:prior=>prior.resumeRecoveryId===row.id&&parkIntent(prior)===parkIntent(payload),assertCurrent:()=>{if(captured!==session())throw Error('The signed-in cashier changed.');current(row,null,true);}};},
        acknowledgePark(id){const recovery=service.activeId();if(!recovery)return;const row=store.get(recovery);if(row?.linkedParkedId===id)remove(row);}
    };
    w.recoverParkedOrder=id=>recover(id).catch(error=>{w.Swal.fire('Parked order recovery',error.message,'info');return false;});w.parkedRecovery=service;return service;
}
