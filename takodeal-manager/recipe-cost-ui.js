import {STORE_SHARED_COST_BASIS,buildRecipeCostCatalog,summarizeRecipeCosts} from './recipe-cost-model.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';

const installations=new WeakMap();
export function installRecipeCostUI({window:w=globalThis.window,document:d=globalThis.document,setCosts=()=>{},now=Date.now,timeoutMs=30000}={}) {
 if(!w||!d)return null;if(installations.has(w))return installations.get(w);
 let basis=STORE_SHARED_COST_BASIS,inventory=[],catalog=buildRecipeCostCatalog([]),verified=false,checkedAt=null,message='Refresh inventory costs to verify this estimate.',pending=null,generation=0,loadedScope=null;
 const bars=new Map(),lineCells=new Map(),serverBatches=new WeakMap();
 const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const node=(tag,value,cls)=>{const result=d.createElement(tag);if(value!==undefined)result.textContent=value;if(cls)result.className=cls;return result;};
 const scope=()=>{
  const user=w.auth?.currentUser,session=w.sessionUser;
  if(!user?.uid||!user.email||!session||session.isFranchisee||session.email?.toLowerCase()!==user.email.toLowerCase()||session.uid&&session.uid!==user.uid||!canOpenWorkspacePage(session,'menu'))throw Error('Unlock your approved account before refreshing recipe costs.');
  return JSON.stringify([user.uid,user.email.toLowerCase(),session.uid,session.email,session.role,session.permissions,session.allowedBranches,session.isOwner]);
 };
 const branchAllowed=branch=>{
  if(w.auth.currentUser.email.toLowerCase()===OWNER_EMAIL)return true;
  const session=w.sessionUser,raw=session.allowedBranches??session.assignedBranch??session.branch;
  const allowed=(Array.isArray(raw)?raw:String(raw||'').split(',')).map(value=>String(value).trim()).filter(Boolean);
  return allowed.some(value=>value.toLowerCase()==='all'||value===branch);
 };
 const current=identity=>{if(scope()!==identity)throw Error('The signed-in account changed. Reopen the recipe before refreshing costs.');};
 const modalOpen=()=>{const modal=d.getElementById('advancedProductModal');return !!modal&&!modal.hidden&&modal.style.display!=='none';};
 const viewActive=id=>d.getElementById(id)?.classList?.contains('active');
 function clearCosts(copy){verified=false;inventory=[];message=copy;catalog=buildRecipeCostCatalog([],{basis});setCosts(catalog.costs);mount();}
 function rebuild(){catalog=buildRecipeCostCatalog(inventory,{basis});setCosts(catalog.costs);mount();return catalog.costs;}
 function useInventory(rows,{fresh=false}={}){
  if(!Array.isArray(rows))throw Error('Inventory cost records could not be verified.');
  const source=fresh===true?serverBatches.get(rows):null;
  if(!source){clearCosts('Refresh inventory costs to verify this estimate.');return catalog.costs;}
  try{current(source.identity);}catch(error){basis=STORE_SHARED_COST_BASIS;loadedScope=null;clearCosts(error.message);throw error;}
  if(source.generation!==generation)throw Error('A newer inventory cost check completed. Refresh this menu view.');
  if(loadedScope&&loadedScope!==source.identity)basis=STORE_SHARED_COST_BASIS;
  loadedScope=source.identity;inventory=source.rows.filter(row=>branchAllowed(row.branch)).map(row=>({...row}));verified=true;checkedAt=source.at;message='';
  return rebuild();
 }
 // A recipe save baseline is not proof that its inventory rows were confirmed
 // with server metadata. Opening a product uses freshInventory() separately.
 function useRecipeState(state){return useInventory(Object.entries(state?.documents?.inventory||{}).map(([id,row])=>({...row,id})));}
 function recipeSummary(recipe){
  let sameScope=false;try{sameScope=!!loadedScope&&scope()===loadedScope;}catch{}
  if(verified&&!sameScope){basis=STORE_SHARED_COST_BASIS;loadedScope=null;clearCosts('The signed-in account changed. Refresh inventory costs.');}
  const summary=summarizeRecipeCosts(recipe,catalog);
  if(verified&&sameScope)return {...summary,cost:summary.total,issues:summary.problems};
  const issues=[message||'Inventory costs are not verified'];
  return {...summary,valid:false,total:null,cost:null,issues,problems:issues,rows:summary.rows.map(row=>({...row,lineCost:null,issue:message||'Refresh inventory costs'}))};
 }
 function costStatus(){
  if(!verified)return message;
  const issues=Object.keys(catalog.issues).length;
  return (basis===STORE_SHARED_COST_BASIS?'Matching store base-unit costs; Main Office is separate.':'Recorded base-unit costs from '+catalog.basisLabel+'.')+(issues?' '+issues+' ingredient cost(s) need review.':'')+' Refreshed '+new Date(checkedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})+'.';
 }
 function updateBars(){for(const bar of bars.values()){
  bar.select.replaceChildren();const shared=node('option','Stores · shared cost');shared.value=STORE_SHARED_COST_BASIS;bar.select.append(shared);
  for(const branch of catalog.storeBranches){const option=node('option',branch);option.value=branch;bar.select.append(option);}
  if(catalog.branches.includes('Main Office')){const option=node('option','Main Office · HQ');option.value='Main Office';bar.select.append(option);}
  if(basis!==STORE_SHARED_COST_BASIS&&!catalog.branches.includes(basis)){const option=node('option',basis+' · no saved inventory');option.value=basis;bar.select.append(option);}
  bar.select.value=basis;bar.select.disabled=!!pending;bar.refresh.disabled=!!pending;bar.status.textContent=costStatus();bar.status.dataset.verified=String(verified);
 }}
 function mount(){
  for(const [id,key]of [['menuTableBody','menu'],['bomTableBody','costing'],['advRecipeBody','product']]){
   const body=d.getElementById(id),table=body?.closest('table');if(!table)continue;
   let bar=bars.get(key);
   if(!bar){const root=node('div',undefined,'recipe-cost-basis'),label=node('label','Cost basis'),select=node('select'),refresh=node('button','Refresh costs'),status=node('p',undefined,'recipe-cost-status');select.setAttribute('aria-label','Recipe cost basis');refresh.type='button';status.setAttribute('role','status');label.append(select);root.append(label,refresh,status);table.before(root);bar={root,select,refresh,status};bars.set(key,bar);
    select.addEventListener('change',()=>{try{current(loadedScope);basis=select.value;rebuild();renderAll();}catch{basis=STORE_SHARED_COST_BASIS;clearCosts('The signed-in account changed. Refresh inventory costs.');paintProfit();}});refresh.addEventListener('click',()=>{void refreshCosts().catch(()=>{});});
   }
  }
  updateBars();
 }
 function paintProfit(){
  const summary=recipeSummary(w.currentAdvRecipe||[]),raw=d.getElementById('advProdPrice')?.value,sell=raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;
  const put=(id,value)=>{const target=d.getElementById(id);if(target)target.textContent=value;};
  put('advTotalCost',summary.valid?money(summary.total):'Recipe cost needs review');put('profSellPrice',sell===null?'—':money(sell));
  put('profProdCost',summary.valid?money(summary.total):'—');
  const margin=summary.valid&&sell!==null?sell-summary.total:null,percent=summary.valid&&sell>0?summary.total/sell*100:null;
  put('profMargin',margin===null?'—':money(margin));put('profMarginPct',percent===null?'—':percent.toFixed(2)+'%');
  const marginNode=d.getElementById('profMargin'),percentNode=d.getElementById('profMarginPct');if(marginNode)marginNode.style.color=margin!==null&&margin<0?'#b91c1c':'#15803d';if(percentNode)percentNode.style.color=percent!==null&&percent>=50?'#b91c1c':'#111827';
  summary.rows.forEach((line,index)=>{const cell=lineCells.get(index);if(!cell)return;cell.unit.textContent=line.unit;cell.cost.textContent=line.lineCost===null?'Needs review':money(line.lineCost);cell.unitPrice.textContent=line.unitCost===null?'':'₱'+line.unitCost.toLocaleString('en-PH',{maximumFractionDigits:6})+' / '+line.unit;cell.issue.textContent=line.issue||'';cell.issue.hidden=!line.issue;});
  return summary;
 }
 function renderRecipe(){
  const body=d.getElementById('advRecipeBody');if(!body)return;mount();lineCells.clear();body.replaceChildren();
  let list=d.getElementById('inventoryDatalist');if(!list){list=node('datalist');list.id='inventoryDatalist';d.body.append(list);}list.replaceChildren();for(const name of catalog.names){const option=node('option');option.value=name;list.append(option);}
  const rows=w.currentAdvRecipe||[];
  if(!rows.length){const row=node('tr'),cell=node('td','No ingredients added yet.');cell.colSpan=5;row.append(cell);body.append(row);}
  rows.forEach((item,index)=>{
   const row=node('tr'),nameCell=node('td'),quantityCell=node('td'),unit=node('td'),costCell=node('td'),actions=node('td'),name=node('input'),quantity=node('input'),issue=node('small',undefined,'recipe-cost-issue'),cost=node('strong'),unitPrice=node('small',undefined,'recipe-cost-unit-price'),remove=node('button','Remove');
   name.type='text';name.setAttribute('list','inventoryDatalist');name.value=item.ingredientName??'';name.placeholder='Type an ingredient name';name.setAttribute('aria-label','Ingredient '+(index+1));name.addEventListener('change',()=>{w.currentAdvRecipe[index].ingredientName=name.value;renderRecipe();});
   quantity.type='number';quantity.min='0';quantity.step='any';quantity.value=item.qty??'';quantity.setAttribute('aria-label','Quantity '+(index+1));quantity.addEventListener('input',()=>{w.updateAdvRecipeQty(index,quantity.value);});quantity.addEventListener('change',()=>{w.updateAdvRecipeQty(index,quantity.value);});
   remove.type='button';remove.className='product-editor-remove';remove.setAttribute('aria-label','Remove ingredient row '+(index+1));remove.addEventListener('click',()=>w.removeAdvRecipeRow?.(index));
   nameCell.append(name,issue);quantityCell.append(quantity);costCell.append(cost,unitPrice);actions.append(remove);row.append(nameCell,quantityCell,unit,costCell,actions);body.append(row);lineCells.set(index,{unit,cost,unitPrice,issue});
  });
  paintProfit();
 }
 function renderAll(){
  if(modalOpen())renderRecipe();
  if(viewActive('view-menu')&&w.globalMenuItemsCache)w.renderMenuEditorUI?.();
  if(viewActive('view-products'))void Promise.resolve(w.loadMenuCosting?.({reuseCosts:true})).catch(()=>{});
 }
 async function freshInventory(){
  let identity;try{identity=scope();}catch(error){basis=STORE_SHARED_COST_BASIS;loadedScope=null;clearCosts(error.message);throw error;}
  if(loadedScope&&loadedScope!==identity){basis=STORE_SHARED_COST_BASIS;loadedScope=null;}
  if(pending?.identity===identity&&pending.generation===generation)return pending.promise;
  const token=++generation;clearCosts('Checking current inventory costs…');let timer;
  const promise=(async()=>{
   try{
    const snapshot=await Promise.race([Promise.resolve().then(()=>w.getDocsFromServer(w.collection(w.db,'inventory'))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Inventory costs took too long to confirm. Reconnect and refresh costs.')),timeoutMs);})]);
    current(identity);if(token!==generation)throw Error('A newer inventory cost check started. Refresh this estimate.');
    const confirmed=metadata=>metadata?.fromCache===false&&metadata?.hasPendingWrites===false;
    if(!Array.isArray(snapshot?.docs)||!confirmed(snapshot.metadata)||snapshot.docs.some(doc=>!confirmed(doc.metadata)))throw Error('Inventory costs are cached or have unconfirmed changes. Reconnect and refresh costs.');
    const rows=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));serverBatches.set(rows,{identity,rows:rows.map(row=>({...row})),at:now(),generation:token});useInventory(rows,{fresh:true});return rows;
   }catch(error){if(token===generation){clearCosts(error.message||'Inventory costs could not be confirmed.');if(modalOpen())paintProfit();}throw error;}
   finally{clearTimeout(timer);if(pending?.promise===promise)pending=null;updateBars();}
  })();
  pending={identity,promise,generation:token};updateBars();return promise;
 }
 async function refreshCosts(){try{const rows=await freshInventory();renderAll();return rows;}catch(error){renderAll();throw error;}}
 async function inventoryChanged(){
  ++generation;clearCosts('Inventory changed. Refresh costs to verify this estimate.');
  if(modalOpen()||viewActive('view-menu')||viewActive('view-products')){try{await refreshCosts();}catch(error){w.ManagerUI?.notify?.('Recipe cost refresh: '+error.message);}}
 }
 w.renderAdvRecipeTable=renderRecipe;w.calcAdvProfit=paintProfit;
 w.updateAdvRecipeQty=(index,value)=>{if(!w.currentAdvRecipe?.[index])return;w.currentAdvRecipe[index].qty=value===''?'':Number(value);paintProfit();};
 const controller={freshInventory,useInventory,useRecipeState,recipeSummary,inventoryChanged,refresh:refreshCosts,mount,getCatalog:()=>catalog,getBasis:()=>basis};
 w.recipeCostUI=controller;installations.set(w,controller);mount();return controller;
}
