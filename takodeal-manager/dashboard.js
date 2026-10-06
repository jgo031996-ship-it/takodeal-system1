import { money, number, escapeHTML as esc, milliseconds, businessDay, calendarDay, dayStart, addDays,
    dateRange, scopedSales, salesSummary, paymentParts, onDuty, dutyAttendance, branchPerformance, productReport, ballAudit } from './dashboard-data.js';
import { countBalls } from './pos-safety.js';

// One dashboard owns its subscriptions. No payroll, stock, sale, or counter writes occur here.
export function createDashboard(w = window, d = document) {
    let generation = 0, stops = [], key = '', state = {}, reportGeneration = 0;
    const cache = new Map();
    const el = id => d.getElementById(id);
    const text = (id, value) => { if (el(id)) el(id).textContent = value; };
    const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const collection = name => w.collection(w.db, name);
    const doc = name => w.doc(w.db, 'settings', name);
    const accountScope = () => JSON.stringify([w.auth?.currentUser?.uid, w.sessionUser?.uid, w.sessionUser?.email,
        w.sessionUser?.permissions, w.sessionUser?.allowedBranches, w.sessionUser?.isFranchisee]);
    const allowed = b => typeof w.isBranchAllowed !== 'function' || w.isBranchAllowed(b);
    function stop() { generation++; stops.splice(0).forEach(off => off()); key = ''; }
    function visible() { return el('view-dashboard')?.classList.contains('active'); }
    function message() {
        const problems = Object.values(state.errors || {});
        text('dashDataStatus', problems.length ? 'Attention needed' : Object.values(state.cached || {}).some(Boolean) ? 'Cached data · reconnecting' : state.sales ? 'Live updates' : 'Connecting…');
        const banner = el('dashDataMessage');
        if (banner) { banner.hidden = !problems.length; banner.textContent = problems.join(' · '); }
    }
    function watch(name, ref, render, current) {
        const timer = setTimeout(() => {
            if (current !== generation) return;
            state.errors[name] = name + ': connection is taking longer than expected. Use Refresh to retry.'; message();
            if (name === 'Sales') productError('Sales connection timed out. Use Refresh to retry.');
            renderOperations();
        }, 15000);
        let off;
        try {
            off = w.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
                if (current !== generation) return;
                clearTimeout(timer); delete state.errors[name]; state.cached[name] = snap.metadata?.fromCache === true;
                try { render(snap); } catch (e) { state.errors[name] = name + ': ' + e.message; }
                message();
            }, error => {
                if (current !== generation) return;
                clearTimeout(timer); state.errors[name] = name + ': ' + error.message; message();
                if (name === 'Sales') productError('Sales could not load. Use Refresh to retry.');
                renderOperations();
            });
        } catch (error) { clearTimeout(timer); state.errors[name] = name + ': ' + error.message; message(); }
        stops.push(() => { clearTimeout(timer); off?.(); });
    }
    async function read(name, force = false) {
        // Reference rows share the same scoped cache as Menu and Inventory. Financial
        // reports remain live subscriptions; an explicit Refresh invalidates references.
        const shared = typeof w.fetchCachedCollection === 'function';
        if (shared && force) await w.invalidateCache?.(name);
        const cacheKey = accountScope() + '/' + name, entry = cache.get(cacheKey);
        if (!shared && !force && entry && Date.now() - entry.at < 60000) return entry.promise;
        let timeout;
        const promise = Promise.race([
            shared ? w.fetchCachedCollection(name) : w.getDocs(collection(name)).then(rows),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(name + ' could not load. Check your connection and refresh.')), 15000); })
        ]).finally(() => clearTimeout(timeout)).catch(error => {
            if (cache.get(cacheKey)?.promise === promise) cache.delete(cacheKey);
            throw error;
        });
        if (!shared) cache.set(cacheKey, { at: Date.now(), promise });
        return promise;
    }
    async function load({ force = false } = {}) {
        if (!w.db || !w.sessionUser || !visible()) return;
        d.body.classList.add('dashboard-open');
        const today = businessDay(Date.now());
        if (!el('dashStartDate').value) el('dashStartDate').value = today;
        if (!el('dashEndDate').value) el('dashEndDate').value = today;
        if (!el('dashBranchFilter')) {
            const select = d.createElement('select'); select.id = 'dashBranchFilter'; select.setAttribute('aria-label', 'Dashboard branch');
            select.innerHTML = '<option value="All">All branches</option>'; select.onchange = () => load();
            el('globalDateControls').prepend(select);
            w.injectDynamicBranchDropdowns?.();
        }
        const filter = el('dashBranchFilter');
        let branch = filter.value || 'All';
        if (w.sessionUser.isFranchisee && !allowed(branch) && branch !== 'All') branch = 'All';
        const dates = { start: el('dashStartDate').value, end: el('dashEndDate').value };
        let range;
        try { range = dateRange(dates.start, dates.end); }
        catch (error) { text('dashDataMessage', error.message); el('dashDataMessage').hidden = false; return; }
        const nextKey = JSON.stringify([branch, dates, today, accountScope()]);
        if (key === nextKey && !force) return;
        stop(); key = nextKey; const current = generation;
        state = { branch, dates, range, today, errors: {}, cached: {}, ready: {}, shifts: [], attendance: [], expenses: [], profiles: {} };
        text('dashScope', branch === 'All' ? 'Across your branches' : branch);
        text('dashPeriod', dates.start === dates.end ? dates.start : dates.start + ' — ' + dates.end);
        text('dashProductStatus', 'Loading sales and recipe costs…');
        el('dashProductAnalyticsBody').innerHTML = '<tr><td colspan="7" class="dash-empty">Loading product report…</td></tr>';
        message();
        try {
            const branches = await read('branches', force);
            if (current !== generation) return;
            state.branches = (branches.length ? branches.map(b => b.name).filter(Boolean) : w.globalActiveBranches || []).filter(allowed);
            if (branch !== 'All' && !state.branches.includes(branch)) throw new Error('This branch is outside your access.');
            const oldBranch = branch;
            filter.innerHTML = (state.branches.length > 1 || !w.sessionUser.isFranchisee ? '<option value="All">All branches</option>' : '') + state.branches.map(b => '<option value="'+esc(b)+'">'+esc(b)+'</option>').join('');
            if (oldBranch === 'All' && filter.querySelector('option[value="All"]')) filter.value = 'All';
            else if (state.branches.includes(oldBranch)) filter.value = oldBranch;
            filter.disabled = w.sessionUser.isFranchisee && state.branches.length === 1;
            if (filter.value !== branch) { key = ''; return load(); }
            state.scope = branch === 'All' ? state.branches : [branch];
            state.operatingBranches = state.scope.filter(b => b !== 'Main Office' || branch === b);
            // A single date query supplies KPIs, charts, products, monthly target, and live shifts.
            const monthStart = new Date(calendarDay().slice(0,7) + '-01T00:00:00+08:00');
            const lookback = dayStart(addDays(today, -3));
            state.chartStart = dates.start > addDays(dates.end, -6) ? addDays(dates.end, -6) : dates.start;
            const start = new Date(Math.min(+range.start, +dayStart(state.chartStart), +monthStart, +lookback));
            const end = new Date(Math.max(+range.end, +dayStart(addDays(today,1))));
            const constraints = [w.where('timestamp', '>=', start), w.where('timestamp', '<', end)];
            if (branch !== 'All') constraints.unshift(w.where('branch', '==', branch));
            watch('Sales', w.query(collection('transactions'), ...constraints), snap => {
                state.sales = rows(snap); renderSales(); renderOperations();
            }, current);
            watch('Shifts', w.query(collection('shifts'), w.where('startTime', '>=', lookback)), snap => { state.shifts = rows(snap); state.ready.shifts = true; renderOperations(); }, current);
            watch('Attendance', w.query(collection('attendance_logs'), w.where('timestamp', '>=', lookback)), snap => { state.attendance = rows(snap); state.ready.attendance = true; renderOperations(); }, current);
            watch('Schedule', doc('global_schedule'), snap => { state.schedule = snap.exists() ? snap.data() : null; state.ready.schedule = true; renderOperations(); }, current);
            watch('Staff profiles', collection('cashiers'), snap => {
                state.profiles = Object.fromEntries(rows(snap).filter(p => p.cashierName).map(p => [p.cashierName, p]));
                state.ready.profiles = true; renderOperations();
            }, current);
            watch('Expenses', w.query(collection('expenses'), w.where('timestamp', '>=', lookback)), snap => { state.expenses = rows(snap); state.ready.expenses = true; renderOperations(); }, current);
            watch('Ball counter', doc('global_stats'), snap => { state.stats = snap.exists() ? snap.data() : {}; renderCounter(); }, current);
            watch('Monthly target', doc('sales_target'), snap => { state.target = snap.exists() ? snap.data() : {}; renderTarget(); }, current);
            const resources = await Promise.allSettled(['inventory','bom','menu'].map(name => read(name, force)));
            if (current !== generation) return;
            ['inventory','bom','menu'].forEach((name, i) => {
                const r = resources[i];
                if (r.status === 'fulfilled') state[name] = r.value;
                else state.errors[name] = r.reason.message;
            });
            renderProducts(); renderCharts(); message();
        } catch (error) {
            if (current !== generation) return;
            state.errors.setup = error.message; productError('Report unavailable. Use Refresh to retry.'); message();
        }
    }
    function periodSales() { return scopedSales(state.sales || [], state.scope || [], state.range.start, state.range.end); }
    function renderSales() {
        const summary = salesSummary(periodSales());
        text('dashNetSales', money(summary.net)); text('dashOrders', summary.orders.toLocaleString()); text('dashAverage', money(summary.average));
        text('dashDigital', money(summary.payments.gcash + summary.payments.grab + summary.payments.foodpanda + summary.payments.other));
        text('dashGrabGross', money(summary.payments.grab)); text('dashFpGross', money(summary.payments.foodpanda));
        text('dashUpdated', 'Updated ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour:'2-digit', minute:'2-digit' }));
        renderCharts(); renderProducts(); renderTarget();
    }
    function renderOperations() {
        if (!state.scope) return;
        const staff = onDuty(state.attendance, state.scope);
        text('dashDutyCount', staff.filter(s => !s.needsReview).length + ' staff on duty');
        text('dashActiveCount', state.shifts.filter(s => state.operatingBranches.includes(s.branch) && s.active && s.status !== 'Closed').length + ' active shifts');
        el('branchTableBody').innerHTML = state.operatingBranches.map(branch => {
            const p = branchPerformance(branch, state.shifts, state.sales || [], state.expenses, state.today);
            const team = staff.filter(s => s.branch === branch);
            const known = state.sales && state.ready.shifts && state.ready.expenses && !state.errors.Sales && !state.errors.Shifts && !state.errors.Expenses;
            const staffHTML = team.map(s => {
                const detail = dutyAttendance(s, state.ready.profiles ? state.schedule : null, state.profiles);
                const late = detail.lateMinutes > 0 && !detail.lateExempted;
                const status = detail.lateExempted ? '<span class="dash-staff-status exempt">Late exempted</span>'
                    : late ? `<span class="dash-staff-status late">Late · ${esc(detail.lateMinutes)} min</span>`
                    : detail.lateMinutes == null && (state.errors.Schedule || state.errors['Staff profiles']) ? '<span class="dash-staff-status review">Late status unavailable</span>'
                    : detail.lateMinutes == null && (!state.ready.schedule || !state.ready.profiles) ? '<span class="dash-muted">Checking schedule…</span>' : '';
                const clock = detail.dateTime ? `<time datetime="${esc(detail.dateTime)}" title="${esc(detail.date + (detail.scheduledStart ? ' · Scheduled ' + detail.scheduledStart : ''))}">${esc(detail.clockIn)}</time>` : esc(detail.clockIn);
                return `<div class="dash-staff ${late ? 'late' : s.needsReview ? 'review' : ''}"><span class="dash-staff-name">${esc(s.staffName || s.staffId)}</span><div class="dash-staff-detail"><span class="dash-staff-clock">In · ${clock}</span>${status}${s.needsReview ? '<span class="dash-staff-status review">Check time out · over 16h</span>' : ''}</div></div>`;
            }).join('') || '<span class="dash-muted">No active time punches</span>';
            return `<tr><td><button type="button" class="dash-branch" data-branch="${esc(branch)}">${esc(branch)} <span>↗</span></button><small>${esc(p.shift?.cashier?.split('/').pop().trim() || 'No cashier assigned')}</small></td>
                <td><span class="dash-badge ${p.state === 'Active' ? 'live' : ''}">${p.state}</span>${p.stale ? '<small>Earlier shift · review</small>' : ''}</td>
                <td class="dash-team">${state.errors.Attendance ? 'Attendance unavailable' : !state.ready.attendance ? 'Connecting…' : staffHTML}</td>
                <td>${p.shift ? money(p.shift.startingCash) : '—'}</td><td class="dash-amount">${known && p.net != null ? money(p.net) : '—'}</td>
                <td>${known && p.expenses != null ? money(p.expenses) : '—'}</td><td>${known && p.expected != null ? money(p.expected) : '—'}<small>${p.state === 'Closed' ? 'Saved Z-reading' : p.state === 'Active' ? 'Starting cash + cash sales − expenses' : ''}</small></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="dash-empty">No branches in your access.</td></tr>';
        el('branchTableBody').querySelectorAll('[data-branch]').forEach(b => b.onclick = () => w.openBranchDetails(b.dataset.branch));
    }
    function renderCounter() {
        const stats = state.stats || {};
        const restricted = w.sessionUser?.isFranchisee && !w.sessionUser?.isOwner;
        const total = state.branch !== 'All' ? number(stats['balls_' + state.branch]) : restricted ? state.scope.reduce((n,b) => n + number(stats['balls_' + b]),0) : number(stats.totalTakoyakiBalls);
        text('milestoneCounter', total.toLocaleString());
        text('dashBallScope', state.branch === 'All' && !restricted ? 'All-time · all branches' : 'All-time · ' + state.scope.join(', '));
        text('dashBallPercent', (total / 10000).toFixed(1) + '% of 1 million');
        el('dashBallProgress').style.width = Math.min(100, Math.max(0,total / 10000)) + '%';
    }
    function renderTarget() {
        if (!state.sales || !state.target) return;
        const current = calendarDay(), month = current.slice(0,7);
        const first = new Date(month + '-01T00:00:00+08:00');
        const todayEnd = new Date(Date.now()+1);
        const sums = salesSummary(scopedSales(state.sales, state.scope, first, todayEnd));
        const mtd = sums.net - sums.payments.grab * .18;
        const restricted = w.sessionUser?.isFranchisee && !w.sessionUser?.isOwner;
        const goal = state.branch !== 'All' ? number(state.target[state.branch]) : restricted ? state.scope.reduce((n,b) => n + number(state.target[b]),0) : number(state.target.amount);
        const daysInMonth = new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
        const day = Number(current.slice(8)), left = daysInMonth-day+1, percent = goal > 0 ? mtd/goal*100 : 0;
        text('targetGoalAmount', money(goal)); text('targetMtdSales', 'Month to date: ' + money(mtd));
        text('targetProgressText', percent.toFixed(1) + '%'); el('targetProgressBar').style.width = Math.max(0,Math.min(100,percent)) + '%';
        text('targetStatusText', goal <= 0 ? 'Set a target' : mtd >= goal ? 'Target reached' : mtd < goal/daysInMonth*day ? 'Below pace' : 'On pace');
        text('targetPaceText', 'After the existing 18% Grab adjustment'); text('targetRequiredDaily', money(Math.max(0,goal-mtd)/left)); text('targetDaysLeft', left + ' days remaining');
    }
    function renderCharts() {
        if (!state.sales || !w.Chart) return;
        const filters = w.chartFilters || { cash:true, gcash:true, grab:true, foodpanda:true };
        const palette = ['#0f766e','#e89729','#719ac4','#ad87bd','#8da44c','#526073'];
        const labels = [];
        const span = (Date.parse(state.dates.end)-Date.parse(state.chartStart))/86400000;
        const monthly = span > 62;
        for (let day = state.chartStart; day <= state.dates.end; day = addDays(day,1)) {
            const k = monthly ? day.slice(0,7) : day;
            if (!labels.includes(k)) labels.push(k);
        }
        const chartSales = scopedSales(state.sales,state.scope,dayStart(state.chartStart),state.range.end);
        const totals = new Map();
        for (const tx of chartSales) {
            const day = monthly ? businessDay(tx.timestamp).slice(0,7) : businessDay(tx.timestamp);
            const key = tx.branch + '\0' + day;
            totals.set(key, (totals.get(key) || 0) + paymentParts(tx).filter(p=>filters[p.method] !== false).reduce((n,p)=>n+p.amount,0));
        }
        const datasets = state.scope.map((branch, idx) => ({ label:branch, data: labels.map(day=>totals.get(branch+'\0'+day)||0), borderColor:palette[idx%palette.length], backgroundColor:palette[idx%palette.length]+'10', fill:true, tension:.25, pointRadius:3, borderWidth:2 }));
        text('revenueChartTitle', span < 7 ? '7-day sales trend' : 'Sales trend');
        text('dashChartPeriod', state.chartStart + ' — ' + state.dates.end + ' · Philippine business days');
        for (const [type,id] of Object.entries({cash:'btnFilterCash',gcash:'btnFilterGcash',grab:'btnFilterGrab',foodpanda:'btnFilterFoodpanda'})) el(id)?.setAttribute('aria-pressed', String(filters[type] !== false));
        const options = { responsive:true, maintainAspectRatio:false, animation:false, plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:7, padding:18, font:{size:11} } } }, scales:{ x:{grid:{display:false},ticks:{maxTicksLimit:8,callback:(_,i)=> monthly ? labels[i] : labels[i]?.slice(5)}}, y:{beginAtZero:true,grid:{color:'#eef1ee'},ticks:{maxTicksLimit:5,callback:v=>'₱'+Number(v).toLocaleString()}} } };
        if (w.revenueChartInstance) { w.revenueChartInstance.data = { labels,datasets }; w.revenueChartInstance.options = options; w.revenueChartInstance.update(); }
        else w.revenueChartInstance = new w.Chart(el('revenueTrendChart'), {type:'line',data:{labels,datasets},options});
        const categories = new Map();
        for (const tx of periodSales()) for (const item of tx.cart || []) {
            const category = item.category || state.menu?.find(m=>m.name === (item.realName || item.name))?.category || 'Other products';
            categories.set(category, (categories.get(category)||0) + number(item.qty ?? 1));
        }
        const sorted = [...categories].sort((a,b)=>b[1]-a[1]);
        const mix = {labels:sorted.map(x=>x[0]),datasets:[{data:sorted.map(x=>x[1]),backgroundColor:palette,borderColor:'#fff',borderWidth:4,hoverOffset:3}]};
        const pieOptions = {responsive:true,maintainAspectRatio:false,animation:false,cutout:'76%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,padding:12,font:{size:11}}}}};
        if (w.categoryMixChartInstance) { w.categoryMixChartInstance.data=mix; w.categoryMixChartInstance.update(); }
        else w.categoryMixChartInstance = new w.Chart(el('categoryMixChart'),{type:'doughnut',data:mix,options:pieOptions});
        text('dashMixCount', sorted.reduce((n,x)=>n+x[1],0).toLocaleString());
        text('dashMixEmpty', sorted.length ? '' : 'No paid sales in this period');
    }
    function renderProducts() {
        if (!state.sales) return;
        if (!state.inventory || !state.bom) {
            if (state.errors.inventory || state.errors.bom) { text('dashProductStatus','Recipe costs unavailable. Use Refresh to retry.'); el('dashProductAnalyticsBody').innerHTML='<tr><td colspan="7" class="dash-empty">Could not load recipe costs.</td></tr>'; }
            return;
        }
        const products = productReport(periodSales(),state.inventory,state.bom);
        const bad = products.filter(p=>p.problems.length).length;
        text('dashProductStatus', products.length + ' products · ' + (bad ? bad + ' need a recipe or cost check' : 'Recipe costs available') + ' · selected period');
        renderProductTable('dashProductAnalyticsBody',products);
    }
    function productError(message) {
        text('dashProductStatus', message);
        if (el('dashProductAnalyticsBody')) el('dashProductAnalyticsBody').innerHTML = '<tr><td colspan="7" class="dash-empty">'+esc(message)+'</td></tr>';
    }
    function renderProductTable(id, products) {
        if (!el(id)) return;
        el(id).innerHTML = products.map(p => `<tr><td><strong>${esc(p.name)}</strong>${p.problems.length ? '<small class="dash-warning">'+esc(p.problems.join(' · '))+'</small>' : ''}</td><td>${p.qty}</td><td class="dash-amount">${money(p.sales)}</td><td>${p.cogs == null ? '—' : money(p.cogs)}</td><td>${p.costPercent == null ? '—' : p.costPercent.toFixed(1)+'%'}</td><td>${p.margin == null ? '—' : money(p.margin)}</td><td><span class="dash-badge ${p.problems.length ? 'review' : p.costPercent > 55 ? 'review' : 'live'}">${p.problems.length ? 'Check recipe / cost' : p.costPercent > 55 ? 'High ingredient cost' : p.costPercent < 35 && p.qty >= 5 ? 'Strong margin' : 'Within range'}</span></td></tr>`).join('') || '<tr><td colspan="7" class="dash-empty">No paid sales in this period.</td></tr>';
    }
    async function historyProducts(start,end,branch) {
        const current = ++reportGeneration;
        const tbody = el('historyProductAnalyticsBody'); if (!tbody) return;
        tbody.innerHTML='<tr><td colspan="7" class="dash-empty">Loading product report…</td></tr>';
        try {
            const q = [w.where('timestamp','>=',start),w.where('timestamp','<=',end)];
            if (branch && branch !== 'All') q.unshift(w.where('branch','==',branch));
            const [tx,inventory,bom] = await Promise.all([w.getDocs(w.query(collection('transactions'),...q)).then(rows),read('inventory'),read('bom')]);
            if (current === reportGeneration) renderProductTable('historyProductAnalyticsBody',productReport(tx.filter(t=>allowed(t.branch)),inventory,bom));
        } catch(error) { if (current === reportGeneration) tbody.innerHTML='<tr><td colspan="7">'+esc(error.message)+'</td></tr>'; }
    }
    async function auditCounter() {
        if (!state.scope) return;
        const button = el('dashCheckCounter'); if (button) button.disabled = true;
        try {
            const snap = await (w.getDocsFromServer || w.getDocs)(collection('transactions'));
            const statsSnap = await (w.getDocFromServer || w.getDoc)(doc('global_stats'));
            const stats = statsSnap.exists() ? statsSnap.data() : {};
            const global = state.branch === 'All' && !w.sessionUser.isFranchisee;
            const receipts = rows(snap);
            // Global lifetime totals also include sales from branches later retired from the branch list.
            const auditScope = global ? [...new Set(receipts.map(tx=>tx.branch))] : state.scope;
            const audit = ballAudit(receipts,stats,countBalls,auditScope);
            const html = `<div class="dash-audit"><p>Counted from ${audit.receipts.toLocaleString()} retained paid receipts in your branch selection.</p><dl><dt>Takoyaki balls in retained receipts</dt><dd>${audit.calculated.toLocaleString()}</dd><dt>Recorded receipt counter amounts</dt><dd>${audit.recorded.toLocaleString()}</dd>${global ? '<dt>Saved historical base</dt><dd>'+ (audit.historical == null ? 'Not recorded' : audit.historical.toLocaleString())+'</dd><dt>Current saved total</dt><dd>'+audit.stored.toLocaleString()+'</dd>' : ''}</dl><p>${audit.unknown ? audit.unknown+' item lines need a pack-size check. ' : ''}${global && audit.expected != null ? 'Historical base + retained receipt count: '+audit.expected.toLocaleString()+'. ' : ''}Archived or deleted receipts can prevent a complete comparison. This check does not overwrite the counter.</p></div>`;
            await w.Swal.fire({title:'Takoyaki counter check',html,confirmButtonText:'Done',width:620});
        } catch(error) { await w.Swal.fire('Counter check unavailable',error.message,'warning'); }
        finally { if(button) button.disabled=false; }
    }
    return { load, stop, renderCharts, historyProducts, auditCounter,
        refreshTarget: () => { if (visible()) return load({force:true}); },
        refreshStaff: () => { if (visible()) return load(); } };
}
