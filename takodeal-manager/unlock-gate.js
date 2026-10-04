// Only a freshly verified account and its configured PIN can start the Manager.
export function createUnlockGate({ verify, load, change = () => {}, now = Date.now }) {
    let generation = 0, account = null, phase = 'signed-out', verifiedAt = 0;
    const configuredPin = data => String(data?.pin === '' || data?.pin == null ? data?.securityPin ?? '' : data.pin);
    const report = (next, details = {}) => { phase = next; change({ phase, account, ...details }); };
    return {
        async identify(user) {
            const current = ++generation; account = null;
            if (!user) { report('signed-out'); return; }
            report('checking');
            try {
                const data = await verify(user);
                if (current !== generation) return;
                if (!data || !configuredPin(data)) throw new Error('No Manager PIN is configured for this account. Ask the owner to check Staff & Security.');
                account = { user, data }; verifiedAt = now(); report('pin');
            } catch (error) { if (current === generation) report('unavailable', { message: error.message }); }
        },
        async unlock(pin) {
            if (phase !== 'pin' || !account) return false;
            if (now() - verifiedAt > 300000) { await this.identify(account.user); return false; }
            if (!pin || String(pin) !== configuredPin(account.data)) {
                report('pin', { message: pin ? 'That PIN is incorrect. Please try again.' : 'Enter your Manager PIN.' }); return false;
            }
            const current = generation; report('opening');
            try {
                await load(account);
                if (current !== generation) return false;
                report('open'); return true;
            } catch (error) {
                if (current === generation) report('pin', { message: 'The workspace could not load. Check your connection and try again. ' + error.message });
                return false;
            }
        },
        reset() { generation++; account = null; report('signed-out'); },
        state() { return { phase, account }; }
    };
}

export async function bounded(promise, milliseconds = 12000) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Account verification is taking longer than expected. Reconnect, then choose Retry.')), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}
