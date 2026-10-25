import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStaffDeviceSetup,hashSetupCode,verifySetupCode,activeSetupStaff,PRODUCTION_ORIGINS,MAX_REQUEST_BYTES,RATE_LIMITS} from '../functions/staff-device-setup/service.mjs';

const token='fixture_firebase_token_1234567890',setupCode='0753146290',otherCode='0296841753';
const owner={uid:'owner_uid',email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const anon=uid=>({uid,firebase:{sign_in_provider:'anonymous'}});
const staff={cashierName:'Sample Staff',branch:'Maa',status:'Active',active:true,pin:'1234'};
const digest=value=>createHash('sha256').update(value).digest('hex');
const fakeHash=async value=>({algorithm:'scrypt-v1',N:16384,r:8,p:1,salt:'a'.repeat(32),hash:digest('sample-only-'+value)});
const fakeVerify=async(value,verifier)=>verifier.hash===digest('sample-only-'+value);
const issue={staffId:'staff_one',code:setupCode,expectedVersion:0,operationId:'operation_issue_one'};
const activation={staffId:'staff_one',code:setupCode,deviceId:'DEV-TEST-ONE',deviceName:'Sample phone',operationId:'operation_activate_one'};
function fixture({enabled=true,realCrypto=false}={}) {
 const docs=new Map([['cashiers/staff_one',structuredClone(staff)],['cashiers/staff_two',{...staff,cashierName:'Sample Second',branch:'Citygate'}]]);
 if(enabled!==null)docs.set('staff_app_setup_config/current',{enabled,revision:1,protocolVersion:1});
 const state={docs,actor:structuredClone(owner),time:1792900800000,ip:'203.0.113.4',verifications:[],commits:[],pending:Promise.resolve(),failAfterCommit:false,hooks:{},hashCalls:0};
 const service=createStaffDeviceSetup({verifyToken:async(value,revoked)=>{state.verifications.push([value,revoked]);if(value!==token||state.revoked)throw Error('Authentication private error '+setupCode);return structuredClone(state.actor);},now:()=>state.time,
  hashCode:realCrypto?hashSetupCode:async value=>{state.hashCalls++;return fakeHash(value);},verifyCode:realCrypto?verifySetupCode:fakeVerify,
  store:{transaction:callback=>{const operation=state.pending.then(async()=>{const working=new Map([...docs].map(([k,v])=>[k,structuredClone(v)])),writes=[];let wrote=false;
   const result=await callback({get:async path=>{assert.equal(wrote,false,'transaction read after write');await state.hooks.beforeRead?.(path);return structuredClone(working.get(path)??null);},set:(path,data)=>{wrote=true;working.set(path,structuredClone(data));writes.push(['set',path]);},delete:path=>{wrote=true;working.delete(path);writes.push(['delete',path]);}});
   await state.hooks.beforeCommit?.(writes);docs.clear();for(const [key,value]of working)docs.set(key,value);if(writes.length)state.commits.push(writes);
   if(state.failAfterCommit&&writes.some(([,path])=>path.startsWith('staff_setup_operations/'))){state.failAfterCommit=false;throw Error('Lost acknowledgement with private details '+setupCode);}return result;
  });state.pending=operation.catch(()=>{});return operation;}}
 });
 state.request=(path,body={},options={})=>service({method:'POST',path,query:{},origin:['/policy','/code-status','/issue-code','/disable-code','/device-action'].includes(path)?PRODUCTION_ORIGINS[1]:PRODUCTION_ORIGINS[0],contentType:'application/json',authorization:'Bearer '+token,rawSize:Buffer.byteLength(JSON.stringify(body)),body:structuredClone(body),trustedIP:state.ip,...options});
 state.owner=()=>{state.actor=structuredClone(owner);};state.staff=(uid='anon_one')=>{state.actor=anon(uid);};
 state.issue=async(body=issue)=>{state.owner();const result=await state.request('/issue-code',body);assert.equal(result.status,200,JSON.stringify(result.body));return result;};
 state.activate=async(body=activation,uid='anon_one')=>{state.staff(uid);return state.request('/activate',body);};
 state.action=async(action,operationId='operation_action_'+action)=>{state.owner();return state.request('/device-action',{deviceId:activation.deviceId,action,operationId});};
 return state;
}
async function enrolled(options){const f=fixture(options);await f.issue();const result=await f.activate();assert.equal(result.status,200,JSON.stringify(result.body));return f;}

test('real setup code hashes use unique random salts, slow verifier and constant-length comparison',async()=>{
 const [a,b]=await Promise.all([hashSetupCode(setupCode),hashSetupCode(setupCode)]);assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);assert.equal(a.algorithm,'scrypt-v1');
 assert.equal(await verifySetupCode(setupCode,a),true);assert.equal(await verifySetupCode(otherCode,a),false);assert.equal(await verifySetupCode(setupCode,{...a,N:2}),false);assert.equal(await verifySetupCode('1234',a),false);
 await assert.rejects(hashSetupCode(1234567890));
});
test('configuration is a nonsecret unauthenticated bootstrap and defaults disabled when absent',async()=>{
 const f=fixture({enabled:null});const result=await f.request('/config',{}, {authorization:undefined});assert.equal(result.status,200);assert.deepEqual(result.body,{enabled:false,revision:0,protocolVersion:1});assert.equal(f.commits.length,0);assert.equal(f.verifications.length,0);
});
test('policy changes require verified Owner and expected revision; repeated operation is stable',async()=>{
 const f=fixture({enabled:false}),body={enabled:true,expectedRevision:1,operationId:'operation_policy_one'};
 const result=await f.request('/policy',body);assert.equal(result.status,200);assert.deepEqual(result.body,{enabled:true,revision:2,protocolVersion:1});
 const commits=f.commits.length;assert.deepEqual((await f.request('/policy',body)).body,result.body);assert.equal(f.commits.length,commits);
 assert.equal((await f.request('/policy',{...body,operationId:'operation_policy_other'})).status,409);
 assert.equal((await f.request('/policy',{...body,enabled:false})).status,409);
});
test('Owner issue code stores only a salted verifier and status/audit contain no code',async()=>{
 const f=fixture(),result=await f.issue();assert.deepEqual(Object.keys(result.body).sort(),['enabled','issuedAt','staffId','version']);assert.equal(result.body.version,1);
 const saved=f.docs.get('staff_setup_credentials/staff_one');assert.equal(saved.enabled,true);assert.equal(saved.staffId,'staff_one');assert.equal(saved.verifier.hash,(await fakeHash(setupCode)).hash);
 assert.equal(JSON.stringify([...f.docs]).includes(setupCode),false);assert.equal(JSON.stringify(result).includes(setupCode),false);
 assert.ok(f.verifications.every(([,checkRevoked])=>checkRevoked===true));
});
test('Owner code status for an unissued account is disabled version zero',async()=>{
 const f=fixture();assert.deepEqual((await f.request('/code-status',{staffId:'staff_one'})).body,{staffId:'staff_one',enabled:false,version:0,issuedAt:null});
});
test('code issue is idempotent after lost acknowledgment and rejects altered code or staff',async()=>{
 const f=fixture();f.failAfterCommit=true;assert.equal((await f.request('/issue-code',issue)).status,503);assert.equal(f.docs.get('staff_setup_credentials/staff_one').version,1);
 const commits=f.commits.length;const retry=await f.request('/issue-code',issue);assert.equal(retry.status,200);assert.equal(retry.body.version,1);assert.equal(f.commits.length,commits);
 assert.equal((await f.request('/issue-code',{...issue,code:otherCode})).status,409);assert.equal((await f.request('/issue-code',{...issue,staffId:'staff_two'})).status,409);
});
test('concurrent same-code issuance converges and concurrent different operations cannot share old version',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.request('/issue-code',issue),f.request('/issue-code',issue)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(f.docs.get('staff_setup_credentials/staff_one').version,1);assert.equal(f.commits.length,1);
 const [c,d]=await Promise.all([f.request('/issue-code',{...issue,expectedVersion:1,operationId:'operation_issue_next'}),f.request('/issue-code',{...issue,expectedVersion:1,operationId:'operation_issue_conflict'})]);assert.deepEqual([c.status,d.status].sort(),[200,409]);
});
test('a delayed old code acknowledgment cannot present a replaced or disabled code as current',async()=>{
 const f=fixture();await f.issue();await f.issue({...issue,expectedVersion:1,code:otherCode,operationId:'operation_issue_replace'});
 const before=f.commits.length;assert.equal((await f.request('/issue-code',issue)).status,409);assert.equal(f.commits.length,before);assert.equal(f.docs.get('staff_setup_credentials/staff_one').version,2);
 const disabled={staffId:'staff_one',expectedVersion:2,operationId:'operation_disable_latest'};assert.equal((await f.request('/disable-code',disabled)).status,200);assert.equal((await f.request('/disable-code',disabled)).status,200);
 await f.issue({...issue,expectedVersion:3,operationId:'operation_issue_reenable'});assert.equal((await f.request('/disable-code',disabled)).status,409);
});
test('a delayed old policy acknowledgment cannot hide a newer rollout change',async()=>{
 const f=fixture({enabled:false}),first={enabled:true,expectedRevision:1,operationId:'operation_policy_enable'};
 assert.equal((await f.request('/policy',first)).status,200);assert.equal((await f.request('/policy',{enabled:false,expectedRevision:2,operationId:'operation_policy_disable'})).status,200);const before=f.commits.length;
 assert.equal((await f.request('/policy',first)).status,409);assert.equal(f.commits.length,before);assert.equal(f.docs.get('staff_app_setup_config/current').enabled,false);
});
test('correct code automatically activates one anonymous UID and derives branch/name from current profile',async()=>{
 const f=fixture();await f.issue();const result=await f.activate();assert.equal(result.status,200);assert.deepEqual(result.body,{enabled:true,mode:'protected',device:{staffId:'staff_one',staffName:'Sample Staff',branch:'Maa',deviceId:activation.deviceId,status:'Active'}});
 const binding=f.docs.get('staff_app_bindings/anon_one'),mirror=f.docs.get('pos_devices/'+activation.deviceId),index=f.docs.get('staff_app_device_index/'+activation.deviceId);assert.equal(binding.status,'Active');assert.equal(binding.codeVersion,1);assert.equal(mirror.setupVersion,1);assert.equal(mirror.setupUid,'anon_one');assert.equal(mirror.appType,'Staff');assert.equal(mirror.staffId,'staff_one');assert.equal(index.uid,'anon_one');
 const writes=f.commits.at(-1);assert.deepEqual(writes.map(([,p])=>p).sort(),['pos_devices/'+activation.deviceId,'staff_app_bindings/anon_one','staff_app_device_index/'+activation.deviceId,'staff_setup_audit/'+activation.operationId,'staff_setup_operations/'+activation.operationId].sort());
});
test('wrong, absent and disabled credentials return the same generic invalid-code result with no binding',async()=>{
 for(const mode of ['wrong','absent','disabled']){const f=fixture();if(mode!=='absent')await f.issue();if(mode==='disabled'){f.owner();assert.equal((await f.request('/disable-code',{staffId:'staff_one',expectedVersion:1,operationId:'operation_disable_one'})).status,200);}const result=await f.activate({...activation,code:mode==='wrong'?otherCode:setupCode});assert.equal(result.status,403);assert.deepEqual(result.body,{error:{code:'setup-code-invalid',message:'The setup code could not be verified. Check it with HQ and try again.'}});assert.equal(f.docs.has('staff_app_bindings/anon_one'),false);assert.equal(f.docs.has('pos_devices/'+activation.deviceId),false);}
});
test('reusable code can enroll another fresh phone and uid but cannot switch an existing binding',async()=>{
 const f=await enrolled();const second={...activation,deviceId:'DEV-TEST-TWO',deviceName:'Second phone',operationId:'operation_activate_two'};assert.equal((await f.activate(second,'anon_two')).status,200);
 assert.equal((await f.activate({...activation,operationId:'operation_activate_other',staffId:'staff_two'})).status,403);
 assert.equal((await f.activate({...activation,operationId:'operation_activate_other',deviceId:'DEV-TEST-THREE'})).status,403);
 assert.equal(f.docs.get('staff_app_bindings/anon_one').staffId,'staff_one');
});
test('activation retry after lost acknowledgment confirms fresh bound state without duplicating registration',async()=>{
 const f=fixture();await f.issue();f.failAfterCommit=true;assert.equal((await f.activate()).status,503);const before=f.commits.filter(rows=>rows.some(([,p])=>p.startsWith('staff_setup_operations/'))).length;
 const retry=await f.activate();assert.equal(retry.status,200);assert.equal(retry.body.device.status,'Active');assert.equal(f.commits.filter(rows=>rows.some(([,p])=>p.startsWith('staff_setup_operations/'))).length,before);
 assert.equal((await f.activate({...activation,deviceName:'Changed retry name'})).status,409);assert.equal((await f.activate({...activation,code:otherCode})).status,409);
});
test('code rotation invalidates old future setup attempts while retaining existing active devices',async()=>{
 const f=await enrolled();await f.issue({...issue,code:otherCode,expectedVersion:1,operationId:'operation_issue_rotate'});f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Active');
 assert.equal((await f.activate()).status,200,'original lost-ack retry uses original proof, not rotated code');
 const next={...activation,deviceId:'DEV-TEST-TWO',operationId:'operation_activate_two'};assert.equal((await f.activate(next,'anon_two')).status,403);assert.equal((await f.activate({...next,code:otherCode},'anon_two')).status,200);
});
test('disabling a code blocks future enrollment without revoking an active binding',async()=>{
 const f=await enrolled();f.owner();const disabled=await f.request('/disable-code',{staffId:'staff_one',expectedVersion:1,operationId:'operation_disable_one'});assert.equal(disabled.status,200);assert.equal(disabled.body.enabled,false);assert.equal(disabled.body.version,2);assert.equal(Object.hasOwn(f.docs.get('staff_setup_credentials/staff_one'),'verifier'),false);
 f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Active');assert.equal((await f.activate({...activation,deviceId:'DEV-TEST-TWO',operationId:'operation_activate_two'},'anon_two')).status,403);
});
test('Owner block updates binding and mirror atomically; Staff cannot self-unpause via activation replay',async()=>{
 const f=await enrolled();const result=await f.action('block');assert.equal(result.status,200);assert.equal(result.body.status,'Blocked');assert.equal(f.docs.get('staff_app_bindings/anon_one').status,'Blocked');assert.equal(f.docs.get('pos_devices/'+activation.deviceId).status,'Blocked');assert.equal((await f.activate()).status,403);
 assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Blocked');assert.equal((await f.action('unblock')).status,200);f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Active');
});
test('delete retains immutable device index tombstone and a deleted binding that cannot be revived',async()=>{
 const f=await enrolled(),index=structuredClone(f.docs.get('staff_app_device_index/'+activation.deviceId));assert.equal((await f.action('delete')).status,200);assert.equal(f.docs.has('pos_devices/'+activation.deviceId),false);assert.deepEqual(f.docs.get('staff_app_device_index/'+activation.deviceId),index);assert.equal(f.docs.get('staff_app_bindings/anon_one').status,'Deleted');
 f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Deleted');assert.equal((await f.activate()).status,403);assert.equal((await f.action('unblock')).status,409);
 assert.equal((await f.activate({...activation,operationId:'operation_reclaim_deleted'},'anon_two')).status,403);assert.deepEqual(f.docs.get('staff_app_device_index/'+activation.deviceId),index);
});
test('a delayed old device action cannot acknowledge a newer action as its own result',async()=>{
 const f=await enrolled();const block={deviceId:activation.deviceId,action:'block',operationId:'operation_block_first'};f.owner();assert.equal((await f.request('/device-action',block)).status,200);assert.equal((await f.request('/device-action',block)).status,200);
 assert.equal((await f.action('unblock','operation_unblock_newer')).status,200);f.owner();const before=f.commits.length;assert.equal((await f.request('/device-action',block)).status,409);assert.equal(f.commits.length,before);assert.equal(f.docs.get('staff_app_bindings/anon_one').status,'Active');
});
test('stolen protected device ID cannot be used by a fresh UID, even after rollout disabled',async()=>{
 const f=await enrolled();f.docs.set('staff_app_setup_config/current',{enabled:false,revision:2,protocolVersion:1});f.staff('anon_attacker');assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).status,403);assert.equal((await f.activate({...activation,operationId:'operation_stolen_device'},'anon_attacker')).status,409);
 f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).body.device.status,'Active');
});
test('a legacy public Active record never becomes protected access without new enrollment',async()=>{
 const f=fixture({enabled:false});f.docs.set('pos_devices/'+activation.deviceId,{deviceId:activation.deviceId,status:'Active',appType:'Staff',branch:'Maa'});f.staff();assert.deepEqual((await f.request('/device-status',{deviceId:activation.deviceId})).body,{enabled:false,mode:'legacy',device:null});
 f.docs.set('staff_app_setup_config/current',{enabled:true,revision:2,protocolVersion:1});assert.deepEqual((await f.request('/device-status',{deviceId:activation.deviceId})).body,{enabled:true,mode:'protected',device:null});await f.issue();assert.equal((await f.activate()).status,403);assert.equal(f.docs.get('pos_devices/'+activation.deviceId).status,'Active');
});
test('orphaned protected mirror or index fails closed rather than returning legacy mode',async()=>{
 for(const mode of ['mirror','index']){const f=fixture({enabled:false});if(mode==='mirror')f.docs.set('pos_devices/'+activation.deviceId,{setupUid:'anon_someone',status:'Active'});else f.docs.set('staff_app_device_index/'+activation.deviceId,{uid:'anon_someone'});f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).status,403);}
});
test('incomplete or mismatched protected mirror cannot authorize a bound phone',async()=>{
 for(const mode of ['missing','uid','staff','branch','appType']){const f=await enrolled(),path='pos_devices/'+activation.deviceId;if(mode==='missing')f.docs.delete(path);else{const mirror=f.docs.get(path);if(mode==='uid')mirror.setupUid='another_uid';if(mode==='staff')mirror.staffId='staff_two';if(mode==='branch')mirror.branch='Citygate';if(mode==='appType')mirror.appType='Cashier';}f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).status,403);}
});
test('revocation or branch change blocks fresh status and activation replay; unblocking requires review',async()=>{
 for(const edit of [{status:'Revoked'},{pin:'REVOKED'},{active:false},{branch:'Citygate'}]){const f=await enrolled();Object.assign(f.docs.get('cashiers/staff_one'),edit);f.staff();const status=await f.request('/device-status',{deviceId:activation.deviceId});assert.equal(status.status,200);assert.equal(status.body.device.status,'Blocked');assert.equal((await f.activate()).status,403);assert.equal((await f.action('unblock')).status,409);}
});
for(const mutation of [{status:'Blocked'},{status:'rEvOkEd'},{status:'Terminated'},{status:'Resigned'},{status:'Inactive'},{status:'Disabled'},{status:'Archived'},{status:'Deleted'},{pin:' revoked '},{pin:'BLOCKED'},{active:false},{archived:true},{blocked:true},{branch:''},{cashierName:''}]){
 test('inactive Staff cannot receive or use setup code: '+JSON.stringify(mutation),async()=>{const f=fixture();await f.issue();Object.assign(f.docs.get('cashiers/staff_one'),mutation);assert.equal(activeSetupStaff(f.docs.get('cashiers/staff_one')),false);f.owner();assert.equal((await f.request('/issue-code',{...issue,expectedVersion:1,operationId:'operation_issue_inactive'})).status,409);assert.equal((await f.activate()).status,403);});
}
test('unknown staff returns generic invalid setup response without identity leak',async()=>{
 const f=fixture();const response=await f.activate({...activation,staffId:'missing_staff'});assert.equal(response.status,403);assert.equal(response.body.error.code,'setup-code-invalid');assert.equal(JSON.stringify(response.body).includes('missing_staff'),false);
});
test('Owner can inspect another device but unverified or wrong identity cannot manage codes or policy',async()=>{
 const f=await enrolled();f.owner();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId},{origin:PRODUCTION_ORIGINS[1]})).body.device.staffId,'staff_one');
 for(const actor of [anon('anon_one'),{...owner,email_verified:false},{...owner,email:'other@example.com'},{...owner,email:'jgo031996@gmail.com.attacker.example'}]){f.actor=actor;assert.equal((await f.request('/code-status',{staffId:'staff_one'})).status,403);assert.equal((await f.request('/policy',{enabled:false,expectedRevision:1,operationId:'operation_policy_denied'})).status,403);assert.equal((await f.request('/issue-code',issue)).status,403);}
});
test('IP changes cannot evade UID attempt limit and attempts store no raw IP or code',async()=>{
 const f=fixture();await f.issue();for(let i=0;i<RATE_LIMITS.uid;i++){f.ip='203.0.113.'+(i+1);assert.equal((await f.activate({...activation,code:otherCode,operationId:'operation_attempt_'+i})).status,403);}f.ip='198.51.100.9';const blocked=await f.activate({...activation,operationId:'operation_attempt_correct'});assert.equal(blocked.status,429);assert.equal(f.docs.has('staff_app_bindings/anon_one'),false);
 const attempts=[...f.docs].filter(([key])=>key.startsWith('staff_setup_attempts/'));assert.ok(attempts.length);assert.equal(JSON.stringify(attempts).includes('203.0.113'),false);assert.equal(JSON.stringify(attempts).includes(setupCode),false);f.time+=RATE_LIMITS.windowMs+1;assert.equal((await f.activate({...activation,operationId:'operation_attempt_later'})).status,200);
});
test('a shared IP bucket blocks rotating UIDs and global bucket blocks rotating UID plus IP',async()=>{
 for(const mode of ['ip','global']){const f=fixture();await f.issue();const key='staff_setup_attempts/'+mode+'-'+digest(mode==='ip'?f.ip:'activation');f.docs.set(key,{protocolVersion:1,kind:mode,count:RATE_LIMITS[mode],windowStart:f.time,updatedAt:new Date(f.time).toISOString()});assert.equal((await f.activate()).status,429);assert.equal(f.docs.has('staff_app_bindings/anon_one'),false);}
});
test('server clock moving backwards cannot reset a current attempt bucket',async()=>{
 const f=fixture();await f.issue();const path='staff_setup_attempts/uid-'+digest('anon_one');f.docs.set(path,{count:RATE_LIMITS.uid,windowStart:f.time+10000});assert.equal((await f.activate()).status,429);
});
test('failed admission never commits credentials, binding or mirror partially',async()=>{
 const f=fixture();await f.issue();f.hooks.beforeCommit=writes=>{if(writes.some(([,p])=>p.startsWith('staff_app_bindings/')))throw Error('Fake datastore failure containing '+setupCode);};const result=await f.activate();assert.equal(result.status,503);assert.equal(JSON.stringify(result).includes(setupCode),false);assert.equal(f.docs.has('staff_app_bindings/anon_one'),false);assert.equal(f.docs.has('pos_devices/'+activation.deviceId),false);assert.equal(f.docs.has('staff_setup_operations/'+activation.operationId),false);
});
test('concurrent UIDs cannot claim the same protected device ID',async()=>{
 const f=fixture();await f.issue();f.staff('anon_one');const a=f.request('/activate',activation);f.staff('anon_two');const b=f.request('/activate',{...activation,operationId:'operation_activate_concurrent'});const results=await Promise.all([a,b]);assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);assert.equal([...f.docs.keys()].filter(p=>p.startsWith('staff_app_bindings/')).length,1);
});
test('orphan operation or audit is never silently overwritten',async()=>{
 for(const prefix of ['staff_setup_operations/','staff_setup_audit/']){const f=fixture();f.docs.set(prefix+issue.operationId,{preserve:'original'});const response=await f.request('/issue-code',issue);assert.equal(response.status,503);assert.deepEqual(f.docs.get(prefix+issue.operationId),{preserve:'original'});assert.equal(f.docs.has('staff_setup_credentials/staff_one'),false);}
});
test('malformed server-owned policy and credentials fail closed',async()=>{
 const f=fixture();f.docs.set('staff_app_setup_config/current',{enabled:false,revision:1,protocolVersion:99});f.staff();assert.equal((await f.request('/device-status',{deviceId:activation.deviceId})).status,503);
 const g=fixture();g.docs.set('staff_setup_credentials/staff_one',{staffId:'staff_one',enabled:true,version:1,issuedAt:'2026-10-25'});assert.equal((await g.activate()).status,503);
});
test('strict request envelope rejects methods, unknown routes, queries and content types before writes',async()=>{
 const f=fixture();for(const options of [{method:'GET'},{path:'/activate/'},{query:{code:setupCode}},{contentType:'text/plain'},{rawSize:MAX_REQUEST_BYTES+1},{rawSize:-1},{origin:'https://evil.example'},{origin:'https://takodeal-staff.vercel.app.attacker.example'}]){const response=await f.request('/config',{},options);assert.ok(response.status>=400);assert.equal(f.commits.length,0);assert.equal(JSON.stringify(response.body).includes(setupCode),false);}
});
test('strict request schemas reject identity smuggling and numeric/truncated codes',async()=>{
 const f=fixture();const bad=[{...activation,branch:'Citygate'},{...activation,uid:'another_uid'},{...activation,code:753146290},{...activation,code:'753146290'},{...activation,staffId:'../staff_one'},{...activation,deviceId:'DEV-../ESCAPE'},{...activation,deviceName:'\nPhone'},{...activation,deviceName:'x'.repeat(81)},{...activation,operationId:'short'}];f.staff();for(const body of bad)assert.equal((await f.request('/activate',body)).status,400);assert.equal(f.commits.length,0);
});
test('invalid and revoked tokens never reach private operations and raw verifier errors are hidden',async()=>{
 const f=fixture();for(const authorization of [undefined,'Bearer short','Basic '+token,'Bearer '+token+'?'])assert.equal((await f.request('/code-status',{staffId:'staff_one'},{authorization})).status,401);f.revoked=true;const result=await f.request('/code-status',{staffId:'staff_one'});assert.equal(result.status,401);assert.equal(JSON.stringify(result).includes(setupCode),false);assert.equal(f.commits.length,0);
});
test('CORS preflight only allows POST authorization/content-type for exact production origins',async()=>{
 const f=fixture(),options={method:'OPTIONS',authorization:undefined,preflightMethod:'POST',preflightHeaders:'authorization, content-type'};const result=await f.request('/activate',{},options);assert.equal(result.status,204);assert.equal(result.body,null);assert.equal(result.headers['Access-Control-Allow-Origin'],PRODUCTION_ORIGINS[0]);assert.equal(f.verifications.length,0);
 assert.equal((await f.request('/activate',{}, {...options,preflightHeaders:'x-client-secret'})).status,403);assert.equal((await f.request('/activate',{}, {...options,preflightMethod:'DELETE'})).status,403);
});
test('Owner issuance is only accepted from Owner origin and activation only from Staff origin/provider',async()=>{
 const f=fixture();assert.equal((await f.request('/issue-code',issue,{origin:PRODUCTION_ORIGINS[0]})).status,403);await f.issue();f.staff();assert.equal((await f.request('/activate',activation,{origin:PRODUCTION_ORIGINS[1]})).status,403);f.owner();assert.equal((await f.request('/activate',activation)).status,403);assert.equal(f.docs.has('staff_app_bindings/owner_uid'),false);
});
test('all replies disable caching and successful responses never reveal setup verifier',async()=>{
 const f=fixture(),response=await f.issue();assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['Pragma'],'no-cache');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.equal(JSON.stringify(response).includes('scrypt'),false);assert.equal(JSON.stringify(response).includes('salt'),false);
});
