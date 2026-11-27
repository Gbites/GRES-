(function () {
  'use strict';

  const { esc, toast, notifyEvent, get, post, connectWS, playKdsChime } = window.BistroAPI;

  const ICONS = {
    dashboard: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    pos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="4" rx="2"/><line x1="7" y1="20" x2="17" y2="20"/><line x1="12" y1="18" x2="12" y2="20"/></svg>',
    floor: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    kds: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>',
    orders: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    inventory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    analytics: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    staff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', sub: 'Real-time overview & KPIs', perm: 'dashboard:view', icon: ICONS.dashboard },
    { id: 'pos', label: 'POS Terminal', sub: 'Take orders, fire KOT & settle GST bills', perm: 'pos:use', icon: ICONS.pos },
    { id: 'floor', label: 'Floor Plan', sub: 'Drag-and-drop tables, merge & transfer', perm: 'floor:view', icon: ICONS.floor },
    { id: 'kds', label: 'Kitchen (KDS)', sub: 'Live kitchen tickets & prep stations', perm: 'kds:view', icon: ICONS.kds },
    { id: 'orders', label: 'Orders & Bills', sub: 'Active orders, PDF & thermal invoices', perm: 'orders:view', icon: ICONS.orders },
    { id: 'menu', label: 'Menu & Recipes', sub: 'Dishes, GST slabs, variants & BOM recipes', perm: 'menu:view', icon: ICONS.menu },
    { id: 'inventory', label: 'Inventory', sub: 'Stock levels, par alerts & ledger', perm: 'inventory:view', icon: ICONS.inventory },
    { id: 'analytics', label: 'Analytics', sub: 'Revenue, top dishes & multi-branch roll-up', perm: 'analytics:view', icon: ICONS.analytics },
    { id: 'staff', label: 'Staff & Roles', sub: 'Custom roles, RBAC permissions, PINs & accounts', perm: 'staff:view', icon: ICONS.staff },
    { id: 'settings', label: 'Customization', sub: 'Theme, branding, POS, tables, billing & rules', perm: 'settings:view', icon: ICONS.settings }
  ];

  const systemDarkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyLoginBranding(brand) {
    const coverEl = document.getElementById('authCoverBanner');
    const badgeEl = document.getElementById('authBrandBadge');
    const titleEl = document.getElementById('authBrandTitle');
    const subEl = document.getElementById('authBrandSub');
    const showBadge = document.getElementById('authShowcaseBadge');
    const showTitle = document.getElementById('authShowcaseTitle');
    const showCopy = document.getElementById('authShowcaseCopy');

    if (!brand || brand.showOnLogin === false) {
      coverEl?.classList.add('hidden');
      if (badgeEl) badgeEl.textContent = 'G';
      if (titleEl) titleEl.innerHTML = 'GRES <span class="ver-tag">RMS</span>';
      if (subEl) subEl.textContent = 'Run Your Restaurant Smarter.';
      if (showBadge) showBadge.textContent = 'GRES RESTAURANT MANAGEMENT SYSTEM';
      if (showTitle) showTitle.innerHTML = 'Run Your Restaurant <span>Smarter.</span>';
      if (showCopy) showCopy.textContent = 'GRES unifies multi-branch POS, drag-and-drop floor plans, live kitchen display, automatic CGST/SGST invoicing, thermal printing, and recipe inventory on a single real-time platform.';
      return;
    }

    if (coverEl) {
      if (brand.coverUrl) {
        coverEl.style.backgroundImage = `url("${brand.coverUrl.replace(/"/g, '')}")`;
        coverEl.classList.remove('hidden');
      } else {
        coverEl.classList.add('hidden');
      }
    }
    if (badgeEl) {
      if (brand.logoUrl) badgeEl.innerHTML = `<img src="${esc(brand.logoUrl)}" alt="Logo">`;
      else badgeEl.textContent = (brand.initials || (brand.restaurantName || 'G').slice(0, 2)).toUpperCase();
    }
    if (titleEl && brand.restaurantName) {
      titleEl.innerHTML = `${esc(brand.restaurantName)} <span class="ver-tag">GRES</span>`;
    }
    if (subEl) {
      subEl.textContent = brand.tagline || 'Powered by GRES — Run Your Restaurant Smarter.';
    }
    if (showTitle && brand.loginTitle) {
      showTitle.textContent = brand.loginTitle;
    }
    if (showCopy && brand.loginSubtitle) {
      showCopy.textContent = brand.loginSubtitle;
    }
  }

  const app = {
    state: {
      user: null,
      restaurant: null,
      permissions: [],
      branches: [],
      activeBranchId: null,
      activeBranch: null,
      settings: null,
      currentView: 'dashboard'
    },

    hasUnsavedChanges: false,
    onDiscardUnsaved: null,

    can(perm) {
      return this.state.permissions.includes('*') || this.state.permissions.includes(perm);
    },

    applySettings(settings) {
      if (!settings) return;
      this.state.settings = settings;
      const cust = settings.customization || {};
      const ap = cust.appearance || {};
      const br = cust.branding || {};
      const tbl = cust.tables || {};
      const stColors = tbl.statusColors || {};

      const root = document.documentElement;
      const requestedTheme = ap.themeMode || settings.theme_mode || 'dark';
      const resolvedTheme = requestedTheme === 'system'
        ? (systemDarkQuery?.matches ? 'dark' : 'light')
        : requestedTheme;

      root.setAttribute('data-theme', resolvedTheme);
      root.setAttribute('data-density', ap.spacing || settings.pos_density || 'comfortable');
      root.setAttribute('data-card-style', ap.cardStyle || 'glass');
      root.setAttribute('data-btn-style', ap.buttonStyle || 'rounded');
      root.setAttribute('data-sidebar-style', ap.sidebarStyle || 'default');
      root.setAttribute('data-sidebar-pos', ap.sidebarPosition || 'left');
      root.setAttribute('data-animations', ap.animations === false ? 'off' : 'on');

      const accent = ap.accentColor || settings.accent_color || '#f97316';
      const secondary = ap.secondaryColor || '#38bdf8';
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--accent-soft', `${accent}24`);
      root.style.setProperty('--secondary', secondary);
      root.style.setProperty('--radius', `${Math.max(4, Math.min(24, Number(ap.cardRadius ?? 16)))}px`);
      root.style.setProperty('--base-font-size', `${Number(ap.fontSize || 13.5)}px`);

      const fontMap = {
        'Plus Jakarta Sans': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        'Outfit': "'Outfit', 'Plus Jakarta Sans', sans-serif",
        'Inter': "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        'System UI': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        'JetBrains Mono': "'JetBrains Mono', monospace"
      };
      if (ap.fontFamily && fontMap[ap.fontFamily]) root.style.setProperty('--font', fontMap[ap.fontFamily]);
      if (ap.displayFont && fontMap[ap.displayFont]) root.style.setProperty('--font-display', fontMap[ap.displayFont]);

      if (ap.bgColor) {
        root.setAttribute('data-custom-bg', '1');
        root.style.setProperty('--custom-bg', ap.bgColor);
      } else {
        root.removeAttribute('data-custom-bg');
        root.style.removeProperty('--custom-bg');
      }
      if (ap.cardBgColor) {
        root.setAttribute('data-custom-card', '1');
        root.style.setProperty('--custom-card', ap.cardBgColor);
      } else {
        root.removeAttribute('data-custom-card');
        root.style.removeProperty('--custom-card');
      }

      root.style.setProperty('--tbl-available', stColors.available || '#10b981');
      root.style.setProperty('--tbl-occupied', stColors.occupied || accent);
      root.style.setProperty('--tbl-reserved', stColors.reserved || '#f59e0b');
      root.style.setProperty('--tbl-merged', stColors.merged || '#38bdf8');

      const fav = document.getElementById('appFavicon');
      const favSrc = br.faviconUrl || settings.logo_url || '';
      if (fav) fav.href = favSrc;

      const restName = br.restaurantName || settings.restaurant_name || 'GRES Restaurant';
      const brandEl = document.getElementById('brandRestaurantName');
      if (brandEl) brandEl.textContent = restName;
      const logoWrap = document.getElementById('brandLogoWrap');
      if (logoWrap) {
        if (br.logoUrl || settings.logo_url) {
          logoWrap.innerHTML = `<img src="${esc(br.logoUrl || settings.logo_url)}" alt="Logo">`;
        } else {
          const fallbackInit = restName
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase();
          logoWrap.textContent = (br.initials || settings.brand_initials || fallbackInit || 'GR').slice(0, 3);
        }
      }

      const loginBrand = {
        restaurantName: restName,
        tagline: br.tagline ?? settings.tagline ?? '',
        initials: br.initials || settings.brand_initials || '',
        logoUrl: br.logoUrl || settings.logo_url || '',
        coverUrl: br.coverUrl || '',
        showOnLogin: br.showOnLogin !== false,
        loginTitle: br.loginTitle || '',
        loginSubtitle: br.loginSubtitle || ''
      };
      try {
        if (loginBrand.showOnLogin) localStorage.setItem('gres_login_brand', JSON.stringify(loginBrand));
        else localStorage.removeItem('gres_login_brand');
      } catch { /* ignore storage restrictions */ }
      applyLoginBranding(loginBrand);

      if (this.state.currentView) {
        const curNav = NAV_ITEMS.find((n) => n.id === this.state.currentView);
        if (curNav) {
          document.title = `${curNav.label} — ${restName} | GRES`;
        }
      }
    },

    openModal(title, html) {
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = html;
      document.getElementById('modalRoot').classList.remove('hidden');
    },

    closeModal() {
      document.getElementById('modalRoot').classList.add('hidden');
    },

    async navigate(viewId) {
      if (this.hasUnsavedChanges && this.state.currentView !== viewId) {
        if (!window.confirm('You have unsaved customization changes. Discard and switch view?')) {
          return;
        }
        if (typeof this.onDiscardUnsaved === 'function') this.onDiscardUnsaved();
        this.hasUnsavedChanges = false;
        this.onDiscardUnsaved = null;
      }

      const allowed = NAV_ITEMS.filter((n) => this.can(n.perm));
      const target = allowed.find((n) => n.id === viewId) || allowed[0];
      if (!target) return;

      this.state.currentView = target.id;
      document.getElementById('pageTitle').textContent = target.label;
      document.getElementById('pageSubtitle').textContent = target.sub;
      document.title = `${target.label} — ${this.state.settings?.restaurant_name || 'GRES'} | GRES`;
      document.getElementById('sidebar').classList.remove('open');

      renderSidebar();

      const viewRoot = document.getElementById('viewRoot');
      viewRoot.innerHTML = '<div class="muted mono" style="padding:36px;text-align:center">GRES • Loading module...</div>';

      try {
        switch (target.id) {
          case 'dashboard': await window.BistroAdminViews.renderDashboard(viewRoot, this); break;
          case 'pos': await window.BistroPosFloorKds.renderPOS(viewRoot, this); break;
          case 'floor': await window.BistroPosFloorKds.renderFloorPlan(viewRoot, this); break;
          case 'kds': await window.BistroPosFloorKds.renderKDS(viewRoot, this); break;
          case 'orders': await window.BistroAdminViews.renderOrdersAndInvoices(viewRoot, this); break;
          case 'menu': await window.BistroAdminViews.renderMenu(viewRoot, this); break;
          case 'inventory': await window.BistroAdminViews.renderInventory(viewRoot, this); break;
          case 'analytics': await window.BistroAdminViews.renderAnalytics(viewRoot, this); break;
          case 'staff': await window.BistroAdminViews.renderStaff(viewRoot, this); break;
          case 'settings': await window.BistroAdminViews.renderSettings(viewRoot, this); break;
        }
        runViewAnimations(viewRoot);
      } catch (err) {
        viewRoot.innerHTML = `<div class="card" style="color:var(--danger)">Failed to load view: ${esc(err.message)}</div>`;
      }
    },

    async refreshSession() {
      const data = await get('/api/auth/me');
      applyAuthPayload(data);
    },

    async finishAuth(data) {
      return finishAuth(data);
    }
  };

  window.GresApp = app;
  window.BistroApp = app;

  function runViewAnimations(root) {
    const targets = root.querySelectorAll('.kpi-card, .menu-tile, .kds-card, .card');
    targets.forEach((el, idx) => {
      el.classList.add('anim-item', 'spotlight-card');
      el.style.setProperty('--stagger', String(Math.min(idx, 16)));
      if (!el.dataset.spotBound) {
        el.dataset.spotBound = '1';
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty('--mx', `${e.clientX - r.left}px`);
          el.style.setProperty('--my', `${e.clientY - r.top}px`);
        });
      }
    });

    // Smooth count-up on KPI values
    const sym = app.state.settings?.currency_symbol || '₹';
    root.querySelectorAll('.kpi-value[data-count]').forEach((el) => {
      const target = Number(el.dataset.count || 0);
      const isInr = el.dataset.format === 'inr';
      const start = performance.now();
      const dur = 520;
      function frame(now) {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const cur = target * eased;
        el.textContent = isInr
          ? `${sym}${cur.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : String(Math.round(cur));
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function applyAuthPayload(data) {
    app.state.user = data.user;
    app.state.restaurant = data.restaurant || null;
    app.state.permissions = data.permissions;
    app.state.branches = data.branches;
    app.state.activeBranchId = data.activeBranchId;
    app.state.activeBranch = data.activeBranch;
    app.applySettings(data.settings || { restaurant_name: data.restaurant?.name || data.activeBranch?.name || '' });

    document.getElementById('userAvatar').textContent = (data.user.name || 'U')[0].toUpperCase();
    document.getElementById('userName').textContent = data.user.name;
    document.getElementById('userRole').textContent = data.user.role;
    document.getElementById('brandBranchCode').textContent = data.activeBranch?.code || '';

    const branchSelect = document.getElementById('branchSelect');
    branchSelect.innerHTML = data.branches.map((b) => `
      <option value="${b.id}" ${b.id === data.activeBranchId ? 'selected' : ''}>${esc(b.name)} (${esc(b.code)})</option>
    `).join('');
    branchSelect.disabled = data.user.role !== 'owner';

    renderSidebar();
  }

  async function finishAuth(data) {
    applyAuthPayload(data);
    const needsOnboarding = data.user?.role === 'owner'
      && data.restaurant
      && !data.restaurant.onboarding_completed
      && window.GresOnboarding;

    document.getElementById('authScreen').classList.add('hidden');
    if (needsOnboarding) {
      document.getElementById('appShell').classList.add('hidden');
      await window.GresOnboarding.render(app);
      return;
    }

    document.getElementById('onboardingScreen')?.classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    resetIdleTimer();
    await app.navigate('dashboard');
    initRealtime();
  }

  function renderSidebar() {
    const nav = document.getElementById('sidebarNav');
    const allowed = NAV_ITEMS.filter((n) => app.can(n.perm));
    nav.innerHTML = allowed.map((n) => `
      <button class="nav-btn ${app.state.currentView === n.id ? 'active' : ''}" data-nav="${n.id}">
        <span>${n.icon}</span>
        <span>${esc(n.label)}</span>
      </button>
    `).join('');
    nav.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.onclick = () => app.navigate(btn.dataset.nav);
    });
  }

  // ===== Auth Handlers =====
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('authError').classList.add('hidden');
      const mode = tab.dataset.authTab;
      document.getElementById('loginForm').classList.toggle('hidden', mode !== 'password');
      document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
      document.getElementById('pinForm').classList.toggle('hidden', mode !== 'pin');
    };
  });

  document.querySelectorAll('.pin-key[data-key]').forEach((k) => {
    k.onclick = () => {
      const inp = document.getElementById('loginPin');
      if (k.dataset.key === 'C') inp.value = '';
      else if (inp.value.length < 6) inp.value += k.dataset.key;
    };
  });

  document.getElementById('registerForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('authError');
    errEl.classList.add('hidden');
    try {
      const data = await post('/api/auth/register', {
        restaurantName: document.getElementById('regRestName').value,
        branchName: document.getElementById('regBranchName').value,
        branchCode: document.getElementById('regBranchCode').value,
        adminName: document.getElementById('regAdminName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
        pin: document.getElementById('regPin').value
      });
      await finishAuth(data);
      toast(data.restaurant && !data.restaurant.onboarding_completed
        ? 'Workspace registered — complete Restaurant Setup to launch!'
        : 'Restaurant workspace created!', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('authError');
    errEl.classList.add('hidden');
    try {
      const data = await post('/api/auth/login', {
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      });
      await finishAuth(data);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };

  document.getElementById('pinForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('authError');
    errEl.classList.add('hidden');
    try {
      const data = await post('/api/auth/pin', {
        restaurantCode: document.getElementById('loginWorkspaceCode').value,
        pin: document.getElementById('loginPin').value
      });
      document.getElementById('loginPin').value = '';
      await finishAuth(data);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };

  document.getElementById('logoutBtn').onclick = async () => {
    await post('/api/auth/logout');
    app.state.user = null;
    document.getElementById('onboardingScreen')?.classList.add('hidden');
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  };

  document.getElementById('pinSwitchBtn').onclick = () => {
    app.openModal('Quick Staff PIN Switch', `
      <form id="quickPinForm" style="display:flex;flex-direction:column;gap:12px">
        <label class="field-label">Enter Staff PIN
          <input id="quickPinInput" type="password" maxlength="6" class="input pin-display" autofocus required>
        </label>
        <button type="submit" class="btn btn-primary">Switch User</button>
      </form>
    `);
    document.getElementById('quickPinForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = await post('/api/auth/pin', {
          pin: document.getElementById('quickPinInput').value,
          branchId: app.state.activeBranchId
        });
        app.closeModal();
        applyAuthPayload(data);
        app.navigate(app.state.currentView);
        toast(`Switched terminal to ${data.user.name} (${data.user.role})`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };

  document.getElementById('branchSelect').onchange = async (e) => {
    try {
      const data = await post('/api/auth/branch', { branchId: Number(e.target.value) });
      applyAuthPayload(data);
      app.state.pos = null;
      app.navigate(app.state.currentView);
      toast(`Switched to ${data.activeBranch.name}`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  let idleTimer = null;
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (!app.state.user) return;
    const mins = Number(app.state.settings?.customization?.advanced?.security?.sessionTimeoutMinutes || 0);
    if (mins <= 0) return;
    idleTimer = setTimeout(async () => {
      if (!app.state.user) return;
      try { await post('/api/auth/logout'); } catch { /* ignore */ }
      app.state.user = null;
      app.hasUnsavedChanges = false;
      document.getElementById('onboardingScreen')?.classList.add('hidden');
      document.getElementById('appShell')?.classList.add('hidden');
      document.getElementById('authScreen')?.classList.remove('hidden');
      toast('Signed out due to inactivity timeout', 'info');
    }, mins * 60000);
  }
  ['pointerdown', 'keydown', 'click'].forEach((evt) => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  });

  // Modal, Unsaved Guard & Mobile Sidebar listeners
  window.addEventListener('beforeunload', (e) => {
    if (app.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  systemDarkQuery?.addEventListener?.('change', () => {
    if (app.state.settings?.customization?.appearance?.themeMode === 'system') {
      app.applySettings(app.state.settings);
    }
  });

  document.getElementById('loginWorkspaceCode')?.addEventListener('change', async (e) => {
    const code = e.target.value.trim();
    if (!code) return;
    try {
      const brand = await get(`/api/auth/brand?code=${encodeURIComponent(code)}`);
      if (brand) applyLoginBranding(brand);
    } catch { /* ignore */ }
  });

  document.getElementById('modalCloseBtn').onclick = () => app.closeModal();
  document.getElementById('modalRoot').onclick = (e) => {
    if (e.target.id === 'modalRoot') app.closeModal();
  };
  document.getElementById('openSidebarBtn').onclick = () => document.getElementById('sidebar').classList.add('open');
  document.getElementById('closeSidebarBtn').onclick = () => document.getElementById('sidebar').classList.remove('open');

  // ===== Real-time WebSocket Sync =====
  let wsInitialized = false;
  const alertedDelayedIds = new Set();
  function initRealtime() {
    if (wsInitialized) return;
    wsInitialized = true;

    // Periodic check for delayed open orders against configured notification threshold
    setInterval(async () => {
      if (!app.state.user) return;
      const noti = app.state.settings?.customization?.notifications;
      if (noti?.events?.delayedOrder === false) return;
      const mins = Math.max(1, Number(noti?.delayedOrderMinutes || app.state.settings?.kds_sla_minutes || 15));
      try {
        const active = await get('/api/orders?status=active');
        const now = Date.now();
        for (const o of active) {
          if (alertedDelayedIds.has(o.id)) continue;
          const ageMins = (now - new Date(String(o.created_at).replace(' ', 'T') + 'Z').getTime()) / 60000;
          if (ageMins >= mins) {
            alertedDelayedIds.add(o.id);
            notifyEvent('delayedOrder', `Delayed Order Alert: ${o.order_number} (${Math.round(ageMins)}m open)`, 'error');
          }
        }
      } catch { /* ignore transient poll errors */ }
    }, 45000);

    connectWS((ev) => {
      if (!app.state.user) return;
      if (ev.restaurantId && ev.restaurantId !== app.state.user.restaurant_id) return;
      if (ev.branchId && ev.branchId !== app.state.activeBranchId) return;

      if (ev.type === 'kds:new_kot') {
        notifyEvent('newOrder', `New Kitchen Ticket: ${ev.kotNumber}`, 'info');
      } else if (ev.type === 'kds:updated') {
        const noti = app.state.settings?.customization?.notifications;
        if (noti?.events?.kotReady !== false) notifyEvent('kotReady', 'Kitchen ticket status updated', 'info');
      } else if (ev.type === 'orders:settled') {
        notifyEvent('paymentSettled', 'Invoice settled & recorded', 'success');
      } else if (ev.type === 'inventory:updated') {
        const noti = app.state.settings?.customization?.notifications;
        if (noti?.events?.lowStock !== false) toast('Inventory levels updated', 'info');
      }

      if (ev.type === 'settings:updated' && ev.settings) {
        app.applySettings(ev.settings);
      }

      const v = app.state.currentView;
      if (v === 'settings' && app.hasUnsavedChanges) return;
      const shouldRefresh =
        (ev.type.startsWith('orders:') && ['dashboard', 'pos', 'floor', 'kds', 'orders'].includes(v)) ||
        (ev.type.startsWith('kds:') && ['kds', 'pos', 'orders'].includes(v)) ||
        (ev.type.startsWith('tables:') && ['floor', 'pos', 'dashboard'].includes(v)) ||
        (ev.type.startsWith('inventory:') && ['inventory', 'dashboard', 'menu'].includes(v)) ||
        (ev.type.startsWith('menu:') && ['menu', 'pos'].includes(v));

      if (shouldRefresh && !document.getElementById('floorCanvas')?.querySelector('.editing')) {
        app.navigate(v);
      }
    });
  }

  // Auto-restore session if cookie is valid, then dismiss GRES boot screen
  (async function boot() {
    const loader = document.getElementById('bootLoader');
    const authScreen = document.getElementById('authScreen');
    try {
      const cached = localStorage.getItem('gres_login_brand');
      if (cached) applyLoginBranding(JSON.parse(cached));
    } catch { /* ignore */ }
    try {
      const data = await get('/api/auth/me');
      await finishAuth(data);
    } catch {
      authScreen?.classList.remove('hidden');
    } finally {
      setTimeout(() => loader?.classList.add('fade-out'), 260);
    }
  })();
})();
