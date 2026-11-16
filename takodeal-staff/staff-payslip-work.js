const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {safe as payslipText};
function instant(value){
    if(value==null||value==='')return null;
    const date=value?.toDate?.()??new Date(value?.seconds!=null?Number(value.seconds)*1000:value);
    return Number.isFinite(+date)?date:null;
}
function format(value,options){
    const time=instant(value);return time?time.toLocaleString('en-PH',{timeZone:'Asia/Manila',...options}):'';
}
export function payslipWorkRows(data){
    const rows=data.shiftPairs?.length?data.shiftPairs:data.logs;
    if(!Array.isArray(rows)||!rows.length)return '<tr><td colspan="5">No attendance detail was saved for this cutoff.</td></tr>';
    const time=value=>format(value,{hour:'numeric',minute:'2-digit'});
    const punch=(actual,label)=>time(actual)||(typeof label==='string'&&!/^\d{4}-\d\d-/.test(label)?label:time(label))||'—';
    const amount=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
    return rows.map(log=>{
        const day=log.date||log.dateString||format(log.timeInAt||log.dateObj||log.timestamp,{month:'short',day:'numeric',year:'numeric'})||'Not recorded';
        const scheduled=time(log.expectedStartAt)&&time(log.expectedEndAt)?'Scheduled '+time(log.expectedStartAt)+' – '+time(log.expectedEndAt):'';
        const note=[log.branch,scheduled,amount(log.lateMins)?'Recorded late: '+Number(log.lateMins)+' min':'',
            amount(log.dailyRate)?'Daily rate: ₱'+Number(log.dailyRate).toFixed(2):'',log.remark].filter(Boolean).map(safe).join('<br>');
        return '<tr>'+[day,punch(log.timeInAt,log.in),punch(log.timeOutAt,log.out),amount(log.hrs)?Number(log.hrs).toFixed(2)+' h':'—'].map(v=>'<td>'+safe(v)+'</td>').join('')+'<td><span>'+note+'</span></td></tr>';
    }).join('');
}
