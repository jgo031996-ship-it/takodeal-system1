// Read a server snapshot with the current Firebase user's token when the local SDK queue stops.
import {saleIsPaid, escapeHTML} from './dashboard-data.js';
const sources = {
    transactions:{date:'timestamp'}, shifts:{date:'startTime'}, incoming_orders:{date:'timestamp'}, parked_orders:{date:'timestamp'},
    inventory:{fields:['name','branch','baseCost','unit','uom']}, bom:{fields:['menuItem','ingredientName','qty']}, menu:{fields:['name','category']}
};
export const supportTables = ['inventory','bom','menu','shifts','incoming_orders','parked_orders'];
const filter=(name,op,value)=>({fieldFilter:{field:{fieldPath:name},op,value}});
function unpack(v) {
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v || 'doubleValue' in v) return Number(v.integerValue ?? v.doubleValue);
    if ('timestampValue' in v) {
        const ms=Date.parse(v.timestampValue);
        if (!Number.isFinite(ms)) throw Error('HQ returned an unreadable timestamp.');
        return {toDate:()=>new Date(ms), toMillis:()=>ms, valueOf:()=>ms};
    }
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(unpack);
    if ('mapValue' in v) return fieldsOf(v.mapValue.fields);
    if ('referenceValue' in v) return v.referenceValue;
    if ('geoPointValue' in v) return v.geoPointValue;
    if ('bytesValue' in v) return v.bytesValue;
    throw Error('HQ returned an unreadable report field.');
}
function fieldsOf(fields) {return Object.fromEntries(Object.entries(fields || {}).map(([k,v])=>[k,unpack(v)]));}
export function createSalesSnapshotReader({projectId,apiKey,getAppCheckToken,user,current,branch,start,end,fetcher=fetch,signal,pageSize=250}) {
    const root='projects/'+projectId+'/databases/(default)/documents';
    let authentication,asOf;
    function guard(){if(signal?.aborted || !current()) throw Error('The report selection or signed-in account changed.');}
    async function page(query,deadline) {
        guard();
        authentication ||= Promise.all([user.getIdToken(),getAppCheckToken?.()]);
        const [token,device]=await authentication;
        guard();if(deadline.aborted)throw Error('Report read cancelled.');
        if(!token)throw Error('Sign in again to read confirmed sales.');
        const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
        if(getAppCheckToken){
            const verified=typeof device==='string'?device:device?.token;
            if(!verified)throw Error('Device confirmation is unavailable. Retry while online.');
            headers['X-Firebase-AppCheck']=verified;
        }
        const response=await fetcher('https://firestore.googleapis.com/v1/'+root+':runQuery'+(apiKey?'?key='+encodeURIComponent(apiKey):''),{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:deadline,
            headers,body:JSON.stringify({structuredQuery:query,...(asOf?{readTime:asOf}:{})})});
        guard();
        if (!response.ok) throw Error(response.status===403?'HQ denied access to this report.':response.status===401?'Sign in again to read confirmed sales.':'HQ could not return this report. Retry when connected.');
        const rows=await response.json();guard();if(deadline.aborted)throw Error('Report read cancelled.');
        if(!Array.isArray(rows)||!rows.length||rows.some(row=>row.error || !row.document&&!row.readTime))throw Error('HQ returned an incomplete report.');
        return rows;
    }
    return async function read(table){
        if (!Object.hasOwn(sources,table)) throw Error('Unknown report section.');
        const controller=new AbortController(),abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        let timer;
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(Error('HQ report read timed out. Use Update Report to retry.'));},30000);});
        async function readAll(){
            const source=sources[table],filters=[];
            if(source.date){
                filters.push(filter(source.date,'GREATER_THAN_OR_EQUAL',{timestampValue:start.toISOString()}),filter(source.date,'LESS_THAN',{timestampValue:end.toISOString()}));
                if(branch && branch!=='All')filters.push(filter('branch','EQUAL',{stringValue:branch}));
            }
            const query={from:[{collectionId:table}],limit:pageSize,orderBy:[...(source.date?[{field:{fieldPath:source.date},direction:'ASCENDING'}]:[]),{field:{fieldPath:'__name__'},direction:'ASCENDING'}]};
            if(filters.length)query.where={compositeFilter:{op:'AND',filters}};
            if(source.fields)query.select={fields:source.fields.map(fieldPath=>({fieldPath}))};
            if(!asOf){
                const stamp=await page({...query,limit:1,select:{fields:[{fieldPath:'__name__'}]}},controller.signal);
                const at=stamp.at(-1)?.readTime;if(!at||!Number.isFinite(Date.parse(at)))throw Error('HQ could not confirm the report time.');asOf=at;
            }
            const docs=[],seen=new Set(),prefix=root+'/'+table+'/';
            for(;;){
                const rows=await page(query,controller.signal);
                const saved=rows.filter(row=>row.document).map(row=>row.document);
                for(const item of saved){
                    const id=item.name?.startsWith(prefix)?item.name.slice(prefix.length):'';
                    if(!id||id.includes('/')||seen.has(id))throw Error('HQ returned an incomplete report page.');
                    seen.add(id);
                    if(table==='incoming_orders'&&!['rejected','rejected_by_customer'].includes(item.fields?.status?.stringValue))continue;
                    const data=fieldsOf(item.fields);docs.push({id,data:()=>data});
                }
                if(saved.length<pageSize)break;
                const last=saved.at(-1);
                query.startAt={before:false,values:[...(source.date?[last.fields[source.date]]:[]),{referenceValue:last.name}]};
            }
            guard();return {docs,forEach:cb=>docs.forEach(cb),asOf};
        }
        try{return await Promise.race([readAll(),timeout]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    };
}
const money=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
export function receiptPlatform(row){
    const method=String(row.paymentMethod||'').toLowerCase(),type=String(row.orderType||'').toLowerCase();
    if(method.includes('grab')||type==='grab')return 'grab';
    if(method.includes('foodpanda')||method==='panda'||type==='panda'||type==='foodpanda')return 'foodpanda';
    return '';
}
const receiptDate=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
const receiptTime=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
const instant=value=>value?.toDate?.() ?? new Date(value);
export function showConfirmedReceipts(d,snap,branch='All') {
    const set=(id,text)=>{const node=d.getElementById(id);if(node)node.textContent=text;};
    const rows=snap.docs.map(doc=>({data:doc.data(),id:doc.id})).filter(row=>branch==='All'||row.data.branch===branch).sort((a,b)=>instant(b.data.timestamp)-instant(a.data.timestamp));
    const sums={net:0,grab:0,fp:0,grabCount:0,fpCount:0};
    for(const {data:r} of rows)if(saleIsPaid(r)){
        const amount=Number(r.netTotal)||0,method=receiptPlatform(r);sums.net+=amount;
        if(method==='grab'){sums.grab+=amount;sums.grabCount++;}
        if(method==='foodpanda'||method==='panda'){sums.fp+=amount;sums.fpCount++;}
    }
    for(const [name,v] of Object.entries({histSumNet:money.format(sums.net),histSumGrab:money.format(sums.grab),histSumFoodpanda:money.format(sums.fp),histCountGrab:sums.grabCount+' orders',histCountFoodpanda:sums.fpCount+' orders'}))set(name,v);
    const table=d.getElementById('historyTableBody');
    if(table)table.innerHTML=rows.map(({data:r,id})=>'<tr>'+[r.receiptId||id,r.branch,r.cashier,r.customerName||'Guest',money.format(Number(r.netTotal)||0),r.paymentMethod,r.status||(saleIsPaid(r)?'Paid':'Unconfirmed'),r.timestamp?receiptDate.format(instant(r.timestamp)):'—',r.timestamp?receiptTime.format(instant(r.timestamp)):'—','—'].map(v=>'<td>'+escapeHTML(v)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="10">No confirmed receipts in this range.</td></tr>';
}
