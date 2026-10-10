import {canOpenWorkspacePage} from './workspace-access-model.js';

const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const serialize=value=>JSON.stringify(canonical(value));
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
const sameQuantity=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
function jsonSnapshot(value){
    try{return JSON.parse(JSON.stringify(value,(_key,data)=>{
        if(typeof data==='number'&&!Number.isFinite(data)||typeof data==='function'||typeof data==='symbol'||typeof data==='bigint')throw Error('Non-JSON draft');
        return data;
    }));}catch{throw Error('The draft contains an invalid value. Review its items before setting it aside.');}
}
function branchName(value){
    if(typeof value!=='string'||!value.trim()||value!==value.trim()||/^(unknown\s*branch|unknown|all)$/i.test(value)||value.length>200)
        throw Error('Choose the current Source and Destination branches before setting this draft aside.');
    return value;
}
function capture(api,actor){
    const user=api.auth?.currentUser,session=api.sessionUser,email=normalizeEmail(user?.email);
    if(!user?.uid||!email||user.emailVerified!==true||!session||session.uid!==user.uid||normalizeEmail(session.email)!==email||!canOpenWorkspacePage(session,'dispatch'))
        throw Error('Unlock Dispatch with your approved Google account before setting a draft aside.');
    if(!actor||actor.uid!==user.uid||normalizeEmail(actor.email)!==email)throw Error('Your account changed. Review the draft before setting it aside.');
    const name=typeof actor.name==='string'&&actor.name.trim()?actor.name.trim():String(session.cashierName||email);
    if(name.length>200)throw Error('The saved account name is invalid. Sign in again.');
    return {uid:user.uid,email,name,session};
}
function assertActor(api,actor,source,destination,assertCurrent){
    const current=capture(api,actor);
    if(current.session!==actor.session)throw Error('Your account changed. Review the draft before setting it aside.');
    if(typeof api.isBranchAllowed!=='function'||!api.isBranchAllowed(destination)||!api.isBranchAllowed(source)&&!(actor.session.isFranchisee&&source==='Main Office'))
        throw Error('A selected branch is outside your Dispatch permissions.');
    assertCurrent();
}
async function resolveBranch(api,name){
    if(typeof api.getDocsFromServer!=='function')throw Error('Connect to HQ to confirm the selected branches before setting this draft aside.');
    const result=await api.getDocsFromServer(api.query(api.collection(api.db,'branches'),api.where('name','==',name)));
    const documents=Array.isArray(result.docs)?result.docs:[];
    if(!Array.isArray(result.docs))result.forEach?.(row=>documents.push(row));
    // The legacy Dispatch source list includes HQ even before a Branch
    // Management document exists for it. No other branch is inferred.
    if(documents.length===0&&name==='Main Office')return null;
    if(documents.length!==1)throw Error(`The branch “${name}” is missing or duplicated. Refresh Branch Management before setting this draft aside.`);
    return api.doc(api.db,'branches',documents[0].id);
}
function assertBranch(snapshot,name){
    const data=snapshot.exists()?snapshot.data():null;
    if(!data||data.name!==name||data.active===false||['deleted','disabled','inactive'].includes(String(data.status||'').toLowerCase()))
        throw Error(`The selected branch “${name}” changed. Refresh the draft before setting it aside.`);
}
async function fingerprint(api,payload){
    const crypto=api.crypto||globalThis.crypto;
    if(!crypto?.subtle?.digest)throw Error('Update this browser before saving a dispatch draft.');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialize(payload)));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function linkedBranch(po,source,destination){
    if(po.branch!==destination||po.destinationBranch!=null&&po.destinationBranch!==destination||po.sourceBranch!=null&&po.sourceBranch!==source)
        throw Error('A linked request belongs to a different Source or Destination branch. Reopen it without moving its saved branch.');
}

// Saves a pending request only. No inventory, deliveries, money or unrelated
// requests are changed. The caller clears its captured local draft after success.
export async function commitSetAside(api,{id,source,destination,actor,items,purchaseOrderIds=[],assertCurrent=()=>{}}){
    if(!validId(id))throw Error('A stable draft-save ID is required. Reopen the Set Aside action.');
    source=branchName(source);destination=branchName(destination);
    if(source===destination)throw Error('Source and Destination must be different branches.');
    if(typeof assertCurrent!=='function'||!Array.isArray(items)||!items.length||!Array.isArray(purchaseOrderIds))throw Error('Choose a valid draft before setting it aside.');
    if(purchaseOrderIds.some(value=>!validId(value)||value===id)||new Set(purchaseOrderIds).size!==purchaseOrderIds.length)
        throw Error('The linked request IDs are invalid. Reopen the draft before setting it aside.');
    const savedItems=jsonSnapshot(items),ids=[...purchaseOrderIds].sort();
    for(const row of savedItems){
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof(row.itemName||row.name)!=='string'||!(row.itemName||row.name).trim()||typeof row.qty!=='number'||!Number.isFinite(row.qty)||row.qty<0)
            throw Error('An item has an invalid name or quantity. Review the draft before setting it aside.');
        if(row.rawQty!=null){
            const raw=Number(row.rawQty),rate=Number(row.convRate??1);
            if(!Number.isFinite(raw)||raw<0||!Number.isFinite(rate)||rate<=0||!sameQuantity(raw*rate,row.qty))throw Error('An item’s selected unit and base quantity disagree. Review its dispatch quantity before setting it aside.');
        }
    }
    if(!ids.length&&!savedItems.some(row=>row.qty>0||row.physicalStock!==undefined||row.countSnapshot||['Low Stock','Out of Stock'].includes(row.requestType)))
        throw Error('Enter a quantity or retain a reported-count item before setting this manual draft aside.');
    const identity=capture(api,actor),savedActor={uid:identity.uid,email:identity.email,name:identity.name};
    assertActor(api,identity,source,destination,assertCurrent);
    const type=ids.length?'Merged Set Aside':'Manual Set Aside';
    const payload={version:1,source,destination,actor:savedActor,items:savedItems,purchaseOrderIds:ids};
    const intent=await fingerprint(api,payload);
    assertActor(api,identity,source,destination,assertCurrent);
    const [fromRef,toRef]=await Promise.all([resolveBranch(api,source),resolveBranch(api,destination)]);
    if(!toRef)throw Error('Choose a registered Destination branch before setting this draft aside.');
    assertActor(api,identity,source,destination,assertCurrent);
    const target=api.doc(api.db,'purchase_orders',id),references=ids.map(value=>api.doc(api.db,'purchase_orders',value));
    return api.runTransaction(api.db,async tx=>{
        // Read every referenced record before any write, including on SDK retries.
        const [existing,from,to,...requests]=await Promise.all([tx.get(target),fromRef?tx.get(fromRef):Promise.resolve(null),tx.get(toRef),...references.map(ref=>tx.get(ref))]);
        assertActor(api,identity,source,destination,assertCurrent);
        if(fromRef)assertBranch(from,source);assertBranch(to,destination);
        if(existing.exists()){
            const saved=existing.data(),operation=saved.setAsideOperation;
            if(operation?.version!==1||operation.id!==id||operation.intent!==intent||operation.actorUid!==identity.uid||operation.actorEmail!==identity.email||
               saved.branch!==destination||saved.sourceBranch!==source||saved.destinationBranch!==destination||saved.type!==type||saved.requestedBy!==identity.name||
               serialize(saved.items)!==serialize(savedItems)||serialize(saved.sourcePurchaseOrderIds)!==serialize(ids))
                throw Error('This save ID already belongs to a different draft. Refresh before trying again.');
            requests.forEach(snapshot=>{
                if(!snapshot.exists())throw Error('A previously linked request is missing. Ask HQ to review the saved draft.');
                const po=snapshot.data();linkedBranch(po,source,destination);
                if(po.status!=='Merged'||po.mergedInto!==id||po.setAsideMergeOperation?.intent!==intent||po.setAsideMergeOperation?.actorUid!==identity.uid)
                    throw Error('A linked request changed after the draft was saved. Ask HQ to review it before clearing this cart.');
            });
            return {status:'already-set-aside',id,source,destination,type};
        }
        requests.forEach(snapshot=>{
            if(!snapshot.exists())throw Error('A linked request was removed. Refresh the request list before setting this draft aside.');
            const po=snapshot.data();linkedBranch(po,source,destination);
            if(!['Pending','Drafting','Delayed'].includes(po.status)||po.mergedInto)throw Error('A linked request was already processed. Refresh it before setting this draft aside.');
        });
        assertActor(api,identity,source,destination,assertCurrent);
        tx.set(target,{branch:destination,sourceBranch:source,destinationBranch:destination,items:savedItems,status:'Pending',type,
            requestedBy:identity.name,timestamp:api.serverTimestamp(),sourcePurchaseOrderIds:ids,
            managerMessage:'Saved from the Dispatch Cart. Stock has not been dispatched.',
            setAsideOperation:{version:1,id,intent,actorUid:identity.uid,actorEmail:identity.email,actorName:identity.name}});
        references.forEach(ref=>tx.update(ref,{status:'Merged',mergedInto:id,mergedAt:api.serverTimestamp(),mergedBy:savedActor,
            setAsideMergeOperation:{version:1,id,intent,actorUid:identity.uid,actorEmail:identity.email}}));
        return {status:'set-aside',id,source,destination,type};
    });
}
