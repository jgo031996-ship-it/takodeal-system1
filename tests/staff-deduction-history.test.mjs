import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ReviewDocument} from './helpers/review-dom.mjs';
import {formatStaffDeductionHistory,renderValeHistoryRows} from '../takodeal-manager/staff-deduction-history.js';
import {isPenaltyDeduction} from '../takodeal-manager/sanction-schedule.js';

function documentWith(html){const d=new ReviewDocument();d.body.innerHTML=html;for(const node of [d.body,...d.body.querySelectorAll('div,table,tbody,tr,td,button,span')]){node.getAttribute=name=>node.attributes[name]??null;node.style={};}return d;}
test('profile formatting preserves every amount, status and original action node while adding compact row labels',()=>{
 const d=documentWith('<div><table class="existing-table"><tbody id="history"><tr data-owner-deduction-history="fictional"><td>Oct 31</td><td>Cash Advance</td><td>₱12,345.67</td><td>Unpaid</td><td><div><button data-owner-deduction="fictional">Review</button></div></td></tr><tr><td colspan="5">No history</td></tr></tbody></table></div>'),body=d.getElementById('history'),button=body.querySelector('button');let clicks=0;button.onclick=()=>clicks++;
 const row=body.children[0],cells=[...row.children],text=body.textContent;formatStaffDeductionHistory(body);formatStaffDeductionHistory(body);
 assert.equal(body.textContent,text);assert.deepEqual(row.children,cells);assert.equal(body.querySelector('button'),button);button.click();assert.equal(clicks,1);assert.equal(button.dataset.ownerDeduction,'fictional');assert.equal(row.dataset.ownerDeductionHistory,'fictional');
 assert.deepEqual(cells.map(cell=>cell.dataset.label),['Date','Type','Amount','Status','Action']);assert.equal(body.children[1].children[0].dataset.label,undefined);assert.match(body.closest('table').attributes.class,/existing-table/);assert.match(body.closest('table').attributes.class,/staff-deduction-history/);assert.match(body.closest('table').parentElement.attributes.class,/staff-deduction-history-wrap/);
});
test('Vale rows expose full notes, amount and status as text, escape stored content and keep the penalty action',()=>{
 const row={id:'fictional-penalty',type:'Penalty <img src=x>',notes:'Long note & <script>test</script> "quoted"',amount:12345.67,status:'Unpaid <b>review</b>',dateAdded:new Date('2026-10-24T16:15:00Z'),effectiveDate:'2026-10-25'},calls=[];
 const html=renderValeHistoryRows([row],{isPenaltyDeduction:()=>true,penaltyDateAction:value=>{calls.push(value);return '<button data-change-date="fictional">Review date</button>';}}),d=documentWith('<div><table><tbody id="history">'+html+'</tbody></table></div>'),body=d.getElementById('history');formatStaffDeductionHistory(body,{kind:'vale'});
 assert.deepEqual(calls,[row]);assert.equal(body.querySelector('img'),null);assert.equal(body.querySelector('script'),null);assert.ok(body.textContent.includes(row.notes));assert.ok(body.textContent.includes(row.status));assert.ok(body.textContent.includes('12,345.67'));assert.match(body.children[0].children[0].textContent,/25/);assert.ok(body.textContent.includes('Effective: 2026-10-25'));assert.ok(body.textContent.includes('Review date'));assert.deepEqual(body.children[0].children.map(cell=>cell.dataset.label),['Date added','Type','Notes','Status','Amount']);
});
test('saved zero amounts remain zero and malformed amounts and dates are described without a fabricated value',()=>{
 const html=renderValeHistoryRows([{type:'Cash Advance',amount:0,status:'Paid'},{type:'Payment',amount:'500.25',status:'Paid'},{type:'Cash Advance',amount:'not saved',dateAdded:'not a date'}]);
 assert.match(html,/₱0\.00/);assert.match(html,/\+ ₱500\.25/);assert.match(html,/Amount needs review/);assert.match(html,/Date not recorded/);assert.equal((html.match(/₱0\.00/g)||[]).length,1);
});
test('the actual Deduction and Vale History handler uses the compact renderer without changing its saved records or issuing writes',async()=>{
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=main.indexOf('window.viewLedgerHistory ='),source=main.slice(start,main.indexOf('\n};',start)+3),d=documentWith('<div id="ledgerHistoryModal"><div id="ledgerHistorySubtitle"></div><table><tbody id="ledgerHistoryBody"></tbody></table></div>');
 const records=[{id:'fictional-a',type:'Cash Advance',notes:'Transport for a covered shift <img src=x>',amount:12345.67,status:'Unpaid',dateAdded:{toDate:()=>new Date('2026-10-20T09:00:00+08:00')}},{id:'fictional-b',type:'Payment',amount:100,status:'Paid',dateAdded:{toDate:()=>new Date('2026-10-21T09:00:00+08:00')}}],queries=[],errors=[],w={};
 vm.runInNewContext(source,{window:w,document:d,db:{},collection:(_db,table)=>({table}),where:(field,op,value)=>({field,op,value}),query:(ref,...clauses)=>({...ref,clauses}),getDocs:async ref=>{queries.push(ref);return {empty:false,forEach:callback=>records.forEach(row=>callback({id:row.id,data:()=>row}))};},isPenaltyDeduction,escapeHtml:value=>String(value).replaceAll('<','&lt;'),renderValeHistoryRows,formatStaffDeductionHistory,console:{error:(...args)=>errors.push(args)}});
 await w.viewLedgerHistory('Fictional Crew');const body=d.getElementById('ledgerHistoryBody');assert.equal(queries.length,1);assert.equal(queries[0].table,'staff_deductions');assert.equal(queries[0].clauses[0].value,'Fictional Crew');assert.deepEqual(errors,[]);assert.equal(body.children.length,2);assert.equal(body.children[0].children[1].textContent,'Payment');assert.equal(body.children[0].children[4].dataset.label,'Amount');assert.ok(body.textContent.includes('12,345.67'));assert.ok(body.textContent.includes('Unpaid'));assert.equal(body.querySelector('img'),null);assert.equal(records[0].amount,12345.67);assert.equal(records[0].status,'Unpaid');
});
