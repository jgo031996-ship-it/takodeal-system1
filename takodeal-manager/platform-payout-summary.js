// Read-only manual net-earnings entries. These records do not verify a bank credit.
export function platformReportingDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function payoutCents(value){
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
 const amount=Number(value),cents=Math.round(amount*100);
 return Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(cents)&&Math.abs(amount*100-cents)<1e-7?cents:null;
}
export function summarizePlatformPayouts(records,{platform,branches,allBranches=false,from,to}={}){
 if(!['Grab','Foodpanda'].includes(platform)||!Array.isArray(records)||!Array.isArray(branches)||branches.some(b=>typeof b!=='string'||!b.trim())||!platformReportingDate(from)||!platformReportingDate(to)||from>to)throw Error('Choose the platform, branches and reporting dates for recorded payouts.');
 const allowed=new Set(branches),seen=new Map(),rows=[],problems=[];let excludedCount=0,duplicateCount=0,total=0;
 for(const record of records){
  if(!record){problems.push('A payout entry is incomplete.');continue;}
  if(allBranches&&(typeof record.branch!=='string'||!record.branch.trim())){problems.push('A payout entry has no saved branch.');continue;}
  if(!allBranches&&!allowed.has(record.branch)){excludedCount++;continue;}
  const state=String(record.status||'').trim().toLowerCase();
  if(record.deleted===true||record.voided===true||record.cancelled===true||record.canceled===true||/^(void|voided|cancelled|canceled|rejected|deleted|pending|draft|unpaid|failed)$/.test(state)){excludedCount++;continue;}
  const id=typeof record.id==='string'&&record.id.trim()&&record.id.length<=180?record.id:null;
  const date=record.dateStr;
  if(!id||!platformReportingDate(date)){problems.push('A payout entry has a missing record number or reporting date.');continue;}
  if(date<from||date>to){excludedCount++;continue;}
  if(state&&!['paid','received','completed','settled','confirmed','approved','recorded'].includes(state)){problems.push('Payout '+id+' has a status that needs review.');continue;}
  const cents=payoutCents(record.amount);
  if(cents===null){problems.push('Payout '+id+' has a missing or invalid amount.');continue;}
  const fingerprint=JSON.stringify([record.branch,date,cents,state]);
  if(seen.has(id)){if(seen.get(id)!==fingerprint)problems.push('Payout '+id+' has conflicting copies.');else duplicateCount++;continue;}
  seen.set(id,fingerprint);const next=total+cents;
  if(!Number.isSafeInteger(next)){problems.push('The recorded payout total is too large to calculate.');continue;}total=next;
  rows.push({id,branch:record.branch,date,cashier:String(record.cashier||record.loggedBy||'Not recorded'),amount:cents/100});
 }
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 return {platform,periodLabel:from===to?from:from+' – '+to,rows,recordedPayout:!problems.length&&rows.length?total/100:null,knownPayout:total/100,payoutCount:rows.length,excludedCount,duplicateCount,problemCount:problems.length,complete:problems.length===0,problems,bankVerified:false};
}
