import './firebase-core.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { createUnlockGate, bounded } from './unlock-gate.js';
import { resolveHQAccount } from './hq-account-model.js';
import { createWorkspaceSession, workspaceRole, workspaceLandingPage } from './workspace-access-model.js';
import { applyWorkspacePermissions, installWorkspaceAccess } from './workspace-access.js';
import { loadManagerLibraries, prepareManagerTools } from './manager-libraries.js';
const MASTER_EMAIL = 'jgo031996@gmail.com';
const el = id => document.getElementById(id);
window.tempAuthUser = null; window.tempAuthData = null; window.sessionUser = null;
window.isLoggingIn = false;
window.applyPermissions = function() { applyWorkspacePermissions(window, document); };

window.isBranchAllowed = function(branchName) {
    if (!window.sessionUser || window.sessionUser.isOwner || !window.sessionUser.isFranchisee) return true;
    return window.sessionUser.allowedBranches.includes(branchName);
};


let runtimeLoaded = false, workspaceLoading = false;
const gate = createUnlockGate({
    verifyOnUnlock:true,
    async verify(user) {
        // One server check prevents stale cached access or a revoked PIN from unlocking.
        const ref = window.query(window.collection(window.db, 'hq_managers'), window.where('email', '==', user.email));
        let snap;
        try { snap = await bounded(window.getDocsFromServer(ref)); }
        catch (error) {
            if (error.code === 'permission-denied') throw new Error('This account cannot access workspace permissions. Ask the owner to check access.');
            throw new Error(navigator.onLine ? 'Unable to verify your account. Check the connection, then choose Retry.' : 'You are offline. Reconnect, then choose Retry to verify your account.');
        }
        if (snap.empty) throw new Error('This Google account is not approved for the Owner workspace. Use a different account.');
        const data = resolveHQAccount(snap.docs.map(profile => ({id:profile.id,data:profile.data()})));
        createWorkspaceSession(user,data);
        return data;
    },
    async load({user, data}) {
        workspaceLoading = true;
        window.sessionUser = createWorkspaceSession(user,data);
        const {isFranchisee,allowedBranches} = window.sessionUser;
        try {
            await loadManagerLibraries();
            if (window.auth.currentUser?.uid !== user.uid || gate.state().phase !== 'opening') throw new Error('The account changed. Please reload.');
            await import('./main.js?v=manager-food-deductions-20261004');
            runtimeLoaded = true;
            installWorkspaceAccess(window,document);
            prepareManagerTools();
            window.promptMobileInstall = window.installManagerApp;
            const logo = el('sidebarLogoBranchText'), name = el('sidebarProfileName'), role = el('sidebarProfileRole');
            if (logo) logo.textContent = isFranchisee ? allowedBranches.join(' & ').toUpperCase() : 'MAIN OFFICE';
            if (name) name.textContent = window.sessionUser.cashierName;
            if (role) role.textContent = window.sessionUser.role;
            window.applyPermissions(); window.applyFranchiseUIProtections?.();
            // switchView owns the dashboard load; no second subscription pass.
            window.switchView(workspaceLandingPage(window.sessionUser));
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
            el('authWelcomeName').textContent = `${workspaceRole(account.user.email,account.data.role)}: ${account.data.fullName || account.user.displayName || 'Authorized account'}`;
            ui.show('pin');
            ui.status(phase === 'opening' ? 'Verifying PIN and opening workspace…' : 'Use the keypad or your keyboard. Press Enter to unlock.');
            if (message) { el('managerPinInput').value = ''; el('managerPinInput').focus(); }
        } else if (phase === 'open') {
            ui.status(''); el('loginOverlay').style.display = 'none';
            window.tempAuthData = null; window.tempAuthUser = null;
        } else {
            window.sessionUser = null; window.tempAuthData = null; window.tempAuthUser = null;
            el('managerPinInput').value = ''; ui.show('google');
            ui.status(phase === 'checking' ? 'Verifying your approved account…' : phase === 'signed-out' ? 'Sign in to open your Owner workspace.' : 'Your workspace stays locked until your account is verified.');
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
