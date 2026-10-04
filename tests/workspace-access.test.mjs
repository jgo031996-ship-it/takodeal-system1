import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {OWNER_EMAIL,WORKSPACE_ROUTES,HR_TABS,INVENTORY_TABS,createWorkspaceSession,workspaceRole,workspaceLandingPage,canOpenWorkspacePage,canOpenHrTab,canOpenInventoryTab} from '../takodeal-manager/workspace-access-model.js';
import {applyWorkspacePermissions,installWorkspaceAccess} from '../takodeal-manager/workspace-access.js';
import {resolveHQAccount} from '../takodeal-manager/hq-account-model.js';
import {createUnlockGate,bounded} from '../takodeal-manager/unlock-gate.js';
const profile={pin:'5678',role:'Manager',permissions:['sop'],assignedBranch:'All'};
const user={uid:'sample',email:'sample@example.test',displayName:'Sample Person'};
test('Google account identity and saved role remain separate from a shared PIN',async()=>{
 const opened=[];
 for(const [email,role,permissions] of [[OWNER_EMAIL,'System Architect',['all']],['co@example.test','Co-Owner',['all']],['manager@example.test','Manager',['ledger']]]){
  const account={...profile,email,role,permissions},google={...user,email};
  const gate=createUnlockGate({verify:async()=>resolveHQAccount([{id:email,data:account}]),verifyOnUnlock:true,load:async({user,data})=>opened.push(createWorkspaceSession(user,data))});await gate.identify(google);assert.equal(await gate.unlock('5678'),true);
 }
 assert.deepEqual(opened.map(s=>s.role),['Owner','Co-Owner','Manager']);assert.deepEqual(opened.map(s=>s.email),[OWNER_EMAIL,'co@example.test','manager@example.test']);assert.equal(canOpenWorkspacePage(opened[2],'accounts'),false);assert.equal(canOpenWorkspacePage(opened[2],'ledger'),true);
});
test('a Co-Owner or Manager title never adds permissions or an unassigned dashboard',()=>{
 for(const role of ['Co-Owner','Manager']){const s=createWorkspaceSession(user,{...profile,role});assert.equal(workspaceLandingPage(s),'sop');assert.equal(canOpenWorkspacePage(s,'dashboard'),false);assert.equal(canOpenWorkspacePage(s,'posconfig'),false);assert.deepEqual(s.permissions,['sop']);}
});
test('all access is an explicit saved setting and an unknown route stays unavailable',()=>{
 const s=createWorkspaceSession(user,{...profile,permissions:['all']});for(const route of WORKSPACE_ROUTES)assert.equal(canOpenWorkspacePage(s,route),true,route);assert.equal(canOpenWorkspacePage(s,'unknown'),false);assert.equal(canOpenWorkspacePage(null,'dashboard'),false);
});
test('individual HR and inventory permissions open only the selected children',()=>{
 const s=createWorkspaceSession(user,{...profile,permissions:['ledger','audits']});assert.equal(canOpenHrTab(s,'Ledger'),true);assert.equal(canOpenHrTab(s,'Feed'),false);assert.equal(canOpenHrTab(s,'Schedule'),false);assert.equal(canOpenWorkspacePage(s,'inventory'),true);assert.equal(canOpenInventoryTab(s,'Audits'),true);assert.equal(canOpenInventoryTab(s,'Overview'),false);assert.equal(canOpenInventoryTab(s,'Waste'),false);
});
test('parent HR and Inventory grants retain all their existing children',()=>{
 const s=createWorkspaceSession(user,{...profile,permissions:['payroll','inventory']});for(const tab of Object.keys(HR_TABS))assert.equal(canOpenHrTab(s,tab),true);for(const tab of INVENTORY_TABS)assert.equal(canOpenInventoryTab(s,tab),true);assert.equal(canOpenWorkspacePage(s,'sop'),false);
});
test('Security Alerts and Low Stock Alerts can be granted separately while legacy alerts remain valid',()=>{
 const s=createWorkspaceSession(user,{...profile,permissions:['security-alerts']});assert.equal(canOpenWorkspacePage(s,'alerts'),true);assert.equal(canOpenInventoryTab(s,'Alerts'),false);
 const inventory={...s,permissions:['low-stock-alerts']};assert.equal(canOpenInventoryTab(inventory,'Alerts'),true);assert.equal(canOpenWorkspacePage(inventory,'alerts'),false);
 const legacy={...s,permissions:['alerts']};assert.equal(canOpenInventoryTab(legacy,'Alerts'),true);assert.equal(canOpenWorkspacePage(legacy,'alerts'),true);
});
test('legacy menu and simulator keys resolve to the existing combined pages',()=>{
 const s=createWorkspaceSession(user,{...profile,permissions:['products','franchise']});assert.equal(canOpenWorkspacePage(s,'menu'),true);assert.equal(canOpenWorkspacePage(s,'addons'),true);assert.equal(canOpenWorkspacePage(s,'franchise-hub'),true);assert.equal(canOpenWorkspacePage(s,'devices'),false);
});
test('inactive, identity mismatch and empty permission accounts cannot open',()=>{
 for(const data of [{...profile,active:false},{...profile,status:'Revoked'},{...profile,email:'other@example.test'},{...profile,permissions:[]},{...profile,permissions:null}])assert.throws(()=>createWorkspaceSession(user,data));
});
test('Franchise branch assignment stays explicit and session contains no credential',()=>{
 const s=createWorkspaceSession(user,{...profile,role:'Franchisee',assignedBranch:['Maa','Ecoland']});assert.deepEqual(s.allowedBranches,['Maa','Ecoland']);assert.equal(s.pin,undefined);assert.equal(s.securityPin,undefined);assert.throws(()=>createWorkspaceSession(user,{...profile,role:'Franchisee',assignedBranch:'All'}));
});
test('latest explicit permission save wins independently of newer profile/PIN edits',()=>{
 const data=resolveHQAccount([{id:'old',data:{...profile,permissions:['all'],profileUpdatedAt:{seconds:30},pinUpdatedAt:{seconds:30}}},{id:'access',data:{...profile,permissions:['ledger'],permissionsUpdatedAt:{seconds:20},profileUpdatedAt:{seconds:10},pinUpdatedAt:{seconds:10},pin:'1111'}}]);assert.equal(data.pin,'5678');assert.deepEqual(data.permissions,['ledger']);
});
function uiHarness(permissions){
 const nodes=new Map();const node=id=>nodes.get(id)||nodes.set(id,{id,style:{},textContent:'',classList:{toggle(){return true;}},querySelectorAll(){return[];},querySelector(){return null;},addEventListener(){}}).get(id);
 for(const route of WORKSPACE_ROUTES)node('nav-'+route);for(const tab of [...Object.keys(HR_TABS),...INVENTORY_TABS])node('subnav-'+tab);node('nav-products');node('hrSubmenu');node('invSubmenu');
 const calls=[],w={sessionUser:createWorkspaceSession(user,{...profile,permissions}),auth:{currentUser:user},ManagerUI:{notify:()=>calls.push('denied')},switchView:route=>calls.push('route:'+route),navToHr:tab=>calls.push('hr:'+tab),switchInvTab:tab=>calls.push('inv:'+tab),loadAccountsAndBudget:()=>calls.push('accounts-read'),loadPayrollGenerator:()=>calls.push('payroll-read'),loadInventoryData:()=>calls.push('stock-read'),loadInventoryAudits:()=>calls.push('audit-read'),loadLedger:()=>calls.push('ledger-read')};
 const d={getElementById:node,querySelector:()=>node('sidebar'),querySelectorAll:()=>[...nodes.values()].filter(n=>n.id.startsWith('nav-'))};return {nodes,calls,w,d};
}
test('sidebar hides unauthorized parents and exposes allowed children including Access Control',()=>{
 const h=uiHarness(['audits','ledger','admin']);applyWorkspacePermissions(h.w,h.d);assert.equal(h.nodes.get('nav-dashboard').style.display,'none');assert.equal(h.nodes.get('nav-inventory').style.display,'flex');assert.equal(h.nodes.get('subnav-Audits').style.display,'flex');assert.equal(h.nodes.get('subnav-Overview').style.display,'none');assert.equal(h.nodes.get('subnav-Feed').style.display,'none');assert.equal(h.nodes.get('subnav-Ledger').style.display,'flex');assert.equal(h.nodes.get('nav-admin').style.display,'flex');
});
test('denied navigation and direct loaders do not open or fetch an unauthorized module',()=>{
 const h=uiHarness(['audits','ledger']);installWorkspaceAccess(h.w,h.d);h.w.switchView('accounts');h.w.loadAccountsAndBudget();h.w.loadPayrollGenerator();h.w.switchInvTab('Overview');h.w.navToHr('Feed');assert.ok(h.calls.every(c=>c==='denied'));h.w.switchView('inventory');h.w.loadInventoryAudits();h.w.loadLedger();assert.ok(h.calls.includes('inv:Audits'));assert.ok(h.calls.includes('audit-read'));assert.ok(h.calls.includes('ledger-read'));assert.ok(!h.calls.includes('accounts-read'));
});
test('replacing saved session permissions immediately changes navigation checks',()=>{
 const h=uiHarness(['accounts']);installWorkspaceAccess(h.w,h.d);h.w.loadAccountsAndBudget();h.w.sessionUser={...h.w.sessionUser,permissions:['sop']};h.w.loadAccountsAndBudget();assert.equal(h.calls.filter(c=>c==='accounts-read').length,1);assert.equal(h.w.switchView('accounts'),false);
});
test('actual auth controller opens the selected Google account with its shared PIN and own permissions',async()=>{
 for(const [role,permissions,route] of [['Co-Owner',['all'],'dashboard'],['Manager',['ledger'],'ledger']]){
  const h=uiHarness(permissions),account={...profile,email:user.email,role,permissions,fullName:'Sample Profile'};let identify;
  h.w.auth.currentUser=user;h.w.provider={};h.w.ManagerLogin={busy(){},show(){},status(){},error(){}};h.w.query=(...args)=>args;h.w.collection=()=>({});h.w.where=()=>({});h.w.getDocsFromServer=async()=>({empty:false,docs:[{id:'sample',data:()=>account}]});h.w.dispatchEvent=()=>{};h.w.loadWorkspaceTest=async()=>{};
  const context={window:h.w,document:h.d,navigator:{onLine:true},location:{reload(){}},Event:class{},createUnlockGate,bounded,resolveHQAccount,createWorkspaceSession,workspaceRole,workspaceLandingPage,applyWorkspacePermissions,installWorkspaceAccess,loadManagerLibraries:async()=>{},prepareManagerTools(){},onAuthStateChanged:(_,fn)=>identify=fn,signInWithPopup:async()=>{},signOut:async()=>{}};
  const source=readFileSync(new URL('../takodeal-manager/auth.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/await import\('\.\/main\.js\?v=[^']+'\)/,'await window.loadWorkspaceTest()');vm.runInNewContext(source,context);identify(user);await new Promise(resolve=>setImmediate(resolve));h.nodes.get('managerPinInput').value='5678';await h.w.checkManagerPin();assert.equal(h.w.sessionUser.role,role);assert.deepEqual(h.w.sessionUser.permissions,permissions);assert.ok(h.calls.includes('route:'+route));assert.equal(h.nodes.get('loginOverlay').style.display,'none');
 }
});
