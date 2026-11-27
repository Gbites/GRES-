(function () {
  'use strict';

  const { esc, formatINR, compressImageFile, toast, playKdsChime, get, post, put, del } = window.GresAPI;

  const TABS = [
    { id: 'appearance', label: '1. Appearance', desc: 'Themes, colors, fonts & layout' },
    { id: 'branding', label: '2. Branding', desc: 'Logo, cover, favicon & surfaces' },
    { id: 'dashboard', label: '3. Dashboard', desc: 'Widgets, sizing & drag order' },
    { id: 'pos', label: '4. POS Terminal', desc: 'Layout, cards, buttons & keys' },
    { id: 'tables', label: '5. Tables & Floors', desc: 'Colors, shapes, sizes & floors' },
    { id: 'billing', label: '6. Billing & Invoice', desc: 'Templates, paper sizes & GST' },
    { id: 'menu', label: '7. Menu & Pricing', desc: 'Subcategories, labels & rules' },
    { id: 'notifications', label: '8. Notifications', desc: 'Alerts, sounds & channels' },
    { id: 'staff', label: '9. Staff & Roles', desc: 'Custom roles & permissions' },
    { id: 'businessRules', label: '10. Business Rules', desc: 'Hours, taxes, refunds & pay' },
    { id: 'advanced', label: '11. Advanced', desc: 'Locale, printer, backup & branches' }
  ];

  const ALL_PERMS = [
    ['dashboard:view', 'Dashboard View'], ['pos:use', 'POS Terminal'],
    ['floor:view', 'Floor View'], ['floor:edit', 'Floor Edit'],
    ['tables:transfer', 'Transfer Tables'], ['tables:merge', 'Merge Tables'],
    ['orders:view', 'Orders & Bills'], ['orders:discount', 'Discounts'],
    ['orders:void', 'Void / Cancel'], ['kds:view', 'KDS View'],
    ['kds:update', 'KDS Update'], ['menu:view', 'Menu View'],
    ['menu:edit', 'Menu Edit'], ['inventory:view', 'Inventory View'],
    ['inventory:edit', 'Inventory Edit'], ['analytics:view', 'Analytics'],
    ['staff:view', 'Staff View'], ['staff:edit', 'Staff Edit'],
    ['settings:view', 'Settings View'], ['settings:edit', 'Settings Edit']
  ];

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const FONTS = ['Plus Jakarta Sans', 'Outfit', 'Inter', 'System UI', 'JetBrains Mono'];
  const TIMEZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  async function renderCustomizationStudio(root, app) {
    const canEdit = app.can('settings:edit');
    const [custPayload, branches, floors, tables, menuData, roles] = await Promise.all([
      get('/api/customization'),
      get('/api/branches'),
      get('/api/floors'),
      get('/api/tables'),
      get('/api/menu'),
      app.can('staff:view') ? get('/api/roles') : Promise.resolve([])
    ]);

    const savedSettings = custPayload.settings;
    let baselineJson = JSON.stringify(custPayload.customization);
    let draft = clone(custPayload.customization);
    let extraBillingFields = {
      invoice_prefix: savedSettings.invoice_prefix || 'INV',
      invoice_start_number: savedSettings.invoice_start_number || 1001,
      kot_prefix: savedSettings.kot_prefix || 'KOT',
      upi_id: savedSettings.upi_id || ''
    };
    let baselineExtraJson = JSON.stringify(extraBillingFields);
    let activeTab = app.state.custTab || 'appearance';

    function isDirty() {
      return JSON.stringify(draft) !== baselineJson || JSON.stringify(extraBillingFields) !== baselineExtraJson;
    }

    function syncDirtyState() {
      const dirty = isDirty();
      app.hasUnsavedChanges = dirty;
      app.onDiscardUnsaved = () => {
        app.applySettings(savedSettings);
      };
      const badge = document.getElementById('custUnsavedBadge');
      const saveBtn = document.getElementById('custSaveBtn');
      const discardBtn = document.getElementById('custDiscardBtn');
      if (badge) badge.classList.toggle('hidden', !dirty);
      if (saveBtn) saveBtn.disabled = !canEdit || !dirty;
      if (discardBtn) discardBtn.classList.toggle('hidden', !dirty);
    }

    function applyLivePreview() {
      syncDirtyState();
      app.applySettings({
        ...savedSettings,
        restaurant_name: draft.branding.restaurantName || savedSettings.restaurant_name,
        tagline: draft.branding.tagline ?? savedSettings.tagline,
        brand_initials: draft.branding.initials ?? savedSettings.brand_initials,
        logo_url: draft.branding.logoUrl ?? savedSettings.logo_url,
        currency_code: draft.advanced.currencyCode,
        currency_symbol: draft.advanced.currencySymbol,
        timezone: draft.advanced.timezone,
        date_format: draft.advanced.dateFormat,
        theme_mode: draft.appearance.themeMode === 'light' ? 'light' : 'dark',
        accent_color: draft.appearance.accentColor,
        pos_density: draft.appearance.spacing === 'compact' ? 'compact' : 'comfortable',
        thermal_width: ['58mm', '80mm'].includes(draft.billing.paperSize) ? draft.billing.paperSize : savedSettings.thermal_width,
        invoice_prefix: extraBillingFields.invoice_prefix,
        invoice_start_number: extraBillingFields.invoice_start_number,
        kot_prefix: extraBillingFields.kot_prefix,
        upi_id: extraBillingFields.upi_id,
        customization: draft
      });
      renderPreviewPane();
    }

    function renderPreviewPane() {
      const pane = document.getElementById('custLivePreview');
      if (!pane) return;
      const sym = draft.advanced.currencySymbol || '₹';
      const restName = draft.branding.restaurantName || savedSettings.restaurant_name || 'Your Restaurant';
      const bill = draft.billing;

      if (activeTab === 'billing') {
        pane.innerHTML = `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Live Invoice &amp; Print Preview</h3>
              <span class="pill pill-blue">${esc(bill.paperSize)} • ${esc(bill.template.toUpperCase())}</span>
            </div>
            <div style="background:#fff;color:#111;padding:14px;border-radius:10px;font-family:${bill.template === 'classic' ? 'Georgia,serif' : "'Courier New',monospace"};font-size:${bill.template === 'compact' ? '10.5px' : '11.5px'};max-width:${bill.paperSize === '58mm' ? '230px' : bill.paperSize === '80mm' ? '310px' : '100%'};margin:0 auto;border:1px solid #cbd5e1">
              <div style="text-align:${bill.logoPlacement === 'left' ? 'left' : 'center'}">
                ${draft.branding.showReceiptLogo && bill.logoPlacement !== 'hidden' && draft.branding.logoUrl
                  ? `<img src="${esc(draft.branding.logoUrl)}" alt="Logo" style="max-height:38px;margin-bottom:4px"><br>`
                  : ''}
                <strong style="font-size:14px">${esc(restName)}</strong><br>
                ${bill.header ? `<span>${esc(bill.header)}</span><br>` : ''}
                ${draft.branding.tagline ? `<span style="opacity:0.75">${esc(draft.branding.tagline)}</span><br>` : ''}
                ${bill.showGstin && draft.businessRules.gstin ? `<span>GSTIN: ${esc(draft.businessRules.gstin)}</span><br>` : ''}
              </div>
              <hr style="margin:8px 0;border:none;border-top:1px dashed #666">
              <div><strong>Invoice #:</strong> ${esc(extraBillingFields.invoice_prefix)}-${String(extraBillingFields.invoice_start_number).padStart(4, '0')}</div>
              ${bill.showTableInfo ? '<div>Table: Layout Sample • DINE_IN</div>' : ''}
              ${bill.showCustomerInfo ? '<div>Guest: Customer Name</div>' : ''}
              <hr style="margin:8px 0;border:none;border-top:1px dashed #666">
              <div style="display:flex;justify-content:space-between"><span>Sample Item x 1 ${bill.showItemGst ? '[5%]' : ''}</span><span>${sym}100.00</span></div>
              <hr style="margin:8px 0;border:none;border-top:1px dashed #666">
              ${bill.showTaxBreakdown ? `
                <div style="display:flex;justify-content:space-between"><span>CGST + SGST</span><span>${sym}5.00</span></div>
              ` : ''}
              <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:4px"><span>TOTAL</span><span>${sym}105.00</span></div>
              ${bill.paymentInstructions ? `<div style="margin-top:8px;font-size:10px;text-align:center">${esc(bill.paymentInstructions)}</div>` : ''}
              <div style="margin-top:8px;text-align:center;font-size:10px;opacity:0.8">
                ${esc(bill.footer || 'Thank you for dining with us!')}
                ${draft.branding.receiptBrandFooter ? `<br>${esc(draft.branding.receiptBrandFooter)}` : ''}
                <br>Powered by GRES
              </div>
            </div>
          </div>`;
        return;
      }

      if (activeTab === 'branding') {
        pane.innerHTML = `
          <div class="card">
            <div class="card-header"><h3 class="card-title">Live Login &amp; Dashboard Branding</h3></div>
            <div style="border:1px solid var(--border-strong);border-radius:12px;overflow:hidden;background:var(--bg)">
              ${draft.branding.coverUrl ? `<div style="height:86px;background:url('${esc(draft.branding.coverUrl)}') center/cover"></div>` : ''}
              <div style="padding:14px;display:flex;align-items:center;gap:12px">
                <div class="brand-badge sm">${draft.branding.logoUrl ? `<img src="${esc(draft.branding.logoUrl)}" alt="Logo">` : esc(draft.branding.initials || restName.slice(0, 2).toUpperCase())}</div>
                <div>
                  <strong>${esc(restName)}</strong>
                  <div class="muted" style="font-size:11.5px">${esc(draft.branding.tagline || 'Run Your Restaurant Smarter.')}</div>
                </div>
              </div>
              <div style="padding:0 14px 14px;font-size:11.5px" class="muted">
                <div>Login Headline: <strong>${esc(draft.branding.loginTitle || 'Default GRES Showcase')}</strong></div>
                <div>Greeting: <strong>${esc(draft.branding.dashboardGreeting || 'Standard Workspace Header')}</strong></div>
              </div>
            </div>
          </div>`;
        return;
      }

      if (activeTab === 'pos') {
        const p = draft.pos;
        pane.innerHTML = `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Live POS Layout Preview</h3>
              <span class="pill pill-orange">${esc(p.layout.toUpperCase())} • ${esc(p.cardSize.toUpperCase())}</span>
            </div>
            <div class="menu-grid ${p.layout === 'list' ? 'list-view' : ''} card-${esc(p.cardSize)}">
              <div class="menu-tile" style="pointer-events:none">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  ${p.showImages ? '<div class="dish-avatar">PT</div>' : ''}
                  ${p.showGstBadge ? '<span class="mono muted" style="font-size:10px">GST 5%</span>' : ''}
                </div>
                <strong>Dish Card Layout</strong>
                ${p.showStation ? '<span class="muted" style="font-size:11px">Main Kitchen</span>' : ''}
                ${p.showSku ? '<span class="mono muted" style="font-size:10px">SKU-SAMPLE</span>' : ''}
                <div class="menu-tile-price">${sym}250.00</div>
              </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
              ${p.quickActions.map((qa) => `<span class="pill pill-blue">${esc(qa.toUpperCase())}</span>`).join('')}
            </div>
          </div>`;
        return;
      }

      pane.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Live UI Preview</h3>
            <span class="pill pill-orange">${esc(draft.appearance.themeMode.toUpperCase())}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="kpi-card" style="padding:14px">
              <span class="kpi-label">SAMPLE KPI CARD (${esc(draft.appearance.cardStyle.toUpperCase())})</span>
              <div class="kpi-value" style="font-size:22px">${formatINR(12500, sym)}</div>
              <span class="kpi-sub">Radius ${draft.appearance.cardRadius}px • ${esc(draft.appearance.fontFamily)}</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm">Primary Button</button>
              <button type="button" class="btn btn-secondary btn-sm">Secondary</button>
              <span class="pill pill-green" style="border-color:${esc(draft.tables.statusColors.available)}">Available</span>
              <span class="pill pill-orange" style="border-color:${esc(draft.tables.statusColors.occupied)}">Occupied</span>
            </div>
            <div class="muted" style="font-size:11.5px">
              Changes reflect live across the workspace chrome. Click <strong>Save Changes</strong> to persist to the database.
            </div>
          </div>
        </div>`;
    }

    function renderActiveTab() {
      const container = document.getElementById('custTabBody');
      if (!container) return;

      document.querySelectorAll('[data-cust-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.custTab === activeTab);
      });

      if (activeTab === 'appearance') {
        const a = draft.appearance;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">1. Appearance &amp; Theme Studio</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Appearance</button>
            </div>
            <div class="onb-grid-3">
              <label class="field-label">Theme Mode
                <select id="apTheme" class="select">
                  <option value="dark" ${a.themeMode === 'dark' ? 'selected' : ''}>Dark Mode</option>
                  <option value="light" ${a.themeMode === 'light' ? 'selected' : ''}>Light Mode</option>
                  <option value="system" ${a.themeMode === 'system' ? 'selected' : ''}>System Preference</option>
                </select>
              </label>
              <label class="field-label">Primary Accent
                <input id="apAccent" type="color" class="input" style="height:38px;padding:3px" value="${esc(a.accentColor)}">
              </label>
              <label class="field-label">Secondary Highlight
                <input id="apSecondary" type="color" class="input" style="height:38px;padding:3px" value="${esc(a.secondaryColor)}">
              </label>
            </div>

            <div class="onb-grid-2">
              <div style="display:flex;gap:8px;align-items:end">
                <label class="field-label" style="flex:1">Custom Background Color (optional)
                  <input id="apBgColor" type="color" class="input" style="height:38px;padding:3px" value="${esc(a.bgColor || '#07080d')}">
                </label>
                <button type="button" class="btn btn-xs btn-ghost" id="apClearBg">Auto</button>
              </div>
              <div style="display:flex;gap:8px;align-items:end">
                <label class="field-label" style="flex:1">Custom Card Surface (optional)
                  <input id="apCardColor" type="color" class="input" style="height:38px;padding:3px" value="${esc(a.cardBgColor || '#121621')}">
                </label>
                <button type="button" class="btn btn-xs btn-ghost" id="apClearCard">Auto</button>
              </div>
            </div>

            <div class="onb-grid-3">
              <label class="field-label">Body Font
                <select id="apFont" class="select">
                  ${FONTS.map((f) => `<option value="${esc(f)}" ${a.fontFamily === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
                </select>
              </label>
              <label class="field-label">Display / Heading Font
                <select id="apDisplayFont" class="select">
                  ${FONTS.map((f) => `<option value="${esc(f)}" ${a.displayFont === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
                </select>
              </label>
              <label class="field-label">Base Font Size
                <select id="apFontSize" class="select">
                  <option value="12" ${String(a.fontSize) === '12' ? 'selected' : ''}>Compact (12px)</option>
                  <option value="13.5" ${String(a.fontSize) === '13.5' ? 'selected' : ''}>Default (13.5px)</option>
                  <option value="15" ${String(a.fontSize) === '15' ? 'selected' : ''}>Large (15px)</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-3">
              <label class="field-label">UI Spacing Density
                <select id="apSpacing" class="select">
                  <option value="compact" ${a.spacing === 'compact' ? 'selected' : ''}>Compact</option>
                  <option value="comfortable" ${a.spacing === 'comfortable' ? 'selected' : ''}>Comfortable</option>
                  <option value="spacious" ${a.spacing === 'spacious' ? 'selected' : ''}>Spacious</option>
                </select>
              </label>
              <label class="field-label">Card Style
                <select id="apCardStyle" class="select">
                  <option value="glass" ${a.cardStyle === 'glass' ? 'selected' : ''}>Glassmorphic</option>
                  <option value="solid" ${a.cardStyle === 'solid' ? 'selected' : ''}>Solid Flat</option>
                  <option value="bordered" ${a.cardStyle === 'bordered' ? 'selected' : ''}>Crisp Bordered</option>
                  <option value="elevated" ${a.cardStyle === 'elevated' ? 'selected' : ''}>Elevated Shadow</option>
                </select>
              </label>
              <label class="field-label">Card Corner Radius (<span id="apRadVal">${a.cardRadius}</span>px)
                <input id="apRadius" type="range" min="4" max="24" step="2" value="${a.cardRadius}">
              </label>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">Button Style
                <select id="apBtnStyle" class="select">
                  <option value="rounded" ${a.buttonStyle === 'rounded' ? 'selected' : ''}>Rounded</option>
                  <option value="pill" ${a.buttonStyle === 'pill' ? 'selected' : ''}>Pill</option>
                  <option value="sharp" ${a.buttonStyle === 'sharp' ? 'selected' : ''}>Sharp</option>
                </select>
              </label>
              <label class="field-label">Sidebar Style
                <select id="apSideStyle" class="select">
                  <option value="default" ${a.sidebarStyle === 'default' ? 'selected' : ''}>Standard</option>
                  <option value="compact" ${a.sidebarStyle === 'compact' ? 'selected' : ''}>Compact</option>
                  <option value="accent" ${a.sidebarStyle === 'accent' ? 'selected' : ''}>Accent Tint</option>
                </select>
              </label>
              <label class="field-label">Sidebar Side
                <select id="apSidePos" class="select">
                  <option value="left" ${a.sidebarPosition === 'left' ? 'selected' : ''}>Left</option>
                  <option value="right" ${a.sidebarPosition === 'right' ? 'selected' : ''}>Right</option>
                </select>
              </label>
              <label class="field-label">Animations
                <select id="apAnim" class="select">
                  <option value="1" ${a.animations !== false ? 'selected' : ''}>Enabled</option>
                  <option value="0" ${a.animations === false ? 'selected' : ''}>Reduced / Off</option>
                </select>
              </label>
            </div>
          </div>`;

        const bind = (id, fn) => document.getElementById(id)?.addEventListener('input', () => { fn(); applyLivePreview(); });
        bind('apTheme', () => { a.themeMode = document.getElementById('apTheme').value; });
        bind('apAccent', () => { a.accentColor = document.getElementById('apAccent').value; });
        bind('apSecondary', () => { a.secondaryColor = document.getElementById('apSecondary').value; });
        bind('apBgColor', () => { a.bgColor = document.getElementById('apBgColor').value; });
        bind('apCardColor', () => { a.cardBgColor = document.getElementById('apCardColor').value; });
        bind('apFont', () => { a.fontFamily = document.getElementById('apFont').value; });
        bind('apDisplayFont', () => { a.displayFont = document.getElementById('apDisplayFont').value; });
        bind('apFontSize', () => { a.fontSize = document.getElementById('apFontSize').value; });
        bind('apSpacing', () => { a.spacing = document.getElementById('apSpacing').value; });
        bind('apCardStyle', () => { a.cardStyle = document.getElementById('apCardStyle').value; });
        bind('apRadius', () => {
          a.cardRadius = Number(document.getElementById('apRadius').value);
          document.getElementById('apRadVal').textContent = a.cardRadius;
        });
        bind('apBtnStyle', () => { a.buttonStyle = document.getElementById('apBtnStyle').value; });
        bind('apSideStyle', () => { a.sidebarStyle = document.getElementById('apSideStyle').value; });
        bind('apSidePos', () => { a.sidebarPosition = document.getElementById('apSidePos').value; });
        bind('apAnim', () => { a.animations = document.getElementById('apAnim').value === '1'; });
        document.getElementById('apClearBg').onclick = () => { a.bgColor = ''; applyLivePreview(); };
        document.getElementById('apClearCard').onclick = () => { a.cardBgColor = ''; applyLivePreview(); };
      }

      if (activeTab === 'branding') {
        const b = draft.branding;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">2. Restaurant Identity &amp; Surface Branding</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Branding</button>
            </div>
            <div class="onb-grid-3">
              <label class="field-label">Restaurant Name <input id="brName" class="input" value="${esc(b.restaurantName)}"></label>
              <label class="field-label">Tagline <input id="brTag" class="input" value="${esc(b.tagline)}"></label>
              <label class="field-label">Monogram (1-3) <input id="brInit" maxlength="3" class="input mono" value="${esc(b.initials)}"></label>
            </div>

            <div class="onb-grid-3">
              <div>
                <label class="field-label">Logo URL / Data <input id="brLogo" class="input" value="${esc(b.logoUrl)}"></label>
                <label class="btn btn-xs btn-secondary" style="margin-top:6px;cursor:pointer">Upload Logo <input type="file" id="brLogoFile" accept="image/*" style="display:none"></label>
              </div>
              <div>
                <label class="field-label">Cover Banner URL <input id="brCover" class="input" value="${esc(b.coverUrl)}"></label>
                <label class="btn btn-xs btn-secondary" style="margin-top:6px;cursor:pointer">Upload Cover <input type="file" id="brCoverFile" accept="image/*" style="display:none"></label>
              </div>
              <div>
                <label class="field-label">Favicon URL <input id="brFavicon" class="input" value="${esc(b.faviconUrl)}"></label>
                <label class="btn btn-xs btn-secondary" style="margin-top:6px;cursor:pointer">Upload Favicon <input type="file" id="brFavFile" accept="image/*" style="display:none"></label>
              </div>
            </div>

            <div class="onb-grid-2">
              <label class="field-label">Login Screen Custom Title <input id="brLoginTitle" class="input" placeholder="Welcome to..." value="${esc(b.loginTitle)}"></label>
              <label class="field-label">Login Screen Subtitle <input id="brLoginSub" class="input" placeholder="Sign in to access your terminal" value="${esc(b.loginSubtitle)}"></label>
            </div>

            <div class="onb-grid-2">
              <label class="field-label">Dashboard Welcome Greeting <input id="brDashGreet" class="input" placeholder="Shown on Dashboard banner" value="${esc(b.dashboardGreeting)}"></label>
              <label class="field-label">Receipt Brand Footer Note <input id="brRecBrand" class="input" placeholder="Website / Instagram / Social" value="${esc(b.receiptBrandFooter)}"></label>
            </div>

            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="brShowLogin" ${b.showOnLogin !== false ? 'checked' : ''}> Show branding on Login screen</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="brShowDash" ${b.showDashboardBanner !== false ? 'checked' : ''}> Show branding banner on Dashboard</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="brShowRecLogo" ${b.showReceiptLogo !== false ? 'checked' : ''}> Print logo on Invoices &amp; Receipts</label>
            </div>
          </div>`;

        const bindTxt = (id, key) => document.getElementById(id)?.addEventListener('input', () => {
          b[key] = document.getElementById(id).value;
          applyLivePreview();
        });
        bindTxt('brName', 'restaurantName');
        bindTxt('brTag', 'tagline');
        bindTxt('brInit', 'initials');
        bindTxt('brLogo', 'logoUrl');
        bindTxt('brCover', 'coverUrl');
        bindTxt('brFavicon', 'faviconUrl');
        bindTxt('brLoginTitle', 'loginTitle');
        bindTxt('brLoginSub', 'loginSubtitle');
        bindTxt('brDashGreet', 'dashboardGreeting');
        bindTxt('brRecBrand', 'receiptBrandFooter');
        document.getElementById('brShowLogin').onchange = (e) => { b.showOnLogin = e.target.checked; applyLivePreview(); };
        document.getElementById('brShowDash').onchange = (e) => { b.showDashboardBanner = e.target.checked; applyLivePreview(); };
        document.getElementById('brShowRecLogo').onchange = (e) => { b.showReceiptLogo = e.target.checked; applyLivePreview(); };

        const bindUpload = (fileId, inputId, key, maxDim) => {
          document.getElementById(fileId)?.addEventListener('change', async (ev) => {
            const f = ev.target.files?.[0];
            if (!f) return;
            try {
              const url = await compressImageFile(f, maxDim);
              document.getElementById(inputId).value = url;
              b[key] = url;
              applyLivePreview();
              toast('Image loaded into preview', 'success');
            } catch (err) { toast(err.message, 'error'); }
          });
        };
        bindUpload('brLogoFile', 'brLogo', 'logoUrl', 240);
        bindUpload('brCoverFile', 'brCover', 'coverUrl', 640);
        bindUpload('brFavFile', 'brFavicon', 'faviconUrl', 96);
      }

      if (activeTab === 'dashboard') {
        const d = draft.dashboard;
        const kpiOptions = [
          ['revenue', 'Total Revenue (Branch)'],
          ['aov', 'Average Order Value'],
          ['occupancy', 'Live Floor Occupancy'],
          ['low_stock', 'Low Stock Alerts'],
          ['today_orders', "Today's Orders Count"],
          ['gst_collected', 'Total GST Collected']
        ];
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">3. Dashboard Widgets &amp; KPI Customization</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Dashboard</button>
            </div>
            <div>
              <span class="field-label" style="display:block;margin-bottom:6px">Visible KPI Metric Cards</span>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px">
                ${kpiOptions.map(([kid, label]) => `
                  <label style="display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer">
                    <input type="checkbox" class="kpi-opt-cb" value="${kid}" ${(d.visibleKpis || []).includes(kid) ? 'checked' : ''}>
                    <span>${esc(label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:12px">
              <span class="field-label" style="display:block;margin-bottom:6px">Drag &amp; Drop Widgets (Reorder, Show/Hide &amp; Resize)</span>
              <div id="widgetDragList" style="display:flex;flex-direction:column;gap:8px">
                ${d.widgets.map((w, idx) => `
                  <div class="widget-drag-row" draggable="true" data-widx="${idx}">
                    <div style="display:flex;align-items:center;gap:10px">
                      <span class="mono muted">⋮⋮</span>
                      <input type="checkbox" class="w-vis-cb" data-widx="${idx}" ${w.visible ? 'checked' : ''}>
                      <strong>${esc(w.title)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <select class="select-sm w-size-sel" data-widx="${idx}" style="width:110px">
                        <option value="half" ${w.size === 'half' ? 'selected' : ''}>Half Width</option>
                        <option value="full" ${w.size === 'full' ? 'selected' : ''}>Full Width</option>
                      </select>
                      <button type="button" class="btn btn-xs btn-ghost w-up" data-widx="${idx}">↑</button>
                      <button type="button" class="btn btn-xs btn-ghost w-dn" data-widx="${idx}">↓</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>`;

        container.querySelectorAll('.kpi-opt-cb').forEach((cb) => {
          cb.onchange = () => {
            d.visibleKpis = Array.from(container.querySelectorAll('.kpi-opt-cb:checked')).map((x) => x.value);
            applyLivePreview();
          };
        });

        let dragIdx = null;
        container.querySelectorAll('.widget-drag-row').forEach((row) => {
          row.ondragstart = () => { dragIdx = Number(row.dataset.widx); row.classList.add('dragging'); };
          row.ondragend = () => { row.classList.remove('dragging'); };
          row.ondragover = (e) => e.preventDefault();
          row.ondrop = () => {
            const dropIdx = Number(row.dataset.widx);
            if (dragIdx === null || dragIdx === dropIdx) return;
            const [moved] = d.widgets.splice(dragIdx, 1);
            d.widgets.splice(dropIdx, 0, moved);
            d.widgets.forEach((w, i) => { w.order = i; });
            dragIdx = null;
            applyLivePreview();
            renderActiveTab();
          };
        });
        container.querySelectorAll('.w-vis-cb').forEach((cb) => {
          cb.onchange = () => { d.widgets[Number(cb.dataset.widx)].visible = cb.checked; applyLivePreview(); };
        });
        container.querySelectorAll('.w-size-sel').forEach((sel) => {
          sel.onchange = () => { d.widgets[Number(sel.dataset.widx)].size = sel.value; applyLivePreview(); };
        });
        container.querySelectorAll('.w-up').forEach((btn) => {
          btn.onclick = () => {
            const i = Number(btn.dataset.widx);
            if (i <= 0) return;
            [d.widgets[i - 1], d.widgets[i]] = [d.widgets[i], d.widgets[i - 1]];
            d.widgets.forEach((w, idx) => { w.order = idx; });
            applyLivePreview();
            renderActiveTab();
          };
        });
        container.querySelectorAll('.w-dn').forEach((btn) => {
          btn.onclick = () => {
            const i = Number(btn.dataset.widx);
            if (i >= d.widgets.length - 1) return;
            [d.widgets[i + 1], d.widgets[i]] = [d.widgets[i], d.widgets[i + 1]];
            d.widgets.forEach((w, idx) => { w.order = idx; });
            applyLivePreview();
            renderActiveTab();
          };
        });
      }

      if (activeTab === 'pos') {
        const p = draft.pos;
        const qaOpts = [
          ['hold', 'Hold / Resume Order'],
          ['discount', 'Discount & SC Bar'],
          ['kot_print', 'Print KOT Button'],
          ['settle', 'Settle Bill Action']
        ];
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">4. POS Terminal Layout &amp; Shortcuts</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset POS</button>
            </div>
            <div class="onb-grid-4">
              <label class="field-label">Catalog Layout
                <select id="posLayout" class="select">
                  <option value="grid" ${p.layout === 'grid' ? 'selected' : ''}>Visual Grid</option>
                  <option value="list" ${p.layout === 'list' ? 'selected' : ''}>Compact List</option>
                </select>
              </label>
              <label class="field-label">Grid Columns
                <select id="posCols" class="select">
                  <option value="auto" ${p.columns === 'auto' ? 'selected' : ''}>Auto Responsive</option>
                  <option value="3" ${String(p.columns) === '3' ? 'selected' : ''}>3 Columns</option>
                  <option value="4" ${String(p.columns) === '4' ? 'selected' : ''}>4 Columns</option>
                  <option value="5" ${String(p.columns) === '5' ? 'selected' : ''}>5 Columns</option>
                </select>
              </label>
              <label class="field-label">Product Card Size
                <select id="posCardSize" class="select">
                  <option value="small" ${p.cardSize === 'small' ? 'selected' : ''}>Small</option>
                  <option value="medium" ${p.cardSize === 'medium' ? 'selected' : ''}>Medium</option>
                  <option value="large" ${p.cardSize === 'large' ? 'selected' : ''}>Large</option>
                </select>
              </label>
              <label class="field-label">Button Size
                <select id="posBtnSize" class="select">
                  <option value="sm" ${p.buttonSize === 'sm' ? 'selected' : ''}>Compact</option>
                  <option value="md" ${p.buttonSize === 'md' ? 'selected' : ''}>Standard</option>
                  <option value="lg" ${p.buttonSize === 'lg' ? 'selected' : ''}>Touch Large</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-2">
              <label class="field-label">Category Navigation Position
                <select id="posCatPos" class="select">
                  <option value="top" ${p.categoryPosition === 'top' ? 'selected' : ''}>Top Pill Bar</option>
                  <option value="left" ${p.categoryPosition === 'left' ? 'selected' : ''}>Left Category Rail</option>
                </select>
              </label>
              <label class="field-label">Keyboard Shortcuts
                <select id="posKeysEn" class="select">
                  <option value="1" ${p.shortcutsEnabled !== false ? 'selected' : ''}>Enabled</option>
                  <option value="0" ${p.shortcutsEnabled === false ? 'selected' : ''}>Disabled</option>
                </select>
              </label>
            </div>

            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="posImg" ${p.showImages !== false ? 'checked' : ''}> Show Dish Photos</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="posGst" ${p.showGstBadge !== false ? 'checked' : ''}> Show GST Badge</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="posSta" ${p.showStation !== false ? 'checked' : ''}> Show Kitchen Station</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="posSku" ${p.showSku ? 'checked' : ''}> Show SKU Code</label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Enabled Quick Actions</span>
              <div style="display:flex;gap:12px;flex-wrap:wrap">
                ${qaOpts.map(([k, lbl]) => `
                  <label style="display:flex;align-items:center;gap:6px">
                    <input type="checkbox" class="pos-qa-cb" value="${k}" ${(p.quickActions || []).includes(k) ? 'checked' : ''}> ${esc(lbl)}
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="onb-grid-4" style="border-top:1px solid var(--border);padding-top:10px">
              <label class="field-label">Search Key <input id="ksSearch" class="input mono" value="${esc(p.shortcuts.search)}"></label>
              <label class="field-label">Fire KOT Key <input id="ksFire" class="input mono" value="${esc(p.shortcuts.fireKot)}"></label>
              <label class="field-label">Settle Key <input id="ksSettle" class="input mono" value="${esc(p.shortcuts.settle)}"></label>
              <label class="field-label">Hold Order Key <input id="ksHold" class="input mono" value="${esc(p.shortcuts.hold)}"></label>
            </div>
          </div>`;

        const bindSel = (id, fn) => document.getElementById(id)?.addEventListener('change', () => { fn(); applyLivePreview(); });
        bindSel('posLayout', () => { p.layout = document.getElementById('posLayout').value; });
        bindSel('posCols', () => { p.columns = document.getElementById('posCols').value; });
        bindSel('posCardSize', () => { p.cardSize = document.getElementById('posCardSize').value; });
        bindSel('posBtnSize', () => { p.buttonSize = document.getElementById('posBtnSize').value; });
        bindSel('posCatPos', () => { p.categoryPosition = document.getElementById('posCatPos').value; });
        bindSel('posKeysEn', () => { p.shortcutsEnabled = document.getElementById('posKeysEn').value === '1'; });
        document.getElementById('posImg').onchange = (e) => { p.showImages = e.target.checked; applyLivePreview(); };
        document.getElementById('posGst').onchange = (e) => { p.showGstBadge = e.target.checked; applyLivePreview(); };
        document.getElementById('posSta').onchange = (e) => { p.showStation = e.target.checked; applyLivePreview(); };
        document.getElementById('posSku').onchange = (e) => { p.showSku = e.target.checked; applyLivePreview(); };
        container.querySelectorAll('.pos-qa-cb').forEach((cb) => {
          cb.onchange = () => {
            p.quickActions = Array.from(container.querySelectorAll('.pos-qa-cb:checked')).map((x) => x.value);
            applyLivePreview();
          };
        });
        ['ksSearch:search', 'ksFire:fireKot', 'ksSettle:settle', 'ksHold:hold'].forEach((pair) => {
          const [id, key] = pair.split(':');
          document.getElementById(id)?.addEventListener('input', (e) => { p.shortcuts[key] = e.target.value; applyLivePreview(); });
        });
      }

      if (activeTab === 'tables') {
        const t = draft.tables;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">5. Tables, Floors &amp; Visual Canvas Settings</h3>
              <div style="display:flex;gap:8px">
                <button type="button" class="btn btn-xs btn-secondary" id="openFloorDesignerBtn">Open Drag/Drop Floor Plan →</button>
                <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Table Styles</button>
              </div>
            </div>
            <div class="onb-grid-4">
              <label class="field-label">Available Color <input id="tbColAvail" type="color" class="input" style="height:36px;padding:3px" value="${esc(t.statusColors.available)}"></label>
              <label class="field-label">Occupied Color <input id="tbColOcc" type="color" class="input" style="height:36px;padding:3px" value="${esc(t.statusColors.occupied)}"></label>
              <label class="field-label">Reserved Color <input id="tbColRes" type="color" class="input" style="height:36px;padding:3px" value="${esc(t.statusColors.reserved)}"></label>
              <label class="field-label">Merged Color <input id="tbColMrg" type="color" class="input" style="height:36px;padding:3px" value="${esc(t.statusColors.merged)}"></label>
            </div>
            <div class="onb-grid-3">
              <label class="field-label">Default Shape
                <select id="tbShape" class="select">
                  <option value="square" ${t.defaultShape === 'square' ? 'selected' : ''}>Square</option>
                  <option value="round" ${t.defaultShape === 'round' ? 'selected' : ''}>Round</option>
                  <option value="rect" ${t.defaultShape === 'rect' ? 'selected' : ''}>Rectangle</option>
                </select>
              </label>
              <label class="field-label">Default Seats <input id="tbSeats" type="number" min="1" class="input" value="${t.defaultSeats}"></label>
              <label class="field-label">Canvas Snap Grid (px) <input id="tbSnap" type="number" min="1" max="40" class="input" value="${t.gridSnap}"></label>
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tbPips" ${t.showSeatPips !== false ? 'checked' : ''}> Show Seat Dots</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tbZone" ${t.showZoneLabel !== false ? 'checked' : ''}> Show Floor / Section Label</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tbAmt" ${t.showAmountOnTable !== false ? 'checked' : ''}> Show Running Bill on Table</label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:12px">
              <span class="field-label" style="display:block;margin-bottom:6px">Database Floors &amp; Sections (${floors.length})</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                ${floors.map((fl) => `
                  <span class="pill pill-blue" style="gap:6px">
                    <strong>${esc(fl.name)}</strong> (${(fl.sections || []).map(esc).join(', ') || 'No sections'})
                    ${canEdit ? `<button type="button" class="btn btn-xs btn-ghost" data-cust-del-floor="${fl.id}">✕</button>` : ''}
                  </span>
                `).join('') || '<span class="muted" style="font-size:12px">No floors defined yet.</span>'}
              </div>
              ${canEdit ? `
                <div style="display:grid;grid-template-columns:1fr 1.2fr auto;gap:8px">
                  <input id="custFlName" class="input" placeholder="Floor (e.g. Rooftop)">
                  <input id="custFlSecs" class="input" placeholder="Sections (Lounge, Patio)">
                  <button type="button" class="btn btn-sm btn-secondary" id="custAddFloorBtn">+ Add Floor</button>
                </div>
              ` : ''}
            </div>

            <div style="border-top:1px solid var(--border);padding-top:12px">
              <span class="field-label" style="display:block;margin-bottom:6px">Table Visual Overrides (${tables.length} Tables)</span>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
                ${tables.map((tb) => `
                  <div style="display:grid;grid-template-columns:1fr 1fr 0.7fr auto auto;gap:6px;align-items:center">
                    <span class="mono"><strong>${esc(tb.name)}</strong> <small class="muted">(${esc(tb.floor_name || '')})</small></span>
                    <input class="input" data-tbl-lbl="${tb.id}" placeholder="Custom Label" value="${esc(tb.label_override || '')}">
                    <select class="select" data-tbl-shape="${tb.id}">
                      <option value="square" ${tb.shape === 'square' ? 'selected' : ''}>Square</option>
                      <option value="round" ${tb.shape === 'round' ? 'selected' : ''}>Round</option>
                      <option value="rect" ${tb.shape === 'rect' ? 'selected' : ''}>Rect</option>
                    </select>
                    <input type="color" class="input" style="width:46px;height:34px;padding:2px" data-tbl-col="${tb.id}" value="${esc(tb.color || '#10b981')}">
                    <button type="button" class="btn btn-xs btn-secondary" data-tbl-save="${tb.id}">Apply</button>
                  </div>
                `).join('') || '<span class="muted" style="font-size:12px">No tables created yet. Add tables in the Floor Plan.</span>'}
              </div>
            </div>
          </div>`;

        document.getElementById('openFloorDesignerBtn').onclick = () => app.navigate('floor');
        ['tbColAvail:available', 'tbColOcc:occupied', 'tbColRes:reserved', 'tbColMrg:merged'].forEach((p) => {
          const [id, k] = p.split(':');
          document.getElementById(id)?.addEventListener('input', (e) => { t.statusColors[k] = e.target.value; applyLivePreview(); });
        });
        document.getElementById('tbShape').onchange = (e) => { t.defaultShape = e.target.value; applyLivePreview(); };
        document.getElementById('tbSeats').oninput = (e) => { t.defaultSeats = Number(e.target.value || 4); applyLivePreview(); };
        document.getElementById('tbSnap').oninput = (e) => { t.gridSnap = Number(e.target.value || 10); applyLivePreview(); };
        document.getElementById('tbPips').onchange = (e) => { t.showSeatPips = e.target.checked; applyLivePreview(); };
        document.getElementById('tbZone').onchange = (e) => { t.showZoneLabel = e.target.checked; applyLivePreview(); };
        document.getElementById('tbAmt').onchange = (e) => { t.showAmountOnTable = e.target.checked; applyLivePreview(); };

        document.getElementById('custAddFloorBtn')?.addEventListener('click', async () => {
          const name = document.getElementById('custFlName').value.trim();
          if (!name) return toast('Enter floor name', 'error');
          const created = await post('/api/floors', {
            name,
            sections: document.getElementById('custFlSecs').value,
            sort_order: floors.length + 1
          });
          floors.push(created);
          toast('Floor created', 'success');
          renderActiveTab();
        });
        container.querySelectorAll('[data-cust-del-floor]').forEach((b) => {
          b.onclick = async () => {
            await del(`/api/floors/${b.dataset.custDelFloor}`);
            const idx = floors.findIndex((f) => f.id === Number(b.dataset.custDelFloor));
            if (idx >= 0) floors.splice(idx, 1);
            renderActiveTab();
          };
        });
        container.querySelectorAll('[data-tbl-save]').forEach((b) => {
          b.onclick = async () => {
            const tid = Number(b.dataset.tblSave);
            const upd = await put(`/api/tables/${tid}`, {
              label_override: document.querySelector(`[data-tbl-lbl="${tid}"]`).value.trim(),
              shape: document.querySelector(`[data-tbl-shape="${tid}"]`).value,
              color: document.querySelector(`[data-tbl-col="${tid}"]`).value
            });
            const idx = tables.findIndex((x) => x.id === tid);
            if (idx >= 0) tables[idx] = upd;
            toast(`Updated ${upd.name} on Floor Plan`, 'success');
          };
        });
      }

      if (activeTab === 'billing') {
        const b = draft.billing;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">6. Billing Templates, Invoices &amp; Paper Sizes</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Billing</button>
            </div>
            <div class="onb-grid-3">
              <label class="field-label">Invoice Template
                <select id="biTpl" class="select">
                  <option value="modern" ${b.template === 'modern' ? 'selected' : ''}>Modern Clean</option>
                  <option value="classic" ${b.template === 'classic' ? 'selected' : ''}>Classic Serif</option>
                  <option value="minimal" ${b.template === 'minimal' ? 'selected' : ''}>Minimalist</option>
                  <option value="compact" ${b.template === 'compact' ? 'selected' : ''}>Compact Express</option>
                </select>
              </label>
              <label class="field-label">Paper / Printer Format
                <select id="biPaper" class="select">
                  <option value="80mm" ${b.paperSize === '80mm' ? 'selected' : ''}>Thermal 80mm</option>
                  <option value="58mm" ${b.paperSize === '58mm' ? 'selected' : ''}>Thermal 58mm</option>
                  <option value="A4" ${b.paperSize === 'A4' ? 'selected' : ''}>A4 Sheet PDF/Print</option>
                  <option value="A5" ${b.paperSize === 'A5' ? 'selected' : ''}>A5 Half Sheet</option>
                </select>
              </label>
              <label class="field-label">Logo Placement
                <select id="biLogoPos" class="select">
                  <option value="center" ${b.logoPlacement === 'center' ? 'selected' : ''}>Centered Top</option>
                  <option value="left" ${b.logoPlacement === 'left' ? 'selected' : ''}>Left Aligned</option>
                  <option value="hidden" ${b.logoPlacement === 'hidden' ? 'selected' : ''}>Hide Logo</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">Invoice Prefix <input id="biPrefix" class="input mono" value="${esc(extraBillingFields.invoice_prefix)}"></label>
              <label class="field-label">Start Number <input id="biStartNum" type="number" min="1" class="input mono" value="${extraBillingFields.invoice_start_number}"></label>
              <label class="field-label">KOT Prefix <input id="biKotPref" class="input mono" value="${esc(extraBillingFields.kot_prefix)}"></label>
              <label class="field-label">UPI VPA ID <input id="biUpi" class="input mono" value="${esc(extraBillingFields.upi_id)}"></label>
            </div>

            <div class="onb-grid-2">
              <label class="field-label">Receipt Header Line <input id="biHdr" class="input" value="${esc(b.header)}" placeholder="e.g. TAX INVOICE / Original for Recipient"></label>
              <label class="field-label">Receipt Footer Message <input id="biFtr" class="input" value="${esc(b.footer)}" placeholder="Thank you for dining with us!"></label>
            </div>

            <label class="field-label">Payment Instructions (printed on Invoice/PDF)
              <input id="biPayInstr" class="input" value="${esc(b.paymentInstructions)}" placeholder="e.g. Scan UPI QR or pay at the counter">
            </label>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biTaxBk" ${b.showTaxBreakdown !== false ? 'checked' : ''}> Show Tax Breakdown on Bill</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biItemGst" ${b.showItemGst !== false ? 'checked' : ''}> Show Per-Item GST %</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biGstSum" ${b.showGstSummary !== false ? 'checked' : ''}> Show PDF GST Slab Summary</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biGstin" ${b.showGstin !== false ? 'checked' : ''}> Show GSTIN on Invoice</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biFssai" ${b.showFssai !== false ? 'checked' : ''}> Show FSSAI License</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biTbl" ${b.showTableInfo !== false ? 'checked' : ''}> Show Table / Order Type</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biCust" ${b.showCustomerInfo !== false ? 'checked' : ''}> Show Customer Details</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="biQr" ${b.upiQrOnInvoice !== false ? 'checked' : ''}> Show UPI Info on Invoice</label>
            </div>
          </div>`;

        ['biTpl:template', 'biPaper:paperSize', 'biLogoPos:logoPlacement'].forEach((p) => {
          const [id, key] = p.split(':');
          document.getElementById(id).onchange = (e) => { b[key] = e.target.value; applyLivePreview(); };
        });
        document.getElementById('biHdr').oninput = (e) => { b.header = e.target.value; applyLivePreview(); };
        document.getElementById('biFtr').oninput = (e) => { b.footer = e.target.value; applyLivePreview(); };
        document.getElementById('biPayInstr').oninput = (e) => { b.paymentInstructions = e.target.value; applyLivePreview(); };
        document.getElementById('biPrefix').oninput = (e) => { extraBillingFields.invoice_prefix = e.target.value; applyLivePreview(); };
        document.getElementById('biStartNum').oninput = (e) => { extraBillingFields.invoice_start_number = Math.max(1, Number(e.target.value || 1001)); applyLivePreview(); };
        document.getElementById('biKotPref').oninput = (e) => { extraBillingFields.kot_prefix = e.target.value; applyLivePreview(); };
        document.getElementById('biUpi').oninput = (e) => { extraBillingFields.upi_id = e.target.value; applyLivePreview(); };
        [
          ['biTaxBk', 'showTaxBreakdown'], ['biItemGst', 'showItemGst'], ['biGstSum', 'showGstSummary'],
          ['biGstin', 'showGstin'], ['biFssai', 'showFssai'], ['biTbl', 'showTableInfo'],
          ['biCust', 'showCustomerInfo'], ['biQr', 'upiQrOnInvoice']
        ].forEach(([id, key]) => {
          document.getElementById(id).onchange = (e) => { b[key] = e.target.checked; applyLivePreview(); };
        });
      }

      if (activeTab === 'menu') {
        const m = draft.menu;
        const parentCats = menuData.categories.filter((c) => !c.parent_id);
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">7. Menu Categories, Subcategories, Labels &amp; Pricing Rules</h3>
              <div style="display:flex;gap:8px">
                <button type="button" class="btn btn-xs btn-secondary" id="openMenuCatBtn">Full Menu Editor →</button>
                <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Menu Rules</button>
              </div>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">Default Dish GST % <input id="mnGst" type="number" step="0.5" class="input" value="${m.defaultGstRate}"></label>
              <label class="field-label">Default Prep (min) <input id="mnPrep" type="number" min="1" class="input" value="${m.defaultPrepMinutes}"></label>
              <label class="field-label">Takeaway Packaging Fee (${esc(draft.advanced.currencySymbol)}) <input id="mnPkg" type="number" min="0" step="1" class="input" value="${m.packagingCharge}"></label>
              <label class="field-label">Show Out-of-Stock Dishes
                <select id="mnOut" class="select">
                  <option value="1" ${m.showOutOfStock !== false ? 'selected' : ''}>Show Disabled</option>
                  <option value="0" ${m.showOutOfStock === false ? 'selected' : ''}>Hide from POS</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">Happy Hour Rules
                <select id="mnHhEn" class="select">
                  <option value="0" ${!m.happyHourEnabled ? 'selected' : ''}>Disabled</option>
                  <option value="1" ${m.happyHourEnabled ? 'selected' : ''}>Enabled</option>
                </select>
              </label>
              <label class="field-label">Happy Hour Disc % <input id="mnHhPct" type="number" min="0" max="100" class="input" value="${m.happyHourDiscountPct}"></label>
              <label class="field-label">Start Time <input id="mnHhStart" type="time" class="input" value="${esc(m.happyHourStart)}"></label>
              <label class="field-label">End Time <input id="mnHhEnd" type="time" class="input" value="${esc(m.happyHourEnd)}"></label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Custom Dish Badges &amp; Labels</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${(m.availableLabels || []).map((lbl, idx) => `
                  <span class="pill pill-orange" style="gap:5px">${esc(lbl)} <button type="button" class="btn btn-xs btn-ghost" data-del-lbl="${idx}">✕</button></span>
                `).join('')}
              </div>
              <div style="display:flex;gap:8px">
                <input id="mnNewLbl" class="input" placeholder="e.g. Signature, Sugar-Free">
                <button type="button" class="btn btn-sm btn-secondary" id="mnAddLblBtn">+ Add Label</button>
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Database Categories &amp; Subcategories (${menuData.categories.length})</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${menuData.categories.map((c) => {
                  const pCat = c.parent_id ? menuData.categories.find((p) => p.id === c.parent_id) : null;
                  return `<span class="pill pill-blue">${pCat ? `${esc(pCat.name)} → ` : ''}${esc(c.name)}${c.label ? ` [${esc(c.label)}]` : ''}</span>`;
                }).join('') || '<span class="muted" style="font-size:12px">No menu categories yet.</span>'}
              </div>
              ${canEdit ? `
                <div style="display:grid;grid-template-columns:1fr 1fr 0.8fr auto;gap:8px">
                  <input id="mnCatName" class="input" placeholder="Category / Subcategory name">
                  <select id="mnCatParent" class="select">
                    <option value="">Top-Level Category</option>
                    ${parentCats.map((pc) => `<option value="${pc.id}">Sub of: ${esc(pc.name)}</option>`).join('')}
                  </select>
                  <input id="mnCatLabel" class="input" placeholder="Badge (optional)">
                  <button type="button" class="btn btn-sm btn-secondary" id="mnAddCatBtn">+ Add</button>
                </div>
              ` : ''}
            </div>
          </div>`;

        document.getElementById('openMenuCatBtn').onclick = () => app.navigate('menu');
        document.getElementById('mnGst').oninput = (e) => { m.defaultGstRate = Number(e.target.value || 5); applyLivePreview(); };
        document.getElementById('mnPrep').oninput = (e) => { m.defaultPrepMinutes = Number(e.target.value || 12); applyLivePreview(); };
        document.getElementById('mnPkg').oninput = (e) => { m.packagingCharge = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('mnOut').onchange = (e) => { m.showOutOfStock = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('mnHhEn').onchange = (e) => { m.happyHourEnabled = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('mnHhPct').oninput = (e) => { m.happyHourDiscountPct = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('mnHhStart').oninput = (e) => { m.happyHourStart = e.target.value; applyLivePreview(); };
        document.getElementById('mnHhEnd').oninput = (e) => { m.happyHourEnd = e.target.value; applyLivePreview(); };
        document.getElementById('mnAddLblBtn').onclick = () => {
          const val = document.getElementById('mnNewLbl').value.trim();
          if (!val) return;
          m.availableLabels = Array.from(new Set([...(m.availableLabels || []), val]));
          applyLivePreview();
          renderActiveTab();
        };
        container.querySelectorAll('[data-del-lbl]').forEach((b) => {
          b.onclick = () => {
            m.availableLabels.splice(Number(b.dataset.delLbl), 1);
            applyLivePreview();
            renderActiveTab();
          };
        });
        document.getElementById('mnAddCatBtn')?.addEventListener('click', async () => {
          const name = document.getElementById('mnCatName').value.trim();
          if (!name) return toast('Enter category name', 'error');
          const created = await post('/api/menu/categories', {
            name,
            parent_id: document.getElementById('mnCatParent').value || null,
            label: document.getElementById('mnCatLabel').value.trim(),
            sort_order: menuData.categories.length + 1
          });
          menuData.categories.push(created);
          toast('Category added', 'success');
          renderActiveTab();
        });
      }

      if (activeTab === 'notifications') {
        const n = draft.notifications;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">8. Real-Time Alerts, Sounds &amp; Channels</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Alerts</button>
            </div>
            <div class="onb-grid-3">
              <label class="field-label">Audio Chimes
                <select id="noSound" class="select">
                  <option value="1" ${n.soundEnabled !== false ? 'selected' : ''}>Enabled</option>
                  <option value="0" ${n.soundEnabled === false ? 'selected' : ''}>Muted</option>
                </select>
              </label>
              <label class="field-label">Volume (<span id="noVolTxt">${Math.round((n.soundVolume ?? 0.7) * 100)}</span>%)
                <input id="noVol" type="range" min="0.1" max="1" step="0.1" value="${n.soundVolume ?? 0.7}">
              </label>
              <label class="field-label">Delayed Order Alert (Minutes)
                <input id="noDelayMins" type="number" min="1" class="input" value="${n.delayedOrderMinutes || 15}">
              </label>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" class="btn btn-sm btn-secondary" id="testChimeBtn">Test Alert Sound</button>
              <button type="button" class="btn btn-sm btn-ghost" id="reqBrowserPushBtn">Enable Browser Desktop Alerts</button>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Alert Channels</span>
              <div style="display:flex;gap:16px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chToast" ${n.channels.inAppToast !== false ? 'checked' : ''}> In-App Toasts</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chPush" ${n.channels.browserPush ? 'checked' : ''}> Browser Push Notifications</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="chKds" ${n.channels.kdsBanner !== false ? 'checked' : ''}> KDS SLA Banner Highlights</label>
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Event Subscriptions</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="evNewOrd" ${n.events.newOrder !== false ? 'checked' : ''}> New KOT / Order Alert</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="evKotReady" ${n.events.kotReady !== false ? 'checked' : ''}> Kitchen Item Ready Alert</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="evPay" ${n.events.paymentSettled !== false ? 'checked' : ''}> Payment Settled Confirmation</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="evStock" ${n.events.lowStock !== false ? 'checked' : ''}> Low Stock Warning</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="evDelay" ${n.events.delayedOrder !== false ? 'checked' : ''}> Delayed Order Alert</label>
              </div>
            </div>
          </div>`;

        document.getElementById('noSound').onchange = (e) => { n.soundEnabled = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('noVol').oninput = (e) => {
          n.soundVolume = Number(e.target.value);
          document.getElementById('noVolTxt').textContent = Math.round(n.soundVolume * 100);
          applyLivePreview();
        };
        document.getElementById('noDelayMins').oninput = (e) => { n.delayedOrderMinutes = Math.max(1, Number(e.target.value || 15)); applyLivePreview(); };
        document.getElementById('testChimeBtn').onclick = () => { playKdsChime(); toast('Sample alert chime triggered', 'info'); };
        document.getElementById('reqBrowserPushBtn').onclick = async () => {
          if (!('Notification' in window)) return toast('Browser Notifications unsupported here', 'error');
          const res = await Notification.requestPermission();
          n.channels.browserPush = res === 'granted';
          document.getElementById('chPush').checked = n.channels.browserPush;
          applyLivePreview();
          toast(`Desktop notifications: ${res}`, res === 'granted' ? 'success' : 'info');
        };
        document.getElementById('chToast').onchange = (e) => { n.channels.inAppToast = e.target.checked; applyLivePreview(); };
        document.getElementById('chPush').onchange = (e) => { n.channels.browserPush = e.target.checked; applyLivePreview(); };
        document.getElementById('chKds').onchange = (e) => { n.channels.kdsBanner = e.target.checked; applyLivePreview(); };
        document.getElementById('evNewOrd').onchange = (e) => { n.events.newOrder = e.target.checked; applyLivePreview(); };
        document.getElementById('evKotReady').onchange = (e) => { n.events.kotReady = e.target.checked; applyLivePreview(); };
        document.getElementById('evPay').onchange = (e) => { n.events.paymentSettled = e.target.checked; applyLivePreview(); };
        document.getElementById('evStock').onchange = (e) => { n.events.lowStock = e.target.checked; applyLivePreview(); };
        document.getElementById('evDelay').onchange = (e) => { n.events.delayedOrder = e.target.checked; applyLivePreview(); };
      }

      if (activeTab === 'staff') {
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">9. Custom Roles &amp; Granular Permissions (${roles.length} Custom Roles)</h3>
              <button type="button" class="btn btn-xs btn-secondary" id="openStaffPageBtn">Manage Staff Accounts →</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${roles.length === 0 ? '<div class="muted" style="font-size:12px">No custom role templates created yet. Create reusable permission templates below to assign to staff members.</div>' : roles.map((r) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:10px">
                  <div>
                    <span class="pill" style="border-color:${esc(r.color)}">${esc(r.name)}</span>
                    <span class="muted" style="font-size:12px;margin-left:8px">${esc(r.description || `${r.permissions.length} permissions`)}</span>
                  </div>
                  ${canEdit ? `<button type="button" class="btn btn-xs btn-danger" data-del-role="${r.id}">Delete</button>` : ''}
                </div>
              `).join('')}
            </div>

            ${canEdit ? `
              <form id="newRoleForm" style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:10px">
                <strong>Create Custom Role Template</strong>
                <div class="onb-grid-3">
                  <label class="field-label">Role Name <input id="crName" class="input" placeholder="e.g. Shift Lead" required></label>
                  <label class="field-label">Description <input id="crDesc" class="input" placeholder="Optional scope note"></label>
                  <label class="field-label">Badge Color <input id="crCol" type="color" class="input" style="height:38px;padding:3px" value="#38bdf8"></label>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;font-size:12px">
                  ${ALL_PERMS.map(([perm, label]) => `
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                      <input type="checkbox" class="cr-perm-cb" value="${perm}" ${perm.endsWith(':view') ? 'checked' : ''}> ${esc(label)}
                    </label>
                  `).join('')}
                </div>
                <button type="submit" class="btn btn-sm btn-primary" style="align-self:flex-start">+ Save Custom Role</button>
              </form>
            ` : ''}
          </div>`;

        document.getElementById('openStaffPageBtn').onclick = () => app.navigate('staff');
        container.querySelectorAll('[data-del-role]').forEach((b) => {
          b.onclick = async () => {
            await del(`/api/roles/${b.dataset.delRole}`);
            const idx = roles.findIndex((r) => r.id === Number(b.dataset.delRole));
            if (idx >= 0) roles.splice(idx, 1);
            toast('Custom role deleted', 'info');
            renderActiveTab();
          };
        });
        document.getElementById('newRoleForm')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const created = await post('/api/roles', {
              name: document.getElementById('crName').value,
              description: document.getElementById('crDesc').value,
              color: document.getElementById('crCol').value,
              permissions: Array.from(container.querySelectorAll('.cr-perm-cb:checked')).map((c) => c.value)
            });
            roles.push(created);
            toast('Custom role template created', 'success');
            renderActiveTab();
          } catch (err) { toast(err.message, 'error'); }
        });
      }

      if (activeTab === 'businessRules') {
        const ru = draft.businessRules;
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">10. Business Rules, Hours, Taxes &amp; Payment Modes</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Rules</button>
            </div>
            <div class="onb-grid-4">
              <label class="field-label">GST Active
                <select id="ruGst" class="select">
                  <option value="1" ${ru.gstEnabled !== false ? 'selected' : ''}>Enabled</option>
                  <option value="0" ${ru.gstEnabled === false ? 'selected' : ''}>Disabled</option>
                </select>
              </label>
              <label class="field-label">Tax Mode
                <select id="ruTaxMode" class="select">
                  <option value="exclusive" ${ru.taxMode === 'exclusive' ? 'selected' : ''}>Exclusive (+GST)</option>
                  <option value="inclusive" ${ru.taxMode === 'inclusive' ? 'selected' : ''}>Inclusive (MRP)</option>
                  <option value="composition" ${ru.taxMode === 'composition' ? 'selected' : ''}>Composition</option>
                </select>
              </label>
              <label class="field-label">GSTIN <input id="ruGstin" class="input mono" value="${esc(ru.gstin)}"></label>
              <label class="field-label">Round Off Total
                <select id="ruRound" class="select">
                  <option value="1" ${ru.roundOffEnabled !== false ? 'selected' : ''}>Nearest ₹1</option>
                  <option value="0" ${ru.roundOffEnabled === false ? 'selected' : ''}>Exact Paise</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">CGST % <input id="ruCgst" type="number" step="0.5" class="input" value="${ru.cgstRate}"></label>
              <label class="field-label">SGST % <input id="ruSgst" type="number" step="0.5" class="input" value="${ru.sgstRate}"></label>
              <label class="field-label">IGST % <input id="ruIgst" type="number" step="0.5" class="input" value="${ru.igstRate}"></label>
              <label class="field-label">Composition % <input id="ruComp" type="number" step="0.5" class="input" value="${ru.compositionRate}"></label>
            </div>

            <div class="onb-grid-4">
              <label class="field-label">Service Charge % <input id="ruSc" type="number" step="0.5" min="0" class="input" value="${ru.serviceChargeRate}"></label>
              <label class="field-label">SC on Takeaway/Delivery
                <select id="ruScTake" class="select">
                  <option value="0" ${!ru.serviceChargeOnTakeaway ? 'selected' : ''}>Dine-in Only</option>
                  <option value="1" ${ru.serviceChargeOnTakeaway ? 'selected' : ''}>All Order Types</option>
                </select>
              </label>
              <label class="field-label">Max Discount Cap (%) <input id="ruMaxDisc" type="number" min="0" max="100" class="input" value="${ru.maxDiscountPct ?? 100}"></label>
              <label class="field-label">Cancel After KOT
                <select id="ruCancelKot" class="select">
                  <option value="1" ${ru.allowCancelAfterKot !== false ? 'selected' : ''}>Allow Staff</option>
                  <option value="0" ${ru.allowCancelAfterKot === false ? 'selected' : ''}>Manager/Owner Only</option>
                </select>
              </label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Enabled Payment Methods</span>
              <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pmCash" ${ru.paymentMethods.cash !== false ? 'checked' : ''}> Cash</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pmUpi" ${ru.paymentMethods.upi !== false ? 'checked' : ''}> UPI</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pmCard" ${ru.paymentMethods.card !== false ? 'checked' : ''}> Card</label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pmSplit" ${ru.paymentMethods.split !== false ? 'checked' : ''}> Split Payment</label>
                ${(ru.paymentMethods.customMethods || []).map((cm, idx) => `
                  <span class="pill pill-green" style="gap:5px">${esc(cm)} <button type="button" class="btn btn-xs btn-ghost" data-del-pm="${idx}">✕</button></span>
                `).join('')}
              </div>
              <div style="display:flex;gap:8px">
                <input id="pmNewInp" class="input" placeholder="Custom method (e.g. Zomato Pay, Corporate Tab)">
                <button type="button" class="btn btn-sm btn-secondary" id="pmAddBtn">+ Add Method</button>
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Cancellation Reasons</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${(ru.cancellationReasons || []).map((rs, idx) => `
                  <span class="pill pill-amber" style="gap:5px">${esc(rs)} <button type="button" class="btn btn-xs btn-ghost" data-del-rsn="${idx}">✕</button></span>
                `).join('')}
              </div>
              <div style="display:flex;gap:8px">
                <input id="rsnNewInp" class="input" placeholder="Add cancellation reason">
                <button type="button" class="btn btn-sm btn-secondary" id="rsnAddBtn">+ Add Reason</button>
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px">
              <span class="field-label" style="display:block;margin-bottom:6px">Weekly Opening Hours &amp; Holidays</span>
              <div style="display:grid;gap:6px;margin-bottom:10px">
                ${DAYS.map((day) => {
                  const slot = (ru.openingHours || {})[day] || { open: '09:00', close: '23:00', closed: false };
                  return `
                    <div style="display:grid;grid-template-columns:92px auto 1fr 1fr;gap:8px;align-items:center;font-size:12px">
                      <strong>${day.slice(0, 3)}</strong>
                      <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="ru-hr-open" data-day="${day}" ${slot.closed ? '' : 'checked'}> Open</label>
                      <input type="time" class="input ru-hr-start" data-day="${day}" value="${esc(slot.open || '09:00')}" style="padding:5px 8px">
                      <input type="time" class="input ru-hr-end" data-day="${day}" value="${esc(slot.close || '23:00')}" style="padding:5px 8px">
                    </div>`;
                }).join('')}
              </div>
              <label class="field-label">Holidays (comma-separated YYYY-MM-DD)
                <input id="ruHolidays" class="input mono" value="${esc((ru.holidays || []).join(', '))}" placeholder="e.g. 2026-01-26, 2026-08-15">
              </label>
            </div>
          </div>`;

        document.getElementById('ruGst').onchange = (e) => { ru.gstEnabled = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('ruTaxMode').onchange = (e) => { ru.taxMode = e.target.value; applyLivePreview(); };
        document.getElementById('ruGstin').oninput = (e) => { ru.gstin = e.target.value; applyLivePreview(); };
        document.getElementById('ruRound').onchange = (e) => { ru.roundOffEnabled = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('ruCgst').oninput = (e) => { ru.cgstRate = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('ruSgst').oninput = (e) => { ru.sgstRate = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('ruIgst').oninput = (e) => { ru.igstRate = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('ruComp').oninput = (e) => { ru.compositionRate = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('ruSc').oninput = (e) => { ru.serviceChargeRate = Number(e.target.value || 0); applyLivePreview(); };
        document.getElementById('ruScTake').onchange = (e) => { ru.serviceChargeOnTakeaway = e.target.value === '1'; applyLivePreview(); };
        document.getElementById('ruMaxDisc').oninput = (e) => { ru.maxDiscountPct = Math.max(0, Math.min(100, Number(e.target.value ?? 100))); applyLivePreview(); };
        document.getElementById('ruCancelKot').onchange = (e) => { ru.allowCancelAfterKot = e.target.value === '1'; applyLivePreview(); };
        ['pmCash:cash', 'pmUpi:upi', 'pmCard:card', 'pmSplit:split'].forEach((p) => {
          const [id, k] = p.split(':');
          document.getElementById(id).onchange = (e) => { ru.paymentMethods[k] = e.target.checked; applyLivePreview(); };
        });
        document.getElementById('pmAddBtn').onclick = () => {
          const v = document.getElementById('pmNewInp').value.trim();
          if (!v) return;
          ru.paymentMethods.customMethods = Array.from(new Set([...(ru.paymentMethods.customMethods || []), v]));
          applyLivePreview();
          renderActiveTab();
        };
        container.querySelectorAll('[data-del-pm]').forEach((b) => {
          b.onclick = () => { ru.paymentMethods.customMethods.splice(Number(b.dataset.delPm), 1); applyLivePreview(); renderActiveTab(); };
        });
        document.getElementById('rsnAddBtn').onclick = () => {
          const v = document.getElementById('rsnNewInp').value.trim();
          if (!v) return;
          ru.cancellationReasons = Array.from(new Set([...(ru.cancellationReasons || []), v]));
          applyLivePreview();
          renderActiveTab();
        };
        container.querySelectorAll('[data-del-rsn]').forEach((b) => {
          b.onclick = () => { ru.cancellationReasons.splice(Number(b.dataset.delRsn), 1); applyLivePreview(); renderActiveTab(); };
        });
        DAYS.forEach((day) => {
          const syncDay = () => {
            ru.openingHours[day] = {
              closed: !document.querySelector(`.ru-hr-open[data-day="${day}"]`).checked,
              open: document.querySelector(`.ru-hr-start[data-day="${day}"]`).value || '09:00',
              close: document.querySelector(`.ru-hr-end[data-day="${day}"]`).value || '23:00'
            };
            applyLivePreview();
          };
          document.querySelector(`.ru-hr-open[data-day="${day}"]`).onchange = syncDay;
          document.querySelector(`.ru-hr-start[data-day="${day}"]`).oninput = syncDay;
          document.querySelector(`.ru-hr-end[data-day="${day}"]`).oninput = syncDay;
        });
        document.getElementById('ruHolidays').oninput = (e) => {
          ru.holidays = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
          applyLivePreview();
        };
      }

      if (activeTab === 'advanced') {
        const ad = draft.advanced;
        const sec = ad.security || {};
        container.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:14px">
            <div class="card-header">
              <h3 class="card-title">11. Regional Formats, Printers, Security &amp; Branches</h3>
              <button type="button" class="btn btn-xs btn-ghost" id="resetSectionBtn">Reset Advanced</button>
            </div>
            <div class="onb-grid-4">
              <label class="field-label">Currency Code <input id="adCurrCode" class="input mono" value="${esc(ad.currencyCode)}"></label>
              <label class="field-label">Currency Symbol <input id="adCurrSym" class="input" value="${esc(ad.currencySymbol)}"></label>
              <label class="field-label">Language
                <select id="adLang" class="select">
                  <option value="en-IN" ${ad.language === 'en-IN' ? 'selected' : ''}>English (India)</option>
                  <option value="en-US" ${ad.language === 'en-US' ? 'selected' : ''}>English (US)</option>
                  <option value="en-GB" ${ad.language === 'en-GB' ? 'selected' : ''}>English (UK)</option>
                  <option value="hi-IN" ${ad.language === 'hi-IN' ? 'selected' : ''}>Hindi / Bilingual</option>
                </select>
              </label>
              <label class="field-label">Number Format
                <select id="adNumLoc" class="select">
                  <option value="en-IN" ${ad.numberLocale === 'en-IN' ? 'selected' : ''}>1,23,456.00 (en-IN)</option>
                  <option value="en-US" ${ad.numberLocale === 'en-US' ? 'selected' : ''}>123,456.00 (en-US)</option>
                  <option value="en-GB" ${ad.numberLocale === 'en-GB' ? 'selected' : ''}>123,456.00 (en-GB)</option>
                </select>
              </label>
            </div>

            <div class="onb-grid-3">
              <label class="field-label">Timezone
                <select id="adTz" class="select">
                  ${TIMEZONES.concat(ad.timezone && !TIMEZONES.includes(ad.timezone) ? [ad.timezone] : []).map((tz) => `
                    <option value="${esc(tz)}" ${ad.timezone === tz ? 'selected' : ''}>${esc(tz)}</option>
                  `).join('')}
                </select>
              </label>
              <label class="field-label">Date Format
                <select id="adDateFmt" class="select">
                  ${['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((df) => `<option value="${df}" ${ad.dateFormat === df ? 'selected' : ''}>${df}</option>`).join('')}
                </select>
              </label>
              <label class="field-label">Printer Connection
                <select id="adPrinter" class="select">
                  <option value="browser_thermal" ${ad.printerType === 'browser_thermal' ? 'selected' : ''}>Browser / System Print</option>
                  <option value="usb_serial_escpos" ${ad.printerType === 'usb_serial_escpos' ? 'selected' : ''}>USB Serial ESC/POS</option>
                  <option value="pdf" ${ad.printerType === 'pdf' ? 'selected' : ''}>PDF Download</option>
                </select>
              </label>
            </div>

            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="adAutoKot" ${ad.autoPrintKot ? 'checked' : ''}> Auto-print KOT on Fire</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="adAutoInv" ${ad.autoPrintInvoice ? 'checked' : ''}> Auto-print Invoice on Settle</label>
              <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="adMaskPh" ${sec.maskCustomerPhone ? 'checked' : ''}> Mask Customer Phones</label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <a class="btn btn-sm btn-secondary" href="/api/backup/export" target="_blank">Download Full Workspace Backup (.json)</a>
              <button type="button" class="btn btn-sm btn-ghost" id="expCustBtn">Export Theme/Config JSON</button>
              <label class="btn btn-sm btn-ghost" style="cursor:pointer">Import Config JSON <input type="file" id="impCustFile" accept=".json,application/json" style="display:none"></label>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong>Multi-Branch Outlets (${branches.length})</strong>
                ${app.state.user.role === 'owner' ? '<button type="button" class="btn btn-xs btn-primary" id="custAddBranchBtn">+ New Branch</button>' : ''}
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${branches.map((br) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid ${br.id === app.state.activeBranchId ? 'var(--accent)' : 'var(--border)'};border-radius:10px">
                    <div>
                      <strong>${esc(br.name)} <span class="mono muted">(${esc(br.code)})</span></strong>
                      <div class="muted" style="font-size:11.5px">${esc([br.address, br.city, br.state, br.country].filter(Boolean).join(', ') || 'No address set')}</div>
                    </div>
                    ${canEdit ? `<button type="button" class="btn btn-xs btn-secondary" data-cust-edit-br="${br.id}">Edit</button>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>`;

        document.getElementById('adCurrCode').oninput = (e) => { ad.currencyCode = e.target.value; applyLivePreview(); };
        document.getElementById('adCurrSym').oninput = (e) => { ad.currencySymbol = e.target.value; applyLivePreview(); };
        document.getElementById('adLang').onchange = (e) => { ad.language = e.target.value; applyLivePreview(); };
        document.getElementById('adNumLoc').onchange = (e) => { ad.numberLocale = e.target.value; applyLivePreview(); };
        document.getElementById('adTz').onchange = (e) => { ad.timezone = e.target.value; applyLivePreview(); };
        document.getElementById('adDateFmt').onchange = (e) => { ad.dateFormat = e.target.value; applyLivePreview(); };
        document.getElementById('adPrinter').onchange = (e) => { ad.printerType = e.target.value; applyLivePreview(); };
        document.getElementById('adAutoKot').onchange = (e) => { ad.autoPrintKot = e.target.checked; applyLivePreview(); };
        document.getElementById('adAutoInv').onchange = (e) => { ad.autoPrintInvoice = e.target.checked; applyLivePreview(); };
        document.getElementById('adMaskPh').onchange = (e) => { ad.security = { ...(ad.security || {}), maskCustomerPhone: e.target.checked }; applyLivePreview(); };

        document.getElementById('expCustBtn').onclick = () => {
          const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'gres-customization.json';
          a.click();
          URL.revokeObjectURL(a.href);
        };
        document.getElementById('impCustFile').onchange = async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          try {
            const parsed = JSON.parse(await f.text());
            if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON configuration');
            draft = { ...draft, ...parsed };
            applyLivePreview();
            renderActiveTab();
            toast('Configuration loaded — click Save Changes to apply persistently', 'info');
          } catch (err) { toast(err.message, 'error'); }
        };

        container.querySelectorAll('[data-cust-edit-br]').forEach((b) => {
          b.onclick = () => {
            const br = branches.find((x) => x.id === Number(b.dataset.custEditBr));
            app.openModal(`Edit Branch: ${br.name}`, `
              <form id="custBrEditForm" style="display:flex;flex-direction:column;gap:10px">
                <label class="field-label">Branch Name <input id="cbeName" class="input" value="${esc(br.name)}" required></label>
                <div class="onb-grid-3">
                  <label class="field-label">Country <input id="cbeCountry" class="input" value="${esc(br.country || '')}"></label>
                  <label class="field-label">State <input id="cbeState" class="input" value="${esc(br.state || '')}"></label>
                  <label class="field-label">City <input id="cbeCity" class="input" value="${esc(br.city || '')}"></label>
                </div>
                <div class="onb-grid-2">
                  <label class="field-label">Address <input id="cbeAddr" class="input" value="${esc(br.address || '')}"></label>
                  <label class="field-label">Postal Code <input id="cbePostal" class="input" value="${esc(br.postal_code || '')}"></label>
                </div>
                <div class="onb-grid-2">
                  <label class="field-label">Phone <input id="cbePhone" class="input" value="${esc(br.phone || '')}"></label>
                  <label class="field-label">Email <input id="cbeEmail" class="input" value="${esc(br.email || '')}"></label>
                </div>
                <button type="submit" class="btn btn-primary">Save Branch</button>
              </form>
            `);
            document.getElementById('custBrEditForm').onsubmit = async (e) => {
              e.preventDefault();
              await put(`/api/branches/${br.id}`, {
                name: document.getElementById('cbeName').value,
                country: document.getElementById('cbeCountry').value,
                state: document.getElementById('cbeState').value,
                city: document.getElementById('cbeCity').value,
                address: document.getElementById('cbeAddr').value,
                postal_code: document.getElementById('cbePostal').value,
                phone: document.getElementById('cbePhone').value,
                email: document.getElementById('cbeEmail').value
              });
              app.closeModal();
              await app.refreshSession();
              toast('Branch updated', 'success');
              renderCustomizationStudio(root, app);
            };
          };
        });

        document.getElementById('custAddBranchBtn')?.addEventListener('click', () => {
          app.openModal('Create Restaurant Branch', `
            <form id="custNewBrForm" style="display:flex;flex-direction:column;gap:10px">
              <div class="onb-grid-2">
                <label class="field-label">Branch Name <input id="cbrName" class="input" required></label>
                <label class="field-label">Code <input id="cbrCode" class="input mono" required></label>
              </div>
              <label class="field-label">Address <input id="cbrAddr" class="input" required></label>
              <button type="submit" class="btn btn-primary">Create Branch</button>
            </form>
          `);
          document.getElementById('custNewBrForm').onsubmit = async (e) => {
            e.preventDefault();
            await post('/api/branches', {
              name: document.getElementById('cbrName').value,
              code: document.getElementById('cbrCode').value,
              address: document.getElementById('cbrAddr').value
            });
            app.closeModal();
            await app.refreshSession();
            toast('Branch created', 'success');
            renderCustomizationStudio(root, app);
          };
        });
      }

      document.getElementById('resetSectionBtn')?.addEventListener('click', async () => {
        if (!canEdit) return;
        const secMap = {
          appearance: 'appearance', branding: 'branding', dashboard: 'dashboard',
          pos: 'pos', tables: 'tables', billing: 'billing', menu: 'menu',
          notifications: 'notifications', businessRules: 'businessRules', advanced: 'advanced'
        };
        const secKey = secMap[activeTab];
        if (!secKey) return;
        const updated = await post('/api/customization/reset', { section: secKey });
        app.hasUnsavedChanges = false;
        app.applySettings(updated);
        toast(`Reset ${activeTab} to GRES defaults`, 'info');
        renderCustomizationStudio(root, app);
      });
    }

    root.innerHTML = `
      <div class="card cust-header-bar">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <strong>GRES Customization Studio</strong>
          <span id="custUnsavedBadge" class="pill pill-amber hidden">Unsaved Changes</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canEdit ? `
            <button type="button" class="btn btn-sm btn-ghost hidden" id="custDiscardBtn">Discard</button>
            <button type="button" class="btn btn-sm btn-ghost" id="custResetAllBtn">Reset All to Default</button>
            <button type="button" class="btn btn-sm btn-primary" id="custSaveBtn" disabled>Save Changes</button>
          ` : '<span class="pill pill-blue">Read Only</span>'}
        </div>
      </div>

      <div class="cust-shell">
        <aside class="card cust-nav">
          ${TABS.map((tb) => `
            <button type="button" class="cust-tab ${tb.id === activeTab ? 'active' : ''}" data-cust-tab="${tb.id}">
              <div>
                <div>${esc(tb.label)}</div>
                <div class="muted" style="font-size:10.5px;font-weight:400">${esc(tb.desc)}</div>
              </div>
            </button>
          `).join('')}
        </aside>

        <div class="cust-split">
          <div id="custTabBody"></div>
          <div id="custLivePreview" class="cust-preview-pane"></div>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-cust-tab]').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.dataset.custTab;
        app.state.custTab = activeTab;
        renderActiveTab();
        renderPreviewPane();
      };
    });

    document.getElementById('custDiscardBtn')?.addEventListener('click', () => {
      draft = clone(custPayload.customization);
      extraBillingFields = {
        invoice_prefix: savedSettings.invoice_prefix || 'INV',
        invoice_start_number: savedSettings.invoice_start_number || 1001,
        kot_prefix: savedSettings.kot_prefix || 'KOT',
        upi_id: savedSettings.upi_id || ''
      };
      app.hasUnsavedChanges = false;
      app.applySettings(savedSettings);
      renderActiveTab();
      renderPreviewPane();
      syncDirtyState();
      toast('Reverted unsaved changes', 'info');
    });

    document.getElementById('custResetAllBtn')?.addEventListener('click', async () => {
      if (!window.confirm('Reset ALL customization settings to GRES defaults? Your restaurant data, orders, and menu will be preserved.')) return;
      const updated = await post('/api/customization/reset', { section: 'all' });
      app.hasUnsavedChanges = false;
      app.applySettings(updated);
      toast('All customization reset to defaults', 'info');
      renderCustomizationStudio(root, app);
    });

    document.getElementById('custSaveBtn')?.addEventListener('click', async () => {
      try {
        await put('/api/settings', {
          invoice_prefix: extraBillingFields.invoice_prefix,
          invoice_start_number: extraBillingFields.invoice_start_number,
          kot_prefix: extraBillingFields.kot_prefix,
          upi_id: extraBillingFields.upi_id
        });
        const updated = await put('/api/customization', { customization: draft });
        app.hasUnsavedChanges = false;
        app.onDiscardUnsaved = null;
        await app.refreshSession();
        app.applySettings(updated);
        baselineJson = JSON.stringify(updated.customization);
        baselineExtraJson = JSON.stringify(extraBillingFields);
        syncDirtyState();
        toast('Customization saved & applied everywhere!', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    renderActiveTab();
    renderPreviewPane();
    syncDirtyState();
  }

  window.GresCustomization = { render: renderCustomizationStudio };
})();
