import test from 'node:test';
import assert from 'node:assert/strict';
import {branchRows,syncBranchOptions,applyBranchDirectory,installLiveBranchDirectory} from '../takodeal-staff/live-branch-directory.js';
const rows=[{id:'one',name:'Maa',lat:7,lng:125},{id:'two',name:'Agdao',lat:7.1,lng:125.6}];
const snapshot=(data=rows,metadata={fromCache:false,hasPendingWrites:false})=>({metadata,docs:data.map(row=>({id:row.id,data:()=>row}))});
function events(target={}) {
    const listeners=new Map();target.addEventListener=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);};
    target.removeEventListener=(name,fn)=>listeners.get(name)?.delete(fn);target.emit=name=>{for(const fn of [...listeners.get(name)||[]])fn();};return target;
}
function fixture() {
    const nodes=new Map(),option=(value,text=value)=>({value,textContent:text,disabled:false});
    const document=events({hidden:false,getElementById:id=>nodes.get(id)||null,createElement:()=>option('')});
    function select(id,value='Maa',names=['Maa']) {const node={value,disabled:false,dataset:{},options:names.map(name=>option(name)),replacements:0,replaceChildren(...children){this.options=children;this.replacements++;}};nodes.set(id,node);return node;}
    const api=events({navigator:{onLine:true},auth:{currentUser:{uid:'owner'}},BRANCH_ZONES:{Maa:{lat:7,lng:125}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',permissions:['all'],allowedBranches:['All'],branch:'Maa'},isBranchAllowed:()=>true,
        cart:[{id:'unsent',qty:2}],localStorage:{setItem(){assert.fail('Discovery cannot assign or register a device');},clear(){assert.fail('No identity clearing');}},
        updateDoc(){assert.fail('No business writes');},setDoc(){assert.fail('No business writes');},loadInventory(){assert.fail('Do not rebuild business views');},location:{reload(){assert.fail('No automatic app reload');}}});
    return {api,document,nodes,select};
}
test('only confirmed server branch names replace a directory; cached/pending and duplicate maps are rejected',()=>{
    assert.equal(branchRows(snapshot(rows,{fromCache:true})),null);assert.equal(branchRows(snapshot(rows,{hasPendingWrites:true})),null);
    assert.deepEqual(branchRows(snapshot()).map(row=>row.name),['Agdao','Maa']);assert.throws(()=>branchRows(snapshot([...rows,{id:'other',name:'Agdao'}])),/review/);
    assert.throws(()=>branchRows(snapshot([{id:'bad',name:'__proto__'}])),/review/);
});
test('a new branch adds a literal option without switching the selected branch, unlocking it, or dispatching a change',()=>{
    const h=fixture(),select=h.select('branches');select.disabled=true;
    syncBranchOptions(h.document,select,['Maa','Agdao','Branch <img src=x>']);
    assert.equal(select.value,'Maa');assert.equal(select.disabled,true);assert.equal(select.options[2].textContent,'Branch <img src=x>');
    const count=select.replacements;syncBranchOptions(h.document,select,['Maa','Agdao','Branch <img src=x>']);assert.equal(select.replacements,count);
});
test('blank forms stay blank and a removed selected branch remains visibly held instead of silently reassigning a draft',()=>{
    const h=fixture(),blank=h.select('blank','',[]);syncBranchOptions(h.document,blank,['Agdao']);assert.equal(blank.value,'');assert.equal(blank.options[0].value,'');
    const held=h.select('held');syncBranchOptions(h.document,held,['Agdao']);assert.equal(held.value,'Maa');assert.equal(held.options.at(-1).disabled,true);assert.match(held.options.at(-1).textContent,/no longer listed/);
});
test('Owner branch discovery updates shared names while filtering controls through the current saved branch permission',()=>{
    const h=fixture(),select=h.select('invBranchFilter');h.api.isBranchAllowed=name=>name==='Maa';
    applyBranchDirectory(h.api,h.document,rows,{kind:'owner'});
    assert.deepEqual(h.api.globalActiveBranches,['Maa','Agdao']);assert.deepEqual(select.options.map(o=>o.value),['Maa']);assert.equal(select.value,'Maa');
    h.api.sessionUser=null;applyBranchDirectory(h.api,h.document,[...rows,{id:'three',name:'Future'}],{kind:'owner'});assert.deepEqual(h.api.globalActiveBranches,['Maa','Agdao']);
});
test('a different authenticated Owner identity cannot apply an old workspace directory',()=>{
    const h=fixture();h.api.auth.currentUser={uid:'different'};applyBranchDirectory(h.api,h.document,rows,{kind:'owner'});assert.equal(h.api.globalActiveBranches,undefined);
});
test('Cashier adds setup options and live GPS pins while retaining the exact current cart and physical branch selection',()=>{
    const h=fixture(),cart=h.api.cart,select=h.select('setupBranchSelect');h.api.POS_BRANCH='Maa';
    applyBranchDirectory(h.api,h.document,rows,{kind:'cashier',fallback:{}});
    assert.equal(h.api.cart,cart);assert.equal(h.api.POS_BRANCH,'Maa');assert.equal(select.value,'Maa');assert.ok(select.options.some(o=>o.value==='Agdao'));assert.deepEqual(h.api.BRANCH_ZONES.Agdao,{lat:7.1,lng:125.6});
});
test('Staff setup and SOP include new branches; the active shift keeps SOP pinned to its recorded branch',()=>{
    const h=fixture(),setup=h.select('deviceBranchInput','Auto',['Auto','Maa']),sop=h.select('sopBranchSelect');
    h.api.sopActiveTimeIn={branch:'Agdao'};h.api.staffProfile={branch:'Maa'};sop.disabled=true;
    applyBranchDirectory(h.api,h.document,rows,{kind:'staff'});
    assert.equal(setup.value,'Auto');assert.equal(sop.value,'Agdao');assert.equal(sop.disabled,true);assert.equal(h.api.staffProfile.branch,'Maa');assert.equal(h.api.sopActiveTimeIn.branch,'Agdao');
});
test('a branch without saved GPS is listed but never given invented coordinates',()=>{
    const h=fixture();h.select('deviceBranchInput');applyBranchDirectory(h.api,h.document,[...rows,{id:'three',name:'Future',lat:'',lng:null}],{kind:'staff'});
    assert.ok(h.nodes.get('deviceBranchInput').options.some(o=>o.value==='Future'));assert.equal(h.api.BRANCH_ZONES.Future,undefined);
});
for(const allBranches of [false,true])test('a franchise owner never inherits new branch access (global marker '+allBranches+')',()=>{
    const h=fixture(),select=h.select('franchiseBranchSelect');h.api.sessionUser={uid:'owner',email:'franchise@example.invalid',isFranchisee:true,branch:'Maa',allowedBranches:['Maa'],permissions:['all']};
    applyBranchDirectory(h.api,h.document,rows,{kind:'franchise',allBranches});assert.deepEqual(h.api.sessionUser.allowedBranches,['Maa']);assert.deepEqual(select.options.map(o=>o.value),['Maa']);
});
test('only a verified All-branch HQ session expands its permitted list without changing branch, cart or schedule',()=>{
    const h=fixture(),select=h.select('franchiseBranchSelect'),cart=h.api.cart;h.api.sessionUser.allowedBranches=['Maa'];h.api.schedule={dirty:true};
    applyBranchDirectory(h.api,h.document,rows,{kind:'franchise',allBranches:true});
    assert.deepEqual(h.api.sessionUser.allowedBranches,['Maa','Agdao']);assert.equal(h.api.sessionUser.branch,'Maa');assert.equal(select.value,'Maa');assert.equal(h.api.cart,cart);assert.deepEqual(h.api.schedule,{dirty:true});
});
test('permissions all alone do not turn a branch-assigned HQ account into a global branch account',()=>{
    const h=fixture();h.api.sessionUser.email='manager@example.invalid';h.api.sessionUser.allowedBranches=['Maa'];applyBranchDirectory(h.api,h.document,rows,{kind:'franchise',allBranches:false});assert.deepEqual(h.api.sessionUser.allowedBranches,['Maa']);
});
test('Customer updates only the visible public locator and never switches a cart or checkout branch',async()=>{
    const h=fixture(),cart=h.api.cart;let calls=0,hidden=false;h.api.loadBranchLocator=async()=>{calls++;};h.api.customerSelectedBranch='Maa';h.nodes.set('branchLocatorScreen',{classList:{contains:()=>hidden}});
    applyBranchDirectory(h.api,h.document,rows,{kind:'customer'});await Promise.resolve();assert.equal(calls,1);assert.equal(h.api.cart,cart);assert.equal(h.api.customerSelectedBranch,'Maa');
    hidden=true;applyBranchDirectory(h.api,h.document,rows,{kind:'customer'});assert.equal(calls,1);
});
function live(kind='cashier') {
    const h=fixture(),subscriptions=[];h.select('setupBranchSelect');
    const directory=installLiveBranchDirectory(h.api,h.document,{kind,subscribe(next,error){const sub={next,error,stopped:0};subscriptions.push(sub);return()=>sub.stopped++;}});
    return {...h,subscriptions,directory};
}
test('one live subscription receives future branches and ignores cache snapshots and unchanged confirmations',()=>{
    const h=live();assert.equal(h.subscriptions.length,1);const sub=h.subscriptions[0],select=h.nodes.get('setupBranchSelect');sub.next(snapshot());const count=select.replacements;
    sub.next(snapshot());assert.equal(select.replacements,count);sub.next(snapshot([{id:'old',name:'Wrong'}],{fromCache:true}));assert.equal(h.api.BRANCH_ZONES.Wrong,undefined);
    sub.next(snapshot([...rows,{id:'three',name:'Future',lat:7.3,lng:125.7}]));assert.ok(select.options.some(o=>o.value==='Future'));assert.equal(select.value,'Maa');h.directory.stop();
});
test('hiding pauses discovery, late callbacks cannot change it, and returning resumes exactly one fresh watch',()=>{
    const h=live(),first=h.subscriptions[0];first.next(snapshot());h.document.hidden=true;h.document.emit('visibilitychange');assert.equal(first.stopped,1);
    first.next(snapshot([{id:'bad',name:'Wrong'}]));assert.equal(h.api.BRANCH_ZONES.Wrong,undefined);
    h.document.hidden=false;h.document.emit('visibilitychange');h.api.emit('pageshow');assert.equal(h.subscriptions.length,2);h.subscriptions[1].next(snapshot(rows));h.directory.stop();assert.equal(h.subscriptions[1].stopped,1);h.api.emit('online');assert.equal(h.subscriptions.length,2);
});
test('a transient read failure preserves all selected forms and an adapter exception cannot escape into Firestore',()=>{
    const h=live();h.subscriptions[0].next(snapshot());const selected=h.nodes.get('setupBranchSelect').value;
    h.subscriptions[0].error(Error('offline'));assert.equal(h.api.branchDirectoryStatus,'unavailable');assert.equal(h.nodes.get('setupBranchSelect').value,selected);
    h.nodes.get('setupBranchSelect').replaceChildren=()=>{throw Error('Synthetic renderer failure');};assert.doesNotThrow(()=>h.subscriptions[0].next(snapshot([...rows,{id:'new',name:'Future'}])));h.directory.stop();
});
test('a pending Franchise save or draft defers an All-branch scope update until its existing work finishes',()=>{
    const h=fixture();h.select('franchiseBranchSelect');h.api.sessionUser.allowedBranches=['Maa'];h.api.franchiseState={pending:true,cart:[]};let retry;
    const directory=installLiveBranchDirectory(h.api,h.document,{kind:'franchise',allBranches:true,delay:fn=>{retry=fn;return 1;},cancelDelay(){},subscribe:next=>{next(snapshot());return()=>{};}});
    assert.deepEqual(h.api.sessionUser.allowedBranches,['Maa']);assert.equal(typeof retry,'function');h.api.franchiseState.pending=false;retry();assert.deepEqual(h.api.sessionUser.allowedBranches,['Agdao','Maa']);assert.equal(h.api.sessionUser.branch,'Maa');directory.stop();
});
