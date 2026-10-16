import test from 'node:test';
import assert from 'node:assert/strict';
import {installInventoryIntelligence} from '../takodeal-manager/inventory-intelligence.js';

class Node {
 constructor(tag,d){this.tagName=tag.toUpperCase();this.doc=d;this.children=[];this.style={};this.attributes={};this.listeners=new Map();this.value='';this._text='';this.dataset={};}
 set id(value){this._id=value;this.doc.nodes.set(value,this);}get id(){return this._id;}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 prepend(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}
 removeAttribute(name){delete this.attributes[name];if(name==='style')this.style={};}
 setAttribute(name,value){this.attributes[name]=String(value);}
 addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);}
 async emit(name){for(const handler of this.listeners.get(name)||[])await handler({target:this});}
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const snapshot=rows=>({docs:rows.map((row,index)=>({id:row.id||String(index),data:()=>row}))});
const item=branch=>({id:'stock-'+branch,name:branch+' sauce',branch,category:'Ingredients',currentStock:0,baseCost:1,baseUom:'gram',uom:'gram',purchaseUom:'Pack',conversionRate:100,maintainingStock:500,reorderLevel:0,lowStockAlert:0});
function fixture(){
 const d={nodes:new Map(),createElement(tag){return new Node(tag,this);},getElementById(id){return this.nodes.get(id)||null;},querySelectorAll(selector){return selector.startsWith('#')?[this.nodes.get(selector.slice(1))].filter(Boolean):[];},querySelector(){return null;}};
 d.head=d.createElement('head');const section=d.createElement('section');section.id='invSectionForecaster';section.style.display='none';
 const held=new Map(),reads=[],actions=[],w={auth:{currentUser:{uid:'owner'}},sessionUser:{uid:'owner',email:'owner@example.test',allowedBranches:['All'],permissions:['all']},globalActiveBranches:['Main Office','Cabantian','Maa'],db:{},
  collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:(field,direction)=>({field,direction}),limit:value=>({limit:value}),query:(ref,...filters)=>({...ref,filters})};
 w.getDocsFromServer=async query=>{
  const branch=query.filters.find(filter=>filter.field==='branch')?.value;reads.push({table:query.table,branch});
  if(query.table==='branches')return snapshot(w.globalActiveBranches.map(name=>({name})));
  if(query.table==='inventory')return held.get(branch)?.promise||snapshot([item(branch)]);
  return snapshot([]);
 };
 w.generateAiDispatchList=async()=>actions.push({branch:d.getElementById('forecasterBranchSelect').value,items:structuredClone(w.globalForecasterData)});
 const controller=installInventoryIntelligence(w,d);
 return {d,w,held,reads,actions,controller,panel:controller.panels.forecast};
}

test('search during a held branch load cannot restore old rows, compatibility data or request actions',async()=>{
 const f=fixture();await f.w.loadForecasterEngine();assert.match(f.panel.results.textContent,/Main Office sauce/);assert.equal(f.panel.generate.disabled,false);
 const pending=deferred();f.held.set('Cabantian',pending);f.panel.branch.value='Cabantian';const loading=f.w.loadForecasterEngine();
 assert.equal(f.panel.loading,true);assert.equal(f.panel.model,null);assert.equal(f.panel.report,null);
 f.panel.search.value='sauce';await f.panel.search.emit('input');await f.panel.category.emit('change');f.w.filterForecaster();
 assert.doesNotMatch(f.panel.results.textContent,/Main Office sauce/);assert.match(f.panel.results.textContent,/Loading/);
 assert.deepEqual(f.w.globalForecasterData,[]);assert.equal(f.panel.generate.disabled,true);
 // Invoke the handler directly as well: safety cannot depend on disabled styling.
 await f.panel.generate.emit('click');assert.equal(f.actions.length,0);
 pending.resolve(snapshot([item('Cabantian')]));await loading;
 assert.equal(f.panel.loading,false);assert.match(f.panel.results.textContent,/Cabantian sauce/);assert.doesNotMatch(f.panel.results.textContent,/Main Office sauce/);
 assert.ok(f.w.globalForecasterData.every(row=>row.branch==='Cabantian'));await f.panel.generate.emit('click');
 assert.equal(f.actions.length,1);assert.equal(f.actions[0].branch,'Cabantian');assert.ok(f.actions[0].items.every(row=>row.branch==='Cabantian'));
});

test('request handler rejects branch, report-date and account changes even without their change event',async()=>{
 const f=fixture();await f.w.loadForecasterEngine();
 f.panel.branch.value='Cabantian';await f.panel.generate.emit('click');assert.equal(f.actions.length,0);
 f.panel.branch.value='Main Office';const from=f.panel.from.value;f.panel.from.value='2026-01-01';await f.panel.generate.emit('click');assert.equal(f.actions.length,0);
 f.panel.from.value=from;f.w.sessionUser={...f.w.sessionUser,email:'manager@example.test'};await f.panel.generate.emit('click');assert.equal(f.actions.length,0);
});

test('an older request finishing cannot clear the loading guard or show rows during the newer request',async()=>{
 const f=fixture();await f.w.loadForecasterEngine();const old=deferred(),latest=deferred();f.held.set('Cabantian',old);f.held.set('Maa',latest);
 f.panel.branch.value='Cabantian';const first=f.w.loadForecasterEngine();
 for(let turn=0;turn<30&&!f.reads.some(row=>row.table==='inventory'&&row.branch==='Cabantian');turn++)await Promise.resolve();
 assert.ok(f.reads.some(row=>row.table==='inventory'&&row.branch==='Cabantian'));
 f.panel.branch.value='Maa';const second=f.w.loadForecasterEngine();old.resolve(snapshot([item('Cabantian')]));await first;
 assert.equal(f.panel.loading,true);assert.equal(f.w.isForecasterLoading,true);assert.equal(f.panel.model,null);assert.equal(f.panel.generate.disabled,true);assert.deepEqual(f.w.globalForecasterData,[]);
 latest.resolve(snapshot([item('Maa')]));await second;assert.equal(f.panel.loading,false);assert.match(f.panel.results.textContent,/Maa sauce/);assert.doesNotMatch(f.panel.results.textContent,/Cabantian sauce/);
});

test('scope denial clears a previously accepted report and blocks filter redraw or request creation',async()=>{
 const f=fixture();await f.w.loadForecasterEngine();f.w.sessionUser={uid:'owner',email:'manager@example.test',allowedBranches:['Maa'],permissions:[]};
 await f.w.loadForecasterEngine();assert.equal(f.panel.loading,false);assert.equal(f.panel.report,null);assert.equal(f.panel.model,null);
 await f.panel.search.emit('input');await f.panel.generate.emit('click');assert.match(f.panel.results.textContent,/outside your saved access/);assert.doesNotMatch(f.panel.results.textContent,/Main Office sauce/);assert.deepEqual(f.w.globalForecasterData,[]);assert.equal(f.actions.length,0);
});
