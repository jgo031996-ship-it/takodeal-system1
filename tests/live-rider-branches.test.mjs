import test from 'node:test';
import assert from 'node:assert/strict';
import {riderPoolScope} from '../takodeal-delivery/rider-delivery-safety.js';
test('approved global Rider dispatch covers arbitrary new branches while assigned riders retain their exact scope',()=>{
    const global=riderPoolScope({status:'Active',fleetType:'Main Office',franchiseAccess:true});assert.equal(global.global,true);assert.equal(global.global||global.branches.includes('Future Branch 5'),true);
    const assigned=riderPoolScope({status:'Active',allowedBranches:['Maa']});assert.equal(assigned.global,false);assert.deepEqual(assigned.branches,['Maa']);assert.equal(assigned.global||assigned.branches.includes('Future Branch 5'),false);
});
