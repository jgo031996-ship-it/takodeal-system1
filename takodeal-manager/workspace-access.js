import {WORKSPACE_ROUTES,HR_TABS,INVENTORY_TABS,OWNER_EMAIL,canonicalRoute,configuredPermissions,inventoryPermission,canOpenWorkspacePage,canOpenHrTab,canOpenInventoryTab,workspaceLandingPage} from './workspace-access-model.js';
import {readHQAccessState,planHQAccessChange,saveHQAccessChange,accessOperation,installHQAccessSync} from './hq-access-sync.js';
import {resolveHQAccount} from './hq-account-model.js';
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function applyWorkspacePermissions(w=window,d=document) {
 const user=w.sessionUser,show=(node,allowed)=>{if(node)node.style.display=allowed?'flex':'none';};
 d.querySelectorAll('.sidebar .nav-item').forEach(node=>show(node,canOpenWorkspacePage(user,node.id.replace('nav-',''))));
 for(const tab of Object.keys(HR_TABS))show(d.getElementById('subnav-'+tab),canOpenHrTab(user,tab));
 for(const tab of INVENTORY_TABS)show(d.getElementById('subnav-'+tab),canOpenInventoryTab(user,tab));
 const hrVisible=Object.keys(HR_TABS).some(tab=>canOpenHrTab(user,tab)) || canOpenWorkspacePage(user,'sop');
 show(d.getElementById('nav-payroll'),hrVisible);
 show(d.getElementById('nav-sop'),canOpenWorkspacePage(user,'sop'));
 show(d.getElementById('nav-inventory'),INVENTORY_TABS.some(tab=>canOpenInventoryTab(user,tab)));
}
export function installWorkspaceAccess(w=window,d=document) {
 if(w.workspaceAccessInstalled)return;
 w.workspaceAccessInstalled=true;
 installHQAccessSync(w);
 const user=()=>w.sessionUser;let lastDenied=0;
 const denied=()=>{if(Date.now()-lastDenied>1000){lastDenied=Date.now();w.ManagerUI?.notify?.('This tab is outside your saved account permissions.');}return false;};
 const wrap=(name,check)=>{const original=w[name];if(typeof original!=='function')return;w[name]=function(...args){if(!check(...args))return denied();return original.apply(this,args);};};
 const originalView=w.switchView;
 w.switchView=function(route,...args){
  route=canonicalRoute(route);if(!canOpenWorkspacePage(user(),route))return denied();
  const result=originalView?.call(this,route,...args);
  if(route==='inventory')w.switchInvTab?.(INVENTORY_TABS.find(tab=>canOpenInventoryTab(user(),tab)));
  if(route==='payroll')w.switchPayrollTab?.(canOpenHrTab(user(),'Feed')?'Feed':'Sanctions');
  return result;
 };
 wrap('switchInvTab',tab=>canOpenInventoryTab(user(),tab));
 wrap('refreshActiveInventoryTab',()=>canOpenInventoryTab(user(),w.activeInvTab || 'Overview'));
 wrap('navToHr',tab=>canOpenHrTab(user(),tab));
 wrap('switchPayrollTab',tab=>canOpenHrTab(user(),tab));
 const loaders={dashboard:['loadGlobalDashboard'],accounts:['loadAccountsAndBudget'], 'financial-flow':['loadFinancialFlow'],transfers:['loadCashExplorer','loadCashFlowHub'],payables:['loadPayablesDashboard'],devices:['loadDeviceFleet'],branches:['loadHRModule'],menu:['loadMenuEditor','loadMenuCosting'],addons:['loadGlobalAddons'],inbox:['loadInbox'],dispatch:['loadDispatchDashboard'],riders:['loadRiderManagement'],zreadings:['loadZReadingReports'],expenses:['loadExpenseLogs'],equipment:['loadEquipmentDashboard'],posconfig:['loadPosConfigHub','loadPosLayout','loadSidebarLayout'],sop:['loadSopManager','loadSopLogs'],customerapp:['loadCustomerAppHub'],bulletin:['loadAnnouncementHistory'],admin:['loadAdminDashboard','loadBranchManager'],ledger:['loadStaffLedger','loadLedger'],schedule:['loadFromCloud']};
 for(const [route,names] of Object.entries(loaders))for(const name of names)wrap(name,()=>canOpenWorkspacePage(user(),route));
 for(const name of ['loadPayrollDashboard','loadPayrollGenerator'])wrap(name,()=>canOpenHrTab(user(),'Feed'));
 wrap('loadSanctionsDashboard',()=>canOpenHrTab(user(),'Sanctions'));
 const inventoryLoaders={Overview:['loadInventoryData'],Audits:['loadInventoryAudits'],Waste:['loadWasteTabLogs'],Prep:['loadPrepBatchLogs'],StockLogs:['loadStockLogs'],Forecaster:['loadForecasterEngine'],AIBrief:['generateAIReport'],Yield:['loadYieldCalculator'],Invoices:['loadRestockInvoices'],Alerts:['loadPurchasesAndAlerts']};
 for(const [tab,names] of Object.entries(inventoryLoaders))for(const name of names)wrap(name,()=>canOpenInventoryTab(user(),tab) || tab==='Alerts' && canOpenWorkspacePage(user(),'purchases'));
 w.toggleHrDropdown=event=>{event.preventDefault();const menu=d.getElementById('hrSubmenu');if(!menu)return;const open=menu.classList.toggle('open'),icon=d.getElementById('hrDropdownIcon');if(icon)icon.textContent=open?'▲':'▼';if(!open)return;const selected=menu.querySelector('.nav-subitem.active')?.id.replace('subnav-',''),tab=canOpenHrTab(user(),selected)?selected:Object.keys(HR_TABS).find(tab=>canOpenHrTab(user(),tab));if(tab)w.navToHr?.(tab);else if(canOpenWorkspacePage(user(),'sop'))w.switchView('sop');};
 w.toggleInvDropdown=event=>{event.preventDefault();const menu=d.getElementById('invSubmenu');if(!menu)return;const open=menu.classList.toggle('open'),icon=d.getElementById('invDropdownIcon');if(icon)icon.textContent=open?'▲':'▼';if(open)w.switchInvTab?.(canOpenInventoryTab(user(),w.activeInvTab)?w.activeInvTab:INVENTORY_TABS.find(tab=>canOpenInventoryTab(user(),tab)));};
 // Capture before inline handlers so a denied click cannot run a second loader.
 d.querySelector('.sidebar')?.addEventListener('click',event=>{
  const item=event.target.closest('[onclick]');if(!item)return;const action=item.getAttribute('onclick') || '',page=action.match(/switchView\(['"]([^'"]+)/),hr=action.match(/navToHr\(['"]([^'"]+)/),inv=action.match(/switchInvTab\(['"]([^'"]+)/);
  const allowed=page?canOpenWorkspacePage(user(),page[1]):hr?canOpenHrTab(user(),hr[1]):inv?canOpenInventoryTab(user(),inv[1]):true;
  if(!allowed){event.preventDefault();event.stopImmediatePropagation();denied();}
 },true);
 w.applyPermissions=()=>applyWorkspacePermissions(w,d);
 installPermissionEditor(w,d);
 w.applyPermissions();
 return {landing:()=>workspaceLandingPage(user())};
}
function installPermissionEditor(w,d) {
 w.editManagerPermissions=async(id)=>{
  const guard=()=>{if(String(w.auth?.currentUser?.email || '').trim().toLowerCase()!==OWNER_EMAIL)throw Error('Only the main owner can change account permissions.');};
  try{
   guard();const state=await readHQAccessState(w,{id});guard();
   const record=state.rows.find(row=>row.id===id);if(!record)throw Error('This access record no longer exists. Refresh accounts.');
   const saved=record.data;if(String(saved.email).trim().toLowerCase()===OWNER_EMAIL)throw Error('The system owner account is protected.');
   const catalogue=new Map();
   for(const node of d.querySelectorAll('.sidebar [id^="nav-"],.sidebar .nav-subitem')){
    const id=node.id.replace(/^nav-|^subnav-/,''),key=HR_TABS[id] || (INVENTORY_TABS.includes(id)?inventoryPermission(id):id==='alerts'?'security-alerts':id);
    if(!key || !WORKSPACE_ROUTES.includes(key) && !Object.values(HR_TABS).includes(key) && !INVENTORY_TABS.map(inventoryPermission).includes(key) && !['products','security-alerts'].includes(key))continue;
    if(!catalogue.has(key))catalogue.set(key,(node.querySelector('.nav-text')?.textContent?.trim() || node.textContent.replace(/[0-9▼▲⌄]/g,'').trim()).replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu,'').trim());
   }
   catalogue.set('payroll','Human Resources · all HR tabs');catalogue.set('inventory','Live Inventory · all inventory tabs');catalogue.set('franchise','Franchise HQ Hub · Simulator');
   const originalPermissions=configuredPermissions(resolveHQAccount(state.rows)),permissions=originalPermissions.flatMap(permission=>permission==='alerts'?['security-alerts','low-stock-alerts']:[permission]);
   for(const permission of permissions)if(permission!=='all' && !catalogue.has(permission))catalogue.set(permission,permission+' (saved permission)');
   const all=permissions.includes('all');
   const answer=await w.Swal.fire({title:'Account permissions',html:`<p>${esc(saved.email)}</p><p>Select the tabs this Google account may open. Changing its role or sharing a PIN does not change these permissions.</p><label style="display:flex;gap:10px;align-items:center;text-align:left;margin:16px 0"><input id="workspaceAllPermission" type="checkbox" ${all?'checked':''}>All workspace tabs</label><div class="workspace-permission-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left;max-height:320px;overflow:auto">${[...catalogue].map(([key,label])=>`<label style="display:flex;gap:8px;align-items:start"><input type="checkbox" class="workspace-permission" value="${esc(key)}" ${permissions.includes(key)?'checked':''}>${esc(label)}</label>`).join('')}</div>`,width:760,showCancelButton:true,confirmButtonText:'Save permissions',showLoaderOnConfirm:true,allowOutsideClick:()=>!w.Swal.isLoading(),preConfirm:async()=>{
    try{guard();const values=d.getElementById('workspaceAllPermission').checked?['all']:[...d.querySelectorAll('.workspace-permission:checked')].map(node=>node.value);
     const plan={...planHQAccessChange(state,{type:'update',id,patch:{permissions:values}}),actor:state.actor};
     await saveHQAccessChange(w,plan,{operationId:accessOperation(w,plan)});return true;
    }catch(error){w.Swal.showValidationMessage(error.message);return false;}
   }});
   if(answer.isConfirmed){await w.loadAdminDashboard?.();await w.Swal.fire({title:'Permissions saved',text:'This account will use these permissions the next time it unlocks or reloads its workspace.',icon:'success'});}
  }catch(error){w.ManagerUI?.notify?.(error.message);}
 };
}
