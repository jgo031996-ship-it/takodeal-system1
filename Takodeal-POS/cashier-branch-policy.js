export async function readCashierBranchPolicy(w,{readPolicy}={}){
 const owner=w.getCashierOwnerWorkspaceContext?.(),session=w.sessionUser,physical=w.localStorage.getItem('takodeal_device_branch'),branch=owner?.branch||session?.branch||physical;
 if(typeof branch!=='string'||!branch.trim()||!owner&&session?.branch&&physical!==session.branch)throw Error('The working branch changed. Reopen this screen.');
 const guard=()=>{if(owner){owner.assertCurrent();if(w.getCashierOwnerWorkspaceContext()?.session!==owner.session)throw Error('The Owner branch changed.');}else if(w.sessionUser!==session||w.localStorage.getItem('takodeal_device_branch')!==physical)throw Error('The working branch changed. Reopen this screen.');};guard();
 const api={...w,db:owner?.db||w.db,getDocs:w.getDocsFromServer};
 const policy=await readPolicy(api,branch);guard();
 return {api,branch,isMallBranch:policy.isMallBranch===true,policy,assertCurrent:guard};
}
