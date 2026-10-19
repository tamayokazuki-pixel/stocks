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

// The shared demonstration account. It is seeded with a sample portfolio and is intentionally
// visible to anyone who opens it; real accounts are private to the person who registered them.
export const DEMO_EMAIL = 'alex@northstar.demo';
export const DEMO_EMAIL_DOMAIN = DEMO_EMAIL.split('@')[1];

// Schema additions are applied to databases created by earlier versions of the app.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
    cash_cents INTEGER NOT NULL DEFAULT 10000000 CHECK(cash_cents >= 0),
    created_at INTEGER NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    linked_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
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
  CREATE TABLE IF NOT EXISTS cash_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('top_up', 'withdrawal')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    balance_after_cents INTEGER NOT NULL CHECK(balance_after_cents >= 0),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cash_transactions_user ON cash_transactions(user_id, created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS transfer_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    details TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transfer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 100 AND 10000000),
    method_id INTEGER REFERENCES transfer_methods(id),
    details TEXT NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'rejected', 'cancelled')),
    review_note TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    request_key TEXT NOT NULL,
    UNIQUE(user_id, request_key)
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_user ON transfer_requests(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfer_requests(status, id DESC);
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

addColumnIfMissing('users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('sessions', 'linked_user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');

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

if (demoEnabled && !db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL)) {
  const positions = [
    ['AAPL', 40, 19870], ['NVDA', 60, 13540], ['MSFT', 20, 42730], ['SPY', 22, 56025],
  ];
  const cashCents = 10000000 - positions.reduce((sum, [, quantity, cost]) => sum + quantity * cost, 0);
  transaction(() => {
    const result = db.prepare('INSERT INTO users(name, email, password_hash, cash_cents, created_at, is_demo) VALUES(?, ?, ?, ?, ?, 1)')
      .run('Alex Morgan', DEMO_EMAIL, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), cashCents, Date.now());
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

// Databases created before the demo flag existed are backfilled so the shared account is labelled.
db.prepare('UPDATE users SET is_demo = 1 WHERE email = ?').run(DEMO_EMAIL);

// Optional real (non-demo) account provisioned from the environment, e.g. a personal paper-trading
// account for a self-hosted deployment. Credentials stay in the Git-ignored .env, never in code.
const seedName = (process.env.SEED_USER_NAME || 'Northstar Trader').trim();
const seedEmail = (process.env.SEED_USER_EMAIL || '').trim().toLowerCase();
const seedPassword = process.env.SEED_USER_PASSWORD || '';
if (seedEmail && seedPassword) {
  if (seedEmail === DEMO_EMAIL || seedEmail.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
    console.warn('SEED_USER_EMAIL uses the reserved demo domain; the account was not created.');
  } else if (seedPassword.length < 8 || seedPassword.length > 72) {
    console.warn('SEED_USER_PASSWORD must be 8–72 characters; the account was not created.');
  } else if (!db.prepare('SELECT id FROM users WHERE email = ?').get(seedEmail)) {
    const result = db.prepare('INSERT INTO users(name, email, password_hash, created_at, is_demo) VALUES(?, ?, ?, ?, 0)')
      .run(seedName, seedEmail, bcrypt.hashSync(seedPassword, 12), Date.now());
    for (const symbol of ['AAPL', 'NVDA', 'SPY']) {
      db.prepare('INSERT INTO watchlists(user_id, symbol) VALUES(?, ?)').run(Number(result.lastInsertRowid), symbol);
    }
    console.log(`Provisioned personal account ${seedEmail}`);
  }
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
