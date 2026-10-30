// Display only the values saved with a payslip. Never consult today's profile
// to reconstruct an older payment or infer receipts from an equal total.
const clean=value=>String(value??'').trim();
const cents=value=>{const n=Number(value??0);return Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):0;};
const money=value=>'₱'+(cents(value)/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const food=type=>/^(?:cancelled food purchase|(?:staff|manager)\s+meal(?:\s*\(\s*pos\s+auto\s*\))?)$/i.test(clean(type));
const bucket=row=>row.bucket|| (clean(row.type)==='Cash Advance'?'advances':food(row.type)?'meals':clean(row.type)==='Online Order Refund'?'onlineRefunds':clean(row.type)==='Cash Shortage'?'cashShortages':clean(row.type)==='Owner Custom Deduction'?'ownerDeductions':null);
function items(row){
 const source=row.items||row.purchasedItems||row.selectedItems||row.cart||[];
 return (Array.isArray(source)?source:[]).slice(0,200).flatMap(item=>{
  const qty=Number(item.qty??item.quantity),name=clean(item.name||item.itemName||item.label);
  if(!name||!Number.isFinite(qty)||qty<=0)return [];
  const result={name:name.slice(0,300),qty};
  for(const key of ['size','variant','variantName','notes'])if(clean(item[key]))result[key]=clean(item[key]).slice(0,300);
  for(const key of ['unitAmount','lineAmount','baseAmount','discountAmount','amount','lineTotalFinal'])if(item[key]!==undefined)result[key]=cents(item[key])/100;
  if(Number.isSafeInteger(item.sourceLineIndex)&&item.sourceLineIndex>=0)result.sourceLineIndex=item.sourceLineIndex;
  const options=Array.isArray(item.addons)?item.addons.map(addon=>['',addon]):item.addons&&typeof item.addons==='object'?Object.entries(item.addons):[];
  if(options.length)result.addons=options.slice(0,30).filter(([,addon])=>addon!==null&&addon!==undefined&&addon!==false&&addon!==0).map(([key,addon])=>clean(typeof addon==='object'?addon.name||addon.itemName||key:typeof addon==='string'?addon:key).slice(0,100)).filter(Boolean);
  return [result];
 });
}
function detail(row,amount=row.amount){
 const result={id:clean(row.id),bucket:bucket(row),type:clean(row.type||row.label),amount:cents(amount)/100,items:items(row)};
 for(const key of ['sourcePlatform','sourceReceiptId','sourceSaleId','purchaseId','purchaseReceiptId','receiptId','item','remarks'])if(clean(row[key]))result[key]=clean(row[key]).slice(0,key==='remarks'?1000:600);
 for(const key of ['label','category','incidentDate','effectiveDate'])if(clean(row[key]))result[key]=clean(row[key]).slice(0,key==='label'?200:key==='category'?120:24);
 if(row.originalAmount!==undefined)result.originalAmount=cents(row.originalAmount)/100;
 if(row.purchaseAmount!==undefined)result.purchaseAmount=cents(row.purchaseAmount)/100;
 if(Number.isFinite(Number(row.discountPct))&&Number(row.discountPct)>=0&&Number(row.discountPct)<=100)result.discountPct=Number(row.discountPct);
 const date=row.dateAdded||row.timestamp;
 const milliseconds=date?.toMillis?.()??(date?.seconds!==undefined?Number(date.seconds)*1000:Date.parse(date));
 if(Number.isFinite(milliseconds))result.dateAdded=new Date(milliseconds).toISOString();
 return result;
}
// Called only after settlement has freshly checked the linked allocation rows.
// Retain the amount actually collected, including a partial loan/food allocation.
export function snapshotPayrollDeductionRows(rows,allocations){
 const byId=new Map(rows.map(row=>[row.id,row])),seen=new Set();
 return allocations.map(allocation=>{
  const row=byId.get(allocation.id),taken=Number(allocation.taken);
  if(!row||seen.has(allocation.id)||!['advances','meals'].includes(bucket(row))||!Number.isFinite(taken)||taken<=0||cents(taken)>cents(row.amount))throw Error('The receipt deduction detail changed. Regenerate this unpaid payslip.');
  seen.add(allocation.id);return detail({...row,id:allocation.id,...(cents(taken)<cents(row.amount)?{purchaseAmount:row.amount}:{})},taken);
 });
}
const definitions=[['lateDeduction','Late / undertime'],['sss','SSS'],['philhealth','PhilHealth'],['pagibig','Pag-IBIG'],['advances','Cash advances'],['loans','Company loans'],['meals','Meals and cancelled food purchases'],['onlineRefunds','Online order refunds'],['cashShortages','Approved cash shortages'],['ownerDeductions','Owner-added one-time deductions']];
export function payslipDeductionBreakdown(data={}){
 const saved=data.frozenData&&typeof data.frozenData==='object'?data.frozenData:data;
 const frozenDetails=saved.deductionDetailsVersion===1&&Array.isArray(saved.deductionDetails)?saved.deductionDetails:[];
 const groups=definitions.map(([key,label])=>{
  const amount=cents(saved[key])/100;
  let source=frozenDetails.filter(row=>bucket(row)===key);
  if(!source.length&&key==='onlineRefunds')source=saved.onlineRefundRows||[];
  if(!source.length&&key==='cashShortages')source=saved.cashShortageRows||[];
  if(!source.length&&key==='ownerDeductions')source=saved.ownerDeductionDetails||[];
  source=Array.isArray(source)?source:[];
  const entries=source.map(row=>detail({...row,type:row.type||label,bucket:key})).filter(row=>row.amount>0);
  const complete=entries.length>0&&entries.reduce((sum,row)=>sum+cents(row.amount),0)===cents(amount);
  const needsDetail=amount>0&&['advances','meals','onlineRefunds','cashShortages','ownerDeductions'].includes(key);
  return {key,label,amount,entries:complete?entries:[],note:needsDetail&&!complete?'This older payslip saved the total without individual receipt details. Ask HQ to review the original records.':''};
 });
 const customSource=saved.customDeductions??saved.profile?.customDeductions??[];
 const custom=Array.isArray(customSource)?customSource.filter(row=>row&&clean(row.name)&&cents(row.amount)>0).map(row=>({label:clean(row.name),amount:cents(row.amount)/100})):[];
 const namedCents=custom.reduce((sum,row)=>sum+cents(row.amount),0);
 const customCents=saved.customDeductionsTotal===undefined?namedCents:cents(saved.customDeductionsTotal);
 if(customCents>0){
  if(namedCents===customCents)groups.push(...custom.map((row,index)=>({key:'custom-'+index,...row,entries:[],note:'Saved custom deduction'})));
  else groups.push({key:'custom',label:'Other saved custom deductions',amount:customCents/100,entries:[],note:'Individual saved labels do not match this frozen total. Ask HQ to review the original payslip.'});
 }
 return {groups:groups.filter(row=>row.amount>0),total:groups.reduce((sum,row)=>sum+cents(row.amount),0)/100};
}
export function payslipDeductionSummaryHTML(data){
 const {groups}=payslipDeductionBreakdown(data);
 return groups.length?groups.map(row=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;line-height:1.4"><span style="overflow-wrap:anywhere">${escape(row.label)}</span><strong style="white-space:nowrap">${money(row.amount)}</strong></div>`).join(''):'<p style="margin:4px 0;color:#64748b">No deductions</p>';
}
export function deductionEntryHTML(row){
 const savedDate=row.dateAdded?new Date(row.dateAdded):null,date=savedDate&&!isNaN(savedDate.getTime())?savedDate.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}):'';
 const source=[date,row.sourcePlatform,row.sourceReceiptId?'Source OR '+row.sourceReceiptId:'',row.purchaseReceiptId||row.receiptId?'Purchase OR '+(row.purchaseReceiptId||row.receiptId):'',!row.sourceReceiptId&&!row.receiptId&&row.id?'Reference '+row.id:''].filter(Boolean).map(escape).join(' · ');
 const purchased=items(row);
 const cancelledPurchase=/^cancelled food purchase$/i.test(clean(row.type));
 const itemText=purchased.length?purchased.map(item=>`${escape(item.qty)} × ${escape(item.name)}${item.size?' · '+escape(item.size):''}${item.variant||item.variantName?' · '+escape(item.variant||item.variantName):''}${item.addons?.length?' · '+(cancelledPurchase?'Original receipt options: ':'')+item.addons.map(escape).join(', '):''}${item.amount!==undefined?' — '+money(item.amount):''}${item.notes?' ('+escape(item.notes)+')':''}`).join('<br>'):escape(row.item||row.remarks||'');
 const optionsNote=cancelledPurchase&&purchased.some(item=>item.addons?.length)?'<div style="color:#64748b;font-size:11px;line-height:1.5;margin-top:4px">Options describe the original receipt line; quantities shown apply to the selected food.</div>':'';
 const discount=row.discountPct!==undefined&&Number(row.discountPct)>0?` · ${escape(row.discountPct)}% staff discount`:'';
 const allocation=row.purchaseAmount!==undefined&&cents(row.purchaseAmount)>cents(row.amount)?`<div style="color:#64748b;font-size:11px;line-height:1.5;margin-top:4px">Collected this payslip: ${money(row.amount)} of the ${money(row.purchaseAmount)} purchase. Items below describe the original purchase.</div>`:'';
 const ownerDetails=bucket(row)==='ownerDeductions'?[row.category,row.incidentDate?'Incident date '+row.incidentDate:'',row.effectiveDate?'Payroll effective '+row.effectiveDate:''].filter(Boolean).map(escape).join(' · '):'';
 return `<div style="padding:8px 0;border-top:1px dashed #e2e8f0"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${escape(row.label||row.type||'Receipt deduction')}</strong><strong style="white-space:nowrap">${money(row.amount)}</strong></div>${source?`<div style="color:#64748b;font-size:11px;overflow-wrap:anywhere;margin-top:3px">${source}${discount}</div>`:''}${ownerDetails?`<div style="color:#64748b;font-size:11px;overflow-wrap:anywhere;margin-top:3px">${ownerDetails}</div>`:''}${allocation}${itemText?`<div style="color:#475569;font-size:12px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere">${itemText}</div>`:''}${optionsNote}</div>`;
}
export function payslipDeductionDetailsHTML(data,{live=false,showTotal=true}={}){
 const result=payslipDeductionBreakdown(data);
 return `<section class="staff-deduction-breakdown" style="text-align:left;margin:16px 0;padding:16px;border:1px solid #d7e2dc;border-radius:12px;background:#fafcfb;break-inside:avoid"><h4 style="font-size:14px;margin:0 0 4px;color:#214c3e">Deduction breakdown</h4><p style="font-size:11px;color:#64748b;line-height:1.5;margin:0 0 10px">${live?'Current estimate. Final amounts are confirmed by HQ.':'These amounts come from this saved payslip. Your paid total stays unchanged.'}</p>${result.groups.map(group=>`<div style="padding:9px 0;border-top:1px solid #e2e8f0"><div style="display:flex;justify-content:space-between;gap:12px;font-size:13px"><strong style="overflow-wrap:anywhere">${escape(group.label)}</strong><strong style="white-space:nowrap;color:#b91c1c">${money(group.amount)}</strong></div>${group.note?`<p style="font-size:11px;color:#64748b;line-height:1.5;margin:4px 0">${escape(group.note)}</p>`:''}${group.entries.map(deductionEntryHTML).join('')}</div>`).join('')||'<p style="font-size:13px;color:#64748b">No deductions</p>'}${showTotal?`<div style="display:flex;justify-content:space-between;gap:12px;margin-top:8px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:14px;font-weight:700"><span>Total deductions</span><span>${money(result.total)}</span></div>`:''}</section>`;
}
