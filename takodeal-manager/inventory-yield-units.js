export function yieldUnitOptions(item){
 const first=keys=>{for(const key of keys)if(item?.[key]!=null)return String(item[key]).trim();return '';};
 const purchase=first(['purchaseUom','purchUom','uom']),base=first(['baseUom','uom']),number=item?.conversionRate??item?.conversion??1,conversion=typeof number==='number'?number:typeof number==='string'&&number.trim()?Number(number):NaN;
 if(!item?.id||!purchase||!base)throw Error('Choose an ingredient with saved purchase and base units.');
 if(!Number.isFinite(conversion)||conversion<=0)throw Error('Review this item’s saved conversion before calculating a yield.');
 const choices=[{value:'purchase',label:purchase,factor:conversion}];
 if(purchase.toLowerCase()===base.toLowerCase()){if(conversion!==1)throw Error('The same purchase and base unit must use a conversion of 1. Review this item’s units.');}
 else choices.push({value:'base',label:base,factor:1});
 return choices;
}
export function yieldQuantityFactor(item,value='purchase'){
 const choice=yieldUnitOptions(item).find(option=>option.value===value);
 if(!choice)throw Error('Choose this item’s saved purchase or base unit.');return choice.factor;
}
export function convertYieldQuantity(item,value,from,to){
 if(value==='')return '';const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 if(!Number.isFinite(number)||number<0)throw Error('Enter a valid quantity before changing its unit.');
 const result=number*yieldQuantityFactor(item,from)/yieldQuantityFactor(item,to);
 if(!Number.isFinite(result)||result>Number.MAX_SAFE_INTEGER)throw Error('This quantity is too large. Check the value.');
 return Number(result.toPrecision(15));
}
