// Presentation only. Existing schedule controls are moved intact; their values,
// event handlers, authorization and save operations remain with their owners.
const installations = new WeakMap();
const sections = Object.freeze([
    ['roster', 'Roster'], ['team', 'Staff & time off'],
    ['rules', 'Shift rules'], ['history', 'History & approvals']
]);
const sectionId = key => 'scheduleWorkspacePanel-' + key;
const buttonId = key => 'scheduleWorkspaceButton-' + key;
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ');

export function installScheduleWorkspace(document) {
    if (!document || typeof document.createElement !== 'function') return null;
    if (installations.has(document)) return installations.get(document);
    let root = null, toolbar = null, context = null, branchHost = null,
        branchCaption = null, branchBarHost = null, notices = null,
        recoveryDetails = null, rulesNote = null, navigation = null;
    let active = 'roster';
    const panels = new Map(), buttons = new Map();
    const byId = id => document.getElementById(id);
    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const move = (node, destination) => {
        if (node && destination && node.parentElement !== destination) destination.append(node);
    };
    function mount() {
        if (root?.isConnected) return true;
        const candidate = byId('scheduleEditorRoot'), heading = byId('scheduleEditorToolbar'),
            rules = byId('scheduleShiftRulesPanel'), team = byId('scheduleTeamPanel'), roster = byId('scheduleContainer');
        if (!candidate || !heading || !rules || !team || !roster ||
            ![heading, rules, team, roster].every(node => candidate.contains(node))) return false;
        root = candidate; toolbar = heading;
        root.classList.add('schedule-workspace');
        toolbar.classList.add('schedule-workspace-toolbar');
        context = make('section', 'schedule-workspace-save-context');
        context.id = 'scheduleWorkspaceSaveContext';
        context.setAttribute('aria-label', 'Schedule save context');
        notices = make('div', 'schedule-workspace-notices');
        notices.id = 'scheduleWorkspaceNotices';
        branchHost = make('section', 'schedule-workspace-branch');
        branchHost.setAttribute('aria-label', 'Schedule branch');
        branchCaption = make('p', 'schedule-workspace-branch-caption', 'Select a branch');
        branchCaption.setAttribute('aria-live', 'polite');
        branchBarHost = make('div', 'schedule-workspace-branch-buttons');
        branchBarHost.id = 'scheduleWorkspaceBranchHost';
        branchHost.append(branchCaption, branchBarHost);
        navigation = make('nav', 'schedule-workspace-navigation');
        navigation.setAttribute('aria-label', 'Schedule sections');
        const content = make('div', 'schedule-workspace-content');
        content.id = 'scheduleWorkspaceContent';
        for (const [key, label] of sections) {
            const button = make('button', 'schedule-workspace-button', label);
            button.id = buttonId(key); button.type = 'button';
            button.setAttribute('aria-controls', sectionId(key));
            button.setAttribute('aria-pressed', String(key === active));
            button.addEventListener('click', () => show(key));
            buttons.set(key, button); navigation.append(button);
            const panel = make('section', 'schedule-workspace-panel');
            panel.id = sectionId(key); panel.hidden = key !== active;
            panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', button.id);
            panels.set(key, panel); content.append(panel);
        }
        // This is called after the memory/store modules have mounted. Their
        // original month-toolbar ancestry is left intact until then.
        toolbar.after(context, notices, branchHost, navigation, content);
        move(roster, panels.get('roster'));
        move(team, panels.get('team'));
        move(rules, panels.get('rules'));
        rulesNote = make('p', 'schedule-workspace-rules-note');
        rulesNote.setAttribute('role', 'status');
        rules.before(rulesNote);
        return true;
    }
    function currentBranch() {
        const button = branchBarHost?.querySelector('.tab-btn.active[id^="btn-"]');
        return button ? normalize(button.id.slice(4)) : '';
    }
    function routeMemory() {
        const memory = byId('scheduleMemoryPanel');
        if (memory && root.contains(memory)) move(memory, panels.get('history'));
        for (const id of ['scheduleProposalAuditPanel', 'scheduleSwapReviewPanel']) {
            const panel = byId(id);
            if (panel && root.contains(panel)) move(panel, panels.get('history'));
        }
        const input = byId('scheduleEffectiveFrom'), label = input?.closest('label');
        if (label && root.contains(label)) {
            label.classList.add('schedule-workspace-effective'); move(label, context);
        }
        const status = byId('scheduleMemoryStatus');
        if (status && root.contains(status)) {
            status.classList.add('schedule-workspace-memory-status'); move(status, context);
        }
        for (const tools of root.querySelectorAll('.owner-schedule-sync-tools')) move(tools, context);
        for (const recovery of root.querySelectorAll('.owner-schedule-recovery')) {
            if (!recoveryDetails) {
                recoveryDetails = make('details', 'schedule-workspace-recovery');
                recoveryDetails.append(make('summary', '', 'Draft recovery'));
                context.append(recoveryDetails);
            }
            move(recovery, recoveryDetails);
        }
        const notice = byId('scheduleSuspensionNotice');
        if (notice && root.contains(notice)) move(notice, notices);
    }
    function routeBranchBar() {
        const roster = byId('scheduleContainer');
        if (!roster || !root.contains(roster)) return;
        const fresh = [...roster.children].find(node => node.classList.contains('tab-container'));
        if (fresh) {
            // renderTables creates new original branch controls. Retire only
            // the previous rendered bar; never clone a control or its handler.
            for (const previous of [...branchBarHost.children]) if (previous !== fresh) previous.remove();
            move(fresh, branchBarHost);
        } else if (!roster.childElementCount) {
            for (const previous of [...branchBarHost.children]) previous.remove();
        }
        const branch = currentBranch(), month = byId('monthSelector')?.value || '';
        let period = month;
        if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
            const at = new Date(month + '-01T00:00:00+08:00');
            if (Number.isFinite(+at)) period = new Intl.DateTimeFormat('en-PH', {
                timeZone: 'Asia/Manila', month: 'long', year: 'numeric'
            }).format(at);
        }
        const caption = [branch || 'Select a branch', period].filter(Boolean).join(' · ');
        if (branchCaption.textContent !== caption) branchCaption.textContent = caption;
    }
    function filterRules() {
        const branch = currentBranch(), grid = byId('shiftConfigGrid');
        if (!grid || !root.contains(grid)) return;
        const cards = [...grid.children].filter(node => node.classList.contains('shift-config-box'));
        const branchOf = card => {
            const encoded = card.getAttribute('data-schedule-branch');
            if (encoded !== null) {
                try { return normalize(decodeURIComponent(encoded)); } catch { return normalize(encoded); }
            }
            return normalize(card.querySelector('h4')?.textContent).replace(/^📍\s*/u, '').replace(/\s+Shifts$/i, '').trim();
        };
        const matches = branch && cards.some(card => branchOf(card) === branch);
        for (const card of cards) {
            card.classList.add('schedule-workspace-rule-card');
            card.hidden = Boolean(matches && branchOf(card) !== branch);
        }
        // Missing or unknown branch metadata must not make every control vanish.
        const note = matches ? branch + ' shift rules. Choose another branch above to view its shift rules.'
            : cards.length ? 'Choose a branch above. All available branch rules are shown until a matching branch is selected.'
                : 'Shift rules will appear after this month and branch have loaded.';
        if (rulesNote.textContent !== note) rulesNote.textContent = note;
    }
    function paint() {
        for (const [key] of sections) {
            panels.get(key).hidden = key !== active;
            buttons.get(key).setAttribute('aria-pressed', String(key === active));
        }
        root.dataset.scheduleWorkspaceSection = active;
    }
    function refresh() {
        if (!mount()) return false;
        routeMemory(); routeBranchBar(); filterRules(); paint(); return true;
    }
    function show(section) {
        if (!sections.some(([key]) => key === section) || !mount()) return false;
        active = section; return refresh();
    }
    const controller = {refresh, show};
    installations.set(document, controller);
    refresh(); return controller;
}
