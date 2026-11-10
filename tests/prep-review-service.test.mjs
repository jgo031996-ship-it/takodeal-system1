import test from 'node:test';
import assert from 'node:assert/strict';
import {prepReviewMemory} from './helpers/prep-review-memory.mjs';
import {createPrepHandler,PREP_CASHIER_ORIGIN,PREP_ORIGIN,PREP_OWNER} from '../functions/cash-remittance-review/prep-handler.mjs';
import {createPrepStore} from '../functions/cash-remittance-review/prep-store.mjs';
import {prepSemanticIssue} from '../functions/cash-remittance-review/prep-review-model.mjs';

const uid='prep-review-device',cashier={staffId:'review-crew',deviceId:'DEV-REVIEW-123456',sessionId:'review-cashier-session-0123456789'};
function fixture({branch='Test Branch',outputName='Test Sauce',recipeName=outputName,outputStock=0,rawStock=5000}={}){
 const m=prepReviewMemory(),now=Date.now(),actor={uid,firebase:{sign_in_provider:'anonymous'}};
 m.put('branches/test',{name:branch,active:true});m.put('cashiers/'+cashier.staffId,{cashierName:'TEST Crew',branch:'Home Branch',active:true,pin:'SYNTHETIC-ONLY'});
 const revision=m.rows.get('cashiers/'+cashier.staffId).updateTime;
 m.put('staff_login_sessions/'+uid,{schemaVersion:1,uid,app:'cashier',...cashier,branch,profileRevision:revision.seconds+'|'+revision.nanoseconds,expiresAt:new Date(now+3600000)});
 m.put('pos_bindings/'+uid,{uid,status:'Active',deviceId:cashier.deviceId,branch,legacyDeviceDocId:'test-device'});m.put('pos_devices/test-device',{status:'Active',deviceId:cashier.deviceId,branch,appType:'Cashier'});
 m.put('inventory/output',{name:outputName,branch,category:'Prepared Batch',baseUom:'Gram',uom:'Gram',purchaseUom:'Batch',conversionRate:1000,currentStock:outputStock});
 m.put('inventory/raw',{name:'Test Raw',branch,baseUom:'Gram',uom:'Gram',currentStock:rawStock});m.put('bom/recipe',{menuItem:recipeName,ingredientName:'Test Raw',qty:1000,uom:'Gram'});
 m.put('transactions/unchanged',{netTotal:123,paymentVerified:true});m.put('payroll_records/unchanged',{isPaid:true,finalNetPay:321});
 const store=createPrepStore(m.db,{serverTimestamp:m.serverTimestamp,now:()=>now}),handler=createPrepHandler({store,verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return actor;},now:()=>now});
 const input={operationId:'prep-review-operation',outputInventoryId:'output',qty:2};
 const call=(route,values=input,extra={})=>{const body={...values,cashier};return handler({method:'POST',path:'/prep/'+route,origin:PREP_CASHIER_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body,...extra});};
 return {...m,actor,store,handler,call,input,branch,update:(path,change)=>m.put(path,{...m.get(path),...change}),skip:review=>({...input,branch,declaredName:outputName,expectedIssueFingerprint:review.issueFingerprint,skipReason:'SkipForNow'})};
}
const businessWrites=f=>f.writes.filter(row=>!row.path.startsWith('cash_remittance_attempts/'));
const blocked=async f=>{const result=await f.call('preview');assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,'prep/review-required');assert.equal(result.body.review.skippable,true);return result.body.review;};

test('negative raw stock gets a precise semantic issue; Skip saves one private pending review with zero stock or public notification posting',async()=>{
 const f=fixture({rawStock:-25}),before=[f.get('inventory/output'),f.get('inventory/raw')],review=await blocked(f);
 assert.equal(review.issue.code,'invalid-stock-quantity');assert.match(review.issue.message,/Test Raw.*negative/);assert.equal(review.issue.details.recordedStock,-25);
 const input={...f.skip(review),note:'Please check the counted raw stock.'},saved=await f.call('review-skip',input);
 assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.sourceFingerprint,review.issueFingerprint);assert.equal(saved.body.reviewSaved,true);assert.equal(saved.body.stockPosted,false);assert.equal(saved.body.notSaved,true);
 assert.deepEqual([f.get('inventory/output'),f.get('inventory/raw')],before);assert.equal(f.get('prep_operations/'+f.input.operationId),undefined);assert.ok(!businessWrites(f).some(row=>/^(stock_logs|inventory|transactions|payroll_records)\//.test(row.path)));
 const record=f.get('prep_review_requests/'+f.input.operationId);assert.equal(record.staffId,cashier.staffId);assert.equal(record.sessionId,cashier.sessionId);assert.equal(record.status,'Pending');assert.equal(record.qty,2);assert.equal(f.get('manager_alerts/prep-review-'+f.input.operationId),undefined);
 const writes=businessWrites(f).length;assert.equal((await f.call('review-skip',input)).body.reviewSaved,true);assert.equal(businessWrites(f).length,writes);assert.equal((await f.call('preview')).body.skipped,true);assert.equal((await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:'a'.repeat(64)})).body.code,'prep/review-pending');
 for(const changes of [{qty:3},{note:'Different note'},{declaredName:'Different item'}])assert.equal((await f.call('review-skip',{...input,...changes})).status,409);
 assert.deepEqual(f.get('transactions/unchanged'),{netTotal:123,paymentVerified:true});assert.deepEqual(f.get('payroll_records/unchanged'),{isPaid:true,finalNetPay:321});
});
test('true raw shortage stays blocked while sufficient raw allows a signed negative output balance and exact Owner reversal',async()=>{
 const short=fixture({outputStock:-5000,rawStock:100}),issue=await blocked(short);assert.equal(issue.issue.code,'insufficient-stock');assert.equal(short.get('inventory/output').currentStock,-5000);
 const f=fixture({outputStock:-5000}),quote=await f.call('preview');assert.equal(quote.status,200);assert.equal(quote.body.effects[0].afterStock,-3000);assert.equal(quote.body.warnings[0].code,'negative-output-balance');
 assert.equal((await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:quote.body.expectedFingerprint})).status,200);assert.equal(f.get('inventory/output').currentStock,-3000);assert.equal(f.get('inventory/raw').currentStock,3000);
 f.put('hq_managers/owner',{email:PREP_OWNER,role:'Owner',active:true,pin:'SYNTHETIC',permissions:['all']});const owner=createPrepHandler({store:f.store,verifyToken:async()=>({uid:'owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}})}),call=(route,body)=>owner({method:'POST',path:'/prep/'+route,origin:PREP_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});
 const reverse=await call('reversal-preview',{operationId:f.input.operationId});assert.equal(reverse.body.canReverse,true,JSON.stringify(reverse.body));assert.equal((await call('reverse',{operationId:f.input.operationId,requestId:'reverse-review-operation',expectedFingerprint:reverse.body.expectedFingerprint,reason:'Actual batch was entered twice'})).status,200);assert.equal(f.get('inventory/output').currentStock,-5000);assert.equal(f.get('inventory/raw').currentStock,5000);
});
test('source changes require a fresh warning and a fixed recipe cannot be silently skipped',async()=>{
 const f=fixture({rawStock:-1}),review=await blocked(f);f.update('inventory/raw',{currentStock:-2});assert.equal((await f.call('review-skip',f.skip(review))).body.code,'prep/review-changed');assert.equal(f.get('prep_review_requests/'+f.input.operationId),undefined);
 f.update('inventory/raw',{currentStock:5000});assert.equal((await f.call('review-skip',f.skip(review))).body.code,'prep/review-not-needed');assert.equal(f.get('prep_review_requests/'+f.input.operationId),undefined);
});
test('Skip closes a stale reviewed quote atomically; its original late commit cannot post stock',async()=>{
 const f=fixture(),quote=await f.call('preview');assert.equal(quote.status,200);f.update('inventory/raw',{currentStock:-1});
 const fresh=fixture({rawStock:-1}),warning=await blocked(fresh);assert.ok(warning); // Independent fixture is not accepted as proof for f.
 const request=await f.call('preview');assert.equal(request.body.quoteClosed,true);assert.equal(request.body.review,undefined);
 const newer={...f.input,operationId:'prep-review-after-closed'},review=await f.call('preview',newer);assert.equal(review.body.code,'prep/review-required');
 const skipped=await f.call('review-skip',{...newer,branch:f.branch,declaredName:'Test Sauce',skipReason:'SkipForNow',expectedIssueFingerprint:review.body.review.issueFingerprint});assert.equal(skipped.status,200);
 assert.equal((await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:quote.body.expectedFingerprint})).status,409);assert.equal(f.get('inventory/raw').currentStock,-1);
});
test('an already committed original operation wins over Skip without creating a false unposted review',async()=>{
 const f=fixture(),quote=await f.call('preview');await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:quote.body.expectedFingerprint});
 const result=await f.call('review-skip',{...f.input,branch:f.branch,declaredName:'Test Sauce',skipReason:'SkipForNow',expectedIssueFingerprint:'a'.repeat(64)});assert.equal(result.status,200);assert.equal(result.body.saved,true);assert.equal(result.body.alreadySaved,true);assert.equal(result.body.reviewSaved,false);assert.equal(result.body.skipped,false);assert.equal(f.get('prep_review_requests/'+f.input.operationId),undefined);assert.equal(f.get('inventory/raw').currentStock,3000);
});
test('unknown database failures and lookalike SDK errors cannot become a skippable issue',async()=>{
 assert.equal(prepSemanticIssue(Object.assign(Error('Injected SDK text'),{name:'PrepModelError',skippable:true,issueCode:'insufficient-stock'})),null);
 for(const error of [Object.assign(Error('Private SDK error'),{status:403}),Object.assign(Error('Private SDK error'),{name:'PrepModelError',skippable:true,issueCode:'invalid-recipe'})]){
  const f=fixture(),original=f.store.transaction;f.store.transaction=work=>original(tx=>{tx.ingredientRows=async()=>{throw error;};return work(tx);});const result=await f.call('preview');assert.equal(result.status,503);assert.equal(result.body.review,undefined);assert.doesNotMatch(JSON.stringify(result.body),/Private SDK/);assert.equal(businessWrites(f).length,0);
 }
});
test('failed review commit keeps the private record absent; same reference recovers and a lost reply does not duplicate the review',async()=>{
 const f=fixture({rawStock:-1}),review=await blocked(f),input=f.skip(review),original=f.store.transaction;let fail=true;f.store.transaction=work=>{if(fail){fail=false;f.failNext();}return original(work);};
 assert.equal((await f.call('review-skip',input)).status,503);assert.equal(f.get('prep_review_requests/'+f.input.operationId),undefined);assert.equal(f.get('manager_alerts/prep-review-'+f.input.operationId),undefined);
 await f.call('review-skip',input);const writes=businessWrites(f).length;assert.equal((await f.call('preview')).body.reviewSaved,true);assert.equal((await f.call('review-skip',input)).status,200);assert.equal(businessWrites(f).length,writes);
});
test('three exact duplicate raw rows are a bounded semantic ambiguity rather than a hidden network failure',async()=>{
 const f=fixture();for(const id of ['raw2','raw3'])f.put('inventory/'+id,{...f.get('inventory/raw')});const review=await blocked(f);assert.equal(review.issue.code,'duplicate-ingredient');assert.equal(review.issue.details.matches,3);assert.equal((await f.call('review-skip',f.skip(review))).status,200);assert.equal(f.get('inventory/raw').currentStock,5000);
});
test('an existing unscoped source never borrows the device branch or exposes its item label in a review',async()=>{
 for(const branch of [undefined,null,'','All',' Test Branch ','Other Branch']){
  const f=fixture({rawStock:-1});f.update('inventory/output',{branch,name:'FOREIGN PRIVATE LABEL'});const result=await f.call('preview');assert.ok([403,409].includes(result.status));assert.equal(result.body.review,undefined);assert.doesNotMatch(JSON.stringify(result.body),/FOREIGN PRIVATE LABEL/);
 }
});
test('invalid saved output label and more than thirty recipe rows are explicit semantic issues, not network errors',async()=>{
 const label=fixture();label.update('inventory/output',{name:'x'.repeat(161)});assert.equal((await blocked(label)).issue.code,'output-label-invalid');
 const f=fixture();for(let index=0;index<34;index++)f.put('bom/extra-'+index,{...f.get('bom/recipe')});const review=await blocked(f);assert.equal(review.issue.code,'recipe-unavailable');assert.match(review.issue.message,/more than 30/);assert.equal((await f.call('review-skip',f.skip(review))).status,200);
});
for(const branch of ['Citygate','Cabantian','Maa','Main Office'])test('unique whitespace-only Sauce match preserves source IDs, units and raw names in '+branch,async()=>{
 const f=fixture({branch,outputName:'Takoyaki Sauce  Regular',recipeName:'Takoyaki Sauce Regular'}),quote=await f.call('preview');assert.equal(quote.status,200,JSON.stringify(quote.body));assert.deepEqual(quote.body.recipeMatch,{method:'whitespace-only',outputName:'Takoyaki Sauce  Regular',recipeName:'Takoyaki Sauce Regular'});assert.equal(quote.body.effects[0].name,'Takoyaki Sauce  Regular');
 const originalRecipe=f.get('bom/recipe'),result=await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:quote.body.expectedFingerprint});assert.equal(result.status,200);assert.equal(f.get('prep_operations/'+f.input.operationId).recipe[0].id,'recipe');assert.equal(f.get('prep_operations/'+f.input.operationId).recipe[0].quantityPerBatch,1000);assert.equal(f.get('inventory/output').name,'Takoyaki Sauce  Regular');assert.deepEqual(f.get('bom/recipe'),originalRecipe);assert.equal(f.get('inventory/raw').currentStock,3000);
});
test('whitespace fallback rejects ambiguous output/recipe names, case mismatch and foreign recipe source without guessing',async()=>{
 for(const kind of ['output','recipe','case','foreign']){
  const f=fixture({outputName:'Test  Sauce',recipeName:kind==='case'?'test Sauce':'Test Sauce'});
  if(kind==='output')f.put('inventory/output2',{...f.get('inventory/output'),name:' Test Sauce '});
  if(kind==='recipe')f.put('bom/recipe2',{...f.get('bom/recipe'),menuItem:' Test Sauce '});
  if(kind==='foreign')f.update('bom/recipe',{branch:'Other Branch'});
  const review=await blocked(f);assert.equal(review.issue.code,{output:'output-name-ambiguous',recipe:'recipe-name-ambiguous',case:'recipe-unavailable',foreign:'invalid-recipe'}[kind]);assert.equal(f.get('inventory/raw').currentStock,5000);
 }
});
test('ambiguous-name review fingerprint includes candidate revisions; a changed candidate cannot reuse an old warning',async()=>{
 const f=fixture({outputName:'Test  Sauce',recipeName:'Test Sauce'});f.put('bom/recipe2',{...f.get('bom/recipe'),menuItem:' Test Sauce '});const review=await blocked(f);f.update('bom/recipe2',{note:'Source was reviewed'});assert.equal((await f.call('review-skip',f.skip(review))).body.code,'prep/review-changed');
});
test('a whitespace-matched quote is immutable across source revision changes and old exact quotes remain unchanged',async()=>{
 const f=fixture({outputName:'Test  Sauce',recipeName:'Test Sauce'}),quote=await f.call('preview');f.update('bom/recipe',{qty:999});assert.equal((await f.call('commit',{operationId:f.input.operationId,expectedFingerprint:quote.body.expectedFingerprint})).status,409);assert.equal(f.get('inventory/output').currentStock,0);
 const exact=fixture(),old=await exact.call('preview');assert.equal(old.body.recipeMatch,undefined);assert.equal(exact.get('prep_quotes/'+exact.input.operationId).recipeMatch,undefined);assert.equal((await exact.call('commit',{operationId:exact.input.operationId,expectedFingerprint:old.body.expectedFingerprint})).status,200);
});
test('saved review replays require fresh branch, employee, device, exact UID/session and unchanged original details',async()=>{
 for(const kind of ['branch','binding','mirror','profile','session','foreign']){
  const f=fixture({rawStock:-1}),review=await blocked(f),input=f.skip(review);assert.equal((await f.call('review-skip',input)).status,200);
  if(kind==='branch')f.update('branches/test',{active:false});if(kind==='binding')f.update('pos_bindings/'+uid,{status:'Revoked'});if(kind==='mirror')f.update('pos_devices/test-device',{status:'Revoked'});if(kind==='profile')f.update('cashiers/'+cashier.staffId,{active:false});if(kind==='session')f.update('staff_login_sessions/'+uid,{sessionId:'new-session-0123456789'});if(kind==='foreign')f.actor.uid='foreign-device';
  const result=await f.call('review-skip',input);assert.ok([403,409].includes(result.status),kind+JSON.stringify(result.body));assert.equal(result.body.reviewSaved,undefined);assert.equal(result.body.issue,undefined);
 }
});
test('Skip accepts only exact Cashier origin/body, bounded note and server-derived semantic proof',async()=>{
 const f=fixture({rawStock:-1}),review=await blocked(f),input=f.skip(review);
 for(const change of [{skipReason:'IgnoreEverything'},{expectedIssueFingerprint:'x'},{note:'x'.repeat(501)},{issue:{code:'forged'}},{qty:0},{branch:'Other Branch'}])assert.ok([400,403].includes((await f.call('review-skip',{...input,...change})).status));
 assert.equal((await f.call('review-skip',input,{origin:PREP_ORIGIN})).status,403);assert.equal(f.get('prep_review_requests/'+f.input.operationId),undefined);
});
test('store cannot apply a negative raw quantity or impersonate another output role',async()=>{
 for(const scope of [undefined,{role:'ingredient',outputInventoryId:'output'},{role:'output',outputInventoryId:'raw'}]){
  const f=fixture();await assert.rejects(f.store.transaction(async tx=>{const row=await tx.get('inventory','raw');tx.updateStock('raw',row.updateTime,-1,scope);}));assert.equal(f.get('inventory/raw').currentStock,5000);
 }
 const f=fixture();await assert.rejects(f.store.transaction(async tx=>{const row=await tx.get('inventory','output');tx.updateStock('output',row.updateTime,-1,{role:'ingredient',outputInventoryId:'output'});}));
});
function ownerApi(f,changes={}){
 const actor={uid:'test-owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'},...changes};f.put('hq_managers/owner',{email:PREP_OWNER,role:'Owner',active:true,pin:'SYNTHETIC',permissions:['all']});
 const handler=createPrepHandler({store:f.store,verifyToken:async()=>actor});return {actor,call:(route,body={})=>handler({method:'POST',path:'/prep/'+route,origin:PREP_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body})};
}
test('Owner-private inbox returns only bounded summaries; exact details retain quantity/note/reason with no public alert',async()=>{
 const f=fixture({rawStock:-1,outputName:'Sauce <test> & stock'}),review=await blocked(f),note='Check <count> & signed sheet';await f.call('review-skip',{...f.skip(review),note});const owner=ownerApi(f),list=await owner.call('reviews');assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(list.body.reviews.length,1);assert.equal(list.body.hasMore,false);assert.equal(list.body.nextAfterOperationId,null);
 const summary=list.body.reviews[0];assert.deepEqual(Object.keys(summary).sort(),['operationId','branch','outputInventoryId','outputName','qty','status','stockPosted','createdAt'].sort());assert.equal(summary.outputName,'Sauce <test> & stock');assert.equal(summary.qty,2);assert.match(summary.createdAt,/^\d{4}-\d\d-\d\dT/);assert.equal(summary.note,undefined);
 const detail=await owner.call('review-read',{operationId:f.input.operationId});assert.equal(detail.status,200);assert.equal(detail.body.review.note,note);assert.equal(detail.body.review.issue.details.recordedStock,-1);assert.deepEqual(detail.body.review.reportedBy,{staffId:cashier.staffId,staffName:'TEST Crew'});assert.equal(detail.body.review.sessionId,undefined);assert.equal(detail.body.review.actorUid,undefined);assert.equal(detail.body.review.sources,undefined);assert.ok(!f.writes.some(row=>row.path.startsWith('manager_alerts/')));assert.ok(!JSON.stringify(list.body).includes(note));
});
test('Owner-private inbox uses a verified saved document cursor, returns twenty and never claims its first page is the total backlog',async()=>{
 const f=fixture({rawStock:-1}),review=await blocked(f);await f.call('review-skip',f.skip(review));const template=f.get('prep_review_requests/'+f.input.operationId);for(let i=0;i<25;i++){const id='private-review-'+String(i).padStart(2,'0');f.put('prep_review_requests/'+id,{...template,operationId:id,createdAt:{seconds:1900000000+i,nanoseconds:123456789}});}
 const owner=ownerApi(f),first=await owner.call('reviews');assert.equal(first.status,200);assert.equal(first.body.reviews.length,20);assert.equal(first.body.hasMore,true);assert.equal(first.body.reviews[0].operationId,'private-review-24');assert.equal(first.body.nextAfterOperationId,'private-review-05');
 const second=await owner.call('reviews',{afterOperationId:first.body.nextAfterOperationId});assert.equal(second.status,200);assert.equal(second.body.reviews.length,6);assert.equal(second.body.hasMore,false);assert.equal(second.body.nextAfterOperationId,null);assert.ok(second.body.reviews.every(row=>!first.body.reviews.some(a=>a.operationId===row.operationId)));
 assert.equal(f.queries.filter(q=>q.table==='prep_review_requests').every(q=>q.count===21&&q.ordered),true);assert.equal((await owner.call('reviews',{afterOperationId:'missing-review-reference'})).body.code,'prep/review-unavailable');assert.equal((await owner.call('reviews',{createdAt:'1900-01-01'})).status,400);assert.equal((await owner.call('reviews',{limit:1000})).status,400);
});
test('private read routes deny Cashier/Staff, non-Google, unverified, foreign Owner and fresh revoked canonical authority',async()=>{
 const f=fixture({rawStock:-1}),review=await blocked(f);await f.call('review-skip',f.skip(review));
 assert.equal((await f.call('reviews',{})).status,403);assert.equal((await f.call('review-read',{operationId:f.input.operationId})).status,403);
 for(const actor of [{email:'foreign@example.test'},{email_verified:false},{firebase:{sign_in_provider:'password'}}]){const owner=ownerApi(f,actor);assert.equal((await owner.call('reviews')).status,403);assert.equal((await owner.call('review-read',{operationId:f.input.operationId})).status,403);}
 const owner=ownerApi(f);f.update('hq_managers/owner',{pin:'REVOKED'});assert.equal((await owner.call('reviews')).status,403);assert.equal((await owner.call('review-read',{operationId:f.input.operationId})).status,403);assert.ok(!f.writes.some(row=>row.path.startsWith('manager_alerts/')));
});
