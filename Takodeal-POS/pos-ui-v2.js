(() => {
  const HIDDEN_CATEGORIES = ["Prepared Batch", "Prep Batch", "Raw Materials", "Packaging", "Consumables", "Premix"];

  const money = value => `₱${(parseFloat(value) || 0).toFixed(0)}`;
  const escAttr = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const escHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function decorateShell() {
    document.body.classList.add('tk-ui-v2');
    const view = document.getElementById('view-pos');
    if (view) {
      const shell = view.firstElementChild;
      if (shell) {
        shell.classList.add('tk-pos-shell');
        if (shell.children[0]) shell.children[0].classList.add('tk-menu-shell');
        if (shell.children[1]) shell.children[1].classList.add('tk-cart-shell');
      }
    }
    installMobileDock();
  }

  function buildPills(categories, activeValue) {
    const select = document.getElementById('menuCategoryDropdown');
    if (!select) return;
    const host = select.parentElement;
    if (!host) return;

    let pills = document.getElementById('tkCategoryPills');
    if (!pills) {
      pills = document.createElement('div');
      pills.id = 'tkCategoryPills';
      pills.className = 'tk-category-pills';
      host.appendChild(pills);
    }

    const all = ['All', ...categories];
    pills.innerHTML = all.map(cat => {
      const label = cat === 'All' ? 'All' : cat;
      const active = (activeValue || 'All') === cat ? ' active' : '';
      return `<button type="button" class="tk-category-pill${active}" data-category="${escAttr(cat)}">${escHtml(label)}</button>`;
    }).join('');

    pills.querySelectorAll('.tk-category-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.category || 'All';
        select.value = category;
        window.filterMenu(category);
        pills.querySelectorAll('.tk-category-pill').forEach(x => x.classList.toggle('active', x === btn));
      });
    });
  }

  function installMenuRenderer() {
    window.filterMenu = function(category) {
      document.querySelectorAll('#menuGrid .tk-product-card').forEach(card => {
        const show = category === 'All' || card.dataset.category === category;
        card.style.display = show ? 'flex' : 'none';
      });
      document.querySelectorAll('.tk-category-pill').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.category || 'All') === category);
      });
    };

    window.buildCategories = function() {
      const select = document.getElementById('menuCategoryDropdown');
      if (!select) return;
      const categories = Array.isArray(window.masterPOSData?.categories)
        ? window.masterPOSData.categories.filter(Boolean)
        : [];
      const current = categories.includes(select.value) || select.value === 'All' ? select.value : 'All';
      select.innerHTML = '<option value="All">All</option>' + categories.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('');
      select.value = current || 'All';
      buildPills(categories, select.value);
      window.renderMenuItems();
    };

    window.renderMenuItems = function() {
      const grid = document.getElementById('menuGrid');
      if (!grid) return;
      const items = Array.isArray(window.masterPOSData?.items) ? [...window.masterPOSData.items] : [];
      const hidden = new Set(HIDDEN_CATEGORIES.map(x => x.toLowerCase()));
      const safeItems = items.filter(item => !hidden.has(String(item.category || '').toLowerCase()));

      safeItems.sort((a, b) => {
        const layout = Array.isArray(window.globalItemLayout) ? window.globalItemLayout : [];
        const ai = layout.indexOf(a.id); const bi = layout.indexOf(b.id);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      const branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
      grid.innerHTML = safeItems.map(item => {
        let price = parseFloat(item.price || item.basePrice) || 0;
        if (window.posPlatform === 'Grab' && item.grabPrice) price = parseFloat(item.grabPrice) || price;
        if (window.posPlatform === 'Foodpanda' && item.foodpandaPrice) price = parseFloat(item.foodpandaPrice) || price;

        let possible = Infinity;
        const bom = Array.isArray(window.masterPOSData?.bom) ? window.masterPOSData.bom : [];
        const stock = window.masterPOSData?.stockLevels || {};
        const recipe = bom.filter(b => b.menuItem === item.name);
        if (recipe.length) {
          recipe.forEach(r => {
            const qty = parseFloat(r.qty) || 1;
            const orders = (parseFloat(stock[r.ingredientName]) || 0) / qty;
            if (orders < possible) possible = orders;
          });
        }

        const manuallyUnavailable = Array.isArray(item.unavailableAt) && item.unavailableAt.includes(branch);
        const soldOut = manuallyUnavailable || possible <= 0;
        const low = !soldOut && Number.isFinite(possible) && possible <= 5;
        const badge = soldOut
          ? '<div class="tk-product-badge out">SOLD OUT</div>'
          : low ? '<div class="tk-product-badge low">LOW STOCK</div>' : '';

        let name = String(item.name || 'Item');
        const cat = String(item.category || '');
        if (cat && name.toLowerCase().startsWith(cat.toLowerCase())) {
          const shorter = name.substring(cat.length).trim().replace(/^[-–—]\s*/, '');
          if (shorter) name = shorter;
        }

        const image = item.image ? `background-image:url("${escAttr(item.image)}")` : '';
        const clickName = String(item.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `
          <article class="tk-product-card item-card ultra-card${soldOut ? ' is-disabled' : ''}" data-category="${escAttr(cat)}" data-name="${escAttr(String(item.name || '').toLowerCase())}" ${soldOut ? '' : `onclick="window.openAddOrderModal('${clickName}', ${price})"`}>
            <div class="tk-product-media" style="${image}">${badge}</div>
            <div class="tk-product-info">
              <div class="tk-product-name">${escHtml(name)}</div>
              <div class="tk-product-price">${money(price)}</div>
              <button type="button" class="tk-add-btn" ${soldOut ? 'disabled' : ''} aria-label="Add ${escAttr(name)}">${soldOut ? '–' : '+'}</button>
            </div>
          </article>`;
      }).join('');

      const select = document.getElementById('menuCategoryDropdown');
      window.filterMenu(select?.value || 'All');
    };
  }

  function installCartRenderer() {
    window.renderCart = function() {
      const list = document.getElementById('cartList');
      if (!list) return;
      const cart = Array.isArray(window.cart) ? window.cart : [];
      let total = 0;

      if (!cart.length) {
        list.innerHTML = '<li class="tk-cart-empty">Your current order is empty.<br><span style="font-weight:600;font-size:11px;">Tap a product to add it.</span></li>';
      } else {
        list.innerHTML = cart.map((item, index) => {
          const line = parseFloat(item.lineTotalFinal) || 0;
          total += line;
          const qty = parseFloat(item.qty) || 1;
          const variant = item.variantName && item.variantName !== 'Standard' ? ` · ${escHtml(item.variantName)}` : '';
          const extras = [];
          if (item.addons) {
            Object.keys(item.addons).forEach(key => {
              const a = item.addons[key];
              if (a && a.qty > 0) extras.push(`${a.qty}× ${escHtml(a.name || key)}`);
            });
          }
          if (item.notes) extras.push(`Note: ${escHtml(item.notes)}`);
          const clickName = String(item.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const basePrice = parseFloat(item.basePrice || item.variantPrice || item.price) || 0;
          return `
            <li class="tk-cart-item" onclick="window.openAddOrderModal('${clickName}', ${basePrice}, window.cart[${index}])">
              <div>
                <div class="tk-cart-name">${escHtml(item.name || 'Item')}${variant}</div>
                <div class="tk-cart-qty">Qty ${qty}</div>
                ${extras.length ? `<div class="tk-cart-meta">${extras.join(' · ')}</div>` : ''}
              </div>
              <div class="tk-cart-price">
                ${money(line)}
                <div><button type="button" class="tk-remove-btn" onclick="event.stopPropagation(); window.cart.splice(${index},1); window.renderCart();">Remove</button></div>
              </div>
            </li>`;
        }).join('');
      }

      window.currentGrandTotal = total;
      const sub = document.getElementById('displaySubTotal');
      const grand = document.getElementById('displayGrandTotal');
      if (sub) sub.innerText = `₱ ${total.toFixed(2)}`;
      if (grand) grand.innerText = `₱ ${total.toFixed(2)}`;
    };
  }

  function installMobileDock() {
    if (document.getElementById('tkMobileDock')) return;
    const dock = document.createElement('nav');
    dock.id = 'tkMobileDock';
    dock.innerHTML = `
      <button class="tk-dock-btn active" data-target="pos"><span>▣</span>POS</button>
      <button class="tk-dock-btn" data-target="sales"><span>≡</span>Orders</button>
      <button class="tk-dock-btn" data-target="mobilehub"><span>◉</span>Mobile</button>
      <button class="tk-dock-btn" data-target="stockreq"><span>□</span>Stock</button>
      <button class="tk-dock-btn" data-target="more"><span>•••</span>More</button>`;
    document.body.appendChild(dock);

    dock.querySelectorAll('.tk-dock-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const sidebar = document.getElementById('mainSidebar');
        if (target === 'more') {
          sidebar?.classList.toggle('tk-mobile-menu-open');
          return;
        }
        sidebar?.classList.remove('tk-mobile-menu-open');
        if (typeof window.switchView === 'function') window.switchView(target);
        if (target === 'mobilehub' && typeof window.loadMenuManager === 'function') window.loadMenuManager();
        if (target === 'stockreq' && typeof window.loadStockRequestUI === 'function') window.loadStockRequestUI();
        dock.querySelectorAll('.tk-dock-btn').forEach(x => x.classList.toggle('active', x === btn));
      });
    });
  }

  function install() {
    decorateShell();
    installMenuRenderer();
    installCartRenderer();
    if (typeof window.buildCategories === 'function') window.buildCategories();
    if (typeof window.renderCart === 'function') window.renderCart();
  }

  window.addEventListener('load', () => setTimeout(install, 80), { once: true });
})();
