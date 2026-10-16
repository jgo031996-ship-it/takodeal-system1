import { fullWorkspaceAccess, configuredPermissions } from './workspace-access-model.js';
import { branchesOf, canUseHQBranch, fullHQScope, summarizeFranchiseLedger, conversationAudience, conversationVisible } from './franchise-hq-model.js';
import { createFranchiseLedgerEntry, createFranchiseConversations } from './franchise-hq-actions.js';

const text = value => String(value ?? '').trim();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number.isFinite(value) ? '₱' + value.toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}) : 'Needs review';
const millis = value => value?.toMillis ? value.toMillis() : value?.seconds != null ? value.seconds * 1000 : +new Date(value || 0) || 0;
const date = value => millis(value) ? new Date(millis(value)).toLocaleString('en-PH', {timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + ' PH' : 'Time not recorded';
const identity = session => JSON.stringify([session?.uid,session?.email,session?.permissions,session?.allowedBranches,session?.assignedBranch,session?.branch,session?.isFranchisee,session?.isOwner]);
const rows = snap => snap.docs.map(doc => ({...doc.data(),id:doc.id}));
const waitFor = (promise, timeout) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('The server is taking too long. This request may still be running. Try Refresh after your connection recovers.')),timeout);
    promise.then(value => {clearTimeout(timer);resolve(value);},error => {clearTimeout(timer);reject(error);});
});

export function canManageFranchiseHQ(session) {
    return !!session && !session.isFranchisee && (fullWorkspaceAccess(session) || configuredPermissions(session).includes('franchise-hub'));
}
export function canReadFranchiseHQ(session) {
    if(canManageFranchiseHQ(session))return true;
    const permissions=configuredPermissions(session),branches=branchesOf(session);
    return !!session?.isFranchisee && (permissions.includes('franchise-hub')||permissions.includes('all')) && branches.length>0 && !branches.some(branch=>branch.toLowerCase()==='all') && branches.includes(session.branch);
}
export function franchiseDirectory(records, session) {
    const permitted = records.filter(row => text(row.name) && canUseHQBranch(session,text(row.name),{hq:true}));
    return {
        branches:[...new Set(permitted.filter(row => row.isFranchise === true && row.isCore !== true && text(row.name) !== 'Main Office').map(row => text(row.name)))].sort((a,b) => a.localeCompare(b)),
        unclassified:permitted.filter(row => row.isCore !== true && row.isFranchise !== true && text(row.name) !== 'Main Office').map(row => text(row.name)),
        conflicts:permitted.filter(row => row.isCore === true && row.isFranchise === true).map(row => text(row.name))
    };
}

// A read can time out in the UI without freeing the underlying SDK request for another retry.
export function createFranchiseHQController(api, {getSession=()=>api.sessionUser,onChange=()=>{},timeoutMs=20000}={}) {
    const pending = new Map(); let ledgerEpoch=0,threadEpoch=0,detailEpoch=0,performanceEpoch=0,directoryKey='',viewKey='',stops=[];
    const state={directory:{status:'idle',branches:[],unclassified:[],conflicts:[]},ledger:{status:'unselected',branch:'',summary:null},chat:{status:'idle',branch:'',threads:[],active:null},performance:{status:'idle',rows:[]}};
    function authorized(session=getSession()) {
        const signed=api.auth?.currentUser;
        return canReadFranchiseHQ(session) && !!session.uid && !!session.email && !!signed && text(signed.email).toLowerCase()===text(session.email).toLowerCase() && signed.uid===session.uid;
    }
    function current(key) {return authorized() && identity(getSession())===key;}
    function syncSession() {
        const key=identity(getSession());if(viewKey===key)return key;
        viewKey=key;directoryKey='';stopChat();++ledgerEpoch;++performanceEpoch;
        state.directory={status:'idle',branches:[],unclassified:[],conflicts:[]};state.ledger={status:'unselected',branch:'',summary:null};state.chat={status:'idle',branch:'',threads:[],active:null};state.performance={status:'idle',rows:[]};
        return key;
    }
    function notify() {if(authorized()&&viewKey===identity(getSession()))onChange(state);}
    function server(key,read) {
        const accountKey=identity(getSession()),signedUid=api.auth?.currentUser?.uid,signedEmail=api.auth?.currentUser?.email;
        if(!pending.has(key)) {
            const promise=Promise.resolve().then(()=>{
                if(!current(accountKey)||api.auth?.currentUser?.uid!==signedUid||api.auth?.currentUser?.email!==signedEmail)throw Error('Your account changed before the server request started. Reload this page.');
                return read();
            });pending.set(key,promise);
            promise.then(()=>{if(pending.get(key)===promise)pending.delete(key);},()=>{if(pending.get(key)===promise)pending.delete(key);});
        }
        return waitFor(pending.get(key),timeoutMs);
    }
    function assertAccess(session,operation,branch) {
        if(!authorized(session))return false;
        if(session.isFranchisee && operation!=='read')return false;
        if(branch && (state.directory.status!=='ready' || !canUseHQBranch(session,branch,{hq:true}) || !state.directory.branches.includes(branch) || directoryKey!==identity(session)))return false;
        return operation!=='create' || !!branch || fullWorkspaceAccess(session);
    }
    const conversations=createFranchiseConversations(api,{getSession,assertAccess,hq:true});
    function query(table,branch='',field='branch',maximum=2001) {
        const terms=branch?[api.where(field,'==',branch)]:[];
        if(api.limit)terms.push(api.limit(maximum));
        return api.query(api.collection(api.db,table),...terms);
    }
    async function loadDirectory() {
        const key=syncSession();if(!authorized())throw Error('Unlock an approved HQ account to view franchise accounts.');
        state.directory={...state.directory,status:'loading',error:''};notify();
        try {
            const snap=await server('branches:'+key,async()=>{
                if(fullHQScope(getSession()))return api.getDocsFromServer(query('branches','','branch',501));
                const snapshots=await Promise.all(branchesOf(getSession()).map(branch=>api.getDocsFromServer(query('branches',branch,'name',501))));
                const unique=new Map();for(const snapshot of snapshots)for(const doc of snapshot.docs)unique.set(doc.id,doc);
                return {docs:[...unique.values()]};
            });
            if(!current(key))return null;
            const directory=franchiseDirectory(rows(snap),getSession());directoryKey=key;
            state.directory={...directory,status:snap.docs.length>500?'partial':'ready',error:snap.docs.length>500?'The branch list is incomplete. Ask HQ to review the branch directory.':''};
            if(state.ledger.branch && !directory.branches.includes(state.ledger.branch)) {++ledgerEpoch;state.ledger={status:'unselected',branch:'',summary:null};}
            notify();return state.directory;
        } catch(error) {if(current(key)){state.directory={...state.directory,status:'error',error:error.message};++ledgerEpoch;state.ledger={status:state.ledger.branch?'error':'unselected',branch:state.ledger.branch,summary:null,error:'The branch settings could not be verified. '+error.message};notify();}throw error;}
    }
    async function verifyBranch(branch) {
        const directory=await loadDirectory();
        if(!directory || directory.status!=='ready' || !directory.branches.includes(branch))throw Error('This branch is not confirmed as a franchise within your approved access.');
        return branch;
    }
    async function loadLedger(branch=state.ledger.branch) {
        const key=syncSession(),epoch=++ledgerEpoch;branch=text(branch);
        state.ledger={status:branch?'loading':'unselected',branch,summary:null};notify();
        if(!branch)return;
        try {
            if(directoryKey!==key || state.directory.status!=='ready')await loadDirectory();
            if(!current(key) || epoch!==ledgerEpoch)return;
            if(!assertAccess(getSession(),'read',branch))throw Error('Choose a confirmed franchise branch within your access.');
            const snap=await server('ledger:'+key+':'+branch,()=>api.getDocsFromServer(query('franchise_ledger',branch)));
            if(!current(key) || epoch!==ledgerEpoch)return;
            const found=rows(snap).filter(row=>row.branch===branch),partial=found.length>2000;
            const summary=summarizeFranchiseLedger(found.slice(0,2000));
            if(partial){summary.balance=null;summary.rows=summary.rows.map(row=>({...row,balance:null}));}
            state.ledger={status:partial?'partial':'ready',branch,summary,loadedAt:new Date()};notify();
        } catch(error){if(current(key)&&epoch===ledgerEpoch){state.ledger={status:'error',branch,summary:null,error:error.message};notify();}}
    }
    function applyThreads(found,branch,key,epoch,partial=false) {
        if(!current(key)||epoch!==threadEpoch)return;
        const threads=found.filter(row=>{
            const audience=conversationAudience(row);
            return (audience.kind!=='branch'||state.directory.branches.includes(audience.branch))&&conversationVisible(getSession(),row,{hq:true,branch});
        }).sort((a,b)=>millis(b.lastActivity||b.timestamp)-millis(a.lastActivity||a.timestamp)||text(a.id).localeCompare(text(b.id)));
        const active=state.chat.active && threads.find(row=>row.id===state.chat.active.id) || null;
        state.chat={status:partial?'partial':'ready',branch,threads,active};notify();
    }
    function stopChat() {stops.forEach(stop=>stop());stops=[];++threadEpoch;++detailEpoch;}
    async function loadThreads(branch=state.chat.branch,{live=true}={}) {
        const key=syncSession();stopChat();const epoch=threadEpoch;branch=text(branch);
        state.chat={status:'loading',branch,threads:[],active:null};notify();
        try {
            if(directoryKey!==key||state.directory.status!=='ready')await loadDirectory();
            if(!current(key)||epoch!==threadEpoch)return;
            if(!assertAccess(getSession(),'read',branch))throw Error('Choose a conversation recipient within your access.');
            const found=await server('threads:'+key+':'+branch,()=>conversations.list(branch));
            applyThreads(found,branch,key,epoch);
            if(!live || !api.onSnapshot || !current(key)||epoch!==threadEpoch)return;
            const targets=branch?[branch]:fullHQScope(getSession())?null:state.directory.branches;
            const refs=targets===null?[query('franchise_comms')]:[...new Set([...targets,'All','HQ Main Office','Main Office'])].map(target=>query('franchise_comms',target));
            const parts=new Map();
            for(const [index,ref] of refs.entries())stops.push(api.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
                if(snap.metadata?.fromCache || snap.metadata?.hasPendingWrites || !current(key)||epoch!==threadEpoch)return;
                parts.set(index,rows(snap));if(parts.size!==refs.length)return;
                const merged=new Map();for(const part of parts.values())for(const row of part)merged.set(row.id,row);
                ++detailEpoch;applyThreads([...merged.values()],branch,key,epoch,[...parts.values()].some(part=>part.length>2000));
            },error=>{if(current(key)&&epoch===threadEpoch){state.chat={...state.chat,status:'error',error:'Conversation updates stopped: '+error.message};notify();}}));
        } catch(error){if(current(key)&&epoch===threadEpoch){state.chat={...state.chat,status:'error',error:error.message};notify();}}
    }
    async function openThread(id) {
        const key=syncSession(),epoch=++detailEpoch,chatEpoch=threadEpoch,branch=state.chat.branch;
        const local=state.chat.threads.find(row=>row.id===id);if(!local)return;
        state.chat={...state.chat,active:local};notify();
        try {
            const row=await server('thread:'+key+':'+id+':'+branch,()=>conversations.get(id,branch));
            if(current(key)&&epoch===detailEpoch&&chatEpoch===threadEpoch){state.chat={...state.chat,active:row};notify();}
        } catch(error){if(current(key)&&epoch===detailEpoch&&chatEpoch===threadEpoch){state.chat={...state.chat,active:null,error:error.message};notify();}}
    }
    async function loadPerformance() {
        if(!canManageFranchiseHQ(getSession()))return false;
        const key=syncSession(),epoch=++performanceEpoch;state.performance={status:'loading',rows:[]};notify();
        try {
            const directory=await loadDirectory();if(!current(key)||epoch!==performanceEpoch)return;
            if(directory.status!=='ready')throw Error('A complete branch directory is needed to load performance.');
            if(!directory.branches.length){state.performance={status:'ready',rows:[]};notify();return;}
            const start=Date.now()-30*86400000;
            const summaries=await Promise.all(directory.branches.map(async branch=>{
                const read=async table=>rows(await server(table+':performance:'+key+':'+branch,()=>api.getDocsFromServer(query(table,branch))));
                const [shifts,ledger]=await Promise.all([read('shifts'),read('franchise_ledger')]);
                const partial=shifts.length>2000||ledger.length>2000;
                const branchShifts=shifts.filter(row=>row.branch===branch&&text(row.status).toLowerCase()==='closed'&&millis(row.endTime)>=start);
                const royalty=ledger.filter(row=>row.branch===branch&&row.category==='Daily Franchise Royalty'&&millis(row.timestamp)>=start);
                const sales=branchShifts.map(row=>[Number(row.totalCashSales),Number(row.totalDigitalSales)]);
                const salesValid=sales.every(pair=>pair.every(Number.isFinite))&&branchShifts.every(row=>[row.totalCashSales,row.totalDigitalSales].every(value=>['string','number'].includes(typeof value)&&text(value)!==''));
                const missingTime=shifts.some(row=>text(row.status).toLowerCase()==='closed'&&!millis(row.endTime))||ledger.some(row=>row.category==='Daily Franchise Royalty'&&!millis(row.timestamp));
                const royaltySummary=summarizeFranchiseLedger(royalty);
                return {branch,closedShifts:branchShifts.length,sales:partial||!salesValid||missingTime?null:sales.reduce((sum,pair)=>sum+pair[0]+pair[1],0),royalties:partial||missingTime||royaltySummary.invalidCount?null:royaltySummary.charges,review:!salesValid||royaltySummary.invalidCount>0||missingTime,partial};
            }));
            if(!current(key)||epoch!==performanceEpoch)return;
            state.performance={status:summaries.some(row=>row.partial)?'partial':'ready',rows:summaries};notify();
        } catch(error){if(current(key)&&epoch===performanceEpoch){state.performance={status:'error',rows:[],error:error.message};notify();}}
    }
    function canExportLedger() {return state.directory.status==='ready'&&state.ledger.status==='ready'&&state.ledger.summary?.balance!=null&&assertAccess(getSession(),'read',state.ledger.branch);}
    return {state,loadDirectory,verifyBranch,loadLedger,loadThreads,openThread,stopChat,loadPerformance,assertAccess,conversations,canExportLedger,
        recordEntry:input=>createFranchiseLedgerEntry(api,{...input,getSession,assertAccess}),
        stop(){stopChat();++ledgerEpoch;++performanceEpoch;}};
}

const styles=`
#view-franchise-hub .fhq-toolbar{display:flex;align-items:end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px}
#view-franchise-hub .fhq-actions{display:flex;flex-wrap:wrap;gap:8px}#view-franchise-hub .fhq-field{display:grid;gap:7px;font-size:12px;font-weight:650;color:#526b61;min-width:190px}
#view-franchise-hub .fhq-button{border:1px solid #cbdccf;border-radius:8px;background:#fff;color:#174c3c;padding:11px 15px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}#view-franchise-hub .fhq-primary{background:#17634f;color:#fff;border-color:#17634f}#view-franchise-hub .fhq-button:disabled{opacity:.48;cursor:not-allowed}
#view-franchise-hub select,#view-franchise-hub .fhq-input{max-width:100%;box-sizing:border-box;border:1px solid #cfddd2;border-radius:8px;background:#fff;color:#173f32;padding:11px;font:inherit}
#view-franchise-hub .fhq-summary{padding:22px;background:#edf4ec;border:1px solid #d6e5d5;border-radius:12px;margin-bottom:18px}#view-franchise-hub .fhq-summary strong{display:block;font-size:32px;margin:8px 0;color:#174c3c}
#view-franchise-hub .fhq-note{font-size:12px;color:#62796e;line-height:1.5;margin:8px 0}#view-franchise-hub .fhq-warning{color:#926020;background:#fff8e9;border-radius:8px;padding:12px}#view-franchise-hub .fhq-error{color:#a73535;background:#fff1f1;padding:12px;border-radius:8px}
#view-franchise-hub .fhq-ledger{display:grid;gap:10px}#view-franchise-hub .fhq-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(180px,2fr) minmax(95px,1fr) minmax(95px,1fr);gap:14px;align-items:start;padding:15px;border:1px solid #dde7dd;border-radius:10px;background:#fff;overflow-wrap:anywhere}
#view-franchise-hub .fhq-row p{margin:5px 0;font-size:12px;color:#64796d}#view-franchise-hub .fhq-row small{display:block;color:#64796d;font-size:11px;margin-bottom:5px}
#view-franchise-hub .fhq-chat-layout{display:grid;grid-template-columns:minmax(210px,300px) minmax(0,1fr);gap:20px}#view-franchise-hub .fhq-thread-list{display:grid;gap:8px;align-content:start;max-height:600px;overflow-y:auto}
#view-franchise-hub .fhq-thread{text-align:left;width:100%;white-space:normal;overflow-wrap:anywhere;background:#fff;border:1px solid #d9e4d9;border-radius:9px;padding:13px;color:#173f32;cursor:pointer}#view-franchise-hub .fhq-thread[aria-pressed=true]{background:#edf5ec;border-color:#6c9a80}#view-franchise-hub .fhq-thread strong{display:block;margin-bottom:6px}
#view-franchise-hub .fhq-messages{display:grid;gap:12px;max-height:500px;overflow-y:auto;padding:2px}#view-franchise-hub .fhq-message{border:1px solid #dce6dc;border-radius:10px;padding:15px;background:#fafcf9;overflow-wrap:anywhere}#view-franchise-hub .fhq-message p{white-space:pre-wrap;line-height:1.6;margin:10px 0 0}
#view-franchise-hub .fhq-composer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin-top:15px}#view-franchise-hub .fhq-composer textarea{min-height:70px;resize:vertical;width:100%}
#view-franchise-hub .fhq-composer[hidden],#view-franchise-hub #franChatHeader[hidden]{display:none!important}
@media(max-width:650px){#view-franchise-hub [id^=franSec]{padding:16px!important}#view-franchise-hub .fhq-chat-layout{grid-template-columns:1fr}#view-franchise-hub .fhq-thread-list{max-height:260px}#view-franchise-hub .fhq-row{grid-template-columns:1fr 1fr;gap:10px}#view-franchise-hub .fhq-row>div:nth-child(2){grid-column:1/-1;grid-row:1}#view-franchise-hub .fhq-row>div:first-child{grid-column:1/-1}#view-franchise-hub .fhq-composer{grid-template-columns:1fr}#view-franchise-hub .fhq-field{min-width:0;width:100%}}
`;

export function installFranchiseHQUI(w=window,d=document) {
    if(!d.createElement || !d.getElementById('franSecLedger') || !w.getDocsFromServer)return null;
    const el=id=>d.getElementById(id),getSession=()=>w.sessionUser;
    const makeId=()=>w.crypto?.randomUUID?.() || 'hq_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
    const style=d.createElement('style');style.textContent=styles;d.head?.append(style);
    el('franSecLedger').innerHTML=`<div class="fhq-toolbar"><label class="fhq-field">Franchise branch<select id="franLedgerBranch"><option value="">Select a franchise branch</option></select></label><div class="fhq-actions"><button class="fhq-button" id="fhqLedgerRefresh">Refresh</button><button class="fhq-button" id="fhqExport" disabled>Export statement (CSV)</button><button class="fhq-button fhq-primary" id="btnFranManualLog" disabled>Log payment / charge</button></div></div><div id="fhqDirectoryNote" class="fhq-note" role="status"></div><div class="fhq-summary"><span>Account balance owed to HQ</span><strong id="franTotalBalance">Select a branch</strong><div class="fhq-note">Ledger charges less confirmed payments. A payment entry updates this account statement only.</div></div><div id="fhqLedgerStatus" class="fhq-note" role="status"></div><div id="franLedgerBody" class="fhq-ledger"></div>`;
    el('franSecChat').innerHTML=`<div class="fhq-toolbar"><label class="fhq-field">Conversations for<select id="fhqChatBranch"><option value="">All permitted franchises</option></select></label><div class="fhq-actions"><button class="fhq-button" id="fhqChatRefresh">Refresh</button><button class="fhq-button fhq-primary" id="fhqNewThread" disabled>New conversation</button></div></div><p id="fhqReadOnlyNote" class="fhq-note" hidden>This Owner workspace view is read-only. <a href="https://takodeal-franchise.vercel.app/" target="_blank" rel="noopener noreferrer">Open the Franchisee app</a> to send branch conversations.</p><div id="fhqChatStatus" class="fhq-note" role="status"></div><div class="fhq-chat-layout"><div id="franThreadList" class="fhq-thread-list"></div><div><div id="franChatHeader" hidden><h3 id="franChatTitle"></h3><p id="franChatAuthor" class="fhq-note"></p></div><div id="franChatMessages" class="fhq-messages">Select a conversation to read messages.</div><div id="franChatInputArea" class="fhq-composer" hidden><textarea id="franChatInput" class="fhq-input" maxlength="2000" placeholder="Write a reply"></textarea><button class="fhq-button fhq-primary" id="fhqSendReply">Send reply</button></div></div></div>`;
    let replyBusy=false,lastThreads='',lastDetail='',inputKey='',inputAccount='';
    const replyDrafts=new Map(),replyOperations=new Map();
    const options=(branches,all)=>`<option value="">${all?'All permitted franchises':'Select a franchise branch'}</option>`+branches.map(branch=>`<option value="${escape(branch)}">${escape(branch)}</option>`).join('');
    const setNote=(id,value,error=false)=>{const node=el(id);node.textContent=value;node.className=error?'fhq-error':'fhq-note';};
    const controller=createFranchiseHQController(w,{getSession,onChange:render});
    function render(state) {
        const account=identity(getSession());
        const readOnly=!canManageFranchiseHQ(getSession());
        if(inputAccount!==account){replyDrafts.clear();replyOperations.clear();inputKey='';el('franChatInput').value='';inputAccount=account;}
        if(inputKey)replyDrafts.set(inputKey,el('franChatInput').value);
        for(const [id,all] of [['franLedgerBranch',false],['fhqChatBranch',true]]) {
            const node=el(id),value=node.value,html=options(state.directory.branches,all);
            if(node.innerHTML!==html){node.innerHTML=html;node.value=state.directory.branches.includes(value)?value:'';}
            node.disabled=state.directory.status!=='ready';
        }
        const directory=state.directory;
        const issues=[directory.unclassified.length?`${directory.unclassified.join(', ')}: franchise status has not been confirmed.`:'',directory.conflicts.length?`${directory.conflicts.join(', ')}: conflicting company / franchise flags need review.`:''].filter(Boolean);
        setNote('fhqDirectoryNote',directory.status==='loading'?'Checking saved branch settings…':directory.status==='error'||directory.status==='partial'?directory.error:issues.join(' ') || (!directory.branches.length?'No confirmed franchise branches are available within your access.':''),directory.status==='error');
        const ledger=state.ledger,valid=controller.canExportLedger();
        el('franLedgerBranch').value=ledger.branch;
        el('franTotalBalance').textContent=ledger.status==='unselected'?'Select a branch':ledger.status==='loading'?'Loading…':ledger.status==='error'?'Unavailable':ledger.status==='partial'?'Incomplete records':money(ledger.summary?.balance);
        el('fhqExport').disabled=!valid;
        el('btnFranManualLog').disabled=directory.status!=='ready'||!directory.branches.includes(ledger.branch)||ledger.status==='loading';
        el('btnFranManualLog').hidden=readOnly;el('btnFranManualLog').style.display=readOnly?'none':'';
        setNote('fhqLedgerStatus',ledger.status==='error'?ledger.error:ledger.status==='partial'?'More than 2,000 entries exist. Balance and export are unavailable until HQ reviews the complete account.':ledger.status==='ready'&&ledger.summary.invalidCount?`${ledger.summary.invalidCount} entries need an amount or transaction-type review. The balance is unavailable.`:ledger.status==='ready'?`${ledger.summary.rows.length} entries · Checked ${date(ledger.loadedAt)}`:'',ledger.status==='error');
        el('franLedgerBody').innerHTML=ledger.summary?.rows.length?ledger.summary.rows.map(row=>`<article class="fhq-row"><div><small>Date & time</small>${escape(date(row.timestamp))}</div><div><strong>${escape(row.description||row.category||'Description not recorded')}</strong><p>${escape(row.type||'Type not recorded')} · ${escape(row.loggedBy||row.authorEmail||'Author not recorded')}</p></div><div><small>${row.payment?'Payment':'Charge'}</small>${row.invalid?'Needs review':money(row.payment||row.charge)}</div><div><small>Running balance</small>${money(row.balance)}</div></article>`).join(''):ledger.status==='ready'?'<p class="fhq-note">No ledger entries are recorded for this franchise. The account balance is ₱0.00.</p>':ledger.status==='unselected'?'<p class="fhq-note">Choose a franchise to view its saved account statement.</p>':'';
        const chat=state.chat;
        el('fhqNewThread').disabled=directory.status!=='ready';
        el('fhqNewThread').hidden=readOnly;el('fhqReadOnlyNote').hidden=!readOnly;
        el('fhqChatBranch').value=chat.branch;
        setNote('fhqChatStatus',chat.error || (chat.status==='loading'?'Loading saved conversations…':chat.status==='partial'?'This conversation list is incomplete. Select one branch or ask HQ to review older records.':chat.status==='ready'?'Saved messages shared with the Franchisee app.':''),chat.status==='error');
        const signature=JSON.stringify([chat.threads.map(row=>[row.id,row.title,row.lastActivity,row.timestamp]),chat.active?.id]);
        if(signature!==lastThreads){lastThreads=signature;el('franThreadList').innerHTML=chat.threads.map(row=>{const audience=conversationAudience(row);return `<button type="button" class="fhq-thread" data-thread="${escape(row.id)}" aria-pressed="${row.id===chat.active?.id}"><strong>${escape(row.title||'Untitled conversation')}</strong><span>${escape(audience.kind==='network'?'All franchises':audience.kind==='unknown'?'Recipient not recorded · HQ review':audience.branch)}</span><div class="fhq-note">${escape(date(row.lastActivity||row.timestamp))}${audience.legacy?' · Older record':''}</div></button>`;}).join('')||'<p class="fhq-note">No saved conversations for this selection.</p>';}
        const nextInputKey=chat.active?JSON.stringify([account,chat.branch,chat.active.id]):'';
        if(inputKey!==nextInputKey){inputKey=nextInputKey;el('franChatInput').value=replyDrafts.get(inputKey)||'';}
        const detail=JSON.stringify([account,chat.branch,chat.active]);
        if(detail!==lastDetail){lastDetail=detail;const row=chat.active;el('franChatHeader').hidden=!row;
            if(row){el('franChatTitle').textContent=row.title||'Untitled conversation';const audience=conversationAudience(row);el('franChatAuthor').textContent=(audience.kind==='network'?'All franchises':audience.kind==='unknown'?'Recipient not recorded · HQ review':audience.branch)+' · '+(row.author||row.authorEmail||'Author not recorded');
                const messages=[row,...(Array.isArray(row.replies)?row.replies:[])];
                el('franChatMessages').innerHTML=(audience.legacy?'<p class="fhq-warning">This older conversation has no confirmed recipient. It is read-only; start a new conversation with a selected recipient.</p>':'')+messages.map(message=>`<article class="fhq-message"><strong>${escape(message.author||message.authorEmail||'Author not recorded')}</strong><div class="fhq-note">${escape(message.authorBranch||message.branch||'')} · ${escape(date(message.timestamp))}</div><p>${escape(message.message)}</p></article>`).join('');
                el('franChatInputArea').hidden=readOnly||audience.legacy||audience.kind==='unknown'||!Array.isArray(row.replies);
            }else{el('franChatMessages').textContent='Select a conversation to read messages.';el('franChatInputArea').hidden=true;}
        }
        el('fhqSendReply').disabled=replyBusy||chat.status==='error';
        el('franChatInput').disabled=replyBusy;
        renderPerformance(state.performance);
    }
    function renderPerformance(performance) {
        const panel=el('franSecPerformance');if(!panel||performance.status==='idle')return;
        panel.innerHTML=`<div class="fhq-toolbar"><div><h3>Franchise performance</h3><p class="fhq-note">Last 30 days · saved closed-shift sales and royalty charges</p></div><button class="fhq-button" id="fhqPerformanceRefresh">Refresh</button></div>${performance.status==='error'?`<p class="fhq-error">${escape(performance.error)}</p>`:performance.status==='loading'?'<p class="fhq-note">Loading saved performance…</p>':`${performance.status==='partial'?'<p class="fhq-warning">Some branches exceed the record limit. Their totals are unavailable; review individual branch reports.</p>':''}<div class="fhq-ledger">${performance.rows.map(row=>`<article class="fhq-row"><div><strong>${escape(row.branch)}</strong><p>${row.closedShifts} closed shifts${row.partial?' shown · incomplete':''}</p></div><div><small>Recorded sales</small>${money(row.sales)}</div><div><small>Royalty charges</small>${money(row.royalties)}</div><div><small>Data status</small>${row.partial?'Incomplete':row.review?'Needs review':'Recorded totals'}</div></article>`).join('')||'<p class="fhq-note">No confirmed franchise branches are available.</p>'}</div>`}`;
        el('fhqPerformanceRefresh')?.addEventListener('click',()=>controller.loadPerformance());
    }
    const showError=error=>w.Swal?.fire({title:'Unable to continue',text:error.message,icon:'error',confirmButtonColor:'#17634f'});
    const branchOptions=()=>controller.state.directory.branches.map(branch=>`<option value="${escape(branch)}">${escape(branch)}</option>`).join('');
    async function entryForm() {
        if(!canManageFranchiseHQ(getSession())){showError(Error('Use the Franchisee app for branch operations. This Owner workspace view is read-only.'));return;}
        const branch=controller.state.ledger.branch;
        try {await controller.verifyBranch(branch);}catch(error){showError(error);return;}
        const key=identity(getSession()),id=makeId();let attempt=null,inflight=null;
        await w.Swal.fire({title:'Record franchise account entry',html:`<div class="workspace-dialog-form"><p>${escape(branch)}</p><label>Entry type<select id="fhqEntryType"><option value="Payment">Payment received</option><option value="Charge">Manual charge</option></select></label><label>Amount (₱)<input id="fhqEntryAmount" type="number" min="0.01" step="0.01"></label><label>Payment reference / reason<textarea id="fhqEntryDescription" class="fhq-input" maxlength="500"></textarea></label><p class="fhq-note">Record a payment only after confirming receipt. This changes the franchise account statement; it does not deposit money into a cash or bank account.</p></div>`,showCancelButton:true,confirmButtonText:'Review and save entry',confirmButtonColor:'#17634f',showLoaderOnConfirm:true,allowOutsideClick:()=>!w.Swal.isLoading(),preConfirm:async()=>{
            const input={id,branch,type:el('fhqEntryType').value,amount:el('fhqEntryAmount').value,description:el('fhqEntryDescription').value},signature=JSON.stringify(input);
            try {if(identity(getSession())!==key)throw Error('Your account changed. Close this form and reload.');if(!Number.isFinite(Number(input.amount))||Number(input.amount)<=0||!text(input.description)||text(input.description).length>500)throw Error('Enter a positive amount and a payment reference or reason.');if(attempt&&attempt!==signature)throw Error('Retry the same details to confirm the previous request. Check the ledger before creating a different entry.');await controller.verifyBranch(branch);if(input.type!==el('fhqEntryType').value||input.amount!==el('fhqEntryAmount').value||input.description!==el('fhqEntryDescription').value)throw Error('The details changed during the branch check. Review them and try again.');attempt=signature;
                if(!inflight)inflight=controller.recordEntry(input).finally(()=>{inflight=null;});await inflight;return true;
            }catch(error){w.Swal.showValidationMessage(error.message);return false;}
        }}).then(async result=>{if(result.isConfirmed)await controller.loadLedger(branch);});
    }
    async function newThread() {
        if(!canManageFranchiseHQ(getSession())){showError(Error('Open the Franchisee app to send branch conversations.'));return;}
        try {await controller.loadDirectory();if(controller.state.directory.status!=='ready')return;}catch(error){showError(error);return;}
        const key=identity(getSession()),id=makeId();let attempt=null,inflight=null;
        const all=fullWorkspaceAccess(getSession());
        const result=await w.Swal.fire({title:'New franchise conversation',html:`<div class="workspace-dialog-form"><label>Recipient<select id="fhqRecipient"><option value="">Select a franchise</option>${all?'<option value="__network__">All franchises</option>':''}${branchOptions()}</select></label><label>Type<select id="fhqThreadType"><option>Discussion</option><option>Help</option><option>Announcement</option></select></label><label>Subject<input id="fhqThreadTitle" maxlength="160"></label><label>Message<textarea id="fhqThreadMessage" maxlength="4000" class="fhq-input"></textarea></label></div>`,showCancelButton:true,confirmButtonText:'Send conversation',confirmButtonColor:'#17634f',showLoaderOnConfirm:true,allowOutsideClick:()=>!w.Swal.isLoading(),didOpen:()=>{el('fhqRecipient').value=controller.state.chat.branch;},preConfirm:async()=>{
            const recipient=el('fhqRecipient').value,input={id,branch:recipient==='__network__'?'':recipient,audience:recipient==='__network__'?'network':'branch',type:el('fhqThreadType').value,title:el('fhqThreadTitle').value,message:el('fhqThreadMessage').value},signature=JSON.stringify(input);
            try {if(identity(getSession())!==key)throw Error('Your account changed. Close this form and reload.');if(!recipient)throw Error('Select a franchise recipient.');if(!text(input.title)||text(input.title).length>160||!text(input.message)||text(input.message).length>4000)throw Error('Enter a subject and message within the indicated limits.');if(attempt&&attempt!==signature)throw Error('Retry the same message to confirm the previous request. Check conversations before starting a different message.');if(input.branch)await controller.verifyBranch(input.branch);else await controller.loadDirectory();if(recipient!==el('fhqRecipient').value||input.type!==el('fhqThreadType').value||input.title!==el('fhqThreadTitle').value||input.message!==el('fhqThreadMessage').value)throw Error('The message changed during the branch check. Review it and try again.');attempt=signature;
                if(!inflight)inflight=controller.conversations.create(input).finally(()=>{inflight=null;});await inflight;return {id};
            }catch(error){w.Swal.showValidationMessage(error.message);return false;}
        }});
        if(result.isConfirmed){await controller.loadThreads();await controller.openThread(id);}
    }
    async function sendReply() {
        if(!canManageFranchiseHQ(getSession())){showError(Error('Open the Franchisee app to send branch conversations.'));return;}
        const row=controller.state.chat.active,message=el('franChatInput').value,branch=controller.state.chat.branch,draftKey=inputKey;
        if(!row||replyBusy)return;
        if(!text(message)||text(message).length>2000){showError(Error('Enter a reply of 2,000 characters or fewer.'));return;}
        const signature=JSON.stringify([row.id,message]);
        let replyOperation=replyOperations.get(draftKey);
        if(replyOperation&&replyOperation.signature!==signature){showError(Error('Retry the same reply to confirm the previous request before changing it.'));return;}
        replyOperation ||= {signature,id:makeId()};replyOperations.set(draftKey,replyOperation);replyBusy=true;render(controller.state);
        try {const audience=conversationAudience(row);if(audience.kind==='branch')await controller.verifyBranch(audience.branch);await controller.conversations.reply({id:row.id,branch,message,replyId:replyOperation.id});replyDrafts.delete(draftKey);replyOperations.delete(draftKey);if(inputKey===draftKey)el('franChatInput').value='';if(controller.state.chat.active?.id===row.id&&controller.state.chat.branch===branch)await controller.openThread(row.id);}
        catch(error){showError(error);}finally{replyBusy=false;render(controller.state);}
    }
    function exportStatement() {
        const ledger=controller.state.ledger;
        if(!controller.canExportLedger())return;
        const csvValue=value=>'"'+(typeof value==='string'&&/^[=+@\-\t\r]/.test(value)?"'":'')+String(value??'').replace(/"/g,'""')+'"';
        const output=[['Franchise',ledger.branch],['Checked',date(ledger.loadedAt)],['Date / time (PH)','Description','Type','Charge','Payment','Running balance'],...ledger.summary.rows.map(row=>[date(row.timestamp),row.description||row.category,row.type,row.charge,row.payment,row.balance])].map(line=>line.map(csvValue).join(',')).join('\r\n');
        const url=w.URL.createObjectURL(new Blob(['\uFEFF'+output],{type:'text/csv;charset=utf-8'})),link=d.createElement('a');link.href=url;link.download='Franchise-statement-'+ledger.branch.replace(/[^a-z0-9_-]/gi,'_')+'.csv';link.click();w.URL.revokeObjectURL(url);
    }
    el('franLedgerBranch').addEventListener('change',event=>controller.loadLedger(event.target.value));
    el('fhqLedgerRefresh').addEventListener('click',async()=>{try{await controller.loadDirectory();await controller.loadLedger();}catch{}});
    el('btnFranManualLog').addEventListener('click',entryForm);el('fhqExport').addEventListener('click',exportStatement);
    el('fhqChatBranch').addEventListener('change',event=>controller.loadThreads(event.target.value));el('fhqChatRefresh').addEventListener('click',()=>controller.loadThreads());
    el('fhqNewThread').addEventListener('click',newThread);el('fhqSendReply').addEventListener('click',sendReply);
    el('franThreadList').addEventListener('click',event=>{const button=event.target.closest('[data-thread]');if(button)controller.openThread(button.dataset.thread);});
    w.loadFranLedger=async()=>{try{await controller.loadDirectory();await controller.loadLedger(el('franLedgerBranch').value);}catch{}};
    w.loadFranChat=()=>controller.loadThreads(el('fhqChatBranch').value);
    w.loadFranPerformance=()=>controller.loadPerformance();w.openFranManualLedger=entryForm;w.generateFranchiseSOA=exportStatement;w.openNewThreadModal=newThread;w.openFranThread=id=>controller.openThread(id);w.sendFranReply=sendReply;
    w.deleteFranThread=()=>showError(Error('Saved conversations are retained for account history. Start a new conversation to correct a message.'));
    w.addEventListener('pagehide',()=>controller.stop());
    return controller;
}
