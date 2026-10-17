import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {posSettingsPolicy,POS_SETTINGS_DEFAULTS,hqPOSAccess,canUsePOSSetting,activePOSStaff} from '../Takodeal-POS/pos-settings-model.js';
const branch='Sample Branch',user={uid:'manager-1',email:'manager@example.test',emailVerified:true},profile={email:user.email,role:'Manager',permissions:['posconfig'],assignedBranch:branch,pin:'4829'},grant={active:true,allowedBranches:[branch],permissions:['posconfig']};
test('default matrix retains basic staff tools and does not permit staff drawer or operational changes',()=>{
    const policy=posSettingsPolicy(),staff={staffId:'crew'};
    for(const action of ['parkedOrders','printerTools'])assert.equal(canUsePOSSetting(action,{policy,staff}),true);
    for(const action of ['manualDrawer','audit','kds','autoDrawer'])assert.equal(canUsePOSSetting(action,{policy,staff}),false);
    assert.equal(canUsePOSSetting('printerTools',{policy}),false);
    policy.staff.printerTools=false;assert.equal(POS_SETTINGS_DEFAULTS.staff.printerTools,true);
});
test('manager control access requires verified Google identity and both saved branch sources',()=>{
    assert.equal(hqPOSAccess(user,profile,grant,branch)?.kind,'manager');
    for(const [u,p,g,b] of [[{...user,emailVerified:false},profile,grant,branch],[user,{...profile,email:'other@example.test'},grant,branch],[user,profile,{...grant,active:false},branch],[user,profile,{...grant,allowedBranches:['Other']},branch],[user,{...profile,assignedBranch:'Other'},grant,branch],[user,{...profile,role:'Cashier'},grant,branch],[user,profile,grant,'Other']])assert.equal(hqPOSAccess(u,p,g,b),null);
});
test('saved permission keys and the Owner matrix separately constrain a Manager',()=>{
    const hq=hqPOSAccess(user,profile,grant,branch),policy=posSettingsPolicy();
    assert.equal(canUsePOSSetting('kds',{policy,hq}),true);assert.equal(canUsePOSSetting('audit',{policy,hq}),false);
    policy.manager.kds=false;assert.equal(canUsePOSSetting('kds',{policy,hq}),false);
    assert.equal(canUsePOSSetting('kds',{policy,hq:{...hq,permissions:['invented-manager-role']}}),false);
    assert.equal(canUsePOSSetting('audit',{policy,hq:{...hq,permissions:['inventory']}}),true);
    for(const permissions of [undefined,[],['history']])assert.equal(hqPOSAccess(user,profile,{...grant,permissions},branch),null);
});
test('cashier role labels and stored PIN aliases cannot create privileged access',()=>{
    const session={staffId:'crew',cashierName:'Sample Crew'},crew={...session,pin:'7281',role:'Staff',active:true};
    assert.ok(activePOSStaff(crew,session));
    for(const change of [{role:'Owner'},{active:false},{archived:true},{status:'TERMINATED'},{status:'Blocked'},{pin:'BLOCKED'},{pin:''},{pin:'',securityPin:'REVOKED'},{staffId:'other'}])assert.equal(activePOSStaff({...crew,...change},session),null);
    assert.equal(canUsePOSSetting('audit',{staff:{...crew,role:'Owner',permissions:['all']}}),false);
});
test('only the actual verified main Owner receives global policy authority',()=>{
    const owner={uid:'owner',email:'jgo031996@gmail.com',emailVerified:true},account={email:owner.email,role:'Owner',permissions:[]};
    assert.equal(hqPOSAccess(owner,account,null,branch)?.kind,'owner');
    assert.equal(hqPOSAccess({...owner,emailVerified:false},account,null,branch),null);
    assert.equal(hqPOSAccess(user,{...profile,role:'Owner',permissions:['all']},null,branch),null);
});
test('inactive or revoked HQ accounts stay denied even if a protected branch grant remains',()=>{
    for(const change of [{archived:true},{active:false},{status:'ARCHIVED'},{status:'terminated'},{pin:'',securityPin:'REVOKED'}])assert.equal(hqPOSAccess(user,{...profile,...change},grant,branch),null);
});
test('policy rejects malformed fields instead of treating strings or missing values as permission',()=>{
    for(const value of [{version:2},{...posSettingsPolicy(),staff:{parkedOrders:'true'}},{...posSettingsPolicy(),manager:{}}])assert.throws(()=>posSettingsPolicy(value));
});
test('Settings routing is a page and receipt-triggered drawer bytes keep the existing pipeline',()=>{
    const html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8'),hub=readFileSync(new URL('../Takodeal-POS/pos-settings-hub.js',import.meta.url),'utf8'),main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    assert.match(html,/id="posSettingsButton" onclick="window\.openPOSSettings\(\)"/);assert.match(hub,/view\.id='view-settings'/);
    assert.equal((html.match(/kickCashDrawer\(/g)||[]).length,1);
    assert.match(main,/window\.kickCashDrawer = function\(\) \{[\s\S]*?new Uint8Array\(\[0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0x96\]\)/);
    assert.match(html,/localStorage\.getItem\('takodeal_auto_drawer'\) !== 'false'/);
    assert.match(main,/initializeApp\(firebaseConfig,'pos-control-approval'\)/);
});
