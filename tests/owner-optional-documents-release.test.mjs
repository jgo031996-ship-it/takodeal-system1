import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertDocumentReleaseCopies,documentReleasePins} from './helpers/owner-document-release-pins.mjs';
import {DOCUMENT_GROUPS,REQUIRED_DOCUMENT_GROUPS,OPTIONAL_DOCUMENT_GROUPS,SUPPORTED_DOCUMENT_GROUPS,documentSummary} from '../takodeal-manager/staff-document-model.js';
import {createDocumentStore,documentFilePath} from '../takodeal-manager/staff-document-store.js';
import {DOCUMENT_BROKER_ENDPOINT} from '../takodeal-manager/staff-document-broker.js';
import {documentCards} from '../takodeal-manager/staff-documents.js';
const read=file=>readFileSync(new URL('../takodeal-manager/'+file,import.meta.url),'utf8');

test('Owner optional-document modules are exact reviewed592 sources while the separate Staff cohort stays unchanged',()=>{
 assertDocumentReleaseCopies(Object.keys(documentReleasePins.staff));
 assert.equal(createHash('sha256').update(read('staff-document-hq.js')).digest('hex'),documentReleasePins.owner['staff-document-hq.js']);
 assert.deepEqual(DOCUMENT_GROUPS,REQUIRED_DOCUMENT_GROUPS);assert.deepEqual(REQUIRED_DOCUMENT_GROUPS,['valid_id','health_card','clearance']);assert.deepEqual(OPTIONAL_DOCUMENT_GROUPS,['sss_id','philhealth_id','pagibig_id']);
 assert.equal(documentSummary({}).urgentCount,3);assert.equal(documentSummary({},new Date(),{groups:OPTIONAL_DOCUMENT_GROUPS}).urgentCount,0);
 const cards=documentCards({}, {hq:true,groups:SUPPORTED_DOCUMENT_GROUPS});for(const group of SUPPORTED_DOCUMENT_GROUPS)assert.ok(cards.includes('<article class="staff-document-card" data-group="'+group+'"'),group+' gets a distinct card');
});

test('Owner v145 retains the complete six-kind graph with matching page/auth/cache/notice IDs and unchanged persistent caches',()=>{
 const worker=read('sw.js'),context={self:{addEventListener(){},location:{origin:'https://takodeal-manager.vercel.app'}},URL};vm.runInNewContext(worker+'\nglobalThis.cached=[...CORE_ASSETS];',context);
 const cached=new Set(context.cached.map(path=>path.replace(/^\.\//,''))),seen=new Set();function walk(file){if(seen.has(file))return;seen.add(file);assert.ok(cached.has(file),file+' cached');for(const match of read(file).matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+\.js)['"]/g))walk(match[1]);}walk('staff-document-hq.js');
 for(const file of Object.keys(documentReleasePins.owner))assert.ok(cached.has(file));
 const release='auto-branches-20261113-r1';assert.match(read('index.html'),new RegExp('<meta name="takodeal-release" content="'+release+'">'));assert.match(read('index.html'),new RegExp('auth\\.js\\?v='+release+'"'));assert.match(read('auth.js'),new RegExp('main\\.js\\?v='+release));assert.ok(worker.includes("const CACHE_NAME = 'takodeal-manager-core-v148-auto-branches-20261113-r1';"));assert.ok(read('owner-update-notice.js').includes('takodeal-manager-core-v148-auto-branches-20261113-r1'));
 assert.ok(worker.includes("const VENDOR_CACHE = 'takodeal-manager-vendors-v1';"));assert.ok(worker.includes("const IMAGE_CACHE = 'takodeal-manager-images-v1';"));assert.doesNotMatch(worker,/deleteDatabase|localStorage\.clear/);
});

function fixture(){
 const employee='employee',uid='owner',bytes=Uint8Array.from([255,216,255,224,0,1]),sha256=createHash('sha256').update(bytes).digest('hex'),rows=new Map(),calls=[];
 rows.set('staff_document_config/current',{enabled:true,policyVersion:2,brokerEndpoint:DOCUMENT_BROKER_ENDPOINT});
 for(const group of SUPPORTED_DOCUMENT_GROUPS)rows.set('staff_private_documents/'+employee+'/files/'+group,{staffId:employee,branch:'Maa',group,uploadId:'upload-'+group,uploadedByUid:'phone',storagePath:documentFilePath('phone',employee,group,'upload-'+group),sha256,size:6,contentType:'image/jpeg',status:'pending_review',version:1,...(group==='clearance'?{clearanceType:'NBI'}:{})});
 const auth={currentUser:{uid}},sdk={doc:(_db,...parts)=>parts.join('/'),getDocFromServer:async path=>({exists:()=>rows.has(path),data:()=>structuredClone(rows.get(path))}),runTransaction(){assert.fail('No SDK metadata writes');}},broker={download:async(_config,args)=>{calls.push(['download',args]);return new Blob([bytes],{type:'image/jpeg'});}},metadata={review:async(_config,args,{assertCurrent})=>{assertCurrent();calls.push(['review',args]);const path='staff_private_documents/'+employee+'/files/'+args.group,prior=rows.get(path);assert.equal(prior.version,args.expectedVersion);rows.set(path,{...prior,version:prior.version+1,status:args.status});return{reviewed:true,version:prior.version+1};}};
 let operation=0;return{rows,calls,auth,store:createDocumentStore({sdk,auth,db:{},identity:()=>employee,isHQ:true,broker,metadata,uuid:()=> 'review-'+(++operation),now:()=>1000})};
}

test('the actual Owner store reads all six and reviews only the viewed exact optional head through the broker',async()=>{
 const f=fixture(),requiredBefore=structuredClone([...f.rows].filter(([path])=>DOCUMENT_GROUPS.some(group=>path.endsWith('/files/'+group))));
 assert.deepEqual(Object.keys(await f.store.records()).sort(),[...DOCUMENT_GROUPS].sort());assert.deepEqual(Object.keys(await f.store.records({groups:SUPPORTED_DOCUMENT_GROUPS})).sort(),[...SUPPORTED_DOCUMENT_GROUPS].sort());
 for(const group of OPTIONAL_DOCUMENT_GROUPS){const path='staff_private_documents/employee/files/'+group,record=structuredClone(f.rows.get(path));await assert.rejects(f.store.review(group,1,'approved'),/View or download/);await f.store.file(record,{validatePhoto:async blob=>assert.equal(blob.size,6)});await f.store.review(group,1,'approved');assert.equal(f.rows.get(path).status,'approved');assert.equal(f.calls.filter(([action,args])=>action==='review'&&args.group===group).length,1);}
 for(const [path,record]of requiredBefore)assert.deepEqual(f.rows.get(path),record);assert.equal(f.calls.filter(([action])=>action==='review').length,3);
});

test('stale optional heads and foreign account changes cannot establish approval or send a review',async()=>{
 const f=fixture(),path='staff_private_documents/employee/files/sss_id',record=structuredClone(f.rows.get(path));await f.store.file(record,{validatePhoto:async()=>{}});f.rows.set(path,{...record,version:2});await assert.rejects(f.store.review('sss_id',1,'approved'),/changed/);assert.equal(f.calls.filter(([action])=>action==='review').length,0);
 const g=fixture(),other=structuredClone(g.rows.get(path));await assert.rejects(g.store.file(other,{validatePhoto:async()=>{g.auth.currentUser={uid:'different-owner'};}}),/account changed/);await assert.rejects(g.store.review('sss_id',1,'approved'),/View or download/);assert.equal(g.calls.filter(([action])=>action==='review').length,0);
});
