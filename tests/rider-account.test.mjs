import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {installRiderAccount} from '../takodeal-delivery/rider-account.js';
import {normalizeRiderPhone,validateRiderPIN,riderApproved,riderStatus,riderStatusMessage,riderSubmittedAt} from '../takodeal-delivery/rider-account-model.js';

const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const photo=(name='sample.jpg',contents='synthetic-image')=>{const bytes=new TextEncoder().encode(contents);return {name,type:'image/jpeg',size:bytes.length,lastModified:1,arrayBuffer:async()=>bytes.slice().buffer};};
const base={name:'Synthetic Rider',phone:'09123456789',pin:'1234',status:'active',walletBalance:200,vehicle:'Sample motorcycle',plateNumber:'SYNTHETIC',joinedAt:{seconds:1791504000}};
function fixture({backend=firestoreHarness(),uid='anonymous-one',auth=true}={}) {
    const nodes=new Map(),events=[],subscriptions=[],reads=[],uploads=[],urls=[],local=new Map([['takodeal_rider_id','unverified-document-id']]);let authChanged;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],textContent:'',disabled:false});return nodes.get(id);};
    for(const [id,value] of Object.entries({loginPhone:base.phone,loginPin:base.pin,regName:base.name,regPhone:base.phone,regPin:base.pin,regPinConfirm:base.pin,regVehicle:base.vehicle,regPlate:base.plateNumber}))node(id).value=value;
    for(const id of ['regLicense','regORCR','regSelfie'])node(id).files=[photo(id+'.jpg')];
    const snapshot=ref=>({id:ref.id,exists:()=>backend.docs.has(ref.path),data:()=>structuredClone(backend.get(ref.path)),metadata:{fromCache:false}});
    const api={...backend.api,auth:{currentUser:auth?{uid}:null},crypto:{subtle:webcrypto.subtle,randomUUID},storage:{},console:{error(){}},
        localStorage:{getItem:key=>local.get(key),removeItem:key=>local.delete(key),setItem:(key,value)=>{throw Error('Account credentials must not be persisted: '+key);}},
        where:(key,op,value)=>({key,op,value}),
        getDocsFromServer:async q=>{reads.push({kind:'query',q});if(h.lookupWait)await h.lookupWait.promise;
            if(h.lookupError)throw h.lookupError;return {docs:[...backend.docs].filter(([path,data])=>path.startsWith(q.table+'/') && q.filters.every(filter=>filter.op==='in'?filter.value.includes(data[filter.key]):data[filter.key]===filter.value)).map(([path])=>snapshot(backend.ref(q.table,path.slice(q.table.length+1)))),metadata:{fromCache:false}};},
        getDocFromServer:async ref=>{reads.push({kind:'record',path:ref.path});if(h.recordWait)await h.recordWait.promise;if(h.recordError)throw h.recordError;return snapshot(ref);},
        onSnapshot:(ref,options,next,error)=>{const sub={ref,options,next,error,stops:0};subscriptions.push(sub);return ()=>sub.stops++;},
        onAuthStateChanged:(_auth,callback)=>{authChanged=callback;return ()=>{authChanged=null;};},
        ensureAuth:async()=>{h.authCalls++;if(h.authWait)await h.authWait.promise;if(h.authError)throw h.authError;if(!api.auth.currentUser)api.auth.currentUser={uid};},
        ref:(_storage,path)=>({path}),uploadBytes:async(ref,file)=>{uploads.push({path:ref.path,file});if(h.uploadWait)await h.uploadWait.promise;if(h.uploadError)throw h.uploadError;return {ref};},
        getDownloadURL:async ref=>{urls.push(ref.path);if(h.urlWait)await h.urlWait.promise;return 'https://example.invalid/'+ref.path;}};
    const h={api,backend,node,nodes,events,subscriptions,reads,uploads,urls,local,authCalls:0,
        setAuth(user){api.auth.currentUser=user;authChanged?.(user);},
        emit(sub,data,{cache=false}={}){sub.next({id:sub.ref.id,exists:()=>data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:cache}});}};
    h.account=installRiderAccount(api,{getElementById:node},{onActive:rider=>events.push({kind:'active',rider}),onRestricted:state=>events.push({kind:'restricted',state}),
        onSignedOut:()=>events.push({kind:'signed-out'}),onStatusError:state=>events.push({kind:'error',state})});return h;
}
function put(h,status='active',id='legacy-rider',extra={}) {h.backend.put('riders/'+id,{...base,status,...extra});return id;}

test('mobile normalization supports 09 and +63 while invalid phones and new non-four-digit PINs fail clearly',()=>{
    for(const input of ['09123456789','+63 912-345-6789','639123456789','(0912) 345 6789'])assert.equal(normalizeRiderPhone(input),base.phone);
    for(const input of ['', '0912', '02123456789','letters09123456789'])assert.throws(()=>normalizeRiderPhone(input),/mobile/);
    assert.equal(validateRiderPIN('0001','0001'),'0001');for(const pin of ['1','12345','four'])assert.throws(()=>validateRiderPIN(pin,pin),/4 digits/);
    assert.throws(()=>validateRiderPIN('1234','1235'),/do not match/);
});
test('only active/approved status enables deliveries and PH submission dates handle Firestore values',()=>{
    for(const status of ['active','approved',' Approved '])assert.equal(riderApproved(status),true);
    for(const status of [undefined,'pending_approval','rejected','banned','suspended','unknown',''])assert.equal(riderApproved(status),false);
    assert.equal(riderStatus('rejected'),'rejected');assert.equal(riderStatus('banned'),'suspended');
    assert.match(riderStatusMessage({status:'rejected',approvalReason:'Please contact Manager'}).message,/Please contact Manager/);
    assert.match(riderSubmittedAt({seconds:1791504000}),/2026/);assert.equal(riderSubmittedAt(null),'Submission date not recorded');
});
test('install clears legacy ID-only restoration without reading or activating any rider',()=>{
    const h=fixture();assert.equal(h.local.has('takodeal_rider_id'),false);assert.equal(h.reads.length,0);assert.equal(h.account.state().rider,null);
    assert.equal(h.subscriptions.length,0);assert.equal(h.events.length,0);assert.equal(h.account.isActive(),false);
});
test('login waits for anonymous auth before server reads and blocks overlapping taps',async()=>{
    const h=fixture({auth:false});put(h);h.authWait=deferred();const pending=h.account.login();assert.equal(h.node('btnLoginRider').disabled,true);
    assert.equal(h.reads.length,0);assert.equal(await h.account.login(),false);h.authWait.resolve();assert.equal(await pending,true);
    assert.equal(h.authCalls,1);assert.equal(h.account.isActive(),true);assert.equal(h.node('btnLoginRider').disabled,false);assert.equal(h.account.isBusy(),false);
});
test('auth failure is visible and never queries rider records',async()=>{
    const h=fixture({auth:false});h.authError=Error('Sign-in connection unavailable');assert.equal(await h.account.login(),false);
    assert.match(h.node('riderAuthStatus').textContent,/unavailable/);assert.equal(h.reads.length,0);assert.equal(h.account.isActive(),false);
});
test('pending, rejected, suspended and unknown accounts sign in to status only without active callbacks',async()=>{
    for(const status of ['pending_approval','rejected','banned','suspended',null]){
        const h=fixture();put(h,status);assert.equal(await h.account.login(),true);assert.equal(h.account.isActive(),false);
        assert.equal(h.events.some(event=>event.kind==='active'),false);assert.equal(h.events.at(-1).kind,'restricted');assert.ok(h.node('applicationStatus').textContent);
        await assert.rejects(h.account.requireActive(),/approval/);
    }
});
test('active and approved login sanitize PINs while legacy PIN authentication is retained in memory only',async()=>{
    for(const status of ['active','approved']){const h=fixture();put(h,status);assert.equal(await h.account.login(),true);assert.equal(h.account.isActive(),true);
        assert.equal(Object.hasOwn(h.account.state().rider,'pin'),false);assert.equal(Object.hasOwn(h.events.find(event=>event.kind==='active').rider,'pin'),false);}
    const h=fixture();put(h,'active','legacy-pin',{pin:'older-password'});h.node('loginPin').value='older-password';assert.equal(await h.account.login(),true);
    assert.equal(h.local.size,0);
});
test('wrong PIN and duplicate canonical phone records cannot select an arbitrary rider',async()=>{
    const wrong=fixture();put(wrong);wrong.node('loginPin').value='4321';assert.equal(await wrong.account.login(),false);assert.equal(wrong.account.state().rider,null);
    const duplicate=fixture();put(duplicate);put(duplicate,'active','another',{phone:'639123456789'});assert.equal(await duplicate.account.login(),false);
    assert.match(duplicate.node('riderAuthStatus').textContent,/more than one/);assert.equal(duplicate.events.some(event=>event.kind==='active'),false);
});
test('a cached approval result is refused and refresh can restore a new server confirmation',async()=>{
    const h=fixture();const id=put(h);await h.account.login();const sub=h.subscriptions[0];h.emit(sub,base,{cache:true});
    assert.equal(h.account.isActive(),false);assert.equal(h.events.at(-1).kind,'error');assert.equal(await h.account.refresh(),true);assert.equal(h.account.isActive(),true);
    assert.equal(h.subscriptions.length,1);assert.equal(h.account.state().rider.id,id);
});
test('Manager status updates revoke active access and approval can reopen the pending account without another login',async()=>{
    const h=fixture();put(h,'pending_approval');await h.account.login();const sub=h.subscriptions[0];assert.equal(h.account.isActive(),false);
    h.emit(sub,{...base,status:'active'});assert.equal(h.account.isActive(),true);const actor=h.account.captureActor();
    h.emit(sub,{...base,status:'banned',statusReason:'Review with Manager'});assert.equal(h.account.isActive(),false);assert.throws(()=>h.account.assertActor(actor),/approval/);
    assert.equal(h.events.at(-1).kind,'restricted');assert.match(h.node('applicationMessage').textContent,/Review with Manager/);
});
test('terminal status-listener failure holds services, clears its handle and manual refresh starts one replacement',async()=>{
    const h=fixture();put(h);await h.account.login();const old=h.subscriptions[0];old.error(Error('Status read unavailable'));
    assert.equal(old.stops,1);assert.equal(h.account.isActive(),false);assert.equal(h.events.at(-1).kind,'error');
    assert.equal(await h.account.refresh(),true);assert.equal(h.subscriptions.length,2);assert.equal(h.account.isActive(),true);
    h.emit(old,{...base,status:'banned'});assert.equal(h.account.isActive(),true);
});
test('account changes and same-rider re-login invalidate captured actors and stale snapshot callbacks',async()=>{
    const h=fixture();put(h);await h.account.login();const actor=h.account.captureActor(),old=h.subscriptions[0];h.account.logout();assert.equal(old.stops,1);
    h.node('loginPin').value='1234';await h.account.login();assert.throws(()=>h.account.assertActor(actor),/session changed/);h.emit(old,{...base,status:'banned'});assert.equal(h.account.isActive(),true);
    h.setAuth({uid:'other-auth'});assert.equal(h.account.state().rider,null);assert.equal(h.account.isActive(),false);assert.equal(h.subscriptions[1].stops,1);
});
test('logout during a slow login cannot reactivate the older account',async()=>{
    const h=fixture();put(h);h.recordWait=deferred();const pending=h.account.login();await tick();h.account.logout();h.recordWait.resolve();assert.equal(await pending,false);
    assert.equal(h.account.state().rider,null);assert.equal(h.events.some(event=>event.kind==='active'),false);assert.equal(h.account.isBusy(),false);
});
test('registration requires a matching PIN and three bounded image files before auth or uploads',async()=>{
    const mismatch=fixture();mismatch.node('regPinConfirm').value='4321';assert.equal(await mismatch.account.register(),false);assert.match(mismatch.node('registrationStatus').textContent,/match/);assert.equal(mismatch.authCalls,0);
    for(const file of [undefined,{...photo(),size:0},{...photo(),size:9*1024*1024},{...photo('malware.exe'),type:'application/octet-stream'},{...photo('camera.heic'),type:'image/heic'}]){
        const h=fixture();h.node('regLicense').files=file?[file]:[];assert.equal(await h.account.register(),false);assert.equal(h.uploads.length,0);assert.equal(h.authCalls,0);
    }
});
test('registration checks legacy duplicates before uploading and never overwrites an existing approved account',async()=>{
    const h=fixture();put(h,'active','older-rider');const before=structuredClone(h.backend.get('riders/older-rider'));
    assert.equal(await h.account.register(),false);assert.equal(h.uploads.length,0);assert.match(h.node('registrationStatus').textContent,/already exists/);
    assert.deepEqual(h.backend.get('riders/older-rider'),before);assert.equal(h.account.state().rider,null);
});
test('successful registration creates one pending record, enters status view and never grants delivery access',async()=>{
    const h=fixture();assert.equal(await h.account.register(),true);const rows=[...h.backend.docs.keys()].filter(path=>path.startsWith('riders/'));
    assert.deepEqual(rows,['riders/rider-phone-'+base.phone]);const saved=h.backend.get(rows[0]);assert.equal(saved.status,'pending_approval');assert.equal(saved.walletBalance,0);assert.equal(saved.isAcceptingOrders,false);
    assert.equal(h.uploads.length,3);assert.equal(h.account.isActive(),false);assert.equal(h.events.at(-1).kind,'restricted');assert.equal(h.node('regPin').value,'');assert.equal(h.node('regPinConfirm').value,'');
    assert.equal(h.account.state().rider.id,'rider-phone-'+base.phone);assert.equal(h.local.size,0);
});
test('slow registration blocks duplicate taps and a lost acknowledgement reuses the exact record and uploaded URLs',async()=>{
    const h=fixture();h.uploadWait=deferred();h.backend.loseNextAck();const first=h.account.register();await tick();
    assert.equal(h.account.isBusy(),true);assert.equal(await h.account.register(),false);h.uploadWait.resolve();assert.equal(await first,false);assert.match(h.node('registrationStatus').textContent,/Connection lost/);
    const original=structuredClone(h.backend.get('riders/rider-phone-'+base.phone));assert.equal(h.uploads.length,3);
    assert.equal(await h.account.register(),true);assert.equal(h.uploads.length,3);assert.deepEqual(h.backend.get('riders/rider-phone-'+base.phone),original);
});
test('a changed retry photo with identical file metadata is rejected rather than reassociated with the saved application',async()=>{
    const h=fixture();h.backend.loseNextAck();assert.equal(await h.account.register(),false);const old=structuredClone(h.backend.get('riders/rider-phone-'+base.phone));
    h.node('regLicense').files=[photo('regLicense.jpg','different-image')];assert.equal(await h.account.register(),false);assert.equal(h.uploads.length,3);
    assert.deepEqual(h.backend.get('riders/rider-phone-'+base.phone),old);
});
test('two concurrent updated clients registering the same phone cannot create two applications',async()=>{
    const backend=firestoreHarness(),a=fixture({backend,uid:'one'}),b=fixture({backend,uid:'two'});const result=await Promise.all([a.account.register(),b.account.register()]);
    assert.equal(result.filter(Boolean).length,1);assert.equal([...backend.docs.keys()].filter(path=>path.startsWith('riders/')).length,1);
    const loser=result[0]?b:a;assert.match(loser.node('registrationStatus').textContent,/already exists/);assert.equal(loser.account.state().rider,null);
});
test('a legacy application arriving during uploads is checked again before creating a new record',async()=>{
    const h=fixture();h.uploadWait=deferred();const pending=h.account.register();await tick();put(h,'pending_approval','late-legacy');h.uploadWait.resolve();
    assert.equal(await pending,false);assert.match(h.node('registrationStatus').textContent,/already exists/);
    assert.equal(h.backend.get('riders/rider-phone-'+base.phone),undefined);assert.equal(h.account.state().rider,null);
});
test('a PIN changed by Manager after a lost acknowledgement cannot be bypassed through registration retry',async()=>{
    const h=fixture();h.backend.loseNextAck();assert.equal(await h.account.register(),false);const path='riders/rider-phone-'+base.phone;
    h.backend.put(path,{...h.backend.get(path),pin:'4321',status:'active',walletBalance:700});
    assert.equal(await h.account.register(),false);assert.equal(h.account.state().rider,null);assert.equal(h.backend.get(path).pin,'4321');assert.equal(h.backend.get(path).walletBalance,700);
    assert.equal(h.events.some(event=>event.kind==='active'),false);
});
test('logout or auth change during document upload cannot publish an application or show the old account',async()=>{
    for(const change of ['logout','auth-away-and-back']){
        const h=fixture();h.uploadWait=deferred();const pending=h.account.register();await tick();
        if(change==='logout')h.account.logout();else{h.setAuth({uid:'other'});h.setAuth({uid:'anonymous-one'});}
        h.uploadWait.resolve();assert.equal(await pending,false);assert.equal([...h.backend.docs.keys()].filter(path=>path.startsWith('riders/')).length,0);
        assert.equal(h.account.state().rider,null);assert.equal(h.events.some(event=>event.kind==='active'),false);
    }
});
test('a transient image upload failure keeps the form and retry resumes with existing completed photos',async()=>{
    const h=fixture(),upload=h.api.uploadBytes;let calls=0;h.api.uploadBytes=async(...args)=>{calls++;if(calls===2)throw Error('Image connection failed');return upload(...args);};
    assert.equal(await h.account.register(),false);assert.equal(h.node('regPin').value,'1234');assert.match(h.node('registrationStatus').textContent,/connection failed/);
    assert.equal(await h.account.register(),true);assert.equal(h.uploads.length,3);assert.equal(h.urls.length,3);
});
test('requireActive performs a new server check, holds revoked status and deduplicates concurrent refreshes',async()=>{
    const h=fixture();const id=put(h);await h.account.login();const before=h.reads.length;h.recordWait=deferred();
    const a=h.account.requireActive(),b=h.account.refresh();assert.equal(h.reads.length,before+1);h.backend.put('riders/'+id,{...base,status:'rejected'});h.recordWait.resolve();
    assert.equal(await b,true);await assert.rejects(a,/approval/);assert.equal(h.account.isActive(),false);assert.equal(h.account.isBusy(),false);
});
