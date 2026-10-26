import {OWNER_EMAIL} from './workspace-access-model.js';
import {platformReportingDate} from './platform-payout-summary.js';
const confirmed=metadata=>metadata?.fromCache===false&&metadata?.hasPendingWrites===false;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function createPlatformComparisonReader(w,{timeoutMs=20000,now=Date.now,delay=setTimeout,cancelDelay=clearTimeout}={}){
 return async function readComparisonData({platform,branches,payoutBranch,from,to,assertCurrent=()=>{}}={}){
  const user=w.auth?.currentUser,session=w.sessionUser;
  const signature=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.auth?.currentUser?.emailVerified,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.isOwner,w.sessionUser?.isFranchisee,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
  const identity=signature();let expired=false,timer;
  const guard=()=>{if(expired)throw Error('Price and payout comparison took too long. Reconnect and retry.');assertCurrent();if(w.auth?.currentUser!==user||w.sessionUser!==session||signature()!==identity||!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!session?.isOwner||session.isFranchisee||session.uid&&session.uid!==user.uid||session.email?.toLowerCase()!==user.email.toLowerCase())throw Error('Unlock the verified Owner account before comparing platform sales.');};
  guard();
  if(!['Grab','Foodpanda'].includes(platform)||!Array.isArray(branches)||branches.length>30||new Set(branches).size!==branches.length||branches.some(b=>typeof b!=='string'||!b.trim()||b!==b.trim()||b.length>120)||typeof payoutBranch!=='string'||!payoutBranch.trim()||payoutBranch!==payoutBranch.trim()||payoutBranch.length>120||!platformReportingDate(from)||!platformReportingDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>366)throw Error('Choose valid reporting dates and up to 30 saved branches.');
  if(branches.some(branch=>typeof w.isBranchAllowed==='function'&&!w.isBranchAllowed(branch)))throw Error('A branch is outside your current access. Reopen Sales History.');
  if(payoutBranch!=='All'&&typeof w.isBranchAllowed==='function'&&!w.isBranchAllowed(payoutBranch))throw Error('The payout branch is outside your current access. Reopen Sales History.');
  const work=Promise.resolve().then(async()=>{
   guard();const at=now();if(!Number.isFinite(at))throw Error('The comparison refresh time could not be recorded.');
   if(['getDocsFromServer','getDocFromServer','doc','collection','query','where'].some(method=>typeof w[method]!=='function'))throw Error('The sales comparison is still loading. Reopen Sales History and try again.');
   const snapshot=async reference=>{guard();const value=await w.getDocsFromServer(reference);guard();if(!Array.isArray(value?.docs)||!confirmed(value.metadata)||value.docs.some(row=>!confirmed(row.metadata))||value.docs.length>20000)throw Error('Comparison records are cached, unconfirmed or too large. Reconnect and retry.');return value.docs.map(row=>({...row.data(),id:row.id}));};
   const revision=async()=>{guard();const row=await w.getDocFromServer(w.doc(w.db,'settings','recipe_revision'));guard();if(!row||!confirmed(row.metadata))throw Error('The recipe reference could not be confirmed. Retry the comparison.');if(!row.exists())return {version:0,revisionId:''};const data=row.data();if(!object(data)||!Number.isSafeInteger(data.version)||data.version<0||typeof data.revisionId!=='string')throw Error('The recipe reference needs review.');return {version:data.version,revisionId:data.revisionId};};
   const references=(async()=>{if(!branches.length)return {menu:[],recipes:[],inventory:[],revision:null};const before=await revision();guard();const inventory=w.query(w.collection(w.db,'inventory'),w.where('branch',branches.length===1?'==':'in',branches.length===1?branches[0]:branches));const [menu,recipes,stock]=await Promise.all([snapshot(w.collection(w.db,'menu')),snapshot(w.collection(w.db,'bom')),snapshot(inventory)]);guard();const after=await revision();guard();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Prices or recipes changed while loading. Retry for one consistent comparison.');return {menu,recipes,inventory:stock.filter(row=>branches.includes(row.branch)),revision:after};})();
   const payoutTable=platform==='Grab'?'grab_payouts':'foodpanda_payouts';
   const payouts=Promise.resolve().then(()=>{guard();return snapshot(w.query(w.collection(w.db,payoutTable),w.where('dateStr','>=',from),w.where('dateStr','<=',to)));});
   const [referenceResult,payoutResult]=await Promise.allSettled([references,payouts]);guard();
   return {...(referenceResult.status==='fulfilled'?referenceResult.value:{menu:[],recipes:[],inventory:[],revision:null,comparisonError:referenceResult.reason?.message||'Current prices and ingredient costs could not be confirmed.'}),...(payoutResult.status==='fulfilled'?{payoutRows:payoutResult.value.filter(row=>payoutBranch==='All'||row.branch===payoutBranch)}:{payoutRows:[],payoutError:payoutResult.reason?.message||'Recorded payouts could not be confirmed.'}),payoutScope:{allBranches:payoutBranch==='All',branches:payoutBranch==='All'?[]:[payoutBranch]},checkedAt:new Date(at).toISOString(),basis:'current-menu-estimate',platform,from,to};
  });
  return Promise.race([work,new Promise((_,reject)=>{timer=delay(()=>{expired=true;reject(Error('Price and payout comparison took too long. Reconnect and retry.'));},timeoutMs);})]).finally(()=>{expired=true;cancelDelay(timer);});
 };
}
