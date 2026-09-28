import 'dotenv/config';
import { registerTransferRoutes } from './transfers.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { db, demoEnabled, transaction, getSetting, setSetting, audit } from './db.js';
import { createSession, destroySession, getUser, requireAuth, requireAdmin } from './auth.js';
import { getAsset, getAssets, getHistory, getQuote, getSnapshot, publishMarketUpdate, resetQuote, setOrderMatcher, startMarket, subscribeToMarket } from './market.js';
import { cancelOrder, createCashTransaction, getAccountSummary, getCashTransactions, getOrders, matchPendingOrders, placeOrder, reservedCash } from './orders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, frameguard: false }));
app.use(express.json({ limit: '64kb' }));

const api = express.Router();
app.use('/api', api);

// Cookies are SameSite=Lax; this custom header additionally rejects cross-site form submissions.
api.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'northstar') {
    return res.status(403).json({ error: 'Request verification failed.' });
  }
  next();
});

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function userById(id) {
  return db.prepare('SELECT id, name, email, role, status, cash_cents AS cashCents, created_at AS createdAt FROM users WHERE id = ?').get(id);
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' } });

api.get('/health', (_req, res) => res.json({ status: 'ok', service: 'northstar', time: Date.now() }));
api.get('/auth/me', (req, res) => res.json({ user: getUser(req), demoEnabled }));

api.post('/auth/register', authLimiter, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (name.length < 2 || name.length > 60) fail('Name must be between 2 and 60 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) fail('Password must be 8–72 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail('An account with this email already exists.', 409);
  const result = db.prepare('INSERT INTO users(name, email, password_hash, created_at) VALUES(?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 12), Date.now());
  const id = Number(result.lastInsertRowid);
  for (const symbol of ['AAPL', 'NVDA', 'SPY']) db.prepare('INSERT INTO watchlists(user_id, symbol) VALUES(?, ?)').run(id, symbol);
  destroySession(req, res);
  createSession(res, id);
  res.status(201).json({ user: userById(id) });
});

api.post('/auth/login', authLimiter, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!email || typeof password !== 'string') fail('Enter your email and password.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) fail('Incorrect email or password.', 401);
  if (user.status !== 'active') fail('This account is currently suspended.', 403);
  destroySession(req, res);
  createSession(res, user.id);
  res.json({ user: userById(user.id) });
});

api.post('/auth/demo', authLimiter, (req, res) => {
  if (!demoEnabled) fail('The demo account is not available.', 404);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('alex@northstar.demo');
  if (!user) fail('The demo account is not available.', 404);
  destroySession(req, res);
  createSession(res, user.id);
  res.json({ user: userById(user.id) });
});

api.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

api.get('/market', (_req, res) => res.json(getSnapshot()));
api.get('/market/stream', subscribeToMarket);
api.get('/market/:symbol/history', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  const range = String(req.query.range || '1D').toUpperCase();
  if (!getAsset(symbol)) fail('Asset not found.', 404);
  if (!['1D', '1W', '1M', '3M', '1Y'].includes(range)) fail('Choose a valid chart range.');
  res.json(await getHistory(symbol, range));
});

api.get('/account', requireAuth, (req, res) => res.json(getAccountSummary(req.user.id)));
api.get('/account/cash-transactions', requireAuth, (req, res) => res.json({ transactions: getCashTransactions(req.user.id) }));
api.post('/account/cash-transactions', requireAuth, (req, res) => {
  const cashTransaction = createCashTransaction(req.user.id, req.body || {});
  res.status(201).json({ transaction: cashTransaction, account: getAccountSummary(req.user.id) });
});
api.get('/orders', requireAuth, (req, res) => res.json({ orders: getOrders(req.user.id) }));
api.post('/orders', requireAuth, (req, res) => {
  const order = placeOrder(req.user.id, req.body || {});
  res.status(201).json({ order, account: getAccountSummary(req.user.id) });
});
api.delete('/orders/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) fail('Invalid order ID.');
  res.json({ order: cancelOrder(req.user.id, id), account: getAccountSummary(req.user.id) });
});

api.get('/watchlist', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT symbol FROM watchlists WHERE user_id = ? ORDER BY symbol').all(req.user.id);
  res.json({ symbols: rows.map(row => row.symbol) });
});
api.put('/watchlist/:symbol', requireAuth, (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!getAsset(symbol)?.active) fail('This asset is not available.', 404);
  db.prepare('INSERT OR IGNORE INTO watchlists(user_id, symbol) VALUES(?, ?)').run(req.user.id, symbol);
  res.json({ symbol, saved: true });
});
api.delete('/watchlist/:symbol', requireAuth, (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  db.prepare('DELETE FROM watchlists WHERE user_id = ? AND symbol = ?').run(req.user.id, symbol);
  res.json({ symbol, saved: false });
});

api.get('/admin/overview', requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM users WHERE role = 'user'").get();
  const orders = db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending,
    SUM(status = 'filled') AS filled, COALESCE(SUM(CASE WHEN status = 'filled' THEN quantity * filled_price_cents ELSE 0 END), 0) AS volumeCents FROM orders`).get();
  const assetCount = db.prepare('SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM assets').get();
  const notices = db.prepare('SELECT id, title, body, active, created_at AS createdAt FROM announcements ORDER BY created_at DESC').all()
    .map(notice => ({ ...notice, active: Boolean(notice.active) }));
  res.json({ users, orders, assets: assetCount, tradingEnabled: getSetting('trading_enabled') === '1', notices });
});

api.get('/admin/users', requireAdmin, (_req, res) => {
  const users = db.prepare(`SELECT id, name, email, role, status, cash_cents AS cashCents, created_at AS createdAt
    FROM users ORDER BY created_at DESC`).all();
  res.json({ users });
});

api.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) fail('Invalid user ID.');
  const target = userById(id);
  if (!target) fail('User not found.', 404);
  if (target.role === 'admin') fail('Admin accounts cannot be changed here.', 403);
  const action = req.body?.action;
  transaction(() => {
    if (action === 'suspend' || action === 'activate') {
      const status = action === 'suspend' ? 'suspended' : 'active';
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
      if (status === 'suspended') {
        db.prepare("UPDATE orders SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'").run(id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      audit(req.user.id, id, action, `Account ${status}`);
    } else if (action === 'adjustCash') {
      const amount = req.body?.amountCents;
      if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100000000) fail('Enter an adjustment between $0.01 and $1,000,000.');
      const current = db.prepare('SELECT cash_cents AS cashCents FROM users WHERE id = ?').get(id);
      if (current.cashCents + amount < reservedCash(id)) fail('This adjustment would leave insufficient cash for pending orders.');
      db.prepare('UPDATE users SET cash_cents = cash_cents + ? WHERE id = ?').run(amount, id);
      audit(req.user.id, id, 'adjust_cash', `${amount > 0 ? '+' : ''}${(amount / 100).toFixed(2)} paper USD`);
    } else fail('Choose a valid admin action.');
  });
  res.json({ user: userById(id) });
});

api.get('/admin/assets', requireAdmin, (_req, res) => res.json({ assets: getAssets(false) }));
api.post('/admin/assets', requireAdmin, (req, res) => {
  const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const sector = typeof req.body?.sector === 'string' ? req.body.sector.trim() : '';
  const exchange = typeof req.body?.exchange === 'string' ? req.body.exchange.trim() : '';
  const kind = req.body?.kind === 'etf' ? 'etf' : 'stock';
  const basePrice = Number(req.body?.basePrice);
  const color = typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#5265a8';
  if (!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol)) fail('Use a valid symbol (1–8 letters, numbers or dots).');
  if (name.length < 2 || name.length > 80 || sector.length < 2 || sector.length > 40 || exchange.length < 2 || exchange.length > 40) fail('Enter a name, sector and exchange.');
  if (!Number.isFinite(basePrice) || basePrice < 0.01 || basePrice > 100000) fail('Enter a valid reference price.');
  if (getAsset(symbol)) fail('This symbol already exists.', 409);
  db.prepare(`INSERT INTO assets(symbol, name, sector, exchange, kind, color, base_price_cents, base_change_percent, active, featured)
    VALUES(?, ?, ?, ?, ?, ?, ?, 0, 1, 0)`).run(symbol, name, sector, exchange, kind, color, Math.round(basePrice * 100));
  audit(req.user.id, null, 'add_asset', `Listed ${symbol} (${name})`);
  resetQuote(symbol);
  res.status(201).json({ asset: getAsset(symbol) });
});

api.patch('/admin/assets/:symbol', requireAdmin, (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  const asset = getAsset(symbol);
  if (!asset) fail('Asset not found.', 404);
  const updates = [];
  const values = [];
  if (typeof req.body?.active === 'boolean') { updates.push('active = ?'); values.push(Number(req.body.active)); }
  if (typeof req.body?.featured === 'boolean') { updates.push('featured = ?'); values.push(Number(req.body.featured)); }
  if (req.body?.basePrice !== undefined) {
    const price = Number(req.body.basePrice);
    if (!Number.isFinite(price) || price < 0.01 || price > 100000) fail('Enter a valid reference price.');
    updates.push('base_price_cents = ?'); values.push(Math.round(price * 100));
  }
  if (!updates.length) fail('Nothing to update.');
  transaction(() => {
    db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE symbol = ?`).run(...values, symbol);
    if (req.body?.active === false) db.prepare("UPDATE orders SET status = 'cancelled' WHERE symbol = ? AND status = 'pending'").run(symbol);
    audit(req.user.id, null, 'update_asset', `Updated ${symbol}: ${updates.join(', ')}`);
  });
  resetQuote(symbol);
  res.json({ asset: getAsset(symbol) });
});

api.patch('/admin/settings', requireAdmin, (req, res) => {
  if (typeof req.body?.tradingEnabled !== 'boolean') fail('Choose whether trading is enabled.');
  setSetting('trading_enabled', req.body.tradingEnabled ? '1' : '0');
  audit(req.user.id, null, 'trading_control', req.body.tradingEnabled ? 'Resumed paper trading' : 'Paused paper trading');
  publishMarketUpdate();
  res.json({ tradingEnabled: req.body.tradingEnabled });
});

api.post('/admin/announcements', requireAdmin, (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (title.length < 3 || title.length > 100 || body.length < 10 || body.length > 600) fail('Use a title (3–100 characters) and message (10–600 characters).');
  const result = db.prepare('INSERT INTO announcements(title, body, active, created_at) VALUES(?, ?, 1, ?)').run(title, body, Date.now());
  audit(req.user.id, null, 'publish_notice', `Published announcement #${result.lastInsertRowid}: ${title}`);
  publishMarketUpdate();
  res.status(201).json({ id: Number(result.lastInsertRowid), title, body, active: true });
});

api.patch('/admin/announcements/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof req.body?.active !== 'boolean') fail('Invalid announcement update.');
  const result = db.prepare('UPDATE announcements SET active = ? WHERE id = ?').run(Number(req.body.active), id);
  if (!result.changes) fail('Announcement not found.', 404);
  audit(req.user.id, null, 'update_notice', `${req.body.active ? 'Published' : 'Unpublished'} announcement #${id}`);
  publishMarketUpdate();
  res.json({ id, active: req.body.active });
});

api.get('/admin/audit', requireAdmin, (_req, res) => {
  const entries = db.prepare(`SELECT audit_log.id, audit_log.action, audit_log.detail, audit_log.created_at AS createdAt,
    actor.name AS actorName, target.name AS targetName FROM audit_log
    LEFT JOIN users actor ON actor.id = audit_log.actor_id
    LEFT JOIN users target ON target.id = audit_log.target_user_id
    ORDER BY audit_log.created_at DESC, audit_log.id DESC LIMIT 50`).all();
  res.json({ entries });
});

registerTransferRoutes(api);

api.use((_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

async function start() {
  if (isProduction) {
    app.use(express.static(path.join(root, 'dist'), { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(root, 'dist', 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root, appType: 'custom', server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true, hmr: { server } },
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      try {
        const template = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(req.method === 'HEAD' ? undefined : html);
      } catch (error) { vite.ssrFixStacktrace(error); next(error); }
    });
  }
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (!error.status || error.status >= 500) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
  setOrderMatcher(matchPendingOrders);
  startMarket();
  const port = Number(process.env.PORT || (isProduction ? 3000 : 5173));
  server.listen(port, '0.0.0.0', () => console.log(`Northstar ${isProduction ? 'production' : 'development'} server at http://0.0.0.0:${port}`));
}

start().catch(error => { console.error(error); process.exit(1); });
