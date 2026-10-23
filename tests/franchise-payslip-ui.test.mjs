import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFranchisePayslip} from '../takodeal-franchise/franchise-payroll-model.js';
import {renderFranchisePayslipHTML,installFranchisePayslipUI} from '../takodeal-franchise/franchise-payslip-ui.js';
const staff={id:'sample-id',cashierName:'Sample <Crew>',branch:'Sample Branch',hourlyRate:999};
function model(){return buildFranchisePayslip({staff,profiles:[staff],branch:staff.branch,start:'2026-10-01',end:'2026-10-15',payrollRecords:[{id:'sample-paid',staffId:staff.id,branch:staff.branch,startDate:'2026-10-01',endDate:'2026-10-15',finalNetPay:450,frozenData:{staffId:staff.id,branch:staff.branch,name:staff.cashierName,start:'2026-10-01',end:'2026-10-15',isPaid:true,basicPay:500,meals:50,finalNetPay:450,deductionDetailsVersion:1,deductionDetails:[{bucket:'meals',type:'Cancelled Food Purchase',amount:50,sourcePlatform:'Grab',sourceReceiptId:'SAMPLE-OR',purchasedItems:[{name:'Mango <shake>',qty:1,amount:50,addons:{Cream:{name:'Cream',qty:2}}}]}]}}]});}
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.style={};this.listeners={};this.attributes={};this.disabled=false;this.textContent='';if(tag==='iframe')this.contentWindow={prints:0,focus(){},events:{},addEventListener(name,callback){this.events[name]=callback;},print(){this.prints++;}};}
 get isConnected(){return this===this.doc.body||!!this.parent?.isConnected;}
 append(...rows){for(const row of rows){this.children.push(row);row.parent=this;}}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(row=>row!==this);this.parent=null;}}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(key,fn){this.listeners[key]=fn;}
 focus(){this.doc.activeElement=this;}
}
function dom(){const document={createElement(tag){return new Element(tag,this);}},errors=[];document.body=new Element('body',document);const original=document.createElement('button');document.body.append(original);original.focus();let current=true;const ui=installFranchisePayslipUI({document,window:{},assertCurrent(){if(!current)throw Error('Branch changed');},onError:error=>errors.push(error.message)});return {document,ui,errors,original,setCurrent:value=>current=value};}
test('A4 output escapes staff, receipt and item text and shows original-option context',()=>{
 const html=renderFranchisePayslipHTML(model(),{standalone:true});assert.match(html,/<!doctype html>/);assert.match(html,/@page\{size:A4 portrait;margin:14mm\}/);assert.match(html,/Sample &lt;Crew&gt;/);assert.match(html,/Mango &lt;shake&gt;/);assert.match(html,/1 × Mango/);assert.match(html,/Grab · Receipt SAMPLE-OR/);assert.match(html,/Original receipt options: Cream/);assert.match(html,/Quantities above apply to the selected food/);assert.match(html,/Saved net pay/);assert.match(html,/₱450\.00/);assert.doesNotMatch(html,/<script|<img|https?:\/\//);assert.equal((html.match(/Total deductions/g)||[]).length,1);
});
test('held records never print a zero or fabricated net payslip',()=>{
 const held=buildFranchisePayslip({staff,branch:staff.branch,start:'bad',end:'bad'}),h=dom();h.ui.open(held);const panel=h.document.body.children.at(-1).children[0],controls=panel.children[0],buttons=controls.children[1];assert.equal(buttons.children[0].disabled,true);assert.throws(()=>h.ui.print(),/Resolve the HR review/);const html=renderFranchisePayslipHTML(held);assert.match(html,/HR review required/);assert.doesNotMatch(html,/Estimated net pay|Saved net pay|₱0\.00/);
});
test('opening, printing and closing use only a local iframe with the saved model',()=>{
 const h=dom();h.ui.open(model());assert.equal(h.document.body.children.length,2);const overlay=h.document.body.children.at(-1);assert.match(overlay.style.cssText,/align-items:center;justify-content:center/);assert.equal(overlay.children[0].attributes['aria-modal'],'true');h.ui.print();const frame=h.document.body.children.at(-1);assert.equal(frame.tagName,'IFRAME');assert.match(frame.srcdoc,/₱450\.00/);frame.onload();assert.equal(frame.contentWindow.prints,1);frame.contentWindow.events.afterprint();assert.equal(h.document.body.children.length,2);h.ui.close();assert.equal(h.document.body.children.length,1);assert.equal(h.document.activeElement,h.original);assert.deepEqual(h.errors,[]);
});
test('a branch/account change between opening and print removes the former preview before any print',()=>{
 const h=dom();h.ui.open(model());h.setCurrent(false);assert.throws(()=>h.ui.print(),/Branch changed/);assert.equal(h.document.body.children.length,1);assert.equal(h.document.body.children.some(row=>row.tagName==='IFRAME'),false);
});
test('a delayed print load cannot print after branch access changes',()=>{
 const h=dom();h.ui.open(model());h.ui.print();const frame=h.document.body.children.at(-1);h.setCurrent(false);frame.onload();assert.equal(frame.contentWindow.prints,0);assert.equal(h.document.body.children.length,1);assert.deepEqual(h.errors,['Branch changed']);h.ui.destroy();assert.throws(()=>h.ui.open(model()),/closed/);
});
