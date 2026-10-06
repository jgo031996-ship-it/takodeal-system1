// Publish only coherent recipe generations. Offline receipts keep the last
// verified generation; a reconnect never rewrites a saved receipt's recipe.
export const RECIPE_CACHE_KEY = 'takodeal_recipe_snapshot_v1';
export function recipeRevision(snapshot) {
    const data = snapshot?.exists?.() ? snapshot.data() : {};
    const version = data.version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid recipe revision.');
    return { version, revisionId: String(data.revisionId || '') };
}
export function recipeRows(rows) {
    if (!Array.isArray(rows)) throw new Error('Invalid recipe data.');
    return rows.map(row => {
        if (typeof row.menuItem !== 'string' || !row.menuItem.trim() ||
            typeof row.ingredientName !== 'string' || !row.ingredientName.trim() ||
            !Number.isFinite(Number(row.qty)) || Number(row.qty) < 0) throw new Error('Invalid recipe row.');
        return { menuItem: row.menuItem, ingredientName: row.ingredientName, qty: Number(row.qty) };
    });
}
const sameRevision = (a,b) => a.version === b.version && a.revisionId === b.revisionId;
const reachedRevision = (current,target) => current && (!target || current.version > target.version || sameRevision(current,target));
export function createRecipeFeed(api, {storage, online = () => true, onChange = () => {},
    report = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, captureWaitMs = 1500} = {}) {
    let current = null, stopWatch = null, flight = null, generation = 0, announced = null;
    const revisionRef = api.doc(api.db, 'settings', 'recipe_revision');
    try {
        const cached = JSON.parse(storage?.getItem(RECIPE_CACHE_KEY) || 'null');
        if (cached?.schema === 1 && Number.isSafeInteger(cached.version) && cached.version >= 0) {
            current = {schema:1,version:cached.version,revisionId:String(cached.revisionId || ''),rows:recipeRows(cached.rows)};
        }
    } catch (error) { report(error); }
    const notify = () => { if (current) onChange(structuredClone(current)); };
    async function readCurrent(force = false) {
        if (!online()) return current;
        const epoch = generation;
        for (let attempt = 0; attempt < 4; attempt++) {
            const before = recipeRevision(await api.getDocFromServer(revisionRef));
            if (current && before.version < current.version) throw new Error('Ignoring an older recipe generation.');
            if (announced && before.version < announced.version) continue;
            if (!force && current && sameRevision(current,before)) return current;
            const snap = await api.getDocsFromServer(api.collection(api.db,'bom'));
            const rows = recipeRows(snap.docs.map(row=>row.data()));
            const after = recipeRevision(await api.getDocFromServer(revisionRef));
            if (!sameRevision(before,after) || (announced && after.version < announced.version)) continue;
            if (epoch !== generation) return current;
            current = {schema:1,...after,rows};
            // Quota/storage failures cannot invalidate a coherent in-memory copy.
            try { storage?.setItem(RECIPE_CACHE_KEY,JSON.stringify(current)); } catch(error) { report(error); }
            notify();
            return current;
        }
        throw new Error('Recipes changed while loading. Keeping the preceding verified generation.');
    }
    function refresh(force = false) {
        if (flight) return flight;
        flight = readCurrent(force).finally(()=>{flight=null;});
        return flight;
    }
    function start() {
        notify();
        if (stopWatch) return;
        if (api.onSnapshot) stopWatch = api.onSnapshot(revisionRef,snapshot=>{
            try {
                const incoming=recipeRevision(snapshot);
                if ((announced && incoming.version < announced.version) || (current && incoming.version < current.version)) return;
                announced=incoming;
                if (!current || !sameRevision(current,incoming)) refresh().then(()=>{
                    // The revision event may arrive while an earlier refresh
                    // was checking an unchanged cached generation.
                    if (current && !reachedRevision(current,incoming)) refresh().catch(report);
                }).catch(report);
            } catch(error) { report(error); }
        },report);
        refresh().catch(report);
    }
    async function capture() {
        // A short bounded freshness check prevents a poor connection from
        // holding payment hostage. The fallback is explicitly recorded.
        let timer, verified=false;
        if (online()) {
            try {
                verified=await Promise.race([
                    (async()=>{
                        // A revision announced while a preceding read was in
                        // flight must be loaded before this is called verified.
                        for(let attempt=0;attempt<4;attempt++) {
                            await refresh();
                            if(reachedRevision(current,announced)) return true;
                        }
                        return false;
                    })(),
                    new Promise(resolve=>{timer=setTimer(()=>resolve(false),captureWaitMs);})
                ]);
            } catch(error) { report(error); }
            finally { if(timer!==undefined) clearTimer(timer); }
        }
        if (!current?.rows.length) return {recipeSnapshot:[],recipeSnapshotStatus:'unavailable',recipeVersion:current?.version??null,recipeRevisionId:current?.revisionId||''};
        return {recipeSnapshot:structuredClone(current.rows),recipeSnapshotStatus:verified?'verified':'cached',
            recipeVersion:current.version,recipeRevisionId:current.revisionId};
    }
    return {start, refresh, capture, rows:()=>current && structuredClone(current),
        stop(){generation++;stopWatch?.();stopWatch=null;}};
}
