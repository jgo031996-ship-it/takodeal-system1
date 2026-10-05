import {monthKey, scheduleDateKey, defaultScheduleEffectiveFrom} from './schedule-history.js';

const savedVersionTime = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'time unavailable';
    return new Intl.DateTimeFormat('en-PH', {timeZone:'Asia/Manila', year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(date) + ' PH';
};

// Presentation and navigation only. Saved revisions are written by the history store.
export function installScheduleMemoryUI({document, store, getSnapshot, applySnapshot, setExpectedRevision, setReadOnly}) {
    const month = document.getElementById('monthSelector');
    if (!month || document.getElementById('scheduleMemoryPanel')) return null;
    const panel = document.createElement('section');
    panel.id = 'scheduleMemoryPanel'; panel.className = 'schedule-memory-panel';
    panel.innerHTML = '<div><strong>Schedule memory</strong><p>Saved versions keep the shift times and staff assignments used from each effective date. Later changes do not replace earlier versions.</p></div><label>Changes effective from<input type="date" id="scheduleEffectiveFrom"></label><label>Saved versions<select id="scheduleMemoryVersions"><option value="">Loading saved versions…</option></select></label><button type="button" id="scheduleMemoryLatest">Show latest version</button><p id="scheduleMemoryStatus" role="status"></p>';
    month.closest('div[style*="justify-content: space-between"]')?.after(panel);
    if (!panel.isConnected) month.parentElement.parentElement.parentElement.after(panel);
    const input = panel.querySelector('#scheduleEffectiveFrom'), versions = panel.querySelector('#scheduleMemoryVersions'), status = panel.querySelector('#scheduleMemoryStatus');
    let saved = null, generation = 0, viewing = false;
    const paint = () => {
        const today = scheduleDateKey(new Date()), snapshot = getSnapshot(), selected = monthKey(snapshot);
        input.min = today; input.max = selected + '-' + new Date(Number(selected.slice(0,4)), Number(selected.slice(5,7)), 0).getDate();
        if (!input.value || monthKey(input.value) !== selected) input.value = defaultScheduleEffectiveFrom(snapshot);
        const past = selected < today.slice(0,7), readOnly = past || viewing;
        input.disabled = readOnly; setReadOnly(readOnly);
        panel.dataset.readOnly = String(readOnly);
        status.textContent = past ? 'Saved past months are read-only. Schedules from before memory was enabled cannot be reconstructed.' : viewing ? 'Viewing a saved version. Choose Show latest version to continue editing.' : saved?.revisions.length ? 'Version saved. Future payroll uses the schedule recorded for the work date, with clock-in references preserved.' : 'No saved version for this month yet. Save Edits or Save Shift Rules to start keeping this month’s history.';
        for (const button of document.querySelectorAll('#view-schedule button[onclick]')) {
            if (/saveManualSchedule|saveShiftConfigChanges|generateSchedule|addNewShiftToBranch|removeShiftFromBranch|moveShiftOrder|addHoliday|addUnavailability|bulkUnavailability|addEmployee|removeEmployee/.test(button.getAttribute('onclick') || '')) button.disabled = readOnly;
        }
    };
    const refresh = async () => {
        const token = ++generation, selected = month.value || monthKey(getSnapshot());
        status.textContent = 'Loading saved schedule versions…';
        try {
            const result = await store.loadMonth(selected); if (token !== generation) return;
            saved = result; setExpectedRevision(result.latestRevisionId || null);
            versions.replaceChildren(new Option('Current editor', ''), ...result.revisions.slice().reverse().map(revision => new Option('From ' + revision.effectiveFrom + ' · saved ' + savedVersionTime(revision.savedAt), revision.revisionId)));
            viewing = false; paint(); return result;
        } catch (error) { if (token === generation) {status.textContent = 'Could not load schedule memory: ' + error.message; setReadOnly(true);} }
    };
    const selectMonth = async () => {
        const selected = month.value, result = await refresh(); if (!result || month.value !== selected) return;
        if (result.latestRevision) await applySnapshot(result.latestRevision.snapshot);
        else {
            const previous = getSnapshot(), [year, number] = selected.split('-').map(Number);
            await applySnapshot({...previous, currentYear:year, currentMonth:number, currentSchedule:{}, holidays:{}, unavailability:{}});
        }
        input.value = defaultScheduleEffectiveFrom(getSnapshot()); viewing = false; paint();
    };
    versions.onchange = async () => {
        if (!versions.value) {if (saved?.latestRevision) await applySnapshot(saved.latestRevision.snapshot); viewing=false; paint(); return;}
        const revision = saved?.revisions.find(row => row.revisionId === versions.value);
        if (revision) {await applySnapshot(revision.snapshot); viewing=true; input.value=revision.effectiveFrom; paint();}
    };
    panel.querySelector('#scheduleMemoryLatest').onclick = async () => { await selectMonth(); };
    month.onchange = selectMonth;
    return {refresh, paint, selectMonth, effectiveFrom:()=>input.value};
}
