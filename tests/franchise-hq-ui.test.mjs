import test from 'node:test';
import assert from 'node:assert/strict';
import {createFranchiseHQController,franchiseDirectory,canManageFranchiseHQ,canReadFranchiseHQ} from '../takodeal-manager/franchise-hq-ui.js';

const owner={uid:'owner-uid',email:'jgo031996@gmail.com',isOwner:true,permissions:['all'],allowedBranches:['All'],branch:'All'};
const snapshot=records=>({size:records.length,docs:records.map((row,index)=>({id:row.id||String(index),data:()=>structuredClone(row)}))});
const held=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}) {
    const records={branches:[{name:'Agdao',isFranchise:true},{name:'Maa',isFranchise:true},{name:'Main Office',isCore:true}],franchise_ledger:[],franchise_comms:[],shifts:[],...options.records};
    const calls=[],watchers=[],session={value:structuredClone(options.session||owner)};
    const api={db:{},auth:{currentUser:{uid:session.value.uid,email:session.value.email}},sessionUser:session.value,
        collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),limit:count=>({count}),query:(ref,...filters)=>({...ref,filters}),doc:(_,table,id)=>({table,id}),
        async getDocsFromServer(ref){calls.push(ref);if(options.read)return options.read(ref,records);let found=records[ref.table]||[];for(const filter of ref.filters||[])if(filter.field)found=found.filter(row=>row[filter.field]===filter.value);const cap=ref.filters?.find(filter=>filter.count)?.count;return snapshot(cap?found.slice(0,cap):found);},
        async getDocFromServer(ref){const row=records[ref.table]?.find(row=>row.id===ref.id);return {id:ref.id,exists:()=>!!row,data:()=>structuredClone(row)};},
        onSnapshot(ref,metadata,next,error){const watcher={ref,next,error,stopped:false};watchers.push(watcher);return()=>{watcher.stopped=true;};},
        runTransaction(){throw Error('Unexpected write during a read-only view.');}
    };
    const changes=[];const controller=createFranchiseHQController(api,{getSession:()=>session.value,onChange:value=>changes.push(structuredClone(value)),timeoutMs:options.timeoutMs||200});
    return {api,session,controller,records,calls,watchers,changes};
}
test('franchise directory uses saved explicit flags and exact allowed branch scope',()=>{
    const records=[{name:'Agdao',isFranchise:true},{name:'Maa',isCore:false},{name:'Unknown'},{name:'Conflict',isFranchise:true,isCore:true},{name:'Main Office',isFranchise:true}];
    assert.deepEqual(franchiseDirectory(records,owner),{branches:['Agdao'],unclassified:['Maa','Unknown'],conflicts:['Conflict']});
    assert.deepEqual(franchiseDirectory(records,{allowedBranches:['Maa','Agdao']}),{branches:['Agdao'],unclassified:['Maa'],conflicts:[]});
    assert.equal(canManageFranchiseHQ({...owner,isFranchisee:true}),false);
    assert.equal(canManageFranchiseHQ({permissions:['franchise']}),false);
});
test('fresh visit loads directory without legacy global cache and distinguishes unselected from an empty account',async()=>{
    const h=harness();await h.controller.loadDirectory();assert.deepEqual(h.controller.state.directory.branches,['Agdao','Maa']);
    await h.controller.loadLedger('');assert.equal(h.calls.filter(ref=>ref.table==='franchise_ledger').length,0);assert.equal(h.controller.state.ledger.status,'unselected');assert.equal(h.controller.state.ledger.summary,null);
    await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.status,'ready');assert.equal(h.controller.state.ledger.summary.balance,0);assert.equal(h.controller.state.ledger.summary.rows.length,0);
});
test('ledger reads alias types and undated records consistently and never presents an invalid amount as a known balance',async()=>{
    const h=harness({records:{franchise_ledger:[{id:'a',branch:'Agdao',type:'debit',amount:100},{id:'b',branch:'Agdao',type:'credit',amount:30,timestamp:{seconds:1}},{id:'c',branch:'Maa',type:'Charge',amount:999}]}});
    await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.summary.balance,70);assert.equal(h.controller.state.ledger.summary.rows.length,2);
    h.records.franchise_ledger.push({id:'bad',branch:'Agdao',type:'Charge',amount:'not recorded'});await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.summary.balance,null);assert.equal(h.controller.state.ledger.summary.invalidCount,1);
    assert.ok(h.calls.filter(ref=>ref.table==='franchise_ledger').every(ref=>ref.filters.some(filter=>filter.field==='branch'&&filter.value==='Agdao')));
});
test('a slow branch response cannot replace the newly selected account',async()=>{
    const old=held(),h=harness({read:ref=>ref.table==='branches'?snapshot([{name:'Agdao',isFranchise:true},{name:'Maa',isFranchise:true}]):ref.filters.some(filter=>filter.value==='Agdao')?old.promise:snapshot([{branch:'Maa',type:'Charge',amount:20}])});
    await h.controller.loadDirectory();const first=h.controller.loadLedger('Agdao');await settle();await h.controller.loadLedger('Maa');old.resolve(snapshot([{branch:'Agdao',type:'Charge',amount:999}]));await first;
    assert.equal(h.controller.state.ledger.branch,'Maa');assert.equal(h.controller.state.ledger.summary.balance,20);
});
test('account changes discard stale reads and clear the former account before a new directory read',async()=>{
    const old=held(),h=harness();await h.controller.loadDirectory();h.api.getDocsFromServer=ref=>ref.table==='franchise_ledger'?old.promise:Promise.resolve(snapshot([{name:'Maa',isFranchise:true}]));
    const first=h.controller.loadLedger('Agdao');await settle();h.session.value={uid:'other',email:'other@test',permissions:['franchise-hub'],allowedBranches:['Maa'],branch:'Maa'};h.api.auth.currentUser={uid:'other',email:'other@test'};
    await h.controller.loadDirectory();assert.equal(h.controller.state.ledger.status,'unselected');old.resolve(snapshot([{branch:'Agdao',type:'Charge',amount:999}]));await first;
    assert.equal(h.controller.state.ledger.summary,null);assert.deepEqual(h.controller.state.directory.branches,['Maa']);
});
test('server read errors are unavailable rather than a zero balance',async()=>{
    const h=harness();await h.controller.loadDirectory();h.api.getDocsFromServer=async()=>{throw Error('Quota exceeded');};await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.status,'error');assert.equal(h.controller.state.ledger.summary,null);assert.match(h.controller.state.ledger.error,/Quota/);
});
test('a deadline retains the physical pending request and does not pile up retries',async()=>{
    const request=held(),h=harness({timeoutMs:8,read:()=>request.promise});
    await assert.rejects(h.controller.loadDirectory(),/taking too long/);await assert.rejects(h.controller.loadDirectory(),/taking too long/);assert.equal(h.calls.length,1);
    request.resolve(snapshot([{name:'Agdao',isFranchise:true}]));await settle();await h.controller.loadDirectory();assert.equal(h.calls.length,2);assert.equal(h.controller.state.directory.status,'ready');
});
test('record caps mark every running balance as unknown instead of exporting an arbitrary subset',async()=>{
    const h=harness({records:{franchise_ledger:Array.from({length:2001},(_,index)=>({id:String(index),branch:'Agdao',type:'Charge',amount:1}))}});await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.status,'partial');assert.equal(h.controller.state.ledger.summary.balance,null);assert.ok(h.controller.state.ledger.summary.rows.every(row=>row.balance===null));
});
test('performance reads only permitted franchise branches, uses 30-day evidence and separates royalty charges from payments',async()=>{
    const now=new Date(),old=new Date(Date.now()-50*86400000),h=harness({session:{uid:'limited',email:'limited@test',permissions:['franchise-hub'],allowedBranches:['Agdao'],branch:'Agdao'},records:{shifts:[{branch:'Agdao',status:'Closed',totalCashSales:100,totalDigitalSales:30,endTime:now},{branch:'Agdao',status:'Closed',totalCashSales:999,totalDigitalSales:0,endTime:old},{branch:'Maa',status:'Closed',totalCashSales:9999,totalDigitalSales:0,endTime:now}],franchise_ledger:[{branch:'Agdao',type:'Charge',amount:40,category:'Daily Franchise Royalty',timestamp:now},{branch:'Agdao',type:'Payment',amount:10,category:'Daily Franchise Royalty',timestamp:now}]}});
    await h.controller.loadPerformance();assert.deepEqual(h.controller.state.performance.rows.map(row=>[row.branch,row.sales,row.royalties]),[['Agdao',130,40]]);
    for(const ref of h.calls.filter(ref=>ref.table!=='branches'))assert.ok(ref.filters.some(filter=>filter.field==='branch'&&filter.value==='Agdao'));
});
test('unknown dated evidence keeps performance values unavailable',async()=>{
    const h=harness({records:{shifts:[{branch:'Agdao',status:'Closed',totalCashSales:100,totalDigitalSales:0}]}});await h.controller.loadPerformance();const row=h.controller.state.performance.rows.find(row=>row.branch==='Agdao');assert.equal(row.sales,null);assert.equal(row.royalties,null);assert.equal(row.review,true);
});
test('conversation server updates use current data, preserve active selection and detach all listeners on exit',async()=>{
    const first={id:'thread_12345',schemaVersion:1,audience:'branch',targetBranch:'Agdao',branch:'Agdao',title:'Order proof',message:'First',replies:[],timestamp:{seconds:1}};
    const h=harness({records:{franchise_comms:[first]}});await h.controller.loadThreads();await h.controller.openThread(first.id);assert.equal(h.watchers.length,1);
    const updated={...first,replies:[{id:'reply_12345',message:'Seen',timestamp:{seconds:2}}],lastActivity:{seconds:2}};h.watchers[0].next({...snapshot([updated]),metadata:{fromCache:false,hasPendingWrites:false}});
    assert.equal(h.controller.state.chat.active.replies[0].message,'Seen');h.controller.stopChat();assert.ok(h.watchers.every(watcher=>watcher.stopped));
    h.watchers[0].next({...snapshot([]),metadata:{fromCache:false}});assert.equal(h.controller.state.chat.threads.length,1);
});
test('all-franchise conversations exclude core branch recipients and retain network announcements plus HQ-only older review',async()=>{
    const h=harness({records:{branches:[{name:'Agdao',isFranchise:true},{name:'Maa',isCore:true,isFranchise:false}],franchise_comms:[
        {id:'agdao_thread',audience:'branch',targetBranch:'Agdao',branch:'Agdao',title:'Agdao'},
        {id:'maa_thread',audience:'branch',targetBranch:'Maa',branch:'Maa',title:'Core branch'},
        {id:'network_thread',audience:'network',branch:'All',targetBranch:'',title:'Announcement'},
        {id:'legacy_thread',branch:'HQ Main Office',type:'Discussion',title:'Recipient unknown'}]}});
    await h.controller.loadThreads('',{live:false});assert.deepEqual(h.controller.state.chat.threads.map(row=>row.id).sort(),['agdao_thread','legacy_thread','network_thread']);
    await h.controller.openThread('maa_thread');assert.equal(h.controller.state.chat.active,null);
});
test('invalid Google identity prevents all server queries and all write delegates',async()=>{
    const h=harness();h.api.auth.currentUser.email='different@test';await assert.rejects(h.controller.loadDirectory(),/Unlock/);assert.equal(h.calls.length,0);assert.equal(h.controller.assertAccess(h.session.value,'ledger','Agdao'),false);await assert.rejects(h.controller.recordEntry({id:'entry_1234',branch:'Agdao',type:'Payment',amount:10,description:'Proof'}),/access|identity|account changed/);
});
test('legacy Owner hub grants a franchisee only assigned read-only account and conversation access',async()=>{
    const franchisee={uid:'fran-uid',email:'franchise@test',isFranchisee:true,permissions:['franchise-hub'],allowedBranches:['Agdao'],branch:'Agdao'};
    assert.equal(canManageFranchiseHQ(franchisee),false);assert.equal(canReadFranchiseHQ(franchisee),true);
    assert.equal(canReadFranchiseHQ({...franchisee,permissions:['inventory']}),false);assert.equal(canReadFranchiseHQ({...franchisee,allowedBranches:['All']}),false);
    const h=harness({session:franchisee,records:{franchise_ledger:[{branch:'Agdao',type:'Charge',amount:4000},{branch:'Maa',type:'Charge',amount:999}],franchise_comms:[{id:'agdao_thread',audience:'branch',targetBranch:'Agdao',branch:'Agdao',replies:[]},{id:'maa_thread',audience:'branch',targetBranch:'Maa',branch:'Maa',replies:[]}]}});
    await h.controller.loadLedger('Agdao');assert.equal(h.controller.state.ledger.summary.balance,4000);assert.deepEqual(h.controller.state.directory.branches,['Agdao']);assert.equal(h.controller.canExportLedger(),true);
    await h.controller.loadThreads('',{live:false});assert.deepEqual(h.controller.state.chat.threads.map(row=>row.id),['agdao_thread']);
    for(const ref of h.calls)assert.ok(ref.filters.some(filter=>filter.field),'Every franchisee read must be scoped; no collection-wide read.');
    const before=h.calls.length;assert.equal(await h.controller.loadPerformance(),false);assert.equal(h.calls.length,before);
    await assert.rejects(h.controller.recordEntry({id:'entry_12345',branch:'Agdao',type:'Payment',amount:10,description:'Not permitted'}),/access/);
    await assert.rejects(h.controller.conversations.create({id:'thread_12345',branch:'Agdao',title:'Not permitted',message:'No write'}),/access/);
    await assert.rejects(h.controller.conversations.reply({id:'agdao_thread',branch:'Agdao',replyId:'reply_12345',message:'No write'}),/access/);
    await h.controller.loadLedger('Maa');assert.equal(h.controller.state.ledger.status,'error');assert.equal(h.controller.state.ledger.summary,null);
});
test('a franchisee without explicit hub permission cannot query the legacy Owner hub',async()=>{
    const h=harness({session:{uid:'fran',email:'fran@test',isFranchisee:true,permissions:['inventory'],allowedBranches:['Agdao'],branch:'Agdao'}});
    await assert.rejects(h.controller.loadDirectory(),/Unlock/);assert.equal(h.calls.length,0);
});
test('same-tick account changes prevent the queued SDK call from starting',async()=>{
    const h=harness();const request=h.controller.loadDirectory();h.session.value={...owner,uid:'other',email:'other@test'};h.api.auth.currentUser={uid:'other',email:'other@test'};
    await assert.rejects(request,/account changed/);assert.equal(h.calls.length,0);
    const h2=harness();const signedOut=h2.controller.loadDirectory();h2.api.auth.currentUser=null;await assert.rejects(signedOut,/account changed/);assert.equal(h2.calls.length,0);
});
test('failed fresh branch verification invalidates the former confirmed balance and statement export',async()=>{
    const h=harness({records:{franchise_ledger:[{branch:'Agdao',type:'Charge',amount:4000}]}});await h.controller.loadLedger('Agdao');assert.equal(h.controller.canExportLedger(),true);
    h.api.getDocsFromServer=async()=>{throw Error('Branch server unavailable');};await assert.rejects(h.controller.loadDirectory(),/unavailable/);
    assert.equal(h.controller.state.directory.status,'error');assert.equal(h.controller.state.ledger.status,'error');assert.equal(h.controller.state.ledger.branch,'Agdao');assert.equal(h.controller.state.ledger.summary,null);assert.equal(h.controller.canExportLedger(),false);
});
