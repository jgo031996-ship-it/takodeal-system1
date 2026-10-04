// Presentation helpers only: no sale, inventory or attendance writes.
export const CASHIER_RELEASE = 'cashier-orange-20261004-r2';
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
  const {start,end} = dayWindow(day), groups = new Map(), rows = [];
  for (const log of logs || []) {
    const time = millis(log.timestamp), name = String(log.staffName || '').trim();
    const location = String(log.branch || 'Unlisted');
    if (!name || !Number.isFinite(time) || time < start - 86400000 || time >= end + 20*3600000 || time > now) continue;
    const key = JSON.stringify([name,location]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({...log, name, branch:location, time});
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
  for (const entries of groups.values()) {
    entries.sort((a,b) => a.time-b.time || (a.type === 'TIME IN' ? -1 : 1));
    let open = null;
    for (const log of entries) {
      if (log.type === 'TIME IN') {
        if (open) add(open,null,'Missing time out');
        open = log;
      } else if (log.type === 'TIME OUT') {
        if (open && log.time-open.time <= 20*3600000) add(open,log,'Completed');
        else { if (open) add(open,null,'Missing time out'); add(null,log,'Missing time in'); }
        open = null;
      }
    }
    if (open) add(open,null,day === businessDate(new Date(now)) && now-open.time <= 20*3600000 ? 'On duty' : 'Missing time out');
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
  if (w.isProcessingOrder || w.isSubmittingOrder || w.isSubmittingWasteCart || w.isProcessingAttendance || w.cashierRemitSubmitting || w.isBluetoothPrinting || w.bluetoothPrintQueue?.length) return 'Please wait for checkout, attendance, remittance or printing to finish before updating.';
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
