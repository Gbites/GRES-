const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { setRuntimeSecret } = require('./auth');

function runTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      restaurant_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      onboarding_step INTEGER NOT NULL DEFAULT 1,
      onboarding_data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      map_lat REAL DEFAULT NULL,
      map_lng REAL DEFAULT NULL,
      gstin TEXT NOT NULL DEFAULT '',
      fssai TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','chef')),
      custom_permissions_json TEXT DEFAULT NULL,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      branch_id INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
      restaurant_name TEXT NOT NULL DEFAULT '',
      tagline TEXT NOT NULL DEFAULT '',
      brand_initials TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      currency_code TEXT NOT NULL DEFAULT 'INR',
      currency_symbol TEXT NOT NULL DEFAULT '₹',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
      opening_hours_json TEXT NOT NULL DEFAULT '{}',
      holidays_json TEXT NOT NULL DEFAULT '[]',
      gst_enabled INTEGER NOT NULL DEFAULT 1,
      gstin TEXT NOT NULL DEFAULT '',
      tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','composition')),
      cgst_rate REAL NOT NULL DEFAULT 2.5,
      sgst_rate REAL NOT NULL DEFAULT 2.5,
      igst_rate REAL NOT NULL DEFAULT 0,
      composition_rate REAL NOT NULL DEFAULT 5,
      default_gst_rate REAL NOT NULL DEFAULT 5,
      service_charge_rate REAL NOT NULL DEFAULT 0,
      round_off_enabled INTEGER NOT NULL DEFAULT 1,
      invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      invoice_start_number INTEGER NOT NULL DEFAULT 1001,
      kot_prefix TEXT NOT NULL DEFAULT 'KOT',
      thermal_width TEXT NOT NULL DEFAULT '80mm' CHECK (thermal_width IN ('58mm','80mm')),
      theme_mode TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark','light')),
      accent_color TEXT NOT NULL DEFAULT '#f97316',
      pos_density TEXT NOT NULL DEFAULT 'comfortable' CHECK (pos_density IN ('compact','comfortable')),
      kds_sla_minutes INTEGER NOT NULL DEFAULT 12,
      kds_sound_enabled INTEGER NOT NULL DEFAULT 1,
      receipt_header TEXT NOT NULL DEFAULT '',
      receipt_footer TEXT NOT NULL DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      customization_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#38bdf8',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(restaurant_id, name)
    );

    CREATE TABLE IF NOT EXISTS floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sections_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      floor_name TEXT NOT NULL DEFAULT 'Ground Floor',
      zone TEXT NOT NULL DEFAULT 'Main Hall',
      seats INTEGER NOT NULL DEFAULT 4,
      shape TEXT NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round','rect')),
      x INTEGER NOT NULL DEFAULT 40,
      y INTEGER NOT NULL DEFAULT 40,
      width INTEGER NOT NULL DEFAULT 100,
      height INTEGER NOT NULL DEFAULT 100,
      color TEXT NOT NULL DEFAULT '',
      size_scale REAL NOT NULL DEFAULT 1,
      label_override TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','reserved','merged')),
      merged_into_table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
      current_order_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
      label TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 5,
      dietary TEXT NOT NULL DEFAULT 'veg' CHECK (dietary IN ('veg','non-veg','vegan','egg')),
      station TEXT NOT NULL DEFAULT 'Main Kitchen',
      variants_json TEXT NOT NULL DEFAULT '[]',
      extras_json TEXT NOT NULL DEFAULT '[]',
      labels_json TEXT NOT NULL DEFAULT '[]',
      pricing_rules_json TEXT NOT NULL DEFAULT '{}',
      available INTEGER NOT NULL DEFAULT 1,
      prep_minutes INTEGER NOT NULL DEFAULT 12,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'kg',
      stock_qty REAL NOT NULL DEFAULT 0,
      par_level REAL NOT NULL DEFAULT 5,
      unit_cost REAL NOT NULL DEFAULT 0,
      supplier TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      qty_per_serving REAL NOT NULL,
      UNIQUE(menu_item_id, ingredient_id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      delta_qty REAL NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      order_number TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'dine_in' CHECK (order_type IN ('dine_in','takeaway','delivery')),
      table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
      merged_table_ids_json TEXT NOT NULL DEFAULT '[]',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','hold','settled','cancelled')),
      discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','flat')),
      discount_value REAL NOT NULL DEFAULT 0,
      service_charge_rate REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      kot_number TEXT NOT NULL,
      menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      variant_name TEXT NOT NULL DEFAULT '',
      extras_json TEXT NOT NULL DEFAULT '[]',
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 5,
      station TEXT NOT NULL DEFAULT 'Main Kitchen',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preparing','ready','served','void')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL UNIQUE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      table_name TEXT NOT NULL DEFAULT '',
      order_type TEXT NOT NULL DEFAULT 'dine_in',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      taxable_amount REAL NOT NULL,
      service_charge_amount REAL NOT NULL DEFAULT 0,
      packaging_charge REAL NOT NULL DEFAULT 0,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      round_off REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      tax_slabs_json TEXT NOT NULL DEFAULT '[]',
      payment_mode TEXT NOT NULL DEFAULT 'upi',
      payment_details_json TEXT NOT NULL DEFAULT '{}',
      amount_tendered REAL NOT NULL DEFAULT 0,
      change_due REAL NOT NULL DEFAULT 0,
      items_snapshot_json TEXT NOT NULL DEFAULT '[]',
      settled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tables_branch ON dining_tables(branch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON invoices(branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingredients_branch ON ingredients(branch_id);
  `);

  // Non-destructive column upgrades for existing SQLite databases
  for (const sql of [
    "ALTER TABLE restaurants ADD COLUMN restaurant_type TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN description TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE restaurants ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE restaurants ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 8',
    "ALTER TABLE restaurants ADD COLUMN onboarding_data_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE branches ADD COLUMN country TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE branches ADD COLUMN state TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE branches ADD COLUMN city TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE branches ADD COLUMN postal_code TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE branches ADD COLUMN email TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE branches ADD COLUMN map_lat REAL DEFAULT NULL',
    'ALTER TABLE branches ADD COLUMN map_lng REAL DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN custom_permissions_json TEXT DEFAULT NULL',
    "ALTER TABLE users ADD COLUMN custom_role_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE settings ADD COLUMN brand_initials TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE settings ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'",
    "ALTER TABLE settings ADD COLUMN date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY'",
    "ALTER TABLE settings ADD COLUMN opening_hours_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE settings ADD COLUMN holidays_json TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE settings ADD COLUMN gst_enabled INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE settings ADD COLUMN gstin TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE settings ADD COLUMN cgst_rate REAL NOT NULL DEFAULT 2.5',
    'ALTER TABLE settings ADD COLUMN sgst_rate REAL NOT NULL DEFAULT 2.5',
    'ALTER TABLE settings ADD COLUMN igst_rate REAL NOT NULL DEFAULT 0',
    'ALTER TABLE settings ADD COLUMN invoice_start_number INTEGER NOT NULL DEFAULT 1001',
    "ALTER TABLE settings ADD COLUMN customization_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE dining_tables ADD COLUMN floor_name TEXT NOT NULL DEFAULT 'Ground Floor'",
    "ALTER TABLE dining_tables ADD COLUMN color TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE dining_tables ADD COLUMN size_scale REAL NOT NULL DEFAULT 1',
    "ALTER TABLE dining_tables ADD COLUMN label_override TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE menu_categories ADD COLUMN parent_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL',
    "ALTER TABLE menu_categories ADD COLUMN label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE menu_items ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE menu_items ADD COLUMN extras_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE menu_items ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE menu_items ADD COLUMN pricing_rules_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE order_items ADD COLUMN extras_json TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE invoices ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN packaging_charge REAL NOT NULL DEFAULT 0',
    'ALTER TABLE branches ADD COLUMN restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE',
    'ALTER TABLE users ADD COLUMN restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE'
  ]) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_branches_restaurant ON branches(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_users_restaurant ON users(restaurant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id) WHERE order_id IS NOT NULL;
  `);
}

/**
 * Non-destructive migration: if an existing database has legacy branches/users with NULL restaurant_id,
 * assign them to a preserved restaurant tenant record without deleting or overwriting any existing data.
 */
function migrateLegacyRecords(db) {
  const unlinkedBranch = db.prepare('SELECT id, name, code FROM branches WHERE restaurant_id IS NULL LIMIT 1').get();
  const unlinkedUser = db.prepare('SELECT id FROM users WHERE restaurant_id IS NULL LIMIT 1').get();
  if (!unlinkedBranch && !unlinkedUser) return;

  runTransaction(db, () => {
    let rest = db.prepare('SELECT id FROM restaurants ORDER BY id ASC LIMIT 1').get();
    if (!rest) {
      const settingsRow = unlinkedBranch
        ? db.prepare('SELECT restaurant_name FROM settings WHERE branch_id = ?').get(unlinkedBranch.id)
        : null;
      const rName = settingsRow?.restaurant_name || unlinkedBranch?.name || 'Workspace';
      const rCode = unlinkedBranch?.code || 'MAIN';
      const info = db.prepare('INSERT INTO restaurants (name, code, onboarding_completed, onboarding_step) VALUES (?, ?, 1, 8)').run(rName, rCode);
      rest = { id: Number(info.lastInsertRowid) };
    }
    db.prepare('UPDATE branches SET restaurant_id = ? WHERE restaurant_id IS NULL').run(rest.id);
    db.prepare('UPDATE users SET restaurant_id = ? WHERE restaurant_id IS NULL').run(rest.id);
  });
}

function initDb(customDbPath) {
  const dbPath = customDbPath || path.join(__dirname, '..', 'data', 'restaurant.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  createSchema(db);
  migrateLegacyRecords(db);

  // Load or generate persistent session secret
  let secretRow = db.prepare("SELECT value FROM app_secrets WHERE key = 'session_secret'").get();
  if (!secretRow) {
    const newSecret = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO app_secrets (key, value) VALUES ('session_secret', ?)").run(newSecret);
    secretRow = { value: newSecret };
  }
  if (!process.env.SESSION_SECRET) {
    setRuntimeSecret(secretRow.value);
  }

  return db;
}

module.exports = { initDb, runTransaction };
