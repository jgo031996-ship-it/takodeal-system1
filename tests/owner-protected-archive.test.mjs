import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {archiveableShift} from '../takodeal-manager/branch-operations.js';

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=source.indexOf('window.openArchiveSalesModal = async function('),end=source.indexOf('// --- POPULATES THE ARCHIVE DROPDOWN ---',start);
const actualFunction=source.slice(start,end),date=new Date('2000-01-01T00:00:00.000Z');
function fixture(transactions,{shifts=[],retry,changeBeforePurge,confirm=true}={}){
 const rows=new Map(),scan=new Map(),deleted=[],audit=[],backups=[],dialogs=[],attempts=[],refresh=[];
 for(const[collection,records]of Object.entries({transactions,shifts,attendance_logs:[],stock_logs:[],expenses:[]})){
  const entries=records.map(([id,data])=>[collection+'/'+id,{timestamp:date,branch:'Synthetic Branch',...structuredClone(data)}]);
  for(const[key,data]of entries)rows.set(key,data);scan.set(collection,entries);
 }
 const snapshot=(key,data)=>({id:key.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
 const list=entries=>{const docs=entries.map(([key,data])=>snapshot(key,data));return{docs,size:docs.length,forEach:fn=>docs.forEach(fn)};};
 let firstTransaction=true;
 const api={db:{},storage:{},collection:(_db,name)=>({collection:name}),where:(...args)=>({where:args}),orderBy:(...args)=>({orderBy:args}),limit:value=>({limit:value}),query:(reference,...constraints)=>({...reference,constraints}),
  getDocs:async query=>query.collection==='shifts'&&query.constraints.some(value=>value.limit)?list([['shifts/latest-handover',{branch:'Synthetic Branch',status:'Closed',endTime:date}]]):list(scan.get(query.collection)),
  doc:(_db,collection,id)=>({key:collection+'/'+id}),
  runTransaction:async(_db,body)=>{
   if(firstTransaction){firstTransaction=false;changeBeforePurge?.(rows);}
   for(let attempt=0;;attempt++){
    const planned=[];let writing=false;
    const result=await body({get:async reference=>{assert.equal(writing,false,'all reads precede writes');return snapshot(reference.key,rows.get(reference.key));},delete:reference=>{writing=true;planned.push(reference.key);},set(){throw Error('Archive must not set financial fields');},update(){throw Error('Archive must not update financial fields');}});
    attempts.push({result:structuredClone(result),planned:[...planned]});
    if(retry&&attempt===0){retry(rows);continue;}
    for(const key of planned){deleted.push(key);rows.delete(key);}return result;
   }
  },
  XLSX:{utils:{book_new:()=>({}),book_append_sheet(){},json_to_sheet:value=>value},writeFile(){}},
  ref:(_storage,path)=>({path}),uploadBytes:async(reference,blob)=>{backups.push(JSON.parse(await blob.text()));return{ref:reference};},getDownloadURL:async()=> 'https://synthetic.invalid/archive.json',
  addDoc:async(reference,data)=>{assert.equal(reference.collection,'archived_months');audit.push(structuredClone(data));},serverTimestamp:()=> 'SYNTHETIC_SERVER_TIME',
  loadArchiveDropdown:()=>refresh.push('archive'),loadSalesHistoryTab:()=>refresh.push('sales'),loadZReadingReports:()=>refresh.push('shifts')
 };
 const Swal={fire:async(...args)=>{dialogs.push(args);if(typeof args[0]==='string')return{};if(args[0].preConfirm)return{value:{start:'2000-01-01',end:'2000-01-01'}};if(args[0].confirmButtonText==='Yes, Purge Database 🗄️')return{isConfirmed:confirm};return{};},showLoading(){}};
 vm.runInNewContext(actualFunction,{window:api,Swal,Blob,Date,Map,Set,Object,console,archiveableShift,businessClock:()=>({day:'2026-11-10'})});
 return{run:()=>api.openArchiveSalesModal(),rows,deleted,audit,backups,dialogs,attempts,refresh,success:()=>dialogs.find(args=>args[0]==='Archived!')?.[1]};
}

test('archive followup leaves every main byte outside the archive function unchanged',()=>{
 assert.equal(createHash('sha256').update(source.slice(0,start)+source.slice(end)).digest('hex'),'b1b50dd42d3ab093c3d576729d17a8edafdb4df707cb75a5b3ee08421f7a1447');
});

test('ordinary receipts purge normally and success truthfully reports zero protected payment records',async()=>{
 const h=fixture([['one',{netTotal:10}],['two',{netTotal:20}]]);await h.run();assert.deepEqual(h.deleted,['transactions/one','transactions/two']);assert.equal(h.audit.length,1);assert.equal(h.backups[0].transactions.length,2);assert.match(h.success(),/^2 records removed.*0 protected payment records kept live/);assert.deepEqual(h.refresh,['archive','sales','shifts']);
});

test('every protected key, including null or false values, keeps its receipt live without financial mutations',async()=>{
 for(const key of ['paymentReconciliationVersion','paymentReconciliationId','paymentReconciliationFile'])for(const value of [null,false,'']){
  const h=fixture([['ordinary',{netTotal:10}],['linked',{netTotal:20,[key]:value}]]),original=structuredClone(h.rows.get('transactions/linked'));await h.run();assert.deepEqual(h.deleted,['transactions/ordinary']);assert.deepEqual(h.rows.get('transactions/linked'),original);assert.equal(h.backups[0].transactions.length,2);assert.match(h.success(),/^1 records removed.*1 protected payment records kept live/);
 }
});

test('retained counts aggregate across committed forty-row chunks while protected shifts stay live',async()=>{
 const transactions=Array.from({length:42},(_,i)=>['ordinary-'+i,{netTotal:i}]);transactions.splice(1,0,['linked',{netTotal:45,paymentReconciliationId:'sample-link'}]);transactions.push(['null-linked',{netTotal:50,paymentReconciliationFile:null}]);
 const h=fixture(transactions,{shifts:[['reviewed-shift',{status:'Closed',active:false,startTime:date,endTime:date}]],changeBeforePurge:rows=>{rows.get('shifts/reviewed-shift').status='Open';}});await h.run();assert.equal(h.attempts.length,2);assert.equal(h.deleted.length,42);assert.ok(h.rows.has('transactions/linked'));assert.ok(h.rows.has('transactions/null-linked'));assert.ok(h.rows.has('shifts/reviewed-shift'));assert.equal(h.backups[0].shifts.length,1);assert.match(h.success(),/^42 records removed.*2 protected payment records kept live\. Protected shifts were retained/);
});

test('a payment link arriving on transaction retry is retained and only the committed result is counted',async()=>{
 const h=fixture([['existing-link',{netTotal:15,paymentReconciliationVersion:1}],['racing-link',{netTotal:25}]],{retry:rows=>{rows.get('transactions/racing-link').paymentReconciliationFile=null;}});await h.run();assert.deepEqual(h.deleted,[]);assert.equal(h.attempts.length,2);assert.equal(h.attempts[0].result.retainedPaymentRecords,1);assert.equal(h.attempts[1].result.retainedPaymentRecords,2);assert.deepEqual(h.attempts[0].planned,['transactions/racing-link']);assert.equal(h.rows.get('transactions/racing-link').netTotal,25);assert.equal(h.rows.get('transactions/racing-link').paymentReconciliationFile,null);assert.equal(h.backups[0].transactions.length,2);assert.match(h.success(),/^0 records removed.*2 protected payment records kept live/);
});

test('declining purge still exports without cloud backup, live deletion or financial mutation',async()=>{
 const h=fixture([['ordinary',{netTotal:10}]],{confirm:false});await h.run();assert.equal(h.backups.length,0);assert.equal(h.audit.length,0);assert.equal(h.attempts.length,0);assert.deepEqual(h.deleted,[]);assert.equal(h.rows.get('transactions/ordinary').netTotal,10);assert.equal(h.success(),undefined);
});
