import {readPayrollSnapshot} from './payroll-preview-guard.js';
import {loadStaffSalaryTimeline,staffProfileForWork,staffRateWorkDate,staffRateForDate,payrollSalaryProfile,dailyStaffRate} from './staff-rate-model.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';

const coordinators=new WeakMap(),references=new WeakMap(),pendingDocuments=new WeakMap(),sessionIds=new WeakMap();let nextSession=0;
function accountKey(api){const user=api.auth?.currentUser,session=api.sessionUser;if(session&&typeof session==='object'&&!sessionIds.has(session))sessionIds.set(session,++nextSession);return JSON.stringify([user?.uid,user?.email,user?.emailVerified,sessionIds.get(session),session?.uid,session?.email,session?.role,session?.permissions,session?.allowedBranches,session?.branch,session?.isFranchisee,session?.isOwner]);}
function requestKey(api,options){const dates=options.getDates?.()||options;return JSON.stringify([accountKey(api),options.kind,dates.start,dates.end]);}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function readGuard(api,assertCurrent){const actor=accountKey(api);return()=>{assertCurrent();if(accountKey(api)!==actor)throw Error('The payroll account or branch access changed. Generate the list again.');payrollLoadingScope(api);};}

export function payrollLoadingScope(api){
 const user=api.auth?.currentUser,session=api.sessionUser,email=String(user?.email||'').trim().toLowerCase();
 if(!user?.uid||!email||user.emailVerified!==true||session?.uid!==user.uid||String(session.email||'').trim().toLowerCase()!==email||session.isFranchisee===true||!canOpenWorkspacePage(session,'payroll'))throw Error('Sign in with your verified payroll account before generating the list.');
 const owner=email===OWNER_EMAIL,branches=Array.isArray(session.allowedBranches)?session.allowedBranches:[],all=owner||branches.includes('All');
 if(!all&&!branches.length)throw Error('No payroll branches are assigned to this account.');
 return {owner,all,allows:branch=>typeof branch==='string'&&branch.trim()?all||branches.includes(branch):owner};
}
function filteredSnapshot(snapshot,accept){const docs=[];snapshot.forEach(row=>{if(accept(row.data(),row.id))docs.push(row);});return {docs,metadata:snapshot.metadata,empty:docs.length===0,size:docs.length,forEach:callback=>docs.forEach(callback)};}
export function scopePayrollInputs(api,input){
 const scope=payrollLoadingScope(api);if(scope.owner)return input;
 const nameKey=value=>String(value||'').trim().toLowerCase(),byId=new Map(),byName=new Map();input.staffSnap.forEach(row=>{const profile=row.data(),name=nameKey(profile.cashierName);byId.set(row.id,profile);const list=byName.get(name)||[];list.push(profile);byName.set(name,list);});
 const accepts=data=>{
  const id=data.staffId||data.frozenData?.staffId,profile=id?byId.get(id):null;
  if(id&&(!profile||!scope.allows(profile.branch)))return false;
  const matches=byName.get(nameKey(data.staffName||data.frozenData?.name))||[];
  if(!profile&&matches.length&&!matches.some(row=>scope.allows(row.branch)))return false;
  const branch=data.branch||data.frozenData?.branch;if(branch)return scope.allows(branch);
  if(profile)return scope.allows(profile.branch);
  return matches.length>0&&matches.every(row=>scope.allows(row.branch));
 };
 return {...input,staffSnap:filteredSnapshot(input.staffSnap,profile=>scope.allows(profile.branch)),prSnap:filteredSnapshot(input.prSnap,accepts),ledgerSnap:filteredSnapshot(input.ledgerSnap,accepts),attSnap:filteredSnapshot(input.attSnap,accepts),deductSnap:filteredSnapshot(input.deductSnap,accepts),bonusSnap:filteredSnapshot(input.bonusSnap,accepts)};
}

// Share an active same-scope run only. A different selection keeps one latest
// queued request; old results and completed server data are never cached.
export function coordinatePayrollLoad(api,options,work){
 let state=coordinators.get(api);if(!state){state={active:null,queued:null};coordinators.set(api,state);}
 const key=requestKey(api,options);if(state.active?.key===key&&!state.active.invalidated)return state.active.promise;if(state.queued?.key===key)return state.queued.promise;
 const request={...deferred(),key,options,work};
 function start(current){
  if(requestKey(api,current.options)!==current.key){current.resolve(false);return;}
  state.active=current;
  const finish=()=>{if(state.active!==current)return;state.active=null;const queued=state.queued;state.queued=null;if(queued)start(queued);};
  let result;try{result=current.work();}catch(error){current.reject(error);finish();return;}
  Promise.resolve(result).then(value=>{finish();current.resolve(value);},error=>{finish();current.reject(error);});
 }
 if(state.active){state.queued?.resolve(false);state.queued=request;state.active.invalidated=true;options.invalidate?.();}
 else start(request);
 return request.promise;
}

export async function mapPayrollReads(tasks,{assertCurrent=()=>{},concurrency=4}={}){
 if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)throw Error('The payroll reader limit is invalid.');
 const values=new Array(tasks.length);let next=0,failure;
 await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{
  while(!failure&&next<tasks.length){const index=next++;try{assertCurrent();values[index]=await tasks[index]();assertCurrent();}catch(error){failure ||= error;}}
 }));
 if(failure)throw failure;return values;
}

function readBoundedDocument(api,key,read,{timeoutMs=25000}={}){
 let pending=pendingDocuments.get(api);if(!pending){pending=new Map();pendingDocuments.set(api,pending);}if(pending.has(key))return pending.get(key).result;
 let physical;try{physical=Promise.resolve(read());}catch(error){physical=Promise.reject(error);}
 let timer;const entry={};entry.result=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ took too long to confirm payroll. Reconnect and generate the list again.')),timeoutMs);})]).finally(()=>clearTimeout(timer));pending.set(key,entry);
 const release=()=>{if(pending.get(key)===entry)pending.delete(key);clearTimeout(timer);};physical.then(release,release);return entry.result;
}
function previewReferences(api,options){
 let cache=references.get(api);if(!cache){cache=new Map();references.set(api,cache);}
 const {start,end,fetchStartDate,fetchEndDate,trueStartDate}=options,key=JSON.stringify([accountKey(api),start,end,+fetchStartDate,+fetchEndDate,+trueStartDate]);
 if(cache.has(key))return cache.get(key);
 const c=table=>api.collection(api.db,table),q=api.query,w=api.where;
 const result={payroll: q(c('payroll_records'),w('startDate','==',start),w('endDate','==',end)),staff:c('cashiers'),ledger:c('staff_ledger'),attendance:q(c('attendance_logs'),w('timestamp','>=',fetchStartDate),w('timestamp','<=',fetchEndDate),api.orderBy('timestamp','asc')),deductions:q(c('staff_deductions'),w('status','==','Unpaid')),bonuses:q(c('staff_bonuses'),w('dateAdded','>=',trueStartDate),w('dateAdded','<=',fetchEndDate))};
 cache.set(key,result);if(cache.size>32)cache.delete(cache.keys().next().value);return result;
}

export async function loadPayrollPreviewInputs(api,options){
 const {start,end,assertCurrent=()=>{},concurrency=7,timeoutMs=25000}=options,guard=readGuard(api,assertCurrent);guard();const refs=previewReferences(api,options),key=JSON.stringify([accountKey(api),'schedule',start,end]);
 const tasks=[()=>readBoundedDocument(api,key,()=>{guard();return api.loadPayrollScheduleHistory(start,end);},{timeoutMs}),...Object.values(refs).map(reference=>()=>{guard();return readPayrollSnapshot(api,reference,{timeoutMs});})];
 const [scheduleData,prSnap,staffSnap,ledgerSnap,attSnap,deductSnap,bonusSnap]=await mapPayrollReads(tasks,{assertCurrent:guard,concurrency});guard();return scopePayrollInputs(api,{scheduleData,prSnap,staffSnap,ledgerSnap,attSnap,deductSnap,bonusSnap});
}

const salaryReviewMessage='Daily wage history could not be confirmed for this employee. Review Staff & Security salary history, then generate this cutoff again. Recorded attendance is retained; payment is held.';
export async function loadPayrollSalaryProfiles(api,staffDict,paidRecords,{assertCurrent=()=>{},concurrency=4,timeoutMs=25000,staffNames}={}){
 const selected=staffNames===undefined?null:new Set(staffNames);
 const guard=readGuard(api,assertCurrent);guard();const scope=payrollLoadingScope(api),entries=Object.entries(staffDict).filter(([name,profile])=>scope.allows(profile.branch)&&!paidRecords[name]&&profile.salaryRateVersion===1&&(!selected||selected.has(name))),key=accountKey(api);
 const results=await mapPayrollReads(entries.map(([,profile])=>async()=>{try{const {salaryHistoryUnavailable,salaryReviewReason,...current}=profile;return await loadStaffSalaryTimeline(api,current,{read:reference=>{guard();return readBoundedDocument(api,JSON.stringify([key,'salary',profile.staffId,profile.branch,profile.salaryRateRevision]),()=>{guard();return api.getDocFromServer(reference);},{timeoutMs});}});}catch{guard();return {...profile,salaryHistoryUnavailable:true,salaryReviewReason:salaryReviewMessage};}}),{assertCurrent:guard,concurrency});
 guard();const next=Object.fromEntries(Object.entries(staffDict).filter(([,profile])=>scope.allows(profile.branch)));entries.forEach(([name],index)=>{next[name]=results[index];});return next;
}

// An employee-specific wage issue never invents a zero wage or discards other
// employees' confirmed attendance. Callers retain the hours and block payment.
export function payrollSalaryForWork(profile,log,shift){
 if(profile?.salaryHistoryUnavailable)return {profile:null,reason:profile.salaryReviewReason||salaryReviewMessage};
 let date='this work date';try{date=staffRateWorkDate(log,shift);if(profile?.salaryRateVersion!==1&&dailyStaffRate(profile)===null)throw Error('No recorded wage');return {profile:staffProfileForWork(profile,log,shift),reason:''};}
 catch{return {profile:null,reason:'Daily wage is not confirmed for '+date+'. Review this employee’s saved salary history. Recorded attendance is retained; payment is held.'};}
}
export function payrollSalaryForPreview(profile,date){
 const {salaryRateTimeline,...safe}=profile||{};
 if(profile?.salaryHistoryUnavailable)return {profile:{...safe,hourlyRate:null},reason:profile.salaryReviewReason||salaryReviewMessage};
 try{if(staffRateForDate(profile,date)===null)throw Error('No recorded wage');return {profile:payrollSalaryProfile(profile,date),reason:''};}
 catch{return {profile:{...safe,hourlyRate:null},reason:'The daily wage for the selected cutoff could not be confirmed. Review this employee’s salary history. Recorded attendance is retained; payment is held.'};}
}
