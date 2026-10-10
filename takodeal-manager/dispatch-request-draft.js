import {canOpenWorkspacePage} from './workspace-access-model.js';

const attempts=new Map(),keys=['takodeal_dispatch_cart','takodeal_dispatch_from','takodeal_dispatch_to','takodeal_active_po'];
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const stringify=value=>JSON.stringify(canonical(value));
const requestFields=po=>({branch:po.branch,sourceBranch:po.sourceBranch ?? null,destinationBranch:po.destinationBranch ?? null,type:po.type ?? null,requestedBy:po.requestedBy ?? null,items:po.items});
const activeIds=storage=>[...new Set(String(storage.getItem('takodeal_active_po') || '').split(',').map(value=>value.trim()).filter(Boolean))];
const close=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
const unit=value=>String(value || '').trim().toLowerCase();
function capture(api){
    const user=api.auth?.currentUser,session=api.sessionUser,email=String(user?.email || '').trim().toLowerCase();
    if(!user?.uid || !email || user.emailVerified!==true || !session || session.uid!==user.uid || String(session.email || '').trim().toLowerCase()!==email || !canOpenWorkspacePage(session,'dispatch'))
        throw Error('Unlock Dispatch with your approved Google account before loading a request.');
    return {uid:user.uid,email,session};
}
function assertCurrent(api,actor,branch,source){
    const current=capture(api);
    if(current.uid!==actor.uid || current.email!==actor.email || current.session!==actor.session)throw Error('Your account changed. Reopen this request.');
    if(typeof api.isBranchAllowed!=='function' || !api.isBranchAllowed(branch))throw Error('This branch is outside your Dispatch permissions.');
    // Existing branch-scoped request loading uses canonical HQ as its supply
    // source. This prepares a request/cart; it does not authorize a stock send.
    if(source && source!=='Main Office' && !api.isBranchAllowed(source))throw Error('The request source is outside your Dispatch permissions.');
}
function stageCart(before,po,hqDetails){
    const cart=clone(before);
    for(const req of po.items){
        const name=req.itemName || req.name;if(typeof name!=='string' || !name.trim())throw Error('An item name is missing. Review this request before loading it.');
        const hq=Object.hasOwn(hqDetails,name)?hqDetails[name]:{},purchase=hq.purchaseUom || hq.purchUom || req.purchaseUom || req.uom || 'units',base=hq.uom || hq.baseUom || req.uom || req.baseUom || 'units';
        const conversion=parseFloat(hq.conversionRate) || parseFloat(hq.conversion) || parseFloat(req.convRate) || parseFloat(req.conversionRate) || 1;
        const original=parseFloat(req.qty) || 0;
        if(!Number.isFinite(conversion) || conversion<=0 || !Number.isFinite(original) || original<0 || typeof purchase!=='string' || typeof base!=='string')throw Error('An item has invalid quantity or dispatch units. Review it before loading the cart.');
        const physical=req.physicalStock!==undefined?req.physicalStock:original,system=req.systemStock!==undefined?req.systemStock:0;
        const audit=req.requestType==='Low Stock' || req.requestType==='Out of Stock' || req.physicalStock!==undefined;
        let badge=req.requestType || 'Request';if(badge==='Delayed / Backlogged' && audit)badge=physical<=0?'Out of Stock':'Low Stock';
        const raw=audit?0:original/conversion,quantity=audit?0:original,selected=purchase.toLowerCase()!==base.toLowerCase()?'purch':'base';
        const mapped={...clone(req),rawQty:raw,qty:quantity,origRawQty:raw,origBaseQty:quantity,purchaseUom:purchase,baseUom:base,conversionRate:conversion,selectedUom:selected,
            hqStock:parseFloat(hq.currentStock) || 0,requestType:badge,physicalStock:physical,systemStock:system,convRate:selected==='purch'?conversion:1,friendlyUom:selected==='purch'?purchase:base};
        if(!close(mapped.rawQty*mapped.convRate,mapped.qty))throw Error(`The dispatch units for ${name} are inconsistent. Ask HQ to review the item conversion before loading this request.`);
        const existing=cart.find(item=>(item.itemName || item.name)===name);
        if(existing){
            const oldRate=Number(existing.convRate || 1),oldRaw=Number(existing.rawQty ?? existing.qty),oldBase=Number(existing.qty),oldUnit=existing.friendlyUom || (existing.selectedUom==='purch'?existing.purchaseUom:existing.baseUom || existing.uom);
            if(existing.selectedUom!==mapped.selectedUom || unit(existing.baseUom || existing.uom)!==unit(mapped.baseUom) || unit(oldUnit)!==unit(mapped.friendlyUom) || !Number.isFinite(oldRate) || !close(oldRate,mapped.convRate) ||
               !Number.isFinite(oldRaw) || !Number.isFinite(oldBase) || oldRaw<0 || oldBase<0 || !close(oldRaw*oldRate,oldBase))
                throw Error(`Your existing ${name} draft uses different units or a different package conversion. Finish or set aside that draft before loading this request.`);
            existing.rawQty=oldRaw+raw;existing.qty=oldBase+quantity;existing.origRawQty=existing.rawQty;existing.origBaseQty=existing.qty;
            Object.assign(existing,{requestType:badge,physicalStock:physical,systemStock:system,purchaseUom:mapped.purchaseUom,baseUom:mapped.baseUom,conversionRate:mapped.conversionRate,hqStock:mapped.hqStock});
        }else cart.push(mapped);
    }
    return cart;
}
async function hash(api,value){
    const crypto=api.crypto || globalThis.crypto;if(!crypto?.subtle?.digest || !crypto?.randomUUID)throw Error('Update this browser before loading a saved dispatch draft.');
    const result=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function storageSnapshot(storage){
    const selected=[...new Set([...keys,...Object.keys(storage).filter(key=>key.startsWith('takodeal_draft_qty_'))])];
    return new Map(selected.map(key=>[key,storage.getItem(key)]));
}
function restore(storage,snapshot){for(const [key,value] of snapshot){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch{}}}
function sameDraft(api,storage,cart,snapshot,controls=[]){
    if(stringify(api.dispatchCart || [])!==stringify(cart))return false;
    return [...snapshot].every(([key,value])=>storage.getItem(key)===value) && controls.every(([control,value])=>control.value===value);
}
// Only prepares a local dispatch draft and request status. Posting actual stock
// remains the existing atomic Send delivery operation, never this review action.
export async function loadStockRequestDraft(api,{poId,po,hqDetails={}},{storage=globalThis.localStorage,document=globalThis.document}={}){
    if(typeof poId!=='string' || !poId || poId.length>150 || poId.includes('/') || !po || typeof po.branch!=='string' || !po.branch || !Array.isArray(po.items) || !po.items.length)
        throw Error('Reload a valid stock request before preparing its dispatch draft.');
    po=clone(po);
    const source=po.sourceBranch ?? 'Main Office';
    if(typeof source!=='string' || !source.trim() || source!==source.trim() || /^(unknown\s*branch|unknown|all)$/i.test(source) || po.destinationBranch!=null && po.destinationBranch!==po.branch)
        throw Error('The request has invalid Source or Destination information. Refresh it before loading the draft.');
    const sourceControl=document?.getElementById('dispFrom');
    if(sourceControl?.options && !Array.from(sourceControl.options).some(option=>option.value===source))throw Error('The request source is unavailable. Refresh Branch Management before loading this draft.');
    const actor=capture(api);assertCurrent(api,actor,po.branch,source);
    const ids=activeIds(storage);if(ids.includes(poId))return {alreadyLoaded:true,branch:po.branch};
    const before=clone(api.dispatchCart || []),savedDestination=storage.getItem('takodeal_dispatch_to') || '',destination=savedDestination || (ids.length?'':document?.getElementById('dispTo')?.value || '');
    if((before.length || ids.length) && destination!==po.branch)return {blockedDestination:true,destination:destination || 'an unconfirmed branch',branch:po.branch};
    const savedSource=storage.getItem('takodeal_dispatch_from') || sourceControl?.value || '';
    if((before.length || ids.length) && savedSource!==source)return {blockedSource:true,source:savedSource || 'an unconfirmed branch',requestedSource:source,branch:po.branch};
    const controls=[sourceControl,document?.getElementById('dispTo')].filter(Boolean).map(control=>[control,control.value]);
    const snapshot=storageSnapshot(storage),staged=stageCart(before,po,hqDetails),request=stringify(requestFields(po)),intent=await hash(api,stringify({poId,request:requestFields(po),before,staged}));
    assertCurrent(api,actor,po.branch,source);if(activeIds(storage).includes(poId))return {alreadyLoaded:true,branch:po.branch};
    if(!sameDraft(api,storage,before,snapshot,controls))throw Error('Your dispatch draft changed while this request was loading. Review it again.');
    const key=actor.uid+':'+poId+':'+intent;if(!attempts.has(key))attempts.set(key,'request-draft-'+(api.crypto || globalThis.crypto).randomUUID());const operationId=attempts.get(key);
    const ref=api.doc(api.db,'purchase_orders',poId);
    try{await api.runTransaction(api.db,async tx=>{
        const saved=await tx.get(ref);assertCurrent(api,actor,po.branch,source);
        if(!sameDraft(api,storage,before,snapshot,controls))throw Error('Your dispatch draft changed while this request was loading. Review it again.');
        if(!saved.exists())throw Error('This request was removed. Refresh the request list.');const current=saved.data();
        if(!['Pending','Drafting','Delayed'].includes(current.status) || stringify(requestFields(current))!==request)throw Error('This request changed or was already processed. Refresh it before loading the cart.');
        const marker=current.dispatchDraftOperation;
        if(marker?.intent===intent && marker.actorUid===actor.uid && current.status==='Drafting')return;
        if(current.status!==po.status)throw Error('Another account changed the request status. Refresh it before loading the cart.');
        assertCurrent(api,actor,po.branch,source);
        tx.update(ref,{status:'Drafting',managerMessage:'Reviewed and loaded into the editable Dispatch Cart. Stock has not been dispatched.',processedAt:api.serverTimestamp(),
            dispatchDraftOperation:{version:1,operationId,intent,actorUid:actor.uid,actorEmail:actor.email,loadedAt:api.serverTimestamp()}});
    });}catch(error){assertCurrent(api,actor,po.branch,source);if(activeIds(storage).includes(poId))return {alreadyLoaded:true,branch:po.branch};throw error;}
    assertCurrent(api,actor,po.branch,source);
    if(activeIds(storage).includes(poId))return {alreadyLoaded:true,branch:po.branch};
    if(!sameDraft(api,storage,before,snapshot,controls))throw Error('The request draft status was recorded, but your local cart or branch selection changed. Refresh before loading it again. Nothing was dispatched.');
    try{
        storage.setItem('takodeal_dispatch_cart',JSON.stringify(staged));storage.setItem('takodeal_dispatch_from',source);storage.setItem('takodeal_dispatch_to',po.branch);storage.setItem('takodeal_active_po',[...ids,poId].join(','));
        if(!before.length)for(const key of snapshot.keys())if(key.startsWith('takodeal_draft_qty_'))storage.removeItem(key);
    }catch{
        restore(storage,snapshot);throw Error('The request status was recorded, but this device could not save the draft. Reopen the request and retry; nothing was dispatched.');
    }
    api.dispatchCart=staged;
    const from=document?.getElementById('dispFrom'),to=document?.getElementById('dispTo');if(from)from.value=source;if(to)to.value=po.branch;
    return {loaded:true,branch:po.branch,source};
}
