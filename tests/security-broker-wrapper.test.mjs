import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {guardSdkImport} from '../tools/private-broker-sdk-check.mjs';
import {defaultReconciliationSettings} from '../functions/cash-remittance-review/gcash-reconciliation-model.mjs';

test('actual production wrapper routes GCash and document actions plus existing private loans without cloud access',async()=>{
 const restore=guardSdkImport();
 try{
  const{cashRemittanceReview:handler}=await import('../functions/cash-remittance-review/index.mjs');
  const routes=[
   ['/gcash-reconciliation/settings','https://takodeal-owner.vercel.app',{settings:{...defaultReconciliationSettings(),revision:1},expectedRevision:0}],
   ['/document-metadata/upload','https://takodeal-staff.vercel.app',{staffId:'sample-staff',group:'valid_id',uploadId:'sample-upload',expectedVersion:0,sha256:'a'.repeat(64),size:100,clearanceType:'',expiresOn:''}],
   ['/document-metadata/review','https://takodeal-owner.vercel.app',{staffId:'sample-staff',group:'valid_id',uploadId:'sample-upload',expectedVersion:1,sha256:'a'.repeat(64),reviewId:'sample-review',status:'rejected',note:'Sample reason'}],
   ['/staff-loan-ledger','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff'}],
   ['/staff-private-profile/read','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff'}],
   ['/staff-private-profile/update','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff',operationId:'sample-contact-op',expectedFingerprint:'a'.repeat(64),patch:{phone:'synthetic'}}],
   ['/staff-private-profile/vault-settings','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff'}],
   ['/staff-private-profile/vault-save','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff',operationId:'sample-vault-op',expectedFingerprint:'a'.repeat(64),mode:'setup',currentPin:'SYNTHETIC-PIN',newPin:'384621'}]
  ];
  for(const[path,origin,body]of routes)for(const method of['OPTIONS','POST']){
   const headers={origin,'content-type':'application/json','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'};
   const request={method,path,headers,query:{},body,rawBody:Buffer.from(JSON.stringify(body)),socket:{remoteAddress:'127.0.0.1'},get(name){return this.headers[name.toLowerCase()];}};
   const response=new EventEmitter();Object.assign(response,{code:200,headers:{},status(code){this.code=code;return this;},set(value){Object.assign(this.headers,value);return this;},setHeader(key,value){this.headers[key]=value;return this;},json(body){this.body=body;this.emit('finish');return this;},end(){this.emit('finish');return this;}});
   await handler(request,response);
   assert.equal(response.code,method==='OPTIONS'?204:401,JSON.stringify({path,method,code:response.code,body:response.body}));
   assert.equal(response.headers['Access-Control-Allow-Origin']||response.headers['access-control-allow-origin'],origin);
  }
 }finally{restore();}
});


test('actual locked-SDK wrapper public route selects publication state and never returns Pending or unpublished reviews',async()=>{
 const restore=guardSdkImport();let db,prior;
 try{
  const{cashRemittanceReview:handler}=await import('../functions/cash-remittance-review/index.mjs'),require=createRequire(new URL('../functions/cash-remittance-review/package.json',import.meta.url)),{getApps}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');db=getFirestore(getApps().find(app=>app.name==='cash-remittance-review'));prior=db.collection;const calls=[];
  db.collection=table=>{assert.equal(table,'reviews');calls.push(['collection',table]);let query;query={orderBy:(...args)=>{calls.push(['orderBy',...args]);return query;},limit:count=>{calls.push(['limit',count]);return query;},select:(...fields)=>{calls.push(['select',fields]);return query;},get:async()=>({docs:[{text:'APPROVED_PUBLIC',status:'Approved',isPublished:true},{text:'PRIVATE_PENDING',status:'Pending',isPublished:false},{text:'PRIVATE_UNPUBLISHED',status:'Approved',isPublished:false},{text:'PRIVATE_LEGACY',status:'Approved'}].map(row=>({data:()=>row}))})};return query;};
  const request=async(method,origin='https://takodeal-customer.vercel.app')=>{const headers={origin,'access-control-request-method':'GET'},req={method,path:'/customer-public/reviews',headers,query:{},rawBody:Buffer.alloc(0),socket:{remoteAddress:'127.0.0.1'},get(name){return headers[name.toLowerCase()];}},res=new EventEmitter();Object.assign(res,{code:0,headers:{},status(code){this.code=code;return this;},set(value){Object.assign(this.headers,value);return this;},setHeader(key,value){this.headers[key]=value;return this;},json(body){this.body=body;this.emit('finish');return this;},end(){this.emit('finish');return this;}});await handler(req,res);return res;};
  assert.equal((await request('OPTIONS')).code,204);const result=await request('GET');assert.equal(result.code,200);assert.equal(result.body.reviews.length,1);assert.equal(result.body.reviews[0].text,'APPROVED_PUBLIC');assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_/);assert.deepEqual(calls.filter(row=>row[0]==='limit'),[['limit',30]]);assert.ok(calls.find(row=>row[0]==='select')[1].includes('isPublished'));assert.equal((await request('GET','https://foreign.invalid')).code,403);assert.equal(calls.filter(row=>row[0]==='collection').length,1);
 }finally{if(db&&prior)db.collection=prior;restore();}
});
