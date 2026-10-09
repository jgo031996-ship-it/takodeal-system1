import test from 'node:test';
import assert from 'node:assert/strict';
import {installRiderLayout} from '../takodeal-delivery/rider-layout.js';

function events(){const listeners=new Map();return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type,data={}){listeners.get(type)?.forEach(fn=>fn({type,...data}));},count(type){return type?listeners.get(type)?.size||0:[...listeners.values()].reduce((sum,set)=>sum+set.size,0);}};}
function harness({defaultBusy=false}={}){
 const all=[],frames=new Map();let next=0,reloads=0,busy=false;
 function node(tag='div',id=''){const props=new Map(),attrs=new Map();const n=Object.assign(events(),{tagName:tag.toUpperCase(),id,style:{setProperty:(key,value)=>props.set(key,value),removeProperty:key=>props.delete(key),getPropertyValue:key=>props.get(key)||''},dataset:{},hidden:false,children:[],textContent:'',removed:false,setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),append(...children){children.forEach(child=>{child.parent=this;this.children.push(child);});},after(child){child.parent=this.parent;this.parent?.children.push(child);},remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}});all.push(n);return n;}
 const root=node('html'),shell=node(),connection=node('div','riderConnectionStatus'),notice=node('div','riderUpdateNotice'),install=node('button','riderInstallButton');shell.append(connection,notice,install);
 const doc=Object.assign(events(),{documentElement:root,visibilityState:'visible',activeElement:null,getElementById:id=>all.find(n=>n.id===id&&!n.removed),createElement:tag=>node(tag)});
 const viewport=Object.assign(events(),{height:700,offsetTop:0,scale:1}),mode=Object.assign(events(),{matches:false});
 const service=Object.assign(events(),{controller:{id:'old'},getRegistration:async()=>null});
 const win=Object.assign(events(),{innerHeight:700,visualViewport:viewport,navigator:{onLine:true,serviceWorker:service},matchMedia:()=>mode,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),location:{reload:()=>reloads++},localStorage:{getItem(){throw Error('Layout must not read account data');},setItem(){throw Error('Layout must not mutate account data');}}});
 const scroller={scrollTop:300,scrollHeight:1300,get clientHeight(){return Number.parseFloat(root.style.getPropertyValue('--rider-viewport-height')||'700')-100;},getBoundingClientRect(){return {top:44,bottom:44+this.clientHeight};}};
 const field={value:'0123',disabled:false,readOnly:false,matches:()=>true,closest:()=>scroller,getBoundingClientRect:()=>({top:44+750-scroller.scrollTop,bottom:92+750-scroller.scrollTop})};
 const layout=defaultBusy?installRiderLayout(doc,win):installRiderLayout(doc,win,{isBusy:()=>busy});
 function flush(){let ticks=0;while(frames.size){if(++ticks>5)throw Error('Layout refresh loop');const fns=[...frames.values()];frames.clear();fns.forEach(fn=>fn());}}
 const messages=[],worker=Object.assign(events(),{state:'installed',postMessage:value=>messages.push(value)}),registration=Object.assign(events(),{waiting:worker,installing:null,update:async()=>{}});
 return {doc,win,root,viewport,mode,service,connection,notice,install,scroller,field,layout,worker,registration,messages,all,flush,set busy(value){busy=value;},get reloads(){return reloads;}};
}

test('Keyboard resizing bounds the visible shell and reveals the active PIN without changing it',()=>{
 const h=harness();h.doc.activeElement=h.field;h.viewport.height=320;h.viewport.emit('resize');h.flush();
 assert.equal(h.root.style.getPropertyValue('--rider-viewport-height'),'320px');assert.equal(h.root.style.getPropertyValue('--rider-keyboard-inset'),'380px');
 assert.ok(h.field.getBoundingClientRect().bottom<=248);assert.equal(h.field.value,'0123');assert.equal(h.doc.activeElement,h.field);h.layout.dispose();
});
test('A queued keyboard reveal cannot move Back to sign in during its pointer gesture or reveal its stale PIN afterward',()=>{
 const h=harness();h.doc.activeElement=h.field;const before=h.scroller.scrollTop;
 h.viewport.height=320;h.viewport.emit('resize');
 const back={closest:()=>null};h.doc.emit('pointerdown',{pointerId:1,target:back});h.flush();
 assert.equal(h.root.style.getPropertyValue('--rider-viewport-height'),'320px');assert.equal(h.scroller.scrollTop,before);
 h.doc.emit('pointerup',{pointerId:1,target:back});h.flush();assert.equal(h.scroller.scrollTop,before);assert.equal(h.field.value,'0123');
 const newInput={...h.field,value:'09000000000'};h.doc.activeElement=newInput;h.doc.emit('focusin',{target:newInput});h.flush();
 assert.ok(newInput.getBoundingClientRect().bottom<=248);assert.equal(newInput.value,'09000000000');h.layout.dispose();
});
test('Tapping the same PIN deliberately restores reveal after the gesture, including pointer cancellation',()=>{
 const h=harness();h.doc.activeElement=h.field;const before=h.scroller.scrollTop;h.viewport.height=320;
 h.doc.emit('pointerdown',{pointerId:1,target:{closest:()=>null}});h.doc.emit('pointerup',{pointerId:1});h.flush();assert.equal(h.scroller.scrollTop,before);
 h.doc.emit('pointerdown',{pointerId:2,target:{closest:()=>h.field}});h.viewport.emit('resize');h.flush();assert.equal(h.scroller.scrollTop,before);
 h.doc.emit('pointercancel',{pointerId:2});h.flush();assert.ok(h.field.getBoundingClientRect().bottom<=248);assert.equal(h.field.value,'0123');h.layout.dispose();
});
test('Viewport panning is measured from the visible top and intentional pinch zoom remains browser-controlled',()=>{
 const h=harness();h.viewport.height=400;h.viewport.offsetTop=80;h.layout.refreshViewport();assert.equal(h.root.style.getPropertyValue('--rider-viewport-top'),'80px');assert.equal(h.root.style.getPropertyValue('--rider-keyboard-inset'),'220px');
 h.doc.activeElement=h.field;const scroll=h.scroller.scrollTop;h.viewport.scale=1.4;h.layout.refreshViewport();assert.equal(h.root.style.getPropertyValue('--rider-viewport-height'),'');assert.equal(h.scroller.scrollTop,scroll);h.layout.dispose();
});
test('Keyboard closing expands the shell without replacing inputs or clearing scroll position',()=>{
 const h=harness();h.doc.activeElement=h.field;h.viewport.height=320;h.layout.refreshViewport();const scroll=h.scroller.scrollTop;h.doc.activeElement=null;h.viewport.height=700;h.viewport.emit('resize');h.flush();
 assert.equal(h.root.style.getPropertyValue('--rider-viewport-height'),'700px');assert.equal(h.root.style.getPropertyValue('--rider-keyboard-inset'),'0px');assert.equal(h.scroller.scrollTop,scroll);assert.equal(h.field.value,'0123');h.layout.dispose();
});
test('Connection hints update on browser events without making business calls',()=>{
 const h=harness();assert.equal(h.connection.textContent,'Connection available');h.win.navigator.onLine=false;h.win.emit('offline');assert.equal(h.connection.dataset.online,'false');assert.match(h.connection.textContent,/reconnect/);
 h.win.navigator.onLine=true;h.win.emit('online');assert.equal(h.connection.dataset.online,'true');assert.equal(h.reloads,0);h.layout.dispose();
});
test('An update needs a user action and an explicitly idle host before activating and reloading',()=>{
 const h=harness();h.layout.watchRegistration(h.registration);assert.equal(h.notice.hidden,false);assert.equal(h.messages.length,0);assert.equal(h.reloads,0);
 assert.equal(h.layout.applyUpdate(),true);assert.deepEqual(h.messages,[{type:'SKIP_WAITING'}]);h.service.controller={id:'new'};h.service.emit('controllerchange');h.service.emit('controllerchange');assert.equal(h.reloads,1);h.layout.dispose();
});
test('Registration, login or delivery work blocks update activation without changing stored data',()=>{
 const h=harness();h.layout.watchRegistration(h.registration);h.busy=true;assert.equal(h.layout.applyUpdate(),false);assert.equal(h.messages.length,0);assert.equal(h.reloads,0);assert.match(h.doc.getElementById('riderUpdateMessage').textContent,/Finish your current action/);h.layout.dispose();
});
test('Missing host busy integration fails closed for updates',()=>{
 const h=harness({defaultBusy:true});h.layout.watchRegistration(h.registration);assert.equal(h.layout.applyUpdate(),false);assert.equal(h.messages.length,0);assert.equal(h.reloads,0);h.layout.dispose();
});
test('Work started after activation delays reload until another idle user click',()=>{
 const h=harness();h.layout.watchRegistration(h.registration);h.layout.applyUpdate();h.busy=true;h.service.controller={id:'new'};h.service.emit('controllerchange');assert.equal(h.reloads,0);
 h.busy=false;assert.equal(h.reloads,0);assert.equal(h.layout.applyUpdate(),true);assert.equal(h.reloads,1);assert.equal(h.messages.length,1);h.layout.dispose();
});
test('Background controller changes and unrequested activations cannot silently reload the app',()=>{
 const h=harness();h.service.controller={id:'other'};h.service.emit('controllerchange');assert.equal(h.reloads,0);
 h.layout.watchRegistration(h.registration);h.layout.applyUpdate();h.doc.visibilityState='hidden';h.service.controller={id:'new'};h.service.emit('controllerchange');assert.equal(h.reloads,0);
 h.doc.visibilityState='visible';h.doc.emit('visibilitychange');assert.equal(h.reloads,0);h.layout.applyUpdate();assert.equal(h.reloads,1);h.layout.dispose();
});
test('The install prompt is shown only from an idle button action and is hidden after app installation',async()=>{
 const h=harness();let opened=0,prevented=0;h.win.emit('beforeinstallprompt',{preventDefault(){prevented++;},async prompt(){opened++;},userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(prevented,1);assert.equal(opened,0);
 h.busy=true;assert.equal(await h.layout.requestInstall(),false);assert.equal(opened,0);h.busy=false;assert.equal(await h.layout.requestInstall(),true);assert.equal(opened,1);
 h.win.emit('appinstalled');assert.equal(h.install.hidden,true);h.layout.dispose();
});
test('Standalone display hides installation, while unsupported prompting shows local instructions',async()=>{
 const h=harness();h.mode.matches=true;h.mode.emit('change');assert.equal(h.install.hidden,true);h.mode.matches=false;h.mode.emit('change');assert.equal(h.install.hidden,false);
 assert.equal(await h.layout.requestInstall(),false);assert.match(h.doc.getElementById('riderInstallHelp').textContent,/Add to Home Screen/);assert.equal(h.reloads,0);h.layout.dispose();
});
test('Installation completion before userChoice settles cannot reshow the Install button',async()=>{
 const h=harness();let settle;const choice=new Promise(resolve=>{settle=resolve;});h.win.emit('beforeinstallprompt',{preventDefault(){},async prompt(){},userChoice:choice});
 const pending=h.layout.requestInstall();h.win.emit('appinstalled');settle({outcome:'accepted'});assert.equal(await pending,true);assert.equal(h.install.hidden,true);h.layout.dispose();
});
test('Repeated installation shares listeners and disposal removes viewport and worker hooks',()=>{
 const h=harness();assert.equal(installRiderLayout(h.doc,h.win),h.layout);assert.equal(h.viewport.count('resize'),1);h.layout.watchRegistration(h.registration);h.layout.watchRegistration(h.registration);assert.equal(h.registration.count('updatefound'),1);
 h.viewport.emit('resize');h.layout.dispose();h.flush();assert.equal(h.viewport.count(),0);assert.equal(h.win.count(),0);assert.equal(h.doc.count(),0);assert.equal(h.service.count(),0);assert.equal(h.registration.count(),0);assert.equal(h.root.style.getPropertyValue('--rider-viewport-height'),'');
});
