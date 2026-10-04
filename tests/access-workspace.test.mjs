import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNER_EMAIL,accountRecord,groupAccounts,filterAccounts,accountAction,checkNewAccount,
    canManageAccess,permissionLabels,branchRecord,filterBranches,branchAction,dateLabel,escapeHTML,registerBranchRecord} from '../takodeal-manager/access-workspace-model.js';

const owner = {email:OWNER_EMAIL}, other = {email:'manager@example.test',isOwner:true};
const rows = [accountRecord('owner-a',{email:OWNER_EMAIL,fullName:'Owner',permissions:['all'],pin:'SECRET_A'}),
    accountRecord('owner-b',{email:` ${OWNER_EMAIL.toUpperCase()} `,permissions:['devices'],pin:'SECRET_B'}),
    accountRecord('manager',{email:'manager@example.test',fullName:'Sample Manager',phone:'0123456789',permissions:['devices','payroll'],pin:'SECRET_C'}),
    accountRecord('franchise',{email:'partner@example.test',role:'Franchisee',assignedBranch:'Maa',permissions:['history']})];

test('normalized duplicate emails group without changing or combining account permissions',()=>{
    const before = JSON.stringify(rows), groups = groupAccounts(rows);
    assert.equal(groups.length,3); assert.equal(groups[0].duplicate,true);
    assert.deepEqual(groups[0].records.map(r=>r.permissions),[['all'],['devices']]);
    assert.equal('permissions' in groups[0],false); assert.equal(JSON.stringify(rows),before);
});
test('mixed roles and PIN state in a duplicate group remain visible for review',()=>{
    const group = groupAccounts([accountRecord('one',{email:'DUP@example.test',role:'Manager',pin:'PIN'}),accountRecord('two',{email:'dup@example.test',role:'Franchisee',permissions:['history']})])[0];
    assert.equal(group.role,'Mixed roles'); assert.equal(group.pinConfigured,false);
    assert.equal(group.records[0].role,'Manager'); assert.equal(group.records[1].role,'Franchise owner');
});
test('view model never carries PIN values or arbitrary credentials',()=>{
    const record = accountRecord('id',{email:'a@example.test',pin:'PIN_PRIVATE',password:'PASSWORD_PRIVATE',token:'TOKEN_PRIVATE'});
    assert.equal(record.pinConfigured,true);
    assert.doesNotMatch(JSON.stringify(record),/PRIVATE|password|token|"pin"/);
});
test('a missing permission list is not presented as all access',()=>{
    assert.deepEqual(permissionLabels(accountRecord('one',{email:'a@example.test'})),[]);
    assert.deepEqual(permissionLabels(rows[0]),['All Manager tabs']);
    assert.deepEqual(permissionLabels(rows[2],{devices:['Operations','Device Fleet']}),['Device Fleet','payroll']);
});
test('malformed emails remain separate records, rather than one unnamed access group',()=>{
    assert.equal(groupAccounts([accountRecord('a',{}),accountRecord('b',{email:42})]).length,2);
});
test('only the actual owner identity can manage access, even with UI all-access flags',()=>{
    assert.equal(canManageAccess(owner),true); assert.equal(canManageAccess(other),false);
    assert.throws(()=>accountAction(rows,'manager','permissions',other),/system owner/);
    assert.throws(()=>checkNewAccount('new@example.test',rows,other),/system owner/);
});
test('owner account protections apply to case and whitespace variants',()=>{
    for(const id of ['owner-a','owner-b']){
        assert.throws(()=>accountAction(rows,id,'revoke',owner),/protected/);
        assert.throws(()=>accountAction(rows,id,'permissions',owner),/protected/);
        assert.equal(accountAction(rows,id,'profile',owner).id,id);
    }
});
test('profile and permission changes route to exact duplicate record IDs',()=>{
    const duplicate = [accountRecord('a',{email:'d@example.test',permissions:['devices']}),accountRecord('b',{email:'d@example.test',permissions:['payroll']})];
    assert.deepEqual(accountAction(duplicate,'b','permissions',owner).permissions,['payroll']);
    assert.equal(accountAction(duplicate,'a','profile',owner).id,'a');
    assert.throws(()=>accountAction(duplicate,'b','revoke',owner),/multiple records/);
    assert.throws(()=>accountAction(duplicate,'missing','profile',owner),/system owner/);
});
test('single non-owner records retain explicit revocation',()=>assert.equal(accountAction(rows,'manager','revoke',owner).id,'manager'));
test('new account checks reject existing case variants and invalid email addresses',()=>{
    assert.throws(()=>checkNewAccount(' MANAGER@EXAMPLE.TEST ',rows,owner),/already has access/);
    for(const value of ['','bad@','a@b','a b@example.test','<a>@b.test'])assert.throws(()=>checkNewAccount(value,rows,owner),/complete Google/);
    assert.equal(checkNewAccount(' New@Example.Test ',rows,owner),'new@example.test');
});
test('account filters search across all duplicate profiles without losing role distinctions',()=>{
    const groups = groupAccounts(rows);
    assert.equal(filterAccounts(groups,'','duplicates').length,1);
    assert.equal(filterAccounts(groups,'Maa','franchise owner').length,1);
    assert.equal(filterAccounts(groups,'012345','manager').length,1);
    assert.equal(filterAccounts(groups,'','pin').length,1);
    assert.equal(filterAccounts(groups,'not-found').length,0);
});
test('branch release approval does not imply live connection or installed app version',()=>{
    const row = branchRecord('id',{name:'Maa',approvedVersion:100},100);
    assert.equal(row.approval,'approved'); assert.equal('online' in row,false); assert.equal('installedVersion' in row,false);
    assert.equal(branchRecord('id',{name:'Agdao',approvedVersion:99},100).approval,'pending');
    assert.equal(branchRecord('id',{name:'Agdao'},0).approval,'untracked');
});
test('core branch names stay protected when old records lack the isCore flag',()=>{
    for(const name of [' Main Office ','CABANTIAN','Citygate','Maa']){
        const branch = branchRecord('id',{name},100);
        assert.equal(branch.protected,true); assert.throws(()=>branchAction([branch],'id','delete',owner),/protected/);
        assert.equal(branchAction([branch],'id','settings',owner).id,'id');
    }
});
test('branch changes use exact IDs and approval version; no action on missing or already approved rows',()=>{
    const branches = [branchRecord('one',{name:'Agdao'},200),branchRecord('two',{name:'Agdao',approvedVersion:200},200)];
    assert.equal(branchAction(branches,'one','approve',owner).targetVersion,200);
    assert.equal(branchAction(branches,'two','delete',owner).id,'two');
    assert.throws(()=>branchAction(branches,'two','approve',owner),/does not need/);
    assert.throws(()=>branchAction(branches,'missing','settings',owner),/system owner/);
    assert.throws(()=>branchAction(branches,'one','settings',other),/system owner/);
    assert.equal(filterBranches(branches,'Agdao','pending').length,1);
});
test('clock location status validates actual coordinates, including valid zero coordinates',()=>{
    assert.equal(branchRecord('one',{lat:0,lng:0}).hasLocation,true);
    for(const data of [{lat:null,lng:10},{lat:'',lng:10},{lat:91,lng:10},{lat:7,lng:181},{lat:'invalid',lng:0}])assert.equal(branchRecord('one',data).hasLocation,false);
});
test('dates and untrusted profile content are rendered safely',()=>{
    assert.equal(dateLabel(null),'Date not recorded'); assert.equal(dateLabel('invalid'),'Date not recorded');
    assert.equal(dateLabel({toDate(){throw Error('bad')}}),'Date not recorded');
    assert.match(dateLabel({seconds:1791158400}),/2026/);
    assert.equal(escapeHTML('<img onerror="bad">'), '&lt;img onerror=&quot;bad&quot;&gt;');
});

test('branch registration retries a lost response without a second write or invented clock location',async()=>{
    let stored = null, writes = 0;
    const request={name:'New branch',user:owner,read:async()=>stored,timestamp:()=>123,
        write:async payload=>{stored=payload;writes++;throw Error('Response lost');}};
    await assert.rejects(registerBranchRecord(request),/Response lost/);
    assert.deepEqual(await registerBranchRecord(request),{existing:true,name:'New branch'});
    assert.equal(writes,1); assert.deepEqual(stored,{name:'New branch',isCore:false,createdAt:123});
});
test('registration cannot overwrite a different branch or run with non-owner identity',async()=>{
    let writes=0; const request={name:'New branch',user:owner,read:async()=>({name:'Different branch'}),write:async()=>writes++,timestamp:()=>123};
    await assert.rejects(registerBranchRecord(request),/no longer matches/);
    await assert.rejects(registerBranchRecord({...request,user:other}),/system owner/);
    for(const name of ['','a/b','a\\b','x'.repeat(101)])await assert.rejects(registerBranchRecord({...request,name}),/branch name/);
    assert.equal(writes,0);
});
