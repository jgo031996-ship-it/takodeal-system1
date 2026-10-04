// This entry renders and handles the keypad without downloading business data.
const el = id => document.getElementById(id);
let installPrompt;
window.ManagerLogin = {
    status(text) { el('loginProgress').textContent = text; },
    error(text) { const box = el('pinErrorMsg'); box.textContent = text || ''; box.hidden = !text; },
    show(stage) {
        el('loginStage1').hidden = stage !== 'google'; el('loginStage2').hidden = stage !== 'pin';
        el('loginOverlay').style.display = 'flex';
    },
    busy(busy) {
        el('loginOverlay').querySelectorAll('.login-numpad-container button, #unlockManagerButton, #managerPinInput').forEach(button => button.disabled = busy);
        el('unlockManagerButton').textContent = busy ? 'Opening your workspace…' : 'Unlock workspace →';
    }
};
window.appendManagerPin = digit => {
    const input = el('managerPinInput');
    if (!input.disabled && /^\d$/.test(digit) && input.value.length < 32) { input.value += digit; window.ManagerLogin.error(''); }
};
window.clearManagerPin = () => { if (!el('managerPinInput').disabled) { el('managerPinInput').value = ''; window.ManagerLogin.error(''); } };
window.backspaceManagerPin = () => { if (!el('managerPinInput').disabled) el('managerPinInput').value = el('managerPinInput').value.slice(0, -1); };
document.addEventListener('keydown', event => {
    if (el('loginOverlay').style.display === 'none' || el('loginStage2').hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) { event.preventDefault(); window.appendManagerPin(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); window.backspaceManagerPin(); }
    else if (event.key === 'Escape') window.clearManagerPin();
    else if (event.key === 'Enter' && event.target.id === 'managerPinInput') { event.preventDefault(); window.checkManagerPin?.(); }
});
function network() {
    const badge = el('loginNetwork'); badge.textContent = navigator.onLine ? 'Online' : 'Offline'; badge.classList.toggle('offline', !navigator.onLine);
    if (!navigator.onLine) window.ManagerLogin.status('Reconnect to verify your account. Saved app files stay on this device.');
}
window.addEventListener('online', () => { network(); window.retryManagerAccess?.(); });
window.addEventListener('offline', network); network();
async function storageStatus(protect = false) {
    try {
        let saved = await navigator.storage?.persisted?.();
        if (protect && !saved) saved = await navigator.storage?.persist?.();
        el('loginDeviceStatus').textContent = saved ? '● Device storage protected' : '● Device cache available';
        el('loginDeviceDescription').textContent = saved ? 'App files stay here for faster launches. Live data syncs online.' : 'App files save here after the first visit. Your browser manages available space.';
    } catch { el('loginDeviceStatus').textContent = 'Device storage limited'; }
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { el('installManagerButton').textContent = 'App installed'; storageStatus(true); });
window.installManagerApp = async () => {
    await storageStatus(true);
    if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
    el('loginInstallDialog').showModal();
};
storageStatus(matchMedia('(display-mode: standalone)').matches);
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async registration => {
        await navigator.serviceWorker.ready;
        el('loginDeviceDescription').textContent = 'App files saved on this device. Live data syncs online.';
        registration.update().catch(() => {});
    }).catch(() => { el('loginDeviceDescription').textContent = 'Device cache is unavailable. The app will load online.'; });
}
const authTimer = setTimeout(() => {
    if (!window.managerAuthReady) {
        window.ManagerLogin.status('The connection is slow. Reconnect and reload to verify your account.');
        el('retryManagerButton').hidden = false;
    }
}, 15000);
window.addEventListener('manager-auth-ready', () => clearTimeout(authTimer), { once: true });
