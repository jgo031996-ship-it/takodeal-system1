import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readBranchNetworkSettings,saveBranchNetworkSettings} from '../takodeal-manager/branch-private-settings.js';

const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=main.indexOf('window.openBranchSettings = async function');
const source=main.slice(start,main.indexOf('// 💉 THE DOM INJECTOR',start));
function fixture({legacy=false,error,hold}={}) {
    const branch={name:'Agdao',lat:7.1,lng:125.6,...(legacy?{wifi:'old password'}:{})};
    const rows=new Map([['branches/b1',branch],['branches/b2',{name:'Maa'}]]),deleted=Symbol('delete');
    const fields=new Map(),notifications=[],successes=[];
    const document={getElementById(id){if(!fields.has(id))fields.set(id,{value:'',checked:false,disabled:false,textContent:'',style:{}});return fields.get(id);}};
    document.getElementById('btnSaveBranchSettings').textContent='Push Settings to Cashier App';
    const snapshot=reference=>({exists:()=>rows.has(reference),data:()=>rows.get(reference)});
    const user={uid:'owner'},session={uid:'owner'};
    const w={auth:{currentUser:user},sessionUser:session,db:{},globalBranchData:{b1:branch,b2:rows.get('branches/b2')},
        uploadedLogoBase64:'',removeLogo(){w.uploadedLogoBase64='';},loadBranchManager(){},
        ManagerUI:{notify:message=>notifications.push(message)},
        doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>snapshot(ref),
        deleteField:()=>deleted,serverTimestamp:()=> 'server-time',transactions:0,
        async runTransaction(_db,callback){
            w.transactions++;if(error)throw error;
            const writes=[];
            await callback({get:async ref=>snapshot(ref),update(ref,patch){writes.push(()=>{
                const value={...rows.get(ref),...patch};for(const key in value)if(value[key]===deleted)delete value[key];rows.set(ref,value);
            });},set:(ref,data)=>writes.push(()=>rows.set(ref,data))});
            if(hold)await hold;
            writes.forEach(write=>write());
        }};
    vm.runInNewContext(source,{window:w,document,readBranchNetworkSettings,saveBranchNetworkSettings,
        Swal:{fire:value=>successes.push(value)},console:{error(){}}});
    return {w,rows,fields,document,notifications,successes,field:id=>document.getElementById(id)};
}
test('a new branch saves receipt, mall mode and logo with its first private settings record',async()=>{
    const h=fixture();await h.w.openBranchSettings('b1');
    assert.equal(h.field('btnSaveBranchSettings').disabled,false);
    h.field('settingAddress').value='Belisario Street';h.field('settingWifi').value=' branch password ';
    h.field('settingMallBranch').checked=true;h.field('logoWidthScale').value='2';h.w.uploadedLogoBase64='data:image/png;base64,c3ludGhldGlj';
    await h.w.saveBranchSettings();
    const saved=h.rows.get('branches/b1');
    assert.equal(saved.address,'Belisario Street');assert.equal(saved.isMallBranch,true);assert.equal(saved.logoWidthScale,2);
    assert.equal(saved.receiptLogoBase64,'data:image/png;base64,c3ludGhldGlj');assert.equal('wifi' in saved,false);
    assert.deepEqual(h.rows.get('branch_private_settings/b1'),{branchId:'b1',branch:'Agdao',wifi:'branch password',updatedAt:'server-time',updatedByUid:'owner'});
    assert.equal(h.successes.length,1);assert.equal(h.field('branchSettingsModal').style.display,'none');
});
test('an existing branch migrates its old network value and can save again',async()=>{
    const h=fixture({legacy:true});await h.w.openBranchSettings('b1');
    assert.equal(h.field('settingWifi').value,'old password');await h.w.saveBranchSettings();
    await h.w.openBranchSettings('b1');h.field('settingContact').value='09123456789';await h.w.saveBranchSettings();
    assert.equal(h.rows.get('branches/b1').contact,'09123456789');assert.equal(h.rows.get('branch_private_settings/b1').wifi,'old password');
    assert.equal(h.successes.length,2);
});
test('rapid repeated taps start only one settings transaction',async()=>{
    let release;const hold=new Promise(resolve=>release=resolve),h=fixture({hold});await h.w.openBranchSettings('b1');
    const first=h.w.saveBranchSettings();await h.w.saveBranchSettings();await h.w.saveBranchSettings();
    assert.equal(h.w.transactions,1);assert.equal(h.field('btnSaveBranchSettings').disabled,true);
    assert.equal(h.field('btnSaveBranchSettings').textContent,'Saving settings…');release();await first;
    assert.equal(h.successes.length,1);assert.equal(h.field('btnSaveBranchSettings').disabled,false);
});
for(const [code,expected] of [['permission-denied',/Owner account/],['unavailable',/internet/],['resource-exhausted',/smaller receipt logo/]]) {
    test(code+' leaves the form open with its edits and a useful retry message',async()=>{
        const h=fixture({error:Object.assign(Error('SDK detail'),{code:'firestore/'+code})});await h.w.openBranchSettings('b1');
        h.field('settingAddress').value='Unsaved address';await h.w.saveBranchSettings();
        assert.match(h.notifications[0],expected);assert.equal(h.successes.length,0);
        assert.equal(h.field('settingAddress').value,'Unsaved address');assert.equal(h.field('branchSettingsModal').style.display,'flex');
        assert.equal(h.field('btnSaveBranchSettings').disabled,false);assert.equal(h.rows.get('branches/b1').address,undefined);
    });
}
test('saving while private settings load is blocked with the reason preserved',async()=>{
    const h=fixture();const loading=h.w.openBranchSettings('b1');
    assert.equal(h.field('btnSaveBranchSettings').disabled,true);await h.w.saveBranchSettings();
    assert.equal(h.w.transactions,0);assert.match(h.notifications[0],/still loading/);await loading;
    assert.equal(h.field('btnSaveBranchSettings').disabled,false);
});
test('a conflicting private edit cannot partly save the public branch record',async()=>{
    const h=fixture();await h.w.openBranchSettings('b1');h.field('settingAddress').value='Stale edit';
    h.rows.set('branch_private_settings/b1',{wifi:'someone else changed this'});await h.w.saveBranchSettings();
    assert.match(h.notifications[0],/Another person changed/);assert.equal(h.rows.get('branches/b1').address,undefined);assert.equal(h.successes.length,0);
});
test('a completed save cannot close another branch opened during the commit',async()=>{
    let release;const hold=new Promise(resolve=>release=resolve),h=fixture({hold});await h.w.openBranchSettings('b1');
    const saving=h.w.saveBranchSettings();await new Promise(resolve=>setImmediate(resolve));
    await h.w.openBranchSettings('b2');release();await saving;
    assert.equal(h.field('settingBranchId').value,'b2');assert.equal(h.field('branchSettingsModal').style.display,'flex');
    assert.equal(h.successes.length,0);assert.equal(h.field('btnSaveBranchSettings').disabled,false);
});
