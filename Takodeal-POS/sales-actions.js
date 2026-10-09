// Keep receipt actions outside scrolling/clipping panels. No transaction writes.
export function salesActionPosition(rect, menu, viewport) {
    const inset=8,left=viewport.left||0,top=viewport.top||0;
    const width=Math.max(1,viewport.width),height=Math.max(1,viewport.height);
    const menuWidth=Math.max(1,Math.min(menu.width||210,width-inset*2));
    const menuHeight=Math.max(1,Math.min(menu.height||156,height-inset*2));
    return {left:Math.max(left+inset,Math.min(rect.right-menuWidth,left+width-menuWidth-inset)),
        top:rect.bottom+6+menuHeight<=top+height-inset?rect.bottom+6:Math.max(top+inset,rect.top-menuHeight-6),
        width:menuWidth,maxHeight:Math.max(1,height-inset*2)};
}
export function installSalesActions(w=window,d=document) {
    if(w.cashierSalesActions)return w.cashierSalesActions;
    let open=null;
    function sameContext() {
        return open && w.sessionUser===open.session && w.sessionUser?.branch===open.branch
            && w.sessionUser?.cashierName===open.cashierName && w.sessionUser?.email===open.email
            && w.currentShift?.shiftId===open.shift && d.getElementById('view-sales')?.classList.contains('active');
    }
    function visibleAnchor(button,viewport) {
        const rect=button.getBoundingClientRect();
        let left=viewport.left||0,top=viewport.top||0,right=left+viewport.width,bottom=top+viewport.height;
        for(let parent=button.parentElement;parent && parent!==d.body;parent=parent.parentElement) {
            const style=w.getComputedStyle(parent),bounds=parent.getBoundingClientRect();
            if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
            if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}
        }
        return right>left && bottom>top && rect.right>left && rect.left<right && rect.bottom>top && rect.top<bottom;
    }
    function close(focus=false) {
        if(!open)return;const prior=open;open=null;
        prior.menu.classList.remove('show','cashier-sales-actions');prior.menu.style.removeProperty('visibility');
        prior.button.setAttribute('aria-expanded','false');
        if(prior.placeholder.isConnected)prior.placeholder.replaceWith(prior.menu);else prior.menu.remove();
        if(focus && prior.button.isConnected)prior.button.focus();
    }
    function position() {
        if(!open)return;const {button,menu,branch,shift}=open;
        if(!button.isConnected || !open.placeholder.isConnected || !sameContext())return close();
        const rect=button.getBoundingClientRect(),v=w.visualViewport;
        const viewport={left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||w.innerWidth,height:v?.height||w.innerHeight};
        if(!visibleAnchor(button,viewport))return close();
        const coords=salesActionPosition(rect,{width:210,height:menu.scrollHeight},viewport);
        Object.assign(menu.style,{left:coords.left+'px',top:coords.top+'px',width:coords.width+'px',maxHeight:coords.maxHeight+'px',visibility:'visible'});
    }
    function toggle(id) {
        if(open?.menu.id===id)return close(true);
        close();const menu=d.getElementById(id),button=menu?.parentElement?.querySelector('.dot-menu');
        if(!menu || !button || !d.getElementById('view-sales')?.classList.contains('active'))return;
        const placeholder=d.createComment('receipt-actions');menu.replaceWith(placeholder);d.body.append(menu);
        menu.classList.add('cashier-sales-actions','show');menu.style.visibility='hidden';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Receipt actions');
        button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','true');
        menu.querySelectorAll('.action-item').forEach(item=>{item.setAttribute('role','menuitem');item.tabIndex=0;});
        open={menu,button,placeholder,session:w.sessionUser,branch:w.sessionUser?.branch,
            cashierName:w.sessionUser?.cashierName,email:w.sessionUser?.email,shift:w.currentShift?.shiftId};position();
    }
    // Validate before a receipt's inline handler can read a changed cashier or shift.
    d.addEventListener('click',event=>{
        if(!open || !open.menu.contains(event.target))return;
        position();
        if(!open){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    d.addEventListener('click',event=>{
        if(!open)return;if(open.menu.contains(event.target)){if(event.target.closest('.action-item'))close();}
        else if(!open.button.contains(event.target))close();
    });
    d.addEventListener('keydown',event=>{
        if(!open)return;
        if(event.key==='Escape'){event.preventDefault();close(true);return;}
        const items=[...open.menu.querySelectorAll('.action-item')];
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();const current=items.indexOf(d.activeElement);
            const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:(current<0?items.length-1:(current+items.length-1)%items.length);
            items[next]?.focus();
        } else if(['Enter',' '].includes(event.key) && items.includes(d.activeElement)){event.preventDefault();d.activeElement.click();}
    });
    d.addEventListener('scroll',position,true);w.addEventListener('resize',position);w.addEventListener('pagehide',()=>close());
    w.visualViewport?.addEventListener('resize',position);w.visualViewport?.addEventListener('scroll',position);
    const observer=new MutationObserver(position);const rows=d.getElementById('tbTransBody'),view=d.getElementById('view-sales');
    if(rows)observer.observe(rows,{childList:true});if(view)observer.observe(view,{attributes:true,attributeFilter:['class','style']});
    w.cashierSalesActions={toggle,close};return w.cashierSalesActions;
}
