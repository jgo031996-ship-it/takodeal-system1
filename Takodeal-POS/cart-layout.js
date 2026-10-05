/* Presentation only. Never changes the cart, prices, quantities, or checkout. */
export const CART_DENSITIES = Object.freeze(['comfortable', 'compact', 'dense']);

export function chooseCartDensity(availableHeight, heights = []) {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return 'comfortable';
  const index = heights.findIndex(height => Number.isFinite(height) && height <= availableHeight + 1);
  return CART_DENSITIES[index >= 0 ? Math.min(index, 2) : 2];
}

export function installCartLayout(document, window) {
  const list = document.getElementById('cartList');
  if (!list || list.dataset.cartLayoutInstalled) return;
  list.dataset.cartLayoutInstalled = 'true';
  const panel = list.closest('.tk-cart-shell'), footer = panel?.lastElementChild;
  if (footer && footer !== list) {
    footer.classList.add('cashier-cart-footer');
    footer.children[0]?.classList.add('cashier-cart-subtotal');
    footer.children[1]?.classList.add('cashier-cart-grand-total');
    footer.children[2]?.classList.add('cashier-cart-secondary-actions');
  }
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      if (!list.clientHeight) return; // Hidden POS keeps its state until it is shown.
      const rows = [...list.children].filter(row => row.children.length >= 5);
      rows.forEach(row => {
        row.classList.add('tk-cart-line');
        const descriptionLabel = row.dataset.cartDescription || row.children[0].textContent.trim();
        row.dataset.cartDescription = descriptionLabel;
        // Keep the unit price and order-type badge together on one metadata line.
        // Only move the existing badge; descriptions, amounts and handlers stay intact.
        const badge = row.children[0].querySelector?.(':scope > span > span');
        if (badge) row.children[1].append(badge);
        const details = row.children[0].querySelector?.(':scope > div');
        if (details?.textContent.trim()) {
          details.classList.add('cashier-cart-line-details');
          row.children[1].append(details);
        }
        row.children[1].classList?.add('cashier-cart-line-meta');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.setAttribute('aria-label', `Edit ${descriptionLabel}`);
        const remove = row.children[4].querySelector('button');
        if (remove) remove.setAttribute('aria-label', `Remove ${row.children[0].firstElementChild?.textContent.trim() || 'order item'}`);
        if (!row.dataset.cartKeyboard) {
          row.dataset.cartKeyboard = 'true';
          row.addEventListener('keydown', event => {
            if (event.target === row && ['Enter', ' '].includes(event.key)) {
              event.preventDefault();
              row.click();
            }
          });
        }
      });
      const heights = [];
      for (const density of CART_DENSITIES) {
        list.dataset.cartDensity = density;
        heights.push(list.scrollHeight);
        if (list.scrollHeight <= list.clientHeight + 1) break;
      }
      list.dataset.cartDensity = chooseCartDensity(list.clientHeight, heights);
      list.dataset.cartOverflow = String(list.scrollHeight > list.clientHeight + 1);
    });
  };
  new window.MutationObserver(schedule).observe(list, {childList:true, subtree:true, characterData:true});
  if (typeof window.ResizeObserver === 'function') new window.ResizeObserver(schedule).observe(list);
  window.addEventListener('resize', schedule, {passive:true});
  // View switches and the mobile order toggle can make the previously hidden list visible.
  const shell = list.closest('.tk-pos-shell');
  if (shell) new window.MutationObserver(schedule).observe(shell, {attributes:true, attributeFilter:['class']});
  const view = document.getElementById('view-pos');
  if (view) new window.MutationObserver(schedule).observe(view, {attributes:true, attributeFilter:['class', 'style']});
  schedule();
}
