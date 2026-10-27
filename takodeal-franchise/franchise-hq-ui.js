import {canVisit,dateText,calendarDay,money,ms} from './franchise-data.js';
import {summarizeFranchiseLedger,conversationAudience,conversationVisible} from './franchise-hq-model.js';
import {createFranchiseConversations} from './franchise-hq-actions.js';

const copy=value=>structuredClone(value);
const stamp=value=>JSON.stringify(value);
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const amount=value=>value===null?'Needs review':money(value);
function rowFingerprint(row){
 try{
  const seen=new Set(),normal=value=>{
   if(value===undefined)return ['undefined'];
   if(value===null)return ['null'];
   if(['string','number','boolean'].includes(typeof value))return [typeof value,typeof value==='number'?String(value):value];
   if(value instanceof Date)return ['date',normal(+value)];
   if(typeof value!=='object'||seen.has(value))throw Error('Uncomparable row');
   seen.add(value);const result=Array.isArray(value)?['array',value.map(normal)]:['object',Object.keys(value).sort().map(key=>[key,normal(value[key])])];seen.delete(value);return result;
  };
  return JSON.stringify(normal(row));
 }catch{return null;}
}

// Fingerprints suppress equivalent listener notifications, never substitute for a server read.
export function createFranchiseHQSnapshotTracker(seed=null){
 const removed=Symbol('removed'),latest=new Map(),parts=new Map();let unseeded=seed===null;
 const versions=rows=>new Map(rows.map(row=>[row.id,rowFingerprint(row)]));
 if(seed)for(const [id,version]of versions(seed))latest.set(id,version);
 return{
  seed(key,rows){parts.set(key,versions(rows));},
  changed(key,rows){
   const previous=parts.get(key)||new Map(),current=versions(rows);parts.set(key,current);
   let changed=unseeded;unseeded=false;
   if(current.size!==rows.length)changed=true;
   for(const id of new Set([...previous.keys(),...current.keys()])){
    const version=current.has(id)?current.get(id):removed;
    if(version===null){changed=true;latest.set(id,version);continue;}
    if(previous.has(id)&&previous.get(id)===version||!previous.has(id)&&version===removed)continue;
    if(!latest.has(id)||latest.get(id)!==version){changed=true;latest.set(id,version);}
   }
   return changed;
  }
 };
}
export function franchiseStatementCSV(rows){const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[['Date & time','Category','Description','Charge','Payment / credit','Balance'],...rows.map(row=>[dateText(row.timestamp),row.category||row.type,row.description,row.charge===null?'Needs review':row.charge,row.payment===null?'Needs review':row.payment,row.balance===null?'Needs review':row.balance])].map(row=>row.map(cell).join(',')).join('\r\n');}

// Drafts stay local to one signed-in account and selected branch. A refresh never
// empties text that was entered after an earlier send began.
export function createFranchiseHQDrafts(){
 const drafts=new Map(),attempts=new Map();
 return {
  get(key){return copy(drafts.get(key)||{});},set(key,value){drafts.set(key,copy(value));},
  clearIf(key,value){if(stamp(drafts.get(key))===stamp(value))drafts.delete(key);},
  has(prefix){return [...drafts].some(([key,value])=>key.startsWith(prefix+'|')&&Object.entries(value).some(([field,text])=>field!=='type'&&typeof text==='string'&&text.trim()));},
  attempt(key,value){const signature=stamp(value),old=attempts.get(key);if(old?.signature===signature)return old.id;const id=uid('franchise-message');attempts.set(key,{signature,id});return id;},
  clear(prefix){for(const key of [...drafts.keys()])if(!prefix||key.startsWith(prefix+'|'))drafts.delete(key);for(const key of [...attempts.keys()])if(!prefix||key.startsWith(prefix+'|'))attempts.delete(key);}
 };
}

export function createFranchiseHQLifecycle({getScope,getRoute,visible,dirty,refresh,subscribe,status}){
 let key='',stopWatch=null,flight=null,follow=false;
 const active=()=>{try{return visible()&&['hq-billing','hq-conversations'].includes(getRoute())&&Boolean(getScope());}catch{return false;}};
 const same=(actor,route)=>{try{return actor===getScope()&&route===getRoute();}catch{return false;}};
 const stop=()=>{stopWatch?.();stopWatch=null;key='';follow=false;};
 async function reload(manual=false){
  if(!active())return false;
  if(!manual&&dirty()){status('New HQ updates are available. Your draft is kept. Choose Refresh messages when ready.');return false;}
  const actor=getScope(),route=getRoute(),requestKey=actor+'|'+route;
  if(flight?.key===requestKey){if(!manual)follow=true;return flight.promise;}
  const entry={key:requestKey};flight=entry;
  entry.promise=Promise.resolve().then(()=>refresh(route)).catch(error=>{if(same(actor,route))status(error.message||'HQ records could not refresh.',true);return false;}).finally(()=>{if(flight!==entry)return;flight=null;if(follow){follow=false;if(same(actor,route)&&active())void reload();}});return entry.promise;
 }
 function start(){if(!active())return stop();const next=getScope()+'|'+getRoute();if(next===key)return;stop();key=next;stopWatch=subscribe(getRoute(),event=>{if(next!==key||!active())return;if(event?.error){status('Live updates could not connect. Use Refresh messages to retry.',true);return;}void reload();})||(()=>{});}
 return {start,stop,reload};
}

export function installFranchiseHQUI(api,{document:d,session,getRoute,read,refresh,onError}={}){
 const drafts=createFranchiseHQDrafts(),selected=new Map(),billFilters=new Map(),reads=new Map(),writes=new Map();let nodes=null,detailGeneration=0,lastRead=null;
 const actor=()=>{const s=session(),user=api.auth?.currentUser;if(!user?.uid||user.uid!==s.uid||String(user.email||'').trim().toLowerCase()!==String(s.email||'').trim().toLowerCase())throw Error('Your signed-in account changed. Sign in again before loading HQ records.');return stamp([user.uid,s.email,s.branch,s.allowedBranches,s.permissions]);};
 const draftScope=()=>{const s=api.sessionUser||{};return stamp([api.auth?.currentUser?.uid,s.email,s.branch]);};
 const assertAccess=(s,_operation,branch)=>Boolean(s&&s.branch===branch&&canVisit(s,'hq-conversations'));
 const conversations=createFranchiseConversations(api,{getSession:()=>api.sessionUser,assertAccess,hq:false});
 const el=(tag,cls='',text)=>{const node=d.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const option=(text,value)=>{const node=el('option','',text);node.value=value;return node;};
 const button=(text,fn,primary=false)=>{const node=el('button',primary?'primary-button':'secondary-button',text);node.type='button';node.addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>{notice(error.message,true);onError?.(error);}));return node;};
 const label=(text,input)=>{const node=el('label','',text);node.append(input);return node;};
 function notice(text,error=false){if(!nodes?.notice?.isConnected)return;nodes.notice.textContent=text;nodes.notice.classList.toggle('is-error',error);nodes.notice.setAttribute('role',error?'alert':'status');}
 function physical(key,fn){const identity=actor(),scoped=identity+'|'+key,old=reads.get(scoped);if(old)return old.timedOut?Promise.reject(Error('The previous HQ read is still pending. Retry after the connection recovers.')):old.deadline;const entry={timedOut:false,promise:Promise.resolve().then(()=>{if(identity!==actor())throw Error('Your account or branch changed. Reload this page.');return fn();})};reads.set(scoped,entry);let timer;const clear=()=>{if(reads.get(scoped)===entry)reads.delete(scoped);};entry.promise.then(clear,clear);entry.deadline=Promise.race([entry.promise,new Promise((_,reject)=>{timer=setTimeout(()=>{entry.timedOut=true;reject(Error('HQ records could not be confirmed yet. Your draft is kept. Retry when connected.'));},20000);})]).finally(()=>clearTimeout(timer));return entry.deadline;}
 const lifecycle=createFranchiseHQLifecycle({getScope:actor,getRoute,visible:()=>canVisit(api.sessionUser,getRoute())&&!d.hidden&&Boolean(d.getElementById('view-'+getRoute())?.classList.contains('active')),dirty:()=>getRoute()==='hq-conversations'&&(drafts.has(draftScope())||writes.size>0),refresh,subscribe:(route,change)=>{
  if(typeof api.onSnapshot!=='function')return ()=>{};const branch=session().branch,identity=actor(),baseline=lastRead?.identity===identity&&lastRead.route===route?lastRead.rows:null,tracker=createFranchiseHQSnapshotTracker(baseline);
  const clauses=route==='hq-billing'?[['franchise_ledger','branch',branch]]:[['franchise_comms','branch',branch],['franchise_comms','targetBranch',branch],['franchise_comms','audience','network']];
  const visible=row=>route==='hq-billing'?row.branch===branch:conversationVisible(session(),row,{hq:false,branch});
  const stops=clauses.map(([table,key,value],index)=>{
   if(baseline)tracker.seed(index,baseline.filter(row=>row[key]===value));
   return api.onSnapshot(api.query(api.collection(api.db,table),api.where(key,'==',value)),{includeMetadataChanges:true},snap=>{
    if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)return;
    try{if(identity!==actor())return;const rows=snap.docs.map(doc=>({...doc.data(),id:doc.id})).filter(visible);if(tracker.changed(index,rows))change({});}catch(error){change({error});}
   },error=>change({error}));
  });return ()=>stops.forEach(stop=>stop());
 },status:notice});

 async function loadBilling(root){
  const identity=actor(),branch=session().branch,snap=await physical('ledger',()=>api.getDocsFromServer(api.query(api.collection(api.db,'franchise_ledger'),api.where('branch','==',branch))));if(identity!==actor())throw Error('Your account or branch changed. Reload HQ billing.');const raw=snap.docs.map(row=>({...row.data(),id:row.id})).filter(row=>row.branch===branch);
  lastRead={identity,route:'hq-billing',rows:raw};
  const summary=summarizeFranchiseLedger(raw),hero=el('div','hero');const heading=el('div');heading.append(el('div','eyebrow','BALANCE WITH HQ'),el('h2','',amount(summary.balance)),el('p','',branch+' · All saved charges and payments'));hero.append(heading);root.append(hero);
  const card=el('section','card franchise-hq-statement'),head=el('div','card-head'),title=el('div');title.append(el('h2','','HQ billing statement'),el('p','','Choose dates to review a statement. The balance above includes all saved records.'));head.append(title,button('Print statement',()=>api.print?.()),button('Export CSV',()=>{const url=URL.createObjectURL(new Blob([franchiseStatementCSV(filtered)],{type:'text/csv;charset=utf-8'})),link=el('a');link.href=url;link.download='takodeal-hq-statement-'+branch+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));card.append(head);root.append(card);
  const filters=billFilters.get(draftScope())||{from:'',to:'',search:''},tools=el('div','tools'),from=el('input'),to=el('input'),search=el('input');from.type=to.type='date';from.value=filters.from;to.value=filters.to;search.type='search';search.placeholder='Category or description';search.value=filters.search;tools.append(label('From date',from),label('To date',to),label('Search',search));card.append(tools);
  const status=el('p','notice'),totals=el('div','franchise-hq-summary'),rowsRoot=el('div','franchise-hq-ledger');status.setAttribute('role','status');card.append(status,totals,rowsRoot);nodes={notice:status,identity,scope:draftScope()};
  let filtered=[];
  function draw(){
   const value={from:from.value,to:to.value,search:search.value};billFilters.set(draftScope(),value);rowsRoot.replaceChildren();totals.replaceChildren();if(value.from&&value.to&&value.from>value.to){status.textContent='Choose an end date on or after the start date.';return;}
   const validDate=row=>ms(row.timestamp)>0?calendarDay(row.timestamp):'',period=summary.rows.filter(row=>(!value.from||validDate(row)>=value.from)&&(!value.to||validDate(row)&&validDate(row)<=value.to));
   filtered=period.filter(row=>(String(row.category||row.type||'')+' '+String(row.description||'')).toLowerCase().includes(value.search.toLowerCase()));
   const prior=value.from?summary.rows.filter(row=>validDate(row)&&validDate(row)<value.from).at(-1):null,undated=Boolean((value.from||value.to)&&summary.rows.some(row=>!validDate(row))),opening=undated?null:prior?prior.balance:0,closing=undated?null:period.length?period.at(-1).balance:opening;
   for(const [name,total]of [['Opening balance',opening],['Closing balance',closing],['Records shown',filtered.length]]){const stat=el('div');stat.append(el('small','',name),el('strong','',name==='Records shown'?String(total):amount(total)));totals.append(stat);}
   const periodText=value.from||value.to?(value.from||'Beginning')+' to '+(value.to||'Latest')+' · PH dates':'All saved dates';
   status.textContent=periodText+' · '+(summary.invalidCount?'Some saved ledger entries need HQ review. A confirmed balance is withheld.':undated?'Some saved dates are unavailable. Period balances need HQ review.':filtered.length+' record(s) shown');
   if(!filtered.length)rowsRoot.append(el('p','empty','No ledger entries match these filters.'));
   for(const row of [...filtered].reverse()){const item=el('article','franchise-hq-ledger-row'),copy=el('div');copy.append(el('small','',dateText(row.timestamp)),el('strong','',row.category||row.type||'Ledger entry'),el('p','',row.description||''));const values=el('dl');for(const [name,value]of [['Charge',row.charge],['Payment / credit',row.payment],['Balance',row.balance]]){const group=el('div');group.append(el('dt','',name),el('dd','',amount(value)));values.append(group);}item.append(copy,values);if(row.invalid)item.append(el('p','franchise-hq-error','This entry needs HQ review.'));rowsRoot.append(item);}
  }
  for(const input of [from,to,search])input.addEventListener('input',draw);draw();
 }

 async function loadConversations(root){
  const identity=actor(),scope=draftScope(),branch=session().branch,rows=(await physical('threads',()=>conversations.list(branch))).sort((a,b)=>ms(b.lastActivity||b.timestamp)-ms(a.lastActivity||a.timestamp));if(identity!==actor())throw Error('Your account or branch changed. Reload HQ conversations.');
  lastRead={identity,route:'hq-conversations',rows};
  const top=el('div','card-head'),title=el('div');title.append(el('h2','','HQ conversations'),el('p','',branch+' · Questions, branch updates and HQ discussions'));top.append(title);root.append(top);
  const status=el('p','notice');status.setAttribute('role','status');const refreshButton=button('Refresh messages',()=>lifecycle.reload(true));top.append(refreshButton);root.append(status);
  const layout=el('div','franchise-hq-chat'),list=el('aside','card franchise-hq-thread-list'),main=el('section','card franchise-hq-thread-detail');layout.append(list,main);root.append(layout);nodes={notice:status,list,main,scope,identity};
  const compose=el('details','card franchise-hq-compose'),summary=el('summary','','Start a conversation');compose.append(summary);const form=el('form','card-body'),draftKey=scope+'|new',draft=drafts.get(draftKey),type=el('select'),subject=el('input'),message=el('textarea');type.append(option('Help / support','Help'),option('Discussion','Discussion'));type.value=draft.type||'Help';subject.value=draft.title||'';subject.maxLength=160;message.value=draft.message||'';message.maxLength=4000;subject.required=message.required=true;form.append(label('Topic',type),label('Title',subject),label('Message',message));const send=button('Send to HQ',()=>post(),true);form.append(el('p','notice','Visible to HQ and your selected branch. Sending a conversation does not record a payment.'),send);compose.append(form);root.insertBefore(compose,layout);compose.open=Boolean(draft.title||draft.message);
  const currentDraft=()=>({type:type.value,title:subject.value,message:message.value});for(const input of [type,subject,message])input.addEventListener('input',()=>drafts.set(draftKey,currentDraft()));
  form.addEventListener('submit',event=>{event.preventDefault();void post();});
  async function post(){if(writes.has(draftKey))return writes.get(draftKey);const sent=currentDraft();if(!sent.title.trim()||!sent.message.trim()){notice('Enter a title and message before sending.',true);(!sent.title.trim()?subject:message).focus();return false;}drafts.set(draftKey,sent);const id=drafts.attempt(draftKey,sent);send.disabled=true;const operation=(async()=>{try{await conversations.create({id,branch,type:sent.type,title:sent.title,message:sent.message,audience:'branch'});drafts.clearIf(draftKey,sent);if(identity===actor()){selected.set(scope,id);await refresh('hq-conversations');}return true;}catch(error){notice(error.message,true);return false;}finally{writes.delete(draftKey);send.disabled=false;}})();writes.set(draftKey,operation);return operation;}
  if(!rows.length)list.append(el('p','empty','No conversations for this branch yet. Start one above to contact HQ.'));
  for(const row of rows){const item=button('',()=>openThread(row.id)),audience=conversationAudience(row);item.className='franchise-hq-thread';item.append(el('strong','',row.title||'Untitled conversation'),el('small','',(audience.kind==='network'?'HQ network update':branch)+' · '+dateText(row.lastActivity||row.timestamp)),el('p','',String(row.message||'').slice(0,110)));item.dataset.threadId=row.id;list.append(item);}
  const active=selected.get(scope);if(active&&rows.some(row=>row.id===active))await openThread(active);else main.append(el('p','empty','Choose a conversation to read messages and replies.'));
  async function openThread(id){
   const token=++detailGeneration;selected.set(scope,id);main.replaceChildren(el('p','loading','Loading conversation…'));
   try{const row=await physical('thread/'+id,()=>conversations.get(id,branch));if(token!==detailGeneration||identity!==actor()||nodes?.scope!==scope)return;main.replaceChildren();for(const item of list.children)item.classList.toggle('active',item.dataset.threadId===id);
    const head=el('div','card-head');head.append(el('h3','',row.title||'Conversation'));main.append(head);const messages=el('div','franchise-hq-messages');main.append(messages);
    const show=entry=>{const bubble=el('article','franchise-hq-message');bubble.append(el('strong','',entry.author||'HQ / branch team'),el('small','',dateText(entry.timestamp)),el('p','',entry.message||''));messages.append(bubble);};show(row);for(const reply of Array.isArray(row.replies)?row.replies:[])show(reply);
    const audience=conversationAudience(row);if(audience.legacy||audience.kind==='unknown'){main.append(el('p','notice','This older conversation is read-only until HQ confirms its audience. Start a new branch conversation to continue.'));return;}
    const key=scope+'|reply/'+id,input=el('textarea'),saved=drafts.get(key);input.value=saved.message||'';input.maxLength=2000;input.setAttribute('aria-label','Reply to HQ conversation');input.placeholder='Write a reply…';input.addEventListener('input',()=>drafts.set(key,{message:input.value}));const replyBox=el('div','franchise-hq-reply'),reply=button('Send reply',()=>sendReply(),true);replyBox.append(input,reply);main.append(replyBox);
    async function sendReply(){if(writes.has(key))return writes.get(key);const sent={message:input.value};if(!sent.message.trim()){notice('Enter a reply before sending.',true);input.focus();return false;}drafts.set(key,sent);const replyId=drafts.attempt(key,sent);reply.disabled=true;const operation=(async()=>{try{await conversations.reply({id,branch,message:sent.message,replyId});drafts.clearIf(key,sent);if(identity===actor()&&nodes?.scope===scope)await openThread(id);return true;}catch(error){notice(error.message,true);return false;}finally{writes.delete(key);reply.disabled=false;}})();writes.set(key,operation);return operation;}
   }catch(error){if(token===detailGeneration&&identity===actor()){main.replaceChildren(el('p','franchise-hq-error',error.message),button('Retry conversation',()=>openThread(id)));}}
  }
 }
 const w=api;let resumeFlight=null;
 const resume=()=>{if(d.hidden){lifecycle.stop();return;}if(!['hq-billing','hq-conversations'].includes(getRoute())||!api.sessionUser)return;if(resumeFlight)return resumeFlight;resumeFlight=Promise.resolve().then(async()=>{if(api.enableNetwork)await api.enableNetwork(api.db);lifecycle.start();await lifecycle.reload();}).catch(error=>notice(error.message,true)).finally(()=>resumeFlight=null);return resumeFlight;};
 d.addEventListener('visibilitychange',()=>void resume());for(const event of ['pageshow','online'])w.addEventListener?.(event,()=>void resume());w.addEventListener?.('pagehide',lifecycle.stop);
 return {loadBilling,loadConversations,start:lifecycle.start,stop:lifecycle.stop,hasDraft:()=>Boolean(api.sessionUser&&drafts.has(draftScope())),isPending:()=>writes.size>0,clearDrafts:()=>drafts.clear(),reload:lifecycle.reload};
}
