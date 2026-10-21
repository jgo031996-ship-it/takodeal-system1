import {validateOwnerRecordFileDescriptor} from './owner-record-files.js';
export const PERMIT_RENEWAL_STATUSES=Object.freeze(['Not started','Preparing','Submitted','Completed','Not required']);
export const PERMIT_FIELDS=Object.freeze(['branch','permitType','permitName','agency','permitNumber','issueDate','expiryDate','renewalStatus','notes','attachment','archived']);
export const permitDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export function validPermitDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function normalizePermitDraft(input){
 const text=(key,max,required=false)=>{const value=String(input?.[key]??'').trim();if(value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||required&&!value)throw Error('Review '+({branch:'branch',permitType:'permit type',permitName:'permit name',agency:'agency',permitNumber:'permit number',notes:'notes'}[key])+'.');return value;};
 const draft={branch:text('branch',120,true),permitType:text('permitType',80,true),permitName:text('permitName',160,true),agency:text('agency',160),permitNumber:text('permitNumber',120),issueDate:String(input?.issueDate||''),expiryDate:String(input?.expiryDate||''),renewalStatus:input?.renewalStatus||'Not started',notes:text('notes',4000),attachment:input?.attachment??null,archived:input?.archived===true};
 for(const key of ['issueDate','expiryDate'])if(draft[key]&&!validPermitDate(draft[key]))throw Error('Choose a valid '+(key==='issueDate'?'issue':'expiry')+' date.');
 if(draft.issueDate&&draft.expiryDate&&draft.expiryDate<draft.issueDate)throw Error('The expiry date cannot be before the issue date.');
 if(!PERMIT_RENEWAL_STATUSES.includes(draft.renewalStatus))throw Error('Choose a renewal status.');
 if(draft.attachment)draft.attachment={...validateOwnerRecordFileDescriptor(draft.attachment)};
 return draft;
}
export function permitSnapshot(record){return Object.fromEntries(PERMIT_FIELDS.map(key=>[key,record[key]??(key==='attachment'?null:key==='archived'?false:'')]));}
export function permitExpiry(record,{today=permitDay(),days=30}={}){
 if(!validPermitDate(today)||!Number.isSafeInteger(days)||days<0||days>365)throw Error('Choose a valid reminder window.');
 if(record.archived)return {key:'Archived',label:'Archived',days:null};
 if(!record.expiryDate)return {key:'No expiry',label:'No expiry recorded',days:null};
 if(!validPermitDate(record.expiryDate))return {key:'Review',label:'Review expiry date',days:null};
 const remaining=Math.round((Date.parse(record.expiryDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 if(remaining<0)return {key:'Expired',label:'Expired '+Math.abs(remaining)+' day'+(remaining===-1?'':'s')+' ago',days:remaining};
 if(!remaining)return {key:'Due soon',label:'Expires today',days:0};
 if(remaining<=days)return {key:'Due soon',label:'Expires in '+remaining+' day'+(remaining===1?'':'s'),days:remaining};
 return {key:'Current',label:'Expiry in '+remaining+' days',days:remaining};
}
export function filterPermits(records,{branch='',search='',status='Active',today=permitDay(),days=30}={}){
 const query=String(search).trim().toLowerCase();return records.filter(row=>(!branch||row.branch===branch)&&(!query||['branch','permitType','permitName','agency','permitNumber','renewalStatus','notes'].some(key=>String(row[key]||'').toLowerCase().includes(query)))&&(status==='All'||status==='Active'?!row.archived||status==='All':permitExpiry(row,{today,days}).key===status)).sort((a,b)=>Number(a.archived)-Number(b.archived)||(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999')||String(a.permitName||'').localeCompare(String(b.permitName||'')));
}
export function permitSummary(records,options){const result={active:0,dueSoon:0,expired:0,noExpiry:0,archived:0};for(const row of records){const state=permitExpiry(row,options);if(state.key==='Archived')result.archived++;else{result.active++;if(state.key==='Due soon')result.dueSoon++;if(state.key==='Expired')result.expired++;if(state.key==='No expiry'||state.key==='Review')result.noExpiry++;}}return result;}
