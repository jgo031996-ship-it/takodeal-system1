import {canVisit} from './franchise-data.js';

export const FRANCHISE_BOARD_ENDPOINT='https://takodeal-owner.vercel.app/api/franchise-ai-board';
export const FRANCHISE_BOARD_DIRECTORS=Object.freeze([
 {id:'finance',title:'Finance',remit:'Sales and recorded spending'},
 {id:'audit',title:'Audit',remit:'Reconciliation and evidence gaps'},
 {id:'inventory',title:'Inventory',remit:'Stock and count accuracy'},
 {id:'hr',title:'HR',remit:'Staffing and attendance signals'},
 {id:'operations',title:'Operations',remit:'Daily branch controls'},
 {id:'marketing',title:'Marketing',remit:'Channels and customer demand'},
 {id:'mentor',title:'Mentor',remit:'Decisions and next steps'}
]);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clean=value=>typeof value==='string'?value.trim():'';
const fingerprint=value=>JSON.stringify(value);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const list=items=>Array.isArray(items)?items.filter(value=>typeof value==='string'&&value.trim()):[];
function scopeIdentity(api,getContext){
 const user=api.auth?.currentUser,session=api.sessionUser,context=getContext();
 if(!user?.uid||user.emailVerified!==true||!clean(user.email)||session?.uid!==user.uid||clean(session.email).toLowerCase()!==clean(user.email).toLowerCase()||!canVisit(session,'ai-board'))throw Error('Sign in with an approved Franchise account and select an assigned branch to open the Board.');
 const {branch,from,to}=context;
 if(branch!==session.branch||!session.allowedBranches?.includes(branch)||!clean(branch)||/^all$/i.test(branch))throw Error('Choose one of your assigned branches for the Board.');
 if(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>30)throw Error('Choose a valid period of up to 31 Philippine business days.');
 return {user,session,branch,from,to,key:fingerprint([user.uid,user.email,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,branch,from,to])};
}
export function createFranchiseBoardClient(api,{getContext,endpoint=FRANCHISE_BOARD_ENDPOINT,timeoutMs={snapshot:20000,briefing:60000}}={}){
 const pending=new Map(),listeners=new Set();
 const changed=()=>{for(const notify of listeners)notify();};
 function request(mode='snapshot'){
  if(!['snapshot','briefing'].includes(mode))return Promise.reject(Error('Choose a snapshot or one Board briefing.'));
  let scope;try{scope=scopeIdentity(api,getContext);}catch(error){return Promise.reject(error);}
  const key=scope.key+'/'+mode,existing=pending.get(key);if(existing)return existing.result;
  if(mode==='briefing'&&[...pending.values()].some(entry=>entry.mode==='briefing'&&entry.uid===scope.user.uid))return Promise.reject(Error('Your previous briefing is still being checked. Wait for it before requesting another.'));
  const guard=()=>{const current=scopeIdentity(api,getContext);if(current.user!==scope.user||current.session!==scope.session||current.key!==scope.key)throw Error('The account, branch, dates or Board access changed. Refresh the selected branch.');};
  const entry={mode,uid:scope.user.uid};pending.set(key,entry);
  const physical=Promise.resolve().then(async()=>{
   guard();const token=await scope.user.getIdToken();guard();
   const response=await api.fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({branch:scope.branch,from:scope.from,to:scope.to,mode}),cache:'no-store',credentials:'omit'});
   let payload;try{payload=await response.json();}catch{const error=Error('The Board response could not be read. Reconnect and refresh the snapshot.');error.status=response.status;throw error;}guard();
   if(!response.ok){const error=Error(clean(payload?.error?.message||payload?.error)||'The Board could not load this branch. Reconnect and try again.');error.status=response.status;error.code=clean(payload?.error?.code);throw error;}
   if(payload.mode!==mode||payload.advisoryOnly!==true||payload.packet?.branch!==scope.branch||payload.packet?.period?.start!==scope.from||payload.packet?.period?.end!==scope.to||!payload.board||!Array.isArray(payload.board.directors)||!Array.isArray(payload.packet.evidence))throw Error('The Board response does not match this branch and period. Refresh before reviewing it.');
   return payload;
  });
  let timer;
  entry.result=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The Board is taking longer than expected. This request may still finish; wait before requesting another briefing.')),Math.max(1,Number(timeoutMs[mode])||20000));})]).finally(()=>clearTimeout(timer));
  const settle=()=>{if(pending.get(key)===entry)pending.delete(key);changed();};void physical.then(settle,settle);changed();return entry.result;
 }
 return {request,busy:()=>pending.size>0,subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);}};
}
export function renderFranchiseBoardReport(payload){
 const {packet,board}=payload,partial=packet.partial===true,priorities=list(board.priorities),asOf=new Date(packet.asOf),updated=Number.isFinite(+asOf)?asOf.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'Time not available';
 const generated=new Date(payload.generatedAt),generatedText=Number.isFinite(+generated)?generated.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'Generation time unavailable';
 const timestamps='<small>Data as of '+esc(updated)+' · Philippine time</small>'+(payload.mode==='briefing'?'<small>'+(payload.cache?.briefing?'Reused briefing':'Briefing')+' · generated '+esc(generatedText)+' · Philippine time</small>':'');
 const metric=entry=>typeof entry.value==='number'&&Number.isFinite(entry.value)?new Intl.NumberFormat('en-PH',entry.unit==='PHP'?{style:'currency',currency:'PHP',maximumFractionDigits:0}:{maximumFractionDigits:2}).format(entry.value):'Unavailable';
 const metrics=packet.evidence.slice(0,6);
 return '<div class="franchise-board-report"><div class="franchise-board-report-heading"><span class="franchise-board-label">'+(payload.mode==='briefing'?'AI briefing':'Recorded snapshot')+'</span>'+timestamps+'</div><p class="franchise-board-summary">'+esc(board.summary||'No reliable branch summary is available for this period.')+'</p>'+(partial?'<p class="franchise-board-warning" role="status">Some sources are unavailable or incomplete. Review the coverage below; sample figures are not complete totals.</p>':'')+'<div class="franchise-board-metrics">'+metrics.map(entry=>'<article><span>'+esc(entry.label)+'</span><strong>'+esc(metric(entry))+'</strong><small>'+esc(entry.complete===false?'Partial evidence':entry.note||entry.source||'Recorded evidence')+'</small></article>').join('')+'</div><section class="franchise-board-priorities"><h3>Priorities for your review</h3><ol>'+(priorities.length?priorities.map(value=>'<li>'+esc(value)+'</li>').join(''):'<li>There is not enough confirmed evidence to rank priorities. Review source coverage first.</li>')+'</ol></section><div class="franchise-board-directors">'+FRANCHISE_BOARD_DIRECTORS.map((director,index)=>{
  const item=board.directors.find(row=>row.id===director.id),actions=list(item?.actions);
  return '<article class="franchise-board-director"><div class="franchise-board-card-top"><span>0'+(index+1)+'</span><h3>'+esc(director.title)+'</h3></div><p class="franchise-board-remit">'+esc(director.remit)+'</p><p>'+esc(item?.summary||'This perspective is unavailable with the current evidence and access.')+'</p>'+(actions.length?'<ul>'+actions.slice(0,3).map(action=>'<li>'+esc(action)+'</li>').join('')+'</ul>':'')+'</article>';
 }).join('')+'</div><details class="franchise-board-coverage"><summary>Source coverage and missing information</summary><div class="franchise-board-coverage-grid">'+(Array.isArray(packet.coverage)?packet.coverage:[]).map(row=>'<p><strong>'+esc(row.source)+'</strong><br>'+esc(row.error||((row.records??'—')+' records · '+(row.complete?'within source limit':'incomplete or capped')))+'<br><small>'+esc(row.basis||'')+'</small></p>').join('')+'</div><ul>'+[...new Set([...list(packet.limitations),...list(board.limitations)])].map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul><p>'+esc(packet.dateBasis||'Philippine business days start at 08:30. Only records available to this account are included.')+'</p></details><p class="franchise-board-footnote">Advisory only. Review the evidence before deciding. The Board does not change sales, stock, payroll or other business records.'+(payload.model?' · '+esc(payload.model):'')+'</p></div>';
}
export function installFranchiseAIBoard(api,{document:d=globalThis.document,getRoute,getContext,endpoint,timeoutMs}={}){
 const client=createFranchiseBoardClient(api,{getContext,endpoint,timeoutMs});let generation=0,root=null,unsubscribe;
 const invalidate=()=>{generation++;unsubscribe?.();unsubscribe=null;if(root)root.innerHTML='';root=null;};
 function mount(host){
  invalidate();root=host;const version=generation,context=getContext(),user=api.auth?.currentUser,session=api.sessionUser,scope=fingerprint([context,session?.permissions,session?.allowedBranches]);
  const current=()=>{const valid=root===host&&version===generation&&getRoute()==='ai-board'&&api.auth?.currentUser===user&&api.sessionUser===session&&canVisit(session,'ai-board')&&scope===fingerprint([getContext(),session?.permissions,session?.allowedBranches]);if(!valid&&root===host&&version===generation)host.innerHTML='';return valid;};
  host.className='franchise-board';host.innerHTML='<header class="franchise-board-intro"><div><span class="franchise-board-label">YOUR BRANCH ADVISORY BOARD</span><h2>Seven perspectives.<br>A clearer next step.</h2><p>Finance, stock, people and daily operations in one short branch review.</p></div><span class="franchise-board-readonly">Read only</span></header><section class="franchise-board-controls" aria-label="Board scope and actions"><div><strong data-board-scope>'+esc(context.branch)+' · '+esc(context.from)+' to '+esc(context.to)+'</strong><p>Philippine business days · 08:30 to 08:30 next day · up to 31 days</p></div><div class="franchise-board-actions"><button type="button" data-board-refresh>Refresh snapshot</button><button type="button" class="primary-button" data-board-generate disabled>Generate briefing</button></div><p class="franchise-board-help">The snapshot uses recorded branch evidence without an AI call. Generate briefing asks all seven directors together in one request; nothing is generated automatically.</p><p data-board-status role="status" aria-live="polite">Loading the recorded branch snapshot…</p></section><div data-board-result aria-label="Branch board report"></div>';
  const status=host.querySelector('[data-board-status]'),result=host.querySelector('[data-board-result]'),refresh=host.querySelector('[data-board-refresh]'),generate=host.querySelector('[data-board-generate]');let available=false,working=false;
  const controls=()=>{if(!current())return;refresh.disabled=working||client.busy();generate.disabled=working||client.busy()||!available;};unsubscribe=client.subscribe(controls);
  async function load(mode){if(working||!current())return false;working=true;controls();status.textContent=mode==='briefing'?'Preparing one briefing with all seven directors…':'Loading the recorded branch snapshot…';
   try{const payload=await client.request(mode);if(!current())return false;available=payload.aiAvailable===true&&payload.packet.evidence.length>0;result.innerHTML=renderFranchiseBoardReport(payload);status.textContent=mode==='briefing'?'Briefing ready. Check its evidence and suggested next steps.':!payload.packet.evidence.length?'Snapshot ready. No permitted evidence is available for an AI briefing. Review source coverage.':available?'Snapshot ready. Generate a briefing when you want a second perspective.':'Snapshot ready. AI briefing is not available for this account right now.';return true;}
   catch(error){if(current()){if([401,403].includes(error.status)){result.innerHTML='';available=false;}status.textContent=error.message||'The Board could not load. Reconnect and refresh the snapshot.';}return false;}
   finally{working=false;controls();}
  }
  refresh.onclick=()=>load('snapshot');generate.onclick=()=>{if(generate.disabled)return false;return load('briefing');};void load('snapshot');return {load};
 }
 return {mount,invalidate,client};
}
