const folded=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
const categories=value=>Array.isArray(value)?value:String(value||'All').split(',').map(s=>s.trim()).filter(Boolean);
export function readProductAddonRows(d=document){
 const addons=[],names=new Set();
 for(const row of d.querySelectorAll('#addonTableBody tr')){
  const name=row.querySelector('.addon-name')?.value.trim();if(!name){if(row.querySelector('.addon-ingredient')?.value||Number(row.querySelector('.addon-price')?.value)||Number(row.querySelector('.addon-qty')?.value))throw Error('Enter a name for the add-on row, or remove the unused row.');continue;}
  if(names.has(folded(name)))throw Error('Each product add-on needs a unique name: '+name);names.add(folded(name));
  const addon={name,price:Number(row.querySelector('.addon-price').value),linkedIngredient:row.querySelector('.addon-ingredient').value,deductQty:Number(row.querySelector('.addon-qty').value)};
  if(row.dataset.globalAddonId)addon.globalAddonId=row.dataset.globalAddonId;
  addons.push(addon);
 }
 return addons;
}
export function installProductAddonDrafts(api=window,d=document){
 const context=()=>JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,d.getElementById('advProdId')?.value,d.getElementById('advProdCat')?.value]);
 const assertDraft=(identity,baseline)=>{if(identity!==context()||api.advRecipeState!==baseline||d.getElementById('advancedProductModal')?.style.display!=='flex')throw Error('This product draft changed. Reopen its add-ons.');};
 const error=problem=>api.Swal?.fire({title:'Product options need review',text:problem.message,icon:'warning'});
 const stocks=()=>Object.values(api.advRecipeState?.documents?.inventory||{}).filter(row=>row.branch==='Main Office').sort((a,b)=>(a.name||'').localeCompare(b.name||''));
 api.addAddonRow=(name='',price='',ingredient='',qty='',source={})=>{
  const body=d.getElementById('addonTableBody');if(!body)return null;const row=d.createElement('tr');
  if(source?.globalAddonId)row.dataset.globalAddonId=String(source.globalAddonId);
  const input=(cls,type,value)=>{const node=d.createElement('input');node.className=cls;node.type=type;node.value=value??'';if(type==='number'){node.min='0';node.step=cls==='addon-price'?'0.01':'0.001';}return node;};
  const nameInput=input('addon-name input-box','text',name),priceInput=input('addon-price input-box','number',price),quantity=input('addon-qty input-box','number',qty),select=d.createElement('select');select.className='addon-ingredient input-box';select.append(new Option('No stock deduction',''));
  for(const stock of stocks())select.append(new Option(stock.name+' · '+(stock.baseUom||stock.uom||'units'),stock.name));
  if(ingredient&&!Array.from(select.options).some(option=>option.value===ingredient)){const missing=new Option(ingredient+' · needs stock review',ingredient);select.append(missing);}select.value=ingredient||'';
  const remove=d.createElement('button');remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>row.remove());
  for(const node of [nameInput,priceInput,select,quantity,remove]){const cell=d.createElement('td');cell.append(node);row.append(cell);}body.append(row);return row;
 };
 api.autoLoadCategoryAddons=async()=>{
  const identity=context(),baseline=api.advRecipeState,category=d.getElementById('advProdCat')?.value.trim(),button=d.getElementById('btnAutoLoadAddons');if(!category)return error(Error('Choose the product category first.'));
  if(button?.disabled)return;const text=button?.textContent;if(button){button.disabled=true;button.textContent='Loading options…';}
  try{const snap=await api.getDocsFromServer(api.collection(api.db,'global_addons'));assertDraft(identity,baseline);const existing=new Set([...d.querySelectorAll('#addonTableBody .addon-name')].map(node=>folded(node.value)));let added=0;
   const rows=snap.docs.map(doc=>({...doc.data(),id:doc.id})),duplicates=new Map();for(const row of rows)duplicates.set(folded(row.name),(duplicates.get(folded(row.name))||0)+1);
   for(const row of rows){if(!categories(row.category).some(c=>c==='All'||folded(c)===folded(category)))continue;if(!folded(row.name)||duplicates.get(folded(row.name))!==1)throw Error('Global options contain duplicate or missing names. Review Global Add-Ons before loading this category.');}
   for(const row of rows){if(categories(row.category).some(c=>c==='All'||folded(c)===folded(category))&&!existing.has(folded(row.name))){api.addAddonRow(row.name,row.price,row.linkedIngredient||row.ingredient||'',row.deductQty??row.qty??0,{globalAddonId:row.id});existing.add(folded(row.name));added++;}}
   await api.Swal.fire({title:added?'Options added to this draft':'Product options are up to date',text:added+' option(s) added. Review them, then choose Save changes to update this product.',icon:'info'});
  }catch(problem){await error(problem);}finally{if(button?.isConnected){button.disabled=false;button.textContent=text||'Load category options';}}
 };
 api.cloneAddons=async()=>{
  const identity=context(),baseline=api.advRecipeState,id=d.getElementById('addonCloneSelect')?.value;if(!id)return error(Error('Choose a product to copy options from.'));
  const answer=await api.Swal.fire({title:'Copy product options?',text:'New option names will be added to this draft. Existing names are kept.',showCancelButton:true,confirmButtonText:'Copy options'});if(!answer.isConfirmed)return;
  const assertCopy=()=>{assertDraft(identity,baseline);if(d.getElementById('addonCloneSelect')?.value!==id)throw Error('The source product changed. Choose Copy options again.');};
  try{assertCopy();const saved=await api.getDocFromServer(api.doc(api.db,'menu',id));assertCopy();if(!saved.exists())throw Error('The source product is unavailable. Refresh the product list.');const names=new Set([...d.querySelectorAll('#addonTableBody .addon-name')].map(node=>folded(node.value)));let added=0;
   for(const row of saved.data().addons||[]){if(!row.name||names.has(folded(row.name)))continue;api.addAddonRow(row.name,row.price,row.linkedIngredient||row.ingredient||'',row.deductQty??row.qty??0,row);names.add(folded(row.name));added++;}
   await api.Swal.fire({title:'Options copied to draft',text:added+' option(s) added. Review and save this product when ready.',icon:'info'});
  }catch(problem){await error(problem);}
 };
 return {readRows:()=>readProductAddonRows(d)};
}
