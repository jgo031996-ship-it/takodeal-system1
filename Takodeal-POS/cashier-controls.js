// Tablet controls reuse the existing actions; no sale or inventory writes.
const paths = {
  pos:'M3 4h18v13H3z M8 21h8 M12 17v4 M7 8h4 M7 12h7',
  sales:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
  mobilehub:'M7 2h10v20H7z M10 5h4 M11 18h2',
  stockreq:'M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 4 9-4 M12 11v11',
  prep:'M5 4l15 15-3 3-5-5 2-2 M5 4c-3 5 0 10 7 13',
  consumables:'M7 7h10v14H7z M10 3h4v4 M8 12h8 M8 16h8',
  waste:'M4 6h16 M9 6V3h6v3 M7 6l1 15h8l1-15 M10 10v7 M14 10v7',
  schedule:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',
  remit:'M3 7h18v13H3z M3 11h18 M16 16h2 M7 3h10',
  printer:'M6 8V3h12v5 M6 17H3V8h18v9h-3 M6 14h12v8H6z M17 11h1',
  timeclock:'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M12 7v5l3 2',
  bulletin:'M4 9h5l10-5v16L9 15H4z M7 15l2 6h3l-2-6',
  staffreq:'M5 4h14v17H5z M8 3h8v3H8z M8 11h8 M8 15h6',
  sop:'M4 5h16v16H4z M8 3h8v4H8z M8 12l2 2 5-5 M8 18h7',
  deliveries:'M2 5h12v13H2z M14 10h4l4 4v4h-8 M5 18a2 2 0 1 0 4 0 M16 18a2 2 0 1 0 4 0',
  grab:'M3 7h18v13H3z M3 11h18 M16 16h2 M8 7V4h8v3',
  settings:'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2z M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  person:'M12 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M5 21v-3a7 7 0 0 1 14 0v3',
  location:'M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13 M12 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  exit:'M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4',
  collapse:'M4 4h16v16H4z M9 4v16 M16 9l-3 3 3 3',
  more:'M4 6h16 M4 12h16 M4 18h16'
};
export function paintIcon(node, name) {
  if (!node) return;
  node.classList.add('cashier-line-icon'); node.setAttribute('aria-hidden','true');
  node.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+(paths[name] || paths.pos)+'"/></svg>';
}

export function installControls() {
  const get=id=>document.getElementById(id), sidebar=get('mainSidebar');
  if (!sidebar || sidebar.dataset.cashierControls) return;
  sidebar.dataset.cashierControls='1'; document.body.classList.add('cashier-tablet-controls');
  sidebar.querySelectorAll('.nav-item').forEach(item=>paintIcon(item.querySelector('.nav-icon-wrapper > span:first-child') || item.querySelector(':scope > span'), item.id.replace('nav-','')));
  for (const [id,name] of [['displayCashierContainer','person'],['displayBranchContainer','location']]) paintIcon(get(id)?.querySelector('.f-icon'),name);
  paintIcon(sidebar.querySelector('.logout-icon'),'exit');
  document.querySelectorAll('.tk-dock-btn').forEach(button=>paintIcon(button.firstElementChild, button.dataset.target));
  const toggle=document.createElement('button'); toggle.type='button'; toggle.className='cashier-sidebar-toggle';
  paintIcon(toggle,'collapse'); toggle.addEventListener('click',()=>window.toggleSidebar());
  sidebar.querySelector('.brand-container')?.after(toggle);
  const brand=sidebar.querySelector('.brand-container');
  brand?.setAttribute('role','button'); brand?.setAttribute('tabindex','0'); brand?.setAttribute('aria-label','Toggle sidebar');
  brand?.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();brand.click();}});
  try { const saved=localStorage.getItem('takodeal_sidebar_collapsed'); sidebar.classList.toggle('collapsed',saved===null ? window.innerWidth<=1180 : saved==='true'); } catch { sidebar.classList.toggle('collapsed',window.innerWidth<=1180); }
  function syncSidebar(){const collapsed=sidebar.classList.contains('collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.title=collapsed?'Expand sidebar':'Collapse sidebar';toggle.setAttribute('aria-label',toggle.title);try{localStorage.setItem('takodeal_sidebar_collapsed',String(collapsed));}catch{/* The toggle still works without persistence. */}}
  new MutationObserver(syncSidebar).observe(sidebar,{attributes:true,attributeFilter:['class']});syncSidebar();

  const tools=document.createElement('div');tools.className='cashier-sidebar-tools';sidebar.querySelector('.sidebar-footer')?.before(tools);
  const dropdown=get('posSettingsDropdown'), wrap=dropdown?.parentElement, settings=dropdown?.previousElementSibling;
  function labelButton(button,name,label){const icon=document.createElement('span');paintIcon(icon,name);const text=document.createElement('span');text.className='cashier-tool-label';text.textContent=label;button.replaceChildren(icon,text);button.title=label;button.setAttribute('aria-label',label);}
  if(wrap && settings){wrap.classList.add('cashier-side-settings');settings.classList.add('cashier-sidebar-action');labelButton(settings,'settings','Settings');settings.setAttribute('aria-controls','posSettingsDropdown');tools.append(wrap);}
  const shift=get('btnTopShift');
  if(shift){shift.classList.add('cashier-sidebar-action','cashier-side-shift');tools.append(shift);}
  function syncShift(){if(!shift)return;const label=shift.textContent.trim().replace(/^[^\p{L}\p{N}]+/u,'') || 'Shift management';if(!shift.querySelector('.cashier-tool-label') || shift.dataset.cashierLabel!==label){labelButton(shift,'timeclock',label);shift.dataset.cashierLabel=label;}shift.dataset.active=String(/active\s+shift/i.test(label));}
  if(shift)new MutationObserver(syncShift).observe(shift,{childList:true,subtree:true});syncShift();
  function positionSettings(){if(!dropdown || !settings)return;const open=dropdown.style.display==='flex';settings.setAttribute('aria-expanded',String(open));if(!open)return;const rect=settings.getBoundingClientRect(),height=window.visualViewport?.height || window.innerHeight,width=Math.min(300,window.innerWidth-24);const values={'--cashier-settings-x':Math.max(12,Math.min(rect.right+10,window.innerWidth-width-12))+'px','--cashier-settings-y':Math.max(12,Math.min(rect.top,height-Math.min(dropdown.scrollHeight,height-24)-12))+'px'};for(const [key,value] of Object.entries(values))if(dropdown.style.getPropertyValue(key)!==value)dropdown.style.setProperty(key,value);}
  if(dropdown)new MutationObserver(()=>requestAnimationFrame(positionSettings)).observe(dropdown,{attributes:true,attributeFilter:['style']});
  window.addEventListener('resize',positionSettings);document.addEventListener('scroll',positionSettings,true);
  document.addEventListener('click',event=>{if(wrap && !wrap.contains(event.target))dropdown.style.display='none';});

  const header=get('posCartHeader');
  function paintPlatform(){const platform=window.posPlatform || 'Standard';header.dataset.platform=platform;document.body.dataset.posPlatform=platform;const title=header.querySelector('.tk-order-heading strong');if(title)title.textContent=platform==='Standard'?'Current order':platform+' order';}
  const switchPlatform=window.switchPosPlatform;
  window.switchPosPlatform=function(...args){const result=switchPlatform.apply(this,args);paintPlatform();window.renderCashierPayments?.();return result;};paintPlatform();

  const expense=get('expenseModal'), expenseBody=expense?.firstElementChild?.children[1];
  expense?.firstElementChild?.firstElementChild?.classList.add('modal-head');
  expense?.firstElementChild?.lastElementChild?.classList.add('modal-foot');
  get('expQtyInput')?.parentElement?.parentElement?.classList.add('cashier-expense-fields');
  get('expenseCartBody')?.closest('div')?.classList.add('cashier-expense-table');
  expenseBody?.classList.add('modal-body','cashier-expense-body');
  const clearance=get('endShiftModal')?.querySelector('.modal-body');
  clearance?.classList.add('cashier-clearance-grid');
  [...(clearance?.children || [])].forEach((card,index)=>{card.classList.add('cashier-clearance-card');card.dataset.section=['cash','prep','stock'][index];});
  get('endShiftModal')?.firstElementChild?.lastElementChild?.classList.add('modal-foot');
  const countLabel=get('endShiftTitle');if(countLabel)countLabel.textContent='Z-Reading · End of shift';
  const expenseTitle=expense?.querySelector('.modal-head > span:first-child');if(expenseTitle)expenseTitle.textContent='Branch expenses';
  const parkedTitle=get('parkedModal')?.querySelector('.modal-head > span:first-child');if(parkedTitle)parkedTitle.textContent='Parked orders';

  let parkedRefresh;
  function paintParked(){const list=get('parkedListContainer');if(!list)return;const cards=[...list.children];const orders=window.currentParkedOrdersList || [];cards.forEach((card,index)=>{const order=orders[index];if(!order || !card.querySelector('button')){card.classList.add('cashier-parked-empty');return;}card.classList.add('cashier-parked-card');card.querySelector(':scope > div:first-child')?.classList.add('cashier-parked-card-heading');card.querySelector(':scope > div:last-child')?.classList.add('cashier-parked-actions');const remove=card.querySelector('button:last-child');remove?.setAttribute('aria-label','Delete parked order for '+(order.name || 'customer'));});}
  const list=get('parkedListContainer');if(list)new MutationObserver(()=>{if(parkedRefresh)return;parkedRefresh=requestAnimationFrame(()=>{parkedRefresh=null;paintParked();});}).observe(list,{childList:true});
  paintParked();

  // Keep the existing dismiss handlers and add keyboard access to every dialog.
  const dialogs=['parkedModal','shiftModal','endShiftModal','expenseModal','checkoutModal'];
  let lastFocus=null;
  dialogs.forEach(id=>{const root=get(id);if(!root)return;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');const title=root.querySelector('.modal-head > span:first-child');if(title){title.id ||= id+'Heading';root.setAttribute('aria-labelledby',title.id);}const close=root.querySelector('.close-modal') || root.querySelector('.modal-head > span:last-child[onclick]');if(close && close.tagName!=='BUTTON'){const button=document.createElement('button');button.type='button';button.className='close-modal';button.textContent='×';button.setAttribute('aria-label','Close dialog');button.setAttribute('onclick',close.getAttribute('onclick'));close.replaceWith(button);}
    let wasOpen=root.style.display==='flex';new MutationObserver(()=>{const open=root.style.display==='flex';if(open===wasOpen)return;wasOpen=open;if(open){lastFocus=document.activeElement;requestAnimationFrame(()=>root.querySelector('button, input, select')?.focus());}else if(root.contains(document.activeElement))lastFocus?.focus();}).observe(root,{attributes:true,attributeFilter:['style']});
  });
  document.addEventListener('keydown',event=>{const modal=[...dialogs].reverse().map(get).find(root=>root?.style.display==='flex');if(!modal)return;if(event.key==='Escape'){event.preventDefault();modal.querySelector('.close-modal')?.click();}if(event.key==='Tab'){const focusable=[...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(node=>!node.disabled && node.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}});
}
