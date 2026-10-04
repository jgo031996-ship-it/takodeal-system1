import { VaultSession, createPinVerifier, verifyPin, validVaultPin, validVerifier, attendanceHistory, escapeHtml } from './staff-privacy.js';

export function installStaffPortal() {
    const $ = id => document.getElementById(id);
    const identity = () => ({ id: localStorage.getItem('takodeal_staff_id'), name: localStorage.getItem('takodeal_staff_name') });
    const session = new VaultSession();
    window.staffVaultSession = session;
    let modalMode = 'unlock', modalEpoch = 0, busy = false, attendanceEpoch = 0, attendanceCache = null;
    const payTemplate = $('vaultContent').innerHTML;
    let profileEpoch = 0;
    const profile = async id => {
        const snap = await window.getDoc(window.doc(window.db, 'cashiers', id));
        if (!snap.exists()) throw new Error('Your staff profile could not be found. Please contact HQ.');
        return snap.data();
    };
    const wipeInputs = () => ['vaultCurrentPin','vaultNewPin','vaultConfirmPin'].forEach(id => { $(id).value = ''; });
    const current = token => identity().id === token.id && modalEpoch === token.epoch && !document.hidden;
    const notice = text => { $('vaultError').textContent = text; $('vaultError').hidden = false; };
    function refreshVault() {
        const open = session.allows(identity().id);
        $('vaultGate').hidden = open;
        $('vaultContent').hidden = !open;
        $('vaultLockButton').hidden = !open;
        $('vaultState').textContent = open ? 'Unlocked · locks after 2 minutes idle' : 'Private · PIN required';
    }
    window.lockPayslipVault = function() {
        session.lock(); modalEpoch++; busy = false; wipeInputs();
        $('vaultPinModal').style.display = 'none';
        // Remove values and encoded payroll actions rather than merely covering them.
        $('vaultContent').innerHTML = payTemplate;
        document.querySelectorAll('[data-pay-export]').forEach(node => node.remove());
        if (document.getElementById('printableStaffPayslip') || document.getElementById('payslipSignatureCanvas')) window.Swal?.close();
        refreshVault();
    };
    window.closeVaultPin = function() { modalEpoch++; busy = false; wipeInputs(); $('vaultPinModal').style.display = 'none'; };
    window.openVaultPin = async function(mode = 'unlock') {
        const { id } = identity(); if (!id) return;
        window.lockPayslipVault();
        const token = { id, epoch: modalEpoch };
        $('vaultPinModal').style.display = 'flex'; $('vaultPinForm').hidden = true;
        $('vaultError').hidden = true; $('vaultPinIntro').textContent = 'Checking your PIN settings…';
        $('vaultSubmit').disabled = false;
        try {
            const data = await profile(id); if (!current(token)) return;
            if (!data.payslipPin && mode === 'unlock') {
                window.closeVaultPin(); window.openProfile();
                document.querySelector('.profile-security')?.scrollIntoView?.({block:'center'});
                return;
            }
            if (data.payslipPin && !validVerifier(data.payslipPin)) throw new Error('Your PIN settings need a review by HQ.');
            modalMode = data.payslipPin ? mode : 'setup';
            const editing = modalMode !== 'unlock';
            $('vaultPinTitle').textContent = modalMode === 'setup' ? 'Create your Payslip PIN' : editing ? 'Change your Payslip PIN' : 'Unlock Payslip Vault';
            $('vaultPinIntro').textContent = modalMode === 'setup' ? 'Verify your staff login PIN, then choose a separate 6–8 digit PIN for your pay.' : editing ? 'Enter your current Payslip PIN and choose a new one.' : 'Enter your separate Payslip PIN to see your earnings and records.';
            $('vaultCurrentLabel').textContent = modalMode === 'setup' ? 'Staff login PIN' : 'Payslip PIN';
            $('vaultNewFields').hidden = !editing;
            $('vaultSubmit').textContent = editing ? 'Save Payslip PIN' : 'Unlock vault';
            $('vaultPinForm').hidden = false; $('vaultCurrentPin').focus();
        } catch (error) { if (current(token)) { $('vaultPinIntro').textContent = 'PIN settings are unavailable.'; notice(error.message || 'Please try again when connected.'); } }
    };
    window.submitVaultPin = async function(event) {
        event?.preventDefault(); if (busy) return;
        const { id } = identity(); if (!id) return;
        const token = { id, epoch: modalEpoch }, pin = $('vaultCurrentPin').value.trim();
        const newPin = $('vaultNewPin').value.trim(), confirm = $('vaultConfirmPin').value.trim();
        const attemptKey = 'takodeal_vault_attempts_' + id;
        let attempts;
        try { attempts = JSON.parse(localStorage.getItem(attemptKey) || '{}'); } catch { attempts = {}; }
        if (attempts.until > Date.now()) return notice('Too many attempts. Wait one minute before trying again.');
        if (modalMode !== 'unlock' && (!validVaultPin(newPin) || newPin !== confirm)) return notice('Use 6–8 digits and make sure the new PINs match.');
        busy = true; $('vaultSubmit').disabled = true; $('vaultError').hidden = true;
        try {
            const data = await profile(id); if (!current(token)) return;
            // Re-read the verifier before every attempt so changing a PIN on another device takes effect.
            const authentic = modalMode === 'setup' ? !data.payslipPin && String(data.pin ?? '') === pin : await verifyPin(pin, data.payslipPin);
            if (!current(token)) return;
            if (!authentic) {
                const count = (attempts.until && attempts.until <= Date.now() ? 0 : attempts.count || 0) + 1;
                localStorage.setItem(attemptKey, JSON.stringify({ count, until: count >= 5 ? Date.now() + 60000 : 0 }));
                throw new Error(count >= 5 ? 'Too many attempts. Please wait one minute.' : 'Incorrect PIN. Please try again.');
            }
            if (modalMode !== 'unlock') {
                if (String(data.pin ?? '') === newPin) throw new Error('Choose a Payslip PIN that is different from your staff login PIN.');
                const verifier = await createPinVerifier(newPin); if (!current(token)) return;
                await window.updateDoc(window.doc(window.db, 'cashiers', id), { payslipPin: verifier });
                if (!current(token)) return;
            }
            localStorage.removeItem(attemptKey);
            window.closeVaultPin(); session.unlock(id); refreshVault();
            // PIN editing from Profile does not reveal pay behind another screen.
            if (!$('view-payslip').classList.contains('active')) { window.lockPayslipVault(); return; }
            window.loadPayslipVault();
        } catch (error) { if (current(token)) notice(error.message || 'Could not open your vault. Please try again.'); }
        finally { if (current(token)) { busy = false; $('vaultSubmit').disabled = false; } }
    };
    const oldSwitch = window.switchView;
    window.switchView = function(view, button) {
        if (view !== 'payslip') window.lockPayslipVault();
        oldSwitch(view, button);
        if (view === 'timeclock') window.loadMyAttendance();
        refreshVault();
        document.querySelector('.content-area').scrollTop = 0;
    };
    const oldLogin = window.checkNormalLogin;
    window.checkNormalLogin = function() {
        const previousId = session.staffId;
        oldLogin(); if (previousId && previousId !== identity().id) window.lockPayslipVault();
        window.refreshStaffHeader();
    };
    const oldManualLogin = window.loginStaff;
    window.loginStaff = async function() { window.lockPayslipVault(); await oldManualLogin(); window.refreshStaffHeader(); };
    const oldLogout = window.logoutStaff;
    window.logoutStaff = function() { window.lockPayslipVault(); attendanceEpoch++; profileEpoch++; attendanceCache = null; oldLogout(); };
    const oldProfile = window.openProfile;
    window.openProfile = function() { window.lockPayslipVault(); return oldProfile(); };
    window.refreshStaffHeader = async function() {
        const { id } = identity(), epoch = ++profileEpoch; if (!id) return;
        try {
            const data = await profile(id); if (epoch !== profileEpoch || identity().id !== id) return;
            $('staffProfileMeta').textContent = [data.role || 'Staff', data.branch].filter(Boolean).join(' · ');
            $('topAvatar').setAttribute('aria-label', 'Open profile for ' + (data.cashierName || 'staff'));
        } catch { $('staffProfileMeta').textContent = 'Your staff portal'; }
    };
    window.loadMyAttendance = async function(force = false) {
        const { id, name } = identity(); if (!id || !name) return;
        const epoch = ++attendanceEpoch, box = $('myAttendanceList');
        box.innerHTML = '<p class="empty-state">Loading your attendance…</p>';
        try {
            // Single-field query avoids requiring a new Firestore composite index.
            let records;
            if (!force && attendanceCache?.id === id && attendanceCache.name === name && Date.now() - attendanceCache.saved < 60000) records = attendanceCache.records;
            else {
                const snapshot = await window.getDocs(window.query(window.collection(window.db, 'attendance_logs'), window.where('staffName', '==', name)));
                records = snapshot.docs.map(d => d.data());
            }
            if (epoch !== attendanceEpoch || identity().id !== id) return;
            attendanceCache = { id, name, records, saved:Date.now() };
            const shifts = attendanceHistory(records, id, name);
            const month = $('attendanceMonth').value;
            const rows = shifts.filter(row => { const d = (row.in || row.out).date; return !month || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === month; });
            $('attendanceCount').textContent = rows.length + (rows.length === 1 ? ' shift' : ' shifts');
            const time = d => d ? d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—';
            box.innerHTML = rows.length ? rows.map(row => {
                const log = row.in || row.out, savedLate = row.in?.reviewedLateMinutes ?? row.in?.lateMinutes, late = Number(savedLate) || 0;
                const label = row.in?.lateExempted === true ? 'Late · exempted by HQ' : late > 3 ? `Late · ${late} min` : savedLate == null ? 'Late status not recorded' : 'On time';
                return `<article class="attendance-row"><div><strong>${escapeHtml(log.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}))}</strong><span>${escapeHtml(log.branch || 'Branch not recorded')}</span></div><div class="attendance-times"><span>Time in<strong>${time(row.in?.date)}</strong></span><span>Time out<strong>${time(row.out?.date)}${row.out && row.in && row.out.date.toDateString() !== row.in.date.toDateString() ? '<small>Next day</small>' : ''}</strong></span><span>Hours<strong>${row.hours == null ? '—' : row.hours.toFixed(2)}</strong></span></div><div class="attendance-status"><span class="status-pill ${row.status.includes('Missing') ? 'warning' : ''}">${row.status}</span>${row.in ? `<span class="status-pill ${late > 3 && !row.in.lateExempted ? 'danger' : ''}">${label}</span>` : ''}</div></article>`;
            }).join('') : '<p class="empty-state">No attendance recorded for this month.</p>';
        } catch { if (epoch === attendanceEpoch) box.innerHTML = '<p class="empty-state">Your attendance could not load. Check your connection, then select Refresh.</p>'; }
    };
    const month = new Date(); $('attendanceMonth').value = `${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
    document.addEventListener('visibilitychange', () => { if (document.hidden) window.lockPayslipVault(); });
    window.addEventListener('pagehide', () => window.lockPayslipVault());
    ['pointerdown','keydown'].forEach(type => document.addEventListener(type, () => {
        if (session.staffId && !session.allows(identity().id)) window.lockPayslipVault();
        else session.touch(identity().id);
    }, { passive: true }));
    setInterval(() => { if (session.staffId && !session.allows(identity().id)) window.lockPayslipVault(); }, 1000);
    window.lockPayslipVault();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Staff offline cache unavailable:', error.message));
}
