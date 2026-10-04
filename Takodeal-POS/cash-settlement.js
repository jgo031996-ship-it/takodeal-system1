import { mallCashPlan, mallOpeningCash, money, businessClock } from './branch-operations.js';
const ref = (api, table, id) => api.doc(api.db, table, id);
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
    const {shiftId,branch,cashier,declaredCash,totalCashSales,totalDigitalSales,digitalBreakdown,physicalStockCount,shiftIngredientBurn,variance} = input;
    const policy = await readBranchPolicy(api,branch);
    const accounts = await api.getDocs(api.query(api.collection(api.db,'cash_accounts'),api.where('branch','==','Main Office')));
    const accountPlans = Object.entries(digitalBreakdown).filter(([method,value])=>method.toLowerCase() !== 'gcash' && money(value)>0).map(([name,value]) => {
        const matches = accounts.docs.filter(row=>row.data().name===name);
        if (matches.length>1) throw new Error('Duplicate HQ cash account: '+name);
        return {name,amount:money(value),reference:matches[0]?.ref || ref(api,'cash_accounts','platform-'+encodeURIComponent(name))};
    });
    if (physicalStockCount.length + Object.keys(shiftIngredientBurn).length + accountPlans.length*2 > 430) throw new Error('This shift has too many settlement records. Ask Manager to review it.');
    return api.runTransaction(api.db,async tx => {
        const shiftRef = ref(api,'shifts',shiftId), shift = await tx.get(shiftRef);
        if (!shift.exists() || shift.data().branch !== branch) throw new Error('Shift does not belong to this branch.');
        if (shift.data().active === false && shift.data().status === 'Closed') return 'already-closed';
        const currentPolicy = await tx.get(ref(api,'branches',policy.id));
        if (!currentPolicy.exists()) throw new Error('Branch settings were removed.');
        const stored = shift.data(), isMall = stored.isMallBranch ?? currentPolicy.data().isMallBranch === true;
        const isFinalShiftOfDay = isMall && input.isFinalShiftOfDay === true;
        const plan = isFinalShiftOfDay ? mallCashPlan(declaredCash) : null;
        const accountReads = [];
        for (const account of accountPlans) accountReads.push({ ...account,snapshot:await tx.get(account.reference) });
        const remitRef = ref(api,'remittances','mall-'+shiftId);
        if (isFinalShiftOfDay && (await tx.get(remitRef)).exists()) throw new Error('A mall remittance already exists for this open shift. Ask Manager to review.');
        const expectedCash = money(stored.startingCash ?? 0) + money(totalCashSales) - money(input.cashOut);
        const closing = {...input.closing,active:false,status:'Closed',endTime:api.serverTimestamp(),expectedCash,declaredCash:money(declaredCash),totalCashSales:money(totalCashSales),totalDigitalSales:money(totalDigitalSales),digitalBreakdown,cashPolicyVersion:2};
        if (isMall) Object.assign(closing,{isMallBranch:true,isFinalShiftOfDay,businessDay:input.businessDay || businessClock().day,retainedCash:money(declaredCash),remittedCash:0,remittanceId:''});
        if (plan) Object.assign(closing,{isMallBranch:true,mallFloat:2000,retainedCash:plan.retainedCash,remittedCash:plan.remittedCash,floatShortage:plan.floatShortage,remittanceId:plan.remittedCash>0 ? remitRef.id : ''});
        tx.update(shiftRef,closing);
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
