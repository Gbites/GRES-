const express = require('express');
const {
  SESSION_COOKIE,
  hashSecret,
  verifySecret,
  signToken,
  verifyToken,
  parseCookies,
  ROLE_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  createAuthMiddleware
} = require('./auth');
const { calculateOrderBill, round2 } = require('./billing');
const { DEFAULT_CUSTOMIZATION, deepMerge, buildCustomization } = require('./customization');
const { runTransaction } = require('./db');
const { streamInvoicePdf } = require('./pdf');

function getSettings(db, branchId) {
  const row = db.prepare('SELECT * FROM settings WHERE branch_id = ?').get(branchId);
  if (!row) return null;
  const branch = db.prepare('SELECT restaurant_id FROM branches WHERE id = ?').get(branchId);
  const rest = branch?.restaurant_id
    ? db.prepare('SELECT * FROM restaurants WHERE id = ?').get(branch.restaurant_id)
    : null;
  return {
    ...row,
    customization: buildCustomization(row, rest)
  };
}

function getOrderWithBill(db, orderId) {
  const order = db.prepare(`
    SELECT o.*, dt.name AS table_name, dt.zone AS table_zone, u.name AS created_by_name
    FROM orders o
    LEFT JOIN dining_tables dt ON dt.id = o.table_id
    LEFT JOIN users u ON u.id = o.created_by
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return null;

  const rawItems = db.prepare(`
    SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC
  `).all(orderId);
  const items = rawItems.map((it) => ({
    ...it,
    extras: (() => { try { return JSON.parse(it.extras_json || '[]'); } catch { return []; } })()
  }));

  const settings = getSettings(db, order.branch_id);
  const packagingFee = ['takeaway', 'delivery'].includes(order.order_type)
    ? Number(settings?.customization?.menu?.packagingCharge || 0)
    : 0;
  const bill = calculateOrderBill(items, {
    gstEnabled: settings ? settings.gst_enabled !== 0 : true,
    taxMode: settings?.tax_mode || 'exclusive',
    compositionRate: settings?.composition_rate ?? 5,
    igstRate: settings?.igst_rate ?? 0,
    discountType: order.discount_type,
    discountValue: order.discount_value,
    serviceChargeRate: order.service_charge_rate,
    packagingCharge: packagingFee,
    roundOffEnabled: Boolean(settings?.round_off_enabled)
  });

  return {
    ...order,
    merged_table_ids: JSON.parse(order.merged_table_ids_json || '[]'),
    items,
    bill
  };
}

function createApiRouter(db, broadcast) {
  const router = express.Router();
  const { authenticateRequest, requirePerm } = createAuthMiddleware(db);

  function setSessionCookie(res, user, branchId) {
    const token = signToken({
      uid: user.id,
      role: user.role,
      branchId: branchId || user.branch_id,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  function logAudit(branchId, userId, action, entityType, entityId, details = {}) {
    db.prepare(`
      INSERT INTO audit_logs (branch_id, user_id, action, entity_type, entity_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(branchId || null, userId || null, action, entityType, String(entityId || ''), JSON.stringify(details));
  }

  function emit(req, ev) {
    broadcast({ ...ev, restaurantId: req.restaurantId });
  }

  function buildAuthPayload(user, activeBranchId) {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(user.restaurant_id);
    const branches = db.prepare('SELECT * FROM branches WHERE restaurant_id = ? AND active = 1 ORDER BY id ASC').all(user.restaurant_id);
    const ownedMatch = branches.find((b) => b.id === Number(activeBranchId));
    const userMatch = branches.find((b) => b.id === Number(user.branch_id));
    const effectiveBranchId =
      user.role === 'owner'
        ? (ownedMatch?.id || userMatch?.id || branches[0]?.id || null)
        : (userMatch?.id || branches[0]?.id || null);
    const settings = effectiveBranchId ? getSettings(db, effectiveBranchId) : null;
    const activeBranch = branches.find((b) => b.id === effectiveBranchId) || branches[0] || null;
    return {
      user: {
        id: user.id,
        restaurant_id: user.restaurant_id,
        name: user.name,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id
      },
      restaurant: restaurant ? {
        ...restaurant,
        onboarding_data: JSON.parse(restaurant.onboarding_data_json || '{}')
      } : null,
      permissions: getEffectivePermissions(user),
      branches,
      activeBranchId: effectiveBranchId,
      activeBranch,
      settings
    };
  }

  // ==================== AUTH & RESTAURANT REGISTRATION ====================
  router.post('/auth/register', (req, res) => {
    const {
      restaurantName,
      restaurantCode,
      branchName,
      branchCode,
      adminName,
      email,
      password,
      pin,
      address,
      phone,
      gstin,
      fssai
    } = req.body || {};

    if (!restaurantName || !branchName || !branchCode || !adminName || !email || !password || !pin) {
      return res.status(400).json({
        error: 'Restaurant name, branch name, branch code, admin name, email, password, and PIN are required'
      });
    }

    const rName = String(restaurantName).trim();
    const bName = String(branchName).trim();
    const bCode = String(branchCode).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const rCode = String(restaurantCode || bCode).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const cleanEmail = String(email).trim().toLowerCase();
    const initials = rName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'GR';

    if (!bCode || !rCode) {
      return res.status(400).json({ error: 'Workspace/Branch code must use letters or numbers' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const cleanPin = String(pin).trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits' });
    }

    try {
      const { user, branchId } = runTransaction(db, () => {
        const restInfo = db.prepare('INSERT INTO restaurants (name, code) VALUES (?, ?)').run(rName, rCode);
        const restaurantId = Number(restInfo.lastInsertRowid);

        const brInfo = db.prepare(`
          INSERT INTO branches (restaurant_id, name, code, address, phone, gstin, fssai)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(restaurantId, bName, bCode, address || '', phone || '', gstin || '', fssai || '');
        const newBranchId = Number(brInfo.lastInsertRowid);

        db.prepare(`
          INSERT INTO settings (
            branch_id, restaurant_name, tagline, brand_initials, logo_url,
            currency_code, currency_symbol, invoice_prefix, kot_prefix
          ) VALUES (?, ?, '', ?, '', 'INR', '₹', ?, 'KOT')
        `).run(newBranchId, rName, initials.slice(0, 3), `INV-${bCode.slice(0, 4)}`);

        const userInfo = db.prepare(`
          INSERT INTO users (restaurant_id, name, email, password_hash, pin_hash, role, branch_id)
          VALUES (?, ?, ?, ?, ?, 'owner', ?)
        `).run(
          restaurantId,
          String(adminName).trim(),
          cleanEmail,
          hashSecret(password),
          hashSecret(String(pin).trim()),
          newBranchId
        );

        const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userInfo.lastInsertRowid);
        return { user: createdUser, branchId: newBranchId };
      });

      setSessionCookie(res, user, branchId);
      res.status(201).json(buildAuthPayload(user, branchId));
    } catch (err) {
      const msg = err.message.includes('UNIQUE')
        ? 'Email, workspace code, or branch code is already registered'
        : err.message;
      res.status(400).json({ error: msg });
    }
  });

  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1').get(String(email).trim());
    if (!user || !verifySecret(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const branchId = user.branch_id || db.prepare('SELECT id FROM branches WHERE restaurant_id = ? AND active = 1 ORDER BY id ASC LIMIT 1').get(user.restaurant_id)?.id;
    setSessionCookie(res, user, branchId);
    res.json(buildAuthPayload(user, branchId));
  });

  router.post('/auth/pin', (req, res) => {
    const { pin, branchId, restaurantCode } = req.body || {};
    if (!pin) return res.status(400).json({ error: 'PIN is required' });

    // Determine scoped restaurant either from current signed session OR explicit restaurantCode
    let scopedRestaurantId = null;
    const cookies = parseCookies(req.headers.cookie);
    const parsed = verifyToken(cookies[SESSION_COOKIE]);
    if (parsed) {
      const curUser = db.prepare('SELECT restaurant_id, active FROM users WHERE id = ?').get(parsed.uid);
      if (curUser && curUser.active) scopedRestaurantId = curUser.restaurant_id;
    }

    if (!scopedRestaurantId && restaurantCode) {
      const cleanCode = String(restaurantCode).trim().toUpperCase();
      const rest = db.prepare('SELECT id FROM restaurants WHERE upper(code) = ?').get(cleanCode);
      const br = !rest ? db.prepare('SELECT restaurant_id FROM branches WHERE upper(code) = ?').get(cleanCode) : null;
      scopedRestaurantId = rest?.id || br?.restaurant_id || null;
    }

    if (!scopedRestaurantId) {
      return res.status(400).json({ error: 'Workspace / Branch Code is required for PIN sign-in' });
    }

    const users = db.prepare('SELECT * FROM users WHERE restaurant_id = ? AND active = 1').all(scopedRestaurantId);
    const matched = users.find((u) => verifySecret(String(pin).trim(), u.pin_hash));
    if (!matched) {
      return res.status(401).json({ error: 'Invalid staff PIN for this restaurant workspace' });
    }
    const defaultBranch = db.prepare('SELECT id FROM branches WHERE restaurant_id = ? AND active = 1 ORDER BY id ASC LIMIT 1').get(scopedRestaurantId)?.id;
    const targetBranch = matched.role === 'owner'
      ? Number(branchId || matched.branch_id || defaultBranch)
      : (matched.branch_id || defaultBranch);
    setSessionCookie(res, matched, targetBranch);
    res.json(buildAuthPayload(matched, targetBranch));
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Public workspace/branch branding lookup for terminal login screen (strictly non-sensitive display metadata)
  router.get('/auth/brand', (req, res) => {
    const cleanCode = String(req.query.code || '').trim().toUpperCase();
    if (!cleanCode) return res.json(null);
    const branch = db.prepare(`
      SELECT b.id, b.name, b.code, b.restaurant_id
      FROM branches b
      LEFT JOIN restaurants r ON r.id = b.restaurant_id
      WHERE upper(b.code) = ? OR upper(r.code) = ?
      ORDER BY b.id ASC LIMIT 1
    `).get(cleanCode, cleanCode);
    if (!branch) return res.json(null);
    const s = getSettings(db, branch.id);
    if (!s || s.customization?.branding?.showOnLogin === false) return res.json(null);
    res.json({
      restaurantName: s.restaurant_name || branch.name,
      tagline: s.tagline || '',
      initials: s.brand_initials || '',
      logoUrl: s.logo_url || '',
      coverUrl: s.customization.branding.coverUrl || '',
      loginTitle: s.customization.branding.loginTitle || '',
      loginSubtitle: s.customization.branding.loginSubtitle || '',
      accentColor: s.customization.appearance.accentColor || s.accent_color,
      themeMode: s.customization.appearance.themeMode || s.theme_mode
    });
  });

  // Protected routes below
  router.use(authenticateRequest);

  router.get('/auth/me', (req, res) => {
    res.json(buildAuthPayload(req.user, req.activeBranchId));
  });

  router.post('/auth/branch', (req, res) => {
    const { branchId } = req.body || {};
    const bId = Number(branchId);
    const branch = db.prepare('SELECT * FROM branches WHERE id = ? AND restaurant_id = ? AND active = 1').get(bId, req.restaurantId);
    if (!branch) return res.status(404).json({ error: 'Branch not found in your restaurant' });
    if (req.user.role !== 'owner' && req.user.branch_id !== bId) {
      return res.status(403).json({ error: 'Only owners can switch across branches' });
    }
    setSessionCookie(res, req.user, bId);
    res.json(buildAuthPayload(req.user, bId));
  });

  // ==================== BRANCHES ====================
  router.get('/branches', (req, res) => {
    const rows = db.prepare('SELECT * FROM branches WHERE restaurant_id = ? ORDER BY id ASC').all(req.restaurantId);
    res.json(rows);
  });

  router.post('/branches', requirePerm('branches:view'), (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can create branches' });
    }
    const { name, code, address, phone, gstin, fssai } = req.body || {};
    if (!name || !code) return res.status(400).json({ error: 'Branch name and code are required' });

    try {
      const created = runTransaction(db, () => {
        const curSettings = getSettings(db, req.activeBranchId);
        const info = db.prepare(
          'INSERT INTO branches (restaurant_id, name, code, address, phone, gstin, fssai) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(req.restaurantId, name.trim(), code.trim().toUpperCase(), address || '', phone || '', gstin || '', fssai || '');
        const newId = Number(info.lastInsertRowid);
        db.prepare(`
          INSERT INTO settings (
            branch_id, restaurant_name, tagline, brand_initials, logo_url,
            currency_code, currency_symbol, invoice_prefix
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          curSettings?.restaurant_name || name.trim(),
          curSettings?.tagline || '',
          curSettings?.brand_initials || '',
          curSettings?.logo_url || '',
          curSettings?.currency_code || 'INR',
          curSettings?.currency_symbol || '₹',
          `INV-${code.trim().toUpperCase().slice(0, 4)}`
        );
        return db.prepare('SELECT * FROM branches WHERE id = ?').get(newId);
      });
      emit(req, { type: 'branches:updated', branchId: created.id });
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Branch code already exists' : err.message });
    }
  });

  router.put('/branches/:id', (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = Number(req.params.id);
    if (req.user.role !== 'owner' && id !== req.activeBranchId) {
      return res.status(403).json({ error: 'Managers can only edit their assigned branch' });
    }
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM branches WHERE id = ? AND restaurant_id = ?').get(id, req.restaurantId);
    if (!existing) return res.status(404).json({ error: 'Branch not found' });

    db.prepare(`
      UPDATE branches SET
        name = ?, country = ?, state = ?, city = ?, address = ?, postal_code = ?,
        phone = ?, email = ?, map_lat = ?, map_lng = ?, gstin = ?, fssai = ?, active = ?
      WHERE id = ? AND restaurant_id = ?
    `).run(
      b.name ?? existing.name,
      b.country ?? existing.country,
      b.state ?? existing.state,
      b.city ?? existing.city,
      b.address ?? existing.address,
      b.postal_code ?? existing.postal_code,
      b.phone ?? existing.phone,
      b.email ?? existing.email,
      b.map_lat !== undefined ? (b.map_lat === '' || b.map_lat === null ? null : Number(b.map_lat)) : existing.map_lat,
      b.map_lng !== undefined ? (b.map_lng === '' || b.map_lng === null ? null : Number(b.map_lng)) : existing.map_lng,
      b.gstin ?? existing.gstin,
      b.fssai ?? existing.fssai,
      b.active === undefined ? existing.active : b.active ? 1 : 0,
      id,
      req.restaurantId
    );
    const updated = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
    emit(req, { type: 'branches:updated', branchId: id });
    res.json(updated);
  });

  // ==================== ONBOARDING (RESTAURANT SETUP WIZARD) ====================
  router.get('/onboarding', (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
    const branch = db.prepare('SELECT * FROM branches WHERE id = ? AND restaurant_id = ?').get(req.activeBranchId, req.restaurantId);
    const settings = getSettings(db, req.activeBranchId);
    const floors = db.prepare('SELECT * FROM floors WHERE branch_id = ? ORDER BY sort_order ASC, id ASC').all(req.activeBranchId);
    const tables = db.prepare('SELECT * FROM dining_tables WHERE branch_id = ? ORDER BY id ASC').all(req.activeBranchId);
    const categories = db.prepare('SELECT * FROM menu_categories WHERE branch_id = ? ORDER BY sort_order ASC, id ASC').all(req.activeBranchId);
    const items = db.prepare('SELECT * FROM menu_items WHERE branch_id = ? ORDER BY id ASC').all(req.activeBranchId);
    const staff = db.prepare('SELECT id, name, email, role, branch_id, custom_permissions_json, active FROM users WHERE restaurant_id = ? ORDER BY id ASC').all(req.restaurantId);

    res.json({
      restaurant: {
        ...restaurant,
        onboarding_data: JSON.parse(restaurant?.onboarding_data_json || '{}')
      },
      branch,
      settings,
      floors: floors.map((f) => ({ ...f, sections: JSON.parse(f.sections_json || '[]') })),
      tables,
      categories,
      items: items.map((it) => ({
        ...it,
        variants: JSON.parse(it.variants_json || '[]'),
        extras: JSON.parse(it.extras_json || '[]')
      })),
      staff: staff.map((s) => ({
        ...s,
        custom_permissions: s.custom_permissions_json ? JSON.parse(s.custom_permissions_json) : null
      }))
    });
  });

  router.put('/onboarding/step', (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the registering owner can update Restaurant Setup' });
    }
    const { step, data = {} } = req.body || {};
    const nextStep = Math.max(1, Math.min(8, Number(step || 1)));
    const branchId = req.activeBranchId;

    runTransaction(db, () => {
      const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
      const prevData = JSON.parse(rest.onboarding_data_json || '{}');
      const mergedData = { ...prevData, ...data };

      // Persist Step 1: Restaurant identity
      if (data.identity) {
        const idn = data.identity;
        const rName = String(idn.restaurant_name || idn.name || rest.name).trim();
        const initials = (idn.brand_initials || rName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')).slice(0, 3).toUpperCase();
        db.prepare(`
          UPDATE restaurants SET name = ?, restaurant_type = ?, description = ? WHERE id = ?
        `).run(rName, idn.restaurant_type ?? rest.restaurant_type, idn.description ?? rest.description, req.restaurantId);

        db.prepare(`
          UPDATE settings SET restaurant_name = ?, brand_initials = ?, logo_url = ?, tagline = ?, updated_at = datetime('now')
          WHERE branch_id = ?
        `).run(rName, initials, idn.logo_url ?? '', idn.tagline ?? '', branchId);
      }

      // Persist Step 2: Location
      if (data.location) {
        const loc = data.location;
        db.prepare(`
          UPDATE branches SET
            country = ?, state = ?, city = ?, address = ?, postal_code = ?,
            phone = ?, email = ?, map_lat = ?, map_lng = ?
          WHERE id = ? AND restaurant_id = ?
        `).run(
          loc.country ?? '',
          loc.state ?? '',
          loc.city ?? '',
          loc.address ?? '',
          loc.postal_code ?? '',
          loc.phone ?? '',
          loc.email ?? '',
          loc.map_lat !== undefined && loc.map_lat !== '' && loc.map_lat !== null ? Number(loc.map_lat) : null,
          loc.map_lng !== undefined && loc.map_lng !== '' && loc.map_lng !== null ? Number(loc.map_lng) : null,
          branchId,
          req.restaurantId
        );
      }

      // Persist Step 3: Business configuration
      if (data.business) {
        const biz = data.business;
        db.prepare(`
          UPDATE settings SET
            currency_code = ?, currency_symbol = ?, timezone = ?, date_format = ?,
            opening_hours_json = ?, holidays_json = ?, updated_at = datetime('now')
          WHERE branch_id = ?
        `).run(
          biz.currency_code || 'INR',
          biz.currency_symbol || '₹',
          biz.timezone || 'Asia/Kolkata',
          biz.date_format || 'DD/MM/YYYY',
          JSON.stringify(biz.opening_hours || {}),
          JSON.stringify(Array.isArray(biz.holidays) ? biz.holidays : []),
          branchId
        );
      }

      // Persist Step 4: Tax & Billing
      if (data.tax) {
        const tx = data.tax;
        const gstEnabled = tx.gst_enabled ? 1 : 0;
        const cgst = Number(tx.cgst_rate ?? 2.5);
        const sgst = Number(tx.sgst_rate ?? 2.5);
        const igst = Number(tx.igst_rate ?? 0);
        const defaultGst = igst > 0 ? igst : round2(cgst + sgst);

        db.prepare(`
          UPDATE settings SET
            gst_enabled = ?, gstin = ?, tax_mode = ?, cgst_rate = ?, sgst_rate = ?, igst_rate = ?,
            default_gst_rate = ?, service_charge_rate = ?, invoice_prefix = ?, invoice_start_number = ?,
            receipt_footer = ?, updated_at = datetime('now')
          WHERE branch_id = ?
        `).run(
          gstEnabled,
          String(tx.gstin || '').trim(),
          ['exclusive', 'inclusive', 'composition'].includes(tx.tax_mode) ? tx.tax_mode : 'exclusive',
          cgst,
          sgst,
          igst,
          defaultGst,
          Number(tx.service_charge_rate ?? 0),
          String(tx.invoice_prefix || 'INV').trim(),
          Math.max(1, Number(tx.invoice_start_number || 1001)),
          String(tx.receipt_footer || ''),
          branchId
        );
        db.prepare('UPDATE branches SET gstin = ? WHERE id = ? AND restaurant_id = ?').run(String(tx.gstin || '').trim(), branchId, req.restaurantId);
      }

      db.prepare(`
        UPDATE restaurants SET onboarding_step = ?, onboarding_data_json = ? WHERE id = ?
      `).run(nextStep, JSON.stringify(mergedData), req.restaurantId);
    });

    res.json({ ok: true, step: nextStep });
  });

  router.post('/onboarding/complete', (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the registering owner can complete setup' });
    }
    const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
    const branch = db.prepare('SELECT * FROM branches WHERE id = ? AND restaurant_id = ?').get(req.activeBranchId, req.restaurantId);
    const settings = getSettings(db, req.activeBranchId);

    if (!settings?.restaurant_name && !rest?.name) {
      return res.status(400).json({ error: 'Restaurant name is required before completing setup' });
    }
    if (!branch?.country || !branch?.city || !branch?.address) {
      return res.status(400).json({ error: 'Location details (Country, City, Street Address) are required before completing setup' });
    }

    db.prepare('UPDATE restaurants SET onboarding_completed = 1, onboarding_step = 8 WHERE id = ?').run(req.restaurantId);
    logAudit(req.activeBranchId, req.user.id, 'COMPLETE_ONBOARDING', 'restaurant', req.restaurantId);
    res.json(buildAuthPayload(req.user, req.activeBranchId));
  });

  // ==================== SETTINGS ====================
  router.get('/settings', (req, res) => {
    res.json(getSettings(db, req.activeBranchId));
  });

  router.put('/settings', requirePerm('settings:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const cur = getSettings(db, branchId);
    if (!cur) return res.status(404).json({ error: 'Settings not found' });

    const body = req.body || {};
    if (body.restaurant_name || body.restaurant_type !== undefined || body.description !== undefined) {
      const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
      db.prepare('UPDATE restaurants SET name = ?, restaurant_type = ?, description = ? WHERE id = ?').run(
        body.restaurant_name ?? rest.name,
        body.restaurant_type ?? rest.restaurant_type,
        body.description ?? rest.description,
        req.restaurantId
      );
    }

    const nextCgst = body.cgst_rate !== undefined ? Number(body.cgst_rate) : cur.cgst_rate;
    const nextSgst = body.sgst_rate !== undefined ? Number(body.sgst_rate) : cur.sgst_rate;
    const nextIgst = body.igst_rate !== undefined ? Number(body.igst_rate) : cur.igst_rate;
    const nextDefGst = body.default_gst_rate !== undefined
      ? Number(body.default_gst_rate)
      : (nextIgst > 0 ? nextIgst : round2(nextCgst + nextSgst));

    db.prepare(`
      UPDATE settings SET
        restaurant_name = ?, tagline = ?, brand_initials = ?, logo_url = ?, currency_code = ?, currency_symbol = ?,
        timezone = ?, date_format = ?, opening_hours_json = ?, holidays_json = ?,
        gst_enabled = ?, gstin = ?, tax_mode = ?, cgst_rate = ?, sgst_rate = ?, igst_rate = ?,
        composition_rate = ?, default_gst_rate = ?, service_charge_rate = ?,
        round_off_enabled = ?, invoice_prefix = ?, invoice_start_number = ?, kot_prefix = ?, thermal_width = ?,
        theme_mode = ?, accent_color = ?, pos_density = ?, kds_sla_minutes = ?,
        kds_sound_enabled = ?, receipt_header = ?, receipt_footer = ?, upi_id = ?,
        updated_at = datetime('now')
      WHERE branch_id = ?
    `).run(
      body.restaurant_name ?? cur.restaurant_name,
      body.tagline ?? cur.tagline,
      (body.brand_initials ?? cur.brand_initials ?? '').slice(0, 3).toUpperCase(),
      body.logo_url ?? cur.logo_url ?? '',
      body.currency_code ?? cur.currency_code,
      body.currency_symbol ?? cur.currency_symbol,
      body.timezone ?? cur.timezone,
      body.date_format ?? cur.date_format,
      body.opening_hours !== undefined ? JSON.stringify(body.opening_hours) : cur.opening_hours_json,
      body.holidays !== undefined ? JSON.stringify(body.holidays) : cur.holidays_json,
      body.gst_enabled !== undefined ? (body.gst_enabled ? 1 : 0) : cur.gst_enabled,
      body.gstin ?? cur.gstin,
      ['exclusive', 'inclusive', 'composition'].includes(body.tax_mode) ? body.tax_mode : cur.tax_mode,
      nextCgst,
      nextSgst,
      nextIgst,
      body.composition_rate !== undefined ? Number(body.composition_rate) : cur.composition_rate,
      nextDefGst,
      body.service_charge_rate !== undefined ? Number(body.service_charge_rate) : cur.service_charge_rate,
      body.round_off_enabled !== undefined ? (body.round_off_enabled ? 1 : 0) : cur.round_off_enabled,
      body.invoice_prefix ?? cur.invoice_prefix,
      body.invoice_start_number !== undefined ? Math.max(1, Number(body.invoice_start_number)) : cur.invoice_start_number,
      body.kot_prefix ?? cur.kot_prefix,
      ['58mm', '80mm'].includes(body.thermal_width) ? body.thermal_width : cur.thermal_width,
      ['dark', 'light'].includes(body.theme_mode) ? body.theme_mode : cur.theme_mode,
      body.accent_color ?? cur.accent_color,
      ['compact', 'comfortable'].includes(body.pos_density) ? body.pos_density : cur.pos_density,
      body.kds_sla_minutes !== undefined ? Number(body.kds_sla_minutes) : cur.kds_sla_minutes,
      body.kds_sound_enabled !== undefined ? (body.kds_sound_enabled ? 1 : 0) : cur.kds_sound_enabled,
      body.receipt_header ?? cur.receipt_header,
      body.receipt_footer ?? cur.receipt_footer,
      body.upi_id ?? cur.upi_id,
      branchId
    );

    if (body.gstin !== undefined) {
      db.prepare('UPDATE branches SET gstin = ? WHERE id = ? AND restaurant_id = ?').run(String(body.gstin), branchId, req.restaurantId);
    }

    const updated = getSettings(db, branchId);
    logAudit(branchId, req.user.id, 'UPDATE_SETTINGS', 'settings', branchId);
    emit(req, { type: 'settings:updated', branchId, settings: updated });
    res.json(updated);
  });

  // ==================== COMPREHENSIVE CUSTOMIZATION STUDIO ====================
  router.get('/customization', (req, res) => {
    const settings = getSettings(db, req.activeBranchId);
    res.json({
      customization: settings?.customization || DEFAULT_CUSTOMIZATION,
      defaults: DEFAULT_CUSTOMIZATION,
      settings
    });
  });

  router.put('/customization', requirePerm('settings:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const cur = getSettings(db, branchId);
    if (!cur) return res.status(404).json({ error: 'Settings not found' });

    const incoming = req.body?.customization || req.body || {};
    const nextCust = deepMerge(cur.customization || DEFAULT_CUSTOMIZATION, incoming);

    const ap = nextCust.appearance || {};
    const br = nextCust.branding || {};
    const bi = nextCust.billing || {};
    const no = nextCust.notifications || {};
    const ru = nextCust.businessRules || {};
    const ad = nextCust.advanced || {};

    const cgst = Number(ru.cgstRate ?? cur.cgst_rate);
    const sgst = Number(ru.sgstRate ?? cur.sgst_rate);
    const igst = Number(ru.igstRate ?? cur.igst_rate);
    const defGst = igst > 0 ? igst : round2(cgst + sgst);

    const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
    if (br.restaurantName !== undefined && String(br.restaurantName).trim()) {
      db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run(String(br.restaurantName).trim(), req.restaurantId);
    }

    const mappedTheme = ap.themeMode === 'light' ? 'light' : 'dark';
    const mappedDensity = ap.spacing === 'compact' ? 'compact' : 'comfortable';
    const mappedThermal = ['58mm', '80mm'].includes(bi.paperSize) ? bi.paperSize : cur.thermal_width;

    db.prepare(`
      UPDATE settings SET
        restaurant_name = ?, tagline = ?, brand_initials = ?, logo_url = ?,
        currency_code = ?, currency_symbol = ?, timezone = ?, date_format = ?,
        opening_hours_json = ?, holidays_json = ?,
        gst_enabled = ?, gstin = ?, tax_mode = ?, cgst_rate = ?, sgst_rate = ?, igst_rate = ?,
        composition_rate = ?, default_gst_rate = ?, service_charge_rate = ?, round_off_enabled = ?,
        receipt_header = ?, receipt_footer = ?,
        theme_mode = ?, accent_color = ?, pos_density = ?, thermal_width = ?,
        kds_sla_minutes = ?, kds_sound_enabled = ?,
        customization_json = ?, updated_at = datetime('now')
      WHERE branch_id = ?
    `).run(
      (br.restaurantName && String(br.restaurantName).trim()) || cur.restaurant_name || rest?.name || '',
      br.tagline ?? cur.tagline,
      String(br.initials ?? cur.brand_initials ?? '').slice(0, 3).toUpperCase(),
      br.logoUrl ?? cur.logo_url ?? '',
      ad.currencyCode ?? cur.currency_code,
      ad.currencySymbol ?? cur.currency_symbol,
      ad.timezone ?? cur.timezone,
      ad.dateFormat ?? cur.date_format,
      JSON.stringify(ru.openingHours || {}),
      JSON.stringify(Array.isArray(ru.holidays) ? ru.holidays : []),
      ru.gstEnabled !== false ? 1 : 0,
      ru.gstin ?? cur.gstin,
      ['exclusive', 'inclusive', 'composition'].includes(ru.taxMode) ? ru.taxMode : cur.tax_mode,
      cgst,
      sgst,
      igst,
      Number(ru.compositionRate ?? cur.composition_rate),
      defGst,
      Number(ru.serviceChargeRate ?? cur.service_charge_rate),
      ru.roundOffEnabled !== false ? 1 : 0,
      bi.header ?? cur.receipt_header,
      bi.footer ?? cur.receipt_footer,
      mappedTheme,
      ap.accentColor || cur.accent_color || '#f97316',
      mappedDensity,
      mappedThermal,
      Math.max(1, Number(no.delayedOrderMinutes ?? cur.kds_sla_minutes ?? 15)),
      no.soundEnabled !== false ? 1 : 0,
      JSON.stringify(nextCust),
      branchId
    );

    if (ru.gstin !== undefined) {
      db.prepare('UPDATE branches SET gstin = ? WHERE id = ? AND restaurant_id = ?').run(String(ru.gstin), branchId, req.restaurantId);
    }

    const updated = getSettings(db, branchId);
    logAudit(branchId, req.user.id, 'UPDATE_CUSTOMIZATION', 'settings', branchId);
    emit(req, { type: 'settings:updated', branchId, settings: updated });
    res.json(updated);
  });

  router.post('/customization/reset', requirePerm('settings:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const cur = getSettings(db, branchId);
    if (!cur) return res.status(404).json({ error: 'Settings not found' });

    const section = req.body?.section || 'all';
    const currentCust = cur.customization || DEFAULT_CUSTOMIZATION;
    const nextCust = section !== 'all' && DEFAULT_CUSTOMIZATION[section] !== undefined
      ? { ...currentCust, [section]: structuredClone(DEFAULT_CUSTOMIZATION[section]) }
      : structuredClone(DEFAULT_CUSTOMIZATION);

    // Never wipe user's registered restaurant name
    if (!nextCust.branding.restaurantName) {
      nextCust.branding.restaurantName = cur.restaurant_name || '';
    }

    db.prepare(`
      UPDATE settings SET
        theme_mode = ?, accent_color = ?, pos_density = ?, thermal_width = ?,
        kds_sla_minutes = ?, kds_sound_enabled = ?,
        customization_json = ?, updated_at = datetime('now')
      WHERE branch_id = ?
    `).run(
      nextCust.appearance.themeMode === 'light' ? 'light' : 'dark',
      nextCust.appearance.accentColor || '#f97316',
      nextCust.appearance.spacing === 'compact' ? 'compact' : 'comfortable',
      ['58mm', '80mm'].includes(nextCust.billing.paperSize) ? nextCust.billing.paperSize : '80mm',
      Number(nextCust.notifications.delayedOrderMinutes || 15),
      nextCust.notifications.soundEnabled !== false ? 1 : 0,
      JSON.stringify(nextCust),
      branchId
    );

    const updated = getSettings(db, branchId);
    logAudit(branchId, req.user.id, 'RESET_CUSTOMIZATION', 'settings', branchId, { section });
    emit(req, { type: 'settings:updated', branchId, settings: updated });
    res.json(updated);
  });

  // ==================== FLOORS & SECTIONS ====================
  router.get('/floors', (req, res) => {
    const rows = db.prepare('SELECT * FROM floors WHERE branch_id = ? ORDER BY sort_order ASC, id ASC').all(req.activeBranchId);
    res.json(rows.map((r) => ({ ...r, sections: JSON.parse(r.sections_json || '[]') })));
  });

  router.post('/floors', requirePerm('floor:edit'), (req, res) => {
    const { name, sections, sort_order } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Floor name is required' });
    const secArr = Array.isArray(sections)
      ? sections.map((s) => String(s).trim()).filter(Boolean)
      : String(sections || '').split(',').map((s) => s.trim()).filter(Boolean);
    const info = db.prepare('INSERT INTO floors (branch_id, name, sections_json, sort_order) VALUES (?, ?, ?, ?)').run(
      req.activeBranchId,
      String(name).trim(),
      JSON.stringify(secArr),
      Number(sort_order || 1)
    );
    const created = db.prepare('SELECT * FROM floors WHERE id = ?').get(info.lastInsertRowid);
    emit(req, { type: 'tables:updated', branchId: req.activeBranchId });
    res.status(201).json({ ...created, sections: JSON.parse(created.sections_json || '[]') });
  });

  router.put('/floors/:id', requirePerm('floor:edit'), (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM floors WHERE id = ? AND branch_id = ?').get(id, req.activeBranchId);
    if (!cur) return res.status(404).json({ error: 'Floor not found' });
    const { name, sections, sort_order } = req.body || {};
    const secArr = sections === undefined
      ? JSON.parse(cur.sections_json || '[]')
      : Array.isArray(sections)
      ? sections.map((s) => String(s).trim()).filter(Boolean)
      : String(sections).split(',').map((s) => s.trim()).filter(Boolean);
    db.prepare('UPDATE floors SET name = ?, sections_json = ?, sort_order = ? WHERE id = ?').run(
      name ? String(name).trim() : cur.name,
      JSON.stringify(secArr),
      sort_order !== undefined ? Number(sort_order) : cur.sort_order,
      id
    );
    const upd = db.prepare('SELECT * FROM floors WHERE id = ?').get(id);
    emit(req, { type: 'tables:updated', branchId: req.activeBranchId });
    res.json({ ...upd, sections: JSON.parse(upd.sections_json || '[]') });
  });

  router.delete('/floors/:id', requirePerm('floor:edit'), (req, res) => {
    db.prepare('DELETE FROM floors WHERE id = ? AND branch_id = ?').run(Number(req.params.id), req.activeBranchId);
    emit(req, { type: 'tables:updated', branchId: req.activeBranchId });
    res.json({ ok: true });
  });

  // ==================== TABLES & FLOOR PLAN ====================
  router.get('/tables', (req, res) => {
    const branchId = req.activeBranchId;
    const tables = db.prepare(`
      SELECT dt.*,
             o.order_number AS active_order_number,
             o.customer_name AS active_customer_name,
             o.created_at AS order_started_at,
             pt.name AS merged_into_name
      FROM dining_tables dt
      LEFT JOIN orders o ON o.id = dt.current_order_id AND o.status IN ('open','hold')
      LEFT JOIN dining_tables pt ON pt.id = dt.merged_into_table_id
      WHERE dt.branch_id = ?
      ORDER BY dt.id ASC
    `).all(branchId);

    const enriched = tables.map((t) => {
      let runningTotal = 0;
      let itemCount = 0;
      if (t.current_order_id) {
        const ord = getOrderWithBill(db, t.current_order_id);
        if (ord) {
          runningTotal = ord.bill.grand_total;
          itemCount = ord.bill.item_count;
        }
      }
      return { ...t, running_total: runningTotal, item_count: itemCount };
    });

    res.json(enriched);
  });

  router.post('/tables', requirePerm('floor:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const { name, floor_name, zone, seats, shape, x, y, width, height, color, size_scale, label_override } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Table name is required' });
    const info = db.prepare(`
      INSERT INTO dining_tables (branch_id, name, floor_name, zone, seats, shape, x, y, width, height, color, size_scale, label_override)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branchId,
      String(name).trim(),
      floor_name || 'Ground Floor',
      zone || 'Main Hall',
      Number(seats || 4),
      ['square', 'round', 'rect'].includes(shape) ? shape : 'square',
      Math.round(Number(x ?? 40)),
      Math.round(Number(y ?? 40)),
      Math.round(Number(width ?? (shape === 'rect' ? 160 : 105))),
      Math.round(Number(height ?? 105)),
      String(color || ''),
      Math.max(0.6, Math.min(2, Number(size_scale || 1))),
      String(label_override || '')
    );
    const created = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(info.lastInsertRowid);
    emit(req, { type: 'tables:updated', branchId });
    res.status(201).json(created);
  });

  router.put('/tables/layout/batch', requirePerm('floor:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const { layouts } = req.body || {};
    if (!Array.isArray(layouts)) return res.status(400).json({ error: 'layouts array required' });

    runTransaction(db, () => {
      const stmt = db.prepare(`
        UPDATE dining_tables SET x = ?, y = ?, width = ?, height = ?, updated_at = datetime('now')
        WHERE id = ? AND branch_id = ?
      `);
      for (const l of layouts) {
        stmt.run(
          Math.max(0, Math.round(Number(l.x || 0))),
          Math.max(0, Math.round(Number(l.y || 0))),
          Math.max(60, Math.round(Number(l.width || 100))),
          Math.max(60, Math.round(Number(l.height || 100))),
          Number(l.id),
          branchId
        );
      }
    });

    emit(req, { type: 'tables:updated', branchId });
    res.json({ ok: true });
  });

  router.put('/tables/:id', requirePerm('floor:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(id, branchId);
    if (!cur) return res.status(404).json({ error: 'Table not found' });

    const b = req.body || {};
    db.prepare(`
      UPDATE dining_tables SET name = ?, floor_name = ?, zone = ?, seats = ?, shape = ?, status = ?, color = ?, size_scale = ?, label_override = ?, updated_at = datetime('now')
      WHERE id = ? AND branch_id = ?
    `).run(
      b.name ?? cur.name,
      b.floor_name ?? cur.floor_name ?? 'Ground Floor',
      b.zone ?? cur.zone,
      b.seats !== undefined ? Number(b.seats) : cur.seats,
      ['square', 'round', 'rect'].includes(b.shape) ? b.shape : cur.shape,
      ['available', 'occupied', 'reserved', 'merged'].includes(b.status) ? b.status : cur.status,
      b.color !== undefined ? String(b.color) : (cur.color || ''),
      b.size_scale !== undefined ? Math.max(0.6, Math.min(2, Number(b.size_scale))) : Number(cur.size_scale || 1),
      b.label_override !== undefined ? String(b.label_override) : (cur.label_override || ''),
      id,
      branchId
    );
    const updated = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(id);
    emit(req, { type: 'tables:updated', branchId });
    res.json(updated);
  });

  router.delete('/tables/:id', requirePerm('floor:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(id, branchId);
    if (!cur) return res.status(404).json({ error: 'Table not found' });
    if (cur.status === 'occupied' || cur.current_order_id) {
      return res.status(400).json({ error: 'Cannot delete an occupied table. Settle or transfer first.' });
    }
    runTransaction(db, () => {
      db.prepare("UPDATE dining_tables SET status = 'available', merged_into_table_id = NULL WHERE merged_into_table_id = ? AND branch_id = ?").run(id, branchId);
      db.prepare('DELETE FROM dining_tables WHERE id = ? AND branch_id = ?').run(id, branchId);
    });
    emit(req, { type: 'tables:updated', branchId });
    res.json({ ok: true });
  });

  // Transfer active order from one table to an available target table
  router.post('/tables/transfer', requirePerm('tables:transfer'), (req, res) => {
    const branchId = req.activeBranchId;
    const { fromTableId, toTableId } = req.body || {};
    const fromId = Number(fromTableId);
    const toId = Number(toTableId);
    if (!fromId || !toId || fromId === toId) {
      return res.status(400).json({ error: 'Select two distinct tables' });
    }

    try {
      const result = runTransaction(db, () => {
        const fromT = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(fromId, branchId);
        const toT = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(toId, branchId);
        if (!fromT || !toT) throw new Error('Table not found in active branch');
        if (!fromT.current_order_id) throw new Error('Source table has no active order');
        if (toT.status !== 'available' && toT.status !== 'reserved') {
          throw new Error(`Target table ${toT.name} is currently ${toT.status}`);
        }

        const orderId = fromT.current_order_id;
        db.prepare("UPDATE orders SET table_id = ?, updated_at = datetime('now') WHERE id = ?").run(toId, orderId);
        db.prepare(`
          UPDATE dining_tables SET status = 'available', current_order_id = NULL, updated_at = datetime('now') WHERE id = ?
        `).run(fromId);
        db.prepare(`
          UPDATE dining_tables SET status = 'occupied', current_order_id = ?, updated_at = datetime('now') WHERE id = ?
        `).run(orderId, toId);

        logAudit(branchId, req.user.id, 'TRANSFER_TABLE', 'order', orderId, {
          fromTable: fromT.name,
          toTable: toT.name
        });
        return { orderId, fromTable: fromT.name, toTable: toT.name };
      });

      emit(req, { type: 'tables:updated', branchId });
      emit(req, { type: 'orders:updated', branchId, orderId: result.orderId });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Merge two or more tables (combines orders if multiple are occupied, or links free tables to primary)
  router.post('/tables/merge', requirePerm('tables:merge'), (req, res) => {
    const branchId = req.activeBranchId;
    const { primaryTableId, secondaryTableIds } = req.body || {};
    const pId = Number(primaryTableId);
    const secIds = Array.isArray(secondaryTableIds)
      ? secondaryTableIds.map(Number).filter((id) => id && id !== pId)
      : [];

    if (!pId || secIds.length === 0) {
      return res.status(400).json({ error: 'Select a primary table and at least one secondary table' });
    }

    try {
      const result = runTransaction(db, () => {
        const primary = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(pId, branchId);
        if (!primary) throw new Error('Primary table not found');

        let primaryOrderId = primary.current_order_id;
        const existingMerged = primaryOrderId
          ? JSON.parse(db.prepare('SELECT merged_table_ids_json FROM orders WHERE id = ?').get(primaryOrderId)?.merged_table_ids_json || '[]')
          : [];
        const mergedSet = new Set(existingMerged);

        for (const sId of secIds) {
          const sec = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(sId, branchId);
          if (!sec) throw new Error(`Secondary table ${sId} not found`);
          if (sec.status === 'merged') throw new Error(`Table ${sec.name} is already merged`);

          // If secondary has an active order, merge its items into primary order
          if (sec.current_order_id) {
            if (!primaryOrderId) {
              // Promote secondary's order to primary
              primaryOrderId = sec.current_order_id;
              db.prepare("UPDATE orders SET table_id = ?, updated_at = datetime('now') WHERE id = ?").run(pId, primaryOrderId);
              db.prepare("UPDATE dining_tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(primaryOrderId, pId);
            } else if (sec.current_order_id !== primaryOrderId) {
              // Move order items onto primary order and cancel secondary order shell
              db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(primaryOrderId, sec.current_order_id);
              db.prepare("UPDATE orders SET status = 'cancelled', notes = notes || ' [Merged into #' || ? || ']', updated_at = datetime('now') WHERE id = ?")
                .run(primaryOrderId, sec.current_order_id);
            }
          }

          mergedSet.add(sId);
          db.prepare(`
            UPDATE dining_tables
            SET status = 'merged', merged_into_table_id = ?, current_order_id = NULL, updated_at = datetime('now')
            WHERE id = ?
          `).run(pId, sId);
        }

        if (primaryOrderId) {
          db.prepare("UPDATE orders SET merged_table_ids_json = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify([...mergedSet]), primaryOrderId);
        }

        logAudit(branchId, req.user.id, 'MERGE_TABLES', 'table', pId, { secondaryTableIds: secIds });
        return { primaryTableId: pId, mergedTableIds: [...mergedSet], orderId: primaryOrderId };
      });

      emit(req, { type: 'tables:updated', branchId });
      emit(req, { type: 'orders:updated', branchId, orderId: result.orderId });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/tables/unmerge', requirePerm('tables:merge'), (req, res) => {
    const branchId = req.activeBranchId;
    const { tableId } = req.body || {};
    const tId = Number(tableId);
    runTransaction(db, () => {
      const target = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(tId, branchId);
      if (!target) throw new Error('Table not found');
      if (target.status === 'merged') {
        db.prepare("UPDATE dining_tables SET status = 'available', merged_into_table_id = NULL WHERE id = ?").run(tId);
      } else {
        db.prepare("UPDATE dining_tables SET status = 'available', merged_into_table_id = NULL WHERE merged_into_table_id = ?").run(tId);
        if (target.current_order_id) {
          db.prepare("UPDATE orders SET merged_table_ids_json = '[]' WHERE id = ?").run(target.current_order_id);
        }
      }
    });
    emit(req, { type: 'tables:updated', branchId });
    res.json({ ok: true });
  });

  // ==================== MENU & RECIPES ====================
  router.get('/menu', (req, res) => {
    const branchId = req.activeBranchId;
    const categories = db.prepare(
      'SELECT * FROM menu_categories WHERE branch_id = ? ORDER BY sort_order ASC, id ASC'
    ).all(branchId);

    const items = db.prepare(`
      SELECT mi.*, mc.name AS category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.branch_id = ?
      ORDER BY mc.sort_order ASC, mi.id ASC
    `).all(branchId);

    const recipes = db.prepare(`
      SELECT r.*, ing.name AS ingredient_name, ing.unit AS ingredient_unit, ing.stock_qty
      FROM recipes r
      JOIN ingredients ing ON ing.id = r.ingredient_id
      WHERE ing.branch_id = ?
    `).all(branchId);

    const recipeByItem = {};
    for (const r of recipes) {
      if (!recipeByItem[r.menu_item_id]) recipeByItem[r.menu_item_id] = [];
      recipeByItem[r.menu_item_id].push(r);
    }

    res.json({
      categories,
      items: items.map((it) => ({
        ...it,
        variants: JSON.parse(it.variants_json || '[]'),
        extras: JSON.parse(it.extras_json || '[]'),
        labels: (() => { try { return JSON.parse(it.labels_json || '[]'); } catch { return []; } })(),
        pricing_rules: (() => { try { return JSON.parse(it.pricing_rules_json || '{}'); } catch { return {}; } })(),
        recipe: recipeByItem[it.id] || []
      }))
    });
  });

  router.post('/menu/categories', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const { name, sort_order, parent_id, label } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const info = db.prepare(
      'INSERT INTO menu_categories (branch_id, name, parent_id, label, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(branchId, name.trim(), parent_id ? Number(parent_id) : null, String(label || '').trim(), Number(sort_order || 99));
    emit(req, { type: 'menu:updated', branchId });
    res.status(201).json(db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/menu/categories/:id', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM menu_categories WHERE id = ? AND branch_id = ?').get(id, branchId);
    if (!cur) return res.status(404).json({ error: 'Category not found' });
    const { name, sort_order, active, parent_id, label } = req.body || {};
    db.prepare('UPDATE menu_categories SET name = ?, parent_id = ?, label = ?, sort_order = ?, active = ? WHERE id = ?').run(
      name ? name.trim() : cur.name,
      parent_id !== undefined ? (parent_id ? Number(parent_id) : null) : (cur.parent_id ?? null),
      label !== undefined ? String(label).trim() : (cur.label || ''),
      sort_order !== undefined ? Number(sort_order) : cur.sort_order,
      active !== undefined ? (active ? 1 : 0) : cur.active,
      id
    );
    emit(req, { type: 'menu:updated', branchId });
    res.json(db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(id));
  });

  router.delete('/menu/categories/:id', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const itemCount = db.prepare('SELECT COUNT(*) AS c FROM menu_items WHERE category_id = ? AND branch_id = ?').get(id, branchId).c;
    if (itemCount > 0) {
      return res.status(400).json({ error: `Cannot delete category with ${itemCount} menu items. Reassign or delete items first.` });
    }
    db.prepare('DELETE FROM menu_categories WHERE id = ? AND branch_id = ?').run(id, branchId);
    emit(req, { type: 'menu:updated', branchId });
    res.json({ ok: true });
  });

  router.post('/menu/items', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const b = req.body || {};
    if (!b.name || !b.category_id || b.price === undefined) {
      return res.status(400).json({ error: 'Name, category, and price are required' });
    }
    const info = db.prepare(`
      INSERT INTO menu_items (
        branch_id, category_id, name, sku, description, photo_url, price, gst_rate, dietary, station, variants_json, extras_json, labels_json, pricing_rules_json, available, prep_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branchId,
      Number(b.category_id),
      b.name.trim(),
      b.sku || `ITM-${Date.now().toString().slice(-4)}`,
      b.description || '',
      b.photo_url || '',
      Number(b.price),
      Number(b.gst_rate ?? 5),
      ['veg', 'non-veg', 'vegan', 'egg'].includes(b.dietary) ? b.dietary : 'veg',
      b.station || 'Main Kitchen',
      JSON.stringify(Array.isArray(b.variants) ? b.variants : []),
      JSON.stringify(Array.isArray(b.extras) ? b.extras : []),
      JSON.stringify(Array.isArray(b.labels) ? b.labels : []),
      JSON.stringify(b.pricing_rules && typeof b.pricing_rules === 'object' ? b.pricing_rules : {}),
      b.available === undefined ? 1 : b.available ? 1 : 0,
      Number(b.prep_minutes || 12)
    );
    const createdItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(info.lastInsertRowid);
    emit(req, { type: 'menu:updated', branchId });
    res.status(201).json({
      ...createdItem,
      variants: JSON.parse(createdItem.variants_json || '[]'),
      extras: JSON.parse(createdItem.extras_json || '[]'),
      labels: JSON.parse(createdItem.labels_json || '[]'),
      pricing_rules: JSON.parse(createdItem.pricing_rules_json || '{}')
    });
  });

  router.put('/menu/items/:id', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM menu_items WHERE id = ? AND branch_id = ?').get(id, branchId);
    if (!cur) return res.status(404).json({ error: 'Menu item not found' });

    const b = req.body || {};
    db.prepare(`
      UPDATE menu_items SET
        category_id = ?, name = ?, sku = ?, description = ?, photo_url = ?, price = ?, gst_rate = ?,
        dietary = ?, station = ?, variants_json = ?, extras_json = ?, labels_json = ?, pricing_rules_json = ?, available = ?, prep_minutes = ?
      WHERE id = ? AND branch_id = ?
    `).run(
      b.category_id !== undefined ? Number(b.category_id) : cur.category_id,
      b.name ?? cur.name,
      b.sku ?? cur.sku,
      b.description ?? cur.description,
      b.photo_url ?? cur.photo_url,
      b.price !== undefined ? Number(b.price) : cur.price,
      b.gst_rate !== undefined ? Number(b.gst_rate) : cur.gst_rate,
      b.dietary ?? cur.dietary,
      b.station ?? cur.station,
      b.variants !== undefined ? JSON.stringify(b.variants) : cur.variants_json,
      b.extras !== undefined ? JSON.stringify(b.extras) : cur.extras_json,
      b.labels !== undefined ? JSON.stringify(b.labels) : (cur.labels_json || '[]'),
      b.pricing_rules !== undefined ? JSON.stringify(b.pricing_rules) : (cur.pricing_rules_json || '{}'),
      b.available !== undefined ? (b.available ? 1 : 0) : cur.available,
      b.prep_minutes !== undefined ? Number(b.prep_minutes) : cur.prep_minutes,
      id,
      branchId
    );
    const updatedItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    emit(req, { type: 'menu:updated', branchId });
    res.json({
      ...updatedItem,
      variants: JSON.parse(updatedItem.variants_json || '[]'),
      extras: JSON.parse(updatedItem.extras_json || '[]'),
      labels: JSON.parse(updatedItem.labels_json || '[]'),
      pricing_rules: JSON.parse(updatedItem.pricing_rules_json || '{}')
    });
  });

  router.delete('/menu/items/:id', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    db.prepare('DELETE FROM menu_items WHERE id = ? AND branch_id = ?').run(Number(req.params.id), branchId);
    emit(req, { type: 'menu:updated', branchId });
    res.json({ ok: true });
  });

  router.put('/menu/items/:id/recipe', requirePerm('menu:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const itemId = Number(req.params.id);
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ? AND branch_id = ?').get(itemId, branchId);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    const { ingredients } = req.body || {};
    if (!Array.isArray(ingredients)) return res.status(400).json({ error: 'ingredients array required' });

    runTransaction(db, () => {
      db.prepare('DELETE FROM recipes WHERE menu_item_id = ?').run(itemId);
      const ins = db.prepare('INSERT INTO recipes (menu_item_id, ingredient_id, qty_per_serving) VALUES (?, ?, ?)');
      for (const line of ingredients) {
        if (line.ingredient_id && Number(line.qty_per_serving) > 0) {
          ins.run(itemId, Number(line.ingredient_id), Number(line.qty_per_serving));
        }
      }
    });

    emit(req, { type: 'menu:updated', branchId });
    res.json({ ok: true });
  });

  // ==================== ORDERS & KDS ====================
  router.get('/orders', (req, res) => {
    const branchId = req.activeBranchId;
    const statusParam = req.query.status || 'active';
    let where = 'branch_id = ?';
    if (statusParam === 'active') {
      where += " AND status IN ('open','hold')";
    } else if (statusParam !== 'all') {
      where += ` AND status = '${String(statusParam).replace(/[^a-z_]/g, '')}'`;
    }
    const orders = db.prepare(`SELECT id FROM orders WHERE ${where} ORDER BY id DESC LIMIT 100`).all(branchId);
    res.json(orders.map((o) => getOrderWithBill(db, o.id)));
  });

  router.get('/orders/:id', (req, res) => {
    const ord = getOrderWithBill(db, Number(req.params.id));
    if (!ord || ord.branch_id !== req.activeBranchId) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(ord);
  });

  function insertKotItems(branchId, orderId, itemsInput) {
    const settings = getSettings(db, branchId);
    const kotCount = db.prepare('SELECT COUNT(DISTINCT kot_number) AS c FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE branch_id = ?)').get(branchId).c;
    const kotNumber = `${settings?.kot_prefix || 'KOT'}-${300 + kotCount + 1}`;

    const findItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND branch_id = ?');
    const insItem = db.prepare(`
      INSERT INTO order_items (
        order_id, kot_number, menu_item_id, name, variant_name, extras_json, qty, unit_price, gst_rate, station, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
    `);

    for (const raw of itemsInput) {
      const mItem = findItem.get(Number(raw.menu_item_id), branchId);
      if (!mItem) throw new Error(`Menu item ${raw.menu_item_id} not found`);
      if (!mItem.available) throw new Error(`${mItem.name} is currently marked unavailable`);

      // Server-authoritative variant + extras price lookup
      let unitPrice = Number(mItem.price);
      let variantName = '';
      if (raw.variant_name) {
        const variants = JSON.parse(mItem.variants_json || '[]');
        const foundVar = variants.find((v) => v.name === raw.variant_name);
        if (foundVar) {
          variantName = foundVar.name;
          unitPrice = round2(unitPrice + Number(foundVar.priceDelta || 0));
        }
      }

      const appliedExtras = [];
      if (Array.isArray(raw.extras) && raw.extras.length > 0) {
        const catalogExtras = JSON.parse(mItem.extras_json || '[]');
        for (const exName of raw.extras) {
          const foundEx = catalogExtras.find((e) => e.name === exName);
          if (foundEx) {
            appliedExtras.push({ name: foundEx.name, price: Number(foundEx.price || 0) });
            unitPrice = round2(unitPrice + Number(foundEx.price || 0));
          }
        }
      }

      const qty = Math.max(1, Math.round(Number(raw.qty || 1)));

      // Apply active Happy Hour rule if enabled in menu customization
      const hh = settings?.customization?.menu;
      if (hh?.happyHourEnabled && Number(hh.happyHourDiscountPct || 0) > 0) {
        try {
          const hhNow = new Intl.DateTimeFormat('en-GB', {
            timeZone: settings.timezone || 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).format(new Date());
          const start = hh.happyHourStart || '16:00';
          const end = hh.happyHourEnd || '19:00';
          const inWindow = start <= end ? (hhNow >= start && hhNow <= end) : (hhNow >= start || hhNow <= end);
          if (inWindow) {
            const pct = Math.min(100, Math.max(0, Number(hh.happyHourDiscountPct)));
            unitPrice = round2(unitPrice * (1 - pct / 100));
          }
        } catch { /* ignore invalid timezone */ }
      }

      insItem.run(
        orderId,
        kotNumber,
        mItem.id,
        mItem.name,
        variantName,
        JSON.stringify(appliedExtras),
        qty,
        unitPrice,
        mItem.gst_rate,
        mItem.station,
        String(raw.notes || '').trim()
      );
    }
    return kotNumber;
  }

  // Create new order (or append KOT if table already has an open order)
  router.post('/orders', requirePerm('pos:use'), (req, res) => {
    const branchId = req.activeBranchId;
    const { order_type, table_id, customer_name, customer_phone, notes, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    try {
      const result = runTransaction(db, () => {
        const settings = getSettings(db, branchId);
        const oType = ['dine_in', 'takeaway', 'delivery'].includes(order_type) ? order_type : 'dine_in';
        let targetTableId = oType === 'dine_in' && table_id ? Number(table_id) : null;
        let orderId = null;

        if (targetTableId) {
          const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(targetTableId, branchId);
          if (!table) throw new Error('Selected table not found');
          if (table.status === 'merged' && table.merged_into_table_id) {
            targetTableId = table.merged_into_table_id;
          }
          const resolvedTable = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(targetTableId);
          if (resolvedTable.current_order_id) {
            orderId = resolvedTable.current_order_id;
          }
        }

        if (!orderId) {
          const count = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE branch_id = ?').get(branchId).c;
          const orderNum = `ORD-${1050 + count + 1}`;
          const applySc = oType === 'dine_in' || Boolean(settings?.customization?.businessRules?.serviceChargeOnTakeaway);
          const scRate = applySc ? Number(settings?.service_charge_rate || 0) : 0;
          const info = db.prepare(`
            INSERT INTO orders (
              branch_id, order_number, order_type, table_id, customer_name, customer_phone, status, service_charge_rate, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
          `).run(
            branchId,
            orderNum,
            oType,
            targetTableId,
            customer_name ? String(customer_name).trim() : '',
            customer_phone || '',
            scRate,
            notes || '',
            req.user.id
          );
          orderId = Number(info.lastInsertRowid);

          if (targetTableId) {
            db.prepare(`
              UPDATE dining_tables SET status = 'occupied', current_order_id = ?, updated_at = datetime('now') WHERE id = ?
            `).run(orderId, targetTableId);
          }
        }

        const kotNumber = insertKotItems(branchId, orderId, items);
        logAudit(branchId, req.user.id, 'CREATE_KOT', 'order', orderId, { kotNumber, itemCount: items.length });
        return { orderId, kotNumber };
      });

      const fullOrder = getOrderWithBill(db, result.orderId);
      emit(req, { type: 'orders:updated', branchId, orderId: result.orderId, kotNumber: result.kotNumber });
      emit(req, { type: 'kds:new_kot', branchId, orderId: result.orderId, kotNumber: result.kotNumber });
      emit(req, { type: 'tables:updated', branchId });
      res.status(201).json(fullOrder);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/orders/:id/items', requirePerm('pos:use'), (req, res) => {
    const branchId = req.activeBranchId;
    const orderId = Number(req.params.id);
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array required' });
    }
    try {
      const kotNumber = runTransaction(db, () => {
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(orderId, branchId);
        if (!order || order.status === 'settled' || order.status === 'cancelled') {
          throw new Error('Active order not found');
        }
        const kot = insertKotItems(branchId, orderId, items);
        db.prepare("UPDATE orders SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(orderId);
        return kot;
      });
      const updated = getOrderWithBill(db, orderId);
      emit(req, { type: 'orders:updated', branchId, orderId, kotNumber });
      emit(req, { type: 'kds:new_kot', branchId, orderId, kotNumber });
      emit(req, { type: 'tables:updated', branchId });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update order metadata, hold/resume, discount, service charge
  router.patch('/orders/:id', requirePerm('pos:use'), (req, res) => {
    const branchId = req.activeBranchId;
    const orderId = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(orderId, branchId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'settled' || order.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot modify a ${order.status} order` });
    }

    const b = req.body || {};
    if ((b.discount_type && b.discount_type !== 'none') || Number(b.discount_value || 0) > 0) {
      if (!hasPermission(req.user, 'orders:discount')) {
        return res.status(403).json({ error: 'Your role cannot apply discounts' });
      }
      const settings = getSettings(db, branchId);
      const maxPct = Number(settings?.customization?.businessRules?.maxDiscountPct ?? 100);
      if (b.discount_type === 'percent' && Number(b.discount_value || 0) > maxPct) {
        return res.status(400).json({ error: `Discount cannot exceed configured max (${maxPct}%)` });
      }
    }

    db.prepare(`
      UPDATE orders SET
        discount_type = ?, discount_value = ?, service_charge_rate = ?,
        customer_name = ?, customer_phone = ?, notes = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      ['none', 'percent', 'flat'].includes(b.discount_type) ? b.discount_type : order.discount_type,
      b.discount_value !== undefined ? Math.max(0, Number(b.discount_value)) : order.discount_value,
      b.service_charge_rate !== undefined ? Math.max(0, Number(b.service_charge_rate)) : order.service_charge_rate,
      b.customer_name ?? order.customer_name,
      b.customer_phone ?? order.customer_phone,
      b.notes ?? order.notes,
      ['open', 'hold'].includes(b.status) ? b.status : order.status,
      orderId
    );

    const updated = getOrderWithBill(db, orderId);
    emit(req, { type: 'orders:updated', branchId, orderId });
    emit(req, { type: 'tables:updated', branchId });
    res.json(updated);
  });

  // Cancel entire open/held order and release any occupied/merged tables
  router.post('/orders/:id/cancel', requirePerm('orders:void'), (req, res) => {
    const branchId = req.activeBranchId;
    const orderId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    try {
      runTransaction(db, () => {
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(orderId, branchId);
        if (!order) throw new Error('Order not found');
        if (order.status === 'settled') throw new Error('Cannot cancel a settled order');
        if (order.status === 'cancelled') throw new Error('Order is already cancelled');
        const settings = getSettings(db, branchId);
        if (settings?.customization?.businessRules?.requireManagerForVoid && req.user.role !== 'owner' && req.user.role !== 'manager') {
          throw new Error('Manager or Owner approval is required to cancel orders');
        }
        if (settings?.customization?.businessRules?.allowCancelAfterKot === false) {
          const hasKot = db.prepare("SELECT id FROM order_items WHERE order_id = ? AND status != 'void' LIMIT 1").get(orderId);
          if (hasKot && req.user.role !== 'owner' && req.user.role !== 'manager') {
            throw new Error('Business rules disallow cancelling orders after KOT is fired');
          }
        }
        db.prepare("UPDATE orders SET status = 'cancelled', notes = CASE WHEN ? != '' THEN notes || ' [Cancel: ' || ? || ']' ELSE notes END, updated_at = datetime('now') WHERE id = ?")
          .run(reason, reason, orderId);
        db.prepare("UPDATE order_items SET status = 'void', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
        if (order.table_id) {
          db.prepare(`
            UPDATE dining_tables SET status = 'available', current_order_id = NULL, merged_into_table_id = NULL, updated_at = datetime('now')
            WHERE id = ? OR merged_into_table_id = ?
          `).run(order.table_id, order.table_id);
        }
        logAudit(branchId, req.user.id, 'CANCEL_ORDER', 'order', orderId, { orderNumber: order.order_number, reason });
      });
      emit(req, { type: 'orders:updated', branchId, orderId });
      emit(req, { type: 'kds:updated', branchId, orderId });
      emit(req, { type: 'tables:updated', branchId });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update item KDS status or void item
  router.patch('/orders/:id/items/:itemId', (req, res) => {
    const branchId = req.activeBranchId;
    const orderId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(orderId, branchId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'settled' || order.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot update items on a ${order.status} order` });
    }

    const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
    if (!item) return res.status(404).json({ error: 'Order item not found' });

    const { status, qty } = req.body || {};
    if (status === 'void') {
      if (!hasPermission(req.user, 'orders:void')) {
        return res.status(403).json({ error: 'Not allowed to void items (orders:void required)' });
      }
      const settings = getSettings(db, branchId);
      if (settings?.customization?.businessRules?.requireManagerForVoid && req.user.role !== 'owner' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Manager or Owner role is required to void items' });
      }
    }
    if (status && ['queued', 'preparing', 'ready', 'served'].includes(status)) {
      if (!hasPermission(req.user, 'kds:update') && !hasPermission(req.user, 'pos:use')) {
        return res.status(403).json({ error: 'Not allowed to update KDS status' });
      }
    }

    db.prepare(`
      UPDATE order_items SET status = ?, qty = ?, updated_at = datetime('now') WHERE id = ?
    `).run(
      ['queued', 'preparing', 'ready', 'served', 'void'].includes(status) ? status : item.status,
      qty !== undefined ? Math.max(1, Math.round(Number(qty))) : item.qty,
      itemId
    );

    if (status === 'void') {
      logAudit(branchId, req.user.id, 'VOID_ITEM', 'order_item', itemId, { name: item.name, orderId });
    }

    const updated = getOrderWithBill(db, orderId);
    emit(req, { type: 'kds:updated', branchId, orderId });
    emit(req, { type: 'orders:updated', branchId, orderId });
    emit(req, { type: 'tables:updated', branchId });
    res.json(updated);
  });

  // Bulk advance all items in a KOT on KDS
  router.post('/kds/kot-status', requirePerm('kds:update'), (req, res) => {
    const branchId = req.activeBranchId;
    const { orderId, kotNumber, status } = req.body || {};
    if (!['queued', 'preparing', 'ready', 'served'].includes(status)) {
      return res.status(400).json({ error: 'Invalid KDS status' });
    }
    const ord = db.prepare('SELECT id FROM orders WHERE id = ? AND branch_id = ?').get(Number(orderId), branchId);
    if (!ord) return res.status(404).json({ error: 'Order not found' });

    db.prepare(`
      UPDATE order_items SET status = ?, updated_at = datetime('now')
      WHERE order_id = ? AND kot_number = ? AND status != 'void'
    `).run(status, Number(orderId), String(kotNumber));

    emit(req, { type: 'kds:updated', branchId, orderId: Number(orderId) });
    res.json(getOrderWithBill(db, Number(orderId)));
  });

  // Server-side Settlement -> Invoice -> Auto Inventory Deduction -> Free Tables
  router.post('/orders/:id/settle', requirePerm('pos:use'), (req, res) => {
    const branchId = req.activeBranchId;
    const orderId = Number(req.params.id);
    const {
      paymentMode = 'upi',
      paymentDetails = {},
      amountTendered,
      discountType,
      discountValue,
      serviceChargeRate
    } = req.body || {};

    try {
      const settled = runTransaction(db, () => {
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(orderId, branchId);
        if (!order) throw new Error('Order not found');
        if (order.status === 'settled') throw new Error('Order is already settled');
        if (order.status === 'cancelled') throw new Error('Cannot settle a cancelled order');
        if (db.prepare('SELECT id FROM invoices WHERE order_id = ?').get(orderId)) {
          throw new Error('An invoice has already been generated for this order');
        }

        const dType = ['none', 'percent', 'flat'].includes(discountType) ? discountType : order.discount_type;
        const dVal = discountValue !== undefined ? Math.max(0, Number(discountValue)) : order.discount_value;
        const scRate = serviceChargeRate !== undefined ? Math.max(0, Number(serviceChargeRate)) : order.service_charge_rate;

        if ((dType !== 'none' && dVal > 0) && !hasPermission(req.user, 'orders:discount')) {
          throw new Error('Your role cannot apply discounts');
        }

        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
        const activeItems = items.filter((i) => i.status !== 'void');
        if (activeItems.length === 0) throw new Error('Cannot settle an order with zero active items');

        const settings = getSettings(db, branchId);
        const maxPct = Number(settings?.customization?.businessRules?.maxDiscountPct ?? 100);
        if (dType === 'percent' && dVal > maxPct) {
          throw new Error(`Discount cannot exceed configured max (${maxPct}%)`);
        }
        const packagingFee = ['takeaway', 'delivery'].includes(order.order_type)
          ? Number(settings?.customization?.menu?.packagingCharge || 0)
          : 0;
        const bill = calculateOrderBill(items, {
          gstEnabled: settings ? settings.gst_enabled !== 0 : true,
          taxMode: settings?.tax_mode || 'exclusive',
          compositionRate: settings?.composition_rate ?? 5,
          igstRate: settings?.igst_rate ?? 0,
          discountType: dType,
          discountValue: dVal,
          serviceChargeRate: scRate,
          packagingCharge: packagingFee,
          roundOffEnabled: Boolean(settings?.round_off_enabled)
        });

        const tendered = amountTendered !== undefined ? Number(amountTendered) : bill.grand_total;
        if (paymentMode === 'cash' && (!Number.isFinite(tendered) || tendered < bill.grand_total)) {
          throw new Error(`Cash tendered (₹${tendered}) is less than grand total (₹${bill.grand_total})`);
        }
        if (paymentMode === 'split') {
          const splitSum = round2(
            Number(paymentDetails?.cash || 0) +
            Number(paymentDetails?.upi || 0) +
            Number(paymentDetails?.card || 0)
          );
          if (Math.abs(splitSum - bill.grand_total) > 0.5) {
            throw new Error(`Split payment sum (₹${splitSum}) must equal grand total (₹${bill.grand_total})`);
          }
        }
        const changeDue = paymentMode === 'cash' ? round2(Math.max(0, tendered - bill.grand_total)) : 0;

        // Generate deterministic unique sequential invoice number honoring invoice_start_number
        const startNum = Number(settings?.invoice_start_number || 1001);
        let seq = startNum + db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE branch_id = ?').get(branchId).c;
        const prefix = settings?.invoice_prefix || 'INV';
        let finalInvNum = `${prefix}-${String(seq).padStart(4, '0')}`;
        while (db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(finalInvNum)) {
          seq++;
          finalInvNum = `${prefix}-${String(seq).padStart(4, '0')}`;
        }

        let tableName = order.order_type.toUpperCase();
        if (order.table_id) {
          const tRow = db.prepare('SELECT name FROM dining_tables WHERE id = ?').get(order.table_id);
          const mergedIds = JSON.parse(order.merged_table_ids_json || '[]');
          if (tRow) {
            tableName = tRow.name;
            if (mergedIds.length > 0) {
              const mNames = mergedIds
                .map((mid) => db.prepare('SELECT name FROM dining_tables WHERE id = ?').get(mid)?.name)
                .filter(Boolean);
              if (mNames.length) tableName += ` + ${mNames.join(', ')}`;
            }
          }
        }

        const invInfo = db.prepare(`
          INSERT INTO invoices (
            branch_id, invoice_number, order_id, table_name, order_type, customer_name, customer_phone,
            subtotal, discount_amount, taxable_amount, service_charge_amount, packaging_charge, cgst_amount, sgst_amount, igst_amount,
            tax_amount, round_off, grand_total, tax_slabs_json, payment_mode, payment_details_json,
            amount_tendered, change_due, items_snapshot_json, settled_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          branchId,
          finalInvNum,
          orderId,
          tableName,
          order.order_type,
          order.customer_name,
          order.customer_phone,
          bill.subtotal,
          bill.discount_amount,
          bill.taxable_amount,
          bill.service_charge_amount,
          bill.packaging_charge || 0,
          bill.cgst_amount,
          bill.sgst_amount,
          bill.igst_amount || 0,
          bill.tax_amount,
          bill.round_off,
          bill.grand_total,
          JSON.stringify(bill.tax_slabs),
          paymentMode,
          JSON.stringify(paymentDetails),
          tendered,
          changeDue,
          JSON.stringify(bill.lines),
          req.user.id
        );

        // Mark order settled & items served
        db.prepare(`
          UPDATE orders SET discount_type = ?, discount_value = ?, service_charge_rate = ?, status = 'settled', updated_at = datetime('now')
          WHERE id = ?
        `).run(dType, dVal, scRate, orderId);
        db.prepare("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status != 'void'").run(orderId);

        // Free primary & merged tables
        if (order.table_id) {
          db.prepare(`
            UPDATE dining_tables SET status = 'available', current_order_id = NULL, merged_into_table_id = NULL, updated_at = datetime('now')
            WHERE id = ? OR merged_into_table_id = ?
          `).run(order.table_id, order.table_id);
        }

        // Deduct raw ingredients via Recipe BOM
        const getRecipe = db.prepare('SELECT ingredient_id, qty_per_serving FROM recipes WHERE menu_item_id = ?');
        const updStock = db.prepare(`
          UPDATE ingredients SET stock_qty = MAX(0, ROUND(stock_qty - ?, 3)), updated_at = datetime('now') WHERE id = ?
        `);
        const insMove = db.prepare(`
          INSERT INTO stock_movements (branch_id, ingredient_id, delta_qty, reason, reference_id, user_id)
          VALUES (?, ?, ?, 'sale_deduction', ?, ?)
        `);

        for (const item of activeItems) {
          if (!item.menu_item_id) continue;
          const lines = getRecipe.all(item.menu_item_id);
          for (const r of lines) {
            const deduct = round2(r.qty_per_serving * item.qty);
            updStock.run(deduct, r.ingredient_id);
            insMove.run(branchId, r.ingredient_id, -deduct, finalInvNum, req.user.id);
          }
        }

        logAudit(branchId, req.user.id, 'SETTLE_INVOICE', 'invoice', invInfo.lastInsertRowid, {
          invoiceNumber: finalInvNum,
          grandTotal: bill.grand_total,
          paymentMode
        });

        return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invInfo.lastInsertRowid);
      });

      emit(req, { type: 'orders:settled', branchId, orderId, invoiceId: settled.id });
      emit(req, { type: 'tables:updated', branchId });
      emit(req, { type: 'inventory:updated', branchId });
      res.json(settled);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ==================== INVOICES & PDF ====================
  router.get('/invoices', (req, res) => {
    const branchId = req.activeBranchId;
    const rows = db.prepare(`
      SELECT inv.*, u.name AS cashier_name
      FROM invoices inv
      LEFT JOIN users u ON u.id = inv.settled_by
      WHERE inv.branch_id = ?
      ORDER BY inv.id DESC
      LIMIT 150
    `).all(branchId);
    res.json(rows);
  });

  router.get('/invoices/:id', (req, res) => {
    const inv = db.prepare(`
      SELECT inv.* FROM invoices inv
      JOIN branches b ON b.id = inv.branch_id
      WHERE inv.id = ? AND b.restaurant_id = ?
    `).get(Number(req.params.id), req.restaurantId);
    if (!inv || (inv.branch_id !== req.activeBranchId && req.user.role !== 'owner')) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({
      ...inv,
      items: JSON.parse(inv.items_snapshot_json || '[]'),
      tax_slabs: JSON.parse(inv.tax_slabs_json || '[]')
    });
  });

  router.get('/invoices/:id/pdf', (req, res) => {
    const inv = db.prepare(`
      SELECT inv.* FROM invoices inv
      JOIN branches b ON b.id = inv.branch_id
      WHERE inv.id = ? AND b.restaurant_id = ?
    `).get(Number(req.params.id), req.restaurantId);
    if (!inv || (inv.branch_id !== req.activeBranchId && req.user.role !== 'owner')) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(inv.branch_id);
    const settings = getSettings(db, inv.branch_id);
    streamInvoicePdf(res, inv, branch, settings);
  });

  // ==================== INVENTORY ====================
  router.get('/inventory', requirePerm('inventory:view'), (req, res) => {
    const branchId = req.activeBranchId;
    const ingredients = db.prepare('SELECT * FROM ingredients WHERE branch_id = ? ORDER BY name ASC').all(branchId);
    const movements = db.prepare(`
      SELECT sm.*, ing.name AS ingredient_name, ing.unit, u.name AS user_name
      FROM stock_movements sm
      JOIN ingredients ing ON ing.id = sm.ingredient_id
      LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.branch_id = ?
      ORDER BY sm.id DESC
      LIMIT 60
    `).all(branchId);
    res.json({
      ingredients,
      movements,
      lowStockCount: ingredients.filter((i) => i.stock_qty <= i.par_level).length
    });
  });

  router.post('/inventory', requirePerm('inventory:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const { name, sku, unit, stock_qty, par_level, unit_cost, supplier } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Ingredient name is required' });
    const info = db.prepare(`
      INSERT INTO ingredients (branch_id, name, sku, unit, stock_qty, par_level, unit_cost, supplier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branchId,
      name.trim(),
      sku || `ING-${Date.now().toString().slice(-4)}`,
      unit || 'kg',
      Number(stock_qty || 0),
      Number(par_level || 5),
      Number(unit_cost || 0),
      supplier || ''
    );
    emit(req, { type: 'inventory:updated', branchId });
    res.status(201).json(db.prepare('SELECT * FROM ingredients WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/inventory/:id', requirePerm('inventory:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?').get(id, branchId);
    if (!cur) return res.status(404).json({ error: 'Ingredient not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE ingredients SET name = ?, sku = ?, unit = ?, par_level = ?, unit_cost = ?, supplier = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.name ?? cur.name,
      b.sku ?? cur.sku,
      b.unit ?? cur.unit,
      b.par_level !== undefined ? Number(b.par_level) : cur.par_level,
      b.unit_cost !== undefined ? Number(b.unit_cost) : cur.unit_cost,
      b.supplier ?? cur.supplier,
      id
    );
    emit(req, { type: 'inventory:updated', branchId });
    res.json(db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id));
  });

  router.post('/inventory/:id/adjust', requirePerm('inventory:edit'), (req, res) => {
    const branchId = req.activeBranchId;
    const id = Number(req.params.id);
    const { deltaQty, reason } = req.body || {};
    const delta = Number(deltaQty);
    if (!delta || Number.isNaN(delta)) return res.status(400).json({ error: 'Non-zero deltaQty is required' });

    const updated = runTransaction(db, () => {
      const cur = db.prepare('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?').get(id, branchId);
      if (!cur) throw new Error('Ingredient not found');
      const nextStock = Math.max(0, round2(cur.stock_qty + delta));
      db.prepare("UPDATE ingredients SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?").run(nextStock, id);
      db.prepare(`
        INSERT INTO stock_movements (branch_id, ingredient_id, delta_qty, reason, user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(branchId, id, delta, reason || (delta > 0 ? 'restock' : 'wastage'), req.user.id);
      return db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    });

    emit(req, { type: 'inventory:updated', branchId });
    res.json(updated);
  });

  router.delete('/inventory/:id', requirePerm('inventory:edit'), (req, res) => {
    db.prepare('DELETE FROM ingredients WHERE id = ? AND branch_id = ?').run(Number(req.params.id), req.activeBranchId);
    emit(req, { type: 'inventory:updated', branchId: req.activeBranchId });
    res.json({ ok: true });
  });

  // ==================== CUSTOM ROLES & STAFF ====================
  router.get('/roles', requirePerm('staff:view'), (req, res) => {
    const rows = db.prepare('SELECT * FROM custom_roles WHERE restaurant_id = ? ORDER BY id ASC').all(req.restaurantId);
    res.json(rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions_json || '[]') })));
  });

  router.post('/roles', requirePerm('staff:edit'), (req, res) => {
    const { name, description, permissions, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Role name is required' });
    try {
      const info = db.prepare(`
        INSERT INTO custom_roles (restaurant_id, name, description, permissions_json, color)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        req.restaurantId,
        String(name).trim(),
        String(description || ''),
        JSON.stringify(Array.isArray(permissions) ? permissions : []),
        String(color || '#38bdf8')
      );
      const row = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json({ ...row, permissions: JSON.parse(row.permissions_json || '[]') });
    } catch (err) {
      res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Role name already exists' : err.message });
    }
  });

  router.put('/roles/:id', requirePerm('staff:edit'), (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM custom_roles WHERE id = ? AND restaurant_id = ?').get(id, req.restaurantId);
    if (!cur) return res.status(404).json({ error: 'Role not found' });
    const { name, description, permissions, color } = req.body || {};
    db.prepare(`
      UPDATE custom_roles SET name = ?, description = ?, permissions_json = ?, color = ? WHERE id = ? AND restaurant_id = ?
    `).run(
      name ? String(name).trim() : cur.name,
      description !== undefined ? String(description) : cur.description,
      permissions !== undefined ? JSON.stringify(Array.isArray(permissions) ? permissions : []) : cur.permissions_json,
      color || cur.color,
      id,
      req.restaurantId
    );
    const upd = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(id);
    res.json({ ...upd, permissions: JSON.parse(upd.permissions_json || '[]') });
  });

  router.delete('/roles/:id', requirePerm('staff:edit'), (req, res) => {
    db.prepare('DELETE FROM custom_roles WHERE id = ? AND restaurant_id = ?').run(Number(req.params.id), req.restaurantId);
    res.json({ ok: true });
  });

  // ==================== STAFF & ROLES ====================
  router.get('/staff', requirePerm('staff:view'), (req, res) => {
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.custom_role_name, u.custom_permissions_json, u.branch_id, u.active, u.created_at, b.name AS branch_name
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.restaurant_id = ?
      ORDER BY u.id ASC
    `).all(req.restaurantId);
    res.json(rows.map((r) => ({
      ...r,
      custom_permissions: r.custom_permissions_json ? JSON.parse(r.custom_permissions_json) : null
    })));
  });

  router.post('/staff', requirePerm('staff:edit'), (req, res) => {
    const { name, email, password, pin, role, custom_role_name, branch_id, custom_permissions } = req.body || {};
    if (!name || !email || !password || !pin || !role) {
      return res.status(400).json({ error: 'Name, email, password, PIN, and role are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^\d{4,6}$/.test(String(pin).trim())) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits' });
    }
    if (!['owner', 'manager', 'cashier', 'waiter', 'chef'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (role === 'owner' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can create another owner' });
    }
    const targetBranchId = branch_id ? Number(branch_id) : req.activeBranchId;
    const validBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND restaurant_id = ?').get(targetBranchId, req.restaurantId);
    if (!validBranch) {
      return res.status(400).json({ error: 'Assigned branch does not belong to this restaurant' });
    }
    const customPermsJson = Array.isArray(custom_permissions) ? JSON.stringify(custom_permissions) : null;
    try {
      const info = db.prepare(`
        INSERT INTO users (restaurant_id, name, email, password_hash, pin_hash, role, custom_role_name, custom_permissions_json, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.restaurantId,
        name.trim(),
        email.trim().toLowerCase(),
        hashSecret(password),
        hashSecret(String(pin).trim()),
        role,
        String(custom_role_name || '').trim(),
        customPermsJson,
        targetBranchId
      );
      res.status(201).json(
        db.prepare('SELECT id, name, email, role, custom_role_name, custom_permissions_json, branch_id, active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid)
      );
    } catch (err) {
      res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Email already exists' : err.message });
    }
  });

  router.put('/staff/:id', requirePerm('staff:edit'), (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM users WHERE id = ? AND restaurant_id = ?').get(id, req.restaurantId);
    if (!cur) return res.status(404).json({ error: 'Staff user not found' });
    const b = req.body || {};
    if (id === req.user.id && b.active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    if (req.user.role !== 'owner' && (cur.role === 'owner' || b.role === 'owner')) {
      return res.status(403).json({ error: 'Only an owner can modify or assign the owner role' });
    }
    if (b.password && String(b.password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (b.pin && !/^\d{4,6}$/.test(String(b.pin).trim())) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits' });
    }
    const nextBranchId = b.branch_id !== undefined ? Number(b.branch_id) : cur.branch_id;
    const validBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND restaurant_id = ?').get(nextBranchId, req.restaurantId);
    if (!validBranch) {
      return res.status(400).json({ error: 'Assigned branch does not belong to this restaurant' });
    }
    const nextCustomPerms = b.custom_permissions !== undefined
      ? (Array.isArray(b.custom_permissions) ? JSON.stringify(b.custom_permissions) : null)
      : cur.custom_permissions_json;

    db.prepare(`
      UPDATE users SET
        name = ?, role = ?, custom_role_name = ?, custom_permissions_json = ?, branch_id = ?, active = ?,
        password_hash = ?, pin_hash = ?
      WHERE id = ? AND restaurant_id = ?
    `).run(
      b.name ?? cur.name,
      ['owner', 'manager', 'cashier', 'waiter', 'chef'].includes(b.role) ? b.role : cur.role,
      b.custom_role_name !== undefined ? String(b.custom_role_name).trim() : (cur.custom_role_name || ''),
      nextCustomPerms,
      nextBranchId,
      b.active !== undefined ? (b.active ? 1 : 0) : cur.active,
      b.password ? hashSecret(b.password) : cur.password_hash,
      b.pin ? hashSecret(String(b.pin).trim()) : cur.pin_hash,
      id,
      req.restaurantId
    );
    res.json(db.prepare('SELECT id, name, email, role, custom_role_name, custom_permissions_json, branch_id, active, created_at FROM users WHERE id = ?').get(id));
  });

  // ==================== ANALYTICS & DASHBOARD ====================
  router.get('/analytics', (req, res) => {
    if (!hasPermission(req.user, 'dashboard:view') && !hasPermission(req.user, 'analytics:view')) {
      return res.status(403).json({ error: 'Permission denied (analytics:view required)' });
    }
    const scopeAll = req.query.scope === 'all' && req.user.role === 'owner';
    const branchId = req.activeBranchId;
    const whereBranch = scopeAll
      ? 'branch_id IN (SELECT id FROM branches WHERE restaurant_id = ?)'
      : 'branch_id = ?';
    const params = scopeAll ? [req.restaurantId] : [branchId];

    const invoices = db.prepare(`
      SELECT * FROM invoices WHERE ${whereBranch} ORDER BY created_at ASC
    `).all(...params);

    let totalRevenue = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let todayRevenue = 0;
    let todayOrders = 0;
    const todayPrefix = new Date().toISOString().slice(0, 10);

    const dailyMap = {};
    const paymentMap = {};
    const itemMap = {};
    const orderTypeMap = {};

    for (const inv of invoices) {
      totalRevenue = round2(totalRevenue + inv.grand_total);
      totalTax = round2(totalTax + inv.tax_amount);
      totalDiscount = round2(totalDiscount + inv.discount_amount);

      const day = String(inv.created_at).slice(0, 10);
      if (day === todayPrefix) {
        todayRevenue = round2(todayRevenue + inv.grand_total);
        todayOrders++;
      }

      if (!dailyMap[day]) dailyMap[day] = { day, revenue: 0, tax: 0, orders: 0 };
      dailyMap[day].revenue = round2(dailyMap[day].revenue + inv.grand_total);
      dailyMap[day].tax = round2(dailyMap[day].tax + inv.tax_amount);
      dailyMap[day].orders++;

      const pm = String(inv.payment_mode || 'other').toUpperCase();
      paymentMap[pm] = round2((paymentMap[pm] || 0) + inv.grand_total);

      const ot = String(inv.order_type || 'dine_in').toUpperCase();
      orderTypeMap[ot] = (orderTypeMap[ot] || 0) + 1;

      const items = JSON.parse(inv.items_snapshot_json || '[]');
      for (const it of items) {
        const key = it.name;
        if (!itemMap[key]) itemMap[key] = { name: key, qty: 0, revenue: 0 };
        itemMap[key].qty += Number(it.qty || 0);
        itemMap[key].revenue = round2(itemMap[key].revenue + Number(it.line_gross || it.qty * it.unit_price || 0));
      }
    }

    const activeOrdersCount = db.prepare(
      `SELECT COUNT(*) AS c FROM orders WHERE ${whereBranch} AND status IN ('open','hold')`
    ).get(...params).c;

    const occupiedTablesCount = db.prepare(
      `SELECT COUNT(*) AS c FROM dining_tables WHERE ${whereBranch} AND status = 'occupied'`
    ).get(...params).c;

    const totalTablesCount = db.prepare(
      `SELECT COUNT(*) AS c FROM dining_tables WHERE ${whereBranch}`
    ).get(...params).c;

    const lowStockItems = db.prepare(
      `SELECT id, name, unit, stock_qty, par_level FROM ingredients WHERE ${whereBranch} AND stock_qty <= par_level ORDER BY stock_qty ASC`
    ).all(...params);

    const branchBreakdown = db.prepare(`
      SELECT b.id, b.name, b.code, COUNT(i.id) AS orders, COALESCE(SUM(i.grand_total), 0) AS revenue
      FROM branches b
      LEFT JOIN invoices i ON i.branch_id = b.id
      WHERE b.restaurant_id = ?
      GROUP BY b.id
    `).all(req.restaurantId);

    const aov = invoices.length ? round2(totalRevenue / invoices.length) : 0;

    res.json({
      kpis: {
        totalRevenue,
        totalTax,
        totalDiscount,
        totalOrders: invoices.length,
        todayRevenue,
        todayOrders,
        aov,
        activeOrdersCount,
        occupiedTablesCount,
        totalTablesCount,
        lowStockCount: lowStockItems.length
      },
      dailySeries: Object.values(dailyMap).slice(-14),
      topItems: Object.values(itemMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      paymentBreakdown: Object.entries(paymentMap).map(([mode, amount]) => ({ mode, amount })),
      orderTypeBreakdown: Object.entries(orderTypeMap).map(([type, count]) => ({ type, count })),
      lowStockItems,
      branchBreakdown
    });
  });

  router.get('/analytics/export.csv', requirePerm('analytics:view'), (req, res) => {
    const branchId = req.activeBranchId;
    const rows = db.prepare('SELECT * FROM invoices WHERE branch_id = ? ORDER BY id DESC').all(branchId);
    const csvCell = (val) => {
      const s = String(val ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = 'Invoice Number,Date,Order Type,Table,Customer,Subtotal,Discount,Service Charge,Packaging Charge,CGST,SGST,IGST,Grand Total,Payment Mode\n';
    const body = rows.map((r) => [
      csvCell(r.invoice_number),
      csvCell(r.created_at),
      csvCell(r.order_type),
      csvCell(r.table_name),
      csvCell(r.customer_name),
      r.subtotal,
      r.discount_amount,
      r.service_charge_amount,
      r.packaging_charge || 0,
      r.cgst_amount,
      r.sgst_amount,
      r.igst_amount || 0,
      r.grand_total,
      csvCell(r.payment_mode)
    ].join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gres-invoices.csv"');
    res.send(header + body);
  });

  router.get('/audit', requirePerm('analytics:view'), (req, res) => {
    const rows = db.prepare(`
      SELECT a.*, u.name AS user_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.branch_id = ?
      ORDER BY a.id DESC
      LIMIT 40
    `).all(req.activeBranchId);
    res.json(rows);
  });

  // Restaurant workspace full JSON backup export (authenticated owner/settings:view)
  router.get('/backup/export', requirePerm('settings:view'), (req, res) => {
    const branchId = req.activeBranchId;
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurantId);
    const branches = db.prepare('SELECT * FROM branches WHERE restaurant_id = ?').all(req.restaurantId);
    const settings = getSettings(db, branchId);
    const floors = db.prepare('SELECT * FROM floors WHERE branch_id = ?').all(branchId);
    const tables = db.prepare('SELECT * FROM dining_tables WHERE branch_id = ?').all(branchId);
    const categories = db.prepare('SELECT * FROM menu_categories WHERE branch_id = ?').all(branchId);
    const menuItems = db.prepare('SELECT * FROM menu_items WHERE branch_id = ?').all(branchId);
    const ingredients = db.prepare('SELECT * FROM ingredients WHERE branch_id = ?').all(branchId);
    const roles = db.prepare('SELECT * FROM custom_roles WHERE restaurant_id = ?').all(req.restaurantId);
    const staff = db.prepare('SELECT id, name, email, role, custom_role_name, custom_permissions_json, branch_id, active, created_at FROM users WHERE restaurant_id = ?').all(req.restaurantId);
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'GRES Restaurant Management System',
      restaurant,
      branches,
      settings,
      floors,
      tables,
      categories,
      menuItems,
      ingredients,
      roles,
      staff
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gres-backup-${restaurant?.code || branchId}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  return router;
}

module.exports = { createApiRouter };
