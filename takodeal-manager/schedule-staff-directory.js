// Current HR profiles supply membership. Saved rosters supply only dated names.
// These helpers never assign a shift, change a home branch, or edit a saved day.
import {activeStaffProfile,createStaffHistoryResolver} from './staff-lifecycle-model.js';
const clean=value=>typeof value==='string'?value.trim():'';
const key=value=>clean(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const id=value=>typeof value==='string'&&value.length>0&&!['.','..'].includes(value)&&!/[\/\0]/.test(value)&&new TextEncoder().encode(value).length<=1500?value:null;
const linked=row=>id(row?.staffId)||id(row?.id);
const eligible=row=>activeStaffProfile(row)&&row?.scheduleEligible!==false;
const unique=values=>{const seen=new Set();return values.filter(value=>{const name=clean(value);if(!name||seen.has(name))return false;seen.add(name);return true;});};
const names=row=>unique([row?.name,row?.fullName,row?.cashierName,row?.scheduleNickname,row?.scheduleName,
    ...(Array.isArray(row?.scheduleAliases)?row.scheduleAliases:[])].map(clean));
function project(profile,staffId){
    if(!profile||typeof profile!=='object'||Array.isArray(profile))return null;
    const scheduleNickname=clean(profile.scheduleNickname),scheduleName=scheduleNickname||clean(profile.scheduleName);
    const cashierName=clean(profile.cashierName)||clean(profile.fullName)||clean(profile.name);
    const name=scheduleNickname||scheduleName||(!staffId?clean(profile.name):'')||cashierName;
    if(!name)return null;
    const output={...(staffId?{staffId}:{}),name,fullName:cashierName||name,cashierName:cashierName||name,
        scheduleNickname,scheduleName:scheduleName||name,branch:clean(profile.branch)||'Unassigned',
        status:clean(profile.status),active:activeStaffProfile(profile),blocked:profile.blocked===true,
        archived:profile.archived===true,scheduleEligible:eligible(profile)};
    if(/^\d{4}-\d{2}-\d{2}$/.test(clean(profile.dateHired)))output.dateHired=clean(profile.dateHired);
    output.scheduleAliases=unique([...names(profile),...names(output)]);
    return output;
}
function rows(value){return (Array.isArray(value)?value:[]).map(row=>project(row,linked(row))).filter(Boolean);}
function shares(a,b){const wanted=new Set(names(a).map(key));return names(b).some(value=>wanted.has(key(value)));}
function legacyMatch(saved,person,all){
    const candidates=saved.filter(row=>!linked(row)&&shares(row,person));
    if(candidates.length!==1)return null;
    const candidate=candidates[0],matched=new Set(names(candidate).filter(value=>names(person).some(name=>key(name)===key(value))).map(key));
    if(all.some(row=>linked(row)&&linked(row)!==person.staffId&&names(row).some(name=>matched.has(key(name)))))return null;
    return candidate;
}
function safeAliases(person,evidence,others){
    const current=new Set(names({...person,scheduleAliases:[]}).map(key));
    const conflicts=new Set(others.filter(row=>linked(row)!==person.staffId).flatMap(row=>names(row).map(key)));
    return unique([...names(person),...evidence.flatMap(names)]).filter(name=>current.has(key(name))||!conflicts.has(key(name)));
}

/** Minimal scheduling metadata. The supplied Firestore document ID wins. */
export function toScheduleEmployee(profile,staffId){return id(staffId)?project(profile,staffId):null;}

/** Current account identity only. Dated roster names never manufacture a current
 * active profile; missing and ambiguous names remain history for review. */
export function resolveScheduleEmployeeReference(reference,directory){
    const identity=createStaffHistoryResolver(Array.isArray(directory)?directory:[])(reference);
    return identity.active&&identity.profile?.scheduleEligible!==false?identity.profile:null;
}

/** Current status wins; an exactly ID-bound saved roster may add old aliases.
 * Inactive accounts remain in the identity index so their names cannot be
 * silently adopted by a different active employee. */
export function scheduleIdentityDirectory(directory,savedEmployees=[]){
    const live=rows(directory),saved=rows(savedEmployees);
    return live.map(person=>({...person,scheduleAliases:unique([...names(person),...saved.filter(row=>linked(row)&&linked(row)===linked(person)).flatMap(names)])}));
}

/** Enrich aliases without importing any old snapshot's membership or status. */
export function mergeScheduleEmployeeAliases(directory,savedEmployees){
    const live=rows(directory).filter(row=>linked(row)),saved=rows(savedEmployees),conflicts=new Set();
    const people=new Map();for(const person of live){const old=people.get(person.staffId);if(old&&(old.name!==person.name||old.branch!==person.branch||old.scheduleEligible!==person.scheduleEligible))conflicts.add(person.staffId);if(!old)people.set(person.staffId,person);}
    const current=[...people.values()].filter(row=>row.scheduleEligible&&!conflicts.has(row.staffId));
    return current.map(person=>{
        const bound=saved.filter(row=>linked(row)===person.staffId),identity={...person,scheduleAliases:unique([...names(person),...bound.flatMap(names)])};
        const legacy=legacyMatch(saved,identity,[...current,...saved]);
        return {...person,scheduleAliases:safeAliases(person,[...bound,...(legacy?[legacy]:[])],[...current,...saved].filter(row=>row!==legacy))};
    });
}

/** Replace one live account by ID; a legacy name may bind only uniquely. */
export function upsertScheduleEmployee(list,profile,staffId,{previousProfile}={}){
    const original=rows(list),target=id(staffId);
    if(!target)return original.filter(row=>row.scheduleEligible);
    const incoming=toScheduleEmployee(profile,target),bound=original.filter(row=>linked(row)===target);
    const previous=previousProfile&&(!linked(previousProfile)||linked(previousProfile)===target)?project(previousProfile,target):null;
    if(!incoming&&eligible(profile))return original.filter(row=>row.scheduleEligible);
    const identity=incoming||bound[0]||previous;
    const evidence=identity?{...identity,staffId:target,scheduleAliases:unique([...names(identity),...bound.flatMap(names),...(previous?names(previous):[])])}:null;
    const legacy=evidence?legacyMatch(original,evidence,original):null;
    const next=[],seen=new Set();let inserted=false;
    for(const person of original){
        if(linked(person)===target||person===legacy){if(!inserted&&incoming?.scheduleEligible){next.push(incoming);inserted=true;}continue;}
        if(!person.scheduleEligible)continue;
        if(linked(person)){if(seen.has(person.staffId))continue;seen.add(person.staffId);}
        next.push(person);
    }
    if(!inserted&&incoming?.scheduleEligible)next.push(incoming);
    const history=[...original,...(previous?[previous]:[])],enriched=new Map(mergeScheduleEmployeeAliases(next,history).map(person=>[person.staffId,person]));
    return next.map(person=>linked(person)?enriched.get(person.staffId):person).filter(Boolean);
}

/** Available same-home-branch accounts missing from this one dated roster.
 * unavailability is the selected work date's global flags, not a month map.
 */
export function availableSchedulePoolStaff({employees,branch,dayData,dayBranches,unavailability}={}){
    const home=clean(branch);if(!home)return [];
    const directory=rows(employees),people=new Map(),conflictingIds=new Set(),owners=new Map();
    for(const person of directory){
        const staffId=linked(person),token=staffId||'legacy:'+directory.indexOf(person);
        if(staffId){const prior=people.get(staffId);if(prior&&(prior.name!==person.name||prior.branch!==person.branch||prior.scheduleEligible!==person.scheduleEligible))conflictingIds.add(staffId);if(!prior)people.set(staffId,person);}
        for(const name of names(person)){const normalized=key(name);if(!owners.has(normalized))owners.set(normalized,new Set());owners.get(normalized).add(token);}
    }
    const blocked=new Set();
    const take=reference=>{
        if(reference===null||reference===undefined)return;
        if(typeof reference==='object'){
            const explicit=linked(reference);if(explicit){blocked.add(explicit);return;}
            reference=reference.name||reference.staffName||reference.cashierName||reference.scheduleName;
        }
        if(typeof reference!=='string'||['','n/a','unfilled'].includes(key(reference)))return;
        if(people.has(reference)){blocked.add(reference);return;}
        // Ambiguous dated names block every claimant rather than picking one.
        for(const owner of owners.get(key(reference))||[])blocked.add(owner);
    };
    const flags=value=>{
        if(Array.isArray(value)){value.forEach(take);return;}
        if(!value||typeof value!=='object')return;
        if(linked(value)||value.name||value.staffName){take(value);return;}
        for(const [name,marker]of Object.entries(value)){
            if(!marker||/^\d{4}-\d{2}-\d{2}$/.test(name))continue;
            take(typeof marker==='object'?{...marker,name:marker.name||name}:name);
        }
    };
    const visit=value=>{if(!value||typeof value!=='object')return;Object.values(value.scheduled||{}).forEach(take);(Array.isArray(value.rest)?value.rest:[]).forEach(take);flags(value.unavailable);};
    visit(dayData);if(dayBranches&&typeof dayBranches==='object')Object.values(dayBranches).forEach(visit);flags(unavailability);
    return [...people.values()].filter(person=>person.scheduleEligible&&person.branch===home&&!conflictingIds.has(person.staffId)
        &&!blocked.has(person.staffId)&&(owners.get(key(person.name))?.size||0)===1)
        .sort((a,b)=>a.name.localeCompare(b.name)||a.staffId.localeCompare(b.staffId));
}
