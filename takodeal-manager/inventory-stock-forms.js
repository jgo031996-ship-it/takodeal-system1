import {loadInventoryStockFormState,saveInventoryCreate,saveHqRestock,saveKitchenPrep} from './inventory-stock-form-actions.js';
import {buildInventoryCreate,buildKitchenPrep,restockLine,mergeRestockLine,stockFormUnits,stockFormCost} from './inventory-stock-form-model.js';

const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:4});
const number=value=>Number(value).toLocaleString('en-PH',{maximumFractionDigits:4});
const field=(label,id,type='text',extra='')=>`<label class="inventory-stock-field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
const numeric=(label,id,extra='')=>field(label,id,'number','min="0" step="any" inputmode="decimal" '+extra);
const selector=(label,id,options='')=>`<label class="inventory-stock-field" for="${id}"><span>${label}</span><select id="${id}">${options}</select></label>`;
const section=(title,content,open=false)=>`<details class="inventory-stock-section" ${open?'open':''}><summary>${title}</summary><div class="inventory-stock-section-body">${content}</div></details>`;
 const shell=(kind,title,description,body,buttonId,buttonText)=>`<section class="inventory-stock-dialog inventory-stock-${kind}" role="dialog" aria-modal="true" aria-labelledby="${kind}StockTitle"><header><div><p class="inventory-stock-eyebrow">OWNER · INVENTORY</p><h2 id="${kind}StockTitle">${title}</h2><p>${description}</p></div><button class="inventory-stock-close" data-stock-close type="button" aria-label="Close ${title}">×</button></header><div class="inventory-stock-body"><p class="inventory-stock-message" role="status" id="${kind}StockStatus" data-stock-status>Loading current inventory…</p><div class="inventory-stock-form-content">${body}</div></div><footer><button type="button" class="inventory-stock-secondary" data-stock-close>Cancel</button><button type="button" class="inventory-stock-primary" id="${buttonId}">${buttonText}</button></footer></section>`;
export function inventoryStockFormMarkup(kind){
 if(kind==='add')return shell(kind,'Add inventory item','Set the item and units first. Open the optional sections only when needed.',
  `<div class="inventory-stock-grid">${selector('Branch','newInvBranch')}${field('Category','newInvCat','text','list="inventoryStockCategories" value="Ingredients" maxlength="60"')}<datalist id="inventoryStockCategories"></datalist></div>${field('Item name *','newInvName','text','maxlength="120" placeholder="e.g. F1 Flour or Burger Box"')}<div class="inventory-stock-grid">${field('Purchase unit *','newInvPurchUom','text','maxlength="40" placeholder="e.g. Pack, Kilo, Gallon"')}${field('Base unit *','newInvBaseUom','text','maxlength="40" placeholder="e.g. piece, gram"')}${numeric('Base units in one purchase unit *','newInvConv','placeholder="e.g. 50"')}${numeric('Cost per purchase unit (₱) *','newInvCost','placeholder="e.g. 150"')}</div><p class="inventory-stock-preview" id="newInvSummary">Choose the units and cost to see the conversion.</p>`+
  section('Starting stock · optional',numeric('Starting quantity in purchase units','newInvInitQty','value="0"')+'<p class="inventory-stock-hint">Added only to the selected branch. A starting balance is saved in stock history.</p>')+
  section('Restock settings · selected branch',`<p class="inventory-stock-hint" id="newInvTargetScope">These targets apply only to the selected branch.</p><div class="inventory-stock-grid">${selector('Restock cycle','newInvCycle','<option>Weekly</option><option>Monthly</option>')}${numeric('Low stock alert in purchase units','newInvBranchReorder','value="0"')}${numeric('Maintaining target in purchase units','newInvMaintainPurch','value="0"')}${numeric('Plus loose base units','newInvMaintainBase','value="0"')}</div>`)+
  section('Availability, photo & branch copies',`<label class="inventory-stock-check"><input type="checkbox" id="newInvAllowRequest" checked> Allow branches to request from Main Office</label><label class="inventory-stock-check"><input type="checkbox" id="newInvShowPrep" checked> Show in Kitchen Prep Station</label>${field('Item photo · optional','newInvPhoto','file','accept="image/jpeg,image/png,image/webp"')}<label class="inventory-stock-check"><input type="checkbox" id="newInvBroadcastAll"> Also create missing copies in other active, approved branches</label><p class="inventory-stock-hint" id="newInvCopyScope">Copies start at zero stock and zero targets. Existing items stay unchanged.</p>`),
  'btnSaveInv','Create item');
 if(kind==='prep')return shell(kind,'Prepare kitchen batch','Review the recipe and required ingredients before preparing.',
  `<div class="inventory-stock-grid">${selector('Branch kitchen','batchBranch')}${selector('Prepared item','batchItem','<option value="">Choose an item</option>')}</div>${numeric('Quantity to produce','batchQty','placeholder="Enter purchase units to produce"')}<p class="inventory-stock-hint" id="batchYieldHint">Choose an item to see its yield unit.</p><div class="inventory-stock-preview" id="batchRecipePreview">Choose the branch and prepared item.</div>`,'btnExecuteBatch','Prepare & update stock');
 return shell(kind,'Receive Main Office stock','Enter the quantities received and invoice costs. Stock and its invoice save together.',
  `<div class="inventory-stock-restock-grid"><section class="inventory-stock-card"><h3>Add received item</h3>${selector('Main Office item','restockItemSelect','<option value="">Choose an item</option>')}<p class="inventory-stock-hint" id="restockQtyLabel">Select an item to see its conversion.</p><div class="inventory-stock-grid">${numeric('Quantity in purchase units','restockQtyInput')}${numeric('Cost per purchase unit (₱)','restockUnitCost')}</div><p class="inventory-stock-hint" id="restockPrevCostLabel">Recorded purchase cost appears here.</p>${numeric('Line total (₱)','restockSubtotal')}<button type="button" class="inventory-stock-primary" id="stockAddRestock">Add to cart</button></section><section class="inventory-stock-card"><h3>Received items <span id="stockRestockCount">0</span></h3><div id="restockCartBody" class="inventory-stock-cart">No items added yet.</div></section></div>${field('Supplier / receipt reference','restockSupplierInput','text','maxlength="240" placeholder="Supplier name or invoice number"')}<div class="inventory-stock-total"><span>Total invoice cost</span><output id="restockCostInput">₱0.00</output></div><p class="inventory-stock-hint">Totals come from the cart. Negative balances are retained for audit; receiving stock does not erase them.</p>`,'btnConfirmRestock','Confirm restock');
}

export function installInventoryStockForms(w=window,d=document){
 if(w.__inventoryStockForms)return;w.__inventoryStockForms=true;
 if(!d.getElementById('inventoryStockFormsStyle')){const link=d.createElement('link');link.id='inventoryStockFormsStyle';link.rel='stylesheet';link.href='./inventory-stock-forms.css';d.head.append(link);}
 const map={add:'addInvModal',prep:'batchModal',restock:'restockModal'},states={},epochs={},busy={},uploaded=new WeakMap();let focusBefore=null,overflowBefore='';
 for(const [kind,id] of Object.entries(map)){
  let modal=d.getElementById(id);if(!modal){modal=d.createElement('div');modal.id=id;d.body.append(modal);}
  modal.removeAttribute('style');modal.className='inventory-stock-overlay';modal.style.display='none';modal.innerHTML=inventoryStockFormMarkup(kind);
  for(const button of modal.querySelectorAll('[data-stock-close]'))button.addEventListener('click',()=>close(kind));
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(kind);}if(event.key==='Tab'){const controls=[...modal.querySelectorAll('button,input,select,summary,textarea')].filter(el=>!el.disabled&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&d.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&d.activeElement===last){event.preventDefault();first?.focus();}}});
 }
 const modal=kind=>d.getElementById(map[kind]),el=id=>d.getElementById(id),value=id=>el(id).value;
 const setOptions=(target,options,placeholder)=>{target.replaceChildren();if(placeholder){const option=d.createElement('option');option.value='';option.textContent=placeholder;target.append(option);}for(const row of options){const option=d.createElement('option');option.value=typeof row==='string'?row:row.value;option.textContent=typeof row==='string'?row:row.label;target.append(option);}};
 function status(kind,message,error=false,field=''){
  const host=modal(kind),messageNode=host.querySelector('[data-stock-status]');messageNode.textContent=message;messageNode.classList.toggle('is-error',error);messageNode.setAttribute('role',error?'alert':'status');
  host.querySelectorAll('[aria-invalid]').forEach(control=>{control.removeAttribute('aria-invalid');control.removeAttribute('aria-describedby');});
  if(error&&field){const control=el(field);if(control&&host.contains(control)){control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',messageNode.id);control.closest('details')?.setAttribute('open','');control.focus({preventScroll:true});control.scrollIntoView({block:'nearest',inline:'nearest'});}}
 }
 function lock(kind,locked){busy[kind]=locked;modal(kind).querySelectorAll('input,select,button').forEach(control=>control.disabled=locked);}
 function close(kind){if(busy[kind])return;epochs[kind]=(epochs[kind]||0)+1;modal(kind).style.display='none';if(kind==='restock')w.restockCart=[];d.body.style.overflow=overflowBefore;focusBefore?.focus?.();}
 async function open(kind){
  if(Object.keys(map).some(name=>busy[name]))return null;
  if(kind!=='restock'&&w.hasPendingHQRestockDraft?.()){status('restock','Finish or cancel the current restock draft before opening another inventory form.',true);return null;}
  for(const name of Object.keys(map))if(modal(name).style.display!=='none')close(name);
  focusBefore=d.activeElement;overflowBefore=d.body.style.overflow;d.body.style.overflow='hidden';modal(kind).style.display='flex';modal(kind).querySelector('.inventory-stock-body').scrollTop=0;
  const epoch=epochs[kind]=(epochs[kind]||0)+1;states[kind]=null;status(kind,'Loading current inventory…');lock(kind,true);
  modal(kind).querySelectorAll('[data-stock-close]').forEach(button=>button.disabled=false);busy[kind]=false;
  try{
   const state=await loadInventoryStockFormState(w,kind);
   if(epoch!==epochs[kind])return null;states[kind]=state;lock(kind,false);status(kind,'Current inventory loaded. Changes save only when you confirm.');return state;
  }catch(error){if(epoch===epochs[kind]){lock(kind,true);busy[kind]=false;modal(kind).querySelectorAll('[data-stock-close]').forEach(button=>button.disabled=false);status(kind,error.code==='resource-exhausted'?'Database quota reached. Try again after the quota resets; this form made no stock changes.':error.message,true);}return null;}
 }
 const notify=message=>w.ManagerUI?.notify?.(message,{type:'success'});
 const refresh=()=>{w.invalidateCache?.('inventory');w.invalidateInventoryHistory?.();Promise.resolve(w.refreshInventoryStocks?.()||w.loadInventoryData?.()).catch(()=>{});};
 const draft=()=>({branch:value('newInvBranch'),name:value('newInvName'),category:value('newInvCat'),purchaseUom:value('newInvPurchUom'),baseUom:value('newInvBaseUom'),conversion:value('newInvConv'),cost:value('newInvCost'),initialQty:value('newInvInitQty'),targetPurchase:value('newInvMaintainPurch'),targetBase:value('newInvMaintainBase'),alertPurchase:value('newInvBranchReorder'),cycle:value('newInvCycle'),allowRequest:el('newInvAllowRequest').checked,showInPrep:el('newInvShowPrep').checked,broadcast:el('newInvBroadcastAll').checked});
 w.openAddInventoryModal=async()=>{
  if(Object.keys(map).some(name=>busy[name]))return;
  const host=modal('add');host.querySelectorAll('input:not([type=checkbox])').forEach(input=>input.value='');for(const id of ['newInvInitQty','newInvBranchReorder','newInvMaintainPurch','newInvMaintainBase'])el(id).value='0';el('newInvCat').value='Ingredients';el('newInvCycle').value='Weekly';el('newInvAllowRequest').checked=true;el('newInvShowPrep').checked=true;el('newInvBroadcastAll').checked=false;host.querySelectorAll('details').forEach(section=>section.open=false);
  const state=await open('add');if(!state)return;setOptions(el('newInvBranch'),state.branches);el('newInvBranch').value=state.branches.includes('Main Office')?'Main Office':state.branches[0]||'';
  setOptions(el('inventoryStockCategories'),[...new Set(['Ingredients','Packaging','Beverage','Prepared Batch','Consumables','Cleaning Supplies',...state.items.map(item=>item.category).filter(Boolean)])].sort());w.updateInvSummary();el('newInvName').focus();
 };
 w.updateInvSummary=()=>{
  const input=draft(),conv=Number(input.conversion),cost=Number(input.cost),qty=Number(input.initialQty||0),good=Number.isFinite(conv)&&conv>0&&input.cost!==''&&Number.isFinite(cost)&&cost>=0;
  el('newInvSummary').textContent=good?'1 '+(input.purchaseUom||'purchase unit')+' = '+number(conv)+' '+(input.baseUom||'base units')+' · '+money(cost/conv)+' per '+(input.baseUom||'base unit')+' · Starting stock '+number(qty*conv)+' '+(input.baseUom||'base units'):'Enter the units, conversion and purchase cost to see the calculation.';
  el('newInvTargetScope').textContent='Targets and alerts apply only to '+(input.branch||'the selected branch')+'.';
  el('newInvCopyScope').textContent=input.broadcast?'Missing copies will be created in: '+(states.add?.branches.filter(branch=>branch!==input.branch).join(', ')||'no other approved branches')+'. Copies start at zero stock and zero targets. Existing items stay unchanged.':'Copies start at zero stock and zero targets. Existing items stay unchanged.';
 };
 modal('add').addEventListener('input',w.updateInvSummary);modal('add').addEventListener('change',w.updateInvSummary);
 w.saveAdvancedInventoryItem=async()=>{
  if(busy.add||!states.add)return;let input;
  try{
   input=draft();buildInventoryCreate(input,{items:states.add.items,branches:states.add.branches});const file=el('newInvPhoto').files?.[0];
   if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024))throw Object.assign(Error('Choose a JPEG, PNG or WebP photo up to 5 MB.'),{field:'newInvPhoto'});
   lock('add',true);status('add','Saving the item and its stock history…');
   if(file){let url=uploaded.get(file);if(!url){const reference=w.ref(w.storage,'inventory_images/new_'+crypto.randomUUID()+'.'+({"image/jpeg":'jpg',"image/png":'png',"image/webp":'webp'}[file.type]));url=await w.getDownloadURL((await w.uploadBytes(reference,file)).ref);uploaded.set(file,url);}input.image=url;}
   const result=await saveInventoryCreate(w,states.add,input);lock('add',false);close('add');notify('Created '+result.name+' in '+result.created.length+' branch'+(result.created.length===1?'':'es')+'.');refresh();
  }catch(error){lock('add',false);status('add',error.message,true,error.field);}
 };
 el('btnSaveInv').addEventListener('click',w.saveAdvancedInventoryItem);
 w.openBatchModal=async()=>{
  if(Object.keys(map).some(name=>busy[name]))return;
  el('batchQty').value='';setOptions(el('batchItem'),[],'Choose an item');el('batchRecipePreview').textContent='Choose the branch and prepared item.';
  const state=await open('prep');if(!state)return;setOptions(el('batchBranch'),state.branches);el('batchBranch').value=state.branch||'';w.loadBatchItemsDropdown();el('batchItem').focus();
 };
 w.loadBatchItemsDropdown=async()=>{
  let state=states.prep;if(!state||busy.prep)return;const branch=value('batchBranch');
  if(state.branch!==branch){const epoch=epochs.prep=(epochs.prep||0)+1;lock('prep',true);busy.prep=false;modal('prep').querySelectorAll('[data-stock-close]').forEach(button=>button.disabled=false);status('prep','Loading '+branch+' inventory and prepared recipes…');
   try{state=await loadInventoryStockFormState(w,'prep',{branch});if(epoch!==epochs.prep)return;states.prep=state;lock('prep',false);el('batchQty').value='';status('prep','Current branch inventory loaded. Review the recipe before preparing.');}
   catch(error){if(epoch===epochs.prep){states.prep=null;lock('prep',true);busy.prep=false;modal('prep').querySelectorAll('[data-stock-close]').forEach(button=>button.disabled=false);status('prep',error.message,true);}return;}
  }
  setOptions(el('batchItem'),state.items.filter(item=>item.branch===branch&&item.category==='Prepared Batch').sort((a,b)=>a.name.localeCompare(b.name)).map(item=>({value:item.id,label:item.name})),'Choose a prepared item');prepPreview();
 };
 function prepPreview(){
  const state=states.prep,item=state?.items.find(row=>row.id===value('batchItem')),host=el('batchRecipePreview');host.replaceChildren();
  if(!item){el('batchYieldHint').textContent='Choose an item to see its yield unit.';host.textContent='Choose the branch and prepared item.';return;}
  try{const units=stockFormUnits(item);el('batchYieldHint').textContent='Produce in '+units.purchaseUom+'. 1 '+units.purchaseUom+' adds '+number(units.conversion)+' '+units.baseUom+'. The BOM quantities apply to one '+units.purchaseUom+'.';
   const plan=buildKitchenPrep(state.items,state.bom,{branch:value('batchBranch'),itemId:item.id,quantity:value('batchQty')||'1'});const title=d.createElement('strong');title.textContent='Ingredients for '+number(plan.quantity)+' '+units.purchaseUom;host.append(title);
   for(const row of plan.requirements){const p=d.createElement('p');p.textContent=row.item.name+' · '+number(row.needed)+' '+row.baseUom+' needed · '+number(row.item.currentStock)+' available';host.append(p);}const p=d.createElement('p');p.textContent='Prepared stock: '+number(plan.oldQty)+' → '+number(plan.newQty)+' '+units.baseUom;host.append(p);
  }catch(error){host.textContent=error.message;}
 }
 el('batchBranch').addEventListener('change',w.loadBatchItemsDropdown);el('batchItem').addEventListener('change',prepPreview);el('batchQty').addEventListener('input',prepPreview);
 w.executeBatchPrep=async()=>{
  if(busy.prep||!states.prep)return;try{const input={branch:value('batchBranch'),itemId:value('batchItem'),quantity:value('batchQty')};buildKitchenPrep(states.prep.items,states.prep.bom,input);lock('prep',true);status('prep','Saving the prepared stock and ingredient deductions together…');const result=await saveKitchenPrep(w,states.prep,input);lock('prep',false);close('prep');notify('Prepared '+number(result.quantity)+' '+result.purchaseUom+' of '+result.target.name+'.');refresh();}catch(error){lock('prep',false);status('prep',error.message,true,error.field);}
 };
 el('btnExecuteBatch').addEventListener('click',w.executeBatchPrep);
 w.hasPendingHQRestockDraft=()=>Boolean(busy.restock||(w.restockCart||[]).length||modal('restock').style.display!=='none'&&['restockItemSelect','restockQtyInput','restockUnitCost','restockSubtotal','restockSupplierInput'].some(id=>value(id)!==''));
 w.openMultiRestockModal=async(preSelectId=null)=>{
  if(Object.keys(map).some(name=>busy[name]))return null;
  if(w.hasPendingHQRestockDraft()){status('restock','Finish or cancel the current restock draft before opening another invoice.',true);return null;}
  w.restockCart=[];for(const id of ['restockQtyInput','restockUnitCost','restockSubtotal','restockSupplierInput'])el(id).value='';w.renderRestockCart();
  const state=await open('restock');if(!state)return;setOptions(el('restockItemSelect'),state.items.filter(item=>item.branch==='Main Office').sort((a,b)=>a.name.localeCompare(b.name)).map(item=>({value:item.id,label:item.name})),'Choose a Main Office item');if(preSelectId&&state.items.some(item=>item.id===preSelectId&&item.branch==='Main Office'))el('restockItemSelect').value=preSelectId;w.updateRestockUomLabel();el('restockItemSelect').focus();return state;
 };
 w.updateRestockUomLabel=()=>{
  const item=states.restock?.items.find(row=>row.id===value('restockItemSelect'));el('restockUnitCost').value='';el('restockSubtotal').value='';
  if(!item){el('restockQtyLabel').textContent='Select an item to see its conversion.';el('restockPrevCostLabel').textContent='Recorded purchase cost appears here.';return;}
  try{const units=stockFormUnits(item),cost=stockFormCost(item);el('restockQtyLabel').textContent='Quantity in '+units.purchaseUom+' · 1 '+units.purchaseUom+' = '+number(units.conversion)+' '+units.baseUom;el('restockPrevCostLabel').textContent=cost===null?'No recorded cost. Enter the actual receipt cost.':'Recorded: '+money(cost)+' per '+units.purchaseUom;el('restockUnitCost').value=cost===null?'':String(cost);w.calcRestockSubtotal();}catch(error){status('restock',error.message,true,'restockItemSelect');}
 };
 w.calcRestockSubtotal=()=>{const qty=Number(value('restockQtyInput')),cost=Number(value('restockUnitCost'));el('restockSubtotal').value=value('restockQtyInput')!==''&&value('restockUnitCost')!==''&&Number.isFinite(qty*cost)?String(Math.round(qty*cost*100)/100):'';};
 w.calcRestockFromSubtotal=()=>{const qty=Number(value('restockQtyInput')),total=Number(value('restockSubtotal'));if(qty>0&&value('restockSubtotal')!==''&&Number.isFinite(total))el('restockUnitCost').value=String(total/qty);};
 w.addRestockToCart=()=>{
  if(busy.restock||!states.restock)return;try{const item=states.restock.items.find(row=>row.id===value('restockItemSelect')),line=restockLine(item,{quantity:value('restockQtyInput'),unitCost:value('restockUnitCost'),subtotal:value('restockSubtotal')});w.restockCart=mergeRestockLine(w.restockCart,line);el('restockItemSelect').value='';el('restockQtyInput').value='';w.updateRestockUomLabel();w.renderRestockCart();status('restock','Item added. Review the cart before confirming.');}catch(error){status('restock',error.message,true,error.field);}
 };
 w.removeRestockItem=index=>{if(busy.restock)return;w.restockCart.splice(index,1);w.renderRestockCart();};
 w.renderRestockCart=()=>{
  const host=el('restockCartBody');host.replaceChildren();const cart=w.restockCart||[];el('stockRestockCount').textContent=String(cart.length);let total=0;
  if(!cart.length)host.textContent='No items added yet.';
  cart.forEach((row,index)=>{total+=row.subtotal;const card=d.createElement('article'),heading=d.createElement('strong'),detail=d.createElement('p'),cost=d.createElement('p'),remove=d.createElement('button');card.className='inventory-stock-cart-row';heading.textContent=row.name;detail.textContent=number(row.purchQty)+' '+row.purchUom+' · +'+number(row.baseQtyToAdd)+' '+row.baseUom;cost.textContent=money(row.subtotal)+' · '+money(row.unitCost)+' / '+row.purchUom;remove.type='button';remove.className='inventory-stock-remove';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+row.name);remove.addEventListener('click',()=>w.removeRestockItem(index));card.append(heading,detail,cost,remove);host.append(card);});
  el('restockCostInput').textContent=money(total);
 };
 w.confirmMultiRestock=async()=>{
  if(busy.restock||!states.restock)return;try{if(value('restockItemSelect')||value('restockQtyInput')||value('restockUnitCost')||value('restockSubtotal'))throw Object.assign(Error('Add the selected item to the cart, or clear its fields before confirming.'),{field:'restockItemSelect'});lock('restock',true);status('restock','Saving received stock, costs and the invoice together…');const result=await saveHqRestock(w,states.restock,{cart:w.restockCart,supplier:value('restockSupplierInput')});lock('restock',false);close('restock');w.restockCart=[];notify('Restock saved · '+money(result.totalCost)+(result.negativeBalances.length?'. Negative balances were retained for audit.':'.'));refresh();}catch(error){lock('restock',false);status('restock',error.message,true,error.field);}
 };
 // Only a successfully verified invoice reversal should call this draft helper.
 w.openHQRestockFromDraft=async({items=[],supplier=''}={})=>{
  const state=await w.openMultiRestockModal();if(!state)return;try{let cart=[];for(const input of items){const item=state.items.find(row=>row.id===input.id&&row.branch==='Main Office');cart=mergeRestockLine(cart,restockLine(item,{quantity:input.purchQty??input.qty,unitCost:input.unitCost??Number(input.subtotal)/Number(input.purchQty??input.qty),subtotal:input.subtotal}));}w.restockCart=cart;el('restockSupplierInput').value=supplier;w.renderRestockCart();status('restock','Reversed invoice loaded as a draft. Review its received quantities and costs before confirming.');}catch(error){status('restock',error.message,true,error.field);}
 };
 el('restockItemSelect').addEventListener('change',w.updateRestockUomLabel);for(const id of ['restockQtyInput','restockUnitCost'])el(id).addEventListener('input',w.calcRestockSubtotal);el('restockSubtotal').addEventListener('input',w.calcRestockFromSubtotal);el('stockAddRestock').addEventListener('click',w.addRestockToCart);el('btnConfirmRestock').addEventListener('click',w.confirmMultiRestock);
}
