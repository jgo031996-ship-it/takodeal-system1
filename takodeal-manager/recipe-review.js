import {canOpenWorkspacePage} from './workspace-access-model.js';

export function recipeReviewRows(menu,recipes,summary){
 return (Array.isArray(menu)?menu:[]).map(item=>{
  const checked=summary((Array.isArray(recipes)?recipes:[]).filter(row=>row.menuItem===item.name));
  const reasons=[...new Set((checked.problems||checked.issues||[]).filter(value=>typeof value==='string'&&value))];
  return {id:item.id,name:item.name||'Unnamed menu item',valid:checked.valid===true,reasons:reasons.length?reasons:['Refresh inventory costs to verify this recipe.'],kind:reasons.some(reason=>/Duplicate inventory|Store costs differ|base units differ|Base.unit|conversion|not recorded for this cost basis/i.test(reason))?'Stock / cost review':'Recipe review'};
 }).filter(item=>!item.valid);
}
export function installRecipeReviewUI(w=window,d=document){
 let dialog=null,identity=null;const original=w.renderMenuEditorUI;
 const authority=()=>{const user=w.auth?.currentUser,session=w.sessionUser;if(!user?.uid||!user.email||!session||session.isFranchisee||session.uid&&session.uid!==user.uid||session.email?.toLowerCase()!==user.email.toLowerCase()||!canOpenWorkspacePage(session,'menu'))throw Error('Unlock your approved menu account before reviewing recipes.');return {user,uid:user.uid,session,key:JSON.stringify([user.uid,user.email,session.permissions,session.allowedBranches,session.role])};};
 const same=(a,b)=>a&&b&&a.user===b.user&&a.session===b.session&&a.key===b.key;
 const current=actor=>{if(!same(actor,authority()))throw Error('The approved account or branch access changed. Reopen recipe review.');};
 const node=(tag,text)=>{const result=d.createElement(tag);if(text!==undefined)result.textContent=text;return result;};
 const rows=()=>recipeReviewRows(w.globalMenuItemsCache,w.menuRecipeRows,recipe=>w.recipeCostUI.recipeSummary(recipe));
 const close=()=>{dialog?.close?.();dialog?.remove?.();dialog=null;identity=null;};
 function mount(){
  const summary=d.getElementById('menuWorkspaceSummary');if(!summary)return;
  let button=d.getElementById('reviewRecipeWarnings');if(!button){button=node('button','Review recipe warnings');button.id='reviewRecipeWarnings';button.type='button';button.className='btn-refresh';button.addEventListener('click',()=>{try{open();}catch(error){w.ManagerUI?.notify?.(error.message,{type:'warning'});}});summary.after(button);}
  try{authority();const warnings=rows();button.textContent='Review recipe warnings · '+warnings.length;button.disabled=!warnings.length;}catch{button.disabled=true;close();}
 }
 function open(){
  close();identity=authority();const actor=identity,warnings=rows();dialog=node('dialog');dialog.className='recipe-review-dialog';dialog.setAttribute('aria-labelledby','recipeReviewTitle');
  const heading=node('h2','Review recipe warnings');heading.id='recipeReviewTitle';dialog.append(heading,node('p','These are the reasons in the current loaded menu and selected cost basis. Duplicate stock records, missing ingredients and different store costs need different decisions. No recipe or stock is changed here.'));
  const refresh=node('button','Refresh menu and costs');refresh.type='button';refresh.addEventListener('click',async()=>{refresh.disabled=true;try{current(actor);for(const table of ['menu','bom','inventory'])w.invalidateCache?.(table);await w.loadMenuEditor();current(actor);open();}catch(error){if(same(actor,identity)){close();w.ManagerUI?.notify?.(error.message,{type:'warning'});}}finally{refresh.disabled=false;}});dialog.append(refresh);
  for(const item of warnings){const card=node('article'),title=node('h3',item.name),kind=node('strong',item.kind),list=node('ul');for(const reason of item.reasons)list.append(node('li',reason));card.append(title,kind,list);
   card.append(node('p',item.kind==='Stock / cost review'?'Review the named stock records in Live Stocks, or choose one store in Cost basis to compare differing costs. Keep quantities and ingredient links unchanged until confirmed.':'Confirm the intended ingredient and its base-unit quantity before saving. The existing editor rechecks the current recipe revision.'));
   const edit=node('button','Review item & recipe');edit.type='button';edit.addEventListener('click',()=>{try{current(actor);if(!(w.globalMenuItemsCache||[]).some(row=>row.id===item.id&&row.name===item.name))throw Error('The menu item changed. Refresh recipe review.');close();void Promise.resolve(w.editMenuItem(item.id)).catch(error=>w.ManagerUI?.notify?.(error.message,{type:'warning'}));}catch(error){close();w.ManagerUI?.notify?.(error.message,{type:'warning'});}});card.append(edit);dialog.append(card);
  }
  if(!warnings.length)dialog.append(node('p','No warnings in the current loaded recipe and cost basis.'));
  const done=node('button','Close review');done.type='button';done.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.append(done);d.body.append(dialog);dialog.showModal();
 }
 w.renderMenuEditorUI=function(...args){const result=original?.apply(this,args);mount();return result;};
 const scopeTimer=w.setInterval?.(()=>{if(identity)try{current(identity);}catch{close();}},500);scopeTimer?.unref?.();
 const controller={refresh:mount,open,close,destroy(){close();w.clearInterval?.(scopeTimer);}};w.recipeReview=controller;w.addEventListener?.('pagehide',close);mount();return controller;
}
