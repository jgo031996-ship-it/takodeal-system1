import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installOwnerPublicInquiries} from '../takodeal-manager/owner-public-inquiries.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.disabled=false;this.hidden=false;this.text='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.text='';this.children=[...nodes];}
 set textContent(value){this.text=String(value);this.children=[];}
 get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
 set innerHTML(_value){throw Error('Public submissions must never enter an HTML parser.');}
 setAttribute(key,value){assert.doesNotMatch(key,/^on/i);this.attributes[key]=value;}
}
const descendants=node=>[node,...node.children.flatMap(descendants)],hold=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const nasty='<img src=x onerror="globalThis.publicLeadXss=true"> & </td><script>globalThis.publicLeadXss=true</script>',leadId="lead');globalThis.publicLeadXss=true;('",path='franchise_leads/'+leadId;
function fixture(){
 const h=firestoreHarness(),body=new Element('tbody'),document={getElementById:id=>id==='franLeadsBody'?body:null,createElement:tag=>new Element(tag)},calls={queries:[],transactions:0},user={uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true,providerData:[{providerId:'google.com'}]};
 h.put(path,{name:nasty,phone:nasty,email:nasty,location:nasty,status:'Pending',formatInterest:'kiosk',timestamp:new Date('2026-11-09T00:00:00Z'),id:'attacker-selected-redirect'});
 h.put('franchise_leads/attacker-selected-redirect',{name:'Another inquiry',status:'Pending'});
 const api={...h.api,auth:{currentUser:user},sessionUser:{uid:user.uid,email:user.email,permissions:['all'],allowedBranches:['All']},orderBy:(field,direction)=>({field,direction}),limit:value=>({limit:value}),getDocsFromServer:async query=>{calls.queries.push(query);return {metadata:{fromCache:false,hasPendingWrites:false},docs:[{id:leadId,data:()=>structuredClone(h.get(path)),metadata:{fromCache:false,hasPendingWrites:false}}]};},getDocFromServer:async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}}),runTransaction:(db,callback)=>{calls.transactions++;return h.api.runTransaction(db,callback);}};
 return{h,api,body,document,calls,ui:installOwnerPublicInquiries(api,document),button:()=>descendants(body).find(node=>node.tagName==='button')};
}
test('actual Owner lead hooks render malicious public fields as text and bind the exact hostile document ID without executable attributes',async()=>{
 const f=fixture(),source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.loadFranchiseLeads = async function()'),end=source.indexOf('// ==========================================\n// 📊 TAB 1:',start);assert.ok(start>=0&&end>start);
 vm.runInNewContext(source.slice(start,end),{window:f.api,document:f.document,installOwnerPublicInquiries});assert.equal(await f.api.loadFranchiseLeads(),true);
 assert.equal(descendants(f.body).some(node=>['img','script','a','iframe'].includes(node.tagName)),false);assert.equal(f.body.textContent.split(nasty).length-1,4);assert.equal(f.calls.queries[0].table,'franchise_leads');assert.ok(f.calls.queries[0].filters.some(rule=>rule.limit===201));
 assert.equal(await f.button().onclick(),true);assert.equal(f.h.get(path).status,'Contacted');assert.equal(f.h.get('franchise_leads/attacker-selected-redirect').status,'Pending');assert.equal(f.calls.transactions,1);assert.equal(f.button().disabled,true);assert.match(f.button().textContent,/Contacted/);assert.equal(globalThis.publicLeadXss,undefined);
});
test('repeated clicks share one contact update and retain every public submission field',async()=>{
 const f=fixture();await f.ui.load();const gate=hold(),read=f.api.getDocFromServer,old=structuredClone(f.h.get(path));f.api.getDocFromServer=async ref=>{await gate.promise;return read(ref);};const first=f.button().onclick(),second=f.button().onclick();assert.equal(f.button().disabled,true);gate.resolve();assert.equal(await first,true);assert.equal(await second,true);assert.equal(f.calls.transactions,1);assert.deepEqual(f.h.get(path),{...old,status:'Contacted'});
});
test('an account change, narrowed permissions or refreshed list cannot apply a retained lead button after its fresh read',async()=>{
 for(const change of ['account','permissions','list']){const f=fixture();await f.ui.load();const gate=hold(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const result=await read(ref);await gate.promise;return result;};const pending=f.button().onclick();if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser,uid:'other-owner'};if(change==='permissions')f.api.sessionUser.permissions=[];if(change==='list')await f.ui.load();gate.resolve();assert.equal(await pending,false,change);assert.equal(f.calls.transactions,0);assert.equal(f.h.get(path).status,'Pending');}
});
test('a source changed inside the real contact transaction cannot be marked from an older displayed inquiry',async()=>{
 const f=fixture();await f.ui.load();const run=f.api.runTransaction;f.api.runTransaction=(db,callback)=>{f.h.put(path,{...f.h.get(path),phone:'Fresh corrected contact'});return run(db,callback);};assert.equal(await f.button().onclick(),false);assert.equal(f.h.get(path).status,'Pending');assert.equal(f.h.get(path).phone,'Fresh corrected contact');assert.match(f.body.textContent,/inquiry changed/);
});
test('late query results cannot expose another account’s inquiries and global CRM scope is required before reading',async()=>{
 const f=fixture(),gate=hold(),read=f.api.getDocsFromServer;f.api.getDocsFromServer=async query=>{const result=await read(query);await gate.promise;return result;};const pending=f.ui.load();f.api.auth.currentUser={...f.api.auth.currentUser,uid:'other-owner'};gate.resolve();assert.equal(await pending,false);assert.equal(f.body.textContent.includes(nasty),false);
 const g=fixture();g.api.auth.currentUser.email='branch-crm@example.test';g.api.sessionUser.email='branch-crm@example.test';g.api.sessionUser.permissions=['crm'];g.api.sessionUser.allowedBranches=['Sample Branch'];assert.equal(await g.ui.load(),false);assert.equal(g.calls.queries.length,0);assert.equal(g.body.textContent.includes(nasty),false);
});
test('active Customer feedback acknowledgments never interpolate submitted public text and no active feedback feed exists',()=>{
 const source=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8'),start=source.indexOf('window.submitFeedbackSuggestion = async function()'),end=source.indexOf('// 👤 USER PROFILE',start),handler=source.slice(start,end);assert.ok(start>=0&&end>start);assert.match(handler,/text: 'HQ has received your message\.'/);assert.doesNotMatch(handler,/html:.*feedbackText|\$\{feedbackText\}/);
 const manager=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.doesNotMatch(manager,/collection\([^\n]*["']customer_feedback["']/);
});
