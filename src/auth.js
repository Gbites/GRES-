const crypto = require('node:crypto');

const SESSION_COOKIE = 'gres_session';
// Ephemeral fallback secret per process if env var isn't supplied; persistent secret stored in DB settings on boot
let runtimeSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function setRuntimeSecret(secret) {
  if (secret && typeof secret === 'string' && secret.length >= 32) {
    runtimeSecret = secret;
  }
}

function hashSecret(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifySecret(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(String(plain), salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', runtimeSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', runtimeSecret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: [
    'dashboard:view', 'pos:use', 'floor:view', 'floor:edit', 'tables:transfer', 'tables:merge',
    'orders:view', 'orders:void', 'orders:discount', 'kds:view', 'kds:update',
    'menu:view', 'menu:edit', 'inventory:view', 'inventory:edit',
    'analytics:view', 'staff:view', 'staff:edit', 'settings:view', 'settings:edit', 'branches:view'
  ],
  cashier: [
    'dashboard:view', 'pos:use', 'floor:view', 'tables:transfer', 'tables:merge',
    'orders:view', 'orders:discount', 'kds:view', 'menu:view', 'inventory:view', 'settings:view'
  ],
  waiter: [
    'pos:use', 'floor:view', 'tables:transfer', 'orders:view', 'kds:view', 'menu:view'
  ],
  chef: [
    'kds:view', 'kds:update', 'menu:view', 'inventory:view', 'orders:view'
  ]
};

function getEffectivePermissions(user) {
  if (!user) return [];
  if (user.role === 'owner') return ['*'];
  if (user.custom_permissions_json) {
    try {
      const parsed = JSON.parse(user.custom_permissions_json);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall back to role defaults
    }
  }
  return ROLE_PERMISSIONS[user.role] || [];
}

function hasPermission(roleOrUser, perm) {
  const perms = typeof roleOrUser === 'string'
    ? (ROLE_PERMISSIONS[roleOrUser] || [])
    : getEffectivePermissions(roleOrUser);
  return perms.includes('*') || perms.includes(perm);
}

function createAuthMiddleware(db) {
  function authenticateRequest(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const parsed = verifyToken(token);
    if (!parsed) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = db.prepare(
      'SELECT id, restaurant_id, name, email, role, custom_permissions_json, branch_id, active FROM users WHERE id = ?'
    ).get(parsed.uid);
    if (!user || !user.active || !user.restaurant_id) {
      return res.status(401).json({ error: 'Session invalid or user deactivated' });
    }
    req.user = user;
    req.restaurantId = user.restaurant_id;

    // Resolve active branch strictly within the authenticated user's restaurant
    let candidateBranchId = Number(parsed.branchId || user.branch_id || 0);
    if (user.role !== 'owner' && user.branch_id) {
      candidateBranchId = user.branch_id;
    }
    const ownedBranch = candidateBranchId
      ? db.prepare('SELECT id FROM branches WHERE id = ? AND restaurant_id = ? AND active = 1').get(candidateBranchId, user.restaurant_id)
      : null;
    if (ownedBranch) {
      req.activeBranchId = ownedBranch.id;
    } else {
      const firstBranch = db.prepare('SELECT id FROM branches WHERE restaurant_id = ? AND active = 1 ORDER BY id ASC LIMIT 1').get(user.restaurant_id);
      if (!firstBranch) {
        return res.status(403).json({ error: 'No active branch found for this restaurant' });
      }
      req.activeBranchId = firstBranch.id;
    }
    next();
  }

  function requirePerm(perm) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!hasPermission(req.user, perm)) {
        return res.status(403).json({ error: `Permission denied (${perm})` });
      }
      next();
    };
  }

  return { authenticateRequest, requirePerm };
}

module.exports = {
  SESSION_COOKIE,
  setRuntimeSecret,
  hashSecret,
  verifySecret,
  signToken,
  verifyToken,
  parseCookies,
  ROLE_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  createAuthMiddleware
};
