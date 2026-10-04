export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reconcileOrder(saved, available) { return [...new Set([...saved, ...available])].filter(id => available.includes(id)); }
export function renderFinancialFlow({ totalRevenue, totalCOGS, totalPayroll, totalOpEx, netProfit, expenseBreakdown }) {
    const cash = value => new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP',maximumFractionDigits:2}).format(value);
    const cost = (label, amount, action = '') => `<article class="flow-cost"><span>${label}</span><strong>${cash(amount)}</strong>${action}</article>`;
    return `<section class="financial-overview"><div class="flow-revenue"><span>Revenue for the selected period</span><strong>${cash(totalRevenue)}</strong><p>Follow how revenue covers your costs.</p></div><div class="flow-cost-grid">${cost('Recipe costs · COGS',totalCOGS,'<button onclick="window.openFlowCogsModal()">View cost records →</button>')}${cost('Payroll paid',totalPayroll)}${cost('Operating expenses',totalOpEx)}</div><div class="flow-profit ${netProfit < 0 ? 'flow-loss' : ''}"><div><span>Remaining profit</span><strong>${cash(netProfit)}</strong></div><div class="flow-margin">${totalRevenue > 0 ? (netProfit/totalRevenue*100).toFixed(1) : '0.0'}%<small>Profit margin</small></div></div><h3>Operating expense breakdown</h3><div class="flow-expenses">${Object.entries(expenseBreakdown).sort((a,b)=>b[1]-a[1]).map(([name,value])=>`<button class="flow-expense" data-flow-category="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><strong>${cash(value)}</strong><small>View records →</small></button>`).join('') || '<p>No operating expenses in this period.</p>'}</div></section>`;
}
export function initManagerWorkspace() {
    const menu = document.querySelector('.sidebar .nav-menu');
    const edit = document.getElementById('editSidebarTabs');
    if (!menu || !edit) return;
    document.getElementById('nav-products')?.remove();
    const placeSopBelowHr = () => {
        const hr = document.getElementById('nav-payroll')?.closest('.nav-item-wrapper');
        const sop = document.getElementById('nav-sop');
        if (hr?.parentElement === menu && sop?.parentElement === menu) hr.after(sop);
    };
    placeSopBelowHr();
    const rows = [...menu.children].filter(el => el.matches('a,.nav-item-wrapper'));
    const idFor = el => el.id || el.querySelector('[id^="nav-"]')?.id;
    const defaults = rows.map(idFor), byId = new Map(rows.map(el => [idFor(el),el]));
    let editing = false, dragging = null;
    const key = 'takodeal_manager_sidebar_order_v1';
    const save = () => { try { localStorage.setItem(key, JSON.stringify([...menu.children].map(idFor).filter(Boolean))); } catch { window.ManagerUI.notify('This browser could not save your sidebar arrangement.'); } };
    const apply = order => reconcileOrder(order, defaults).forEach(id => menu.append(byId.get(id)));
    try { apply(JSON.parse(localStorage.getItem(key) || '[]')); } catch { apply(defaults); }
    // Apply the requested placement once to existing saved arrangements too.
    // Other tabs retain their order, and future user rearrangements remain editable.
    const sopPlacementKey = 'takodeal_manager_sop_below_hr_v1';
    let sopPlacementApplied = false;
    try { sopPlacementApplied = localStorage.getItem(sopPlacementKey) === 'done'; } catch {}
    if (!sopPlacementApplied) {
        placeSopBelowHr();
        try {
            localStorage.setItem(key, JSON.stringify([...menu.children].map(idFor).filter(Boolean)));
            localStorage.setItem(sopPlacementKey, 'done');
        } catch {}
    }
    for (const row of rows) {
        const controls = document.createElement('span'); controls.className = 'sidebar-move-controls';
        for (const [label,offset,glyph] of [['Move up',-1,'↑'],['Move down',1,'↓']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph; button.title = label; button.setAttribute('aria-label',`${label}: ${row.querySelector('.nav-text')?.textContent || row.textContent}`);
            button.onclick = event => { event.preventDefault(); event.stopPropagation(); const adjacent = offset < 0 ? row.previousElementSibling : row.nextElementSibling; if (adjacent) { if (offset < 0) menu.insertBefore(row,adjacent); else menu.insertBefore(adjacent,row); save(); } };
            controls.append(button);
        }
        row.append(controls);
        row.addEventListener('dragstart', event => { if (!editing) return; dragging = row; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain',idFor(row)); });
        row.addEventListener('dragover', event => { if (editing && dragging) event.preventDefault(); });
        row.addEventListener('drop', event => { if (!editing || !dragging || dragging === row) return; event.preventDefault(); menu.insertBefore(dragging,row); save(); });
        row.addEventListener('dragend', () => dragging = null);
        row.addEventListener('click', event => { if (editing && !event.target.closest('.sidebar-move-controls')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    }
    edit.onclick = () => { editing = !editing; document.querySelector('.sidebar').classList.toggle('sidebar-editing',editing); rows.forEach(row => row.draggable = editing); edit.textContent = editing ? '✓ Done arranging' : '↕ Edit sidebar tabs'; document.getElementById('restoreSidebarTabs').hidden = !editing; };
    document.getElementById('restoreSidebarTabs').onclick = () => { apply(defaults); save(); };
    document.addEventListener('click', event => { const button = event.target.closest('[data-flow-category]'); if (button) window.openFlowOpExModal(button.dataset.flowCategory); });
    window.openStockRequestSchedule = async () => {
        try {
            const ref = window.doc(window.db,'settings','global_delivery_schedule');
            const snap = await window.getDoc(ref); const data = snap.exists() ? snap.data() : {};
            const result = await Swal.fire({ title:'Automatic stock requests', html:`<div class="workspace-dialog-form"><p>Cashiers submit one request after the scheduled time, while their app is open. Pending requests prevent another submission.</p><label><input id="requestEnabled" type="checkbox" ${data.requestEnabled === false ? '' : 'checked'}> Enable automatic requests</label><label>Day<select id="requestDay">${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index)=>`<option value="${index}" ${index === Number(data.requestDay ?? 4) ? 'selected' : ''}>${day}</option>`).join('')}</select></label><label>Time · Philippine time<input id="requestTime" type="time" value="${escapeHtml(data.requestTime ?? '18:00')}"></label></div>`, showCancelButton:true, confirmButtonText:'Save schedule', preConfirm:() => { const time = document.getElementById('requestTime').value; if (!time) { Swal.showValidationMessage('Choose a request time.'); return false; } return {requestEnabled:document.getElementById('requestEnabled').checked,requestDay:Number(document.getElementById('requestDay').value),requestTime:time}; } });
            if (result.isConfirmed) { await window.setDoc(ref,{...result.value,updatedAt:window.serverTimestamp()},{merge:true}); window.ManagerUI.notify('Automatic stock request schedule saved.'); }
        } catch (error) { Swal.fire('Could not save',error.message,'error'); }
    };
}
