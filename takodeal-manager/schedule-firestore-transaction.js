// The browser SDK only accepts document references in Transaction.get(). A
// Firestore REST transaction supports a staff_requests query in the same commit.
const valueOf=v=>{
  if('nullValue'in v)return null;
  if('stringValue'in v)return v.stringValue;
  if('booleanValue'in v)return v.booleanValue;
  if('integerValue'in v||'doubleValue'in v)return Number(v.integerValue??v.doubleValue);
  if('timestampValue'in v)return v.timestampValue;
  if('arrayValue'in v)return (v.arrayValue.values||[]).map(valueOf);
  if('mapValue'in v)return objectOf(v.mapValue.fields);
  throw Error('An unsupported stored schedule value needs review.');
};
const objectOf=fields=>Object.fromEntries(Object.entries(fields||{}).map(([key,v])=>[key,valueOf(v)]));
const fieldsOf=obj=>Object.fromEntries(Object.entries(obj).map(([key,value])=>[key,encode(value)]));
function encode(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='string')return {stringValue:value};
  if(Number.isSafeInteger(value))return {integerValue:String(value)};
  if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
  if(value instanceof Date)return {timestampValue:value.toISOString()};
  if(value&&typeof value==='object')return {mapValue:{fields:fieldsOf(value)}};
  throw Error('The edited schedule contains an unsupported value.');
}

export async function runScheduleFirestoreTransaction(api,callback){
  const user=api.auth?.currentUser,session=api.sessionUser,project=api.db?.app?.options?.projectId;
  if(!project||!user?.uid||user.uid!==session?.uid)throw Error('Sign in again before saving the schedule.');
  const root='projects/'+encodeURIComponent(project)+'/databases/(default)/documents';
  const base='https://firestore.googleapis.com/v1/'+root;
  const guard=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session)throw Error('The signed-in scheduling account changed. Reopen the month.');};
  for(let attempt=0;attempt<3;attempt++){
    const token=await user.getIdToken();guard();
    async function request(method,body){
      guard();
      const response=await fetch(base+':'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(18000)});
      const data=await response.json();
      if(!response.ok){const error=Error(data.error?.status==='ABORTED'?'The saved schedule changed in another session.':
        response.status===403?'Your schedule access could not be confirmed.':'HQ could not confirm the schedule transaction ('+response.status+').');
        error.code=data.error?.status;throw error;}
      return data;
    }
    const {transaction}=await request('beginTransaction',{options:{readWrite:{}}});
    const writes=[];
    try{
      const tx={
        async get(ref){
          const name=root+'/'+ref.path,rows=await request('batchGet',{documents:[name],transaction});
          const row=rows.find(item=>item.found?.name===name||item.missing===name);
          if(!row)throw Error('A schedule record could not be confirmed.');
          return {exists:()=>!!row.found,data:()=>objectOf(row.found?.fields)};
        },
        set(ref,data){writes.push({update:{name:root+'/'+ref.path,fields:fieldsOf(data)}});},
        update(ref,data){writes.push({update:{name:root+'/'+ref.path,fields:fieldsOf(data)},updateMask:{fieldPaths:Object.keys(data)},currentDocument:{exists:true}});},
        async readApprovedLeaves(){
          const filters=[['type','Leave'],['status','Approved']].map(([field,value])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}}));
          const rows=await request('runQuery',{transaction,structuredQuery:{from:[{collectionId:'staff_requests'}],
            where:{compositeFilter:{op:'AND',filters}},select:{fields:['type','status','staffId','staffName','name','activeLeaveDates','startDate','endDate'].map(fieldPath=>({fieldPath}))}}});
          return rows.filter(row=>row.document).map(row=>objectOf(row.document.fields));
        }
      };
      const result=await callback(tx);guard();
      await request('commit',{writes,transaction});return result;
    }catch(error){
      try{await request('rollback',{transaction});}catch{}
      if(error.code!=='ABORTED'||attempt===2)throw error;
    }
  }
}
