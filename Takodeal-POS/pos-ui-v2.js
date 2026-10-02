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

/* Restore platform colours through the existing switch function */
(() => {
  function updatePlatformTheme() {
    const platform = window.posPlatform || 'Standard';

    document.body.dataset.posTheme = platform;
    document.body.classList.toggle(
      'tk-delivery-theme',
      platform === 'Grab' || platform === 'Foodpanda'
    );
  }

  function installPlatformTheme() {
    const originalSwitch = window.switchPosPlatform;
    if (typeof originalSwitch !== 'function') return;

    window.switchPosPlatform = function (...args) {
      const result = originalSwitch.apply(this, args);
      updatePlatformTheme();
      return result;
    };

    updatePlatformTheme();
  }

  if (document.readyState === 'complete') {
    installPlatformTheme();
  } else {
    window.addEventListener('load', installPlatformTheme, {
      once: true
    });
  }
})();

/* Compact checkout and complete per-order reset */
(() => {
  const get = id => document.getElementById(id);

  function install() {
    const modal = get('checkoutModal');
    if (!modal || modal.dataset.tkCheckoutReady === '1') return;

    const open = window.openCheckoutModal;
    const update = window.updateNumpadDisplay;
    if (typeof open !== 'function' || typeof update !== 'function' ||
        typeof window.handleDiscountTypeChange !== 'function') return;

    const body = modal.querySelector('.modal-body');
    const head = modal.querySelector('.modal-head');
    const area = get('standardPaymentArea');
    const total = modal.querySelector('.checkout-yellow-box');
    const received = modal.querySelector('.checkout-grey-box');
    const type = get('checkoutDiscountType');
    if (!body || !head || !area || !total || !received || !type) return;

    let discountBox = type;
    while (discountBox.parentElement !== body) {
      discountBox = discountBox.parentElement;
      if (!discountBox) return;
    }

    modal.dataset.tkCheckoutReady = '1';
    modal.classList.add('tk-compact-checkout');

    const close = head.querySelector('.close-modal');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tk-checkout-back';
    back.textContent = '‹ Back';
    back.addEventListener('click', () => close.click());
    head.firstElementChild.replaceWith(back);
    total.firstElementChild.textContent = 'Total:';
    head.appendChild(total);

    const extras = document.createElement('details');
    extras.id = 'tkCheckoutExtras';
    const summary = document.createElement('summary');
    summary.textContent = 'Discount / Staff meal';
    body.insertBefore(extras, discountBox);
    discountBox.classList.add('tk-discount-box');
    extras.append(summary, discountBox);

    const amount = document.createElement('div');
    amount.className = 'tk-amount-entry';
    const label = document.createElement('label');
    label.htmlFor = 'tkCheckoutAmount';
    label.textContent = 'Amount received';
    const row = document.createElement('div');
    row.className = 'tk-amount-row';
    const input = document.createElement('input');
    input.id = 'tkCheckoutAmount';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = '₱ 0.00';
    input.addEventListener('input', () => {
      const value = Number(input.value);
      window.amountReceivedStr =
        input.value !== '' && Number.isFinite(value) && value >= 0
          ? input.value : '0';
      window.updateNumpadDisplay();
    });
    row.appendChild(input);

    [['₱500', 500], ['₱1,000', 1000], ['Exact', null]].forEach(([text, value]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => {
        window.amountReceivedStr = String(value ??
          window.finalCheckoutAmount ?? window.currentGrandTotal ?? 0);
        input.value = window.amountReceivedStr;
        window.updateNumpadDisplay();
      });
      row.appendChild(button);
    });
    amount.append(label, row);
    area.appendChild(amount);
    body.insertBefore(area, extras);
    body.insertBefore(received, extras);

    function sync() {
      const meal = ['staff_meal', 'manager_meal'].includes(type.value);
      modal.classList.toggle('tk-meal-mode', meal);
      if (meal) {
        extras.open = true;
        const split = get('splitPaymentContainer');
        if (split) split.style.display = 'none';
      }
      if (document.activeElement !== input) {
        input.value = window.amountReceivedStr || '0';
      }

      const icons = {
        cash: '💵', gcash: 'Ⓖ', grab: 'Grab',
        foodpanda: '🐼', bank: '🏦', split: '▣'
      };
      area.querySelectorAll('.pay-btn').forEach(button => {
        const method = button.dataset.tkMethod ||
          (button.classList.contains('split-btn') ? 'Split' : button.textContent.trim());
        button.dataset.tkMethod = method;
        const key = method.toLowerCase().replace(/[^a-z0-9]/g, '');
        button.dataset.payIcon = icons[key] || '💳';
        button.dataset.payKind = key;
        const labels = {
          cash: 'Cash', gcash: 'GCash', grab: 'GrabPay',
          foodpanda: 'Foodpanda', bank: 'Bank Transfer',
          split: 'Split Payment'
        };
        if (labels[key]) button.textContent = labels[key];
        button.classList.toggle('active',
          method === window.selectedPaymentMethod);
      });

      const submit = get('btnSubmitFinal');
      if (!window.isSubmittingOrder && submit.innerText === 'Complete checkout') {
        submit.innerText = meal ? 'Complete Meal' : 'Complete Payment';
      }
    }

    window.updateNumpadDisplay = function (...args) {
      const result = update.apply(this, args);
      sync();
      return result;
    };

    window.openCheckoutModal = function (...args) {
      if (window.isSubmittingOrder) return;
      const result = open.apply(this, args);
      if (modal.style.display !== 'flex') return result;

      const name = get('finalCustomerName');
      const savedName = name.readOnly ? '' : name.value;
      type.value = 'none';
      ['checkoutDiscountValue', 'checkoutDiscountReason',
       'checkoutStaffPin', 'splitAmount1', 'splitAmount2'].forEach(id => {
        if (get(id)) get(id).value = '';
      });
      const split = get('splitPaymentContainer');
      if (split) split.style.display = 'none';

      // Restore disabled fields, PIN visibility and customer-name editing.
      window.handleDiscountTypeChange();
      name.value = savedName;
      name.style.fontWeight = '';
      extras.open = false;

      const platform = window.posPlatform || 'Standard';
      const deliveryPlatform = ['Grab', 'Foodpanda'].includes(platform);
      window.selectedPaymentMethod = deliveryPlatform ? platform : 'Cash';
      window.amountReceivedStr = deliveryPlatform
        ? String(window.currentGrandTotal ?? 0) : '0';
      area.style.display = deliveryPlatform ? 'none' : 'block';
      area.querySelectorAll('.pay-btn').forEach(button => {
        button.classList.toggle('active',
          button.dataset.tkMethod === window.selectedPaymentMethod);
      });
      window.updateNumpadDisplay();
      return result;
    };

    sync();
  }

  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install, { once: true });
})();

/* TAKODEAL: photo categories and refreshed POS */
(() => {
  function installPhotoPOS() {
    const select = document.getElementById('menuCategoryDropdown');
    const rail = document.getElementById('tkCategoryPills');
    const toolbar = document.querySelector('.tk-menu-toolbar');
    const header = document.getElementById('posCartHeader');
    const popup = document.getElementById('categoryModal');

    if (!select || !rail || !toolbar || !header || !popup ||
        document.body.classList.contains('tk-photo-pos')) return;

    document.body.classList.add('tk-photo-pos');

    const heading = document.createElement('div');
    heading.className = 'tk-menu-heading';

    const title = document.createElement('strong');
    title.textContent = 'Explore the menu';

    const caption = document.createElement('span');
    heading.append(title, caption);

    const browse = document.createElement('button');
    browse.type = 'button';
    browse.id = 'tkBrowseCategories';
    browse.textContent = '▦ All categories';
    browse.setAttribute('aria-controls', 'categoryModal');
    browse.setAttribute('aria-haspopup', 'dialog');
    browse.addEventListener('click', () => window.openCategoryModal());

    toolbar.prepend(heading);
    toolbar.append(browse);

    const orderHeading = document.createElement('div');
    orderHeading.className = 'tk-order-heading';

    const orderTitle = document.createElement('strong');
    orderTitle.textContent = 'Current order';

    const quantity = document.createElement('span');
    orderHeading.append(orderTitle, quantity);
    header.prepend(orderHeading);

    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');

    const popupTitle = popup.querySelector('h2');
    if (popupTitle) {
      popupTitle.id = 'tkPhotoCategoryTitle';
      popupTitle.textContent = 'Choose a category';
      popup.setAttribute('aria-labelledby', popupTitle.id);
    }

    function icon(category) {
      const name = category.toLowerCase();
      if (name.includes('takoyaki')) return '🐙';
      if (name.includes('coffee') || name.includes('latte')) return '☕';
      if (name.includes('milk') || name.includes('tea')) return '🧋';
      if (name.includes('fries')) return '🍟';
      if (/shake|soda|smooth|drink/.test(name)) return '🥤';
      if (/pudding|tiramisu/.test(name)) return '🍮';
      if (/pack|consum|prep/.test(name)) return '📦';
      return category === 'All' ? '🍽️' : '🍴';
    }

    function paintCategories() {
      const items = Array.isArray(window.masterPOSData?.items)
        ? window.masterPOSData.items : [];

      const photos = new Map();
      const counts = new Map();
      let firstPhoto = '';

      items.forEach(item => {
        const image = item.image || item.imageUrl;
        counts.set(item.category, (counts.get(item.category) || 0) + 1);

        if (image && !photos.has(item.category)) {
          photos.set(item.category, String(image));
        }
        if (image && !firstPhoto) firstPhoto = String(image);
      });

      document.querySelectorAll(
        '.tk-category-pill, .tk-category-option'
      ).forEach(button => {
        const category = button.dataset.category || 'All';
        const photo = category === 'All'
          ? firstPhoto : (photos.get(category) || '');
        const count = category === 'All'
          ? items.length : (counts.get(category) || 0);
        const signature = JSON.stringify([category, photo, count]);

        if (button.dataset.tkPhoto !== signature) {
          const media = document.createElement('span');
          media.className = 'tk-category-photo';
          media.setAttribute('aria-hidden', 'true');

          const fallback = document.createElement('span');
          fallback.textContent = icon(category);
          media.append(fallback);

          if (photo) {
            const image = document.createElement('img');
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => {
              image.hidden = true;
            });
            image.src = photo;
            media.append(image);
          }

          const label = document.createElement('span');
          label.className = 'tk-category-label';
          label.textContent = category === 'All' ? 'All items' : category;

          const total = document.createElement('small');
          total.className = 'tk-category-total';
          total.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;

          button.replaceChildren(media, label, total);
          button.dataset.tkPhoto = signature;
        }

        const active = category === (select.value || 'All');
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });

      const current = select.value || 'All';
      caption.textContent = current === 'All'
        ? 'Pick a category to get started' : current;
    }

    function paintOrder() {
      const cart = Array.isArray(window.cart) ? window.cart : [];
      const count = cart.reduce((sum, item) =>
        sum + (Number(item.qty) || Number(item.quantity) || 1), 0);

      quantity.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;

      document.querySelectorAll('#cartList .tk-cart-empty').forEach(row => {
        if (row.textContent !== 'Your order starts here') {
          row.textContent = 'Your order starts here';
        }
      });
    }

    function wrap(name, after) {
      const original = window[name];
      if (typeof original !== 'function') return;

      window[name] = function (...args) {
        const result = original.apply(this, args);
        after();
        return result;
      };
    }

    wrap('renderMenuItems', paintCategories);
    wrap('renderCart', paintOrder);

    const originalFilter = window.filterMenu;
    if (typeof originalFilter === 'function') {
      window.filterMenu = function (...args) {
        const previous = select.value;
        const result = originalFilter.apply(this, args);
        paintCategories();

        if (select.value !== previous) {
          document.getElementById('menuGrid').scrollTop = 0;
        }
        return result;
      };
    }

    wrap('openCategoryModal', () => {
      paintCategories();
      popup.querySelector('.tk-category-option.active')?.focus();
    });

    wrap('closeCategoryModal', () => {
      if (popup.contains(document.activeElement)) browse.focus();
    });

    document.addEventListener('keydown', event => {
      if (popup.style.display !== 'flex') return;

      if (event.key === 'Escape') {
        event.preventDefault();
        window.closeCategoryModal();
      } else if (event.key === 'Tab') {
        const buttons = [...popup.querySelectorAll('button')]
          .filter(button => !button.disabled);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        paintCategories();
      });
    }).observe(select, { childList: true });

    paintCategories();
    paintOrder();
  }

  if (document.readyState === 'complete') installPhotoPOS();
  else window.addEventListener('load', installPhotoPOS, { once: true });
})();
