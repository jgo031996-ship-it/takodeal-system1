// Display calculations only. Menu selling prices, recipes and stock are never changed here.
export const STORE_SHARED_COST_BASIS = '@stores';
const text = value => typeof value === 'string' ? value.trim() : '';
const number = value => ['number','string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const close = (a,b) => Math.abs(a-b) <= Math.max(1e-10,Math.max(Math.abs(a),Math.abs(b))*1e-9);
const aliases = new Map([
 ['g','gram'],['gram','gram'],['grams','gram'],['kg','kilogram'],['kilo','kilogram'],['kilos','kilogram'],['kilogram','kilogram'],['kilograms','kilogram'],
 ['ml','milliliter'],['milliliter','milliliter'],['milliliters','milliliter'],['l','liter'],['liter','liter'],['liters','liter'],
 ['pc','piece'],['pcs','piece'],['piece','piece'],['pieces','piece'],['unit','unit'],['units','unit'],
]);
export const recipeCostUnit = value => {const key=text(value).toLowerCase();return aliases.get(key)||key;};
function consistentText(row,keys,label) {
 const values=keys.map(key=>text(row[key])).filter(Boolean);
 if(new Set(values.map(recipeCostUnit)).size>1)return {error:label+' fields disagree'};
 return {value:values[0]||''};
}
function inventoryCost(row) {
 const base=consistentText(row,['baseUom','uom'],'Base unit');
 if(base.error||!base.value)return {issue:base.error||'Base unit is not recorded'};
 const purchase=consistentText(row,['purchaseUom','purchUom'],'Purchase unit');
 if(purchase.error)return {issue:purchase.error};
 const conversionFields=['conversionRate','conversion'].filter(key=>row[key]!=null&&String(row[key]).trim()!=='');
 const conversion=conversionFields.map(key=>number(row[key]));
 if(conversion.some(value=>value===null||value<=0)||conversion.length>1&&!close(conversion[0],conversion[1]))return {issue:'Unit conversion needs review'};
 const baseCost=number(row.baseCost);
 if(baseCost===null||baseCost<0)return {issue:'Base-unit cost is not recorded or is invalid'};
 // Recorded baseCost is authoritative. A purchase price may legitimately differ
 // from a weighted/yield-adjusted base cost; it never replaces this saved value.
 return {cost:baseCost,uom:base.value,unit:recipeCostUnit(base.value)};
}

export function buildRecipeCostCatalog(rows,{basis=STORE_SHARED_COST_BASIS}={}) {
 if(!Array.isArray(rows))throw Error('Inventory costs must be a list of saved records.');
 const branches=[...new Set(rows.map(row=>text(row.branch)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const storeBranches=branches.filter(branch=>branch!=='Main Office');
 const selected=basis===STORE_SHARED_COST_BASIS?storeBranches:[text(basis)];
 const selectedSet=new Set(selected),groups=new Map(),costs=Object.create(null),issues=Object.create(null),names=new Set();
 for(const row of rows){const name=text(row.name),branch=text(row.branch);if(!name||!selectedSet.has(branch))continue;names.add(name);if(!groups.has(name))groups.set(name,[]);groups.get(name).push({...row,name,branch});}
 for(const [name,records]of groups){
  const byBranch=new Map();for(const row of records){if(!byBranch.has(row.branch))byBranch.set(row.branch,[]);byBranch.get(row.branch).push(row);}
  const duplicates=[...byBranch].filter(([,items])=>items.length!==1).map(([branch])=>branch);
  if(duplicates.length){issues[name]='Duplicate inventory records in '+duplicates.join(', ');continue;}
  const entries=records.map(row=>({row,...inventoryCost(row)})),invalid=entries.filter(entry=>entry.issue);
  if(invalid.length){issues[name]=invalid.map(entry=>entry.row.branch+': '+entry.issue).join('; ');continue;}
  const first=entries[0];
  if(entries.some(entry=>entry.unit!==first.unit)){issues[name]='Store base units differ. Choose a store and review its units.';continue;}
  if(entries.some(entry=>!close(entry.cost,first.cost))){issues[name]='Store costs differ. Choose a store to compare.';continue;}
  costs[name]={cost:first.cost,uom:first.uom,unit:first.unit,branches:records.map(row=>row.branch).sort(),sourceIds:records.map(row=>text(row.id)).filter(Boolean)};
 }
 return {basis,basisLabel:basis===STORE_SHARED_COST_BASIS?'Stores · shared cost':basis==='Main Office'?'Main Office · HQ':text(basis),branches,storeBranches,costs,issues,names:[...names].sort((a,b)=>a.localeCompare(b))};
}

export function summarizeRecipeCosts(recipe,catalog) {
 const seen=new Set(),problems=[],rows=[];
 for(const item of Array.isArray(recipe)?recipe:[]){
  const name=text(item.ingredientName),quantity=number(item.qty),cost=catalog?.costs?.[name];
  let issue=!name?'Choose an ingredient':catalog?.issues?.[name]||(!cost?'Ingredient is not recorded for this cost basis':'');
  if(quantity===null||quantity<=0)issue=issue||'Enter a quantity greater than zero';
  if(seen.has(name))issue=issue||'Duplicate recipe ingredient';seen.add(name);
  const explicitUnit=text(item.baseUom||item.uom||item.unit);
  if(cost&&explicitUnit&&recipeCostUnit(explicitUnit)!==cost.unit)issue=issue||'Recipe unit differs from the saved base unit';
  const lineCost=!issue?cost.cost*quantity:null;
  if(lineCost!==null&&!Number.isFinite(lineCost))issue='Recipe cost is too large to calculate';
  if(issue)problems.push((name||'(blank ingredient)')+': '+issue);
  rows.push({ingredientName:name,quantity,unit:cost?.uom||explicitUnit||'—',unitCost:cost?.cost??null,lineCost:issue?null:lineCost,issue});
 }
 if(!rows.length)problems.push('No recipe ingredients are recorded');
 const total=problems.length?null:rows.reduce((sum,row)=>sum+row.lineCost,0);
 if(total!==null&&!Number.isFinite(total))problems.push('Recipe cost is too large to calculate');
 return {valid:problems.length===0,total:problems.length?null:total,rows,problems:[...new Set(problems)]};
}
