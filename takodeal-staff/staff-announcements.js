export function announcementImage(value,{signature=false}={}){
 if(typeof value!=='string')return '';if(signature&&value.length<=500000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
 if(value.length>8192)return '';try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
export async function readStaffAnnouncements(api,{staffId,staffName,branch,assertCurrent=()=>{},timeoutMs=20000,maxRows=1000}={}){
 if(!staffId||typeof staffName!=='string'||!staffName.trim()||typeof branch!=='string'||!branch.trim()||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000)throw Error('Sign in to your assigned branch before opening announcements.');
 let expired=false,timer;const guard=()=>{if(expired)throw Error('Announcements took too long. Reconnect and refresh.');assertCurrent();};
 const work=Promise.resolve().then(async()=>{guard();if(typeof api.readOperationalRecords==='function'){const snapshot=await api.readOperationalRecords('announcements',{assertCurrent:guard});guard();return checked(snapshot);}
  if(typeof api.getDocsFromServer!=='function'||typeof api.limit!=='function')throw Error('The scoped announcement reader is unavailable. Update the app and reconnect.');
  const base=api.collection(api.db,'announcements'),read=(...filters)=>api.getDocsFromServer(api.query(base,api.where('active','==',true),...filters,api.limit(maxRows+1)));
  const snapshots=await Promise.all([read(api.where('targetType','==','All')),read(api.where('targetType','==','Branch'),api.where('targetBranch','==',branch)),read(api.where('targetType','==','Individual'),api.where('targetStaff','==',staffName))]);guard();
  const merged=new Map();for(const snapshot of snapshots)for(const row of checked(snapshot).docs)merged.set(row.id,row);if(merged.size>maxRows)throw Error('Announcement history is incomplete. Ask HQ to review the notice list.');const docs=[...merged.values()];return{docs,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};
 });
 function checked(snapshot){if(!snapshot||!Array.isArray(snapshot.docs)||snapshot.docs.length>maxRows||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||snapshot.docs.some(row=>!row?.id||typeof row.data!=='function'||row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Announcements are incomplete or still syncing. Reconnect and refresh.');return snapshot;}
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Announcements took too long. Reconnect and refresh.'));},timeoutMs);})]);}finally{expired=true;clearTimeout(timer);}
}
