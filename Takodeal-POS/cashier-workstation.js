// The verified Owner enrolls this browser's own branch-specific Cashier identity.
// Staff PINs subsequently go to the ordinary staff-login service as that device.
export async function enrollOwnerWorkstation(w,c,{stationAuth,signInAnonymously}){
    c.assertCurrent();
    const profiles=w.cashierWorkstation,prior=profiles.find(c.user.uid,c.branch);
    const id=prior?.id||'DEV-'+w.crypto.randomUUID().toUpperCase(),auth=stationAuth(id);
    await auth.authStateReady();
    const device=auth.currentUser||(!prior&&(await signInAnonymously(auth)).user);
    if(!device?.isAnonymous||!device.uid||prior&&prior.uid!==device.uid)throw Error('The saved workstation identity changed. Review this device in Device Fleet.');
    const guard=await c.prepareSale();
    const fleet=w.doc(c.db,'pos_devices',id),binding=w.doc(c.db,'pos_bindings',device.uid);
    await w.runTransaction(c.db,async tx=>{
        await guard.checkTransaction(tx);
        const [f,b]=await Promise.all([tx.get(fleet),tx.get(binding)]);c.assertCurrent();
        if(auth.currentUser!==device)throw Error('The workstation identity changed. Reopen Owner Access.');
        if(prior||f.exists()||b.exists()){
            if(!f.exists()||!b.exists()||f.data().status!=='Active'||b.data().status!=='Active'||f.data().deviceId!==id||b.data().deviceId!==id||
                f.data().ownerWorkstationUid!==device.uid||f.data().authorizedByUid!==c.user.uid||b.data().uid!==device.uid||b.data().legacyDeviceDocId!==id||
                f.data().branch!==c.branch||b.data().branch!==c.branch)throw Error('This workstation needs review in Device Fleet.');
            return;
        }
        const name='Owner workstation · '+c.branch;
        tx.set(fleet,{deviceId:id,deviceName:name,branch:c.branch,status:'Active',appType:'Cashier',ownerWorkstationUid:device.uid,authorizedByUid:c.user.uid,createdAt:w.serverTimestamp()});
        tx.set(binding,{uid:device.uid,deviceId:id,deviceName:name,branch:c.branch,legacyDeviceDocId:id,status:'Active',requestedAt:w.serverTimestamp(),approvedAt:w.serverTimestamp(),approvedBy:c.user.email});
    });
    c.assertCurrent();const saved={id,uid:device.uid,branch:c.branch,ownerUid:c.user.uid};profiles.remember(saved);return saved;
}
