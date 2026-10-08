import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const moduleUrl=new URL('../takodeal-manager/staff-document-hq.js',import.meta.url);
// The real HQ UI runs against a mock client; an unexpected live SDK call fails.
const source=readFileSync(moduleUrl,'utf8')
    .replace(/import \{createStaffDocumentFirebase\} from '.\/staff-document-firebase.js';/,"const createStaffDocumentFirebase=()=>{throw Error('Unexpected live SDK');};")
    .replace(/from '(\.\/[^']+)'/g,(_match,path)=>`from '${new URL(path,moduleUrl).href}'`);
const {installMasterEmployeeDocuments}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function approvalHarness(existing) {
    const nodes=new Map(),events=new Map(),writes=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{display:'flex'},textContent:'',innerHTML:'',disabled:false,
        addEventListener:(event,fn)=>events.set(id+':'+event,fn),close(){},removeAttribute(){}});return nodes.get(id);};
    node('empProfileId').value='employee-a';node('empFullName').value='QA employee';
    const requestedAt={toMillis:()=>1000};
    const request={uid:'phone-a',staffId:'employee-a',deviceId:'new-device-label',deviceName:'New phone label',status:'pending',requestedAt};
    const data=new Map([['cashiers/employee-a',{branch:'Maa'}],['staff_document_requests/phone-a',request],
        ['staff_private_documents/employee-a',{staffId:'employee-a',branch:'Maa',version:1}]]);
    if(existing)data.set('staff_document_devices/phone-a',existing);
    const snapshot=ref=>({exists:()=>data.has(ref),data:()=>data.get(ref)});
    const auth={currentUser:{uid:'owner-a',emailVerified:true,email:'jgo031996@gmail.com'}};
    const sdk={doc:(_db,...parts)=>parts.join('/'),collection:(_db,name)=>name,where:()=>{},query:()=>{},serverTimestamp:()=> 'SERVER_TIME',
        getDocFromServer:async ref=>snapshot(ref),getDocsFromServer:async()=>({docs:request.status==='pending'?[{id:'phone-a',data:()=>request}]:[]}),
        runTransaction:async(_db,work)=>work({get:async ref=>snapshot(ref),update(ref,value){writes.push({method:'update',ref,value});data.set(ref,{...data.get(ref),...value});},set(ref,value){writes.push({method:'set',ref,value});data.set(ref,value);}})};
    const client={auth,db:{},sdk,store:{ready:async()=>{},records:async()=>({})}};
    const d={hidden:false,getElementById:node,addEventListener(){}};
    const api={auth,Swal:{fire:async()=>({isConfirmed:true})},openEmployeeProfile(){},addEventListener(){}};
    const previous=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}};
    installMasterEmployeeDocuments(api,{d,createVault:async()=>client});
    return {api,node,writes,data,restore:()=>{globalThis.MutationObserver=previous;},async approve(){
        await api.masterStaffDocuments.load();
        const button={dataset:{documentDevice:'phone-a',deviceAction:'approve'},disabled:false,closest(){return this;}};
        events.get('masterStaffDocumentRequests:click')({target:button});
        for(let step=0;step<10;step++)await new Promise(resolve=>setImmediate(resolve));
    }};
}

for(const metadata of [{},{deviceId:'original-device',deviceName:'Original phone'}])test('reactivating a phone preserves its original approval and immutable metadata '+JSON.stringify(metadata),async()=>{
    const existing={uid:'phone-a',staffId:'employee-a',branch:'Maa',active:false,approvedAt:'ORIGINAL_TIME',approvedByUid:'original-owner',
        updatedAt:'PREVIOUS_TIME',updatedByUid:'original-owner',audit:{prior:{active:false,actorUid:'original-owner',recordedAt:'PREVIOUS_TIME'}},...metadata};
    const h=approvalHarness(existing);try{
        await h.approve();const change=h.writes.find(row=>row.ref==='staff_document_devices/phone-a');assert.ok(change);
        assert.equal(change.method,'update');assert.deepEqual(Object.keys(change.value).sort(),['active','audit','updatedAt','updatedByUid']);
        const result=h.data.get(change.ref);assert.equal(result.active,true);assert.equal(result.approvedAt,'ORIGINAL_TIME');assert.equal(result.approvedByUid,'original-owner');
        for(const key of ['uid','staffId','branch','deviceId','deviceName'])assert.equal(result[key],existing[key]);
        assert.deepEqual(result.audit.prior,existing.audit.prior);assert.equal(Object.keys(result.audit).length,2);
    }finally{h.restore();}
});

test('a renewed request cannot move an approved phone to another employee branch',async()=>{
    const h=approvalHarness({uid:'phone-a',staffId:'employee-a',branch:'Cabantian',active:false});try{
        await h.approve();assert.equal(h.writes.length,0);assert.match(h.node('masterStaffDocumentStatus').textContent,/another employee or branch/);
    }finally{h.restore();}
});
