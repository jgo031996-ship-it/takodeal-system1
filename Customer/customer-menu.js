// Public catalogue helpers. Order submission still requires authenticated,
// server-confirmed branch availability in TKCustomerGate.
export const MENU_CACHE_KEY = 'tk_customer_menu_v1';
export const MENU_TTL = 30 * 60 * 1000;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const encodeItem = item => encodeURIComponent(JSON.stringify(item)).replace(/'/g, '%27');
const categoryKey = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
const internalCategories = new Set(['consumables','prepbatch','preparedbatch','rawingredients','kitchenprep','takeoutpackaging','extras']);
export function itemPrice(item) {
    const price = Number(item?.price ?? item?.basePrice);
    return Number.isFinite(price) && price >= 0 ? price : null;
}
export function publicItem(item, branch) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || itemPrice(item) === null) return false;
    if (internalCategories.has(categoryKey(item.category))) return false;
    if (item.isAvailable === false || item.customerVisible === false) return false;
    // Missing configuration means unrestricted; an explicit empty selection means none.
    if (Array.isArray(branch?.allowedCategories) && !branch.allowedCategories.some(c => categoryKey(c) === categoryKey(item.category || 'Other'))) return false;
    return true;
}
export const soldOut = (item, branch) => Array.isArray(item?.unavailableAt) && item.unavailableAt.includes(branch);
export function buildMenu(raw, branch = {}) {
    const groups = new Map(), variants = Object.create(null), categories = Object.create(null), menu = [];
    const items = (Array.isArray(raw) ? raw : []).filter(item => publicItem(item, branch));
    items.sort((a,b) => (Number(a.displayOrder ?? a.order ?? 9999) - Number(b.displayOrder ?? b.order ?? 9999)) || a.name.localeCompare(b.name, undefined, {numeric:true}));
    for (const original of items) {
        const item = {...original, price:itemPrice(original), isSoldOut:soldOut(original, branch.name)};
        const category = (item.category || 'Other').trim();
        const match = item.name.match(/^(.*?)\s+(\d+\s*Pcs|[SML]|Duo|Solo|Trio|Squad|Platter|Family)$/i);
        if (match) {
            const baseName = match[1].trim(), key = category + '\0' + baseName;
            let group = groups.get(key);
            if (!group) {
                group = {...item, name:baseName, isGrouped:true, variantKey:key};
                groups.set(key, group); variants[key] = []; menu.push(group);
            }
            variants[key].push({...item, realName:item.name, sizeLabel:match[2].trim()});
        } else menu.push(item);
    }
    for (const [key, group] of groups) {
        variants[key].sort((a,b) => a.price-b.price);
        const available = variants[key].filter(v=>!v.isSoldOut);
        group.isSoldOut = !available.length;
        group.price = (available[0] || variants[key][0]).price;
    }
    const categoryOrder = Array.isArray(branch.allowedCategories) ? branch.allowedCategories.map(categoryKey) : [];
    const names = [...new Set(menu.map(i=>(i.category || 'Other').trim()))];
    names.sort((a,b) => {
        const ai=categoryOrder.indexOf(categoryKey(a)), bi=categoryOrder.indexOf(categoryKey(b));
        return (ai<0?999:ai)-(bi<0?999:bi) || a.localeCompare(b);
    });
    for (const name of names) categories[name] = menu.filter(i=>(i.category || 'Other').trim()===name);
    return {menu, variants, categories};
}
export function withinBranchHours(hours, now = new Date()) {
    const parts = String(hours || '').replace(/\([^)]*\)/g,'').split(/\s*[-–—]\s*/);
    function minutes(text) {
        const m=String(text).match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
        if (!m || +m[1]<1 || +m[1]>12) return null;
        return (+m[1]%12 + (/pm/i.test(m[3])?12:0))*60 + +m[2];
    }
    if (parts.length!==2) return true; // Unknown hours: use the live branch gate.
    const start=minutes(parts[0]), end=minutes(parts[1]);
    if (start===null || end===null || start===end) return true;
    const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const current=+local.find(p=>p.type==='hour').value*60 + +local.find(p=>p.type==='minute').value;
    return start<end ? current>=start && current<end : current>=start || current<end;
}
export function readMenuCache(storage, now=Date.now()) {
    try {
        const cached=JSON.parse(storage.getItem(MENU_CACHE_KEY));
        if (cached?.version===1 && Array.isArray(cached.items) && Number.isFinite(cached.savedAt) && now>=cached.savedAt && now-cached.savedAt<MENU_TTL) return cached.items;
    } catch {}
    return null;
}
export function writeMenuCache(storage, items, now=Date.now()) {
    try {storage.setItem(MENU_CACHE_KEY, JSON.stringify({version:1,savedAt:now,items}));} catch {}
}
export function readCart(storage) {
    try {
        const cart=JSON.parse(storage.getItem('takodeal_customer_cart'));
        return Array.isArray(cart) ? cart.filter(i=>typeof i?.name==='string' && Number.isInteger(i.quantity) && i.quantity>0 && Number.isFinite(i.price) && i.price>=0 && Number.isFinite(i.lineTotalFinal) && i.lineTotalFinal>=0) : [];
    } catch {return [];}
}
export function validateCart(cart, raw, branch) {
    if (!Array.isArray(cart) || !cart.length) throw new Error('Your cart is empty. Please add an item first.');
    for (const line of cart) {
        if (!Number.isInteger(line.quantity) || line.quantity<1) throw new Error('Please review the quantities in your cart.');
        const matches=raw.filter(i=>line.menuId ? i.id===line.menuId : i.name===line.name);
        const item=matches.length===1 ? matches[0] : null;
        if (!item || !publicItem(item,branch) || soldOut(item,branch.name)) throw new Error(`${line.name} is currently unavailable. Please remove it from your cart.`);
        if (line.price!==itemPrice(item)) throw new Error(`The price of ${line.name} has changed. Please remove it and add it again.`);
        let addons=0;
        for (const extra of Object.values(line.addons || {})) {
            if (!Number.isInteger(extra.qty) || extra.qty<0 || extra.qty>10) throw new Error('Please review your add-ons.');
            const configured=(item.addons || []).filter(a=>a.name===extra.name);
            const isBaseSauce=['Regular Sauce','Spicy Sauce'].includes(extra.name) && (item.addons || []).some(a=>['Regular Sauce','Spicy Sauce'].includes(a.name));
            const price=isBaseSauce ? 0 : configured.reduce((sum,a)=>sum+(Number(a.price)||0),0);
            if ((!configured.length && !isBaseSauce) || Number(extra.price)!==price) throw new Error(`The add-ons for ${line.name} have changed. Please add this item again.`);
            addons+=price*extra.qty;
        }
        const total=(itemPrice(item)+addons)*line.quantity;
        if (!Number.isFinite(line.lineTotalFinal) || Math.abs(total-line.lineTotalFinal)>0.005) throw new Error('Please review the totals in your cart.');
    }
    return cart.reduce((sum,i)=>sum+i.lineTotalFinal,0);
}
