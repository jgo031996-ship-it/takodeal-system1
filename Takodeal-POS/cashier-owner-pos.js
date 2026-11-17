import {createSaleEngine, saleIdentity, SALE_VERSION, saleFingerprint, safeId} from './pos-safety.js';
import {recipeRevision,recipeRows} from './recipe-feed.js';
import {editableVoidCart,voidCanonical} from './cashier-void-model.js';
import {restoreVoidPlatform,revealEditableVoidCart} from './cashier-void.js';
import {resetCheckoutForNextOrder} from './checkout-controls.js';

export function installOwnerPOS(w,d){
    let menuSession=null, correction=null, busy=false, awaitingCart=null;
    const context=()=>{
        const c=w.getCashierOwnerWorkspaceContext?.();
        if(!c||c.session!==w.sessionUser||!c.session.isOwner)throw Error('Reopen verified Owner Access.');
        c.assertCurrent(); return c;
    };
    const shift=()=>w.cashierOwnerRegister?.openShift();
    const key=c=>'takodeal_owner_checkout_v1:'+JSON.stringify([c.user.uid,c.branch]);
    const rowData=snap=>snap.exists()?snap.data():{};
    const settings=(c,id)=>w.getDocFromServer(w.doc(c.db,'settings',id));
    const rows=(c,table)=>w.getDocsFromServer(w.collection(c.db,table));
    const pending=c=>JSON.parse(w.localStorage.getItem(key(c))||'null');
    const emptyCart=()=>Array.isArray(w.cart)&&!w.cart.length&&!Object.values(w.platformCarts||{}).some(items=>items?.length)&&!w.isActiveOrderMobile&&!w.isResumedParkedOrder&&!w.parkedRecovery?.activeId?.();
    async function loadMenu(c){
        c.assertCurrent(); menuSession=null; correction=null;
        w.menuListenerUnsubscribe?.();
        const [branch,menu,addons,config,layout,itemLayout,addonLayout,mix]=await Promise.all([
            w.getDocsFromServer(w.query(w.collection(c.db,'branches'),w.where('name','==',c.branch),w.limit(2))),
            rows(c,'menu'),rows(c,'global_addons'),...['global_pos_config','pos_layout','pos_item_layout','pos_addon_layout','global_mixmatch'].map(id=>settings(c,id))]);
        c.assertCurrent();
        if(branch.docs.length!==1)throw Error('The selected branch menu could not be confirmed.');
        const allowed=branch.docs[0].data().allowedCategories||[], cfg=rowData(config);
        const items=menu.docs.map(doc=>({...doc.data(),id:doc.id})).filter(item=>!allowed.length||allowed.includes(item.category));
        w.branchAllowedCategories=allowed;
        w.globalItemLayout=rowData(itemLayout).items||[];
        w.masterPOSData={items:[],variants:{},categories:rowData(layout).categories||[],addonLayoutNames:rowData(addonLayout).itemNames||[],
            addons:addons.docs.map(doc=>doc.data()),globalMixMatch:rowData(mix),settings:{...cfg,
            payMethods:cfg.paymentMethods?.length?cfg.paymentMethods:['Cash','GCash'],
            orderTypes:cfg.orderTypes?.length?cfg.orderTypes:['Dine-In','Take-Out','Delivery','Grab']}};
        w.masterPOSData.items=w.processRawItemsIntoMenu(items);
        w.buildCategories();w.renderOrderAndPaymentUI();w.renderCart?.();
        menuSession=c.session;w.cashierOwnerRegister?.paintStatus();
        if(pending(c))await reviewPending();
    }
    async function verifyVoid(tx,c,shiftId,action){
        const reference=w.doc(c.db,'transactions',action.id);
        const data=rowData(await tx.get(reference));
        if(data.saleId!==action.id||data.branch!==c.branch||data.receiptId!==action.receiptId||data.shiftId!==shiftId||
            saleFingerprint(data)!==action.fingerprint||data.status==='Voided')throw Error('This receipt changed. Reopen it in Shift Sales.');
        const method=String(data.paymentMethod||'').trim().toLowerCase();
        const linked=['paymentReconciliationVersion','paymentReconciliationId','paymentReconciliationFile','manualVerification','refundId','refund','refundAmount','refundedAt','refundedBy','returnId','returnedAt','splitDetails','preparedCancellation','cancelledFoodPurchaseId','cancelledFoodAllocationVersion'];
        if(![undefined,'Paid','Completed','Complete','Settled','Received'].includes(data.status)||!method||data.paymentVerified===true&&method!=='cash'||
            /salary|split|return|refund/.test(method)||linked.some(key=>Object.hasOwn(data,key))||data.isMobileOrder||data.mobileOrderId||data.orderType==='Delivery'||data.mealStaffName||data.mealIdentityId)
            throw Error('This receipt is linked to a payment, delivery, or payroll record. Review it in the Owner App before reversing it.');
        const marker=rowData(await tx.get(w.doc(c.db,'pos_sale_commits',action.id)));
        if(marker.fingerprint!==action.fingerprint||marker.branch!==c.branch||marker.receiptId!==action.receiptId||marker.saleId!==action.id)
            throw Error('This receipt no longer matches its original sale record. Review it in the Owner App.');
        if(data.inventoryState==='applied'){
            const audit=rowData(await tx.get(w.doc(c.db,'settings','audit_'+safeId(c.branch))));
            if(audit.active)throw Error('Finish the branch stock count before returning ingredients.');
            if(!Array.isArray(data.inventoryMovements)||data.inventoryMovements.some(m=>!m?.unitSnapshot))throw Error('Use the original cashier’s stock-unit review before reversing this older receipt.');
        }
        return data.cashier||'';
    }
    async function scoped(c,shiftId,{checkShift=true,markSale=false,voidAction=null}={}){
        const guard=await c.prepareSale();
        async function queryRows(query){
            const snap=await w.getDocsFromServer(query);
            if(voidAction&&(snap.docs.length!==1||snap.docs[0].id!==voidAction.id))throw Error('The saved receipt reference changed. Reopen Shift Sales.');
            return snap;
        }
        return createSaleEngine({db:c.db,doc:w.doc,collection:w.collection,query:w.query,where:w.where,getDocsFromServer:queryRows,
            increment:w.increment,serverTimestamp:w.serverTimestamp,runTransaction:(db,fn)=>w.runTransaction(db,async tx=>{
            await guard.checkTransaction(tx);
            let shiftRef,revision;
            if(checkShift){
                shiftRef=w.doc(db,'shifts',shiftId);
                const row=rowData(await tx.get(shiftRef));
                if(row.branch!==c.branch||row.active!==true||String(row.status||'').toLowerCase()==='closed')throw Error('The original register has closed. Check this receipt in Shift Sales.');
                revision=row.salesRevision??0;
                if((markSale||voidAction)&&(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER))throw Error('The register sales count needs review before checkout.');
            }
            const originalCashier=voidAction?await verifyVoid(tx,c,shiftId,voidAction):'';
            c.assertCurrent();
            const result=await fn(tx);
            c.assertCurrent();
            if(voidAction&&result===true){
                tx.update(w.doc(c.db,'transactions',voidAction.id),{voidReason:voidAction.reason,voidOperationId:voidAction.operationId,voidOwnerUid:c.user.uid});
                tx.set(w.doc(c.db,'manager_alerts','void-'+voidAction.id),{voidReason:voidAction.reason,ownerUid:c.user.uid,sourceSaleId:voidAction.id,originalCashier},{merge:true});
            }
            if(markSale&&result==='committed'||voidAction&&result===true)tx.update(shiftRef,{salesRevision:revision+1});
            return result;
        })});
    }
    async function finish(c,p){
        if(p.ownerUid!==c.user.uid||p.branch!==c.branch||!p.shiftId)throw Error('The saved checkout belongs to a different session.');
        const verification=await scoped(c,p.shiftId,{checkShift:false});
        const {ownerInput,...sale}=p;
        if(!await verification.alreadyCommitted(sale))await (await scoped(c,p.shiftId,{markSale:!sale.voidCorrection})).commit(sale);
        c.assertCurrent();return {status:'committed',payload:p,receiptId:p.receiptId,saleId:p.saleId};
    }
    function exclusive(c,fn){
        if(!w.navigator?.locks)throw Error('Open Owner POS in an updated browser with secure checkout storage.');
        return w.navigator.locks.request(key(c),{ifAvailable:true},lock=>{
            if(!lock)throw Error('Another Owner tab is processing a checkout for this branch.');
            c.assertCurrent();return fn();
        });
    }
    async function reviewPending(){
        const c=context(),p=pending(c);if(!p)return;
        if(!(await w.Swal.fire({title:'Check saved Owner payment',text:'Receipt '+p.receiptId+' is awaiting confirmation. Use the same saved payment to check or finish it.',showCancelButton:true,confirmButtonText:'Check receipt'})).isConfirmed)return;
        await exclusive(c,async()=>{
            const saved=pending(c);if(saved?.saleId!==p.saleId)return;
            await finish(c,saved);w.localStorage.removeItem(key(c));
            if(awaitingCart?.saleId===saved.saleId&&w.cart===awaitingCart.cart&&voidCanonical(w.cart)===voidCanonical(saved.cart)){
                w.cart=[];if(w.platformCarts)w.platformCarts[w.posPlatform||'Standard']=w.cart;
                w.renderCart?.();resetCheckoutForNextOrder(w,d);w.closeModal?.('checkoutModal');
            }
            awaitingCart=null;correction=null;
            await w.Swal.fire({title:'Receipt confirmed',text:saved.receiptId+' is saved in '+c.branch+'.',icon:'success'});
        });
    }
    async function checkout(input){
        let persisted=false;
        try{
            const c=context(),drawer=shift();
            if(!drawer||menuSession!==c.session||input.branch!==c.branch||input.shiftId!==drawer.shiftId)throw Error('Wait for the selected branch menu and open register.');
            if(!Array.isArray(input.cart)||!input.cart.length||!Number.isFinite(input.netTotal)||input.netTotal<0)throw Error('Review the items and total before checkout.');
            if(input.mealStaffName||input.isMobileOrder||input.wasParked||input.resumeRecoveryId||input.paymentMethod==='Salary Deduction')throw Error('Complete this specialized order through its original staff workflow.');
            return await exclusive(c,async()=>{
                let p=pending(c);
                const base=JSON.parse(JSON.stringify(input));
                const split=d.getElementById('splitPaymentContainer');
                if(split&&split.style.display!=='none'){
                    const parts=[1,2].map(i=>({method:d.getElementById('splitMethod'+i).value,amount:Number(d.getElementById('splitAmount'+i).value)}));
                    if(parts.some(part=>!Number.isFinite(part.amount)||part.amount<0)||Math.abs(parts[0].amount+parts[1].amount-base.netTotal)>0.01)throw Error('Split payments must match the order total.');
                    base.splitDetails=parts;base.paymentMethod='Split ('+parts.map(part=>part.method).join(' & ')+')';
                }
                const signature=voidCanonical(base);
                if(p){
                    persisted=true;if(p.ownerInput!==signature)throw Error('A previous payment is awaiting confirmation. Open Shift Sales and select Check saved payment.');
                }else{
                    const fix=correction?.session===c.session?correction:null;
                    if(fix&&(w.cart!==fix.cart||input.shiftId!==fix.shiftId))throw Error('Reopen the original correction in Shift Sales.');
                    const saleId=fix?.saleId||saleIdentity({},w.crypto),now=new Date();
                    const before=recipeRevision(await settings(c,'recipe_revision'));
                    const bom=recipeRows((await rows(c,'bom')).docs.map(doc=>doc.data()));
                    const after=recipeRevision(await settings(c,'recipe_revision'));c.assertCurrent();
                    if(!bom.length||before.version!==after.version||before.revisionId!==after.revisionId)throw Error('Branch recipes are updating. Retry checkout.');
                    p={...base,saleId,status:'Paid',receiptId:'OWN-'+saleId.slice(5).toUpperCase(),saleVersion:SALE_VERSION,
                        localTimestamp:now.toISOString(),cashier:c.actionActor,ownerUid:c.user.uid,ownerInput:signature,
                        paymentVerified:base.paymentMethod==='Cash',recipeSnapshot:bom,recipeSnapshotStatus:'live',
                        ...(fix?{voidCorrection:{sourceSaleId:fix.sourceId,sourceReceiptId:fix.receiptId,operationId:fix.operationId}}:{})};
                    const engine=await scoped(c,p.shiftId);
                    await engine.alreadyCommitted(p);
                    p=await engine.prepare(p,bom);c.assertCurrent();
                    w.localStorage.setItem(key(c),JSON.stringify(p));persisted=true;
                }
                awaitingCart={saleId:p.saleId,cart:w.cart};
                const result=await finish(c,p);w.localStorage.removeItem(key(c));correction=null;awaitingCart=null;
                if(w.platformCarts)w.platformCarts[w.posPlatform||'Standard']=[];
                try{resetCheckoutForNextOrder(w,d);}catch(error){console.warn('Owner receipt saved; payment controls will reset on the next order.',error);}
                return result;
            });
        }catch(e){return {status:persisted?'owner-pending':'failed',error:e.message};}
    }
    async function changeReceipt(id,receiptId){
        if(busy)return;busy=true;
        try{
            const c=context(),drawer=shift();
            if(!drawer)throw Error('Open the current branch shift to change a receipt.');
            const ref=w.doc(c.db,'transactions',id),row=rowData(await w.getDocFromServer(ref));c.assertCurrent();
            if(row.branch!==c.branch||row.receiptId!==receiptId||row.shiftId!==drawer.shiftId||row.saleId!==id)throw Error('This receipt belongs to another shift or needs its saved sale ID reviewed.');
            const resuming=row.status==='Voided'&&row.voidReason==='WrongPunched'&&row.voidOwnerUid===c.user.uid;
            if(row.status==='Voided'&&!resuming)throw Error('This receipt is already voided.');
            const decision=resuming?{isDenied:true}:await w.Swal.fire({title:'Why are you voiding this order?',text:receiptId+' · '+c.branch+' · '+(row.cashier||'Cashier')+' · ₱'+Number(row.netTotal).toFixed(2),
                showCancelButton:true,showDenyButton:true,confirmButtonText:'Cancelled order',denyButtonText:'Wrong punched items',cancelButtonText:'Keep receipt'});
            if(!decision.isConfirmed&&!decision.isDenied)return;
            c.assertCurrent();
            const reason=decision.isDenied?'WrongPunched':'OrderCancelled',operationId='owner-void-'+id;
            let items,platform;
            if(reason==='WrongPunched'){
                if(correction?.session===c.session&&correction.sourceId===id&&w.cart===correction.cart){revealEditableVoidCart(w,d);return;}
                if(!emptyCart()||pending(c))throw Error('Finish the current order or saved payment before restoring this receipt.');
                items=editableVoidCart(row.cart);
                const method=String(row.paymentMethod||'').toLowerCase(),order=String(row.orderType||'').toLowerCase();
                platform=[method,order].includes('grab')?'Grab':[method,order].some(name=>['panda','foodpanda'].includes(name))?'Foodpanda':'Standard';
                if((await w.getDocFromServer(w.doc(c.db,'transactions','sale-'+operationId))).exists())throw Error('The corrected receipt was already checked out.');
            }
            if(!resuming){
                const engine=await scoped(c,drawer.shiftId,{voidAction:{id,receiptId,reason,operationId,fingerprint:saleFingerprint(row)}});
                const changed=await engine.voidSale(receiptId,c.actionActor,c.branch);
                if(!changed)throw Error('Another cashier changed this receipt. Reopen it in Shift Sales.');
            }
            c.assertCurrent();
            if(items){
                if(!emptyCart())throw Error('The receipt was voided. Finish your open cart and select Continue correction in Shift Sales.');
                restoreVoidPlatform(w,d,platform);resetCheckoutForNextOrder(w,d);
                w.cart=items;w.platformCarts||={};w.platformCarts[platform]=items;
                correction={session:c.session,cart:items,sourceId:id,receiptId,shiftId:drawer.shiftId,operationId,saleId:'sale-'+operationId};
                const type=d.getElementById('mainOrderType');if(type&&Array.from(type.options||[]).some(o=>o.value===row.orderType))type.value=row.orderType;
                w.renderCart();revealEditableVoidCart(w,d);
            }else await w.Swal.fire({title:'Order cancelled',text:receiptId+' was voided and its inventory update was recorded.',icon:'success'});
        }catch(e){await w.Swal.fire({title:'Receipt update',text:e.message,icon:'info'});}finally{busy=false;}
    }
    return {loadMenu,checkout,changeReceipt,reviewPending,isReady:()=>!!menuSession&&menuSession===w.sessionUser,isBusy:()=>busy,hasPending:()=>{try{return !!pending(context());}catch{return false;}}};
}
