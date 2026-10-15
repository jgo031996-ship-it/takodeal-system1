import {OWNER_EMAIL} from './workspace-access-model.js';
import {esc,amount,franchiseSupplyQuote} from './operations-model.js';
import {franchiseCostedItem} from './franchise-cost-model.js';
function owner(api){const user=api.auth?.currentUser;if(!user?.uid||user.emailVerified!==true||user.email?.toLowerCase()!==OWNER_EMAIL||api.sessionUser?.uid!==user.uid||api.sessionUser?.email?.toLowerCase()!==OWNER_EMAIL)throw Error('Only the signed-in Owner can set franchise supply markups.');return user.uid;}
export async function saveFranchiseMarkup(api,id,markupPercent,costBasis='recorded'){
 const uid=owner(api);if(typeof id!=='string'||!id||id.includes('/'))throw Error('Reopen an HQ inventory item.');
 if(!['recorded','bom'].includes(costBasis))throw Error('Choose a cost basis.');
 const inventory=costBasis==='bom'?(await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==','Main Office')))).docs.map(row=>({...row.data(),id:row.id})):[],recipes=costBasis==='bom'?(await api.getDocsFromServer(api.collection(api.db,'bom'))).docs.map(row=>({...row.data(),id:row.id})):[];
 const target=inventory.find(row=>row.id===id),context=costBasis==='bom'?franchiseCostedItem({...target,franchiseCostBasis:costBasis},inventory,recipes):{inventoryDependencies:[],recipeDependencies:[]};
 return api.runTransaction(api.db,async tx=>{const ref=api.doc(api.db,'inventory',id),snap=await tx.get(ref);if(!snap.exists()||snap.data().branch!=='Main Office')throw Error('Set the supply markup on the Main Office item.');const liveInventory=[],liveRecipes=[];for(const row of context.inventoryDependencies){const s=await tx.get(api.doc(api.db,'inventory',row.id));if(s.exists())liveInventory.push({...s.data(),id:row.id});}for(const row of context.recipeDependencies){const s=await tx.get(api.doc(api.db,'bom',row.id));if(s.exists())liveRecipes.push({...s.data(),id:row.id});}const costed=franchiseCostedItem({...snap.data(),id,franchiseCostBasis:costBasis},liveInventory,liveRecipes),quote=franchiseSupplyQuote(costed.item,{markupPercent,conversionRate:Number(snap.data().conversionRate??snap.data().conversion??1)});if(owner(api)!==uid)throw Error('The Owner account changed.');tx.update(ref,{franchiseMarkupPercent:quote.markupPercent,franchiseCostBasis:costBasis,franchisePricingVersion:1,franchisePricingUpdatedAt:api.serverTimestamp(),franchisePricingUpdatedBy:OWNER_EMAIL});return quote;});
}
// Showing the saved cost does not require choosing a markup for the Owner.
export function franchisePricingPreview(item,inventory,recipes,markupPercent,costBasis='recorded'){
 const priced=franchiseCostedItem({...item,franchiseCostBasis:costBasis},inventory,recipes).item;
 const conversionRate=Number(item.conversionRate??item.conversion??1);
 const cost=franchiseSupplyQuote(priced,{markupPercent:0,conversionRate});
 const hasMarkup=markupPercent!=null&&String(markupPercent).trim()!=='';
 return {cost:cost.unitCost,quote:hasMarkup?franchiseSupplyQuote(priced,{markupPercent,conversionRate}):null,
  scenarios:[10,15,20,25,30].map(rate=>franchiseSupplyQuote(priced,{markupPercent:rate,conversionRate}))};
}
export function installFranchiseSupplyPricing(w=window,d=document){
 const original=w.openEditInvModal;if(typeof original!=='function')return;let epoch=0;
 w.openEditInvModal=async function(id){
  const token=++epoch;d.getElementById('franchiseSupplyPricing')?.remove();await original.call(w,id);
  const active=()=>token===epoch&&d.getElementById('editInvId')?.value===id&&d.getElementById('editInvModal')?.style.display!=='none';
  if(!active())return;
  try{
   owner(w);const snap=await w.getDocFromServer(w.doc(w.db,'inventory',id));if(!active()||!snap.exists())return;
   const item={...snap.data(),id};
   // Branch stock editors have no supply-price controls to distract from their local settings.
   if(item.branch!=='Main Office')return;
   const [inventorySnap,recipeSnap]=await Promise.all([
    w.getDocsFromServer(w.query(w.collection(w.db,'inventory'),w.where('branch','==','Main Office'))),
    w.getDocsFromServer(w.collection(w.db,'bom'))
   ]);if(!active())return;
   const inventory=inventorySnap.docs.map(row=>({...row.data(),id:row.id})),recipes=recipeSnap.docs.map(row=>({...row.data(),id:row.id}));
   const unit=item.purchaseUom||item.purchUom||item.uom||'unit',section=d.createElement('details');
   section.id='franchiseSupplyPricing';section.className='inventory-editor-pricing inventory-editor-panel';
   section.innerHTML=`<summary><span>Supply price</span><small>Franchise pricing · Main Office</small></summary>
    <div class="inventory-editor-panel-body">
     <p class="inventory-editor-hint">Set the markup added to this item’s saved cost.</p>
     <div class="inventory-editor-grid">
      <label for="franchiseCostBasis">Calculate from<select id="franchiseCostBasis"><option value="recorded">Recorded item cost</option><option value="bom">Live recipe ingredient costs</option></select></label>
      <label for="franchiseMarkupPercent">Markup on cost (%)<input type="number" id="franchiseMarkupPercent" min="0" max="300" step="0.1" inputmode="decimal" value="${esc(item.franchiseMarkupPercent??'')}" placeholder="Choose your rate" aria-describedby="franchiseSupplyStatus"></label>
     </div>
     <div id="franchiseSupplyPreview" class="inventory-editor-price-preview" aria-live="polite">
      <div><span>Cost / ${esc(unit)}</span><strong id="franchiseSupplyCost">—</strong></div>
      <div><span>Supply price / ${esc(unit)}</span><strong id="franchiseSupplyPrice">—</strong></div>
      <small id="franchiseSupplyMargin"></small>
     </div>
     <p id="franchiseSupplyStatus" class="inventory-editor-hint" role="status"></p>
     <div class="inventory-editor-pricing-actions"><button type="button" id="saveFranchiseMarkup" class="operations-button">Save supply pricing</button><span class="inventory-editor-hint">Pricing only</span></div>
     <details class="inventory-editor-help"><summary>Pricing help &amp; examples</summary>
      <p>A 25% markup on a ₱100 cost gives a ₱125 supply price. Markup and profit margin are different.</p>
      <div id="franchiseMarkupScenarios"></div>
      <p>Recipe mode requires a saved recipe for exactly one purchase unit, such as one gallon or batch. Include labour, packaging and overhead in your costing where needed.</p>
      <p>Prices follow future cost changes. Existing requests keep their submitted quote. Save item-cost or unit changes before setting pricing here; this button saves only the cost basis and markup.</p>
     </details>
    </div>`;
   const basis=section.querySelector('#franchiseCostBasis'),input=section.querySelector('#franchiseMarkupPercent'),button=section.querySelector('#saveFranchiseMarkup'),status=section.querySelector('#franchiseSupplyStatus');
   basis.value=['recorded','bom'].includes(item.franchiseCostBasis)?item.franchiseCostBasis:'recorded';
   const statusMessage=(message,isError=false)=>{status.textContent=message;status.classList.toggle('inventory-editor-error',isError);status.setAttribute('role',isError?'alert':'status');};
   const showQuote=(quote)=>{section.querySelector('#franchiseSupplyCost').textContent=amount(quote.unitCost);section.querySelector('#franchiseSupplyPrice').textContent=amount(quote.unitPrice);section.querySelector('#franchiseSupplyMargin').textContent=quote.grossMarginPercent.toFixed(1)+'% gross margin before excluded costs';};
   const preview=()=>{
    input.removeAttribute('aria-invalid');section.querySelector('#franchiseSupplyCost').textContent='—';section.querySelector('#franchiseSupplyPrice').textContent='—';section.querySelector('#franchiseSupplyMargin').textContent='';
    try{
     const view=franchisePricingPreview(item,inventory,recipes,input.value,basis.value);
     section.querySelector('#franchiseSupplyCost').textContent=amount(view.cost);
     section.querySelector('#franchiseMarkupScenarios').innerHTML='<table><caption>Examples only · no rate is selected for you</caption><thead><tr><th>Markup</th><th>Supply price</th><th>Gross margin</th></tr></thead><tbody>'+view.scenarios.map(q=>'<tr><td>'+q.markupPercent+'%</td><td>'+amount(q.unitPrice)+'</td><td>'+q.grossMarginPercent.toFixed(1)+'%</td></tr>').join('')+'</tbody></table>';
     if(view.quote){showQuote(view.quote);statusMessage('Preview from saved costs.');}else statusMessage('Choose a markup to preview the supply price.');
    }catch(error){section.querySelector('#franchiseMarkupScenarios').textContent='Enter valid costs and a markup to compare prices.';if(input.value.trim()!==''&&(!Number.isFinite(Number(input.value))||Number(input.value)<0||Number(input.value)>300))input.setAttribute('aria-invalid','true');statusMessage(error.message,true);}
   };
   input.oninput=preview;basis.onchange=preview;preview();
   button.onclick=async()=>{
    button.disabled=true;input.disabled=true;basis.disabled=true;
    try{if(!active())throw Error('Reopen the item.');const quote=await saveFranchiseMarkup(w,id,input.value,basis.value);if(!active())return;item.franchiseMarkupPercent=quote.markupPercent;item.franchiseCostBasis=basis.value;showQuote(quote);input.removeAttribute('aria-invalid');statusMessage('Supply pricing saved. Existing request quotes stay unchanged.');}
    catch(error){if(active()){if(input.value.trim()==='')input.setAttribute('aria-invalid','true');statusMessage(error.message,true);input.focus();}}
    finally{button.disabled=false;input.disabled=false;basis.disabled=false;}
   };
   (d.getElementById('inventoryEditorPricingHost')||d.getElementById('editInvId').parentElement).append(section);
  }catch(error){if(active()&&w.sessionUser?.email?.toLowerCase()===OWNER_EMAIL)w.ManagerUI?.notify(error.message,{type:'error'});}
 };
}
