// Read-only comparison using today's menu, today's branch ingredient costs and
// the saved basket/options. This is neither a historical valuation nor a payout.
import {buildRecipeCostCatalog,summarizeRecipeCosts} from './recipe-cost-model.js';

export const PLATFORM_PRICE_BASIS='current-menu-estimate';
export const PLATFORM_PRICE_DISCOUNT_BASIS='Saved percentage/fixed discounts are reapplied to current base prices; saved extras keep their saved prices. Platform fees and payouts are separate.';
const LIMIT=1_000_000_000_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const text=value=>typeof value==='string'?value.trim():'';
const lower=value=>text(value).toLowerCase().replace(/[_\s]+/g,' ');
const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))?Number(value):null;
const amount=value=>{const n=numeric(value);if(n===null||n<0||n*100>LIMIT)return null;return Math.round((n+Number.EPSILON)*100);};
const quantity=value=>{const n=numeric(value);return n!==null&&n>0&&n<=1_000_000?n:null;};
const safe=value=>Number.isSafeInteger(value)&&Math.abs(value)<=LIMIT?value:null;
const money=value=>value===null?null:value/100;
const unique=values=>[...new Set(values)];
const platform=value=>lower(value)==='grab'?'Grab':['foodpanda','food panda','panda'].includes(lower(value))?'Foodpanda':null;
const unposted=new Set(['void','voided','cancelled','canceled','parked','draft','unpaid','unpaid / deleted','pending','pending sync','mobile queue','rejected','deleted']);
const posted=new Set(['','paid','complete','completed','settled','received']);
function salePlatform(sale){
 const direct=platform(sale.paymentMethod);if(direct)return direct;
 const hints=unique([platform(sale.platform),platform(sale.orderType),...(Array.isArray(sale.splitDetails)?sale.splitDetails.map(row=>platform(row?.method)):[])].filter(Boolean));
 return hints.length===1?hints[0]:null;
}
function exclusion(sale,kind){
 if(sale.cancelledFoodSourceId)return 'Separate staff purchase of cancelled food; not a platform order.';
 if(!kind)return 'Not one identifiable Grab or Foodpanda order.';
 if(sale.preparedCancellation||sale.cancelled===true||sale.canceled===true)return 'Cancelled order; excluded from sales comparison.';
 if(sale.isPendingSync===true||unposted.has(lower(sale.status))||unposted.has(lower(sale.paymentStatus))||lower(sale.paymentMethod).startsWith('unpaid'))return 'Cancelled, unpaid or pending order; excluded from sales comparison.';
 if(!posted.has(lower(sale.status))||!posted.has(lower(sale.paymentStatus)))return 'The saved payment status needs review.';
 return '';
}
function currentProduct(item,menu,issues){
 const ids=unique([text(item.menuId),text(item.menuItemId)].filter(Boolean));
 if(ids.length>1){issues.push('Saved menu IDs disagree.');return null;}
 if(ids.length){const matches=menu.filter(row=>text(row.id)===ids[0]);if(matches.length!==1){issues.push(matches.length?'Duplicate current menu ID.':'Saved menu ID is not in the current menu.');return null;}return matches[0];}
 for(const name of unique([text(item.realName),text(item.name),text(item.itemName)].filter(Boolean))){
  const matches=menu.filter(row=>text(row.name)===name);
  if(matches.length>1){issues.push('Duplicate current menu products named '+name+'.');return null;}
  if(matches.length===1)return matches[0];
 }
 issues.push('No exact saved product name matches the current menu.');return null;
}
function baseUnitPrice(product,issues){
 if(!product)return null;
 const fields=['price','basePrice'].filter(key=>own(product,key)&&product[key]!==null&&product[key]!==undefined);
 const values=fields.map(key=>amount(product[key]));
 if(!fields.length||values.some(value=>value===null)){issues.push('Current standard menu price is missing or invalid.');return null;}
 if(fields.some((field,i)=>Math.abs(Number(product[field])*100-values[i])>0.000001)){issues.push('Current standard menu price has a fraction of a cent.');return null;}
 if(new Set(values).size>1){issues.push('Current standard menu price fields disagree.');return null;}
 return values[0];
}
function discount(type,value,label,issues){
 const kind=lower(type),n=value===undefined||value===null||value===''?0:numeric(value);
 if((!kind||kind==='none')&&n===0)return {kind:'none',value:0};
 if(value===undefined||value===null||value===''){issues.push(label+' discount value is not recorded.');return null;}
 if(!['percentage','fixed'].includes(kind)||n===null||n<0||kind==='percentage'&&n>100){issues.push(label+' discount rule is missing, unsupported or invalid.');return null;}
 if(kind==='fixed'){const cents=amount(value);if(cents===null||Math.abs(n*100-cents)>0.000001){issues.push(label+' fixed discount is invalid.');return null;}return {kind,value:cents};}
 return {kind,value:n};
}
function discounted(cents,rule){
 if(cents===null||!rule)return null;
 const reduction=rule.kind==='percentage'?Math.round(cents*rule.value/100):rule.kind==='fixed'?rule.value:0;
 return Math.max(0,cents-reduction);
}
function allocate(total,weights){
 const sum=weights.reduce((n,value)=>n+value,0);if(sum===0)return weights.map(()=>0);
 const divisor=BigInt(sum),entries=weights.map((weight,index)=>{const numerator=BigInt(total)*BigInt(weight);return {index,value:Number(numerator/divisor),fraction:numerator%divisor};});
 let left=total-entries.reduce((n,row)=>n+row.value,0);
 for(const row of [...entries].sort((a,b)=>a.fraction===b.fraction?a.index-b.index:a.fraction>b.fraction?-1:1)){if(left<=0)break;row.value++;left--;}
 return entries.map(row=>row.value);
}
function extras(item,priceIssues,costIssues){
 if(item.addons===undefined||item.addons===null)return [];
 if(!object(item.addons)){priceIssues.push('Saved add-ons are not a valid option list.');costIssues.push('Saved add-on quantities could not be confirmed.');return [];}
 const result=[];
 for(const [key,value]of Object.entries(item.addons)){
  if(!object(value)){priceIssues.push('Invalid saved add-on '+key+'.');costIssues.push('Invalid saved add-on '+key+'.');continue;}
  const qty=numeric(value.qty),name=text(value.name)||key;
  if(qty===0)continue;
  if(qty===null||qty<0||qty>1_000_000){priceIssues.push('Invalid saved add-on quantity: '+name+'.');costIssues.push('Invalid saved add-on quantity: '+name+'.');continue;}
  const price=amount(value.price);if(price===null)priceIssues.push('Saved add-on price is missing or invalid: '+name+'.');
  result.push({...value,name,qty,priceCents:price});
 }
 return result;
}
function itemCost(item,name,qty,addons,sale,recipes,catalog,issues){
 if(qty===null){issues.push('Saved item quantity is missing or invalid.');return null;}
 let rows=recipes.filter(row=>text(row.menuItem)===name);
 if(!name||!rows.length){issues.push('No current recipe is recorded for '+(name||'this item')+'.');return null;}
 const orderType=lower(item.orderType||sale.orderType);
 if(orderType.includes('dine-in'))rows=rows.map(row=>/box/i.test(text(row.ingredientName))?{...row,qty:numeric(row.qty)===null?row.qty:Number(row.qty)/2}:row);
 const recipe=summarizeRecipeCosts(rows,catalog);issues.push(...recipe.problems);
 let total=recipe.total??0;
 for(const addon of addons){
  const ingredient=text(addon.linkedIngredient),deductQty=numeric(addon.deductQty);
  if(!ingredient||deductQty===null||deductQty<=0){issues.push('Saved add-on ingredient or deduction quantity is missing: '+addon.name+'.');continue;}
  const cost=summarizeRecipeCosts([{ingredientName:ingredient,qty:deductQty,uom:addon.baseUom||addon.uom||addon.unit}],catalog);
  issues.push(...cost.problems.map(problem=>addon.name+': '+problem));
  if(cost.total!==null)total+=cost.total*addon.qty;
 }
 if(issues.length)return null;
 const cents=safe(Math.round((total*qty+Number.EPSILON)*100));if(cents===null)issues.push('Estimated ingredient cost is too large.');return cents;
}
function line(item,index,sale,menu,recipes,catalog){
 const priceIssues=[],costIssues=[];
 if(!object(item))return {name:'Invalid saved item',qty:null,menuId:null,currentBaseUnitPrice:null,savedAddonTotal:null,recordedLineTotal:null,recordedLineNet:null,baseSales:null,priceDifference:null,cogs:null,afterCogs:null,priceIssues:['Invalid saved receipt item.'],costIssues:['Invalid saved receipt item.'],_base:null,_recorded:null,_cost:null};
 const qty=quantity(item.qty??item.quantity);if(qty===null)priceIssues.push('Saved item quantity is missing or invalid.');
 const product=currentProduct(item,menu,priceIssues),name=text(product?.name)||text(item.realName)||text(item.name)||text(item.itemName)||'Unnamed item',unit=baseUnitPrice(product,priceIssues),addons=extras(item,priceIssues,costIssues);
 const addonTotal=addons.every(addon=>addon.priceCents!==null)?safe(Math.round(addons.reduce((sum,addon)=>sum+addon.priceCents*addon.qty,0))):null;
 if(addonTotal===null)priceIssues.push('Saved add-on prices could not be totaled.');
 const rule=discount(item.discountType,item.discountVal,'Line '+(index+1),priceIssues);
 let base=unit!==null&&addonTotal!==null&&qty!==null?safe(Math.round((unit+addonTotal)*qty)):null;
 base=discounted(base,rule);
 const recorded=own(item,'lineTotalFinal')?amount(item.lineTotalFinal):null;
 if(own(item,'lineTotalFinal')&&recorded===null)priceIssues.push('Saved line total is invalid.');
 const charged=amount(item.variantPrice??item.basePrice??item.price);
 if(charged!==null&&qty!==null&&addonTotal!==null&&rule&&recorded!==null){
  const expected=discounted(safe(Math.round((charged+addonTotal)*qty)),rule);
  if(expected===null||Math.abs(expected-recorded)>1)priceIssues.push('Saved line discount or total is inconsistent.');
 }
 const cost=itemCost(item,name,qty,addons,sale,recipes,catalog,costIssues);
 if(base===null&&!priceIssues.length)priceIssues.push('Current base sales could not be calculated.');
 if(priceIssues.length)base=null;
 return {name,qty,menuId:text(product?.id)||null,currentBaseUnitPrice:money(unit),savedAddonTotal:money(addonTotal),recordedLineTotal:money(recorded),recordedLineNet:null,baseSales:money(base),priceDifference:null,cogs:money(cost),afterCogs:base!==null&&cost!==null?money(base-cost):null,priceIssues:unique(priceIssues),costIssues:unique(costIssues),_base:base,_recorded:recorded,_cost:cost};
}
function row(sale,index,{menu,recipes,catalogs}){
 const kind=salePlatform(sale),excluded=exclusion(sale,kind),recorded=amount(sale.netTotal),subtotal=own(sale,'subTotalBeforeDiscount')?amount(sale.subTotalBeforeDiscount):null;
 const result={source:sale,id:text(sale.id)||text(sale.saleId)||text(sale.receiptId)||'comparison-row-'+index,platform:kind,included:!excluded,exclusionReason:excluded,recordedSubtotal:money(subtotal),recordedTotal:money(recorded),baseSales:null,priceDifference:null,cogs:null,afterCogs:null,priceIssues:[],costIssues:[],basis:PLATFORM_PRICE_BASIS,items:[]};
 if(excluded)return result;
 const priceIssues=[],costIssues=[];
 if(recorded===null)priceIssues.push('Saved order total is missing or invalid.');
 if(own(sale,'subTotalBeforeDiscount')&&subtotal===null)priceIssues.push('Saved order subtotal is invalid.');
 if(!Array.isArray(sale.cart)||!sale.cart.length){result.priceIssues=[...priceIssues,'No saved item breakdown is available.'];result.costIssues=['No saved item breakdown is available.'];return result;}
 const branch=text(sale.branch);if(!branch)costIssues.push('The saved sale has no branch for ingredient costs.');
 let catalog=catalogs.get(branch);if(!catalog){catalog=buildRecipeCostCatalog([], {basis:branch});catalogs.set(branch,catalog);}
 const items=sale.cart.map((item,i)=>line(item,i,sale,menu,recipes,catalog));
 for(const item of items){priceIssues.push(...item.priceIssues.map(issue=>item.name+': '+issue));costIssues.push(...item.costIssues.map(issue=>item.name+': '+issue));}
 const rule=discount(sale.globalDiscountType,sale.globalDiscountValue,'Order',priceIssues),savedDiscount=own(sale,'globalDiscountAmount')?amount(sale.globalDiscountAmount):null;
 if(own(sale,'globalDiscountAmount')&&savedDiscount===null)priceIssues.push('Saved order discount amount is invalid.');
 if(rule?.kind==='none'&&savedDiscount!==null&&savedDiscount!==0)priceIssues.push('Saved order discount amount disagrees with its rule.');
 const originalLinesKnown=items.every(item=>item._recorded!==null),lineSum=originalLinesKnown?safe(items.reduce((sum,item)=>sum+item._recorded,0)):null,original=subtotal??lineSum;
 if(subtotal!==null&&lineSum!==null&&Math.abs(subtotal-lineSum)>1)priceIssues.push('Saved order subtotal does not match its receipt lines.');
 if(original!==null&&rule){const expected=discounted(original,rule);if(recorded!==null&&Math.abs(expected-recorded)>1)priceIssues.push('Saved order discount rule does not match its paid total.');if(savedDiscount!==null&&Math.abs(original-expected-savedDiscount)>1)priceIssues.push('Saved order discount amount disagrees with its rule.');}
 if(own(sale,'splitDetails')){
  const splits=sale.splitDetails;
  if(!Array.isArray(splits)||!splits.length||splits.some(part=>!object(part)||!text(part.method)||amount(part.amount)===null||unposted.has(lower(part.method))))priceIssues.push('Saved split payments are invalid.');
  else{const total=safe(splits.reduce((sum,part)=>sum+amount(part.amount),0));if(recorded===null||total!==recorded)priceIssues.push('Saved split payments do not match the paid order total.');if(!splits.some(part=>platform(part.method)===kind))priceIssues.push('Saved split payments do not include this platform.');}
 }
 let base=items.every(item=>item._base!==null)?safe(items.reduce((sum,item)=>sum+item._base,0)):null;
 if(base===null&&!priceIssues.length)priceIssues.push('The base-price estimate is incomplete.');
 const baseBeforeDiscount=base;base=priceIssues.length?null:discounted(base,rule);
 const cost=costIssues.length||items.some(item=>item._cost===null)?null:safe(items.reduce((sum,item)=>sum+item._cost,0));
 if(cost===null&&!costIssues.length)costIssues.push('The ingredient-cost estimate is incomplete.');
 if(base!==null){const reductions=allocate(baseBeforeDiscount-base,items.map(item=>item._base));items.forEach((item,i)=>{item._base-=reductions[i];item.baseSales=money(item._base);item.afterCogs=item._cost!==null?money(item._base-item._cost):null;});}
 else for(const item of items){item.baseSales=null;item.afterCogs=null;}
 if(recorded!==null&&lineSum!==null&&lineSum>0&&recorded<=lineSum){const reductions=allocate(lineSum-recorded,items.map(item=>item._recorded));items.forEach((item,i)=>{item.recordedLineNet=money(item._recorded-reductions[i]);item.priceDifference=base!==null?money(item._recorded-reductions[i]-item._base):null;});}
 else if(recorded===0&&lineSum===0)for(const item of items){item.recordedLineNet=0;item.priceDifference=base!==null?-item.baseSales:null;}
 Object.assign(result,{baseSales:money(base),priceDifference:base!==null&&recorded!==null?money(recorded-base):null,cogs:money(cost),afterCogs:base!==null&&cost!==null?money(base-cost):null,priceIssues:unique(priceIssues),costIssues:unique(costIssues),items:items.map(({_base,_recorded,_cost,...item})=>item)});
 return result;
}

/** All public amounts are pesos, rounded once per line and summed as centavos.
 * Null means unknown. `known` sums are partial and must show their knownCounts.
 * Matched groups subtract only measures calculated for the same saved orders.
 */
export function buildPlatformPriceReport(sales,{menu=[],inventory=[],recipes=[]}={}){
 if(!Array.isArray(sales)||![menu,inventory,recipes].every(Array.isArray))throw Error('Platform comparison requires saved sales, menu, branch inventory and recipes lists.');
 if([...sales,...menu,...inventory,...recipes].some(value=>!object(value)))throw Error('Platform comparison contains an invalid saved record.');
 const catalogs=new Map();for(const branch of unique(sales.map(sale=>text(sale.branch)).filter(Boolean)))catalogs.set(branch,buildRecipeCostCatalog(inventory,{basis:branch}));
 const rows=sales.map((sale,index)=>row(sale,index,{menu,recipes,catalogs})),included=rows.filter(row=>row.included),measures=['recordedTotal','baseSales','cogs','priceDifference','afterCogs'],known={},knownCounts={},totals={};
 for(const name of measures){const values=included.filter(row=>row[name]!==null);knownCounts[name]=values.length;const cents=safe(values.reduce((sum,row)=>sum+Math.round(row[name]*100),0));known[name]=money(cents);totals[name]=values.length===included.length?money(cents):null;}
 const matchedPrice=included.filter(row=>row.priceDifference!==null),matchedMargin=included.filter(row=>row.afterCogs!==null),sum=(list,name)=>money(safe(list.reduce((total,row)=>total+Math.round(row[name]*100),0)));
 const summary={includedCount:included.length,excludedCount:rows.length-included.length,completeCount:included.filter(row=>measures.every(name=>row[name]!==null)).length,priceIncompleteCount:included.filter(row=>row.baseSales===null||row.priceDifference===null).length,costIncompleteCount:included.filter(row=>row.cogs===null).length,recordedIncompleteCount:included.filter(row=>row.recordedTotal===null).length,...totals,known,knownCounts,matched:{price:{count:matchedPrice.length,recordedTotal:sum(matchedPrice,'recordedTotal'),baseSales:sum(matchedPrice,'baseSales'),priceDifference:sum(matchedPrice,'priceDifference')},margin:{count:matchedMargin.length,baseSales:sum(matchedMargin,'baseSales'),cogs:sum(matchedMargin,'cogs'),afterCogs:sum(matchedMargin,'afterCogs')}},basis:PLATFORM_PRICE_BASIS,discountBasis:PLATFORM_PRICE_DISCOUNT_BASIS};
 return {rows,summary};
}
