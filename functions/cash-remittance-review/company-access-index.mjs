import {accessDocumentId,accessText} from './access-model.mjs';
import {activeStaffProfile} from './relief-core/staff-lifecycle-model.js';
const email=value=>accessText(value).toLowerCase();
const profileNames=row=>[...new Set(['cashierName','name','fullName','scheduleNickname','scheduleName','nickname'].flatMap(key=>typeof row?.[key]==='string'?[row[key],row[key].trim()]:[]).concat(Array.isArray(row?.scheduleAliases)?row.scheduleAliases.flatMap(value=>typeof value==='string'?[value,value.trim()]:[]):[]).filter(value=>value&&value.length<=200&&!value.includes('/')&&!/[\u0000-\u001f\u007f]/.test(value)))];
export const HQ_SOURCE_ACCESS_FIELDS=Object.freeze(['email','role','permissions','assignedBranch','active','isActive','blocked','status','disabled','archived','isArchived','deleted','isDeleted','revoked','offboarded','resigned','terminated','employmentStatus','contractStatus']);
export const hqSourceAccess=row=>Object.fromEntries(HQ_SOURCE_ACCESS_FIELDS.map(key=>[key,row?.[key]??null]));
export function buildHQAccessIndex(rows=[]){
 const groups=new Map();for(const row of rows){const name=email(row?.data?.email);if(!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(name)||!accessDocumentId(row.id))continue;const group=groups.get(name)||[];group.push(row);groups.set(name,group);}
 return [...groups].map(([name,records])=>{
  if(records.length!==1)return{email:name,schemaVersion:1,active:false,ambiguous:true,permissions:[],allowedBranches:[]};
  const {id,data}=records[0],role=accessText(data.role),franchise=/^(franchisee|franchise owner)$/i.test(role),assignment=data.assignedBranch??(franchise?'':'All'),allowedBranches=[...new Set((Array.isArray(assignment)?assignment:String(assignment).split(',')).filter(value=>typeof value==='string').map(value=>value.trim()).filter(Boolean).map(value=>value.toLowerCase()==='all'?'All':value))],permissions=[...new Set((Array.isArray(data.permissions)?data.permissions:[]).filter(value=>typeof value==='string').map(value=>value.trim().toLowerCase()).filter(Boolean))];
  const active=activeStaffProfile(data)&&allowedBranches.length>0&&(!franchise||!allowedBranches.includes('All'))&&permissions.length>0;
  return{email:name,schemaVersion:1,sourceProfileId:id,sourceAccess:hqSourceAccess(data),active,ambiguous:false,role,permissions,allowedBranches};
 });
}
export function createCompanyAccessIndex(db,{serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted company access index is required.');
 return{
  async syncHQ(){
   return db.runTransaction(async tx=>{
    const profiles=await tx.get(db.collection('hq_managers').limit(201)),old=await tx.get(db.collection('hq_account_index').limit(201));
    if(profiles.size>200||old.size>200)throw Error('HQ access index needs a smaller reviewed scope.');
    const rows=buildHQAccessIndex(profiles.docs.map(snap=>({id:snap.id,data:snap.data()}))),current=new Set(rows.map(row=>row.email));
    for(const row of rows)tx.set(db.doc('hq_account_index/'+row.email),{...row,syncedAt:serverTimestamp()});
    for(const snap of old.docs)if(!current.has(snap.id))tx.set(db.doc('hq_account_index/'+snap.id),{email:snap.id,schemaVersion:1,active:false,ambiguous:false,permissions:[],allowedBranches:[],syncedAt:serverTimestamp()});
    return rows.map(({email,active,ambiguous,allowedBranches,permissions})=>({email,active,ambiguous,allowedBranches,permissions}));
   });
  },
  async syncNames(before,after){
   for(const name of [...new Set([...profileNames(before),...profileNames(after)])])await db.runTransaction(async tx=>{
    const ids=new Set();let overflow=false;
    for(const field of ['cashierName','name','fullName','scheduleNickname','scheduleName','nickname','scheduleAliases']){
     const query=db.collection('cashiers').where(field,field==='scheduleAliases'?'array-contains':'==',name).select('cashierName').limit(3),snap=await tx.get(query);if(snap.size>=3)overflow=true;for(const row of snap.docs)ids.add(row.id);
    }
    tx.set(db.doc('staff_name_claims/'+name),{schemaVersion:1,name,uniqueStaffId:!overflow&&ids.size===1?[...ids][0]:null,ambiguous:overflow||ids.size!==1,updatedAt:serverTimestamp()});
   });
  }
 };
}
