// Branch locator/receipt records are public; network credentials are not.
export async function readBranchNetworkSettings(api,id){
    const snapshot=await (api.getDocFromServer||api.getDoc)(api.doc(api.db,'branch_private_settings',id));
    const row=snapshot.exists()?snapshot.data():null;
    if(row&&typeof row.wifi!=='string')throw Error('The private branch settings need HQ review.');
    return {exists:!!row,wifi:row?.wifi??null};
}
export async function saveBranchNetworkSettings(api,{id,branch,expected,wifi,payload,assertCurrent=()=>{}}){
    if(typeof wifi!=='string'||wifi.length>256||!expected)throw Error('Reload the branch’s private network settings first.');
    const publicRef=api.doc(api.db,'branches',id),privateRef=api.doc(api.db,'branch_private_settings',id);
    return api.runTransaction(api.db,async transaction=>{
        assertCurrent();const [publicSnap,privateSnap]=await Promise.all([transaction.get(publicRef),transaction.get(privateRef)]);
        if(!publicSnap.exists()||publicSnap.data().name!==branch)throw Error('This branch changed. Reopen its settings.');
        const prior=privateSnap.exists()?privateSnap.data():null;
        if(!!prior!==expected.exists||(prior?.wifi??null)!==expected.wifi)throw Error('Another person changed the private network settings. Reopen this branch before saving.');
        assertCurrent();
        transaction.update(publicRef,{...payload,wifi:api.deleteField()});
        transaction.set(privateRef,{branchId:id,branch,wifi,updatedAt:api.serverTimestamp(),updatedByUid:api.auth.currentUser.uid});
    });
}
