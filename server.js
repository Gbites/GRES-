const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { initDb } = require('./src/db');
const { createApiRouter } = require('./src/routes');
const { SESSION_COOKIE, parseCookies, verifyToken } = require('./src/auth');

function createApp({ dbPath } = {}) {
  const db = initDb(dbPath);
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(event) {
    const payload = JSON.stringify({ ...event, ts: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState !== 1) continue;
      // Strict multi-tenant isolation: only deliver events to clients in the same restaurant
      if (event.restaurantId && client.restaurantId !== event.restaurantId) continue;
      client.send(payload);
    }
  }

  wss.on('connection', (ws, req) => {
    const cookies = parseCookies(req.headers.cookie);
    const parsed = verifyToken(cookies[SESSION_COOKIE]);
    if (!parsed) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    const user = db.prepare('SELECT id, restaurant_id, active FROM users WHERE id = ?').get(parsed.uid);
    if (!user || !user.active || !user.restaurant_id) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    ws.userId = user.id;
    ws.restaurantId = user.restaurant_id;
    ws.send(JSON.stringify({ type: 'ws:connected', restaurantId: user.restaurant_id, ts: Date.now() }));
  });

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, product: 'GRES', time: new Date().toISOString() });
  });

  app.use('/api', createApiRouter(db, broadcast));
  app.use(express.static(path.join(__dirname, 'public')));

  // Fallback to index.html for clean app shell reload
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return { app, server, db, wss, broadcast };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`GRES Restaurant Management System running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
