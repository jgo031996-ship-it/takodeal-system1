import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {riderRuntime} from './helpers/rider-runtime-harness.mjs';

const photo=()=>({type:'image/jpeg',size:3,name:'sample.jpg',arrayBuffer:async()=>Uint8Array.from([1,2,3]).buffer});
function topUpDialog(h,reference='123 - 456') {
    h.node('topupRef').value=reference;
    h.node('topupProof').files=[photo()];
    const validation=[];
    h.context.Swal.showValidationMessage=message=>validation.push(message);
    h.context.Swal.fire=async options=>options.preConfirm?{value:await options.preConfirm()}:{isConfirmed:true};
    return validation;
}

for (const status of ['pending','approved','rejected']) {
    test('a '+status+' top-up survives reload without uploading or creating another request',async()=>{
        const h=riderRuntime();await h.login();
        const id='topup-'+createHash('sha256').update('rider-a:123456').digest('hex');
        const saved={riderId:'rider-a',reference:'123 456',status,proofUrl:'https://example.test/original.jpg',amount:250};
        h.backend.put('rider_topups/'+id,saved);
        let uploads=0;h.context.uploadBytes=async()=>{uploads++;throw Error('Existing proof must not be overwritten');};
        topUpDialog(h);
        const result=await h.window.requestTopUp();
        assert.equal(result.alreadySaved,true);assert.equal(result.status,status);assert.equal(result.topupId,id);
        assert.equal(uploads,0);assert.deepEqual(h.backend.get('rider_topups/'+id),saved);
        assert.equal(h.backend.get('riders/rider-a').walletBalance,100);
        assert.match(h.node('riderOperationStatus').textContent,/already/);
    });
}

test('blank formatted payment reference is rejected before reads, uploads or writes',async()=>{
    const h=riderRuntime();await h.login();const validation=topUpDialog(h,'---   ---');
    const reads=h.reads.length,writes=h.writes.length;
    const result=await h.window.requestTopUp();
    assert.equal(result.cancelled,true);assert.equal(validation.length,1);
    assert.equal(h.reads.length,reads);assert.equal(h.writes.length,writes);
});

test('a conflicting saved reference is not replaced or uploaded',async()=>{
    const h=riderRuntime();await h.login();topUpDialog(h);
    const id='topup-'+createHash('sha256').update('rider-a:123456').digest('hex');
    const saved={riderId:'rider-b',reference:'123456',status:'pending',proofUrl:'https://example.test/original.jpg'};
    h.backend.put('rider_topups/'+id,saved);
    let uploads=0;h.context.uploadBytes=async()=>{uploads++;};
    assert.equal(await h.window.requestTopUp(),false);
    assert.equal(uploads,0);assert.deepEqual(h.backend.get('rider_topups/'+id),saved);
});

test('failed ping claim clears the offer and restores its button',async()=>{
    const h=riderRuntime();await h.login();
    h.window.triggerIncomingPing('missing-order',{branch:'Maa',deliveryAddress:'Sample address'});
    h.context.Swal.fire=async()=>({isConfirmed:true});
    assert.equal(await h.window.acceptPing(),false);
    assert.equal(h.window.activePingId,null);assert.equal(h.node('btnAcceptPing').disabled,false);
    assert.equal(h.node('btnAcceptPing').textContent,'Accept delivery');
    assert.equal(h.node('incomingOrderPing').style.display,'none');
    assert.equal(h.window.riderActionBusy,false);
});
