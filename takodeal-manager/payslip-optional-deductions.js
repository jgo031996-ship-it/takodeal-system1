const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
const entries=value=>Array.isArray(value)?value.filter(row=>row&&amount(row.amount)>0):[];
export function renderPayslipOptionalDeductions(d,data={}){
 const anchor=d.getElementById('psFoods')?.parentElement;
 for(const [key,lineId,title,note,rows] of [
  ['onlineRefunds','psOnlineRefunds','ONLINE REFUND ORDERS','Confirmed charges are included in net pay. Staff can respond through My Inbox.',data.onlineRefundRows],
  ['cashShortages','psCashShortages','OWNER-REVIEWED CASH SHORTAGE','Approved amounts are included from their effective date. Linked records are verified again before payment.',data.cashShortageRows],
  ['ownerDeductions','psOwnerDeductions','ONE-TIME CUSTOM DEDUCTIONS','Only the reviewed amount is included. Each record is collected once.',data.ownerDeductionRows]
 ]){
  let line=d.getElementById(lineId),box=line?.parentElement;
  if(!line){if(!anchor)continue;box=d.createElement('div');box.id=lineId+'Box';box.style.cssText='padding:10px;border:1px solid #dce6df;border-radius:8px;margin-top:8px;font-size:12px;';box.innerHTML='<span>'+title+'</span><strong id="'+lineId+'" style="float:right">0.00</strong><p style="font-size:11px;margin:6px 0 0;color:#64756d">'+note+'</p><div data-deduction-items></div>';anchor.after(box);line=d.getElementById(lineId);}
  if(!line)continue;const visible=amount(data[key])>0||entries(rows).length>0;
  box.id=lineId+'Box';box.hidden=!visible;box.style.display=visible?'':'none';line.textContent=amount(data[key]).toFixed(2);
  const detail=box.querySelector('[data-deduction-items]');if(detail){const records=key==='ownerDeductions'?entries(data.ownerDeductionDetails):[];detail.innerHTML=records.map(row=>'<p style="margin:5px 0;font-size:11px;overflow-wrap:anywhere"><strong>'+escape(row.label||'Owner custom deduction')+'</strong> · ₱'+amount(row.amount).toFixed(2)+(row.effectiveDate?' · '+escape(row.effectiveDate):'')+(row.category?' · '+escape(row.category):'')+'</p>').join('');}
 }
}

export function renderRecurringPayslipDeductions(d,data={}){
 const area=d.getElementById('psDynamicDeductionsArea');if(!area)return;
 const rows=data.customDeductions??data.profile?.customDeductions??[];
 area.innerHTML=(Array.isArray(rows)?rows:[]).map((row,index)=>!row||!String(row.name||'').trim()||!amount(row.amount)?'':'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 8px;font-size:13px"><span>'+escape(row.name)+'</span><input type="number" id="psCustomDed_'+index+'" data-deduction-index="'+index+'" class="ps-input ps-dynamic-deduction" value="'+amount(row.amount).toFixed(2)+'" oninput="window.recalcPayslip()"></div>').join('');
 area.hidden=!area.innerHTML;area.style.display=area.innerHTML?'':'none';
}
