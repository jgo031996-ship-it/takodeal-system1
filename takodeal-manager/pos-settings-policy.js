// The global POS tool matrix lives in the existing Owner-only policy collection.
const defaults={version:1,staff:{parkedOrders:true,printerTools:true,manualDrawer:false},manager:{audit:true,kds:true,autoDrawer:true,manualDrawer:true}};
const labels={parkedOrders:'Parked orders',printerTools:'Printer and receipt tools',manualDrawer:'Open cash drawer manually',audit:'Pause / resume inventory audit',kds:'Kitchen tracking',autoDrawer:'Automatic drawer preference'};
const parse=value=>{
    if(value==null)return structuredClone(defaults);
    if(value.version!==1)throw Error('This POS policy needs Owner review.');
    const result={version:1,staff:{},manager:{}};
    for(const group of ['staff','manager'])for(const key of Object.keys(defaults[group])){if(typeof value[group]?.[key]!=='boolean')throw Error('Choose every POS tool permission.');result[group][key]=value[group][key];}
    return result;
};
export function installPOSSettingsPolicy(api,d,host) {
    if(!host)return null;let expected=null,busy=false,loaded=false;
    const owner=()=>{const user=api.auth?.currentUser,session=api.sessionUser;
        if(!user?.uid||user.email!=='jgo031996@gmail.com'||user.emailVerified!==true||session?.uid!==user.uid||session.email!==user.email||session.isFranchisee)throw Error('Only the signed-in main Owner can change the global POS tool policy.');
        return user.uid;};
    host.classList.add('pos-settings-policy');
    host.innerHTML='<div class="manager-panel-heading"><h3>POS Settings access</h3><p>Choose staff tools and Manager controls for the network. Managers still need their saved HQ permissions, assigned branch and security PIN.</p></div><p role="status" data-policy-status>Load the saved policy before editing.</p><div data-policy-fields></div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button type="button" data-policy-load>Reload saved policy</button><button type="button" data-policy-save disabled>Save POS access policy</button></div>';
    const status=host.querySelector('[data-policy-status]'),fields=host.querySelector('[data-policy-fields]'),saveButton=host.querySelector('[data-policy-save]');
    function paint(value){fields.replaceChildren();for(const group of ['staff','manager']){const section=d.createElement('fieldset');section.style.cssText='border:1px solid #dce6df;border-radius:10px;padding:16px;margin:12px 0;';const legend=d.createElement('legend');legend.textContent=group==='staff'?'Staff tools':'Manager branch controls';section.append(legend);
        for(const key of Object.keys(value[group])){const label=d.createElement('label');label.style.cssText='display:flex;align-items:center;gap:10px;padding:8px;';const checkbox=d.createElement('input');checkbox.type='checkbox';checkbox.checked=value[group][key];checkbox.dataset.policyGroup=group;checkbox.dataset.policyKey=key;label.append(checkbox,d.createTextNode(labels[key]));section.append(label);}fields.append(section);}}
    async function load(){if(busy)return;busy=true;loaded=false;saveButton.disabled=true;status.textContent='Confirming the Owner account and saved policy…';try{const uid=owner(),snapshot=await api.getDocFromServer(api.doc(api.db,'offline_policy','pos_settings_global'));if(owner()!==uid||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Connect to HQ to confirm the current policy.');const value=snapshot.exists()?snapshot.data().posSettings:null;expected=JSON.stringify(value??null);paint(parse(value));loaded=true;saveButton.disabled=false;status.textContent=value?'Saved POS access policy loaded.':'Default tools shown. Save only when you want to change the network policy.';}catch(error){fields.replaceChildren();status.textContent=error.message;}finally{busy=false;}}
    async function save(){if(busy||!loaded)return;busy=true;saveButton.disabled=true;try{const uid=owner(),value=structuredClone(defaults);for(const checkbox of fields.querySelectorAll('input'))value[checkbox.dataset.policyGroup][checkbox.dataset.policyKey]=checkbox.checked;parse(value);
        await api.runTransaction(api.db,async tx=>{const reference=api.doc(api.db,'offline_policy','pos_settings_global'),snapshot=await tx.get(reference);if(owner()!==uid)throw Error('The Owner account changed. Reload the policy.');if(JSON.stringify(snapshot.exists()?snapshot.data().posSettings??null:null)!==expected)throw Error('The policy changed in another window. Reload before saving.');tx.set(reference,{posSettings:value,posSettingsUpdatedAt:api.serverTimestamp(),posSettingsUpdatedBy:api.auth.currentUser.email},{merge:true});});
        expected=JSON.stringify(value);status.textContent='POS access policy saved. Cashier devices confirm it before using Settings controls.';
    }catch(error){status.textContent=error.message;}finally{busy=false;saveButton.disabled=!loaded;}}
    host.querySelector('[data-policy-load]').onclick=load;saveButton.onclick=save;return {load,save};
}
