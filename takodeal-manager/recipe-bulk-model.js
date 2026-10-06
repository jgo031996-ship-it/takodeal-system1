import { recipePlan, recipeFingerprint } from './recipe-changes.js';
import { recipeProblems } from './recipe-integrity.js';
export const recipeRows = (state,table) => Object.entries(state.documents[table] || {}).map(([id,data])=>({...data,id}));
const unit = row => String(row.baseUom || row.uom || '').trim().toLowerCase();
const canonicalUnit = value => ({g:'gram',grams:'gram',kg:'kilogram',kgs:'kilogram',ml:'milliliter',milliliters:'milliliter',l:'liter',liters:'liter',pcs:'piece',pieces:'piece',pc:'piece'}[value] || value);
function ingredient(state,name,{optional=false}={}) {
    const rows=recipeRows(state,'inventory').filter(row=>row.name===name);
    if(!rows.length){if(optional)return null;throw Error('Stock ingredient does not exist: '+name);}
    const branches=new Set();for(const row of rows){if(!row.branch || branches.has(row.branch))throw Error('Duplicate or unassigned stock ingredient: '+name);branches.add(row.branch);}
    const units=[...new Set(rows.map(row=>canonicalUnit(unit(row))))];
    if(units.length!==1 || !units[0])throw Error('Branches have missing or conflicting base units for '+name+'. Correct those stock units first.');
    return {rows,unit:units[0],label:rows[0].baseUom || rows[0].uom};
}
const displayUnit=(state,name)=>[...new Set(recipeRows(state,'inventory').filter(row=>row.name===name).map(row=>row.baseUom || row.uom).filter(Boolean))].join(' / ') || 'unit not configured';
export function replacementPlan(state,{selectedIds,sourceName,targetName,quantities={}}) {
    if(!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size!==selectedIds.length)throw Error('Select unique menu items to update.');
    if(!sourceName || !targetName || sourceName===targetName)throw Error('Choose different source and replacement ingredients.');
    const from=ingredient(state,sourceName,{optional:true}),to=ingredient(state,targetName);
    if(!from && !recipeRows(state,'bom').some(row=>row.ingredientName===sourceName))throw Error('Source ingredient does not exist in stock or recipes: '+sourceName);
    if(from && from.unit!==to.unit)throw Error('Ingredient base units differ ('+from.label+' → '+to.label+'). Convert and review quantities in each product editor first.');
    const missing=(from?.rows || []).filter(row=>!to.rows.some(target=>target.branch===row.branch)).map(row=>row.branch);
    if(missing.length)throw Error('Replacement stock is missing in '+missing.join(', ')+'. Add the matching branch stock records before replacing this ingredient.');
    const menu=recipeRows(state,'menu'),bom=recipeRows(state,'bom'),writes=[],affected=[],warnings=[];
    for(const id of selectedIds){
        const product=menu.find(row=>row.id===id);
        if(!product || menu.filter(row=>row.name===product.name).length!==1)throw Error('Select an existing product with a unique name.');
        const recipe=bom.filter(row=>row.menuItem===product.name),sources=recipe.filter(row=>row.ingredientName===sourceName);
        if(sources.length!==1)throw Error(product.name+': source ingredient is missing or duplicated.');
        if(recipe.some(row=>row.ingredientName===targetName))throw Error(product.name+': the replacement ingredient is already present. Merge it explicitly in the product editor first.');
        if(!from && !Object.hasOwn(quantities,id))throw Error(product.name+': the old ingredient has no verified base unit. Enter an explicit replacement quantity in '+to.label+'.');
        const quantity=Object.hasOwn(quantities,id)?Number(quantities[id]):Number(sources[0].qty);
        if(!Number.isFinite(quantity) || quantity<=0 || String(quantities[id] ?? sources[0].qty).trim()==='')throw Error(product.name+': enter a positive replacement quantity.');
        const after=recipe.map(row=>row.id===sources[0].id?{...row,ingredientName:targetName,qty:quantity}:row);
        const problems=recipeProblems(after.filter(row=>row.id!==sources[0].id),new Set(recipeRows(state,'inventory').map(row=>row.name)));warnings.push(...problems.map(problem=>product.name+': '+problem));
        writes.push({table:'bom',id:sources[0].id,mode:'update',data:{ingredientName:targetName,qty:quantity}});
        affected.push({id,name:product.name,category:product.category,before:recipe.map(row=>({...row,unit:displayUnit(state,row.ingredientName)})),
            after:after.map(row=>({...row,unit:displayUnit(state,row.ingredientName)})),beforeQty:Number(sources[0].qty),afterQty:quantity,sourceUnit:from?.label || 'unit unavailable',targetUnit:to.label});
    }
    const plan=recipePlan(state,writes,{label:'Bulk ingredient replacement',intent:{selectedIds,sourceName,targetName,quantities:affected.map(row=>[row.id,row.afterQty])}});
    for(const product of affected)for(const row of product.before)if(!plan.expected.some(old=>old.table==='bom' && old.id===row.id))plan.expected.push({table:'bom',id:row.id,exists:true,data:state.documents.bom[row.id]});
    for(const row of selectedIds)plan.expected.push({table:'menu',id:row,exists:true,data:state.documents.menu[row]});
    for(const row of [...(from?.rows || []),...to.rows])plan.expected.push({table:'inventory',id:row.id,exists:true,data:state.documents.inventory[row.id],fields:['name','branch','uom','baseUom']});
    plan.affected=affected;plan.sourceName=sourceName;plan.targetName=targetName;
    plan.warnings=[...new Set(warnings)];plan.requiresUnitReview=!from;plan.targetBranches=to.rows.map(row=>row.branch).sort();
    plan.previewFingerprint=recipeFingerprint(affected);
    return plan;
}
