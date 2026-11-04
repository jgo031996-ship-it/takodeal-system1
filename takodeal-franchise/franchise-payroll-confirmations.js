import {loadPayrollShiftConfirmations} from './payroll-confirmed-shifts.js';

// Only the currently selected branch's previously loaded staff and attendance
// may supply exact document IDs. Never broaden the reader into a head LIST.
export async function loadFranchisePayrollShiftConfirmations(api,{schedule,profiles,logs,payrollRecords=[],branch,start,end,assertCurrent=()=>{}}){
 assertCurrent();if(typeof branch!=='string'||!branch.trim())throw Error('Select the assigned branch before loading payroll.');
 const staff=profiles.filter(person=>person.branch===branch&&typeof person.id==='string'&&person.id),ids=new Set(staff.map(person=>person.id));
 const names=new Set(staff.map(person=>String(person.cashierName||'').trim().toLowerCase()));
 const selected=logs.filter(row=>row.branch===branch&&(row.staffId?ids.has(row.staffId):names.has(String(row.staffName||'').trim().toLowerCase())));
 const input={scheduleData:schedule,staffSnap:{docs:staff.map(person=>({id:person.id,data:()=>person}))},attSnap:{docs:selected.map(row=>({id:row.id,data:()=>row}))},prSnap:{docs:payrollRecords.map(row=>({id:row.id,data:()=>row}))}};
 const result=await loadPayrollShiftConfirmations(api,input,{from:start,to:end,assertCurrent});assertCurrent();return result;
}
