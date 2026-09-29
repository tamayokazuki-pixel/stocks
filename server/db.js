import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool, types } = pg;
types.setTypeParser(20, value => Number(value)); // int8 values are cents, timestamps, and safe app IDs.
const context = new AsyncLocalStorage();
const sqliteMode = process.env.DATABASE_DRIVER === 'sqlite';
let sqlite;
let pool;
let sqliteQueue = Promise.resolve();

export const DEMO_EMAIL = 'alex@northstar.demo';
export const DEMO_EMAIL_DOMAIN = DEMO_EMAIL.split('@')[1];
export const demoEnabled = process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE !== 'false' && process.env.NODE_ENV !== 'production');

if (sqliteMode) {
  // The existing SQLite implementation remains available for the isolated local test suite.
  sqlite = await import('./sqlite-db.js');
  pool = null;
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it to the Supabase PostgreSQL connection string.');
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 10),
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  await initializePostgres();
}

function sqliteSql(sql) {
  // Repositories use PostgreSQL-style numbered placeholders. SQLite's native test driver uses ?.
  return sql.replace(/\s+FOR UPDATE\b/gi, '').replace(/\$(\d+)/g, '?');
}

function executeSqlite(sql, params) {
  const statement = sqlite.db.prepare(sqliteSql(sql));
  const isRead = /^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
  if (isRead) {
    const rows = statement.all(...params);
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...params);
  return { rows: [], rowCount: Number(result.changes || 0), lastInsertRowid: Number(result.lastInsertRowid || 0) };
}

async function serializedSqlite(sql, params) {
  const current = sqliteQueue.then(() => executeSqlite(sql, params));
  sqliteQueue = current.then(() => undefined, () => undefined);
  return current;
}

export async function query(sql, params = []) {
  if (sqliteMode) {
    if (context.getStore()?.sqliteTransaction) return executeSqlite(sql, params);
    return serializedSqlite(sql, params);
  }
  const client = context.getStore()?.client;
  return (client || pool).query(sql, params);
}

export async function one(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

export async function many(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

export async function run(sql, params = []) {
  return query(sql, params);
}

export async function transaction(fn) {
  if (sqliteMode) {
    let release;
    const previous = sqliteQueue;
    sqliteQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      sqlite.db.exec('BEGIN IMMEDIATE');
      const result = await context.run({ sqliteTransaction: true }, () => fn(query));
      sqlite.db.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await context.run({ client }, () => fn(query));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getSetting(key) {
  return (await one('SELECT value FROM settings WHERE key = $1', [key]))?.value;
}

export async function setSetting(key, value) {
  await run('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
}

export async function audit(actorId, targetUserId, action, detail) {
  await run('INSERT INTO audit_log(actor_id, target_user_id, action, detail, created_at) VALUES($1, $2, $3, $4, $5)',
    [actorId, targetUserId, action, detail, Date.now()]);
}

async function initializePostgres() {
  const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase/schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  await pool.query(schema);
  if (!await getSetting('trading_enabled')) await setSetting('trading_enabled', '1');
  await one(`INSERT INTO announcements(title, body, active, created_at)
    SELECT $1, $2, 1, $3 WHERE NOT EXISTS (SELECT 1 FROM announcements) RETURNING id`,
    ['A clearer way to follow the market', 'Welcome to Northstar. Explore stocks, build a watchlist, and practice your strategy with a paper trading account.', Date.now()]);

  if (demoEnabled && !await one('SELECT id FROM users WHERE lower(email) = lower($1)', [DEMO_EMAIL])) {
    const positions = [['AAPL', 40, 19870], ['NVDA', 60, 13540], ['MSFT', 20, 42730], ['SPY', 22, 56025]];
    const cashCents = 10000000 - positions.reduce((sum, [, quantity, cost]) => sum + quantity * cost, 0);
    await transaction(async tx => {
      const inserted = await tx('INSERT INTO users(name, email, password_hash, cash_cents, created_at, is_demo) VALUES($1, $2, $3, $4, $5, 1) RETURNING id',
        ['Alex Morgan', DEMO_EMAIL, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), cashCents, Date.now()]);
      const userId = Number(inserted.rows[0].id);
      for (const [index, [symbol, quantity, cost]] of positions.entries()) {
        const filledAt = Date.now() - (positions.length - index) * 86400000;
        await tx('INSERT INTO positions(user_id, symbol, quantity, average_cost_cents) VALUES($1, $2, $3, $4)', [userId, symbol, quantity, cost]);
        await tx(`INSERT INTO orders(user_id, symbol, side, type, quantity, filled_price_cents, status, created_at, filled_at)
          VALUES($1, $2, 'buy', 'market', $3, $4, 'filled', $5, $5)`, [userId, symbol, quantity, cost, filledAt]);
      }
      for (const symbol of ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ']) {
        await tx('INSERT INTO watchlists(user_id, symbol) VALUES($1, $2) ON CONFLICT DO NOTHING', [userId, symbol]);
      }
    });
  }
  await run('UPDATE users SET is_demo = 1 WHERE lower(email) = lower($1)', [DEMO_EMAIL]);

  const seedName = (process.env.SEED_USER_NAME || 'Northstar Trader').trim();
  const seedEmail = (process.env.SEED_USER_EMAIL || '').trim().toLowerCase();
  const seedPassword = process.env.SEED_USER_PASSWORD || '';
  if (seedEmail && seedPassword) {
    if (seedEmail === DEMO_EMAIL || seedEmail.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
      console.warn('SEED_USER_EMAIL uses the reserved demo domain; the account was not created.');
    } else if (seedPassword.length < 8 || seedPassword.length > 72) {
      console.warn('SEED_USER_PASSWORD must be 8–72 characters; the account was not created.');
    } else if (!await one('SELECT id FROM users WHERE lower(email) = lower($1)', [seedEmail])) {
      const inserted = await one('INSERT INTO users(name, email, password_hash, created_at, is_demo) VALUES($1, $2, $3, $4, 0) RETURNING id',
        [seedName, seedEmail, bcrypt.hashSync(seedPassword, 12), Date.now()]);
      for (const symbol of ['AAPL', 'NVDA', 'SPY']) await run('INSERT INTO watchlists(user_id, symbol) VALUES($1, $2) ON CONFLICT DO NOTHING', [inserted.id, symbol]);
      console.log(`Provisioned personal account ${seedEmail}`);
    }
  }
  const adminEmail = (process.env.ADMIN_EMAIL || (process.env.NODE_ENV !== 'production' ? 'admin@northstar.demo' : '')).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'NorthstarAdmin123!' : '');
  if (adminEmail && adminPassword && !await one('SELECT id FROM users WHERE lower(email) = lower($1)', [adminEmail])) {
    if (adminPassword.length < 12) console.warn('ADMIN_PASSWORD must be at least 12 characters; admin was not created.');
    else await run("INSERT INTO users(name, email, password_hash, role, cash_cents, created_at) VALUES($1, $2, $3, 'admin', $4, $5)",
      ['Northstar Admin', adminEmail, bcrypt.hashSync(adminPassword, 12), 10000000, Date.now()]);
  }
  await run('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
}

export async function closeDatabase() {
  if (pool) await pool.end();
  if (sqlite?.db?.isOpen) sqlite.db.close();
}
