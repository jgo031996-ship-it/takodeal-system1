// A prepared-item BOM is defined per purchase unit by the existing batch engine.
// This derives a supply quote without changing inventory valuation or stock.
export function franchiseCostedItem(item,inventory=[],recipes=[]){
 const dependencies=new Map(),recipeDependencies=new Map(),path=new Set();
 function cost(target,fromRecipe=false){
  if(path.has(target.id||target.name))throw Error('The prepared recipe contains a circular ingredient. Ask HQ to review its BOM.');
  dependencies.set(target.id,target);const parts=recipes.filter(row=>row.menuItem===target.name);
  if(!(target.franchiseCostBasis==='bom'||fromRecipe&&parts.length)){
   if(target.baseCost==null||typeof target.baseCost==='boolean'||String(target.baseCost).trim()===''||!Number.isFinite(Number(target.baseCost))||Number(target.baseCost)<0)throw Error('A current ingredient cost is missing for '+target.name+'.');return Number(target.baseCost);
  }
  if(!parts.length)throw Error('No saved BOM was found for '+target.name+'.');
  const conversion=Number(target.conversionRate??target.conversion??target.convRate??1);if(!Number.isFinite(conversion)||conversion<=0)throw Error('Record a valid prepared-item conversion.');
  path.add(target.id||target.name);let total=0;
  for(const row of parts){recipeDependencies.set(row.id,row);const matches=inventory.filter(i=>i.branch==='Main Office'&&i.name===row.ingredientName),qty=Number(row.qty);if(matches.length!==1||row.qty==null||typeof row.qty==='boolean'||!Number.isFinite(qty)||qty<=0)throw Error('A BOM ingredient is missing, duplicated or has an invalid quantity: '+row.ingredientName+'.');total+=qty*cost(matches[0],true);}
  path.delete(target.id||target.name);return total/conversion;
 }
 const baseCost=cost(item);return {item:{...item,baseCost},inventoryDependencies:[...dependencies.values()],recipeDependencies:[...recipeDependencies.values()],costBasis:item.franchiseCostBasis==='bom'?'current HQ ingredient costs × saved BOM quantities per purchase unit':'current recorded base-unit cost; overhead may be excluded'};
}
