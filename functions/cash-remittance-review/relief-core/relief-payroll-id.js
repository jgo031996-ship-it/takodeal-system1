// Identical ordinary-payroll ID validation without importing payment actions.
export function ordinaryPayrollId(staffId,start,end){
 const id=v=>typeof v==='string'&&/^[-\w]{1,180}$/.test(v),date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(!id(staffId)||!date(start)||!date(end)||start>end)throw Error('Choose a valid payroll cutoff.');
 const value='payroll-'+staffId+'-'+start+'-'+end;if(!id(value))throw Error('Reopen payroll using the saved employee and account IDs.');return value;
}
