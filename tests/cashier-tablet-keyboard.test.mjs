import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Takodeal-POS/cashier-workspace.js',import.meta.url),'utf8');
const start=source.indexOf('export function installCashierViewport('),end=source.indexOf('\nfunction installParkedOrders(',start);
assert.ok(start>=0&&end>start);
const code=source.slice(start,end).replace('export function','function');
function events(){const handlers=new Map();return {addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},emit(type){handlers.get(type)?.forEach(fn=>fn({type}));},get listenerCount(){return [...handlers.values()].reduce((count,set)=>count+set.size,0);}};}
function harness({viewport=true,width=1024}={}){
 const callbacks=new Map(),frames=new Map();let frameId=0;
 function classes(initial=[]){const set=new Set(initial);return {contains:key=>set.has(key),toggle(key,on){const before=set.has(key);if(on)set.add(key);else set.delete(key);if(before!==on)callbacks.get(this.target)?.forEach(fn=>fn());},target:null};}
 function node(){const props=new Map(),attrs=new Map();return {style:{setProperty:(key,value)=>props.set(key,value),removeProperty:key=>props.delete(key),getPropertyValue:key=>props.get(key)||''},setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),props};}
 const stock=Object.assign(node(),{...events(),scrollTop:400,scrollHeight:1600,baseHeight:448,classList:classes(['active'])});stock.classList.target=stock;
 Object.defineProperty(stock,'clientHeight',{get(){const cap=parseFloat(stock.props.get('--cashier-stock-visible-height'));return stock.classList.contains('cashier-stock-viewport')&&Number.isFinite(cap)?Math.min(stock.baseHeight,cap):stock.baseHeight;}});
 stock.getBoundingClientRect=()=>({top:152,bottom:152+stock.clientHeight,height:stock.clientHeight});
 const controls={contains:input=>input===search,getBoundingClientRect:()=>{const top=stock.classList.contains('cashier-stock-compact-input')?252-stock.scrollTop:Math.max(152,252-stock.scrollTop);return {top,bottom:top+60,height:60};}};
 function field(id,contentY){return {id,value:'17',disabled:false,readOnly:false,matches:()=>true,getBoundingClientRect:()=>({top:152+contentY-stock.scrollTop,bottom:196+contentY-stock.scrollTop,height:44})};}
 const input=field('countBase_sample',900),search=field('manualCountSearch',120);
 search.getBoundingClientRect=()=>({top:controls.getBoundingClientRect().top+8,bottom:controls.getBoundingClientRect().top+52,height:44});
 stock.contains=value=>value===input||value===search;stock.querySelector=selector=>selector==='.cashier-stock-controls'?controls:null;
 const logout=node(),footer={};
 const cashier=Object.assign(node(),{querySelector:()=>({textContent:'QA cashier with a long name'})}),branch=Object.assign(node(),{querySelector:()=>({textContent:'Maa'})});
 const sidebar=Object.assign(node(),events(),{getBoundingClientRect:()=>({top:28}),querySelector:selector=>selector==='.logout-btn'?logout:selector==='.sidebar-footer'?footer:null});
 const doc=Object.assign(events(),{activeElement:null,documentElement:{clientHeight:600},getElementById:id=>({'view-stockreq':stock,mainSidebar:sidebar,displayCashierContainer:cashier,displayBranchContainer:branch}[id]),querySelector:()=>({getBoundingClientRect:()=>({bottom:94})})});
 const visible=Object.assign(events(),{height:600,offsetTop:0,scale:1});
 const win=Object.assign(events(),{innerHeight:600,visualViewport:viewport?visible:null,matchMedia:()=>({matches:width<=768}),getComputedStyle:()=>({position:stock.classList.contains('cashier-stock-compact-input')?'static':'sticky'}),requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),MutationObserver:class {constructor(fn){this.fn=fn;this.targets=[];}observe(target){if(!callbacks.has(target))callbacks.set(target,new Set());callbacks.get(target).add(this.fn);this.targets.push(target);}disconnect(){this.targets.forEach(target=>callbacks.get(target)?.delete(this.fn));}}});
 const context=vm.createContext({});vm.runInContext(code,context);const layout=context.installCashierViewport(doc,win);
 function flush(){let count=0;while(frames.size){if(++count>8)throw Error('Viewport refresh loop');const run=[...frames.values()];frames.clear();run.forEach(fn=>fn());}return count;}
 function focus(fieldValue=input){doc.activeElement=fieldValue;doc.emit('focusin');flush();}
 flush();return {stock,input,search,controls,sidebar,logout,cashier,branch,doc,win,visible,layout,flush,focus,callbacks,frames};
}

test('A covered count input is revealed above the tablet keyboard without changing its draft or focus',()=>{
 const h=harness();const value=h.input.value;h.focus();h.visible.height=320;h.visible.emit('resize');h.flush();
 assert.equal(h.stock.style.getPropertyValue('--cashier-stock-visible-height'),'168px');
 assert.equal(h.stock.classList.contains('cashier-stock-compact-input'),true);
 const bounds=h.input.getBoundingClientRect();assert.ok(bounds.bottom<=308);assert.ok(bounds.top>=162);
 assert.equal(h.input.value,value);assert.equal(h.doc.activeElement,h.input);
});
test('Visual viewport panning uses the visible bottom rather than only viewport height',()=>{
 const h=harness();h.focus();h.visible.height=300;h.visible.offsetTop=80;h.visible.emit('scroll');h.flush();
 assert.equal(h.stock.style.getPropertyValue('--cashier-stock-visible-height'),'228px');assert.ok(h.input.getBoundingClientRect().bottom<=368);
 assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-height'),'352px');
});
test('Search stays reachable inside its sticky toolbar and neither count unit is reset',()=>{
 const h=harness();h.visible.height=320;h.focus(h.search);
 assert.equal(h.stock.classList.contains('cashier-stock-compact-input'),false);assert.ok(h.search.getBoundingClientRect().bottom<=308);
 assert.equal(h.input.value,'17');assert.equal(h.search.value,'17');assert.equal(h.doc.activeElement,h.search);
});
test('The stock panel expands when the keyboard closes and keeps its scroll position and values',()=>{
 const h=harness();h.focus();h.visible.height=300;h.visible.emit('resize');h.flush();const scroll=h.stock.scrollTop;
 h.doc.activeElement=null;h.doc.emit('focusout');h.visible.height=600;h.visible.emit('resize');h.flush();
 assert.equal(h.stock.clientHeight,448);assert.equal(h.stock.classList.contains('cashier-stock-compact-input'),false);assert.equal(h.stock.scrollTop,scroll);assert.equal(h.input.value,'17');
});
test('Leaving Stock Report removes its viewport constraint and does not touch another view',()=>{
 const h=harness();h.focus();h.visible.height=300;h.visible.emit('resize');h.flush();h.stock.classList.toggle('active',false);h.flush();
 assert.equal(h.stock.style.getPropertyValue('--cashier-stock-visible-height'),'');assert.equal(h.stock.classList.contains('cashier-stock-compact-input'),false);assert.equal(h.input.value,'17');
});
test('Deliberate pinch zoom is left to the browser without forced scrolling',()=>{
 const h=harness();h.focus();const scroll=h.stock.scrollTop;h.visible.scale=1.4;h.visible.height=260;h.visible.emit('resize');h.flush();
 assert.equal(h.stock.classList.contains('cashier-stock-viewport'),false);assert.equal(h.stock.scrollTop,scroll);assert.equal(h.input.value,'17');
});
test('Browsers without visualViewport still reveal inputs through the existing scroller',()=>{
 const h=harness({viewport:false});h.win.innerHeight=320;h.focus();assert.ok(h.input.getBoundingClientRect().bottom<=308);
 assert.equal(h.stock.classList.contains('cashier-stock-viewport'),false);assert.equal(h.input.value,'17');
});
test('Narrow navigation fits above a keyboard and its original Sign Out remains labelled',()=>{
 const h=harness({width:600});h.visible.height=280;h.visible.emit('resize');h.flush();
 assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-top'),'102px');assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-height'),'168px');
 assert.equal(h.logout.getAttribute('aria-label'),'Sign out of Cashier workspace');assert.equal(h.cashier.title,'QA cashier with a long name');assert.equal(h.branch.title,'Maa');
});
test('Shorter navigation starts inside the visible viewport when the normal top would consume it',()=>{
 const h=harness({width:600});h.visible.height=180;h.visible.offsetTop=20;h.visible.emit('resize');h.flush();
 assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-top'),'30px');assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-height'),'160px');
});
test('Resize bursts settle and disposal removes listeners and viewport constraints',()=>{
 const h=harness();h.focus();for(let i=0;i<20;i++)h.visible.emit('resize');assert.equal(h.frames.size,1);assert.ok(h.flush()<=2);
 h.layout.dispose();assert.equal(h.visible.listenerCount,0);assert.equal(h.doc.listenerCount,0);assert.equal(h.win.listenerCount,0);assert.equal(h.stock.classList.contains('cashier-stock-viewport'),false);
 assert.equal(h.sidebar.style.getPropertyValue('--cashier-sidebar-height'),'');assert.equal(h.frames.size,0);
});
