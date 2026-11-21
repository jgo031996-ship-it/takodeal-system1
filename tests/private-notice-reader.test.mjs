import test from 'node:test';
import assert from 'node:assert/strict';
import {readStaffAnnouncements,readStaffNoticeAcknowledgments,announcementImage} from '../takodeal-staff/staff-announcements.js';
test('personal notices use a permanent employee ID and private illustrations can be displayed',async()=>{
    const seen=[],api={db:{},collection:()=>({}),query:(_, ...constraints)=>constraints,where:(...args)=>args,limit:n=>n,getDocsFromServer:async constraints=>{seen.push(constraints);return {docs:[]};}};
    await readStaffAnnouncements(api,{staffId:'fictional-a',staffName:'Sample A',branch:'East'});
    assert.ok(seen.some(group=>group.some(v=>v[0]==='targetStaffId' && v[2]==='fictional-a')));
    assert.equal(announcementImage('data:image/jpeg;base64,YQ=='),'data:image/jpeg;base64,YQ==');
    assert.equal(announcementImage('data:text/plain,abc'),'');
});
test('a change of staff account while private rows load cancels delivery',async()=>{
    let changed=false;const api={readOperationalRecords:async()=>{changed=true;return {docs:[]};}};
    await assert.rejects(readStaffAnnouncements(api,{staffId:'fictional-a',staffName:'Sample A',branch:'East',assertCurrent(){if(changed)throw Error('account changed');}}),/account changed/);
});

test('older phone signatures survive for the uniquely claimed employee and do not follow a shared name',async()=>{
    const person='fictional-b',row=(id,staffId)=>({id,data:()=>({staffId})});
    for(const ambiguous of [true,false]){
        const api={db:{},collection:()=>({}),query:(_,f)=>f,where:key=>key,doc:()=>({}),getDocFromServer:async()=>({exists:()=>true,data:()=>({ambiguous,uniqueStaffId:person})}),
            getDocsFromServer:async key=>({docs:key==='staffId'?[row('modern',person)]:[row('legacy'),row('other','fictional-c')]})};
        const items=[];const saved=await readStaffNoticeAcknowledgments(api,{staffId:person,staffName:'Example'});
        saved.forEach(item=>items.push(item.id));assert.deepEqual(items,ambiguous?['modern']:['modern','legacy']);
    }
});
