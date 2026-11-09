import{riderCommandsFor}from'./rider-command-client.js';
export{reserveRiderCommand}from'./rider-command-client.js';
// Mutations are executed by the broker with fresh server-owned identity,
// approval, scope and operation checks. These exports keep existing UI callers.
const text=value=>typeof value==='string'?value.trim():'';
const normalized=value=>text(value).toLowerCase();
export function riderProofUrl(value,{actor,kind,recordId,operationId}){
    try{const url=new URL(value),prefix=kind==='delivery'?'deliveries/proofs/':'riders/topups/';
        if(url.protocol!=='https:'||url.hostname!=='firebasestorage.googleapis.com'||url.port||url.username||url.password||url.hash||url.searchParams.size!==2||url.searchParams.getAll('alt').length!==1||url.searchParams.get('alt')!=='media'||url.searchParams.getAll('token').length!==1||!url.searchParams.get('token'))throw Error();
        const base='/v0/b/takodeal-pos.firebasestorage.app/o/';if(!url.pathname.startsWith(base))throw Error();
        const path=decodeURIComponent(url.pathname.slice(base.length)),expected=prefix+actor.authUid+'/'+actor.sessionId+'/'+recordId+'/'+operationId+'/';
        if(!path.startsWith(expected)||!/^([a-f0-9]{64})\.(jpg|png|webp)$/.test(path.slice(expected.length)))throw Error();return url.href;
    }catch{throw Error('Upload a fresh proof on this signed-in Rider account before saving.');}
}
export function riderMoneyCents(value,label='amount') {
    if(typeof value!=='number' && !(typeof value==='string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim())))throw Error(`The ${label} is invalid. Ask HQ to review it.`);
    const number=Number(value),cents=Math.round(number*100);
    if(!Number.isFinite(number) || number<0 || number>9000000000000 || !Number.isSafeInteger(cents) || Math.abs(number*100-cents)>0.00001)throw Error(`The ${label} is invalid. Ask HQ to review it.`);
    return cents;
}
export function isApprovedRider(data){return ['active','approved'].includes(normalized(data?.status))&&data.active!==false&&data.archived!==true&&data.deleted!==true&&data.blocked!==true;}
export function riderPoolScope(data){
    const held={allowed:false,global:false,branches:[],reason:'HQ must review this rider’s saved branch assignment before delivery access.'};
    if(!isApprovedRider(data))return {...held,reason:'Manager approval is required before delivery access.'};
    if(Object.hasOwn(data,'allowedBranches')){
        if(!Array.isArray(data.allowedBranches)||!data.allowedBranches.length||data.allowedBranches.length>30||data.allowedBranches.some(branch=>typeof branch!=='string'||!branch||branch.trim()!==branch||branch.length>128))return held;
        const branches=[...new Set(data.allowedBranches)];return branches.includes('All')?{allowed:true,global:true,branches:[],reason:''}:{allowed:true,global:false,branches,reason:''};
    }
    if((data.fleetType==null||data.fleetType==='Main Office')&&(data.franchiseAccess==null||data.franchiseAccess===true))return {allowed:true,global:true,branches:[],reason:''};
    return held;
}
export function deliveryPaymentPlan(order){
    const mode=normalized(order.paymentMode),method=normalized(order.paymentMethod);
    const cash=value=>['cash','cod','cash on delivery','cash-on-delivery'].includes(value);
    if(mode && method && cash(mode)!==cash(method))throw Error('The payment fields disagree. Ask the cashier to review this order.');
    const selected=mode || method;
    if(!selected)throw Error('The payment method is missing. Ask the cashier to review this order.');
    const total=riderMoneyCents(order.totalAmount,'order total');
    if(total<=0)throw Error('The delivery total must be greater than zero.');
    return {kind:cash(selected)?'cash':'prepaid',debitCents:cash(selected)?total:0,totalCents:total};
}
export const claimDeliveryAtomic=(api,input)=>riderCommandsFor(api).execute('claim',input);
export const acceptPingAtomic=(api,input)=>riderCommandsFor(api).execute('accept-ping',input);
export const pickupDeliveryAtomic=(api,input)=>riderCommandsFor(api).execute('pickup',input);
export const completeDeliveryAtomic=(api,input)=>riderCommandsFor(api).execute('complete',input);
export const rejectPingAtomic=(api,input)=>riderCommandsFor(api).execute('decline',input);
export const reviewRiderStatusAtomic=(api,input)=>riderCommandsFor(api).execute('review-status',input);
export const reviewRiderTopUpAtomic=(api,input)=>riderCommandsFor(api).execute('review-topup',input);
export const requestRiderTopUpAtomic=(api,input)=>riderCommandsFor(api).execute('topup-request',input);
export const setRiderAvailabilityAtomic=(api,input)=>riderCommandsFor(api).execute('availability',input);
export const setRiderLocationAtomic=(api,input)=>riderCommandsFor(api).execute('location',input);
