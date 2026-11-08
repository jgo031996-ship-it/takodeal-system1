// A staff declaration is an untrusted reference for HQ, never a roster change,
// attendance correction, lateness exemption or payroll approval.
import {resolveScheduleForDate,scheduleDateKey} from './schedule-history.js';
import {shiftTimes,shiftType} from './payroll-safety.js';
import {attendanceScheduleIdentity} from './attendance-schedule-preview.js';
import {savedShiftChoices,makeSavedShiftProposal} from './saved-shift-proposal.js';
const minute=60000,day=86400000;
const text=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const key=value=>text(value).normalize('NFKC').toLowerCase();
const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!['.','..'].includes(value)&&!/[\/\u0000-\u001f]/.test(value)?value:'';
const staffId=row=>id(row?.staffId)||id(row?.id);
const aliases=row=>[row?.cashierName,row?.fullName,row?.name,row?.scheduleNickname,row?.scheduleName,row?.nickname,...(Array.isArray(row?.scheduleAliases)?row.scheduleAliases:[])].map(text).filter(Boolean);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const clockInDeclarationIdentity=value=>JSON.stringify(canonical(value??null));
const inactive=row=>row?.active===false||row?.isActive===false||row?.scheduleEligible===false
  ||['archived','isArchived','deleted','isDeleted','blocked','revoked','offboarded','resigned','terminated','disabled'].some(field=>row?.[field]===true)
  ||[row?.status,row?.employmentStatus,row?.contractStatus].some(value=>/^(resigned|terminated|inactive|disabled|revoked|archived|blocked|deleted|offboarded|offboard|finished contract|contract ended|end of contract)$/i.test(text(value)));
function directory(history){
  const roster=Array.isArray(history?.employees)?history.employees:[],ids=new Map(),owners=new Map();
  for(const row of roster){const own=staffId(row);if(!own)continue;ids.set(own,[...(ids.get(own)||[]),row]);for(const alias of aliases(row)){const name=key(alias);if(!owners.has(name))owners.set(name,new Set());owners.get(name).add(own);}}
  return {ids,owners};
}
export function clockInCoworkers(history,{staffId:ownId,staffName,profile={}}={}){
  const {ids,owners}=directory(history),homeBranch=text(profile.branch)||text(profile.homeBranch),ownNames=new Set([staffName,...aliases(profile)].map(key).filter(Boolean));
  const rows=[];
  for(const [account,records]of ids){
    if(records.length!==1||account===ownId||inactive(records[0]))continue;
    const row=records[0],name=text(row.cashierName)||text(row.fullName)||text(row.name);
    if(!name||name.length>200||owners.get(key(name))?.size!==1||aliases(row).some(alias=>ownNames.has(key(alias))))continue;
    rows.push({staffId:account,name,homeBranch:text(row.branch)||text(row.homeBranch)});
  }
  return rows.sort((a,b)=>(a.homeBranch===homeBranch?0:1)-(b.homeBranch===homeBranch?0:1)||a.homeBranch.localeCompare(b.homeBranch)||a.name.localeCompare(b.name)||a.staffId.localeCompare(b.staffId));
}
function dated(history,date){
  const archived=resolveScheduleForDate(history,date);
  if(archived)return archived;
  // A legacy live plan can be shown, but cannot become a supposedly archived
  // slot: only an explicit saved revision may be declared as a dated reference.
  return null;
}
export function clockInSwapChoices(history,input={}){
  const at=+new Date(input.at),date=scheduleDateKey(new Date(at)),midnight=Date.parse(date+'T00:00:00+08:00');
  const people=clockInCoworkers(history,input),byId=new Map(people.map(row=>[row.staffId,row])),current=directory(history),output=[];
  for(const offset of [-1,0,1]){
    const workDate=scheduleDateKey(new Date(midnight+offset*day)),saved=dated(history,workDate);if(!saved?.scheduleRevisionId)continue;
    const datedPeople=Array.isArray(saved.employees)?saved.employees:[],datedOwners=new Map(),datedIds=new Map();
    for(const row of datedPeople){const account=staffId(row);if(!account)continue;datedIds.set(account,(datedIds.get(account)||0)+1);for(const name of aliases(row)){const normalized=key(name);if(!datedOwners.has(normalized))datedOwners.set(normalized,new Set());datedOwners.get(normalized).add(account);}}
    for(const [branch,record]of Object.entries(saved.currentSchedule?.[Number(workDate.slice(-2))]||{})){
      const rules=Array.isArray(saved.branchConfig?.[branch])?saved.branchConfig[branch]:[];
      for(const [shiftId,assigned]of Object.entries(record?.scheduled||{})){
        if(typeof assigned!=='string'||!text(assigned))continue;
        const normalized=key(assigned),owners=datedOwners.get(normalized),freshOwners=current.owners.get(normalized);
        if(owners?.size!==1||freshOwners?.size>1)continue;
        const account=[...owners][0],person=byId.get(account);if(!person||datedIds.get(account)!==1||freshOwners?.size===1&&![...freshOwners].includes(account))continue;
        const matchesPerson=flag=>staffId(flag)===account||[person.name,...aliases(datedPeople.find(row=>staffId(row)===account))].some(name=>key(name)===key(typeof flag==='string'?flag:flag?.name||flag?.staffName));
        const unavailable=Object.values(saved.currentSchedule?.[Number(workDate.slice(-2))]||{}).some(row=>(Array.isArray(row?.unavailable)?row.unavailable:[]).some(matchesPerson));
        const flags=saved.unavailability?.[workDate];
        if(unavailable||Array.isArray(flags)&&flags.some(matchesPerson)||flags&&!Array.isArray(flags)&&typeof flags==='object'&&Object.entries(flags).some(([name,value])=>value&&matchesPerson(typeof value==='object'?{...value,name:value.name||name}:name)))continue;
        const matches=rules.filter(rule=>rule.id===shiftId),rule=matches.length===1?matches[0]:null;
        if(!rule||!id(shiftId)||rule.active===false||Array.isArray(rule.days)&&!rule.days.includes(new Date(workDate+'T00:00:00Z').getUTCDay()))continue;
        const times=shiftTimes(rule);if(times.start===null||times.end===null)continue;
        const duration=(times.end-times.start+1440)%1440;if(duration<60||duration>1080)continue;
        const begin=Date.parse(workDate+'T00:00:00+08:00')+times.start*minute,finish=begin+duration*minute;
        if(at<begin-90*minute||at>=finish)continue;
        const row={coworkerStaffId:account,coworkerName:person.name,coworkerHomeBranch:person.homeBranch,workDate,targetBranch:branch,
          targetShiftId:shiftId,targetShiftName:text(rule.name)||shiftId,targetAssignedName:text(assigned),targetStartAt:new Date(begin).toISOString(),targetEndAt:new Date(finish).toISOString(),sourceRevisionId:saved.scheduleRevisionId};
        row.sourceFingerprint=clockInDeclarationIdentity({...row,shiftType:shiftType(rule),amendmentIds:(saved.scheduleAmendments||[]).filter(event=>event.branch===branch&&event.changes?.some(change=>change.shiftId===shiftId)).map(event=>event.id)});
        if(row.sourceFingerprint.length>12000)continue;
        row.key=JSON.stringify([account,workDate,branch,shiftId,row.sourceRevisionId]);output.push(row);
      }
    }
  }
  return output.sort((a,b)=>people.findIndex(person=>person.staffId===a.coworkerStaffId)-people.findIndex(person=>person.staffId===b.coworkerStaffId)
    ||(a.targetBranch===input.branch?0:1)-(b.targetBranch===input.branch?0:1)||a.targetStartAt.localeCompare(b.targetStartAt)||a.targetBranch.localeCompare(b.targetBranch)||a.targetShiftId.localeCompare(b.targetShiftId));
}
export function makeClockInScheduleDeclaration(history,input,selection,explanation,{declaredAt=new Date(input.at).toISOString()}={}){
  if(!id(input.staffId)||!text(input.staffName)||!id(input.branch)||!input.snapshot)throw Error('Refresh your staff identity and assigned hours before declaring a swap.');
  const reason=text(explanation);if(reason.length<5||reason.length>1000)throw Error('Explain who agreed to the swap and which shift you will cover (5–1000 characters).');
  if(typeof declaredAt!=='string'||!Number.isFinite(Date.parse(declaredAt))||new Date(declaredAt).toISOString()!==declaredAt)throw Error('Review the shift declaration again with a valid device clock.');
  const choice=clockInSwapChoices(history,input).find(row=>row.key===selection?.key);
  if(!choice||choice.sourceFingerprint!==selection.sourceFingerprint)throw Error('The coworker or saved dated shift changed. Review the current choices before Time In.');
  const {key:unused,...reference}=choice;
  return {schemaVersion:1,kind:'unrequested-swap',referenceOnly:true,staffId:input.staffId,staffName:input.staffName,attendanceBranch:input.branch,declaredAt,
    ...reference,originalScheduleFingerprint:attendanceScheduleIdentity(input.snapshot),explanation:reason};
}
export function revalidateClockInScheduleDeclaration(history,input,declaration){
  if(!declaration)return null;
  const selection={key:JSON.stringify([declaration.coworkerStaffId,declaration.workDate,declaration.targetBranch,declaration.targetShiftId,declaration.sourceRevisionId]),sourceFingerprint:declaration.sourceFingerprint};
  const current=makeClockInScheduleDeclaration(history,input,selection,declaration.explanation,{declaredAt:declaration.declaredAt});
  if(clockInDeclarationIdentity(current)!==clockInDeclarationIdentity(declaration))throw Error('Your declared swap or original assigned hours changed during verification. No Time In was saved. Review the current shift again.');
  return current;
}
export function clockInDeclarationSavedProposal(history,input,declaration){
  if(!declaration||declaration.targetBranch!==input.start.branch)return null;
  const choice=savedShiftChoices(history,input).find(row=>row.workDate===declaration.workDate&&row.shiftId===declaration.targetShiftId&&row.sourceRevisionId===declaration.sourceRevisionId&&row.expectedStartAt===declaration.targetStartAt&&row.expectedEndAt===declaration.targetEndAt);
  if(!choice)throw Error('The declared dated shift no longer matches its saved branch reference. Review the shift again.');
  return makeSavedShiftProposal(history,input,choice);
}
export function clockInDeclarationRequest({declaration,attendanceLogId,lateRequest=null,lateMinutes=0,timestamp}){
  if(!declaration)return lateRequest;
  if(!id(attendanceLogId))throw Error('The shift declaration needs its exact Time In reference.');
  const combined=lateRequest?.type==='Reason Letter'&&Number(lateMinutes)>3;
  return {...(combined?lateRequest:{}),attendanceLogId,staffId:declaration.staffId,staffName:declaration.staffName,branch:declaration.attendanceBranch,
    type:combined?'Reason Letter':'Schedule Declaration',status:'Pending',lateMinutes:Number.isFinite(Number(lateMinutes))?Number(lateMinutes):0,
    explanationCause:combined?'Tardiness / Late Arrival · Unrequested shift swap':'Unrequested shift swap',
    explanationMessage:(combined?lateRequest.explanationMessage+'\n\n':'')+'Declared swap with '+declaration.coworkerName+' · '+declaration.targetBranch+' · '+declaration.targetShiftName+' ('+declaration.workDate+'). '+declaration.explanation,
    scheduleDeclaration:declaration,timestamp};
}
