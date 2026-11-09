import {readStaffAnnouncements} from './staff-announcements.js';
export function createCashierOwnOperations(w){
 async function capture({expectedSession,assertCurrent=()=>{}}={}){
  const session=w.sessionUser,branch=w.localStorage.getItem('takodeal_device_branch'),device=w.localStorage.getItem('takodeal_device_id');
  const guard=()=>{assertCurrent();if(!session?.staffId||!session.cashierName||w.sessionUser!==session||expectedSession&&session!==expectedSession||w.localStorage.getItem('takodeal_device_branch')!==branch||w.localStorage.getItem('takodeal_device_id')!==device||session.branch!==branch)throw Error('The cashier or branch changed. Reopen this view after signing in.');};
  guard();const api=await w.resolveCashierOperationalApi({assertCurrent:guard});guard();
  await api.readStaffSessionProfile({staffId:session.staffId,branch,name:session.cashierName,assertCurrent:guard});guard();
  return{api,session,branch,assertCurrent:guard};
 }
 async function announcements(scope){scope=scope||await capture();const {api,session,branch,assertCurrent}=scope;const reader={...api,readOperationalRecords:async(table,options)=>{const value=await api.readOperationalRecords(table,options);if(!Array.isArray(value))return value;const docs=value.map(({id,...row})=>({id,data:()=>row,metadata:{fromCache:false,hasPendingWrites:false}}));return{docs,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};}};const snapshot=await readStaffAnnouncements(reader,{staffId:session.staffId,staffName:session.cashierName,branch,assertCurrent});assertCurrent();return snapshot;}
 async function read(table,scope){scope=scope||await capture();const records=await scope.api.readOperationalRecords(table,{assertCurrent:scope.assertCurrent});scope.assertCurrent();return Array.isArray(records)?records:records.docs.map(row=>({id:row.id,...row.data()}));}
 async function acknowledge({announcementId,signature,expectedSession,assertCurrent}={}){
  if(typeof announcementId!=='string'||!announcementId||announcementId.includes('/')||typeof signature!=='string'||signature.length>352*1024||!/^data:image\/(?:png|svg\+xml);/.test(signature))throw Error('Reopen this announcement and confirm its signature.');
  const scope=await capture({expectedSession,assertCurrent}),snapshot=await announcements(scope);scope.assertCurrent();if(!snapshot.docs.some(row=>row.id===announcementId))throw Error('This announcement changed or is no longer shared with your account.');
  const {api,session}=scope;await api.addDoc(api.collection(api.db,'acknowledgments'),{announcementId,staffId:session.staffId,staffName:session.cashierName,signature,timestamp:api.serverTimestamp()});scope.assertCurrent();return true;
 }
 return{capture,read,announcements,acknowledge};
}
