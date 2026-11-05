import {createScheduleHistoryStore} from './schedule-history.js';

const clone=value=>JSON.parse(JSON.stringify(value));
// Payroll's confirmed-head loader preserves Symbols when spreading its source.
// JSON, saved settings and editor drafts cannot manufacture this provenance.
const publishedTemplateToken=Symbol('published-payroll-templates'),publishedTemplateSources=new WeakMap();
function freezeTemplate(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeTemplate);Object.freeze(value);}return value;}
export function publishedPayrollTemplateEvidence(history){return publishedTemplateSources.get(history?.[publishedTemplateToken])||null;}
function wallTime(value){
    const match=String(value||'').trim().replace(/\s+/g,'').toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm|nn)?$/);
    if(!match)return null;
    let hour=Number(match[1]),minute=Number(match[2]||0);
    if(minute>59||hour>(match[3]?12:23)||match[3]&&hour<1)return null;
    if(match[3]){hour%=12;if(match[3]!=='am')hour+=12;}
    return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}
export function publishedPayrollTemplates(history,branch){
    const saved=publishedTemplateSources.get(history?.[publishedTemplateToken]),rules=saved?.branchConfig?.[branch];
    if(!Array.isArray(rules)||!rules.length)return null;
    const ids=new Set(),checked=[];
    for(const rule of rules){
        if(!rule||typeof rule!=='object'||Array.isArray(rule))return null;
        if(rule.active===false)continue;
        if(rule.active!==undefined&&rule.active!==true||typeof rule.id!=='string'||!rule.id||rule.id.length>100||ids.has(rule.id)
            ||rule.shiftType!==undefined&&!['morning','mid','night','other'].includes(rule.shiftType)
            ||rule.days!==undefined&&(!Array.isArray(rule.days)||rule.days.some(day=>!Number.isInteger(day)||day<0||day>6)))return null;
        ids.add(rule.id);
        const label=String(rule.name||'').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))/i);
        const start=wallTime(rule.startTime)??wallTime(label?.[1]),end=wallTime(rule.endTime)??wallTime(label?.[2]);
        if(!start||!end)return null;
        const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),duration=(minutes(end)-minutes(start)+1440)%1440;
        if(duration<60||duration>1080)return null;
        checked.push({...clone(rule),startTime:start,endTime:end});
    }
    return checked.length?freezeTemplate({rules:checked,scheduleRevisionId:saved.scheduleRevisionId}):null;
}
function globalScheduleReference(reference){
    return typeof reference==='string'?['global_schedule','settings/global_schedule'].includes(reference)
        :reference?.path==='settings/global_schedule'||reference?.id==='global_schedule'&&(!reference.parent||reference.parent.id==='settings');
}

// Capture the existing global_schedule server read; do not add a second query.
// Each loadRange gets its own store and capture, including concurrent cutoffs.
export function createPayrollBonusHistoryStore(api,options){
    const base=createScheduleHistoryStore(api,options),read=api.getDocFromServer||api.getDoc;
    return {...base,async loadRange(from,to){
        let published=null;
        const scoped=Object.create(api);
        Object.defineProperty(scoped,'getDocFromServer',{value:async reference=>{
            const snapshot=await read(reference);
            if(globalScheduleReference(reference)&&snapshot?.metadata?.fromCache===false&&snapshot.metadata.hasPendingWrites===false&&snapshot.exists?.()){
                const current=snapshot.data();
                if(current&&typeof current==='object'&&!Array.isArray(current))published=freezeTemplate({branchConfig:clone(current.branchConfig||{}),scheduleRevisionId:typeof current.scheduleRevisionId==='string'?current.scheduleRevisionId:null});
            }
            return snapshot;
        }});
        const history=await createScheduleHistoryStore(scoped,options).loadRange(from,to);
        if(published){
            const token=Object.freeze({});publishedTemplateSources.set(token,published);
            Object.defineProperty(history,publishedTemplateToken,{value:token,enumerable:true});
        }
        return history;
    }};
}
