import {attendanceMillis,attendanceKind} from './attendance-reconcile.js';

// Preview-only safety: never rewrite punches or recalculate a frozen payslip.
// Explicit links that cannot be paid confidently hold that employee's preview.
export function planPayrollAttendance(records,{resolveName=row=>row.staffName,frozenNames=[],referenceRecords=records}={}) {
    const normalize=row=>({...row,payrollStaffName:String(resolveName(row)||row.staffName||'').trim()});
    const rows=records.map(normalize),known=[...rows],includedIds=new Set(rows.map(row=>row.id).filter(Boolean));
    for(const record of referenceRecords)if(record.id&&!includedIds.has(record.id))known.push(normalize(record));
    const byId=new Map(),groups=new Map(),issues=new Map(),normalized=new Set(),foreignClosures=new Set();
    const available=row=>!row.deleted&&!['Voided','Cancelled'].includes(row.status);
    const samePerson=(a,b)=>a.staffId&&b.staffId?a.staffId===b.staffId:String(a.staffName||'').trim().toLowerCase()===String(b.staffName||'').trim().toLowerCase();
    for(const row of known)if(row.id){if(!byId.has(row.id))byId.set(row.id,[]);byId.get(row.id).push(row);}
    for(const row of rows){
        if(!groups.has(row.payrollStaffName))groups.set(row.payrollStaffName,[]);
        groups.get(row.payrollStaffName).push(row);
    }
    const hold=(row,reason)=>{const name=row?.payrollStaffName;if(!name||!groups.has(name))return;if(!issues.has(name))issues.set(name,new Set());issues.get(name).add(reason);};
    const frozenKeys=new Set([...frozenNames].map(String));
    const protectedNames=new Set([...frozenKeys].map(name=>name.trim().toLowerCase()));
    for(const group of groups.values()){
        if(new Set(group.filter(available).map(row=>row.staffId).filter(Boolean)).size>1)hold(group[0],'This payroll name maps to multiple employee IDs; HR must separate the records.');
        if(!frozenKeys.has(group[0].payrollStaffName) && group.some(row=>protectedNames.has(String(row.staffName||'').trim().toLowerCase())))hold(group[0],'A saved payslip exists under the original name; HR must confirm its employee identity before another preview is paid.');
    }
    const linked=rows.filter(row=>row.timeInLogId&&available(row)),counts=new Map();
    for(const row of known.filter(row=>row.timeInLogId&&available(row)))counts.set(row.timeInLogId,(counts.get(row.timeInLogId)||0)+1);
    for(const end of linked){
        const sources=byId.get(end.timeInLogId)||[],begin=sources[0];
        if(sources.length!==1 || !available(begin) || attendanceKind(begin)!=='TIME IN' || attendanceKind(end)!=='TIME OUT'){
            hold(end,'Linked Time In is missing or ambiguous; HR must confirm the original shift.');continue;
        }
        if(!samePerson(begin,end) || begin.payrollStaffName!==end.payrollStaffName || !begin.branch || begin.branch!==end.branch){
            hold(end,'Linked punches have conflicting employee or branch details.');hold(begin,'Linked punches have conflicting employee or branch details.');continue;
        }
        const beginAt=attendanceMillis(begin.timestamp),endAt=attendanceMillis(end.timestamp);
        if(!Number.isFinite(beginAt)||!Number.isFinite(endAt)||endAt<beginAt||endAt-beginAt>18*3600000){
            hold(end,'Linked shift times are incomplete or outside the payable duration; HR review is required.');continue;
        }
        if(counts.get(end.timeInLogId)!==1){hold(end,'More than one Time Out links to the same Time In; HR review is required.');continue;}
        const group=groups.get(end.payrollStaffName)||[];
        const identities=new Set(group.filter(available).map(row=>row.staffId).filter(Boolean));
        if(identities.size>1){hold(end,'This payroll name maps to multiple employee IDs; HR must separate the records.');continue;}
        const overlaps=group.some(row=>{
            const at=attendanceMillis(row.timestamp);
            if(row===begin || !available(row) || attendanceKind(row)!=='TIME IN' || !samePerson(row,begin) || at<beginAt || at>=endAt)return false;
            const closes=known.filter(close=>row.id && close.timeInLogId===row.id && available(close));
            // A verified zero-duration punch can close before the real shift at
            // this boundary. A misclick inside the shift still needs HR review.
            return !(closes.length===1 && attendanceKind(closes[0])==='TIME OUT' && samePerson(row,closes[0]) && row.branch===closes[0].branch && attendanceMillis(closes[0].timestamp)>=at && attendanceMillis(closes[0].timestamp)<=beginAt);
        });
        if(overlaps){
            hold(end,'Linked shifts overlap another Time In; payable hours must be confirmed by HR.');continue;
        }
        normalized.add(begin);normalized.add(end);
        if(!rows.includes(begin))foreignClosures.add(end);
    }
    // Firestore does not guarantee an order between equal timestamps. Close a
    // validated explicit shift before a different shift starts at that instant.
    // Keep own zero-duration IN/OUT order and untouched legacy order stable.
    const ordered=[...rows],buckets=new Map();
    rows.forEach((row,index)=>{const at=attendanceMillis(row.timestamp);if(!buckets.has(at))buckets.set(at,[]);buckets.get(at).push({row,index});});
    for(const bucket of buckets.values()){
        if(bucket.length<2 || !bucket.some(({row})=>normalized.has(row)&&attendanceKind(row)==='TIME OUT'))continue;
        const edges=bucket.map(()=>new Set()),counts=bucket.map(()=>0);
        const edge=(from,to)=>{if(from!==to&&!edges[from].has(to)){edges[from].add(to);counts[to]++;}};
        bucket.forEach(({row:end},endIndex)=>{
            if(!normalized.has(end)||attendanceKind(end)!=='TIME OUT')return;
            bucket.forEach(({row:begin},beginIndex)=>{
                if(attendanceKind(begin)!=='TIME IN'||begin.payrollStaffName!==end.payrollStaffName)return;
                if(begin.id===end.timeInLogId)edge(beginIndex,endIndex);else edge(endIndex,beginIndex);
            });
        });
        const ready=counts.map((count,index)=>count===0?index:-1).filter(index=>index>=0),result=[];
        while(ready.length){const index=ready.shift();result.push(index);for(const next of edges[index])if(--counts[next]===0){ready.push(next);ready.sort((a,b)=>a-b);}}
        if(result.length<bucket.length){
            for(let index=0;index<bucket.length;index++)if(counts[index]>0){hold(bucket[index].row,'Coincident linked punches have an ambiguous order; HR review is required.');result.push(index);}
        }
        bucket.forEach(({index},position)=>ordered[index]=bucket[result[position]].row);
    }
    const reviews=[...issues].map(([name,reasons])=>{const group=groups.get(name)||[];return {name,staffId:group.find(row=>row.staffId)?.staffId||'',reason:[...reasons].join(' '),recordIds:group.map(row=>row.id).filter(Boolean),records:group};});
    const heldNames=new Set(reviews.map(review=>review.name));
    const logs=ordered.filter(row=>!heldNames.has(row.payrollStaffName) && !foreignClosures.has(row) && !(row.timeInLogId&&!available(row))).map(row=>normalized.has(row)?{...row,type:attendanceKind(row)}:row);
    return {logs,reviews,heldNames};
}
