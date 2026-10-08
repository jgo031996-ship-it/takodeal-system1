// Cross-app attendance identity and explicit shift closure. Existing punches are never rewritten.
const nameKey=value=>String(value||'').trim().toLocaleLowerCase();
export function attendanceMillis(value) {
    if(value==null)return NaN;
    try{
        const result=value?.toMillis?.() ?? value?.toDate?.()?.getTime?.() ?? (Number.isFinite(value?.seconds)?value.seconds*1000+Math.floor((value.nanoseconds||0)/1000000):new Date(value).getTime());
        return Number.isFinite(result)?result:NaN;
    }catch{return NaN;}
}
export function attendanceKind(row) {
    const type=String(row?.type||'').trim().toUpperCase();
    if(type==='TIME IN')return 'TIME IN';
    if(['TIME OUT','TIME OUT (AUTO)','AUTO TIME OUT (PENALTY)'].includes(type))return 'TIME OUT';
    if(row?.isManual===true && /^TIME (IN|OUT) \(MANUAL EDIT:[^)]{1,120}\)$/.test(type))return type.startsWith('TIME IN ')?'TIME IN':'TIME OUT';
    return '';
}
export function belongsToAttendance(row,staffId,names) {
    if(row?.staffId)return row.staffId===staffId;
    return names.some(name=>nameKey(name)===nameKey(row?.staffName));
}
export async function readStaffRecords(api,staffId,name,{fresh=true,table='attendance_logs',names=[]}={}) {
    if(typeof staffId!=='string'||!staffId||staffId.includes('/'))throw Error('Sign in to your staff account again.');
    const aliases=[...new Set([name,...names].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
    if(!aliases.length)throw Error('Choose your staff account again.');
    const read=fresh?api.getDocsFromServer:api.getDocs;
    if(typeof read!=='function')throw Error('Connect to HQ to verify the latest attendance from both apps.');
    const base=api.collection(api.db,table);
    const queries=[api.query(base,api.where('staffId','==',staffId)),...aliases.map(alias=>api.query(base,api.where('staffName','==',alias)))];
    let snapshots;
    try{snapshots=await Promise.all(queries.map(q=>read(q)));}
    catch(error){throw Error('The latest attendance could not be confirmed with HQ. Reconnect and try again; no punch was created.',{cause:error});}
    const merged=new Map();
    for(const snap of snapshots){
        const documents=Array.isArray(snap.docs)?snap.docs:[];
        if(!Array.isArray(snap.docs))snap.forEach?.(entry=>documents.push(entry));
        for(const entry of documents){const row={...entry.data(),id:entry.id};if(belongsToAttendance(row,staffId,aliases))merged.set(entry.id,row);}
    }
    const rows=[...merged.values()];
    // A name-only legacy row is safe only when the directory identifies one person.
    const legacyNames=[...new Set(rows.filter(row=>!row.staffId).map(row=>row.staffName))];
    for(const legacyName of legacyNames){
        const directory=await read(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',legacyName)));
        const people=Array.isArray(directory.docs)?directory.docs:[];
        if(!Array.isArray(directory.docs))directory.forEach?.(entry=>people.push(entry));
        if(people.length!==1 || people[0].id!==staffId)throw Error('A legacy name-only record cannot be matched to one employee. Ask HQ to confirm the staff identity before continuing.');
    }
    return rows;
}
export function latestAttendance(records,staffId,name,now=Date.now()) {
    const rows=records.filter(row=>belongsToAttendance(row,staffId,[name]) && attendanceKind(row) && !row.deleted && !['Voided','Cancelled'].includes(row.status));
    if(rows.some(row=>!Number.isFinite(attendanceMillis(row.timestamp))))throw Error('An attendance timestamp is still missing. Refresh after the other app has synced, or ask HQ to review the record.');
    if(rows.some(row=>attendanceMillis(row.timestamp)>now+60000))throw Error('An attendance time is ahead of this device clock. Check the device date and ask HQ to review it.');
    rows.sort((a,b)=>attendanceMillis(b.timestamp)-attendanceMillis(a.timestamp) || (attendanceKind(a)===attendanceKind(b)?0:attendanceKind(a)==='TIME OUT'?-1:1));
    const latestStart=rows.find(row=>attendanceKind(row)==='TIME IN');
    if(!latestStart)return rows[0]||null;
    // A late closure of an older shift must not close a newer active shift.
    // Use the same explicit/legacy pairing as the visible attendance history.
    const shifts=linkedAttendanceHistory(rows,staffId,name,new Date(now));
    const latestShift=shifts.find(shift=>shift.in && (latestStart.id ? shift.in.id===latestStart.id : attendanceMillis(shift.in.timestamp)===attendanceMillis(latestStart.timestamp) && shift.in.branch===latestStart.branch));
    if(!latestShift?.out)return latestStart;
    return rows.find(row=>row.id && row.id===latestShift.out.id)||latestShift.out;
}
export function linkedAttendanceHistory(records,staffId,name,now=new Date()) {
    const logs=records.filter(row=>belongsToAttendance(row,staffId,[name]) && attendanceKind(row) && !row.deleted && !['Voided','Cancelled'].includes(row.status))
        .map(row=>({...row,date:Number.isFinite(attendanceMillis(row.timestamp))?new Date(attendanceMillis(row.timestamp)):null}));
    const valid=logs.filter(row=>row.date).sort((a,b)=>a.date-b.date || (attendanceKind(a)===attendanceKind(b)?0:attendanceKind(a)==='TIME IN'?-1:1));
    const starts=new Map(valid.filter(row=>attendanceKind(row)==='TIME IN' && row.id).map(row=>[row.id,row]));
    const linked=new Map();
    for(const row of valid){
        const start=starts.get(row.timeInLogId),hours=start?(row.date-start.date)/3600000:NaN;
        if(attendanceKind(row)==='TIME OUT' && start && row.branch===start.branch && hours>=0 && hours<=24 && !linked.has(start.id))linked.set(start.id,row);
    }
    const shifts=[];let active=null;
    for(const row of valid){
        if(attendanceKind(row)==='TIME IN'){
            if(active)shifts.push({in:active,out:null,status:'Missing time out'});
            const end=linked.get(row.id);
            if(end){shifts.push({in:row,out:end,hours:(end.date-row.date)/3600000,status:'Complete'});active=null;}
            else active=row;
        }else if(row.timeInLogId){
            if(linked.get(row.timeInLogId)!==row)shifts.push({in:null,out:row,status:'Missing time in'});
        }else if(active){
            const hours=(row.date-active.date)/3600000;
            if(hours>=0 && hours<=24 && (!row.branch||!active.branch||row.branch===active.branch))shifts.push({in:active,out:row,hours,status:'Complete'});
            else{shifts.push({in:active,out:null,status:'Missing time out'});shifts.push({in:null,out:row,status:'Missing time in'});}
            active=null;
        }else shifts.push({in:null,out:row,status:'Missing time in'});
    }
    if(active)shifts.push({in:active,out:null,status:+now-active.date>24*3600000?'Missing time out':'On duty'});
    for(const row of logs.filter(row=>!row.date))shifts.push({in:attendanceKind(row)==='TIME IN'?row:null,out:attendanceKind(row)==='TIME OUT'?row:null,status:'Review timestamp'});
    return shifts.sort((a,b)=>((b.in||b.out).date?.getTime()??Infinity)-((a.in||a.out).date?.getTime()??Infinity));
}
export function sopCoversShift(records,start,staffId,name,now=Date.now()) {
    const begin=attendanceMillis(start?.timestamp);if(!Number.isFinite(begin))return false;
    const phMidnight=Math.floor((begin+8*3600000)/86400000)*86400000-8*3600000;
    return records.some(row=>belongsToAttendance(row,staffId,[name,start.staffName]) && (!row.timeInLogId||row.timeInLogId===start.id) && (!row.branch||row.branch===start.branch) && attendanceMillis(row.timestamp)>=phMidnight && attendanceMillis(row.timestamp)<=now);
}
export async function linkedTimeOutId(staffId,timeInId,cryptoApi=globalThis.crypto) {
    if(!staffId||!timeInId||[staffId,timeInId].some(value=>typeof value!=='string'||value.includes('/')))throw Error('The active Time In record is unavailable. Refresh attendance before Time Out.');
    const hash=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([staffId,timeInId])));
    return 'time-out-'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function closeAttendanceShift(api,{start,attendance,assertCurrent=()=>{},records=[]}) {
    if(!start?.id || attendanceKind(start)!=='TIME IN' || !Number.isFinite(attendanceMillis(start.timestamp)) || !belongsToAttendance(start,attendance.staffId,[attendance.staffName]))throw Error('There is no verified active Time In to close. Refresh attendance.');
    if(attendance.type!=='TIME OUT' || attendance.branch!==start.branch)throw Error(`Time Out must close your active shift at ${start.branch||'the recorded branch'}.`);
    const id=await linkedTimeOutId(attendance.staffId,start.id);assertCurrent();
    const source=api.doc(api.db,'attendance_logs',start.id),target=api.doc(api.db,'attendance_logs',id);
    return api.runTransaction(api.db,async tx=>{
        const original=await tx.get(source),existing=await tx.get(target);assertCurrent();
        if(!original.exists())throw Error('The active Time In was removed by HQ. Refresh attendance before continuing.');
        const live=original.data();
        if(attendanceKind(live)!=='TIME IN' || !belongsToAttendance(live,attendance.staffId,[start.staffName]) || live.branch!==start.branch || attendanceMillis(live.timestamp)!==attendanceMillis(start.timestamp) || live.deleted || ['Voided','Cancelled'].includes(live.status))throw Error('The active Time In changed. Refresh attendance before continuing.');
        if(existing.exists()){
            const prior=existing.data();
            if(prior.type!=='TIME OUT'||prior.staffId!==attendance.staffId||prior.timeInLogId!==start.id||prior.branch!==start.branch)throw Error('This shift closure needs an HQ review.');
            return {alreadySaved:true,id,record:prior};
        }
        const next={...attendance,staffName:start.staffName||attendance.staffName,timeInLogId:start.id,timeInAt:new Date(attendanceMillis(start.timestamp)).toISOString(),attendanceVersion:2};
        assertCurrent();
        for(const row of records)tx.set(row.ref,row.data);
        tx.set(target,next);return {saved:true,id};
    });
}
