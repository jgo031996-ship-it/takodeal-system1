import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateStaffSetupCode,isSetupOwner,createSetupOwnerClient,installStaffSetupCodes,STAFF_SETUP_ENDPOINT,setupDeviceUsage} from '../takodeal-manager/staff-setup-codes.js';

const owner=()=>({uid:'qa-owner',email:'jgo031996@gmail.com',emailVerified:true,getIdToken:async()=> 'qa-token'});
test('personal setup code uses rejection sampling and preserves leading zero digits',()=>{
 let calls=0;const cryptoAPI={getRandomValues(bytes){bytes.fill(255);bytes.set(calls++?[0,1,2,3,4,5,6,7,8,9]:[250,251,252,253,254,255]);return bytes;}};
 assert.equal(generateStaffSetupCode(cryptoAPI),'0123456789');assert.equal(calls,2);
 assert.throws(()=>generateStaffSetupCode({}),/unavailable/);
});
test('only verified approved Owner identity manages setup codes',()=>{
 assert.equal(isSetupOwner(owner()),true);
 for(const user of [null,{...owner(),emailVerified:false},{...owner(),email:'manager@example.test'},{...owner(),uid:''}])assert.equal(isSetupOwner(user),false);
});
test('setup transport authenticates exact endpoint and avoids caching and cookies',async()=>{
 const api={auth:{currentUser:owner()}},calls=[];const request=createSetupOwnerClient(api,{fetcher:async(...args)=>{calls.push(args);return{ok:true,json:async()=>({staffId:'a',enabled:true,version:1})};}});
 await request('issue-code',{staffId:'a',code:'0123456789',expectedVersion:0,operationId:'qa-operation'});
 const [url,options]=calls[0];assert.equal(url,STAFF_SETUP_ENDPOINT+'/issue-code');assert.equal(options.headers.Authorization,'Bearer qa-token');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).code,'0123456789');
});
test('unauthorized identity and unknown routes never make a request',async()=>{
 let reads=0;const request=createSetupOwnerClient({auth:{currentUser:{...owner(),emailVerified:false}}},{fetcher:async()=>{reads++;}});
 await assert.rejects(request('config',{}),/verified Owner/);await assert.rejects(request('other',{}),/Unsupported/);assert.equal(reads,0);
});
test('account switch during token loading aborts before transmitting a code',async()=>{
 let resolveToken,reads=0;const first={...owner(),getIdToken:()=>new Promise(resolve=>{resolveToken=resolve;})},api={auth:{currentUser:first}};
 const request=createSetupOwnerClient(api,{fetcher:async()=>{reads++;}}),result=request('issue-code',{code:'0123456789'});await Promise.resolve();api.auth.currentUser={...owner(),uid:'other'};resolveToken('token');
 await assert.rejects(result,/account changed/);assert.equal(reads,0);
});
test('unavailable or invalid endpoint response is never treated as a saved code',async()=>{
 for(const response of [{ok:true,json:async()=>{throw Error('HTML page');}},{ok:false,json:async()=>({error:'Not allowed'})},{ok:true,json:async()=>[]}]){
  const request=createSetupOwnerClient({auth:{currentUser:owner()}},{fetcher:async()=>response});await assert.rejects(request('config',{}),/not available|Not allowed|invalid setup/);
 }
});
test('account switch after server reply discards it before returning to UI',async()=>{
 const api={auth:{currentUser:owner()}},request=createSetupOwnerClient(api,{fetcher:async()=>{api.auth.currentUser={...owner(),uid:'other'};return{ok:true,json:async()=>({enabled:true})};}});
 await assert.rejects(request('config',{}),/account changed/);
});
test('transport preserves server conflict status and code for safe UI recovery',async()=>{
 const request=createSetupOwnerClient({auth:{currentUser:owner()}},{fetcher:async()=>({ok:false,status:409,json:async()=>({error:{code:'version-changed',message:'Refresh before continuing.'}})})});await assert.rejects(request('code-status',{staffId:'a'}),error=>error.status===409&&error.code==='version-changed');
});
test('deadline bounds token verification and a late token cannot send a setup code',async()=>{
 let timeout,releaseToken,requests=0;const api={auth:{currentUser:{...owner(),getIdToken:()=>new Promise(resolve=>{releaseToken=resolve;})}}};
 const request=createSetupOwnerClient(api,{delay(fn){timeout=fn;return 1;},cancelDelay(){},fetcher:async()=>{requests++;return{ok:true,json:async()=>({})};}}),result=request('issue-code',{staffId:'a',code:'0123456789'});await Promise.resolve();timeout();await assert.rejects(result,/not confirmed/);releaseToken('late-token');await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,0);
});

function harness(request){
 const nodes=new Map(),events=new Map(),docEvents=new Map();let mutation,authChange,n=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{display:'flex'},hidden:false,disabled:false,textContent:'',addEventListener:(type,fn)=>events.set(id+':'+type,fn)});return nodes.get(id);};
 for(const id of ['empProfileId','employeeProfileModal','staffSetupCodeStatus','staffSetupCodeGenerate','staffSetupCodeDisable','staffSetupCodeRefresh','staffSetupCodeCopy','staffSetupCodeValue','staffSetupCodeResult','staffSetupPolicyStatus','staffSetupPolicyEnable','staffSetupPolicyPause','staffSetupPolicyRefresh','staffSetupDeviceUsage','staffSetupDeviceUsageNote','staffSetupUsageRefresh'])node(id);
 node('empProfileId').value='employee-a';
 const d={hidden:false,getElementById:id=>nodes.get(id)||null,addEventListener:(event,fn)=>docEvents.set(event,fn)};
 const api={auth:{currentUser:owner(),onAuthStateChanged(fn){authChange=fn;}},navigator:{clipboard:{writeText:async value=>{api.copied=value;}}},Swal:{fire:async()=>({isConfirmed:true})},openEmployeeProfile(){},addNewStaff(){node('empProfileId').value='';},switchView(){},addEventListener:(event,fn)=>docEvents.set(event,fn)};
 const cryptoAPI={getRandomValues(bytes){bytes.set(Array.from({length:bytes.length},(_,i)=>i%10));return bytes;},randomUUID:()=> 'qa-operation-'+(++n)};
 const controller=installStaffSetupCodes(api,d,{request,cryptoAPI,observe:class{constructor(fn){mutation=fn;}observe(){}}});
 return{api,d,node,controller,docEvents,events,mutation:()=>mutation(),authChange:()=>authChange(),click:id=>events.get(id+':click')?.()};
}
const metadata={staffId:'employee-a',enabled:false,version:0};
test('only server confirmation reveals code, retry retains exact code and operation after lost acknowledgement',async()=>{
 const calls=[];let fail=true;const h=harness(async(route,body)=>{calls.push({route,body:{...body}});if(route==='code-status')return metadata;if(fail){fail=false;throw Error('Acknowledgement lost');}return{staffId:body.staffId,enabled:true,version:body.expectedVersion+1};});
 await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(h.node('staffSetupCodeValue').textContent,'');assert.equal(h.node('staffSetupCodeResult').hidden,true);assert.equal(h.node('staffSetupCodeGenerate').textContent,'Retry same code');assert.equal(h.node('staffSetupCodeRefresh').disabled,true);
 await h.click('staffSetupCodeGenerate');const writes=calls.filter(c=>c.route==='issue-code');assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(h.node('staffSetupCodeValue').textContent,'01234 56789');assert.equal(h.node('staffSetupCodeResult').hidden,false);assert.equal(h.node('staffSetupCodeDisable').disabled,false);
 await h.click('staffSetupCodeCopy');assert.equal(h.api.copied,'0123456789');
});
test('stale profile reply never exposes another employee’s generated code',async()=>{
 let finish;const h=harness(async(route,body)=>route==='code-status'?metadata:new Promise(resolve=>{finish=()=>resolve({staffId:body.staffId,enabled:true,version:1});}));
 await h.controller.loadProfile();const pending=h.click('staffSetupCodeGenerate');h.node('empProfileId').value='employee-b';finish();await pending;assert.equal(h.node('staffSetupCodeValue').textContent,'');assert.equal(h.node('staffSetupCodeResult').hidden,true);
});
test('invalid successful response cannot reveal an unconfirmed code',async()=>{
 const h=harness(async route=>route==='code-status'?metadata:{staffId:'employee-a',enabled:true,version:999});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(h.node('staffSetupCodeResult').hidden,true);assert.match(h.node('staffSetupCodeStatus').textContent,/not confirmed/);
});
test('profile close, page hiding and account change clear visible and pending secrets',async()=>{
 for(const event of ['close','hide','auth']){
  const h=harness(async(route,body)=>route==='code-status'?metadata:{staffId:body.staffId,enabled:true,version:1});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(h.node('staffSetupCodeResult').hidden,false);
  if(event==='close'){h.node('employeeProfileModal').style.display='none';h.mutation();}else if(event==='hide'){h.d.hidden=true;h.docEvents.get('visibilitychange')();}else h.authChange();
  assert.equal(h.node('staffSetupCodeValue').textContent,'');assert.equal(h.node('staffSetupCodeResult').hidden,true);
 }
});
test('new unsaved profile does not request or issue a setup code',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return metadata;});h.node('empProfileId').value='';await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(calls,0);assert.match(h.node('staffSetupCodeStatus').textContent,/Save the employee/);
});
test('disabled code action confirms separately without exposing or changing daily PINs',async()=>{
 const calls=[];const h=harness(async(route,body)=>{calls.push({route,body});return route==='code-status'?{...metadata,enabled:true,version:1}:{staffId:'employee-a',enabled:false,version:2};});await h.controller.loadProfile();await h.click('staffSetupCodeDisable');assert.equal(calls[1].route,'disable-code');assert.equal(calls[1].body.expectedVersion,1);assert.equal('code'in calls[1].body,false);assert.match(h.node('staffSetupCodeStatus').textContent,/Existing phones have not been blocked/);
});
test('global requirement defaults to unavailable until confirmed server policy and requires explicit action',async()=>{
 const calls=[];const h=harness(async(route,body)=>{calls.push({route,body});return route==='config'?{enabled:false,revision:0,protocolVersion:1}:{enabled:body.enabled,revision:1,protocolVersion:1};});
 assert.equal(h.node('staffSetupPolicyEnable').disabled,true);await h.controller.loadPolicy();assert.equal(calls.length,1);assert.equal(h.node('staffSetupPolicyEnable').disabled,false);await h.click('staffSetupPolicyEnable');assert.equal(calls[1].route,'policy');assert.equal(calls[1].body.enabled,true);assert.equal(calls[1].body.expectedRevision,0);assert.equal(h.node('staffSetupPolicyPause').hidden,false);
});
test('protected Staff fleet actions use server route and never mutate legacy mirror directly',async()=>{
 const calls=[];let legacy=0;const h=harness(async(route,body)=>{calls.push({route,body});return{ok:true};});h.api.db={};h.api.doc=(_db,...p)=>p.join('/');h.api.getDocFromServer=async()=>({exists:()=>true,data:()=>({appType:'Staff',setupVersion:1}),metadata:{fromCache:false}});
 await h.controller.routeDeviceChange('DEV-QA','block',()=>{legacy++;});assert.equal(legacy,0);assert.equal(calls[0].route,'device-action');assert.equal(calls[0].body.action,'block');assert.equal(calls[0].body.deviceId,'DEV-QA');
});
test('legacy POS fleet path retains its action only after fresh confirmed classification',async()=>{
 let legacy=0;const h=harness(async()=>{throw Error('Unexpected protected route');});h.api.db={};h.api.doc=(_db,...p)=>p.join('/');h.api.getDocFromServer=async()=>({exists:()=>true,data:()=>({appType:'POS'}),metadata:{fromCache:false}});
 await h.controller.routeDeviceChange('legacy-pos','delete',()=>{legacy++;});assert.equal(legacy,1);
 h.api.getDocFromServer=async()=>({exists:()=>true,data:()=>({appType:'POS'}),metadata:{fromCache:true}});await assert.rejects(h.controller.routeDeviceChange('legacy-pos','delete',()=>{legacy++;}),/Reconnect/);assert.equal(legacy,1);
});
test('uncertain protected device retry retains its original operation ID',async()=>{
 const calls=[];let fail=true;const h=harness(async(route,body)=>{calls.push({...body});if(fail){fail=false;throw Error('Lost acknowledgement');}return{ok:true};});h.api.db={};h.api.doc=()=>'';h.api.getDocFromServer=async()=>({exists:()=>true,data:()=>({appType:'Staff',setupVersion:1}),metadata:{}});
 await assert.rejects(h.controller.routeDeviceChange('DEV-QA','block',()=>{}),/Lost/);await h.controller.routeDeviceChange('DEV-QA','block',()=>{});assert.deepEqual(calls[0],calls[1]);
});
test('lost delete acknowledgement retries the server operation even after its mirror is gone',async()=>{
 const calls=[];let reads=0,fail=true;const h=harness(async(route,body)=>{calls.push({...body});if(fail){fail=false;throw Error('Delete acknowledgement lost');}return{deviceId:body.deviceId,status:'Deleted'};});h.api.db={};h.api.doc=()=>'';h.api.getDocFromServer=async()=>{reads++;return{exists:()=>reads===1,data:()=>({appType:'Staff',setupVersion:1}),metadata:{}};};
 await assert.rejects(h.controller.routeDeviceChange('DEV-QA','delete',()=>assert.fail('Unexpected legacy delete')),/acknowledgement lost/);
 await h.controller.routeDeviceChange('DEV-QA','delete',()=>assert.fail('Unexpected legacy delete'));assert.equal(reads,1);assert.deepEqual(calls[0],calls[1]);
});
test('hiding during a policy request cannot leave rollout controls permanently busy',async()=>{
 let finish;const h=harness(async(route,body)=>route==='config'?{enabled:false,revision:0,protocolVersion:1}:new Promise(resolve=>{finish=()=>resolve({enabled:body.enabled,revision:1,protocolVersion:1});}));await h.controller.loadPolicy();const changing=h.click('staffSetupPolicyEnable');await new Promise(resolve=>setImmediate(resolve));h.d.hidden=true;h.docEvents.get('visibilitychange')();finish();await changing;h.d.hidden=false;await h.controller.loadPolicy();assert.equal(h.node('staffSetupPolicyEnable').disabled,false);
});
test('explicit issuance conflict refreshes newer code status and never automatically generates a replacement',async()=>{
 const calls=[];let statusReads=0;const conflict=Object.assign(Error('Record changed; refresh.'),{status:409});const h=harness(async(route,body)=>{calls.push({route,body});if(route==='code-status')return statusReads++?{staffId:'employee-a',enabled:true,version:2}:metadata;throw conflict;});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(calls.filter(r=>r.route==='issue-code').length,1);assert.equal(statusReads,2);assert.equal(h.node('staffSetupCodeGenerate').disabled,false);assert.equal(h.node('staffSetupCodeGenerate').textContent,'Replace setup code');assert.equal(h.node('staffSetupCodeRefresh').disabled,false);assert.equal(h.node('staffSetupCodeValue').textContent,'');assert.equal(h.node('staffSetupCodeResult').hidden,true);
});
test('explicit rollout conflict reloads current policy and leaves controls usable without another policy write',async()=>{
 const calls=[];let reads=0;const h=harness(async(route,body)=>{calls.push({route,body});if(route==='config')return reads++?{enabled:true,revision:2,protocolVersion:1}:{enabled:false,revision:0,protocolVersion:1};throw Object.assign(Error('Policy changed; refresh.'),{status:409});});await h.controller.loadPolicy();await h.click('staffSetupPolicyEnable');assert.equal(calls.filter(r=>r.route==='policy').length,1);assert.equal(reads,2);assert.equal(h.node('staffSetupPolicyPause').hidden,false);assert.equal(h.node('staffSetupPolicyPause').disabled,false);assert.equal(h.node('staffSetupPolicyRefresh').disabled,false);
});
test('explicit protected-device conflict forgets superseded operation and refreshes without replaying a write',async()=>{
 const calls=[];let reads=0,refreshes=0;const h=harness(async(route,body)=>{calls.push({...body});if(calls.length===1)throw Object.assign(Error('Device changed; refresh.'),{status:409});return{deviceId:body.deviceId,status:'Blocked'};});h.api.db={};h.api.doc=()=>'';h.api.loadDeviceFleet=()=>refreshes++;h.api.getDocFromServer=async()=>{reads++;return{exists:()=>true,data:()=>({appType:'Staff',setupVersion:1}),metadata:{}};};await assert.rejects(h.controller.routeDeviceChange('DEV-QA','block',()=>{}),error=>error.status===409);assert.equal(refreshes,1);assert.equal(calls.length,1);await h.controller.routeDeviceChange('DEV-QA','block',()=>{});assert.equal(reads,2);assert.notEqual(calls[0].operationId,calls[1].operationId);
});
test('phone usage uses the server limit dynamically and describes reached capacity',async()=>{
 for(const limit of [2,3]){const h=harness(async()=>({...metadata,activeDevices:2,deviceLimit:limit}));await h.controller.loadProfile();assert.equal(h.node('staffSetupDeviceUsage').textContent,`2 of ${limit} active phones`);assert.match(h.node('staffSetupDeviceUsageNote').textContent,limit===2?/Limit reached/:/old registration/);assert.equal(h.node('staffSetupUsageRefresh').disabled,false);}
});
test('absent or malformed usage never invents zero active phones',async()=>{
 for(const value of [metadata,{...metadata,activeDevices:-1,deviceLimit:2},{...metadata,activeDevices:0},{...metadata,activeDevices:'0',deviceLimit:2},{...metadata,activeDevices:1,deviceLimit:0}]){assert.equal(setupDeviceUsage(value),null);const h=harness(async()=>value);await h.controller.loadProfile();assert.equal(h.node('staffSetupDeviceUsage').textContent,'Phone usage not available');assert.match(h.node('staffSetupDeviceUsageNote').textContent,/No count has been assumed/);}
});
test('issuing and disabling a code retain last-checked phone usage without resetting capacity',async()=>{
 const h=harness(async(route,body)=>route==='code-status'?{...metadata,activeDevices:2,deviceLimit:2}:route==='issue-code'?{staffId:body.staffId,enabled:true,version:body.expectedVersion+1}:{staffId:body.staffId,enabled:false,version:body.expectedVersion+1});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(h.node('staffSetupCodeResult').hidden,false);assert.equal(h.node('staffSetupDeviceUsage').textContent,'2 of 2 active phones');assert.match(h.node('staffSetupDeviceUsageNote').textContent,/Last checked/);await h.click('staffSetupCodeDisable');assert.equal(h.node('staffSetupDeviceUsage').textContent,'2 of 2 active phones');assert.equal(h.node('staffSetupCodeResult').hidden,true);
});
test('refreshing phone usage preserves a newly confirmed code and its copy action',async()=>{
 let reads=0;const h=harness(async(route,body)=>route==='code-status'?reads++?{...metadata,enabled:true,version:1,activeDevices:2,deviceLimit:2}:{...metadata,activeDevices:1,deviceLimit:2}:{staffId:body.staffId,enabled:true,version:1});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');const shown=h.node('staffSetupCodeValue').textContent;await h.click('staffSetupUsageRefresh');assert.equal(h.node('staffSetupDeviceUsage').textContent,'2 of 2 active phones');assert.equal(h.node('staffSetupCodeValue').textContent,shown);assert.equal(h.node('staffSetupCodeResult').hidden,false);assert.equal(h.node('staffSetupCodeCopy').disabled,false);await h.click('staffSetupCodeCopy');assert.equal(h.api.copied,'0123456789');
});
test('failed phone-usage refresh keeps the last checked count with an explicit stale message',async()=>{
 let reads=0;const h=harness(async()=>{if(reads++)throw Error('HQ connection unavailable.');return{...metadata,activeDevices:1,deviceLimit:2};});await h.controller.loadProfile();await h.click('staffSetupUsageRefresh');assert.equal(h.node('staffSetupDeviceUsage').textContent,'1 of 2 active phones');assert.match(h.node('staffSetupDeviceUsageNote').textContent,/connection unavailable.*last checked/);assert.equal(h.node('staffSetupUsageRefresh').disabled,false);
});
test('a late usage reply for a closed or different profile cannot reveal the previous staff count',async()=>{
 let finish,reads=0;const h=harness(async()=>reads++?new Promise(resolve=>{finish=()=>resolve({...metadata,activeDevices:2,deviceLimit:2});}):{...metadata,activeDevices:1,deviceLimit:2});await h.controller.loadProfile();const pending=h.click('staffSetupUsageRefresh');h.controller.clear();h.node('empProfileId').value='employee-b';finish();await pending;assert.equal(h.node('staffSetupDeviceUsage').textContent,'Phone usage not available');assert.equal(h.node('staffSetupCodeValue').textContent,'');
});
test('usage read begun before local issuance cannot clear its newer confirmed code',async()=>{
 let finish,reads=0;const h=harness(async(route,body)=>route==='code-status'?reads++?new Promise(resolve=>{finish=()=>resolve({...metadata,activeDevices:1,deviceLimit:2});}):{...metadata,activeDevices:0,deviceLimit:2}:{staffId:body.staffId,enabled:true,version:1});await h.controller.loadProfile();const pending=h.click('staffSetupUsageRefresh');await h.click('staffSetupCodeGenerate');const shown=h.node('staffSetupCodeValue').textContent;finish();await pending;assert.equal(h.node('staffSetupCodeValue').textContent,shown);assert.equal(h.node('staffSetupCodeResult').hidden,false);assert.equal(h.node('staffSetupDeviceUsage').textContent,'1 of 2 active phones');
});
test('usage refresh clears shown code only when HQ explicitly confirms a newer credential decision',async()=>{
 let reads=0;const h=harness(async(route,body)=>route==='code-status'?reads++?{...metadata,enabled:false,version:2,activeDevices:1,deviceLimit:2}:{...metadata,activeDevices:1,deviceLimit:2}:{staffId:body.staffId,enabled:true,version:1});await h.controller.loadProfile();await h.click('staffSetupCodeGenerate');assert.equal(h.node('staffSetupCodeResult').hidden,false);await h.click('staffSetupUsageRefresh');assert.equal(h.node('staffSetupCodeResult').hidden,true);assert.match(h.node('staffSetupCodeStatus').textContent,/status changed at HQ/);assert.equal(h.node('staffSetupCodeGenerate').textContent,'Replace setup code');
});
test('source integration precaches private UI and routes both single and bulk fleet operations',()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8'),sw=readFileSync(new URL('../takodeal-manager/sw.js',import.meta.url),'utf8'),module=readFileSync(new URL('../takodeal-manager/staff-setup-codes.js',import.meta.url),'utf8');
 assert.match(main,/installStaffSetupCodes\(window,document\)/);assert.equal((main.match(/staffSetupCodes\.routeDeviceChange/g)||[]).length,3);assert.match(html,/id="staffSetupCodePanel"/);assert.match(html,/staff-setup-codes\.css/);assert.match(sw,/staff-setup-codes\.js/);assert.doesNotMatch(module,/localStorage|sessionStorage|setDoc|updateDoc|console\.log/);
});
