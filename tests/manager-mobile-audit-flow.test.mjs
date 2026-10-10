import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=source.indexOf('window.saveAuditTempCount = function'),end=source.indexOf('// 🏢 MULTI-TENANT BRANCH EXPANSION ENGINE',start);
assert.ok(start>=0&&end>start,'Actual audit count/render/submit implementation must be available.');
const actual=source.slice(start,end);
const sample=()=>[
    {id:'sample-chicken',name:'Sample Chicken Powder',category:'Ingredients',systemQty:1000,uom:'Gram',purchUom:'Pack',convRate:1000},
    {id:'sample-paper',name:'Sample Paper Bowl',category:'Packaging',systemQty:40,uom:'Piece',purchUom:'Pack',convRate:50},
    {id:'sample-cup',name:'Sample Cup',category:'Packaging',systemQty:20,uom:'Piece',purchUom:'Piece',convRate:1}
];
function fixture({confirmed=true}={}){
    const elements=new Map(),writes=[],notices=[];
    const element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',innerText:'',disabled:false,style:{display:'flex'}});return elements.get(id);};
    for(const id of ['auditModalBranch','auditModalSearch','auditModalBody','btnSubmitGeneralAudit','generalAuditModal'])element(id);
    element('auditModalBranch').value='LOCAL SAMPLE';element('btnSubmitGeneralAudit').innerText='Sync & Finalize Audit';
    const app={globalAuditItems:sample(),db:{sampleOnly:true},sessionUser:{cashierName:'Synthetic Reviewer'},
        ManagerUI:{confirm:async()=>confirmed,notify:text=>notices.push(text)},doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>name,
        serverTimestamp:()=>({sampleServerTime:true}),updateDoc:async(ref,data)=>writes.push({type:'update',ref,data}),addDoc:async(collection,data)=>writes.push({type:'add',collection,data})};
    const context={window:app,document:{getElementById:id=>elements.get(id)||null},Swal:{fire:(...args)=>notices.push(args)},console:{error(){}}};
    vm.createContext(context);vm.runInContext(actual,context);
    return {app,elements,writes,notices,element};
}
const json=value=>JSON.parse(JSON.stringify(value));

test('actual audit keeps typed zero and pack/base values when filtering hides and restores the rows',()=>{
    const f=fixture();
    f.app.saveAuditTempCount(0,'purch','1');f.app.saveAuditTempCount(0,'base','25');f.app.saveAuditTempCount(1,'purch','0');
    f.element('auditModalSearch').value='Cup';f.app.filterAuditTable();
    assert.equal(f.app.globalAuditItems[0].tempPurch,'1');assert.equal(f.app.globalAuditItems[0].tempBase,'25');assert.equal(f.app.globalAuditItems[1].tempPurch,'0');
    assert.ok(!f.element('auditModalBody').innerHTML.includes('auditInputPurch_0'));
    f.element('auditModalSearch').value='';f.app.filterAuditTable();
    const output=f.element('auditModalBody').innerHTML;
    assert.match(output,/id="auditInputPurch_0"[^>]*value="1"/);assert.match(output,/id="auditInputBase_0"[^>]*value="25"/);
    assert.match(output,/id="auditInputPurch_1"[^>]*value="0"/);assert.equal(f.writes.length,0);
});

test('actual submit converts saved hidden pack plus base counts and ignores completely blank items',async()=>{
    const f=fixture();f.app.saveAuditTempCount(0,'purch','1');f.app.saveAuditTempCount(0,'base','25');
    f.element('auditModalSearch').value='Cup';f.app.filterAuditTable();await f.app.submitGeneralAudit();
    assert.deepEqual(json(f.writes.filter(write=>write.type==='update')),[{type:'update',ref:{collection:'inventory',id:'sample-chicken'},data:{currentStock:1025}}]);
    const history=f.writes.find(write=>write.collection==='stock_logs');assert.equal(history.data.oldQty,1000);assert.equal(history.data.newQty,1025);assert.equal(history.data.variance,25);
    const count=f.writes.find(write=>write.collection==='stock_counts');assert.equal(count.data.counts.length,1);assert.equal(count.data.counts[0].physicalQty,1025);
    assert.equal(f.element('btnSubmitGeneralAudit').disabled,false);
});

test('explicit zero is a real count, while untouched blanks do not post zero stock',async()=>{
    const f=fixture();f.app.saveAuditTempCount(1,'purch','0');await f.app.submitGeneralAudit();
    const update=f.writes.find(write=>write.type==='update');assert.equal(update.ref.id,'sample-paper');assert.equal(update.data.currentStock,0);
    const count=f.writes.find(write=>write.collection==='stock_counts');assert.equal(count.data.counts.length,1);assert.equal(count.data.counts[0].physicalQty,0);
    assert.equal(f.writes.some(write=>write.ref?.id==='sample-chicken'||write.ref?.id==='sample-cup'),false);
});

test('an all-blank audit does not change stock, append history or create a scorecard',async()=>{
    const f=fixture();await f.app.submitGeneralAudit();assert.equal(f.writes.length,0);
    assert.ok(f.notices.some(notice=>Array.isArray(notice)&&notice[0]==='No Items Audited'));assert.equal(f.element('btnSubmitGeneralAudit').disabled,false);
});

test('cancelling the actual audit confirmation preserves typed memory and produces no writes',async()=>{
    const f=fixture({confirmed:false});f.app.saveAuditTempCount(0,'purch','2');f.app.saveAuditTempCount(0,'base','0');
    await f.app.submitGeneralAudit();assert.equal(f.writes.length,0);assert.equal(f.app.globalAuditItems[0].tempPurch,'2');assert.equal(f.app.globalAuditItems[0].tempBase,'0');
    assert.equal(f.element('btnSubmitGeneralAudit').disabled,false);assert.equal(f.element('generalAuditModal').style.display,'flex');
});

test('actual submit uses the latest visible input value and preserves same-unit base quantity arithmetic',async()=>{
    const f=fixture();f.app.saveAuditTempCount(2,'base','8');f.element('auditInputBase_2').value='12';f.element('auditInputPurch_2').value='';
    await f.app.submitGeneralAudit();const update=f.writes.find(write=>write.type==='update');assert.equal(update.ref.id,'sample-cup');assert.equal(update.data.currentStock,12);
    const count=f.writes.find(write=>write.collection==='stock_counts');assert.equal(count.data.counts[0].physicalQty,12);
});

test('actual mobile renderer escapes saved names, units and draft input strings without changing the count memory',()=>{
    const f=fixture();const item=f.app.globalAuditItems[0];item.name='Sample <img src=x onerror=alert(1)>';item.category='Ingredients & tools';item.purchUom='Pack" <x>';item.uom='Gram <base>';
    f.app.saveAuditTempCount(0,'purch','0" onfocus="alert(1)');f.app.renderAuditModalItems();
    const output=f.element('auditModalBody').innerHTML;
    assert.equal(output.includes('<img src=x'),false);assert.match(output,/&lt;img/);assert.match(output,/INGREDIENTS &amp; TOOLS/);
    assert.equal(output.includes('value="0" onfocus='),false);assert.match(output,/value="0&quot; onfocus=&quot;alert\(1\)"/);
    assert.equal(item.tempPurch,'0" onfocus="alert(1)');assert.equal(f.writes.length,0);
});
