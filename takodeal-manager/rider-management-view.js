import {captureRiderManagerActor} from './rider-management.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const encode=value=>encodeURIComponent(JSON.stringify(value)).replace(/'/g,'%27');
const amount=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):'Unconfirmed';
const scope=rider=>Array.isArray(rider.allowedBranches)&&rider.allowedBranches.length?rider.allowedBranches:['All'];
const millis=value=>value?.toMillis?.() ?? (value?.seconds?Number(value.seconds)*1000:Date.parse(value || ''));
const date=value=>Number.isFinite(millis(value))?new Date(millis(value)).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'Date not recorded';
function imageURL(value){try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}return '';}
export function installRiderManagementViews(api=window,d=document){
    let fleetEpoch=0,topupEpoch=0;
    const busy=tbody=>{tbody.innerHTML='<tr><td colspan="5">Loading Rider records…</td></tr>';};
    const fail=(tbody,error)=>{tbody.innerHTML='<tr><td colspan="5"></td></tr>';tbody.querySelector('td').textContent=error.message||'Rider records could not load. Reconnect and refresh.';};
    const allowed=(actor,rows,rider)=>{try{api.assertRiderManagerAuthority(actor,rows,scope(rider));return true;}catch{return false;}};
    const reviewButton=(id,status,label)=>`<button type="button" onclick="window.updateRiderStatus(decodeURIComponent('${encodeURIComponent(id).replace(/'/g,'%27')}'),'${status}')">${label}</button>`;
    const photoButton=(url,title,label,kind,id)=>imageURL(url)?`<button type="button" onclick="window.viewRiderApplicationDocument('${encode({kind,id})}')">${label}</button>`:`<span>${label} not provided</span>`;
    api.viewRiderApplicationDocument=async encoded=>{try{
        const binding=JSON.parse(decodeURIComponent(encoded));
        if(!['license','orcr','topup'].includes(binding.kind)||typeof binding.id!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(binding.id))throw Error('Choose a saved Rider document.');
        const actor=captureRiderManagerActor(api);await api.loadRiderManagerAuthority(actor);
        let riderId=binding.id,request=null;
        if(binding.kind==='topup'){const saved=await api.getDocFromServer(api.doc(api.db,'rider_topups',binding.id));if(!saved.exists())throw Error('This top-up request is unavailable.');request=saved.data();riderId=request.riderId;if(typeof riderId!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(riderId))throw Error('This top-up has an invalid Rider reference.');}
        const savedRider=await api.getDocFromServer(api.doc(api.db,'riders',riderId));if(!savedRider.exists())throw Error('This Rider record is unavailable.');
        const rider=savedRider.data(),authority=await api.loadRiderManagerAuthority(actor);api.assertRiderManagerAuthority(actor,authority.rows,scope(rider));
        const url=imageURL(binding.kind==='topup'?request.proofUrl:binding.kind==='license'?rider.licenseUrl:rider.orcrUrl);if(!url)throw Error('This document image is unavailable.');
        const title=binding.kind==='topup'?'Top-up proof · '+String(request.reference||'not recorded'):(binding.kind==='license'?'Driver’s license · ':'OR/CR · ')+String(rider.name||'Rider');
        await api.Swal.fire({titleText:title,imageUrl:url,imageAlt:title,showCloseButton:true,confirmButtonText:'Close'});
    }catch(error){await api.Swal.fire({title:'Document unavailable',text:error.message,icon:'warning'});}};
    api.loadRiderManagement=async()=>{
        const tbody=d.getElementById('riderFleetBody');if(!tbody)return false;const epoch=++fleetEpoch;busy(tbody);
        try{
            const actor=captureRiderManagerActor(api),authority=await api.loadRiderManagerAuthority(actor),snapshot=await api.getDocsFromServer(api.collection(api.db,'riders'));api.assertRiderManagerAuthority(actor,authority.rows,[]);if(epoch!==fleetEpoch)return false;
            const riders=snapshot.docs.map(row=>({...row.data(),id:row.id})).filter(row=>allowed(actor,authority.rows,row)).sort((a,b)=>(millis(b.joinedAt)||0)-(millis(a.joinedAt)||0));
            tbody.innerHTML=riders.map(row=>{
                const status=String(row.status||'unreviewed'),active=['active','approved'].includes(status),pending=status==='pending_approval';
                const actions=pending?reviewButton(row.id,'active','Approve')+reviewButton(row.id,'rejected','Reject'):active?reviewButton(row.id,'banned','Suspend'):['banned','rejected'].includes(status)?reviewButton(row.id,'active','Restore access'):'Review legacy status with the Owner';
                const photo=imageURL(row.selfieUrl);
                return `<tr><td>${photo?`<img src="${esc(photo)}" alt="${esc(row.name||'Rider')}" width="48" height="48">`:''}<strong>${esc(row.name||'Unnamed rider')}</strong><div>${esc(row.phone||'Phone not recorded')}</div><div>Applied: ${esc(date(row.joinedAt))}</div><div>Wallet: ₱${esc(amount(row.walletBalance??0))}</div></td><td>${esc(row.vehicle||'Vehicle not recorded')}<div>Plate: ${esc(row.plateNumber||'Not recorded')}</div></td><td>${photoButton(row.licenseUrl,'Driver’s license · '+(row.name||'Rider'),'License','license',row.id)}${photoButton(row.orcrUrl,'OR/CR · '+(row.name||'Rider'),'OR/CR','orcr',row.id)}</td><td>${esc(({pending_approval:'Pending Manager approval',active:'Active',approved:'Active',rejected:'Not approved',banned:'Suspended'})[status]||status)}</td><td>${actions}</td></tr>`;
            }).join('')||'<tr><td colspan="5">No Rider records within your saved permissions.</td></tr>';return true;
        }catch(error){if(epoch===fleetEpoch)fail(tbody,error);return false;}
    };
    api.loadRiderTopUps=async()=>{
        const tbody=d.getElementById('riderTopUpBody');if(!tbody)return false;const epoch=++topupEpoch;busy(tbody);
        try{
            const actor=captureRiderManagerActor(api),authority=await api.loadRiderManagerAuthority(actor),snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'rider_topups'),api.where('status','==','pending')));api.assertRiderManagerAuthority(actor,authority.rows,[]);
            const rows=[];
            for(const row of snapshot.docs){const request={...row.data(),id:row.id};if(typeof request.riderId!=='string'||!request.riderId||request.riderId.includes('/'))continue;const rider=await api.getDocFromServer(api.doc(api.db,'riders',request.riderId));api.assertRiderManagerAuthority(actor,authority.rows,[]);if(rider.exists()&&allowed(actor,authority.rows,rider.data()))rows.push(request);}
            if(epoch!==topupEpoch)return false;rows.sort((a,b)=>(millis(b.timestamp)||0)-(millis(a.timestamp)||0));
            tbody.innerHTML=rows.map(row=>`<tr><td>${esc(date(row.timestamp))}</td><td>${esc(row.riderName||'Rider')}</td><td>${esc(row.reference||'Reference not recorded')}</td><td>${photoButton(row.proofUrl,'Top-up proof · '+(row.reference||'not recorded'),'View proof','topup',row.id)}</td><td><button type="button" onclick="window.approveTopUp(decodeURIComponent('${encodeURIComponent(row.id).replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(row.riderId).replace(/'/g,'%27')}'))">Credit wallet</button><button type="button" onclick="window.rejectTopUp(decodeURIComponent('${encodeURIComponent(row.id).replace(/'/g,'%27')}'))">Reject</button></td></tr>`).join('')||'<tr><td colspan="5">No pending top-ups within your saved permissions.</td></tr>';return true;
        }catch(error){if(epoch===topupEpoch)fail(tbody,error);return false;}
    };
}
