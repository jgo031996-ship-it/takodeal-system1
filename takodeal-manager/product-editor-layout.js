const installations=new WeakMap();

// Presentation only: retain the existing controls, listeners and recipe save path.
export function installProductEditorLayout({document:d=globalThis.document,window:w=globalThis.window}={}){
 if(!d)return null;
 if(installations.has(d))return installations.get(d);
 const modal=d.getElementById('advancedProductModal'),recipeBody=d.getElementById('advRecipeBody'),addonBody=d.getElementById('addonTableBody'),priceGrid=modal?.querySelector('.menu-price-grid');
 if(!modal||!recipeBody||!addonBody||!priceGrid)return null;
 const panel=modal.firstElementChild,header=panel?.firstElementChild,scroll=panel?.children[1],footer=panel?.lastElementChild,manage=priceGrid.parentElement;
 if(!panel||!scroll||!manage)return null;
 const element=(tag,cls,text)=>{const node=d.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const directChild=(node,parent)=>{let current=node;while(current?.parentElement&&current.parentElement!==parent)current=current.parentElement;return current?.parentElement===parent?current:null;};
 const createCard=(title,copy)=>{const section=element('section','product-editor-section');section.append(element('h3','product-editor-section-title',title));if(copy)section.append(element('p','product-editor-help',copy));return section;};
 modal.classList.add('product-editor-enhanced');panel.classList.add('product-editor-panel');header.classList.add('product-editor-header');scroll.classList.add('product-editor-scroll');footer.classList.add('product-editor-footer');
 const title=header.querySelector('h2');if(title){title.id ||= 'productEditorTitle';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby',title.id);}
 header.querySelector('button')?.setAttribute('aria-label','Close product editor');
 const details=scroll.firstElementChild;details?.classList.add('product-editor-section','product-editor-details');text(details?.querySelector('h3'),'Product details');
 const priceCard=createCard('Selling prices','Set the price for each sales channel.');priceCard.classList.add('product-editor-prices');manage.before(priceCard);priceCard.append(priceGrid);
 const recipeTable=recipeBody.closest('table');manage.classList.add('product-editor-section','product-editor-recipe');text(manage.querySelector('h3'),'Recipe ingredients');
 const recipeCopy=d.getElementById('recipeCloneSelect')?.parentElement;recipeCopy?.classList.add('product-editor-copy');
 if(recipeCopy){text(recipeCopy.querySelector('span'),'Copy another recipe');const cloneButton=recipeCopy.querySelector('button');text(cloneButton,'Replace recipe');cloneButton?.setAttribute('title','Replace the ingredient rows with another saved recipe');}
 const ingredientIntro=recipeCopy?.previousElementSibling;if(ingredientIntro&&ingredientIntro.tagName==='DIV')text(ingredientIntro,'Enter the ingredient quantities for one product or one prepared batch.');
 const addIngredient=manage.querySelector('[onclick*="addAdvRecipeRow"]');if(addIngredient){text(addIngredient,'+ Add ingredient');addIngredient.classList.add('product-editor-add');}
 const mixInput=d.getElementById('advProdMixMatch'),mixBox=mixInput?directChild(mixInput,manage):null,addonBox=directChild(addonBody,manage);
 const profit=d.getElementById('profSellPrice')?.parentElement?.parentElement?.parentElement;
 const choices=createCard('Choices & add-ons','Optional fillings, flavors and extras for this product.');choices.classList.add('product-editor-choices');
 const choiceDetails=(title,box,cls)=>{if(!box)return null;const detail=element('details','product-editor-disclosure '+cls),summary=element('summary','',title);detail.append(summary,box);box.classList.add('product-editor-disclosure-body');choices.append(detail);return detail;};
 const mixDetails=choiceDetails('Mix & match fillings',mixBox,'product-editor-mix'),addonDetails=choiceDetails('Product add-ons & flavors',addonBox,'product-editor-addons');
 if(mixBox){text(mixBox.querySelector('label'),'Available fillings');text(mixBox.querySelector('div'),'Separate fillings with commas, then link each filling to its stock ingredient below.');}
 if(addonBox){const h4=addonBox.querySelector('h4');if(h4)h4.classList.add('product-editor-duplicate-heading');}
 if(profit)scroll.insertBefore(choices,profit);else scroll.append(choices);
 if(profit){
  profit.classList.add('product-editor-section','product-editor-costs');text(profit.querySelector('h3'),'Recipe cost & gross profit');
  for(const [id,label]of [['profSellPrice','Base selling price'],['profProdCost','Base recipe cost'],['profMargin','Gross profit before other costs'],['profMarginPct','Food cost %']]){const value=d.getElementById(id);text(value?.previousElementSibling,label);}
  const note=element('p','product-editor-help product-editor-cost-note','This summary uses the base recipe and base selling price. Selected extras, wages, rent and platform fees are not included. Food cost % is recipe cost divided by the base selling price.');profit.append(note);
 }
 for(const [id,label]of [['advProdName','Product name'],['advProdCat','Category']]){const input=d.getElementById(id),labelNode=input?.previousElementSibling;if(labelNode?.tagName==='LABEL'){labelNode.htmlFor=id;text(labelNode,label+' *');}}
 const recipeHeaders=['Ingredient','Quantity','Unit','Line cost',''];
 const addonHeaders=['Add-on name','Extra price (₱)','Stock ingredient','Stock quantity',''];
 let wasOpen=false,lastProductId=null,queued=false,stopped=false;
 function tableLayout(body,labels,kind){
  const table=body.closest('table');if(!table)return;table.classList.add('product-editor-table','product-editor-'+kind+'-table');
  const headings=[...table.querySelectorAll('thead th')];for(const [index,heading]of headings.entries())if(index<labels.length&&labels[index])text(heading,labels[index]);
  for(const [index,row]of [...body.children].entries()){
   if(row.children.length!==headings.length||row.querySelector('td[colspan]'))continue;
   row.classList.add('product-editor-data-row');
   for(const [cellIndex,cell]of [...row.children].entries()){
    cell.dataset.label=labels[cellIndex]||headings[cellIndex]?.textContent?.trim()||'Action';
    for(const input of cell.querySelectorAll('input,select'))input.setAttribute('aria-label',(cell.dataset.label||'Value')+' '+(index+1));
   }
   const remove=row.lastElementChild?.querySelector('button');if(remove){text(remove,'Remove');remove.classList.add('product-editor-remove');remove.setAttribute('aria-label','Remove '+kind+' row '+(index+1));}
  }
 }
 function refresh(){
  queued=false;if(stopped)return;
  tableLayout(recipeBody,recipeHeaders,'ingredient');tableLayout(addonBody,addonHeaders,'add-on');
  const auto=d.getElementById('btnAutoLoadAddons');if(auto&&!auto.disabled)text(auto,'Add category options');
  const save=d.getElementById('btnSaveAdvProd');if(save&&!save.disabled)text(save,'Save product');
  const clone=d.getElementById('addonCloneSelect');if(clone){clone.setAttribute('aria-label','Product to copy add-ons from');const copyButton=clone.parentElement?.querySelector('[onclick*="cloneAddons"]');text(copyButton,'Copy options');}
  const busy=/^Loading(?:\.{3}|…)?$/i.test(recipeBody.textContent.trim());panel.setAttribute('aria-busy',String(busy));
  const isOpen=modal.style.display!=='none'&&!modal.hidden,productId=d.getElementById('advProdId')?.value||'';
  if(isOpen&&(!wasOpen||productId!==lastProductId)){
   if(mixDetails)mixDetails.open=Boolean(mixInput?.value.trim());
   if(addonDetails)addonDetails.open=Boolean(addonBody.querySelector('.addon-name'));
   lastProductId=productId;
  }
  wasOpen=isOpen;
 }
 const request=w?.requestAnimationFrame?.bind(w)||((fn)=>queueMicrotask(fn));
 const schedule=()=>{if(!queued&&!stopped){queued=true;request(refresh);}};
 const costTotal=d.getElementById('advTotalCost');
 const observer=w?.MutationObserver?new w.MutationObserver(records=>{if(records.some(record=>record.target===modal||record.type==='childList'&&!profit?.contains(record.target)&&!costTotal?.contains(record.target)))schedule();}):null;
 observer?.observe(modal,{subtree:true,childList:true,attributes:true,attributeFilter:['style','hidden']});
 refresh();
 const controller={refresh,stop(){if(stopped)return;stopped=true;observer?.disconnect();installations.delete(d);}};
 installations.set(d,controller);return controller;
}
