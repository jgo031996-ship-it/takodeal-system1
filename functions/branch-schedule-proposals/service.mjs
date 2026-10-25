import {createHash,timingSafeEqual} from 'node:crypto';
import {loadScheduleMonthView} from './schedule-sync.js';
import {normalizeScheduleProposal,scheduleProposalContext} from './schedule-proposal-model.js';

export const PRODUCTION_ORIGINS=['https://takodeal-cashier.vercel.app'];
export const MAX_REQUEST_BYTES=262144;
const WINDOW_MS=900000,LIMITS={uid:12,peer:80,global:500};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(x);
const canonical=x=>JSON.stringify(x,(_key,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=x=>createHash('sha256').update(x).digest('hex');
const sameSecret=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const today=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
class ProposalError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new ProposalError(status,code,message);};
const deny=()=>fail(403,'staff-unavailable','Your saved staff account or tablet could not be confirmed for this branch. Ask HQ to check it.');
function active(profile){return object(profile)&&profile.active!==false&&profile.blocked!==true&&profile.archived!==true&&!['blocked','revoked','terminated','resigned','inactive','disabled','archived','deleted'].includes(String(profile.status||'').trim().toLowerCase())&&typeof profile.cashierName==='string'&&profile.cashierName.trim()&&typeof profile.branch==='string'&&profile.branch.trim()&&!['REVOKED','BLOCKED'].includes(String(profile.pin||'').trim().toUpperCase())&&['staff','staff crew','crew','cashier','manager'].includes(String(profile.role||'Staff').trim().toLowerCase());}
function verifyPin(profile,pin){const saved=profile.pin;return (typeof saved==='string'&&saved.trim()!==''&&sameSecret(pin,saved))||(typeof saved==='number'&&Number.isSafeInteger(saved)&&/^\d{1,16}$/.test(pin)&&sameSecret(String(Number(pin)),String(saved)));}
function profileRow(profile,staffId){return {staffId,name:profile.cashierName,scheduleName:profile.scheduleNickname||profile.cashierName,branch:profile.branch,active:active(profile)};}

// Only the server creates proposals. Staff never receive a canonical schedule
// write capability. Owner decisions use an atomic revision-linked client rule.
export function createBranchScheduleProposals({verifyToken,store,now=Date.now,allowedOrigins=PRODUCTION_ORIGINS}={}){
 if(typeof verifyToken!=='function'||typeof store?.transaction!=='function')throw Error('Trusted auth and transaction store required');
 const origins=new Set(allowedOrigins);for(const origin of origins){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin)throw Error('Use exact HTTPS origins');}
 const instant=()=>{const ms=now();if(!Number.isSafeInteger(ms)||ms<0)throw Error('Trusted server time unavailable');return ms;};
 const response=(status,body,origin)=>({status,body,headers:{'Cache-Control':'no-store','Content-Type':'application/json',Vary:'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
 async function attempts(actor,peer){const window=Math.floor(instant()/WINDOW_MS),paths=[['uid',actor.uid],['peer',String(peer||'shared-peer')],['global','all']].map(([kind,value])=>({kind,path:'branch_schedule_proposal_attempts/'+hash(kind+'|'+value+'|'+window)}));
  await store.transaction(async tx=>{const before=await Promise.all(paths.map(x=>tx.get(x.path)));for(let i=0;i<paths.length;i++){const value=before[i];if(value!==null&&(!Number.isSafeInteger(value.count)||value.count<0))fail(503,'rate-unavailable','Schedule submission is temporarily unavailable.');if((value?.count||0)>=LIMITS[paths[i].kind])fail(429,'too-many-attempts','Too many schedule attempts. Wait a few minutes before trying again.');}
   paths.forEach((entry,i)=>tx.set(entry.path,{count:(before[i]?.count||0)+1,expiresAt:new Date((window+2)*WINDOW_MS).toISOString()}));});}
 async function submit(body,actor){const intent=hash(canonical({staffId:body.staffId,proposal:body.proposal})),opPath='branch_schedule_proposal_operations/'+hash(actor.uid+'|'+body.operationId),path='branch_schedule_proposals/'+body.proposal.id;
  return store.transaction(async tx=>{
   const [profile,binding,prior,existing]=await Promise.all([tx.get('cashiers/'+body.staffId),tx.get('pos_bindings/'+actor.uid),tx.get(opPath),tx.get(path)]);
   if(!active(profile)||!object(binding)||binding.uid!==actor.uid||binding.status!=='Active'||binding.branch!==profile.branch||!id(binding.deviceId)||body.proposal.branch!==profile.branch||!verifyPin(profile,body.pin))deny();
   if(!id(binding.legacyDeviceDocId))deny();
   const fleet=await tx.get('pos_devices/'+binding.legacyDeviceDocId);
   if(!object(fleet)||fleet.status!=='Active'||fleet.branch!==binding.branch||fleet.deviceId!==binding.deviceId||String(fleet.appType||'').toLowerCase()==='staff')deny();
   const summary=row=>({id:row.proposal.id,status:row.status,submittedAt:row.submittedAt,submittedBy:row.submittedBy});
   if(prior){if(prior.uid!==actor.uid||prior.staffId!==body.staffId||prior.intent!==intent||prior.proposalId!==body.proposal.id||existing?.intent!==intent||existing?.submittedBy?.uid!==actor.uid)fail(409,'operation-changed','This submission changed. Refresh its status before trying again.');return summary(existing);}
   if(existing){if(existing.intent!==intent||existing.submittedBy?.uid!==actor.uid||existing.submittedBy.staffId!==body.staffId)fail(409,'proposal-exists','This proposal number already belongs to a different submission.');tx.set(opPath,{uid:actor.uid,staffId:body.staffId,intent,proposalId:body.proposal.id,createdAt:new Date(instant()).toISOString()});return summary(existing);}
   const ms=instant();
   const api={db:{},doc:(_db,...parts)=>parts.join('/'),getDocFromServer:async reference=>{const value=await tx.get(reference);return {exists:()=>value!==null,data:()=>value,metadata:{fromCache:false,hasPendingWrites:false}};},isBranchAllowed:branch=>branch===binding.branch};
   let view;try{view=await loadScheduleMonthView(api,{month:body.proposal.month,branch:binding.branch,now:new Date(ms)});}catch{fail(409,'schedule-unavailable','The saved branch schedule could not be confirmed. Refresh Branch Schedule before proposing changes.');}
   const ids=new Set([body.staffId]);
   for(const employee of view.editorSnapshot?.employees||[])if(id(employee.staffId)&&employee.branch===binding.branch)ids.add(employee.staffId);
   for(const day of body.proposal.days||[]){for(const row of day.scheduled||[])if(row?.staffId!==null)ids.add(row?.staffId);for(const name of ['standbyStaffIds','offStaffIds'])for(const staffId of day[name]||[])ids.add(staffId);}
   if(ids.size>120||[...ids].some(value=>!id(value)))fail(400,'invalid-roster','Choose active branch staff from the saved directory.');
   const people=await Promise.all([...ids].map(async staffId=>{const person=staffId===body.staffId?profile:await tx.get('cashiers/'+staffId);return person?profileRow(person,staffId):{staffId,active:false};}));
   let proposal,context;try{proposal=normalizeScheduleProposal(body.proposal,{monthView:view,staff:people,today:today(ms)});context=scheduleProposalContext({monthView:view,staff:people,branch:proposal.branch,from:proposal.from,to:proposal.to,today:today(ms)});}catch(error){fail(409,'schedule-changed',error.message||'The saved schedule changed. Refresh before submitting.');}
   const submittedBy={staffId:body.staffId,staffName:profile.cashierName.trim(),uid:actor.uid,deviceId:binding.deviceId,deviceName:String(binding.deviceName||fleet.deviceName||'Branch tablet').slice(0,120),branch:binding.branch};
   const staffSnapshot=context.staff.map(person=>({staffId:person.staffId,name:person.name.slice(0,160),scheduleName:person.scheduleName.slice(0,160),branch:person.branch}));
   const shiftSnapshot=context.days.map(day=>({date:day.date,shifts:day.shifts.map(shift=>({id:shift.shiftId,name:shift.name.slice(0,120),startTime:shift.startTime,endTime:shift.endTime}))}));
   const row={schemaVersion:1,proposal,intent,status:'Pending',submittedBy,staffSnapshot,shiftSnapshot,submittedAt:new Date(ms).toISOString(),reviewedAt:null,reviewedByUid:null,reviewedByEmail:null,reviewNote:'',revisionId:null};
   tx.set(path,row);tx.set(opPath,{uid:actor.uid,staffId:body.staffId,intent,proposalId:proposal.id,createdAt:row.submittedAt});return summary(row);
  });
 }
 return async request=>{const origin=request.origin;try{
  if(!origins.has(origin))return response(403,{code:'origin-denied',message:'Open schedule proposals in the approved Cashier app.'},origin);
  if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!['authorization','content-type'].includes(x)))return response(403,{code:'preflight-denied'},origin);const result=response(204,null,origin);Object.assign(result.headers,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Max-Age':'600'});return result;}
  if(request.method!=='POST'||request.path!=='/submit'||Object.keys(request.query||{}).length)fail(404,'route-unavailable','This schedule action is unavailable.');
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.contentType||'')||!object(request.body))fail(400,'invalid-request','Send a valid schedule proposal.');
  if((request.rawSize||0)>MAX_REQUEST_BYTES||Buffer.byteLength(JSON.stringify(request.body))>MAX_REQUEST_BYTES)fail(413,'proposal-too-large','Choose a shorter date range.');
  const body=request.body;if(Object.keys(body).sort().join(',')!=='operationId,pin,proposal,staffId'||!id(body.staffId)||!id(body.operationId)||typeof body.pin!=='string'||body.pin.length<1||body.pin.length>100||!object(body.proposal)||!id(body.proposal.id)||!Array.isArray(body.proposal.days)||body.proposal.days.length>31||body.proposal.days.some(day=>!object(day)||!Array.isArray(day.scheduled)||day.scheduled.length>120||!Array.isArray(day.standbyStaffIds)||day.standbyStaffIds.length>120||!Array.isArray(day.offStaffIds)||day.offStaffIds.length>120))fail(400,'invalid-request','Check the staff account and schedule details.');
  if(typeof request.authorization!=='string'||!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(request.authorization))fail(401,'authentication-required','Reconnect this approved branch tablet before submitting a schedule.');
  let actor;try{actor=await verifyToken(request.authorization.slice(7),true);}catch{fail(401,'authentication-required','Sign in again on this approved branch tablet.');}
  if(!id(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous')fail(403,'pos-auth-required','Submit schedules from an approved branch Cashier tablet.');
  await attempts(actor,request.trustedIP);const result=await submit(body,actor);return response(200,result,origin);
 }catch(error){return response(error instanceof ProposalError?error.status:503,{code:error instanceof ProposalError?error.code:'service-unavailable',message:error instanceof ProposalError?error.message:'HQ has not confirmed this proposal. Keep your draft and retry the same submission.'},origin);}};
}
