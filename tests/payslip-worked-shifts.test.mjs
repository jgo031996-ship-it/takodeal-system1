import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openPayslipWorkedShifts} from '../takodeal-manager/payslip-worked-shifts.js';
import {rememberPayslipInputs} from '../takodeal-manager/payroll-adjustment-refresh.js';
import {ReviewDocument,ReviewElement,drain} from './helpers/review-dom.mjs';

Object.defineProperty(ReviewElement.prototype,'style',{configurable:true,get(){return this._style||={};}});
ReviewElement.prototype.remove=function(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(el=>el!==this);};
function fixture(){
 const d=new ReviewDocument(),user={uid:'fictional-owner',email:'jgo031996@gmail.com',emailVerified:true};
 const log=day=>({attendanceLogId:'in-'+day,branch:'Fictional Cover',timeInAt:'2026-11-'+day+'T15:41:00+08:00',timeOutAt:'2026-11-'+String(+day+1).padStart(2,'0')+'T00:31:00+08:00',out:'12:31 AM',bonusReviewRequired:true});
 const data={name:'Fictional Crew',staffId:'fictional-id',start:'2026-11-01',end:'2026-11-15',logs:[log('02'),log('15')]},fresh={...data,logs:[]};
 const calls={inspect:[],refresh:0,invalidations:0,reopens:0},guard={invalidate(){calls.invalidations++;w.currentPayslipData=null;w.globalPayrollCache={};},requireReady(){if(!Object.keys(w.globalPayrollCache).length)throw Error('Offline');}};
 const w={auth:{currentUser:user},sessionUser:{...user,role:'Owner',isOwner:true,permissions:['all'],allowedBranches:['All']},globalPayrollCache:{crew:data},currentPayslipData:data,
  requirePayrollPreview(v){assert.equal(w.currentPayslipData,v);},getPayrollPreviewGuard:()=>guard,
  generateAutoPayslips:async()=>{calls.refresh++;w.globalPayrollCache={crew:fresh};},
  openPayslipModal:async()=>{calls.reopens++;w.currentPayslipData=fresh;input.value='server amount';}};
 const field=(id,value)=>{const el=d.createElement('input');el.setAttribute('id',id);el.value=value;d.body.append(el);return el;};
 field('payrollStart',data.start);field('payrollEnd',data.end);
 const input=field('otherManualBonus','0');d.querySelectorAll=selector=>selector==='#printablePayslip input'?[input]:d.body.querySelectorAll(selector);
 rememberPayslipInputs(data,d);input.value='18';
 let current;
 const chooser={open:async(context,options)=>{options.assertCurrent();calls.inspect.push(context);const child=d.createElement('dialog');d.body.append(child);child.showModal();current={child,options};return child;}};
 const open=()=>openPayslipWorkedShifts(w,d,data,data.logs[0],chooser);
 const save=async()=>{current.options.assertCurrent();current.child.close();await current.options.onApplied({workDate:data.start});};
 return {d,w,data,calls,open,save,chooser,input,cancel:()=>current.child.close()};
}
test('two exact dates save independently and one final refresh reopens the current employee with their edits',async()=>{
 const f=fixture(),node=f.open();await drain();assert.equal(f.open(),node);
 const rows=node.querySelector('[data-dates]').querySelectorAll('button'),finish=node.querySelector('[data-finish]');
 assert.equal(rows.length,2);assert.equal(f.calls.inspect[0].attendanceLogId,'in-02');
 await f.save();assert.equal(rows[0].textContent,'Saved');assert.equal(f.calls.refresh,0);assert.equal(f.w.currentPayslipData,null);
 rows[1].click();rows[1].click();await drain();assert.deepEqual(f.calls.inspect.map(row=>row.attendanceLogId),['in-02','in-15']);
 assert.equal(f.calls.inspect[1].branch,'Fictional Cover');await f.save();
 assert.equal(f.calls.invalidations,2);assert.equal(f.calls.refresh,0);finish.click();finish.click();await drain();
 assert.equal(f.calls.refresh,1);assert.equal(f.calls.reopens,1);assert.equal(node.open,false);assert.equal(f.input.value,'18');
});
test('cancelling a date keeps earlier confirmed dates, and a failed final refresh can retry without another save',async()=>{
 const f=fixture(),node=f.open();await drain();await f.save();const rows=node.querySelector('[data-dates]').querySelectorAll('button');
 rows[1].click();await drain();f.cancel();assert.equal(rows[1].disabled,false);
 const generate=f.w.generateAutoPayslips;f.w.generateAutoPayslips=async()=>{throw Error('HQ offline');};
 node.querySelector('[data-finish]').click();await drain();assert.equal(node.open,true);assert.equal(node.querySelector('[data-exit]').hidden,false);
 assert.match(node.querySelector('[data-status]').textContent,/1 shift.*saved.*offline/i);assert.equal(f.calls.reopens,0);
 f.w.generateAutoPayslips=generate;node.querySelector('[data-finish]').click();await drain();
 assert.equal(f.calls.reopens,1);assert.equal(f.calls.inspect.length,2);assert.equal(f.calls.invalidations,1);
});
test('cancelling before a save leaves the preview current and never recalculates',async()=>{
 const f=fixture(),node=f.open();await drain();f.cancel();node.querySelector('[data-finish]').click();
 assert.equal(node.open,false);assert.equal(f.calls.refresh,0);assert.equal(f.calls.invalidations,0);assert.equal(f.w.currentPayslipData,f.data);
});
test('an account or cutoff change cannot reopen another employee or reuse a saved batch',async()=>{
 for(const change of [f=>{f.w.sessionUser={...f.w.sessionUser};},f=>{f.d.getElementById('payrollEnd').value='2026-11-30';}]){
  const f=fixture(),node=f.open();await drain();await f.save();change(f);node.querySelector('[data-finish]').click();await drain();
  assert.equal(f.calls.refresh,0);assert.equal(f.calls.reopens,0);node.querySelector('[data-exit]').click();assert.equal(node.open,false);
 }
});
test('the payslip entry point opens the batch only for multiple eligible punch IDs',()=>{
 const f=fixture();f.data.logs=[f.data.logs[0],{...f.data.logs[0]}, {...f.data.logs[1],workedShiftCorrectionId:'already-applied'}];assert.equal(f.open(),null);
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
 assert.match(main,/const batch=openPayslipWorkedShifts\(window,document,data,log,chooser\);if\(batch\)return batch/);
});
