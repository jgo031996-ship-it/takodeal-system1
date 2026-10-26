import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { firestoreHarness } from './helpers/firestore-harness.mjs';
import { createRemittanceAttemptStore, remittanceIntent, readRemittanceDrawer, readClosedCashCarry, submitRemittanceAtomic, recordOpeningCashReview } from '../Takodeal-POS/remittance-safety.js';

const at = value => new Date(value);
const input = overrides => ({ branch:'Maa', cashier:'John Lester Garcia', amount:24000, channel:'Cash', recipient:'John Lester Garcia', referenceNumber:'', salesPeriodStart:'2026-09-29', salesPeriodEnd:'2026-10-05', sourceShiftId:'previous', ...overrides });
const attempt = (overrides, suffix = '11111111') => { const intent=remittanceIntent(input(overrides)); return { id:'manual-'+suffix, intent, fingerprint:JSON.stringify(intent) }; };
const drawer = overrides => ({sourceShiftId:'previous',active:false,available:26000,observedManualCashOut:0,observedShiftCashOut:0,...overrides});
function fixture() {
    const h=firestoreHarness(), api=h.api;
    api.where=(key,op,value)=>({key,op,value}); api.limit=count=>({limit:count}); api.orderBy=(key,direction)=>({sort:key,direction});
    api.getDocsFromServer=async q=>{
        const filters=q.filters || [];let rows=[...h.docs.entries()].filter(([path,data])=>path.startsWith(q.table+'/') && filters.filter(f=>f.key).every(f=>f.op==='>=' ? data[f.key]>=f.value : data[f.key]===f.value));
        const sort=filters.find(f=>f.sort), limit=filters.find(f=>f.limit);
        if(sort)rows.sort((a,b)=>(a[1][sort.sort]>b[1][sort.sort]?1:-1)*(sort.direction==='desc'?-1:1));
        if(limit)rows=rows.slice(0,limit.limit);
        return {docs:rows.map(([path,data])=>({id:path.slice(q.table.length+1),data:()=>structuredClone(data)}))};
    };
    h.put('shifts/previous',{branch:'Maa',active:false,status:'Closed',declaredCash:26000,endTime:at('2026-10-05T17:00:00+08:00')});
    return h;
}
function storage() { const rows=new Map(); return { getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key),rows }; }

test('twenty concurrent sends commit one transfer and one drawer entry',async()=>{
    const h=fixture(), a=attempt();
    await Promise.all(Array.from({length:20},()=>submitRemittanceAtomic(h.api,a,drawer())));
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('remittances/')).length,1);
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('expenses/')).length,1);
    assert.equal(h.get('shifts/previous').retainedCash,2000);
    assert.equal(h.get('shifts/previous').declaredCash,26000);
    assert.equal(h.get('remittances/'+a.id).cashierName,'John Lester Garcia');
    assert.equal(h.get('remittances/'+a.id).salesPeriodEnd,'2026-10-05');
});

test('lost acknowledgement and page reload confirm the same transfer without another cash deduction',async()=>{
    const h=fixture(), saved=storage(), store=createRemittanceAttemptStore(saved,()=> '11111111');
    const a=store.prepare(input());h.loseNextAck();
    await assert.rejects(submitRemittanceAtomic(h.api,a,drawer()),/lost/);
    const restored=createRemittanceAttemptStore(saved,()=> '99999999').prepare(input());
    assert.equal(restored.id,a.id);
    assert.equal((await submitRemittanceAtomic(h.api,restored,null)).status,'already-submitted');
    assert.equal(h.get('shifts/previous').retainedCash,2000);
    store.complete('Maa',a.id);assert.equal(store.pending('Maa'),null);
});

test('failed atomic send creates neither a transfer nor a drawer expense and remains safely retryable',async()=>{
    const h=fixture(), a=attempt();h.failNextCommit();
    await assert.rejects(submitRemittanceAtomic(h.api,a,drawer()),/rejected/);
    assert.equal(h.get('remittances/'+a.id),undefined);assert.equal(h.get('expenses/remittance-'+a.id),undefined);
    assert.equal(h.get('shifts/previous').manualRemittanceCashOut,undefined);
    assert.equal((await submitRemittanceAtomic(h.api,a,drawer())).status,'submitted');
});

test('two distinct stale attempts cannot both withdraw the same cash',async()=>{
    const h=fixture();const outcomes=await Promise.allSettled([submitRemittanceAtomic(h.api,attempt({},'11111111'),drawer()),submitRemittanceAtomic(h.api,attempt({},'22222222'),drawer())]);
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    assert.match(outcomes.find(result=>result.status==='rejected').reason.message,/exceeds available cash/);
    assert.equal(h.get('shifts/previous').retainedCash,2000);
});

test('legitimate separate transfers remain possible with sufficient drawer cash',async()=>{
    const h=fixture();await submitRemittanceAtomic(h.api,attempt({amount:1000,referenceNumber:'A'}),drawer());
    const fresh=await readRemittanceDrawer(h.api,'Maa');
    await submitRemittanceAtomic(h.api,attempt({amount:1000,referenceNumber:'B'},'22222222'),fresh);
    assert.equal(h.get('shifts/previous').retainedCash,24000);
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('remittances/')).length,2);
});

test('legacy post-close manual transfer reduces carry once and does not treat automatic Owner Collection as another cash expense',async()=>{
    const h=fixture(), shift=h.get('shifts/previous');
    h.put('expenses/real-transfer',{branch:'Maa',shiftId:'Accumulated_Floating',amount:24000,description:'[REMITTANCE TO HQ] - Cash to John',timestamp:at('2026-10-05T18:03:00+08:00')});
    h.put('remittances/auto-duplicate',{branch:'Maa',amount:24000,type:'Cash Collection',channel:'Owner Collection',timestamp:at('2026-10-05T18:06:00+08:00')});
    h.put('expenses/manager',{branch:'Maa',shiftId:'Accumulated_Floating',amount:9999,description:'[REMITTANCE TO HQ]',paidFrom:'Manager Fund',timestamp:at('2026-10-05T18:04:00+08:00')});
    h.put('expenses/other-branch',{branch:'Cabantian',shiftId:'Accumulated_Floating',amount:9999,description:'[REMITTANCE TO HQ]',timestamp:at('2026-10-05T18:04:00+08:00')});
    assert.equal(await readClosedCashCarry(h.api,'Maa','previous',shift),2000);
    assert.equal(h.get('remittances/auto-duplicate').amount,24000,'history is preserved for owner review');
});

test('new closed-drawer transfer uses retained cash without subtracting its expense again',async()=>{
    const h=fixture();await submitRemittanceAtomic(h.api,attempt(),drawer());
    assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),2000);
    assert.equal((await readRemittanceDrawer(h.api,'Maa')).available,2000);
});

test('subsequent transfer after a legacy post-close expense migrates the carry baseline without deducting legacy cash twice',async()=>{
    const h=fixture();h.put('expenses/legacy',{branch:'Maa',shiftId:'Accumulated_Floating',amount:24000,description:'[REMITTANCE TO HQ] - Cash to John',timestamp:at('2026-10-05T18:03:00+08:00')});
    const before=await readRemittanceDrawer(h.api,'Maa');assert.equal(before.available,2000);
    await submitRemittanceAtomic(h.api,attempt({amount:1000}),before);
    assert.equal(h.get('shifts/previous').retainedCash,1000);
    assert.equal((await readRemittanceDrawer(h.api,'Maa')).available,1000);
    assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),1000);
});

test('active drawer audit uses split cash receipts and all recorded drawer expenses, excluding manager funds and other shifts',async()=>{
    const h=fixture();h.put('shifts/current',{branch:'Maa',active:true,startingCash:2000,startTime:at('2026-10-05T19:00:00+08:00')});
    h.put('transactions/a',{branch:'Maa',shiftId:'current',paymentMethod:'Cash',netTotal:1000,timestamp:at('2026-10-05T19:01:00+08:00')});
    h.put('transactions/b',{branch:'Maa',shiftId:'current',splitDetails:[{method:'Cash',amount:300},{method:'cash',amount:200},{method:'GCash',amount:500}],timestamp:at('2026-10-05T19:02:00+08:00')});
    h.put('transactions/c',{branch:'Maa',shiftId:'previous',paymentMethod:'Cash',netTotal:9999,timestamp:at('2026-10-05T19:03:00+08:00')});
    h.put('transactions/void',{branch:'Maa',shiftId:'current',paymentMethod:'Cash',netTotal:9999,status:'Voided',timestamp:at('2026-10-05T19:04:00+08:00')});
    h.put('expenses/supplies',{branch:'Maa',shiftId:'current',amount:400});
    h.put('expenses/fund',{branch:'Maa',shiftId:'current',amount:9999,paidFrom:'Manager Fund'});
    assert.equal((await readRemittanceDrawer(h.api,'Maa')).available,3100);
    const current=await readRemittanceDrawer(h.api,'Maa');await submitRemittanceAtomic(h.api,attempt({amount:1000,sourceShiftId:'current'}),current);
    assert.equal((await readRemittanceDrawer(h.api,'Maa')).available,2100);
});

test('unexplained opening cash generates one HQ review rather than another remittance or expense',async()=>{
    const h=fixture(), review={branch:'Maa',cashier:'John',previousShiftId:'previous',expectedCash:26000,startingCash:2000,reason:'Owner or manager collection reported by staff'};
    await Promise.all(Array.from({length:10},()=>recordOpeningCashReview(h.api,review)));
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('manager_alerts/')).length,1);
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('remittances/') || key.startsWith('expenses/')).length,0);
    assert.equal(h.get('shifts/previous').declaredCash,26000);
});

test('malformed days, changed attempt payloads, mismatched branches and insufficient cash fail without financial writes',async()=>{
    assert.throws(()=>remittanceIntent(input({salesPeriodStart:'2026-02-30'})),/valid sales period/);
    assert.throws(()=>remittanceIntent(input({amount:Infinity})),/valid amount/);
    const h=fixture(), a=attempt();
    await assert.rejects(submitRemittanceAtomic(h.api,{...a,intent:{...a.intent,amount:1000}},drawer()),/identity/);
    h.put('shifts/previous',{...h.get('shifts/previous'),branch:'Cabantian'});
    await assert.rejects(submitRemittanceAtomic(h.api,a,drawer()),/another branch/);
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('remittances/') || key.startsWith('expenses/')).length,0);
});

test('pending attempt freezes the original details and prevents accidental new submission after an uncertain response',()=>{
    const saved=storage(), store=createRemittanceAttemptStore(saved,()=> '11111111');store.prepare(input());
    assert.throws(()=>store.prepare(input({amount:2000})),/awaiting confirmation/);
    assert.ok(!JSON.stringify([...saved.rows.values()]).includes('pin'));
    assert.equal(store.prepare(input()).id,'manual-11111111');
});

function submitFixture(identity = {cashierName:'John Lester Garcia'}) {
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    const start=source.indexOf('const remittanceAttempts ='),end=source.indexOf('\nwindow.loadRemittanceHistory =',start);
    const saved=storage();saved.setItem('takodeal_device_branch','Maa');
    const nodes=new Map(Object.entries({Amount:'24000',Channel:'Cash',Recipient:'John',RefNum:'',StartDate:'2026-09-29',EndDate:'2026-10-05',PinCode:'1234'}).map(([key,value])=>['remit'+key,{value}]));
    const btn={innerText:'Submit Remittance to HQ',disabled:false},calls={pin:0,drawer:0,submit:0},errors=[];let resolve;
    const pinWait=new Promise(done=>resolve=done);
    const window={sessionUser:{branch:'Maa'},verifyPin:async()=>{calls.pin++;await pinWait;return identity;},switchRemittanceTab:()=>{}};
    const context={window,localStorage:saved,document:{getElementById:id=>nodes.get(id),querySelector:()=>btn},console:{error:()=>{}},alert:message=>errors.push(message),Swal:{fire:async()=>{}},createRemittanceAttemptStore:s=>createRemittanceAttemptStore(s,()=> '11111111'),readRemittanceDrawer:async()=>{calls.drawer++;return drawer();},submitRemittanceAtomic:async(api,a,d)=>{calls.submit++;return {status:'submitted',id:a.id};}};
    vm.runInNewContext(source.slice(start,end),context);
    return {window,btn,calls,errors,resolve,nodes};
}

test('actual submit handler locks before PIN awaits and rapid double taps share one request',async()=>{
    const f=submitFixture(), first=f.window.submitRemittance(), second=f.window.submitRemittance();
    assert.equal(first,second);assert.equal(f.btn.disabled,true);assert.equal(f.window.cashierRemitSubmitting,true);assert.equal(f.calls.pin,1);
    f.resolve();await first;
    assert.deepEqual(f.calls,{pin:1,drawer:1,submit:1});assert.deepEqual(f.errors,[]);
    assert.equal(f.window.cashierRemitSubmitting,false);assert.equal(f.btn.disabled,false);assert.equal(f.nodes.get('remitPinCode').value,'');
});

test('actual submit handler rejects BLOCKED device sentinel instead of treating it as an authenticated staff identity',async()=>{
    const f=submitFixture('BLOCKED'), sent=f.window.submitRemittance();f.resolve();await sent;
    assert.equal(f.calls.drawer,0);assert.equal(f.calls.submit,0);assert.match(f.errors[0],/PIN was not verified/);
    assert.equal(f.btn.disabled,false);
});

function openingFixture({legacyTransfer=false,isMallBranch=false,startingCash='2000'}={}) {
    const h=fixture(), stored=storage();stored.setItem('takodeal_device_branch','Maa');stored.setItem('cashierName','John');
    if(legacyTransfer)h.put('expenses/legacy',{branch:'Maa',shiftId:'Accumulated_Floating',amount:24000,description:'[REMITTANCE TO HQ] - Cash to John',timestamp:at('2026-10-05T18:03:00+08:00')});
    const nodes=new Map([['btnOpenShiftSubmit',{innerText:'Open shift',disabled:false}],['inputStartingCash',{value:startingCash}],['btnTopShift',{innerText:''}],['shiftLockout',{style:{}}],['btnMainPlaceOrder',{disabled:true}]]);
    const dialogs=[],errors=[];let opens=0;
    const window={...h.api,sessionUser:{branch:'Maa',cashierName:'John'},lastEndingCash:26000,openNewShift:async()=>{opens++;return 'new-shift';},closeModal:()=>{}};
    const context={window,localStorage:stored,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},readBranchPolicy:async()=>({isMallBranch}),readClosedCashCarry,recordOpeningCashReview,console:{error:()=>{}},alert:message=>errors.push(message),Swal:{fire:async value=>{dialogs.push(value);return {isConfirmed:true,value:'Owner supplied extra opening cash'};}}};
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),start=source.indexOf('window.submitOpenShift = async function()'),end=source.indexOf('\n};',start)+3;
    vm.runInNewContext(source.slice(start,end),context);
    return {h,window,dialogs,errors,opens:()=>opens};
}

test('actual next-shift handler accounts for the earlier manual ₱24,000 and opens with ₱2,000 without auto-logging another collection',async()=>{
    const f=openingFixture({legacyTransfer:true});await f.window.submitOpenShift();
    assert.equal(f.opens(),1);assert.equal(f.dialogs.length,0);assert.deepEqual(f.errors,[]);
    assert.equal(f.window.currentShift.startingCash,2000);assert.equal(f.window.lastEndingCash,2000);
    assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('remittances/') || key.startsWith('manager_alerts/')).length,0);
});

test('actual next-shift handler records an unexplained owner collection as an HQ review without a second pending transfer',async()=>{
    const f=openingFixture();await f.window.submitOpenShift();
    assert.equal(f.opens(),1);assert.deepEqual(f.errors,[]);
    assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('manager_alerts/')).length,1);
    assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('remittances/') || key.startsWith('expenses/')).length,0);
    assert.match(f.dialogs[1].text,/No extra remittance/);
});

test('actual next-shift handler ignores rapid second taps while drawer review is running',async()=>{
    const f=openingFixture({legacyTransfer:true});await Promise.all([f.window.submitOpenShift(),f.window.submitOpenShift()]);
    assert.equal(f.opens(),1);assert.equal(f.window.cashierShiftOpening,false);
});
test('a mall shift preserves a lower physical opening count and records its difference without inventing float',async()=>{
    const f=openingFixture({legacyTransfer:true,isMallBranch:true,startingCash:'1200'});await f.window.submitOpenShift();assert.equal(f.opens(),1);assert.equal(f.window.currentShift.startingCash,1200);const reviews=[...f.h.docs].filter(([p])=>p.startsWith('manager_alerts/'));assert.equal(reviews.length,1);assert.equal(reviews[0][1].expectedCash,2000);assert.equal(reviews[0][1].startingCash,1200);assert.equal(reviews[0][1].varianceAmount,-800);assert.equal([...f.h.docs.keys()].filter(p=>p.startsWith('remittances/')).length,0);
});
test('extra opening float requires an explanation and stays separate from any cash remittance',async()=>{
    const f=openingFixture({legacyTransfer:true,isMallBranch:true,startingCash:'2300'});await f.window.submitOpenShift();assert.equal(f.opens(),1);assert.equal(f.window.currentShift.startingCash,2300);const reviews=[...f.h.docs].filter(([p])=>p.startsWith('manager_alerts/'));assert.equal(reviews.length,1);assert.equal(reviews[0][1].varianceAmount,300);assert.match(reviews[0][1].reportedReason,/extra opening/);assert.equal([...f.h.docs.keys()].filter(p=>p.startsWith('remittances/')).length,0);
});
test('fractional centavos cannot become a new opening balance that later blocks drawer reconciliation',async()=>{const f=openingFixture({legacyTransfer:true,isMallBranch:true,startingCash:'0.001'});await f.window.submitOpenShift();assert.equal(f.opens(),0);assert.equal(f.window.currentShift,undefined);assert.equal([...f.h.docs.keys()].filter(p=>p.startsWith('manager_alerts/')).length,0);});

test('actual closed carry subtracts an ordinary post-close withdrawal explicitly linked to that cash source',async()=>{
 const h=fixture();h.put('shifts/previous',{...h.get('shifts/previous'),declaredCash:1000});h.put('expenses/post-close-cost',{branch:'Maa',shiftId:'Accumulated_Floating',cashSourceShiftId:'previous',paidFrom:'Drawer',amount:100,category:'Supplies',timestamp:at('2026-10-05T18:04:00+08:00')});
 assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),900);const checked=await readRemittanceDrawer(h.api,'Maa');assert.equal(checked.available,900);assert.ok(checked.legacyCarryExpenseIds.includes('post-close-cost'));
});
test('actual retained cash rather than expected ledger cash is carried into the next opening',async()=>{
 const h=fixture();h.put('shifts/previous',{...h.get('shifts/previous'),declaredCash:1000,retainedCash:900,expectedRetainedCash:1000});assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),900);
});
test('closed carry excludes Manager Fund and already-adjusted withdrawals without counting either again',async()=>{
 const h=fixture();h.put('shifts/previous',{...h.get('shifts/previous'),declaredCash:1000,retainedCash:900});h.put('expenses/fund',{branch:'Maa',shiftId:'Accumulated_Floating',cashSourceShiftId:'previous',paidFrom:'Manager Fund',amount:9999,timestamp:at('2026-10-05T18:04:00+08:00')});h.put('expenses/already-adjusted',{branch:'Maa',shiftId:'Accumulated_Floating',cashSourceShiftId:'previous',paidFrom:'Drawer',amount:100,carryAlreadyAdjusted:true,timestamp:at('2026-10-05T18:04:00+08:00')});assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),900);
});
test('a legacy carry checkpoint prevents an ordinary cash expense from being subtracted after migration twice',async()=>{
 const h=fixture();h.put('shifts/previous',{...h.get('shifts/previous'),declaredCash:1000});h.put('expenses/post-close-cost',{branch:'Maa',shiftId:'Accumulated_Floating',cashSourceShiftId:'previous',paidFrom:'Drawer',amount:100,timestamp:at('2026-10-05T18:04:00+08:00')});const before=await readRemittanceDrawer(h.api,'Maa');assert.equal(before.available,900);await submitRemittanceAtomic(h.api,attempt({amount:500}),before);assert.equal(h.get('shifts/previous').retainedCash,400);assert.equal(await readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),400);
});
test('closed carry cannot mix another branch or contradictory drawer source links',async()=>{
 const h=fixture();await assert.rejects(readClosedCashCarry(h.api,'Other','previous',h.get('shifts/previous')),/no longer closed/);h.put('expenses/conflicting',{branch:'Maa',shiftId:'previous',cashSourceShiftId:'another-drawer',paidFrom:'Drawer',amount:100,timestamp:at('2026-10-05T18:04:00+08:00')});await assert.rejects(readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),/conflicting drawer links/);
});
test('ambiguous unlinked post-close cash expenses and negative physical carry require Owner review',async()=>{
 for(const variant of ['ambiguous','negative']){const h=fixture();h.put('shifts/previous',{...h.get('shifts/previous'),declaredCash:1000});h.put('expenses/post-close-cost',{branch:'Maa',shiftId:'Accumulated_Floating',...(variant==='negative'?{cashSourceShiftId:'previous'}:{}),paidFrom:'Drawer',amount:variant==='negative'?1000.01:100,timestamp:at('2026-10-05T18:04:00+08:00')});await assert.rejects(readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),variant==='negative'?/withdrawals exceed/:/no verified source drawer/);}
});
test('cached or locally pending post-close reads cannot be used as confirmed opening carry',async()=>{
 for(const flag of ['fromCache','hasPendingWrites'])for(const scope of ['query','document']){const h=fixture(),read=h.api.getDocsFromServer;h.put('expenses/post-close-cost',{branch:'Maa',shiftId:'Accumulated_Floating',cashSourceShiftId:'previous',paidFrom:'Drawer',amount:100,timestamp:at('2026-10-05T18:04:00+08:00')});h.api.getDocsFromServer=async q=>{const result=await read(q);if(scope==='query')result.metadata={[flag]:true};else result.docs[0].metadata={[flag]:true};return result;};await assert.rejects(readClosedCashCarry(h.api,'Maa','previous',h.get('shifts/previous')),/Connect to HQ/);}
});
