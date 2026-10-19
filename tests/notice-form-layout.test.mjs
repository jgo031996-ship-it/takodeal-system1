import test from 'node:test';
import assert from 'node:assert/strict';
import {installNoticeFormLayout} from '../takodeal-manager/notice-form-layout.js';

function events() {
    const listeners=new Map();
    return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
        emit(type,event={}){const value={type,...event,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};listeners.get(type)?.forEach(fn=>fn(value));return value;},
        count(){return [...listeners.values()].reduce((sum,rows)=>sum+rows.size,0);}};
}
function harness({visualViewport=true,observer=true,oldFocus=false}={}) {
    let next=0,observeCallback=null,disconnected=false,popup=false,closeCalls=0;
    const frames=new Map(),properties=new Map();
    const doc=Object.assign(events(),{activeElement:null,body:{tagName:'BODY'}});
    const node=(name,inside=true)=>({name,inside,isConnected:true,disabled:false,hidden:false,tabIndex:0,focusCalls:0,getAttribute(){return null;},getClientRects(){return this.hidden?[]:[{}];},
        focus(options){if(oldFocus&&options)throw TypeError('Old focus API');this.focusCalls++;doc.activeElement=this;doc.emit('focusin',{target:this});},
        closest(selector){return selector==='input,textarea,select'?null:this;},matches(){return false;}});
    const opener=node('open notice',false),outside=node('another workflow',false),panel=node('dialog');panel.tabIndex=-1;
    const close=node('close'),cancel=node('cancel'),save=node('save'),date=node('date'),amount=node('penalty'),staff=node('staff'),details=node('details'),file=node('optional evidence');
    const controls=[close,staff,date,amount,details,file,cancel,save];
    const viewport=Object.assign(events(),{height:700,width:390,offsetTop:0,offsetLeft:0,scale:1});
    const win=Object.assign(events(),{innerHeight:700,innerWidth:390,getComputedStyle:element=>({display:element.style?.display||'block'}),
        requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),Swal:{isVisible:()=>popup}});
    const modal={hidden:false,style:{display:'none',getPropertyValue:key=>properties.get(key)||'',setProperty(key,value){properties.set(key,value);observeCallback?.();},removeProperty(key){properties.delete(key);observeCallback?.();}},
        contains:element=>element?.inside===true,getAttribute:()=>null,
        querySelector:selector=>selector==='.notice-form-dialog'?panel:selector==='[data-notice-close]'?close:null,querySelectorAll:()=>controls};
    const scroller={inside:true,scrollTop:400,scrollHeight:2000,get clientHeight(){return Math.max(0,parseFloat(properties.get('--notice-viewport-height')||win.innerHeight)-154);},
        getBoundingClientRect(){return {top:74+viewport.offsetTop,bottom:74+viewport.offsetTop+this.clientHeight};}};
    for(const input of [date,amount,staff,details,file]) {
        input.matches=()=>true;input.closest=()=>scroller;input.getBoundingClientRect=()=>({top:74+viewport.offsetTop+770-scroller.scrollTop,bottom:122+viewport.offsetTop+770-scroller.scrollTop});
    }
    date.value='2026-10-19';date.min='2026-10-19';date.max='2027-12-31';date.onchange=()=>{};
    amount.value='0';amount.min='0';amount.step='0.01';amount.oninput=()=>{};
    staff.options=[{value:'Sample Staff',branch:'Maa'}];staff.value='Sample Staff';staff.onchange=()=>{};
    details.value='Saved draft stays exactly as typed.';file.files=[{name:'synthetic-proof.jpg',size:10}];
    close.onclick=cancel.onclick=()=>{closeCalls++;modal.style.display='none';observeCallback?.();};
    close.click=()=>close.onclick();cancel.click=()=>cancel.onclick();
    doc.activeElement=opener;doc.getElementById=id=>id==='issueSanctionModal'?modal:id==='btnSaveSanction'?save:null;
    if(visualViewport)win.visualViewport=viewport;
    if(observer)win.MutationObserver=class{constructor(fn){observeCallback=fn;}observe(){}disconnect(){observeCallback=null;disconnected=true;}};
    const layout=installNoticeFormLayout(doc,win);
    function flush(){let ticks=0;while(frames.size){assert.ok(++ticks<=5,'Viewport writes and observation must settle');const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}}
    function open(){modal.style.display='flex';observeCallback?.();layout.refresh();flush();}
    return {doc,win,modal,panel,viewport,properties,layout,opener,outside,close,cancel,save,date,amount,staff,details,file,scroller,open,flush,
        setPopup:value=>{popup=value;},hide(){modal.style.display='none';observeCallback?.();layout.refresh();flush();},get closeCalls(){return closeCalls;},get disconnected(){return disconnected;}};
}

test('opening announces the dialog without opening or changing native date and currency controls',()=>{
    const h=harness(),options=h.staff.options,change=h.staff.onchange,dateChange=h.date.onchange,amountInput=h.amount.oninput,files=h.file.files;
    h.open();assert.equal(h.doc.activeElement,h.panel);assert.equal(h.date.value,'2026-10-19');assert.equal(h.date.min,'2026-10-19');assert.equal(h.date.max,'2027-12-31');
    assert.equal(h.amount.value,'0');assert.equal(h.amount.min,'0');assert.equal(h.amount.step,'0.01');assert.equal(h.staff.options,options);
    assert.equal(h.staff.onchange,change);assert.equal(h.date.onchange,dateChange);assert.equal(h.amount.oninput,amountInput);assert.equal(h.file.files,files);assert.equal(h.details.value,'Saved draft stays exactly as typed.');h.layout.dispose();
});
test('a narrow keyboard viewport reveals only the current field inside its form scroller',()=>{
    const h=harness();h.open();h.doc.activeElement=h.date;
    h.viewport.height=300;h.viewport.width=320;h.viewport.offsetTop=30;h.viewport.offsetLeft=2;h.viewport.emit('resize');h.flush();
    assert.equal(h.properties.get('--notice-viewport-height'),'300px');assert.equal(h.properties.get('--notice-viewport-top'),'30px');
    assert.equal(h.properties.get('--notice-viewport-width'),'320px');assert.equal(h.properties.get('--notice-viewport-left'),'2px');
    assert.ok(h.date.getBoundingClientRect().bottom<=h.scroller.getBoundingClientRect().bottom-12);assert.equal(h.doc.activeElement,h.date);assert.equal(h.date.value,'2026-10-19');h.layout.dispose();
});
test('a queued keyboard reveal cannot move the Cancel target beneath a pointer or after its tap',()=>{
    const h=harness();h.open();h.doc.activeElement=h.date;const before=h.scroller.scrollTop;
    h.viewport.height=300;h.viewport.emit('resize');h.doc.emit('pointerdown',{pointerId:7,target:h.cancel});h.flush();assert.equal(h.scroller.scrollTop,before);
    h.doc.emit('pointerup',{pointerId:7,target:h.cancel});h.doc.emit('click',{target:h.cancel});h.flush();assert.equal(h.scroller.scrollTop,before);
    h.cancel.click();h.flush();assert.equal(h.closeCalls,1);assert.equal(h.doc.activeElement,h.opener);h.layout.dispose();
});
test('Escape delegates the existing close handler and restores the triggering control',()=>{
    const h=harness();h.open();h.date.focus();const handler=h.close.onclick;
    const event=h.doc.emit('keydown',{key:'Escape'});h.flush();assert.equal(event.prevented,true);assert.equal(h.closeCalls,1);
    assert.equal(h.close.onclick,handler);assert.equal(h.modal.style.display,'none');assert.equal(h.doc.activeElement,h.opener);assert.equal(h.properties.size,0);h.layout.dispose();
});
test('Escape does not close an issuing form or interfere with a nested SweetAlert dialog',()=>{
    const h=harness();h.open();h.save.disabled=true;assert.equal(h.doc.emit('keydown',{key:'Escape'}).prevented,false);assert.equal(h.closeCalls,0);
    h.save.disabled=false;h.setPopup(true);assert.equal(h.doc.emit('keydown',{key:'Escape'}).prevented,false);assert.equal(h.doc.emit('keydown',{key:'Tab'}).prevented,false);
    assert.equal(h.closeCalls,0);assert.equal(h.modal.style.display,'flex');h.layout.dispose();
});
test('Tab and Shift+Tab wrap around visible enabled dialog controls without activating submit',()=>{
    const h=harness();h.open();let submits=0;h.save.onclick=()=>submits++;
    assert.equal(h.doc.emit('keydown',{key:'Tab'}).prevented,true);assert.equal(h.doc.activeElement,h.close);
    h.doc.emit('keydown',{key:'Tab',shiftKey:true});assert.equal(h.doc.activeElement,h.save);
    h.doc.emit('keydown',{key:'Tab'});assert.equal(h.doc.activeElement,h.close);
    h.save.disabled=true;h.doc.emit('keydown',{key:'Tab',shiftKey:true});assert.equal(h.doc.activeElement,h.cancel);assert.equal(submits,0);h.layout.dispose();
});
test('closing does not steal focus from a success popup or another workflow',()=>{
    for(const popup of [false,true]){const h=harness();h.open();h.setPopup(popup);h.doc.activeElement=h.outside;h.hide();assert.equal(h.doc.activeElement,h.outside);assert.equal(h.properties.size,0);h.layout.dispose();}
});
test('intentional pinch zoom keeps browser panning and does not move typed fields',()=>{
    const h=harness();h.open();h.doc.activeElement=h.amount;const before=h.scroller.scrollTop;
    h.viewport.scale=1.6;h.viewport.height=300;h.viewport.emit('scroll');h.flush();assert.equal(h.properties.size,0);assert.equal(h.scroller.scrollTop,before);assert.equal(h.amount.value,'0');h.layout.dispose();
});
test('old viewport/focus APIs keep the form usable and unrelated fields never scroll it',()=>{
    const h=harness({visualViewport:false,observer:false,oldFocus:true});h.open();assert.equal(h.doc.activeElement,h.panel);
    h.win.innerHeight=360;h.win.innerWidth=320;const before=h.scroller.scrollTop;h.doc.activeElement=h.outside;h.win.emit('resize');h.flush();
    assert.equal(h.properties.get('--notice-viewport-height'),'360px');assert.equal(h.properties.get('--notice-viewport-width'),'320px');assert.equal(h.scroller.scrollTop,before);
    h.doc.activeElement=h.date;h.cancel.click();h.layout.refresh();h.flush();assert.equal(h.doc.activeElement,h.opener);h.layout.dispose();
});
test('duplicate installation and disposal never duplicate handlers or leave viewport listeners running',()=>{
    const h=harness();assert.equal(installNoticeFormLayout(h.doc,h.win),h.layout);h.open();h.viewport.emit('resize');h.layout.dispose();h.flush();
    assert.equal(h.properties.size,0);assert.equal(h.disconnected,true);assert.equal(h.doc.count()+h.win.count()+h.viewport.count(),0);
    assert.equal(h.modal.style.display,'flex');assert.equal(h.date.value,'2026-10-19');h.win.emit('resize');h.flush();assert.equal(h.properties.size,0);
});
