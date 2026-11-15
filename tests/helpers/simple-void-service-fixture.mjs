import {createAccessHandler} from '../fixtures/receipt-void-backend/access-handler.mjs';
import {createAccessStore} from '../fixtures/receipt-void-backend/access-store.mjs';
import {createCashierVoidHandler} from '../fixtures/receipt-void-backend/cashier-void-handler.mjs';
import {voidFixture,sampleActor,sampleNow} from './void-service-fixture.mjs';
import {voidUI} from './cashier-void-fixture.mjs';
export async function simpleVoidFixture(reason='OrderCancelled',options={}){
 let clock=sampleNow;const server=await voidFixture({reason,clock:()=>clock,...options}),h=server.h;
 const access=createAccessHandler({store:createAccessStore(h.db,{serverTimestamp:h.serverTimestamp,now:()=>clock}),verifyToken:async()=>sampleActor});
 const handler=createCashierVoidHandler({store:server.store,verifyToken:async()=>sampleActor,now:()=>clock});
 const backend={uid:sampleActor.uid,staffId:server.body.staffId,deviceId:server.body.deviceId,branch:server.body.branch,now:()=>clock,setNow:value=>clock=value,
  request:(path,body)=>(path.startsWith('/access/')?access:handler)({method:'POST',path,origin:'https://takodeal-cashier.vercel.app',authorization:'Bearer '+'s'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body,trustedIP:'192.0.2.4'})};
 const f=voidUI({backend});f.reason=reason;f.w.sessionUser={...f.w.sessionUser,cashierName:'Sample Cashier'};f.w.currentShift={active:true,shiftId:server.body.shiftId};
 return Object.assign(f,{server,h,go:()=>f.controller.start(server.body.saleId,server.body.receiptId),operations:()=>[...h.rows].filter(([path])=>path.startsWith('cashier_void_operations/')).map(([,row])=>row.data),alerts:()=>[...h.rows].filter(([path])=>path.startsWith('manager_alerts/')).map(([,row])=>row.data)});
}
