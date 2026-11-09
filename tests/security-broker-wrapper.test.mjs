import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {guardSdkImport} from '../tools/private-broker-sdk-check.mjs';
import {defaultReconciliationSettings} from '../functions/cash-remittance-review/gcash-reconciliation-model.mjs';

test('actual production wrapper routes new GCash, Rider and document actions and existing private loans without cloud access',async()=>{
 const restore=guardSdkImport();
 try{
  const{cashRemittanceReview:handler}=await import('../functions/cash-remittance-review/index.mjs');
  const routes=[
   ['/gcash-reconciliation/settings','https://takodeal-owner.vercel.app',{settings:{...defaultReconciliationSettings(),revision:1},expectedRevision:0}],
   ['/rider-command/claim','https://takodeal-rider.vercel.app',{operationId:'test-only-wrapper',sessionId:'sample-session-0123456789',orderId:'sample-order'}],
   ['/rider-command/review-topup','https://takodeal-owner.vercel.app',{operationId:'test-only-wrapper',riderId:'sample-rider',requestId:'sample-request',decision:'approved',amount:1}],
   ['/document-metadata/upload','https://takodeal-staff.vercel.app',{staffId:'sample-staff',group:'valid_id',uploadId:'sample-upload',expectedVersion:0,sha256:'a'.repeat(64),size:100,clearanceType:'',expiresOn:''}],
   ['/document-metadata/review','https://takodeal-owner.vercel.app',{staffId:'sample-staff',group:'valid_id',uploadId:'sample-upload',expectedVersion:1,sha256:'a'.repeat(64),reviewId:'sample-review',status:'rejected',note:'Sample reason'}],
   ['/staff-loan-ledger','https://takodeal-staff.vercel.app',{deviceId:'DEV-SAMPLE-ONE',staffId:'sample-staff'}]
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
