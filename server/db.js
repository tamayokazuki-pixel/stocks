import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'northstar.sqlite');
if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
    cash_cents INTEGER NOT NULL DEFAULT 10000000 CHECK(cash_cents >= 0),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS assets (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sector TEXT NOT NULL,
    exchange TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'stock' CHECK(kind IN ('stock', 'etf')),
    color TEXT NOT NULL DEFAULT '#5265a8',
    base_price_cents INTEGER NOT NULL CHECK(base_price_cents > 0),
    base_change_percent REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS watchlists (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES assets(symbol),
    PRIMARY KEY(user_id, symbol)
  );
  CREATE TABLE IF NOT EXISTS positions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES assets(symbol),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    average_cost_cents INTEGER NOT NULL CHECK(average_cost_cents > 0),
    PRIMARY KEY(user_id, symbol)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES assets(symbol),
    side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    type TEXT NOT NULL CHECK(type IN ('market', 'limit')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    limit_price_cents INTEGER,
    filled_price_cents INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'filled', 'cancelled')),
    created_at INTEGER NOT NULL,
    filled_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status, symbol);
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id),
    target_user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// All multi-statement account mutations run synchronously in one SQLite transaction.
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function audit(actorId, targetUserId, action, detail) {
  db.prepare('INSERT INTO audit_log(actor_id, target_user_id, action, detail, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(actorId, targetUserId, action, detail, Date.now());
}

const initialAssets = [
  ['AAPL', 'Apple Inc.', 'Technology', 'NASDAQ', 'stock', '#252d40', 24736, 1.24, 1],
  ['NVDA', 'NVIDIA Corp.', 'Technology', 'NASDAQ', 'stock', '#76b900', 18247, 2.83, 1],
  ['MSFT', 'Microsoft Corp.', 'Technology', 'NASDAQ', 'stock', '#4285c5', 51291, 0.94, 1],
  ['GOOGL', 'Alphabet Inc.', 'Technology', 'NASDAQ', 'stock', '#e85b51', 19254, -0.62, 0],
  ['AMZN', 'Amazon.com Inc.', 'Consumer', 'NASDAQ', 'stock', '#ef9d32', 22716, 1.37, 0],
  ['TSLA', 'Tesla Inc.', 'Automotive', 'NASDAQ', 'stock', '#df4848', 27683, -1.18, 1],
  ['META', 'Meta Platforms Inc.', 'Technology', 'NASDAQ', 'stock', '#3679da', 70235, 2.06, 0],
  ['AMD', 'Advanced Micro Devices', 'Technology', 'NASDAQ', 'stock', '#373e50', 16642, -0.84, 0],
  ['SPY', 'SPDR S&P 500 ETF', 'ETF', 'NYSE Arca', 'etf', '#394fc1', 66038, 0.73, 1],
  ['QQQ', 'Invesco QQQ Trust', 'ETF', 'NASDAQ', 'etf', '#5b43bd', 58827, 1.12, 1],
  ['DIA', 'SPDR Dow Jones ETF', 'ETF', 'NYSE Arca', 'etf', '#5b8d9c', 47242, 0.35, 0],
  ['JPM', 'JPMorgan Chase & Co.', 'Finance', 'NYSE', 'stock', '#326b91', 30218, 0.45, 0],
];

if (db.prepare('SELECT COUNT(*) AS count FROM assets').get().count === 0) {
  const insert = db.prepare(`INSERT INTO assets(symbol, name, sector, exchange, kind, color, base_price_cents, base_change_percent, featured)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  transaction(() => { for (const asset of initialAssets) insert.run(...asset); });
}

if (!getSetting('trading_enabled')) setSetting('trading_enabled', '1');
if (db.prepare('SELECT COUNT(*) AS count FROM announcements').get().count === 0) {
  db.prepare('INSERT INTO announcements(title, body, active, created_at) VALUES(?, ?, 1, ?)')
    .run('A clearer way to follow the market', 'Welcome to Northstar. Explore stocks, build a watchlist, and practice your strategy with a paper trading account.', Date.now());
}

export const demoEnabled = process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE !== 'false' && process.env.NODE_ENV !== 'production');

if (demoEnabled && !db.prepare('SELECT id FROM users WHERE email = ?').get('alex@northstar.demo')) {
  const positions = [
    ['AAPL', 40, 19870], ['NVDA', 60, 13540], ['MSFT', 20, 42730], ['SPY', 22, 56025],
  ];
  const cashCents = 10000000 - positions.reduce((sum, [, quantity, cost]) => sum + quantity * cost, 0);
  transaction(() => {
    const result = db.prepare('INSERT INTO users(name, email, password_hash, cash_cents, created_at) VALUES(?, ?, ?, ?, ?)')
      .run('Alex Morgan', 'alex@northstar.demo', bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), cashCents, Date.now());
    const id = Number(result.lastInsertRowid);
    const addPosition = db.prepare('INSERT INTO positions(user_id, symbol, quantity, average_cost_cents) VALUES(?, ?, ?, ?)');
    const addOrder = db.prepare(`INSERT INTO orders(user_id, symbol, side, type, quantity, filled_price_cents, status, created_at, filled_at)
      VALUES(?, ?, 'buy', 'market', ?, ?, 'filled', ?, ?)`);
    positions.forEach(([symbol, quantity, cost], index) => {
      const filledAt = Date.now() - (positions.length - index) * 86400000;
      addPosition.run(id, symbol, quantity, cost);
      addOrder.run(id, symbol, quantity, cost, filledAt, filledAt);
    });
    for (const symbol of ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ']) {
      db.prepare('INSERT INTO watchlists(user_id, symbol) VALUES(?, ?)').run(id, symbol);
    }
  });
}

const adminEmail = process.env.ADMIN_EMAIL || (process.env.NODE_ENV !== 'production' ? 'admin@northstar.demo' : '');
const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'NorthstarAdmin123!' : '');
if (adminEmail && adminPassword && !db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail.toLowerCase())) {
  if (adminPassword.length < 12) {
    console.warn('ADMIN_PASSWORD must be at least 12 characters; admin was not created.');
  } else {
    db.prepare("INSERT INTO users(name, email, password_hash, role, cash_cents, created_at) VALUES(?, ?, ?, 'admin', ?, ?)")
      .run('Northstar Admin', adminEmail.toLowerCase(), bcrypt.hashSync(adminPassword, 12), 10000000, Date.now());
  }
}

// Remove expired sessions on boot. Active sessions are also checked on every request.
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
