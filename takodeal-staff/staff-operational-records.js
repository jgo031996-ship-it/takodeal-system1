const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class OperationalTimestamp{
 constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}
 toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}
 toDate(){return new Date(this.toMillis());}
}
function timestamp(value){
 if(object(value)&&Number.isSafeInteger(value.seconds)&&Number.isInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1e9)return new OperationalTimestamp(value.seconds,value.nanoseconds);
 const match=typeof value==='string'&&value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/),millis=match?Date.parse(match[1]+match[3]):NaN;
 if(!Number.isFinite(millis))throw Error('HQ returned an invalid saved operational timestamp. Reconnect and retry.');return new OperationalTimestamp(millis/1000,Number((match[2]||'').padEnd(9,'0')));
}
const copy=(value,key)=>key==='timestamp'&&value!==null?timestamp(value):Array.isArray(value)?value.map(item=>copy(item)):object(value)?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,copy(item,name)])):value;
export function operationalRecordsSnapshot(records){
 if(!Array.isArray(records)||records.some(row=>!object(row)||typeof row.id!=='string'||!row.id||row.id.includes('/'))||new Set(records.map(row=>row.id)).size!==records.length)throw Error('HQ returned an incomplete operational history. Reconnect and retry.');
 const docs=records.map(row=>({id:row.id,data:()=>copy(row),metadata:{fromCache:false,hasPendingWrites:false}}));return{docs,empty:!docs.length,size:docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};
}
