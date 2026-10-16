import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES,canVisit} from '../takodeal-franchise/franchise-data.js';
import {canOpenHrTab,canOpenInventoryTab} from '../takodeal-manager/workspace-access-model.js';

const account=permissions=>({email:'branch@example.test',branch:'Agdao',allowedBranches:['Agdao'],isFranchisee:true,permissions});
const legacyDefault=['dashboard','accounts','financial-flow','transfers','devices','payroll','inbox','dispatch','zreadings','history','expenses','branches','sop','equipment','inventory','alerts','bulletin'];
test('the exact saved legacy Franchisee default grants retain supported branch operations without adding HQ access',()=>{
 const session=account(legacyDefault);
 for(const route of ['dashboard','accounts','staff','payroll','schedule','inbox','sanctions','inv-overview','inv-audits','inv-waste','inv-prep','inv-logs','inv-alerts','b2b','history','zreadings','expenses','bulletin'])assert.equal(canVisit(session,route),true,route);
 for(const route of ['hq-billing','hq-conversations'])assert.equal(canVisit(session,route),false,route);
 assert.deepEqual(session.permissions,legacyDefault,'the compatibility check never rewrites saved grants');
});
test('separate Franchise HR routes follow the exact Owner child permission vocabulary',()=>{
 const routes={payroll:'Feed',schedule:'Schedule',inbox:'Inbox',sanctions:'Sanctions'};
 for(const permission of ['payroll','feed','schedule','inbox','sanctions','ledger','inventory','dispatch','hr','']){
  const session=account(permission?[permission]:[]);
  for(const [route,tab]of Object.entries(routes))assert.equal(canVisit(session,route),canOpenHrTab(session,tab),permission+' -> '+route);
 }
 assert.equal(canVisit(account(['sanctions']),'payroll'),false,'a notice-only grant does not expose attendance or salary');
 assert.equal(canVisit(account(['feed']),'schedule'),false);
});
test('Owner inventory child grants expose only their matching Franchise inventory page',()=>{
 const routes={'inv-overview':'Overview','inv-audits':'Audits','inv-waste':'Waste','inv-prep':'Prep','inv-logs':'StockLogs','inv-alerts':'Alerts'};
 for(const permission of ['inventory','overview','audits','waste','prep','stocklogs','low-stock-alerts','alerts','aibrief','yield','forecaster','security-alerts','']){
  const session=account(permission?[permission]:[]);
  for(const [route,tab]of Object.entries(routes))assert.equal(canVisit(session,route),canOpenInventoryTab(session,tab),permission+' -> '+route);
 }
 for(const route of Object.keys(routes)){
  const session=account([route]);assert.equal(canVisit(session,route),true);
  for(const other of Object.keys(routes).filter(value=>value!==route))assert.equal(canVisit(session,other),false,route+' must not expose '+other);
 }
 assert.equal(canVisit(account([' Payroll ',' STOCKLOGS ']),'inv-logs'),true,'saved grant spelling is normalized consistently with Owner');
});
test('HQ management and exact page grants stay separate from simulator, payroll and stock ordering',()=>{
 for(const permission of ['franchise','payroll','dispatch','inventory','ledger','']){
  for(const route of ['hq-billing','hq-conversations'])assert.equal(canVisit(account(permission?[permission]:[]),route),false,permission+' -> '+route);
 }
 for(const route of ['hq-billing','hq-conversations']){
  assert.equal(canVisit(account(['franchise-hub']),route),true);
  assert.equal(canVisit(account([route]),route),true);
  assert.equal(canVisit(account([route]),route==='hq-billing'?'hq-conversations':'hq-billing'),false);
 }
});
test('existing staff and dispatch aliases stay limited and branch scope always wins',()=>{
 assert.equal(canVisit(account(['feed']),'staff'),true);assert.equal(canVisit(account(['staff']),'staff'),true);
 assert.equal(canVisit(account(['dispatch']),'b2b'),true);assert.equal(canVisit(account(['b2b']),'b2b'),true);
 assert.equal(canVisit(account(['inventory']),'b2b'),false);assert.equal(canVisit(account(['accounts']),'staff'),false);
 assert.equal(canVisit(account(['accounts']),'expenses'),true);
 for(const route of Object.keys(ROUTES)){
  assert.equal(canVisit({...account(['all']),branch:'Maa'},route),false,route);
  assert.equal(canVisit({...account(['all']),allowedBranches:[]},route),false,route);
  assert.equal(canVisit(null,route),false,route);
 }
 assert.equal(canVisit(account(['all']),'unknown-page'),false);
});
