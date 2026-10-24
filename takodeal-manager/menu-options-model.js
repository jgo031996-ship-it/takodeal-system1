import {recipeFingerprint} from './recipe-changes.js';

const string=value=>String(value??'').trim();
const nameKey=value=>string(value).normalize('NFKC').toLocaleLowerCase();
const records=(state,table)=>state?.documents?.[table]||{};
const savedRecord=(state,table,id)=>Object.hasOwn(records(state,table),id)?records(state,table)[id]:null;
const categoryValues=value=>Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
export function menuOptionId(value,label='Saved item ID'){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(value))throw Error(label+' is missing or invalid. Reopen the item.');
 return value;
}
function label(value,title,max=160){
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error(title+' is required (up to '+max+' characters).');
 return value.trim();
}
function numeric(value,title,{optional=false,money=false}={}){
 if(optional&&(value===null||value===undefined||value===''))return null;
 if(!['string','number'].includes(typeof value)||string(value)===''||typeof value==='string'&&!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1e10)throw Error(title+' must be a finite, non-negative number.');
 const result=Number(value);
 if(money&&(Math.abs(result*100-Math.round(result*100))>1e-6||!Number.isSafeInteger(Math.round(result*100))))throw Error(title+' must use at most two decimal places.');
 return money?Math.round(result*100)/100:result;
}
export function activeMenuProduct(product){return Boolean(product&&product.archived!==true&&product.isArchived!==true&&product.active!==false&&!/^(archived|deleted|inactive)$/i.test(string(product.status)));}
export function addonAppliesToProduct(addon,product){
 const categories=categoryValues(addon?.category||'All');
 return activeMenuProduct(product)&&(categories.some(value=>string(value)==='All')||categories.some(value=>nameKey(value)===nameKey(product.category)));
}
function menuCategories(value,state,{allowDisabled=false}={}){
 const known=new Set(Object.values(records(state,'menu')).map(row=>string(row.category)).filter(Boolean));
 const category=[...new Set(categoryValues(value).map(entry=>label(entry,'Menu category',120)))];
 if(!category.length&&!allowDisabled||category.includes('All')&&category.length!==1||category.some(entry=>entry!=='All'&&!known.has(entry)))throw Error('Choose All menu categories or one or more existing categories.');
 return category;
}
function verifyHQIngredient(name,state){
 const matching=Object.entries(records(state,'inventory')).filter(([,row])=>row.branch==='Main Office'&&row.name===name);
 if(matching.length!==1)throw Error('The linked HQ ingredient is missing or duplicated. Review its saved inventory name.');
 if(!string(matching[0][1].baseUom||matching[0][1].uom))throw Error('The linked ingredient needs a saved base unit before a deduction quantity can be set.');
}
function definition(row,{legacy=false}={}){
 const name=label(row?.name,'Add-on name',120),price=numeric(legacy?(row.price??0):row.price,'Extra price',{money:true});
 const linkedIngredient=string(legacy?(row.linkedIngredient??row.ingredient??''):row.linkedIngredient),deductQty=numeric(legacy?(row.deductQty??row.qty??0):(row.deductQty??0),'Quantity deducted');
 if(linkedIngredient.length>160||/[\u0000-\u001f\u007f]/.test(linkedIngredient))throw Error('Choose a valid linked ingredient.');
 if(linkedIngredient&&deductQty<=0||!linkedIngredient&&deductQty!==0)throw Error('A linked ingredient needs a positive deduction quantity. Use zero when no ingredient is linked.');
 return {name,price,linkedIngredient,deductQty};
}
export function normalizeGlobalAddon(input,state,{id=''}={}){
 const result=definition(input),category=menuCategories(input?.category,state);
 if(Object.entries(records(state,'global_addons')).some(([other,row])=>other!==id&&nameKey(row.name)===nameKey(result.name)))throw Error('Another global add-on already uses this name. Choose a unique name.');
 if(result.linkedIngredient)verifyHQIngredient(result.linkedIngredient,state);
 return {...result,category};
}
export function normalizeGlobalMixMatch(input,state){
 if(!Array.isArray(input?.categories)&&typeof input?.categories!=='string')throw Error('Choose menu categories or explicitly disable Global Mix & Match.');
 const categories=menuCategories(input.categories,state,{allowDisabled:true});
 if(!Array.isArray(input.flavors)||input.flavors.length>30||categories.length&&input.flavors.length===0)throw Error('Choose 1–30 flavors for enabled Global Mix & Match.');
 const seen=new Map(),flavors=input.flavors.map(value=>{const flavor=label(value,'Flavor name',120),key=nameKey(flavor);if(seen.has(key))throw Error('Each global flavor needs a unique name: '+flavor);seen.set(key,flavor);return flavor;});
 if(!Array.isArray(input.mappings)||input.mappings.length>flavors.length)throw Error('Each stock mapping must identify one saved flavor.');
 const mapped=new Set(),mappings=input.mappings.map(row=>{
  const flavor=seen.get(nameKey(row?.flavor));if(!flavor||mapped.has(flavor))throw Error('Each stock mapping must identify one unique saved flavor.');
  const linkedIngredient=label(row?.linkedIngredient,'Linked ingredient',160),deductQty=numeric(row?.deductQty,'Flavor quantity deducted');
  if(deductQty<=0)throw Error('A flavor stock mapping needs a positive deduction quantity.');
  verifyHQIngredient(linkedIngredient,state);mapped.add(flavor);return {flavor,linkedIngredient,deductQty};
 });
 return {categories,flavors,mappings};
}
export function addonDefinitions(addon){
 const source=[addon,...(Array.isArray(addon?.legacyDefinitions)?addon.legacyDefinitions:[])],seen=new Set(),result=[];
 for(const row of source){try{const entry=definition(row,{legacy:true}),key=recipeFingerprint(entry);if(!seen.has(key)){seen.add(key);result.push(entry);}}catch{}}
 return result;
}
function namesOf(addon){return new Set([addon?.name,...addonDefinitions(addon).map(row=>row.name),...(Array.isArray(addon?.legacyNames)?addon.legacyNames:[])].map(nameKey).filter(Boolean));}
export function nextGlobalAddonRecord(before,after){
 const history=before?addonDefinitions(before):[];
 const legacyNames=[...new Set([...(before?.legacyNames||[]),...history.map(row=>row.name)].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
 if(legacyNames.length>100)throw Error('This add-on has too many historical names. Review the remaining legacy product links first.');
 return {...(before||{}),...after,optionVersion:1,legacyDefinitions:history.slice(0,20),legacyNames};
}
export function addonUsage(state,id){
 menuOptionId(id);const addon=savedRecord(state,'global_addons',id);if(!addon)throw Error('This global add-on no longer exists. Refresh the list.');
 const names=namesOf(addon),usage=[];
 for(const [productId,product]of Object.entries(records(state,'menu'))){
  if(!Array.isArray(product.addons))continue;
  const byId=product.addons.some(row=>row&&row.globalAddonId===id),byName=product.addons.some(row=>row&&!row.globalAddonId&&names.has(nameKey(row.name)));
  if(byId||byName)usage.push({id:productId,name:string(product.name)||'Unnamed product',category:string(product.category),matchedBy:byId?'global ID':'legacy name'});
 }
 return usage.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
function canonicalAddon(before,source,id){
 const result={...(before||{}),name:source.name,price:source.price,linkedIngredient:source.linkedIngredient,deductQty:source.deductQty,globalAddonId:id};
 // Legacy stock aliases must not survive as a fallback after a linked ingredient is removed.
 delete result.ingredient;delete result.qty;
 return result;
}
function selectedProducts(state,selection,source){
 const menu=records(state,'menu'),ids=selection?.productIds,categories=selection?.categories;
 if(ids!==undefined&&(!Array.isArray(ids)||new Set(ids).size!==ids.length))throw Error('Choose unique saved products.');
 let selected=Array.isArray(ids)?ids:[];
 if(!selected.length&&Array.isArray(categories)&&categories.length)selected=Object.keys(menu).filter(id=>addonAppliesToProduct({category:categories},menu[id]));
 if(selected.length>100)throw Error('Apply to at most 100 products per reviewed save.');
 return selected.map(id=>{menuOptionId(id,'Product ID');if(!Object.hasOwn(menu,id))throw Error('A selected product no longer exists. Reload the menu.');return {...menu[id],id};});
}
export function previewAddonApply(state,id,selection={}){
 menuOptionId(id);const raw=savedRecord(state,'global_addons',id);if(!raw)throw Error('This global add-on no longer exists. Refresh the list.');
 const addon=normalizeGlobalAddon(raw,state,{id}),names=namesOf(raw),definitions=addonDefinitions(raw),targets=[],changes=[],conflicts=[];
 const owners=new Map();
 for(const [globalId,entry]of Object.entries(records(state,'global_addons')))for(const name of namesOf(entry)){if(!owners.has(name))owners.set(name,new Set());owners.get(name).add(globalId);}
 for(const product of selectedProducts(state,selection,addon)){
  const summary={id:product.id,name:string(product.name)||'Unnamed product',category:string(product.category)};targets.push(summary);
  const conflict=reason=>conflicts.push({...summary,reason});
  if(!activeMenuProduct(product)){conflict('This product is archived or inactive.');continue;}
  if(product.addons!=null&&!Array.isArray(product.addons)){conflict('The saved product choices need review before they can be updated.');continue;}
  const before=structuredClone(product.addons||[]);
  if(before.some(row=>!row||typeof row!=='object'||Array.isArray(row))){conflict('The saved product has an invalid choice entry.');continue;}
  const bound=before.map((row,index)=>({row,index})).filter(({row})=>row.globalAddonId===id);
  const unbound=before.map((row,index)=>({row,index})).filter(({row})=>!row.globalAddonId&&names.has(nameKey(row.name)));
  const otherCollision=before.some(row=>row.globalAddonId&&row.globalAddonId!==id&&nameKey(row.name)===nameKey(addon.name));
  if(bound.length>1||bound.length&&unbound.length||unbound.length>1||otherCollision){conflict('Duplicate or differently linked choices share this name. Review the product first.');continue;}
  let index=-1,action='attach';
  if(bound.length){index=bound[0].index;action='update';}
  else if(unbound.length){
   const entry=unbound[0];let comparable=null;try{comparable=definition(entry.row,{legacy:true});}catch{}
   if((owners.get(nameKey(entry.row.name))?.size||0)!==1||!comparable||!definitions.some(old=>recipeFingerprint(old)===recipeFingerprint(comparable))){conflict('This unlinked choice has a product-specific price or ingredient setting. Review it before replacing it.');continue;}
   index=entry.index;action='adopt';
  }
  if(index<0&&before.length>=100){conflict('This product already has 100 choices. Review it before adding another.');continue;}
  const after=structuredClone(before),next=canonicalAddon(index<0?null:before[index],addon,id);
  if(index<0)after.push(next);else after[index]=next;
  if(recipeFingerprint(before)!==recipeFingerprint(after))changes.push({...summary,before,after,action});
 }
 return {addonId:id,addon,targets,changes,conflicts,canApply:changes.length>0&&conflicts.length===0};
}
export function normalizeBundleDraft(input,state){
 const name=label(input?.name,'Bundle name',120);
 if(!Array.isArray(input?.components)||input.components.length<1||input.components.length>20)throw Error('Choose 1–20 products for this draft bundle.');
 const seen=new Set(),menu=records(state,'menu'),components=input.components.map(row=>{
  const menuId=menuOptionId(row?.menuId,'Component product ID'),qty=numeric(row?.qty,'Component quantity');
  if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Each component quantity must be a whole number from 1 to 100.');
  if(seen.has(menuId))throw Error('A product is listed twice. Edit its existing quantity instead.');
  if(!Object.hasOwn(menu,menuId)||!activeMenuProduct(menu[menuId]))throw Error('A component product is missing, archived or inactive. Choose a current saved product.');
  seen.add(menuId);return {menuId,qty};
 });
 const notes=string(input.notes);if(notes.length>2000)throw Error('Keep bundle notes within 2,000 characters.');
 return {version:1,status:'draft',name,components,basePrice:numeric(input.basePrice,'Planned base price',{optional:true,money:true}),grabPrice:numeric(input.grabPrice,'Planned Grab price',{optional:true,money:true}),foodpandaPrice:numeric(input.foodpandaPrice,'Planned Foodpanda price',{optional:true,money:true}),notes};
}
export function bundleDraftRows(state){
 const saved=records(state,'settings').menu_bundle_drafts;if(!saved)return [];
 if(saved.version!==1||!Number.isSafeInteger(saved.revision)||saved.revision<0||!Array.isArray(saved.drafts)||saved.drafts.length>50)throw Error('The saved bundle drafts need Owner review before editing.');
 const ids=new Set();for(const row of saved.drafts){menuOptionId(row?.id,'Bundle draft ID');if(ids.has(row.id)||row.status!=='draft'||row.version!==1)throw Error('The saved bundle draft identity needs Owner review.');ids.add(row.id);}
 return saved.drafts.map(row=>structuredClone(row));
}
