import test from 'node:test';
import assert from 'node:assert/strict';
import {installPayrollMessenger} from '../takodeal-manager/payroll-messenger.js';
import {ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {ReviewDocument,drain,deferred} from './helpers/review-dom.mjs';
const staffId='sample-staff',name='Sample Employee',branch='Maa',start='2026-10-16',end='2026-10-31';
function fixture({saved=true,profile={},present}={}){
 const h=firestoreHarness(),document=new ReviewDocument(),create=document.createElement.bind(document),uid='sample-owner',email='jgo031996@gmail.com';
 document.createElement=tag=>{const node=create(tag);node.remove=function(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;};return node;};
 const button=document.createElement('button');button.id='btnPreparePayrollMessenger';button.innerText='Prepare Messenger';document.body.append(button);
 const data={staffId,name,branch,start,end,isPaid:true,basicPay:5400,nightBonus:450,meals:1124.5,finalNetPay:4725.5,profile:{staffId,cashierName:name,branch}},calls={notices:[],present:[],clipboard:[],downloads:0};
 const api=h.api;Object.assign(api,{auth:{currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid,email,isOwner:true,isFranchisee:false,role:'Owner',permissions:['payroll'],allowedBranches:['All']},isBranchAllowed:()=>true,currentPayslipData:data,ManagerUI:{notify:text=>calls.notices.push(text)},navigator:{clipboard:{writeText:async text=>{calls.clipboard.push(text);}}},downloadPayslipImage:async()=>{calls.downloads++;return {filename:'Sample_saved_payslip.png'};}});
 h.put('hq_managers/'+uid,{email,cashierName:'Example Owner',pin:'fixture-only',role:'System Architect',permissions:['payroll'],assignedBranch:'All'});
 h.put('cashiers/'+staffId,{cashierName:name,branch,messengerUrl:'https://m.me/sample.employee',messengerPayslipPrompt:false,...profile});
 if(saved)h.put('payroll_records/'+ordinaryPayrollId(staffId,start,end),{staffId,staffName:name,branch,startDate:start,endDate:end,finalNetPay:4725.5,accountId:'saved-bank',accountName:'Original Bank',frozenData:structuredClone(data)});
 api.getDocFromServer=async ref=>({id:ref.id,ref,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const presentSaved=async(result,context)=>{calls.present.push({result,context});context.assertCurrent();if(present)return present(result,context,api);const {assertCurrent,...person}=context,shown={...structuredClone(result.frozenData),...person,isPaid:true,finalNetPay:result.finalNetPay};api.currentPayslipData=shown;return shown;};
 const ui=installPayrollMessenger(api,document,{presentSaved,timeoutMs:1000});return {h,api,document,calls,data,ui,node:selector=>document.querySelector(selector)};
}
test('manual preparation freshly confirms paid payroll/contact, renders a replacement saved view and never writes business records',async()=>{
 const f=fixture(),before=structuredClone([...f.h.docs]),result=await f.ui.prepare();assert.equal(result.prepared,true);assert.equal(f.calls.present.length,1);assert.notEqual(f.api.currentPayslipData,f.data);assert.equal(f.node('dialog').open,true);assert.match(f.node('[data-net]').textContent,/4,725\.50/);assert.match(f.node('[data-status]').textContent,/No message has been sent/);assert.equal(f.node('[data-open]').href,'https://m.me/sample.employee');assert.equal(f.node('[data-open]').attributes.rel,'noopener noreferrer');assert.deepEqual([...f.h.docs],before);assert.equal(f.calls.clipboard.length,0);assert.equal(f.calls.downloads,0);
});
test('copy, download and saved-link controls require explicit gestures and never mark the payslip sent or delivered',async()=>{
 const f=fixture();await f.ui.prepare();const before=structuredClone([...f.h.docs]);f.node('[data-copy]').click();await drain();assert.equal(f.calls.clipboard.length,1);assert.match(f.calls.clipboard[0],/2026-10-16 to 2026-10-31/);assert.match(f.calls.clipboard[0],/₱4,725\.50/);f.node('[data-download]').click();await drain();assert.equal(f.calls.downloads,1);assert.match(f.node('[data-status]').textContent,/tap Send yourself/);assert.deepEqual([...f.h.docs],before);assert.doesNotMatch(f.node('[data-status]').textContent,/delivered|message sent/i);
});
test('an unpaid or unavailable server record cannot open sharing or change any financial record',async()=>{
 const f=fixture({saved:false}),before=structuredClone([...f.h.docs]);f.data.isPaid=false;assert.equal(await f.ui.prepare(),false);assert.equal(f.node('dialog'),null);assert.equal(f.calls.present.length,0);assert.match(f.calls.notices.at(-1),/No confirmed paid payroll/);assert.deepEqual([...f.h.docs],before);
});
test('invalid or missing saved contact cannot present a recipient or start any external action',async()=>{
 for(const messengerUrl of ['', 'https://facebook.com.evil.example.test/name','javascript:alert(1)']){
  const f=fixture({profile:{messengerUrl}});assert.equal(await f.ui.prepare(),false);assert.equal(f.node('dialog'),null);assert.equal(f.calls.present.length,0);assert.equal(f.calls.downloads,0);assert.equal(f.calls.clipboard.length,0);
 }
});
test('fresh profile prompt is opt-in only and the off setting avoids even the saved-payment query',async()=>{
 for(const messengerPayslipPrompt of [undefined,false,'true']){const f=fixture({profile:{messengerPayslipPrompt}});let queries=0;const read=f.api.getDocsFromServer;f.api.getDocsFromServer=async ref=>{queries++;return read(ref);};assert.equal(await f.ui.offer(),false);assert.equal(queries,0);assert.equal(f.node('dialog'),null);}
 const f=fixture({profile:{messengerPayslipPrompt:true}});assert.equal((await f.ui.offer()).prepared,true);assert.equal(f.calls.downloads,0);assert.equal(f.calls.clipboard.length,0);
});
test('changing the selected recipient during the fresh contact read stops the old preparation',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{entered.resolve();await gate.promise;return read(ref);};const work=f.ui.prepare();await entered.promise;f.api.currentPayslipData={...f.data,staffId:'another-staff',name:'Another Employee'};gate.resolve();assert.equal(await work,false);assert.equal(f.calls.present.length,0);assert.equal(f.node('dialog'),null);
});
test('account changes during reads and after opening cannot copy, download or navigate the old recipient link',async()=>{
 const f=fixture();await f.ui.prepare();f.api.auth.currentUser.uid='another-owner';f.node('[data-copy]').click();f.node('[data-download]').click();const event=f.node('[data-open]').emit('click');await drain();assert.equal(event.defaultPrevented,true);assert.equal(f.calls.clipboard.length,0);assert.equal(f.calls.downloads,0);
 const g=fixture(),gate=deferred(),entered=deferred(),read=g.api.getDocFromServer;g.api.getDocFromServer=async ref=>{entered.resolve();await gate.promise;return read(ref);};const work=g.ui.prepare();await entered.promise;g.api.auth.currentUser.uid='another-owner';gate.resolve();assert.equal(await work,false);assert.equal(g.node('dialog'),null);
});
test('duplicate preparation shares its physical read and timeout cannot later display or start a second read',async t=>{
 const f=fixture(),gate=deferred(),entered=deferred(),read=f.api.getDocFromServer;let reads=0;f.api.getDocFromServer=async ref=>{reads++;entered.resolve();await gate.promise;return read(ref);};t.mock.timers.enable({apis:['setTimeout']});const first=f.ui.prepare(),second=f.ui.prepare();assert.strictEqual(first,second);await entered.promise;t.mock.timers.tick(1000);assert.equal(await first,false);assert.equal(await f.ui.prepare(),false);assert.equal(reads,1);gate.resolve();await drain();assert.equal(f.calls.present.length,0);assert.equal(f.node('dialog'),null);f.api.getDocFromServer=read;assert.equal((await f.ui.prepare()).prepared,true);
});
test('cached, failed or mismatched current profile evidence cannot expose a saved contact',async()=>{
 for(const failure of ['cache','network','name','branch']){
  const f=fixture(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{if(failure==='network')throw Error('Contact read offline');const snap=await read(ref);if(failure==='cache')return {...snap,metadata:{fromCache:true}};return {...snap,data:()=>({...snap.data(),[failure==='name'?'cashierName':'branch']:failure==='name'?'Different Employee':'Cabantian'})};};assert.equal(await f.ui.prepare(),false);assert.equal(f.node('dialog'),null);assert.equal(f.calls.present.length,0);
 }
});
test('a download failure reports only an image problem and preserves the confirmed paid state',async()=>{
 const f=fixture();await f.ui.prepare();const before=structuredClone([...f.h.docs]);f.api.downloadPayslipImage=async()=>null;f.node('[data-download]').click();await drain();assert.match(f.calls.notices.at(-1),/paid payroll remains saved/);assert.equal(f.api.currentPayslipData.isPaid,true);assert.equal(f.api.currentPayslipData.finalNetPay,4725.5);assert.deepEqual([...f.h.docs],before);assert.equal(f.node('[data-download]').disabled,false);
});
test('names are text-only, same-cutoff replacement objects are allowed and a disposed dialog cannot reopen from a late read',async()=>{
 const f=fixture(),unsafe='Sample <img src=x onerror=alert(1)> Employee';f.data.name=unsafe;f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),cashierName:unsafe});const id=ordinaryPayrollId(staffId,start,end),saved=f.h.get('payroll_records/'+id);f.h.put('payroll_records/'+id,{...saved,staffName:unsafe,frozenData:{...saved.frozenData,name:unsafe}});await f.ui.prepare();assert.equal(f.node('[data-person]').textContent,unsafe+' · Maa');assert.equal(f.document.querySelector('img'),null);assert.notEqual(f.api.currentPayslipData,f.data);
 const g=fixture(),gate=deferred(),entered=deferred(),read=g.api.getDocFromServer;g.api.getDocFromServer=async ref=>{entered.resolve();await gate.promise;return read(ref);};const work=g.ui.prepare();await entered.promise;g.ui.dispose();gate.resolve();assert.equal(await work,false);assert.equal(g.node('dialog'),null);assert.equal(g.calls.present.length,0);
});
test('the recipient link comes from the fresh authoritative profile rather than cached payslip contact data',async()=>{
 const f=fixture({profile:{messengerUrl:'https://messenger.com/t/00998877'}});f.data.profile.messengerUrl='https://m.me/outdated.cached.contact';await f.ui.prepare();assert.equal(f.node('[data-open]').href,'https://messenger.com/t/00998877');
});
test('a presentation callback cannot replace the selected employee or expose a record that remains unpaid',async()=>{
 for(const patch of [{staffId:'foreign-staff',name:'Foreign Employee'},{isPaid:false}]){
  const f=fixture({present:(result,context,api)=>{const {assertCurrent,...person}=context;return api.currentPayslipData={...result.frozenData,...person,...patch};}});assert.equal(await f.ui.prepare(),false);assert.equal(f.node('dialog'),null);assert.equal(f.calls.downloads,0);assert.equal(f.calls.clipboard.length,0);
 }
});
test('a cutoff or saved-amount contradiction remains held for review and cannot become an ordinary sharing preview',async()=>{
 for(const patch of [{endDate:'2026-10-15'},{finalNetPay:1}]){
  const f=fixture(),id=ordinaryPayrollId(staffId,start,end),record=f.h.get('payroll_records/'+id);f.h.put('payroll_records/'+id,{...record,...patch});const before=structuredClone([...f.h.docs]);assert.equal(await f.ui.prepare(),false);assert.equal(f.node('dialog'),null);assert.equal(f.calls.present.length,0);assert.deepEqual([...f.h.docs],before);
 }
});
