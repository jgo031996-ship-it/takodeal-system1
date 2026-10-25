// Category templates are reviewed plans only. They never create sellable products.
export const CATEGORY_BUNDLE_LIMITS=Object.freeze({slots:20,productsPerSlot:250,uniqueProducts:300});
const channels=['base','grab','foodpanda'];
const menuOf=state=>state?.documents?.menu||{};
const own=(object,key)=>Object.hasOwn(object,key);
const text=value=>String(value??'').trim();
const internalCategory=value=>['prepbatch','consumables','extras','takeoutpackaging'].includes(text(value).normalize('NFKC').toLowerCase().replace(/\s+/g,''));
const available=product=>Boolean(product&&typeof product.name==='string'&&product.name.trim()&&typeof product.category==='string'&&product.category.trim()&&!internalCategory(product.category)&&product.archived!==true&&product.isArchived!==true&&product.active!==false&&product.isActive!==false&&product.enabled!==false&&product.disabled!==true&&!/^(archived|deleted|inactive|disabled)$/i.test(text(product.status)));
function label(value,title,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error(title+' is required (up to '+max+' characters).');return value.trim();}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(value))throw Error('Choose a valid saved product ID.');return value;}
function number(value,title){if(!['number','string'].includes(typeof value)||text(value)===''||typeof value==='string'&&!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<0)throw Error(title+' must be a finite, non-negative number.');return Number(value);}
export function eligibleBundleProducts(state,category){
 const selected=text(category);
 return Object.entries(menuOf(state)).filter(([,product])=>available(product)&&text(product.category)===selected).map(([savedId,product])=>({...product,id:savedId})).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export function bundleCategoryNames(state){return [...new Set(Object.values(menuOf(state)).filter(available).map(product=>text(product.category)))].sort((a,b)=>a.localeCompare(b));}
function template(input,state,review){
 const name=label(input?.name,'Bundle name',120);
 if(!Array.isArray(input.slots)||input.slots.length<1||input.slots.length>CATEGORY_BUNDLE_LIMITS.slots)throw Error('Choose 1–20 category slots for this bundle plan.');
 const unique=new Set(),slots=input.slots.map((slot,index)=>{
  const category=label(slot?.category,'Slot '+(index+1)+' category',120);if(internalCategory(category))throw Error('Choose a sellable category; internal supplies cannot be bundled.');
  const qty=number(slot.qty,'Slot quantity');if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Each slot quantity must be a whole number from 1 to 100.');
  let menuIds=slot.menuIds;if(menuIds===undefined&&review)menuIds=eligibleBundleProducts(state,category).map(product=>product.id);
  if(!Array.isArray(menuIds)||menuIds.length<1||menuIds.length>CATEGORY_BUNDLE_LIMITS.productsPerSlot||new Set(menuIds).size!==menuIds.length)throw Error('Each category slot needs 1–250 unique reviewed products.');
  menuIds=menuIds.map(savedId=>{
   id(savedId);unique.add(savedId);
   if(review){const product=own(menuOf(state),savedId)?menuOf(state)[savedId]:null;if(!available(product)||text(product.category)!==category)throw Error('A reviewed product is missing, inactive or outside its selected category. Refresh the category choices.');}
   return savedId;
  });
  return {category,qty,menuIds};
 });
 if(unique.size>CATEGORY_BUNDLE_LIMITS.uniqueProducts)throw Error('Review at most 300 different products in one category template.');
 const discountPercent=input.discountPercent===undefined||input.discountPercent===''?0:number(input.discountPercent,'Bundle discount');if(discountPercent>100)throw Error('The bundle discount must be between 0 and 100 percent.');
 const notes=text(input.notes);if(notes.length>2000)throw Error('Keep bundle notes within 2,000 characters.');
 return {version:2,status:'draft',name,slots,discountPercent,notes};
}
export function normalizeCategoryBundleDraft(input,state){return template(input,state,true);}
// Validate saved structure without requiring old reviewed products to still exist.
export function validateCategoryBundleShape(input){template(input,null,false);return true;}
function price(product,channel){
 const field=channel==='base'?'price':channel==='grab'?'grabPrice':'foodpandaPrice',value=channel==='base'?(product.price??product.basePrice):product[field];
 try{const amount=number(value,field),[numerator,denominator]=exactFraction(typeof value==='string'?value.trim():amount),scaled=numerator*100n;if(scaled%denominator!==0n||scaled/denominator>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid cent amount');return {cents:Number(scaled/denominator),reason:null};}
 catch{return {cents:null,reason:product.name+' needs a valid saved '+(channel==='base'?'Base':channel==='grab'?'Grab':'Foodpanda')+' price (at most two decimal places).'};}
}
function reviewedProduct(state,slot,savedId){
 const product=own(menuOf(state),savedId)?menuOf(state)[savedId]:null;
 if(!available(product)||text(product.category)!==slot.category)return {product:null,reason:'A reviewed product ('+savedId+') is missing, inactive or outside '+slot.category+'. Review the saved choices.'};
 return {product:{...product,id:savedId},reason:null};
}
function exactFraction(value){
 const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),parts=mantissa.split('.'),digits=parts.join(''),scale=(parts[1]?.length||0)-Number(exponent);
 return scale>=0?[BigInt(digits),10n**BigInt(scale)]:[BigInt(digits)*10n**BigInt(-scale),1n];
}
function discounted(cents,percent){
 const [numerator,denominator]=exactFraction(percent),divisor=100n*denominator,result=BigInt(cents)*(divisor-numerator);
 // Integer cents are summed first. Round the entire discounted channel once.
 return Number((result*2n+divisor)/(divisor*2n));
}
const uniqueReasons=reasons=>[...new Set(reasons)];
function safeSum(amounts){const total=amounts.reduce((sum,value)=>sum+value,0);return Number.isSafeInteger(total)?total:null;}
export function categoryBundleSummary(input,state){
 const draft=template(input,state,false),slotSummaries=draft.slots.map(slot=>{
  const products=slot.menuIds.map(savedId=>reviewedProduct(state,slot,savedId)),channelValues=Object.fromEntries(channels.map(channel=>{
   const reasons=[],amounts=[];for(const {product,reason}of products){if(reason){reasons.push(reason);continue;}const value=price(product,channel);if(value.reason)reasons.push(value.reason);else if(!Number.isSafeInteger(value.cents*slot.qty))reasons.push('This slot total is too large to calculate safely.');else amounts.push(value.cents*slot.qty);}
   const complete=reasons.length===0,minCents=complete?Math.min(...amounts):null,maxCents=complete?Math.max(...amounts):null;return [channel,{complete,min:complete?minCents/100:null,max:complete?maxCents/100:null,minCents,maxCents,reasons:uniqueReasons(reasons)}];
  }));
  return {category:slot.category,qty:slot.qty,productCount:slot.menuIds.length,channels:channelValues};
 });
 const totals=Object.fromEntries(channels.map(channel=>{
  const reasons=slotSummaries.flatMap(slot=>slot.channels[channel].reasons),mins=slotSummaries.map(slot=>slot.channels[channel].minCents??0),maxs=slotSummaries.map(slot=>slot.channels[channel].maxCents??0),low=safeSum(mins),high=safeSum(maxs);
  if(low===null||high===null)reasons.push('This bundle total is too large to calculate safely.');const complete=reasons.length===0;
  return [channel,{complete,subtotalMin:complete?low/100:null,subtotalMax:complete?high/100:null,min:complete?discounted(low,draft.discountPercent)/100:null,max:complete?discounted(high,draft.discountPercent)/100:null,reasons:uniqueReasons(reasons)}];
 }));
 return {complete:channels.every(channel=>totals[channel].complete),slotSummaries,combinationCount:draft.slots.reduce((count,slot)=>count*BigInt(slot.menuIds.length),1n).toString(),channels:totals,discountPercent:draft.discountPercent};
}
export function quoteCategoryBundle(input,selectedMenuIds,state){
 const draft=template(input,state,false),selection=Array.isArray(selectedMenuIds)?selectedMenuIds:[],items=draft.slots.map((slot,index)=>{
  const selected=selection[index],chosen=slot.menuIds.includes(selected)?reviewedProduct(state,slot,selected):{product:null,reason:'Choose one reviewed product for '+slot.category+' (slot '+(index+1)+').'},product=chosen.product;
  const values=Object.fromEntries(channels.map(channel=>{
   const value=product?price(product,channel):{cents:null,reason:chosen.reason};let reason=value.reason;if(!reason&&!Number.isSafeInteger(value.cents*slot.qty))reason='This slot total is too large to calculate safely.';
   return [channel,{complete:!reason,unitPrice:reason?null:value.cents/100,subtotal:reason?null:value.cents*slot.qty/100,unitPriceCents:reason?null:value.cents,subtotalCents:reason?null:value.cents*slot.qty,reasons:reason?[reason]:[]}];
  }));
  return {menuId:product?.id||selected||null,name:product?.name||'Choose a product',category:slot.category,qty:slot.qty,channels:values};
 });
 const values=Object.fromEntries(channels.map(channel=>{
  const reasons=items.flatMap(item=>item.channels[channel].reasons);if(selection.length!==draft.slots.length)reasons.push('Choose exactly one product for each category slot.');
  const cents=safeSum(items.map(item=>item.channels[channel].subtotalCents??0));if(cents===null)reasons.push('This bundle total is too large to calculate safely.');const complete=reasons.length===0;
  return [channel,{complete,subtotal:complete?cents/100:null,total:complete?discounted(cents,draft.discountPercent)/100:null,reasons:uniqueReasons(reasons)}];
 }));
 return {complete:channels.every(channel=>values[channel].complete),items,channels:values,discountPercent:draft.discountPercent};
}
