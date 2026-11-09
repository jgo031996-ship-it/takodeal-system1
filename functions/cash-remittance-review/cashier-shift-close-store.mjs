import {accessId,accessDevice,accessDocumentId,activeAccessStaff,isAccessOwner} from './access-model.mjs';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const hold=message=>fail(409,'access/shift-review',message);
const deny=()=>fail(403,'access/approval','The current Cashier account or tablet needs HQ confirmation.');
const stamp=value=>value?.toMillis?.()??(value instanceof Date?+value:Date.parse(value));
const revision=value=>value?String(value.seconds??value._seconds)+'|'+String(value.nanoseconds??value._nanoseconds):'';
const decimal=value=>typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value.trim())?Number(value.trim()):value;
const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001)hold('A saved shift amount needs HQ review.');return Math.round(value*100);};
const accountCents=value=>{value=decimal(value);if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001)hold('An HQ account balance needs review.');return Math.round(value*100);};
const amount=value=>cents(value)/100;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
const response=(shiftId,branch,status)=>({schemaVersion:1,shiftId,branch,status});
const data=snap=>snap?.exists?snap.data():null;
export function createCashierShiftCloser(db,{now=Date.now,serverTimestamp}={}){
 if(typeof serverTimestamp!=='function')throw Error('A trusted shift close clock is required.');
 return async(body,actor)=>{
  if(!accessId(actor?.uid)||!accessDevice(body.deviceId)||body.app!=='cashier'||!accessId(body.sessionId)||!accessDocumentId(body.shiftId)||!text(body.branch)||!Number.isSafeInteger(body.expectedSalesRevision)||body.expectedSalesRevision<0||typeof body.isFinalShiftOfDay!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDay||'')||!Array.isArray(body.physicalStockCount)||body.physicalStockCount.length>100||!body.cashBreakdown||typeof body.cashBreakdown!=='object'||Array.isArray(body.cashBreakdown))deny();
  const declared=cents(body.declaredCash),expectedReview=cents(body.expectedCash);
  let counted=0;const cashBreakdown={};for(const [key,value]of Object.entries(body.cashBreakdown)){
   if(!/^₱(?:1000|500|200|100|50|20|10|5|1|0\.25)$/.test(key)||!Number.isSafeInteger(value)||value<0||value>1000000)hold('Check the saved cash denominations.');counted+=Math.round(Number(key.slice(1))*100)*value;cashBreakdown[key]=value;
  }if(!Number.isSafeInteger(counted)||counted!==declared)hold('The cash denominations do not equal the declared amount. Reopen the shift close review.');
  const physical=body.physicalStockCount.map(item=>{
   const allowed=['name','systemExpected','actualCount','baseCost','uom','purchUom','convRate','rawPurchCount','rawBaseCount'];
   if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!allowed.includes(key))||!text(item.name)||!text(item.uom)||item.purchUom!=null&&!text(item.purchUom))hold('A physical count item needs review.');
   for(const key of ['systemExpected','actualCount','baseCost','convRate','rawPurchCount','rawBaseCount'])if(item[key]!=null&&(typeof item[key]!=='number'||!Number.isFinite(item[key])||key!=='systemExpected'&&item[key]<0))hold('A physical count quantity is invalid.');
   if(!Number.isFinite(item.actualCount)||!Number.isFinite(item.systemExpected))hold('Complete every physical stock count.');return {...item};
  });
  if(new Set(physical.map(row=>row.name)).size!==physical.length)hold('Duplicate physical stock count items need HQ review.');
  return db.runTransaction(async tx=>{
   const read=async path=>data(await tx.get(db.doc(path))),session=await read('staff_login_sessions/'+actor.uid);
   if(session?.schemaVersion!==1||session.uid!==actor.uid||session.app!=='cashier'||session.sessionId!==body.sessionId||session.deviceId!==body.deviceId||session.branch!==body.branch||!Number.isFinite(stamp(session.expiresAt))||stamp(session.expiresAt)<=now()||!accessId(session.staffId))deny();
   const profileSnap=await tx.get(db.doc('cashiers/'+session.staffId)),profile=data(profileSnap);if(!activeAccessStaff(profile)||session.profileRevision!==revision(profileSnap.updateTime))deny();
   if(isAccessOwner(actor)){
    const mirrors=await tx.get(db.collection('pos_devices').where('deviceId','==',body.deviceId).limit(3));if(mirrors.docs.length!==1||mirrors.docs[0].data().status!=='Active'||mirrors.docs[0].data().branch!==body.branch||String(mirrors.docs[0].data().appType||'').toLowerCase()==='staff')deny();
   }else{
    if(actor.firebase?.sign_in_provider!=='anonymous')deny();const binding=await read('pos_bindings/'+actor.uid);if(binding?.uid!==actor.uid||binding.status!=='Active'||binding.branch!==body.branch||binding.deviceId!==body.deviceId||!accessId(binding.legacyDeviceDocId))deny();const mirror=await read('pos_devices/'+binding.legacyDeviceDocId);if(mirror?.status!=='Active'||mirror.branch!==body.branch||mirror.deviceId!==body.deviceId||String(mirror.appType||'').toLowerCase()==='staff')deny();
   }
   const shiftRef=db.doc('shifts/'+body.shiftId),shiftSnap=await tx.get(shiftRef),shift=data(shiftSnap);if(!shift||shift.branch!==body.branch)hold('This shift does not belong to the approved branch.');
   if(shift.active===false&&shift.status==='Closed')return response(body.shiftId,body.branch,'already-closed');
   if(shift.active!==true||Number(shift.salesRevision||0)!==body.expectedSalesRevision)hold('Sales changed during the closing review. Refresh this shift before closing.');
   const [branches,receipts,expenses,accounts]=await Promise.all([
    tx.get(db.collection('branches').where('name','==',body.branch).limit(3)),
    tx.get(db.collection('transactions').where('branch','==',body.branch).where('shiftId','==',body.shiftId).limit(2001)),
    tx.get(db.collection('expenses').where('branch','==',body.branch).where('shiftId','==',body.shiftId).limit(501)),
    tx.get(db.collection('cash_accounts').where('branch','==','Main Office').limit(101))]);
   if(branches.docs.length!==1||branches.docs[0].data().active===false||branches.docs[0].data().archived===true||receipts.size>=2001||expenses.size>=501||accounts.size>=101)hold('This shift has an ambiguous branch or exceeds the safe settlement size. Ask HQ to review it.');
   const policy=branches.docs[0].data();let cash=0,digital=0,cashOut=0;const breakdown=Object.create(null),burn=Object.create(null);
   const addBurn=row=>{for(const movement of row.inventoryMovements||[]){if(!text(movement.ingredientName)||typeof movement.quantity!=='number'||!Number.isFinite(movement.quantity)||movement.quantity<0)hold('A captured stock movement needs HQ review.');if(movement.quantity>0)burn[movement.ingredientName]=(burn[movement.ingredientName]||0)+movement.quantity;}};
   for(const saved of receipts.docs){const row=saved.data();if(row.isPendingSync===true)hold('Some saved sales still need upload confirmation.');if(row.status==='Voided'){if(row.preparedCancellation?.prepared===true)addBurn(row);continue;}if(!['Paid','Completed','Complete','Settled','Received',undefined].includes(row.status))hold('A saved receipt has an unresolved payment state.');addBurn(row);
    const total=cents(row.netTotal);if(row.splitDetails!=null&&(!Array.isArray(row.splitDetails)||row.splitDetails.length>20))hold('A split payment needs HQ review.');
    const parts=row.splitDetails?.length?row.splitDetails:[{method:row.paymentMethod||'Cash',amount:row.netTotal}];let partsTotal=0;
    for(const part of parts){if(!text(part.method)||part.method!==part.method.trim())hold('A payment method needs HQ review.');const value=cents(part.amount);partsTotal+=value;if(part.method==='Cash')cash+=value;else{digital+=value;breakdown[part.method]=(breakdown[part.method]||0)+value;}}
    if(partsTotal!==total)hold('A saved split payment does not equal its receipt total.');
   }
   for(const saved of expenses.docs){const row=saved.data();if(![row.paidFrom,row.sourceAccount,row.paymentSource].includes('Manager Fund'))cashOut+=cents(decimal(row.amount));}
   if(![cash,digital,cashOut].every(Number.isSafeInteger))hold('Shift amounts exceed the safe range.');const expected=cents(shift.startingCash??0)+cash-cashOut;if(expected<0||expected!==expectedReview)hold('The saved sales or expenses changed. Refresh the closing review before confirming its cash expectation.');if(expected>0&&declared===0)hold('Recount the drawer before submitting a zero cash count.');
   const plans=[];for(const [name,value]of Object.entries(breakdown)){if(['gcash','salary deduction'].includes(name.toLowerCase())||value===0)continue;const matches=accounts.docs.filter(row=>row.data().name===name);if(matches.length>1)hold('An HQ platform account is duplicated. Ask HQ to review it.');const reference=matches[0]?.ref||db.doc('cash_accounts/platform-'+encodeURIComponent(name)),snapshot=matches[0]||await tx.get(reference),prior=data(snapshot);if(prior&&(prior.branch!=='Main Office'||prior.name!==name))hold('An HQ account identity changed.');const balance=(prior?accountCents(prior.balance):0)+value;if(!Number.isSafeInteger(balance))hold('An HQ account balance needs review.');plans.push({name,value,reference,prior,balance});}
   const isMall=shift.isMallBranch??policy.isMallBranch===true,final=isMall&&body.isFinalShiftOfDay,remitRef=db.doc('remittances/mall-'+body.shiftId);if(final&&data(await tx.get(remitRef)))hold('This open shift already has a mall remittance. Ask HQ to review it.');
   const phDay=new Date(now()+8*3600000).toISOString().slice(0,10);if(isMall&&body.businessDay!==phDay)hold('The Philippine business day changed. Reopen the daily closing review.');
   const royaltyPct=Number(policy.royaltyPercent||0);if(!Number.isFinite(royaltyPct)||royaltyPct<0||royaltyPct>100)hold('The saved royalty setting needs HQ review.');const royalty=Math.round((cash+digital)*royaltyPct/100);
   if(physical.length+Object.keys(burn).length+plans.length*2>430)hold('This shift needs a smaller reviewed settlement.');
   const at=serverTimestamp(),closedBy={version:1,actorType:'staff',source:'pos-session',staffId:session.staffId,staffName:profile.cashierName,authUid:actor.uid,branch:body.branch,staffBranch:profile.branch,recordedAt:at},breakdownMoney=Object.fromEntries(Object.entries(breakdown).map(([key,value])=>[key,value/100]));
   const closing={active:false,status:'Closed',endTime:at,closedBy,expectedCash:expected/100,declaredCash:declared/100,totalCashSales:cash/100,totalDigitalSales:digital/100,digitalBreakdown:breakdownMoney,cashPolicyVersion:2,cashBreakdown,physicalStockCount:physical};
   if(isMall)Object.assign(closing,{isMallBranch:true,isFinalShiftOfDay:final,businessDay:phDay,retainedCash:declared/100,remittedCash:0,remittanceId:''});const remitted=final?Math.max(0,declared-200000):0;if(final)Object.assign(closing,{mallFloat:2000,retainedCash:Math.min(declared,200000)/100,remittedCash:remitted/100,floatShortage:Math.max(0,200000-declared)/100,remittanceId:remitted>0?remitRef.id:''});
   tx.update(shiftRef,closing);
   if(remitted>0)tx.create(remitRef,{branch:body.branch,shiftId:body.shiftId,cashierName:profile.cashierName,amount:remitted/100,retainedCash:closing.retainedCash,type:'Mall Daily Remittance',channel:'Physical Handover',status:'Pending',dateStr:phDay,timestamp:at,cashPolicyVersion:2});
   for(const plan of plans){tx.set(plan.reference,{...(plan.prior||{}),name:plan.name,branch:'Main Office',balance:plan.balance/100});tx.create(db.doc('account_logs/shift-'+body.shiftId+'-'+encodeURIComponent(plan.name)),{accountId:plan.reference.id,accountName:plan.name,branch:'Main Office',action:'Auto-Sweep (Shift Close)',amount:plan.value/100,newBalance:plan.balance/100,user:profile.cashierName,timestamp:at,note:'From '+body.branch});}
   if(royalty>0)tx.create(db.doc('franchise_ledger/royalty-'+body.shiftId),{branch:body.branch,type:'Charge',category:'Daily Franchise Royalty',amount:royalty/100,description:'Shift close royalty',loggedBy:'System Z-Reading',timestamp:at});
   if(Math.abs(declared-expected)>5)tx.set(db.doc('manager_alerts/cash-variance-'+body.shiftId),{type:'VARIANCE_ALERT',branch:body.branch,cashier:profile.cashierName,shiftId:body.shiftId,expected:expected/100,declared:declared/100,varianceAmount:(declared-expected)/100,message:'Cash variance recorded at shift close.',explanationCause:'Awaiting Staff Letter...',explanationMessage:'',explanationStatus:'Pending',timestamp:at,isRead:false});
   physical.forEach((item,index)=>{if(item.actualCount<item.systemExpected)tx.set(db.doc('manager_alerts/stock-variance-'+body.shiftId+'-'+index),{type:'STOCK_SHORTAGE_ALERT',branch:body.branch,cashier:profile.cashierName,shiftId:body.shiftId,message:'STOCK SHORTAGE: '+item.name+', '+(item.systemExpected-item.actualCount)+' '+item.uom+'.',timestamp:at,isRead:false});});
   for(const [name,quantity]of Object.entries(burn))if(quantity>0)tx.create(db.doc('stock_logs/shift-burn-'+body.shiftId+'-'+encodeURIComponent(name)),{branch:body.branch,item:name,uom:'Units',oldQty:'Shift',newQty:'Summary',variance:-quantity,type:'Shift Sales Deduction',note:profile.cashierName+' shift ingredient use',user:profile.cashierName,timestamp:at});
   return response(body.shiftId,body.branch,'closed');
  });
 };
}
