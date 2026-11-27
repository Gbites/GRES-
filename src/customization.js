/**
 * Canonical 11-module Customization defaults and deep-merge helpers for GRES.
 * Zero fake demo data — every restaurant starts with clean neutral system defaults
 * layered over its own database-backed restaurant, branch, tax, menu, and staff records.
 */

const DEFAULT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_HOURS = Object.fromEntries(
  DEFAULT_DAYS.map((d) => [d, { open: '09:00', close: '23:00', closed: false }])
);

const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'brand_banner', title: 'Restaurant Branding Banner', visible: true, size: 'full', order: 0 },
  { id: 'kpis', title: 'Key Performance Indicators', visible: true, size: 'full', order: 1 },
  { id: 'revenue_chart', title: 'Revenue Trend Chart', visible: true, size: 'half', order: 2 },
  { id: 'floor_snapshot', title: 'Live Floor Snapshot', visible: true, size: 'half', order: 3 },
  { id: 'recent_invoices', title: 'Recent GST Invoices', visible: true, size: 'half', order: 4 },
  { id: 'low_stock', title: 'Low Stock Alerts', visible: true, size: 'half', order: 5 },
  { id: 'payment_mix', title: 'Payment Mode Breakdown', visible: false, size: 'half', order: 6 },
  { id: 'top_dishes', title: 'Top Selling Dishes', visible: false, size: 'half', order: 7 }
];

const DEFAULT_CUSTOMIZATION = {
  appearance: {
    themeMode: 'dark',
    accentColor: '#f97316',
    secondaryColor: '#38bdf8',
    bgColor: '',
    cardBgColor: '',
    fontFamily: 'Plus Jakarta Sans',
    displayFont: 'Outfit',
    fontSize: '13.5',
    spacing: 'comfortable',
    cardRadius: 16,
    cardStyle: 'glass',
    buttonStyle: 'rounded',
    sidebarStyle: 'default',
    sidebarPosition: 'left',
    animations: true
  },
  branding: {
    restaurantName: '',
    tagline: '',
    initials: '',
    logoUrl: '',
    coverUrl: '',
    faviconUrl: '',
    showOnLogin: true,
    loginTitle: '',
    loginSubtitle: '',
    showDashboardBanner: true,
    dashboardGreeting: '',
    showReceiptLogo: true,
    receiptBrandFooter: ''
  },
  dashboard: {
    visibleKpis: ['revenue', 'aov', 'occupancy', 'low_stock'],
    widgets: DEFAULT_DASHBOARD_WIDGETS
  },
  pos: {
    layout: 'grid',
    columns: 'auto',
    cardSize: 'medium',
    showImages: true,
    showGstBadge: true,
    showStation: true,
    showSku: false,
    categoryPosition: 'top',
    buttonSize: 'md',
    quickActions: ['hold', 'discount', 'kot_print', 'settle'],
    shortcutsEnabled: true,
    shortcuts: {
      search: '/',
      fireKot: 'F2',
      settle: 'F9',
      hold: 'F4',
      clearCart: 'Escape'
    }
  },
  tables: {
    defaultShape: 'square',
    defaultSeats: 4,
    gridSnap: 10,
    showSeatPips: true,
    showZoneLabel: true,
    showAmountOnTable: true,
    statusColors: {
      available: '#10b981',
      occupied: '#f97316',
      reserved: '#f59e0b',
      merged: '#38bdf8'
    }
  },
  billing: {
    template: 'modern',
    paperSize: '80mm',
    logoPlacement: 'center',
    header: '',
    footer: '',
    showTaxBreakdown: true,
    showItemGst: true,
    showGstSummary: true,
    showGstin: true,
    showFssai: true,
    showTableInfo: true,
    showCustomerInfo: true,
    paymentInstructions: '',
    upiQrOnInvoice: true
  },
  menu: {
    allowSubcategories: true,
    availableLabels: ['Chef Special', 'Bestseller', 'Spicy', 'Jain', 'Gluten-Free', 'New'],
    showOutOfStock: true,
    defaultGstRate: 5,
    defaultPrepMinutes: 12,
    happyHourEnabled: false,
    happyHourDiscountPct: 0,
    happyHourStart: '16:00',
    happyHourEnd: '19:00',
    packagingCharge: 0
  },
  notifications: {
    soundEnabled: true,
    soundVolume: 0.7,
    channels: {
      inAppToast: true,
      browserPush: false,
      kdsBanner: true
    },
    events: {
      newOrder: true,
      kotReady: true,
      paymentSettled: true,
      lowStock: true,
      delayedOrder: true
    },
    delayedOrderMinutes: 15
  },
  businessRules: {
    openingHours: DEFAULT_HOURS,
    holidays: [],
    gstEnabled: true,
    taxMode: 'exclusive',
    gstin: '',
    cgstRate: 2.5,
    sgstRate: 2.5,
    igstRate: 0,
    compositionRate: 5,
    serviceChargeRate: 0,
    serviceChargeOnTakeaway: false,
    roundOffEnabled: true,
    maxDiscountPct: 100,
    requireManagerForVoid: false,
    allowCancelAfterKot: true,
    cancellationReasons: [
      'Customer changed mind',
      'Ingredient out of stock',
      'Wrong item entered',
      'Kitchen delay'
    ],
    orderStatusLabels: {
      open: 'Open',
      hold: 'On Hold',
      preparing: 'Preparing',
      ready: 'Ready'
    },
    paymentMethods: {
      cash: true,
      upi: true,
      card: true,
      split: true,
      customMethods: []
    }
  },
  advanced: {
    currencyCode: 'INR',
    currencySymbol: '₹',
    language: 'en-IN',
    numberLocale: 'en-IN',
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    printerType: 'browser_thermal',
    autoPrintKot: false,
    autoPrintInvoice: false,
    printerCopies: 1,
    security: {
      sessionTimeoutMinutes: 480,
      pinLength: 4,
      requirePinForVoid: false,
      maskCustomerPhone: false
    }
  }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, source) {
  if (!isPlainObject(source)) return structuredClone(target);
  const out = isPlainObject(target) ? structuredClone(target) : {};
  for (const [k, val] of Object.entries(source)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isPlainObject(val) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], val);
    } else if (val !== undefined) {
      out[k] = structuredClone(val);
    }
  }
  return out;
}

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Hydrates full 11-module customization object from a settings row + optional restaurant row.
 */
function buildCustomization(settingsRow, restaurantRow) {
  const stored = parseJsonSafe(settingsRow?.customization_json, {});
  const hours = parseJsonSafe(settingsRow?.opening_hours_json, DEFAULT_HOURS);
  const holidays = parseJsonSafe(settingsRow?.holidays_json, []);

  const fromRelational = {
    appearance: {
      themeMode: stored?.appearance?.themeMode === 'system' ? 'system' : (settingsRow?.theme_mode || 'dark'),
      accentColor: settingsRow?.accent_color || '#f97316',
      spacing: stored?.appearance?.spacing || settingsRow?.pos_density || 'comfortable'
    },
    branding: {
      restaurantName: settingsRow?.restaurant_name || restaurantRow?.name || '',
      tagline: settingsRow?.tagline || '',
      initials: settingsRow?.brand_initials || '',
      logoUrl: settingsRow?.logo_url || ''
    },
    billing: {
      paperSize: stored?.billing?.paperSize || settingsRow?.thermal_width || '80mm',
      header: settingsRow?.receipt_header || '',
      footer: settingsRow?.receipt_footer || ''
    },
    notifications: {
      soundEnabled: settingsRow ? Boolean(settingsRow.kds_sound_enabled) : true,
      delayedOrderMinutes: settingsRow?.kds_sla_minutes || 15
    },
    businessRules: {
      openingHours: Object.keys(hours).length ? hours : DEFAULT_HOURS,
      holidays: Array.isArray(holidays) ? holidays : [],
      gstEnabled: settingsRow ? settingsRow.gst_enabled !== 0 : true,
      taxMode: settingsRow?.tax_mode || 'exclusive',
      gstin: settingsRow?.gstin || '',
      cgstRate: Number(settingsRow?.cgst_rate ?? 2.5),
      sgstRate: Number(settingsRow?.sgst_rate ?? 2.5),
      igstRate: Number(settingsRow?.igst_rate ?? 0),
      compositionRate: Number(settingsRow?.composition_rate ?? 5),
      serviceChargeRate: Number(settingsRow?.service_charge_rate ?? 0),
      roundOffEnabled: settingsRow ? Boolean(settingsRow.round_off_enabled) : true
    },
    advanced: {
      currencyCode: settingsRow?.currency_code || 'INR',
      currencySymbol: settingsRow?.currency_symbol || '₹',
      timezone: settingsRow?.timezone || 'Asia/Kolkata',
      dateFormat: settingsRow?.date_format || 'DD/MM/YYYY'
    }
  };

  const merged = deepMerge(deepMerge(DEFAULT_CUSTOMIZATION, stored), fromRelational);
  // Keep user-customized widget ordering if present in stored customization
  if (Array.isArray(stored?.dashboard?.widgets) && stored.dashboard.widgets.length > 0) {
    const knownById = new Map(DEFAULT_DASHBOARD_WIDGETS.map((w) => [w.id, w]));
    const seen = new Set();
    const clean = [];
    for (const w of stored.dashboard.widgets) {
      if (!w || !w.id || seen.has(w.id)) continue;
      const base = knownById.get(w.id) || { id: w.id, title: w.title || w.id, visible: true, size: 'half', order: clean.length };
      clean.push({ ...base, ...w });
      seen.add(w.id);
    }
    for (const def of DEFAULT_DASHBOARD_WIDGETS) {
      if (!seen.has(def.id)) clean.push({ ...def, order: clean.length });
    }
    merged.dashboard.widgets = clean;
  }
  return merged;
}

module.exports = {
  DEFAULT_CUSTOMIZATION,
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_HOURS,
  deepMerge,
  buildCustomization
};
