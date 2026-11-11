import test from 'node:test';
import assert from 'node:assert/strict';
import {initManagerDialogs} from '../takodeal-manager/manager-dialogs.js';

function fixture(){
 let document;const calls=[];
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.open=false;this.disabled=false;this.events=[];this.className='';}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  setAttribute(){}focus(){document.activeElement=this;}
  addEventListener(type,fn,capture=false){this.events.push({type,fn,capture});}
  removeEventListener(type,fn,capture=false){this.events=this.events.filter(row=>row.type!==type||row.fn!==fn||row.capture!==capture);}
  dispatch(type){const event={defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const row of [...this.events].filter(row=>row.type===type).sort((a,b)=>Number(b.capture)-Number(a.capture))){row.fn(event);if(event.stopped)break;}return event;}
  querySelector(){const visit=node=>node.children.flatMap(child=>[child,...visit(child)]);return visit(this).find(node=>['INPUT','TEXTAREA','SELECT','BUTTON'].includes(node.tagName)&&!node.disabled)||null;}
  close(){this.open=false;this.dispatch('close');}
 }
 document={activeElement:null,createElement:tag=>new Element(tag)};document.body=new Element('body');
 const dialog=document.createElement('dialog');dialog.open=true;document.body.append(dialog);const input=document.createElement('input');dialog.append(input);input.focus();
 let current;
 const Swal={fire(options){const container=document.createElement('div');(options.target||document.body).append(container);return new Promise(resolve=>{current={options,container,resolve};calls.push(options);});},getContainer:()=>current?.container,close(result={isDismissed:true}){if(!current)return;const saved=current;current=null;saved.container.parentNode.children=saved.container.parentNode.children.filter(node=>node!==saved.container);saved.resolve(result);saved.options.didClose?.();}};
 const w={};const prior={window:globalThis.window,document:globalThis.document,Swal:globalThis.Swal};Object.assign(globalThis,{window:w,document,Swal});initManagerDialogs();
 return{document,dialog,input,w,Swal,calls,create:tag=>document.createElement(tag),finish:result=>Swal.close(result),async tick(){await new Promise(resolve=>setTimeout(resolve,2));},dispose(){for(const[key,value]of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('ordinary confirm and prompt keep the original body-target options exactly',async()=>{const f=fixture();try{
 const first=f.w.ManagerUI.confirm('Ordinary');assert.deepEqual(f.calls[0],{title:'Confirm action',text:'Ordinary',icon:'question',showCancelButton:true,confirmButtonText:'Continue',cancelButtonText:'Cancel',focusCancel:true});f.finish({isConfirmed:false});assert.equal(await first,false);
 const next=f.w.ManagerUI.prompt('Details','kept');assert.deepEqual(f.calls[1],{title:'Enter details',text:'Details',input:'text',inputValue:'kept',showCancelButton:true,confirmButtonText:'Continue',cancelButtonText:'Cancel'});f.finish({isConfirmed:true,value:'typed'});assert.equal(await next,'typed');
 }finally{f.dispose();}});

test('native-dialog confirmation is inside that same top layer and Escape cancels only its prompt',async()=>{const f=fixture();try{
 let parentCancel=0;f.dialog.addEventListener('cancel',()=>parentCancel++);const work=f.w.ManagerUI.confirm('Receive sample cash?',{target:f.dialog});const opts=f.calls[0];assert.equal(opts.target,f.dialog);assert.equal(f.Swal.getContainer().parentNode,f.dialog);assert.equal(opts.focusCancel,true);assert.equal(opts.keydownListenerCapture,true);assert.equal(opts.returnFocus,false);
 const event=f.dialog.dispatch('cancel');assert.equal(event.defaultPrevented,true);assert.equal(parentCancel,0);assert.equal(await work,false);assert.equal(f.dialog.open,true);await f.tick();assert.equal(f.document.activeElement,f.input);assert.equal(f.dialog.events.filter(row=>row.capture).length,0);
 f.dialog.dispatch('cancel');assert.equal(parentCancel,1,'normal parent Escape behavior is restored');
 }finally{f.dispose();}});

test('prompt supports the same target, result and focus protection',async()=>{const f=fixture();try{const work=f.w.ManagerUI.prompt('Reason','original',{target:f.dialog});assert.equal(f.calls[0].target,f.dialog);f.finish({isConfirmed:true,value:'reviewed'});assert.equal(await work,'reviewed');await f.tick();assert.equal(f.document.activeElement,f.input);}finally{f.dispose();}});

test('a closed, detached, foreign or non-dialog target cannot open a hidden confirmation',async()=>{const f=fixture();try{for(const change of[target=>target.open=false,target=>target.ownerDocument={},target=>target.tagName='DIV',target=>f.document.body.children=[]]){const target=f.create('dialog');target.open=true;f.document.body.append(target);change(target);await assert.rejects(f.w.ManagerUI.confirm('No action',{target}),/Reopen this review/);}assert.equal(f.calls.length,0);}finally{f.dispose();}});

test('closing the native review dismisses its pending prompt and never restores focus into a closed form',async()=>{const f=fixture();try{const work=f.w.ManagerUI.confirm('No hidden decision',{target:f.dialog});f.dialog.close();assert.equal(await work,false);f.document.activeElement=f.document.body;await f.tick();assert.equal(f.document.activeElement,f.document.body);assert.equal(f.dialog.events.length,0);}finally{f.dispose();}});

test('focus restores after busy controls unlock but never steals focus from another active dialog',async()=>{const f=fixture();try{f.input.disabled=true;const work=f.w.ManagerUI.confirm('Busy form',{target:f.dialog});f.finish({isConfirmed:false});assert.equal(await work,false);f.input.disabled=false;await f.tick();assert.equal(f.document.activeElement,f.input);
 const next=f.w.ManagerUI.confirm('Second',{target:f.dialog});f.finish({isConfirmed:false});await next;const other=f.create('button');f.document.body.append(other);other.focus();await f.tick();assert.equal(f.document.activeElement,other);
 }finally{f.dispose();}});
