import { mallCashPlan, mallOpeningCash, money, businessClock } from './branch-operations.js';
const ref = (api, table, id) => api.doc(api.db, table, id);
const text=value=>String(value??'').trim();
const staffKey=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,160}$/.test(value);
const sessionKey=session=>JSON.stringify([session?.staffId??session?.id??null,session?.cashierName,session?.branch,session?.pin??null]);
const staffActive=profile=>profile&&profile.active!==false&&profile.archived!==true&&profile.blocked!==true&&!/blocked|revoked|inactive|disabled|terminated|resigned|deleted|archived/i.test(text(profile.status))&&!/^(BLOCKED|REVOKED)$/i.test(text(profile.pin));
export function captureShiftCloseIdentity(api,branch){
 const session=api.sessionUser,authUid=api.auth?.currentUser?.uid??null;
 if(!session||!text(session.cashierName)||!text(branch)||session.branch!==branch)throw Error('Sign in to the current branch with your own staff account before closing this shift.');
 const savedId=session.staffId??session.id??null;
 if(savedId!==null&&!staffKey(savedId))throw Error('Your saved staff account ID is invalid. Sign in again before closing.');
 const captured={sessionRef:session,key:sessionKey(session),staffId:savedId,staffName:String(session.cashierName),authUid,branch};assertShiftCloseIdentity(api,captured);return captured;
}
export function assertShiftCloseIdentity(api,captured){
 const deviceBranch=api.localStorage?.getItem?.('takodeal_device_branch');
 if(!captured||api.sessionUser!==captured.sessionRef||sessionKey(api.sessionUser)!==captured.key||(api.auth?.currentUser?.uid??null)!==captured.authUid||deviceBranch&&deviceBranch!==captured.branch)throw Error('The signed-in cashier or working branch changed. Reopen the shift close review.');
}
export async function resolveShiftCloseIdentity(api,captured){
 assertShiftCloseIdentity(api,captured);let staffId=captured.staffId;
 if(!staffId){
  if(!text(captured.sessionRef.pin))throw Error('Your saved login has no staff account ID. Sign in again before closing this shift.');
  const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',captured.staffName)));
  assertShiftCloseIdentity(api,captured);
  if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||snap.docs.length!==1||snap.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites)||!staffActive(snap.docs[0].data())||String(snap.docs[0].data().cashierName)!==captured.staffName||String(snap.docs[0].data().pin)!==String(captured.sessionRef.pin)||!staffKey(snap.docs[0].id))throw Error('Your current staff account could not be identified uniquely. Sign in again before closing.');
  staffId=snap.docs[0].id;
 }
 return {version:1,actorType:'staff',source:'pos-session',staffId,staffName:captured.staffName,authUid:captured.authUid,branch:captured.branch};
}
async function closeIdentity(tx,api,input,stamp){
 const closer=input.closer,guard=input.assertCurrent||(()=>{});guard();
 if(!closer)return {version:1,actorType:'unknown',source:'legacy-unknown',staffId:null,staffName:null,authUid:null,branch:input.branch,staffBranch:null,recordedAt:stamp};
 if(closer.version!==1||closer.actorType!=='staff'||closer.source!=='pos-session'||!staffKey(closer.staffId)||!text(closer.staffName)||closer.branch!==input.branch||(closer.authUid??null)!==(api.auth?.currentUser?.uid??null))throw Error('The closing staff account changed. Reopen this shift close review.');
 const snap=await tx.get(ref(api,'cashiers',closer.staffId));guard();const profile=snap.exists()?snap.data():null;
 if(!staffActive(profile)||String(profile.cashierName)!==closer.staffName||!text(profile.branch)||api.sessionUser?.pin!==undefined&&String(api.sessionUser.pin)!==String(profile.pin))throw Error('The saved closing staff account is inactive or changed. Sign in again before closing.');
 return {version:1,actorType:'staff',source:'pos-session',staffId:closer.staffId,staffName:closer.staffName,authUid:closer.authUid??null,branch:input.branch,staffBranch:profile.branch,recordedAt:stamp};
}
// Compatibility close has no receipt/account settlement. Preserve its existing
// financial fields, but capture the same actual operator and never replace a
// saved closer when a caller retries an already ended shift.
export async function closeLegacyShiftAtomic(api,input){
 input={...input,closer:input.closer?{...input.closer}:undefined};
 return api.runTransaction(api.db,async tx=>{const shiftRef=ref(api,'shifts',input.shiftId),snap=await tx.get(shiftRef);if(!snap.exists()||snap.data().branch!==input.branch)throw Error('Shift does not belong to this branch.');if(snap.data().active===false||snap.data().status==='Closed')return 'already-closed';const stamp=api.serverTimestamp(),closedBy=await closeIdentity(tx,api,input,stamp);input.assertCurrent?.();tx.update(shiftRef,{active:false,endTime:stamp,actualCash:input.actualCash,expectedCash:input.expectedCash,difference:input.diff,closedBy});return 'closed';});
}
export async function readBranchPolicy(api, branch) {
    const snap = await (api.getDocsFromServer || api.getDocs)(api.query(api.collection(api.db,'branches'),api.where('name','==',branch)));
    if (snap.docs.length !== 1) throw new Error('Branch settings are missing or duplicated. Ask Manager to check this branch.');
    return { id:snap.docs[0].id, ...snap.docs[0].data() };
}
export async function readMallOpeningCash(api, branch) {
    const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'shifts'),api.where('branch','==',branch),api.where('status','==','Closed'),api.orderBy('endTime','desc'),api.limit(1)));
    return mallOpeningCash(snap.docs[0]?.data());
}
export async function closeShiftAtomic(api, input) {
    input={...input,closer:input.closer?{...input.closer}:undefined};
    const {shiftId,branch,cashier,declaredCash,totalCashSales,totalDigitalSales,digitalBreakdown,physicalStockCount,shiftIngredientBurn,variance} = input;
    input.assertCurrent?.();const policy = await readBranchPolicy(api,branch);input.assertCurrent?.();
    const accounts = await api.getDocs(api.query(api.collection(api.db,'cash_accounts'),api.where('branch','==','Main Office')));
    input.assertCurrent?.();
    const accountPlans = Object.entries(digitalBreakdown).filter(([method,value])=>!['gcash','salary deduction'].includes(method.trim().toLowerCase()) && money(value)>0).map(([name,value]) => {
        const matches = accounts.docs.filter(row=>row.data().name===name);
        if (matches.length>1) throw new Error('Duplicate HQ cash account: '+name);
        return {name,amount:money(value),reference:matches[0]?.ref || ref(api,'cash_accounts','platform-'+encodeURIComponent(name))};
    });
    if (physicalStockCount.length + Object.keys(shiftIngredientBurn).length + accountPlans.length*2 > 430) throw new Error('This shift has too many settlement records. Ask Manager to review it.');
    return api.runTransaction(api.db,async tx => {
        const shiftRef = ref(api,'shifts',shiftId), shift = await tx.get(shiftRef);
        if (!shift.exists() || shift.data().branch !== branch) throw new Error('Shift does not belong to this branch.');
        if (shift.data().active === false && shift.data().status === 'Closed') return 'already-closed';
        input.assertCurrent?.();
        const currentPolicy = await tx.get(ref(api,'branches',policy.id));
        if (!currentPolicy.exists()) throw new Error('Branch settings were removed.');
        if (input.expectedSalesRevision !== undefined && Number(shift.data().salesRevision || 0) !== input.expectedSalesRevision) throw new Error('Sales changed during shift close. Reload the closing review before settling.');
        const stored = shift.data(), isMall = stored.isMallBranch ?? currentPolicy.data().isMallBranch === true;
        const isFinalShiftOfDay = isMall && input.isFinalShiftOfDay === true;
        const plan = isFinalShiftOfDay ? mallCashPlan(declaredCash) : null;
        const accountReads = [];
        for (const account of accountPlans) accountReads.push({ ...account,snapshot:await tx.get(account.reference) });
        const remitRef = ref(api,'remittances','mall-'+shiftId);
        if (isFinalShiftOfDay && (await tx.get(remitRef)).exists()) throw new Error('A mall remittance already exists for this open shift. Ask Manager to review.');
        const expectedCash = money(stored.startingCash ?? 0) + money(totalCashSales) - money(input.cashOut);
        const stamp=api.serverTimestamp(),closedBy=await closeIdentity(tx,api,input,stamp);
        const closing = {...input.closing,active:false,status:'Closed',endTime:stamp,closedBy,expectedCash,declaredCash:money(declaredCash),totalCashSales:money(totalCashSales),totalDigitalSales:money(totalDigitalSales),digitalBreakdown,cashPolicyVersion:2};
        if (isMall) Object.assign(closing,{isMallBranch:true,isFinalShiftOfDay,businessDay:input.businessDay || businessClock().day,retainedCash:money(declaredCash),remittedCash:0,remittanceId:''});
        if (plan) Object.assign(closing,{isMallBranch:true,mallFloat:2000,retainedCash:plan.retainedCash,remittedCash:plan.remittedCash,floatShortage:plan.floatShortage,remittanceId:plan.remittedCash>0 ? remitRef.id : ''});
        input.assertCurrent?.();tx.update(shiftRef,closing);
        if (plan?.remittedCash > 0) tx.set(remitRef,{branch,shiftId,cashierName:cashier,amount:plan.remittedCash,retainedCash:plan.retainedCash,type:'Mall Daily Remittance',channel:'Physical Handover',status:'Pending',dateStr:closing.businessDay,timestamp:api.serverTimestamp(),cashPolicyVersion:2});
        for (const account of accountReads) {
            const data = account.snapshot.exists() ? account.snapshot.data() : {};
            if (account.snapshot.exists() && (data.branch !== 'Main Office' || data.name !== account.name)) throw new Error('HQ account identity changed.');
            const balance = Number(data.balance ?? 0) + account.amount;
            if (!Number.isFinite(balance)) throw new Error('HQ account has an invalid balance.');
            tx.set(account.reference,{...data,name:account.name,branch:'Main Office',balance},{merge:true});
            tx.set(ref(api,'account_logs','shift-'+shiftId+'-'+encodeURIComponent(account.name)),{accountId:account.reference.id,accountName:account.name,branch:'Main Office',action:'Auto-Sweep (Shift Close)',amount:account.amount,newBalance:balance,user:cashier,timestamp:api.serverTimestamp(),note:'From '+branch});
        }
        const royalty = (money(totalCashSales)+money(totalDigitalSales)) * Number(currentPolicy.data().royaltyPercent || 0)/100;
        if (royalty>0) tx.set(ref(api,'franchise_ledger','royalty-'+shiftId),{branch,type:'Charge',category:'Daily Franchise Royalty',amount:money(royalty),description:'Shift close royalty',loggedBy:'System Z-Reading',timestamp:api.serverTimestamp()});
        if (Math.abs(declaredCash-expectedCash)>0.05) tx.set(ref(api,'manager_alerts','cash-variance-'+shiftId),{type:'VARIANCE_ALERT',branch,cashier,shiftId,expected:expectedCash,declared:declaredCash,varianceAmount:declaredCash-expectedCash,message:'Cash variance recorded at shift close.',explanationCause:'Awaiting Staff Letter...',explanationMessage:'',explanationStatus:'Pending',timestamp:api.serverTimestamp(),isRead:false});
        for (let index=0;index<physicalStockCount.length;index++) {
            const item=physicalStockCount[index], difference=item.actualCount-item.systemExpected;
            if (difference<0) tx.set(ref(api,'manager_alerts','stock-variance-'+shiftId+'-'+index),{type:'STOCK_SHORTAGE_ALERT',branch,cashier,shiftId,message:`STOCK SHORTAGE: ${item.name}, ${Math.abs(difference)} ${item.uom}.`,timestamp:api.serverTimestamp(),isRead:false});
        }
        for (const [name,quantity] of Object.entries(shiftIngredientBurn)) if (quantity>0) tx.set(ref(api,'stock_logs','shift-burn-'+shiftId+'-'+encodeURIComponent(name)),{branch,item:name,uom:'Units',oldQty:'Shift',newQty:'Summary',variance:-quantity,type:'Shift Sales Deduction',note:cashier+' shift ingredient use',user:cashier,timestamp:api.serverTimestamp()});
        return 'closed';
    });
}
export async function approveRemittanceAtomic(api, remitId, accountRef, actor) {
    return api.runTransaction(api.db,async tx=> {
        const remitRef=ref(api,'remittances',remitId), remit=await tx.get(remitRef);
        if (!remit.exists()) throw new Error('Remittance not found.');
        if (remit.data().status === 'Received') return 'already-received';
        if (remit.data().status !== 'Pending') throw new Error('Only pending remittances can be received.');
        const account=await tx.get(accountRef);
        if (!account.exists()) throw new Error('Cash account not found.');
        const data=account.data(), amount=money(remit.data().amount), balance=Number(data.balance)+amount;
        const targetName = remit.data().channel === 'Physical Handover' ? 'Cash' : remit.data().channel;
        if (data.branch !== 'Main Office' || data.name !== targetName || !Number.isFinite(balance)) throw new Error('HQ cash account changed. Reload this remittance.');
        tx.update(accountRef,{balance});
        tx.set(ref(api,'account_logs','remittance-'+remitId),{accountId:accountRef.id,accountName:data.name,branch:data.branch,action:'Remittance received',amount,newBalance:balance,user:actor,note:'From '+remit.data().branch,timestamp:api.serverTimestamp()});
        tx.update(remitRef,{status:'Received',receivedAt:api.serverTimestamp(),approvedBy:actor,targetAccountId:accountRef.id});
        return 'received';
    });
}
