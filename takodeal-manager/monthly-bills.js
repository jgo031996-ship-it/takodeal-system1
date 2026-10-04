const DAY=86400000;
export function billToday(now=new Date()) { return new Date(+now+8*3600000).toISOString().slice(0,10); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value; }
export function billSchedule({dueDate,reminderDays,reminderTime}) {
    if(!validDate(dueDate))throw new Error('A valid first due date is required for every monthly bill.');
    if(reminderDays==='' || reminderDays===undefined || reminderDays===null)throw new Error('A reminder offset is required.');
    const days=Number(reminderDays);
    if(!Number.isInteger(days) || days<0 || days>30)throw new Error('Choose a reminder from 0 to 30 days before the bill.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime || ''))throw new Error('A valid reminder time is required.');
    return {billStartDate:dueDate,billDay:Number(dueDate.slice(8)),billReminderDays:days,billReminderTime:reminderTime};
}
export function billDueDate(bill,month) {
    if(!validDate(bill.billStartDate) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month<bill.billStartDate.slice(0,7))return null;
    const [y,m]=month.split('-').map(Number),day=Number(bill.billDay);
    if(!Number.isInteger(day) || day<1 || day>31)return null;
    return `${month}-${String(Math.min(day,new Date(Date.UTC(y,m,0)).getUTCDate())).padStart(2,'0')}`;
}
export function billAmount(bill,month) {
    return Number(bill.billPayments?.[month]?.amount ?? bill.billAmounts?.[month] ?? bill.limit ?? bill.amount ?? 0);
}
export function billPeriods(bill,now=new Date(),throughMonth=billToday(now).slice(0,7)) {
    if(!billDueDate(bill,bill.billStartDate?.slice(0,7)))return [];
    const rows=[],start=bill.billStartDate.slice(0,7);
    let [y,m]=start.split('-').map(Number);
    for(let i=0;i<1200;i++) {
        const month=`${y}-${String(m).padStart(2,'0')}`;
        if(month>throughMonth)break;
        const dueDate=billDueDate(bill,month),payment=bill.billPayments?.[month];
        const alarmAt=Date.parse(`${dueDate}T${bill.billReminderTime || '09:00'}:00+08:00`)-Number(bill.billReminderDays || 0)*DAY;
        const state=payment?'paid':dueDate<billToday(now)?'overdue':+now>=alarmAt?'due':'upcoming';
        rows.push({month,dueDate,state,alarmAt,payment,amount:billAmount(bill,month)});
        if(++m===13){m=1;y++;}
    }
    return rows;
}
export function billsForPeriod(bills,branch,start,end,now=new Date()) {
    const from=billToday(start),to=billToday(end);
    return bills.filter(b=>branch==='All' || b.branch===branch).flatMap(b=>billPeriods(b,now,to.slice(0,7)).filter(p=>p.dueDate>=from && p.dueDate<=to).map(p=>({...p,billId:b.id,branch:b.branch,category:b.category || b.name})));
}
export function billExpenseId(id,month) {
    if(!/^[\w-]+$/.test(id) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Invalid bill or billing month.');
    return `bill-${id}-${month}`;
}
// A changed utility bill belongs to one month. Optional new defaults preserve
// prior months and explicit overrides; editing estimates never moves cash.
export async function saveBillAmount(api,{billId,month,amount:inputAmount,schedule,useAsDefault=false,actor,allowedBranch}) {
    billExpenseId(billId,month);
    const amount=Math.round(Number(inputAmount)*100)/100;
    if(!Number.isFinite(amount) || amount<=0 || amount>1e9)throw new Error('Enter a bill amount greater than zero.');
    if(!actor)throw new Error('A signed-in manager is required.');
    const ref=api.doc(api.db,'budgets',billId);
    return api.runTransaction(api.db,async tx=>{
        const snapshot=await tx.get(ref);if(!snapshot.exists())throw new Error('This bill no longer exists.');
        const existing=snapshot.data();if(!allowedBranch(existing.branch))throw new Error('This branch is outside your access.');
        const settings=billSchedule({dueDate:schedule.billStartDate,reminderDays:schedule.billReminderDays,reminderTime:schedule.billReminderTime});
        if(existing.billStartDate && existing.billStartDate!==settings.billStartDate)throw new Error('Keep the first due date so unpaid months remain visible.');
        if(!billDueDate({...existing,...settings},month))throw new Error('Choose a billing month on or after the first due date.');
        const paid=existing.billPayments?.[month];
        if(paid && (Number(paid.amount)!==amount || useAsDefault))throw new Error('This month is already paid. Its recorded amount cannot be changed here.');
        const amounts={...(existing.billAmounts || {})};
        if(useAsDefault)for(const period of billPeriods(existing,new Date(),month)) {
            if(period.month<month && amounts[period.month]===undefined)amounts[period.month]=period.amount;
        }
        if(!paid)amounts[month]=amount;
        tx.update(ref,{...settings,billAmounts:amounts,...(useAsDefault?{limit:amount,amount}:{}),billUpdatedBy:actor,billUpdatedAt:api.serverTimestamp()});
    });
}
// One atomic, retry-safe expense, cash deduction and paid marker per bill/month.
export async function recordBillPayment(api,input) {
    const {billId,month,accountId,paymentDate,actor,allowedBranch}=input;
    const amount=Math.round(Number(input.amount)*100)/100;
    if(!Number.isFinite(amount) || amount<=0 || amount>1e9)throw new Error('Enter a valid payment amount.');
    if(!validDate(paymentDate) || paymentDate>billToday())throw new Error('Enter the actual payment date, today or earlier.');
    if(!actor || !accountId)throw new Error('A signed-in manager and cash account are required.');
    const expenseId=billExpenseId(billId,month),expenseRef=api.doc(api.db,'expenses',expenseId),budgetRef=api.doc(api.db,'budgets',billId),accountRef=api.doc(api.db,'cash_accounts',accountId);
    return api.runTransaction(api.db,async tx=>{
        const [budgetSnap,accountSnap,expenseSnap]=await Promise.all([tx.get(budgetRef),tx.get(accountRef),tx.get(expenseRef)]);
        if(!budgetSnap.exists() || !accountSnap.exists())throw new Error('Bill or cash account no longer exists. Refresh and try again.');
        const bill=budgetSnap.data(),account=accountSnap.data(),dueDate=billDueDate(bill,month);
        if(!allowedBranch(bill.branch) || !allowedBranch(account.branch))throw new Error('This branch is outside your access.');
        if(![bill.branch,'Main Office'].includes(account.branch))throw new Error('Choose this branch’s cash account or a Main Office account.');
        if(!dueDate)throw new Error('Set the bill schedule before logging its payment.');
        if(expenseSnap.exists()) {
            const existing=expenseSnap.data();
            if(existing.billId!==billId || existing.billingMonth!==month || existing.amount!==amount || existing.accountId!==accountId || existing.paymentDate!==paymentDate)throw new Error('This billing month was already paid. Check its expense log.');
            return {expenseId,alreadyPaid:true};
        }
        if(bill.billPayments?.[month])throw new Error('This billing month already has a payment. Check its expense log.');
        const balance=Number(account.balance);
        if(!Number.isFinite(balance) || balance<amount)throw new Error('This cash account has insufficient funds.');
        const paymentMonth=paymentDate.slice(0,7),timestamp=new Date(`${paymentDate}T12:00:00+08:00`);
        const payment={expenseId,amount,accountId,paymentDate,dueDate};
        tx.update(accountRef,{balance:Math.round((balance-amount)*100)/100});
        tx.update(budgetRef,{spent:(bill.currentMonth===paymentMonth?Number(bill.spent || 0):0)+amount,currentMonth:paymentMonth,billAmounts:{...(bill.billAmounts || {}),[month]:amount},billPayments:{...(bill.billPayments || {}),[month]:payment}});
        tx.set(expenseRef,{branch:bill.branch,category:bill.category || bill.name,amount,account:account.name,accountId,note:String(input.note || ''),timestamp,paymentDate,billId,billingMonth:month,billDueDate:dueDate,user:actor,createdAt:api.serverTimestamp()});
        tx.set(api.doc(api.db,'account_logs',expenseId),{branch:account.branch,accountName:account.name,accountId,action:'Monthly Bill Payment',amount:-amount,newBalance:Math.round((balance-amount)*100)/100,note:`${bill.branch} · ${bill.category || bill.name} · ${month}`,user:actor,timestamp:api.serverTimestamp(),expenseId});
        return {expenseId,alreadyPaid:false};
    });
}
