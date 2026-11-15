import {inventoryItemIdentity,inventoryItemEditDraft} from './inventory-item-edit-model.js';
const text=value=>typeof value==='string'?value.trim():'';
const inactive=row=>row?.active===false||row?.deleted===true||row?.archived===true||row?.blocked===true||/^(inactive|disabled|archived|deleted|blocked)$/i.test(text(row?.status));
export const activeInventoryTemplate=row=>!!row&&!inactive(row);
export const activeInventoryBranch=row=>!!text(row?.name)&&!inactive(row);
export async function branchInventoryId(branch,name){
 if(!text(branch)||!text(name))throw Error('Choose an exact branch and item name.');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([branch,name])));
 return 'branch-stock-'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
export function inventoryTemplatePayload(row,branch){
 const identity=inventoryItemIdentity(row),draft=inventoryItemEditDraft(row);
 if(!identity||!activeInventoryTemplate(row)||!text(row.name)||row.name!==text(row.name)||!text(row.category))throw Error('The saved name, category or purchase/base units need review.');
 if(typeof draft.purchaseCost!=='number'||!Number.isFinite(draft.purchaseCost)||draft.purchaseCost<0||draft.purchaseCost>1e12)throw Error('The saved purchase cost needs review.');
 const rate=draft.conversionRate;
 if(rate>1e9)throw Error('The saved purchase conversion needs review.');
 if(row.lowStockAlert!=null&&row.reorderLevel!=null&&Number(row.lowStockAlert)!==Number(row.reorderLevel))throw Error('The saved low-stock alert values disagree.');
 const payload={branch,name:row.name,category:row.category,purchaseUom:draft.purchaseUom,purchUom:draft.purchaseUom,baseUom:draft.baseUom,uom:draft.baseUom,conversionRate:rate,conversion:rate,
  purchaseCost:draft.purchaseCost,cost:draft.purchaseCost,baseCost:draft.purchaseCost/rate,currentStock:0,
  showInPrep:row.showInPrep!==false,showToCashier:row.showToCashier!==false,allowRequest:row.allowRequest!==false,
  catalogSetupVersion:1,catalogSourceId:row.id,catalogSourceBranch:row.branch};
 for(const field of ['maintainingStock','lowStockAlert','reorderLevel'])if(row[field]!=null){const value=Number(row[field]);if(!Number.isFinite(value)||value<0||value>1e12)throw Error('The saved stock target or low-stock alert needs review.');payload[field]=value;}
 if(row.restockCycle!=null){if(!text(row.restockCycle)||text(row.restockCycle).length>40)throw Error('The saved restock cycle needs review.');payload.restockCycle=row.restockCycle;}
 if(text(row.image))payload.image=row.image;
 return payload;
}
// Copy item setup only. Balances, counts, ledger entries and branch-specific
// restrictions never become templates. Existing destination rows always win.
export function planBranchInventorySetup({branch,branches,items}){
 if(!Array.isArray(branches)||!Array.isArray(items)||items.length>5000)throw Error('The branch item directory is unavailable or too large.');
 const registered=branches.filter(activeInventoryBranch),matches=registered.filter(row=>row.name===branch);
 if(matches.length!==1||branch==='Main Office')throw Error('Choose one saved, active store branch.');
 const allowed=new Set(registered.map(row=>row.name)),existing=new Map(),groups=new Map(),issues=[];
 for(const row of items){
  if(!row||!text(row.name))continue;
  if(row.branch===branch){const list=existing.get(row.name)||[];list.push(row);existing.set(row.name,list);continue;}
  if(!allowed.has(row.branch)||!activeInventoryTemplate(row))continue;
  const list=groups.get(row.name)||[];list.push(row);groups.set(row.name,list);
 }
 const creates=[];
 for(const [name,all]of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  if(existing.has(name)){if(existing.get(name).length>1)issues.push({name,message:'Duplicate items already exist in this branch. Review them in Live Stocks.'});continue;}
  const stores=all.filter(row=>row.branch!=='Main Office'),choices=stores.length?stores:all;
  choices.sort((a,b)=>(a.branch==='Cabantian'?0:1)-(b.branch==='Cabantian'?0:1)||a.branch.localeCompare(b.branch)||String(a.id).localeCompare(String(b.id)));
  try{
   const identity=inventoryItemIdentity(choices[0]);
   if(!identity||choices.some(row=>inventoryItemIdentity(row)!==identity||text(row.category).toLowerCase()!==text(choices[0].category).toLowerCase()))throw Error('Existing stores use conflicting units or categories for this item. Review the item setup first.');
   creates.push({sourceId:choices[0].id,sourceBranch:choices[0].branch,name,payload:inventoryTemplatePayload(choices[0],branch)});
  }catch(error){issues.push({name,message:error.message});}
 }
 return {branchId:matches[0].id,branch,creates,kept:existing.size,issues};
}
