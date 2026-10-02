/* Takodeal POS: responsive UI for the current cashier HTML.
   Decorates existing menu/cart renderers. No database reads or listeners. */
(() => {
  'use strict';
  const HIDDEN = new Set(['Prepared Batch', 'Prep Batch', 'Raw Materials', 'Packaging', 'Consumables', 'Premix'].map(value => value.toLowerCase()));
  const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
  const money = value => currency.format(Number(value) || 0);
  let categorySignature = null;
  let query = '';
  let select, shell, grid, orderButton;

  function categoryNames() {
    const data = window.masterPOSData || {};
    const configured = Array.isArray(data.categories) ? data.categories : [];
    const items = Array.isArray(data.items) ? data.items : [];
    const derived = items.map(item => item.category).filter(value => typeof value === 'string' && !HIDDEN.has(value.toLowerCase()));
    return [...new Set([...configured, ...derived])].filter(value => typeof value === 'string' && value && value !== 'All');
  }

  function categoryIcon(category) {
    const value = category.toLowerCase();
    if (value.includes('takoyaki')) return '🐙';
    if (value.includes('tea') || value.includes('boba')) return '🧋';
    if (value.includes('coffee') || value.includes('latte')) return '☕';
    if (value.includes('frappe') || value.includes('shake')) return '🥤';
    return category === 'All' ? '🍔' : '📁';
  }

  function makeCategoryButton(category, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.category = category;
    button.textContent = category === 'All' ? 'All items' : category;
    button.addEventListener('click', () => window.filterMenu(category, categoryIcon(category)));
    return button;
  }

  function syncCategories() {
    const categories = categoryNames();
    const signature = JSON.stringify(categories);
    if (signature === categorySignature) return false;
    const current = categories.includes(select.value) ? select.value : 'All';
    const names = ['All', ...categories];
    select.replaceChildren(...names.map(name => new Option(name, name)));
    select.value = current;
    const pills = document.getElementById('tkCategoryPills');
    pills.replaceChildren(...names.map(name => makeCategoryButton(name, 'tk-category-pill')));
    const modalGrid = document.getElementById('categoryModalGrid');
    if (modalGrid) modalGrid.replaceChildren(...names.map(name => makeCategoryButton(name, 'tk-category-option')));
    categorySignature = signature;
    return true;
  }

  function decorateProducts() {
    const items = Array.isArray(window.masterPOSData?.items) ? window.masterPOSData.items : [];
    const byName = new Map(items.map(item => [JSON.stringify([item.category || '', String(item.name || '').toLowerCase()]), item]));
    grid.querySelectorAll('.ultra-card').forEach(card => {
      // The existing HTML renderer escapes apostrophes for inline handlers and
      // also leaves that escape in data-category. Restore the actual category.
      const category = (card.dataset.category || '').replace(/\\'/g, "'");
      const item = byName.get(JSON.stringify([category, card.dataset.name || '']));
      if (!item) return;
      card.dataset.category = item.category || '';
      const media = card.firstElementChild;
      const info = card.children[1];
      if (!media || !info) return;
      const unavailable = card.style.cursor === 'not-allowed';
      const name = info.firstElementChild?.textContent || item.name || 'Item';
      card.classList.add('tk-product-card');
      card.classList.toggle('is-disabled', unavailable);
      // The original card click retains its systemReady and availability checks.
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${item.name || name}, ${unavailable ? 'unavailable' : 'add to order'}`);
      card.setAttribute('aria-disabled', String(unavailable));
      card.tabIndex = unavailable ? -1 : 0;
      card.addEventListener('keydown', event => {
        if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          card.click();
        }
      });
      media.classList.add('tk-product-media');
      const image = item.image || item.imageUrl;
      media.style.backgroundImage = image ? `url(${JSON.stringify(String(image))})` : '';
      if (!image) {
        const placeholder = document.createElement('span');
        placeholder.className = 'tk-product-placeholder';
        placeholder.textContent = categoryIcon(item.category || '');
        placeholder.setAttribute('aria-hidden', 'true');
        media.appendChild(placeholder);
      }
      info.classList.add('tk-product-info');
      const title = document.createElement('div');
      title.className = 'tk-product-name';
      title.textContent = name;
      let price = parseFloat(item.price || item.basePrice) || 0;
      if (window.posPlatform === 'Grab' && item.grabPrice) price = parseFloat(item.grabPrice) || price;
      if (window.posPlatform === 'Foodpanda' && item.foodpandaPrice) price = parseFloat(item.foodpandaPrice) || price;
      const priceLabel = document.createElement('div');
      priceLabel.className = 'tk-product-price';
      priceLabel.textContent = money(price);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'tk-add-btn';
      add.disabled = unavailable;
      add.textContent = unavailable ? '–' : '+';
      add.setAttribute('aria-label', `Add ${item.name || name}`);
      // A single click bubbles to the original product handler.
      info.replaceChildren(title, priceLabel, add);
    });
    const empty = document.createElement('div');
    empty.id = 'tkMenuEmpty';
    empty.className = 'tk-menu-empty';
    empty.setAttribute('role', 'status');
    empty.hidden = true;
    grid.appendChild(empty);
  }

  function refreshOrderButton() {
    const cart = Array.isArray(window.cart) ? window.cart : [];
    const quantity = cart.reduce((sum, item) => sum + (Number(item.qty) || Number(item.quantity) || 1), 0);
    orderButton.textContent = `Order (${quantity}) · ${money(window.currentGrandTotal)}`;
    orderButton.setAttribute('aria-label', `View current order: ${quantity} items, ${money(window.currentGrandTotal)}`);
  }

  function decorateCart() {
    document.querySelectorAll('#cartList > li').forEach(row => {
      if (row.children.length >= 5) row.classList.add('tk-cart-line');
      else row.classList.add('tk-cart-empty');
    });
    refreshOrderButton();
  }

  function installToolbar() {
    const menu = shell.children[0];
    const header = menu.children[0];
    select = document.getElementById('menuCategoryDropdown');
    if (!select) {
      select = document.createElement('select');
      select.id = 'menuCategoryDropdown';
      header.appendChild(select);
    }
    select.setAttribute('aria-label', 'Product category');
    select.addEventListener('change', () => window.filterMenu(select.value));
    const toolbar = document.createElement('div');
    toolbar.className = 'tk-menu-toolbar';
    const search = document.createElement('input');
    search.type = 'search';
    search.id = 'tkMenuSearch';
    search.placeholder = 'Search products';
    search.setAttribute('aria-label', 'Search products');
    search.autocomplete = 'off';
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      window.filterMenu(select.value || 'All');
    });
    const count = document.createElement('span');
    count.id = 'tkMenuCount';
    count.className = 'tk-menu-count';
    count.setAttribute('aria-live', 'polite');
    orderButton = document.createElement('button');
    orderButton.type = 'button';
    orderButton.id = 'tkCartToggle';
    orderButton.addEventListener('click', () => {
      shell.classList.add('tk-show-cart');
      document.getElementById('tkCartBack')?.focus();
    });
    toolbar.append(search, count, orderButton);
    const pills = document.createElement('div');
    pills.id = 'tkCategoryPills';
    pills.className = 'tk-category-pills';
    pills.setAttribute('role', 'group');
    pills.setAttribute('aria-label', 'Product categories');
    header.append(toolbar, pills);
    const back = document.createElement('button');
    back.id = 'tkCartBack';
    back.type = 'button';
    back.textContent = '← Menu';
    back.addEventListener('click', () => {
      shell.classList.remove('tk-show-cart');
      orderButton.focus();
    });
    document.getElementById('posCartHeader')?.prepend(back);
  }

  function installDock() {
    const dock = document.createElement('nav');
    dock.id = 'tkMobileDock';
    dock.setAttribute('aria-label', 'Main navigation');
    const entries = [['pos', '▣', 'POS'], ['sales', '≡', 'Sales'], ['mobilehub', '◉', 'Orders'], ['stockreq', '□', 'Stock'], ['more', '•••', 'More']];
    entries.forEach(([target, symbol, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tk-dock-btn';
      button.dataset.target = target;
      const icon = document.createElement('span');
      icon.textContent = symbol;
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, document.createTextNode(label));
      button.addEventListener('click', () => {
        if (!document.body.classList.contains('tk-dock-visible')) return;
        const sidebar = document.getElementById('mainSidebar');
        if (target === 'more') {
          sidebar?.classList.toggle('tk-mobile-menu-open');
          return;
        }
        sidebar?.classList.remove('tk-mobile-menu-open');
        if (target === 'pos') shell.classList.remove('tk-show-cart');
        // Reuse each existing navigation handler, including shift protections.
        document.getElementById(`nav-${target}`)?.click();
      });
      dock.appendChild(button);
    });
    document.body.appendChild(dock);
    const sidebar = document.getElementById('mainSidebar');
    sidebar?.addEventListener('click', event => {
      if (event.target.closest('.nav-item')) sidebar.classList.remove('tk-mobile-menu-open');
    });
    const isVisible = element => element && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0;
    function updateDock() {
      const loginVisible = isVisible(document.getElementById('loginOverlay'));
      const modalVisible = [...document.querySelectorAll('.overlay, [id$="Modal"]')].some(isVisible);
      const allowed = !loginVisible && !modalVisible;
      if (document.body.classList.contains('tk-dock-visible') !== allowed) document.body.classList.toggle('tk-dock-visible', allowed);
      if (!allowed && sidebar?.classList.contains('tk-mobile-menu-open')) sidebar.classList.remove('tk-mobile-menu-open');
      const activeId = document.querySelector('.nav-item.active')?.id;
      const target = activeId?.replace(/^nav-/, '') || 'pos';
      dock.querySelectorAll('.tk-dock-btn').forEach(button => {
        const active = button.dataset.target === target || (button.dataset.target === 'more' && !entries.some(entry => entry[0] === target));
        if (button.classList.contains('active') !== active) button.classList.toggle('active', active);
        if (button.getAttribute('aria-current') !== String(active)) button.setAttribute('aria-current', String(active));
        if (button.dataset.target === 'more') {
          const expanded = String(sidebar?.classList.contains('tk-mobile-menu-open') || false);
          if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded);
        }
      });
    }
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; updateDock(); });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    window.addEventListener('resize', updateDock);
    updateDock();
  }

  function install() {
    if (document.body.classList.contains('tk-ui-v2')) return;
    shell = document.getElementById('view-pos')?.firstElementChild;
    grid = document.getElementById('menuGrid');
    const originalMenu = window.renderMenuItems;
    const originalCart = window.renderCart;
    const originalFilter = window.filterMenu;
    if (!shell || !grid || typeof originalMenu !== 'function' || typeof originalCart !== 'function') return;
    document.body.classList.add('tk-ui-v2');
    shell.classList.add('tk-pos-shell');
    shell.children[0]?.classList.add('tk-menu-shell');
    shell.children[1]?.classList.add('tk-cart-shell');
    installToolbar();
    window.filterMenu = function(category = 'All', icon = categoryIcon(category)) {
      if (typeof originalFilter === 'function') originalFilter(category, icon);
      select.value = category;
      let visible = 0;
      grid.querySelectorAll('.ultra-card').forEach(card => {
        const show = (category === 'All' || card.dataset.category === category) && (!query || (card.dataset.name || '').includes(query));
        card.style.setProperty('display', show ? 'flex' : 'none', 'important');
        if (show) visible++;
      });
      document.querySelectorAll('.tk-category-pill, .tk-category-option').forEach(button => {
        const active = button.dataset.category === category;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('tkMenuCount').textContent = `${visible} ${visible === 1 ? 'item' : 'items'}`;
      const empty = document.getElementById('tkMenuEmpty');
      if (empty) {
        empty.hidden = visible > 0;
        empty.textContent = query ? 'No products match your search.' : 'No products in this category yet.';
      }
    };
    window.renderMenuItems = function(...args) {
      syncCategories();
      const result = originalMenu.apply(this, args);
      decorateProducts();
      window.filterMenu(select.value || 'All');
      return result;
    };
    window.buildCategories = function() {
      syncCategories();
      window.renderMenuItems();
    };
    window.renderCart = function(...args) {
      const result = originalCart.apply(this, args);
      decorateCart();
      return result;
    };
    installDock();
    window.buildCategories();
    window.renderCart();
    window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && syncCategories()) window.filterMenu(select.value || 'All');
    }, 1000);
  }
  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install, { once: true });
})();
