import {OWNER_EMAIL} from './workspace-access-model.js';
import {sanctionAuthority} from './sanction-actions.js';
import {phDay} from './sanction-schedule.js';
import {caseHistory,normalizeDisciplinePolicy} from './discipline-case-model.js';
import {readDisciplineContext,issueDisciplineCase,saveDisciplinePolicy,reviewDisciplineCase,cancelDisciplineCase} from './discipline-actions.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayText=value=>{const date=value?.toDate?.()||new Date(value?.seconds!=null?value.seconds*1000:value);return Number.isFinite(+date)?date.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'}):'Date not recorded';};
const activeStaff=row=>row.active!==false&&!row.archived&&!row.blocked&&!['Resigned','Revoked','Terminated','Inactive','Disabled','Archived','Deleted'].includes(row.status)&&row.pin!=='REVOKED';
const safeImage=value=>typeof value==='string'&&(/^https:\/\//.test(value)||/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value));
const caseName=row=>row.caseVersion===2?'Case #'+row.caseNumber:'Earlier notice · number not recorded';
const findingLabel=row=>{if(row.caseVersion!==2)return 'Finding not recorded';try{const saved=caseHistory([row],{id:row.staffId,cashierName:row.staffName,branch:row.branch}).rows[0];return saved?.findingLabel==='Confirmed'?'Violation confirmed':saved?.findingLabel==='Not established'?'Violation not established':saved?.withdrawn?'Case withdrawn':'Awaiting management finding';}catch{return 'Finding needs review';}};
const levelOptions=(policy,selected='')=>'<option value="">Choose a level for review</option>'+policy.levels.map(level=>'<option value="'+esc(level.id)+'" '+(level.id===selected?'selected':'')+'>'+esc(level.label)+(level.suspensionDays?' · '+level.suspensionDays+' suspension day(s)':'')+'</option>').join('');
export function disciplineHistoryHTML(rows,staff){
    const history=caseHistory(rows,staff);
    return '<div class="discipline-history-summary"><strong>'+history.totalCases+' earlier case(s) across incident types</strong><span>'+history.confirmedCount+' confirmed finding(s) · '+history.legacyRows.length+' earlier finding(s) not recorded</span></div>'+(history.rows.length?'<div class="discipline-history-list">'+history.rows.map(row=>'<article><strong>'+esc(caseName(row))+' · '+esc(row.type)+'</strong><span>'+esc(findingLabel(row))+' · '+esc(row.status||'Status not recorded')+'</span><small>'+esc(dayText(row.issuedAt||row.timestamp))+'</small></article>').join('')+'</div>':'<p>No earlier cases found for this staff account.</p>');
}

export function installDisciplineCases(api=window,d=document){
    if(api.disciplineCases)return api.disciplineCases;
    let issueEpoch=0,reviewEpoch=0,dashboardEpoch=0,issueContext=null,staffRows=[],attemptId='',issueAttachment=null,policyDraft=null,policyChangeId='',policyDialog=null,reviewDialog=null;
    let issueSaving=false,policySaving=false,reviewSaving=false,policyActor='',policyLoad=0;
    const dashboardRows=new Map();
    const byId=id=>d.getElementById(id),actorKey=()=>JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.auth?.currentUser?.emailVerified,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.permissions,api.sessionUser?.allowedBranches,api.sessionUser?.role,api.sessionUser?.isOwner,api.sessionUser?.isFranchisee]);
    const owner=()=>api.auth?.currentUser?.emailVerified===true&&String(api.auth?.currentUser?.email||'').toLowerCase()===OWNER_EMAIL&&api.auth?.currentUser?.uid===api.sessionUser?.uid;
    const fail=error=>api.Swal.fire({icon:'error',title:'Could not complete this action',text:error.message||String(error)});
    const read=ref=>(api.getDocFromServer||api.getDoc)(ref);
    const controls=(root,busy)=>root?.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=busy;});
    function dialog(id,title){
        const el=d.createElement('dialog');el.id=id;el.className='discipline-dialog';
        el.innerHTML='<header><div><small>HUMAN RESOURCES · DISCIPLINARY CASES</small><h2>'+esc(title)+'</h2></div><button type="button" data-dialog-close aria-label="Close '+esc(title)+'">×</button></header><div class="discipline-dialog-body"></div><footer></footer>';
        const saving=()=>id==='disciplineSeveritySettings'?policySaving:reviewSaving;
        el.querySelector('[data-dialog-close]').onclick=()=>{if(!saving())el.close();};el.addEventListener('cancel',event=>{if(saving())event.preventDefault();});el.addEventListener('close',()=>{if(id==='disciplineSeveritySettings')policyLoad++;else{reviewEpoch++;currentReview=null;}});d.body.append(el);return el;
    }
    function addTools(){
        const settings=byId('disciplineSettingsButton');if(settings)settings.hidden=!owner();
        let summary=byId('disciplineCaseSummary');if(!summary){summary=d.createElement('div');summary.id='disciplineCaseSummary';summary.className='discipline-case-summary';summary.setAttribute('role','status');byId('sanctionStaffSelect')?.parentElement.append(summary);}
        let explanation=byId('disciplineProposedHelp');if(!explanation){explanation=d.createElement('p');explanation.id='disciplineProposedHelp';explanation.className='notice-form-help';explanation.textContent='A proposed level is optional. The case number never selects a punishment. Management records the finding and final action after reviewing the explanation.';byId('sanctionSeverity')?.parentElement.append(explanation);}
    }
    function selectedStaff(){return staffRows.find(row=>row.id===byId('sanctionStaffSelect')?.value);}
    function updateSummary(){
        const box=byId('disciplineCaseSummary'),staff=selectedStaff();if(!box)return;
        if(!staff||!issueContext){box.textContent='Select a staff member to confirm their case history.';return;}
        const history=caseHistory(issueContext.rows||issueContext.history?.rows||[],staff),next=issueContext.nextCaseNumber||issueContext.history?.nextCaseNumber||history.nextCaseNumber;
        box.innerHTML='<strong>Next case: #'+esc(next)+' · all incident types</strong><span>'+history.totalCases+' earlier case(s) · '+history.confirmedCount+' confirmed finding(s)</span><small>'+history.relatedConfirmedCount(byId('sanctionType').value)+' confirmed finding(s) with this incident type. Management must assess whether earlier cases are relevant.</small><details><summary>View disciplinary history</summary>'+disciplineHistoryHTML(history.rows,staff)+'</details><small>The final case number is reserved when the notice saves. Cancelled cases remain in history.</small>';
    }
    async function loadContext(){
        if(issueSaving)return;
        const ticket=++issueEpoch,staff=selectedStaff(),key=actorKey();issueContext=null;byId('btnSaveSanction').disabled=true;
        if(!staff){updateSummary();return;}
        byId('disciplineCaseSummary').textContent='Confirming this staff account’s case history…';
        try{
            const context=await readDisciplineContext(api,staff);
            if(ticket!==issueEpoch||key!==actorKey()||selectedStaff()?.id!==staff.id)return;
            issueContext=context;byId('sanctionSeverity').innerHTML=levelOptions(context.policy);updateSummary();byId('btnSaveSanction').disabled=false;
        }catch(error){if(ticket===issueEpoch&&key===actorKey()){byId('disciplineCaseSummary').textContent=error.message;issueContext=null;}}
    }
    async function openIssue(){
        if(issueSaving)return api.ManagerUI?.notify?.('Wait for this notice to finish saving.');
        const key=actorKey(),ticket=++issueEpoch;
        try{
            sanctionAuthority(api);attemptId='case-'+crypto.randomUUID();issueAttachment=null;issueContext=null;staffRows=[];addTools();
            byId('sanctionEffectiveDate').value=phDay();byId('sanctionEffectiveDate').min=phDay();byId('sanctionDetails').value='';byId('sanctionDetails').style.height='';byId('sanctionEvidencePhoto').value='';byId('sanctionSeverity').innerHTML='<option value="">Select a staff member first</option>';byId('sanctionStaffSelect').innerHTML='<option value="">Loading staff…</option>';byId('btnSaveSanction').disabled=true;byId('btnSaveSanction').textContent='Issue notice';byId('issueSanctionModal').style.display='flex';
            byId('autoSanctionHelper')?.remove();updateSummary();
            byId('sanctionStaffSelect').onchange=loadContext;
            byId('sanctionType').onchange=async function(){if(this.value==='ADD_NEW')await api.handleCustomDropdown(this);updateSummary();};
            byId('sanctionSeverity').onchange=null;
            const snap=await (api.getDocsFromServer||api.getDocs)(api.collection(api.db,'cashiers'));sanctionAuthority(api);
            if(ticket!==issueEpoch||key!==actorKey())return;
            const branch=byId('sanctionBranchFilter')?.value||'All';
            staffRows=snap.docs.map(row=>({...row.data(),id:row.id})).filter(row=>activeStaff(row)&&api.isBranchAllowed(row.branch)&&(branch==='All'||row.branch===branch)).sort((a,b)=>String(a.cashierName).localeCompare(String(b.cashierName)));
            byId('sanctionStaffSelect').innerHTML='<option value="">Choose staff member</option>'+staffRows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.cashierName)+' ('+esc(row.branch)+')</option>').join('');
        }catch(error){if(key===actorKey()&&ticket===issueEpoch)await fail(error);}
    }
    async function submitIssue(){
        if(issueSaving)return;
        const staff=selectedStaff(),key=actorKey(),context=issueContext,button=byId('btnSaveSanction');
        if(!staff||!context)return fail(Error('Select the staff member and wait for their case history.'));
        const details=byId('sanctionDetails').value.trim(),type=byId('sanctionType').value,proposedLevelId=byId('sanctionSeverity').value||null;
        if(details.length<8||!type||type==='ADD_NEW')return fail(Error('Complete the incident type and at least 8 characters of incident details before issuing.'));
        const operation={id:attemptId,ticket:issueEpoch,effectiveDate:byId('sanctionEffectiveDate').value,file:byId('sanctionEvidencePhoto').files?.[0]};
        const current=()=>key===actorKey()&&operation.ticket===issueEpoch&&operation.id===attemptId;
        issueSaving=true;controls(byId('issueSanctionModal'),true);button.textContent='Saving notice…';
        try{
            sanctionAuthority(api,staff.branch);let evidencePhoto='';const file=operation.file;
            if(file){if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP evidence photo up to 5 MB.');if(issueAttachment?.file===file)evidencePhoto=issueAttachment.url;else{const reference=api.ref(api.storage,'hr_evidence/'+operation.id);await api.uploadBytes(reference,file);evidencePhoto=await api.getDownloadURL(reference);if(current())issueAttachment={file,url:evidencePhoto};}}
            if(!current()||staff.id!==selectedStaff()?.id)throw Error('The signed-in account or selected staff member changed. Reopen the notice.');
            const result=await issueDisciplineCase(api,{staffId:staff.id,staffName:staff.cashierName,branch:staff.branch,type,details,effectiveDate:operation.effectiveDate,evidencePhoto,proposedLevelId,expectedPolicyRevision:context.policy.revision},{id:operation.id});
            if(!current())return;
            byId('issueSanctionModal').style.display='none';issueEpoch++;await api.loadSanctionsDashboard();if(key===actorKey())await api.Swal.fire({icon:'success',title:'Case #'+result.caseNumber+' saved',text:'The staff member can submit an explanation. Review the finding and action after their reply.'});
        }catch(error){if(current())await fail(error);}finally{issueSaving=false;if(operation.id===attemptId){controls(byId('issueSanctionModal'),false);button.disabled=!issueContext||key!==actorKey();button.textContent='Issue notice';}}
    }
    function draftNotice(){
        const staff=selectedStaff(),details=byId('sanctionDetails').value.trim();if(!staff||!details)return fail(Error('Select the staff member and enter the incident facts first.'));
        byId('sanctionDetails').value='NOTICE TO EXPLAIN\n\nDear '+staff.cashierName+',\n\nPlease provide your explanation regarding the following reported incident:\n\n'+details+'\n\nInclude relevant dates, circumstances and supporting information. This notice records an allegation for review. A finding and any disciplinary action will be recorded separately after your explanation is considered.\n\nManagement, TAKODEÁL '+staff.branch;
    }
    function capturePolicy(){
        if(!policyDialog||!policyDraft)return;
        policyDialog.querySelectorAll('[data-level-row]').forEach(row=>{const level=policyDraft.levels[Number(row.dataset.levelRow)];if(level){level.label=row.querySelector('[data-level-label]').value;const days=row.querySelector('[data-level-days]').value;level.suspensionDays=days.trim()===''?NaN:Number(days);}});
    }
    function renderPolicy(){
        policyDialog.querySelector('.discipline-dialog-body').innerHTML='<p>Edit the choices available for future cases and management reviews. Existing notices and decisions keep their saved wording and suspension dates.</p><div class="discipline-levels">'+policyDraft.levels.map((level,index)=>'<section data-level-row="'+index+'"><div><label>Level name<input data-level-label maxlength="120" value="'+esc(level.label)+'"></label><label>Suspension days<input data-level-days type="number" min="0" max="366" step="1" value="'+esc(level.suspensionDays)+'"><small>Use 0 for an action without suspension.</small></label></div><nav aria-label="Arrange '+esc(level.label)+'"><button type="button" data-level-up="'+index+'" '+(index===0?'disabled':'')+'>Move up</button><button type="button" data-level-down="'+index+'" '+(index===policyDraft.levels.length-1?'disabled':'')+'>Move down</button><button type="button" data-level-remove="'+index+'">Remove level</button></nav></section>').join('')+'</div><button type="button" data-level-add>Add severity level</button><p class="discipline-form-note">The order of this list does not automatically assign an action to a case number. Staff explanations and findings are reviewed individually.</p><p data-policy-error role="alert"></p>';
        policyDialog.querySelector('footer').innerHTML='<button type="button" data-policy-cancel>Cancel</button><button type="button" class="discipline-primary" data-policy-save>Save severity settings</button>';
    }
    async function openPolicy(){
        if(policySaving)return;
        const key=actorKey(),ticket=++policyLoad;
        try{
            sanctionAuthority(api);if(!owner())throw Error('Only the Owner can edit severity settings.');
            const snap=await read(api.doc(api.db,'settings','discipline_policy'));if(key!==actorKey()||ticket!==policyLoad||!owner())return;policyDraft=normalizeDisciplinePolicy(snap.exists()?snap.data():null);policyChangeId='policy-'+crypto.randomUUID();policyActor=key;
            policyDialog ||= dialog('disciplineSeveritySettings','Severity settings');renderPolicy();if(!policyDialog.open)policyDialog.showModal();
        }catch(error){if(key===actorKey()&&ticket===policyLoad)await fail(error);}
    }
    async function savePolicy(){
        if(policySaving)return;capturePolicy();const changeId=policyChangeId,key=policyActor,current=()=>changeId===policyChangeId&&key===actorKey();policySaving=true;controls(policyDialog,true);
        try{if(!current())throw Error('The Owner account changed. Reopen settings.');const value=normalizeDisciplinePolicy(policyDraft);await saveDisciplinePolicy(api,{levels:value.levels,expectedRevision:policyDraft.revision},{changeId});if(!current())return;policyDialog.close();if(byId('issueSanctionModal')?.style.display==='flex'&&selectedStaff())await loadContext();if(current())api.ManagerUI?.notify?.('Severity choices saved for future reviews.');}
        catch(error){if(current())policyDialog.querySelector('[data-policy-error]').textContent=error.message;}finally{policySaving=false;if(changeId===policyChangeId)controls(policyDialog,false);}
    }
    let currentReview=null;
    async function openReview(id){
        if(reviewSaving)return;
        const ticket=++reviewEpoch,key=actorKey();
        try{
            sanctionAuthority(api);reviewDialog ||= dialog('disciplineCaseReview','Review disciplinary case');reviewDialog.querySelector('.discipline-dialog-body').textContent='Confirming this case and its review history…';reviewDialog.querySelector('footer').innerHTML='';if(!reviewDialog.open)reviewDialog.showModal();
            const snap=await read(api.doc(api.db,'hr_sanctions',id));if(!snap.exists())throw Error('This case no longer exists.');const row={...snap.data(),id:snap.id||id};sanctionAuthority(api,row.branch);
            const profile=await read(api.doc(api.db,'cashiers',row.staffId||'__missing__'));const staff=profile.exists()?{...profile.data(),id:row.staffId}:{id:row.staffId,cashierName:row.staffName,branch:row.branch};
            const context=row.staffId?await readDisciplineContext(api,staff):null;if(ticket!==reviewEpoch||key!==actorKey()||!reviewDialog.open)return;
            currentReview={row,context,staff,changeId:'review-'+crypto.randomUUID(),key};const editable=row.caseVersion===2&&row.status==='Replied'&&row.finding==='Pending';
            reviewDialog.querySelector('.discipline-dialog-body').innerHTML='<section class="discipline-case-facts"><strong>'+esc(caseName(row))+' · '+esc(row.staffName)+'</strong><span>'+esc(row.branch)+' · '+esc(row.type)+'</span><small>Issued '+esc(dayText(row.issuedAt||row.timestamp))+' · '+esc(findingLabel(row))+'</small><h3>Reported incident</h3><p class="discipline-preserve">'+esc(row.details)+'</p><h3>Staff explanation</h3><p class="discipline-preserve">'+esc(row.staffReply||'No staff explanation has been submitted yet.')+'</p>'+(safeImage(row.signatureBase64)?'<img class="discipline-signature" alt="Staff acknowledgement signature" src="'+esc(row.signatureBase64)+'">':'')+(safeImage(row.evidencePhoto)?'<button type="button" data-case-evidence>View evidence photo</button>':'')+'</section>'+(context?'<details><summary>Earlier case history</summary>'+disciplineHistoryHTML((context.rows||context.history?.rows||[]).filter(record=>record.id!==id),staff)+'</details>':'')+(editable?'<section class="discipline-review-fields"><label>Finding<select id="disciplineFinding"><option value="">Choose a finding after review</option><option value="Confirmed">Violation confirmed</option><option value="Not established">Violation not established</option></select></label><label>Reviewed severity level<select id="disciplineReviewedLevel">'+levelOptions(context.policy)+'</select></label><label>Action effective date<input id="disciplineReviewDate" type="date" min="'+phDay()+'" value="'+phDay()+'"></label><label>Decision and reasons<textarea id="disciplineReviewReason" maxlength="1500" rows="4" placeholder="Explain the evidence, staff explanation, relevant policy and reasons for the action."></textarea></label><p>Cash deductions need a separate payroll review. Case numbers never authorize termination.</p></section>':'<section><h3>Recorded decision</h3><p>'+esc(findingLabel(row))+'</p><p>'+esc(row.reviewedAction?.label||'No reviewed action recorded')+'</p>'+(row.reviewedAction?'<p>Effective '+esc(row.reviewedAction.effectiveDate)+' · '+esc(row.reviewedAction.suspensionDays)+' suspension day(s)</p>':'')+'<p class="discipline-preserve">'+esc(row.reviewReason||'Earlier notices are retained as history. A closed notice alone does not establish a confirmed violation.')+'</p><small>'+esc(row.reviewedByEmail||'')+'</small></section>')+'<p data-review-error role="alert"></p>';
            reviewDialog.querySelector('footer').innerHTML='<button type="button" data-review-close>Close</button>'+(editable?'<button type="button" class="discipline-primary" data-review-save>Save reviewed decision</button>':'');
            const finding=byId('disciplineFinding');if(finding)finding.onchange=()=>{const level=byId('disciplineReviewedLevel');level.disabled=finding.value!=='Confirmed';if(level.disabled)level.value='';};if(byId('disciplineReviewedLevel'))byId('disciplineReviewedLevel').disabled=true;
        }catch(error){if(ticket!==reviewEpoch||key!==actorKey())return;if(reviewDialog?.open)reviewDialog.querySelector('.discipline-dialog-body').textContent=error.message;else await fail(error);}
    }
    async function saveReview(){
        if(reviewSaving)return;const review=currentReview;if(!review)return;
        const outcome=byId('disciplineFinding').value,levelId=outcome==='Confirmed'?(byId('disciplineReviewedLevel').value||null):null,effectiveDate=byId('disciplineReviewDate').value,reason=byId('disciplineReviewReason').value;
        const current=()=>currentReview===review&&review.key===actorKey();reviewSaving=true;controls(reviewDialog,true);
        try{
            if(!current())throw Error('The signed-in account changed. Reopen this case.');
            if(reason.trim().length<8)throw Error('Explain the decision in at least 8 characters.');
            await reviewDisciplineCase(api,review.row.id,{outcome,levelId,effectiveDate,reason,expectedRevision:review.row.decisionRevision||0,expectedPolicyRevision:review.context.policy.revision,relatedCaseIds:[]},{changeId:review.changeId});
            if(!current())return;
            reviewDialog.close();await loadDashboard();if(review.key===actorKey())api.ManagerUI?.notify?.('Reviewed decision saved.');
        }catch(error){if(current())reviewDialog.querySelector('[data-review-error]').textContent=error.message;}finally{reviewSaving=false;if(currentReview===review||currentReview===null){controls(reviewDialog,false);if(byId('disciplineReviewedLevel'))byId('disciplineReviewedLevel').disabled=byId('disciplineFinding').value!=='Confirmed';}}
    }
    async function cancelCase(id){
        const key=actorKey();
        try{
            const snap=await read(api.doc(api.db,'hr_sanctions',id));if(key!==actorKey())return;if(!snap.exists())throw Error('This case no longer exists.');const row=snap.data();if(row.caseVersion!==2)return api.legacyDeleteSanction(id);
            if(['Cancelled','Archived'].includes(row.status)){if(key===actorKey()){await loadDashboard();api.ManagerUI?.notify?.('This case is already cancelled or archived.');}return;}
            if(!(await api.ManagerUI.confirm(row.status==='Reviewed'?'Archive this reviewed case? Its saved decision remains in history.':'Cancel this notice? Its case number remains in history.')))return;
            if(key!==actorKey())return;
            await cancelDisciplineCase(api,id,{expectedRevision:row.decisionRevision||0,reason:'Management cancelled or archived this case.'},{changeId:'cancel-'+crypto.randomUUID()});if(key===actorKey())await loadDashboard();
        }catch(error){if(key===actorKey())await fail(error);}
    }
    async function loadDashboard(){
        addTools();const body=byId('sanctionsTableBody');if(!body)return;const ticket=++dashboardEpoch,key=actorKey();body.innerHTML='<tr><td colspan="6">Loading disciplinary cases…</td></tr>';
        try{
            sanctionAuthority(api);const branch=byId('sanctionBranchFilter')?.value||'All',filters=branch==='All'?[]:[api.where('branch','==',branch)];const snap=await (api.getDocsFromServer||api.getDocs)(api.query(api.collection(api.db,'hr_sanctions'),...filters,api.orderBy('timestamp','desc')));
            if(ticket!==dashboardEpoch||key!==actorKey())return;
            const rows=snap.docs.map(row=>({...row.data(),id:row.id})).filter(row=>api.isBranchAllowed(row.branch));dashboardRows.clear();for(const row of rows)dashboardRows.set(row.id,row);
            body.innerHTML=rows.map(row=>'<tr><td>'+esc(dayText(row.issuedAt||row.timestamp))+'<br><strong>'+esc(caseName(row))+'</strong></td><td><strong>'+esc(row.staffName)+'</strong><br>'+esc(row.branch)+'</td><td><strong>'+esc(row.type)+'</strong><p class="discipline-preserve">'+esc(row.details)+'</p></td><td><strong>'+esc(row.caseVersion===2?(row.reviewedAction?.label||'Awaiting reviewed action'):row.severity||'Not recorded')+'</strong>'+(row.proposedSeverity?'<br><small>Proposed: '+esc(row.proposedSeverity.label)+'</small>':'')+'</td><td><strong>'+esc(row.status)+'</strong><br>'+esc(findingLabel(row))+(row.staffReply?'<p class="discipline-preserve">'+esc(row.staffReply)+'</p>':'')+'</td><td><div class="discipline-row-actions"><button type="button" data-discipline-review="'+esc(row.id)+'">'+(row.caseVersion===2&&row.status==='Replied'&&row.finding==='Pending'?'Review finding & action':'View case & history')+'</button>'+(!['Cancelled','Canceled','Archived','Deleted'].includes(row.status)?'<button type="button" data-discipline-cancel="'+esc(row.id)+'">'+(row.status==='Reviewed'||row.status==='Resolved'?'Archive':'Cancel notice')+'</button>':'')+(row.caseVersion!==2&&row.status==='Replied'?'<button type="button" data-legacy-resolve="'+esc(row.id)+'">Resolve earlier notice</button>':'')+(row.caseVersion!==2?'<button type="button" data-sanction-date="'+esc(row.id)+'">Effective date / audit</button>':'')+(row.caseVersion!==2&&row.staffReply?'<button type="button" data-legacy-print="'+esc(row.id)+'">Print earlier notice</button>':'')+'</div></td></tr>').join('')||'<tr><td colspan="6">No disciplinary cases found.</td></tr>';
        }catch(error){if(ticket===dashboardEpoch&&key===actorKey())body.innerHTML='<tr><td colspan="6">'+esc(error.message)+'</td></tr>';}
    }
    d.addEventListener('click',event=>{if(event.target.closest('[data-notice-close]')){if(issueSaving){event.preventDefault();event.stopImmediatePropagation();}else issueEpoch++;}},true);
    d.addEventListener('keydown',event=>{if(event.key==='Escape'&&byId('issueSanctionModal')?.style.display==='flex'){if(issueSaving){event.preventDefault();event.stopImmediatePropagation();}else issueEpoch++;}},true);
    d.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button)return;
        if(button.matches('[data-discipline-review]'))void openReview(button.dataset.disciplineReview);
        if(button.matches('[data-discipline-cancel]'))void cancelCase(button.dataset.disciplineCancel);
        if(button.matches('[data-legacy-resolve]')){const row=dashboardRows.get(button.dataset.legacyResolve);if(row)void api.resolveSanction(row.id,row.staffName);}
        if(button.matches('[data-legacy-print]')){const row=dashboardRows.get(button.dataset.legacyPrint);if(row)api.printFormalNTE(encodeURIComponent(JSON.stringify(row)));}
        if(button.matches('[data-policy-cancel]'))policyDialog.close();
        if(button.matches('[data-policy-save]'))void savePolicy();
        if(button.matches('[data-review-close]'))reviewDialog.close();
        if(button.matches('[data-review-save]'))void saveReview();
        if(button.matches('[data-case-evidence]')&&safeImage(currentReview?.row.evidencePhoto))api.viewSelfie(currentReview.row.evidencePhoto,'Case evidence');
        if(button.matches('[data-level-add],[data-level-remove],[data-level-up],[data-level-down]')){
            capturePolicy();if(button.hasAttribute('data-level-add')){if(policyDraft.levels.length>=20)return;policyDraft.levels.push({id:'level-'+crypto.randomUUID(),label:'New severity level',suspensionDays:0});}
            for(const [key,offset]of [['levelUp',-1],['levelDown',1]])if(button.dataset[key]!=null){const at=Number(button.dataset[key]),to=at+offset;if(to>=0&&to<policyDraft.levels.length)[policyDraft.levels[at],policyDraft.levels[to]]=[policyDraft.levels[to],policyDraft.levels[at]];}
            if(button.dataset.levelRemove!=null&&policyDraft.levels.length>1)policyDraft.levels.splice(Number(button.dataset.levelRemove),1);renderPolicy();
        }
    });
    api.legacyDeleteSanction=api.deleteSanction;api.openIssueSanctionModal=openIssue;api.submitNewSanction=submitIssue;api.autoCalculateSeverity=loadContext;api.generateAiNteLetter=draftNotice;api.loadSanctionsDashboard=loadDashboard;api.openDisciplineSettings=openPolicy;api.openDisciplineReview=openReview;
    const result={openIssue,loadContext,openPolicy,loadDashboard,openReview,submitIssue};api.disciplineCases=result;return result;
}
