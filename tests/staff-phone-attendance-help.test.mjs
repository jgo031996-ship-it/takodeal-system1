import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createStaffAccessClient,staffAccessRecovery} from '../takodeal-staff/staff-access.js';

test('known denials distinguish the daily PIN, approved phone, expired sign-in and duplicate account',()=>{
    for(const [code,action]of [['access/pin','pin'],['access/approval','phone'],['access/sign-in','sign-in'],['access/review','review']]){
        const help=staffAccessRecovery(code);assert.equal(help.action,action);assert.ok(help.title);assert.ok(help.message);
    }
    assert.match(staffAccessRecovery('access/approval').message,/Staff & POS devices/);
    assert.match(staffAccessRecovery('access/pin').message,/no separate PIN approval/);
    assert.equal(staffAccessRecovery('injected-error'),null);
});
test('older PIN formats receive the personal activation path only for the exact legacy login rejection',()=>{
    for(const pin of ['7','Old-PIN','12345678901']){
        const help=staffAccessRecovery('access/request',{route:'/staff-login',pin});
        assert.equal(help.action,'phone');assert.match(help.message,/Keep your daily PIN/);assert.match(help.message,/Staff app setup code/);
    }
    assert.equal(staffAccessRecovery('access/request',{route:'/staff-login',pin:'1234'}),null);
    assert.equal(staffAccessRecovery('access/request',{route:'/change-staff-pin',pin:'OLD'}),null);
});
test('actual HTTP client preserves actionable denial, and unknown messages never become trusted instructions',async()=>{
    const user={uid:'synthetic-phone',isAnonymous:true,getIdToken:async()=>'SYNTHETIC_TOKEN'};
    for(const [code,status,action]of [['access/pin',403,'pin'],['access/approval',403,'phone'],['access/sign-in',401,'sign-in'],['access/review',409,'review'],['unknown',403,null],['access/approval',429,null]]){
        let calls=0;const client=createStaffAccessClient({auth:{currentUser:user},ensureUser:async()=>user,deviceId:()=> 'DEV-SYNTHETIC-PHONE',sessionId:()=> 'synthetic-session-123',fetcher:async(url,options)=>{
            calls++;assert.equal(JSON.parse(options.body).staffId,'synthetic-staff');
            return {ok:false,status,url,json:async()=>({code,message:'<script>SECRET_SERVER_MESSAGE</script>'})};
        }});
        await assert.rejects(client.verifyPin({pin:'1234',staffId:'synthetic-staff',purpose:'time-clock',scope:'synthetic-punch'}),error=>{
            assert.equal(error.staffAccessRecovery?.action||null,action);assert.ok(error.code.startsWith('staff-access/'));assert.doesNotMatch(error.message,/SECRET_SERVER_MESSAGE|<script>/);return true;
        });assert.equal(calls,1);
    }
});
test('attendance help keeps the selected reason and screenshot and opens no setup unless the user selects help',async()=>{
    const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),start=source.indexOf('        if(e.staffAccessRecovery){'),end=source.indexOf('\n    } \n    finally',start);
    assert.ok(start>0&&end>start);
    for(const dismiss of ['cancel','esc',undefined]){
        const draft={reason:'Kept reason',file:{name:'kept.jpg'}};let opened=0,presented;
        const window={staffLateProofDraft:draft,staffSelfRepair:{open:()=>opened++}},Swal={DismissReason:{cancel:'cancel'},fire:async input=>{presented=input;return {dismiss};}};
        await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',{e:{staffAccessRecovery:staffAccessRecovery('access/approval')},window,Swal});
        assert.equal(window.staffLateProofDraft,draft);assert.match(presented.footer,/kept/);assert.equal(opened,dismiss==='cancel'?1:0);
    }
});
