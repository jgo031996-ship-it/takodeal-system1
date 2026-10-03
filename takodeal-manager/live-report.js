// One listener per report. Switching filters/views invalidates stale async loads.
export function createLiveReport({ subscribe, status, error = console.error }) {
    let generation = 0, unsubscribe;
    const stop = () => { generation++; unsubscribe?.(); unsubscribe = null; };
    return {
        stop,
        start() {
            stop();
            const current = generation;
            const active = () => generation === current;
            return {
                active,
                watch(query, render) {
                    if (!active()) return;
                    status('Connecting…');
                    let first = true;
                    const off = subscribe(query, { includeMetadataChanges: true }, snap => {
                        if (!active()) return;
                        status(snap.metadata?.fromCache ? 'Offline / cached sales' : 'Live sales');
                        const update = !first; first = false;
                        Promise.resolve().then(() => { if (active()) return render(snap, update); }).catch(e => {
                            if (active()) { status('Report update failed'); error(e); }
                        });
                    }, e => { if (active()) { status('Live connection failed — use Update Report'); error(e); } });
                    if (active()) unsubscribe = off; else off();
                }
            };
        }
    };
}
