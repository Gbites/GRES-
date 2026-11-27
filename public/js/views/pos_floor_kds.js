(function () {
  'use strict';

  const { esc, formatINR, toast, get, post, put, patch, del } = window.BistroAPI;

  // ==================== POS TERMINAL VIEW ====================
  async function renderPOS(root, app) {
    const [menuData, tables, activeOrders] = await Promise.all([
      get('/api/menu'),
      get('/api/tables'),
      get('/api/orders?status=active')
    ]);

    const posState = app.state.pos || {
      orderType: 'dine_in',
      tableId: tables.find((t) => t.status === 'occupied')?.id || tables.find((t) => t.status === 'available')?.id || null,
      activeOrderId: null,
      cart: [],
      categoryId: 'all',
      dietary: 'all',
      search: ''
    };
    app.state.pos = posState;

    // Resolve activeOrderId from selected table if dine_in
    if (posState.orderType === 'dine_in' && posState.tableId) {
      const tbl = tables.find((t) => t.id === Number(posState.tableId));
      posState.activeOrderId = tbl?.current_order_id || null;
    }

    const currentOrder = posState.activeOrderId
      ? activeOrders.find((o) => o.id === Number(posState.activeOrderId)) || null
      : null;

    function getCartPreviewBill() {
      const sym = app.state.settings?.currency_symbol || '₹';
      const existingItems = (currentOrder?.items || []).filter((i) => i.status !== 'void');
      const combined = [
        ...existingItems.map((i) => ({ qty: i.qty, unit_price: i.unit_price, gst_rate: i.gst_rate })),
        ...posState.cart.map((c) => ({ qty: c.qty, unit_price: c.unit_price, gst_rate: c.gst_rate }))
      ];
      // Approximate preview before server KOT commit (authoritative calculation runs server-side)
      const draftSub = posState.cart.reduce((s, c) => s + c.qty * c.unit_price, 0);
      return { sym, draftSub, totalItems: combined.reduce((s, i) => s + i.qty, 0) };
    }

    const cust = app.state.settings?.customization || {};
    const posCfg = cust.pos || {};
    const menuCfg = cust.menu || {};
    const rulesCfg = cust.businessRules || {};
    const advCfg = cust.advanced || {};
    const qaSet = new Set(Array.isArray(posCfg.quickActions) ? posCfg.quickActions : ['hold', 'discount', 'kot_print', 'settle']);

    const filteredItems = menuData.items.filter((it) => {
      if (menuCfg.showOutOfStock === false && !it.available) return false;
      if (posState.categoryId !== 'all' && it.category_id !== Number(posState.categoryId)) return false;
      if (posState.dietary !== 'all' && it.dietary !== posState.dietary) return false;
      if (posState.search) {
        const q = posState.search.toLowerCase();
        if (!it.name.toLowerCase().includes(q) && !it.sku.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const bill = currentOrder?.bill;
    const previewInfo = getCartPreviewBill();
    const gridStyle = posCfg.layout !== 'list' && posCfg.columns && posCfg.columns !== 'auto'
      ? `style="grid-template-columns:repeat(${Number(posCfg.columns)},minmax(0,1fr))"`
      : '';

    root.innerHTML = `
      <div class="pos-layout btn-pos-${esc(posCfg.buttonSize || 'md')}">
        <!-- Left Catalog -->
        <div>
          <div class="pos-toolbar card" style="margin-bottom:12px">
            <div style="display:flex;gap:6px">
              ${['dine_in', 'takeaway', 'delivery'].map((ot) => `
                <button class="btn btn-sm ${posState.orderType === ot ? 'btn-primary' : 'btn-secondary'}" data-otype="${ot}">
                  ${ot === 'dine_in' ? 'Dine-In' : ot === 'takeaway' ? 'Takeaway' : 'Delivery'}
                </button>
              `).join('')}
            </div>

            ${posState.orderType === 'dine_in' ? (
        tables.filter((t) => t.status !== 'merged').length > 0 ? `
                <select id="posTableSelect" class="select-sm" style="min-width:170px">
                  ${tables.filter((t) => t.status !== 'merged').map((t) => `
                    <option value="${t.id}" ${Number(posState.tableId) === t.id ? 'selected' : ''}>
                      ${esc(t.label_override || t.name)} (${esc(t.zone)}) — ${t.status.toUpperCase()}
                    </option>
                  `).join('')}
                </select>
              ` : '<span class="pill pill-amber">No Tables Added</span>'
      ) : `
              <select id="posHoldSelect" class="select-sm" style="min-width:190px">
                <option value="">+ New ${posState.orderType} Order</option>
                ${activeOrders.filter((o) => o.order_type === posState.orderType).map((o) => `
                  <option value="${o.id}" ${Number(posState.activeOrderId) === o.id ? 'selected' : ''}>
                    ${esc(o.order_number)} • ${esc(o.customer_name)} (${o.status.toUpperCase()})
                  </option>
                `).join('')}
              </select>
            `}

            <input type="search" id="posSearch" class="input" style="max-width:220px" placeholder="Search dishes or SKU..." value="${esc(posState.search)}">

            <div style="display:flex;gap:5px;margin-left:auto">
              ${['all', 'veg', 'non-veg', 'vegan'].map((d) => `
                <button class="btn btn-xs ${posState.dietary === d ? 'btn-primary' : 'btn-ghost'}" data-diet="${d}">
                  ${d.toUpperCase()}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="${posCfg.categoryPosition === 'left' ? 'pos-catalog-split' : ''}">
            <div class="pos-cats">
              <button class="cat-tab ${posState.categoryId === 'all' ? 'active' : ''}" data-cat="all">All Items (${menuData.items.length})</button>
              ${menuData.categories.map((c) => `
                <button class="cat-tab ${Number(posState.categoryId) === c.id ? 'active' : ''}" data-cat="${c.id}">
                  ${c.parent_id ? '↳ ' : ''}${esc(c.name)}
                </button>
              `).join('')}
            </div>

            <div class="menu-grid ${posCfg.layout === 'list' ? 'list-view' : ''} card-${esc(posCfg.cardSize || 'medium')}" ${gridStyle}>
              ${filteredItems.map((it) => {
        const initials = it.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
        const hue = (it.category_id * 47 + 15) % 360;
        return `
                <button class="menu-tile ${it.available ? '' : 'disabled'}" data-item-id="${it.id}" ${it.available ? '' : 'disabled'}>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    ${posCfg.showImages !== false ? (
            it.photo_url
              ? `<img src="${esc(it.photo_url)}" alt="${esc(it.name)}" class="dish-avatar" style="object-fit:cover">`
              : `<div class="dish-avatar" style="background:linear-gradient(135deg, hsl(${hue}, 82%, 52%), hsl(${(hue + 28) % 360}, 85%, 42%))">${esc(initials)}</div>`
          ) : ''}
                    <div style="display:flex;align-items:center;gap:6px">
                      ${posCfg.showGstBadge !== false ? `<span class="mono muted" style="font-size:10px">GST ${it.gst_rate}%</span>` : ''}
                      <span class="diet-dot ${esc(it.dietary)}" title="${esc(it.dietary)}"></span>
                    </div>
                  </div>
                  <strong style="font-size:13.5px;line-height:1.3">${esc(it.name)}</strong>
                  ${posCfg.showStation !== false ? `<span class="muted" style="font-size:11px">${esc(it.station)}${it.extras?.length ? ` • +${it.extras.length} extras` : ''}</span>` : ''}
                  ${posCfg.showSku && it.sku ? `<span class="mono muted" style="font-size:10px">${esc(it.sku)}</span>` : ''}
                  ${Array.isArray(it.labels) && it.labels.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${it.labels.map((l) => `<span class="pill pill-orange" style="font-size:9px;padding:1px 6px">${esc(l)}</span>`).join('')}</div>` : ''}
                  <div class="menu-tile-price">${formatINR(it.price)}</div>
                </button>`;
      }).join('') || `
                <div class="empty-state" style="grid-column:1/-1">
                  <h4>${menuData.items.length === 0 ? 'No Menu Items Yet' : 'No Matching Dishes'}</h4>
                  <p>${menuData.items.length === 0 ? 'Add categories and dishes to your menu catalog to start taking orders.' : 'Try clearing your search or dietary filter.'}</p>
                  ${menuData.items.length === 0 && app.can('menu:edit') ? '<button class="btn btn-sm btn-primary" id="posGoMenuBtn">+ Add Menu Items</button>' : ''}
                </div>
              `}
            </div>
          </div>
        </div>

        <!-- Right Order / Billing Panel -->
        <aside class="pos-ticket">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div>
              <strong style="font-size:15px">
                ${currentOrder ? `${esc(currentOrder.order_number)} • ${esc(currentOrder.table_name || currentOrder.order_type.toUpperCase())}` : 'New Order Ticket'}
              </strong>
              <div class="muted" style="font-size:11px">
                ${currentOrder ? `Status: ${currentOrder.status.toUpperCase()} • ${esc(currentOrder.customer_name)}` : 'Add dishes & Fire KOT to kitchen'}
              </div>
            </div>
            ${currentOrder ? `
              <div style="display:flex;gap:5px">
                <button class="btn btn-xs btn-ghost" id="posGuestEditBtn" title="Edit guest info">Guest</button>
                ${qaSet.has('hold') ? `
                  <button class="btn btn-xs btn-ghost" id="posHoldBtn">
                    ${currentOrder.status === 'hold' ? 'Resume' : 'Hold'}
                  </button>
                ` : ''}
                ${app.can('orders:void') ? '<button class="btn btn-xs btn-danger" id="posCancelOrdBtn" title="Cancel entire order">Cancel</button>' : ''}
              </div>
            ` : ''}
          </div>

          ${!currentOrder ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input type="text" id="custName" class="input" placeholder="Customer Name (optional)">
              <input type="text" id="custPhone" class="input" placeholder="Phone (optional)">
            </div>
          ` : ''}

          <div class="ticket-items">
            ${posState.cart.length > 0 ? `
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="mono muted" style="font-size:10px">UNFIRED DRAFT ITEMS (WILL SEND AS KOT)</span>
                <button class="btn btn-xs btn-ghost" id="clearCartBtn">Clear</button>
              </div>
              ${posState.cart.map((c, idx) => `
                <div class="ticket-row" style="border-color:var(--accent)">
                  <div style="min-width:0;flex:1">
                    <strong style="font-size:12px">${esc(c.name)}</strong>
                    ${c.variant_name ? `<div class="muted" style="font-size:11px">${esc(c.variant_name)}</div>` : ''}
                    ${c.extras?.length ? `<div class="muted" style="font-size:11px">+ ${c.extras.map(esc).join(', ')}</div>` : ''}
                    ${c.notes ? `<div style="font-size:11px;color:var(--warning)">Note: ${esc(c.notes)}</div>` : ''}
                  </div>
                  <button class="btn btn-xs btn-ghost" data-cart-note="${idx}" title="Add kitchen note">✎</button>
                  <div class="qty-ctrl">
                    <button class="qty-btn" data-cart-dec="${idx}">-</button>
                    <span class="mono" style="font-weight:700">${c.qty}</span>
                    <button class="qty-btn" data-cart-inc="${idx}">+</button>
                  </div>
                  <span class="mono" style="font-size:12px;font-weight:700">${formatINR(c.qty * c.unit_price)}</span>
                </div>
              `).join('')}
            ` : ''}

            ${currentOrder ? `
              <div class="mono muted" style="font-size:10px;margin-top:4px">RUNNING KOT ITEMS</div>
              ${currentOrder.items.map((it) => `
                <div class="ticket-row ${it.status === 'void' ? 'voided' : ''}">
                  <div style="min-width:0;flex:1">
                    <div style="display:flex;align-items:center;gap:6px">
                      <strong style="font-size:12px">${it.qty}× ${esc(it.name)}</strong>
                      <span class="pill ${it.status === 'ready' || it.status === 'served' ? 'pill-green' : it.status === 'preparing' ? 'pill-amber' : it.status === 'void' ? 'pill-red' : 'pill-blue'}" style="font-size:9px">${it.status}</span>
                    </div>
                    <div class="muted" style="font-size:10px">${esc(it.kot_number)}${it.variant_name ? ` • ${esc(it.variant_name)}` : ''}${it.extras?.length ? ` • +${it.extras.map((ex) => esc(ex.name)).join(', ')}` : ''}${it.notes ? ` • ${esc(it.notes)}` : ''}</div>
                  </div>
                  <span class="mono" style="font-size:12px">${formatINR(it.qty * it.unit_price)}</span>
                  ${it.status !== 'void' ? `<button class="btn btn-xs btn-danger" data-void-item="${it.id}" title="Void item">✕</button>` : ''}
                </div>
              `).join('')}
            ` : ''}

            ${posState.cart.length === 0 && !currentOrder ? `
              <div class="muted" style="text-align:center;padding:28px 10px">Tap menu items on the left to build an order.</div>
            ` : ''}
          </div>

          ${currentOrder && app.can('orders:discount') && qaSet.has('discount') ? `
            <div style="display:grid;grid-template-columns:1fr 70px 72px 64px;gap:6px;align-items:center">
              <select id="discType" class="select-sm" title="Discount Type">
                <option value="none" ${currentOrder.discount_type === 'none' ? 'selected' : ''}>No Disc</option>
                <option value="percent" ${currentOrder.discount_type === 'percent' ? 'selected' : ''}>Disc %</option>
                <option value="flat" ${currentOrder.discount_type === 'flat' ? 'selected' : ''}>Flat ₹</option>
              </select>
              <input type="number" id="discVal" class="input" style="padding:6px" min="0" max="${rulesCfg.maxDiscountPct ?? 100}" value="${currentOrder.discount_value || 0}" title="Discount Value">
              <input type="number" id="scVal" class="input" style="padding:6px" min="0" step="0.5" value="${currentOrder.service_charge_rate ?? 0}" title="Service Charge %">
              <button class="btn btn-xs btn-secondary" id="applyDiscBtn">Apply</button>
            </div>
          ` : ''}

          <div class="bill-summary">
            ${bill ? `
              <div class="bill-line"><span>Subtotal</span><span class="mono">${formatINR(bill.subtotal)}</span></div>
              ${bill.discount_amount > 0 ? `<div class="bill-line" style="color:var(--success)"><span>Discount</span><span class="mono">-${formatINR(bill.discount_amount)}</span></div>` : ''}
              ${bill.service_charge_amount > 0 ? `<div class="bill-line"><span>Service Charge (${bill.service_charge_rate}%)</span><span class="mono">${formatINR(bill.service_charge_amount)}</span></div>` : ''}
              ${bill.packaging_charge > 0 ? `<div class="bill-line"><span>Packaging Charge</span><span class="mono">${formatINR(bill.packaging_charge)}</span></div>` : ''}
              <div class="bill-line"><span>${bill.igst_amount > 0 ? 'IGST' : 'CGST + SGST'}</span><span class="mono">${formatINR(bill.tax_amount)}</span></div>
              ${bill.round_off !== 0 ? `<div class="bill-line"><span>Round Off</span><span class="mono">${formatINR(bill.round_off)}</span></div>` : ''}
              <div class="bill-line bill-total"><span>SERVER TOTAL</span><span>${formatINR(bill.grand_total)}</span></div>
            ` : `
              <div class="bill-line"><span>Draft Items Total (pre-GST)</span><span class="mono">${formatINR(previewInfo.draftSub)}</span></div>
            `}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-secondary" id="fireKotBtn" ${posState.cart.length === 0 ? 'disabled' : ''}>
              Fire KOT (${posState.cart.reduce((s, c) => s + c.qty, 0)})
            </button>
            ${qaSet.has('settle') ? `
              <button class="btn btn-primary btn-shimmer" id="settleBtn" ${!currentOrder || posState.cart.length > 0 ? 'disabled' : ''} title="${posState.cart.length > 0 ? 'Fire or clear draft items first' : 'Settle & Print GST Bill'}">
                Settle Bill
              </button>
            ` : ''}
          </div>
          ${currentOrder && qaSet.has('kot_print') ? `
            <button class="btn btn-xs btn-ghost" id="printLatestKotBtn">Print Kitchen KOT</button>
          ` : ''}
        </aside>
      </div>
    `;

    // Event bindings
    root.querySelectorAll('[data-otype]').forEach((btn) => {
      btn.addEventListener('click', () => {
        posState.orderType = btn.dataset.otype;
        if (posState.orderType !== 'dine_in') posState.activeOrderId = null;
        renderPOS(root, app);
      });
    });

    document.getElementById('posTableSelect')?.addEventListener('change', (e) => {
      posState.tableId = Number(e.target.value);
      renderPOS(root, app);
    });

    document.getElementById('posHoldSelect')?.addEventListener('change', (e) => {
      posState.activeOrderId = e.target.value ? Number(e.target.value) : null;
      renderPOS(root, app);
    });

    document.getElementById('posSearch')?.addEventListener('input', (e) => {
      posState.search = e.target.value;
      renderPOS(root, app);
      const inp = document.getElementById('posSearch');
      inp?.focus();
      inp?.setSelectionRange(inp.value.length, inp.value.length);
    });

    root.querySelectorAll('[data-diet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        posState.dietary = btn.dataset.diet;
        renderPOS(root, app);
      });
    });

    root.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        posState.categoryId = btn.dataset.cat;
        renderPOS(root, app);
      });
    });

    document.getElementById('posGoMenuBtn')?.addEventListener('click', () => app.navigate('menu'));

    // Add item click (with optional variant + extras picker)
    root.querySelectorAll('[data-item-id]').forEach((tile) => {
      tile.addEventListener('click', () => {
        const item = menuData.items.find((m) => m.id === Number(tile.dataset.itemId));
        if (!item) return;
        const hasVars = Array.isArray(item.variants) && item.variants.length > 0;
        const hasExtras = Array.isArray(item.extras) && item.extras.length > 0;
        if (hasVars || hasExtras) {
          app.openModal(`Customize ${item.name}`, `
            <div style="display:flex;flex-direction:column;gap:12px">
              ${hasVars ? `
                <div class="field-label">Select Portion / Variant
                  <select id="varSelect" class="select">
                    ${item.variants.map((v) => `
                      <option value="${esc(v.name)}" data-delta="${v.priceDelta || 0}">
                        ${esc(v.name)} (${v.priceDelta >= 0 ? '+' : ''}${formatINR(v.priceDelta || 0)})
                      </option>
                    `).join('')}
                  </select>
                </div>
              ` : ''}
              ${hasExtras ? `
                <div>
                  <span class="field-label" style="display:block;margin-bottom:6px">Extras / Add-ons</span>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    ${item.extras.map((ex, idx) => `
                      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;cursor:pointer">
                        <input type="checkbox" class="pos-extra-cb" data-ex-idx="${idx}" value="${esc(ex.name)}" data-price="${Number(ex.price || 0)}">
                        <span>${esc(ex.name)} <span class="mono muted">(+${formatINR(ex.price || 0)})</span></span>
                      </label>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              <label class="field-label">Kitchen Note (optional)
                <input type="text" id="varNote" class="input" placeholder="e.g. No onion, extra spicy">
              </label>
              <button class="btn btn-primary" id="confirmVarBtn">Add to Ticket</button>
            </div>
          `);
          document.getElementById('confirmVarBtn').onclick = () => {
            let vName = '';
            let vDelta = 0;
            if (hasVars) {
              const sel = document.getElementById('varSelect');
              const opt = sel.options[sel.selectedIndex];
              vName = sel.value;
              vDelta = Number(opt.dataset.delta || 0);
            }
            const chosenExtras = Array.from(document.querySelectorAll('.pos-extra-cb:checked'));
            const extraNames = chosenExtras.map((cb) => cb.value);
            const extraTotal = chosenExtras.reduce((s, cb) => s + Number(cb.dataset.price || 0), 0);
            const note = document.getElementById('varNote').value.trim();
            pushToCart(item, vName, extraNames, item.price + vDelta + extraTotal, note);
            app.closeModal();
            renderPOS(root, app);
          };
        } else {
          pushToCart(item, '', [], item.price, '');
          renderPOS(root, app);
        }
      });
    });

    function pushToCart(item, variantName, extras, unitPrice, notes) {
      const extrasKey = (extras || []).slice().sort().join('|');
      const existing = posState.cart.find(
        (c) => c.menu_item_id === item.id
          && c.variant_name === variantName
          && (c.extras || []).slice().sort().join('|') === extrasKey
          && c.notes === notes
      );
      if (existing) existing.qty += 1;
      else {
        posState.cart.push({
          menu_item_id: item.id,
          name: item.name,
          variant_name: variantName,
          extras: extras || [],
          qty: 1,
          unit_price: unitPrice,
          gst_rate: item.gst_rate,
          notes
        });
      }
    }

    root.querySelectorAll('[data-cart-inc]').forEach((b) => {
      b.onclick = () => {
        posState.cart[Number(b.dataset.cartInc)].qty++;
        renderPOS(root, app);
      };
    });

    root.querySelectorAll('[data-cart-dec]').forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.cartDec);
        posState.cart[idx].qty--;
        if (posState.cart[idx].qty <= 0) posState.cart.splice(idx, 1);
        renderPOS(root, app);
      };
    });

    document.getElementById('clearCartBtn')?.addEventListener('click', () => {
      posState.cart = [];
      renderPOS(root, app);
    });

    root.querySelectorAll('[data-cart-note]').forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.cartNote);
        const item = posState.cart[idx];
        app.openModal(`Kitchen Note — ${item.name}`, `
          <form id="cartNoteForm" style="display:flex;flex-direction:column;gap:12px">
            <label class="field-label">Special Instructions
              <input id="cartNoteInput" class="input" value="${esc(item.notes || '')}" placeholder="e.g. Extra spicy, Jain, no onion" autofocus>
            </label>
            <button type="submit" class="btn btn-primary">Save Note</button>
          </form>
        `);
        document.getElementById('cartNoteForm').onsubmit = (e) => {
          e.preventDefault();
          item.notes = document.getElementById('cartNoteInput').value.trim();
          app.closeModal();
          renderPOS(root, app);
        };
      };
    });

    // Fire KOT
    document.getElementById('fireKotBtn')?.addEventListener('click', async () => {
      try {
        let updated;
        if (currentOrder) {
          updated = await post(`/api/orders/${currentOrder.id}/items`, { items: posState.cart });
        } else {
          updated = await post('/api/orders', {
            order_type: posState.orderType,
            table_id: posState.orderType === 'dine_in' ? posState.tableId : null,
            customer_name: document.getElementById('custName')?.value.trim() || '',
            customer_phone: document.getElementById('custPhone')?.value.trim() || '',
            items: posState.cart
          });
        }
        posState.cart = [];
        posState.activeOrderId = updated.id;
        toast(`KOT fired for ${updated.order_number}!`, 'success');
        if (advCfg.autoPrintKot) {
          const latestKot = updated.items[updated.items.length - 1]?.kot_number;
          window.BistroThermal.printKot(updated, latestKot, app.state.activeBranch, app.state.settings);
        }
        renderPOS(root, app);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Void item
    root.querySelectorAll('[data-void-item]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await patch(`/api/orders/${currentOrder.id}/items/${btn.dataset.voidItem}`, { status: 'void' });
          toast('Item voided from bill', 'info');
          renderPOS(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });

    // Hold / Resume
    document.getElementById('posHoldBtn')?.addEventListener('click', async () => {
      try {
        const nextStatus = currentOrder.status === 'hold' ? 'open' : 'hold';
        await patch(`/api/orders/${currentOrder.id}`, { status: nextStatus });
        toast(`Order marked ${nextStatus.toUpperCase()}`, 'info');
        renderPOS(root, app);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Edit Guest Info & Cancel Order
    document.getElementById('posGuestEditBtn')?.addEventListener('click', () => {
      app.openModal(`Guest Details — ${currentOrder.order_number}`, `
        <form id="guestEditForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field-label">Guest Name <input id="geName" class="input" value="${esc(currentOrder.customer_name)}" required></label>
          <label class="field-label">Phone <input id="gePhone" class="input" value="${esc(currentOrder.customer_phone || '')}"></label>
          <label class="field-label">Order Notes <input id="geNotes" class="input" value="${esc(currentOrder.notes || '')}"></label>
          <button type="submit" class="btn btn-primary">Update Guest Info</button>
        </form>
      `);
      document.getElementById('guestEditForm').onsubmit = async (e) => {
        e.preventDefault();
        await patch(`/api/orders/${currentOrder.id}`, {
          customer_name: document.getElementById('geName').value,
          customer_phone: document.getElementById('gePhone').value,
          notes: document.getElementById('geNotes').value
        });
        app.closeModal();
        toast('Guest info updated', 'success');
        renderPOS(root, app);
      };
    });

    document.getElementById('posCancelOrdBtn')?.addEventListener('click', () => {
      const reasons = Array.isArray(rulesCfg.cancellationReasons) && rulesCfg.cancellationReasons.length
        ? rulesCfg.cancellationReasons
        : ['Customer changed mind', 'Out of stock'];
      app.openModal(`Cancel Order ${currentOrder.order_number}`, `
        <form id="cancelOrderReasonForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field-label">Cancellation Reason
            <select id="cancelReasonSel" class="select">
              ${reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
              <option value="Other">Other</option>
            </select>
          </label>
          <button type="submit" class="btn btn-danger">Confirm Cancel Order</button>
        </form>
      `);
      document.getElementById('cancelOrderReasonForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const reason = document.getElementById('cancelReasonSel').value;
          await post(`/api/orders/${currentOrder.id}/cancel`, { reason });
          app.closeModal();
          posState.activeOrderId = null;
          posState.cart = [];
          toast(`Cancelled ${currentOrder.order_number}`, 'info');
          renderPOS(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });

    // Apply Discount & Service Charge
    document.getElementById('applyDiscBtn')?.addEventListener('click', async () => {
      try {
        const discount_type = document.getElementById('discType').value;
        const discount_value = Number(document.getElementById('discVal').value || 0);
        const service_charge_rate = Number(document.getElementById('scVal').value || 0);
        await patch(`/api/orders/${currentOrder.id}`, { discount_type, discount_value, service_charge_rate });
        toast('Billing adjustments updated & GST recalculated', 'success');
        renderPOS(root, app);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    document.getElementById('printLatestKotBtn')?.addEventListener('click', () => {
      const latestKot = currentOrder.items[currentOrder.items.length - 1]?.kot_number;
      window.BistroThermal.printKot(currentOrder, latestKot, app.state.activeBranch, app.state.settings);
    });

    // Settlement Modal
    document.getElementById('settleBtn')?.addEventListener('click', () => {
      if (!currentOrder) return;
      const gTotal = currentOrder.bill.grand_total;
      const upiId = app.state.settings?.upi_id || 'gres@okaxis';

      app.openModal(`Settle ${currentOrder.order_number}`, `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card" style="background:var(--bg)">
            <div class="bill-line"><span>Subtotal</span><span class="mono">${formatINR(currentOrder.bill.subtotal)}</span></div>
            ${currentOrder.bill.discount_amount > 0 ? `<div class="bill-line"><span>Discount</span><span class="mono">-${formatINR(currentOrder.bill.discount_amount)}</span></div>` : ''}
            ${currentOrder.bill.service_charge_amount > 0 ? `<div class="bill-line"><span>Service Charge</span><span class="mono">${formatINR(currentOrder.bill.service_charge_amount)}</span></div>` : ''}
            ${currentOrder.bill.packaging_charge > 0 ? `<div class="bill-line"><span>Packaging Charge</span><span class="mono">${formatINR(currentOrder.bill.packaging_charge)}</span></div>` : ''}
            ${currentOrder.bill.gst_enabled === false ? '' : (
          currentOrder.bill.igst_amount > 0
            ? `<div class="bill-line"><span>IGST</span><span class="mono">${formatINR(currentOrder.bill.igst_amount)}</span></div>`
            : `<div class="bill-line"><span>CGST (${(currentOrder.bill.tax_slabs[0]?.rate || 5) / 2}%)</span><span class="mono">${formatINR(currentOrder.bill.cgst_amount)}</span></div>
                   <div class="bill-line"><span>SGST (${(currentOrder.bill.tax_slabs[0]?.rate || 5) / 2}%)</span><span class="mono">${formatINR(currentOrder.bill.sgst_amount)}</span></div>`
        )}
            ${currentOrder.bill.round_off !== 0 ? `<div class="bill-line"><span>Round Off</span><span class="mono">${formatINR(currentOrder.bill.round_off)}</span></div>` : ''}
            <div class="bill-line bill-total"><span>PAYABLE TOTAL</span><span>${formatINR(gTotal)}</span></div>
          </div>

          <label class="field-label">Payment Mode
            <select id="payMode" class="select">
              ${(() => {
          const pm = rulesCfg.paymentMethods || { cash: true, upi: true, card: true, split: true, customMethods: [] };
          const opts = [];
          if (pm.upi !== false) opts.push('<option value="upi">UPI (GPay / PhonePe / Paytm)</option>');
          if (pm.cash !== false) opts.push('<option value="cash">Cash</option>');
          if (pm.card !== false) opts.push('<option value="card">Card (POS Swipe / Tap)</option>');
          if (pm.split !== false) opts.push('<option value="split">Split Payment</option>');
          (pm.customMethods || []).forEach((cm) => opts.push(`<option value="${esc(cm)}">${esc(cm)}</option>`));
          if (opts.length === 0) opts.push('<option value="cash">Cash</option>');
          return opts.join('');
        })()}
            </select>
          </label>

          <div id="upiBox" class="card" style="background:var(--bg);font-size:12px">
            UPI VPA: <strong class="mono">${esc(upiId)}</strong> • Amount: <strong class="mono">${formatINR(gTotal)}</strong>
          </div>

          <div id="cashBox" class="hidden" style="display:flex;flex-direction:column;gap:8px">
            <label class="field-label">Cash Tendered (${esc(app.state.settings?.currency_symbol || '₹')})
              <input type="number" id="cashTendered" class="input" value="${gTotal}" min="${gTotal}" step="1">
            </label>
            <div class="mono" style="font-size:12px">Change Due: <strong id="changeDueText">${formatINR(0)}</strong></div>
          </div>

          <div id="splitBox" class="hidden" style="display:flex;flex-direction:column;gap:8px">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <label class="field-label">Cash ₹ <input type="number" id="spCash" class="input" value="${Math.floor(gTotal / 2)}" min="0" step="1"></label>
              <label class="field-label">UPI ₹ <input type="number" id="spUpi" class="input" value="${(gTotal - Math.floor(gTotal / 2)).toFixed(2)}" min="0" step="0.01"></label>
              <label class="field-label">Card ₹ <input type="number" id="spCard" class="input" value="0" min="0" step="0.01"></label>
            </div>
            <div class="mono" style="font-size:12px">Remaining to allocate: <strong id="splitRemainText">${formatINR(0)}</strong></div>
          </div>

          <button class="btn btn-success btn-full" id="confirmSettleBtn">Complete Settlement &amp; Deduct Stock</button>
        </div>
      `);

      const payModeEl = document.getElementById('payMode');
      const upiBox = document.getElementById('upiBox');
      const cashBox = document.getElementById('cashBox');
      const splitBox = document.getElementById('splitBox');
      const cashInp = document.getElementById('cashTendered');
      const changeTxt = document.getElementById('changeDueText');
      const spCash = document.getElementById('spCash');
      const spUpi = document.getElementById('spUpi');
      const spCard = document.getElementById('spCard');
      const spRemTxt = document.getElementById('splitRemainText');

      function updateSplitRemain() {
        const sum = Number(spCash.value || 0) + Number(spUpi.value || 0) + Number(spCard.value || 0);
        const rem = gTotal - sum;
        spRemTxt.textContent = formatINR(rem);
        spRemTxt.style.color = Math.abs(rem) <= 0.5 ? 'var(--success)' : 'var(--danger)';
      }
      [spCash, spUpi, spCard].forEach((el) => { el.oninput = updateSplitRemain; });

      payModeEl.onchange = () => {
        upiBox.classList.toggle('hidden', payModeEl.value !== 'upi');
        cashBox.classList.toggle('hidden', payModeEl.value !== 'cash');
        splitBox.classList.toggle('hidden', payModeEl.value !== 'split');
        if (payModeEl.value === 'split') updateSplitRemain();
      };
      payModeEl.onchange();

      cashInp.oninput = () => {
        const diff = Math.max(0, Number(cashInp.value || 0) - gTotal);
        changeTxt.textContent = formatINR(diff);
      };

      document.getElementById('confirmSettleBtn').onclick = async () => {
        try {
          const paymentDetails = payModeEl.value === 'split'
            ? { cash: Number(spCash.value || 0), upi: Number(spUpi.value || 0), card: Number(spCard.value || 0) }
            : {};
          const inv = await post(`/api/orders/${currentOrder.id}/settle`, {
            paymentMode: payModeEl.value,
            paymentDetails,
            amountTendered: payModeEl.value === 'cash' ? Number(cashInp.value) : gTotal
          });
          posState.activeOrderId = null;
          toast(`Invoice ${inv.invoice_number} settled!`, 'success');

          app.openModal(`Invoice ${inv.invoice_number} Settled`, `
            <div style="display:flex;flex-direction:column;gap:12px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="pill pill-green">PAID • ${inv.payment_mode.toUpperCase()}</span>
                <strong class="mono" style="font-size:16px">${formatINR(inv.grand_total)}</strong>
              </div>
              <div style="background:#fff;color:#000;padding:12px;border-radius:8px;font-family:'Courier New',monospace;font-size:11px;max-height:240px;overflow-y:auto">
                ${window.BistroThermal.buildReceiptHtml(inv, app.state.activeBranch, app.state.settings)}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <a class="btn btn-primary" href="/api/invoices/${inv.id}/pdf" target="_blank">Download PDF</a>
                <button class="btn btn-secondary" id="settledThermalBtn">Thermal Print</button>
              </div>
              <button class="btn btn-ghost" id="settledEscPosBtn">Direct ESC/POS Print / .BIN</button>
            </div>
          `);

          document.getElementById('settledThermalBtn').onclick = () => {
            window.BistroThermal.printThermalInvoice(inv, app.state.activeBranch, app.state.settings);
          };
          document.getElementById('settledEscPosBtn').onclick = () => {
            window.BistroThermal.printDirectEscPos(inv, app.state.activeBranch, app.state.settings);
          };
          if (advCfg.autoPrintInvoice) {
            window.BistroThermal.printThermalInvoice(inv, app.state.activeBranch, app.state.settings);
          }
          renderPOS(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });

    if (window._gresPosKeyHandler) {
      window.removeEventListener('keydown', window._gresPosKeyHandler);
    }
    if (posCfg.shortcutsEnabled !== false) {
      const keys = posCfg.shortcuts || { search: '/', fireKot: 'F2', settle: 'F9', hold: 'F4', clearCart: 'Escape' };
      window._gresPosKeyHandler = (e) => {
        if (app.state.currentView !== 'pos') return;
        if (!document.getElementById('modalRoot')?.classList.contains('hidden')) return;
        if (!document.getElementById('onboardingScreen')?.classList.contains('hidden')) return;
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag) && e.key !== 'Escape') return;
        if (e.key === keys.search) { e.preventDefault(); document.getElementById('posSearch')?.focus(); }
        else if (e.key === keys.fireKot) { e.preventDefault(); document.getElementById('fireKotBtn')?.click(); }
        else if (e.key === keys.settle) { e.preventDefault(); document.getElementById('settleBtn')?.click(); }
        else if (e.key === keys.hold) { e.preventDefault(); document.getElementById('posHoldBtn')?.click(); }
        else if (e.key === (keys.clearCart || 'Escape') && posState.cart.length > 0) {
          document.getElementById('clearCartBtn')?.click();
        }
      };
      window.addEventListener('keydown', window._gresPosKeyHandler);
    }
  }

  // ==================== FLOOR PLAN EDITOR & SERVICE ====================
  async function renderFloorPlan(root, app) {
    const [tables, floors] = await Promise.all([get('/api/tables'), get('/api/floors')]);
    const fpState = app.state.floor || { editMode: false, zone: 'All', floor: 'All' };
    app.state.floor = fpState;

    const floorNames = ['All', ...new Set([
      ...floors.map((f) => f.name),
      ...tables.map((t) => t.floor_name).filter(Boolean)
    ])];
    const zones = ['All', ...new Set(tables.map((t) => t.zone))];
    const visibleTables = tables.filter((t) =>
      (fpState.zone === 'All' || t.zone === fpState.zone)
      && (fpState.floor === 'All' || (t.floor_name || '') === fpState.floor)
    );
    const canEdit = app.can('floor:edit');

    root.innerHTML = `
      <div class="floor-toolbar">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${floorNames.length > 1 ? `
            <select id="fpFloorSelect" class="select-sm" style="max-width:150px" title="Filter by Floor">
              ${floorNames.map((fn) => `<option value="${esc(fn)}" ${fpState.floor === fn ? 'selected' : ''}>${fn === 'All' ? 'All Floors' : esc(fn)}</option>`).join('')}
            </select>
          ` : ''}
          ${zones.map((z) => `
            <button class="btn btn-sm ${fpState.zone === z ? 'btn-primary' : 'btn-secondary'}" data-zone="${esc(z)}">${esc(z)}</button>
          `).join('')}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="pill pill-green">Available</span>
          <span class="pill pill-orange">Occupied</span>
          <span class="pill pill-amber">Reserved</span>
          <span class="pill pill-blue">Merged</span>

          ${app.can('tables:transfer') ? '<button class="btn btn-sm btn-secondary" id="openTransferBtn">Transfer Table</button>' : ''}
          ${app.can('tables:merge') ? '<button class="btn btn-sm btn-secondary" id="openMergeBtn">Merge Tables</button>' : ''}
          ${canEdit ? `
            <button class="btn btn-sm ${fpState.editMode ? 'btn-primary' : 'btn-secondary'}" id="toggleEditFloorBtn">
              ${fpState.editMode ? 'Editing Layout' : 'Edit Floor Plan'}
            </button>
          ` : ''}
          ${fpState.editMode ? `
            <button class="btn btn-sm btn-secondary" id="manageFloorsBtn">Floors</button>
            <button class="btn btn-sm btn-secondary" id="addTableBtn">+ Add Table</button>
            <button class="btn btn-sm btn-success" id="saveLayoutBtn">Save Layout</button>
          ` : ''}
        </div>
      </div>

      <div class="floor-canvas" id="floorCanvas">
        ${visibleTables.length === 0 ? `
          <div class="empty-state" style="margin:64px auto;max-width:420px">
            <h4>No Tables on Floor Plan</h4>
            <p>Add tables to start managing dine-in seating, transfers, and merges.</p>
            ${canEdit ? `<button class="btn btn-sm btn-primary" id="emptyFloorAddBtn">+ Add First Table</button>` : ''}
          </div>
        ` : visibleTables.map((t) => {
      const tblCfg = app.state.settings?.customization?.tables || {};
      const seatCount = Math.min(8, Math.max(2, Number(t.seats || 4)));
      const seatPips = tblCfg.showSeatPips === false ? '' : Array.from({ length: seatCount }, (_, idx) => {
        const angle = (idx / seatCount) * Math.PI * 2 - Math.PI / 2;
        const px = 50 + Math.cos(angle) * 56;
        const py = 50 + Math.sin(angle) * 56;
        return `<span class="seat-pip" style="left:calc(${px.toFixed(1)}% - 5px);top:calc(${py.toFixed(1)}% - 5px)"></span>`;
      }).join('');
      const scale = Number(t.size_scale || 1);
      const customBorder = t.color ? `border-color:${esc(t.color)};` : '';
      return `
          <div class="floor-table shape-${esc(t.shape)} status-${esc(t.status)} ${fpState.editMode ? 'editing' : ''}"
               data-tid="${t.id}"
               style="left:${t.x}px;top:${t.y}px;width:${Math.round(t.width * scale)}px;height:${Math.round(t.height * scale)}px;${customBorder}">
            ${seatPips}
            <strong style="font-size:14px">${esc(t.label_override || t.name)}</strong>
            ${tblCfg.showZoneLabel !== false ? `<span class="mono muted" style="font-size:10px">${t.seats} seats • ${esc(t.zone)}</span>` : ''}
            ${t.status === 'occupied' && tblCfg.showAmountOnTable !== false ? `<span class="mono" style="font-size:11px;color:var(--accent);font-weight:700">${formatINR(t.running_total)}</span>` : ''}
            ${t.status === 'merged' ? `<span class="mono" style="font-size:10px;color:var(--info)">→ ${esc(t.merged_into_name || '')}</span>` : ''}
            ${fpState.editMode ? '<span class="table-resize-handle" data-resize="1"></span>' : ''}
          </div>`;
    }).join('')}
      </div>
    `;

    document.getElementById('fpFloorSelect')?.addEventListener('change', (e) => {
      fpState.floor = e.target.value;
      renderFloorPlan(root, app);
    });

    root.querySelectorAll('[data-zone]').forEach((b) => {
      b.onclick = () => {
        fpState.zone = b.dataset.zone;
        renderFloorPlan(root, app);
      };
    });

    document.getElementById('toggleEditFloorBtn')?.addEventListener('click', () => {
      fpState.editMode = !fpState.editMode;
      renderFloorPlan(root, app);
    });

    document.getElementById('emptyFloorAddBtn')?.addEventListener('click', async () => {
      fpState.editMode = true;
      await renderFloorPlan(root, app);
      document.getElementById('addTableBtn')?.click();
    });

    // Drag & Resize pointer interactions in Edit Mode
    const canvasEl = document.getElementById('floorCanvas');
    if (fpState.editMode && canvasEl) {
      let dragTarget = null;
      let modeOp = null; // 'move' | 'resize'
      let startX = 0, startY = 0, origX = 0, origY = 0, origW = 0, origH = 0, moved = false;

      canvasEl.querySelectorAll('.floor-table').forEach((el) => {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          dragTarget = el;
          modeOp = e.target.dataset.resize ? 'resize' : 'move';
          startX = e.clientX;
          startY = e.clientY;
          origX = parseInt(el.style.left, 10) || 0;
          origY = parseInt(el.style.top, 10) || 0;
          origW = parseInt(el.style.width, 10) || 100;
          origH = parseInt(el.style.height, 10) || 100;
          moved = false;
          el.setPointerCapture(e.pointerId);
        });

        el.addEventListener('pointermove', (e) => {
          if (dragTarget !== el) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
          const snapPx = Math.max(1, Number(app.state.settings?.customization?.tables?.gridSnap || 10));
          const snap = (v) => Math.round(v / snapPx) * snapPx;

          if (modeOp === 'move') {
            el.style.left = `${Math.max(0, snap(origX + dx))}px`;
            el.style.top = `${Math.max(0, snap(origY + dy))}px`;
          } else {
            el.style.width = `${Math.max(70, snap(origW + dx))}px`;
            el.style.height = `${Math.max(70, snap(origH + dy))}px`;
          }
        });

        el.addEventListener('pointerup', () => {
          if (dragTarget !== el) return;
          dragTarget = null;
          if (!moved) {
            const t = tables.find((tb) => tb.id === Number(el.dataset.tid));
            if (t) openEditTableModal(t);
          }
        });
      });

      document.getElementById('saveLayoutBtn')?.addEventListener('click', async () => {
        const layouts = Array.from(canvasEl.querySelectorAll('.floor-table')).map((el) => ({
          id: Number(el.dataset.tid),
          x: parseInt(el.style.left, 10),
          y: parseInt(el.style.top, 10),
          width: parseInt(el.style.width, 10),
          height: parseInt(el.style.height, 10)
        }));
        try {
          await put('/api/tables/layout/batch', { layouts });
          toast('Floor plan layout saved to database!', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      document.getElementById('manageFloorsBtn')?.addEventListener('click', () => {
        app.openModal('Manage Floors & Sections', `
          <div style="display:flex;flex-direction:column;gap:10px">
            ${floors.length === 0 ? '<div class="muted" style="font-size:12px">No floors created yet.</div>' : floors.map((fl) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--border);border-radius:8px">
                <div>
                  <strong>${esc(fl.name)}</strong>
                  <div class="muted" style="font-size:11px">Sections: ${fl.sections?.length ? fl.sections.map(esc).join(', ') : 'None'}</div>
                </div>
                <button class="btn btn-xs btn-danger" data-del-floor="${fl.id}">Delete</button>
              </div>
            `).join('')}
            <form id="addFloorModalForm" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding-top:10px;border-top:1px solid var(--border)">
              <input id="mfName" class="input" placeholder="Floor Name (e.g. Rooftop)" required>
              <input id="mfSections" class="input" placeholder="Sections (Main, Patio)">
              <button type="submit" class="btn btn-sm btn-primary">Add</button>
            </form>
          </div>
        `);
        document.querySelectorAll('[data-del-floor]').forEach((b) => {
          b.onclick = async () => {
            await del(`/api/floors/${b.dataset.delFloor}`);
            app.closeModal();
            toast('Floor deleted', 'info');
            renderFloorPlan(root, app);
          };
        });
        document.getElementById('addFloorModalForm').onsubmit = async (e) => {
          e.preventDefault();
          await post('/api/floors', {
            name: document.getElementById('mfName').value,
            sections: document.getElementById('mfSections').value,
            sort_order: floors.length + 1
          });
          app.closeModal();
          toast('Floor added', 'success');
          renderFloorPlan(root, app);
        };
      });

      document.getElementById('addTableBtn')?.addEventListener('click', () => {
        const tblCfg = app.state.settings?.customization?.tables || {};
        const defShape = tblCfg.defaultShape || 'square';
        const defSeats = Number(tblCfg.defaultSeats || 4);
        const defaultFloor = fpState.floor !== 'All' ? fpState.floor : (floors[0]?.name || 'Ground Floor');
        app.openModal('Add Floor Table', `
          <form id="addTableForm" style="display:flex;flex-direction:column;gap:12px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="field-label">Table Name <input id="ntName" class="input" placeholder="e.g. T-07" required></label>
              <label class="field-label">Floor <input id="ntFloor" class="input" value="${esc(defaultFloor)}" list="floorListOptions"></label>
            </div>
            <datalist id="floorListOptions">${floors.map((f) => `<option value="${esc(f.name)}">`).join('')}</datalist>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="field-label">Zone / Section <input id="ntZone" class="input" value="Main Hall" required></label>
              <label class="field-label">Seats <input id="ntSeats" type="number" class="input" value="${defSeats}" min="1" required></label>
            </div>
            <label class="field-label">Shape
              <select id="ntShape" class="select">
                <option value="square" ${defShape === 'square' ? 'selected' : ''}>Square</option>
                <option value="round" ${defShape === 'round' ? 'selected' : ''}>Round</option>
                <option value="rect" ${defShape === 'rect' ? 'selected' : ''}>Rectangle</option>
              </select>
            </label>
            <button type="submit" class="btn btn-primary">Create Table</button>
          </form>
        `);
        document.getElementById('addTableForm').onsubmit = async (e) => {
          e.preventDefault();
          try {
            await post('/api/tables', {
              name: document.getElementById('ntName').value,
              floor_name: document.getElementById('ntFloor').value,
              zone: document.getElementById('ntZone').value,
              seats: Number(document.getElementById('ntSeats').value),
              shape: document.getElementById('ntShape').value,
              x: 40,
              y: 40
            });
            app.closeModal();
            toast('Table added to floor plan!', 'success');
            renderFloorPlan(root, app);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });
    } else if (canvasEl) {
      // Live service click
      canvasEl.querySelectorAll('.floor-table').forEach((el) => {
        el.onclick = () => {
          const t = tables.find((tb) => tb.id === Number(el.dataset.tid));
          if (!t) return;
          const linkedChildren = tables.filter((tb) => tb.merged_into_table_id === t.id);
          app.openModal(`Table ${t.name} (${t.zone})`, `
            <div style="display:flex;flex-direction:column;gap:12px">
              <div>Status: <span class="pill pill-orange">${t.status.toUpperCase()}</span> • Seats: ${t.seats}</div>
              ${linkedChildren.length > 0 ? `<div class="muted" style="font-size:12px">Merged Tables: <strong>${linkedChildren.map((c) => esc(c.name)).join(', ')}</strong></div>` : ''}
              ${t.status === 'occupied' ? `<div>Running Bill: <strong class="mono">${formatINR(t.running_total)}</strong> (${t.item_count} items)</div>` : ''}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <button class="btn btn-primary" id="tbOpenPosBtn">${t.status === 'occupied' ? 'Open Running Bill' : 'Start Order in POS'}</button>
                ${t.status === 'available' || t.status === 'reserved' ? `
                  <button class="btn btn-secondary" id="tbToggleResBtn">${t.status === 'reserved' ? 'Mark Available' : 'Mark Reserved'}</button>
                ` : ''}
                ${t.status === 'merged' || linkedChildren.length > 0 ? '<button class="btn btn-secondary" id="tbUnmergeBtn">Unmerge Table(s)</button>' : ''}
              </div>
            </div>
          `);

          document.getElementById('tbOpenPosBtn').onclick = () => {
            app.closeModal();
            app.state.pos = {
              ...(app.state.pos || {}),
              orderType: 'dine_in',
              tableId: t.status === 'merged' && t.merged_into_table_id ? t.merged_into_table_id : t.id,
              activeOrderId: t.current_order_id || null,
              cart: [],
              categoryId: 'all',
              dietary: 'all',
              search: ''
            };
            app.navigate('pos');
          };

          document.getElementById('tbToggleResBtn')?.addEventListener('click', async () => {
            await put(`/api/tables/${t.id}`, { status: t.status === 'reserved' ? 'available' : 'reserved' });
            app.closeModal();
            renderFloorPlan(root, app);
          });

          document.getElementById('tbUnmergeBtn')?.addEventListener('click', async () => {
            await post('/api/tables/unmerge', { tableId: t.id });
            app.closeModal();
            toast(`Unmerged ${t.name}`, 'info');
            renderFloorPlan(root, app);
          });
        };
      });
    }

    function openEditTableModal(t) {
      app.openModal(`Edit Table ${t.name}`, `
        <form id="editTableForm" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">Name <input id="etName" class="input" value="${esc(t.name)}" required></label>
            <label class="field-label">Floor <input id="etFloor" class="input" value="${esc(t.floor_name || 'Ground Floor')}"></label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">Zone <input id="etZone" class="input" value="${esc(t.zone)}" required></label>
            <label class="field-label">Seats <input id="etSeats" type="number" class="input" value="${t.seats}" min="1"></label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 0.7fr;gap:10px">
            <label class="field-label">Shape
              <select id="etShape" class="select">
                <option value="square" ${t.shape === 'square' ? 'selected' : ''}>Square</option>
                <option value="round" ${t.shape === 'round' ? 'selected' : ''}>Round</option>
                <option value="rect" ${t.shape === 'rect' ? 'selected' : ''}>Rectangle</option>
              </select>
            </label>
            <label class="field-label">Display Label <input id="etLblOverride" class="input" placeholder="Optional" value="${esc(t.label_override || '')}"></label>
            <label class="field-label">Border Color <input id="etColor" type="color" class="input" style="height:38px;padding:3px" value="${esc(t.color || '#10b981')}"></label>
          </div>
          <div style="display:flex;gap:8px;justify-content:space-between">
            <button type="button" class="btn btn-danger" id="delTableBtn">Delete Table</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      `);
      document.getElementById('editTableForm').onsubmit = async (e) => {
        e.preventDefault();
        await put(`/api/tables/${t.id}`, {
          name: document.getElementById('etName').value,
          floor_name: document.getElementById('etFloor').value,
          zone: document.getElementById('etZone').value,
          seats: Number(document.getElementById('etSeats').value),
          shape: document.getElementById('etShape').value,
          label_override: document.getElementById('etLblOverride').value.trim(),
          color: document.getElementById('etColor').value
        });
        app.closeModal();
        renderFloorPlan(root, app);
      };
      document.getElementById('delTableBtn').onclick = async () => {
        try {
          await del(`/api/tables/${t.id}`);
          app.closeModal();
          toast(`Deleted table ${t.name}`, 'info');
          renderFloorPlan(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }

    // Transfer Modal
    document.getElementById('openTransferBtn')?.addEventListener('click', () => {
      const occ = tables.filter((t) => t.status === 'occupied');
      const free = tables.filter((t) => t.status === 'available' || t.status === 'reserved');
      if (occ.length === 0 || free.length === 0) {
        return toast('Need at least one occupied source and one available target table.', 'error');
      }
      app.openModal('Transfer Table Order', `
        <form id="transferForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field-label">From Occupied Table
            <select id="trFrom" class="select">
              ${occ.map((t) => `<option value="${t.id}">${esc(t.name)} (${formatINR(t.running_total)})</option>`).join('')}
            </select>
          </label>
          <label class="field-label">To Available Table
            <select id="trTo" class="select">
              ${free.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(t.zone)})</option>`).join('')}
            </select>
          </label>
          <button type="submit" class="btn btn-primary">Confirm Transfer</button>
        </form>
      `);
      document.getElementById('transferForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const res = await post('/api/tables/transfer', {
            fromTableId: Number(document.getElementById('trFrom').value),
            toTableId: Number(document.getElementById('trTo').value)
          });
          app.closeModal();
          toast(`Transferred ${res.fromTable} → ${res.toTable}`, 'success');
          renderFloorPlan(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });

    // Merge Modal
    document.getElementById('openMergeBtn')?.addEventListener('click', () => {
      const eligible = tables.filter((t) => t.status !== 'merged');
      if (eligible.length < 2) return toast('Need at least two unmerged tables.', 'error');
      app.openModal('Merge Tables', `
        <form id="mergeForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field-label">Primary Table (Keeps Combined Bill)
            <select id="mgPrimary" class="select">
              ${eligible.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.status})</option>`).join('')}
            </select>
          </label>
          <div class="field-label">Select Secondary Table(s) to Merge In
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
              ${eligible.map((t) => `
                <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer">
                  <input type="checkbox" name="mgSec" value="${t.id}"> ${esc(t.name)} (${t.status})
                </label>
              `).join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Merge Selected Tables</button>
        </form>
      `);
      document.getElementById('mergeForm').onsubmit = async (e) => {
        e.preventDefault();
        const primaryTableId = Number(document.getElementById('mgPrimary').value);
        const secondaryTableIds = Array.from(document.querySelectorAll('input[name="mgSec"]:checked'))
          .map((c) => Number(c.value))
          .filter((id) => id !== primaryTableId);
        try {
          await post('/api/tables/merge', { primaryTableId, secondaryTableIds });
          app.closeModal();
          toast('Tables merged successfully!', 'success');
          renderFloorPlan(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  // ==================== KITCHEN DISPLAY SYSTEM (KDS) ====================
  async function renderKDS(root, app) {
    const orders = await get('/api/orders?status=active');
    const kdsState = app.state.kds || { station: 'All' };
    app.state.kds = kdsState;

    const stations = ['All', 'Main Kitchen', 'Grill / Tandoor', 'Bar / Beverages', 'Bakery / Dessert'];
    const slaMins = Number(app.state.settings?.kds_sla_minutes || 12);

    // Group active non-served, non-void items by Order + KOT
    const tickets = [];
    for (const ord of orders) {
      const byKot = {};
      for (const it of ord.items) {
        if (it.status === 'void' || it.status === 'served') continue;
        if (kdsState.station !== 'All' && it.station !== kdsState.station) continue;
        if (!byKot[it.kot_number]) {
          byKot[it.kot_number] = {
            orderId: ord.id,
            orderNumber: ord.order_number,
            tableName: ord.table_name || ord.order_type.toUpperCase(),
            kotNumber: it.kot_number,
            createdAt: it.created_at,
            orderObj: ord,
            items: []
          };
        }
        byKot[it.kot_number].items.push(it);
      }
      tickets.push(...Object.values(byKot));
    }

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${stations.map((st) => `
            <button class="btn btn-sm ${kdsState.station === st ? 'btn-primary' : 'btn-secondary'}" data-station="${esc(st)}">${esc(st)}</button>
          `).join('')}
        </div>
        <span class="mono muted" style="font-size:12px">Active KOT Tickets: <strong>${tickets.length}</strong> • SLA Target: ${slaMins}m</span>
      </div>

      <div class="kds-grid">
        ${tickets.map((tk) => {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(tk.createdAt.replace(' ', 'T') + 'Z').getTime()) / 60000));
      const slaClass = mins >= slaMins ? 'sla-late' : mins >= Math.floor(slaMins * 0.7) ? 'sla-warn' : '';
      return `
            <div class="kds-card ${slaClass}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <strong>${esc(tk.kotNumber)}</strong>
                  <span class="muted" style="font-size:12px">• ${esc(tk.tableName)}</span>
                </div>
                <span class="pill ${slaClass === 'sla-late' ? 'pill-red' : slaClass === 'sla-warn' ? 'pill-amber' : 'pill-blue'}">${mins}m ago</span>
              </div>

              <div style="display:flex;flex-direction:column;gap:6px">
                ${tk.items.map((it) => `
                  <div class="kds-item-row">
                    <div>
                      <strong>${it.qty}× ${esc(it.name)}</strong>
                      ${it.variant_name ? `<div class="muted" style="font-size:11px">${esc(it.variant_name)}</div>` : ''}
                      ${it.extras?.length ? `<div class="muted" style="font-size:11px">+ ${it.extras.map((ex) => esc(ex.name)).join(', ')}</div>` : ''}
                      ${it.notes ? `<div style="font-size:11px;color:var(--warning)">★ ${esc(it.notes)}</div>` : ''}
                    </div>
                    <button class="btn btn-xs ${it.status === 'ready' ? 'btn-success' : it.status === 'preparing' ? 'btn-primary' : 'btn-secondary'}"
                            data-kds-next="${it.id}" data-ord="${tk.orderId}" data-cur="${it.status}">
                      ${it.status === 'queued' ? 'Cook' : it.status === 'preparing' ? 'Ready' : 'Served'}
                    </button>
                  </div>
                `).join('')}
              </div>

              <div style="display:flex;gap:6px;margin-top:auto;padding-top:6px;border-top:1px solid var(--border)">
                <button class="btn btn-xs btn-secondary" style="flex:1" data-kot-bump="${tk.kotNumber}" data-ord="${tk.orderId}" data-next="ready">All Ready</button>
                <button class="btn btn-xs btn-success" style="flex:1" data-kot-bump="${tk.kotNumber}" data-ord="${tk.orderId}" data-next="served">Bump Served</button>
                <button class="btn btn-xs btn-ghost" data-print-kot="${tk.kotNumber}" data-ord="${tk.orderId}" title="Print KOT">Print</button>
              </div>
            </div>
          `;
    }).join('') || '<div class="card muted" style="grid-column:1/-1;text-align:center;padding:42px">Kitchen queue is completely clear!</div>'}
      </div>
    `;

    root.querySelectorAll('[data-station]').forEach((b) => {
      b.onclick = () => {
        kdsState.station = b.dataset.station;
        renderKDS(root, app);
      };
    });

    root.querySelectorAll('[data-kds-next]').forEach((b) => {
      b.onclick = async () => {
        const nextMap = { queued: 'preparing', preparing: 'ready', ready: 'served' };
        const nextStatus = nextMap[b.dataset.cur] || 'served';
        await patch(`/api/orders/${b.dataset.ord}/items/${b.dataset.kdsNext}`, { status: nextStatus });
        renderKDS(root, app);
      };
    });

    root.querySelectorAll('[data-kot-bump]').forEach((b) => {
      b.onclick = async () => {
        await post('/api/kds/kot-status', {
          orderId: Number(b.dataset.ord),
          kotNumber: b.dataset.kotBump,
          status: b.dataset.next
        });
        toast(`KOT ${b.dataset.kotBump} marked ${b.dataset.next.toUpperCase()}`, 'success');
        renderKDS(root, app);
      };
    });

    root.querySelectorAll('[data-print-kot]').forEach((b) => {
      b.onclick = () => {
        const ord = orders.find((o) => o.id === Number(b.dataset.ord));
        if (ord) window.BistroThermal.printKot(ord, b.dataset.printKot, app.state.activeBranch, app.state.settings);
      };
    });
  }

  window.BistroPosFloorKds = { renderPOS, renderFloorPlan, renderKDS };
})();
