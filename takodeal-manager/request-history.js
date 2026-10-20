import { isMealDeduction } from './payroll-safety.js';

export function historyTime(value) {
    const date = value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
    return Number.isFinite(date?.getTime?.()) ? date.getTime() : 0;
}
const nameKey = value => String(value || '').trim().toLowerCase();
const automaticMeal = row => isMealDeduction(row.type) && /\(\s*pos\s+auto\s*\)/i.test(row.type);
function sameMeal(request, deduction) {
    if (deduction.requestId) return request.id === deduction.requestId;
    if (request.deductionId) return request.deductionId === deduction.id;
    if (!isMealDeduction(request.type) || nameKey(request.staffName) !== nameKey(deduction.staffName)) return false;
    if (request.branch && deduction.branch && request.branch !== deduction.branch) return false;
    if (request.receiptId && deduction.receiptId) return request.receiptId === deduction.receiptId;
    const time = historyTime(request.timestamp);
    return time > 0 && Math.floor(time / 1000) === Math.floor(historyTime(deduction.dateAdded) / 1000)
        && Number(request.amount) === Number(deduction.amount)
        && /^manager/i.test(request.type) === /^manager/i.test(deduction.type);
}

// Read-only union: older POS meals exist only in the deduction ledger.
// Pair individual rows, never collapse two meals simply because their amounts match.
export function requestHistory(requests, deductions, branch = null) {
    const rows = requests.filter(row => !branch || row.branch === branch).map(row => ({ ...row }));
    // Indexed queues retain original first-match order and one-to-one pairing.
    // Explicit links, receipt matches and legacy time/amount matches have the
    // same precedence as sameMeal; unrelated employees no longer scan each other.
    const allBranches=Symbol('all-branches'),byId=new Map(),byDeduction=new Map(),byReceipt=new Map(),byLegacy=new Map(),byLegacyWithoutReceipt=new Map();
    const queue=(map,keys,create=false)=>{for(const key of keys){if(!map.has(key)){if(!create)return null;map.set(key,new Map());}map=map.get(key);}if(!map.has('queue')){if(!create)return null;map.set('queue',{rows:[],at:0});}return map.get('queue');};
    const add=(map,keys,entry)=>queue(map,keys,true).rows.push(entry);
    const head=entry=>{if(!entry)return null;while(entry.at<entry.rows.length&&entry.rows[entry.at].used)entry.at++;return entry.rows[entry.at]||null;};
    const scopedAdd=(map,keys,entry)=>{add(map,[...keys,allBranches],entry);add(map,[...keys,entry.row.branch||null],entry);};
    const candidates=(map,keys,deduction)=>deduction.branch?[head(queue(map,[...keys,deduction.branch])),head(queue(map,[...keys,null]))]:[head(queue(map,[...keys,allBranches]))];
    rows.forEach((row,position)=>{
        if(row.status==='Pending'||row.historySource==='deduction')return;
        const entry={row,position,used:false};add(byId,[row.id],entry);
        if(row.deductionId){add(byDeduction,[row.deductionId],entry);return;}
        if(!isMealDeduction(row.type))return;
        const name=nameKey(row.staffName);if(row.receiptId)scopedAdd(byReceipt,[name,row.receiptId],entry);
        const time=historyTime(row.timestamp),amount=Number(row.amount);
        if(time>0&&!Number.isNaN(amount)){const keys=[name,Math.floor(time/1000),amount,/^manager/i.test(row.type)];scopedAdd(byLegacy,keys,entry);if(!row.receiptId)scopedAdd(byLegacyWithoutReceipt,keys,entry);}
    });
    for (const deduction of deductions) {
        if (!automaticMeal(deduction) || (branch && deduction.branch !== branch)) continue;
        let eligible;
        if(deduction.requestId)eligible=[head(queue(byId,[deduction.requestId]))];
        else{
            const name=nameKey(deduction.staffName),time=historyTime(deduction.dateAdded),amount=Number(deduction.amount),keys=[name,Math.floor(time/1000),amount,/^manager/i.test(deduction.type)];
            eligible=[head(queue(byDeduction,[deduction.id])),...(deduction.receiptId?candidates(byReceipt,[name,deduction.receiptId],deduction):[]),...(!Number.isNaN(amount)?candidates(deduction.receiptId?byLegacyWithoutReceipt:byLegacy,keys,deduction):[])];
        }
        const match=eligible.filter(entry=>entry&&sameMeal(entry.row,deduction)).sort((a,b)=>a.position-b.position)[0];
        if (match) {
            match.used=true;
            match.row.deductionStatus = deduction.status || 'Unpaid';
        } else {
            rows.push({ ...deduction, historySource: 'deduction', status: 'Recorded',
                deductionStatus: deduction.status || 'Unpaid', timestamp: deduction.dateAdded || deduction.timestamp });
        }
    }
    return rows.sort((a, b) => historyTime(b.timestamp) - historyTime(a.timestamp));
}
