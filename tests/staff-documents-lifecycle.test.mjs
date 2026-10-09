import test from 'node:test';
import assert from 'node:assert/strict';
import {installStaffDocuments} from '../takodeal-staff/staff-documents.js';

function ui({watchAuth=true}={}) {
    const nodes=new Map(),events=new Map(),selectors=new Map(),created=[],revoked=[],storage=new Map([['takodeal_staff_id','employee-a']]);
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,style:{display:'flex'},dataset:{},textContent:'',innerHTML:'',src:'',
        addEventListener:(name,fn)=>events.set(`${id}:${name}`,fn),querySelector:selector=>selectors.get(selector)||null,querySelectorAll:()=>[],
        removeAttribute(name){if(name==='src')this.src='';},close(){this.open=false;},showModal(){this.open=true;}});return nodes.get(id);};
    const auth={currentUser:{uid:'private-a'}},changes=[];let reads=0,files=0,requests=0,uploads=0,authCallback;
    const record={staffId:'employee-a',group:'valid_id',status:'approved',storagePath:'staff_private_documents/private-a/employee-a/valid_id/op.jpg',size:4,contentType:'image/jpeg',expiresOn:'',reviewNote:'Employee A secret',version:1};
    const records=()=>({valid_id:{...record,reviewNote:auth.currentUser?.uid==='private-a'?'Employee A secret':'Employee B secret'}});
    const client={auth,sdk:watchAuth?{onAuthStateChanged(_auth,callback){changes.push(callback);authCallback=callback;return ()=>{};}}:{},store:{
        async records(){reads++;return records();},async file(){files++;return new Blob(['photo'],{type:'image/jpeg'});},async requestDevice(){requests++;},async upload(){uploads++;}
    }};
    const api={localStorage:{getItem:key=>storage.get(key)||null},addEventListener:(name,fn)=>events.set(`api:${name}`,fn),openProfile:async()=>{},stopStaffLiveListeners(){},checkNormalLogin:async()=>{},loginStaff:async()=>{}};
    const d={hidden:false,getElementById:node,addEventListener:(name,fn)=>events.set(`document:${name}`,fn)};
    const oldObserver=globalThis.MutationObserver,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
    globalThis.MutationObserver=class{observe(){}};URL.createObjectURL=blob=>{const url=`blob:private-${created.length+1}`;created.push({url,blob});return url;};URL.revokeObjectURL=url=>revoked.push(url);
    installStaffDocuments(api,{d,createVault:async()=>client,normalize:async()=>new Blob(['normal'],{type:'image/jpeg'})});
    const button=(type,group='valid_id')=>({dataset:{docAction:type,group},disabled:false,closest(){return this;}});
    const click=button=>events.get('staffDocumentCards:click')({target:button});
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    return {api,d,auth,client,node,events,selectors,created,revoked,storage,changes,button,click,tick,
        get reads(){return reads;},get files(){return files;},get requests(){return requests;},get uploads(){return uploads;},
        changeAuth(user){auth.currentUser=user;authCallback?.(user);},
        restore(){globalThis.MutationObserver=oldObserver;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}};
}

test('named private UID changes revoke displayed photos, clear cached metadata and retain one auth watcher',async()=>{
    const h=ui();try{
        await h.api.staffDocuments.load();assert.match(h.node('staffDocumentCards').innerHTML,/Employee A secret/);assert.equal(h.reads,1);
        h.click(h.button('view'));await h.tick();assert.equal(h.node('staffDocumentPreview').open,true);assert.equal(h.created.length,1);
        h.changeAuth({uid:'private-b'});assert.equal(h.node('staffDocumentCards').innerHTML,'');assert.equal(h.node('staffDocumentPreviewImage').src,'');assert.equal(h.node('staffDocumentPreview').open,false);assert.deepEqual(h.revoked,['blob:private-1']);
        await h.api.staffDocuments.load();assert.equal(h.reads,2);assert.match(h.node('staffDocumentCards').innerHTML,/Employee B secret/);assert.doesNotMatch(h.node('staffDocumentCards').innerHTML,/Employee A secret/);assert.equal(h.changes.length,1);
        h.changeAuth(null);await h.api.staffDocuments.load();assert.equal(h.reads,2);assert.equal(h.node('staffDocumentCards').innerHTML,'');assert.match(h.node('staffDocumentsStatus').textContent,/access changed/);
    }finally{h.restore();}
});
test('a slow photo read cannot display its old UID image after a named auth switch',async()=>{
    const h=ui();try{
        await h.api.staffDocuments.load();let complete;h.client.store.file=()=>new Promise(resolve=>complete=resolve);
        h.click(h.button('view'));await h.tick();h.changeAuth({uid:'private-b'});complete(new Blob(['old image']));await h.tick();
        assert.equal(h.created.length,0);assert.equal(h.node('staffDocumentPreview').open,false);assert.equal(h.node('staffDocumentCards').innerHTML,'');
        await h.api.staffDocuments.load();h.client.store.file=async()=>new Blob(['new image']);h.click(h.button('view'));await h.tick();assert.equal(h.created.length,1);
    }finally{h.restore();}
});
test('UID-bound cache guards still work when a mocked client omits its optional auth watcher',async()=>{
    const h=ui({watchAuth:false});try{
        await h.api.staffDocuments.load();h.auth.currentUser={uid:'private-b'};await h.api.staffDocuments.load();assert.equal(h.reads,2);assert.match(h.node('staffDocumentCards').innerHTML,/Employee B secret/);
    }finally{h.restore();}
});
test('refresh during a slow view releases its abandoned busy owner; completion cannot unlock the new view',async()=>{
    const h=ui();try{
        await h.api.staffDocuments.load();const pending=[];h.client.store.file=()=>new Promise(resolve=>pending.push(resolve));
        const old=h.button('view');h.click(old);await h.tick();assert.equal(old.disabled,true);
        await h.api.staffDocuments.load(true);const current=h.button('view');h.click(current);await h.tick();assert.equal(pending.length,2);assert.equal(current.disabled,true);
        pending[0](new Blob(['old']));await h.tick();assert.equal(current.disabled,true);assert.equal(h.created.length,0);
        const blocked=h.button('view');h.click(blocked);await h.tick();assert.equal(pending.length,2);
        pending[1](new Blob(['new']));await h.tick();assert.equal(current.disabled,false);assert.equal(h.created.length,1);
        h.click(h.button('view'));await h.tick();assert.equal(pending.length,3);pending[2](new Blob(['again']));await h.tick();
    }finally{h.restore();}
});
test('refresh during a slow upload leaves the refreshed profile usable and cannot unlock a newer action',async()=>{
    const h=ui();try{
        await h.api.staffDocuments.load();const upload=h.button('upload'),preview=h.node('selectedPreview');
        h.selectors.set('[data-doc-preview="valid_id"]',preview);h.selectors.set('[data-doc-action="upload"][data-group="valid_id"]',upload);h.selectors.set('[data-doc-expiry="valid_id"]',{value:''});
        h.events.get('staffDocumentCards:change')({target:{dataset:{docFile:'valid_id'},files:[new Blob(['input'])],value:'selected'}});await h.tick();assert.equal(upload.disabled,false);
        let finishUpload,finishView;h.client.store.upload=()=>new Promise(resolve=>finishUpload=resolve);h.client.store.file=()=>new Promise(resolve=>finishView=resolve);
        h.click(upload);await h.tick();assert.ok(finishUpload);await h.api.staffDocuments.load(true);
        const view=h.button('view');h.click(view);await h.tick();assert.ok(finishView);assert.equal(view.disabled,true);
        finishUpload({saved:true});await h.tick();assert.equal(view.disabled,true);assert.equal(h.node('staffDocumentPreview').open,false);
        finishView(new Blob(['new view']));await h.tick();assert.equal(view.disabled,false);assert.equal(h.node('staffDocumentPreview').open,true);
    }finally{h.restore();}
});
test('slow photo normalization cannot revive a selected preview after private auth changes',async()=>{
    const h=ui();try{
        await h.api.staffDocuments.load();let complete;
        // Reinstall with a controlled normalization promise on an isolated fresh API.
        const api={...h.api,staffDocuments:undefined};installStaffDocuments(api,{d:h.d,createVault:async()=>h.client,normalize:()=>new Promise(resolve=>complete=resolve)});await api.staffDocuments.load();
        const preview=h.node('selectedPreview'),upload=h.button('upload');h.selectors.set('[data-doc-preview="valid_id"]',preview);h.selectors.set('[data-doc-action="upload"][data-group="valid_id"]',upload);
        const input={dataset:{docFile:'valid_id'},files:[new Blob(['input'])],value:'selected'};h.events.get('staffDocumentCards:change')({target:input});await h.tick();
        h.changeAuth({uid:'private-b'});complete(new Blob(['normalized']));await h.tick();assert.equal(h.created.length,0);assert.equal(preview.src,'');assert.equal(upload.disabled,true);
    }finally{h.restore();}
});
