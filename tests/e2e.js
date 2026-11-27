const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createApp } = require('../server');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gres-e2e-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const { server, db } = createApp({ dbPath });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function createClient() {
    let cookieHeader = '';
    return {
      getCookie: () => cookieHeader,
      async api(method, urlPath, body) {
        const headers = {};
        if (cookieHeader) headers.Cookie = cookieHeader;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${baseUrl}${urlPath}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookieHeader = setCookie.split(';')[0];
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json')
          ? await res.json()
          : Buffer.from(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, data };
      }
    };
  }

  const clientA = createClient();
  const clientB = createClient();
  let wsA = null;
  let wsB = null;

  try {
    // 1. Fresh DB must contain ZERO seeded/demo records across all tables
    for (const tbl of [
      'restaurants', 'branches', 'users', 'dining_tables',
      'menu_categories', 'menu_items', 'ingredients', 'orders', 'invoices'
    ]) {
      const cnt = db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get().c;
      assert.equal(cnt, 0, `Fresh DB table ${tbl} must start with 0 rows`);
    }

    // 2. Unauthenticated access must fail (401)
    const unauth = await clientA.api('GET', '/api/orders');
    assert.equal(unauth.status, 401);

    // 3. Register Restaurant A — starts completely empty except for its registering admin
    const regA = await clientA.api('POST', '/api/auth/register', {
      restaurantName: 'Alpha Diner',
      branchName: 'Alpha Main',
      branchCode: 'ALPHA1',
      adminName: 'Admin Alpha',
      email: 'alpha@test.local',
      password: 'password123',
      pin: '1111'
    });
    assert.equal(regA.status, 201);
    assert.equal(regA.data.user.role, 'owner');
    assert.equal(regA.data.restaurant.onboarding_completed, 0);
    assert.equal(regA.data.restaurant.onboarding_step, 1);
    assert.equal(regA.data.settings.currency_code, 'INR');
    assert.equal(regA.data.settings.currency_symbol, '₹');
    assert.equal(regA.data.branches.length, 1);

    // 3b. Onboarding step persistence, validation, resume & completion
    const incompleteAttempt = await clientA.api('POST', '/api/onboarding/complete');
    assert.equal(incompleteAttempt.status, 400);

    const step1 = await clientA.api('PUT', '/api/onboarding/step', {
      step: 2,
      data: {
        identity: {
          name: 'Alpha Bistro',
          restaurant_type: 'Fine Dining',
          description: 'Wood-fired coastal dining',
          tagline: 'Fresh every evening',
          brand_initials: 'AB',
          logo_url: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA='
        }
      }
    });
    assert.equal(step1.status, 200);
    assert.equal(step1.data.step, 2);

    const step234 = await clientA.api('PUT', '/api/onboarding/step', {
      step: 5,
      data: {
        location: {
          country: 'India',
          state: 'Karnataka',
          city: 'Bengaluru',
          address: '42 Indiranagar 100ft Rd',
          postal_code: '560038',
          phone: '+91-80-41112222',
          email: 'hello@alphabistro.in',
          map_lat: 12.9784,
          map_lng: 77.6408
        },
        business: {
          currency_code: 'INR',
          currency_symbol: '₹',
          timezone: 'Asia/Kolkata',
          date_format: 'DD/MM/YYYY',
          opening_hours: { Monday: { open: '11:00', close: '23:00', closed: false } },
          holidays: ['2026-08-15']
        },
        tax: {
          gst_enabled: true,
          gstin: '29AABCU9603R1ZM',
          tax_mode: 'exclusive',
          cgst_rate: 2.5,
          sgst_rate: 2.5,
          igst_rate: 0,
          service_charge_rate: 5,
          invoice_prefix: 'ABINV',
          invoice_start_number: 2001,
          receipt_footer: 'Thank you for visiting Alpha Bistro!'
        }
      }
    });
    assert.equal(step234.status, 200);

    // Resume simulation via fresh GET /api/onboarding
    const resumed = await clientA.api('GET', '/api/onboarding');
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.restaurant.onboarding_step, 5);
    assert.equal(resumed.data.restaurant.restaurant_type, 'Fine Dining');
    assert.equal(resumed.data.branch.city, 'Bengaluru');
    assert.equal(resumed.data.settings.invoice_prefix, 'ABINV');
    assert.equal(resumed.data.settings.invoice_start_number, 2001);

    const floorRes = await clientA.api('POST', '/api/floors', {
      name: 'Ground Floor',
      sections: ['Main Hall', 'Patio'],
      sort_order: 1
    });
    assert.equal(floorRes.status, 201);
    assert.deepEqual(floorRes.data.sections, ['Main Hall', 'Patio']);

    const doneOnb = await clientA.api('POST', '/api/onboarding/complete');
    assert.equal(doneOnb.status, 200);
    assert.equal(doneOnb.data.restaurant.onboarding_completed, 1);
    const meAfterOnb = await clientA.api('GET', '/api/auth/me');
    assert.equal(meAfterOnb.data.restaurant.onboarding_completed, 1);

    // Reset service_charge_rate back to 0 so rest of billing checks match clean defaults
    await clientA.api('PUT', '/api/settings', { service_charge_rate: 0 });

    // Verify Restaurant A starts completely empty (0 tables, 0 menu, 0 inventory, 0 orders, 0 invoices, 1 user)
    assert.equal((await clientA.api('GET', '/api/tables')).data.length, 0);
    const emptyMenuA = (await clientA.api('GET', '/api/menu')).data;
    assert.equal(emptyMenuA.categories.length, 0);
    assert.equal(emptyMenuA.items.length, 0);
    assert.equal((await clientA.api('GET', '/api/inventory')).data.ingredients.length, 0);
    assert.equal((await clientA.api('GET', '/api/orders')).data.length, 0);
    assert.equal((await clientA.api('GET', '/api/invoices')).data.length, 0);
    assert.equal((await clientA.api('GET', '/api/staff')).data.length, 1);
    assert.equal((await clientA.api('GET', '/api/analytics')).data.kpis.totalRevenue, 0);

    // 4. Register Restaurant B with the same PIN (1111) to test strict tenant isolation
    const regB = await clientB.api('POST', '/api/auth/register', {
      restaurantName: 'Beta Kitchen',
      branchName: 'Beta Hub',
      branchCode: 'BETA1',
      adminName: 'Admin Beta',
      email: 'beta@test.local',
      password: 'password123',
      pin: '1111'
    });
    assert.equal(regB.status, 201);
    assert.notEqual(regA.data.user.restaurant_id, regB.data.user.restaurant_id);

    // Connect authenticated WebSockets for both tenants
    const wsEventsA = [];
    const wsEventsB = [];
    wsA = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: clientA.getCookie() } });
    wsB = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: clientB.getCookie() } });
    await Promise.all([
      new Promise((r, j) => { wsA.on('open', r); wsA.on('error', j); }),
      new Promise((r, j) => { wsB.on('open', r); wsB.on('error', j); })
    ]);
    wsA.on('message', (b) => wsEventsA.push(JSON.parse(b.toString('utf8'))));
    wsB.on('message', (b) => wsEventsB.push(JSON.parse(b.toString('utf8'))));

    // 5. Restaurant A builds tables, category, ingredient, menu item + recipe
    const tA = (await clientA.api('POST', '/api/tables', { name: 'A-1', zone: 'Main', seats: 4, shape: 'square', x: 40, y: 40 })).data;
    const tB = (await clientA.api('POST', '/api/tables', { name: 'A-2', zone: 'Main', seats: 4, shape: 'square', x: 180, y: 40 })).data;
    const tC = (await clientA.api('POST', '/api/tables', { name: 'A-3', zone: 'Main', seats: 2, shape: 'round', x: 320, y: 40 })).data;

    // Layout batch save
    const layoutSave = await clientA.api('PUT', '/api/tables/layout/batch', {
      layouts: [{ id: tA.id, x: 260, y: 310, width: 120, height: 120 }]
    });
    assert.equal(layoutSave.status, 200);

    const catA = (await clientA.api('POST', '/api/menu/categories', { name: 'Mains', sort_order: 1 })).data;
    const ingA = (await clientA.api('POST', '/api/inventory', {
      name: 'Paneer', unit: 'kg', stock_qty: 10, par_level: 2, unit_cost: 400
    })).data;
    const dishA = (await clientA.api('POST', '/api/menu/items', {
      category_id: catA.id,
      name: 'Paneer Roast',
      price: 350,
      gst_rate: 5,
      variants: [{ name: 'Regular', priceDelta: 0 }, { name: 'Large', priceDelta: 150 }]
    })).data;
    const recRes = await clientA.api('PUT', `/api/menu/items/${dishA.id}/recipe`, {
      ingredients: [{ ingredient_id: ingA.id, qty_per_serving: 0.25 }]
    });
    assert.equal(recRes.status, 200);

    // 6. Restaurant A creates Dine-In order, transfers tA -> tB, merges tC -> tB, updates KDS, settles & checks PDF
    const ordRes = await clientA.api('POST', '/api/orders', {
      order_type: 'dine_in',
      table_id: tA.id,
      items: [{ menu_item_id: dishA.id, variant_name: 'Regular', qty: 2, notes: 'Less salt' }]
    });
    assert.equal(ordRes.status, 201);
    const orderId = ordRes.data.id;

    await new Promise((r) => setTimeout(r, 90));
    assert.ok(wsEventsA.some((e) => e.type === 'kds:new_kot' && e.orderId === orderId));
    assert.equal(
      wsEventsB.some((e) => e.type === 'kds:new_kot' && e.orderId === orderId),
      false,
      'Restaurant B WebSocket must NEVER receive Restaurant A events'
    );

    assert.equal((await clientA.api('POST', '/api/tables/transfer', { fromTableId: tA.id, toTableId: tB.id })).status, 200);
    assert.equal((await clientA.api('POST', '/api/tables/merge', { primaryTableId: tB.id, secondaryTableIds: [tC.id] })).status, 200);
    assert.equal((await clientA.api('PATCH', `/api/orders/${orderId}/items/${ordRes.data.items[0].id}`, { status: 'preparing' })).status, 200);

    const settleRes = await clientA.api('POST', `/api/orders/${orderId}/settle`, {
      paymentMode: 'cash',
      amountTendered: 1000,
      discountType: 'percent',
      discountValue: 10
    });
    assert.equal(settleRes.status, 200);
    assert.ok(settleRes.data.grand_total > 0);
    assert.ok(settleRes.data.cgst_amount > 0 && settleRes.data.sgst_amount > 0);

    // Verify recipe stock deduction (10 - 0.5 = 9.5)
    const ingAfter = (await clientA.api('GET', '/api/inventory')).data.ingredients.find((i) => i.id === ingA.id);
    assert.equal(ingAfter.stock_qty, 9.5);

    // Verify PDF download
    const pdfA = await clientA.api('GET', `/api/invoices/${settleRes.data.id}/pdf`);
    assert.equal(pdfA.status, 200);
    assert.equal(pdfA.data.slice(0, 5).toString('utf8'), '%PDF-');

    // 7. Strict Cross-Tenant Isolation Checks from Restaurant B
    assert.equal((await clientB.api('GET', '/api/tables')).data.length, 0);
    assert.equal((await clientB.api('GET', '/api/menu')).data.items.length, 0);
    assert.equal((await clientB.api('GET', '/api/inventory')).data.ingredients.length, 0);
    assert.equal((await clientB.api('GET', '/api/invoices')).data.length, 0);
    assert.equal((await clientB.api('GET', '/api/staff')).data.length, 1);
    assert.equal((await clientB.api('GET', '/api/analytics?scope=all')).data.kpis.totalRevenue, 0);
    assert.equal((await clientB.api('GET', `/api/invoices/${settleRes.data.id}`)).status, 404);
    assert.equal((await clientB.api('GET', `/api/invoices/${settleRes.data.id}/pdf`)).status, 404);

    // 8. Scoped PIN login: BETA1 + 1111 logs into Beta, never Alpha
    const pinClient = createClient();
    const pinNoCode = await pinClient.api('POST', '/api/auth/pin', { pin: '1111' });
    assert.equal(pinNoCode.status, 400);
    const pinBeta = await pinClient.api('POST', '/api/auth/pin', { restaurantCode: 'BETA1', pin: '1111' });
    assert.equal(pinBeta.status, 200);
    assert.equal(pinBeta.data.user.restaurant_id, regB.data.user.restaurant_id);

    // 9. RBAC check with custom permissions: Chef granted custom analytics:view succeeds, while settings:edit remains 403
    const chefCreate = await clientA.api('POST', '/api/staff', {
      name: 'Chef A',
      email: 'chefa@test.local',
      password: 'password123',
      pin: '5555',
      role: 'chef',
      custom_permissions: ['kds:view', 'kds:update', 'menu:view', 'analytics:view']
    });
    assert.equal(chefCreate.status, 201);
    const chefSwitch = await clientA.api('POST', '/api/auth/pin', { pin: '5555' });
    assert.equal(chefSwitch.status, 200);
    assert.ok(chefSwitch.data.permissions.includes('analytics:view'));
    assert.equal((await clientA.api('PUT', '/api/settings', { theme_mode: 'light' })).status, 403);

    // 10. Menu extras & server-side pricing calculation check
    const ownerBack = await clientA.api('POST', '/api/auth/pin', { pin: '1111' });
    assert.equal(ownerBack.status, 200);
    const catExtra = (await clientA.api('GET', '/api/menu')).data.categories[0];
    const exItemRes = await clientA.api('POST', '/api/menu/items', {
      category_id: catExtra.id,
      name: 'Truffle Naan',
      price: 100,
      gst_rate: 5,
      photo_url: 'https://example.com/naan.jpg',
      extras: [{ name: 'Extra Butter', price: 30 }, { name: 'Garlic Topping', price: 20 }]
    });
    assert.equal(exItemRes.status, 201);
    assert.equal(exItemRes.data.extras.length, 2);
    const exOrd = await clientA.api('POST', '/api/orders', {
      order_type: 'takeaway',
      items: [{ menu_item_id: exItemRes.data.id, extras: ['Extra Butter'], qty: 2 }]
    });
    assert.equal(exOrd.status, 201);
    assert.equal(exOrd.data.items[0].unit_price, 130);
    assert.equal(exOrd.data.bill.subtotal, 260);

    // 11. Comprehensive 11-Module Customization Studio E2E checks
    const custInit = await clientA.api('GET', '/api/customization');
    assert.equal(custInit.status, 200);
    assert.ok(custInit.data.customization.appearance);
    assert.ok(Array.isArray(custInit.data.customization.dashboard.widgets));

    const custSave = await clientA.api('PUT', '/api/customization', {
      customization: {
        appearance: { themeMode: 'system', accentColor: '#2563eb', fontFamily: 'Outfit', spacing: 'spacious', buttonStyle: 'pill' },
        branding: { showOnLogin: true, loginTitle: 'Alpha Terminal' },
        pos: { layout: 'list', columns: '4', categoryPosition: 'left', buttonSize: 'lg' },
        billing: { paperSize: 'A5', template: 'classic', paymentInstructions: 'Scan UPI at desk' },
        menu: { packagingCharge: 25 },
        notifications: { soundVolume: 0.5, delayedOrderMinutes: 20 },
        businessRules: { maxDiscountPct: 25, paymentMethods: { cash: true, upi: true, card: true, split: true, customMethods: ['Sodexo'] } },
        advanced: { numberLocale: 'en-US', security: { maskCustomerPhone: true } }
      }
    });
    assert.equal(custSave.status, 200);
    assert.equal(custSave.data.customization.appearance.themeMode, 'system');
    assert.equal(custSave.data.customization.billing.paperSize, 'A5');
    assert.equal(custSave.data.customization.businessRules.maxDiscountPct, 25);

    // Ensure Restaurant B stays completely isolated with default accent & theme
    const custB = await clientB.api('GET', '/api/customization');
    assert.equal(custB.data.customization.appearance.accentColor, '#f97316');
    assert.equal(custB.data.customization.businessRules.maxDiscountPct, 100);

    // Verify public brand lookup returns Alpha non-sensitive login branding
    const brandLookup = await clientA.api('GET', '/api/auth/brand?code=ALPHA1');
    assert.equal(brandLookup.status, 200);
    assert.equal(brandLookup.data.loginTitle, 'Alpha Terminal');

    // Verify maxDiscountPct enforcement & takeaway packaging charge on order
    const tooHighDisc = await clientA.api('PATCH', `/api/orders/${exOrd.data.id}`, { discount_type: 'percent', discount_value: 50 });
    assert.equal(tooHighDisc.status, 400);
    const reloadedEx = await clientA.api('GET', `/api/orders/${exOrd.data.id}`);
    assert.equal(reloadedEx.data.bill.packaging_charge, 25);

    // Verify A5 PDF invoice renders cleanly
    const pdfA5 = await clientA.api('GET', `/api/invoices/${settleRes.data.id}/pdf`);
    assert.equal(pdfA5.status, 200);
    assert.equal(pdfA5.data.slice(0, 5).toString('utf8'), '%PDF-');

    // Verify custom roles CRUD + subcategory + labels + table appearance + backup export
    const roleRes = await clientA.api('POST', '/api/roles', {
      name: 'Shift Captain',
      description: 'Floor + POS discounts',
      permissions: ['pos:use', 'floor:view', 'orders:discount'],
      color: '#10b981'
    });
    assert.equal(roleRes.status, 201);
    assert.equal((await clientA.api('GET', '/api/roles')).data.length, 1);

    const subCatRes = await clientA.api('POST', '/api/menu/categories', {
      name: 'Wood-Fired Specials',
      parent_id: catExtra.id,
      label: 'Seasonal',
      sort_order: 2
    });
    assert.equal(subCatRes.status, 201);
    assert.equal(subCatRes.data.parent_id, catExtra.id);

    const lblItem = await clientA.api('POST', '/api/menu/items', {
      category_id: subCatRes.data.id,
      name: 'Burrata Margherita',
      price: 420,
      labels: ['Chef Special', 'Bestseller']
    });
    assert.equal(lblItem.status, 201);
    assert.deepEqual(lblItem.data.labels, ['Chef Special', 'Bestseller']);

    const tblUpdate = await clientA.api('PUT', `/api/tables/${tA.id}`, {
      color: '#38bdf8',
      label_override: 'VIP-01',
      size_scale: 1.25
    });
    assert.equal(tblUpdate.status, 200);
    assert.equal(tblUpdate.data.label_override, 'VIP-01');

    const backupRes = await clientA.api('GET', '/api/backup/export');
    assert.equal(backupRes.status, 200);
    assert.equal(backupRes.data.roles.length, 1);

    // Reset section to default preserves restaurant identity
    const resetRes = await clientA.api('POST', '/api/customization/reset', { section: 'appearance' });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.data.customization.appearance.accentColor, '#f97316');
    assert.equal(resetRes.data.customization.billing.paperSize, 'A5');

    // 12. Regression tests for security, billing integrity, duplicate invoice prevention & RBAC
    // Duplicate settlement on already settled order returns 400
    const dupSettle = await clientA.api('POST', `/api/orders/${orderId}/settle`, { paymentMode: 'upi' });
    assert.equal(dupSettle.status, 400);

    // Mutating or voiding items on a settled order is blocked (400)
    const editSettledOrd = await clientA.api('PATCH', `/api/orders/${orderId}`, { notes: 'tamper' });
    assert.equal(editSettledOrd.status, 400);
    const voidSettledItem = await clientA.api('PATCH', `/api/orders/${orderId}/items/${ordRes.data.items[0].id}`, { status: 'void' });
    assert.equal(voidSettledItem.status, 400);

    // Split payment requires exact sum matching grand_total (including rejecting 0-sum split)
    const zeroSplit = await clientA.api('POST', `/api/orders/${exOrd.data.id}/settle`, {
      paymentMode: 'split',
      paymentDetails: { cash: 0, upi: 0, card: 0 }
    });
    assert.equal(zeroSplit.status, 400);
    const exactSplitTotal = reloadedEx.data.bill.grand_total;
    const okSplit = await clientA.api('POST', `/api/orders/${exOrd.data.id}/settle`, {
      paymentMode: 'split',
      paymentDetails: { cash: 100, upi: exactSplitTotal - 100, card: 0 }
    });
    assert.equal(okSplit.status, 200);
    assert.equal(okSplit.data.packaging_charge, 25);

    // Cancel + double-cancel guard + post-cancel mutation block
    const cancelOrdRes = await clientA.api('POST', '/api/orders', {
      order_type: 'takeaway',
      items: [{ menu_item_id: exItemRes.data.id, qty: 1 }]
    });
    assert.equal(cancelOrdRes.status, 201);
    assert.equal((await clientA.api('POST', `/api/orders/${cancelOrdRes.data.id}/cancel`, { reason: 'Test cancel' })).status, 200);
    assert.equal((await clientA.api('POST', `/api/orders/${cancelOrdRes.data.id}/cancel`, {})).status, 400);
    assert.equal((await clientA.api('PATCH', `/api/orders/${cancelOrdRes.data.id}`, { notes: 'late' })).status, 400);

    // Deleting a merged primary table unlinks its merged secondary table cleanly
    const tMerge1 = (await clientA.api('POST', '/api/tables', { name: 'M1', zone: 'Patio', seats: 2 })).data;
    const tMerge2 = (await clientA.api('POST', '/api/tables', { name: 'M2', zone: 'Patio', seats: 2 })).data;
    assert.equal((await clientA.api('POST', '/api/tables/merge', { primaryTableId: tMerge1.id, secondaryTableIds: [tMerge2.id] })).status, 200);
    assert.equal((await clientA.api('DELETE', `/api/tables/${tMerge1.id}`)).status, 200);
    const tMerge2After = (await clientA.api('GET', '/api/tables')).data.find((x) => x.id === tMerge2.id);
    assert.equal(tMerge2After.status, 'available');
    assert.equal(tMerge2After.merged_into_table_id, null);

    // Billing engine unit matrix checks (exclusive, inclusive, composition, IGST, gstEnabled=false)
    const { calculateOrderBill } = require('../src/billing');
    const billIncl = calculateOrderBill([{ name: 'D', qty: 1, unit_price: 105, gst_rate: 5, status: 'queued' }], {
      taxMode: 'inclusive',
      roundOffEnabled: false
    });
    assert.equal(billIncl.subtotal, 100);
    assert.equal(billIncl.tax_amount, 5);
    assert.equal(billIncl.grand_total, 105);

    const billIgst = calculateOrderBill([{ name: 'D', qty: 1, unit_price: 200, gst_rate: 5, status: 'queued' }], {
      taxMode: 'exclusive',
      igstRate: 18,
      roundOffEnabled: false
    });
    assert.equal(billIgst.igst_amount, 36);
    assert.equal(billIgst.cgst_amount, 0);
    assert.equal(billIgst.grand_total, 236);

    const billNoGst = calculateOrderBill([{ name: 'D', qty: 2, unit_price: 150, gst_rate: 12, status: 'queued' }], {
      gstEnabled: false,
      roundOffEnabled: false
    });
    assert.equal(billNoGst.tax_amount, 0);
    assert.equal(billNoGst.grand_total, 300);

    // Manager role cannot promote staff to owner or modify an owner
    const mgrCreate = await clientA.api('POST', '/api/staff', {
      name: 'Manager A',
      email: 'mgra@test.local',
      password: 'password123',
      pin: '4444',
      role: 'manager'
    });
    assert.equal(mgrCreate.status, 201);
    const ownerUserId = regA.data.user.id;
    assert.equal((await clientA.api('POST', '/api/auth/pin', { pin: '4444' })).status, 200);
    assert.equal((await clientA.api('PUT', `/api/staff/${ownerUserId}`, { active: false })).status, 403);
    assert.equal((await clientA.api('PUT', `/api/staff/${chefCreate.data.id}`, { role: 'owner' })).status, 403);

    // CSV export includes Packaging Charge and IGST columns
    const csvRes = await clientA.api('GET', '/api/analytics/export.csv');
    assert.equal(csvRes.status, 200);
    const csvText = csvRes.data.toString('utf8');
    assert.ok(csvText.includes('Packaging Charge,CGST,SGST,IGST'));

    console.log('ALL_E2E_TESTS_PASSED');
  } finally {
    wsA?.close();
    wsB?.close();
    db.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('E2E_FAILED:', err);
  process.exit(1);
});
