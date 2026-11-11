import {prepBackend,prepUI} from './cashier-prep-fixture.mjs';
import {createPrepHandler,PREP_OWNER,PREP_ORIGIN,PREP_CASHIER_ORIGIN} from '../fixtures/actual-prep-backend/prep-handler.mjs';
import {createPrepStore} from '../fixtures/actual-prep-backend/prep-store.mjs';
export function actualServiceFixture({raw=-250,output=-500,qty=1,legacyDraft='actual-v2',saved}={}){
 const backend=prepBackend(),access=backend.request;
 backend.put('inventory/output',{...backend.get('inventory/output'),currentStock:output,purchaseUom:'Pack(1Kg)',conversionRate:500});backend.put('inventory/raw',{...backend.get('inventory/raw'),currentStock:raw});
 const handler=createPrepHandler({store:createPrepStore(backend.db,{serverTimestamp:backend.serverTimestamp,now:backend.now}),now:backend.now,verifyToken:async token=>token.startsWith('OWNER')?{uid:'owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}}:{uid:backend.uid,firebase:{sign_in_provider:'anonymous'}}});
 backend.request=(path,body,{owner=false}={})=>path.startsWith('/access/')?access(path,body,{owner}):handler({method:'POST',path,origin:owner?PREP_ORIGIN:PREP_CASHIER_ORIGIN,authorization:'Bearer '+(owner?'OWNER':'DEVICE')+'_SAMPLE_TOKEN_0123456789012345',contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});
 const f=prepUI({backend,saved,legacyDraft});f.w.kitchenPrepCart[0].purchQty=qty;return f;
}
