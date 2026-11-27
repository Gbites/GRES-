(function () {
  'use strict';

  const { esc, formatINR, formatDate, maskPhone, toast, get, post, put, del } = window.BistroAPI;

  // ==================== DASHBOARD ====================
  async function renderDashboard(root, app) {
    const [analytics, tables, invoices] = await Promise.all([
      get('/api/analytics'),
      get('/api/tables'),
      get('/api/invoices')
    ]);
    const k = analytics.kpis;
    const cust = app.state.settings?.customization || {};
    const dashCfg = cust.dashboard || {};
    const brandCfg = cust.branding || {};
    const sym = app.state.settings?.currency_symbol || '₹';

    const DEFAULT_WIDGETS = [
      { id: 'brand_banner', visible: true, size: 'full' },
      { id: 'kpis', visible: true, size: 'full' },
      { id: 'revenue_chart', visible: true, size: 'half' },
      { id: 'floor_snapshot', visible: true, size: 'half' },
      { id: 'recent_invoices', visible: true, size: 'half' },
      { id: 'low_stock', visible: true, size: 'half' },
      { id: 'payment_mix', visible: false, size: 'half' },
      { id: 'top_dishes', visible: false, size: 'half' }
    ];
    const widgets = (Array.isArray(dashCfg.widgets) && dashCfg.widgets.length ? dashCfg.widgets : DEFAULT_WIDGETS)
      .filter((w) => w.visible !== false);

    const visibleKpis = Array.isArray(dashCfg.visibleKpis) && dashCfg.visibleKpis.length
      ? dashCfg.visibleKpis
      : ['revenue', 'aov', 'occupancy', 'low_stock'];

    const KPI_CARDS = {
      revenue: `
        <div class="kpi-card">
          <span class="kpi-label">TOTAL REVENUE (BRANCH)</span>
          <div class="kpi-value" data-count="${k.totalRevenue}" data-format="inr">${formatINR(k.totalRevenue)}</div>
          <span class="kpi-sub">${k.totalOrders} settled bills • Today: ${formatINR(k.todayRevenue)}</span>
        </div>`,
      aov: `
        <div class="kpi-card">
          <span class="kpi-label">AVG ORDER VALUE</span>
          <div class="kpi-value" data-count="${k.aov}" data-format="inr">${formatINR(k.aov)}</div>
          <span class="kpi-sub">GST Collected: ${formatINR(k.totalTax)}</span>
        </div>`,
      occupancy: `
        <div class="kpi-card">
          <span class="kpi-label">LIVE FLOOR OCCUPANCY</span>
          <div class="kpi-value">${k.occupiedTablesCount} / ${k.totalTablesCount}</div>
          <span class="kpi-sub">${k.activeOrdersCount} active running orders</span>
        </div>`,
      low_stock: `
        <div class="kpi-card">
          <span class="kpi-label">LOW STOCK ALERTS</span>
          <div class="kpi-value" data-count="${k.lowStockCount}" style="color:${k.lowStockCount > 0 ? 'var(--danger)' : 'var(--success)'}">${k.lowStockCount}</div>
          <span class="kpi-sub">${k.lowStockCount > 0 ? 'Ingredients at or below par level' : 'All pantry levels healthy'}</span>
        </div>`,
      today_orders: `
        <div class="kpi-card">
          <span class="kpi-label">TODAY'S SETTLED ORDERS</span>
          <div class="kpi-value" data-count="${k.todayOrders}">${k.todayOrders}</div>
          <span class="kpi-sub">Today Revenue: ${formatINR(k.todayRevenue)}</span>
        </div>`,
      gst_collected: `
        <div class="kpi-card">
          <span class="kpi-label">TOTAL GST COLLECTED</span>
          <div class="kpi-value" data-count="${k.totalTax}" data-format="inr">${formatINR(k.totalTax)}</div>
          <span class="kpi-sub">Discounts Issued: ${formatINR(k.totalDiscount)}</span>
        </div>`
    };

    function renderWidgetHtml(w) {
      const spanStyle = w.size === 'full' ? 'grid-column:1 / -1;' : '';
      if (w.id === 'brand_banner') {
        if (brandCfg.showDashboardBanner === false) return '';
        const coverBg = brandCfg.coverUrl ? `background-image:linear-gradient(rgba(7,8,13,0.72),rgba(7,8,13,0.82)),url('${esc(brandCfg.coverUrl)}');background-size:cover;background-position:center;` : '';
        return `
          <div class="card" style="${spanStyle}${coverBg}display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 20px">
            <div style="display:flex;align-items:center;gap:12px">
              <span class="gres-mark">GRES RMS</span>
              <div>
                <strong style="font-size:14px">${esc(app.state.settings?.restaurant_name || app.state.activeBranch?.name || '')}</strong>
                <span class="muted" style="font-size:12px"> • ${esc(app.state.activeBranch?.name || '')}</span>
                ${brandCfg.dashboardGreeting ? `<div class="muted" style="font-size:11.5px">${esc(brandCfg.dashboardGreeting)}</div>` : ''}
              </div>
            </div>
            <span class="mono muted" style="font-size:11.5px">${esc(app.state.settings?.tagline || 'GRES — Run Your Restaurant Smarter.')}</span>
          </div>`;
      }

      if (w.id === 'kpis') {
        return `<div class="kpi-grid" style="${spanStyle}margin-bottom:0">${visibleKpis.map((id) => KPI_CARDS[id] || '').join('')}</div>`;
      }

      if (w.id === 'revenue_chart') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header">
              <h3 class="card-title">Revenue Trend (${esc(app.state.settings?.currency_code || 'INR')})</h3>
              <button class="btn btn-xs btn-secondary" id="dashGoAnalytics">Full Analytics →</button>
            </div>
            <div id="dashBarChart"></div>
          </div>`;
      }

      if (w.id === 'floor_snapshot') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header">
              <h3 class="card-title">Live Floor Snapshot</h3>
              <button class="btn btn-xs btn-secondary" id="dashGoFloor">Open Floor Plan →</button>
            </div>
            ${tables.length === 0 ? `
              <div class="empty-state">
                <h4>No Tables Configured</h4>
                <p>Design your dining floor and add tables to track live occupancy.</p>
                <button class="btn btn-xs btn-primary" id="dashEmptyFloorBtn">Configure Floor Plan</button>
              </div>
            ` : `
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:8px">
                ${tables.map((t) => `
                  <div class="card" style="padding:10px;text-align:center;border-color:${esc(t.color || (t.status === 'occupied' ? 'var(--tbl-occupied)' : t.status === 'available' ? 'var(--tbl-available)' : 'var(--tbl-reserved)'))}">
                    <strong style="font-size:13px">${esc(t.label_override || t.name)}</strong>
                    <div class="mono muted" style="font-size:10px">${t.status.toUpperCase()}</div>
                    ${t.status === 'occupied' ? `<div class="mono" style="font-size:11px;color:var(--accent)">${formatINR(t.running_total)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            `}
          </div>`;
      }

      if (w.id === 'recent_invoices') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header">
              <h3 class="card-title">Recent GST Invoices</h3>
              <button class="btn btn-xs btn-secondary" id="dashGoOrders">All Invoices →</button>
            </div>
            ${invoices.length === 0 ? `
              <div class="empty-state">
                <h4>No Invoices Yet</h4>
                <p>Settle an order in the POS Terminal to generate your first GST invoice.</p>
                <button class="btn btn-xs btn-primary" id="dashEmptyPosBtn">Open POS Terminal</button>
              </div>
            ` : `
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Invoice #</th><th>Table</th><th>Mode</th><th>Total</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${invoices.slice(0, 6).map((inv) => `
                      <tr>
                        <td class="mono"><strong>${esc(inv.invoice_number)}</strong></td>
                        <td>${esc(inv.table_name)}</td>
                        <td><span class="pill pill-blue">${esc(inv.payment_mode)}</span></td>
                        <td class="mono"><strong>${formatINR(inv.grand_total)}</strong></td>
                        <td>
                          <a class="btn btn-xs btn-ghost" href="/api/invoices/${inv.id}/pdf" target="_blank">PDF</a>
                          <button class="btn btn-xs btn-ghost" data-dash-print="${inv.id}">Print</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>`;
      }

      if (w.id === 'low_stock') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header">
              <h3 class="card-title">Low Stock Alerts</h3>
              <button class="btn btn-xs btn-secondary" id="dashGoInv">Manage Stock →</button>
            </div>
            ${analytics.lowStockItems.length === 0 ? `
              <div class="empty-state">
                <h4>No Low Stock Alerts</h4>
                <p>Add raw ingredients in Inventory and map them to dishes to track par levels automatically.</p>
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:8px">
                ${analytics.lowStockItems.map((ing) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border:1px solid rgba(239,68,68,0.35);border-radius:8px;background:rgba(239,68,68,0.08)">
                    <div>
                      <strong>${esc(ing.name)}</strong>
                      <div class="muted" style="font-size:11px">Par: ${ing.par_level} ${esc(ing.unit)}</div>
                    </div>
                    <span class="pill pill-red">${ing.stock_qty} ${esc(ing.unit)}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>`;
      }

      if (w.id === 'payment_mix') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header"><h3 class="card-title">Payment Mode Breakdown</h3></div>
            <div id="dashDonutChart"></div>
          </div>`;
      }

      if (w.id === 'top_dishes') {
        return `
          <div class="card" style="${spanStyle}">
            <div class="card-header"><h3 class="card-title">Top Selling Dishes</h3></div>
            <table class="data-table">
              <thead><tr><th>Dish</th><th>Qty</th><th>Revenue</th></tr></thead>
              <tbody>
                ${analytics.topItems.slice(0, 6).map((it) => `
                  <tr><td><strong>${esc(it.name)}</strong></td><td class="mono">${it.qty}</td><td class="mono">${formatINR(it.revenue)}</td></tr>
                `).join('') || '<tr><td colspan="3" class="muted">No item sales yet.</td></tr>'}
              </tbody>
            </table>
          </div>`;
      }
      return '';
    }

    root.innerHTML = `<div class="grid-2">${widgets.map(renderWidgetHtml).join('')}</div>`;

    const barEl = document.getElementById('dashBarChart');
    if (barEl) window.BistroCharts.renderBarChart(barEl, analytics.dailySeries, sym);
    const donutEl = document.getElementById('dashDonutChart');
    if (donutEl) window.BistroCharts.renderDonutChart(donutEl, analytics.paymentBreakdown, sym);

    document.getElementById('dashGoAnalytics')?.addEventListener('click', () => app.navigate('analytics'));
    document.getElementById('dashGoFloor')?.addEventListener('click', () => app.navigate('floor'));
    document.getElementById('dashGoOrders')?.addEventListener('click', () => app.navigate('orders'));
    document.getElementById('dashGoInv')?.addEventListener('click', () => app.navigate('inventory'));
    document.getElementById('dashEmptyFloorBtn')?.addEventListener('click', () => app.navigate('floor'));
    document.getElementById('dashEmptyPosBtn')?.addEventListener('click', () => app.navigate('pos'));

    root.querySelectorAll('[data-dash-print]').forEach((b) => {
      b.onclick = async () => {
        const inv = await get(`/api/invoices/${b.dataset.dashPrint}`);
        window.BistroThermal.printThermalInvoice(inv, app.state.activeBranch, app.state.settings);
      };
    });
  }

  // ==================== ORDERS & INVOICES ====================
  async function renderOrdersAndInvoices(root, app) {
    const [activeOrders, invoices] = await Promise.all([
      get('/api/orders?status=active'),
      get('/api/invoices')
    ]);

    root.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3 class="card-title">Active &amp; Held Orders (${activeOrders.length})</h3>
          <button class="btn btn-sm btn-primary" id="ordNewPosBtn">+ Open POS</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Order #</th><th>Type / Table</th><th>Guest</th><th>Items</th><th>Status</th><th>Running Total</th><th>Action</th></tr></thead>
            <tbody>
              ${activeOrders.map((o) => `
                <tr>
                  <td class="mono"><strong>${esc(o.order_number)}</strong></td>
                  <td>${esc(o.table_name || o.order_type.toUpperCase())}</td>
                  <td>${esc(o.customer_name)}</td>
                  <td>${o.bill.item_count}</td>
                  <td><span class="pill ${o.status === 'hold' ? 'pill-amber' : 'pill-orange'}">${o.status}</span></td>
                  <td class="mono"><strong>${formatINR(o.bill.grand_total)}</strong></td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-xs btn-primary" data-resume-ord="${o.id}" data-otype="${o.order_type}" data-tid="${o.table_id || ''}">Open in POS</button>
                    ${app.can('orders:void') ? `<button class="btn btn-xs btn-danger" data-cancel-ord="${o.id}">Cancel</button>` : ''}
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="muted">No open orders right now.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Settled GST Invoices (${invoices.length})</h3>
          <input type="search" id="invSearch" class="input" style="max-width:240px" placeholder="Filter invoice #, guest, table...">
        </div>
        <div class="table-wrap">
          <table class="data-table" id="invTable">
            <thead>
              <tr><th>Invoice #</th><th>Date</th><th>Table / Type</th><th>Guest</th><th>Subtotal</th><th>CGST+SGST</th><th>Grand Total</th><th>Mode</th><th>Print / PDF</th></tr>
            </thead>
            <tbody>
              ${invoices.map((inv) => `
                <tr data-inv-row="${esc((inv.invoice_number + ' ' + inv.customer_name + ' ' + inv.table_name).toLowerCase())}">
                  <td class="mono"><strong>${esc(inv.invoice_number)}</strong></td>
                  <td class="mono muted" style="font-size:11px">${esc(inv.created_at)}</td>
                  <td class="mono muted" style="font-size:11px">${esc(formatDate ? formatDate(inv.created_at, true) : inv.created_at)}</td>
                  <td>${esc(inv.table_name)}</td>
                  <td>${esc(inv.customer_name || '—')}</td>
                  <td>${esc(inv.customer_name || '—')}${inv.customer_phone ? ` <small class="mono muted">${esc(maskPhone ? maskPhone(inv.customer_phone) : inv.customer_phone)}</small>` : ''}</td>
                  <td class="mono">${formatINR(inv.subtotal)}</td>
                  <td class="mono">${formatINR(inv.tax_amount)}</td>
                  <td class="mono"><strong>${formatINR(inv.grand_total)}</strong></td>
                  <td><span class="pill pill-green">${esc(inv.payment_mode)}</span></td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-xs btn-ghost" data-preview-inv="${inv.id}">View</button>
                    <a class="btn btn-xs btn-primary" href="/api/invoices/${inv.id}/pdf" target="_blank">PDF</a>
                    <button class="btn btn-xs btn-secondary" data-print-inv="${inv.id}">Thermal</button>
                    <button class="btn btn-xs btn-ghost" data-escpos-inv="${inv.id}">ESC/POS</button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="9" class="muted">No GST invoices issued yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('ordNewPosBtn').onclick = () => app.navigate('pos');

    root.querySelectorAll('[data-resume-ord]').forEach((b) => {
      b.onclick = () => {
        app.state.pos = {
          ...(app.state.pos || {}),
          orderType: b.dataset.otype,
          tableId: b.dataset.tid ? Number(b.dataset.tid) : null,
          activeOrderId: Number(b.dataset.resumeOrd),
          cart: [],
          categoryId: 'all',
          dietary: 'all',
          search: ''
        };
        app.navigate('pos');
      };
    });

    root.querySelectorAll('[data-cancel-ord]').forEach((b) => {
      b.onclick = () => {
        const reasons = app.state.settings?.customization?.businessRules?.cancellationReasons || ['Customer changed mind', 'Out of stock'];
        app.openModal('Cancel Active Order', `
          <form id="ordCancelForm" style="display:flex;flex-direction:column;gap:12px">
            <label class="field-label">Cancellation Reason
              <select id="ordCancelReason" class="select">
                ${reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
                <option value="Other">Other</option>
              </select>
            </label>
            <button type="submit" class="btn btn-danger">Confirm Cancel Order</button>
          </form>
        `);
        document.getElementById('ordCancelForm').onsubmit = async (e) => {
          e.preventDefault();
          try {
            await post(`/api/orders/${b.dataset.cancelOrd}/cancel`, {
              reason: document.getElementById('ordCancelReason').value
            });
            app.closeModal();
            toast('Order cancelled & table freed', 'info');
            renderOrdersAndInvoices(root, app);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      };
    });

    root.querySelectorAll('[data-preview-inv]').forEach((b) => {
      b.onclick = async () => {
        const inv = await get(`/api/invoices/${b.dataset.previewInv}`);
        app.openModal(`Invoice ${inv.invoice_number}`, `
          <div style="background:#fff;color:#000;padding:14px;border-radius:8px;font-family:'Courier New',monospace;font-size:11px;max-height:360px;overflow-y:auto">
            ${window.BistroThermal.buildReceiptHtml(inv, app.state.activeBranch, app.state.settings)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <a class="btn btn-primary" href="/api/invoices/${inv.id}/pdf" target="_blank">Download PDF</a>
            <button class="btn btn-secondary" id="prevThermBtn">Print Thermal</button>
          </div>
        `);
        document.getElementById('prevThermBtn').onclick = () => {
          window.BistroThermal.printThermalInvoice(inv, app.state.activeBranch, app.state.settings);
        };
      };
    });

    document.getElementById('invSearch').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      root.querySelectorAll('[data-inv-row]').forEach((tr) => {
        tr.classList.toggle('hidden', q && !tr.dataset.invRow.includes(q));
      });
    };

    root.querySelectorAll('[data-print-inv]').forEach((b) => {
      b.onclick = async () => {
        const inv = await get(`/api/invoices/${b.dataset.printInv}`);
        window.BistroThermal.printThermalInvoice(inv, app.state.activeBranch, app.state.settings);
      };
    });

    root.querySelectorAll('[data-escpos-inv]').forEach((b) => {
      b.onclick = async () => {
        const inv = await get(`/api/invoices/${b.dataset.escposInv}`);
        window.BistroThermal.printDirectEscPos(inv, app.state.activeBranch, app.state.settings);
      };
    });
  }

  // ==================== MENU & RECIPES ====================
  async function renderMenu(root, app) {
    const [menuData, invData] = await Promise.all([
      get('/api/menu'),
      app.can('inventory:view') ? get('/api/inventory') : Promise.resolve({ ingredients: [] })
    ]);
    const canEdit = app.can('menu:edit');

    root.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3 class="card-title">Menu Catalog &amp; Recipe Mapping (${menuData.items.length} items)</h3>
          ${canEdit ? `
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-secondary" id="addCatBtn">Categories (${menuData.categories.length})</button>
              <button class="btn btn-sm btn-primary" id="addMenuBtn">+ Add Menu Item</button>
            </div>
          ` : ''}
        </div>
        <div class="table-wrap">
          ${menuData.items.length === 0 ? `
            <div class="empty-state">
              <h4>Your Menu Is Empty</h4>
              <p>${menuData.categories.length === 0 ? 'Start by creating a menu category, then add dishes with INR pricing and GST slabs.' : 'Add your first dish to make it available in the POS Terminal.'}</p>
              ${canEdit ? `<button class="btn btn-sm btn-primary" id="emptyMenuBtn">${menuData.categories.length === 0 ? '+ Add First Category' : '+ Add First Dish'}</button>` : ''}
            </div>
          ` : `
          <table class="data-table">
            <thead><tr><th>Dish</th><th>Category</th><th>Station</th><th>Price</th><th>GST</th><th>Recipe BOM</th><th>Status</th>${canEdit ? '<th>Actions</th>' : ''}</tr></thead>
            <tbody>
              ${menuData.items.map((it) => `
                <tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:7px">
                      <span class="diet-dot ${esc(it.dietary)}"></span>
                      <strong>${esc(it.name)}</strong>
                    </div>
                    <div class="muted" style="font-size:11px">${esc(it.sku)} • ${esc(it.description)}</div>
                  </td>
                  <td>${esc(it.category_name)}</td>
                  <td>${esc(it.station)}</td>
                  <td class="mono"><strong>${formatINR(it.price)}</strong></td>
                  <td class="mono">${it.gst_rate}%</td>
                  <td>
                    ${it.recipe.length > 0
        ? it.recipe.map((r) => `<span class="pill pill-blue" style="margin:2px">${esc(r.ingredient_name)}: ${r.qty_per_serving}${esc(r.ingredient_unit)}</span>`).join('')
        : '<span class="muted">No recipe</span>'}
                  </td>
                  <td>
                    <span class="pill ${it.available ? 'pill-green' : 'pill-red'}">${it.available ? 'Available' : '86 / Out'}</span>
                  </td>
                  ${canEdit ? `
                    <td style="white-space:nowrap">
                      <button class="btn btn-xs btn-secondary" data-edit-menu="${it.id}">Edit</button>
                      <button class="btn btn-xs btn-secondary" data-recipe-menu="${it.id}">Recipe</button>
                      <button class="btn btn-xs btn-ghost" data-toggle-avail="${it.id}">${it.available ? 'Mark Out' : 'Enable'}</button>
                      <button class="btn btn-xs btn-danger" data-del-menu="${it.id}">Del</button>
                    </td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
          `}
        </div>
      </div>
    `;

    if (!canEdit) return;

    document.getElementById('addCatBtn').onclick = () => {
      app.openModal('Manage Menu Categories', `
        <div style="display:flex;flex-direction:column;gap:10px;max-height:220px;overflow-y:auto">
          ${menuData.categories.map((c) => `
            <div style="display:flex;gap:6px;align-items:center">
              <input class="input" data-cat-name="${c.id}" value="${esc(c.name)}">
              <input class="input" style="max-width:110px" data-cat-lbl="${c.id}" value="${esc(c.label || '')}" placeholder="Badge">
              <input type="number" class="input" style="max-width:70px" data-cat-sort="${c.id}" value="${c.sort_order}">
              <button class="btn btn-xs btn-secondary" data-save-cat="${c.id}">Save</button>
              <button class="btn btn-xs btn-danger" data-del-cat="${c.id}">Del</button>
            </div>
          `).join('')}
        </div>
        <form id="catForm" style="display:grid;grid-template-columns:1.2fr 1fr 0.7fr auto;gap:8px;padding-top:10px;border-top:1px solid var(--border)">
          <input id="catName" class="input" placeholder="Category / Subcategory Name" required>
          <select id="catParent" class="select">
            <option value="">Top Level</option>
            ${menuData.categories.filter((c) => !c.parent_id).map((pc) => `<option value="${pc.id}">Sub of: ${esc(pc.name)}</option>`).join('')}
          </select>
          <input id="catOrder" type="number" class="input" value="${menuData.categories.length + 1}">
          <button type="submit" class="btn btn-sm btn-primary">Add</button>
        </form>
      `);
      document.querySelectorAll('[data-save-cat]').forEach((b) => {
        b.onclick = async () => {
          const cid = b.dataset.saveCat;
          await put(`/api/menu/categories/${cid}`, {
            name: document.querySelector(`[data-cat-name="${cid}"]`).value,
            label: document.querySelector(`[data-cat-lbl="${cid}"]`).value,
            sort_order: Number(document.querySelector(`[data-cat-sort="${cid}"]`).value)
          });
          toast('Category updated', 'success');
          app.closeModal();
          renderMenu(root, app);
        };
      });
      document.querySelectorAll('[data-del-cat]').forEach((b) => {
        b.onclick = async () => {
          try {
            await del(`/api/menu/categories/${b.dataset.delCat}`);
            toast('Category deleted', 'info');
            app.closeModal();
            renderMenu(root, app);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });
      document.getElementById('catForm').onsubmit = async (e) => {
        e.preventDefault();
        await post('/api/menu/categories', {
          name: document.getElementById('catName').value,
          parent_id: document.getElementById('catParent').value || null,
          sort_order: Number(document.getElementById('catOrder').value)
        });
        app.closeModal();
        toast('Category created', 'success');
        renderMenu(root, app);
      };
    };

    function openItemForm(existing) {
      const variantsCopy = existing?.variants ? existing.variants.map((v) => ({ ...v })) : [];
      const extrasCopy = Array.isArray(existing?.extras) ? existing.extras.map((x) => ({ ...x })) : [];
      const labelChoices = app.state.settings?.customization?.menu?.availableLabels || ['Chef Special', 'Bestseller', 'Spicy', 'Jain', 'Gluten-Free', 'New'];
      const chosenLabels = new Set(Array.isArray(existing?.labels) ? existing.labels : []);
      app.openModal(existing ? `Edit ${existing.name}` : 'Add Menu Item', `
        <form id="itemForm" style="display:flex;flex-direction:column;gap:11px;max-height:76vh;overflow-y:auto;padding-right:4px">
          <div style="display:grid;grid-template-columns:1.6fr 0.8fr;gap:10px">
            <label class="field-label">Dish Name <input id="miName" class="input" value="${esc(existing?.name || '')}" required></label>
            <label class="field-label">SKU <input id="miSku" class="input" value="${esc(existing?.sku || '')}" placeholder="Auto"></label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 0.7fr;gap:10px">
            <label class="field-label">Category
              <select id="miCat" class="select">
                ${menuData.categories.map((c) => `<option value="${c.id}" ${existing?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field-label">Price (${esc(app.state.settings?.currency_symbol || '₹')})
              <input id="miPrice" type="number" step="0.5" class="input" value="${existing?.price ?? 250}" required>
            </label>
            <label class="field-label">Prep (min)
              <input id="miPrep" type="number" min="1" class="input" value="${existing?.prep_minutes ?? 12}">
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            <label class="field-label">GST %
              <select id="miGst" class="select">
                ${[0, 5, 12, 18, 28].map((r) => `<option value="${r}" ${Number(existing?.gst_rate ?? 5) === r ? 'selected' : ''}>${r}%</option>`).join('')}
              </select>
            </label>
            <label class="field-label">Dietary
              <select id="miDiet" class="select">
                ${['veg', 'non-veg', 'vegan', 'egg'].map((d) => `<option value="${d}" ${existing?.dietary === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </label>
            <label class="field-label">Kitchen Station
              <select id="miStation" class="select">
                ${['Main Kitchen', 'Grill / Tandoor', 'Bar / Beverages', 'Bakery / Dessert'].map((s) => `<option value="${s}" ${existing?.station === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
            <label class="field-label">Dish Photo URL (optional)
              <input id="miPhotoUrl" class="input" placeholder="https://... or upload" value="${esc(existing?.photo_url || '')}">
            </label>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;margin-bottom:1px">
              Upload Photo <input type="file" id="miPhotoFile" accept="image/*" style="display:none">
            </label>
          </div>
          <label class="field-label">Description <input id="miDesc" class="input" value="${esc(existing?.description || '')}"></label>
          <div style="border-top:1px solid var(--border);padding-top:10px">
            <span class="field-label" style="display:block;margin-bottom:6px">Menu Badges / Labels</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${labelChoices.map((lbl) => `
                <label style="display:flex;align-items:center;gap:5px;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:999px;cursor:pointer">
                  <input type="checkbox" class="mi-label-cb" value="${esc(lbl)}" ${chosenLabels.has(lbl) ? 'checked' : ''}> ${esc(lbl)}
                </label>
              `).join('')}
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span class="field-label">Portion / Variants (optional)</span>
              <button type="button" class="btn btn-xs btn-secondary" id="addVariantRowBtn">+ Add Variant</button>
            </div>
            <div id="variantsContainer" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span class="field-label">Extras / Add-ons (optional)</span>
              <button type="button" class="btn btn-xs btn-secondary" id="addExtraRowBtn">+ Add Extra</button>
            </div>
            <div id="extrasContainer" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>
          <button type="submit" class="btn btn-primary">${existing ? 'Save Changes' : 'Add Dish'}</button>
        </form>
      `);

      document.getElementById('miPhotoFile').onchange = async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        try {
          document.getElementById('miPhotoUrl').value = await compressImageFile(f, 320);
          toast('Photo attached', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      };

      const varContainer = document.getElementById('variantsContainer');
      function renderVariantRows() {
        varContainer.innerHTML = variantsCopy.map((v, idx) => `
          <div style="display:grid;grid-template-columns:1.5fr 1fr auto;gap:6px;align-items:center">
            <input class="input var-name-inp" data-vidx="${idx}" value="${esc(v.name)}" placeholder="Variant (e.g. Full)">
            <input type="number" step="1" class="input var-delta-inp" data-vidx="${idx}" value="${v.priceDelta || 0}" placeholder="Price +/-">
            <button type="button" class="btn btn-xs btn-danger" data-del-var="${idx}">✕</button>
          </div>
        `).join('');
        varContainer.querySelectorAll('.var-name-inp').forEach((inp) => {
          inp.oninput = () => { variantsCopy[Number(inp.dataset.vidx)].name = inp.value; };
        });
        varContainer.querySelectorAll('.var-delta-inp').forEach((inp) => {
          inp.oninput = () => { variantsCopy[Number(inp.dataset.vidx)].priceDelta = Number(inp.value || 0); };
        });
        varContainer.querySelectorAll('[data-del-var]').forEach((btn) => {
          btn.onclick = () => { variantsCopy.splice(Number(btn.dataset.delVar), 1); renderVariantRows(); };
        });
      }
      renderVariantRows();
      document.getElementById('addVariantRowBtn').onclick = () => {
        variantsCopy.push({ name: '', priceDelta: 0 });
        renderVariantRows();
      };

      const extContainer = document.getElementById('extrasContainer');
      function renderExtraRows() {
        extContainer.innerHTML = extrasCopy.map((ex, idx) => `
          <div style="display:grid;grid-template-columns:1.5fr 1fr auto;gap:6px;align-items:center">
            <input class="input ext-name-inp" data-eidx="${idx}" value="${esc(ex.name || '')}" placeholder="Extra (e.g. Extra Cheese)">
            <input type="number" step="1" min="0" class="input ext-price-inp" data-eidx="${idx}" value="${Number(ex.price || 0)}" placeholder="Price">
            <button type="button" class="btn btn-xs btn-danger" data-del-ext="${idx}">✕</button>
          </div>
        `).join('');
        extContainer.querySelectorAll('.ext-name-inp').forEach((inp) => {
          inp.oninput = () => { extrasCopy[Number(inp.dataset.eidx)].name = inp.value; };
        });
        extContainer.querySelectorAll('.ext-price-inp').forEach((inp) => {
          inp.oninput = () => { extrasCopy[Number(inp.dataset.eidx)].price = Number(inp.value || 0); };
        });
        extContainer.querySelectorAll('[data-del-ext]').forEach((btn) => {
          btn.onclick = () => { extrasCopy.splice(Number(btn.dataset.delExt), 1); renderExtraRows(); };
        });
      }
      renderExtraRows();
      document.getElementById('addExtraRowBtn').onclick = () => {
        extrasCopy.push({ name: '', price: 0 });
        renderExtraRows();
      };

      document.getElementById('itemForm').onsubmit = async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('miName').value,
          sku: document.getElementById('miSku').value.trim() || undefined,
          category_id: Number(document.getElementById('miCat').value),
          price: Number(document.getElementById('miPrice').value),
          prep_minutes: Number(document.getElementById('miPrep').value || 12),
          gst_rate: Number(document.getElementById('miGst').value),
          dietary: document.getElementById('miDiet').value,
          station: document.getElementById('miStation').value,
          photo_url: document.getElementById('miPhotoUrl').value.trim(),
          description: document.getElementById('miDesc').value,
          variants: variantsCopy.filter((v) => v.name.trim()),
          extras: extrasCopy.filter((x) => x.name && x.name.trim()).map((x) => ({ name: x.name.trim(), price: Number(x.price || 0) })),
          labels: Array.from(document.querySelectorAll('.mi-label-cb:checked')).map((c) => c.value)
        };
        if (existing) await put(`/api/menu/items/${existing.id}`, payload);
        else await post('/api/menu/items', payload);
        app.closeModal();
        toast(existing ? 'Menu item updated' : 'Menu item created', 'success');
        renderMenu(root, app);
      };
    }

    document.getElementById('addMenuBtn').onclick = () => {
      if (menuData.categories.length === 0) {
        toast('Create a category first before adding dishes', 'info');
        document.getElementById('addCatBtn').click();
        return;
      }
      openItemForm(null);
    };

    document.getElementById('emptyMenuBtn')?.addEventListener('click', () => {
      if (menuData.categories.length === 0) document.getElementById('addCatBtn').click();
      else document.getElementById('addMenuBtn').click();
    });

    root.querySelectorAll('[data-edit-menu]').forEach((b) => {
      b.onclick = () => openItemForm(menuData.items.find((m) => m.id === Number(b.dataset.editMenu)));
    });

    root.querySelectorAll('[data-toggle-avail]').forEach((b) => {
      b.onclick = async () => {
        const it = menuData.items.find((m) => m.id === Number(b.dataset.toggleAvail));
        await put(`/api/menu/items/${it.id}`, { available: !it.available });
        renderMenu(root, app);
      };
    });

    root.querySelectorAll('[data-del-menu]').forEach((b) => {
      b.onclick = async () => {
        await del(`/api/menu/items/${b.dataset.delMenu}`);
        toast('Menu item deleted', 'info');
        renderMenu(root, app);
      };
    });

    root.querySelectorAll('[data-recipe-menu]').forEach((b) => {
      b.onclick = () => {
        const it = menuData.items.find((m) => m.id === Number(b.dataset.recipeMenu));
        if (invData.ingredients.length === 0) {
          app.openModal(`Recipe BOM: ${it.name}`, `
            <div class="empty-state">
              <h4>No Raw Ingredients Yet</h4>
              <p>Add raw ingredients in Inventory first before mapping quantities to this dish.</p>
              ${app.can('inventory:view') ? '<button type="button" class="btn btn-sm btn-primary" id="recipeGoInvBtn">Go to Inventory →</button>' : ''}
            </div>
          `);
          document.getElementById('recipeGoInvBtn')?.addEventListener('click', () => {
            app.closeModal();
            app.navigate('inventory');
          });
          return;
        }
        app.openModal(`Recipe BOM: ${it.name}`, `
          <p class="muted" style="font-size:12px">Define raw ingredients automatically deducted per serving when an invoice is settled.</p>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto">
            ${invData.ingredients.map((ing) => {
          const cur = it.recipe.find((r) => r.ingredient_id === ing.id);
          return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px;border:1px solid var(--border);border-radius:8px">
                  <span><strong>${esc(ing.name)}</strong> <small class="muted">(${esc(ing.unit)})</small></span>
                  <input type="number" step="0.01" min="0" class="input recipe-qty-input" data-ing-id="${ing.id}" style="max-width:110px" value="${cur ? cur.qty_per_serving : 0}">
                </div>
              `;
        }).join('')}
          </div>
          <button class="btn btn-primary" id="saveRecipeBtn">Save Recipe Mapping</button>
        `);
        document.getElementById('saveRecipeBtn').onclick = async () => {
          const ingredients = Array.from(document.querySelectorAll('.recipe-qty-input'))
            .map((inp) => ({ ingredient_id: Number(inp.dataset.ingId), qty_per_serving: Number(inp.value) }))
            .filter((x) => x.qty_per_serving > 0);
          await put(`/api/menu/items/${it.id}/recipe`, { ingredients });
          app.closeModal();
          toast('Recipe BOM updated!', 'success');
          renderMenu(root, app);
        };
      };
    });
  }

  // ==================== INVENTORY ====================
  async function renderInventory(root, app) {
    const data = await get('/api/inventory');
    const canEdit = app.can('inventory:edit');

    root.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">TRACKED INGREDIENTS</span>
          <div class="kpi-value">${data.ingredients.length}</div>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">LOW STOCK ITEMS</span>
          <div class="kpi-value" style="color:${data.lowStockCount ? 'var(--danger)' : 'var(--success)'}">${data.lowStockCount}</div>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">TOTAL INVENTORY VALUE</span>
          <div class="kpi-value">${formatINR(data.ingredients.reduce((s, i) => s + i.stock_qty * i.unit_cost, 0))}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Raw Ingredients &amp; Par Levels</h3>
            ${canEdit ? '<button class="btn btn-sm btn-primary" id="addIngBtn">+ Add Ingredient</button>' : ''}
          </div>
          <div class="table-wrap">
            ${data.ingredients.length === 0 ? `
              <div class="empty-state">
                <h4>No Raw Ingredients Tracked</h4>
                <p>Add ingredients with par levels to track stock and enable automatic recipe deduction.</p>
                ${canEdit ? '<button class="btn btn-sm btn-primary" id="emptyIngBtn">+ Add First Ingredient</button>' : ''}
              </div>
            ` : `
            <table class="data-table">
              <thead><tr><th>Ingredient</th><th>Stock</th><th>Par</th><th>Unit Cost</th><th>Supplier</th>${canEdit ? '<th>Adjust</th>' : ''}</tr></thead>
              <tbody>
                ${data.ingredients.map((ing) => {
      const low = ing.stock_qty <= ing.par_level;
      return `
                    <tr>
                      <td><strong>${esc(ing.name)}</strong><div class="muted mono" style="font-size:10px">${esc(ing.sku)}</div></td>
                      <td><span class="pill ${low ? 'pill-red' : 'pill-green'}">${ing.stock_qty} ${esc(ing.unit)}</span></td>
                      <td class="mono muted">${ing.par_level} ${esc(ing.unit)}</td>
                      <td class="mono">${formatINR(ing.unit_cost)}</td>
                      <td>${esc(ing.supplier)}</td>
                      ${canEdit ? `
                        <td style="white-space:nowrap">
                          <button class="btn btn-xs btn-secondary" data-edit-ing="${ing.id}">Edit</button>
                          <button class="btn btn-xs btn-secondary" data-adj-ing="${ing.id}">± Stock</button>
                          <button class="btn btn-xs btn-danger" data-del-ing="${ing.id}">Del</button>
                        </td>
                      ` : ''}
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
            `}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Recent Stock Movements</h3></div>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:460px;overflow-y:auto">
            ${data.movements.map((m) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
                <div>
                  <strong>${esc(m.ingredient_name)}</strong>
                  <div class="muted" style="font-size:11px">${esc(m.reason)} ${m.reference_id ? `• ${esc(m.reference_id)}` : ''}</div>
                </div>
                <span class="mono ${m.delta_qty >= 0 ? 'pill pill-green' : 'pill pill-amber'}">
                  ${m.delta_qty >= 0 ? '+' : ''}${m.delta_qty} ${esc(m.unit)}
                </span>
              </div>
            `).join('') || '<p class="muted">No stock movements logged yet.</p>'}
          </div>
        </div>
      </div>
    `;

    if (!canEdit) return;

    document.getElementById('emptyIngBtn')?.addEventListener('click', () => document.getElementById('addIngBtn').click());
    document.getElementById('addIngBtn').onclick = () => {
      app.openModal('New Raw Ingredient', `
        <form id="ingForm" style="display:flex;flex-direction:column;gap:10px">
          <label class="field-label">Ingredient Name <input id="inName" class="input" required></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="field-label">Unit (kg/L/pcs) <input id="inUnit" class="input" value="kg" required></label>
            <label class="field-label">Initial Stock <input id="inStock" type="number" step="0.1" class="input" value="10"></label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="field-label">Reorder Par Level <input id="inPar" type="number" step="0.1" class="input" value="4"></label>
            <label class="field-label">Unit Cost (₹) <input id="inCost" type="number" step="1" class="input" value="250"></label>
          </div>
          <label class="field-label">Supplier <input id="inSup" class="input" placeholder="e.g. Metro Cash & Carry"></label>
          <button type="submit" class="btn btn-primary">Add Ingredient</button>
        </form>
      `);
      document.getElementById('ingForm').onsubmit = async (e) => {
        e.preventDefault();
        await post('/api/inventory', {
          name: document.getElementById('inName').value,
          unit: document.getElementById('inUnit').value,
          stock_qty: Number(document.getElementById('inStock').value),
          par_level: Number(document.getElementById('inPar').value),
          unit_cost: Number(document.getElementById('inCost').value),
          supplier: document.getElementById('inSup').value
        });
        app.closeModal();
        toast('Ingredient added', 'success');
        renderInventory(root, app);
      };
    };

    root.querySelectorAll('[data-adj-ing]').forEach((b) => {
      b.onclick = () => {
        const ing = data.ingredients.find((x) => x.id === Number(b.dataset.adjIng));
        app.openModal(`Adjust Stock: ${ing.name}`, `
          <form id="adjForm" style="display:flex;flex-direction:column;gap:12px">
            <div>Current Stock: <strong class="mono">${ing.stock_qty} ${esc(ing.unit)}</strong></div>
            <label class="field-label">Delta Quantity (+ for Restock, - for Wastage)
              <input id="adjDelta" type="number" step="0.1" class="input" value="5" required>
            </label>
            <label class="field-label">Reason
              <select id="adjReason" class="select">
                <option value="purchase_restock">Purchase / Restock</option>
                <option value="wastage">Spoilage / Wastage</option>
                <option value="manual_audit">Physical Audit Correction</option>
              </select>
            </label>
            <button type="submit" class="btn btn-primary">Apply Stock Adjustment</button>
          </form>
        `);
        document.getElementById('adjForm').onsubmit = async (e) => {
          e.preventDefault();
          await post(`/api/inventory/${ing.id}/adjust`, {
            deltaQty: Number(document.getElementById('adjDelta').value),
            reason: document.getElementById('adjReason').value
          });
          app.closeModal();
          toast('Stock updated & logged', 'success');
          renderInventory(root, app);
        };
      };
    });

    root.querySelectorAll('[data-edit-ing]').forEach((b) => {
      b.onclick = () => {
        const ing = data.ingredients.find((x) => x.id === Number(b.dataset.editIng));
        app.openModal(`Edit Ingredient: ${ing.name}`, `
          <form id="editIngForm" style="display:flex;flex-direction:column;gap:10px">
            <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:8px">
              <label class="field-label">Name <input id="eiName" class="input" value="${esc(ing.name)}" required></label>
              <label class="field-label">SKU <input id="eiSku" class="input" value="${esc(ing.sku)}"></label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <label class="field-label">Unit <input id="eiUnit" class="input" value="${esc(ing.unit)}" required></label>
              <label class="field-label">Par Level <input id="eiPar" type="number" step="0.1" class="input" value="${ing.par_level}"></label>
              <label class="field-label">Unit Cost (₹) <input id="eiCost" type="number" step="1" class="input" value="${ing.unit_cost}"></label>
            </div>
            <label class="field-label">Supplier <input id="eiSup" class="input" value="${esc(ing.supplier)}"></label>
            <button type="submit" class="btn btn-primary">Save Ingredient</button>
          </form>
        `);
        document.getElementById('editIngForm').onsubmit = async (e) => {
          e.preventDefault();
          await put(`/api/inventory/${ing.id}`, {
            name: document.getElementById('eiName').value,
            sku: document.getElementById('eiSku').value,
            unit: document.getElementById('eiUnit').value,
            par_level: Number(document.getElementById('eiPar').value),
            unit_cost: Number(document.getElementById('eiCost').value),
            supplier: document.getElementById('eiSup').value
          });
          app.closeModal();
          toast('Ingredient updated', 'success');
          renderInventory(root, app);
        };
      };
    });

    root.querySelectorAll('[data-del-ing]').forEach((b) => {
      b.onclick = async () => {
        await del(`/api/inventory/${b.dataset.delIng}`);
        renderInventory(root, app);
      };
    });
  }

  // ==================== ANALYTICS ====================
  async function renderAnalytics(root, app) {
    const scope = app.state.analyticsScope || 'branch';
    const data = await get(`/api/analytics?scope=${scope}`);
    const k = data.kpis;
    const sym = app.state.settings?.currency_symbol || '₹';

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${scope === 'branch' ? 'btn-primary' : 'btn-secondary'}" data-an-scope="branch">Active Branch</button>
          ${app.state.user.role === 'owner' ? `<button class="btn btn-sm ${scope === 'all' ? 'btn-primary' : 'btn-secondary'}" data-an-scope="all">All Branches Roll-Up</button>` : ''}
        </div>
        <a class="btn btn-sm btn-secondary" href="/api/analytics/export.csv" target="_blank">⬇ Export Invoices CSV</a>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">GROSS REVENUE</span><div class="kpi-value">${formatINR(k.totalRevenue)}</div></div>
        <div class="kpi-card"><span class="kpi-label">TOTAL GST COLLECTED</span><div class="kpi-value">${formatINR(k.totalTax)}</div></div>
        <div class="kpi-card"><span class="kpi-label">DISCOUNTS ISSUED</span><div class="kpi-value">${formatINR(k.totalDiscount)}</div></div>
        <div class="kpi-card"><span class="kpi-label">AVERAGE TICKET (AOV)</span><div class="kpi-value">${formatINR(k.aov)}</div></div>
      </div>

      <div class="grid-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Daily Revenue Breakdown</h3></div>
          <div id="anBarChart"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Payment Mode Mix</h3></div>
          <div id="anDonutChart"></div>
        </div>
      </div>

      <div class="grid-equal-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Top Performing Dishes</h3></div>
          <table class="data-table">
            <thead><tr><th>Dish</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
            <tbody>
              ${data.topItems.map((it) => `
                <tr><td><strong>${esc(it.name)}</strong></td><td class="mono">${it.qty}</td><td class="mono">${formatINR(it.revenue)}</td></tr>
              `).join('') || '<tr><td colspan="3" class="muted">No settled item sales recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Multi-Branch Performance</h3></div>
          <table class="data-table">
            <thead><tr><th>Branch</th><th>Code</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              ${data.branchBreakdown.map((b) => `
                <tr><td><strong>${esc(b.name)}</strong></td><td class="mono">${esc(b.code)}</td><td class="mono">${b.orders}</td><td class="mono"><strong>${formatINR(b.revenue)}</strong></td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    window.BistroCharts.renderBarChart(document.getElementById('anBarChart'), data.dailySeries, sym);
    window.BistroCharts.renderDonutChart(document.getElementById('anDonutChart'), data.paymentBreakdown, sym);

    root.querySelectorAll('[data-an-scope]').forEach((b) => {
      b.onclick = () => {
        app.state.analyticsScope = b.dataset.anScope;
        renderAnalytics(root, app);
      };
    });
  }

  // ==================== STAFF & ROLES ====================
  async function renderStaff(root, app) {
    const [staff, branches, customRoles, auditLogs] = await Promise.all([
      get('/api/staff'),
      get('/api/branches'),
      get('/api/roles'),
      app.can('analytics:view') ? get('/api/audit') : Promise.resolve([])
    ]);
    const canEdit = app.can('staff:edit');

    root.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3 class="card-title">Staff Accounts &amp; RBAC Roles</h3>
          ${canEdit ? '<button class="btn btn-sm btn-primary" id="addStaffBtn">+ Add Staff Member</button>' : ''}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th>${canEdit ? '<th>Actions</th>' : ''}</tr></thead>
            <tbody>
              ${staff.map((u) => `
                <tr>
                  <td><strong>${esc(u.name)}</strong></td>
                  <td class="mono">${esc(u.email)}</td>
                  <td><span class="pill pill-orange">${esc(u.custom_role_name || u.role)}</span></td>
                  <td>${esc(u.branch_name || 'All')}</td>
                  <td><span class="pill ${u.active ? 'pill-green' : 'pill-red'}">${u.active ? 'Active' : 'Disabled'}</span></td>
                  ${canEdit ? `
                    <td>
                      <button class="btn btn-xs btn-secondary" data-edit-staff="${u.id}">Edit / Reset PIN</button>
                      ${u.id !== app.state.user.id ? `<button class="btn btn-xs btn-ghost" data-toggle-staff="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}
                    </td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3 class="card-title">Role-Based Access Matrix</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Role</th><th>Capabilities</th></tr></thead>
            <tbody>
              <tr><td><span class="pill pill-orange">OWNER</span></td><td>Full multi-branch control, branch creation, staff management, settings, billing, analytics</td></tr>
              <tr><td><span class="pill pill-blue">MANAGER</span></td><td>Branch floor plan editing, discounts/voids, inventory, menu, staff, analytics, settings</td></tr>
              <tr><td><span class="pill pill-green">CASHIER</span></td><td>POS billing, GST invoices, discounts, table transfers &amp; merges, view KDS</td></tr>
              <tr><td><span class="pill pill-amber">WAITER</span></td><td>Take Dine-In/Takeaway orders, fire KOTs, view floor plan, transfer tables</td></tr>
              <tr><td><span class="pill pill-gray">CHEF</span></td><td>KDS ticket progression (Queued → Preparing → Ready → Served) &amp; recipe inspection</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      ${auditLogs.length > 0 ? `
        <div class="card">
          <div class="card-header"><h3 class="card-title">Recent Security &amp; POS Audit Log</h3></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Timestamp</th><th>Staff</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                ${auditLogs.slice(0, 15).map((a) => `
                  <tr>
                    <td class="mono muted" style="font-size:11px">${esc(a.created_at)}</td>
                    <td>${esc(a.user_name || 'System')}</td>
                    <td><span class="pill pill-blue">${esc(a.action)}</span></td>
                    <td class="mono">${esc(a.entity_type)} #${esc(a.entity_id)}</td>
                    <td class="mono muted" style="font-size:11px">${esc(a.details_json)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    if (!canEdit) return;

    function openStaffModal(existing) {
      const ALL_PERMS = [
        ['dashboard:view', 'Dashboard'], ['pos:use', 'POS Terminal'], ['floor:view', 'Floor View'],
        ['floor:edit', 'Floor Edit'], ['tables:transfer', 'Transfer Tables'], ['tables:merge', 'Merge Tables'],
        ['orders:view', 'Orders/Bills'], ['orders:discount', 'Discounts'], ['orders:void', 'Void/Cancel'],
        ['kds:view', 'KDS View'], ['kds:update', 'KDS Update'], ['menu:view', 'Menu View'],
        ['menu:edit', 'Menu Edit'], ['inventory:view', 'Inventory View'], ['inventory:edit', 'Inventory Edit'],
        ['analytics:view', 'Analytics'], ['staff:view', 'Staff View'], ['staff:edit', 'Staff Edit'],
        ['settings:view', 'Settings View'], ['settings:edit', 'Settings Edit']
      ];
      const ROLE_DEFAULTS = {
        manager: ['dashboard:view', 'pos:use', 'floor:view', 'floor:edit', 'tables:transfer', 'tables:merge', 'orders:view', 'orders:void', 'orders:discount', 'kds:view', 'kds:update', 'menu:view', 'menu:edit', 'inventory:view', 'inventory:edit', 'analytics:view', 'staff:view', 'staff:edit', 'settings:view', 'settings:edit'],
        cashier: ['dashboard:view', 'pos:use', 'floor:view', 'tables:transfer', 'tables:merge', 'orders:view', 'orders:discount', 'kds:view', 'menu:view', 'inventory:view', 'settings:view'],
        waiter: ['pos:use', 'floor:view', 'tables:transfer', 'orders:view', 'kds:view', 'menu:view'],
        chef: ['kds:view', 'kds:update', 'menu:view', 'inventory:view', 'orders:view']
      };
      const initRole = existing?.role || 'waiter';
      let selectedPerms = new Set(Array.isArray(existing?.custom_permissions) ? existing.custom_permissions : (ROLE_DEFAULTS[initRole] || []));

      app.openModal(existing ? `Edit ${existing.name}` : 'Add Staff Member', `
        <form id="staffForm" style="display:flex;flex-direction:column;gap:11px;max-height:76vh;overflow-y:auto;padding-right:4px">
          <label class="field-label">Full Name <input id="stName" class="input" value="${esc(existing?.name || '')}" required></label>
          ${!existing ? `<label class="field-label">Email <input id="stEmail" type="email" class="input" required></label>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="field-label">Role
              <select id="stRole" class="select">
                ${['manager', 'cashier', 'waiter', 'chef', ...(app.state.user.role === 'owner' ? ['owner'] : [])].map((r) => `
                  <option value="${r}" ${initRole === r ? 'selected' : ''}>${r.toUpperCase()}</option>
                `).join('')}
              </select>
            </label>
            <label class="field-label">Custom Role Template (optional)
              <select id="stCustomRole" class="select">
                <option value="">None (Use Role/Custom)</option>
                ${(customRoles || []).map((cr) => `<option value="${esc(cr.name)}" ${existing?.custom_role_name === cr.name ? 'selected' : ''}>${esc(cr.name)}</option>`).join('')}
              </select>
            </label>
          </div>
          <label class="field-label">Assigned Branch
            <select id="stBranch" class="select">
              ${branches.map((b) => `<option value="${b.id}" ${(existing?.branch_id || app.state.activeBranchId) === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="field-label">${existing ? 'New Password (optional)' : 'Password'} <input id="stPass" type="password" class="input" ${existing ? '' : 'required'}></label>
            <label class="field-label">${existing ? 'New PIN (optional)' : '4-6 Digit PIN'} <input id="stPin" type="text" maxlength="6" class="input" ${existing ? '' : 'required'}></label>
          </div>
          <div id="stPermsWrap" style="border-top:1px solid var(--border);padding-top:10px;${initRole === 'owner' ? 'display:none' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span class="field-label">Role Permissions</span>
              <button type="button" class="btn btn-xs btn-ghost" id="stResetPermsBtn">Reset Role Defaults</button>
            </div>
            <div id="stPermsGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:12px"></div>
          </div>
          <button type="submit" class="btn btn-primary">${existing ? 'Save Changes' : 'Create Staff Account'}</button>
        </form>
      `);

      const permsGrid = document.getElementById('stPermsGrid');
      const permsWrap = document.getElementById('stPermsWrap');
      function renderPermsGrid() {
        permsGrid.innerHTML = ALL_PERMS.map(([perm, label]) => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" class="st-perm-cb" value="${perm}" ${selectedPerms.has(perm) ? 'checked' : ''}>
            <span>${esc(label)}</span>
          </label>
        `).join('');
        permsGrid.querySelectorAll('.st-perm-cb').forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) selectedPerms.add(cb.value);
            else selectedPerms.delete(cb.value);
          };
        });
      }
      renderPermsGrid();

      document.getElementById('stRole').onchange = () => {
        const r = document.getElementById('stRole').value;
        permsWrap.style.display = r === 'owner' ? 'none' : '';
        if (r !== 'owner') {
          selectedPerms = new Set(ROLE_DEFAULTS[r] || []);
          renderPermsGrid();
        }
      };
      document.getElementById('stResetPermsBtn').onclick = () => {
        const r = document.getElementById('stRole').value;
        selectedPerms = new Set(ROLE_DEFAULTS[r] || []);
        renderPermsGrid();
      };

      document.getElementById('stCustomRole')?.addEventListener('change', (e) => {
        const tmpl = (customRoles || []).find((cr) => cr.name === e.target.value);
        if (tmpl && Array.isArray(tmpl.permissions)) {
          selectedPerms = new Set(tmpl.permissions);
          renderPermsGrid();
        }
      });

      document.getElementById('staffForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const role = document.getElementById('stRole').value;
          const payload = {
            name: document.getElementById('stName').value,
            role,
            custom_role_name: document.getElementById('stCustomRole')?.value || '',
            branch_id: Number(document.getElementById('stBranch').value),
            password: document.getElementById('stPass').value || undefined,
            pin: document.getElementById('stPin').value || undefined,
            custom_permissions: role === 'owner' ? null : Array.from(selectedPerms)
          };
          if (existing) await put(`/api/staff/${existing.id}`, payload);
          else {
            payload.email = document.getElementById('stEmail').value;
            await post('/api/staff', payload);
          }
          app.closeModal();
          toast('Staff record saved', 'success');
          renderStaff(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }

    document.getElementById('addStaffBtn').onclick = () => openStaffModal(null);
    root.querySelectorAll('[data-edit-staff]').forEach((b) => {
      b.onclick = () => openStaffModal(staff.find((u) => u.id === Number(b.dataset.editStaff)));
    });
    root.querySelectorAll('[data-toggle-staff]').forEach((b) => {
      b.onclick = async () => {
        const u = staff.find((x) => x.id === Number(b.dataset.toggleStaff));
        await put(`/api/staff/${u.id}`, { active: !u.active });
        renderStaff(root, app);
      };
    });
  }

  function compressImageFile(file, maxDim = 280) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('Please select a valid image file'));
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/webp', 0.84));
        };
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  // ==================== CUSTOMIZATION SETTINGS & BRANCHES ====================
  async function renderSettings(root, app) {
    if (window.GresCustomization) {
      return window.GresCustomization.render(root, app);
    }
    const [settings, branches] = await Promise.all([get('/api/settings'), get('/api/branches')]);
    const canEdit = app.can('settings:edit');
    const rest = app.state.restaurant || {};
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let hoursObj = {};
    let holidaysList = [];
    try { hoursObj = JSON.parse(settings.opening_hours_json || '{}') || {}; } catch { hoursObj = {}; }
    try { holidaysList = JSON.parse(settings.holidays_json || '[]') || []; } catch { holidaysList = []; }
    const TYPES = ['Fine Dining', 'Casual Dining', 'Cafe / Bakery', 'Fast Casual / QSR', 'Cloud Kitchen', 'Bar & Pub', 'Food Truck', 'Buffet / Catering', 'Other'];
    const TIMEZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];

    root.innerHTML = `
      <div class="grid-2">
        <form id="settingsForm" class="card" style="display:flex;flex-direction:column;gap:14px">
          <div class="card-header">
            <div>
              <h3 class="card-title">Restaurant Branding, GST &amp; UI Customization</h3>
              <div class="muted" style="font-size:11.5px">Customize your restaurant identity on top of <strong>GRES</strong> (<em>Run Your Restaurant Smarter.</em>)</div>
            </div>
            ${canEdit ? '<button type="submit" class="btn btn-sm btn-primary">Save &amp; Apply Settings</button>' : ''}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">Restaurant Name <input id="setName" class="input" value="${esc(settings.restaurant_name)}"></label>
            <label class="field-label">Restaurant Tagline <input id="setTag" class="input" value="${esc(settings.tagline)}"></label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:10px">
            <label class="field-label">Restaurant Type
              <select id="setRestType" class="select">
                <option value="">Select type...</option>
                ${TYPES.map((tp) => `<option value="${esc(tp)}" ${rest.restaurant_type === tp ? 'selected' : ''}>${esc(tp)}</option>`).join('')}
              </select>
            </label>
            <label class="field-label">Short Description <input id="setDesc" class="input" placeholder="Cuisine, specialty, vibe..." value="${esc(rest.description || '')}"></label>
          </div>

          <div style="display:grid;grid-template-columns:120px 1fr auto;gap:10px;align-items:end">
            <label class="field-label">Monogram (1-3) <input id="setInit" maxlength="3" class="input mono" value="${esc(settings.brand_initials || '')}"></label>
            <label class="field-label">Custom Logo URL (optional) <input id="setLogoUrl" class="input" placeholder="https://.../logo.png" value="${esc(settings.logo_url || '')}"></label>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;margin-bottom:1px">
              Upload Logo <input type="file" id="setLogoFile" accept="image/*" style="display:none">
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <label class="field-label">Currency Code <input id="setCurrCode" class="input" value="${esc(settings.currency_code)}"></label>
            <label class="field-label">Currency Symbol <input id="setCurrSym" class="input" value="${esc(settings.currency_symbol)}"></label>
            <label class="field-label">UPI VPA ID <input id="setUpi" class="input" value="${esc(settings.upi_id)}"></label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <label class="field-label">Timezone
              <select id="setTz" class="select">
                ${TIMEZONES.concat(settings.timezone && !TIMEZONES.includes(settings.timezone) ? [settings.timezone] : []).map((tz) => `
                  <option value="${esc(tz)}" ${(settings.timezone || 'Asia/Kolkata') === tz ? 'selected' : ''}>${esc(tz)}</option>
                `).join('')}
              </select>
            </label>
            <label class="field-label">Date Format
              <select id="setDateFmt" class="select">
                ${['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((df) => `<option value="${df}" ${(settings.date_format || 'DD/MM/YYYY') === df ? 'selected' : ''}>${df}</option>`).join('')}
              </select>
            </label>
            <label class="field-label">GST Status
              <select id="setGstEnabled" class="select">
                <option value="1" ${settings.gst_enabled !== 0 ? 'selected' : ''}>GST Enabled</option>
                <option value="0" ${settings.gst_enabled === 0 ? 'selected' : ''}>GST Disabled</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:10px">
            <label class="field-label">GSTIN <input id="setGstin" class="input mono" placeholder="e.g. 29ABCDE1234F1Z5" value="${esc(settings.gstin || '')}"></label>
            <label class="field-label">GST Billing Mode
              <select id="setTaxMode" class="select">
                <option value="exclusive" ${settings.tax_mode === 'exclusive' ? 'selected' : ''}>Exclusive (Price + GST)</option>
                <option value="inclusive" ${settings.tax_mode === 'inclusive' ? 'selected' : ''}>Inclusive (MRP incl. GST)</option>
                <option value="composition" ${settings.tax_mode === 'composition' ? 'selected' : ''}>Composition Scheme</option>
              </select>
            </label>
            <label class="field-label">Composition GST % <input id="setCompRate" type="number" step="0.5" class="input" value="${settings.composition_rate}"></label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <label class="field-label">CGST % <input id="setCgst" type="number" step="0.5" class="input" value="${settings.cgst_rate ?? 2.5}"></label>
            <label class="field-label">SGST % <input id="setSgst" type="number" step="0.5" class="input" value="${settings.sgst_rate ?? 2.5}"></label>
            <label class="field-label">IGST % (overrides split) <input id="setIgst" type="number" step="0.5" class="input" value="${settings.igst_rate ?? 0}"></label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">Service Charge % <input id="setSc" type="number" step="0.5" class="input" value="${settings.service_charge_rate}"></label>
            <label class="field-label">Round-Off Total
              <select id="setRound" class="select">
                <option value="1" ${settings.round_off_enabled ? 'selected' : ''}>Enabled (Nearest ₹1)</option>
                <option value="0" ${!settings.round_off_enabled ? 'selected' : ''}>Disabled (Exact Paise)</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
            <label class="field-label">Invoice Prefix <input id="setInvPref" class="input" value="${esc(settings.invoice_prefix)}"></label>
            <label class="field-label">Start # <input id="setInvStart" type="number" min="1" class="input" value="${settings.invoice_start_number || 1001}"></label>
            <label class="field-label">KOT Prefix <input id="setKotPref" class="input" value="${esc(settings.kot_prefix)}"></label>
            <label class="field-label">Thermal Width
              <select id="setThermal" class="select">
                <option value="80mm" ${settings.thermal_width === '80mm' ? 'selected' : ''}>80mm</option>
                <option value="58mm" ${settings.thermal_width === '58mm' ? 'selected' : ''}>58mm</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <label class="field-label">Interface Theme
              <select id="setTheme" class="select">
                <option value="dark" ${settings.theme_mode === 'dark' ? 'selected' : ''}>Dark Mode</option>
                <option value="light" ${settings.theme_mode === 'light' ? 'selected' : ''}>Light Mode</option>
              </select>
            </label>
            <label class="field-label">Accent Color
              <input id="setAccent" type="color" class="input" style="height:38px;padding:3px" value="${esc(settings.accent_color)}">
            </label>
            <label class="field-label">POS UI Density
              <select id="setDensity" class="select">
                <option value="comfortable" ${settings.pos_density === 'comfortable' ? 'selected' : ''}>Comfortable</option>
                <option value="compact" ${settings.pos_density === 'compact' ? 'selected' : ''}>Compact</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">KDS SLA Warning (Minutes) <input id="setSla" type="number" class="input" value="${settings.kds_sla_minutes}"></label>
            <label class="field-label">KDS Sound Chime
              <select id="setSound" class="select">
                <option value="1" ${settings.kds_sound_enabled ? 'selected' : ''}>Enabled</option>
                <option value="0" ${!settings.kds_sound_enabled ? 'selected' : ''}>Muted</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label">Receipt Header <input id="setHeader" class="input" value="${esc(settings.receipt_header)}"></label>
            <label class="field-label">Receipt Footer Message <input id="setFooter" class="input" value="${esc(settings.receipt_footer)}"></label>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:10px">
            <span class="field-label" style="display:block;margin-bottom:6px">Weekly Opening Hours</span>
            <div style="display:grid;gap:6px">
              ${DAYS.map((day) => {
      const slot = hoursObj[day] || { open: '09:00', close: '23:00', closed: false };
      return `
                  <div style="display:grid;grid-template-columns:92px auto 1fr 1fr;gap:8px;align-items:center;font-size:12px">
                    <strong>${day.slice(0, 3)}</strong>
                    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="hr-open" data-day="${day}" ${slot.closed ? '' : 'checked'}> Open</label>
                    <input type="time" class="input hr-start" data-day="${day}" value="${esc(slot.open || '09:00')}" style="padding:5px 8px">
                    <input type="time" class="input hr-end" data-day="${day}" value="${esc(slot.close || '23:00')}" style="padding:5px 8px">
                  </div>`;
    }).join('')}
            </div>
          </div>

          <label class="field-label">Holidays / Closed Dates (comma-separated YYYY-MM-DD)
            <input id="setHolidays" class="input mono" placeholder="e.g. 2026-01-26, 2026-08-15" value="${esc(holidaysList.join(', '))}">
          </label>
        </form>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Multi-Branch Outlets (${branches.length})</h3>
            ${app.state.user.role === 'owner' ? '<button class="btn btn-sm btn-primary" id="addBranchBtn">+ New Branch</button>' : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${branches.map((b) => `
              <div class="card" style="background:var(--bg);border-color:${b.id === app.state.activeBranchId ? 'var(--accent)' : 'var(--border)'}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <strong>${esc(b.name)} <span class="mono muted">(${esc(b.code)})</span></strong>
                  <div style="display:flex;gap:6px;align-items:center">
                    ${b.id === app.state.activeBranchId ? '<span class="pill pill-orange">ACTIVE</span>' : ''}
                    ${canEdit ? `<button class="btn btn-xs btn-secondary" data-edit-branch="${b.id}">Edit</button>` : ''}
                  </div>
                </div>
                <div class="muted" style="font-size:12px;margin-top:4px">${esc([b.address, b.city, b.state, b.country, b.postal_code].filter(Boolean).join(', ') || 'No address set')}</div>
                <div class="mono muted" style="font-size:11px;margin-top:4px">Ph: ${esc(b.phone || 'N/A')} • Email: ${esc(b.email || 'N/A')} • GSTIN: ${esc(b.gstin || 'N/A')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    if (canEdit) {
      document.getElementById('setLogoFile')?.addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        try {
          document.getElementById('setLogoUrl').value = await compressImageFile(f, 240);
          toast('Logo loaded — save settings to apply', 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      document.getElementById('settingsForm').onsubmit = async (e) => {
        e.preventDefault();
        const cgst = Number(document.getElementById('setCgst').value || 0);
        const sgst = Number(document.getElementById('setSgst').value || 0);
        const igst = Number(document.getElementById('setIgst').value || 0);
        const openingHours = {};
        DAYS.forEach((day) => {
          const openCb = document.querySelector(`.hr-open[data-day="${day}"]`);
          const startInp = document.querySelector(`.hr-start[data-day="${day}"]`);
          const endInp = document.querySelector(`.hr-end[data-day="${day}"]`);
          openingHours[day] = {
            closed: !(openCb?.checked),
            open: startInp?.value || '09:00',
            close: endInp?.value || '23:00'
          };
        });
        const holidays = document.getElementById('setHolidays').value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const updated = await put('/api/settings', {
          restaurant_name: document.getElementById('setName').value,
          tagline: document.getElementById('setTag').value,
          restaurant_type: document.getElementById('setRestType').value,
          description: document.getElementById('setDesc').value,
          brand_initials: document.getElementById('setInit').value,
          logo_url: document.getElementById('setLogoUrl').value,
          currency_code: document.getElementById('setCurrCode').value,
          currency_symbol: document.getElementById('setCurrSym').value,
          upi_id: document.getElementById('setUpi').value,
          timezone: document.getElementById('setTz').value,
          date_format: document.getElementById('setDateFmt').value,
          gst_enabled: document.getElementById('setGstEnabled').value === '1',
          gstin: document.getElementById('setGstin').value,
          tax_mode: document.getElementById('setTaxMode').value,
          cgst_rate: cgst,
          sgst_rate: sgst,
          igst_rate: igst,
          default_gst_rate: igst > 0 ? igst : (cgst + sgst),
          composition_rate: Number(document.getElementById('setCompRate').value),
          service_charge_rate: Number(document.getElementById('setSc').value),
          round_off_enabled: document.getElementById('setRound').value === '1',
          invoice_prefix: document.getElementById('setInvPref').value,
          invoice_start_number: Number(document.getElementById('setInvStart').value || 1001),
          kot_prefix: document.getElementById('setKotPref').value,
          thermal_width: document.getElementById('setThermal').value,
          theme_mode: document.getElementById('setTheme').value,
          accent_color: document.getElementById('setAccent').value,
          pos_density: document.getElementById('setDensity').value,
          kds_sla_minutes: Number(document.getElementById('setSla').value),
          kds_sound_enabled: document.getElementById('setSound').value === '1',
          receipt_header: document.getElementById('setHeader').value,
          receipt_footer: document.getElementById('setFooter').value,
          opening_hours: openingHours,
          holidays
        });
        await app.refreshSession();
        app.applySettings(updated);
        toast('Settings saved & applied across UI!', 'success');
      };
    }

    root.querySelectorAll('[data-edit-branch]').forEach((btn) => {
      btn.onclick = () => {
        const b = branches.find((x) => x.id === Number(btn.dataset.editBranch));
        app.openModal(`Edit Branch: ${b.name}`, `
          <form id="editBranchForm" style="display:flex;flex-direction:column;gap:10px;max-height:76vh;overflow-y:auto;padding-right:4px">
            <label class="field-label">Branch Name <input id="ebName" class="input" value="${esc(b.name)}" required></label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <label class="field-label">Country <input id="ebCountry" class="input" value="${esc(b.country || '')}"></label>
              <label class="field-label">State <input id="ebState" class="input" value="${esc(b.state || '')}"></label>
              <label class="field-label">City <input id="ebCity" class="input" value="${esc(b.city || '')}"></label>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
              <label class="field-label">Street Address <input id="ebAddr" class="input" value="${esc(b.address || '')}"></label>
              <label class="field-label">Postal Code <input id="ebPostal" class="input" value="${esc(b.postal_code || '')}"></label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <label class="field-label">Phone <input id="ebPhone" class="input" value="${esc(b.phone || '')}"></label>
              <label class="field-label">Email <input id="ebEmail" type="email" class="input" value="${esc(b.email || '')}"></label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <label class="field-label">GSTIN <input id="ebGst" class="input" value="${esc(b.gstin || '')}"></label>
              <label class="field-label">FSSAI <input id="ebFssai" class="input" value="${esc(b.fssai || '')}"></label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
              <label class="field-label">Latitude <input id="ebLat" type="number" step="any" class="input" value="${b.map_lat ?? ''}"></label>
              <label class="field-label">Longitude <input id="ebLng" type="number" step="any" class="input" value="${b.map_lng ?? ''}"></label>
              <button type="button" class="btn btn-sm btn-secondary" id="ebGpsBtn">Detect GPS</button>
            </div>
            <button type="submit" class="btn btn-primary">Save Branch</button>
          </form>
        `);
        document.getElementById('ebGpsBtn').onclick = () => {
          if (!navigator.geolocation) return toast('Geolocation unavailable', 'error');
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              document.getElementById('ebLat').value = pos.coords.latitude.toFixed(6);
              document.getElementById('ebLng').value = pos.coords.longitude.toFixed(6);
              toast('GPS coordinates updated', 'success');
            },
            (err) => toast(err.message, 'error')
          );
        };
        document.getElementById('editBranchForm').onsubmit = async (e) => {
          e.preventDefault();
          await put(`/api/branches/${b.id}`, {
            name: document.getElementById('ebName').value,
            country: document.getElementById('ebCountry').value,
            state: document.getElementById('ebState').value,
            city: document.getElementById('ebCity').value,
            address: document.getElementById('ebAddr').value,
            postal_code: document.getElementById('ebPostal').value,
            phone: document.getElementById('ebPhone').value,
            email: document.getElementById('ebEmail').value,
            gstin: document.getElementById('ebGst').value,
            fssai: document.getElementById('ebFssai').value,
            map_lat: document.getElementById('ebLat').value || null,
            map_lng: document.getElementById('ebLng').value || null
          });
          app.closeModal();
          await app.refreshSession();
          toast('Branch updated', 'success');
          renderSettings(root, app);
        };
      };
    });

    document.getElementById('addBranchBtn')?.addEventListener('click', () => {
      app.openModal('Create Restaurant Branch', `
        <form id="branchForm" style="display:flex;flex-direction:column;gap:10px">
          <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:8px">
            <label class="field-label">Branch Name <input id="brName" class="input" placeholder="e.g. Koramangala Hub" required></label>
            <label class="field-label">Code <input id="brCode" class="input" placeholder="BLR-KOR" required></label>
          </div>
          <label class="field-label">Address <input id="brAddr" class="input" required></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="field-label">GSTIN <input id="brGst" class="input"></label>
            <label class="field-label">FSSAI <input id="brFssai" class="input"></label>
          </div>
          <button type="submit" class="btn btn-primary">Create Branch</button>
        </form>
      `);
      document.getElementById('branchForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await post('/api/branches', {
            name: document.getElementById('brName').value,
            code: document.getElementById('brCode').value,
            address: document.getElementById('brAddr').value,
            gstin: document.getElementById('brGst').value,
            fssai: document.getElementById('brFssai').value
          });
          app.closeModal();
          await app.refreshSession();
          toast('New branch provisioned!', 'success');
          renderSettings(root, app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  window.BistroAdminViews = {
    renderDashboard,
    renderOrdersAndInvoices,
    renderMenu,
    renderInventory,
    renderAnalytics,
    renderStaff,
    renderSettings
  };
})();
