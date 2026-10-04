import {billToday,billSchedule,billDueDate,billPeriods,billsForPeriod,recordBillPayment} from './monthly-bills.js';
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+Number(value || 0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=value=>new Date(value+'T12:00:00+08:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
const canManage=()=>!!window.sessionUser && (window.sessionUser.isOwner || window.sessionUser.isFranchisee || window.sessionUser.permissions?.some(p=>['all','accounts'].includes(p)));
export function renderBillForecast(bills,branch,start,end,allowManage=false) {
    const rows=billsForPeriod(bills,branch,start,end).filter(p=>!p.payment);
    const unscheduled=bills.filter(b=>(branch==='All' || b.branch===branch) && !b.billStartDate);
    return `<section class="bill-forecast"><div><h3>📅 Scheduled monthly bills</h3><p>${rows.length} unpaid bill${rows.length===1?'':'s'} due in this period · ${money(rows.reduce((sum,r)=>sum+r.amount,0))} planned</p><small>Payments already logged are included in operating expenses above. Unpaid bills are planned spending.</small>${unscheduled.length?`<p>${unscheduled.length} budget categor${unscheduled.length===1?'y needs':'ies need'} a due date in Cash & Budget.</p>`:''}</div>${allowManage?`<button type="button" onclick="window.switchView('accounts')">Manage bills →</button>`:''}</section>`;
}
export function installMonthlyBills() {
    const el=id=>document.getElementById(id),originalLoad=window.loadAccountsAndBudget,originalView=window.switchView;
    let bills=[],loading=null,lastRefresh=0,alarmKey='',audio=null,sound=false,scope='';
    const api={db:window.db,doc:window.doc,collection:window.collection,runTransaction:window.runTransaction,serverTimestamp:window.serverTimestamp};
    const notify=message=>window.ManagerUI.notify(message);
    function scheduleFields(prefix) {
        return billSchedule({dueDate:el(prefix+'BudgetDueDate').value,reminderDays:el(prefix+'BudgetReminderDays').value,reminderTime:el(prefix+'BudgetReminderTime').value});
    }
    function allowedBranches() {
        return [...new Set(['Main Office',...(window.globalActiveBranches || []),...(window.sessionUser?.allowedBranches || []),...bills.map(b=>b.branch)])].filter(window.isBranchAllowed);
    }
    function row(bill,now) {
        const current=billToday(now).slice(0,7),end=bill.billStartDate?.slice(0,7)>current?bill.billStartDate.slice(0,7):current;
        const amount=Number(bill.limit || bill.amount || 0),periods=billPeriods(bill,now,end);
        const next=periods.find(p=>!p.payment) || {month:current,dueDate:billDueDate(bill,current),state:'paid'};
        const pending=periods.filter(p=>!p.payment),paid=Object.values(bill.billPayments || {}).filter(p=>p.paymentDate?.slice(0,7)===current).reduce((sum,p)=>sum+Number(p.amount || 0),0);
        const schedule=next.dueDate;
        return `<article class="monthly-bill" data-bill-id="${esc(bill.id)}"><div class="monthly-bill-heading"><div><strong>${esc(bill.category || bill.name || 'Monthly bill')}</strong><small>${schedule?`Due ${date(next.dueDate)} · repeats monthly · remind ${bill.billReminderDays} day(s) before at ${esc(bill.billReminderTime)} (PH)`:'First due date required'}</small></div><span class="bill-state ${schedule?next.state:'unscheduled'}">${schedule?{paid:'Paid',overdue:'Overdue',due:'Reminder due',upcoming:'Upcoming'}[next.state]:'Schedule needed'}</span></div><div class="monthly-bill-bottom"><span>${money(paid)} paid this month / ${money(amount)} monthly budget${pending.length>1?` · ${pending.length} unpaid months`:''}</span><div><button type="button" data-bill-action="edit">${schedule?'Edit':'Set schedule'}</button><button type="button" data-bill-action="pay" ${schedule && pending.length?'':'disabled'}>Log payment</button></div></div></article>`;
    }
    function draw() {
        if(!canManage()){if(el('monthlyBillAlarm'))el('monthlyBillAlarm').hidden=true;return;}
        const now=new Date(),groups=new Map();
        for(const b of bills) {if(!groups.has(b.branch))groups.set(b.branch,[]);groups.get(b.branch).push(b);}
        if(el('budgetListBody'))el('budgetListBody').innerHTML=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([branch,items])=>`<section class="monthly-bill-branch"><h3>🏢 ${esc(branch)}</h3>${items.map(b=>row(b,now)).join('')}</section>`).join('') || '<p class="bill-empty">Add a monthly bill and its first due date to start.</p>';
        const alerted=bills.flatMap(b=>billPeriods(b,now).filter(p=>['overdue','due'].includes(p.state)).map(p=>({b,p})));
        const missing=bills.filter(b=>!b.billStartDate).length;
        const alarm=el('monthlyBillAlarm');
        if(alarm){alarm.hidden=!alerted.length && !missing;el('monthlyBillAlarmText').textContent=`${alerted.length} bill reminder${alerted.length===1?'':'s'}${missing?` · ${missing} schedule${missing===1?'':'s'} needed`:''}`;el('monthlyBillAlarmDetail').textContent=alerted.slice(0,3).map(({b,p})=>`${b.branch} · ${b.category || b.name} · ${date(p.dueDate)}`).join(' | ') || 'Set a due date for each monthly budget in Cash & Budget.';}
        const key=billToday(now)+':'+alerted.map(({b,p})=>b.id+p.month).sort().join(',');
        if(alerted.length && sound && audio && key!==alarmKey && document.visibilityState==='visible') {
            const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);gain.gain.value=.08;oscillator.frequency.value=740;oscillator.start();oscillator.stop(audio.currentTime+.3);alarmKey=key;
        }
        if(el('billScheduleSummary'))el('billScheduleSummary').textContent=`${bills.filter(b=>b.billStartDate).length} scheduled · ${missing} need a due date · ${alerted.length} reminders`;
    }
    async function refresh(force=false) {
        if(!canManage()){bills=[];scope='';lastRefresh=0;draw();return;}
        const key=JSON.stringify([window.auth.currentUser?.uid,window.sessionUser.isOwner,window.sessionUser.isFranchisee,window.sessionUser.permissions,window.sessionUser.allowedBranches]);
        if(scope!==key){scope=key;bills=[];lastRefresh=0;}
        if(loading)return loading.then(()=>refresh());
        if(!force && Date.now()-lastRefresh<300000){draw();return;}
        loading=(async()=>{
            try {
                const snapshot=await window.getDocsFromServer(window.collection(window.db,'budgets'));
                if(scope!==key || !canManage())return;
                bills=snapshot.docs.map(d=>({id:d.id,...d.data()})).filter(b=>window.isBranchAllowed(b.branch));
                lastRefresh=Date.now();draw();
            } catch(error) {if(el('billScheduleSummary'))el('billScheduleSummary').textContent='Unable to refresh bill schedules. Reconnect and refresh.';console.error('Monthly bills:',error);}
            finally{loading=null;}
        })();return loading;
    }
    window.loadAccountsAndBudget=async function(...args){await originalLoad.apply(this,args);await refresh(true);};
    window.openAddBudgetModal=function() {
        if(!canManage())return;
        el('newBudgetBranch').innerHTML=allowedBranches().map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
        for(const id of ['newBudgetCategory','newBudgetLimit','newBudgetDueDate'])el(id).value='';
        el('newBudgetReminderDays').value='3';el('newBudgetReminderTime').value='09:00';el('addBudgetModal').style.display='flex';
    };
    window.openEditBudgetModal=function(id) {
        const b=bills.find(b=>b.id===id);if(!b || !canManage())return;
        el('editBudgetId').value=id;el('editBudgetTitle').textContent=`${b.branch} · ${b.category || b.name}`;el('editBudgetLimit').value=b.limit || b.amount || 0;
        el('editBudgetDueDate').value=b.billStartDate || '';el('editBudgetDueDate').readOnly=!!b.billStartDate;
        el('editBudgetReminderDays').value=b.billReminderDays ?? 3;el('editBudgetReminderTime').value=b.billReminderTime || '09:00';el('editBudgetModal').style.display='flex';
    };
    async function save(edit) {
        if(!canManage())return;
        const prefix=edit?'edit':'new',btn=el(edit?'btnSubmitEditBudget':'btnSubmitNewBudget');
        if(btn.disabled)return;
        try {
            const schedule=scheduleFields(prefix),limit=Number(el(prefix+'BudgetLimit').value);
            if(!el(prefix+'BudgetLimit').value || !Number.isFinite(limit) || limit<=0)throw new Error('Enter a monthly bill amount greater than zero.');
            btn.disabled=true;
            if(edit) {
                const id=el('editBudgetId').value,ref=window.doc(window.db,'budgets',id);
                await window.runTransaction(window.db,async tx=>{
                    const snapshot=await tx.get(ref);if(!snapshot.exists())throw new Error('This bill no longer exists.');
                    const existing=snapshot.data();if(!window.isBranchAllowed(existing.branch))throw new Error('This branch is outside your access.');
                    if(existing.billStartDate && existing.billStartDate!==schedule.billStartDate)throw new Error('Keep the first due date so unpaid months remain visible.');
                    tx.update(ref,{limit,amount:limit,...schedule});
                });
            } else {
                const category=el('newBudgetCategory').value.trim(),branch=el('newBudgetBranch').value;
                if(!category || !branch || !window.isBranchAllowed(branch))throw new Error('Select your branch and enter the bill name.');
                await window.addDoc(window.collection(window.db,'budgets'),{branch,category,limit,spent:0,currentMonth:billToday().slice(0,7),...schedule,createdAt:window.serverTimestamp()});
            }
            el(edit?'editBudgetModal':'addBudgetModal').style.display='none';await window.loadAccountsAndBudget();
            notify('Monthly bill and reminder saved.');
        } catch(error){notify(error.message);}finally{btn.disabled=false;}
    }
    window.submitNewBudget=()=>save(false);window.submitEditBudget=()=>save(true);window.editBudget=id=>window.openEditBudgetModal(id);
    function updatePaymentOptions(preferredMonth) {
        const bill=bills.find(b=>b.id===el('logExpBudgetSelect').value);
        if(!bill)return;
        const current=billToday().slice(0,7),end=bill.billStartDate?.slice(0,7)>current?bill.billStartDate.slice(0,7):current;
        const pending=billPeriods(bill,new Date(),end).filter(p=>!p.payment);
        el('logExpBillMonth').innerHTML=pending.map(p=>`<option value="${p.month}">${p.month} · due ${date(p.dueDate)}</option>`).join('');
        if(preferredMonth && pending.some(p=>p.month===preferredMonth))el('logExpBillMonth').value=preferredMonth;
        el('logExpAmount').value=bill.limit || bill.amount || '';
        el('logExpAccSelect').innerHTML='<option value="">Choose a cash account</option>'+(window.liveAccounts || []).filter(a=>window.isBranchAllowed(a.branch) && [bill.branch,'Main Office'].includes(a.branch)).map(a=>`<option value="${esc(a.id)}">${esc(a.branch)} · ${esc(a.name)} · ${money(a.balance)}</option>`).join('');
        el('btnSubmitLogExpense').disabled=!pending.length;
        el('billPaymentHelp').textContent=bill.billStartDate?(pending.length?'Log the actual payment once for this billing month. It updates cash, expense logs and Financial Flow.':'All scheduled months are paid.'):'Set this category’s first due date before logging a monthly payment.';
    }
    window.openLogExpenseModal=function(id,month) {
        if(!canManage())return;
        if(!bills.length){notify('Add a monthly bill first.');return;}
        el('logExpBudgetSelect').innerHTML=bills.map(b=>`<option value="${esc(b.id)}">${esc(b.branch)} · ${esc(b.category || b.name)}</option>`).join('');
        if(id)el('logExpBudgetSelect').value=id;
        el('logExpDate').value=billToday();el('logExpNote').value='';updatePaymentOptions(month);el('logExpenseModal').style.display='flex';
    };
    window.logExpense=window.openLogExpenseModal;
    window.submitLogExpense=async function() {
        const btn=el('btnSubmitLogExpense');if(btn.disabled || !canManage())return;
        btn.disabled=true;
        try {
            await recordBillPayment(api,{billId:el('logExpBudgetSelect').value,month:el('logExpBillMonth').value,accountId:el('logExpAccSelect').value,amount:el('logExpAmount').value,paymentDate:el('logExpDate').value,note:el('logExpNote').value,actor:window.auth.currentUser?.uid,allowedBranch:window.isBranchAllowed});
            el('logExpenseModal').style.display='none';await window.loadAccountsAndBudget();notify('Payment logged once and linked to Financial Flow.');
        } catch(error){notify(error.message);}finally{btn.disabled=false;}
    };
    el('logExpBudgetSelect')?.addEventListener('change',()=>updatePaymentOptions());
    el('budgetListBody')?.addEventListener('click',event=>{
        const button=event.target.closest('[data-bill-action]'),id=button?.closest('[data-bill-id]')?.dataset.billId;
        if(!id)return;if(button.dataset.billAction==='edit')window.openEditBudgetModal(id);else window.openLogExpenseModal(id);
    });
    el('billSoundToggle')?.addEventListener('click',async()=>{
        sound=!sound;
        if(sound){const Audio=window.AudioContext || window.webkitAudioContext;if(Audio){audio ||= new Audio();await audio.resume();}else{sound=false;notify('Sound is unavailable on this browser. Bill reminders remain visible.');}}
        el('billSoundToggle').textContent=sound?'🔔 Alarm sound on':'🔕 Enable alarm sound';el('billSoundToggle').setAttribute('aria-pressed',String(sound));draw();
    });
    window.switchView=function(view,...args){const result=originalView.call(this,view,...args);refresh();return result;};
    const tick=()=>{if(document.visibilityState==='visible')refresh();};
    let interval=window.setInterval(tick,60000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
    window.addEventListener('online',()=>refresh(true));window.addEventListener('pagehide',()=>{window.clearInterval(interval);interval=null;audio?.close();audio=null;sound=false;});
    window.addEventListener('pageshow',()=>{if(interval===null)interval=window.setInterval(tick,60000);refresh();});
    window.renderBillForecast=(...args)=>renderBillForecast(...args,canManage());
}
