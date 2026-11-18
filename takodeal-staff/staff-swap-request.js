import {createScheduleMonthReader} from './schedule-sync.js';
import {monthKey,scheduleDateKey} from './schedule-history.js';
import {activeStaffProfile} from './staff-lifecycle-model.js';

const clean=value=>typeof value==='string'?value.trim():'';
const key=value=>clean(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const adjacent=(date,offset)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
export const staffSwapAliases=profile=>[...new Set([profile?.cashierName,profile?.fullName,profile?.name,profile?.scheduleNickname,profile?.scheduleName,profile?.nickname,...(Array.isArray(profile?.scheduleAliases)?profile.scheduleAliases:[])].map(clean).filter(Boolean))];
export const swapCandidateKey=candidate=>JSON.stringify([candidate.targetBranch,candidate.targetAssignedName,candidate.targetStaffId||'',candidate.targetShiftId]);

export const STAFF_SWAP_READ_TIMEOUT_MS=45000;
const profileReads=new WeakMap(),monthReaders=new WeakMap();
function freshProfile(api,staffId){
 let pending=profileReads.get(api);if(!pending){pending=new Map();profileReads.set(api,pending);}
 const key=JSON.stringify([api.auth?.currentUser?.uid||'',staffId]);
 let read=pending.get(key);
 if(!read){read=Promise.resolve().then(()=>api.getDocFromServer(api.doc(api.db,'cashiers',staffId))).finally(()=>{if(pending.get(key)===read)pending.delete(key);});pending.set(key,read);}
 return read;
}
function freshMonth(api,{month}){
 let reader=monthReaders.get(api);if(!reader){reader=createScheduleMonthReader(api,{timeoutMs:STAFF_SWAP_READ_TIMEOUT_MS});monthReaders.set(api,reader);}
 return reader.load(month);
}
function boundedRead(promise,deadline,assertCurrent){
 let timer;const remaining=Math.max(1,deadline-Date.now());
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The current staff account and branch schedules could not be confirmed in time. No request was sent. Check your connection and try again.')),remaining);})]).then(value=>{assertCurrent();return value;}).finally(()=>clearTimeout(timer));
}

// Only the requesting account is refreshed here. Coworker identities come from
// the already published scheduling roster, never a broad private-profile read.
export async function loadStaffSwapContext(api,{staffId,staffName,workDate,assertCurrent=()=>{},readMonth=freshMonth,onProgress=()=>{},timeoutMs=STAFF_SWAP_READ_TIMEOUT_MS}={}){
 const date=scheduleDateKey(workDate),month=monthKey(date),day=Number(date.slice(-2));
 if(!clean(staffId)||/[\/\0]/.test(staffId))throw Error('Sign in to your staff account before requesting a swap.');
 const deadline=Date.now()+Math.min(STAFF_SWAP_READ_TIMEOUT_MS,Math.max(1,Number(timeoutMs)||STAFF_SWAP_READ_TIMEOUT_MS));
 assertCurrent();
 onProgress('Confirming your current staff account…');
 const snap=await boundedRead(freshProfile(api,staffId),deadline,assertCurrent);assertCurrent();
 if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to confirm your staff account.');
 const profile=snap.data(),aliases=staffSwapAliases(profile);
 if(!activeStaffProfile(profile)||profile.scheduleEligible===false||!aliases.length||staffName&&!aliases.some(name=>key(name)===key(staffName)))throw Error('Your active staff identity could not be confirmed. Sign in again or ask HQ to review your profile.');
 onProgress('Checking the latest saved schedules across all branches…');
 const view=await boundedRead(readMonth(api,{month}),deadline,assertCurrent);assertCurrent();
 if(!view.hasSavedSchedule)throw Error('HQ has not saved a schedule for this month yet.');
 const snapshot=view.daySnapshots?.[day]||view.snapshot;
 const daySnapshots={...view.daySnapshots,[date]:snapshot};
 for(const [offset,neighboringDate] of [[-1,adjacent(date,-1)],[1,adjacent(date,1)]]){
  if(monthKey(neighboringDate)===month)continue;
  onProgress('Checking the adjacent month for overnight shift conflicts…');
  const neighboringMonth=await boundedRead(readMonth(api,{month:monthKey(neighboringDate)}),deadline,assertCurrent);assertCurrent();
  if(!neighboringMonth.hasSavedSchedule){
   if(offset<0)throw Error('The neighboring month schedule is needed to check overnight shift conflicts. Ask HQ to confirm it first.');
   // The model can still offer daytime trades. Only shifts extending into the
   // following day need evidence from an unpublished next month.
   continue;
  }
  const neighborDay=Number(neighboringDate.slice(-2));
  daySnapshots[neighboringDate]=neighboringMonth.daySnapshots?.[neighborDay]||neighboringMonth.snapshot;
 }
 assertCurrent();
 return {workDate:date,day,sourceScheduleMonth:month,sourceRevisionId:view.dayRevisions?.[day]||snapshot.scheduleRevisionId||'',snapshot,daySnapshots,requesterStaffId:staffId,requesterName:clean(profile.cashierName)||clean(profile.fullName)||clean(profile.name)||aliases[0],requesterAliases:aliases};
}

export function staffSwapContextKey(context){
 const {snapshot,day,workDate}=context;
 return canonical({sourceRevisionId:context.sourceRevisionId,day:snapshot.currentSchedule?.[day],branchConfig:snapshot.branchConfig,unavailability:snapshot.unavailability?.[workDate]});
}

export const swapEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function incomingSwapDetailsHTML(request){
 const e=swapEscape,from=request.branch,to=request.targetBranch||from;
 const trade=request.targetShiftId==='STANDBY'
  ?`You would cover <b>${e(from)} · ${e(request.requesterShiftName)}</b>. ${e(request.requesterName)} would take a standby/day off.`
  :`You would work <b>${e(from)} · ${e(request.requesterShiftName)}</b>, and ${e(request.requesterName)} would work <b>${e(to)} · ${e(request.targetShiftName)}</b>.`;
 return `<strong style="color:#92400e;font-size:14px">${e(request.requesterName)}</strong> requests a shift swap on <strong>${e(request.workDate||request.dateStr)}</strong>.<br>${trade}<br><small>Accepting sends this request to HQ. The schedule changes only after HQ approval.</small>`;
}
