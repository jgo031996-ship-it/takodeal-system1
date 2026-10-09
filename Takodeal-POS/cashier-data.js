// Presentation helpers only: no sale, inventory or attendance writes.
import {linkedAttendanceHistory,attendanceKind} from './attendance-reconcile.js';
export const CASHIER_RELEASE = 'staff-pos-repair-20261008-r12';
export function millis(value) {
  if (value == null) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return +value.toDate();
  if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return +new Date(value);
}
export function businessDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}
export function dayWindow(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Choose a valid date.');
  const start = +new Date(day + 'T00:00:00+08:00');
  if (!Number.isFinite(start) || businessDate(new Date(start)) !== day) throw new Error('Choose a valid date.');
  return {start, end:start + 86400000};
}
export function attendanceRows(logs, day, branch = 'All', now = Date.now()) {
  const {start,end} = dayWindow(day), groups = new Map(), rows = [], eligible = [];
  for (const log of logs || []) {
    const time = millis(log.timestamp), name = String(log.staffName || '').trim();
    const location = String(log.branch || 'Unlisted');
    if (!name || !Number.isFinite(time) || time < start - 86400000 || time >= end + 20*3600000 || time > now) continue;
    eligible.push({...log, name, branch:location, time});
  }
  const idsByName = new Map(), idsByStart = new Map(), starts = new Map(eligible.filter(log=>attendanceKind(log)==='TIME IN' && log.id).map(log=>[log.id,log]));
  const addIdentity = (map,key,id) => {if(!id)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(id);};
  for(const log of eligible) {
    addIdentity(idsByName,JSON.stringify([log.name,log.branch]),log.staffId);
    const source=starts.get(log.timeInLogId);
    if(source && !source.staffId && source.name===log.name && source.branch===log.branch)addIdentity(idsByStart,source.id,log.staffId);
  }
  const soleIdentity = values => values?.size===1 ? [...values][0] : '';
  for(const log of eligible) {
    // Projection only: an exact link or a sole name/branch identity keeps old
    // name-only punches together. Ambiguous names never borrow an employee ID.
    const staffId=log.staffId || soleIdentity(idsByStart.get(log.id)) || soleIdentity(idsByName.get(JSON.stringify([log.name,log.branch])));
    const key=JSON.stringify([staffId || log.name,log.branch]);
    if(!groups.has(key))groups.set(key,{staffId,name:log.name,logs:[]});
    groups.get(key).logs.push(staffId && !log.staffId ? {...log,staffId} : log);
  }
  const add = (input,output,status) => {
    const event = input || output;
    if (branch !== 'All' && event.branch !== branch) return;
    const begin = input?.time, finish = output?.time;
    if (!(begin >= start && begin < end) && !(finish >= start && finish < end) &&
        !(input && !output && status === 'On duty' && day === businessDate(new Date(now)))) return;
    rows.push({name:event.name, branch:event.branch, in:begin ?? null, out:finish ?? null,
      status, carryIn:begin < start, hours:input && output ? (finish-begin)/3600000 : null});
  };
  for (const group of groups.values()) {
    for(const shift of linkedAttendanceHistory(group.logs,group.staffId,group.name,new Date(now))) {
      if(shift.in && shift.out) {
        if(shift.hours<=20)add(shift.in,shift.out,'Completed');
        else {add(shift.in,null,'Missing time out');add(null,shift.out,'Missing time in');}
      } else if(shift.in) {
        add(shift.in,null,shift.status==='On duty' && day===businessDate(new Date(now)) && now-shift.in.time<=20*3600000 ? 'On duty':'Missing time out');
      } else if(shift.out)add(null,shift.out,'Missing time in');
    }
  }
  return rows.sort((a,b) => (b.status === 'On duty')-(a.status === 'On duty') || a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
}
export function imageFor(item, catalogue = []) {
  const candidate = item?.image || item?.imageUrl || item?.photoUrl || item?.photoURL || item?.picture;
  const sameName = catalogue.filter(entry => String(entry.name || '').trim().toLowerCase() === String(item?.name || '').trim().toLowerCase());
  const found = candidate || sameName.map(entry => entry.image || entry.imageUrl || entry.photoUrl).find(Boolean);
  if (typeof found !== 'string') return '';
  try { const url = new URL(found, 'https://local.invalid/'); return ['http:','https:','data:'].includes(url.protocol) ? found : ''; }
  catch { return ''; }
}
export function updateBlocker(w) {
  const carts = [w.cart, ...Object.values(w.platformCarts || {}),w.prepCart,w.kitchenPrepCart,w.consumablesCart,w.wasteCart,w.expenseCart];
  if (carts.some(cart => Array.isArray(cart) && cart.length)) return 'Finish or park your order and save any stock, prep or waste entries before updating.';
  if (w.isProcessingOrder || w.isSubmittingOrder || w.isSubmittingWasteCart || w.isProcessingAttendance || w.cashierRemitSubmitting || w.cashierShiftOpening || w.isBluetoothPrinting || w.bluetoothPrintQueue?.length) return 'Please wait for checkout, attendance, remittance, shift opening or printing to finish before updating.';
  return '';
}
export function labelSettings(input = {}) {
  const width = Number(input.width ?? 50), height = Number(input.height ?? 30);
  if (!Number.isFinite(width) || width < 25 || width > 54 || !Number.isFinite(height) || height < 20 || height > 100) throw new Error('Use a label width of 25–54 mm and height of 20–100 mm.');
  return {width,height,dpi:203};
}
export function drinkLabels(receipt, categories = [], catalogue = []) {
  if (!receipt || ['Voided','Cancelled','Parked'].includes(receipt.status) || receipt.paymentMethod === 'UNPAID') return [];
  const drinks = /coffee|latte|tea|milk|shake|smooth|soda|drink|pudding|tiramisu/i;
  const labels = [];
  for (const item of receipt.items || receipt.cart || []) {
    const category=item.category || catalogue.find(product=>product.name===(item.realName || item.name))?.category || '';
    if (!(categories.length ? categories.includes(category) : drinks.test(category))) continue;
    const qty = Number(item.qty ?? item.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) continue;
    const extras = Array.isArray(item.addons) ? item.addons.map(a => typeof a === 'string' ? a : a.name).filter(Boolean).join(', ') : Object.keys(item.addons || {}).join(', ');
    for (let copy=1;copy<=qty;copy++) labels.push({title:String(item.name || 'Drink'), detail:[item.variant || (item.variantName!=='Standard' ? item.variantName : ''),item.size,extras,item.notes || item.note].filter(v=>typeof v==='string' && v).join(' · '),
      customer:String(receipt.customerName || receipt.customer || ''), order:String(receipt.receiptId || receipt.orderId || receipt.id || ''), copy:copy+'/'+qty});
  }
  return labels;
}

export function parkedOrderDetails(order) {
  const time=millis(order.timestamp ?? order.parkedAt ?? order.localTimestamp);
  return {
    name:String(order.name || order.customerName || 'Guest'),
    total:Number(order.total ?? order.netTotal) || 0,
    parkedAt:Number.isFinite(time) ? new Date(time).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}) : 'Parked time not recorded',
    cashier:String(order.cashier || order.parkedBy || 'Not recorded'),
    branch:String(order.branch || 'Not recorded'),
    type:String(order.orderType || 'Not recorded'),
    platform:order.platform==='Grab' || order.platform==='Foodpanda' ? order.platform : 'Store POS',
    items:(Array.isArray(order.items) ? order.items : Array.isArray(order.cart) ? order.cart : []).map(item=>({
      name:String(item.name || 'Item'),qty:Number(item.qty ?? item.quantity) || 1,
      total:Number(item.lineTotalFinal ?? item.lineTotal) || 0,
      variant:item.variantName && item.variantName!=='Standard' ? String(item.variantName) : '',
      notes:String(item.notes || ''),
      addons:Object.entries(item.addons || {}).filter(([,a])=>Number(a?.qty)>0).map(([name,a])=>`${a.qty}× ${name}`)
    }))
  };
}
