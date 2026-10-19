import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureSalaryEffectiveField,installStaffSalaryDateUI,legacySalaryDateMarkup,ensureSalaryDateStyles} from '../takodeal-manager/staff-salary-date-ui.js';
test('older cached HTML loads the salary date stylesheet once, while a current page keeps its existing stylesheet',()=>{
 for(const existing of [true,false]){const links=[],d={head:{append:node=>links.push(node)},querySelector:()=>existing||links.length?{}:null,createElement:tag=>({tag,setAttribute(key,value){this[key]=value;}})};ensureSalaryDateStyles(d);ensureSalaryDateStyles(d);assert.equal(links.length,existing?0:1);if(!existing){assert.equal(links[0].rel,'stylesheet');assert.match(links[0].href,/\/takodeal-manager\/staff-salary-date-ui\.css$/);assert.equal(links[0]['data-salary-date-style'],'true');}}
});

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.style={};this.dataset={};this.value='';this.open=false;this.listeners=new Map();this._html='';}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 insertBefore(node,before){if(before===null||before===undefined){this.append(node);return;}const index=this.children.indexOf(before);if(index<0)throw Error('insertBefore target is not a direct child');node.remove();node.parentNode=this;this.children.splice(index,0,node);}
 remove(){if(this.parentNode){const nodes=this.parentNode.children;nodes.splice(nodes.indexOf(this),1);this.parentNode=null;}}
 get nextSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=String(value);}
 getAttribute(key){return this.attributes.get(key)??null;}
 matches(selector){const match=selector.match(/^([a-z]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i);if(!match)return false;const[,tag,key,value]=match;if(tag&&this.tagName!==tag.toUpperCase())return false;if(!key)return true;const found=key==='for'?this.htmlFor:this.getAttribute(key);return value===undefined?found!==null&&found!==undefined:found===value;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 addEventListener(name,handler){this.listeners.set(name,handler);}
 showModal(){this.open=true;}
 close(){this.open=false;this.listeners.get('close')?.();}
 focus(){this.focused=true;}
 set innerHTML(html){this._html=html;for(const node of [...this.children])node.remove();for(const match of html.matchAll(/<(button|input|p)\b([^>]*)>/g)){const node=new Element(match[1]);for(const attr of match[2].matchAll(/([A-Za-z][\w-]*)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]??'');this.append(node);}}
 get innerHTML(){return this._html;}
}
function fixture({existingDate=false,save=async()=>({effectiveDate:'2030-01-10'})}={}){
 const body=new Element('body'),modal=new Element('div');modal.id='employeeProfileModal';modal.style.display='flex';body.append(modal);const group=new Element('div'),rate=new Element('input');rate.id='empHourlyRate';group.append(rate);modal.append(group);
 let native=null;if(existingDate){native=new Element('input');native.id='empRateEffectiveDate';native.type='date';native.value='2030-02-09';const label=new Element('label');label.htmlFor=native.id;group.append(label,native);}
 const historyGroup=new Element('div'),history=new Element('div');history.id='masterRateHistory';historyGroup.append(history);modal.append(historyGroup);const selected=new Element('input');selected.id='empProfileId';selected.value='sample-staff';modal.append(selected);
 const document={body,createElement:tag=>new Element(tag),getElementById:id=>{const visit=node=>node.id===id?node:node.children.map(visit).find(Boolean);return visit(body);}};
 const alerts=[],w={auth:{currentUser:{uid:'sample-hq',email:'hq@example.test'}},sessionUser:{uid:'sample-hq',email:'hq@example.test'},Swal:{fire:async(...args)=>alerts.push(args)},openEmployeeProfile:id=>{selected.value=id;const input=document.getElementById('empRateEffectiveDate');if(input)input.value='2030-01-01';},addNewStaff:()=>{selected.value='';const input=document.getElementById('empRateEffectiveDate');if(input)input.value='2030-01-01';}};
 const profile={staffId:'sample-staff',cashierName:'Sample Staff',branch:'Sample Branch',hourlyRate:500,staffRateAuditId:'legacy-raise',latestRateRaise:{eventId:'legacy-raise',version:1}},audit={id:'legacy-raise',version:1,staffId:profile.staffId,staffName:profile.cashierName,branch:profile.branch,eventType:'increase',fromDailyRate:450,toDailyRate:500};
 return {document,body,modal,rate,native,selected,w,alerts,profile,audit,install:()=>installStaffSalaryDateUI(w,document,{save})};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('older profile HTML receives one usable salary date control and a synchronous calendar gesture',()=>{
 const h=fixture(),input=ensureSalaryEffectiveField(h.document,{today:'2030-01-01'});assert.equal(input.type,'date');assert.equal(input.value,'2030-01-01');assert.equal(input.required,true);assert.equal(h.modal.contains(input),true);assert.equal(input.getAttribute('aria-describedby'),'empRateEffectiveHelp');let opened=0;input.showPicker=()=>opened++;h.document.getElementById('salaryEffectiveControl').querySelector('button').onclick();assert.equal(opened,1);assert.equal(ensureSalaryEffectiveField(h.document,{today:'2040-01-01'}),input);assert.equal(input.value,'2030-01-01');assert.equal(h.modal.querySelectorAll('input').filter(node=>node.id==='empRateEffectiveDate').length,1);
});

test('an existing native input and selected date are preserved; unsupported calendar chooser focuses it',()=>{
 const h=fixture({existingDate:true}),input=ensureSalaryEffectiveField(h.document,{today:'2030-01-01'});assert.equal(input,h.native);assert.equal(input.value,'2030-02-09');assert.equal(input.type,'date');h.document.getElementById('salaryEffectiveControl').querySelector('button').onclick();assert.equal(input.focused,true);input.focused=false;input.showPicker=()=>{throw Error('gesture unsupported');};h.document.getElementById('salaryEffectiveControl').querySelector('button').onclick();assert.equal(input.focused,true);
});

test('installer mounts before legacy profile callbacks reset the date, without writing business records',()=>{
 const h=fixture(),first=h.install();assert.equal(h.install(),first);h.w.openEmployeeProfile('sample-staff');assert.equal(h.document.getElementById('empRateEffectiveDate').value,'2030-01-01');h.w.addNewStaff();assert.equal(h.selected.value,'');assert.equal(h.document.getElementById('empRateEffectiveDate').value,'2030-01-01');assert.equal(h.alerts.length,0);
});

test('legacy increase public markup escapes dynamic values and leaves the date an explicit management choice',()=>{
 const html=legacySalaryDateMarkup({cashierName:'<script>unsafe</script>'},{fromDailyRate:450,toDailyRate:500});assert.match(html,/Set effective date/);assert.match(html,/Paid payslips stay as saved/);assert.doesNotMatch(html,/<script>|value="\d{4}-\d{2}-\d{2}"/);const h=fixture();h.install();h.w.renderSalaryEffectiveDateActions({...h.profile,cashierName:'<img src=x onerror=alert(1)>'},[{...h.audit,staffName:'<img src=x onerror=alert(1)>'}]);h.document.getElementById('salaryLegacyDateActions').querySelector('button').onclick();const dialog=h.body.children.find(node=>node.tagName==='DIALOG');assert.match(dialog.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(dialog.innerHTML,/<img src=x/);assert.equal(dialog.querySelector('input').value,'');
});

test('legacy dialog validates the selected date, preserves retry identity and cannot repaint another profile after acknowledgement',async()=>{
 const calls=[],gate=deferred();const h=fixture({save:async(...args)=>{calls.push(args);if(calls.length===1)throw Error('Acknowledgement not confirmed');return gate.promise;}});h.install();h.w.renderSalaryEffectiveDateActions(h.profile,[h.audit]);h.document.getElementById('salaryLegacyDateActions').querySelector('button').onclick();const dialog=h.body.children.find(node=>node.tagName==='DIALOG'),input=dialog.querySelector('input'),save=dialog.querySelector('[data-save]');await save.onclick();assert.equal(calls.length,0);assert.match(dialog.querySelector('[data-status]').textContent,/valid effective date/);input.value='2030-01-10';await save.onclick();assert.equal(calls.length,1);assert.match(dialog.querySelector('[data-status]').textContent,/not confirmed/);const pending=save.onclick();await Promise.resolve();assert.equal(calls.length,2);assert.equal(calls[1][3].operationId,calls[0][3].operationId);assert.equal(calls[1][3].effectiveDate,'2030-01-10');assert.equal(calls[1][3].expectedRate,500);h.w.openEmployeeProfile('different-staff');gate.resolve({effectiveDate:'2030-01-10'});await pending;assert.equal(h.w.staffSalaryDateReopenRequired,null);assert.equal(h.alerts.length,0);assert.equal(h.document.getElementById('salaryLegacyDateActions'),undefined);
});

test('a queued legacy date save cannot dispatch under an account switched before its first service call',async()=>{
 let calls=0;const h=fixture({save:async()=>{calls++;return{effectiveDate:'2030-01-10'};}});h.install();h.w.renderSalaryEffectiveDateActions(h.profile,[h.audit]);h.document.getElementById('salaryLegacyDateActions').querySelector('button').onclick();const dialog=h.body.children.find(node=>node.tagName==='DIALOG');dialog.querySelector('input').value='2030-01-10';const pending=dialog.querySelector('[data-save]').onclick();h.w.auth.currentUser={uid:'different-hq',email:'different@example.test'};h.w.sessionUser={uid:'different-hq',email:'different@example.test'};await pending;assert.equal(calls,0);assert.equal(h.alerts.length,0);assert.equal(h.w.staffSalaryDateReopenRequired,undefined);
});

test('an uncertain deadline reuses the same physical date save instead of starting duplicate cloud requests',async()=>{
 const normalTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,ms,...args)=>normalTimeout(callback,ms===25000?5:ms,...args);
 const gate=deferred();let calls=0;const h=fixture({save:async()=>{calls++;return gate.promise;}});
 try{h.install();h.w.renderSalaryEffectiveDateActions(h.profile,[h.audit]);h.document.getElementById('salaryLegacyDateActions').querySelector('button').onclick();const dialog=h.body.children.find(node=>node.tagName==='DIALOG'),save=dialog.querySelector('[data-save]');dialog.querySelector('input').value='2030-01-10';await save.onclick();assert.match(dialog.querySelector('[data-status]').textContent,/not confirmed/);await save.onclick();assert.equal(calls,1);assert.equal(h.alerts.length,0);assert.equal(dialog.querySelector('input').disabled,false);}
 finally{gate.resolve({effectiveDate:'2030-01-10'});await new Promise(resolve=>setImmediate(resolve));globalThis.setTimeout=normalTimeout;}
});
