import {adminMemory} from './admin-memory.mjs';
// Standard SDK query behavior used only by the private review cursor tests.
// Ordinary prep writes still execute through the shared atomic test adapter.
export function prepReviewMemory(){
 const m=adminMemory(),collection=m.db.collection,transaction=m.db.runTransaction;
 const compare=(a,b)=>{const av=a.data.createdAt,bv=b.data.createdAt;return bv.seconds-av.seconds||bv.nanoseconds-av.nanoseconds||(a.id<b.id?1:a.id>b.id?-1:0);};
 m.db.collection=table=>({...collection(table),orderBy(field,direction){if(field!=='createdAt'||direction!=='desc')throw Error('Unexpected test query order.');return {...this,ordered:true};},startAfter(snapshot){return {...this,cursor:snapshot};}});
 m.db.runTransaction=work=>transaction(tx=>{const get=tx.get;return work({...tx,async get(ref){
  if(!ref.ordered)return get(ref);m.queries.push(ref);
  let entries=[...m.rows].filter(([path,row])=>path.startsWith(ref.table+'/')&&path.split('/').length===2&&row.data.createdAt).map(([path,row])=>({path,id:path.split('/')[1],...row})).sort(compare);
  if(ref.cursor){const at=entries.findIndex(row=>row.id===ref.cursor.id);if(at<0)throw Error('Missing test cursor.');entries=entries.slice(at+1);}
  const docs=entries.slice(0,ref.count).map(row=>({id:row.id,exists:true,data:()=>structuredClone(row.data),createTime:row.createTime,updateTime:row.updateTime}));return {size:docs.length,docs};
 }});});return m;
}
