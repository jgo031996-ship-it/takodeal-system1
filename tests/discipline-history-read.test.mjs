import test from 'node:test';
import assert from 'node:assert/strict';
import {installDisciplineCases} from '../takodeal-manager/discipline-case-ui.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {ReviewDocument,ReviewElement,drain} from './helpers/review-dom.mjs';

// Run the production dashboard, delegated click handler, case reader and history
// service. Only the DOM and Firestore boundary use fictional data.
Object.defineProperty(ReviewElement.prototype,'style',{get(){return this._style||={};},configurable:true});
ReviewElement.prototype.hasAttribute=function(name){return Object.hasOwn(this.attributes,name);};
ReviewElement.prototype.matches=function(selector){return selector.split(',').some(raw=>{const one=raw.trim();if(one[0]==='[')return this.hasAttribute(one.slice(1,-1));if(one[0]==='#')return this.id===one.slice(1);if(one[0]==='.')return String(this.className||this.attributes.class||'').split(/\s+/).includes(one.slice(1));return this.tagName.toLowerCase()===one;});};
class Document extends ReviewDocument{
 constructor(){super();this.events=[];}
 addEventListener(type,fn,capture=false){this.events.push({type,fn,capture});}
 click(target){const event={target,preventDefault(){},stopImmediatePropagation(){}};for(const listener of this.events.filter(row=>row.type==='click'))listener.fn(event);}
}
const branch='Sample Branch',staffName='Sample Crew';
const legacyNotice=extra=>({staffName,branch,type:'Earlier procedure report',status:'Cancelled',timestamp:new Date('2026-09-10T04:00:00Z'),details:'Original earlier incident facts retained for history.',staffReply:'Original staff explanation retained for history.',signatureBase64:'data:image/png;base64,eA==',evidencePhoto:'https://example.invalid/earlier-evidence.png',...extra});
function fixture(row){
 const h=firestoreHarness(),d=new Document(),reads=[],writes=[],dialogs=[];
 d.body.innerHTML='<select id="sanctionBranchFilter"><option value="All">All</option></select><button id="disciplineSettingsButton"></button><table><tbody id="sanctionsTableBody"></tbody></table>';
 h.put('hq_managers/owner',{email:OWNER_EMAIL,role:'Owner',permissions:['all'],assignedBranch:'All',pin:'sample-only',active:true});
 h.put('cashiers/staff',{cashierName:staffName,branch,active:true});
 h.put('hr_sanctions/earlier-notice',row);
 Object.assign(h.api,{auth:{currentUser:{uid:'sample-owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-owner',email:OWNER_EMAIL,isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,orderBy:()=>null,query:(ref,...filters)=>({...ref,filters:filters.filter(Boolean)}),Swal:{fire:async value=>dialogs.push(value)},ManagerUI:{notify:value=>dialogs.push(value)}});
 const readMany=h.api.getDocsFromServer;
 h.api.getDocsFromServer=async query=>{reads.push({table:query.table,filters:query.filters});return readMany(query);};
 h.api.getDocFromServer=async ref=>{
  reads.push({path:ref.path});
  // Firestore rejects reserved document IDs. A permissive map-only reader hid
  // the previous cashiers/__missing__ request from the UI regression tests.
  if(/^__.*__$/.test(ref.id))throw Error('Resource id "'+ref.id+'" is invalid because it is reserved.');
  return {id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}};
 };
 for(const name of ['runTransaction','addDoc','setDoc','updateDoc','deleteDoc'])h.api[name]=async()=>{writes.push(name);assert.fail('Viewing case history must not write records.');};
 const ui=installDisciplineCases(h.api,d);
 return {h,d,ui,reads,writes,dialogs,body:()=>d.getElementById('disciplineCaseReview').querySelector('.discipline-dialog-body'),async openFromList(){await ui.loadDashboard();const button=d.getElementById('sanctionsTableBody').querySelectorAll('[data-discipline-review]').find(el=>el.dataset.disciplineReview==='earlier-notice');assert.ok(button);assert.equal(button.textContent,'View case & history');d.click(button);await drain();}};
}

for(const staffId of [undefined,null,''])test('cancelled earlier notice with '+String(staffId)+' staff link opens read-only without a reserved placeholder lookup',async()=>{
 const row=legacyNotice(staffId===undefined?{}:{staffId}),f=fixture(row),before=structuredClone([...f.h.docs]);
 await f.openFromList();
 assert.doesNotMatch(f.body().textContent,/Resource id .* is invalid because it is reserved/);
 assert.match(f.body().innerHTML,/Earlier notice · number not recorded/);
 assert.match(f.body().innerHTML,/Original earlier incident facts retained for history/);
 assert.match(f.body().innerHTML,/Original staff explanation retained for history/);
 assert.match(f.body().innerHTML,/Staff acknowledgement signature/);
 assert.match(f.body().innerHTML,/View evidence photo/);
 assert.match(f.body().innerHTML,/Finding not recorded/);
 assert.ok(f.d.querySelector('[data-review-close]'));
 assert.equal(f.d.querySelector('[data-review-save]'),null);
 assert.deepEqual(f.reads.filter(ref=>ref.path),[{path:'hr_sanctions/earlier-notice'}]);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.dialogs,[]);assert.deepEqual([...f.h.docs],before);
});

test('linked cancelled notice keeps real staff history, excludes another staff ID and remains read-only',async()=>{
 const f=fixture(legacyNotice({staffId:'staff'}));
 f.h.put('hr_sanctions/earlier-same-person',legacyNotice({type:'Legitimate earlier history'}));
 f.h.put('hr_sanctions/other-person',legacyNotice({staffId:'different-staff',type:'OTHER STAFF PRIVATE HISTORY'}));
 const before=structuredClone([...f.h.docs]);await f.openFromList();
 assert.match(f.body().innerHTML,/Earlier case history/);
 assert.match(f.body().innerHTML,/1 earlier case\(s\) across incident types/);
 assert.match(f.body().innerHTML,/Legitimate earlier history/);
 assert.match(f.body().innerHTML,/Cancelled/);
 assert.doesNotMatch(f.body().innerHTML,/OTHER STAFF PRIVATE HISTORY/);
 assert.ok(f.reads.some(ref=>ref.path==='cashiers/staff'));
 assert.ok(f.reads.some(ref=>ref.path==='settings/discipline_case_staff'));
 assert.ok(f.reads.some(ref=>ref.table==='hr_sanctions'&&ref.filters.some(filter=>filter.key==='staffId'&&filter.value==='staff')));
 assert.equal(f.d.querySelector('[data-review-save]'),null);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.dialogs,[]);assert.deepEqual([...f.h.docs],before);
});
