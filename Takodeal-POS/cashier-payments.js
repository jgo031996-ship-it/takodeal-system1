// Presentation only. Method names remain identical to the Manager configuration.
export function paymentMethods(settings = {}) {
  const source = Array.isArray(settings.payMethods) ? settings.payMethods : settings.paymentMethods;
  const seen = new Set();
  const methods = (Array.isArray(source) ? source : []).filter(value => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const key = value.trim().toLowerCase();
    if (seen.has(key) || key === 'split') return false;
    seen.add(key); return true;
  }).map(value => value.trim());
  return methods.length ? methods : ['Cash', 'GCash', 'Bank'];
}

export function paymentKind(method) {
  const value = String(method).toLowerCase().replace(/[\s-]/g, '');
  if (value === 'cash') return 'cash';
  if (value.includes('gcash')) return 'gcash';
  if (value.includes('grab')) return 'grab';
  if (value.includes('panda')) return 'foodpanda';
  if (/bank|bpi|bdo|gotyme|union|metro/.test(value)) return 'bank';
  return 'wallet';
}

function icon(method, document) {
  const node = document.createElement('span'); node.className = 'cashier-payment-icon'; node.setAttribute('aria-hidden', 'true');
  if (paymentKind(method) === 'gcash') {
    const image = document.createElement('img'); image.src = 'assets/gcash.svg'; image.alt = ''; node.append(image);
  } else {
    const path = paymentKind(method) === 'cash' ? 'M3 6h18v12H3z M7 10h1 M16 14h1 M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6'
      : paymentKind(method) === 'bank' ? 'M3 9l9-6 9 6H3z M5 10v9 M10 10v9 M14 10v9 M19 10v9 M3 21h18'
      : 'M3 6h18v14H3z M3 10h18 M15 15h3';
    node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
  }
  return node;
}

export function renderPayments(settings = {}, w = window) {
  const d = w.document, grid = d.querySelector('#checkoutModal .payment-grid');
  if (!grid) return;
  const configured = paymentMethods(settings);
  const partner = ['Grab', 'Foodpanda'].includes(w.posPlatform) ? w.posPlatform : null;
  const methods = partner ? [partner] : configured;
  const before = w.selectedPaymentMethod;
  let split = d.getElementById('splitPaymentContainer');
  if (!split) {
    split = d.createElement('div'); split.id = 'splitPaymentContainer'; split.style.display = 'none';
    split.innerHTML = '<strong>Split payment</strong><div class="cashier-split-row"><label>First method<select id="splitMethod1"></select></label><label>Amount (₱)<input id="splitAmount1" type="number" min="0" step="0.01" inputmode="decimal"></label></div><div class="cashier-split-row"><label>Second method<select id="splitMethod2"></select></label><label>Amount (₱)<input id="splitAmount2" type="number" min="0" step="0.01" inputmode="decimal"></label></div><div id="splitRemainingAlert" role="status"></div>';
    grid.after(split);
    split.querySelectorAll('input').forEach(input => input.addEventListener('input', () => w.calcSplitRemaining?.()));
  }
  const validSplit = before === 'Split' && split.style.display !== 'none' && !partner && configured.length > 1
    && ['splitMethod1','splitMethod2'].every(id => configured.includes(d.getElementById(id).value));
  const chosen = partner || (validSplit ? 'Split' : methods.find(method => method.toLowerCase() === String(before).toLowerCase()))
    || methods.find(method => paymentKind(method) === 'cash') || methods[0];
  w.selectedPaymentMethod = chosen;
  if (!validSplit) split.style.display = 'none';
  for (const [index, id] of ['splitMethod1', 'splitMethod2'].entries()) {
    const select = d.getElementById(id), previous = select.value;
    select.replaceChildren(...configured.map(method => { const option = d.createElement('option'); option.value = method; option.textContent = method; return option; }));
    select.value = configured.includes(previous) ? previous : configured[Math.min(index, configured.length - 1)];
  }
  const selectMethod = (button, method) => {
    if (partner) return;
    const wasCash = paymentKind(w.selectedPaymentMethod) === 'cash';
    split.style.display = 'none';
    if (paymentKind(method) === 'cash' && !wasCash) w.amountReceivedStr = '0';
    if (typeof w.setPaymentMethod === 'function') w.setPaymentMethod(button, method);
    else { w.selectedPaymentMethod = method; grid.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button)); }
    grid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    w.updateNumpadDisplay?.();
  };
  const buttons = methods.map(method => {
    const button = d.createElement('button'); button.type = 'button'; button.className = 'pay-btn cashier-payment-card';
    button.dataset.paymentMethod = method; button.dataset.paymentKind = paymentKind(method);
    button.classList.toggle('active', method === chosen); button.setAttribute('aria-pressed', String(method === chosen));
    button.setAttribute('aria-label', method + (partner ? ' platform payment' : ' payment')); button.disabled = !!partner;
    const text = d.createElement('span'); text.textContent = method;
    button.append(icon(method, d), text); button.addEventListener('click', () => selectMethod(button, method)); return button;
  });
  if (!partner && configured.length > 1) {
    const button = d.createElement('button'); button.type = 'button'; button.className = 'pay-btn cashier-payment-card split-btn'; button.textContent = 'Split payment';
    button.classList.toggle('active', validSplit); button.setAttribute('aria-pressed', String(validSplit));
    button.addEventListener('click', () => {
      if (split.style.display !== 'none') { selectMethod(buttons.find(b => b.dataset.paymentMethod === configured[0]), configured[0]); return; }
      split.style.display = 'block'; w.selectedPaymentMethod = 'Split';
      grid.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      w.calcSplitRemaining?.();
    }); buttons.push(button);
  }
  grid.replaceChildren(...buttons); grid.style.display = 'grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Payment methods');
  // Choose a method before entering tender. Keep these controls visible first
  // on tablets instead of placing them below the entire number pad.
  const area = d.getElementById('standardPaymentArea'), heading = area?.querySelector('.section-title');
  if (area && heading) area.prepend(heading, grid, split);
  if (chosen !== before && before != null) {
    w.amountReceivedStr = paymentKind(chosen) === 'cash' ? '0' : String(w.finalCheckoutAmount ?? w.currentGrandTotal ?? 0);
    w.updateNumpadDisplay?.();
  }
}

export function installPayments(w = window) {
  const updateNumpad = w.updateNumpadDisplay;
  const updateSplitStatus = () => {
    const a = Number(w.document.getElementById('splitAmount1')?.value) || 0;
    const b = Number(w.document.getElementById('splitAmount2')?.value) || 0;
    const total = a + b, payable = w.finalCheckoutAmount ?? w.currentGrandTotal ?? 0;
    const status = w.document.getElementById('splitRemainingAlert');
    if (status) {
      status.textContent = `Entered: ₱${total.toFixed(2)} · Remaining: ₱${Math.max(0, payable-total).toFixed(2)}`;
      status.style.color = a < 0 || b < 0 || Math.abs(total-payable) > .01 ? '#b45309' : '#08783b';
    }
    const button = w.document.getElementById('btnSubmitFinal');
    if (button && (a < 0 || b < 0 || Math.abs(total-payable) > .01)) {
      button.disabled = true; button.textContent = 'Split amounts must match the total';
    }
  };
  w.updateNumpadDisplay = function(...args) {
    const result = updateNumpad?.apply(this, args);
    if (w.selectedPaymentMethod === 'Split') updateSplitStatus();
    return result;
  };
  w.calcSplitRemaining = () => {
    const a = Number(w.document.getElementById('splitAmount1')?.value) || 0;
    const b = Number(w.document.getElementById('splitAmount2')?.value) || 0;
    w.amountReceivedStr = String(a + b);
    w.updateNumpadDisplay();
  };
  w.renderCashierPayments = () => {
    let settings = w.masterPOSData?.settings || {};
    if (!settings.payMethods?.length && !settings.paymentMethods?.length) {
      try { settings = JSON.parse(w.localStorage.getItem('takodeal_cached_settings') || '{}'); } catch { /* Use initial defaults until configuration loads. */ }
    }
    renderPayments(settings || {}, w);
  };
  w.renderCashierPayments();
}
