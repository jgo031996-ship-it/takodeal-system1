import {resolveHQAccount} from './hq-account-model.js';
import {canOpenWorkspacePage,createWorkspaceSession,OWNER_EMAIL} from './workspace-access-model.js';
import {recipeFingerprint,revisionOf,recipeOperationId,RECIPE_REVISION_ID} from './recipe-changes.js';
import {normalizeGlobalAddon,nextGlobalAddonRecord,previewAddonApply,addonUsage,normalizeBundleDraft,bundleDraftRows,menuOptionId,normalizeGlobalMixMatch} from './menu-options-model.js';

const key=value=>String(value??'').trim().toLowerCase(),same=(a,b)=>recipeFingerprint(a)===recipeFingerprint(b);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function fresh(snapshot){if(!snapshot||snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true)throw Error('The current menu records could not be confirmed. Reconnect and refresh.');return snapshot;}
function actorNow(api){
 const user=api.auth?.currentUser,session=api.sessionUser,email=key(user?.email);
 if(!user?.uid||email!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||!session||session.uid!==user.uid||key(session.email)!==email||!canOpenWorkspacePage(session,'addons'))throw Error('Unlock Global Add-Ons with the verified Owner Google account before making changes.');
 return {uid:user.uid,email,session};
}
function assertActor(api,actor){const now=actorNow(api);if(now.uid!==actor.uid||now.email!==actor.email||now.session!==actor.session)throw Error('The Owner account changed. Reopen Global Add-Ons.');}
function permitted(api,actor,rows,grant=null){
 assertActor(api,actor);const account=resolveHQAccount(rows);if(account.blocked===true)throw Error('This Owner account is blocked.');
 const session=createWorkspaceSession({uid:actor.uid,email:actor.email},account);
 if(!canOpenWorkspacePage(session,'addons')&&!canOpenWorkspacePage(session,'menu'))throw Error('The current saved permissions do not allow menu changes.');
 if(grant&&(grant.active===false||grant.blocked===true||/^(blocked|revoked|inactive|disabled)$/i.test(String(grant.status||''))))throw Error('The protected HQ access was revoked. Reopen the Owner workspace.');
 return session;
}
export function createMenuOptionsService(api){
 const issued=new WeakMap(),ref=(table,id)=>api.doc(api.db,table,id);
 const readDoc=async(table,id)=>fresh(await api.getDocFromServer(ref(table,id)));
 async function authority(actor){
  const [snap,grant]=await Promise.all([api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email))).then(fresh),readDoc('hq_email_access',actor.email)]);
  const rows=snap.docs.map(doc=>({id:doc.id,data:fresh(doc).data()}));permitted(api,actor,rows,grant.exists()?grant.data():null);return rows;
 }
 async function load({assertCurrent=()=>{}}={}){
  const actor=actorNow(api),guard=()=>{assertCurrent();assertActor(api,actor);};guard();await authority(actor);guard();
  const before=await readDoc('settings',RECIPE_REVISION_ID),tables=['menu','bom','inventory','global_addons'],settingIds=['menu_bundle_drafts','global_mixmatch','pos_addon_layout'];
  const [snapshots,settings]=await Promise.all([Promise.all(tables.map(table=>api.getDocsFromServer(api.collection(api.db,table)).then(fresh))),Promise.all(settingIds.map(id=>readDoc('settings',id)))]);guard();
  const after=await readDoc('settings',RECIPE_REVISION_ID);guard();if(!same(revisionOf(before.exists()?before.data():null),revisionOf(after.exists()?after.data():null)))throw Error('The menu changed while loading. Refresh Global Add-Ons.');
  const documents=Object.fromEntries(tables.map((table,index)=>[table,Object.fromEntries(snapshots[index].docs.map(doc=>[doc.id,fresh(doc).data()]))]));documents.settings=Object.fromEntries(settings.flatMap((snap,index)=>snap.exists()?[[settingIds[index],snap.data()]]:[]));
  const order=documents.settings.pos_addon_layout?.items,ranks=new Map();if(Array.isArray(order))order.forEach((id,index)=>{if(typeof id==='string'&&!ranks.has(id))ranks.set(id,index);});
  const state={revision:revisionOf(after.exists()?after.data():null),documents};state.addons=Object.entries(documents.global_addons).map(([id,row])=>({...row,id})).sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity)||String(a.name||'').localeCompare(String(b.name||''))||a.id.localeCompare(b.id));state.menu=Object.entries(documents.menu).map(([id,row])=>({...row,id}));state.drafts=bundleDraftRows(state);
  freeze(state);issued.set(state,actor);return state;
 }
 function context(state,assertCurrent){
  const actor=issued.get(state);if(!actor)throw Error('Reload the saved menu state before reviewing a change.');
  return {actor,guard(){assertCurrent();assertActor(api,actor);}};
 }
 function expected(state,table,id,fields=null){const exists=Object.hasOwn(state.documents[table]||{},id);return {table,id,exists,data:exists?state.documents[table][id]:null,fields};}
 function addonDirectory(state){return Object.keys(state.documents.global_addons).map(id=>expected(state,'global_addons',id));}
 function ingredientChecks(state,addon){return Object.entries(state.documents.inventory).filter(([,row])=>row.branch==='Main Office'&&row.name===addon.linkedIngredient).map(([id])=>expected(state,'inventory',id,['name','branch','baseUom','uom']));}
 async function commit({state,operationId,assertCurrent=()=>{},kind,recordId,intent,writes,checks=[]}){
  menuOptionId(operationId,'Save reference');const {actor,guard}=context(state,assertCurrent);guard();const rows=await authority(actor);guard();
  const fingerprint=recipeFingerprint({kind,recordId,intent}),markerRef=ref('settings',recipeOperationId(operationId)),revisionRef=ref('settings',RECIPE_REVISION_ID);
  return api.runTransaction(api.db,async tx=>{
   guard();const [accountSnapshots,grant]=await Promise.all([Promise.all(rows.map(row=>tx.get(ref('hq_managers',row.id)).then(fresh))),tx.get(ref('hq_email_access',actor.email)).then(fresh)]),freshRows=accountSnapshots.filter(snap=>snap.exists()).map(snap=>({id:snap.id,data:snap.data()}));permitted(api,actor,freshRows,grant.exists()?grant.data():null);guard();
   const marker=fresh(await tx.get(markerRef));if(marker.exists()){const old=marker.data();if(old.actorUid!==actor.uid||old.fingerprint!==fingerprint)throw Error('This save reference belongs to different edits. Reopen the operation.');return {id:recordId,status:'already-applied',repeated:true,revision:revisionOf(old)};}
   if(!writes.length)throw Error('No selected records need this change. Refresh the list.');
   const revision=fresh(await tx.get(revisionRef)),current=revisionOf(revision.exists()?revision.data():null);if(!same(current,state.revision))throw Error('Another menu or recipe change was saved after this preview. Refresh before saving.');
   const guarded=new Map();for(const entry of [...checks,...writes.map(write=>expected(state,write.table,write.id))]){const path=entry.table+'/'+entry.id;if(!guarded.has(path)||!entry.fields)guarded.set(path,entry);}
   await Promise.all([...guarded.values()].map(async entry=>{
    const snap=fresh(await tx.get(ref(entry.table,entry.id))),project=data=>entry.fields?Object.fromEntries(entry.fields.map(field=>[field,data?.[field]??null])):data;
    if(snap.exists()!==entry.exists||snap.exists()&&!same(project(snap.data()),project(entry.data)))throw Error('An affected item changed after this preview. Refresh before saving.');
   }));
   permitted(api,actor,freshRows,grant.exists()?grant.data():null);guard();
   const stamp=api.serverTimestamp();for(const write of writes){const target=ref(write.table,write.id),data=typeof write.data==='function'?write.data(stamp):write.data;if(write.mode==='delete')tx.delete(target);else if(write.mode==='update')tx.update(target,data);else tx.set(target,data);}
   const next={version:current.version+1,revisionId:operationId};tx.set(revisionRef,{...next,updatedAt:stamp,updatedByUid:actor.uid,updatedByEmail:actor.email});tx.set(markerRef,{...next,fingerprint,label:'Menu options: '+kind,kind,recordId,actorUid:actor.uid,actorEmail:actor.email,recordedAt:stamp});
   return {id:recordId,status:'saved',repeated:false,revision:next};
  });
 }
 async function saveAddon(id,input,{state,operationId,assertCurrent=()=>{}}={}){
  menuOptionId(id);context(state,assertCurrent).guard();const after=normalizeGlobalAddon(input,state,{id}),before=Object.hasOwn(state.documents.global_addons,id)?state.documents.global_addons[id]:null,record=nextGlobalAddonRecord(before,after);
  return commit({state,operationId,assertCurrent,kind:'save-addon',recordId:id,intent:after,checks:[...addonDirectory(state),...ingredientChecks(state,after)],writes:[{table:'global_addons',id,mode:'set',data:stamp=>({...record,revision:(Number.isSafeInteger(before?.revision)?before.revision:0)+1,createdAt:before?.createdAt??stamp,updatedAt:stamp,lastOperationId:operationId})}]});
 }
 async function applyAddonToProducts(id,selection,{state,operationId,assertCurrent=()=>{}}={}){
  context(state,assertCurrent).guard();const preview=previewAddonApply(state,id,selection);if(preview.conflicts.length)throw Error(preview.conflicts[0].reason);
  const result=await commit({state,operationId,assertCurrent,kind:'apply-addon',recordId:id,intent:{addon:preview.addon,productIds:preview.targets.map(row=>row.id).sort()},checks:[...addonDirectory(state),...ingredientChecks(state,preview.addon),...preview.targets.map(row=>expected(state,'menu',row.id))],writes:preview.changes.map(row=>({table:'menu',id:row.id,mode:'update',data:{addons:row.after}}))});
  return {...result,updatedProducts:preview.changes.length};
 }
 async function deleteAddon(id,{state,operationId,assertCurrent=()=>{}}={}){
  menuOptionId(id);context(state,assertCurrent).guard();const before=Object.hasOwn(state.documents.global_addons,id)?state.documents.global_addons[id]:null;
  if(!before)return commit({state,operationId,assertCurrent,kind:'delete-addon',recordId:id,intent:{id},writes:[]});
  if(Object.values(state.documents.menu).some(product=>product.addons!=null&&!Array.isArray(product.addons)))throw Error('Some saved product choices have an unsupported format. Review them before deleting global add-ons.');
  if(addonUsage(state,id).length)throw Error('This add-on is still used by menu products. Remove or replace those product links before deleting it.');
  return commit({state,operationId,assertCurrent,kind:'delete-addon',recordId:id,intent:{id},checks:[...addonDirectory(state),...Object.keys(state.documents.menu).map(productId=>expected(state,'menu',productId,['name','category','addons']))],writes:[{table:'global_addons',id,mode:'delete'}]});
 }
 async function saveBundleDraft(id,input,{state,operationId,assertCurrent=()=>{}}={}){
  menuOptionId(id,'Bundle draft ID');context(state,assertCurrent).guard();const draft=normalizeBundleDraft(input,state),rows=bundleDraftRows(state),index=rows.findIndex(row=>row.id===id),before=index<0?null:rows[index],doc=state.documents.settings.menu_bundle_drafts;
  if(index<0&&rows.length>=50)throw Error('Keep at most 50 saved bundle drafts.');
  const saved={...draft,id,revision:(Number.isSafeInteger(before?.revision)?before.revision:0)+1};if(index<0)rows.push(saved);else rows[index]=saved;
  if(new TextEncoder().encode(JSON.stringify(rows)).length>750000)throw Error('These saved bundle plans are too large. Reduce the reviewed choices or remove unused plans.');
  const productIds=draft.version===2?[...new Set(draft.slots.flatMap(slot=>slot.menuIds))]:draft.components.map(row=>row.menuId);
  return commit({state,operationId,assertCurrent,kind:'save-bundle-draft',recordId:id,intent:draft,checks:productIds.map(menuId=>expected(state,'menu',menuId)),writes:[{table:'settings',id:'menu_bundle_drafts',mode:'set',data:stamp=>({version:1,revision:(doc?.revision||0)+1,drafts:rows,updatedAt:stamp})}]});
 }
 async function deleteBundleDraft(id,{state,operationId,assertCurrent=()=>{}}={}){
  menuOptionId(id,'Bundle draft ID');context(state,assertCurrent).guard();const rows=bundleDraftRows(state),before=rows.find(row=>row.id===id),doc=state.documents.settings.menu_bundle_drafts;
  if(!before)return commit({state,operationId,assertCurrent,kind:'delete-bundle-draft',recordId:id,intent:{id},writes:[]});
  return commit({state,operationId,assertCurrent,kind:'delete-bundle-draft',recordId:id,intent:{id},writes:[{table:'settings',id:'menu_bundle_drafts',mode:'set',data:stamp=>({version:1,revision:doc.revision+1,drafts:rows.filter(row=>row.id!==id),updatedAt:stamp})}]});
 }
 async function saveMixMatch(input,{state,operationId,assertCurrent=()=>{}}={}){
  context(state,assertCurrent).guard();const config=normalizeGlobalMixMatch(input,state);
  const checks=[...config.mappings.flatMap(row=>ingredientChecks(state,row)),...Object.keys(state.documents.menu).map(id=>expected(state,'menu',id,['category']))];
  return commit({state,operationId,assertCurrent,kind:'save-global-mixmatch',recordId:'global_mixmatch',intent:config,checks,writes:[{table:'settings',id:'global_mixmatch',mode:'set',data:config}]});
 }
 async function saveAddonOrder(ids,{state,operationId,assertCurrent=()=>{}}={}){
  context(state,assertCurrent).guard();const current=Object.keys(state.documents.global_addons);
  if(!Array.isArray(ids)||ids.length!==current.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!Object.hasOwn(state.documents.global_addons,id)))throw Error('The display order must contain every current saved add-on exactly once. Refresh before arranging.');
  ids.forEach(id=>menuOptionId(id));const data={...(state.documents.settings.pos_addon_layout||{}),items:[...ids],itemNames:ids.map(id=>String(state.documents.global_addons[id].name||'').toLowerCase())};
  return commit({state,operationId,assertCurrent,kind:'save-addon-order',recordId:'pos_addon_layout',intent:{items:data.items,itemNames:data.itemNames},checks:addonDirectory(state),writes:[{table:'settings',id:'pos_addon_layout',mode:'set',data}]});
 }
 return {load,saveAddon,previewApply:previewAddonApply,applyAddonToProducts,deleteAddon,saveBundleDraft,deleteBundleDraft,saveMixMatch,saveAddonOrder};
}
