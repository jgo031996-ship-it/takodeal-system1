import {prepBackend,prepUI} from './cashier-prep-fixture.mjs';
import {createPrepHandler,PREP_OWNER,PREP_ORIGIN,PREP_CASHIER_ORIGIN} from '../fixtures/measured-prep-backend/prep-handler.mjs';
import {createPrepStore} from '../fixtures/measured-prep-backend/prep-store.mjs';
export function measuredServiceFixture({raw=-250,output=-500,qty=1,actual=400,conversion=500,saved,backend=prepBackend()}={}){
 const access=backend.request;backend.put('inventory/output',{...backend.get('inventory/output'),currentStock:output,purchaseUom:'Pack(1Kg)',conversionRate:conversion});backend.put('inventory/raw',{...backend.get('inventory/raw'),currentStock:raw});
 const handler=createPrepHandler({store:createPrepStore(backend.db,{serverTimestamp:backend.serverTimestamp,now:backend.now}),now:backend.now,verifyToken:async token=>token.startsWith('OWNER')?{uid:'owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}}:{uid:backend.uid,firebase:{sign_in_provider:'anonymous'}}});
 backend.request=(path,body,{owner=false}={})=>path.startsWith('/access/')?access(path,body,{owner}):handler({method:'POST',path,origin:owner?PREP_ORIGIN:PREP_CASHIER_ORIGIN,authorization:'Bearer '+(owner?'OWNER':'DEVICE')+'_SAMPLE_TOKEN_0123456789012345',contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});
 const f=prepUI({backend,saved,legacyDraft:false});f.w.kitchenPrepCart[0].purchQty=qty;f.actualWeight=actual;f.yieldReason='Weighed complete batch before any use';const fire=f.w.Swal.fire;
 f.w.Swal.fire=async options=>{if(options.input==='number'){f.dialogs.push(options);return{isConfirmed:!f.cancelWeight,value:f.actualWeight};}if(options.title==='Explain the yield difference'||options.title==='No usable output — explain the failed batch'){f.dialogs.push(options);return{isConfirmed:!f.cancelYieldReason,value:f.yieldReason};}return fire(options);};return f;
}
