import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),path='functions/cash-remittance-review/index.mjs',source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
const proof=JSON.parse(readFileSync(new URL('./fixtures/cashier-void-router-inverse.json',import.meta.url),'utf8')),sha=v=>createHash('sha256').update(v).digest('hex');
test('the additive void router restores every existing live592 byte without changing a prior route or request mapping',()=>{
 let restored=source;for(const [from,to]of [...proof.cuts].reverse()){assert.equal(restored.split(to).length,2);restored=restored.replace(to,from);}
 assert.equal(sha(source),proof.candidateSha256);assert.equal(sha(restored),proof.baselineSha256);assert.equal(restored,execFileSync('git',['show',proof.base+':'+path],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:2**20}));
});
const names=['staffPrivateProfileHandle','documentMetadataHandle','gcashHandle','ownerTimeOutHandle','reliefHandle','accessHandle','loanHandle','prepHandle','riderHandle','hqUploadHandle','customerPublicHandle','cashierVoidHandle','handle'];
function fixture(){
 const calls=[],fnStart=source.indexOf('async(request,response)=>{',source.indexOf('export const cashRemittanceReview=')),body=source.slice(fnStart+'async(request,response)=>{'.length,source.lastIndexOf('\n});'));
 assert.ok(fnStart>0);const run=new Function(...names,'serialize','return async(request,response)=>{'+body+'}');
 const f=run(...names.map(name=>async request=>{calls.push({name,request});return {status:request.method==='OPTIONS'?204:200,headers:{'Cache-Control':'no-store'},body:request.method==='OPTIONS'?null:{handler:name}};}),v=>v);
 return {calls,async dispatch(path,method='POST'){
  const fields={Origin:'https://takodeal-cashier.vercel.app','Content-Type':'application/json',Authorization:'Bearer FICTIONAL_TOKEN_ONLY','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type','X-Forwarded-For':'do-not-trust-forwarded-input'};
  const request={method,path,query:{},body:{operationId:'sample-reference'},rawBody:Buffer.alloc(41),socket:{remoteAddress:'127.0.0.1'},get:key=>fields[key]},response={status(code){this.statusCode=code;return this;},set(headers){this.headers=headers;return this;},json(body){this.body=body;},end(){this.ended=true;}};
  await f(request,response);return {request,response};
 }};
}
for(const route of ['preview','commit','status','cancel','replacement-claim'])test('fixed void '+route+' is dispatched with the existing bounded raw request and socket-derived IP',async()=>{
 const f=fixture(),{request,response}=await f.dispatch('/cashier-void/'+route),saved=f.calls[0];assert.equal(f.calls.length,1);assert.equal(saved.name,'cashierVoidHandle');
 assert.deepEqual(saved.request,{method:'POST',path:request.path,query:request.query,origin:'https://takodeal-cashier.vercel.app',contentType:'application/json',authorization:'Bearer FICTIONAL_TOKEN_ONLY',rawSize:41,body:request.body,trustedIP:'127.0.0.1',preflightMethod:'POST',preflightHeaders:'authorization,content-type'});assert.equal(response.statusCode,200);assert.equal(response.body.handler,'cashierVoidHandle');
});
test('void preflight is sent to the same handler and produces no JSON body',async()=>{const f=fixture(),{response}=await f.dispatch('/cashier-void/preview','OPTIONS');assert.equal(f.calls[0].name,'cashierVoidHandle');assert.equal(response.statusCode,204);assert.equal(response.ended,true);assert.equal(Object.hasOwn(response,'body'),false);});
for(const [path,name]of [['/staff-private-profile/read','staffPrivateProfileHandle'],['/document-metadata/read','documentMetadataHandle'],['/gcash-reconciliation/preview','gcashHandle'],['/owner-time-out/preview','ownerTimeOutHandle'],['/relief-hours/preview','reliefHandle'],['/access/staff-login','accessHandle'],['/staff-loan-ledger','loanHandle'],['/prep/preview','prepHandle'],['/rider-access/login','riderHandle'],['/hq-upload/preview','hqUploadHandle'],['/customer-public/reviews','customerPublicHandle'],['/cashier-voided/commit','handle'],['/cashier-void','handle'],['/','handle']])test('existing dispatch remains exact for '+path,async()=>{const f=fixture(),{response}=await f.dispatch(path);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,name);assert.equal(response.body.handler,name);});
