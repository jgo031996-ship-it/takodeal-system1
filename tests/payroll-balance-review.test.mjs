import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayrollRosterResolver} from '../takodeal-manager/payroll-roster-model.js';
import {buildPayrollRosterReview,renderPayrollBalanceReview} from '../takodeal-manager/payroll-balance-review.js';

class Node{constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.hidden=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}get text(){return this.textContent+this.children.map(node=>node.text??node.textContent??'').join(' ');}set innerHTML(_){assert.fail('Saved balance data must never be interpreted as HTML');}}
const document=()=>{const root=new Node();return {root,getElementById:id=>id==='payrollBalanceReview'?root:null,createElement:tag=>new Node(tag)};};

test('former balances remain inspectable while paid snapshots and earned final pay stay in payroll',()=>{
 const profiles=[{staffId:'active',cashierName:'Current Crew',branch:'Sample Branch'},{staffId:'former',cashierName:'Former Crew',branch:'Sample Branch',pin:'REVOKED',status:'Resigned'},{staffId:'final',cashierName:'Final Pay Crew',branch:'Sample Branch',pin:'REVOKED'}],staffDict=Object.fromEntries(profiles.map(p=>[p.cashierName,p]));
 const paid={name:'Archived Paid Crew',basicPay:450,logs:[]},staffData={'Current Crew':{foodDeductions:50},'Former Crew':{foodDeductions:136},'Final Pay Crew':{totalHours:8,basicPay:450,logs:[]}},sources=new Map([['Former Crew',[{id:'sample-old-meal',type:'Staff Meal',amount:136,dateAdded:'2030-01-01'}]]]);
 const before=structuredClone({paid,staffData}),result=buildPayrollRosterReview({staffData,paidRecords:{'Archived Paid Crew':paid},staffDict,resolver:createPayrollRosterResolver(profiles),sources});
 assert.deepEqual(result.names.sort(),['Archived Paid Crew','Current Crew','Final Pay Crew']);assert.equal(result.reviewRows[0].name,'Former Crew');assert.equal(result.reviewRows[0].records[0].id,'sample-old-meal');assert.deepEqual({paid,staffData},before);
 const d=document();renderPayrollBalanceReview(d,result.reviewRows);assert.equal(d.root.hidden,false);assert.match(d.root.text,/Former Crew/);assert.match(d.root.text,/136\.00/);assert.match(d.root.text,/sample-old-meal/);assert.doesNotMatch(d.root.text,/Generate Payslip|Mark Paid/);
});

test('original attendance identity conflicts cannot become payable through a later name-only match',()=>{
 const person={staffId:'a',cashierName:'Current Crew',branch:'Sample Branch'},resolver=createPayrollRosterResolver([person]),identity=resolver({staffId:'missing',staffName:'Current Crew'});
 const result=buildPayrollRosterReview({staffData:{'Current Crew':{hours:8,basicPay:450}},paidRecords:{},staffDict:{'Current Crew':person},resolver,identities:new Map([['Current Crew',identity]])});
 assert.equal(result.names[0],'Current Crew');assert.equal(result.holds.length,1);assert.match(result.holds[0].reason,/ID/);
});

test('review rendering preserves escaped record text and clears stale data on preview invalidation',()=>{
 const d=document(),record={id:'ref<script>',type:'Meal <img>',amount:12.5,remarks:'<script>private</script>'},rows=[{name:'<script>employee</script>',branch:'Sample Branch',reason:'Review <b>identity</b>',records:[record]}],before=structuredClone(rows);
 renderPayrollBalanceReview(d,rows);assert.match(d.root.text,/<script>employee/);assert.match(d.root.text,/Reference: ref<script>/);assert.match(d.root.text,/Date not recorded/);assert.deepEqual(rows,before);
 renderPayrollBalanceReview(d,[]);assert.equal(d.root.hidden,true);assert.equal(d.root.children.length,0);
});
