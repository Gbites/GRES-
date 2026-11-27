(function () {
  'use strict';

  const { esc, formatINR, toast, get, post, put, del } = window.GresAPI;

  const STEPS = [
    { num: 1, title: 'Identity', label: 'Restaurant Identity' },
    { num: 2, title: 'Location', label: 'Location & Contact' },
    { num: 3, title: 'Business', label: 'Business Config' },
    { num: 4, title: 'Tax & Billing', label: 'Tax & Billing' },
    { num: 5, title: 'Floors & Tables', label: 'Floors & Table Layout' },
    { num: 6, title: 'Menu', label: 'Menu, Variants & Extras' },
    { num: 7, title: 'Staff', label: 'Staff & Permissions' },
    { num: 8, title: 'Review', label: 'Review & Complete' }
  ];

  const ALL_PERMS = [
    ['dashboard:view', 'View Dashboard'],
    ['pos:use', 'Use POS Terminal'],
    ['floor:view', 'View Floor Plan'],
    ['floor:edit', 'Edit Floor Plan'],
    ['tables:transfer', 'Transfer Tables'],
    ['tables:merge', 'Merge Tables'],
    ['orders:view', 'View Orders & Invoices'],
    ['orders:discount', 'Apply Discounts'],
    ['orders:void', 'Void / Cancel Orders'],
    ['kds:view', 'View Kitchen (KDS)'],
    ['kds:update', 'Update KDS Status'],
    ['menu:view', 'View Menu'],
    ['menu:edit', 'Edit Menu & Recipes'],
    ['inventory:view', 'View Inventory'],
    ['inventory:edit', 'Edit Inventory'],
    ['analytics:view', 'View Analytics'],
    ['staff:view', 'View Staff'],
    ['staff:edit', 'Manage Staff'],
    ['settings:view', 'View Settings'],
    ['settings:edit', 'Edit Settings']
  ];

  const ROLE_DEFAULTS = {
    manager: ['dashboard:view', 'pos:use', 'floor:view', 'floor:edit', 'tables:transfer', 'tables:merge', 'orders:view', 'orders:void', 'orders:discount', 'kds:view', 'kds:update', 'menu:view', 'menu:edit', 'inventory:view', 'inventory:edit', 'analytics:view', 'staff:view', 'staff:edit', 'settings:view', 'settings:edit'],
    cashier: ['dashboard:view', 'pos:use', 'floor:view', 'tables:transfer', 'tables:merge', 'orders:view', 'orders:discount', 'kds:view', 'menu:view', 'inventory:view', 'settings:view'],
    waiter: ['pos:use', 'floor:view', 'tables:transfer', 'orders:view', 'kds:view', 'menu:view'],
    chef: ['kds:view', 'kds:update', 'menu:view', 'inventory:view', 'orders:view']
  };

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function readImageAsDataUrl(file, maxDim = 280) {
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

  let currentStep = 1;
  let stateCache = null;

  async function render(app, stepOverride) {
    const shell = document.getElementById('onboardingScreen');
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appShell').classList.add('hidden');
    shell.classList.remove('hidden');

    stateCache = await get('/api/onboarding');
    currentStep = stepOverride || Math.max(1, Math.min(8, Number(stateCache.restaurant?.onboarding_step || 1)));
    drawWizard(app);
  }

  function drawWizard(app) {
    const shell = document.getElementById('onboardingScreen');
    const stepMeta = STEPS[currentStep - 1];
    const pct = Math.round((currentStep / 8) * 100);

    shell.innerHTML = `
      <div class="onb-container">
        <header class="onb-topbar">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="brand-badge sm">G</div>
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                <strong style="font-size:15px">GRES</strong>
                <span class="ver-tag">RESTAURANT SETUP</span>
              </div>
              <small class="muted">Run Your Restaurant Smarter.</small>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <span class="mono muted" style="font-size:12px">Step ${currentStep} of 8 (${pct}%)</span>
            <button class="btn btn-ghost btn-xs" id="onbLogoutBtn">Sign Out &amp; Resume Later</button>
          </div>
        </header>

        <div class="onb-progress-wrap">
          <div class="onb-progress-track"><div class="onb-progress-fill" style="width:${pct}%"></div></div>
          <div class="onb-steps-row">
            ${STEPS.map((s) => `
              <button type="button" class="onb-step-pill ${s.num === currentStep ? 'active' : s.num < currentStep ? 'done' : ''}" data-jump-step="${s.num}">
                <span class="mono">${s.num < currentStep ? '✓' : s.num}</span>
                <span>${esc(s.title)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <section class="onb-card card anim-item">
          <div class="onb-page-head">
            <span class="mono" style="color:var(--accent);font-size:11px">PAGE ${currentStep} / 8</span>
            <h2>${esc(stepMeta.label)}</h2>
          </div>
          <div id="onbBody"></div>
        </section>
      </div>
    `;

    document.getElementById('onbLogoutBtn').onclick = async () => {
      await post('/api/auth/logout');
      shell.classList.add('hidden');
      document.getElementById('authScreen').classList.remove('hidden');
    };

    shell.querySelectorAll('[data-jump-step]').forEach((btn) => {
      btn.onclick = async () => {
        const target = Number(btn.dataset.jumpStep);
        if (target <= currentStep || target <= Number(stateCache.restaurant?.onboarding_step || 1)) {
          currentStep = target;
          drawWizard(app);
        }
      };
    });

    const body = document.getElementById('onbBody');
    switch (currentStep) {
      case 1: renderPage1(body, app); break;
      case 2: renderPage2(body, app); break;
      case 3: renderPage3(body, app); break;
      case 4: renderPage4(body, app); break;
      case 5: renderPage5(body, app); break;
      case 6: renderPage6(body, app); break;
      case 7: renderPage7(body, app); break;
      case 8: renderPage8(body, app); break;
    }
  }

  async function saveAndGo(nextStep, payloadData, app) {
    await put('/api/onboarding/step', { step: nextStep, data: payloadData });
    stateCache = await get('/api/onboarding');
    currentStep = nextStep;
    drawWizard(app);
  }

  // ===== PAGE 1: RESTAURANT IDENTITY =====
  function renderPage1(body, app) {
    const r = stateCache.restaurant || {};
    const s = stateCache.settings || {};
    let logoDataUrl = s.logo_url || '';

    body.innerHTML = `
      <form id="onbP1Form" class="onb-form">
        <div class="onb-grid-2">
          <label class="field-label">Restaurant Name *
            <input id="p1Name" class="input" value="${esc(s.restaurant_name || r.name || '')}" placeholder="Official Restaurant Name" required>
          </label>
          <label class="field-label">Restaurant Type *
            <select id="p1Type" class="select" required>
              <option value="">Select type...</option>
              ${['Fine Dining', 'Casual Dining', 'Cafe / Bakery', 'QSR / Fast Casual', 'Cloud Kitchen', 'Bar & Lounge', 'Multi-Cuisine'].map((t) => `
                <option value="${t}" ${r.restaurant_type === t ? 'selected' : ''}>${t}</option>
              `).join('')}
            </select>
          </label>
        </div>

        <div class="onb-grid-2">
          <label class="field-label">Tagline (optional)
            <input id="p1Tagline" class="input" value="${esc(s.tagline || '')}" placeholder="Short subtitle for receipts & profile">
          </label>
          <label class="field-label">Monogram Initials (1-3 chars)
            <input id="p1Initials" class="input mono" maxlength="3" value="${esc(s.brand_initials || '')}" placeholder="Auto">
          </label>
        </div>

        <div class="onb-logo-row">
          <div class="brand-badge" id="p1LogoPreview" style="width:60px;height:60px;font-size:20px">
            ${logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="Logo">` : esc(s.brand_initials || 'G')}
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <label class="field-label">Restaurant Logo URL (optional)
              <input id="p1LogoUrl" class="input" value="${esc(logoDataUrl)}" placeholder="https://... or upload an image below">
            </label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <label class="btn btn-xs btn-secondary" style="cursor:pointer">
                Upload Logo Image
                <input type="file" id="p1LogoFile" accept="image/*" class="hidden">
              </label>
              <button type="button" class="btn btn-xs btn-ghost" id="p1ClearLogo">Clear Logo</button>
            </div>
          </div>
        </div>

        <label class="field-label">Description (optional)
          <textarea id="p1Desc" class="textarea" rows="3" placeholder="Cuisine style, dining concept, or story">${esc(r.description || '')}</textarea>
        </label>

        <div class="onb-actions">
          <span></span>
          <button type="submit" class="btn btn-primary btn-shimmer">Save &amp; Continue →</button>
        </div>
      </form>
    `;

    const prev = document.getElementById('p1LogoPreview');
    const urlInp = document.getElementById('p1LogoUrl');
    function syncLogoPreview() {
      const val = urlInp.value.trim();
      logoDataUrl = val;
      prev.innerHTML = val ? `<img src="${esc(val)}" alt="Logo">` : esc((document.getElementById('p1Initials').value || 'G').toUpperCase());
    }
    urlInp.oninput = syncLogoPreview;
    document.getElementById('p1Initials').oninput = syncLogoPreview;
    document.getElementById('p1ClearLogo').onclick = () => { urlInp.value = ''; syncLogoPreview(); };
    document.getElementById('p1LogoFile').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        urlInp.value = await readImageAsDataUrl(file, 240);
        syncLogoPreview();
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    document.getElementById('onbP1Form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await saveAndGo(2, {
          identity: {
            restaurant_name: document.getElementById('p1Name').value.trim(),
            restaurant_type: document.getElementById('p1Type').value,
            tagline: document.getElementById('p1Tagline').value.trim(),
            brand_initials: document.getElementById('p1Initials').value.trim(),
            logo_url: urlInp.value.trim(),
            description: document.getElementById('p1Desc').value.trim()
          }
        }, app);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  // ===== PAGE 2: LOCATION =====
  function renderPage2(body, app) {
    const b = stateCache.branch || {};

    body.innerHTML = `
      <form id="onbP2Form" class="onb-form">
        <div class="onb-grid-3">
          <label class="field-label">Country *
            <input id="p2Country" class="input" value="${esc(b.country || '')}" placeholder="Country" required>
          </label>
          <label class="field-label">State / Province *
            <input id="p2State" class="input" value="${esc(b.state || '')}" placeholder="State" required>
          </label>
          <label class="field-label">City *
            <input id="p2City" class="input" value="${esc(b.city || '')}" placeholder="City" required>
          </label>
        </div>

        <div class="onb-grid-2">
          <label class="field-label">Street Address *
            <input id="p2Address" class="input" value="${esc(b.address || '')}" placeholder="Building, Street, Locality" required>
          </label>
          <label class="field-label">Postal / PIN Code
            <input id="p2Postal" class="input mono" value="${esc(b.postal_code || '')}" placeholder="Postal Code">
          </label>
        </div>

        <div class="onb-grid-2">
          <label class="field-label">Restaurant Phone
            <input id="p2Phone" class="input" value="${esc(b.phone || '')}" placeholder="Phone number">
          </label>
          <label class="field-label">Contact Email
            <input id="p2Email" type="email" class="input" value="${esc(b.email || '')}" placeholder="contact@restaurant.com">
          </label>
        </div>

        <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
            <span class="field-label">Optional Map Pin (Latitude / Longitude)</span>
            <button type="button" class="btn btn-xs btn-secondary" id="p2GpsBtn">Detect Current GPS Pin</button>
          </div>
          <div class="onb-grid-2">
            <input id="p2Lat" type="number" step="any" class="input mono" value="${b.map_lat ?? ''}" placeholder="Latitude (optional)">
            <input id="p2Lng" type="number" step="any" class="input mono" value="${b.map_lng ?? ''}" placeholder="Longitude (optional)">
          </div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p2BackBtn">← Back</button>
          <button type="submit" class="btn btn-primary btn-shimmer">Save &amp; Continue →</button>
        </div>
      </form>
    `;

    document.getElementById('p2GpsBtn').onclick = () => {
      if (!navigator.geolocation) return toast('Geolocation not supported by browser', 'error');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          document.getElementById('p2Lat').value = pos.coords.latitude.toFixed(6);
          document.getElementById('p2Lng').value = pos.coords.longitude.toFixed(6);
          toast('GPS coordinates captured', 'success');
        },
        (err) => toast(err.message, 'error')
      );
    };

    document.getElementById('p2BackBtn').onclick = () => { currentStep = 1; drawWizard(app); };
    document.getElementById('onbP2Form').onsubmit = async (e) => {
      e.preventDefault();
      await saveAndGo(3, {
        location: {
          country: document.getElementById('p2Country').value.trim(),
          state: document.getElementById('p2State').value.trim(),
          city: document.getElementById('p2City').value.trim(),
          address: document.getElementById('p2Address').value.trim(),
          postal_code: document.getElementById('p2Postal').value.trim(),
          phone: document.getElementById('p2Phone').value.trim(),
          email: document.getElementById('p2Email').value.trim(),
          map_lat: document.getElementById('p2Lat').value.trim(),
          map_lng: document.getElementById('p2Lng').value.trim()
        }
      }, app);
    };
  }

  // ===== PAGE 3: BUSINESS CONFIGURATION =====
  function renderPage3(body, app) {
    const s = stateCache.settings || {};
    let hours = {};
    try { hours = JSON.parse(s.opening_hours_json || '{}'); } catch { hours = {}; }
    let holidays = [];
    try { holidays = JSON.parse(s.holidays_json || '[]'); } catch { holidays = []; }

    body.innerHTML = `
      <form id="onbP3Form" class="onb-form">
        <div class="onb-grid-4">
          <label class="field-label">Currency Code
            <input id="p3CurrCode" class="input mono" value="${esc(s.currency_code || 'INR')}" required>
          </label>
          <label class="field-label">Currency Symbol
            <input id="p3CurrSym" class="input mono" value="${esc(s.currency_symbol || '₹')}" required>
          </label>
          <label class="field-label">Timezone
            <select id="p3Tz" class="select">
              ${['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles'].map((tz) => `
                <option value="${tz}" ${(s.timezone || 'Asia/Kolkata') === tz ? 'selected' : ''}>${tz}</option>
              `).join('')}
            </select>
          </label>
          <label class="field-label">Date Format
            <select id="p3DateFmt" class="select">
              ${['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((df) => `
                <option value="${df}" ${(s.date_format || 'DD/MM/YYYY') === df ? 'selected' : ''}>${df}</option>
              `).join('')}
            </select>
          </label>
        </div>

        <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
          <span class="field-label" style="margin-bottom:8px">Opening Hours (Monday – Sunday)</span>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${DAYS.map((day) => {
              const d = hours[day] || { open: '11:00', close: '23:00', closed: false };
              return `
                <div style="display:grid;grid-template-columns:110px 1fr 1fr auto;gap:8px;align-items:center">
                  <strong style="font-size:12px">${day}</strong>
                  <input type="time" class="input mono" data-hr-open="${day}" value="${esc(d.open || '11:00')}" ${d.closed ? 'disabled' : ''}>
                  <input type="time" class="input mono" data-hr-close="${day}" value="${esc(d.close || '23:00')}" ${d.closed ? 'disabled' : ''}>
                  <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px">
                    <input type="checkbox" data-hr-closed="${day}" ${d.closed ? 'checked' : ''}> Closed
                  </label>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="field-label">Scheduled Holidays (optional)</span>
          </div>
          <div style="display:grid;grid-template-columns:160px 1fr auto;gap:8px;margin-bottom:8px">
            <input type="date" id="p3HolDate" class="input mono">
            <input type="text" id="p3HolName" class="input" placeholder="Holiday name">
            <button type="button" class="btn btn-xs btn-secondary" id="p3AddHolBtn">+ Add</button>
          </div>
          <div id="p3HolList" style="display:flex;flex-wrap:wrap;gap:6px"></div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p3BackBtn">← Back</button>
          <button type="submit" class="btn btn-primary btn-shimmer">Save &amp; Continue →</button>
        </div>
      </form>
    `;

    DAYS.forEach((day) => {
      const chk = body.querySelector(`[data-hr-closed="${day}"]`);
      chk.onchange = () => {
        body.querySelector(`[data-hr-open="${day}"]`).disabled = chk.checked;
        body.querySelector(`[data-hr-close="${day}"]`).disabled = chk.checked;
      };
    });

    function drawHolidays() {
      const list = document.getElementById('p3HolList');
      list.innerHTML = holidays.map((h, i) => `
        <span class="pill pill-blue">${esc(h.date)} • ${esc(h.name)} <button type="button" data-del-hol="${i}" style="background:none;border:none;cursor:pointer;margin-left:4px">✕</button></span>
      `).join('') || '<span class="muted" style="font-size:12px">No holidays added.</span>';
      list.querySelectorAll('[data-del-hol]').forEach((b) => {
        b.onclick = () => { holidays.splice(Number(b.dataset.delHol), 1); drawHolidays(); };
      });
    }
    drawHolidays();

    document.getElementById('p3AddHolBtn').onclick = () => {
      const date = document.getElementById('p3HolDate').value;
      const name = document.getElementById('p3HolName').value.trim();
      if (!date || !name) return toast('Enter holiday date and name', 'error');
      holidays.push({ date, name });
      document.getElementById('p3HolDate').value = '';
      document.getElementById('p3HolName').value = '';
      drawHolidays();
    };

    document.getElementById('p3BackBtn').onclick = () => { currentStep = 2; drawWizard(app); };
    document.getElementById('onbP3Form').onsubmit = async (e) => {
      e.preventDefault();
      const opening_hours = {};
      DAYS.forEach((day) => {
        opening_hours[day] = {
          open: body.querySelector(`[data-hr-open="${day}"]`).value,
          close: body.querySelector(`[data-hr-close="${day}"]`).value,
          closed: body.querySelector(`[data-hr-closed="${day}"]`).checked
        };
      });
      await saveAndGo(4, {
        business: {
          currency_code: document.getElementById('p3CurrCode').value.trim().toUpperCase(),
          currency_symbol: document.getElementById('p3CurrSym').value.trim(),
          timezone: document.getElementById('p3Tz').value,
          date_format: document.getElementById('p3DateFmt').value,
          opening_hours,
          holidays
        }
      }, app);
    };
  }

  // ===== PAGE 4: TAX & BILLING =====
  function renderPage4(body, app) {
    const s = stateCache.settings || {};

    body.innerHTML = `
      <form id="onbP4Form" class="onb-form">
        <div class="onb-grid-3">
          <label class="field-label">GST Billing Enabled
            <select id="p4GstEn" class="select">
              <option value="1" ${s.gst_enabled !== 0 ? 'selected' : ''}>Enabled (GST Registered)</option>
              <option value="0" ${s.gst_enabled === 0 ? 'selected' : ''}>Disabled (No GST)</option>
            </select>
          </label>
          <label class="field-label">GSTIN
            <input id="p4Gstin" class="input mono" value="${esc(s.gstin || stateCache.branch?.gstin || '')}" placeholder="15-char GSTIN (optional)">
          </label>
          <label class="field-label">Tax Mode
            <select id="p4TaxMode" class="select">
              <option value="exclusive" ${s.tax_mode === 'exclusive' ? 'selected' : ''}>Exclusive (Price + GST)</option>
              <option value="inclusive" ${s.tax_mode === 'inclusive' ? 'selected' : ''}>Inclusive (MRP incl. GST)</option>
              <option value="composition" ${s.tax_mode === 'composition' ? 'selected' : ''}>Composition Scheme</option>
            </select>
          </label>
        </div>

        <div class="onb-grid-4">
          <label class="field-label">CGST %
            <input id="p4Cgst" type="number" step="0.5" min="0" class="input mono" value="${s.cgst_rate ?? 2.5}">
          </label>
          <label class="field-label">SGST %
            <input id="p4Sgst" type="number" step="0.5" min="0" class="input mono" value="${s.sgst_rate ?? 2.5}">
          </label>
          <label class="field-label">IGST % (0 = intra-state)
            <input id="p4Igst" type="number" step="0.5" min="0" class="input mono" value="${s.igst_rate ?? 0}">
          </label>
          <label class="field-label">Service Charge %
            <input id="p4Sc" type="number" step="0.5" min="0" class="input mono" value="${s.service_charge_rate ?? 0}">
          </label>
        </div>

        <div class="onb-grid-2">
          <label class="field-label">Invoice Prefix
            <input id="p4Prefix" class="input mono" value="${esc(s.invoice_prefix || 'INV')}" required>
          </label>
          <label class="field-label">Starting Invoice Number
            <input id="p4StartNum" type="number" min="1" class="input mono" value="${s.invoice_start_number ?? 1001}" required>
          </label>
        </div>

        <label class="field-label">Invoice / Receipt Footer Note (optional)
          <input id="p4Footer" class="input" value="${esc(s.receipt_footer || '')}" placeholder="Custom message printed at the bottom of bills">
        </label>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p4BackBtn">← Back</button>
          <button type="submit" class="btn btn-primary btn-shimmer">Save &amp; Continue →</button>
        </div>
      </form>
    `;

    document.getElementById('p4BackBtn').onclick = () => { currentStep = 3; drawWizard(app); };
    document.getElementById('onbP4Form').onsubmit = async (e) => {
      e.preventDefault();
      await saveAndGo(5, {
        tax: {
          gst_enabled: document.getElementById('p4GstEn').value === '1',
          gstin: document.getElementById('p4Gstin').value.trim().toUpperCase(),
          tax_mode: document.getElementById('p4TaxMode').value,
          cgst_rate: Number(document.getElementById('p4Cgst').value || 0),
          sgst_rate: Number(document.getElementById('p4Sgst').value || 0),
          igst_rate: Number(document.getElementById('p4Igst').value || 0),
          service_charge_rate: Number(document.getElementById('p4Sc').value || 0),
          invoice_prefix: document.getElementById('p4Prefix').value.trim(),
          invoice_start_number: Number(document.getElementById('p4StartNum').value || 1001),
          receipt_footer: document.getElementById('p4Footer').value.trim()
        }
      }, app);
    };
  }

  // ===== PAGE 5: FLOORS, SECTIONS & VISUAL DRAG-AND-DROP TABLE LAYOUT =====
  function renderPage5(body, app) {
    const floors = stateCache.floors || [];
    const tables = stateCache.tables || [];
    const floorNames = floors.length > 0 ? floors.map((f) => f.name) : ['Ground Floor'];
    const allSections = [...new Set(floors.flatMap((f) => f.sections || []))];
    const sectionOpts = allSections.length > 0 ? allSections : ['Main Hall'];

    body.innerHTML = `
      <div class="onb-form">
        <div class="onb-grid-2">
          <!-- Left: Add Floor / Section & Add Table -->
          <div style="display:flex;flex-direction:column;gap:12px">
            <form id="p5FloorForm" class="card" style="background:rgba(8,10,16,0.35);padding:12px;display:flex;flex-direction:column;gap:8px">
              <strong style="font-size:12.5px">1. Add Floor &amp; Sections</strong>
              <input id="p5FloorName" class="input" placeholder="Floor Name (e.g. Ground Floor)" required>
              <input id="p5Sections" class="input" placeholder="Sections comma-separated (e.g. Main Hall, Patio)">
              <button type="submit" class="btn btn-xs btn-secondary">+ Add Floor</button>
              <div style="display:flex;flex-wrap:wrap;gap:5px">
                ${floors.map((f) => `
                  <span class="pill pill-blue">${esc(f.name)} (${(f.sections || []).length} sec) <button type="button" data-del-floor="${f.id}" style="background:none;border:none;cursor:pointer">✕</button></span>
                `).join('') || '<span class="muted" style="font-size:11px">No custom floors added yet.</span>'}
              </div>
            </form>

            <form id="p5TableForm" class="card" style="background:rgba(8,10,16,0.35);padding:12px;display:flex;flex-direction:column;gap:8px">
              <strong style="font-size:12.5px">2. Add Table to Canvas</strong>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <input id="p5TbName" class="input" placeholder="Table (e.g. T-01)" required>
                <input id="p5TbSeats" type="number" min="1" class="input" value="4" placeholder="Seats" required>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <select id="p5TbFloor" class="select">
                  ${floorNames.map((fn) => `<option value="${esc(fn)}">${esc(fn)}</option>`).join('')}
                </select>
                <select id="p5TbSec" class="select">
                  ${sectionOpts.map((sn) => `<option value="${esc(sn)}">${esc(sn)}</option>`).join('')}
                </select>
              </div>
              <select id="p5TbShape" class="select">
                <option value="square">Square</option>
                <option value="round">Round</option>
                <option value="rect">Rectangle</option>
              </select>
              <button type="submit" class="btn btn-xs btn-primary">+ Place Table on Floor</button>
            </form>
          </div>

          <!-- Right: Drag-and-Drop Canvas -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span class="muted" style="font-size:12px">Drag tables to position &amp; drag bottom-right corner to resize (${tables.length} tables)</span>
              <button type="button" class="btn btn-xs btn-success" id="p5SaveLayoutBtn">Save Positions</button>
            </div>
            <div class="floor-canvas" id="onbFloorCanvas" style="min-height:360px">
              ${tables.length === 0 ? `
                <div class="empty-state" style="margin:60px auto;max-width:340px">
                  <h4>No Tables Placed Yet</h4>
                  <p>Use the form on the left to add tables, or skip this step if you only operate takeaway/delivery.</p>
                </div>
              ` : tables.map((t) => `
                <div class="floor-table shape-${esc(t.shape)} status-available editing"
                     data-tid="${t.id}"
                     style="left:${t.x}px;top:${t.y}px;width:${t.width}px;height:${t.height}px">
                  <strong style="font-size:13px">${esc(t.name)}</strong>
                  <span class="mono muted" style="font-size:10px">${t.seats}s • ${esc(t.zone)}</span>
                  <button type="button" data-del-tb="${t.id}" style="position:absolute;top:3px;right:5px;background:none;border:none;color:var(--danger);font-size:11px;cursor:pointer" title="Delete table">✕</button>
                  <span class="table-resize-handle" data-resize="1"></span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p5BackBtn">← Back</button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost" id="p5SkipBtn">Skip for Now</button>
            <button type="button" class="btn btn-primary btn-shimmer" id="p5NextBtn">Save Layout &amp; Continue →</button>
          </div>
        </div>
      </div>
    `;

    // Drag & Resize inside onboarding canvas
    const canvasEl = document.getElementById('onbFloorCanvas');
    let dragEl = null, op = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
    canvasEl.querySelectorAll('.floor-table').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        if (e.target.dataset.delTb) return;
        e.preventDefault();
        dragEl = el;
        op = e.target.dataset.resize ? 'resize' : 'move';
        sx = e.clientX; sy = e.clientY;
        ox = parseInt(el.style.left, 10) || 0; oy = parseInt(el.style.top, 10) || 0;
        ow = parseInt(el.style.width, 10) || 100; oh = parseInt(el.style.height, 10) || 100;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (dragEl !== el) return;
        const snap = (v) => Math.round(v / 10) * 10;
        if (op === 'move') {
          el.style.left = `${Math.max(0, snap(ox + e.clientX - sx))}px`;
          el.style.top = `${Math.max(0, snap(oy + e.clientY - sy))}px`;
        } else {
          el.style.width = `${Math.max(70, snap(ow + e.clientX - sx))}px`;
          el.style.height = `${Math.max(70, snap(oh + e.clientY - sy))}px`;
        }
      });
      el.addEventListener('pointerup', () => { dragEl = null; });
    });

    async function persistCanvasPositions() {
      const layouts = Array.from(canvasEl.querySelectorAll('.floor-table')).map((el) => ({
        id: Number(el.dataset.tid),
        x: parseInt(el.style.left, 10),
        y: parseInt(el.style.top, 10),
        width: parseInt(el.style.width, 10),
        height: parseInt(el.style.height, 10)
      }));
      if (layouts.length > 0) await put('/api/tables/layout/batch', { layouts });
    }

    document.getElementById('p5FloorForm').onsubmit = async (e) => {
      e.preventDefault();
      await post('/api/floors', {
        name: document.getElementById('p5FloorName').value,
        sections: document.getElementById('p5Sections').value
      });
      stateCache = await get('/api/onboarding');
      drawWizard(app);
    };

    body.querySelectorAll('[data-del-floor]').forEach((b) => {
      b.onclick = async () => {
        await del(`/api/floors/${b.dataset.delFloor}`);
        stateCache = await get('/api/onboarding');
        drawWizard(app);
      };
    });

    document.getElementById('p5TableForm').onsubmit = async (e) => {
      e.preventDefault();
      await persistCanvasPositions();
      const offset = (tables.length % 4) * 125;
      const rowOff = Math.floor(tables.length / 4) * 120;
      await post('/api/tables', {
        name: document.getElementById('p5TbName').value,
        seats: Number(document.getElementById('p5TbSeats').value),
        floor_name: document.getElementById('p5TbFloor').value,
        zone: document.getElementById('p5TbSec').value,
        shape: document.getElementById('p5TbShape').value,
        x: 30 + offset,
        y: 30 + rowOff
      });
      stateCache = await get('/api/onboarding');
      drawWizard(app);
    };

    body.querySelectorAll('[data-del-tb]').forEach((b) => {
      b.onclick = async () => {
        await del(`/api/tables/${b.dataset.delTb}`);
        stateCache = await get('/api/onboarding');
        drawWizard(app);
      };
    });

    document.getElementById('p5SaveLayoutBtn').onclick = async () => {
      await persistCanvasPositions();
      toast('Table positions saved!', 'success');
    };

    document.getElementById('p5BackBtn').onclick = () => { currentStep = 4; drawWizard(app); };
    document.getElementById('p5SkipBtn').onclick = () => saveAndGo(6, {}, app);
    document.getElementById('p5NextBtn').onclick = async () => {
      await persistCanvasPositions();
      await saveAndGo(6, {}, app);
    };
  }

  // ===== PAGE 6: MENU CATEGORIES, ITEMS, PHOTOS, VARIANTS & EXTRAS =====
  function renderPage6(body, app) {
    const categories = stateCache.categories || [];
    const items = stateCache.items || [];
    const variantsDraft = [];
    const extrasDraft = [];

    body.innerHTML = `
      <div class="onb-form">
        <div class="onb-grid-2">
          <!-- Left: Add Category + Add Dish -->
          <div style="display:flex;flex-direction:column;gap:12px">
            <form id="p6CatForm" class="card" style="background:rgba(8,10,16,0.35);padding:12px;display:flex;gap:8px;align-items:center">
              <input id="p6CatName" class="input" placeholder="New Category (e.g. Starters)" required>
              <button type="submit" class="btn btn-xs btn-secondary">+ Category</button>
            </form>

            <form id="p6ItemForm" class="card" style="background:rgba(8,10,16,0.35);padding:12px;display:flex;flex-direction:column;gap:8px">
              <strong style="font-size:12.5px">Add Menu Item</strong>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <select id="p6CatSel" class="select" ${categories.length === 0 ? 'disabled' : ''}>
                  ${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">Create a category first</option>'}
                </select>
                <input id="p6ItemName" class="input" placeholder="Dish Name" required>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                <input id="p6Price" type="number" step="0.5" min="0" class="input mono" placeholder="Price ₹" required>
                <select id="p6Gst" class="select">
                  ${[0, 5, 12, 18, 28].map((r) => `<option value="${r}" ${r === Number(stateCache.settings?.default_gst_rate ?? 5) ? 'selected' : ''}>GST ${r}%</option>`).join('')}
                </select>
                <select id="p6Diet" class="select">
                  <option value="veg">Veg</option>
                  <option value="non-veg">Non-Veg</option>
                  <option value="vegan">Vegan</option>
                  <option value="egg">Egg</option>
                </select>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center">
                <input id="p6PhotoUrl" class="input" placeholder="Photo URL (optional)">
                <label class="btn btn-xs btn-secondary" style="cursor:pointer">
                  Upload
                  <input type="file" id="p6PhotoFile" accept="image/*" class="hidden">
                </label>
              </div>

              <!-- Variants & Extras -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:4px">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                    <small class="muted">Variants</small>
                    <button type="button" class="btn btn-xs btn-ghost" id="p6AddVarBtn">+ Variant</button>
                  </div>
                  <div id="p6VarsWrap" style="display:flex;flex-direction:column;gap:4px"></div>
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                    <small class="muted">Extras / Add-ons</small>
                    <button type="button" class="btn btn-xs btn-ghost" id="p6AddExtBtn">+ Extra</button>
                  </div>
                  <div id="p6ExtsWrap" style="display:flex;flex-direction:column;gap:4px"></div>
                </div>
              </div>

              <button type="submit" class="btn btn-sm btn-primary" ${categories.length === 0 ? 'disabled' : ''}>+ Add Dish to Menu</button>
            </form>
          </div>

          <!-- Right: Created Categories & Items -->
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${categories.map((c) => `
                <span class="pill pill-orange">${esc(c.name)} <button type="button" data-del-cat="${c.id}" style="background:none;border:none;cursor:pointer">✕</button></span>
              `).join('') || '<span class="muted" style="font-size:12px">No categories added yet.</span>'}
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto">
              ${items.length === 0 ? `
                <div class="empty-state">
                  <h4>No Menu Items Yet</h4>
                  <p>Add categories and dishes on the left, or skip and configure your menu later.</p>
                </div>
              ` : items.map((it) => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:rgba(8,10,16,0.35)">
                  <div style="display:flex;align-items:center;gap:10px">
                    ${it.photo_url ? `<img src="${esc(it.photo_url)}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover">` : ''}
                    <div>
                      <strong>${esc(it.name)}</strong>
                      <div class="muted mono" style="font-size:11px">${formatINR(it.price)} • GST ${it.gst_rate}% • ${(it.variants || []).length} var • ${(it.extras || []).length} extras</div>
                    </div>
                  </div>
                  <button type="button" class="btn btn-xs btn-danger" data-del-mi="${it.id}">Del</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p6BackBtn">← Back</button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost" id="p6SkipBtn">Skip for Now</button>
            <button type="button" class="btn btn-primary btn-shimmer" id="p6NextBtn">Save &amp; Continue →</button>
          </div>
        </div>
      </div>
    `;

    function drawSubRows(arr, containerId, phName, phNum) {
      const box = document.getElementById(containerId);
      box.innerHTML = arr.map((row, idx) => `
        <div style="display:grid;grid-template-columns:1.3fr 0.8fr auto;gap:4px">
          <input class="input" style="padding:5px 7px;font-size:11px" data-sr-name="${idx}" value="${esc(row.name)}" placeholder="${phName}">
          <input type="number" class="input mono" style="padding:5px 7px;font-size:11px" data-sr-val="${idx}" value="${row.val}" placeholder="${phNum}">
          <button type="button" class="btn btn-xs btn-danger" data-sr-del="${idx}">✕</button>
        </div>
      `).join('');
      box.querySelectorAll('[data-sr-name]').forEach((i) => { i.oninput = () => { arr[Number(i.dataset.srName)].name = i.value; }; });
      box.querySelectorAll('[data-sr-val]').forEach((i) => { i.oninput = () => { arr[Number(i.dataset.srVal)].val = Number(i.value || 0); }; });
      box.querySelectorAll('[data-sr-del]').forEach((b) => { b.onclick = () => { arr.splice(Number(b.dataset.srDel), 1); drawSubRows(arr, containerId, phName, phNum); }; });
    }

    document.getElementById('p6AddVarBtn').onclick = () => { variantsDraft.push({ name: '', val: 0 }); drawSubRows(variantsDraft, 'p6VarsWrap', 'Full', '+/- ₹'); };
    document.getElementById('p6AddExtBtn').onclick = () => { extrasDraft.push({ name: '', val: 0 }); drawSubRows(extrasDraft, 'p6ExtsWrap', 'Cheese', '+ ₹'); };

    document.getElementById('p6PhotoFile').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        document.getElementById('p6PhotoUrl').value = await readImageAsDataUrl(file, 240);
        toast('Dish photo attached', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    document.getElementById('p6CatForm').onsubmit = async (e) => {
      e.preventDefault();
      await post('/api/menu/categories', { name: document.getElementById('p6CatName').value, sort_order: categories.length + 1 });
      stateCache = await get('/api/onboarding');
      drawWizard(app);
    };

    body.querySelectorAll('[data-del-cat]').forEach((b) => {
      b.onclick = async () => {
        try {
          await del(`/api/menu/categories/${b.dataset.delCat}`);
          stateCache = await get('/api/onboarding');
          drawWizard(app);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });

    document.getElementById('p6ItemForm').onsubmit = async (e) => {
      e.preventDefault();
      await post('/api/menu/items', {
        category_id: Number(document.getElementById('p6CatSel').value),
        name: document.getElementById('p6ItemName').value,
        price: Number(document.getElementById('p6Price').value),
        gst_rate: Number(document.getElementById('p6Gst').value),
        dietary: document.getElementById('p6Diet').value,
        photo_url: document.getElementById('p6PhotoUrl').value.trim(),
        variants: variantsDraft.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), priceDelta: v.val })),
        extras: extrasDraft.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), price: x.val }))
      });
      stateCache = await get('/api/onboarding');
      drawWizard(app);
    };

    body.querySelectorAll('[data-del-mi]').forEach((b) => {
      b.onclick = async () => {
        await del(`/api/menu/items/${b.dataset.delMi}`);
        stateCache = await get('/api/onboarding');
        drawWizard(app);
      };
    });

    document.getElementById('p6BackBtn').onclick = () => { currentStep = 5; drawWizard(app); };
    document.getElementById('p6SkipBtn').onclick = () => saveAndGo(7, {}, app);
    document.getElementById('p6NextBtn').onclick = () => saveAndGo(7, {}, app);
  }

  // ===== PAGE 7: STAFF INVITATIONS, ROLES & PERMISSIONS =====
  function renderPage7(body, app) {
    const staff = stateCache.staff || [];

    body.innerHTML = `
      <div class="onb-form">
        <div class="onb-grid-2">
          <form id="p7StaffForm" class="card" style="background:rgba(8,10,16,0.35);padding:14px;display:flex;flex-direction:column;gap:10px">
            <strong style="font-size:13px">Invite / Add Staff Member</strong>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input id="p7Name" class="input" placeholder="Full Name" required>
              <input id="p7Email" type="email" class="input" placeholder="Staff Email" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <select id="p7Role" class="select">
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
                <option value="waiter">Waiter</option>
                <option value="chef">Chef</option>
              </select>
              <input id="p7Pass" type="password" class="input" placeholder="Password" required>
              <input id="p7Pin" class="input mono" maxlength="6" minlength="4" placeholder="PIN (4-6)" required>
            </div>
            <div>
              <small class="muted" style="display:block;margin-bottom:6px">Customize Granular Permissions:</small>
              <div id="p7PermsBox" style="display:grid;grid-template-columns:1fr 1fr;gap:5px;max-height:170px;overflow-y:auto"></div>
            </div>
            <button type="submit" class="btn btn-sm btn-primary">+ Invite &amp; Save Staff</button>
          </form>

          <div style="display:flex;flex-direction:column;gap:8px">
            <strong style="font-size:13px">Team Directory (${staff.length})</strong>
            ${staff.map((u) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(8,10,16,0.35)">
                <div>
                  <strong>${esc(u.name)}</strong>
                  <div class="muted mono" style="font-size:11px">${esc(u.email)}</div>
                </div>
                <div style="text-align:right">
                  <span class="pill pill-orange">${esc(u.role)}</span>
                  <div class="muted" style="font-size:10px;margin-top:3px">${u.role === 'owner' ? 'Full Access' : `${(u.custom_permissions || ROLE_DEFAULTS[u.role] || []).length} perms`}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p7BackBtn">← Back</button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost" id="p7SkipBtn">Skip for Now</button>
            <button type="button" class="btn btn-primary btn-shimmer" id="p7NextBtn">Continue to Review →</button>
          </div>
        </div>
      </div>
    `;

    const roleSel = document.getElementById('p7Role');
    const permsBox = document.getElementById('p7PermsBox');
    function drawRolePerms() {
      const defaults = ROLE_DEFAULTS[roleSel.value] || [];
      permsBox.innerHTML = ALL_PERMS.map(([key, label]) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;cursor:pointer">
          <input type="checkbox" class="p7-perm-chk" value="${key}" ${defaults.includes(key) ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label>
      `).join('');
    }
    drawRolePerms();
    roleSel.onchange = drawRolePerms;

    document.getElementById('p7StaffForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const custom_permissions = Array.from(document.querySelectorAll('.p7-perm-chk:checked')).map((c) => c.value);
        await post('/api/staff', {
          name: document.getElementById('p7Name').value,
          email: document.getElementById('p7Email').value,
          role: roleSel.value,
          password: document.getElementById('p7Pass').value,
          pin: document.getElementById('p7Pin').value,
          custom_permissions
        });
        toast('Staff member added!', 'success');
        stateCache = await get('/api/onboarding');
        drawWizard(app);
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    document.getElementById('p7BackBtn').onclick = () => { currentStep = 6; drawWizard(app); };
    document.getElementById('p7SkipBtn').onclick = () => saveAndGo(8, {}, app);
    document.getElementById('p7NextBtn').onclick = () => saveAndGo(8, {}, app);
  }

  // ===== PAGE 8: REVIEW & COMPLETE SETUP =====
  function renderPage8(body, app) {
    const r = stateCache.restaurant || {};
    const b = stateCache.branch || {};
    const s = stateCache.settings || {};

    body.innerHTML = `
      <div class="onb-form">
        <div class="onb-grid-2">
          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <strong>1. Identity</strong>
              <button type="button" class="btn btn-xs btn-ghost" data-rev-edit="1">Edit</button>
            </div>
            <div><strong>${esc(s.restaurant_name || r.name)}</strong> (${esc(r.restaurant_type || 'Unspecified')})</div>
            <div class="muted" style="font-size:12px">${esc(s.tagline || r.description || 'No tagline/description')}</div>
          </div>

          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <strong>2. Location</strong>
              <button type="button" class="btn btn-xs btn-ghost" data-rev-edit="2">Edit</button>
            </div>
            <div>${esc([b.address, b.city, b.state, b.country, b.postal_code].filter(Boolean).join(', ') || 'Not completed yet')}</div>
            <div class="muted mono" style="font-size:11px">${esc(b.phone || '')} ${b.email ? `• ${esc(b.email)}` : ''}</div>
          </div>

          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <strong>3. Business Config</strong>
              <button type="button" class="btn btn-xs btn-ghost" data-rev-edit="3">Edit</button>
            </div>
            <div class="mono">${esc(s.currency_code)} (${esc(s.currency_symbol)}) • ${esc(s.timezone)} • ${esc(s.date_format)}</div>
          </div>

          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <strong>4. Tax &amp; Billing</strong>
              <button type="button" class="btn btn-xs btn-ghost" data-rev-edit="4">Edit</button>
            </div>
            <div class="mono">${s.gst_enabled ? `GST ON (${esc(s.tax_mode)}) • CGST ${s.cgst_rate}% + SGST ${s.sgst_rate}%` : 'GST Disabled'}</div>
            <div class="muted mono" style="font-size:11px">Prefix: ${esc(s.invoice_prefix)} • Start #${s.invoice_start_number}</div>
          </div>
        </div>

        <div class="onb-grid-3">
          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between"><strong>5. Floors &amp; Tables</strong><button type="button" class="btn btn-xs btn-ghost" data-rev-edit="5">Edit</button></div>
            <div class="mono" style="font-size:18px;font-weight:700;margin-top:6px">${(stateCache.floors || []).length} Floors / ${(stateCache.tables || []).length} Tables</div>
          </div>
          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between"><strong>6. Menu Catalog</strong><button type="button" class="btn btn-xs btn-ghost" data-rev-edit="6">Edit</button></div>
            <div class="mono" style="font-size:18px;font-weight:700;margin-top:6px">${(stateCache.categories || []).length} Categories / ${(stateCache.items || []).length} Items</div>
          </div>
          <div class="card" style="background:rgba(8,10,16,0.35);padding:14px">
            <div style="display:flex;justify-content:space-between"><strong>7. Team</strong><button type="button" class="btn btn-xs btn-ghost" data-rev-edit="7">Edit</button></div>
            <div class="mono" style="font-size:18px;font-weight:700;margin-top:6px">${(stateCache.staff || []).length} Staff Member(s)</div>
          </div>
        </div>

        <div class="onb-actions">
          <button type="button" class="btn btn-secondary" id="p8BackBtn">← Back</button>
          <button type="button" class="btn btn-primary btn-lg btn-shimmer" id="p8CompleteBtn">Complete Setup &amp; Launch GRES →</button>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-rev-edit]').forEach((btn) => {
      btn.onclick = () => { currentStep = Number(btn.dataset.revEdit); drawWizard(app); };
    });

    document.getElementById('p8BackBtn').onclick = () => { currentStep = 7; drawWizard(app); };
    document.getElementById('p8CompleteBtn').onclick = async () => {
      try {
        const authData = await post('/api/onboarding/complete', {});
        document.getElementById('onboardingScreen').classList.add('hidden');
        toast('Restaurant Setup complete! Welcome to GRES.', 'success');
        app.finishAuth(authData);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  window.GresOnboarding = { render };
})();
