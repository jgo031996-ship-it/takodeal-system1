import { resolveHQAccount } from './hq-account-model.js';
import { createWorkspaceSession, canOpenWorkspacePage } from './workspace-access-model.js';
import { ingredientUses } from './recipe-integrity.js';
import { inventoryItemIdentity } from './inventory-item-edit-model.js';

export const RECIPE_REVISION_ID = 'recipe_revision';
export const recipeOperationId = id => 'recipe_operation_' + encodeURIComponent(id);
export const recipeFingerprint = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
export const revisionOf = data => ({version:Number.isSafeInteger(data?.version) ? data.version : 0,revisionId:data?.revisionId || ''});
const same = (a,b) => recipeFingerprint(a) === recipeFingerprint(b);
const reference = (api,table,id) => api.doc(api.db,table,id);
const actorNow = api => {
    const user=api.auth?.currentUser, session=api.sessionUser;
    if(!user?.uid || !user.email || !session || session.email?.toLowerCase()!==user.email.toLowerCase() || session.uid && session.uid!==user.uid)
        throw Error('Sign in with your approved Google account before changing recipes.');
    return {uid:user.uid,email:user.email.toLowerCase()};
};
async function accessRecords(api,actor) {
    const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email)));
    return snap.docs.map(doc=>({id:doc.id,data:doc.data()}));
}
function permitted(api,actor,records,route) {
    if(!same(actorNow(api),actor))throw Error('The Google account changed. Reopen this operation.');
    const account=resolveHQAccount(records);
    if(account.blocked===true)throw Error('This approved account is blocked. Ask the owner to review its access.');
    const current=createWorkspaceSession(actor,account);
    if(!canOpenWorkspacePage(current,route))throw Error('Your current saved permissions do not allow this change.');
    return current;
}
export async function readRecipeRevision(api) {
    const snap=await api.getDocFromServer(reference(api,'settings',RECIPE_REVISION_ID));
    return revisionOf(snap.exists()?snap.data():null);
}
export async function loadRecipeState(api) {
    const actor=actorNow(api);permitted(api,actor,await accessRecords(api,actor),'menu');
    const before=await readRecipeRevision(api);
    const tables=['menu','bom','inventory'],snapshots=await Promise.all(tables.map(table=>api.getDocsFromServer(api.collection(api.db,table))));
    const after=await readRecipeRevision(api);
    if(!same(actorNow(api),actor) || !same(before,after))throw Error('Recipes changed while loading. Refresh and try again.');
    return {revision:after,documents:Object.fromEntries(tables.map((table,i)=>[table,Object.fromEntries(snapshots[i].docs.map(doc=>[doc.id,doc.data()]))]))};
}
const deletionUses=(documents,name)=>ingredientUses(new Set([name]),Object.values(documents.bom||{}),Object.values(documents.menu||{}),Object.values(documents.global_addons||{}),documents.settings?.global_mixmatch?.mappings||[]);
function inventoryDeletionReview(documents,ids) {
    const selected=new Set(ids),deletionRetainedIds=new Set(),deletionDuplicates=[];
    for(const id of ids){
        const item=documents.inventory?.[id];if(!item)throw Error('A stock item changed. Refresh Live Stocks before deleting.');
        const uses=deletionUses(documents,item.name);if(!uses.length)continue;
        const remaining=Object.entries(documents.inventory).filter(([key,row])=>!selected.has(key)&&row.name===item.name&&row.branch===item.branch);
        const recordedZero=(typeof item.currentStock==='number'||typeof item.currentStock==='string'&&item.currentStock.trim()!=='')&&Number(item.currentStock)===0;
        let identity=null,keptIdentity=null;try{identity=inventoryItemIdentity(item);if(remaining.length===1)keptIdentity=inventoryItemIdentity(remaining[0][1]);}catch{}
        const keptStock=remaining[0]?.[1]?.currentStock,recordedKeptStock=(typeof keptStock==='number'||typeof keptStock==='string'&&keptStock.trim()!=='')&&Number.isFinite(Number(keptStock));
        if(!item.name||!item.branch||!recordedZero||!recordedKeptStock||remaining.length!==1||identity===null||identity!==keptIdentity)throw Error('These ingredients are still used. Only an empty duplicate with one matching record remaining in the same branch can be removed.\n\n'+item.name+' · '+item.branch+'\n'+uses.slice(0,8).join('\n'));
        const [keptId,kept]=remaining[0];deletionRetainedIds.add(keptId);
        deletionDuplicates.push({id,name:item.name,branch:item.branch,keptId,keptStock:kept.currentStock,uom:kept.baseUom||kept.uom});
    }
    return {deletionRetainedIds:[...deletionRetainedIds].sort(),deletionDuplicates};
}
export async function loadInventoryDeletionState(api,ids,{timeoutMs=20000}={}) {
    let timer;
    try{return await Promise.race([readInventoryDeletionState(api,ids),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stock and recipe checks took too long. Nothing was deleted. Reconnect and try Delete again.')),timeoutMs);})]);}
    finally{clearTimeout(timer);}
}
export async function inventoryDeletionPreflight(api,ids,{operationId,intent={ids},timeoutMs=20000}={}) {
    let timer;
    const read=async()=>await recipeOperationApplied(api,{operationId,intent,route:'inventory'})?{alreadyApplied:true,state:null}:{alreadyApplied:false,state:await readInventoryDeletionState(api,ids)};
    try{return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stock and recipe checks took too long. Nothing was changed by this attempt. Reconnect and retry Delete to check its saved result.')),timeoutMs);})]);}
    finally{clearTimeout(timer);}
}
async function readInventoryDeletionState(api,ids) {
    if(!Array.isArray(ids) || !ids.length || ids.length>390 || new Set(ids).size!==ids.length || ids.some(id=>!id))throw Error('Select 1–390 unique stock items to delete safely.');
    const actor=actorNow(api);permitted(api,actor,await accessRecords(api,actor),'inventory');
    const before=await readRecipeRevision(api);
    const [stock,bom,menu,addons,mix]=await Promise.all([
        Promise.all(ids.map(id=>api.getDocFromServer(reference(api,'inventory',id)))),
        api.getDocsFromServer(api.collection(api.db,'bom')),api.getDocsFromServer(api.collection(api.db,'menu')),
        api.getDocsFromServer(api.collection(api.db,'global_addons')),api.getDocFromServer(reference(api,'settings','global_mixmatch'))
    ]);
    if(stock.some(row=>!row.exists()))throw Error('A stock item changed. Refresh Live Stocks before deleting.');
    const entries=rows=>Object.fromEntries(rows.map(row=>[row.id,row.data()]));
    const documents={inventory:entries(stock),bom:entries(bom.docs),menu:entries(menu.docs),global_addons:entries(addons.docs),settings:mix.exists()?{global_mixmatch:mix.data()}:{} };
    // Recipes resolve by exact ingredient name within a branch. A referenced
    // name alone does not make every duplicate stock document indispensable.
    const linkedNames=[...new Set(stock.map(row=>row.data().name))].filter(name=>deletionUses(documents,name).length);
    const matches=await Promise.all(linkedNames.map(name=>api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('name','==',name)))));
    for(const result of matches)for(const row of result.docs)if(!ids.includes(row.id))documents.inventory[row.id]=row.data();
    const after=await readRecipeRevision(api);
    if(!same(actorNow(api),actor) || !same(before,after))throw Error('Recipe links changed while checking deletion. Refresh and review again.');
    return {revision:after,documents,...inventoryDeletionReview(documents,ids)};
}
export function inventoryDeletionPlan(state,ids) {
    const review=inventoryDeletionReview(state.documents,ids);
    const intent={ids:[...ids].sort()},plan=recipePlan(state,ids.map(id=>({table:'inventory',id,mode:'delete'})),{label:review.deletionDuplicates.length?'Remove empty duplicate inventory':'Delete unused inventory',intent});
    for(const id of review.deletionRetainedIds)plan.expected.push({table:'inventory',id,exists:true,data:state.documents.inventory[id]});
    plan.deletedInventory=ids.map(id=>({id,record:state.documents.inventory[id]}));
    plan.retainedInventory=review.deletionDuplicates.map(({id,keptId,name,branch})=>({removedId:id,keptId,name,branch}));
    if(new TextEncoder().encode(JSON.stringify(plan.deletedInventory)).length>200000)throw Error('Select fewer stock records so their deletion audit can be saved safely.');
    // The revision protects newly added BOM rows. Existing dependency records
    // are also read in the transaction so edits after confirmation are held.
    for(const table of ['bom','menu','global_addons'])for(const [id,data] of Object.entries(state.documents[table] || {}))plan.expected.push({table,id,exists:true,data});
    plan.expected.push({table:'settings',id:'global_mixmatch',exists:Object.hasOwn(state.documents.settings || {},'global_mixmatch'),data:state.documents.settings?.global_mixmatch ?? null});
    return plan;
}
export function inventoryDeletionConfirmation(state,ids) {
    const review=inventoryDeletionReview(state.documents,ids),items=ids.map(id=>state.documents.inventory[id]);
    const summary=items.slice(0,8).map(item=>item.name+' · '+item.branch+' · '+String(item.currentStock)+' '+(item.baseUom||item.uom||'base units')).join('\n');
    const kept=review.deletionDuplicates.slice(0,8).map(row=>row.name+' · '+row.branch+': keep '+row.keptStock+' '+row.uom).join('\n');
    return 'Permanently delete '+ids.length+' selected stock record(s)?\n\n'+summary+(items.length>8?'\n…and '+(items.length-8)+' more.':'')+(kept?'\n\nEmpty duplicate only. Remaining stock is unchanged:\n'+kept:'')+'\n\nRecipe links, receipts and stock history stay on file. Deleted item details are kept in the operation audit. This removes the selected stock record and cannot be undone from this screen.';
}
export function recipePlan(state,writes,{label='Recipe change',intent=null}={}) {
    const expected=writes.map(write=>({table:write.table,id:write.id,exists:Object.hasOwn(state.documents[write.table] || {},write.id),
        data:state.documents[write.table]?.[write.id] ?? null}));
    return {revision:state.revision,writes,expected,label,fingerprint:recipeFingerprint(intent ?? writes)};
}
export function operationFor(api,key,intent) {
    const fingerprint=recipeFingerprint(intent);
    api.recipeOperations ||= new Map();
    let operation=api.recipeOperations.get(key);
    if(!operation || operation.fingerprint!==fingerprint){operation={id:'recipe-'+crypto.randomUUID(),fingerprint};api.recipeOperations.set(key,operation);}
    return operation.id;
}
export async function recipeOperationApplied(api,{operationId,intent,route='menu'}) {
    const actor=actorNow(api),records=await accessRecords(api,actor);permitted(api,actor,records,route);
    const marker=await api.getDocFromServer(reference(api,'settings',recipeOperationId(operationId)));
    permitted(api,actor,records,route);
    if(!marker.exists())return false;
    if(marker.data().actorUid!==actor.uid || marker.data().fingerprint!==recipeFingerprint(intent))throw Error('This operation ID belongs to different edits. Reopen the operation.');
    return true;
}
export async function saveRecipePlan(api,plan,{operationId,route='menu'}={}) {
    if(!operationId || !plan?.writes?.length || plan.writes.length>390)throw Error('Choose 1–390 document changes for one safe save.');
    if(!['menu','inventory'].includes(route))throw Error('This recipe operation uses an invalid permission scope.');
    const allowedTables=route==='inventory'?['inventory','bom','global_addons','stock_logs','hq_restocks','yield_logs']:['menu','bom'];
    const paths=plan.writes.map(write=>write.table+'/'+write.id);
    if(new Set(paths).size!==paths.length || plan.writes.some(write=>!write.id || !allowedTables.includes(write.table) || !['set','update','delete'].includes(write.mode)) || paths.some(path=>!plan.expected?.some(old=>old.table+'/'+old.id===path)))throw Error('The recipe plan contains duplicate, unguarded or invalid writes for its permission scope.');
    const actor=actorNow(api),records=await accessRecords(api,actor);permitted(api,actor,records,route);
    const revisionRef=reference(api,'settings',RECIPE_REVISION_ID),markerRef=reference(api,'settings',recipeOperationId(operationId));
    return api.runTransaction(api.db,async tx=>{
        const freshRecords=[];
        for(const record of records){const snap=await tx.get(reference(api,'hq_managers',record.id));if(snap.exists())freshRecords.push({id:snap.id,data:snap.data()});}
        permitted(api,actor,freshRecords,route);
        const marker=await tx.get(markerRef);
        if(marker.exists()){
            if(marker.data().fingerprint!==plan.fingerprint || marker.data().actorUid!==actor.uid)throw Error('This operation ID belongs to different edits. Reopen the operation.');
            return {status:'already-applied',...revisionOf(marker.data())};
        }
        const revision=await tx.get(revisionRef),current=revisionOf(revision.exists()?revision.data():null);
        if(!same(current,plan.revision))throw Error('Another recipe change was saved after this preview. Refresh before saving.');
        for(const old of plan.expected){
            const snap=await tx.get(reference(api,old.table,old.id));
            const projected=data=>old.fields?Object.fromEntries(old.fields.map(field=>[field,data?.[field] ?? null])):data;
            if(snap.exists()!==old.exists || snap.exists() && !same(projected(snap.data()),projected(old.data)))throw Error('An affected item changed after this preview. Refresh before saving.');
        }
        permitted(api,actor,freshRecords,route);
        for(const write of plan.writes){const ref=reference(api,write.table,write.id);if(write.mode==='delete')tx.delete(ref);else if(write.mode==='update')tx.update(ref,write.data);else tx.set(ref,write.data);}
        const next={version:current.version+1,revisionId:operationId};
        tx.set(revisionRef,{...next,updatedAt:api.serverTimestamp(),updatedByEmail:actor.email,updatedByUid:actor.uid});
        tx.set(markerRef,{...next,fingerprint:plan.fingerprint,label:plan.label,actorUid:actor.uid,actorEmail:actor.email,recordedAt:api.serverTimestamp(),...(plan.deletedInventory?{deletedInventory:plan.deletedInventory,retainedInventory:plan.retainedInventory}: {})});
        return {status:'saved',...next};
    });
}
// Adapter for existing atomic editor batches. The same input keeps its operation
// identity through a lost acknowledgment; every writer advances the shared revision.
export async function createRecipeBatch(api,{operationId,revision=null,baseline=null,intent=null,route='menu',label='Recipe edit'}={}) {
    revision ||= await readRecipeRevision(api);
    const writes=[];
    const add=(mode,ref,data)=>{const [table,...ids]=ref.path.split('/');writes.push({table,id:ids.join('/'),mode,...(data?{data}:{})});};
    return {update:(ref,data)=>add('update',ref,data),set:(ref,data)=>add('set',ref,data),delete:ref=>add('delete',ref),
        async commit(){
            const documents={};
            for(const write of writes){documents[write.table] ||= {};if(baseline?.documents?.[write.table]){if(Object.hasOwn(baseline.documents[write.table],write.id))documents[write.table][write.id]=baseline.documents[write.table][write.id];continue;}
                const snap=await api.getDocFromServer(reference(api,write.table,write.id));if(snap.exists())documents[write.table][write.id]=snap.data();}
            const plan=recipePlan({revision,documents},writes,{label,intent});
            for(const old of plan.expected){const write=writes.find(row=>row.table===old.table && row.id===old.id);if(old.table==='inventory' && write.mode==='update' && !Object.hasOwn(write.data,'currentStock'))old.fields=[...new Set(['name','branch','baseUom','uom',...Object.keys(write.data)])];}
            return saveRecipePlan(api,plan,{operationId,route});
        }};
}
