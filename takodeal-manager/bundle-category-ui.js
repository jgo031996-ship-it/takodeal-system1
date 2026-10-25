import {eligibleBundleProducts,bundleCategoryNames,normalizeCategoryBundleDraft,categoryBundleSummary,quoteCategoryBundle} from './bundle-category-model.js';

const channels=[['base','Base'],['grab','Grab'],['foodpanda','Foodpanda']];
const text=value=>String(value??'').trim();
const searchKey=value=>text(value).normalize('NFKC').toLocaleLowerCase();
const money=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-PH',{style:'currency',currency:'PHP'}):'Needs price review';
const range=value=>!value?.complete?'Needs price review':value.min===value.max?money(value.min):money(value.min)+' – '+money(value.max);
const wordKey=value=>searchKey(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function bundleProductSizes(name){
 const value=text(name),result=new Set();for(const match of value.matchAll(/(?:^|[^0-9])(\d+)\s*(?:pcs?|pieces?)\b/gi))result.add(Number(match[1])+'Pcs');
 const suffix=value.match(/\b(XXL|XL|XS|S|M|L)\s*$/i);if(suffix)result.add(suffix[1].toUpperCase());
 for(const match of value.matchAll(/\b(solo|duo|trio|squad)\b/gi))result.add(match[1][0].toUpperCase()+match[1].slice(1).toLowerCase());return [...result];
}
export function bundleProductMatchesFilling(name,filling){return !text(filling)||(' '+wordKey(name)+' ').includes(' '+wordKey(filling)+' ');}
export function bundleCategoryFacets(products,flavors=[]){
 const sizeOrder=['XS','S','M','L','XL','XXL','Solo','Duo','Trio','Squad'],sizes=[...new Set(products.flatMap(product=>bundleProductSizes(product.name)))].sort((a,b)=>{const x=sizeOrder.indexOf(a),y=sizeOrder.indexOf(b);return x>=0&&y>=0?x-y:a.localeCompare(b,undefined,{numeric:true});}),seen=new Set(),fillings=[];
 for(const value of Array.isArray(flavors)?flavors:[]){const flavor=text(value),key=wordKey(flavor);if(flavor&&key&&!seen.has(key)&&products.some(product=>bundleProductMatchesFilling(product.name,flavor))){seen.add(key);fillings.push(flavor);}}
 return{sizes,fillings};
}
export function bundleProductMatchesFilter(name,filter){
 const normalize=value=>searchKey(value).replace(/(\d+)\s*(?:pcs?|pieces?)\b/g,'$1pcs');
 const source=normalize(name),query=normalize(filter);if(!query)return true;
 return query.split(/\s+/).every(word=>/^(?:xxl|xl|xs|s|m|l)$/.test(word)?new RegExp('(?:^|[^a-z0-9])'+word+'(?:$|[^a-z0-9])','i').test(source):/^\d+pcs$/.test(word)?new RegExp('(?:^|[^0-9])'+word+'(?:$|[^a-z0-9])','i').test(source):source.includes(word));
}

export function categoryBundleDescription(draft){return (draft.slots||[]).map(slot=>{const count=(slot.menuIds||[]).length;return slot.qty+' × '+slot.category+' ('+count+' '+(count===1?'choice':'choices')+')';}).join(' + ');}

export function openCategoryBundleEditor({document:d=document,state,saved=null,targetId,dialogForm,service}){
 const element=(tag,value,cls='')=>{const node=d.createElement(tag);node.className=cls;if(value!=null)node.textContent=value;return node;};
 const option=(label,value)=>{const node=element('option',label);node.value=value;return node;};
 const field=(label,type,value='')=>{const wrap=element('label',label),input=element(type==='select'?'select':type==='textarea'?'textarea':'input');if(!['select','textarea'].includes(type))input.type=type;input.value=value??'';wrap.append(input);return{wrap,input};};
 const button=(label,action,cls='mo-button')=>{const node=element('button',label,cls);node.type='button';node.addEventListener('click',action);return node;};
 const rows=[],categoryNames=bundleCategoryNames(state),name=field('Bundle name','text',saved?.name||''),notes=field('Planning notes','textarea',saved?.notes||''),discount=field('Bundle discount (%)','number',saved?.discountPercent??0);let nameEdited=Boolean(saved);
 name.input.addEventListener('input',()=>{nameEdited=true;});
 name.input.required=true;name.input.maxLength=120;notes.input.maxLength=1000;discount.input.min='0';discount.input.max='100';discount.input.step='0.01';discount.input.required=true;
 const slots=element('div',null,'bc-slots'),pricing=element('section',null,'bc-pricing'),overview=element('p','Choose the bundle categories to see automatic prices.','bc-preview-status'),grid=element('div',null,'bc-channel-grid'),breakdown=element('div',null,'bc-breakdown'),priceCards=new Map();overview.setAttribute('aria-live','polite');
 const form=dialogForm(saved?'Edit category bundle draft':'Plan a category bundle','Save draft',async context=>{
  const input=normalizeCategoryBundleDraft(collect(),state);
  await service.saveBundleDraft(targetId,input,{state,operationId:context.attempt([targetId,input]),assertCurrent:context.assertCurrent});
 });
 form.body.closest('dialog')?.classList.add('bc-dialog');
 for(const [channel,label]of channels){const card=element('article',null,'bc-channel-card'),total=element('output','Choose categories','bc-channel-total'),span=element('p','', 'mo-help'),subtotal=element('p','', 'mo-help'),review=element('div',null,'bc-channel-review');total.setAttribute('aria-label','Example '+label+' total');card.append(element('h4',label+' price'),total,subtotal,span,review);grid.append(card);priceCards.set(channel,{total,span,subtotal,review});}
 pricing.append(element('h3','Automatic bundle prices'),element('p','The example below uses one selected product from each category. The range covers all allowed choices.','mo-help'),discount.wrap,overview,grid,breakdown);
 function productsFor(row){return row.category.input.value?eligibleBundleProducts(state,row.category.input.value):[];}
 function matching(row){return productsFor(row).filter(product=>(!row.size.input.value||bundleProductSizes(product.name).includes(row.size.input.value))&&bundleProductMatchesFilling(product.name,row.filling.input.value)&&bundleProductMatchesFilter(product.name,row.filter.input.value));}
 function drawFacets(row){
  const products=productsFor(row),flavors=state.documents?.settings?.global_mixmatch?.flavors||[],facets=bundleCategoryFacets(products,flavors),oldSize=row.size.input.value,oldFilling=row.filling.input.value;
  row.size.input.replaceChildren(option('All sizes',''),...facets.sizes.map(size=>option(size,size)));if(facets.sizes.includes(oldSize))row.size.input.value=oldSize;row.size.wrap.hidden=!facets.sizes.length;
  const sized=products.filter(product=>!row.size.input.value||bundleProductSizes(product.name).includes(row.size.input.value)),fillings=bundleCategoryFacets(sized,flavors).fillings;
  row.filling.input.replaceChildren(option('All fillings',''),...fillings.map(filling=>option(filling,filling)));if(fillings.includes(oldFilling))row.filling.input.value=oldFilling;row.filling.wrap.hidden=!fillings.length;row.fillingHelp.hidden=!fillings.length;
 }
 function selectedIds(row){const products=productsFor(row),matches=matching(row);if(row.all.checked)return matches.map(product=>product.id);const known=new Set(products.map(product=>product.id));return [...matches.filter(product=>row.selected.has(product.id)).map(product=>product.id),...[...row.selected].filter(id=>!known.has(id))];}
 function collect(){return{version:2,status:'draft',name:name.input.value,slots:rows.map(row=>({category:row.category.input.value,qty:row.qty.input.value,menuIds:selectedIds(row)})),discountPercent:discount.input.value,notes:notes.input.value};}
 function drawPrices(){
  if(!nameEdited){const names=rows.map(row=>row.category.input.value).filter(Boolean);name.input.value=names.length?(names.join(' + ')+' bundle').slice(0,120):'';}
  let draft,summary,quote;try{draft=normalizeCategoryBundleDraft({...collect(),name:name.input.value.trim()||'Bundle preview'},state);summary=categoryBundleSummary(draft,state);quote=quoteCategoryBundle(draft,rows.map(row=>row.example.input.value),state);}
  catch(error){overview.textContent=error.message;const incompleteCategory=!rows.length||rows.some(row=>!row.category.input.value);for(const card of priceCards.values()){card.total.textContent=incompleteCategory?'Choose categories':'Needs review';card.subtotal.textContent='';card.span.textContent='';card.review.replaceChildren();}breakdown.replaceChildren();return;}
  overview.textContent=summary.combinationCount+' possible '+(summary.combinationCount==='1'?'combination':'combinations')+' · '+(Number(discount.input.value)||0)+'% bundle discount';
  for(const [channel]of channels){const card=priceCards.get(channel),exact=quote.channels[channel],limits=summary.channels[channel];card.total.textContent=exact.complete?money(exact.total):'Needs price review';card.subtotal.textContent=exact.complete?'Example before discount: '+money(exact.subtotal):'Example total is held until its prices are complete.';card.span.textContent='All choices: '+range(limits);card.review.replaceChildren();if(!limits.complete||!exact.complete){const list=element('ul');for(const reason of [...new Set([...(limits.reasons||[]),...(exact.reasons||[])])].slice(0,6))list.append(element('li',typeof reason==='string'?reason:reason.message||reason.reason||'Review the saved channel price.'));card.review.append(list);}}
  breakdown.replaceChildren(element('h4','Example calculation'));
  for(const item of quote.items||[]){const row=element('div',null,'bc-calculation-row');row.append(element('strong',item.qty+' × '+item.name));const lines=element('div');for(const [channel,label]of channels){const value=item.channels?.[channel];lines.append(element('p',label+': '+(value?.complete?money(value.unitPrice)+' × '+item.qty+' = '+money(value.subtotal):'Needs price review'),'mo-help'));}row.append(lines);breakdown.append(row);}
 }
 function drawProducts(row){
  const products=productsFor(row),matches=matching(row),ids=selectedIds(row),allowed=new Set(ids),available=new Set(products.map(product=>product.id)),filters=[row.size.input.value,row.filling.input.value,row.filter.input.value.trim()].filter(Boolean);row.list.replaceChildren();row.reviewSummary.textContent='Review included products · '+ids.length+' selected';row.count.textContent=matches.length+' '+(matches.length===1?'product matches':'products match')+(filters.length?' '+filters.join(' · '):' this category')+'.';
  for(const product of matches){const label=element('label',null,'bc-product-check'),check=element('input');check.type='checkbox';check.checked=allowed.has(product.id);check.setAttribute('aria-label','Include '+product.name+' in category '+(rows.indexOf(row)+1));label.append(check,element('span',product.name));row.list.append(label);check.addEventListener('change',()=>{if(row.all.checked){row.selected=new Set(matches.map(product=>product.id));row.all.checked=false;}check.checked?row.selected.add(product.id):row.selected.delete(product.id);drawProducts(row);});}
  for(const id of ids.filter(value=>!available.has(value))){const label=element('label',null,'bc-product-check bc-unavailable'),check=element('input');check.type='checkbox';check.checked=true;check.setAttribute('aria-label','Keep unavailable product '+id);label.append(check,element('span','Unavailable product: '+id+' · uncheck to remove from this plan'));check.addEventListener('change',()=>{row.selected.delete(id);drawProducts(row);});row.list.append(label);}
  const previous=row.example.input.value;row.example.input.replaceChildren();for(const product of products.filter(product=>allowed.has(product.id)))row.example.input.append(option(product.name,product.id));if([...row.example.input.options].some(item=>item.value===previous))row.example.input.value=previous;if(!row.example.input.options.length)row.example.input.append(option('No included product',''));row.example.input.disabled=!row.example.input.value;drawPrices();
 }
 function relabel(){rows.forEach((row,index)=>{row.title.textContent='Category '+(index+1);row.category.input.setAttribute('aria-label','Bundle category '+(index+1));row.qty.input.setAttribute('aria-label','Category quantity '+(index+1));row.filter.input.setAttribute('aria-label','Filter products in category '+(index+1));row.size.input.setAttribute('aria-label','Size in category '+(index+1));row.filling.input.setAttribute('aria-label','Filling in category '+(index+1));row.example.input.setAttribute('aria-label','Example product in category '+(index+1));row.remove.setAttribute('aria-label','Remove category '+(index+1));for(const check of row.list.querySelectorAll('input')){const label=check.getAttribute('aria-label')||'';if(label.startsWith('Include '))check.setAttribute('aria-label',label.replace(/ in category \d+$/,' in category '+(index+1)));}});add.disabled=rows.length>=20;}
 function addSlot(value={}){
  if(rows.length>=20)return;const card=element('section',null,'bc-slot'),head=element('div',null,'bc-slot-head'),title=element('h3'),category=field('Menu category','select'),qty=field('Quantity','number',value.qty??1),filter=field('Narrow by name or size','search'),size=field('Size','select'),filling=field('Filling','select'),facets=element('div',null,'bc-slot-facets'),fillingHelp=element('p','Filling is included in the saved product price.','mo-help'),example=field('Example product for the price preview','select'),tools=element('div',null,'bc-slot-fields'),allLabel=element('label',null,'bc-all'),all=element('input'),count=element('p','', 'mo-help'),review=element('details',null,'bc-product-review'),reviewSummary=element('summary'),list=element('div',null,'bc-product-list');
  category.input.append(option('Choose a category',''));for(const value of categoryNames)category.input.append(option(value,value));if(value.category&&!categoryNames.includes(value.category))category.input.append(option(value.category+' · needs review',value.category));category.input.value=value.category||'';category.input.required=true;qty.input.min='1';qty.input.max='100';qty.input.step='1';qty.input.required=true;filter.input.placeholder='For example: 8Pcs, M, Large or Mango';filter.input.maxLength=120;
  all.type='checkbox';all.checked=!Array.isArray(value.menuIds);allLabel.append(all,element('span','Include every matching product'));const row={card,title,category,qty,filter,size,filling,fillingHelp,example,all,count,reviewSummary,list,selected:new Set(value.menuIds||[])};row.remove=button('Remove category',()=>{rows.splice(rows.indexOf(row),1);card.remove();relabel();drawPrices();},'mo-button mo-danger');const includeCurrent=button('Use all current matching products',()=>{all.checked=true;row.selected.clear();drawProducts(row);});rows.push(row);head.append(title,row.remove);tools.append(category.wrap,qty.wrap);facets.append(size.wrap,filling.wrap);review.append(reviewSummary,list);card.append(head,tools,facets,fillingHelp,filter.wrap,element('p','Size, filling and name filters narrow the products saved in this slot. Clear them to review the full category.','mo-help'),allLabel,includeCurrent,count,review,example.wrap);slots.append(card);
  category.input.addEventListener('change',()=>{row.selected.clear();all.checked=true;filter.input.value='';size.input.value='';filling.input.value='';drawFacets(row);drawProducts(row);});size.input.addEventListener('change',()=>{drawFacets(row);drawProducts(row);});filling.input.addEventListener('change',()=>drawProducts(row));filter.input.addEventListener('input',()=>drawProducts(row));all.addEventListener('change',()=>{if(!all.checked)row.selected=new Set(matching(row).map(product=>product.id));drawProducts(row);});qty.input.addEventListener('input',drawPrices);example.input.addEventListener('change',drawPrices);relabel();drawFacets(row);drawProducts(row);
 }
 const add=button('+ Add category',()=>addSlot());
 form.body.append(element('p','Plan a bundle by category, such as one takoyaki plus one drink. This stays a draft and does not change stock or appear for sale.','mo-plan-notice'),name.wrap,slots,add,element('p','The plan saves the products you review now. New menu items are included only when you reopen and review the plan.','mo-help'),pricing,notes.wrap);
 discount.input.addEventListener('input',drawPrices);for(const slot of saved?.slots||[{},{}])addSlot(slot);drawPrices();form.show();
 return form;
}
