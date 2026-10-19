import {readPayrollSnapshot} from './payroll-preview-guard.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
import {ensureManagerLibrary} from './manager-libraries.js';

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
    return Math.max(0,amount(data.basicPay)+amount(data.nightBonus??data.nightBonusTotal)+amount(data.straightBonus)+amount(data.holidayPayTotal)+amount(data.perfBonus)-['onlineRefunds','meals','advances','loans','sss','pagibig','philhealth','lateDeduction'].reduce((sum,key)=>sum+amount(data[key]),0));
}
export function applyConfirmedPayroll(api,d,data,saved,{actorKey}={}){
    const frozen=saved.frozenData||data;Object.assign(data,frozen,{isPaid:true,finalNetPay:saved.finalNetPay??frozen.finalNetPay});
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
        if(row.cells?.[3]){const deduct=['onlineRefunds','meals','advances','loans','sss','pagibig','philhealth','lateDeduction'].reduce((sum,key)=>sum+amount(data[key]),0);row.cells[3].textContent='Total: ₱'+deduct.toFixed(2)+' · Paid and saved';}
    }
    const total=d.getElementById('payrollGrandTotalAmount');
    if(total)total.innerText='₱'+Object.values(api.globalPayrollCache).reduce((sum,item)=>sum+payrollEstimate(item),0).toLocaleString(undefined,{minimumFractionDigits:2});
    return true;
}

const imageQueues=new WeakMap();
export function syncPayslipImageButton(api,d){const button=d.getElementById('btnDownloadPayslip');if(button){const pending=imageQueues.get(api)?.active.has(api.currentPayslipData);button.disabled=!!pending;button.innerText=pending?'Preparing payslip image…':'⬇️ Download Image';}}
const formStamp=node=>[...node.querySelectorAll('input')].map(input=>[input.id,input.value]).map(value=>JSON.stringify(value)).join('|');
export function exportPayslipImage(api,d,{load=ensureManagerLibrary,capture}={}){
    let actor;try{actor=payrollActorKey(api);}catch(error){return Promise.reject(error);}
    const data=api.currentPayslipData,original=d.getElementById('printablePayslip');
    if(!data||!original)return Promise.reject(Error('Open a payslip before downloading its image.'));
    if(!allowed(api,data.branch))return Promise.reject(Error('This payslip is outside your assigned branches.'));
    const guard=()=>{if(payrollActorKey(api)!==actor)throw Error('The payroll account changed. Download was stopped.');};
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
            if(api.currentPayslipData===data&&button){button.innerText='⬇️ Download Image';button.disabled=false;}
        }
    };
    const pending=state.tail.catch(()=>{}).then(work).finally(()=>{state.count--;if(state.active.get(data)===pending)state.active.delete(data);});
    state.tail=pending;state.active.set(data,pending);return pending;
}
