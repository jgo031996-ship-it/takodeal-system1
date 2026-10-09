import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {attendanceRows} from '../Takodeal-POS/cashier-data.js';
import {attendanceEstimate,money,esc} from '../takodeal-franchise/franchise-data.js';

const at=time=>new Date('2026-10-07T'+time+':00+08:00');
const punch=(id,type,time,extra={})=>({id,staffId:'staff-1',staffName:'Sample Staff',branch:'Maa',type,timestamp:at(time),...extra});
const older=punch('old-in','TIME IN','01:00'),newer=punch('new-in','TIME IN','03:00'),oldClose=punch('old-out','TIME OUT','09:00',{timeInLogId:'old-in'});
const profiles=[{id:'staff-1',cashierName:'Sample Staff',branch:'Maa',hourlyRate:500}];
const estimate=(logs,extra={})=>attendanceEstimate({logs,profiles,start:'2026-10-07',end:'2026-10-07',branch:'Maa',...extra});

test('Cashier shows the older linked closure and keeps the newer shift on duty without changing punches',()=>{
 const logs=[older,newer,oldClose],original=structuredClone(logs),rows=attendanceRows(logs,'2026-10-07','Maa',+at('10:00'));
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.status==='On duty').in,+newer.timestamp);
 const closed=rows.find(r=>r.status==='Completed');assert.equal(closed.in,+older.timestamp);assert.equal(closed.out,+oldClose.timestamp);assert.equal(closed.hours,8);assert.deepEqual(logs,original);
});
test('Cashier never pairs a missing or different-employee explicit source with a visible newer start',()=>{
 for(const change of [{timeInLogId:'unavailable-start'},{staffId:'staff-2'}]) {
  const rows=attendanceRows([newer,{...oldClose,...change}],'2026-10-07','Maa',+at('10:00'));
  assert.equal(rows.filter(r=>r.status==='Completed').length,0);assert.equal(rows.find(r=>r.status==='On duty').in,+newer.timestamp);assert.ok(rows.every(r=>r.hours===null));
 }
});
test('Cashier preserves normal legacy pairing and supports an exact link to a legacy name-only start',()=>{
 const legacy={...older};delete legacy.staffId;
 const legacyOut={...oldClose};delete legacyOut.staffId;delete legacyOut.timeInLogId;
 const unlinked=attendanceRows([legacy,legacyOut],'2026-10-07','Maa',+at('10:00'));assert.equal(unlinked[0].hours,8);
 const linked=attendanceRows([legacy,newer,oldClose],'2026-10-07','Maa',+at('10:00'));assert.equal(linked.find(r=>r.status==='Completed').in,+legacy.timestamp);assert.equal(linked.find(r=>r.status==='On duty').in,+newer.timestamp);
});
test('Franchise quarantines overlapping linked shifts without invented hours, penalties or a negative payable net',()=>{
 const deductions=[{staffName:'Sample Staff',branch:'Maa',type:'Staff Meal',status:'Unpaid',amount:30,dateAdded:at('12:00')}];
 const logs=[older,newer,oldClose],original=structuredClone({logs,profiles,deductions});
 const [row]=estimate(logs,{deductions});assert.equal(row.attendanceHeld,true);assert.equal(row.attendanceReviewRequired,true);assert.match(row.attendanceReviewReasons.join(' '),/overlap/);
 assert.equal(row.hours,0);assert.equal(row.basic,0);assert.equal(row.late,0);assert.equal(row.gross,null);assert.equal(row.net,null);assert.equal(row.meals,30);
 assert.deepEqual({logs,profiles,deductions},original);
});
test('Franchise holds unknown linked sources and does not attach them to a newer active shift',()=>{
 const [row]=estimate([newer,{...oldClose,timeInLogId:'not-loaded'}]);assert.equal(row.attendanceHeld,true);assert.equal(row.hours,0);assert.equal(row.net,null);assert.match(row.attendanceReviewReasons.join(' '),/missing/);
});
test('Franchise preserves normal unlinked salary and safe explicit links after a staff rename',()=>{
 const start=punch('in','TIME IN','09:00'),end=punch('out','TIME OUT','17:00');
 const [legacy]=estimate([start,end]);assert.equal(legacy.hours,8);assert.equal(legacy.gross,500);assert.equal(legacy.net,500);assert.equal(legacy.attendanceHeld,undefined);
 const [linked]=estimate([{...start,staffName:'Previous Name'},{...end,staffName:'Previous Name',timeInLogId:'in'}]);assert.equal(linked.name,'Sample Staff');assert.equal(linked.hours,8);assert.equal(linked.gross,500);assert.equal(linked.attendanceHeld,undefined);
});
test('actual Franchise estimate retains both valid adjacent explicit shifts at a shared IN/OUT boundary',()=>{
 const logs=[punch('a','TIME IN','09:00'),punch('b','TIME IN','12:00'),punch('oa','TIME OUT','12:00',{timeInLogId:'a'}),punch('ob','TIME OUT','20:00',{timeInLogId:'b'})],original=structuredClone(logs);
 const [row]=estimate(logs);assert.equal(row.hours,11);assert.equal(row.shifts,2);assert.equal(row.gross,1000);assert.equal(row.net,1000);assert.equal(row.attendanceHeld,undefined);assert.deepEqual(row.logs.map(log=>log.hours),[3,8]);assert.deepEqual(logs,original);
});
test('the actual Franchise payroll view renders held gross/net as review text and shows the reason in details',async()=>{
 const source=readFileSync(new URL('../takodeal-franchise/franchise-workspace.js',import.meta.url),'utf8');
 const begin=source.indexOf(" define('payroll',"),end=source.indexOf(" define('schedule',",begin);assert.ok(begin>=0&&end>begin);
 let render,click,details,load;
 const ctx=vm.createContext({define:(_id,handler)=>{load=handler;},selectedRange:()=>({start:new Date('2026-10-07T00:00:00+08:00'),end:new Date('2026-10-08T00:00:00+08:00')}),
  read:async table=>table==='cashiers'?profiles:[older,newer,oldClose],staffRows:async()=>[],createScheduleHistoryStore:()=>({loadRange:async()=>({})}),
  api:{},session:()=>({branch:'Maa'}),calendarDay:()=> '2026-10-07',$:()=>({value:'2026-10-07'}),attendanceEstimate,money,esc,
  table:()=>({card:{append(){}},body:{addEventListener:(_event,handler)=>{click=handler;}}}),element:()=>({}),cell:value=>'<td>'+value+'</td>',number:value=>'<td>'+money(value)+'</td>',
  tools:(_card,_id,rows,renderer)=>{render=rows.map(renderer).join('');},showDetails:(...args)=>{details=args;},dateText:()=> 'Sample attendance time'});
 vm.runInContext(source.slice(begin,end),ctx);await load({});
 assert.match(render,/HR review required/);assert.doesNotMatch(render,/₱500\.00/);
 click({target:{closest:()=>({dataset:{payroll:'Sample Staff'}})}});
 assert.equal(details[1].find(row=>row[0]==='Net estimate')[1],'HR review required');assert.match(details[1].find(row=>row[0]==='Reason')[1],/overlap/);
});
