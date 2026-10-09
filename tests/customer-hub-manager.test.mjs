import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {loadCustomerHubState,saveCustomerHubState,installCustomerHubSettings} from '../takodeal-manager/customer-hub-settings.js';

const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8');
const profile={businessName:'TAKODEÁL',location:'Davao City',sinceYear:2023,aboutText:'Sample description'};
const opening={customerSoonToOpen:true,customerOpeningLabel:'Opening soon in Maa'};
const branchPatch={operatingHours:'9:00 AM - 9:00 PM',publicContact:'09000000000',publicAddress:'Sample public address',grabLink:'https://example.invalid/grab',foodpandaLink:'https://example.invalid/fp',...opening};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
function fixture({permissions=['customerapp'],assignedBranch=['Maa'],existingSite=false}={}) {
    const backend=firestoreHarness(),nodes=new Map(),events=new Map(),dialogs=[],validations=[],uploads=[],uploadURLs=[];
    const user={uid:'manager-1',email:'manager@example.invalid',emailVerified:true};
    const saved={email:user.email,fullName:'Sample manager',role:'Manager',permissions,assignedBranch,pin:'1111',active:true};
    backend.put('hq_managers/manager',saved);
    backend.put('branches/maa',{name:'Maa',publicAddress:'Original public address',operatingHours:'10:00 AM - 9:00 PM',address:'Receipt address',contact:'Receipt phone',storefrontImage:'https://example.invalid/old.jpg',royaltyPercentage:7,allowedCategories:['Takoyaki'],unrelated:'keep'});
    backend.put('branches/cabantian',{name:'Cabantian',publicAddress:'Other branch'});
    if(existingSite)backend.put('settings/customer_site_profile',{...profile,unrelated:'keep site setting'});
    const node=id=>{
        if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,files:[],textContent:'',innerHTML:'',disabled:false,dataset:{},style:{},events:new Map(),
            addEventListener(name,callback){this.events.set(name,callback);},querySelector(){return null;}});
        return nodes.get(id);
    };
    const document={getElementById:node,createTextNode:value=>({textContent:value})};
    const api={...backend.api,auth:{currentUser:user},sessionUser:createWorkspaceSession(user,saved),crypto:{randomUUID},storage:{},
        getDocFromServer:async ref=>({id:ref.id,exists:()=>backend.docs.has(ref.path),data:()=>structuredClone(backend.get(ref.path))}),
        isBranchAllowed(name){return this.sessionUser?.allowedBranches?.some(branch=>branch==='All'||branch===name);},
        ManagerUI:{notify:message=>validations.push(message)},
        ref:(_storage,path)=>({path}),uploadBytes:async(ref,file)=>{uploads.push({ref,file});if(h.uploadWait)await h.uploadWait.promise;return {ref};},
        getDownloadURL:async ref=>{uploadURLs.push(ref.path);return 'https://example.invalid/new.jpg';},
        Swal:{isLoading:()=>false,showValidationMessage:message=>validations.push(message),async fire(options){dialogs.push(options);return h.onDialog(options);}}};
    const h={api,backend,document,nodes,node,dialogs,validations,uploads,uploadURLs,user,saved,events,onDialog:async()=>({isConfirmed:false})};
    h.installed=installCustomerHubSettings(api,document);return h;
}
const stateFor=h=>loadCustomerHubState(h.api,{kind:'branch',id:'maa'});

test('new About tab loads defaults without automatically creating cloud configuration',async()=>{
    const h=fixture();assert.equal(await h.api.loadCustomerSiteProfile(),true);
    assert.equal(h.node('customerSiteBusinessName').value,'TAKODEÁL');assert.equal(h.node('customerSiteLocation').value,'Davao City');assert.equal(h.node('customerSiteSinceYear').value,2023);assert.equal(h.node('customerSiteAboutText').value,'');
    assert.equal(h.node('customerSiteFooterPreview').textContent,'TAKODEÁL · Davao City · Since 2023');assert.equal(h.backend.get('settings/customer_site_profile'),undefined);
});
test('About preview uses text nodes and the actual editor saves exactly validated public fields with a merge',async()=>{
    const h=fixture({existingSite:true});await h.api.loadCustomerSiteProfile();
    h.node('customerSiteBusinessName').value='<img src=x onerror=alert(1)>';h.node('customerSiteAboutText').value='<script>literal description</script>';
    h.node('customerSiteBusinessName').events.get('input')();assert.equal(h.node('customerSiteFooterPreview').textContent,'<img src=x onerror=alert(1)> · Davao City · Since 2023');assert.equal(h.node('customerSiteFooterPreview').innerHTML,'');
    assert.equal(h.node('customerSiteAboutPreview').textContent,'<script>literal description</script>');assert.equal(await h.api.saveCustomerSiteProfile(),true);
    const saved=h.backend.get('settings/customer_site_profile');assert.equal(saved.businessName,'<img src=x onerror=alert(1)>');assert.equal(saved.aboutText,'<script>literal description</script>');assert.equal(saved.sinceYear,2023);assert.equal(saved.unrelated,'keep site setting');assert.equal(saved.customerHubUpdatedBy,h.user.email);
});
test('branch save merges opening notice with existing public profile fields while preserving receipt settings and image',async()=>{
    const h=fixture(),state=await stateFor(h);await saveCustomerHubState(h.api,state,branchPatch,{operationId:'opening-1'});
    const saved=h.backend.get('branches/maa');assert.equal(saved.customerSoonToOpen,true);assert.equal(saved.customerOpeningLabel,'Opening soon in Maa');
    assert.equal(saved.operatingHours,branchPatch.operatingHours);assert.equal(saved.grabLink,branchPatch.grabLink);assert.equal(saved.publicAddress,branchPatch.publicAddress);
    assert.equal(saved.storefrontImage,'https://example.invalid/old.jpg');assert.equal(saved.address,'Receipt address');assert.equal(saved.contact,'Receipt phone');assert.equal(saved.royaltyPercentage,7);assert.deepEqual(saved.allowedCategories,['Takoyaki']);assert.equal(saved.unrelated,'keep');
});
test('disabled notice uses the same merge path and a blank label gets the shared default',async()=>{
    const h=fixture(),state=await stateFor(h);await saveCustomerHubState(h.api,state,{customerSoonToOpen:false,customerOpeningLabel:'   '},{operationId:'opening-off'});
    assert.equal(h.backend.get('branches/maa').customerSoonToOpen,false);assert.equal(h.backend.get('branches/maa').customerOpeningLabel,'Soon to open');assert.equal(h.backend.get('branches/maa').publicAddress,'Original public address');
});
test('unauthenticated, unverified, unapproved tab permission and other-branch calls cannot save',async()=>{
    for(const denial of ['signed-out','unverified','permission','branch']){
        const h=fixture(denial==='permission'?{permissions:['dashboard']}:{});
        if(denial==='signed-out')h.api.auth.currentUser=null;if(denial==='unverified')h.api.auth.currentUser.emailVerified=false;
        const before=structuredClone(h.backend.get('branches/maa'));
        await assert.rejects(loadCustomerHubState(h.api,{kind:'branch',id:denial==='branch'?'cabantian':'maa'}),/Unlock|outside/);
        assert.deepEqual(h.backend.get('branches/maa'),before);assert.equal(h.backend.get('settings/customer_site_profile'),undefined);
    }
});
test('a fresh saved permission revoke during the transaction holds the change despite cached tab access',async()=>{
    const h=fixture(),state=await stateFor(h),original=h.api.runTransaction;
    h.api.runTransaction=(db,callback)=>{h.backend.put('hq_managers/manager',{...h.saved,permissions:['dashboard']});return original(db,callback);};
    await assert.rejects(saveCustomerHubState(h.api,state,opening,{operationId:'revoked'}),/saved permissions/);assert.equal(h.backend.get('branches/maa').customerSoonToOpen,undefined);
});
test('branch scope changes, blocked HQ access and renamed branches are rechecked before mutations',async()=>{
    for(const change of ['scope','blocked','rename']){
        const h=fixture(),state=await stateFor(h);
        if(change==='scope')h.backend.put('hq_managers/manager',{...h.saved,assignedBranch:['Cabantian']});
        if(change==='blocked')h.backend.put('hq_managers/manager',{...h.saved,blocked:true});
        if(change==='rename')h.backend.put('branches/maa',{...h.backend.get('branches/maa'),name:'Renamed'});
        await assert.rejects(saveCustomerHubState(h.api,state,opening,{operationId:'changed-'+change}),/outside|blocked|branch changed/);assert.equal(h.backend.get('branches/maa').customerSoonToOpen,undefined);
    }
});
test('account changes during a profile read or transaction cannot apply the previous actor save',async()=>{
    for(const at of ['read','transaction']){
        const h=fixture();let pending,state;
        const wait=deferred(),originalRead=h.api.getDocFromServer,originalTransaction=h.api.runTransaction;
        if(at==='read'){
            h.api.getDocFromServer=async ref=>{await wait.promise;return originalRead(ref);};pending=stateFor(h);await tick();
        }else{
            state=await stateFor(h);h.api.runTransaction=(db,callback)=>originalTransaction(db,tx=>callback({...tx,get:async ref=>{const row=await tx.get(ref);if(ref.path==='branches/maa')await wait.promise;return row;}}));pending=saveCustomerHubState(h.api,state,opening,{operationId:'stale-actor'});await tick();
        }
        h.api.auth.currentUser={...h.user,uid:'next-account'};wait.resolve();await assert.rejects(pending,/Unlock|account changed/);assert.equal(h.backend.get('branches/maa').customerSoonToOpen,undefined);
    }
});
test('concurrent About and branch edits reject a stale draft instead of overwriting the newer fields',async()=>{
    for(const kind of ['site','branch']){
        const h=fixture({existingSite:true}),first=await loadCustomerHubState(h.api,{kind,id:'maa'}),second=await loadCustomerHubState(h.api,{kind,id:'maa'});
        const a=kind==='site'?{...profile,aboutText:'First saved description'}:opening,b=kind==='site'?{...profile,aboutText:'Older conflicting draft'}:{...opening,customerOpeningLabel:'Older conflicting label'};
        await saveCustomerHubState(h.api,first,a,{operationId:'first'});await assert.rejects(saveCustomerHubState(h.api,second,b,{operationId:'second'}),/Another account changed/);
        const saved=h.backend.get(kind==='site'?'settings/customer_site_profile':'branches/maa');assert.equal(kind==='site'?saved.aboutText:saved.customerOpeningLabel,kind==='site'?a.aboutText:a.customerOpeningLabel);
    }
});
test('lost acknowledgement retries one stable save and cannot reapply it after a later edit',async()=>{
    const h=fixture(),state=await stateFor(h);h.backend.loseNextAck();await assert.rejects(saveCustomerHubState(h.api,state,opening,{operationId:'retry'}),/Connection lost/);
    assert.equal(h.backend.get('branches/maa').customerHubRevision,1);assert.equal((await saveCustomerHubState(h.api,state,opening,{operationId:'retry'})).alreadySaved,true);assert.equal(h.backend.get('branches/maa').customerHubRevision,1);
    h.backend.put('branches/maa',{...h.backend.get('branches/maa'),customerOpeningLabel:'Later edit'});await assert.rejects(saveCustomerHubState(h.api,state,opening,{operationId:'retry'}),/changed after/);assert.equal(h.backend.get('branches/maa').customerOpeningLabel,'Later edit');
});
test('opening label and About validation refuse unsupported/invalid fields before writes',async()=>{
    const h=fixture(),state=await stateFor(h),site=await loadCustomerHubState(h.api);
    await assert.rejects(saveCustomerHubState(h.api,state,{...opening,customerOpeningLabel:'x'.repeat(61)},{operationId:'bad-label'}),/60 characters/);
    await assert.rejects(saveCustomerHubState(h.api,state,{...opening,royaltyPercentage:100},{operationId:'unsupported'}),/unsupported/);
    await assert.rejects(saveCustomerHubState(h.api,site,{...profile,sinceYear:'2.023e3'},{operationId:'bad-year'}),/founding year/);
    assert.equal(h.backend.get('settings/customer_site_profile'),undefined);assert.equal(h.backend.get('branches/maa').customerSoonToOpen,undefined);
});
function setProfileForm(h,{label='Soon to open',soon=true,file}={}) {
    for(const [id,value] of Object.entries({sfHours:branchPatch.operatingHours,sfContact:branchPatch.publicContact,sfAddress:branchPatch.publicAddress,sfGrab:branchPatch.grabLink,sfFp:branchPatch.foodpandaLink,sfOpeningLabel:label}))h.node(id).value=value;
    h.node('sfSoonToOpen').checked=soon;h.node('sfImage').files=file?[file]:[];
}
test('actual profile dialog escapes notice text, defaults label and retains all existing upload/profile controls',async()=>{
    const h=fixture();h.backend.put('branches/maa',{...h.backend.get('branches/maa'),customerSoonToOpen:true,customerOpeningLabel:'"><img src=x onerror=alert(1)>'});
    await h.installed.editProfile(encodeURIComponent(JSON.stringify({id:'maa'})));const options=h.dialogs[0];
    assert.equal(options.titleText,'Edit Maa profile');assert.match(options.html,/maxlength="60"/);assert.match(options.html,/&quot;&gt;&lt;img/);assert.doesNotMatch(options.html,/<img src=x/);
    for(const id of ['sfHours','sfContact','sfAddress','sfGrab','sfFp','sfImage','sfSoonToOpen','sfOpeningLabel'])assert.match(options.html,new RegExp('id="'+id+'"'));
    assert.equal(h.uploads.length,0);assert.equal(h.backend.get('branches/maa').customerHubRevision,undefined);
});
test('profile image and opening notice save together with one retained upload through a lost acknowledgement retry',async()=>{
    const h=fixture(),file={name:'storefront.jpg',size:100,lastModified:1};
    h.onDialog=async options=>{
        setProfileForm(h,{file,label:'Ready soon'});h.backend.loseNextAck();assert.equal(await options.preConfirm(),false);assert.match(h.validations.at(-1),/Connection lost/);
        const value=await options.preConfirm();return {isConfirmed:true,value};
    };
    assert.equal(await h.installed.editProfile(encodeURIComponent(JSON.stringify({id:'maa'}))),true);assert.equal(h.uploads.length,1);assert.equal(h.uploadURLs.length,1);
    const saved=h.backend.get('branches/maa');assert.equal(saved.customerOpeningLabel,'Ready soon');assert.equal(saved.customerSoonToOpen,true);assert.equal(saved.storefrontImage,'https://example.invalid/new.jpg');assert.equal(saved.customerHubRevision,1);assert.equal(saved.unrelated,'keep');
});
test('account switch during image upload cannot attach the photo or notice to a branch',async()=>{
    const h=fixture();h.uploadWait=deferred();h.onDialog=async options=>{
        setProfileForm(h,{file:{name:'sample.jpg',size:50,lastModified:1}});const saving=options.preConfirm();await tick();h.api.auth.currentUser={...h.user,uid:'other'};h.uploadWait.resolve();assert.equal(await saving,false);return {isConfirmed:false};
    };
    assert.equal(await h.installed.editProfile(encodeURIComponent(JSON.stringify({id:'maa'}))),false);assert.equal(h.uploads.length,1);assert.equal(h.uploadURLs.length,0);assert.equal(h.backend.get('branches/maa').storefrontImage,'https://example.invalid/old.jpg');assert.equal(h.backend.get('branches/maa').customerSoonToOpen,undefined);
});
test('profile listing shows only permitted branches and safely renders the opening label',async()=>{
    const h=fixture();h.backend.put('branches/maa',{...h.backend.get('branches/maa'),customerSoonToOpen:true,customerOpeningLabel:'<b>Opening soon</b>'});
    assert.equal(await h.installed.loadProfiles(),true);const content=h.node('storefrontProfilesTableBody').innerHTML;
    assert.match(content,/Maa/);assert.match(content,/&lt;b&gt;Opening soon&lt;\/b&gt;/);assert.doesNotMatch(content,/Cabantian|<b>Opening soon/);
});
test('late About read from a previous account cannot replace the newer account form or status',async()=>{
    const h=fixture({existingSite:true}),wait=deferred(),read=h.api.getDocFromServer;let first=true;
    h.api.getDocFromServer=async ref=>{const row=await read(ref);if(first){first=false;await wait.promise;}return row;};
    const old=h.api.loadCustomerSiteProfile();await tick();
    const user={uid:'manager-2',email:'next@example.invalid',emailVerified:true},saved={...h.saved,email:user.email};
    h.api.auth.currentUser=user;h.api.sessionUser=createWorkspaceSession(user,saved);h.backend.put('hq_managers/next',saved);h.backend.put('settings/customer_site_profile',{...profile,businessName:'Newer saved brand'});
    assert.equal(await h.api.loadCustomerSiteProfile(),true);const status=h.node('customerSiteSettingsStatus').textContent;
    wait.resolve();assert.equal(await old,false);assert.equal(h.node('customerSiteBusinessName').value,'Newer saved brand');assert.equal(h.node('customerSiteSettingsStatus').textContent,status);assert.equal(h.node('btnSaveCustomerSiteProfile').disabled,false);
});
test('actual About save locks concurrent clicks and retries a lost acknowledgement with the same operation',async()=>{
    const h=fixture({existingSite:true}),wait=deferred(),transaction=h.api.runTransaction;let calls=0;
    await h.api.loadCustomerSiteProfile();h.node('customerSiteAboutText').value='Updated once';
    h.api.runTransaction=async(db,callback)=>{calls++;if(calls===1)await wait.promise;return transaction(db,callback);};h.backend.loseNextAck();
    const first=h.api.saveCustomerSiteProfile();await tick();assert.equal(h.node('btnSaveCustomerSiteProfile').disabled,true);assert.equal(await h.api.saveCustomerSiteProfile(),false);assert.equal(calls,1);
    wait.resolve();assert.equal(await first,false);assert.match(h.node('customerSiteSettingsStatus').textContent,/Connection lost/);
    const operation=h.backend.get('settings/customer_site_profile').customerHubOperation.id;assert.equal(await h.api.saveCustomerSiteProfile(),true);
    assert.equal(h.backend.get('settings/customer_site_profile').customerHubOperation.id,operation);assert.equal(h.backend.get('settings/customer_site_profile').customerHubRevision,1);assert.equal(h.backend.get('settings/customer_site_profile').aboutText,'Updated once');
});
test('Manager tab and public handlers delegate to the installed settings module with matching static DOM',()=>{
    const from=main.indexOf('window.switchCustomerAppTab = function'),to=main.indexOf('\n};',from)+4;assert.ok(from>=0 && to>from);
    const nodes=new Map(),loads=[];const context=vm.createContext({window:{loadCustomerSiteProfile:()=>loads.push('About')},document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{style:{}});return nodes.get(id);}}});
    vm.runInContext(main.slice(from,to),context);context.window.switchCustomerAppTab('About');assert.deepEqual(loads,['About']);assert.equal(nodes.get('custSecAbout').style.display,'block');assert.equal(nodes.get('custSecProfiles').style.display,'none');
    for(const id of ['tabCustAbout','custSecAbout','customerSiteBusinessName','customerSiteLocation','customerSiteSinceYear','customerSiteAboutText','customerSiteFooterPreview','customerSiteAboutPreview','customerSiteSettingsStatus','btnSaveCustomerSiteProfile'])assert.match(page,new RegExp('id="'+id+'"'));
    assert.match(main,/return window\.customerHubSettings\.loadProfiles\(\)/);assert.match(main,/return window\.customerHubSettings\.editProfile\(encodedData\)/);assert.match(main,/installCustomerHubSettings\(window,document\)/);
});
