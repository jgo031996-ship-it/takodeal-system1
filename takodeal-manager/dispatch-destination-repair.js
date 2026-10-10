import {canOpenWorkspacePage,createWorkspaceSession,OWNER_EMAIL} from './workspace-access-model.js';
import {resolveHQAccount} from './hq-account-model.js';

const text=value=>typeof value==='string'?value.trim():'';
const lower=value=>text(value).toLowerCase();
const unknown=value=>value==null || typeof value==='string' && (text(value)==='' || lower(value)==='unknown branch');
const mutable=data=>['Pending','Drafting','Delayed'].includes(data.status);
const activeBranch=data=>text(data?.name) && !unknown(data.name) && data.active!==false && !['inactive','disabled','blocked','deleted','closed'].includes(lower(data.status));
function manualDraft(data) {
    if(data.isForecast===true || /(?:^|[\s_-])ai(?:$|[\s_-])|forecast/i.test(text(data.type)))return false;
    return lower(data.type).replace(/[\s_-]/g,'')==='manualsetaside'
        || /^system\s*\(\s*merged\s*\/\s*set\s*aside\s*\)$/i.test(text(data.requestedBy));
}
function canonical(value) {
    if(value instanceof Date)return {date:value.getTime()};
    if(typeof value?.toMillis==='function')return {date:value.toMillis()};
    if(Array.isArray(value))return value.map(canonical);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
    return value;
}
async function fingerprint(api,data) {
    const crypto=api.crypto || globalThis.crypto;
    if(!crypto?.subtle?.digest)throw Error('Update this browser before repairing a saved dispatch draft.');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(data))));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function actor(api) {
    const user=api.auth?.currentUser,session=api.sessionUser,email=lower(user?.email);
    if(!user?.uid || !email || user.emailVerified!==true || !Array.isArray(user.providerData) || !user.providerData.some(provider=>provider.providerId==='google.com')
        || !session || session.uid!==user.uid || lower(session.email)!==email || session.isFranchisee===true || !canOpenWorkspacePage(session,'dispatch'))
        throw Error('Unlock Dispatch with your approved Google account before repairing this saved draft.');
    return {uid:user.uid,email,session};
}
function assertCurrent(api,expected) {
    const current=actor(api);
    if(current.uid!==expected.uid || current.email!==expected.email || current.session!==expected.session)throw Error('Your account changed. Reopen this saved draft.');
}
function authority(api,expected,records,branch='') {
    assertCurrent(api,expected);
    const saved=resolveHQAccount(records);
    if(saved.blocked===true)throw Error('This HQ account is blocked. Ask the Owner to review its access.');
    const session=createWorkspaceSession({uid:expected.uid,email:expected.email},saved);
    if(session.isFranchisee || !canOpenWorkspacePage(session,'dispatch'))throw Error('Your saved HQ permissions do not allow dispatch draft repairs.');
    if(branch && (typeof api.isBranchAllowed!=='function' || api.isBranchAllowed(branch)!==true
        || expected.email!==OWNER_EMAIL && !session.allowedBranches.some(name=>name==='All' || name===branch)))
        throw Error('This destination is outside your saved Dispatch branch permissions.');
    return session;
}
function validateRequest(data) {
    if(!mutable(data) || data.dispatchBatchId || data.completedAt)throw Error('This request was already processed. Reload the request list.');
    if(!unknown(data.branch))return;
    if(!manualDraft(data))throw Error('This request has no confirmed destination. Verify it with the branch; automatic forecasts are not repaired here.');
    if(!unknown(data.destinationBranch))throw Error('This saved draft has conflicting destinations. Ask HQ to review its original records.');
    if(data.destinationRepair)throw Error('This saved draft already has a destination repair record. Ask HQ to review it before changing the destination again.');
}
function sourceName(data) {
    if(unknown(data.sourceBranch))return 'Main Office';
    if(typeof data.sourceBranch!=='string')throw Error('The saved draft source is unclear. Ask HQ to review its original records.');
    return text(data.sourceBranch);
}
const branchesByName=(rows,name)=>rows.filter(row=>row.data.name===name && activeBranch(row.data));

// Installed after both existing review handlers. A repair changes only the
// request's destination and audit metadata; the original review/draft flow
// remains responsible for its own permissions and confirmation.
export function installDispatchDestinationRepair(api,{document,dialogs=api.Swal}={}) {
    if(api.dispatchDestinationRepair)return api.dispatchDestinationRepair;
    if(typeof api.reviewPurchaseOrder!=='function' || typeof api.reviewStockRequest!=='function' || typeof dialogs?.fire!=='function')
        throw Error('Install destination repair after the stock request review handlers.');
    const originals={reviewPurchaseOrder:api.reviewPurchaseOrder,reviewStockRequest:api.reviewStockRequest},attempts=new Map();
    let busy=false;
    async function readAccess(expected) {
        const result=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',expected.email)));
        assertCurrent(api,expected);
        const rows=result.docs.map(row=>({id:row.id,data:row.data()}));authority(api,expected,rows);return rows;
    }
    async function readBranches(expected) {
        const result=await api.getDocsFromServer(api.collection(api.db,'branches'));assertCurrent(api,expected);
        return result.docs.map(row=>({id:row.id,data:row.data()}));
    }
    function allowed(apiActor,records,name) {try{authority(api,apiActor,records,name);return true;}catch{return false;}}
    async function review(original,context,poId,args) {
        let ownsBusy=false;
        try {
            if(typeof poId!=='string' || !poId || poId.includes('/'))throw Error('Choose an existing saved request.');
            const ref=api.doc(api.db,'purchase_orders',poId),snap=await api.getDocFromServer(ref);
            if(!snap.exists())throw Error('This saved draft could not be found. Refresh the request list.');
            const before=snap.data();
            // Ordinary request review already owns its authorization and state
            // handling, including Franchise and completed-request inspection.
            if(typeof before.branch==='string' && !unknown(before.branch))return await original.call(context,poId,...args);
            if(!unknown(before.branch))throw Error('The saved draft destination is unclear. Ask HQ to review its original records.');
            validateRequest(before);
            if(busy)return false;busy=true;ownsBusy=true;
            const expected=actor(api);
            const records=await readAccess(expected),branches=await readBranches(expected),source=sourceName(before);
            if(source!=='Main Office' && (branchesByName(branches,source).length!==1 || !allowed(expected,records,source)))
                throw Error('The saved draft source is unavailable or outside your Dispatch permissions.');
            const choices=branches.filter(row=>activeBranch(row.data) && row.data.name===text(row.data.name) && row.data.name!==source
                && branchesByName(branches,row.data.name).length===1 && allowed(expected,records,row.data.name));
            if(!choices.length)throw Error('No unique active destination branches are available in your Dispatch permissions. Ask the Owner to check Branch Management.');
            const hash=await fingerprint(api,before);assertCurrent(api,expected);
            const answer=await dialogs.fire({titleText:'Choose the destination for this saved draft',
                text:'This older manual draft was saved without a branch. Select its correct destination. The saved items, quantities, date and status will be kept; no stock or money will move.',
                input:'select',inputLabel:'Destination branch',inputOptions:Object.fromEntries(choices.sort((a,b)=>a.data.name.localeCompare(b.data.name)).map(row=>[row.id,row.data.name])),
                inputValue:'',inputPlaceholder:'Select the correct branch',inputValidator:value=>choices.some(row=>row.id===value)?undefined:'Choose one of the confirmed destination branches.',
                showCancelButton:true,confirmButtonText:'Save destination and review',cancelButtonText:'Keep draft unchanged',confirmButtonColor:'#12644f',focusConfirm:false});
            assertCurrent(api,expected);if(!answer?.isConfirmed)return false;
            const chosen=choices.find(row=>row.id===answer.value);if(!chosen)throw Error('Choose one of the confirmed destination branches.');
            const currentBranches=await readBranches(expected),matching=branchesByName(currentBranches,chosen.data.name);
            if(matching.length!==1 || matching[0].id!==chosen.id)throw Error('The selected branch changed or is duplicated. Reopen the saved draft.');
            const sourceMatches=source==='Main Office'?[]:branchesByName(currentBranches,source);
            if(source!=='Main Office' && sourceMatches.length!==1)throw Error('The saved draft source changed. Reopen it before repairing its destination.');
            const watchedBranches=currentBranches.filter(row=>row.data.name===chosen.data.name || source!=='Main Office' && row.data.name===source);
            const key=JSON.stringify([expected.uid,poId,hash,chosen.id]);
            if(!attempts.has(key)) {
                const crypto=api.crypto || globalThis.crypto;if(typeof crypto?.randomUUID!=='function')throw Error('Update this browser before repairing a saved draft.');
                attempts.set(key,'destination-repair-'+crypto.randomUUID());
            }
            const operationId=attempts.get(key);
            await api.runTransaction(api.db,async tx=>{
                const savedRecords=[];
                for(const record of records) {const row=await tx.get(api.doc(api.db,'hq_managers',record.id));assertCurrent(api,expected);if(row.exists())savedRecords.push({id:record.id,data:row.data()});}
                authority(api,expected,savedRecords,chosen.data.name);
                const liveBranches=[];
                for(const branch of watchedBranches) {const row=await tx.get(api.doc(api.db,'branches',branch.id));assertCurrent(api,expected);if(row.exists())liveBranches.push({id:branch.id,data:row.data()});}
                const destinations=branchesByName(liveBranches,chosen.data.name);
                if(destinations.length!==1 || destinations[0].id!==chosen.id)throw Error('The selected branch changed or is duplicated. Reopen the saved draft.');
                if(source!=='Main Office') {
                    if(branchesByName(liveBranches,source).length!==1)throw Error('The saved draft source changed. Reopen the request.');
                    authority(api,expected,savedRecords,source);
                }
                const request=await tx.get(ref);assertCurrent(api,expected);
                if(!request.exists())throw Error('This saved draft was removed. Refresh the request list.');
                const current=request.data(),marker=current.destinationRepair;
                if(marker?.operationId===operationId && marker.actorUid===expected.uid && marker.requestHash===hash
                    && current.branch===chosen.data.name && current.destinationBranch===chosen.data.name && current.sourceBranch===source) {
                    if(!mutable(current) || current.dispatchBatchId || current.completedAt)throw Error('This request was already processed. Reload the request list.');
                    const restored={...current};delete restored.destinationRepair;
                    for(const field of ['branch','destinationBranch','sourceBranch']) {
                        if(Object.hasOwn(before,field))restored[field]=before[field];else delete restored[field];
                    }
                    if(await fingerprint(api,restored)!==hash)throw Error('This saved draft was edited after its repair. Reopen it before continuing.');
                    authority(api,expected,savedRecords,chosen.data.name);return;
                }
                validateRequest(current);
                if(!unknown(current.branch) || await fingerprint(api,current)!==hash)throw Error('Another account edited or repaired this saved draft. Reload it before choosing a destination.');
                authority(api,expected,savedRecords,chosen.data.name);
                tx.update(ref,{branch:chosen.data.name,destinationBranch:chosen.data.name,sourceBranch:source,
                    destinationRepair:{version:1,operationId,requestHash:hash,previousBranch:before.branch ?? null,previousDestinationBranch:before.destinationBranch ?? null,
                        previousSourceBranch:before.sourceBranch ?? null,destinationBranch:chosen.data.name,sourceBranch:source,
                        actorUid:expected.uid,actorEmail:expected.email,actorName:text(expected.session.cashierName) || 'Authorized HQ account',repairedAt:api.serverTimestamp()}});
            });
            assertCurrent(api,expected);return await original.call(context,poId,...args);
        } catch(error) {
            await dialogs.fire({titleText:'Saved draft needs attention',text:error.message || 'Reconnect and reopen this saved draft. Nothing was dispatched.',icon:'warning'});return false;
        } finally {if(ownsBusy)busy=false;}
    }
    for(const [name,original] of Object.entries(originals))api[name]=function(poId,...args){return review(original,this,poId,args);};
    api.dispatchDestinationRepair={busy:()=>busy};return api.dispatchDestinationRepair;
}
