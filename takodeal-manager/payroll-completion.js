import {readPayrollSnapshot} from './payroll-preview-guard.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
import {ensureManagerLibrary} from './manager-libraries.js';
import {checkSavedPayrollPayment,PAYROLL_SETTLEMENT_LIMITS} from './payroll-settlement.js';

export function payrollActorKey(api){
    const user=api.auth?.currentUser,session=api.sessionUser;
    if(!user?.uid||!user.email||user.emailVerified!==true||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==user.email.toLowerCase()||session.isFranchisee===true||!canOpenWorkspacePage(session,'payroll'))throw Error('Sign in with your approved payroll account.');
    return JSON.stringify([user.uid,user.email.toLowerCase(),session.role,session.permissions,session.allowedBranches]);
}
function allowed(api,branch){return api.auth.currentUser.email.toLowerCase()===OWNER_EMAIL||api.sessionUser.allowedBranches?.includes('All')||api.sessionUser.allowedBranches?.includes(branch);}
export async function loadPayrollAccounts(api,assertCurrent=()=>{}){
    const actor=payrollActorKey(api);assertCurrent();
    const snap=await readPayrollSnapshot(api,api.collection(api.db,'cash_accounts'));
    assertCurrent();if(payrollActorKey(api)!==actor)throw Error('The payroll account changed. Reopen the payslip.');
    return snap.docs.map(row=>({...row.data(),id:row.id})).filter(row=>allowed(api,row.branch)&&Number.isFinite(Number(row.balance)));
}
const amount=value=>Number.isFinite(Number(value))?Number(value):0;
export function payrollEstimate(data){
    if(data.attendanceReviewRequired)return 0;
    if(data.isPaid&&Number.isFinite(Number(data.finalNetPay)))return Math.max(0,Number(data.finalNetPay));
    // This is the same cutoff estimate used by the generator; paid rows use the
    // exact confirmed net amount, including any edits made in their payslip.
    return Math.max(0,amount(data.basicPay)+amount(data.nightBonus??data.nightBonusTotal)+amount(data.straightBonus)+amount(data.holidayPayTotal)+amount(data.perfBonus)-['cashShortages','onlineRefunds','meals','advances','loans','sss','pagibig','philhealth','lateDeduction'].reduce((sum,key)=>sum+amount(data[key]),0));
}
export function applyConfirmedPayroll(api,d,data,saved,{actorKey}={}){
    const frozen={...(saved.frozenData||data)},identity=Object.fromEntries(['name','staffId','branch','start','end'].map(key=>[key,data[key]]));
    // A recovered legacy snapshot may omit a newer deduction field. Do not
    // merge an unsaved preview's charges into that already-paid document.
    for(const key of Object.keys(data))delete data[key];
    Object.assign(data,identity,frozen,{isPaid:true,finalNetPay:saved.finalNetPay??frozen.finalNetPay});
    let current;try{current=payrollActorKey(api);}catch{return false;}
    if(actorKey&&current!==actorKey)return false;
    if(api.globalPayrollCache?.[data.name]!==data)return false;
    if(d.getElementById('payrollStart')?.value!==data.start||d.getElementById('payrollEnd')?.value!==data.end)return false;
    api.paidPayrollSnapshots||=new WeakSet();api.paidPayrollSnapshots.add(data);
    const account=api.liveAccounts?.find(row=>row.id===saved.accountId);
    if(account&&Number.isFinite(saved.accountBalance))account.balance=saved.accountBalance;
    const rows=d.getElementById('payrollGeneratorBody')?.querySelectorAll('tr')||[];
    const row=[...rows].find(item=>item.cells?.[0]?.textContent.trim()===data.name);
    if(row){
        row.style.background='#f8fafc';row.style.opacity='0.85';
        const button=row.querySelector('button');if(button){button.textContent='✅ View Paid Payslip';button.style.background='#475569';}
        if(row.cells?.[2])row.cells[2].textContent=amount(data.hours??data.totalHours).toFixed(2)+' hrs'+(amount(data.nightBonus)?' · ₱'+amount(data.nightBonus).toFixed(2)+' Mid/Night Bonus':'')+(amount(data.perfBonus)?' · ₱'+amount(data.perfBonus).toFixed(2)+' Reward':'');
        if(row.cells?.[3]){const deduct=['cashShortages','onlineRefunds','meals','advances','loans','sss','pagibig','philhealth','lateDeduction'].reduce((sum,key)=>sum+amount(data[key]),0);row.cells[3].textContent='Total: ₱'+deduct.toFixed(2)+' · Paid and saved';}
    }
    const total=d.getElementById('payrollGrandTotalAmount');
    if(total)total.innerText='₱'+Object.values(api.globalPayrollCache).reduce((sum,item)=>sum+payrollEstimate(item),0).toLocaleString(undefined,{minimumFractionDigits:2});
    return true;
}

const paymentCheckUI=new WeakMap();
export function checkSavedPayslipPayment(api,d,{data=api.currentPayslipData,button=d.getElementById('btnCheckSavedPayslip'),onFound=()=>{},inspect=checkSavedPayrollPayment,timeoutMs=PAYROLL_SETTLEMENT_LIMITS.timeoutMs}={}){
    if(!data)return Promise.resolve({status:'unavailable'});
    const existing=paymentCheckUI.get(api);if(existing?.data===data)return existing.promise;
    let actorKey;try{actorKey=payrollActorKey(api);}catch(error){api.ManagerUI?.notify?.(error.message);return Promise.resolve({status:'unconfirmed'});}
    const selection=JSON.stringify([data.staffId,data.name,data.branch,data.start,data.end]);
    const current=()=>{if(payrollActorKey(api)!==actorKey||api.currentPayslipData!==data||(api.globalPayrollCache&&api.globalPayrollCache[data.name]!==data)||JSON.stringify([data.staffId,data.name,data.branch,data.start,data.end])!==selection||d.getElementById('payrollStart')?.value!==data.start||d.getElementById('payrollEnd')?.value!==data.end)throw Error('The selected payslip or payroll account changed. Reopen it before checking payment.');};
    const isCurrent=()=>{try{current();return true;}catch{return false;}};
    const label=button?.innerText,disabled=button?.disabled;if(button){button.disabled=true;button.innerText='Checking saved payment…';}
    const entry={data};
    entry.promise=Promise.resolve().then(async()=>{let timer,result;
        try{
            current();result=await Promise.race([inspect(api,{data,assertCurrent:current}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Saved payroll could not be confirmed in time. Reconnect and check again. No payment or deduction was changed.')),timeoutMs);})]);current();
            if(result.status==='paid'){
                applyConfirmedPayroll(api,d,data,result,{actorKey});
                try{await onFound(result);}catch{if(isCurrent())api.ManagerUI?.notify?.('Saved payment confirmed. Reopen View Paid Payslip to view the recorded figures.');return result;}
                if(isCurrent())api.ManagerUI?.notify?.('Saved payment confirmed: ₱'+Number(result.finalNetPay).toLocaleString(undefined,{minimumFractionDigits:2})+(result.accountName?' · '+result.accountName:'')+'. No new payment or deduction.');
            }else if(result.status==='not-recorded'){
                if(isCurrent())api.ManagerUI?.notify?.('No saved payment for this cutoff ('+data.start+' to '+data.end+'). This check only searches payroll records saved in the app. If you already paid outside the app, confirm the original payment date, account and amount before recording it. Nothing was marked paid or deducted.',{type:'info'});
            }else throw Error('Saved payment could not be confirmed. Reconnect and check again. No payment or deduction was changed.');
            return result;
        }catch(error){if(isCurrent())api.ManagerUI?.notify?.(error.message||'Saved payment could not be confirmed. No payment or deduction was changed.');return {status:'unconfirmed'};}
        finally{clearTimeout(timer);if(button&&isCurrent()){button.disabled=disabled;button.innerText=label;}if(paymentCheckUI.get(api)===entry)paymentCheckUI.delete(api);}
    });
    paymentCheckUI.set(api,entry);return entry.promise;
}

const imageQueues=new WeakMap();
const heldUnpaid=(api,data)=>!!data&&!data.isPaid&&!api.paidPayrollSnapshots?.has(data)&&!!(data.attendanceReviewRequired||data.salaryReviewRequired);
const heldExportError=()=>Object.assign(Error('This payroll is a review draft. Choose Review affected records, resolve its checks and generate a fresh payroll list before downloading a payslip.'),{code:'payroll-review-required'});
export function syncPayslipImageButton(api,d){const button=d.getElementById('btnDownloadPayslip');if(button){const pending=imageQueues.get(api)?.active.has(api.currentPayslipData),held=heldUnpaid(api,api.currentPayslipData);button.disabled=!!pending||held;button.innerText=pending?'Preparing payslip image…':held?'Review before download':'⬇️ Download Image';}}
const formStamp=node=>[...node.querySelectorAll('input')].map(input=>[input.id,input.value]).map(value=>JSON.stringify(value)).join('|');
export function exportPayslipImage(api,d,{load=ensureManagerLibrary,capture}={}){
    let actor;try{actor=payrollActorKey(api);}catch(error){return Promise.reject(error);}
    const data=api.currentPayslipData,original=d.getElementById('printablePayslip');
    if(!data||!original)return Promise.reject(Error('Open a payslip before downloading its image.'));
    if(heldUnpaid(api,data))return Promise.reject(heldExportError());
    if(!allowed(api,data.branch))return Promise.reject(Error('This payslip is outside your assigned branches.'));
    const guard=()=>{if(payrollActorKey(api)!==actor)throw Error('The payroll account changed. Download was stopped.');if(heldUnpaid(api,data))throw heldExportError();};
    let state=imageQueues.get(api);if(!state){state={tail:Promise.resolve(),active:new Map(),count:0};imageQueues.set(api,state);}
    if(state.active.has(data))return state.active.get(data);
    if(state.count>=4)return Promise.reject(Error('Several payslips are being prepared. Wait for their downloads, then try again.'));
    // Capture the visible form before any asynchronous library load or queue.
    // Later selections cannot rename this image or close another employee's form.
    const name=String(d.getElementById('psName')?.innerText||data.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'_');
    const end=String(data.end||'').replace(/[^0-9-]/g,'');
    const capturedForm=formStamp(original),clone=original.cloneNode(true),wrapper=d.createElement('div');wrapper.className='payroll-image-export';
    Object.assign(wrapper.style,{position:'absolute',left:'-9999px',top:'0',background:'#fff',width:'800px',padding:'20px',boxSizing:'border-box'});
    Object.assign(clone.style,{overflow:'visible',maxHeight:'none',height:'auto'});
    for(const input of clone.querySelectorAll('input')){const span=d.createElement('span');span.textContent=input.value;span.style.fontWeight='bold';span.style.fontSize='14px';input.parentNode.replaceChild(span,input);}
    wrapper.appendChild(clone);
    const button=d.getElementById('btnDownloadPayslip');
    if(button){button.disabled=true;button.innerText='Preparing payslip image…';}
    state.count++;
    const work=async()=>{
        let canvas,url;
        try{
            guard();await load('html2canvas',api,d);guard();d.body.appendChild(wrapper);
            if(api.requestAnimationFrame)await new Promise(resolve=>api.requestAnimationFrame(resolve));guard();
            canvas=await (capture||api.html2canvas)(wrapper,{scale:2,backgroundColor:'#ffffff',logging:false});guard();
            const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('The payslip image could not be encoded.')),'image/png'));guard();
            url=api.URL.createObjectURL(blob);const link=d.createElement('a');link.download='Payslip_'+name+'_'+end+'.png';link.href=url;d.body.appendChild(link);link.click();link.remove();
            const completedURL=url;api.setTimeout(()=>api.URL.revokeObjectURL(completedURL),30000);url=null;
            if(api.currentPayslipData===data&&formStamp(original)===capturedForm){const modal=d.getElementById('payslipModal');if(modal)modal.style.display='none';}
            return {filename:link.download,size:blob.size};
        }finally{
            wrapper.remove();if(canvas){canvas.width=0;canvas.height=0;}if(url)api.URL.revokeObjectURL(url);
            if(api.currentPayslipData===data&&button){const held=heldUnpaid(api,data);button.innerText=held?'Review before download':'⬇️ Download Image';button.disabled=held;}
        }
    };
    const pending=state.tail.catch(()=>{}).then(work).finally(()=>{state.count--;if(state.active.get(data)===pending)state.active.delete(data);});
    state.tail=pending;state.active.set(data,pending);return pending;
}
