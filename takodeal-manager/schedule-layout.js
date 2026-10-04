// Presentation only: use the existing schedule cells and their editing actions.
// No assignments, availability records or payroll rules are changed here.
const views = new Map();
function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function copyCell(cell) {
    const box = element('div', 'schedule-assignment');
    for (const child of cell.childNodes) box.appendChild(child.cloneNode(true));
    // The original badges have inline edit actions. Expose those same actions
    // as keyboard-accessible buttons in the comfortable view.
    box.querySelectorAll('span[onclick]').forEach(span => {
        const button = element('button', span.className);
        button.type = 'button';
        for (const attr of span.attributes) button.setAttribute(attr.name, attr.value);
        while (span.firstChild) button.appendChild(span.firstChild);
        span.replaceWith(button);
    });
    return box;
}
export function enhanceScheduleLayout(container, branch) {
    const table = container.querySelector('.sched-table');
    if (!table?.tHead || !table.tBodies[0]) return;
    const headers = [...table.tHead.rows[0].cells];
    const shiftEnd = headers.length - 3;
    const cards = element('div', 'schedule-days');
    cards.setAttribute('aria-label', `${branch} daily schedule`);
    for (const row of table.tBodies[0].rows) {
        const cells = [...row.cells];
        const article = element('article', 'schedule-day');
        const date = element('header', 'schedule-day-date');
        date.appendChild(element('small', '', 'WORKDAY'));
        date.appendChild(element('strong', '', cells[0].textContent));
        article.appendChild(date);
        const shifts = element('div', 'schedule-shifts');
        for (let i = 1; i < shiftEnd; i++) {
            const shift = element('section', 'schedule-shift');
            shift.appendChild(element('div', 'schedule-shift-title', headers[i].textContent));
            shift.appendChild(copyCell(cells[i]));
            shifts.appendChild(shift);
        }
        article.appendChild(shifts);
        const availability = element('aside', 'schedule-availability');
        for (let i = shiftEnd; i < headers.length; i++) {
            const status = element('section', 'schedule-status');
            status.appendChild(element('div', 'schedule-status-title', headers[i].textContent));
            const value = copyCell(cells[i]);
            if (!value.textContent.trim() || value.textContent.trim() === '-') value.textContent = 'None';
            status.appendChild(value);
            availability.appendChild(status);
        }
        article.appendChild(availability);
        cards.appendChild(article);
    }
    const grid = table.parentElement;
    grid.classList.add('schedule-month-scroll');
    grid.setAttribute('tabindex', '0');
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', `${branch} monthly schedule. Scroll to see all columns.`);
    const toolbar = element('div', 'schedule-layout-tools');
    const description = element('p', '', 'Every shift and staff status, with room to read.');
    const choices = element('div', 'schedule-view-buttons');
    const comfortable = element('button', '', 'Comfortable view');
    const month = element('button', '', 'Month grid');
    comfortable.type = month.type = 'button';
    const arrows = element('div', 'schedule-grid-navigation');
    const left = element('button', '', '← Earlier columns');
    const right = element('button', '', 'Later columns →');
    left.type = right.type = 'button';
    left.onclick = () => grid.scrollBy({ left: -Math.max(300, grid.clientWidth * .7), behavior: 'smooth' });
    right.onclick = () => grid.scrollBy({ left: Math.max(300, grid.clientWidth * .7), behavior: 'smooth' });
    arrows.append(left, right);
    function setView(view) {
        views.set(branch, view);
        cards.hidden = view !== 'comfortable';
        grid.hidden = view !== 'grid';
        arrows.hidden = view !== 'grid';
        comfortable.setAttribute('aria-pressed', String(view === 'comfortable'));
        month.setAttribute('aria-pressed', String(view === 'grid'));
    }
    comfortable.onclick = () => setView('comfortable');
    month.onclick = () => setView('grid');
    choices.append(comfortable, month);
    toolbar.append(description, choices);
    container.prepend(toolbar, arrows, cards);
    setView(views.get(branch) || 'comfortable');
}
