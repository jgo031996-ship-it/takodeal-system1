import {installStockAudits} from './stock-audit-ui.js';
const all=value=>!value||/^(all|all branches|all permitted branches)$/i.test(value);
export function installOwnerStockAudits(w=window,d=document){
 const panel=d.getElementById('stockAuditReports'),select=d.getElementById('stockAuditBranch');if(!panel||!select)return null;
 const ui=installStockAudits(w,d),status=d.getElementById('stockAuditBranchStatus');let epoch=0;
 const permitted=branch=>typeof branch==='string'&&!all(branch)&&w.isBranchAllowed?.(branch)===true;
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.sessionUser]);
 async function load(){const generation=++epoch,user=w.auth?.currentUser,session=w.sessionUser,key=identity(),current=()=>generation===epoch&&w.auth?.currentUser===user&&w.sessionUser===session&&identity()===key;
  if(!user||!session){ui.dispose();panel.textContent='Unlock the workspace to view submitted counts.';return;}
  try{let names=[...new Set(['invBranchFilter','histBranchFilter'].flatMap(id=>Array.from(d.getElementById(id)?.options||[]).map(option=>option.value)).filter(permitted))];
   if(!names.length){const snap=await w.getDocsFromServer(w.query(w.collection(w.db,'branches'),w.limit(100)));if(!current())return;if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the branch directory.');names=snap.docs.map(doc=>doc.data().name||doc.id).filter(permitted);}
   if(!current())return;const previous=select.value,candidate=permitted(previous)?previous:d.getElementById('invBranchFilter')?.value;select.replaceChildren();const placeholder=d.createElement('option');placeholder.value='';placeholder.textContent='Choose a branch';select.append(placeholder);
   for(const name of [...new Set(names)].sort()){const option=d.createElement('option');option.value=name;option.textContent=name;select.append(option);}select.value=names.includes(candidate)?candidate:'';
   status.textContent='Choose a branch, then select Weekly or Monthly and the report dates.';ui.dispose();
   if(select.value)await ui.load({branch:select.value});else panel.textContent='Choose one branch to review its physical stock reports.';
  }catch(error){if(current()){ui.dispose();status.textContent=error.message;panel.textContent='No audit was calculated. Retry after confirming the branch.';}}
 }
 select.onchange=()=>{epoch++;ui.dispose();if(select.value)void ui.load({branch:select.value});else panel.textContent='Choose one branch to review its physical stock reports.';};
 w.loadInventoryAudits=load;return {load,dispose(){epoch++;ui.dispose();select.replaceChildren();panel.replaceChildren();}};
}
