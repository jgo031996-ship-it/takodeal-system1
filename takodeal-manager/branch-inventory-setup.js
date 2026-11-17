import {OWNER_EMAIL,canOpenInventoryTab,canOpenWorkspacePage} from './workspace-access-model.js';
import {activeInventoryBranch,activeInventoryTemplate,inventoryTemplatePayload,planBranchInventorySetup,branchInventoryId} from './branch-inventory-model.js';
const lower=value=>String(value||'').trim().toLowerCase();
export function branchInventoryActor(api,branch){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||lower(session.email)!==lower(user.email)||session.isFranchisee===true
  ||!canOpenWorkspacePage(session,'branches')||!canOpenInventoryTab(session,'Overview')
  ||lower(user.email)!==OWNER_EMAIL&&!session.allowedBranches?.includes('All')||branch&&api.isBranchAllowed?.(branch)!==true)throw Error('Sign in with HQ access to all branches and Live Stocks before setting up branch inventory.');
 return JSON.stringify([user.uid,user.email,session.uid,session.email,session.permissions,session.allowedBranches,session.isFranchisee]);
}
function rows(snapshot,label){
 if(snapshot?.metadata?.fromCache!==false||snapshot?.metadata?.hasPendingWrites!==false||!Array.isArray(snapshot.docs)||snapshot.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Reconnect to confirm the latest '+label+'.');
 return snapshot.docs.map(row=>({...row.data(),id:row.id}));
}
export function createBranchInventorySetup(api){
 const flights=new Map();
 async function directory(guard){
  const account=branchInventoryActor(api),user=api.auth.currentUser;
  guard();
  const [branches,items]=await Promise.all([
   api.getDocsFromServer(api.collection(api.db,'branches')),
   api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.limit(5001)))
  ]);
  guard();
  if(user!==api.auth.currentUser||account!==branchInventoryActor(api))throw Error('Your HQ session changed. Reopen Branch item sync.');
  return {branches:rows(branches,'branch directory'),items:rows(items,'stock item directory')};
 }
 function ensure(branch,{assertCurrent=()=>{},reviewedCreates}={}){
  let actor;try{actor=branchInventoryActor(api,branch);assertCurrent();}catch(error){return Promise.reject(error);}
  const key=actor+'|'+branch;if(flights.has(key))return flights.get(key).then(result=>{assertCurrent();return result;});
  const user=api.auth.currentUser,session=api.sessionUser;
  const guard=()=>{assertCurrent();if(api.auth?.currentUser!==user||api.sessionUser!==session||branchInventoryActor(api,branch)!==actor)throw Error('The HQ account or branch access changed. Reopen item setup.');};
  const work=(async()=>{
   const plan=planBranchInventorySetup({branch,...await directory(guard)});
   if(reviewedCreates && JSON.stringify(plan.creates)!==JSON.stringify(reviewedCreates))throw Error('The catalog has changed. Reopen Branch item sync to review the current items.');
   const targets=await Promise.all(plan.creates.map(async row=>({...row,id:await branchInventoryId(branch,row.name)})));guard();
   const branchRef=api.doc(api.db,'branches',plan.branchId);let created=0;
   for(let offset=0;offset<targets.length;offset+=25){
    const chunk=targets.slice(offset,offset+25);
    created+=await api.runTransaction(api.db,async tx=>{
     guard();const [savedBranch,...snapshots]=await Promise.all([tx.get(branchRef),...chunk.flatMap(row=>[tx.get(api.doc(api.db,'inventory',row.id)),tx.get(api.doc(api.db,'inventory',row.sourceId))])]);guard();
     if(!savedBranch.exists()||savedBranch.data().name!==branch||!activeInventoryBranch(savedBranch.data()))throw Error('The destination branch changed or is no longer active.');
     const pending=[];
     for(let index=0;index<chunk.length;index++){
      const row=chunk[index],destination=snapshots[index*2],source=snapshots[index*2+1];
      if(destination.exists()){const saved=destination.data();if(saved.branch!==branch||saved.name!==row.name)throw Error('An item ID belongs to a different stock record.');continue;}
      if(!source.exists()||source.data().branch!==row.sourceBranch)throw Error('A source item changed. Retry the branch item setup.');
      const payload=inventoryTemplatePayload({...source.data(),id:row.sourceId},branch);
      if(JSON.stringify(payload)!==JSON.stringify(row.payload))throw Error('Source item details changed. Retry to use the latest setup.');
      pending.push({id:row.id,payload});
     }
     guard();for(const row of pending)tx.set(api.doc(api.db,'inventory',row.id),{...row.payload,createdAt:api.serverTimestamp()});return pending.length;
    });
   }
   guard();await api.runTransaction(api.db,async tx=>{const saved=await tx.get(branchRef);guard();if(!saved.exists()||saved.data().name!==branch||!activeInventoryBranch(saved.data()))throw Error('The branch changed before setup finished.');tx.update(branchRef,{inventorySetupVersion:1,inventorySetupStatus:plan.issues.length?'Needs Review':'Ready',inventorySetupIssueCount:plan.issues.length,inventorySetupAt:api.serverTimestamp()});});guard();
   api.invalidateCache?.('inventory');return {branch,created,kept:plan.kept,ready:plan.issues.length===0,issues:plan.issues};
  })();flights.set(key,work);work.finally(()=>{if(flights.get(key)===work)flights.delete(key);}).catch(()=>{});return work;
 }
 return {ensure,directory};
}
export function branchSyncSummary(data,branch){
 const plan=planBranchInventorySetup({...data,branch});
 const hq=new Set(data.items.filter(row=>row.branch==='Main Office'&&activeInventoryTemplate(row)&&typeof row.name==='string'&&row.name.trim()).map(row=>row.name));
 const atBranch=new Set(data.items.filter(row=>row.branch===branch).map(row=>row.name));
 const listed=[...hq].filter(name=>atBranch.has(name)).sort((a,b)=>a.localeCompare(b));
 return {plan,listed,hqTotal:hq.size,hqMissing:plan.creates.filter(row=>hq.has(row.name)),otherMissing:plan.creates.filter(row=>!hq.has(row.name))};
}
function reviewItems(doc,summary){
 const box=doc.createElement('div');box.style.textAlign='left';
 const intro=doc.createElement('p');intro.textContent=summary.listed.length+' of '+summary.hqTotal+' Main Office item names already listed at this branch. New items start at zero stock.';box.append(intro);
 function group(label,lines){
  const section=doc.createElement('details'),heading=doc.createElement('summary');heading.textContent=label+' ('+lines.length+')';section.append(heading);
  if(lines.length){const list=doc.createElement('ul');for(const line of lines){const item=doc.createElement('li');item.textContent=line;list.append(item);}section.append(list);}
  box.append(section);
 }
 group('Main Office items ready to add',summary.hqMissing.map(row=>row.name));
 group('Other store items ready to add',summary.otherMissing.map(row=>row.name));
 group('Main Office items already listed',summary.listed);
 group('Needs review',summary.plan.issues.map(row=>row.name+' — '+row.message));
 return box;
}
export function installBranchInventorySetup(api){
 const service=api.branchInventorySetup ||= createBranchInventorySetup(api);
 api.ensureBranchInventory=(branch,options)=>service.ensure(branch,options);
 let previewBusy=false;
 api.reviewBranchItemSync=async()=>{
  if(previewBusy)return;
  previewBusy=true;
  try{
   const actor=branchInventoryActor(api),user=api.auth.currentUser,session=api.sessionUser;
   const guard=()=>{if(api.auth.currentUser!==user||api.sessionUser!==session||branchInventoryActor(api)!==actor)throw Error('Your HQ session changed. Reopen Branch item sync.');};
   api.Swal.fire({titleText:'Checking the stock catalog',allowOutsideClick:false,didOpen:()=>api.Swal.showLoading()});
   const data=await service.directory(guard);
   const choices=data.branches.filter(row=>activeInventoryBranch(row)&&row.name!=='Main Office'&&api.isBranchAllowed(row.name)).map(row=>row.name).sort((a,b)=>a.localeCompare(b));
   if(!choices.length)throw Error('No active store branches are available to review.');
   let branch=api.document.getElementById('invBranchFilter')?.value;
   if(!choices.includes(branch)){
    const picked=await api.Swal.fire({titleText:'Branch item sync',input:'select',inputPlaceholder:'Choose a store branch',inputOptions:new Map(choices.map(name=>[name,name])),showCancelButton:true,confirmButtonText:'Review items',inputValidator:value=>choices.includes(value)?undefined:'Choose a store branch.'});
    if(!picked.isConfirmed)return;
    branch=picked.value;
   }
   guard();branchInventoryActor(api,branch);
   const summary=branchSyncSummary(data,branch),count=summary.plan.creates.length;
   const decision=await api.Swal.fire({titleText:'Item sync · '+branch,html:reviewItems(api.document,summary),showCancelButton:true,cancelButtonText:'Close',showConfirmButton:count>0,confirmButtonText:'Add '+count+' missing item'+(count===1?'':'s'),focusCancel:true});
   if(!decision.isConfirmed||!count)return;
   guard();
   api.Swal.fire({titleText:'Adding missing items to '+branch,allowOutsideClick:false,didOpen:()=>api.Swal.showLoading()});
   const result=await service.ensure(branch,{assertCurrent:guard,reviewedCreates:summary.plan.creates});guard();
   await api.refreshInventoryStocks?.();guard();
   await api.Swal.fire({titleText:'Item sync · '+branch,text:result.created+' items added with zero stock. '+result.kept+' existing item names kept. '+result.issues.length+' need review.',icon:result.ready?'success':'warning'});
  }catch(error){await api.Swal.fire({titleText:'Branch item sync',text:error.message||'Reopen the preview and try again.',icon:'warning'});}
  finally{previewBusy=false;}
 };
 api.syncBranchInventory=async encoded=>{
  let branch;try{branch=decodeURIComponent(encoded);branchInventoryActor(api,branch);}catch(error){return api.ManagerUI?.notify?.(error.message);}
  api.Swal.fire({titleText:'Setting up branch stock items…',allowOutsideClick:false,didOpen:()=>api.Swal.showLoading()});
  try{const result=await service.ensure(branch);await api.Swal.fire({titleText:result.ready?'Stock items ready':'Some item setup needs review',text:branch+': '+result.created+' missing items added with zero stock. Existing items and quantities were kept.'+(result.issues.length?' '+result.issues.map(row=>row.name+': '+row.message).slice(0,5).join(' '):''),icon:result.ready?'success':'warning'});return result;}catch(error){await api.Swal.fire({titleText:'Item setup is not complete',text:error.message+' Retry Sync Stock Items; completed items and their quantities are kept.',icon:'warning'});return false;}
 };
 return service;
}
