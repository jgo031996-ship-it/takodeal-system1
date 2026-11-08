import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installAIBoard} from '../takodeal-manager/ai-board.js';
import {ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
const css=readFileSync(new URL('../takodeal-manager/style.css',import.meta.url),'utf8');
function fixture({owner=true}={}){
 const d=new ReviewDocument(),create=d.createElement.bind(d),calls=[],events=new Map();
 const decorate=node=>{
  if(!node||node.navigationDecorated)return node;node.navigationDecorated=true;node.style={};
  Object.defineProperty(node,'className',{get:()=>node.attributes.class||'',set:value=>node.attributes.class=String(value)});
  Object.defineProperty(node,'parentNode',{get:()=>node.parentElement});
  const classes=()=>new Set(node.className.split(/\s+/).filter(Boolean));
  node.classList={contains:value=>classes().has(value),add(...values){const next=classes();values.forEach(value=>next.add(value));node.className=[...next].join(' ');},remove(...values){const next=classes();values.forEach(value=>next.delete(value));node.className=[...next].join(' ');}};
  node.replaceChildren=(...children)=>{node.children=[];node._text='';node._html='';node.append(...children);};return node;
 };
 decorate(d.body);d.createElement=tag=>decorate(create(tag));d.head=d.createElement('head');
 const node=id=>decorate(d.body.querySelector('#'+id));d.getElementById=node;
 const append=(id,classes='')=>{const element=d.createElement('section');element.id=id;element.className=classes;d.body.append(element);return element;};
 const menu=append('nav-menu','nav-menu');append('view-dashboard','view active');append('view-inventory','view');append('pageTitle');
 d.querySelector=selector=>selector==='.sidebar .nav-menu'?menu:d.body.querySelector(selector);
 d.querySelectorAll=selector=>{const result=[];const walk=parent=>{for(const child of parent.children){decorate(child);if(selector.startsWith('.')&&child.classList.contains(selector.slice(1)))result.push(child);walk(child);}};walk(d.body);return result;};
 const baseSwitch=view=>{d.querySelectorAll('.view').forEach(element=>element.classList.remove('active'));d.querySelectorAll('.nav-item').forEach(element=>element.classList.remove('active'));node('view-'+view)?.classList.add('active');node('nav-'+view)?.classList.add('active');};
 const w={auth:{currentUser:{uid:'owner',email:owner?'jgo031996@gmail.com':'other@example.invalid',emailVerified:true,getIdToken:async()=>'synthetic_token'}},sessionUser:{uid:'owner'},switchView:baseSwitch,addEventListener:(event,callback)=>events.set(event,callback),fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({configured:true})};}};
 installAIBoard(w,d);return{w,d,node,calls,events,baseSwitch,directInventory:()=>baseSwitch('inventory'),visible:element=>element.style.display?element.style.display!=='none':element.classList.contains('active')};
}
test('actual Board entry uses active-view CSS with no inline block and performs no consultation POST',async()=>{
 assert.match(css,/\.view\s*\{[^}]*display:\s*none/s);assert.match(css,/\.view\.active\s*\{\s*display:\s*block/);
 const f=fixture();f.node('nav-ai-board').click();await drain();const board=f.node('view-ai-board');assert.equal(board.classList.contains('active'),true);assert.equal(board.style.display,'');assert.equal(f.visible(board),true);assert.equal(f.node('pageTitle').textContent,'AI Board of Directors');assert.deepEqual(f.calls.map(call=>call.options.method),['GET']);assert.equal(f.node('board-submit').disabled,false);
});
test('direct Inventory subnavigation removes active and hides Board through existing CSS without the wrapped switchView',async()=>{
 const f=fixture();f.w.switchView('ai-board');await drain();const board=f.node('view-ai-board');f.directInventory();assert.equal(f.node('view-inventory').classList.contains('active'),true);assert.equal(board.classList.contains('active'),false);assert.equal(board.style.display,'');assert.equal(f.visible(board),false);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,0);
});
test('returning after direct Inventory navigation restores one Board and still never starts a consultation',async()=>{
 const f=fixture();f.w.switchView('ai-board');await drain();f.directInventory();f.node('nav-ai-board').click();await drain();assert.equal(f.node('view-ai-board').style.display,'');assert.equal(f.node('view-ai-board').classList.contains('active'),true);assert.equal(f.d.querySelectorAll('.view').filter(node=>node.classList.contains('active')).length,1);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,0);installAIBoard(f.w,f.d);assert.equal(f.d.querySelectorAll('.view').filter(node=>node.id==='view-ai-board').length,1);
});
const report=()=>({model:'synthetic-model',requestId:'sample',packet:{branch:'All',period:{start:'2026-11-01',end:'2026-11-07'},asOf:'2026-11-08T00:00:00Z',partial:false,evidence:[],coverage:[],dateBasis:'Saved sample',limitations:[]},report:{confidence:'medium',summary:'LATE_REPORT_SENTINEL',findings:[],assumptions:[],counterargument:'Sample',options:[],recommendation:'Sample',nextSteps:[]}});
test('normal navigation clears report, aborts the explicit consultation and rejects a late response',async()=>{
 const f=fixture(),gate=deferred();f.w.switchView('ai-board');await drain();f.w.fetch=async(url,options)=>{f.calls.push({url,options});return gate.promise;};
 const form=f.node('board-question-form'),pending=form.listeners.submit[0]({preventDefault(){}});await drain();const post=f.calls.find(call=>call.options.method==='POST');assert.ok(post);assert.equal(post.options.signal.aborted,false);f.w.switchView('inventory');assert.equal(post.options.signal.aborted,true);assert.equal(f.node('view-ai-board').style.display,'none');assert.equal(f.node('view-ai-board').classList.contains('active'),false);assert.equal(f.node('board-result').innerHTML,'');
 gate.resolve({ok:true,json:async()=>report()});await pending;assert.doesNotMatch(f.node('board-result').innerHTML,/LATE_REPORT_SENTINEL/);assert.equal(f.node('board-result').innerHTML,'');assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
});
test('pagehide invalidates a pending explicit consultation without any follow-up POST',async()=>{
 const f=fixture(),gate=deferred();f.w.switchView('ai-board');await drain();f.w.fetch=async(url,options)=>{f.calls.push({url,options});return gate.promise;};const pending=f.node('board-question-form').listeners.submit[0]({preventDefault(){}});await drain();f.events.get('pagehide')();gate.resolve({ok:true,json:async()=>report()});await pending;assert.equal(f.node('board-result').innerHTML,'');assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
});
test('a non-owner session cannot install navigation or start even a Board configuration read',()=>{const f=fixture({owner:false});assert.equal(f.node('nav-ai-board'),null);assert.equal(f.node('view-ai-board'),null);assert.equal(f.calls.length,0);});
