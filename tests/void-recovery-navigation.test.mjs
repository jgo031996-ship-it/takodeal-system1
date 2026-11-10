// Executes exact production handler excerpts against the repository's lightweight
// HTML DOM fixture. This is not a native-browser layout or backend void test.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ReviewDocument,ReviewElement} from './helpers/review-dom.mjs';
import {revealEditableVoidCart,restoreVoidPlatform} from '../Takodeal-POS/cashier-void.js';
const read=file=>readFileSync(new URL('../Takodeal-POS/'+file,import.meta.url),'utf8');
const html=read('index.html'),main=read('main.js'),workspace=read('cashier-workspace.js'),pos=read('cashier-pos-ui.js'),css=read('cashier-pos-base.css');
const between=(source,start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from,start);return source.slice(from,to);};
const router=between(html,'    function switchView(viewName) {','    function closeModal(');
const platformSwitch=between(html,'    window.switchPosPlatform = function(platform) {','    window.renderMenuItems = function()');
const renderer=between(main,'window.renderCart = function() {','window.clearCart = function()');
const workspaceWrapper=between(workspace,'  const original=window.switchView;','  for(const name of [\'loadConsumablesView\'');
const toolbar=between(pos,'  function installToolbar() {','  function installDock()');
const orderPaint=between(pos,'  function refreshOrderButton() {','  function installToolbar()');
const cartWrapper=between(pos,'    window.renderCart = function(...args) {','    installDock();');
const titles=workspace.split('\n').find(line=>line.startsWith('const titles = '));assert.ok(titles);
const styles=new WeakMap(),classes=node=>new Set(String(node.attributes.class||'').split(/\s+/).filter(Boolean)),setClasses=(node,values)=>node.attributes.class=[...values].join(' ');
Object.defineProperties(ReviewElement.prototype,{
 className:{configurable:true,get(){return this.attributes.class||'';},set(value){this.attributes.class=String(value);}},
 classList:{configurable:true,get(){const node=this;return{contains:value=>classes(node).has(value),add(...values){const all=classes(node);values.forEach(value=>all.add(value));setClasses(node,all);},remove(...values){const all=classes(node);values.forEach(value=>all.delete(value));setClasses(node,all);},toggle(value,force){const all=classes(node),use=force??!all.has(value);if(use)all.add(value);else all.delete(value);setClasses(node,all);return use;}};}},
 style:{configurable:true,get(){if(!styles.has(this)){const display=/display\s*:\s*([^;]+)/.exec(this.attributes.style||'')?.[1]?.trim();styles.set(this,{...(display?{display}:{})});}return styles.get(this);}},
 firstElementChild:{configurable:true,get(){return this.children[0]||null;}},
 innerText:{configurable:true,get(){return this.textContent;},set(value){this.textContent=value;}}
});
const match=ReviewElement.prototype.matches,queryAll=ReviewElement.prototype.querySelectorAll;
ReviewElement.prototype.matches=function(selector){if(selector.startsWith('.'))return selector.slice(1).split('.').every(value=>this.classList.contains(value));return match.call(this,selector);};
ReviewElement.prototype.querySelectorAll=function(selector){const direct=/^#([-\w]+)\s*>\s*([-\w]+)$/.exec(selector);if(direct)return(this.ownerDocument.getElementById(direct[1])?.children||[]).filter(node=>node.tagName.toLowerCase()===direct[2]);return queryAll.call(this,selector);};
ReviewElement.prototype.prepend=function(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);};
ReviewElement.prototype.focus=function(){this.ownerDocument.activeElement=this;};
const navSourceProof=Object.fromEntries([['index.html',html],['main.js',main],['cashier-workspace.js',workspace],['cashier-pos-ui.js',pos],['cashier-pos-base.css',css],['cashier-void.js',read('cashier-void.js')]].map(([file,value])=>[file,createHash('sha256').update(value).digest('hex')]));
function createVoidNavFixture(){
 const d=new ReviewDocument();d.querySelectorAll=selector=>d.body.querySelectorAll(selector);
 const markup=html.slice(html.indexOf('<body'),html.lastIndexOf('</body>')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 d.body.innerHTML=markup;
 for(const id of ['view-pos','view-sales','nav-pos','nav-sales','cartList','displayGrandTotal','topBarTitle','timeClockModal'])assert.ok(d.getElementById(id),id+' is from actual HTML');
 const sample=[{name:'SAMPLE editable item',realName:'SAMPLE editable item',variantName:'Standard',basePrice:40,variantPrice:40,qty:2,lineTotalFinal:85,notes:'SAMPLE note',addons:{SAMPLE:{name:'SAMPLE add-on',qty:1,price:2.5}}}];
 const w={document:d,cart:sample,currentShift:{shiftId:'SAMPLE_SHIFT',active:true},stopShiftSalesFeed(){},loadSalesDashboard(){},closeTimeClock(){},renderMenuItems(){},console};w.window=w;
 for(const [id,values]of [['posPlatformSelect',['Standard','Grab','Foodpanda']],['mainOrderType',['','Dine-In','Grab','Food Panda']]]){const select=d.getElementById(id);select.options=values.map(value=>({value}));select.value=values[0];}
 const context=vm.createContext(w);vm.runInContext(router+'\n'+renderer+'\n'+platformSwitch,context);
 vm.runInContext('(()=>{'+titles+"\nconst el=id=>document.getElementById(id),stopAttendance=()=>{};\n"+workspaceWrapper+'})()',context);
 // Actual responsive toolbar installs the real event listener. Only its pure
 // toolbar/cart excerpts run; no listeners, timers, SDK or app bootstraps run.
 vm.runInContext("let shell=document.getElementById('view-pos').firstElementChild,select,orderButton; const money=value=>'PHP '+Number(value||0).toFixed(2);\n"+toolbar+'\n'+orderPaint+'\ninstallToolbar();\nconst originalCart=window.renderCart;\n'+cartWrapper,context);
 const shell=d.getElementById('view-pos').firstElementChild;shell.classList.add('tk-pos-shell');d.body.classList.add('tk-ui-v2');
 w.switchView('sales');w.renderCart();
 return{w,d,shell,sample,proof:navSourceProof,baseline(){w.switchView('pos');},reveal(){revealEditableVoidCart(w,d);},snapshot(){return{posActive:d.getElementById('view-pos').classList.contains('active'),salesActive:d.getElementById('view-sales').classList.contains('active'),navPosActive:d.getElementById('nav-pos').classList.contains('active'),navCurrent:d.getElementById('nav-pos').attributes['aria-current'],cartRevealed:shell.classList.contains('tk-show-cart'),cartHTML:d.getElementById('cartList').innerHTML,total:d.getElementById('displayGrandTotal').innerText,focused:d.activeElement?.id||null,cartReferenceRetained:w.cart===sample};}};
}
function assertResponsiveGateSource(){assert.match(css,/@media \(max-width: 768px\)/);assert.match(css,/\.tk-cart-shell\s*\{ display: none !important/);assert.match(css,/\.tk-show-cart \.tk-cart-shell\s*\{ display: flex !important/);}

import test from 'node:test';
const observed=[];
test('actual saved router reaches POS while responsive cart remains closed in the old behavior',()=>{
 assertResponsiveGateSource();const f=createVoidNavFixture();f.baseline();const state=f.snapshot();assert.equal(state.posActive,true);assert.equal(state.navPosActive,true);assert.equal(state.salesActive,false);assert.equal(state.cartRevealed,false);assert.match(state.cartHTML,/SAMPLE editable item/);assert.equal(state.total,'₱ 85.00');assert.equal(state.cartReferenceRetained,true);observed.push({case:'baseline route-only',...state,cartHTMLContainsSample:true,cartHTML:undefined});
});
test('new reveal uses actual workspace route and real Cart control to expose rendered editable items',()=>{
 const f=createVoidNavFixture();f.reveal();const state=f.snapshot();assert.equal(state.posActive,true);assert.equal(state.navCurrent,'true');assert.equal(state.cartRevealed,true);assert.equal(state.focused,'tkCartBack');assert.match(state.cartHTML,/SAMPLE editable item/);assert.match(state.cartHTML,/SAMPLE note/);assert.match(state.cartHTML,/SAMPLE add-on/);assert.equal(state.cartReferenceRetained,true);const before=JSON.stringify(f.w.cart);f.reveal();assert.equal(JSON.stringify(f.w.cart),before);assert.equal(f.snapshot().cartRevealed,true);observed.push({case:'canonical route plus real Cart toggle',...state,cartHTMLContainsSample:true,cartHTML:undefined});
});

test('actual legacy programmatic switch reproduces the old selector mismatch while correction synchronization fixes both channels',()=>{
 for(const platform of ['Grab','Foodpanda']){const f=createVoidNavFixture(),select=f.d.getElementById('posPlatformSelect');f.w.cart=[];f.w.switchPosPlatform(platform);assert.equal(f.w.posPlatform,platform);assert.equal(select.value,'Standard','Original user-onchange handler never assigns its own selector value');const edited=f.w.cart;restoreVoidPlatform(f.w,f.d,platform,{switchCart:false});assert.equal(select.value,platform);assert.equal(f.w.cart,edited);assert.equal(f.d.getElementById('mainOrderType').value,platform==='Grab'?'Grab':'Food Panda');}
});
test('correction synchronization validates real selector options before touching cart/channel and preserves canonical hidden cart identity',()=>{
 const f=createVoidNavFixture(),select=f.d.getElementById('posPlatformSelect'),cart=f.w.cart;select.options=[{value:'Standard'}];assert.throws(()=>restoreVoidPlatform(f.w,f.d,'Grab'),/not configured/);assert.equal(f.w.cart,cart);assert.equal(f.w.posPlatform,undefined);assert.equal(select.value,'Standard');select.options.push({value:'Grab'});const hidden=[{...f.sample[0],notes:'KEEP EDITED HIDDEN'}];f.w.cart=[];f.w.platformCarts={Standard:f.w.cart,Grab:hidden};restoreVoidPlatform(f.w,f.d,'Grab');assert.equal(f.w.cart,hidden);assert.equal(f.w.platformCarts.Grab,hidden);assert.equal(select.value,'Grab');assert.equal(hidden[0].notes,'KEEP EDITED HIDDEN');
});
