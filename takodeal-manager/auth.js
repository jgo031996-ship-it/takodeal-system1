import './firebase-core.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { createUnlockGate, bounded } from './unlock-gate.js';
import { loadManagerLibraries, prepareManagerTools } from './manager-libraries.js';
const MASTER_EMAIL = 'jgo031996@gmail.com';
const el = id => document.getElementById(id);
window.tempAuthUser = null; window.tempAuthData = null; window.sessionUser = null;
window.isLoggingIn = false;
window.applyPermissions = function() {
    if (!window.sessionUser) return;
    const syncHrGroup = () => {
        const { isOwner, isFranchisee, permissions = [] } = window.sessionUser;
        const allHr = isOwner || isFranchisee || permissions.includes('payroll');
        for (const [id, permission] of [['Feed','payroll'],['Schedule','schedule'],['Ledger','ledger'],['Sanctions','payroll'],['Inbox','inbox']]) {
            const link = el('subnav-' + id);
            if (link) link.style.display = allHr || permissions.includes(permission) ? 'flex' : 'none';
        }
        const group = el('nav-payroll'), submenu = el('hrSubmenu');
        const sop = el('nav-sop');
        if (sop && sop.style.display !== 'none') sop.style.display = 'flex';
        if (group && submenu) group.style.display = [...submenu.querySelectorAll('.nav-subitem')].some(link => link.style.display !== 'none') ? 'flex' : 'none';
    };
    if (window.sessionUser.isOwner) {
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'block');
        syncHrGroup();
        return;
    }
    if (window.sessionUser.isFranchisee) {
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'none');
        const allowedTabs = ['dashboard', 'accounts', 'financial-flow', 'transfers', 'devices', 'payroll', 'inbox', 'dispatch', 'zreadings', 'history', 'expenses', 'branches', 'sop', 'equipment', 'inventory', 'alerts', 'bulletin', 'franchise-hub'];
        allowedTabs.forEach(tab => { let el = document.getElementById('nav-' + tab); if (el) el.style.display = 'flex'; });
        syncHrGroup();
        setTimeout(() => {
            document.querySelectorAll('#hubSafeCash').forEach(c => { if(c.parentElement) c.parentElement.style.display = 'none'; });
            let publisherDiv = document.getElementById('announceTitle')?.parentElement;
            if (publisherDiv) publisherDiv.style.display = 'none';
            let aiPromptDiv = document.getElementById('aiRoughIdea')?.parentElement;
            if (aiPromptDiv) aiPromptDiv.style.display = 'none';
        }, 1000);
        return;
    }
    document.querySelectorAll('.nav-item').forEach(el => { if (el.id !== 'nav-dashboard') el.style.display = 'none'; });
    window.sessionUser.permissions.forEach(tabName => { let el = document.getElementById('nav-' + (tabName==='franchise'?'franchise-hub':tabName)); if (el) el.style.display = 'flex'; });
    let adminEl = document.getElementById('nav-admin'); if (adminEl) adminEl.style.display = 'none'; 
    syncHrGroup();
};

window.isBranchAllowed = function(branchName) {
    if (!window.sessionUser || window.sessionUser.isOwner || !window.sessionUser.isFranchisee) return true;
    return window.sessionUser.allowedBranches.includes(branchName);
};


let runtimeLoaded = false, workspaceLoading = false;
const gate = createUnlockGate({
    async verify(user) {
        // One server check prevents stale cached access or a revoked PIN from unlocking.
        const ref = window.query(window.collection(window.db, 'hq_managers'), window.where('email', '==', user.email));
        let snap;
        try { snap = await bounded(window.getDocsFromServer(ref)); }
        catch (error) {
            if (error.code === 'permission-denied') throw new Error('This account cannot access Manager permissions. Ask the owner to check access.');
            throw new Error(navigator.onLine ? 'Unable to verify your account. Check the connection, then choose Retry.' : 'You are offline. Reconnect, then choose Retry to verify your account.');
        }
        if (snap.empty) throw new Error('This Google account is not approved for the Manager app. Use a different account.');
        const profile = snap.docs[0];
        return {...profile.data(), docId:profile.id};
    },
    async load({user, data}) {
        workspaceLoading = true;
        const isFranchisee = data.role === 'Franchisee';
        const allowedBranches = String(data.assignedBranch || 'Main Office').split(',').map(branch => branch.trim());
        const permissions = Array.isArray(data.permissions) ? data.permissions : user.email === MASTER_EMAIL ? ['all'] : [];
        window.sessionUser = {email:user.email, branch:allowedBranches[0], allowedBranches, isFranchisee,
            cashierName:user.displayName || data.fullName || data.name || 'Manager',
            isOwner:user.email === MASTER_EMAIL || !isFranchisee && permissions.includes('all'), permissions};
        try {
            await loadManagerLibraries();
            if (window.auth.currentUser?.uid !== user.uid || gate.state().phase !== 'opening') throw new Error('The account changed. Please reload.');
            await import('./main.js?v=manager-food-deductions-20261004');
            runtimeLoaded = true;
            prepareManagerTools();
            window.promptMobileInstall = window.installManagerApp;
            const logo = el('sidebarLogoBranchText'), name = el('sidebarProfileName'), role = el('sidebarProfileRole');
            if (logo) logo.textContent = isFranchisee ? allowedBranches.join(' & ').toUpperCase() : 'MAIN OFFICE';
            if (name) name.textContent = window.sessionUser.cashierName;
            if (role) role.textContent = isFranchisee ? 'Franchise Owner' : 'Admin Access';
            window.applyPermissions(); window.applyFranchiseUIProtections?.();
            // switchView owns the dashboard load; no second subscription pass.
            window.switchView('dashboard');
        } catch (error) { window.sessionUser = null; throw error; }
        finally { workspaceLoading = false; }
    },
    change({phase, account, message}) {
        window.isLoggingIn = phase === 'opening';
        const ui = window.ManagerLogin;
        ui.busy(phase === 'opening'); ui.error(message || '');
        el('retryManagerButton').hidden = phase !== 'unavailable';
        el('changeManagerAccount').hidden = phase === 'signed-out' || phase === 'opening';
        el('googleManagerButton').disabled = phase === 'checking' || phase === 'unavailable';
        if (phase === 'pin' || phase === 'opening') {
            window.tempAuthUser = account.user; window.tempAuthData = account.data;
            el('authWelcomeName').textContent = `${account.data.role || 'Manager'}: ${account.user.displayName || account.data.fullName || 'Authorized account'}`;
            ui.show('pin');
            ui.status(phase === 'opening' ? 'Loading workspace tools…' : 'Use the keypad or your keyboard. Press Enter to unlock.');
            if (message) { el('managerPinInput').value = ''; el('managerPinInput').focus(); }
        } else if (phase === 'open') {
            ui.status(''); el('loginOverlay').style.display = 'none';
            window.tempAuthData = null; window.tempAuthUser = null;
        } else {
            window.sessionUser = null; window.tempAuthData = null; window.tempAuthUser = null;
            el('managerPinInput').value = ''; ui.show('google');
            ui.status(phase === 'checking' ? 'Verifying your approved account…' : phase === 'signed-out' ? 'Sign in to open your Manager workspace.' : 'Your workspace stays locked until your account is verified.');
        }
    }
});
window.checkManagerPin = async () => {
    const entered = el('managerPinInput').value;
    el('managerPinInput').value = '';
    await gate.unlock(entered);
};
window.finalizeManagerLogin = () => window.checkManagerPin();
window.retryManagerAccess = () => {
    const phase = gate.state().phase;
    if (phase === 'open' || phase === 'opening' || phase === 'checking') return;
    return gate.identify(window.auth.currentUser);
};
window.loginWithGoogle = async () => {
    const button = el('googleManagerButton'); if (button.disabled) return;
    button.disabled = true; window.ManagerLogin.error(''); window.ManagerLogin.status('Opening Google sign in…');
    try {
        window.provider.setCustomParameters({prompt:'select_account'});
        await signInWithPopup(window.auth, window.provider);
    } catch (error) {
        window.ManagerLogin.error(error.code === 'auth/popup-blocked' ? 'Allow the Google sign-in window, then try again.' : error.code === 'auth/popup-closed-by-user' ? '' : 'Google sign in did not finish. Check your connection and try again.');
        window.ManagerLogin.status('Sign in with your approved Google account.');
    } finally { if (!window.auth.currentUser) button.disabled = false; }
};
window.cancelLoginAndSignOut = async () => {
    if (workspaceLoading) return;
    gate.reset(); window.clearManagerMemoryCache?.();
    await signOut(window.auth);
};
onAuthStateChanged(window.auth, user => {
    // Stop the previous workspace and all its timers when the signed-in account changes.
    if (runtimeLoaded || workspaceLoading) { gate.reset(); window.clearManagerMemoryCache?.(); location.reload(); return; }
    gate.identify(user);
});
window.managerAuthReady = true;
window.dispatchEvent(new Event('manager-auth-ready'));
