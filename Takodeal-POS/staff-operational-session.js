import {operationalStaffProfile} from './cashier-staff-access.js';
const milliseconds=value=>value?.toMillis?.()??(value instanceof Date?+value:typeof value==='string'?Date.parse(value):NaN);
export async function readOperationalStaffSession(api,{staffId,branch,name,transaction,assertCurrent=()=>{},now=Date.now}={}){
 const user=api.auth?.currentUser,uid=user?.uid,actor=api.staffPinActor?.(),sessionId=actor?.sessionId||api.sessionUser?.staffLoginSessionId;
 const guard=()=>{assertCurrent();api.assertStaffOperationalCurrent?.();api.assertStockAuditCurrent?.();if(!uid||api.auth?.currentUser!==user||api.auth.currentUser.uid!==uid)throw Error('The secure staff session changed. Sign in again.');};guard();
 if(typeof staffId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(staffId)||typeof branch!=='string'||!branch)throw Error('Sign in to the current staff account before continuing.');
 const read=reference=>transaction?transaction.get(reference):api.getDocFromServer(reference);
 const [sessionSnap,profileSnap]=await Promise.all([read(api.doc(api.db,'staff_login_sessions',uid)),read(api.doc(api.db,'staff_directory',staffId))]);guard();
 if(!transaction&&[sessionSnap,profileSnap].some(row=>row?.metadata?.fromCache!==false||row.metadata.hasPendingWrites!==false))throw Error('Reconnect to confirm your current staff login.');
 const session=sessionSnap.exists()?sessionSnap.data():null,record=profileSnap.exists()?profileSnap.data():null;
 if(!session||!record||typeof sessionId!=='string'||!sessionId||session.sessionId!==sessionId||session.schemaVersion!==1||session.uid!==uid||session.staffId!==staffId||session.branch!==branch||session.app!=='cashier'||!/^DEV-[A-Z0-9-]{6,80}$/.test(session.deviceId||'')||actor&&session.deviceId!==actor.deviceId||!Number.isFinite(milliseconds(session.expiresAt))||milliseconds(session.expiresAt)<=now()||typeof session.profileRevision!=='string'||!session.profileRevision||session.profileRevision!==record.profileRevision)throw Error('Your staff login expired or changed. Sign in again before continuing.');
 const {schemaVersion,profileRevision,syncedAt,updatedAt,...profile}=record,result=operationalStaffProfile(profile,staffId);if(name!==undefined&&result.cashierName!==name)throw Error('The staff name changed. Sign in again before continuing.');guard();return result;
}
