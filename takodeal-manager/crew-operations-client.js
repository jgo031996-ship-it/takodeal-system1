const endpoint='https://asia-southeast1-takodeal-pos.cloudfunctions.net/branchCrewOperations';
export async function crewRequest(user,route,body,guard=()=>{}){
 guard();
 if(!user?.uid)throw Error('Sign in again to check this branch.');
 const token=await user.getIdToken();guard();
 let response;
 try{response=await fetch(endpoint+'/'+route,{method:'POST',cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});}
 catch{throw Error('Connection interrupted. Reopen the same entry and retry to check its saved result.');}
 guard();const data=await response.json().catch(()=>null);guard();
 if(!response.ok||!data)throw Error(data?.error||'The branch service could not confirm this action.');
 return data;
}
export function operationFor(storage,key,details){
 const intent=JSON.stringify(details),name='takodeal-crew-op:'+key;
 const prior=JSON.parse(storage.getItem(name)||'null');
 if(prior?.intent===intent)return {id:prior.id,done:()=>{if(storage.getItem(name)===JSON.stringify(prior))storage.removeItem(name);}};
 const record={id:crypto.randomUUID(),intent};storage.setItem(name,JSON.stringify(record));
 return {id:record.id,done:()=>{if(storage.getItem(name)===JSON.stringify(record))storage.removeItem(name);}};
}
export function centsOf(value){const amount=String(value??'').trim();if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0||Number(amount)>1000000)throw Error('Enter a positive peso amount with up to two decimal places.');return Math.round(Number(amount)*100);}
export const pesos=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(n);
export const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
