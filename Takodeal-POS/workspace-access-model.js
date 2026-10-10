export const OWNER_EMAIL = 'jgo031996@gmail.com';
export const WORKSPACE_ROUTES = ['dashboard','accounts','financial-flow','franchise-hub','transfers','payables','devices','payroll','schedule','ledger','inbox','branches','menu','dispatch','riders','zreadings','history','expenses','sop','posconfig','customerapp','equipment','inventory','purchases','alerts','bulletin','addons','admin'];
export const HR_TABS = {Feed:'feed',Schedule:'schedule',Ledger:'ledger',Sanctions:'sanctions',Inbox:'inbox'};
export const INVENTORY_TABS = ['Overview','AIBrief','Yield','Audits','Waste','Prep','StockLogs','Invoices','Forecaster','Alerts'];
export const inventoryPermission = tab => tab==='Alerts'?'low-stock-alerts':String(tab).toLowerCase();
const lower = value => String(value || '').trim().toLowerCase();
export const canonicalRoute = route => ({products:'menu',franchise:'franchise-hub'}[route] || route);
export const configuredPermissions = data => [...new Set((Array.isArray(data?.permissions)?data.permissions:[]).filter(p=>typeof p==='string').map(lower).filter(Boolean))];
export const fullWorkspaceAccess = user => lower(user?.email)===OWNER_EMAIL || configuredPermissions(user).includes('all');
export function canOpenHrTab(user,tab) {
 if(!user || !HR_TABS[tab])return false;
 const permissions=configuredPermissions(user);
 return fullWorkspaceAccess(user) || permissions.includes('payroll') || permissions.includes(HR_TABS[tab]);
}
export function canOpenInventoryTab(user,tab) {
 if(!user || !INVENTORY_TABS.includes(tab))return false;
 const permissions=configuredPermissions(user);
 return fullWorkspaceAccess(user) || permissions.includes('inventory') || permissions.includes(inventoryPermission(tab)) || tab==='Alerts' && permissions.includes('alerts');
}
export function canOpenWorkspacePage(user,route) {
 route=canonicalRoute(route);
 if(!user || !WORKSPACE_ROUTES.includes(route))return false;
 if(fullWorkspaceAccess(user))return true;
 const permissions=configuredPermissions(user);
 if(route==='payroll')return canOpenHrTab(user,'Feed') || canOpenHrTab(user,'Sanctions');
 if(['schedule','ledger','inbox'].includes(route))return canOpenHrTab(user,Object.keys(HR_TABS).find(tab=>HR_TABS[tab]===route));
 if(route==='inventory')return INVENTORY_TABS.some(tab=>canOpenInventoryTab(user,tab));
 if(route==='menu' || route==='addons')return permissions.includes(route) || permissions.includes('menu') || permissions.includes('products');
 if(route==='franchise-hub')return permissions.includes('franchise-hub') || permissions.includes('franchise');
 if(route==='alerts')return permissions.includes('security-alerts') || permissions.includes('alerts');
 return permissions.includes(route);
}
export function workspaceLandingPage(user) {return WORKSPACE_ROUTES.find(route=>canOpenWorkspacePage(user,route)) || null;}
export function workspaceRole(email,role) {
 if(lower(email)===OWNER_EMAIL)return 'Owner';
 return ({owner:'Owner','co-owner':'Co-Owner','co owner':'Co-Owner',co_owner:'Co-Owner',franchisee:'Franchise owner','franchise owner':'Franchise owner',manager:'Manager','appointed manager':'Manager'}[lower(role)] || 'Manager');
}
export function createWorkspaceSession(user,data) {
 const email=lower(user?.email);
 if(!email || data?.email && lower(data.email)!==email)throw Error('The approved account does not match the signed-in Google account.');
 if(data?.active===false || ['blocked','disabled','inactive','revoked'].includes(lower(data?.status)))throw Error('This account is inactive. Ask the owner to review its access.');
 const role=workspaceRole(email,data?.role),isFranchisee=role==='Franchise owner',permissions=configuredPermissions(data);
 const assignment=data?.assignedBranch ?? (isFranchisee?'':'All');
 const allowedBranches=[...new Set((Array.isArray(assignment)?assignment:String(assignment).split(',')).map(branch=>String(branch).trim()).filter(Boolean))];
 if(isFranchisee && (!allowedBranches.length || allowedBranches.some(branch=>lower(branch)==='all')))throw Error('Assign this franchise account to its branch before signing in.');
 const session={email,uid:user.uid,role,branch:allowedBranches[0] || 'Main Office',allowedBranches,isFranchisee,permissions,cashierName:data?.fullName || data?.name || user.displayName || 'Authorized account',isOwner:email===OWNER_EMAIL || !isFranchisee && permissions.includes('all')};
 if(!workspaceLandingPage(session))throw Error('No workspace tabs are assigned to this account. Ask the owner to select its permissions in Access Control.');
 return session;
}
