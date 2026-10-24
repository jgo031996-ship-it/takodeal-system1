let pickerSequence=0;

const searchText=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
const catalogDetail=item=>[item.category,item.purchaseUom||item.purchUom||item.uom||'Unit set by HQ'].filter(Boolean).join(' · ');

// Item identity always comes from a selected catalog row, never the typed name.
export function installFranchiseItemPicker({input,items=[],getName=item=>item.itemName||item.name||'',onSelectionChange=()=>{},document:doc=input?.ownerDocument,minChars=2,maxResults=50}={}) {
 if(!input||!doc||!input.parentNode)throw Error('An attached item input is required.');
 const id=input.id||`franchise-item-${++pickerSequence}`,listId=`${id}-suggestions`,statusId=`${id}-suggestion-status`,previousDescription=input.getAttribute('aria-describedby')||'';
 const candidates=items.map(item=>({item,id:String(item.id??'').trim(),name:String(getName(item)??'').trim(),detail:catalogDetail(item)})).filter(row=>row.id&&row.name),counts=new Map(),detailCounts=new Map();
 const detailKey=row=>JSON.stringify([searchText(row.name),searchText(row.detail)]);
 for(const row of candidates){counts.set(row.id,(counts.get(row.id)||0)+1);const key=detailKey(row);detailCounts.set(key,(detailCounts.get(key)||0)+1);}
 const catalog=candidates.filter(row=>counts.get(row.id)===1),root=doc.createElement('div'),field=doc.createElement('div'),toggle=doc.createElement('button'),list=doc.createElement('div'),status=doc.createElement('div');
 root.className='franchise-item-picker';field.className='franchise-item-picker-field';list.className='franchise-item-picker-options';status.className='franchise-item-picker-status';
 input.parentNode.insertBefore(root,input);root.append(field,list,status);field.append(input,toggle);
 input.removeAttribute('list');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',listId);input.setAttribute('aria-describedby',[previousDescription,statusId].filter(Boolean).join(' '));input.setAttribute('autocomplete','off');input.setAttribute('spellcheck','false');
 toggle.type='button';toggle.textContent='⌄';toggle.className='franchise-item-picker-toggle';toggle.setAttribute('aria-label','Show approved items');toggle.setAttribute('aria-controls',listId);toggle.setAttribute('aria-expanded','false');
 list.id=listId;list.setAttribute('role','listbox');list.setAttribute('aria-label','Approved HQ items');list.hidden=true;
 status.id=statusId;status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
 let selected=null,shown=[],active=-1,opened=false,destroyed=false;
 const listeners=[];
 function listen(target,name,callback){target.addEventListener(name,callback);listeners.push(()=>target.removeEventListener(name,callback));}
 function instructions(){status.textContent=catalog.length?`Type at least ${minChars} characters to see matching items.`:'No approved items are available. Refresh the page or ask HQ to review the catalog.';}
 function close(){opened=false;list.hidden=true;input.setAttribute('aria-expanded','false');toggle.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;doc.removeEventListener('pointerdown',outside);}
 function outside(event){if(!root.contains(event.target))close();}
 function highlight(index){active=index;for(let i=0;i<list.children.length;i++){const option=list.children[i],isActive=i===active;option.classList.toggle('is-active',isActive);option.setAttribute('aria-selected',String(isActive));}if(active>=0){const option=list.children[active];input.setAttribute('aria-activedescendant',option.id);option.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
 function choose(index){const row=shown[index];if(!row||destroyed)return;selected=row;input.value=row.name;close();status.textContent=`Selected ${row.name}. Choose the quantity and unit below.`;onSelectionChange(row.item);input.focus();}
 function show(all=false){
  if(destroyed)return;const query=searchText(input.value);if(!all&&query.length<minChars){close();instructions();return;}
  const matches=catalog.filter(row=>!query||searchText(row.name).includes(query));shown=matches.slice(0,maxResults);list.replaceChildren();
  if(shown.length){for(const [index,row]of shown.entries()){const option=doc.createElement('div'),title=doc.createElement('strong'),detail=doc.createElement('small');option.id=`${listId}-${index}`;option.className='franchise-item-picker-option';option.setAttribute('role','option');option.setAttribute('aria-selected','false');title.textContent=row.name;detail.textContent=[row.detail,detailCounts.get(detailKey(row))>1?`Reference ${row.item.itemCode||row.item.sku||row.item.barcode||row.id}`:''].filter(Boolean).join(' · ');option.append(title,detail);option.addEventListener('pointerdown',event=>{if(event.button==null||event.button===0)event.preventDefault();});option.addEventListener('click',()=>choose(index));list.append(option);}}else{const empty=doc.createElement('p');empty.className='franchise-item-picker-empty';empty.textContent='No matching approved item. Try another name.';list.append(empty);}
  opened=true;list.hidden=false;input.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','true');highlight(-1);doc.addEventListener('pointerdown',outside);
  status.textContent=matches.length?`${matches.length} matching item${matches.length===1?'':'s'}.${matches.length>maxResults?` Showing the first ${maxResults}; type more to narrow the list.`:' Use the arrow keys and Enter, or tap an item.'}`:'No matching approved item. Try another name.';
 }
 listen(input,'input',()=>{const hadSelection=selected!==null;selected=null;if(hadSelection)onSelectionChange(null);show();});
 listen(input,'focus',()=>{if(!selected&&searchText(input.value).length>=minChars)show();});
 listen(input,'keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape'){if(opened){event.preventDefault();close();}return;}
  if(event.key==='Tab'){close();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!opened)show(true);if(!shown.length)return;highlight(event.key==='ArrowDown'?(active+1)%shown.length:(active<=0?shown.length-1:active-1));return;}
  if(event.key==='Enter'&&opened){event.preventDefault();if(shown.length)choose(active>=0?active:0);}
 });
 listen(toggle,'pointerdown',event=>event.preventDefault());
 listen(toggle,'click',()=>{const wasOpen=opened;input.focus();if(wasOpen)close();else show(true);});
 listen(root,'focusout',event=>{if(!root.contains(event.relatedTarget))close();});
 instructions();
 return {
  getSelectedItem(){return !destroyed&&selected&&input.value===selected.name?selected.item:null;},
  clear(){if(destroyed)return;selected=null;input.value='';close();instructions();onSelectionChange(null);},
  destroy(){if(destroyed)return;close();destroyed=true;for(const remove of listeners)remove();selected=null;shown=[];list.replaceChildren();}
 };
}
