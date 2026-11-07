import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReviewDocument,deferred,drain} from './helpers/review-dom.mjs';
import {canVisit} from '../takodeal-franchise/franchise-data.js';
import {FRANCHISE_BOARD_ENDPOINT,FRANCHISE_BOARD_DIRECTORS,createFranchiseBoardClient,installFranchiseAIBoard,renderFranchiseBoardReport} from '../takodeal-franchise/franchise-ai-board.js';

const session=()=>({uid:'partner',email:'partner@example.test',role:'Franchisee',isFranchisee:true,permissions:['dashboard'],allowedBranches:['Maa','Agdao'],branch:'Maa'});
function packet(scope={branch:'Maa',from:'2026-11-01',to:'2026-11-07'},mode='snapshot'){
 return {mode,advisoryOnly:true,aiAvailable:true,requestId:'sample-only',model:mode==='briefing'?'sample-model':null,packet:{branch:scope.branch,period:{start:scope.from,end:scope.to},asOf:'2026-11-07T01:00:00Z',partial:false,evidence:[{id:'sales',label:'Recorded sales',value:1000,unit:'PHP',complete:true,source:'transactions'}],coverage:[{source:'transactions',records:10,complete:true,basis:'Selected branch and business days'}],limitations:['Uploaded records only.']},board:{summary:'Review the selected branch evidence.',priorities:['Check the saved cash reconciliation.'],directors:FRANCHISE_BOARD_DIRECTORS.map(row=>({...row,summary:row.title+' perspective',actions:['Review the supporting evidence.']})),limitations:[]}};
}
function fixture(options={}){
 const d=new ReviewDocument(),host=d.createElement('section');d.body.append(host);const calls=[],scope={branch:'Maa',from:'2026-11-01',to:'2026-11-07'},state={route:'ai-board'};
 const api={sessionUser:session(),auth:{currentUser:{uid:'partner',email:'partner@example.test',emailVerified:true,getIdToken:async()=>options.token?options.token():'fictional-token'}},fetch:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return options.fetch?options.fetch(url,init):{ok:true,json:async()=>packet(scope,JSON.parse(init.body).mode)};},runTransaction(){throw Error('Board UI must never write business records.');},getDocsFromServer(){throw Error('The central service owns evidence reads.');}};
 const client=createFranchiseBoardClient(api,{getContext:()=>({...scope}),...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{})});return {api,d,host,calls,scope,state,client};
}
const install=f=>installFranchiseAIBoard(f.api,{document:f.d,getRoute:()=>f.state.route,getContext:()=>({...f.scope})});
const control=(f,name)=>f.host.querySelector('[data-board-'+name+']');

test('Franchise Board access does not grant other routes or expose HQ-only all-permission accounts',()=>{
 const partner=session();assert.equal(canVisit(partner,'ai-board'),true);assert.equal(canVisit(partner,'hq-billing'),false);assert.equal(canVisit({...partner,permissions:['inventory']},'ai-board'),false);assert.equal(canVisit({...partner,permissions:['ai-board']},'ai-board'),true);
 assert.equal(canVisit({...partner,isFranchisee:false,isOwner:true,permissions:['all']},'ai-board'),false);assert.equal(canVisit({...partner,email:'jgo031996@gmail.com',isOwner:true,isFranchisee:false},'ai-board'),true);assert.equal(canVisit({...partner,branch:'Other'},'ai-board'),false);
});
test('snapshot uses the central authenticated endpoint with only the explicit branch/date/mode contract',async()=>{
 const f=fixture();await f.client.request('snapshot');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,FRANCHISE_BOARD_ENDPOINT);assert.deepEqual(f.calls[0].body,{branch:'Maa',from:'2026-11-01',to:'2026-11-07',mode:'snapshot'});assert.equal(f.calls[0].init.headers.Authorization,'Bearer fictional-token');assert.equal(f.calls[0].init.credentials,'omit');assert.equal(f.calls[0].init.cache,'no-store');assert.equal(f.calls[0].init.method,'POST');
});
test('opening the simple Board loads a free snapshot and all seven cards without an AI request',async()=>{
 const f=fixture(),ui=install(f);ui.mount(f.host);await drain();assert.deepEqual(f.calls.map(row=>row.body.mode),['snapshot']);assert.equal(FRANCHISE_BOARD_DIRECTORS.length,7);for(const role of FRANCHISE_BOARD_DIRECTORS)assert.match(control(f,'result').innerHTML,new RegExp(role.title));assert.match(control(f,'scope').textContent,/Maa.*2026-11-01.*2026-11-07/);assert.equal(control(f,'generate').disabled,false);assert.match(control(f,'status').textContent,/Snapshot ready/);
});
test('one explicit Generate briefing asks all directors once and duplicate clicks do not create paid requests',async()=>{
 const gate=deferred(),f=fixture({fetch:async(_url,init)=>({ok:true,json:async()=>JSON.parse(init.body).mode==='briefing'?(await gate.promise,packet(f.scope,'briefing')):packet(f.scope)})}),ui=install(f);ui.mount(f.host);await drain();const first=control(f,'generate').onclick();assert.equal(control(f,'generate').disabled,true);assert.equal(control(f,'generate').onclick(),false);await drain();assert.equal(f.calls.filter(row=>row.body.mode==='briefing').length,1);gate.resolve();await first;assert.match(control(f,'result').innerHTML,/AI briefing/);assert.match(control(f,'status').textContent,/Briefing ready/);
});
test('missing evidence stays unavailable and an unconfigured AI connection leaves only the free snapshot enabled',async()=>{
 const f=fixture({fetch:async()=>{const data=packet();data.aiAvailable=false;data.packet.partial=true;data.packet.evidence[0].value=null;data.packet.coverage[0].error='History permission is unavailable';data.board.directors=[];return {ok:true,json:async()=>data};}}),ui=install(f);ui.mount(f.host);await drain();assert.equal(control(f,'generate').disabled,true);assert.equal(control(f,'refresh').disabled,false);assert.match(control(f,'result').innerHTML,/Unavailable|unavailable/);assert.match(control(f,'result').innerHTML,/incomplete/);assert.match(control(f,'result').innerHTML,/History permission/);assert.equal(f.calls.length,1);
});
test('an AI-configured empty packet still disables paid briefing and explains the missing evidence',async()=>{
 const f=fixture({fetch:async()=>{const data=packet();data.packet.evidence=[];data.packet.partial=true;data.board.directors=[];return {ok:true,json:async()=>data};}}),ui=install(f);ui.mount(f.host);await drain();assert.equal(control(f,'generate').disabled,true);assert.match(control(f,'status').textContent,/No permitted evidence/);assert.equal(control(f,'refresh').disabled,false);assert.deepEqual(f.calls.map(row=>row.body.mode),['snapshot']);
});
test('a reused AI briefing shows its generation time separately from the newer data snapshot time',()=>{
 const data=packet(undefined,'briefing');data.cache={briefing:true};data.packet.asOf='2026-11-07T04:00:00Z';data.generatedAt='2026-11-07T03:51:00Z';const html=renderFranchiseBoardReport(data);assert.match(html,/Data as of/);assert.match(html,/Reused briefing · generated/);assert.match(html,/12:00/);assert.match(html,/11:51/);
});
test('server evidence and director text are escaped, with no generated action or link execution',()=>{
 const data=packet(),bad='<img src=x onerror="unsafe()">';data.board.summary=bad;data.board.directors[0].summary=bad;data.board.directors[0].actions=[bad];data.packet.coverage[0].error=bad;const html=renderFranchiseBoardReport(data);assert.doesNotMatch(html,/<img|<script|onclick=|href=/);assert.match(html,/&lt;img/);assert.match(html,/does not change sales, stock, payroll/);
});
test('a branch or permission change while the Firebase token is loading prevents even the request',async()=>{
 for(const change of ['branch','permissions','account']){const gate=deferred(),f=fixture({token:()=>gate.promise}),loading=f.client.request();if(change==='branch'){f.scope.branch='Agdao';f.api.sessionUser.branch='Agdao';}if(change==='permissions')f.api.sessionUser.permissions=[];if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser};gate.resolve('fictional-token');await assert.rejects(loading,/changed|approved Franchise/);assert.equal(f.calls.length,0);}
});
test('a late former-branch or route response cannot repopulate a cleared Board',async()=>{
 for(const change of ['branch','route','account','permission']){const gate=deferred(),f=fixture({fetch:async()=>({ok:true,json:()=>gate.promise})}),ui=install(f);ui.mount(f.host);await drain();if(change==='branch'){f.scope.branch='Agdao';f.api.sessionUser.branch='Agdao';}if(change==='route')f.state.route='dashboard';if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser};if(change==='permission')f.api.sessionUser.permissions=[];ui.invalidate();assert.equal(f.host.innerHTML,'');gate.resolve(packet());await drain();assert.equal(f.host.innerHTML,'');}
});
test('a refresh while the same physical snapshot is running shares its request and renders only the newest mount',async()=>{
 const gate=deferred(),f=fixture({fetch:async()=>({ok:true,json:()=>gate.promise})}),ui=install(f);ui.mount(f.host);await drain();ui.mount(f.host);await drain();assert.equal(f.calls.length,1);gate.resolve(packet());await drain();assert.match(control(f,'result').innerHTML,/Recorded snapshot/);
});
test('in-place permission revocation removes the old report before another action can start',async()=>{
 const f=fixture(),ui=install(f);ui.mount(f.host);await drain();const generate=control(f,'generate');assert.match(control(f,'result').innerHTML,/Recorded snapshot/);f.api.sessionUser.permissions=[];assert.equal(await generate.onclick(),false);assert.equal(f.host.innerHTML,'');assert.equal(f.calls.length,1);
});
test('a deadline retains the paid physical request and cannot create another briefing across a branch change',async()=>{
 const gate=deferred(),f=fixture({timeoutMs:{briefing:5,snapshot:5},fetch:async()=>({ok:true,json:()=>gate.promise})});await assert.rejects(f.client.request('briefing'),/longer than expected/);assert.equal(f.client.busy(),true);await assert.rejects(f.client.request('briefing'),/longer than expected/);assert.equal(f.calls.length,1);f.scope.branch='Agdao';f.api.sessionUser.branch='Agdao';await assert.rejects(f.client.request('briefing'),/previous briefing/);assert.equal(f.calls.length,1);gate.resolve(packet());await drain();assert.equal(f.client.busy(),false);
});
test('a cross-branch or wrong-period response is rejected before it can render private evidence',async()=>{
 for(const patch of [data=>data.packet.branch='Agdao',data=>data.packet.period.start='2026-10-01',data=>data.mode='briefing',data=>data.advisoryOnly=false]){const f=fixture({fetch:async()=>{const data=packet();patch(data);return {ok:true,json:async()=>data};}});await assert.rejects(f.client.request(),/does not match/);}
});
test('fresh server access denial clears a previously valid briefing and disables another paid request',async()=>{
 for(const status of [401,403]){let denied=false;const f=fixture({fetch:async(_url,init)=>denied?{ok:false,status,json:async()=>({error:{code:'access-changed',message:'Saved branch access changed. Sign in again.'}})}:{ok:true,json:async()=>packet(f.scope,JSON.parse(init.body).mode)}}),ui=install(f);ui.mount(f.host);await drain();await control(f,'generate').onclick();assert.match(control(f,'result').innerHTML,/AI briefing/);denied=true;assert.equal(await control(f,'refresh').onclick(),false);assert.equal(control(f,'result').innerHTML,'');assert.equal(control(f,'generate').disabled,true);assert.equal(control(f,'generate').onclick(),false);assert.equal(f.calls.filter(row=>row.body.mode==='briefing').length,1);assert.match(control(f,'status').textContent,/access changed/);}
});
test('an optional AI provider failure keeps the recorded snapshot available with an honest error',async()=>{
 const f=fixture({fetch:async(_url,init)=>JSON.parse(init.body).mode==='briefing'?{ok:false,status:503,json:async()=>({error:{code:'service-unavailable',message:'AI briefing is unavailable. Use the free snapshot.'}})}:{ok:true,json:async()=>packet()}}),ui=install(f);ui.mount(f.host);await drain();assert.equal(await control(f,'generate').onclick(),false);assert.match(control(f,'result').innerHTML,/Recorded snapshot/);assert.match(control(f,'status').textContent,/Use the free snapshot/);assert.equal(control(f,'refresh').disabled,false);
});
test('date limits and All-branch scopes fail before a network or token request',async()=>{
 for(const change of [f=>f.scope.from='2026-09-01',f=>f.scope.to='2026-02-30',f=>{f.scope.branch='All';f.api.sessionUser.branch='All';f.api.sessionUser.allowedBranches=['All'];}]){const f=fixture();change(f);await assert.rejects(f.client.request(),/31 Philippine|assigned branches/);assert.equal(f.calls.length,0);}
});
test('route, navigation, auth-clear lifecycle and responsive styles are wired into the existing workspace',()=>{
 const read=name=>readFileSync(new URL('../takodeal-franchise/'+name,import.meta.url),'utf8'),html=read('index.html'),workspace=read('franchise-workspace.js');assert.equal(html.split('id="view-ai-board"').length-1,1);assert.equal(html.split('data-route="ai-board"').length-1,1);assert.match(html,/franchise-ai-board\.css/);assert.match(workspace,/define\('ai-board'/);assert.match(workspace,/clearFranchiseReadRequests=\(\)=>\{board\.invalidate\(\)/);assert.match(workspace,/board\.invalidate\(\);hq\.stop/);assert.match(read('franchise-ai-board.css'),/max-width:580px/);assert.doesNotMatch(read('franchise-ai-board.js'),/localStorage|sessionStorage|addDoc|updateDoc|setDoc|runTransaction|\.getDocs/);
});
