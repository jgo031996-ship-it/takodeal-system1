import {operationalStaffProfile,activeAccessStaff} from '../../functions/cash-remittance-review/access-model.mjs';

const revisions=new WeakMap();
// Model the actual directory trigger when a fixture changes its private source.
// This does not alter API defaults: legacy PIN actions still use cashiers, and
// the Owner review adapter explicitly selects the credential-free directory.
export function putOperationalStaffFixture(harness,staffId,source){
 harness.put('cashiers/'+staffId,source);
 let projection;
 try{projection=operationalStaffProfile(staffId,source,{requireActive:false});}
 catch{projection={staffId,cashierName:'Account requires HQ review',branch:'',active:false};}
 if(!activeAccessStaff(source))projection.active=false;
 const revision=(revisions.get(harness)||0)+1;revisions.set(harness,revision);
 harness.put('staff_directory/'+staffId,{...projection,profileRevision:'SYNTHETIC-FIXTURE-'+revision});
}
