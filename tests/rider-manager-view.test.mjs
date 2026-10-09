import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {configureRiderManagerAuthority} from '../takodeal-manager/rider-management.js';
import {installRiderManagementViews} from '../takodeal-manager/rider-management-view.js';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
function fixture({branches=['All'],permissions=['riders']}={}){
    const h=firestoreHarness(),user={uid:'hq',email:'manager@example.test',emailVerified:true},saved={email:user.email,fullName:'Sample Manager',role:'Manager',assignedBranch:branches,permissions,pin:'1111',active:true};
    h.put('hq_managers/hq',saved);h.put('riders/a',{name:"O'Brien <img src=x onerror=alert(1)>",phone:'09000000001',vehicle:'Motorcycle',plateNumber:'SAMPLE-A',status:'pending_approval',walletBalance:'123.45',licenseUrl:'https://example.invalid/license.jpg',orcrUrl:'javascript:alert(1)',selfieUrl:'https://user:pass@example.invalid/unsafe.jpg',joinedAt:{seconds:100},allowedBranches:['Maa']});
    h.put('riders/b',{name:'Other branch rider',phone:'09000000002',status:'active',allowedBranches:['Cabantian'],walletBalance:0});
    const nodes=new Map(),dialogs=[],reads=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',querySelector(){return node(id+'-td');}});return nodes.get(id);};
    const api={...h.api,auth:{currentUser:user},sessionUser:createWorkspaceSession(user,saved),
        getDocFromServer:async ref=>{reads.push(ref.path);return {id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))};},
        Swal:{fire:async options=>{dialogs.push(options);return {isConfirmed:true};}}};
    const original=api.getDocsFromServer;api.getDocsFromServer=async query=>{reads.push(query.table);return original(query);};configureRiderManagerAuthority(api);
    const document={getElementById:node};installRiderManagementViews(api,document);
    return {h,api,user,saved,node,nodes,dialogs,reads};
}
const imageButtons=html=>[...html.matchAll(/viewRiderApplicationDocument\('([^']*)'\)/g)].map(match=>match[1]);
test('actual Fleet loader performs one rider read, escapes names and handles missing status/dates/unsafe URLs',async()=>{
    const f=fixture();f.h.put('riders/legacy',{name:'Legacy rider',vehicle:'<script>literal</script>',walletBalance:'bad'});
    assert.equal(await f.api.loadRiderManagement(),true);const html=f.node('riderFleetBody').innerHTML;
    assert.equal(f.reads.filter(path=>path==='riders').length,1);assert.match(html,/O&#39;Brien &lt;img/);assert.doesNotMatch(html,/<img src=x onerror/);assert.doesNotMatch(html,/javascript:|user:pass/);
    assert.match(html,/Review legacy status with the Owner/);assert.match(html,/Date not recorded/);assert.match(html,/Unconfirmed/);assert.match(html,/₱123\.45/);assert.match(html,/OR\/CR not provided/);
});
test('Fleet list honors explicit saved branch assignments and canonical duplicate permission winner',async()=>{
    const f=fixture({branches:['Maa']});assert.equal(await f.api.loadRiderManagement(),true);assert.match(f.node('riderFleetBody').innerHTML,/O&#39;Brien/);assert.doesNotMatch(f.node('riderFleetBody').innerHTML,/Other branch rider/);
    f.h.put('hq_managers/hq',{...f.saved,permissionsUpdatedAt:{seconds:1}});f.h.put('hq_managers/new',{...f.saved,permissions:['dashboard'],permissionsUpdatedAt:{seconds:2}});
    assert.equal(await f.api.loadRiderManagement(),false);assert.match(f.node('riderFleetBody-td').textContent,/saved permissions/);assert.equal(f.reads.filter(path=>path==='riders').length,1);
});
test('Top-up list reads only pending requests, rejects invalid rider links and escapes reference/name fields',async()=>{
    const f=fixture({branches:['Maa']});
    f.h.put('rider_topups/topup',{riderId:'a',riderName:"O'Brien <script>literal</script>",reference:"123'<img onerror=alert(1)>",proofUrl:'https://example.invalid/proof.jpg',status:'pending'});
    f.h.put('rider_topups/other',{riderId:'b',riderName:'Other branch rider',reference:'456',proofUrl:'https://example.invalid/other.jpg',status:'pending'});
    f.h.put('rider_topups/processed',{riderId:'a',riderName:'Already approved',reference:'789',status:'approved'});f.h.put('rider_topups/broken',{riderId:'bad/path',riderName:'Broken record',status:'pending'});
    assert.equal(await f.api.loadRiderTopUps(),true);const html=f.node('riderTopUpBody').innerHTML;
    assert.match(html,/O&#39;Brien &lt;script&gt;/);assert.doesNotMatch(html,/Other branch rider|Already approved|Broken record|<script>literal/);assert.equal(imageButtons(html).length,1);assert.doesNotMatch(f.reads.join(' '),/riders\/bad\/path/);
});
function defer(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
test('late Fleet query cannot overwrite a newer refresh or render another signed-in account records',async()=>{
    const f=fixture(),wait=defer(),original=f.api.getDocsFromServer;let first=true;
    f.api.getDocsFromServer=async query=>{const value=await original(query);if(query.table==='riders' && first){first=false;await wait.promise;}return value;};
    const old=f.api.loadRiderManagement();while(first)await Promise.resolve();f.h.put('riders/a',{...f.h.get('riders/a'),name:'New name'});assert.equal(await f.api.loadRiderManagement(),true);const latest=f.node('riderFleetBody').innerHTML;wait.resolve();assert.equal(await old,false);assert.equal(f.node('riderFleetBody').innerHTML,latest);
    const g=fixture(),block=defer(),read=g.api.getDocsFromServer;let waiting=false;g.api.getDocsFromServer=async query=>{const value=await read(query);if(query.table==='riders'){waiting=true;await block.promise;}return value;};
    const pending=g.api.loadRiderManagement();while(!waiting)await Promise.resolve();g.api.auth.currentUser={...g.user,uid:'other-hq'};block.resolve();assert.equal(await pending,false);assert.doesNotMatch(g.node('riderFleetBody').innerHTML,/O&#39;Brien|Other branch rider/);
});
test('late Top-up rider lookup cannot replace a newer refresh or expose a stale account proof',async()=>{
    const f=fixture();f.h.put('rider_topups/topup',{riderId:'a',riderName:'First old rider',reference:'123',proofUrl:'https://example.invalid/proof.jpg',status:'pending'});
    const wait=defer(),original=f.api.getDocFromServer;let first=true;f.api.getDocFromServer=async ref=>{const result=await original(ref);if(ref.path==='riders/a' && first){first=false;await wait.promise;}return result;};
    const old=f.api.loadRiderTopUps();while(first)await Promise.resolve();f.h.put('rider_topups/topup',{...f.h.get('rider_topups/topup'),riderName:'Fresh rider name'});assert.equal(await f.api.loadRiderTopUps(),true);const latest=f.node('riderTopUpBody').innerHTML;wait.resolve();assert.equal(await old,false);assert.equal(f.node('riderTopUpBody').innerHTML,latest);
});
test('actual document buttons open a saved HTTPS image with text title',async()=>{
    const f=fixture();await f.api.loadRiderManagement();const encoded=imageButtons(f.node('riderFleetBody').innerHTML)[0];assert.ok(encoded);
    await f.api.viewRiderApplicationDocument(encoded);const dialog=f.dialogs.at(-1);assert.equal(dialog.imageUrl,'https://example.invalid/license.jpg');assert.match(dialog.titleText,/O'Brien <img/);assert.equal(dialog.html,undefined);
});
test('document viewer refuses signed-out, unverified, changed-permission and other-branch sessions',async()=>{
    for(const scenario of ['signed-out','unverified','revoked','scope']){
        const f=fixture();await f.api.loadRiderManagement();const encoded=imageButtons(f.node('riderFleetBody').innerHTML)[0];
        if(scenario==='signed-out')f.api.sessionUser=null;if(scenario==='unverified')f.api.auth.currentUser.emailVerified=false;
        if(scenario==='revoked')f.h.put('hq_managers/hq',{...f.saved,permissions:['dashboard']});if(scenario==='scope')f.h.put('hq_managers/hq',{...f.saved,assignedBranch:['Cabantian']});
        await f.api.viewRiderApplicationDocument(encoded);assert.equal(f.dialogs.some(dialog=>dialog.imageUrl),false,scenario+' must not open a stale image');
    }
});
test('document viewer refuses unbound, unsafe, deleted or changed saved document inputs',async()=>{
    const f=fixture();for(const value of [{url:'https://example.invalid/unbound.jpg',title:'unbound'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.invalid/proof.jpg'}])await f.api.viewRiderApplicationDocument(encodeURIComponent(JSON.stringify(value)));
    assert.equal(f.dialogs.some(dialog=>dialog.imageUrl),false);
    await f.api.loadRiderManagement();const encoded=imageButtons(f.node('riderFleetBody').innerHTML)[0];f.h.docs.delete('riders/a');await f.api.viewRiderApplicationDocument(encoded);assert.equal(f.dialogs.some(dialog=>dialog.imageUrl),false);
});
test('rendered document button carries only record binding and viewer uses the latest saved URL/name',async()=>{
    const f=fixture();await f.api.loadRiderManagement();const encoded=imageButtons(f.node('riderFleetBody').innerHTML)[0],binding=JSON.parse(decodeURIComponent(encoded));assert.deepEqual(binding,{kind:'license',id:'a'});
    f.h.put('riders/a',{...f.h.get('riders/a'),name:'Current Rider name',licenseUrl:'https://example.invalid/current-license.jpg'});await f.api.viewRiderApplicationDocument(encoded);
    assert.equal(f.dialogs.at(-1).imageUrl,'https://example.invalid/current-license.jpg');assert.equal(f.dialogs.at(-1).titleText,'Driver’s license · Current Rider name');
});
test('fresh authority recheck blocks scope/permission revocation or account changes during document reads',async()=>{
    for(const scenario of ['scope','permission','account']){
        const f=fixture();await f.api.loadRiderManagement();const encoded=imageButtons(f.node('riderFleetBody').innerHTML)[0],original=f.api.getDocFromServer;
        f.api.getDocFromServer=async ref=>{const snapshot=await original(ref);if(ref.path==='riders/a'){
            if(scenario==='scope')f.h.put('hq_managers/hq',{...f.saved,assignedBranch:['Cabantian']});if(scenario==='permission')f.h.put('hq_managers/hq',{...f.saved,permissions:['dashboard']});if(scenario==='account')f.api.auth.currentUser={...f.user,uid:'other-hq'};
        }return snapshot;};
        await f.api.viewRiderApplicationDocument(encoded);assert.equal(f.dialogs.some(dialog=>dialog.imageUrl),false);assert.equal(f.dialogs.at(-1).title,'Document unavailable');
    }
});
test('top-up proof viewer resolves actual request and rider scope, never embedded URL or caller-supplied rider',async()=>{
    const f=fixture({branches:['Maa']});f.h.put('rider_topups/topup',{riderId:'a',reference:'123',proofUrl:'https://example.invalid/proof.jpg',status:'pending'});await f.api.loadRiderTopUps();const encoded=imageButtons(f.node('riderTopUpBody').innerHTML)[0];assert.deepEqual(JSON.parse(decodeURIComponent(encoded)),{kind:'topup',id:'topup'});
    await f.api.viewRiderApplicationDocument(encoded);assert.equal(f.dialogs.at(-1).imageUrl,'https://example.invalid/proof.jpg');assert.ok(f.reads.includes('rider_topups/topup'));
    f.dialogs.length=0;f.h.put('rider_topups/topup',{...f.h.get('rider_topups/topup'),riderId:'b'});await f.api.viewRiderApplicationDocument(encoded);assert.equal(f.dialogs.some(dialog=>dialog.imageUrl),false);assert.equal(f.dialogs.at(-1).title,'Document unavailable');
});
