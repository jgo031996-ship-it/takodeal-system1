import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepBackend,prepUI} from './helpers/cashier-prep-fixture.mjs';
import {createPrepHandler,PREP_OWNER,PREP_ORIGIN,PREP_CASHIER_ORIGIN} from './fixtures/prep-review-backend/prep-handler.mjs';
import {createPrepStore} from './fixtures/prep-review-backend/prep-store.mjs';

function fixture({issue='missing',saved}={}){
 const backend=prepBackend(),legacyRequest=backend.request;
 const handler=createPrepHandler({store:createPrepStore(backend.db,{serverTimestamp:backend.serverTimestamp,now:backend.now}),now:backend.now,verifyToken:async token=>token.startsWith('OWNER')?{uid:'owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}}:{uid:backend.uid,firebase:{sign_in_provider:'anonymous'}}});
 backend.request=(path,body,{owner=false}={})=>path.startsWith('/access/')?legacyRequest(path,body,{owner}):handler({method:'POST',path,origin:owner?PREP_ORIGIN:PREP_CASHIER_ORIGIN,authorization:'Bearer '+(owner?'OWNER':'DEVICE')+'_SAMPLE_TOKEN_0123456789012345',contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});
 if(issue==='missing')backend.rows.delete('bom/recipe');
 if(issue==='shortage')backend.put('inventory/raw',{...backend.get('inventory/raw'),currentStock:-1});
 if(issue==='ambiguous')backend.put('inventory/raw-copy',backend.get('inventory/raw'));
 if(issue==='negative')backend.put('inventory/output',{...backend.get('inventory/output'),currentStock:-5000});
 const f=prepUI({backend,saved}),fire=f.w.Swal.fire;
 f.w.Swal.fire=async options=>options.input==='textarea'?(f.dialogs.push(options),{isConfirmed:true,value:'SAMPLE protected note'}):fire(options);
 return f;
}
const reviewRows=f=>[...f.backend.rows].filter(([key])=>key.startsWith('prep_review_requests/'));
const journal=f=>[...f.saved].filter(([key])=>key.startsWith('takodeal_cashier_prep_v2_')).map(([,value])=>JSON.parse(value));

test('actual private-only service and Cashier UI skip exact missing recipe and continue a valid batch',async()=>{
 const f=fixture();f.backend.put('inventory/good',{name:'SAMPLE Good Batch',branch:f.backend.branch,category:'Prepared Batch',baseUom:'Gram',uom:'Gram',purchaseUom:'Batch',conversionRate:1000,currentStock:0});f.backend.put('bom/good',{menuItem:'SAMPLE Good Batch',ingredientName:'SAMPLE Raw',qty:500,uom:'Gram'});f.w.kitchenPrepCart.push({id:'good',name:'SAMPLE Good Batch',branch:f.backend.branch,purchQty:2});
 const result=await f.controller.confirm();assert.equal(result.completed,1,JSON.stringify(result));assert.equal(result.skipped,1);assert.equal(result.remaining,0);
 assert.equal(f.backend.get('inventory/output').currentStock,0);assert.equal(f.backend.get('inventory/good').currentStock,2000);assert.equal(f.backend.get('inventory/raw').currentStock,4000);
 const [[path,{data:review}]]=reviewRows(f);assert.equal(review.qty,2);assert.equal(review.note,'SAMPLE protected note');assert.equal(review.stockPosted,false);assert.equal(review.status,'Pending');assert.equal(review.declaredName,'SAMPLE Sauce');assert.equal(f.backend.writes.some(row=>row.path.startsWith('manager_alerts/')),false);
 const read=await f.backend.request('/prep/review-read',{operationId:path.split('/')[1]},{owner:true});assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.review.qty,2);assert.equal(read.body.review.note,'SAMPLE protected note');
 const cashier=f.calls.find(row=>row.path==='/prep/review-skip').body.cashier;assert.equal((await f.backend.request('/prep/review-read',{operationId:review.operationId,cashier})).status,403);
 assert.deepEqual(f.backend.get('transactions/unrelated'),{netTotal:150,status:'Paid'});assert.deepEqual(f.backend.get('payroll_records/unrelated'),{finalNetPay:80,status:'Paid'});
});

test('actual lost skip reply recovers one original private review without stock effects or a late commit',async()=>{
 const f=fixture({issue:'shortage'});f.afterRequest=async request=>{if(request.path==='/prep/review-skip')throw Error('SAMPLE lost private review reply');};assert.match((await f.controller.confirm()).error,/lost private review/);const original=journal(f)[0],skip=f.calls.find(row=>row.path==='/prep/review-skip').body;assert.equal(reviewRows(f).length,1);assert.equal(f.w.kitchenPrepCart.length,1);
 const next=prepUI({backend:f.backend,saved:f.saved}),result=await next.controller.confirm();assert.equal(result.skipped,1,JSON.stringify(result));assert.equal(result.completed,0);assert.equal(next.calls[0].body.operationId,original.operationId);assert.equal(next.calls[0].body.cashier.sessionId,skip.cashier.sessionId);assert.equal(next.calls.filter(row=>row.path==='/prep/review-skip').length,0);assert.equal(reviewRows(f).length,1);assert.equal(f.backend.get('inventory/raw').currentStock,-1);assert.equal(f.backend.get('inventory/output').currentStock,0);
 const late=await f.backend.request('/prep/commit',{operationId:original.operationId,expectedFingerprint:'a'.repeat(64),cashier:skip.cashier});assert.equal(late.status,409);assert.equal(late.body.code,'prep/review-pending');assert.equal(f.backend.writes.some(row=>row.path.startsWith('stock_logs/')),false);
});

test('actual ambiguous ingredient becomes review while a valid negative prepared balance still saves its real quantity',async()=>{
 const ambiguous=fixture({issue:'ambiguous'}),skipped=await ambiguous.controller.confirm();assert.equal(skipped.skipped,1,JSON.stringify(skipped));assert.equal(reviewRows(ambiguous)[0][1].data.issue.code,'duplicate-ingredient');assert.equal(ambiguous.backend.get('inventory/raw').currentStock,5000);assert.equal(ambiguous.backend.get('inventory/raw-copy').currentStock,5000);
 const negative=fixture({issue:'negative'}),saved=await negative.controller.confirm();assert.equal(saved.completed,1,JSON.stringify(saved));assert.equal(saved.skipped,undefined);assert.equal(negative.backend.get('inventory/output').currentStock,-3000);assert.equal(negative.backend.get('inventory/raw').currentStock,3000);assert.equal(negative.dialogs.some(row=>row.input==='textarea'),false);assert.equal(reviewRows(negative).length,0);
});

test('actual source repair after the Skip prompt holds the original batch instead of silently skipping or preparing',async()=>{
 const f=fixture(),fire=f.w.Swal.fire;f.w.Swal.fire=async options=>{const answer=await fire(options);if(options.input==='textarea')f.backend.put('bom/repaired',{menuItem:'SAMPLE Sauce',ingredientName:'SAMPLE Raw',qty:1000,uom:'Gram'});return answer;};
 const result=await f.controller.confirm();assert.ok(result.error);assert.match(result.error,/now support/);assert.equal(f.w.kitchenPrepCart.length,1);assert.equal(f.w.kitchenPrepCart[0].purchQty,2);assert.equal(reviewRows(f).length,0);assert.equal(f.backend.get('inventory/raw').currentStock,5000);assert.equal(journal(f)[0].state,'pending');
});

test('the staged runtime fixture stays exactly pinned and contains no public review notification writer',()=>{
 const root=new URL('./fixtures/prep-review-backend/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
 assert.equal(manifest.sourceBase,'650409386054048399ccda3675a2333fe4188833');assert.equal(Object.keys(manifest.files).length,7);
 for(const [file,record]of Object.entries(manifest.files)){const bytes=readFileSync(new URL(file,root));assert.equal(bytes.length,record.bytes,file);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,file);}
 assert.doesNotMatch(readFileSync(new URL('prep-store.mjs',root),'utf8'),/manager_alerts/);
});
