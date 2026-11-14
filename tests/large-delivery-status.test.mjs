import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import * as owner from '../takodeal-manager/dispatch-safety.js';
import * as cashier from '../Takodeal-POS/dispatch-safety.js';
import * as franchise from '../takodeal-franchise/dispatch-safety.js';

function shipment(count=129,{sameStock=false,charged=false}={}) {
    const h=firestoreHarness();
    h.api.getDocFromServer=async ref=>{const data=structuredClone(h.get(ref.path));return {id:ref.id,ref,exists:()=>data!==undefined,data:()=>structuredClone(data)};};
    const ids=Array.from({length:count},(_,i)=>'large-'+i);
    for(const [i,id]of ids.entries()) {
        const key=sameStock?'shared':String(i),name='Sample Item '+key;
        h.put('inventory/hq-'+key,{branch:'Main Office',name,currentStock:10,uom:'Gram'});
        h.put('inventory/local-'+key,{branch:'Agdao',name,currentStock:7,uom:'Gram'});
        h.put('dispatch_logs/'+id,{batchId:'large',sourceBranch:'Main Office',sourceId:'hq-'+key,toBranch:'Agdao',item:name,qty:20,displayQty:2,convRate:10,displayUom:'Pack',uom:'Gram',unitCost:3,franchiseCharged:charged,status:'In Transit'});
    }
    return Object.assign(h,{ids,input:{branch:'Agdao',actor:'Sample Cashier',items:ids.map(id=>({id,actualDisplayQty:2,isMissing:false}))}});
}
const snapshot=h=>structuredClone([...h.docs]);
const rows=(h,table)=>[...h.docs].filter(([path])=>path.startsWith(table+'/'));

for(const [name,service]of [['Owner',owner],['Cashier',cashier],['Franchise',franchise]]) {
    test(name+': 129 saved lines arrive and are received together; retries cannot add stock twice',async()=>{
        const h=shipment();
        assert.equal((await service.transitionDispatch(h.api,{ids:[...h.ids,h.ids[0]],mode:'arrive',actor:'Sample Owner'})).length,129);
        for(const id of h.ids)assert.equal(h.get('dispatch_logs/'+id).status,'Arrived');
        assert.equal(h.get('inventory/local-128').currentStock,7);
        h.loseNextAck();await assert.rejects(service.receiveDispatch(h.api,h.input),/Connection lost/);
        const saved=snapshot(h);
        assert.deepEqual(await Promise.all(Array.from({length:5},()=>service.receiveDispatch(h.api,h.input))),[0,0,0,0,0]);
        assert.deepEqual(snapshot(h),saved);
        for(let i=0;i<129;i++){assert.equal(h.get('inventory/local-'+i).currentStock,27);assert.equal(h.get('inventory/hq-'+i).currentStock,10);assert.equal(h.get('dispatch_logs/large-'+i).status,'Received');}
        assert.equal(rows(h,'stock_logs').length,129);
    });
    test(name+': concurrent returns of 129 lines restore shared stock and supply credits only once',async()=>{
        const h=shipment(129,{sameStock:true,charged:true}),input={ids:h.ids,mode:'return',actor:'Sample Owner'};
        h.loseNextAck();await assert.rejects(service.transitionDispatch(h.api,input),/Connection lost/);
        await Promise.all(Array.from({length:5},()=>service.transitionDispatch(h.api,input)));
        assert.equal(h.get('inventory/hq-shared').currentStock,10+129*20);
        assert.equal(h.get('inventory/local-shared').currentStock,7);
        assert.equal(rows(h,'stock_logs').length,129);assert.equal(rows(h,'franchise_ledger').length,129);
        assert.equal(rows(h,'franchise_ledger').reduce((sum,[,row])=>sum+row.amount,0),129*60);
    });
}

test('actual Owner Arrived button passes its entire 129-line group and refreshes only after success',async()=>{
    const h=shipment(),alerts=[];let refreshes=0;
    Object.assign(h.api,{ManagerUI:{confirm:async()=>true},sessionUser:{cashierName:'Sample Owner'},loadDispatchLogs:()=>refreshes++});
    const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
    const start=main.indexOf('window.markDispatchArrived =');
    const binding=main.slice(start,main.indexOf('window.resolveMissingDispatchItems =',start));
    vm.runInNewContext(binding,{window:h.api,transitionDispatch:owner.transitionDispatch,Swal:{fire:(...args)=>alerts.push(args)}});
    await h.api.markDispatchArrived(encodeURIComponent(JSON.stringify({toBranch:'Agdao',items:h.ids.map(id=>({id}))})));
    assert.equal(refreshes,1);assert.equal(alerts.at(-1)[0],'Delivery arrived');
    assert.ok(h.ids.every(id=>h.get('dispatch_logs/'+id).status==='Arrived'));
});

test('last-line validation and commit failures leave all 129 shipment lines untouched',async()=>{
    for(const mode of ['arrive','return','receive'])for(const failure of ['invalid-last','commit']) {
        const h=shipment();
        if(mode==='receive')await owner.transitionDispatch(h.api,{ids:h.ids,mode:'arrive',actor:'Sample Owner'});
        if(failure==='invalid-last')h.put('dispatch_logs/large-128',{...h.get('dispatch_logs/large-128'),qty:-1});
        else h.failNextCommit();
        const before=snapshot(h);
        await assert.rejects(mode==='receive'?owner.receiveDispatch(h.api,h.input):owner.transitionDispatch(h.api,{ids:h.ids,mode,actor:'Sample Owner'}),/Invalid|Commit rejected/);
        assert.deepEqual(snapshot(h),before);
    }
});

test('201 discrepant receipts commit over 500 writes together, preserving actual amounts and alerts',async()=>{
    const h=shipment(201);
    await owner.transitionDispatch(h.api,{ids:h.ids,mode:'arrive',actor:'Sample Owner'});
    h.input.items.forEach(row=>row.actualDisplayQty=1);
    assert.equal(await owner.receiveDispatch(h.api,h.input),201);
    assert.equal(rows(h,'manager_alerts').length,201);assert.equal(rows(h,'stock_logs').length,201);
    assert.equal(h.get('inventory/local-200').currentStock,17);
    assert.equal(h.get('dispatch_logs/large-200').variance,-10);
});

test('payload limits abort the whole save, including writes staged before oversized notes',async()=>{
    for(const kind of ['document','request']) {
        const h=shipment();await owner.transitionDispatch(h.api,{ids:h.ids,mode:'arrive',actor:'Sample Owner'});
        if(kind==='document')h.input.items.at(-1).remarks='界'.repeat(300000);
        else h.input.items.forEach(row=>row.remarks='x'.repeat(40000));
        const before=snapshot(h);await assert.rejects(owner.receiveDispatch(h.api,h.input),/too much saved detail/);
        assert.deepEqual(snapshot(h),before);
    }
});

test('received items cannot be returned and duplicate receiving IDs remain rejected',async()=>{
    const h=shipment();await owner.transitionDispatch(h.api,{ids:h.ids,mode:'arrive',actor:'Sample Owner'});
    const duplicate={...h.input,items:[...h.input.items,h.input.items[0]]},before=snapshot(h);
    await assert.rejects(owner.receiveDispatch(h.api,duplicate),/unique/);assert.deepEqual(snapshot(h),before);
    await owner.receiveDispatch(h.api,h.input);const received=snapshot(h);
    await assert.rejects(owner.transitionDispatch(h.api,{ids:h.ids,mode:'return',actor:'Sample Owner'}),/cashier/);
    assert.deepEqual(snapshot(h),received);
});
