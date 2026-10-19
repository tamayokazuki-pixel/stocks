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
import { one, many, run, transaction, getSetting, setSetting, audit, closeDatabase, demoEnabled, DEMO_EMAIL, DEMO_EMAIL_DOMAIN } from './db.js';
import { createSession, destroySession, getUser, linkedUserId, requireAuth, requireAdmin, switchSession, userById } from './auth.js';
import { getAsset, getAssets, getHistory, getSnapshot, publishMarketUpdate, resetQuote, reloadMarketData, initializeMarket, setOrderMatcher, startMarket, subscribeToMarket } from './market.js';
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
api.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'northstar') return res.status(403).json({ error: 'Request verification failed.' });
  next();
});
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

async function resolveSwitchTarget(user, linkedId) {
  if (!user) return null;
  if (linkedId) {
    const linked = await one('SELECT id, name, status, is_demo AS "isDemo" FROM users WHERE id = $1', [linkedId]);
    if (linked && linked.status === 'active' && Boolean(linked.isDemo) !== user.isDemo) return { id: linked.id, name: linked.name, isDemo: Boolean(linked.isDemo) };
  }
  if (user.isDemo || !demoEnabled) return null;
  const demo = await one('SELECT id, name, status, is_demo AS "isDemo" FROM users WHERE lower(email) = lower($1)', [DEMO_EMAIL]);
  if (!demo || !demo.isDemo || demo.status !== 'active') return null;
  return { id: demo.id, name: demo.name, isDemo: true };
}
async function authState(user, linkedId) { return { user, demoEnabled, switchTarget: await resolveSwitchTarget(user, linkedId) }; }
async function currentAuthState(req) { const user = await getUser(req); return authState(user, user ? await linkedUserId(req) : null); }
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' } });

api.get('/health', (_req, res) => res.json({ status: 'ok', service: 'northstar', time: Date.now() }));
api.get('/auth/me', async (req, res) => res.json(await currentAuthState(req)));
api.post('/auth/switch', authLimiter, async (req, res) => {
  const user = await getUser(req);
  if (!user) fail('Please sign in to continue.', 401);
  const target = await resolveSwitchTarget(user, await linkedUserId(req));
  if (!target) fail('There is no other account to switch to right now.', 400);
  await switchSession(req, res, target.id);
  await audit(user.id, target.id, 'switch_account', user.isDemo ? 'Returned to a personal account' : 'Opened the shared demo account');
  res.json(await authState(await userById(target.id), user.id));
});
api.post('/auth/register', authLimiter, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (name.length < 2 || name.length > 60) fail('Name must be between 2 and 60 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
  if (email === DEMO_EMAIL || email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) fail('That domain is reserved for the shared demo account. Use your own email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) fail('Password must be 8–72 characters.');
  if (await one('SELECT id FROM users WHERE lower(email) = lower($1)', [email])) fail('An account with this email already exists.', 409);
  let inserted;
  try {
    inserted = await one('INSERT INTO users(name, email, password_hash, created_at, is_demo) VALUES($1, $2, $3, $4, 0) RETURNING id',
      [name, email, bcrypt.hashSync(password, 12), Date.now()]);
  } catch (error) { if (error.code === '23505') fail('An account with this email already exists.', 409); throw error; }
  const userId = inserted.id;
  for (const symbol of ['AAPL', 'NVDA', 'SPY']) await run('INSERT INTO watchlists(user_id, symbol) VALUES($1, $2) ON CONFLICT DO NOTHING', [userId, symbol]);
  await destroySession(req, res);
  await createSession(res, userId);
  res.status(201).json(await authState(await userById(userId), null));
});
api.post('/auth/login', authLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!email || typeof password !== 'string') fail('Enter your email and password.');
  const user = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) fail('Incorrect email or password.', 401);
  if (user.status !== 'active') fail('This account is currently suspended.', 403);
  await destroySession(req, res); await createSession(res, user.id);
  res.json(await authState(await userById(user.id), null));
});
api.post('/auth/demo', authLimiter, async (req, res) => {
  if (!demoEnabled) fail('The demo account is not available.', 404);
  const demo = await one('SELECT id, is_demo AS "isDemo", status FROM users WHERE lower(email) = lower($1)', [DEMO_EMAIL]);
  if (!demo?.isDemo || demo.status !== 'active') fail('The demo account is not available.', 404);
  const previous = await getUser(req);
  await destroySession(req, res);
  const linked = previous && !previous.isDemo ? previous.id : null;
  await createSession(res, demo.id, linked);
  res.json(await authState(await userById(demo.id), linked));
});
api.post('/auth/logout', async (req, res) => { await destroySession(req, res); res.json({ ok: true }); });

api.get('/market', (_req, res) => res.json(getSnapshot()));
api.get('/market/stream', subscribeToMarket);
api.get('/market/:symbol/history', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase(), range = String(req.query.range || '1D').toUpperCase();
  if (!getAsset(symbol)) fail('Asset not found.', 404);
  if (!['1D', '1W', '1M', '3M', '1Y'].includes(range)) fail('Choose a valid chart range.');
  res.json(await getHistory(symbol, range));
});
api.get('/account', requireAuth, async (req, res) => res.json(await getAccountSummary(req.user.id)));
api.get('/account/cash-transactions', requireAuth, async (req, res) => res.json({ transactions: await getCashTransactions(req.user.id) }));
api.post('/account/cash-transactions', requireAuth, async (req, res) => {
  const cashTransaction = await createCashTransaction(req.user.id, req.body || {});
  res.status(201).json({ transaction: cashTransaction, account: await getAccountSummary(req.user.id) });
});
api.get('/orders', requireAuth, async (req, res) => res.json({ orders: await getOrders(req.user.id) }));
api.post('/orders', requireAuth, async (req, res) => {
  const order = await placeOrder(req.user.id, req.body || {});
  res.status(201).json({ order, account: await getAccountSummary(req.user.id) });
});
api.delete('/orders/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) fail('Invalid order ID.');
  res.json({ order: await cancelOrder(req.user.id, id), account: await getAccountSummary(req.user.id) });
});
api.get('/watchlist', requireAuth, async (req, res) => {
  const rows = await many('SELECT symbol FROM watchlists WHERE user_id = $1 ORDER BY symbol', [req.user.id]);
  res.json({ symbols: rows.map(row => row.symbol) });
});
api.put('/watchlist/:symbol', requireAuth, async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!getAsset(symbol)?.active) fail('This asset is not available.', 404);
  await run('INSERT INTO watchlists(user_id, symbol) VALUES($1, $2) ON CONFLICT DO NOTHING', [req.user.id, symbol]);
  res.json({ symbol, saved: true });
});
api.delete('/watchlist/:symbol', requireAuth, async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  await run('DELETE FROM watchlists WHERE user_id = $1 AND symbol = $2', [req.user.id, symbol]);
  res.json({ symbol, saved: false });
});

api.get('/admin/overview', requireAdmin, async (_req, res) => {
  const users = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active,
    COUNT(*) FILTER (WHERE is_demo = 0) AS "realAccounts" FROM users WHERE role = 'user'`);
  const orders = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE status = 'filled') AS filled,
    COALESCE(SUM(CASE WHEN status = 'filled' THEN quantity * filled_price_cents ELSE 0 END), 0) AS "volumeCents" FROM orders`);
  const assetCount = await one('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE active = 1) AS active FROM assets');
  const notices = (await many('SELECT id, title, body, active, created_at AS "createdAt" FROM announcements ORDER BY created_at DESC')).map(notice => ({ ...notice, active: Boolean(notice.active) }));
  res.json({ users, orders, assets: assetCount, tradingEnabled: await getSetting('trading_enabled') === '1', notices });
});
api.get('/admin/users', requireAdmin, async (_req, res) => {
  const users = await many(`SELECT id, name, email, role, status, is_demo AS "isDemo", cash_cents AS "cashCents", created_at AS "createdAt"
    FROM users ORDER BY created_at DESC`);
  res.json({ users: users.map(user => ({ ...user, isDemo: Boolean(user.isDemo) })) });
});
api.patch('/admin/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) fail('Invalid user ID.');
  const target = await userById(id);
  if (!target) fail('User not found.', 404);
  if (target.role === 'admin') fail('Admin accounts cannot be changed here.', 403);
  if (target.isDemo) fail('The shared demo account is managed by the demo seed, not this screen.', 403);
  const action = req.body?.action;
  await transaction(async () => {
    if (action === 'suspend' || action === 'activate') {
      const status = action === 'suspend' ? 'suspended' : 'active';
      await run('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
      if (status === 'suspended') {
        await run("UPDATE orders SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending'", [id]);
        await run('DELETE FROM sessions WHERE user_id = $1', [id]);
      }
      await audit(req.user.id, id, action, `Account ${status}`);
    } else if (action === 'adjustCash') {
      const amount = req.body?.amountCents;
      if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100000000) fail('Enter an adjustment between $0.01 and $1,000,000.');
      const current = await one('SELECT cash_cents AS "cashCents" FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (current.cashCents + amount < await reservedCash(id)) fail('This adjustment would leave insufficient cash for pending orders.');
      await run('UPDATE users SET cash_cents = cash_cents + $1 WHERE id = $2', [amount, id]);
      await audit(req.user.id, id, 'adjust_cash', `${amount > 0 ? '+' : ''}${(amount / 100).toFixed(2)} paper USD`);
    } else fail('Choose a valid admin action.');
  });
  res.json({ user: await userById(id) });
});
api.get('/admin/assets', requireAdmin, (_req, res) => res.json({ assets: getAssets(false) }));
api.post('/admin/assets', requireAdmin, async (req, res) => {
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
  await run(`INSERT INTO assets(symbol, name, sector, exchange, kind, color, base_price_cents, base_change_percent, active, featured)
    VALUES($1, $2, $3, $4, $5, $6, $7, 0, 1, 0)`, [symbol, name, sector, exchange, kind, color, Math.round(basePrice * 100)]);
  await reloadMarketData(); await audit(req.user.id, null, 'add_asset', `Listed ${symbol} (${name})`); resetQuote(symbol);
  res.status(201).json({ asset: getAsset(symbol) });
});
api.patch('/admin/assets/:symbol', requireAdmin, async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase(), asset = getAsset(String(req.params.symbol).toUpperCase());
  if (!asset) fail('Asset not found.', 404);
  const assignments = [], values = [];
  const add = (column, value) => { values.push(value); assignments.push(`${column} = $${values.length}`); };
  if (typeof req.body?.active === 'boolean') add('active', Number(req.body.active));
  if (typeof req.body?.featured === 'boolean') add('featured', Number(req.body.featured));
  if (req.body?.basePrice !== undefined) {
    const price = Number(req.body.basePrice);
    if (!Number.isFinite(price) || price < 0.01 || price > 100000) fail('Enter a valid reference price.');
    add('base_price_cents', Math.round(price * 100));
  }
  if (!assignments.length) fail('Nothing to update.');
  await transaction(async () => {
    values.push(symbol);
    await run(`UPDATE assets SET ${assignments.join(', ')} WHERE symbol = $${values.length}`, values);
    if (req.body?.active === false) await run("UPDATE orders SET status = 'cancelled' WHERE symbol = $1 AND status = 'pending'", [symbol]);
    await audit(req.user.id, null, 'update_asset', `Updated ${symbol}: ${assignments.join(', ')}`);
  });
  await reloadMarketData(); resetQuote(symbol);
  res.json({ asset: getAsset(symbol) });
});
api.patch('/admin/settings', requireAdmin, async (req, res) => {
  if (typeof req.body?.tradingEnabled !== 'boolean') fail('Choose whether trading is enabled.');
  await setSetting('trading_enabled', req.body.tradingEnabled ? '1' : '0');
  await audit(req.user.id, null, 'trading_control', req.body.tradingEnabled ? 'Resumed paper trading' : 'Paused paper trading');
  await publishMarketUpdate();
  res.json({ tradingEnabled: req.body.tradingEnabled });
});
api.post('/admin/announcements', requireAdmin, async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (title.length < 3 || title.length > 100 || body.length < 10 || body.length > 600) fail('Use a title (3–100 characters) and message (10–600 characters).');
  const announcement = await one('INSERT INTO announcements(title, body, active, created_at) VALUES($1, $2, 1, $3) RETURNING id', [title, body, Date.now()]);
  await audit(req.user.id, null, 'publish_notice', `Published announcement #${announcement.id}: ${title}`);
  await publishMarketUpdate();
  res.status(201).json({ id: Number(announcement.id), title, body, active: true });
});
api.patch('/admin/announcements/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof req.body?.active !== 'boolean') fail('Invalid announcement update.');
  const result = await run('UPDATE announcements SET active = $1 WHERE id = $2', [Number(req.body.active), id]);
  if (!result.rowCount) fail('Announcement not found.', 404);
  await audit(req.user.id, null, 'update_notice', `${req.body.active ? 'Published' : 'Unpublished'} announcement #${id}`);
  await publishMarketUpdate();
  res.json({ id, active: req.body.active });
});
api.get('/admin/audit', requireAdmin, async (_req, res) => {
  const entries = await many(`SELECT audit_log.id, audit_log.action, audit_log.detail, audit_log.created_at AS "createdAt",
    actor.name AS "actorName", target.name AS "targetName" FROM audit_log
    LEFT JOIN users actor ON actor.id = audit_log.actor_id LEFT JOIN users target ON target.id = audit_log.target_user_id
    ORDER BY audit_log.created_at DESC, audit_log.id DESC LIMIT 50`);
  res.json({ entries });
});

registerTransferRoutes(api);
api.use((_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

async function start() {
  await initializeMarket();
  if (isProduction) {
    app.use(express.static(path.join(root, 'dist'), { index: false }));
    app.use((req, res, next) => { if (req.method !== 'GET' && req.method !== 'HEAD') return next(); res.sendFile(path.join(root, 'dist', 'index.html')); });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true, hmr: { server } } });
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
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise(resolve => server.close(resolve));
  await closeDatabase();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
