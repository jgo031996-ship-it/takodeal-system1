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

/* Keep checkout and Add Order above the tablet keyboard */
(() => {
  function install() {
    const root = document.documentElement;
    if (root.dataset.tkViewportReady === '1') return;
    root.dataset.tkViewportReady = '1';

    const viewport = window.visualViewport;
    const checkout = document.getElementById('checkoutModal');
    const variant = document.getElementById('variantModal');

    let queued = false;
    let revealInput = false;

    function update() {
      queued = false;

      const height = viewport?.height || window.innerHeight;
      root.style.setProperty('--tk-visible-height', `${height}px`);
      root.style.setProperty(
        '--tk-visible-top',
        `${viewport?.offsetTop || 0}px`
      );

      const active = document.activeElement;
      const editing = active &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(
          active.tagName.toUpperCase()
        );

      const short = height < 520 ||
        height < window.innerHeight - 120;

      checkout?.classList.toggle(
        'tk-checkout-typing',
        Boolean(editing && short && checkout.contains(active))
      );

      if (revealInput && editing) {
        const modal = active.closest('#checkoutModal, #variantModal');
        if (modal?.style.display === 'flex') {
          active.scrollIntoView({
            block: 'nearest',
            inline: 'nearest'
          });
        }
      }

      revealInput = false;
    }

    function queue(reveal = false) {
      revealInput = revealInput || reveal;
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }

    viewport?.addEventListener('resize', () => queue(true));
    viewport?.addEventListener('scroll', () => queue());
    window.addEventListener('resize', () => queue(true));
    document.addEventListener('focusin', () => queue(true));
    document.addEventListener('focusout', () => queue());

    const observer = new MutationObserver(() => queue());
    [checkout, variant].filter(Boolean).forEach(modal => {
      observer.observe(modal, {
        attributes: true,
        attributeFilter: ['style']
      });
    });

    update();
  }

  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install, { once: true });
})();

(function standardWorkTabs() {
  function install() {
    if (document.body.dataset.tkWorkUI === '1') return;
    document.body.dataset.tkWorkUI = '1';

    const get = id => document.getElementById(id);
    const mark = (node, name) => {
      if (node && !node.classList.contains(name)) node.classList.add(name);
    };
    const setStyle = (node, key, value) => {
      if (node.style.getPropertyValue(key) !== value)
        node.style.setProperty(key, value);
    };
    const markAll = (selector, name) =>
      document.querySelectorAll(selector).forEach(node => mark(node, name));

    const roots = [
      'sales', 'mobilehub', 'stockreq', 'prep',
      'consumables', 'waste', 'schedule'
    ].map(name => get(`view-${name}`)).filter(Boolean);

    roots.forEach(node => mark(node, 'tk-work-tab'));
    [get('remittanceModal'), get('timeClockModal')]
      .filter(Boolean).forEach(node => mark(node, 'tk-work-dialog'));

    [
      '#view-sales > div > div',
      '#view-stockreq > div',
      '#view-prep > div',
      '#view-consumables .menu-panel',
      '#consumablesCartPanel',
      '#view-mobilehub > div > div:last-child',
      '#view-mobilehub > div > div:first-child > div',
      '#view-waste > div > div',
      '#view-schedule > div > div'
    ].forEach(selector => markAll(selector, 'tk-work-card'));

    [
      '#view-sales > div > div > div:first-child',
      '#view-stockreq > div > div:first-child',
      '#view-prep > div > div:first-child',
      '#view-mobilehub > div > div:last-child > div:first-child',
      '#view-mobilehub > div > div:first-child > div > div:first-child',
      '#view-waste > div > div > div:first-child',
      '#view-consumables .menu-panel > div:first-child',
      '#consumablesCartPanel .ticket-header'
    ].forEach(selector => markAll(selector, 'tk-work-header'));

    mark(get('view-mobilehub')?.firstElementChild, 'tk-hub-layout');
    mark(get('prepCartBody')?.parentElement, 'tk-prep-cart');
    mark(get('menuToggleHeader')?.parentElement, 'tk-hub-menu-body');
    mark(get('view-consumables')?.firstElementChild, 'tk-supplies-layout');
    mark(get('manualCountCycleFilter')?.parentElement, 'tk-count-tools');
    mark(
      get('manualCountCycleFilter')?.parentElement?.parentElement,
      'tk-count-toolbar'
    );
    mark(get('clockVideo')?.parentElement, 'tk-clock-preview');

    const groups = [
      ['stockReqTabNew', 'btnTabReqNew', 'stockReqTabHistory', 'btnTabReqHist'],
      ['prepTabNew', 'btnTabPrepNew', 'prepTabHistory', 'btnTabPrepHist'],
      ['consumablesTabNew', 'btnTabConsNew', 'consumablesTabHistory', 'btnTabConsHist'],
      ['mobileHubListContainer', 'btnMobLive', 'mobileHubHistoryContainer', 'btnMobHist'],
      ['remitFormSection', 'tabRemitForm', 'remitHistorySection', 'tabRemitHistory']
    ];
    groups.forEach(group =>
      [group[1], group[3]].forEach(id => mark(get(id), 'tk-work-switch'))
    );

    function syncTabs() {
      groups.forEach(([first, firstButton, second, secondButton]) => {
        [[first, firstButton], [second, secondButton]]
          .forEach(([panel, button]) => {
            const control = get(button), content = get(panel);
            if (!control || !content) return;
            const active = content.style.display !== 'none' && !content.hidden;
            if (control.classList.contains('tk-work-selected') !== active)
              control.classList.toggle('tk-work-selected', active);
          });
      });

      const layout = get('view-consumables')?.firstElementChild;
      const history = get('consumablesTabHistory');
      if (layout && history) {
        const active = history.style.display !== 'none';
        if (layout.classList.contains('tk-supplies-history') !== active)
          layout.classList.toggle('tk-supplies-history', active);
      }
    }

    function decorateSales() {
      const body = get('tbTransBody');
      if (!body) return;
      const labels = [
        'Receipt', 'Customer', 'Payment', 'Status',
        'Date', 'Time', 'Amount', ''
      ];

      [...body.children].forEach(row => {
        if (row.children.length === 8) {
          mark(row, 'tk-sale-row');
          [...row.children].forEach((cell, index) => {
            if (cell.dataset.label !== labels[index])
              cell.dataset.label = labels[index];
          });

          const voided = Boolean(row.querySelector('.status-out'));
          if (row.classList.contains('tk-sale-void') !== voided)
            row.classList.toggle('tk-sale-void', voided);

          row.querySelectorAll('.dot-menu').forEach(button => {
            if (button.textContent.trim() !== 'Actions ▾')
              button.textContent = 'Actions ▾';
          });

          row.querySelectorAll('.action-item').forEach(item => {
            if (item.dataset.tkKeys === '1') return;
            item.dataset.tkKeys = '1';
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.addEventListener('keydown', event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                item.click();
              }
            });
          });
        } else if (row.querySelector('strong') && row.children.length === 1) {
          mark(row, 'tk-sales-summary');
          const cell = row.firstElementChild;
          if (cell.dataset.tkChips !== '1') {
            const totals = document.createElement('div');
            totals.className = 'tk-sales-totals';
            totals.append(...cell.children);
            cell.replaceChildren(totals);
            cell.dataset.tkChips = '1';
          }
        } else {
          mark(row, 'tk-sales-message');
        }
      });
    }

    function positionActions() {
      document.querySelectorAll('#tbTransBody .action-dropdown.show')
        .forEach(menu => {
          const button = menu.parentElement.querySelector('.dot-menu');
          if (!button) return;

          const rect = button.getBoundingClientRect();
          const viewport = window.visualViewport;
          const top = viewport?.offsetTop || 0;
          const height = viewport?.height || window.innerHeight;
          const width = window.innerWidth;

          if (rect.bottom < top || rect.top > top + height) {
            menu.classList.remove('show');
            return;
          }

          const menuHeight = Math.min(menu.scrollHeight || 170, height - 24);
          const y = rect.bottom + 6 + menuHeight <= top + height - 8
            ? rect.bottom + 6
            : Math.max(top + 8, rect.top - menuHeight - 6);
          const x = Math.max(8, Math.min(rect.right - 210, width - 218));

          setStyle(menu, '--tk-action-top', `${y}px`);
          setStyle(menu, '--tk-action-left', `${x}px`);
          setStyle(menu, '--tk-action-height', `${Math.max(80, height - 24)}px`);
        });
    }

    function installHubPicker() {
      const select = get('categoryFilter');
      const header = get('menuToggleHeader');
      if (!select || !header) return () => {};

      const launch = document.createElement('button');
      launch.type = 'button';
      launch.id = 'tkHubCategories';
      launch.textContent = '▦ All categories';
      launch.setAttribute('aria-haspopup', 'dialog');
      launch.setAttribute('aria-controls', 'tkHubCategoryModal');

      const current = document.createElement('small');
      current.className = 'tk-hub-current';
      header.prepend(launch);
      header.append(current);

      const overlay = document.createElement('div');
      overlay.id = 'tkHubCategoryModal';
      overlay.className = 'overlay tk-hub-picker';
      overlay.style.display = 'none';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'tkHubCategoryTitle');

      const panel = document.createElement('div');
      const head = document.createElement('div');
      const title = document.createElement('h2');
      title.id = 'tkHubCategoryTitle';
      title.textContent = 'Choose a menu category';

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '✕';
      close.setAttribute('aria-label', 'Close categories');
      head.append(title, close);

      const grid = document.createElement('div');
      grid.className = 'tk-hub-category-grid';
      panel.append(head, grid);
      overlay.append(panel);
      document.body.append(overlay);

      let signature = '';

      function shut() {
        overlay.style.display = 'none';
        launch.focus();
      }

      function sync() {
        const label = !select.value || select.value === 'All'
          ? 'Showing all items' : select.value;
        if (current.textContent !== label) current.textContent = label;
        if (overlay.style.display !== 'flex') return;

        const cached = window.masterPOSData?.items;
        const items = Array.isArray(window.globalMenuToggleList)
          ? window.globalMenuToggleList
          : (Array.isArray(cached) ? cached : []);

        const data = [...select.options].map(option => {
          const category = option.value;
          const matches = category === 'All'
            ? items : items.filter(item => item.category === category);
          const imageItem = matches.find(item => item.image || item.imageUrl);
          return [
            category,
            imageItem?.image || imageItem?.imageUrl || '',
            matches.length
          ];
        });

        const next = JSON.stringify(data);
        if (next !== signature) {
          const focused = document.activeElement?.dataset?.category;

          grid.replaceChildren(...data.map(([category, photo, count]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tk-hub-category';
            button.dataset.category = category;

            const media = document.createElement('span');
            media.className = 'tk-category-photo';
            media.setAttribute('aria-hidden', 'true');
            media.textContent = category === 'All' ? '🍽️' : '🍴';

            if (photo) {
              const image = document.createElement('img');
              image.alt = '';
              image.loading = 'lazy';
              image.src = photo;
              image.addEventListener('error', () => { image.hidden = true; });
              media.append(image);
            }

            const label = document.createElement('strong');
            label.textContent = category === 'All' ? 'All items' : category;
            const total = document.createElement('small');
            total.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;

            button.append(media, label, total);
            button.addEventListener('click', () => {
              select.value = category;
              if (typeof window.filterMenuToggle === 'function')
                window.filterMenuToggle();
              sync();
              shut();
            });
            return button;
          }));

          signature = next;
          if (focused)
            [...grid.children]
              .find(button => button.dataset.category === focused)?.focus();
        }

        [...grid.children].forEach(button => {
          const active = button.dataset.category === select.value;
          if (button.classList.contains('active') !== active)
            button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
      }

      launch.addEventListener('click', () => {
        overlay.style.display = 'flex';
        sync();
        grid.querySelector('.active')?.focus();
      });
      close.addEventListener('click', shut);
      overlay.addEventListener('click', event => {
        if (event.target === overlay) shut();
      });
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          shut();
        }
        if (event.key === 'Tab') {
          const controls = [close, ...grid.children];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
      select.addEventListener('change', sync);
      return sync;
    }

    const syncHub = installHubPicker();

    function printerSkin() {
      document.querySelectorAll('.swal2-popup').forEach(popup => {
        const buttons = [...popup.querySelectorAll('button')];
        if (!buttons.some(button =>
          (button.getAttribute('onclick') || '')
            .includes('connectSpecificPrinter'))) return;

        mark(popup, 'tk-printer-popup');
        buttons.forEach(button => {
          const action = button.getAttribute('onclick') || '';
          if (action.includes('testPrint'))
            mark(button, 'tk-printer-test');

          if (action.includes('connectSpecificPrinter')) {
            mark(button, 'tk-printer-pair');
            const connected = button.textContent.includes('Paired & Online');
            if (button.classList.contains('tk-printer-online') !== connected)
              button.classList.toggle('tk-printer-online', connected);
          }
        });
      });
    }

    let queued = false;
    function refresh() {
      queued = false;
      decorateSales();
      syncTabs();
      syncHub();
      printerSkin();
      positionActions();
    }
    function queue() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(refresh);
    }

    const observer = new MutationObserver(queue);
    [...roots, get('remittanceModal'), get('timeClockModal')]
      .filter(Boolean).forEach(root =>
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style']
        })
      );

    new MutationObserver(queue)
      .observe(document.body, { childList: true });

    document.addEventListener('click', queue);
    document.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    refresh();
  }

  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install, { once: true });
})();
