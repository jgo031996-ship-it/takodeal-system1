import './main_franchise.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import { createUnlockGate, bounded } from './unlock-gate.js';
import { MASTER_EMAIL, resolveHQAccount } from './hq-account-model.js';
import { ROUTES, branchScope } from './franchise-data.js';

const $=id=>document.getElementById(id);
let currentUser=null;
async function verify(user) {
 const email=String(user.email || '').toLowerCase().trim();
 if(!email || user.emailVerified===false)throw new Error('Sign in with a verified Google account.');
 await window.enableNetwork(window.db);
 const snap=await bounded(window.getDocsFromServer(window.query(window.collection(window.db,'hq_managers'),window.where('email','==',email))));
 const data=resolveHQAccount(snap.docs.map(d=>({id:d.id,data:d.data()})));
 if(!data || data.active===false || data.blocked===true || ['Revoked','Blocked','Inactive'].includes(data.status))throw new Error('Your account does not have active workspace access. Ask HQ to review HQ Access Control.');
 const allAssigned=(Array.isArray(data.assignedBranch)?data.assignedBranch:String(data.assignedBranch || '').split(',')).some(b=>String(b).trim().toLowerCase()==='all');
 let registered=[];
 if(email===MASTER_EMAIL || String(data.role).toLowerCase()!=='franchisee' && data.permissions?.includes('all') && allAssigned) {
  const branches=await bounded(window.getDocsFromServer(window.collection(window.db,'branches')));
  registered=branches.docs.filter(d=>d.data().active!==false && d.data().status!=='Inactive').map(d=>d.data().name || d.data().branchName).filter(Boolean);
 }
 const allowedBranches=branchScope(data,email,registered);
 if(!allowedBranches.length)throw new Error('No branch is assigned to your account. Ask HQ to set your assigned branch in HQ Access Control.');
 return {...data,allowedBranches};
}
const gate=createUnlockGate({verify,verifyOnUnlock:true,load:async({user,data})=>{
 const isFranchisee=String(data.role || '').toLowerCase()==='franchisee',permissions=Array.isArray(data.permissions)?data.permissions:isFranchisee?Object.keys(ROUTES):['dashboard'];
 const branch=data.allowedBranches.includes('Main Office') && user.email.toLowerCase()===MASTER_EMAIL?'Main Office':data.allowedBranches[0];
 window.sessionUser={email:user.email.toLowerCase(),branch,allowedBranches:data.allowedBranches,cashierName:data.fullName || data.name || user.displayName || 'Authorized account',role:data.role,isFranchisee,isOwner:user.email.toLowerCase()===MASTER_EMAIL,permissions};
 try {window.applyPermissions();await window.switchView('dashboard');}catch(error){window.sessionUser=null;throw error;}
},change:({phase,account,message})=>{
 const open=phase==='open';$('loginOverlay').hidden=open;
 $('loginStage1').hidden=!['signed-out'].includes(phase);$('loginStage2').hidden=!['pin','opening'].includes(phase);$('switchAccountBtn').hidden=phase==='signed-out';$('retryAccountBtn').hidden=phase!=='unavailable';
 $('loginStatus').textContent=phase==='checking'?'Checking your account with HQ…':phase==='unavailable'?message || 'Account verification is unavailable.':'';
 $('pinErrorMsg').hidden=!message || phase==='unavailable';$('pinErrorMsg').textContent=phase==='pin'?message || '':'';
 $('unlockBtn').disabled=phase==='opening';$('unlockBtn').textContent=phase==='opening'?'Opening workspace…':'Unlock workspace';
 $('googleLoginBtn').disabled=phase==='checking';
 if(account)$('authWelcomeName').textContent=(account.data.role || 'Authorized account')+': '+(account.data.fullName || account.data.name || account.user.displayName || account.user.email);
 if(!open && phase!=='opening')window.sessionUser=null;
 if(phase==='pin'){$('managerPinInput').value='';$('managerPinInput').focus();}
}});
onAuthStateChanged(window.auth,async user=>{currentUser=user;window.clearFranchiseReadRequests?.();window.sessionUser=null;await gate.identify(user);});
window.loginWithGoogle=async()=>{
 $('googleLoginBtn').disabled=true;$('loginStatus').textContent='Connecting to Google…';
 try{window.provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(window.auth,window.provider);}catch(error){$('loginStatus').textContent=error.code==='auth/popup-blocked'?'Allow the sign-in popup, then try again.':error.code==='auth/popup-closed-by-user'?'Sign-in was cancelled.':'Google sign-in could not connect. Check your connection and try again.';}finally{$('googleLoginBtn').disabled=false;}
};
window.checkManagerPin=()=>gate.unlock($('managerPinInput').value.trim());
window.cancelLoginAndSignOut=async()=>{gate.reset();window.clearFranchiseReadRequests?.();window.sessionUser=null;await signOut(window.auth);};
window.logoutManager=async()=>{const answer=await Swal.fire({title:'Sign out?',text:'Save any unfinished branch work before leaving.',showCancelButton:true,confirmButtonText:'Sign out'});if(!answer.isConfirmed)return;await window.cancelLoginAndSignOut();window.franchiseState.generation++;window.franchiseState.inventory.clear();window.franchiseState.loaded.clear();window.franchiseState.cart=[];window.franchiseState.schedule=null;for(const route of Object.keys(ROUTES))$('body-'+route).replaceChildren();};
$('googleLoginBtn').addEventListener('click',window.loginWithGoogle);$('unlockBtn').addEventListener('click',window.checkManagerPin);$('managerPinInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.checkManagerPin();}});$('switchAccountBtn').addEventListener('click',window.cancelLoginAndSignOut);$('retryAccountBtn').addEventListener('click',()=>gate.identify(currentUser));$('signOutBtn').addEventListener('click',window.logoutManager);
for(const key of document.querySelectorAll('[data-pin-key]'))key.addEventListener('click',()=>{const input=$('managerPinInput'),value=key.dataset.pinKey;input.value=value==='clear'?'':value==='back'?input.value.slice(0,-1):(input.value+value).slice(0,64);input.focus();});
