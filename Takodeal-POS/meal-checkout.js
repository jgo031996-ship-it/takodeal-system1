import {mealLevels,isMealType,requireMealLevel,mealDiscount,validateCheckoutFields,checkoutSelections} from './pos-config-model.js';
import {resolveHQAccount,mealRole,savedPin} from './hq-account-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ verification timed out. Check the connection and retry.')),12000);})]);}finally{clearTimeout(timer);}}
const mealRequest=data=>data.status!=='Voided'&&(data.mealRole==='staff'||String(data.type||'').toLowerCase().includes('staff meal'));
function requestTime(value){
    try{
        if(value instanceof Date)return value.getTime();
        if(typeof value?.toMillis==='function')return value.toMillis();
        if(typeof value?.toDate==='function')return value.toDate().getTime();
        if(typeof value?.seconds==='number'&&Number.isFinite(value.seconds))return value.seconds*1000+(Number(value.nanoseconds)||0)/1e6;
        if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value))return Date.parse(value);
    }catch{}
    return NaN;
}
export async function readStaffMealClaims(api,{staffName,start}){
    if(typeof staffName!=='string'||!staffName.trim()||!(start instanceof Date)||!Number.isFinite(start.getTime()))throw Error('Choose a verified staff member before checking the meal history.');
    const collection=api.collection(api.db,'staff_requests'),person=api.where('staffName','==',staffName);
    try{return await bounded(api.getDocsFromServer(api.query(collection,person,api.where('timestamp','>=',start))));}
    catch(error){
        // Only a missing composite index permits a different query. Permission,
        // connection and unrelated precondition failures never approve a meal.
        if(!['failed-precondition','firestore/failed-precondition'].includes(error?.code)||!/requires an index|missing.{0,30}index|index.{0,30}(required|missing|building|not ready)/i.test(String(error.message||'')))throw error;
    }
    // Keep the exact verified person's scope; no whole-collection scan or
    // limit that could hide a claim made earlier today. The ordinary indexed
    // date-range lookup remains the fast path once the HQ index is ready.
    const result=await bounded(api.getDocsFromServer(api.query(collection,person))),docs=[];
    for(const row of result.docs){
        const data=row.data();if(data.staffName!==staffName||!mealRequest(data))continue;
        const timestamp=requestTime(data.timestamp);
        if(!Number.isFinite(timestamp))throw Error('A previous meal record has no valid date. Ask HQ to review it before recording another meal. Your cart was kept.');
        if(timestamp>=start.getTime())docs.push(row);
    }
    return {docs};
}
export async function findMealIdentity(api,pin,level) {
    if(String(pin).length<4)throw Error('Enter at least 4 characters for the PIN.');
    const queries=[];
    // Staff-only levels use the public operational Staff profiles. A PIN-only
    // Cashier is not authorized to read the protected HQ directory, and that
    // unrelated lookup must not block an otherwise valid Staff meal.
    const sources=level.roles.some(role=>role!=='staff')?['cashiers','hq_managers']:['cashiers'];
    for(const source of sources)for(const field of source==='hq_managers'?['pin','securityPin']:['pin']){
        queries.push(api.read(source,field,pin).then(rows=>rows.map(row=>({...row,source}))));
        if(/^\d+$/.test(pin)&&String(Number(pin))===pin)queries.push(api.read(source,field,Number(pin)).then(rows=>rows.map(row=>({...row,source}))));
    }
    const matches=(await Promise.all(queries)).flat(),unique=new Map(matches.map(row=>[row.source+'/'+row.id,row]));
    const identities=new Map();
    for(const record of unique.values()){
        let data=record.data,id=record.id;
        if(record.source==='hq_managers'){
            const rows=await api.read('hq_managers','email',data.email);
            data=resolveHQAccount(rows);id=data.docId;
            if(savedPin(data)!==pin)continue;
        }
        const role=mealRole(data,record.source),name=data.fullName||data.cashierName||data.name;
        if(!name)continue;
        const key=data.email?String(data.email).trim().toLowerCase():record.source+'/'+id;
        if(!identities.has(key)||record.source==='hq_managers')identities.set(key,{id,source:record.source,role,cashierName:name,email:data.email||''});
    }
    if(!identities.size)throw Error('This PIN was not found. Ask the main owner to check the saved PIN.');
    const eligible=[...identities.values()].filter(identity=>level.roles.includes(identity.role));
    if(!eligible.length)throw Error('This PIN is not allowed to use the selected meal level.');
    if(eligible.length>1)throw Error('This PIN belongs to more than one person. Ask the main owner to set a unique PIN.');
    const identity=eligible[0];
    return identity;
}
export function installMealCheckout({window:w=window,document:d=document}={}) {
    const settings=()=>w.masterPOSData?.settings||{};
    const read=async(source,field,value)=>{const snap=await bounded(w.getDocsFromServer(w.query(w.collection(w.db,source),w.where(field,'==',value))));return snap.docs.map(row=>({id:row.id,data:row.data()}));};
    w.isMealDiscount=isMealType;
    w.getMealLevel=id=>requireMealLevel(settings(),id);
    w.calculateMealDiscount=id=>mealDiscount(w.cart||[],w.masterPOSData?.items||[],w.getMealLevel(id),w.currentGrandTotal||0);
    w.syncMealDiscountOptions=()=>{
        const select=d.getElementById('checkoutDiscountType');if(!select)return;
        const selected=select.value;
        select.innerHTML='<option value="none">No Discount</option><option value="percentage">Percentage (%)</option><option value="fixed">Fixed Amount (₱)</option>'+mealLevels(settings()).filter(row=>row.enabled).map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
        select.value=[...select.options].some(row=>row.value===selected)?selected:'none';
    };
    w.renderCustomCheckoutFields=()=>{
        let host=d.getElementById('customCheckoutFields');
        if(!host){host=d.createElement('div');host.id='customCheckoutFields';host.className='custom-checkout-fields';d.getElementById('finalCustomerName')?.parentElement?.append(host);}
        const rows=validateCheckoutFields(settings().customCheckoutFields||[]).filter(row=>row.enabled);
        host.hidden=!rows.length;
        host.innerHTML=rows.map(row=>`<label>${esc(row.name)}${row.required?' <span aria-label="required">*</span>':''}<select data-checkout-field="${esc(row.id)}" ${row.required?'required':''}><option value="">Choose ${esc(row.name)}</option>${row.options.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></label>`).join('');
    };
    w.collectCustomCheckoutFields=()=>checkoutSelections(settings().customCheckoutFields||[],Object.fromEntries([...d.querySelectorAll('[data-checkout-field]')].map(node=>[node.dataset.checkoutField,node.value])));
    w.authorizeMealPin=async(pin,id,{refresh=false}={})=>{
        if(refresh){
            const snap=await bounded(w.getDocFromServer(w.doc(w.db,'settings','global_pos_config'))),data=snap.exists()?snap.data():{};
            w.masterPOSData.settings={...settings(),...data};
        }
        const level=requireMealLevel(settings(),id);
        const deviceId=w.localStorage?.getItem('takodeal_device_id');
        if(deviceId){const devices=await read('pos_devices','deviceId',deviceId);if(devices.some(row=>String(row.data.status||'').toLowerCase()==='blocked'))throw Error('This device is blocked. Ask HQ to review device access.');}
        const identity=await findMealIdentity({read},String(pin),level);
        // Apply the staff daily limit to every level that permits Staff, even a custom level.
        if(identity.role==='staff'){
            const start=new Date();start.setHours(0,0,0,0);
            const queued = await w.saleOutbox?.list?.() || [];
            if(queued.some(row=>{const sale=row.payload;return sale.mealStaffName===identity.cashierName && sale.mealRole==='staff' && new Date(sale.localTimestamp)>=start;}))
                throw Error('This staff member already has a meal awaiting synchronization today.');
            let requests;
            try{requests=await readStaffMealClaims(w,{staffName:identity.cashierName,start});}
            catch(error){
                if(error?.code){const failure=Error('Meal verification could not finish. Your cart is unchanged and no meal was recorded. Check the connection and retry, or ask HQ to review access.');failure.code=error.code;failure.cause=error;throw failure;}
                throw error;
            }
            if(requests.docs.some(row=>mealRequest(row.data())))throw Error('This staff member has already claimed one meal today.');
        }
        return {...identity,level};
    };
    w.verifyStaffMealPin=async()=>{
        const pin=d.getElementById('checkoutStaffPin').value,id=d.getElementById('checkoutDiscountType').value,name=d.getElementById('finalCustomerName');
        const current=()=>d.getElementById('checkoutStaffPin').value===pin&&d.getElementById('checkoutDiscountType').value===id;
        if(pin.length<4){name.value='';name.placeholder='Awaiting PIN verification…';return;}
        name.value='Verifying PIN…';
        try{const identity=await w.authorizeMealPin(pin,id);if(!current())return;name.value=identity.cashierName+' ('+identity.level.name+')';name.style.color='#15803d';name.style.backgroundColor='#dcfce7';}
        catch(error){if(!current())return;name.value='';name.placeholder=error.message;name.style.color='#b91c1c';name.style.backgroundColor='#fef2f2';}
    };
}
