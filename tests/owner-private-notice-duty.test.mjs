import test from 'node:test';
import assert from 'node:assert/strict';
import {dutyRequestStatus,onDuty} from '../takodeal-manager/dashboard-data.js';
import {prepareGuidedDraft,validateDraft,noticeImagePrompt,publishReviewedDraft} from '../takodeal-manager/ai-hub-model.js';
import {createNoticeHandler} from '../takodeal-manager/api/staff-notice.mjs';
const punch={id:'fictional-in',staffId:'fictional-a',staffName:'Sample A',branch:'Example East',type:'TIME IN',timestamp:'2026-11-20T17:30:00+08:00'};
const request={type:'Early Time Out',staffId:punch.staffId,timeInLogId:punch.id,timeInAt:punch.timestamp,branch:punch.branch,status:'Pending'};
test('overnight request labels the matching shift; a linked departure removes it from duty',()=>{
    const now=Date.parse('2026-11-21T11:00:00+08:00');
    assert.equal(onDuty([punch],[punch.branch],now)[0].needsReview,true);
    assert.match(dutyRequestStatus(punch,[request]),/awaiting review/);
    assert.match(dutyRequestStatus(punch,[{...request,status:'Approved'}]),/awaiting punch/);
    const out={...punch,id:'fictional-out',timeInLogId:punch.id,type:'TIME OUT',timestamp:'2026-11-21T02:29:00+08:00'};
    assert.deepEqual(onDuty([punch,out],[punch.branch],now),[]);
});
test('other shifts, another employee with the same name, other branches and cancelled requests cannot clear warnings',()=>{
    for(const changes of [{staffId:'fictional-b'},{branch:'Example West'},{timeInLogId:'other'},{timeInAt:'2026-11-19'},{status:'Rejected'},{status:'Cancelled'}]) assert.equal(dutyRequestStatus(punch,[{...request,...changes}]),'');
    assert.match(dutyRequestStatus(punch,[request,request]),/Conflicting/);
});
const brief={type:'increase',title:'Rate update',facts:'Daily rate from 400 to 450 plus 50 per night shift.',date:'2026-11-22'};
test('each personal format is locked to an employee; image prompts omit the private brief',()=>{
    for (const type of ['increase','deduction','personal']){
        const draft=prepareGuidedDraft({...brief,type});
        assert.equal(draft.targetType,'Individual');
        assert.ok(validateDraft({...draft,targetType:'All'}).length);
        assert.ok(validateDraft({...draft,targetStaff:'Sample A'}).length);
        assert.deepEqual(validateDraft({...draft,targetStaff:'Sample A',targetStaffId:'fictional-a'}),[]);
        assert.doesNotMatch(noticeImagePrompt(type),/400|450|Sample A/);
    }
});
test('interrupted private publication retries once and cannot redirect a saved notice to a second employee', async()=>{
    const draft={...prepareGuidedDraft(brief,{id:'hub-fictional-private'}),targetStaff:'Sample A',targetStaffId:'fictional-a'};
    let saved, writes=0;
    const opts={reviewed:true,online:true,uid:'fictional-owner',user:{isOwner:true},adapter:{read:async()=>saved,commit:async(id,payload)=>{saved=payload;writes++;throw Error('ack lost');}}};
    await assert.rejects(publishReviewedDraft(draft,[],opts),/ack lost/);
    assert.equal((await publishReviewedDraft(draft,[],opts)).existing,true);
    assert.equal(saved.targetStaffId,'fictional-a');assert.equal(saved.targetStaff,null);assert.equal(writes,1);
    await assert.rejects(publishReviewedDraft({...draft,targetStaffId:'fictional-b'},[],opts),/already been published/);
});
async function rewrite(output,{key='fictional',method='POST'}={}){
    let request;
    const handler=createNoticeHandler({verify:async()=>({uid:'fictional-owner'}),env:{OPENAI_API_KEY:key},fetcher:async(_,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]})};}});
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
    await handler({method,headers:{'content-type':'application/json'},body:brief},res);return {res,request};
}
test('AI returns edited language and preserves the three pay figures, with no payroll or publication action',async()=>{
    const {res,request}=await rewrite('Your daily rate increases from ₱400 to ₱450, with an additional ₱50 for each night shift.');
    assert.equal(res.code,200);assert.equal(request.store,false);assert.notEqual(res.body.message,brief.facts);
    assert.equal((await rewrite('Your salary is now ₱550.')).res.code,422);
    assert.equal((await rewrite('',{key:''})).res.code,503);
    assert.equal((await rewrite('',{method:'GET'})).res.code,405);
});
