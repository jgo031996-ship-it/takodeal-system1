export const escapeRiderText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function riderMoney(value) {
    if((typeof value!=='number' && typeof value!=='string') || String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0)return 'Amount unavailable';
    return '₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function riderMapURL(order) {
    try {
        const url=new URL(order.mapLink);
        if(url.protocol==='https:' && ['google.com','www.google.com','maps.google.com','maps.app.goo.gl','goo.gl','waze.com','www.waze.com'].includes(url.hostname))return url.href;
    }catch{}
    return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(String(order.deliveryAddress||order.branch||''));
}
export function riderPayment(order) {
    const mode=String(order.paymentMethod||order.paymentMode||'Cash').trim().toLowerCase();
    return ['cash','cod','cash on delivery','cash upon delivery'].includes(mode)?'cash':'prepaid';
}
export function renderRiderDispatch(api,d=document) {
    const board=d.getElementById('dispatchBoard'),container=d.getElementById('dispatchBoardContainer'),radar=d.getElementById('radarScreen');
    if(!board || !container || !radar)return;
    const rider=api.currentRider,active=api.isRiderApproved?.(rider)===true;
    const orders=active?(api.activeDeliveries||[]):[];
    const available=orders.filter(o=>o.status==='ready'),mine=orders.filter(o=>o.status==='out_for_delivery' && o.riderId===rider?.id);
    const tab=api.currentRiderTab==='Ongoing'?'Ongoing':'Pending',shown=tab==='Ongoing'?mine:available;
    for(const [id,count] of [['riderOpenCount',available.length],['riderOngoingCount',mine.length]])if(d.getElementById(id))d.getElementById(id).textContent=String(count);
    for(const [id,selected] of [['tabPending',tab==='Pending'],['tabOngoing',tab==='Ongoing']])d.getElementById(id)?.setAttribute('aria-pressed',String(selected));
    if(!shown.length){
        board.replaceChildren?.();container.style.display='none';radar.style.display='flex';
        const online=rider?.isAcceptingOrders===true;
        const title=!active?'Approval required':tab==='Ongoing'?'No deliveries in progress':online?'Ready for your next delivery':'You’re offline';
        const message=!active?'Manager must approve your account before delivery access.':tab==='Ongoing'?'Your accepted deliveries appear here.':'Go online when you’re ready. New available orders appear here automatically.';
        if(d.getElementById('riderEmptyTitle'))d.getElementById('riderEmptyTitle').textContent=title;
        if(d.getElementById('riderEmptyMessage'))d.getElementById('riderEmptyMessage').textContent=message;
        return;
    }
    radar.style.display='none';container.style.display='block';board.style.display='flex';
    board.innerHTML=shown.map(order=>{
        const id=encodeURIComponent(String(order.id)).replace(/'/g,'%27'),code=escapeRiderText(order.orderCode||order.id),amount=escapeRiderText(riderMoney(order.totalAmount));
        const customer=escapeRiderText(String(order.customerName||'Customer').split('(')[0].trim()),branch=escapeRiderText(order.branch||'Contact Manager for pickup details');
        const address=escapeRiderText(order.deliveryAddress||'Address not provided. Contact the customer before pickup.');
        const phone=String(order.contactNumber||'').replace(/[^0-9+]/g,''),phoneLink=/^\+?[0-9]{7,15}$/.test(phone)?`<a class="rider-button secondary" href="tel:${escapeRiderText(phone)}">Call customer</a>`:'<p class="rider-status">No customer phone number provided.</p>';
        const payment=riderPayment(order),cash=payment==='cash',mine=order.status==='out_for_delivery';
        const fee=order.deliveryFee==null?'Fee not listed':riderMoney(order.deliveryFee);
        const action=mine?`<button type="button" class="rider-button btn-action" onclick="window.completeDelivery(decodeURIComponent('${id}'))">Mark delivered · Add proof</button>`:`<button type="button" class="rider-button btn-action" onclick="window.claimDelivery(decodeURIComponent('${id}'))" ${!api.currentRider?.isAcceptingOrders?'disabled':''}>Accept delivery${cash?' · Wallet '+amount:''}</button>`;
        return `<article class="rider-order-card order-card"><div class="rider-order-heading"><h2>${code}</h2><strong>${amount}</strong></div><p class="rider-order-state">${mine?'Your delivery in progress':'Ready for pickup'} · ${cash?'Cash on delivery':'Online payment'}</p><dl class="rider-order-details"><div><dt>Pickup</dt><dd>${branch}</dd></div><div><dt>Customer</dt><dd>${customer}</dd></div><div><dt>Drop-off</dt><dd>${address}</dd></div><div><dt>Delivery fee</dt><dd>${escapeRiderText(fee)}</dd></div></dl><div class="rider-order-actions">${phoneLink}<a class="rider-button secondary" href="${escapeRiderText(riderMapURL(order))}" target="_blank" rel="noopener noreferrer">Open directions ↗</a></div><p class="rider-order-help">${mine?'Save a clear delivery photo to finish this order.':cash?'Accepting this delivery reserves the shown order amount from your rider wallet.':'Manager must verify the linked online payment before this delivery can be accepted.'}</p>${action}</article>`;
    }).join('');
}
