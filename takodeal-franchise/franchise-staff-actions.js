import {saveStaffProfileAtomic,staffProfileOperation} from './staff-rate-changes.js';
import {canVisit} from './franchise-data.js';
export async function addFranchiseStaff(api,{id,name,pin,role,dailyRate,phone='',dateHired=''}){
 const user=api.auth?.currentUser,session=api.sessionUser,scope=()=>JSON.stringify([api.auth?.currentUser?.uid,api.sessionUser?.email,api.sessionUser?.branch,api.sessionUser?.permissions]),identity=scope();
 if(!user?.uid||!canVisit(session,'staff')||!session.branch||session.branch==='Main Office')throw Error('Choose your assigned franchise branch with payroll access.');
 if(typeof name!=='string'||!name.trim()||name.length>100||!/^\d{4,12}$/.test(pin)||!['Crew','Store Manager'].includes(role)||dailyRate===''||typeof dailyRate==='boolean'||!Number.isFinite(Number(dailyRate))||Number(dailyRate)<=0)throw Error('Enter a name, unique 4–12 digit PIN, role and positive daily rate.');
 if(dateHired&&!/^\d{4}-\d{2}-\d{2}$/.test(dateHired))throw Error('Choose a valid hire date.');
 const duplicates=await Promise.all([['pin',pin],['pin',Number(pin)],['cashierName',name.trim()]].map(([key,value])=>api.getDocsFromServer(api.query(api.collection(api.db,'cashiers'),api.where(key,'==',value)))));
 if(duplicates.some(snap=>snap.docs.some(row=>row.id!==id)))throw Error('That name or PIN is already in use. Choose a unique one before saving.');
 const payload={cashierName:name.trim(),pin,branch:session.branch,role,hourlyRate:Number(dailyRate),phone:phone.trim(),dateHired,status:'Active'},operationId=staffProfileOperation(api,payload,id);
 const guarded=Object.create(api);guarded.runTransaction=(db,fn)=>api.runTransaction(db,async tx=>{if(scope()!==identity)throw Error('Your account or branch changed. Reopen Add branch staff.');const result=await fn(tx);if(scope()!==identity)throw Error('Your account or branch changed before saving.');return result;});
 return saveStaffProfileAtomic(guarded,id,payload,{operationId,expectedExists:false});
}
