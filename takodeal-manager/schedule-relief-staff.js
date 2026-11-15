import {toScheduleEmployee} from './schedule-staff-directory.js';

const text=value=>typeof value==='string'?value.trim():'';
const key=value=>text(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const aliases=row=>[row?.name,row?.cashierName,row?.fullName,row?.scheduleNickname,row?.scheduleName,...(Array.isArray(row?.scheduleAliases)?row.scheduleAliases:[])].filter(value=>typeof value==='string'&&text(value)).map(key);
const empty=value=>typeof value==='string'&&['','n/a','unfilled'].includes(key(value));

// Relief is an explicit move of an available account, never an implicit swap
// out of another scheduled shift or leave. Standby sources retain their exact
// saved strings so the caller can remove only the inspected entries.
function availableStaff({employees,branch,dayBranches,unavailability,isBranchAllowed}={},transfer=false){
    const target=text(branch),allowed=name=>typeof isBranchAllowed==='function'&&isBranchAllowed(name)===true;
    if(!target||!allowed(target)||!Array.isArray(employees))return [];
    const people=new Map(),owners=new Map(),duplicates=new Set();
    for(const [index,row]of employees.entries()){
        const person=toScheduleEmployee(row,row?.staffId??row?.id),token=person?.staffId??Symbol('unlinked-'+index);
        if(person){if(people.has(person.staffId))duplicates.add(person.staffId);else people.set(person.staffId,person);}
        for(const alias of aliases(person||row)){if(!owners.has(alias))owners.set(alias,new Set());owners.get(alias).add(token);}
    }
    const blocked=new Set(),standby=new Map(),assignments=new Map();
    const resolve=reference=>{
        if(reference==null||empty(reference))return [];
        if(typeof reference==='object'){
            const explicit=reference.staffId??reference.id;
            if(explicit!=null)return people.has(explicit)?[explicit]:[];
            reference=reference.name||reference.staffName||reference.cashierName||reference.scheduleName;
        }
        if(typeof reference!=='string')return [];
        if(people.has(reference))return [reference];
        return [...(owners.get(key(reference))||[])];
    };
    const take=reference=>{for(const id of resolve(reference))blocked.add(id);};
    const flags=value=>{
        if(Array.isArray(value)){value.forEach(take);return;}
        if(!value||typeof value!=='object')return;
        if(value.staffId||value.id||value.name||value.staffName){take(value);return;}
        for(const [name,marker]of Object.entries(value)){if(!marker||/^\d{4}-\d{2}-\d{2}$/.test(name))continue;take(typeof marker==='object'?{...marker,name:marker.name||name}:name);}
    };
    for(const [source,row]of Object.entries(dayBranches||{})){
        if(!row||typeof row!=='object')continue;
        for(const [shiftId,reference]of Object.entries(row.scheduled||{})){
            if(!transfer){take(reference);continue;}
            const matches=resolve(reference);
            if(matches.length!==1){matches.forEach(id=>blocked.add(id));continue;}
            const id=matches[0],entries=assignments.get(id)||[];
            entries.push({branch:source,shiftId,name:reference});assignments.set(id,entries);
        }
        flags(row.unavailable);
        for(const reference of Array.isArray(row.rest)?row.rest:[]){
            const matches=resolve(reference);
            if(matches.length!==1||typeof reference!=='string'||empty(reference)){matches.forEach(id=>blocked.add(id));continue;}
            const id=matches[0],entries=standby.get(id)||[];
            if(entries.some(entry=>entry.branch===source))blocked.add(id);
            entries.push({branch:source,name:reference});standby.set(id,entries);
        }
    }
    flags(unavailability);
    return [...people.values()].filter(person=>{
        const sources=standby.get(person.staffId)||[],scheduled=assignments.get(person.staffId)||[];
        return person.scheduleEligible&&!duplicates.has(person.staffId)&&!blocked.has(person.staffId)
            &&(owners.get(key(person.name))?.size||0)===1&&sources.every(source=>allowed(source.branch))
            &&(transfer?scheduled.length===1&&scheduled[0].branch!==target&&allowed(scheduled[0].branch)
                :!sources.some(source=>source.branch===target)&&(person.branch!==target||sources.some(source=>source.branch!==target)));
    }).map(person=>({...person,standbySources:(standby.get(person.staffId)||[]).map(source=>({...source})).sort((a,b)=>a.branch.localeCompare(b.branch)||a.name.localeCompare(b.name)),
        ...(transfer?{scheduledSource:{...assignments.get(person.staffId)[0]}}:{})}))
        .sort((a,b)=>a.name.localeCompare(b.name)||a.staffId.localeCompare(b.staffId));
}

// A home branch is HR metadata. Only the destination and actual roster rows
// being changed require branch permission.
export const availableScheduleReliefStaff=input=>availableStaff(input);
// Moving a single dated assignment requires a separate, explicit review.
export const availableScheduleTransferStaff=input=>availableStaff(input,true);
