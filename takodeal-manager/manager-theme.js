// Presentation only: no database calls, permissions, or business calculations.
export const MANAGER_PAGES = Object.freeze({
    dashboard: ['Overview', 'Global Dashboard', 'Your sales, branch performance, and team in one place.'],
    accounts: ['Finance', 'Cash & Budget', 'Keep cash accounts and monthly spending in view.'],
    'financial-flow': ['Finance', 'Financial Flow', 'Follow revenue, expenses, and the movement of funds.'],
    'franchise-hub': ['Partners', 'Franchise HQ Hub', 'Manage partner performance, accounts, and conversations.'],
    transfers: ['Finance', 'EOD Remittance Hub', 'Review branch remittances and cash awaiting verification.'],
    payables: ['Finance', 'Supplier Payables', 'Track suppliers, payment terms, and outstanding balances.'],
    devices: ['Operations', 'Device Fleet', 'Review registered cashier devices and their status.'],
    payroll: ['Human resources', 'Payroll & Time Feed', 'Prepare payslips and review staff attendance.'],
    schedule: ['Human resources', 'Schedule Manager', 'Plan branch staffing and configure Morning, Mid, and Night shifts.'],
    ledger: ['Human resources', 'Loans & Ledger', 'Review staff accounts, loans, and repayments.'],
    inbox: ['Human resources', 'Request Inbox', 'Review staff requests and keep decisions documented.'],
    branches: ['People', 'Staff & Security', 'Manage employment details and branch assignments.'],
    products: ['Menu', 'Menu & Recipes', 'Edit prices, recipes, images, and margins in one workspace.'],
    dispatch: ['Operations', 'Dispatch Stock', 'Prepare deliveries and follow stock requests across branches.'],
    riders: ['Operations', 'Fleet & Riders', 'Keep rider assignments and delivery accounts organized.'],
    zreadings: ['Reports', 'Z-Reading Reports', 'Review completed shifts and cashier declarations.'],
    history: ['Reports', 'Sales History', 'Find receipts and review sales across your branches.'],
    expenses: ['Finance', 'Expense & Restock Feed', 'Review spending, purchases, and restock activity.'],
    sop: ['Operations', 'SOP Manager', 'Maintain procedures and review branch compliance.'],
    menu: ['Menu', 'Menu & Recipes', 'Edit prices, recipes, images, and margins in one workspace.'],
    posconfig: ['Configuration', 'POS Config Hub', 'Manage cashier settings and the layout of the POS.'],
    customerapp: ['Configuration', 'Customer App Hub', 'Manage the customer menu and ordering experience.'],
    equipment: ['Operations', 'Assets & Equipment', 'Track company equipment and asset records.'],
    inventory: ['Inventory', 'Live Inventory', 'Review branch stock, audits, and inventory activity.'],
    purchases: ['Inventory', 'Purchases & Alerts', 'Review purchase needs and low stock alerts.'],
    alerts: ['Operations', 'Security Alerts', 'Review incidents and activity requiring attention.'],
    bulletin: ['Communication', 'Bulletin & AI', 'Share branch updates and review business insights.'],
    franchise: ['Planning', 'Franchise Simulator', 'Explore franchise packages, setup costs, and projections.'],
    addons: ['Menu', 'Global Add-Ons', 'Maintain the extras available across your menu.'],
    admin: ['Configuration', 'Access Control', 'Manage existing staff access and branch permissions.']
});

const INVENTORY_PAGES = Object.freeze({
    Overview: 'Live Stocks', AIBrief: 'Chief Executive Brief', Yield: 'Yield Cost Calculator',
    Audits: 'Audits & Accuracy', Waste: 'Waste & Spoilage', Prep: 'Prep Batch Logs',
    StockLogs: 'Stock History', Invoices: 'Restock Invoices', Forecaster: 'Forecaster', Alerts: 'Low Stock Alerts'
});

export function managerPageMeta(viewId, { inventoryTab, hrTab } = {}) {
    const page = MANAGER_PAGES[viewId] || ['Workspace', 'Manager Workspace', 'Manage your TAKODEÁL business.'];
    const [section, originalTitle, description] = page;
    const title = viewId === 'inventory' ? (INVENTORY_PAGES[inventoryTab] || originalTitle)
        : viewId === 'payroll' && hrTab === 'Sanctions' ? 'Disciplinary Actions' : originalTitle;
    return { section, title, description, tabTitle: `${title} · TAKODEÁL Manager` };
}

// Existing inline styles use several generations of palettes. Classify only
// their decorative surfaces; keep danger colors and selection indicators intact.
export function themeTone(color = '') {
    const normalized = color.toLowerCase().replace(/\s/g, '');
    if (/#(?:ef4444|dc2626|b91c1c|be123c|f43f5e)|rgb\((?:239,68,68|220,38,38|185,28,28|190,18,60)/.test(normalized)) return 'danger';
    if (/#(?:0ea5e9|0284c7|2563eb|3b82f6|0f766e|10b981|16a34a|059669|8b5cf6|6366f1|d97706|f59e0b)|rgb\((?:14,165,233|2,132,199|37,99,235|59,130,246|15,118,110|16,185,129|22,163,74|5,150,105|139,92,246|99,102,241|217,119,6|245,158,11)/.test(normalized)) return 'primary';
    if (/#(?:0f172a|1e293b|111827|020617)|rgb\((?:15,23,42|30,41,59|17,24,39|2,6,23)/.test(normalized)) return 'dark';
    return 'neutral';
}

export function initManagerTheme({ document: d = document, window: w = window, onViewChange = () => {} } = {}) {
    if (d.body.dataset.managerTheme) return;
    d.body.dataset.managerTheme = '20261003';
    d.body.classList.add('manager-theme');
    let lastView = '', lastPage = '', queued = false;
    const seen = new WeakSet();
    function decorate(root) {
        if (!root?.querySelectorAll) return;
        const nodes = [root, ...root.querySelectorAll('div[style],section[style],article[style],button,table')];
        for (const el of nodes) {
            if (!el.matches || seen.has(el) || !el.closest('.view')) continue;
            // Preserve the dashboard design and all printable/exportable documents.
            if (el.closest('#view-dashboard,#printablePayslip,#proposalContainer,.modal,.overlay,dialog')) continue;
            seen.add(el);
            const s = el.style;
            if (el.matches('table')) {
                // Reuse the app's existing mobile table wrapper; keep parent/sibling
                // relationships that legacy filter and export handlers depend on.
                el.classList.add('theme-table');
                continue;
            }
            if (el.matches('button')) {
                // Tab colors may change later, so don't freeze their state into a tone.
                if (!el.matches('.tab-btn,[role="tab"]') && !/^tab|^btnTab/i.test(el.id)) {
                    const tone = themeTone(s.background || s.backgroundColor);
                    if (tone !== 'neutral') el.classList.add(`theme-button-${tone}`);
                }
                continue;
            }
            if (s.gridTemplateColumns) el.classList.add('theme-grid');
            if (s.display === 'flex' && (s.gap || s.justifyContent === 'space-between') && s.flexDirection !== 'column') el.classList.add('theme-flex');
            if (s.borderRadius && s.padding && (s.background || s.backgroundColor) && !['absolute','fixed'].includes(s.position)) {
                const tone = themeTone(s.background || s.backgroundColor);
                el.classList.add((tone === 'dark' || (tone === 'primary' && /white|#fff|rgb\(255/.test(s.color))) ? 'theme-hero' : 'theme-surface');
                if (tone === 'danger' || /#(?:fef2f2|fff1f2|fee2e2)|rgb\((?:254, 242, 242|255, 241, 242|254, 226, 226)\)/i.test(s.background)) el.classList.add('theme-surface-danger');
            }
            if (s.borderBottom && el.querySelector('h2,h3') && s.padding) el.classList.add('theme-panel-heading');
        }
    }
    function sync() {
        const active = d.querySelector('.main-content > .view.active');
        if (!active) return;
        const view = active.id.replace(/^view-/, '');
        const hrTab = d.querySelector('#hrSubmenu .nav-subitem.active')?.id.replace('subnav-', '');
        const inventoryTab = d.querySelector('#invSubmenu .nav-subitem.active')?.id.replace('subnav-', '') || 'Overview';
        const meta = managerPageMeta(view, { hrTab, inventoryTab });
        const pageKey = `${view}:${meta.title}`;
        if (pageKey !== lastPage) {
            lastPage = pageKey;
            d.querySelector('.sidebar')?.classList.remove('show-mobile');
            const overlay = d.getElementById('mobileSidebarOverlay');
            if (overlay) overlay.style.display = 'none';
        }
        for (const [id, value] of Object.entries({pageTitle: meta.title, managerPageSection: meta.section, managerPageDescription: meta.description})) {
            const el = d.getElementById(id);
            if (el && el.textContent !== value) el.textContent = value;
        }
        if (d.title !== meta.tabTitle) d.title = meta.tabTitle;
        d.body.classList.toggle('dashboard-open', view === 'dashboard');
        d.body.dataset.managerView = view;
        const dates = d.getElementById('globalDateControls');
        if (dates) dates.hidden = !['dashboard', 'accounts', 'payroll', 'dispatch'].includes(view) || meta.title === 'Disciplinary Actions';
        // These two actions operate on Dashboard data, so keep them in its header.
        for (const id of ['dashBranchFilter','btnRefreshData','btnExportSales','btnWipeData']) {
            const el = d.getElementById(id); if (el) el.hidden = view !== 'dashboard';
        }
        const navId = ['payroll','schedule','ledger','inbox'].includes(view) ? 'nav-payroll'
            : view === 'addons' ? 'nav-products' : `nav-${view}`;
        if (d.getElementById(navId)) {
            d.querySelectorAll('.sidebar .nav-item').forEach(el => {
                const selected = el.id === navId;
                if (el.classList.contains('active') !== selected) el.classList.toggle('active', selected);
            });
        }
        d.querySelectorAll('.sidebar .nav-item,.sidebar .nav-subitem').forEach(el => {
            if (el.classList.contains('active')) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        });
        d.querySelector('.mobile-menu-btn')?.setAttribute('aria-expanded', String(d.querySelector('.sidebar')?.classList.contains('show-mobile') || false));
        decorate(active);
        if (view !== lastView) { lastView = view; onViewChange(view); }
    }
    const queue = () => { if (!queued) { queued = true; w.requestAnimationFrame(() => { queued = false; sync(); }); } };
    // Watch existing routes, including inventory navigation that bypasses switchView.
    const observer = new w.MutationObserver(records => {
        for (const r of records) {
            if (r.type === 'childList') {
                for (const node of r.addedNodes) if (node.nodeType === 1) decorate(node);
                queue();
            } else if (r.target.matches('.view,.sidebar,.nav-item,.nav-subitem,.tab-btn')) queue();
        }
    });
    observer.observe(d.querySelector('.main-content'), {subtree:true, childList:true, attributes:true, attributeFilter:['class']});
    observer.observe(d.querySelector('.sidebar'), {subtree:true, attributes:true, attributeFilter:['class']});
    d.querySelectorAll('.view').forEach(decorate);
    sync();
    return { sync, stop: () => observer.disconnect() };
}
