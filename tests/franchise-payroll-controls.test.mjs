import test from 'node:test';
import assert from 'node:assert/strict';
import {installFranchisePayrollControls,currentPayrollCutoff,halfMonthPayrollCutoff,validatePayrollCutoff,payrollCutoffQueryRange} from '../takodeal-franchise/franchise-payroll-controls.js';

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.value='';this.disabled=false;this.hidden=false;this.textContent='';}
 append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 removeAttribute(name){delete this.attributes[name];}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
 emit(type){const event={preventDefault(){this.defaultPrevented=true;}};for(const listener of this.listeners.get(type)||[])listener(event);return event;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
}
function fixture(options={}){
 const document={createElement:tag=>new Element(tag)},root=new Element('div'),calls=[],errors=[];let branch='Sample Franchise',day='2026-10-24';
 const ui=installFranchisePayrollControls({root,document,branch:()=>branch,today:()=>day,onApply:async range=>{calls.push(range);if(options.onApply)await options.onApply(range);},onError:error=>errors.push(error.message),...options.controls});
 const all=()=>{const list=[];function visit(node){list.push(node);for(const child of node.children)visit(child);}visit(root);return list;};
 const node=key=>all().find(item=>Object.hasOwn(item.attributes,'data-payroll-'+key));
 const cls=key=>all().find(item=>String(item.className).split(' ').includes(key));
 const change=(key,value,type='input')=>{const input=node(key);input.value=value;input.emit(type);return input;};
 return {root,ui,calls,errors,node,cls,change,setBranch:value=>branch=value,setToday:value=>day=value};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const drain=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('current PH date chooses the correct semi-monthly cutoff without any load',()=>{
 for(const [day,expected]of [['2026-10-01',{start:'2026-10-01',end:'2026-10-15'}],['2026-10-15',{start:'2026-10-01',end:'2026-10-15'}],['2026-10-16',{start:'2026-10-16',end:'2026-10-31'}],['2026-12-31',{start:'2026-12-16',end:'2026-12-31'}]])assert.deepEqual(currentPayrollCutoff(day),expected);
 const f=fixture();assert.deepEqual(f.ui.getRange(),{start:'2026-10-16',end:'2026-10-31'});assert.deepEqual(f.calls,[]);assert.match(f.cls('payroll-cutoff-applied').textContent,/Sample Franchise.*2026-10-16 to 2026-10-31/);
});
test('standard cutoffs retain actual month lengths, leap days and December',()=>{
 assert.deepEqual(halfMonthPayrollCutoff('2026-02','second'),{start:'2026-02-16',end:'2026-02-28'});
 assert.deepEqual(halfMonthPayrollCutoff('2028-02','second'),{start:'2028-02-16',end:'2028-02-29'});
 assert.deepEqual(halfMonthPayrollCutoff('2026-04','second'),{start:'2026-04-16',end:'2026-04-30'});
 assert.deepEqual(halfMonthPayrollCutoff('2026-12','second'),{start:'2026-12-16',end:'2026-12-31'});
 assert.deepEqual(halfMonthPayrollCutoff('2028-02','first'),{start:'2028-02-01',end:'2028-02-15'});
 for(const values of [['2026-13','first'],['bad','second'],['2026-02','other']])assert.throws(()=>halfMonthPayrollCutoff(...values),/valid cutoff month/);
});
test('calendar validation rejects overflow, missing, reversed and excessively long cutoffs',()=>{
 for(const range of [null,{start:'',end:''},{start:'2026-02-29',end:'2026-03-01'},{start:'2026-04-31',end:'2026-05-01'},{start:'2026-10-16',end:'2026-10-15'},{start:'2024-01-01',end:'2026-01-01'}])assert.throws(()=>validatePayrollCutoff(range));
 assert.deepEqual(validatePayrollCutoff({start:'2028-02-29',end:'2028-02-29'}),{start:'2028-02-29',end:'2028-02-29'});
 assert.throws(()=>currentPayrollCutoff('2026-02-31'),/calendar date/);
});
test('payroll attendance queries include first-day early clock-ins and final-day overnight clock-outs',()=>{
 const {startDate,endDate}=payrollCutoffQueryRange({start:'2026-10-01',end:'2026-10-15'});
 assert.equal(startDate.toISOString(),'2026-09-30T16:00:00.000Z');assert.equal(endDate.toISOString(),'2026-10-16T10:00:00.000Z');
 assert.ok(+new Date('2026-10-01T07:00:00+08:00')>=+startDate);
 assert.ok(+new Date('2026-10-16T05:30:00+08:00')<+endDate);
 assert.equal(+new Date('2026-10-16T18:00:00+08:00'),+endDate);
});
test('month and preset changes remain drafts until Load payroll is chosen',async()=>{
 const f=fixture(),original=f.ui.getRange();f.change('month','2028-02','change');
 assert.deepEqual(f.ui.getDraftRange(),{start:'2028-02-16',end:'2028-02-29'});assert.deepEqual(f.ui.getRange(),original);assert.equal(f.calls.length,0);
 const presets=f.cls('payroll-cutoff-presets');presets.children[0].emit('click');
 assert.deepEqual(f.ui.getDraftRange(),{start:'2028-02-01',end:'2028-02-15'});assert.match(f.cls('payroll-cutoff-hint').textContent,/Dates changed/);assert.equal(f.calls.length,0);
 assert.equal(await f.ui.apply(),true);assert.deepEqual(f.calls,[{start:'2028-02-01',end:'2028-02-15'}]);assert.deepEqual(f.ui.getRange(),f.calls[0]);assert.match(f.cls('payroll-cutoff-hint').textContent,/Generate payslip/);
});
test('custom dates apply exactly once through the form submit action',async()=>{
 const f=fixture();f.change('start','2026-09-20');f.change('end','2026-10-05');assert.equal(f.calls.length,0);
 const event=f.cls('payroll-cutoff-form').emit('submit');assert.equal(event.defaultPrevented,true);await drain();
 assert.deepEqual(f.calls,[{start:'2026-09-20',end:'2026-10-05'}]);assert.deepEqual(f.ui.queryRange(),payrollCutoffQueryRange(f.calls[0]));
});
test('invalid custom and invalid month drafts preserve the loaded cutoff and trigger no read',async()=>{
 const f=fixture(),original=f.ui.getRange();f.change('start','2026-11-01');f.change('end','2026-10-15');
 assert.equal(await f.ui.apply(),false);assert.deepEqual(f.ui.getRange(),original);assert.equal(f.calls.length,0);assert.equal(f.cls('payroll-cutoff-error').hidden,false);assert.equal(f.node('start').getAttribute('aria-invalid'),'true');
 f.change('start','2026-10-01');assert.equal(f.cls('payroll-cutoff-error').hidden,true);assert.equal(f.node('start').getAttribute('aria-invalid'),null);
 f.change('month','2026-13','change');assert.equal(await f.ui.apply(),false);assert.equal(f.calls.length,0);assert.match(f.cls('payroll-cutoff-error').textContent,/valid cutoff month/);assert.deepEqual(f.ui.getRange(),original);
});
test('double submission is ignored while loading and all cutoff inputs are disabled',async()=>{
 const gate=deferred(),f=fixture({onApply:()=>gate.promise});f.change('start','2026-10-01');f.change('end','2026-10-15');const pending=f.ui.apply();
 assert.equal(f.node('start').disabled,true);assert.equal(f.node('month').disabled,true);assert.equal(f.node('apply').disabled,true);assert.equal(f.ui.element.getAttribute('aria-busy'),'true');assert.equal(await f.ui.apply(),false);assert.equal(f.calls.length,1);
 gate.resolve();assert.equal(await pending,true);assert.equal(f.node('apply').disabled,false);assert.equal(f.ui.element.getAttribute('aria-busy'),'false');
});
test('load errors are visible, reported once, and keep the applied cutoff for retry',async()=>{
 let attempt=0;const f=fixture({onApply:()=>{if(attempt++===0)throw Error('Sample connection unavailable');}});f.change('start','2026-10-01');f.change('end','2026-10-15');assert.equal(await f.ui.apply(),false);
 assert.deepEqual(f.errors,['Sample connection unavailable']);assert.match(f.cls('payroll-cutoff-error').textContent,/connection unavailable/);assert.equal(f.node('apply').disabled,false);assert.deepEqual(f.ui.getRange(),{start:'2026-10-01',end:'2026-10-15'});
 assert.equal(await f.ui.apply(),true);assert.equal(f.cls('payroll-cutoff-error').hidden,true);assert.equal(f.calls.length,2);
});
test('sync preserves the cutoff when the branch label changes; getters cannot mutate controller state',()=>{
 const f=fixture();f.setBranch('Other authorized branch');f.ui.sync();assert.match(f.cls('payroll-cutoff-applied').textContent,/Other authorized branch/);
 const values=f.ui.getRange();values.start='1900-01-01';const query=f.ui.queryRange();query.startDate.setUTCFullYear(1900);assert.deepEqual(f.ui.getRange(),{start:'2026-10-16',end:'2026-10-31'});assert.equal(f.calls.length,0);
 f.ui.setLoading(true);assert.equal(f.node('end').disabled,true);f.ui.setLoading(false);assert.equal(f.node('end').disabled,false);
});
for(const rejected of [false,true])test('an old-branch cutoff load '+(rejected?'failure':'completion')+' cannot unlock controls loading for the new branch',async()=>{
 const gate=deferred(),f=fixture({onApply:()=>gate.promise});f.change('start','2026-10-01');f.change('end','2026-10-15');const pending=f.ui.apply();
 f.setBranch('Other authorized branch');f.ui.sync();f.ui.setLoading(true);
 if(rejected)gate.reject(Error('Old branch request failed'));else gate.resolve();await pending;
 assert.equal(f.node('apply').disabled,true);assert.equal(f.ui.element.getAttribute('aria-busy'),'true');assert.deepEqual(f.errors,[]);assert.equal(f.cls('payroll-cutoff-error').hidden,true);assert.match(f.cls('payroll-cutoff-applied').textContent,/Other authorized branch/);assert.deepEqual(f.ui.getRange(),{start:'2026-10-01',end:'2026-10-15'});
 f.ui.setLoading(false);assert.equal(f.node('apply').disabled,false);
});
for(const rejected of [false,true])test('a managed same-branch reload keeps controls busy after an older cutoff load '+(rejected?'fails':'completes'),async()=>{
 const gate=deferred(),f=fixture({onApply:()=>gate.promise}),pending=f.ui.apply();
 // Leaving the tab and returning starts a new root-owned read without changing
 // the account or branch. Only that new read may release its loading state.
 f.ui.sync({newLoad:true});f.ui.setLoading(true);
 if(rejected)gate.reject(Error('Obsolete page load'));else gate.resolve();await pending;
 assert.equal(f.node('apply').disabled,true);assert.equal(f.ui.element.getAttribute('aria-busy'),'true');assert.deepEqual(f.errors,[]);assert.equal(f.cls('payroll-cutoff-error').hidden,true);
 f.ui.setLoading(false);assert.equal(f.node('apply').disabled,false);
});
test('reset selects the new current half without a read and old asynchronous errors stay silent',async()=>{
 const gate=deferred(),f=fixture({onApply:()=>gate.promise}),pending=f.ui.apply();f.setToday('2027-01-03');f.ui.reset();
 assert.deepEqual(f.ui.getRange(),{start:'2027-01-01',end:'2027-01-15'});assert.equal(f.node('apply').disabled,false);gate.reject(Error('Old account load failed'));assert.equal(await pending,false);assert.deepEqual(f.errors,[]);assert.equal(f.cls('payroll-cutoff-error').hidden,true);assert.equal(f.calls.length,1);
});
test('destroy detaches only its own controls and suppresses late results and callbacks',async()=>{
 const gate=deferred(),f=fixture({onApply:()=>gate.promise}),other=new Element('p');f.root.append(other);const old=f.ui.element,pending=f.ui.apply();f.ui.destroy();f.ui.destroy();
 assert.deepEqual(f.root.children,[other]);gate.reject(Error('Obsolete load'));assert.equal(await pending,false);assert.deepEqual(f.errors,[]);assert.throws(()=>f.ui.getRange(),/closed/);assert.throws(()=>f.ui.reset(),/closed/);
 const oldForm=old.children.find(node=>node.tagName==='FORM');oldForm.emit('submit');await drain();assert.equal(f.calls.length,1);
});
test('labels and local validation are accessible without interpolating branch text as HTML',()=>{
 const f=fixture();f.setBranch('<Sample branch>');f.ui.sync();assert.match(f.cls('payroll-cutoff-applied').textContent,/<Sample branch>/);assert.equal(f.ui.element.getAttribute('aria-label'),'Payroll cutoff');
 for(const key of ['month','start','end'])assert.equal(f.node(key).getAttribute('aria-describedby'),f.cls('payroll-cutoff-error').id);
 assert.equal(f.cls('payroll-cutoff-error').getAttribute('role'),'alert');assert.equal(f.node('apply').type,'submit');
});
