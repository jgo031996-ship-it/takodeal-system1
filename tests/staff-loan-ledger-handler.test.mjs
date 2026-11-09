import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffLoanLedgerHandler,STAFF_LOAN_ORIGIN} from '../functions/cash-remittance-review/staff-loan-ledger-handler.mjs';
const body={staffId:'sample-staff',deviceId:'DEV-SAMPLE-PHONE'},base={origin:STAFF_LOAN_ORIGIN,path:'/staff-loan-ledger',method:'POST',query:{},contentType:'application/json',authorization:'Bearer SAMPLE_PRIVATE_FIREBASE_TOKEN_123456789',rawSize:JSON.stringify(body).length,body};
function fixture({actor={uid:'sample-private',firebase:{sign_in_provider:'anonymous'}},read=async scope=>({sample:scope.staffId})}={}){
 const calls=[];const handler=createStaffLoanLedgerHandler({verifyToken:async(token,checkRevoked)=>{calls.push(['token',token,checkRevoked]);return actor;},store:{rate:async uid=>calls.push(['rate',uid]),read:async scope=>{calls.push(['read',scope]);return read(scope);}}});return{handler,calls};
}
test('canonical private Staff route checks token revocation and passes only exact bound scope to its store',async()=>{
 const h=fixture(),result=await h.handler(base);assert.equal(result.status,200);assert.equal(result.headers['Access-Control-Allow-Origin'],STAFF_LOAN_ORIGIN);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(h.calls[0][2],true);assert.deepEqual(h.calls[2],['read',{uid:'sample-private',...body}]);
});
test('CORS preflight is exact and rejected origins never receive credentials or reach authentication',async()=>{
 for(const origin of [undefined,'null','https://evil.example','https://takodeal-staff.vercel.app.evil.test','https://takodeal-owner.vercel.app']){const h=fixture(),result=await h.handler({...base,origin});assert.equal(result.status,403);assert.equal(result.headers['Access-Control-Allow-Origin'],undefined);assert.equal(h.calls.length,0);}
 const h=fixture(),good=await h.handler({...base,method:'OPTIONS',preflightMethod:'POST',preflightHeaders:'authorization,content-type'});assert.equal(good.status,204);assert.equal(h.calls.length,0);
 for(const patch of [{preflightMethod:'GET'},{preflightMethod:'POST',preflightHeaders:'X-Unreviewed'}])assert.equal((await h.handler({...base,method:'OPTIONS',...patch})).status,403);
});
test('malformed body, selected names, query, route, method, content and oversized input fail before auth or reads',async()=>{
 for(const patch of [{body:{...body,staffName:'Other'}},{body:{staffId:body.staffId}},{body:{...body,staffId:'bad/id'}},{body:{...body,deviceId:'unbound'}},{body:[]},{rawSize:2049},{query:{staffId:'other'}},{path:'/other'},{method:'GET'},{contentType:'text/plain'}]){
  const h=fixture(),result=await h.handler({...base,...patch});assert.ok([400,404].includes(result.status));assert.equal(h.calls.length,0);
 }
});
test('missing and non-private identities are denied, database failures do not echo private source data',async()=>{
 for(const actor of [{uid:'owner',firebase:{sign_in_provider:'google.com'}},{uid:'bad/id',firebase:{sign_in_provider:'anonymous'}},{uid:'service'}]){const h=fixture({actor});assert.equal((await h.handler(base)).status,403);assert.equal(h.calls.some(call=>call[0]==='read'),false);}
 assert.equal((await fixture().handler({...base,authorization:''})).status,401);
 const h=fixture({read:async()=>{throw Error('SAMPLE_SECRET_PRIVATE_SOURCE');}}),result=await h.handler(base);assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result),/SAMPLE_SECRET/);
});
