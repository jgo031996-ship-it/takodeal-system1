import {accessId,accessDocumentId,accessDevice,STAFF_PIN_PURPOSES,isAccessOwner} from './access-model.mjs';
const origins={staff:'https://takodeal-staff.vercel.app',cashier:'https://takodeal-cashier.vercel.app',rider:'https://takodeal-rider.vercel.app',owner:'https://takodeal-owner.vercel.app',customer:'https://takodeal-customer.vercel.app',franchise:'https://takodeal-franchise.vercel.app'};
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const pin=value=>typeof value==='string'&&/^\d{4,10}$/.test(value);
const scopeId=accessDocumentId;
const routes=new Set(['/access/staff-login','/access/verify-staff-pin','/access/meal-identity','/access/staff-logout','/access/change-staff-pin','/access/staff-options','/access/staff-payroll-history','/access/staff-payroll-inputs','/access/staff-operational-history','/access/staff-payroll-acknowledge','/access/cashier-close-shift']);
export function createAccessHandler({verifyToken,store}={}){
 if(typeof verifyToken!=='function'||typeof store?.login!=='function')throw Error('A trusted account access service is required.');
 return async request=>{
  const app=Object.keys(origins).find(key=>origins[key]===request.origin),headers={'Cache-Control':'no-store',Pragma:'no-cache',Vary:'Origin','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',...(app?{'Access-Control-Allow-Origin':request.origin}:{})},response=(status,body)=>({status,headers,body});
  try{
   if(!app||!routes.has(request.path))fail(403,'access/origin','Use the approved TAKODEÁL app.');
   if(request.method==='OPTIONS'){
    if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(value=>!['authorization','content-type'].includes(value)))fail(403,'access/preflight','Use the approved app.');
    return{...response(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};
   }
   const maxBytes=request.path==='/access/staff-payroll-acknowledge'?352*1024:request.path==='/access/cashier-close-shift'?128*1024:4096;
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>maxBytes||!object(request.body)||Buffer.byteLength(JSON.stringify(request.body))>maxBytes)fail(400,'access/request','Reopen this account check in the app.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)fail(401,'access/sign-in','Reconnect to verify this app account.');
   let actor;try{actor=await verifyToken(token,true);}catch{fail(401,'access/sign-in','Sign in again to verify this account.');}
   if(!accessId(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous'&&!isAccessOwner(actor))fail(403,'access/identity','Use your approved device identity.');
   const body=request.body,route=request.path.slice('/access/'.length);
   if(['staff-login','verify-staff-pin'].includes(route)){
    const proof=route==='verify-staff-pin';
    if(!['staff','cashier'].includes(app)||!only(body,proof?['pin','staffId','deviceId','app','purpose']:['pin','deviceId','app','sessionId'],proof?['branch','scope','sessionId']:['branch','selectedStaffId'])||body.app!==app||!pin(body.pin)||!accessDevice(body.deviceId)||body.branch!==undefined&&(typeof body.branch!=='string'||!body.branch.trim()||body.branch.length>120)||app==='cashier'&&body.branch===undefined||body.selectedStaffId!==undefined&&!accessId(body.selectedStaffId)||(!proof||app==='staff')&&(!accessId(body.sessionId)||body.sessionId.length<16)||body.sessionId!==undefined&&(!accessId(body.sessionId)||body.sessionId.length<16)||proof&&(!accessId(body.staffId)||!STAFF_PIN_PURPOSES.includes(body.purpose)||body.scope!==undefined&&!scopeId(body.scope)))fail(400,'access/request','Check the employee PIN and the saved device.');
    if(proof&&(['purchase','meal'].includes(body.purpose)&&!scopeId(body.scope)||app==='cashier'&&body.purpose!=='time-clock'&&body.sessionId===undefined))fail(400,'access/request','Sign in to the Cashier app and reopen this exact PIN action.');
    await store.rate(actor.uid,request.trustedIP,route);
    return response(200,proof?await store.verifyPin(body,actor):await store.login(body,actor));
   }
   if(route==='staff-logout'){
    if(!['staff','cashier'].includes(app)||!only(body,['deviceId','app','sessionId'],['branch'])||body.app!==app||!accessDevice(body.deviceId)||!accessId(body.sessionId)||body.sessionId.length<16||body.branch!==undefined&&(typeof body.branch!=='string'||body.branch.length>120))fail(400,'access/request','Reopen this account action.');
    await store.rate(actor.uid,request.trustedIP,'staff-logout');
    return response(200,await store.logout(body,actor));
   }
   if(route==='staff-options'){
    if(app!=='staff'||!only(body,[])||actor.firebase?.sign_in_provider!=='anonymous')fail(400,'access/request','Reopen Staff setup.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.options(actor));
   }
   if(route==='change-staff-pin'){
    if(app!=='staff'||actor.firebase?.sign_in_provider!=='anonymous'||!only(body,['staffId','deviceId','newPin','operationId','expectedVersion'])||!accessId(body.staffId)||!accessDevice(body.deviceId)||!pin(body.newPin)||!accessId(body.operationId)||body.operationId.length<8||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)fail(400,'access/request','Use 4–10 digits for your daily Staff PIN.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.changePin(body,actor));
   }
   if(['staff-payroll-history','staff-payroll-inputs'].includes(route)){
    if(app!=='staff'||actor.firebase?.sign_in_provider!=='anonymous'||!only(body,['staffId','deviceId'])||!accessId(body.staffId)||!accessDevice(body.deviceId))fail(400,'access/request','Reopen your private payslip history.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store[route==='staff-payroll-history'?'payroll':'payrollInputs'](body,actor));
   }
   if(route==='cashier-close-shift'){
    if(app!=='cashier'||!only(body,['deviceId','app','branch','sessionId','shiftId','declaredCash','isFinalShiftOfDay','businessDay','expectedSalesRevision','expectedCash','cashBreakdown','physicalStockCount'])||body.app!==app||!accessDevice(body.deviceId)||!accessId(body.sessionId)||body.sessionId.length<16||!scopeId(body.shiftId)||typeof body.branch!=='string'||!body.branch.trim()||body.branch.length>120)fail(400,'access/request','Reopen this exact shift close review on the approved tablet.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.closeCashierShift(body,actor));
   }
   if(route==='staff-operational-history'){
    if(!['staff','cashier'].includes(app)||!only(body,['staffId','deviceId','app','table'],['sessionId'])||body.app!==app||!accessId(body.staffId)||!accessDevice(body.deviceId)||!['attendance_logs','sop_logs','staff_requests','hr_sanctions','announcements','acknowledgments','shift_swaps'].includes(body.table)||body.sessionId!==undefined&&(!accessId(body.sessionId)||body.sessionId.length<16)||app==='staff'&&body.sessionId===undefined)fail(400,'access/request','Reopen your own operational history.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.operationalHistory(body,actor));
   }
   if(route==='staff-payroll-acknowledge'){
    if(app!=='staff'||actor.firebase?.sign_in_provider!=='anonymous'||!only(body,['staffId','deviceId','recordId','signatureBase64','expectedFingerprint','operationId'])||!accessId(body.staffId)||!accessDevice(body.deviceId)||!accessId(body.recordId)||!accessId(body.operationId)||typeof body.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedFingerprint)||typeof body.signatureBase64!=='string'||body.signatureBase64.length>352*1024)fail(400,'access/request','Reopen this exact saved payslip before acknowledging it.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.acknowledgePayroll(body,actor));
   }
   if(route==='meal-identity'){
    if(app!=='cashier'||!only(body,['pin','deviceId','app','branch','scope','mealLevelId','sessionId'])||body.app!=='cashier'||!pin(body.pin)||!accessDevice(body.deviceId)||typeof body.branch!=='string'||!body.branch.trim()||body.branch.length>120||!scopeId(body.scope)||!accessId(body.mealLevelId)||!accessId(body.sessionId)||body.sessionId.length<16)fail(400,'access/request','Reopen the meal PIN confirmation on this tablet.');
    await store.rate(actor.uid,request.trustedIP,route);return response(200,await store.mealIdentity(body,actor));
   }
   fail(404,'access/route','This account action is unavailable.');
  }catch(error){return response(error.status||503,{code:error.status?error.code:'access/unavailable',message:error.status?error.message:'The account check could not be confirmed. Reconnect and try again.'});}
 };
}
