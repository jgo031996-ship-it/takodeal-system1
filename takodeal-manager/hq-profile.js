import { canManageAccess, escapeHTML as esc, normalizeEmail, validEmail } from './access-workspace-model.js';
import { savedPin, MASTER_EMAIL } from './hq-account-model.js';
import { bounded } from './unlock-gate.js';
export function installHQProfile({window:w = window,document:d = document} = {}) {
    const guard = () => { if (!canManageAccess(w.auth?.currentUser)) throw Error('Only the main owner can view PINs or change HQ profiles.'); };
    w.addHqManager = async () => {
        let dialog;
        try {
            guard(); const emailInput = d.getElementById('newManagerEmail'), email = normalizeEmail(emailInput.value);
            if (!validEmail(email)) throw Error('Enter a complete Google email address.');
            const existing = await bounded(w.getDocsFromServer(w.query(w.collection(w.db,'hq_managers'),w.where('email','==',email))));
            if (!existing.empty) throw Error('This email already has access. Open its profile to make changes.');
            const branches = await bounded(w.getDocsFromServer(w.collection(w.db,'branches'))); guard();
            const names = [...new Set(branches.docs.map(row => row.data().name).filter(Boolean))].sort();
            const ref = w.doc(w.db,'hq_managers','hq_'+encodeURIComponent(email));
            dialog = d.createElement('dialog'); dialog.className = 'hq-profile-dialog';
            dialog.innerHTML = `<form><header><div><small>HQ ACCESS CONTROL</small><h2>Authorize an account</h2></div><button type="button" data-close aria-label="Close registration">×</button></header><div class="hq-profile-body">
                <label>Google email<input readonly value="${esc(email)}"></label><label>Full name<input name="fullName" required maxlength="100"></label><label>Contact number<input name="phone" maxlength="40"></label>
                <label>Account role<select name="role"><option value="Manager">Manager</option><option value="Co-Owner">Co-Owner</option><option value="Franchisee">Franchise owner</option></select></label>
                <label data-branch hidden>Assigned branch<select name="branch">${names.map(name=>`<option>${esc(name)}</option>`).join('')}</select></label>
                <label>Security PIN / password<input name="pin" type="password" autocomplete="new-password" minlength="4" maxlength="128" required></label><p class="hq-profile-note">Use a PIN of at least 4 characters. Approved Google accounts can share the same PIN; each keeps its own role and permissions. You can review the saved PIN from this account's profile.</p><p role="status" data-status></p></div><footer><button type="button" data-close>Cancel</button><button type="submit" data-save>Grant access</button></footer></form>`;
            const form=dialog.querySelector('form'),field=name=>form.elements.namedItem(name);let saving=false;
            field('role').onchange=()=>dialog.querySelector('[data-branch]').hidden=field('role').value!=='Franchisee';
            const close=()=>{if(saving)return;field('pin').value='';dialog.close();dialog.remove();};
            dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
            form.onsubmit=async event=>{
                event.preventDefault();if(saving)return;const status=dialog.querySelector('[data-status]'),button=dialog.querySelector('[data-save]');
                try{
                    guard();const role=field('role').value,pin=field('pin').value.trim();
                    if(pin.length<4)throw Error('Use at least 4 characters for the PIN.');
                    if(!['Manager','Co-Owner','Franchisee'].includes(role))throw Error('Choose a valid account role.');
                    if(role==='Franchisee'&&!names.includes(field('branch').value))throw Error('Choose a registered branch.');
                    saving=true;button.disabled=true;status.textContent='Saving account to HQ…';
                    const permissions=role==='Franchisee'?['dashboard','accounts','financial-flow','transfers','devices','payroll','inbox','dispatch','zreadings','history','expenses','branches','sop','equipment','inventory','alerts','bulletin']:['all'];
                    await bounded(w.runTransaction(w.db,async tx=>{const snap=await tx.get(ref);guard();if(snap.exists())throw Error('This account was already registered. Refresh the account list.');tx.set(ref,{email,fullName:field('fullName').value.trim(),phone:field('phone').value.trim(),pin,role,assignedBranch:role==='Franchisee'?field('branch').value:'All',permissions,addedAt:w.serverTimestamp(),pinUpdatedAt:w.serverTimestamp(),profileUpdatedAt:w.serverTimestamp()});}));
                    emailInput.value='';saving=false;close();await w.loadAdminDashboard?.();
                }catch(error){status.textContent=error.message||'Unable to confirm registration. Your entered values are kept.';}
                finally{saving=false;button.disabled=false;}
            };
            d.body.append(dialog);dialog.showModal();
        }catch(error){dialog?.remove();w.ManagerUI?.notify?.(error.message);}
    };
    w.editManagerProfile = async id => {
        let dialog;
        try {
            guard();
            const ref = w.doc(w.db,'hq_managers',id), snapshot = await bounded(w.getDocFromServer(ref));
            guard();
            if (!snapshot.exists()) throw Error('This profile no longer exists. Refresh the account list.');
            const record = snapshot.data(), email = normalizeEmail(record.email), owner = email === MASTER_EMAIL;
            const role = record.role === 'Co-Owner' ? 'Co-Owner' : record.role === 'Franchisee' ? 'Franchisee' : 'Manager';
            dialog = d.createElement('dialog'); dialog.className = 'hq-profile-dialog';
            dialog.innerHTML = `<form method="dialog"><header><div><small>HQ ACCESS CONTROL</small><h2>Profile & security PIN</h2></div><button type="button" data-close aria-label="Close profile">×</button></header>
                <div class="hq-profile-body"><label>Google email<input readonly value="${esc(email)}"></label>
                <label>Full name<input name="fullName" maxlength="100" value="${esc(record.fullName || record.name || '')}" required></label>
                <label>Contact number<input name="phone" maxlength="40" value="${esc(record.phone || '')}"></label>
                <label>Account role<select name="role" ${owner ? 'disabled' : ''}><option value="Manager">Manager</option><option value="Co-Owner">Co-Owner</option><option value="Franchisee">Franchise owner</option></select></label>
                <p class="hq-profile-note">Role changes keep existing tab permissions. Edit permissions separately to change access.</p>
                <section class="hq-pin-section"><label>Current saved PIN<div class="hq-pin-row"><input name="currentPin" type="password" readonly autocomplete="off"><button type="button" data-reveal>Show PIN</button></div></label>
                <p data-pin-status></p><label>New security PIN / password<input name="newPin" type="password" autocomplete="new-password" maxlength="128" placeholder="Leave blank to keep the saved PIN"></label>
                <p class="hq-profile-note">Use at least 4 characters. The new PIN field is blank when you reopen this profile; the current saved PIN is shown above.</p></section>
                <p role="status" data-status></p></div><footer><button type="button" data-close>Cancel</button><button type="submit" data-save>Save profile & PIN</button></footer></form>`;
            const form = dialog.querySelector('form'), field = name => form.elements.namedItem(name);
            field('role').value = role; field('currentPin').value = savedPin(record);
            dialog.querySelector('[data-pin-status]').textContent = savedPin(record) ? 'A PIN is saved for this account.' : 'No PIN is saved. Set a PIN before this account signs in.';
            let saving = false, revealed = false;
            dialog.querySelector('[data-reveal]').onclick = event => { guard(); revealed = !revealed; field('currentPin').type = revealed ? 'text' : 'password'; event.currentTarget.textContent = revealed ? 'Hide PIN' : 'Show PIN'; };
            const close = () => { if (saving) return; field('currentPin').value = ''; field('newPin').value = ''; dialog.close(); dialog.remove(); };
            dialog.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            form.onsubmit = async event => {
                event.preventDefault(); if (saving) return;
                const status = dialog.querySelector('[data-status]'), button = dialog.querySelector('[data-save]');
                try {
                    guard(); const pin = field('newPin').value.trim();
                    if (pin && pin.length < 4) throw Error('Use at least 4 characters for the new PIN.');
                    const nextRole = owner ? record.role || 'Owner' : field('role').value;
                    if (!owner && !['Manager','Co-Owner','Franchisee'].includes(nextRole)) throw Error('Choose a valid account role.');
                    saving = true; button.disabled = true; status.textContent = 'Saving to HQ…';
                    // One email represents one person. Synchronize PIN/role across legacy duplicates,
                    // retaining each record's permissions, balances, and history.
                    const matches = await bounded(w.getDocsFromServer(w.query(w.collection(w.db,'hq_managers'),w.where('email','==',record.email))));
                    const refs = matches.docs.map(row => w.doc(w.db,'hq_managers',row.id));
                    if (!matches.docs.some(row => row.id === id)) throw Error('This profile changed. Refresh the directory and try again.');
                    const expectedPin = pin || savedPin(record);
                    await bounded(w.runTransaction(w.db,async tx => {
                        const current = await Promise.all(refs.map(item => tx.get(item))); guard();
                        if (current.some(item => !item.exists() || normalizeEmail(item.data().email) !== email)) throw Error('An account record changed. Refresh and try again.');
                        refs.forEach((item,index) => tx.update(item,{
                            role:nextRole, ...(pin ? {pin,pinUpdatedAt:w.serverTimestamp()} : {}),
                            ...(matches.docs[index].id === id ? {fullName:field('fullName').value.trim(),phone:field('phone').value.trim(),profileUpdatedAt:w.serverTimestamp()} : {})
                        }));
                    }));
                    const confirmed = await bounded(w.getDocFromServer(ref)); guard();
                    if (!confirmed.exists() || savedPin(confirmed.data()) !== expectedPin) throw Error('HQ could not confirm the saved PIN. Reopen this profile to check before retrying.');
                    field('currentPin').value = expectedPin; field('currentPin').type = 'password'; revealed = false;
                    field('newPin').value = ''; dialog.querySelector('[data-reveal]').textContent = 'Show PIN';
                    dialog.querySelector('[data-pin-status]').textContent = expectedPin ? 'Saved PIN confirmed by HQ.' : 'No PIN is saved.';
                    status.textContent = 'Profile saved. Sign-in will use the current saved PIN.';
                    await w.loadAdminDashboard?.();
                } catch (error) { status.textContent = error.message || 'The save could not be confirmed. Your entered values are kept here.'; }
                finally { saving = false; button.disabled = false; }
            };
            d.body.append(dialog); dialog.showModal();
        } catch (error) { dialog?.remove(); w.ManagerUI?.notify?.(error.message); }
    };
}
