// A failed Firestore queue cannot safely accept more work in this page session.
// Keep the original SDK diagnostics in the console; expose only a fixed UI notice.
export const FIRESTORE_RECOVERY_CODE = 'owner/cloud-failed';
export const FIRESTORE_RECOVERY_MESSAGE = 'The Owner app’s database connection stopped. Keep this window open to preserve unsaved edits. Review Schedule Manager’s recovery tools before reopening the app.';

const assertion = /\bFIRESTORE\s*(?:\([^\)\r\n]{1,40}\))?\s*:?\s*INTERNAL ASSERTION FAILED\b/i;

export function isFatalFirestoreError(value) {
    const seen = new Set();
    function inspect(item, depth) {
        if (typeof item === 'string') return assertion.test(item);
        if (!item || typeof item !== 'object' || depth > 4 || seen.has(item)) return false;
        seen.add(item);
        if (Array.isArray(item)) return item.slice(0, 20).some(part => inspect(part, depth + 1));
        // Firebase logger parameters and browser error events have these fields.
        // Do not stringify arbitrary objects, retain errors, or publish their data.
        for (const key of ['message', 'error', 'reason', 'args']) {
            try { if (inspect(item[key], depth + 1)) return true; } catch { /* Untrusted getter. */ }
        }
        return false;
    }
    return inspect(value, 0);
}

export function createFirestoreHealth({notify = () => {}} = {}) {
    let failed = false;
    const health = {
        isFailed: () => failed,
        report(error) {
            if (!isFatalFirestoreError(error)) return false;
            if (!failed) {
                failed = true;
                try { notify({code: FIRESTORE_RECOVERY_CODE, message: FIRESTORE_RECOVERY_MESSAGE}); }
                catch { /* A failed UI must not throw from the SDK logging hook. */ }
            }
            return true;
        },
        assertReady() {
            if (!failed) return;
            const error = new Error(FIRESTORE_RECOVERY_MESSAGE);
            error.code = FIRESTORE_RECOVERY_CODE;
            throw error;
        },
        guard(fn) {
            return function (...args) {
                health.assertReady();
                try {
                    const result = fn.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return Promise.resolve(result).catch(error => { health.report(error); throw error; });
                    }
                    return result;
                } catch (error) { health.report(error); throw error; }
            };
        }
    };
    return Object.freeze(health);
}

export function guardFirestoreOperations(health, sdk) {
    if (!health || typeof health.guard !== 'function') throw new TypeError('A database health guard is required.');
    const guarded = {...sdk};
    for (const name of ['getDoc', 'getDocs', 'getDocFromServer', 'getDocsFromServer',
        'addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'runTransaction', 'enableNetwork', 'disableNetwork']) {
        if (typeof sdk[name] === 'function') guarded[name] = health.guard(sdk[name]);
    }
    if (typeof sdk.runTransaction === 'function') {
        guarded.runTransaction = health.guard(function (...args) {
            const update = args[1];
            if (typeof update !== 'function') return sdk.runTransaction.apply(this, args);
            args[1] = health.guard(function (transaction) {
                const facade = {};
                facade.get = health.guard(reference => transaction.get(reference));
                for (const name of ['set', 'update', 'delete']) {
                    facade[name] = health.guard(function (...methodArgs) {
                        transaction[name](...methodArgs);
                        return facade;
                    });
                }
                return update.call(this, Object.freeze(facade));
            });
            return sdk.runTransaction.apply(this, args);
        });
    }
    if (typeof sdk.writeBatch === 'function') {
        guarded.writeBatch = health.guard(function (...args) {
            const batch = sdk.writeBatch.apply(this, args);
            const facade = {};
            for (const name of ['set', 'update', 'delete']) {
                facade[name] = health.guard(function (...methodArgs) {
                    batch[name](...methodArgs);
                    return facade;
                });
            }
            facade.commit = health.guard(() => batch.commit());
            return Object.freeze(facade);
        });
    }
    if (typeof sdk.onSnapshot === 'function') {
        guarded.onSnapshot = health.guard(function (...args) {
            const index = args[1] && typeof args[1] === 'object' &&
                !['next', 'error', 'complete'].some(name => typeof args[1][name] === 'function') ? 2 : 1;
            const observer = args[index];
            if (observer && typeof observer === 'object' && typeof observer.error === 'function') {
                args[index] = {...observer,
                    next: typeof observer.next === 'function' ? observer.next.bind(observer) : undefined,
                    complete: typeof observer.complete === 'function' ? observer.complete.bind(observer) : undefined,
                    error(error) { health.report(error); return observer.error(error); }
                };
            } else if (typeof args[index + 1] === 'function') {
                const onError = args[index + 1];
                args[index + 1] = function (error) { health.report(error); return onError.apply(this, arguments); };
            }
            const unsubscribe = sdk.onSnapshot.apply(this, args);
            let stopped = false;
            return () => {
                if (stopped) return;
                stopped = true;
                // Enqueuing an unsubscribe on the poisoned queue creates another assertion.
                if (health.isFailed()) return;
                try { return unsubscribe(); }
                catch (error) { if (!health.report(error)) throw error; }
            };
        });
    }
    return Object.freeze(guarded);
}

const installations = new WeakMap();
export function installFirestoreHealth(w, {onLog} = {}) {
    let installation = installations.get(w);
    if (!installation) {
        const health = createFirestoreHealth({notify(detail) {
            w.dispatchEvent(new w.CustomEvent('managercloudfailure', {detail}));
        }});
        installation = {health, loggerInstalled: false};
        installations.set(w, installation);
        w.managerCloudHealth = health;
        w.addEventListener('error', event => health.report(event));
        w.addEventListener('unhandledrejection', event => health.report(event));
    }
    if (!installation.loggerInstalled && typeof onLog === 'function') {
        onLog(event => installation.health.report(event), {level: 'error'});
        installation.loggerInstalled = true;
    }
    return installation.health;
}
