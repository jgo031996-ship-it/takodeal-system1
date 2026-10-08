import test from 'node:test';
import assert from 'node:assert/strict';
import {salesActionPosition,installSalesActions} from '../Takodeal-POS/sales-actions.js';
test('a receipt Action menu fits above the last row on a small tablet',()=>{
    const p=salesActionPosition({top:490,bottom:525,right:1000},{width:210,height:150},{width:1024,height:600});
    assert.equal(p.top,334);assert.equal(p.left,790);assert.equal(p.width,210);
});
test('receipt menu accounts for an iPhone visual viewport and narrow screen',()=>{
    const p=salesActionPosition({top:650,bottom:695,right:205},{width:210,height:150},{left:0,top:200,width:200,height:500});
    assert.equal(p.width,184);assert.ok(p.left>=8);assert.ok(p.left+p.width<=192);assert.ok(p.top>=208);assert.ok(p.top+150<=692);
});
test('a tall receipt menu retains scrolling within the visible viewport',()=>{
    const p=salesActionPosition({top:100,bottom:144,right:100},{width:210,height:900},{width:390,height:360});
    assert.equal(p.maxHeight,344);assert.equal(p.top,8);assert.equal(p.left,8);
});

function actionHarness() {
    const classes=()=>{const values=new Set();return {add:(...names)=>names.forEach(name=>values.add(name)),remove:(...names)=>names.forEach(name=>values.delete(name)),contains:name=>values.has(name)};};
    const events=new Map(),attributes={},body={append(menu){menu.parentElement=body;}},view={classList:classes()};view.classList.add('active');
    let rect={left:300,right:380,top:250,bottom:280},calls=0;
    const table={parentElement:body,overflowX:'auto',overflowY:'auto',getBoundingClientRect:()=>({left:0,right:600,top:0,bottom:300})};
    const row={parentElement:table,querySelector:()=>button,getBoundingClientRect:table.getBoundingClientRect};
    const button={isConnected:true,parentElement:row,getBoundingClientRect:()=>rect,setAttribute:(key,value)=>attributes[key]=value,contains:()=>false,focus(){}};
    const menu={id:'receipt-menu',parentElement:row,scrollHeight:180,classList:classes(),style:{removeProperty(){}},setAttribute(){},
        querySelectorAll:()=>[],contains:target=>target===item,replaceWith(){},remove(){this.removed=true;}};
    const item={closest:()=>item};
    const d={body,getElementById:id=>id==='view-sales'?view:id===menu.id?menu:null,
        createComment:()=>({isConnected:true,replaceWith(value){value.parentElement=row;}}),
        addEventListener:(name,handler,capture)=>events.set(name+':'+(capture===true),handler)};
    const w={sessionUser:{branch:'Maa',cashierName:'QA cashier'},currentShift:{shiftId:'shift-a'},innerWidth:800,innerHeight:600,
        getComputedStyle:element=>({overflowX:element.overflowX||'visible',overflowY:element.overflowY||'visible'}),addEventListener(){}};
    const prior=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}};
    const actions=installSalesActions(w,d);
    return {w,menu,actions,setRect:value=>{rect=value;},get calls(){return calls;},click(){
        const event={target:item,blocked:false,preventDefault(){this.blocked=true;},stopImmediatePropagation(){this.blocked=true;}};
        events.get('click:true')(event);
        if(!event.blocked){calls++;events.get('click:false')(event);}
        return event.blocked;
    },restore:()=>{globalThis.MutationObserver=prior;}};
}

test('receipt handler cannot run after cashier, branch or shift changes even without scrolling',()=>{
    for(const change of [h=>{h.w.sessionUser={...h.w.sessionUser};},h=>{h.w.sessionUser.branch='Cabantian';},h=>{h.w.currentShift.shiftId='shift-b';}]) {
        const h=actionHarness();try{h.actions.toggle('receipt-menu');assert.equal(h.menu.classList.contains('show'),true);change(h);
            assert.equal(h.click(),true);assert.equal(h.calls,0);assert.equal(h.menu.classList.contains('show'),false);
        }finally{h.restore();}
    }
});

test('a receipt action closes when its anchor is outside the table scroller in either direction',()=>{
    for(const rect of [{left:300,right:380,top:320,bottom:350},{left:640,right:720,top:250,bottom:280}]) {
        const h=actionHarness();try{h.actions.toggle('receipt-menu');h.setRect(rect);
            assert.equal(h.click(),true);assert.equal(h.calls,0);assert.equal(h.menu.classList.contains('show'),false);
        }finally{h.restore();}
    }
});

test('a visible receipt action still invokes its existing handler once',()=>{
    const h=actionHarness();try{h.actions.toggle('receipt-menu');assert.equal(h.click(),false);assert.equal(h.calls,1);assert.equal(h.menu.classList.contains('show'),false);}
    finally{h.restore();}
});
