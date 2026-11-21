import test from 'node:test';
import assert from 'node:assert/strict';
import {closeShiftAtomic,readBranchPolicy} from '../Takodeal-POS/cash-settlement.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
function fixture(current,opened) {
    const h=firestoreHarness();h.api.getDocs=h.api.getDocsFromServer;
    h.put('branches/example',{name:'Example East',isMallBranch:current});
    h.put('branches/other',{name:'Example West',isMallBranch:true});
    h.put('shifts/demo',{branch:'Example East',active:true,startingCash:2000,isMallBranch:opened});
    const input={branch:'Example East',shiftId:'demo',declaredCash:6000,totalCashSales:4000,totalDigitalSales:0,cashOut:0,digitalBreakdown:{},physicalStockCount:[],shiftIngredientBurn:{},closing:{},isFinalShiftOfDay:true,reviewedMallMode:current===true};
    return {h,input,close:()=>closeShiftAtomic(h.api,input)};
}
test('standard branch overrides old mall shift and string flags at the ordinary close entry point',async()=>{
    for (const policy of [false,undefined,'false','true']){
        const {h,close}=fixture(policy,true);await close();
        assert.equal(h.get('shifts/demo').isMallBranch,false);assert.equal(h.get('shifts/demo').openingMallMode,true);assert.equal(h.get('shifts/demo').expectedCash,6000);assert.equal(h.get('remittances/mall-demo'),undefined);
    }
});
test('explicit saved mall mode supports earlier and final closes even with a stale standard opening',async()=>{
    for (const final of [true,false]){
        const {h,input,close}=fixture(true,false);input.isFinalShiftOfDay=final;await close();
        assert.equal(h.get('shifts/demo').isFinalShiftOfDay,final);
        assert.equal(h.get('shifts/demo').retainedCash,final?2000:6000);assert.equal(h.get('remittances/mall-demo')?.amount,final?4000:undefined);
    }
});
test('mode changed after review, ambiguous policy, and interrupted commits keep cash consistent',async()=>{
    const {h,input,close}=fixture(false,true);
    input.reviewedMallMode=true;await assert.rejects(close(),/mode changed/);assert.equal(h.get('shifts/demo').active,true);
    input.reviewedMallMode=false;h.failNextCommit();await assert.rejects(close());assert.equal(h.get('shifts/demo').active,true);
    h.loseNextAck();await assert.rejects(close());await Promise.all([close(),close()]);assert.equal(h.get('remittances/mall-demo'),undefined);
    h.put('branches/duplicate',{name:input.branch,isMallBranch:true});await assert.rejects(readBranchPolicy(h.api,input.branch),/duplicated/);
});
