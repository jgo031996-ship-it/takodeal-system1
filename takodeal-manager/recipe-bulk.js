import { loadRecipeState, saveRecipePlan } from './recipe-changes.js';
import { replacementPlan, recipeRows } from './recipe-bulk-model.js';
import { canOpenWorkspacePage } from './workspace-access-model.js';
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function recipeReplacementPreview(plan) {
    const recipe=row=>'<ul style="margin:0;padding-left:18px">'+row.map(item=>'<li>'+esc(item.ingredientName)+' · '+esc(item.qty)+' '+esc(item.unit)+'</li>').join('')+'</ul>';
    return '<p>'+plan.affected.length+' selected recipes · '+esc(plan.sourceName)+' → '+esc(plan.targetName)+'</p>'+
        '<p>Review every quantity below. Unselected products keep their recipes. Existing receipts and saved stock movements keep their original records.</p>'+
        '<p style="text-align:left">Quantities are the base recipe amounts per ordered item. The current Dine-In rule uses half the quantity for ingredient names containing “box”; other paper bowls and cups use the full quantity. Review the changed packaging name and amount for both order types.</p>'+
        '<p style="text-align:left">Replacement stock is configured in: '+esc((plan.targetBranches || []).join(', '))+'.'+(plan.requiresUnitReview?' The old ingredient no longer has stock records, so its previous branch coverage cannot be verified.':'')+'</p>'+
        '<div style="max-height:55vh;overflow:auto"><table style="width:100%;text-align:left;border-collapse:collapse"><thead><tr><th>Product</th><th>Current recipe</th><th>Updated recipe</th></tr></thead><tbody>'+
        plan.affected.map(row=>'<tr style="border-top:1px solid #dbe5dd"><td style="padding:14px"><strong>'+esc(row.name)+'</strong><small style="display:block">'+esc(row.category)+'</small></td><td style="padding:14px">'+recipe(row.before)+'</td><td style="padding:14px">'+recipe(row.after)+'</td></tr>').join('')+'</tbody></table></div>'+
        (plan.warnings?.length?'<div style="text-align:left;margin-top:16px;padding:12px;background:#fff5df"><strong>Unchanged recipe links still need inventory review</strong><ul>'+plan.warnings.map(warning=>'<li>'+esc(warning)+'</li>').join('')+'</ul><p>These links remain unchanged. Sales using them can still need stock review.</p></div>':'')+
        (plan.requiresUnitReview?'<label style="display:block;text-align:left;margin-top:16px"><input id="recipeConfirmUnknownUnits" type="checkbox"> I reviewed every new quantity in the replacement ingredient’s base unit. The old ingredient’s unit is unavailable.</label>':'');
}
export function installRecipeReplacement(api=window,d=document) {
    api.openRecipeReplacement=async()=>{
        if(!canOpenWorkspacePage(api.sessionUser,'menu'))throw Error('Your saved permissions do not allow recipe editing.');
        if(api.recipeReplacementBusy)return;api.recipeReplacementBusy=true;
        const dialog=api.Swal || globalThis.Swal;
        try{
            const state=await loadRecipeState(api),menu=recipeRows(state,'menu'),bom=recipeRows(state,'bom'),stockNames=[...new Set(recipeRows(state,'inventory').map(row=>row.name).filter(Boolean))].sort(),names=[...new Set([...stockNames,...bom.map(row=>row.ingredientName).filter(Boolean)])].sort(),selected=new Map();
            const options=values=>values.map(value=>'<option value="'+esc(value)+'">'+esc(value)+'</option>').join('');
            const result=await dialog.fire({title:'Replace recipe ingredient',width:960,showCancelButton:true,confirmButtonText:'Preview selected recipes',
                html:'<p style="text-align:left">Choose an ingredient, select the products to change, and review their replacement quantities in base units.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left">'+
                    '<label>Current ingredient<select id="recipeBulkSource" style="width:100%"><option value="">Choose ingredient</option>'+options(names)+'</select></label><label>Replacement ingredient<select id="recipeBulkTarget" style="width:100%"><option value="">Choose ingredient</option>'+options(stockNames)+'</select></label>'+
                    '<label>Search products<input id="recipeBulkSearch" type="search" style="width:100%" placeholder="Search name or pack size"></label><label>Category<select id="recipeBulkCategory" style="width:100%"><option value="">All categories</option>'+options([...new Set(menu.map(row=>row.category).filter(Boolean))].sort())+'</select></label></div>'+
                    '<p id="recipeBulkCount" style="text-align:left">0 selected</p><div id="recipeBulkItems" style="max-height:38vh;overflow:auto;text-align:left"></div>',
                didOpen:()=>{
                    const $=id=>d.getElementById(id),list=$('recipeBulkItems');
                    const draw=()=>{
                        const source=$('recipeBulkSource').value,query=$('recipeBulkSearch').value.trim().toLowerCase(),category=$('recipeBulkCategory').value;
                        const products=menu.filter(row=>(!category || row.category===category) && (!query || row.name?.toLowerCase().includes(query)) && bom.some(recipe=>recipe.menuItem===row.name && recipe.ingredientName===source));
                        list.innerHTML=products.map(row=>{const qty=selected.get(row.id) ?? (stockNames.includes(source)?bom.find(recipe=>recipe.menuItem===row.name && recipe.ingredientName===source).qty:'');
                            return '<div style="display:grid;grid-template-columns:1fr 130px;gap:12px;padding:12px;border-top:1px solid #dbe5dd"><label><input type="checkbox" data-recipe-select="'+esc(row.id)+'" '+(selected.has(row.id)?'checked':'')+'> '+esc(row.name)+'<small style="display:block;margin-left:22px">'+esc(row.category)+'</small></label><label>Replacement quantity<input type="number" min="0.000001" step="any" data-recipe-qty="'+esc(row.id)+'" value="'+esc(qty)+'" style="width:100%"></label></div>';}).join('') || '<p>Select a current ingredient or adjust your search to find matching recipes.</p>';
                        $('recipeBulkCount').textContent=selected.size+' selected';
                    };
                    list.addEventListener('change',event=>{const id=event.target.dataset.recipeSelect || event.target.dataset.recipeQty;if(!id)return;
                        const input=[...list.querySelectorAll('[data-recipe-qty]')].find(node=>node.dataset.recipeQty===id);
                        if(event.target.dataset.recipeSelect){if(event.target.checked)selected.set(id,input.value);else selected.delete(id);}else if(selected.has(id))selected.set(id,event.target.value);
                        $('recipeBulkCount').textContent=selected.size+' selected';
                    });
                    list.addEventListener('input',event=>{const id=event.target.dataset.recipeQty;if(id && selected.has(id))selected.set(id,event.target.value);});
                    $('recipeBulkSource').addEventListener('change',()=>{selected.clear();draw();});
                    for(const id of ['recipeBulkSearch','recipeBulkCategory'])$(id).addEventListener('input',draw);draw();
                },preConfirm:()=>{
                    try{
                        for(const input of d.getElementById('recipeBulkItems').querySelectorAll('[data-recipe-qty]'))if(selected.has(input.dataset.recipeQty))selected.set(input.dataset.recipeQty,input.value);
                        return replacementPlan(state,{selectedIds:[...selected.keys()],sourceName:d.getElementById('recipeBulkSource').value,targetName:d.getElementById('recipeBulkTarget').value,quantities:Object.fromEntries(selected)});
                    }
                    catch(error){dialog.showValidationMessage(error.message);return false;}
                }});
            if(!result.isConfirmed)return;
            const plan=result.value,operationId='recipe-'+crypto.randomUUID();
            const saved=await dialog.fire({title:'Review recipe replacement',html:recipeReplacementPreview(plan),width:1120,showCancelButton:true,confirmButtonText:'Save selected recipes',showLoaderOnConfirm:true,allowOutsideClick:()=>!dialog.isLoading(),
                preConfirm:async()=>{try{if(plan.requiresUnitReview && !d.getElementById('recipeConfirmUnknownUnits')?.checked)throw Error('Confirm that you reviewed the replacement quantities and their base units.');return await saveRecipePlan(api,plan,{operationId});}catch(error){dialog.showValidationMessage(error.message);return false;}}});
            if(saved.isConfirmed){api.invalidateCache('menu');api.invalidateCache('bom');await api.loadMenuEditor();api.ManagerUI?.notify?.(plan.affected.length+' recipes updated. New sales use the updated recipe after their recipe data connects.');}
        }catch(error){await dialog.fire({title:'Recipe replacement unavailable',text:error.message,icon:'warning'});}
        finally{api.recipeReplacementBusy=false;}
    };
}
