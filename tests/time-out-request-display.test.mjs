import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {isTimeOutScheduleReview,timeOutRequestLabel,timeOutRequestDetailsHTML} from '../takodeal-staff/time-out-request-display.js';

const row=(extra={})=>({type:'Early Time Out',status:'Pending',requiresScheduleReview:true,staffId:'sample-staff',staffName:'Sample Crew',branch:'Sample Branch',reason:'Night shift finished at 3 AM.',timestamp:new Date('2026-10-29T03:06:00+08:00'),...extra});

test('schedule review display requires the explicit saved flag and never changes its type or outcome',()=>{
 for(const status of ['Pending','Not Required','Completed Normally','Rejected','Cancelled']){const saved=row({status}),before=structuredClone(saved);assert.equal(timeOutRequestLabel(saved),'Time-out schedule review');assert.equal(isTimeOutScheduleReview(saved),true);const html=timeOutRequestDetailsHTML(saved);assert.match(html,/schedule.review/i);assert.doesNotMatch(html,/minutes early|undertime|penalt|deduct|₱/i);assert.deepEqual(saved,before);}
 for(const requiresScheduleReview of [false,undefined,'true'])assert.equal(timeOutRequestLabel(row({requiresScheduleReview})),'Early Time Out');assert.equal(timeOutRequestLabel({type:'Leave',requiresScheduleReview:true}),'Leave');
});

test('friendly history wording preserves what each actual recorded status establishes',()=>{
 assert.match(timeOutRequestDetailsHTML(row()),/does not establish that you left early/);assert.match(timeOutRequestDetailsHTML(row()),/does not record Time Out/);assert.match(timeOutRequestDetailsHTML(row({status:'Not Required'})),/without early-time-out approval/);assert.match(timeOutRequestDetailsHTML(row({status:'Completed Normally'})),/Normal Time Out was recorded/);assert.match(timeOutRequestDetailsHTML(row({reason:'<img onerror=bad()>'})),/&lt;img/);assert.doesNotMatch(timeOutRequestDetailsHTML(row({reason:'<img onerror=bad()>'})),/<img/);
});

function actualStaffInbox(records){
 const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),from=source.indexOf('window.loadInbox = async function()'),to=source.indexOf('window.currentSopRoles =',from);assert.ok(from>0&&to>from);
 const panel={innerHTML:'',textContent:''},root={append(){}},writes=[],calls=[],values={takodeal_staff_id:'sample-staff',takodeal_staff_name:'Sample Crew'},window={getStaffLeaveUI:()=>({list:async()=>[],details:()=>'',actions:()=>''})};
 const context={window,document:{getElementById:id=>id==='requestInboxPanel'?panel:id==='reqInboxList'?root:null},localStorage:{getItem:key=>values[key]},db:{},collection:(_db,table)=>table,where:(...args)=>args,query:(...args)=>args,getDocs:async reference=>{calls.push(reference);return{forEach:callback=>records.forEach((saved,index)=>callback({id:'request-'+index,data:()=>structuredClone(saved)}))};},doc:(_db,...parts)=>parts.join('/'),updateDoc:(...args)=>writes.push(args),timeOutRequestLabel,timeOutRequestDetailsHTML,Date,console};
 vm.runInNewContext(source.slice(from,to),context);return {window,panel,writes,calls};
}

test('the actual Staff history card labels the 3:06 AM unknown request as a schedule review without changing records',async()=>{
 const saved=row({reason:'<script>unsafe()</script> 5:30 PM to 3:00 AM'}),before=structuredClone(saved),f=actualStaffInbox([saved]);await f.window.loadInbox();assert.match(f.panel.innerHTML,/Time-out schedule review/);assert.doesNotMatch(f.panel.innerHTML,/>Early Time Out<\/strong>|<script>/);assert.match(f.panel.innerHTML,/does not establish that you left early/);assert.match(f.panel.innerHTML,/Pending/);assert.match(f.panel.innerHTML,/&lt;script&gt;/);assert.equal(f.writes.length,0);assert.equal(f.calls.length,1);assert.deepEqual(saved,before);
});

test('the actual Staff history retains Not Required and normal Time Out outcomes with neutral review details',async()=>{
 const records=[row({status:'Not Required'}),row({status:'Completed Normally'})],before=structuredClone(records),f=actualStaffInbox(records);await f.window.loadInbox();assert.match(f.panel.innerHTML,/Not Required/);assert.match(f.panel.innerHTML,/Completed Normally/);assert.match(f.panel.innerHTML,/without early-time-out approval/);assert.match(f.panel.innerHTML,/Normal Time Out was recorded/);assert.equal(f.writes.length,0);assert.deepEqual(records,before);
});

test('Owner and Staff use identical display helpers with no clock-out, payroll or storage dependency',()=>{
 const owner=readFileSync(new URL('../takodeal-manager/time-out-request-display.js',import.meta.url),'utf8'),staff=readFileSync(new URL('../takodeal-staff/time-out-request-display.js',import.meta.url),'utf8');assert.equal(owner,staff);assert.doesNotMatch(staff,/^import|localStorage|indexedDB|runTransaction|updateDoc|setDoc/m);
});
