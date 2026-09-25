import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startIsolatedServer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-test-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(''),
    env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true', DATABASE_PATH: path.join(directory, 'test.sqlite'),
      ADMIN_EMAIL: 'admin@tests.example', ADMIN_PASSWORD: 'a-long-test-password-123', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data.toString(); });
  child.stderr.on('data', data => { logs += data.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited unexpectedly: ${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { base, child, directory };
    } catch { /* Starting up. */ }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for server: ${logs}`);
}

async function request(base, route, { method = 'GET', body, cookie, verified = true } = {}) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(verified && method !== 'GET' ? { 'X-Requested-With': 'northstar' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sessionCookie = response.headers.getSetCookie().filter(value => value.startsWith('northstar_session=')).at(-1);
  return { status: response.status, data: await response.json(), cookie: sessionCookie?.split(';')[0] };
}

test('account, trading, watchlist and admin flows are enforced by the API', { timeout: 30000 }, async () => {
  const { base, child, directory } = await startIsolatedServer();
  try {
    const market = await request(base, '/market');
    assert.equal(market.status, 200);
    assert.equal(market.data.mode, 'demo');
    assert.ok(market.data.quotes.AAPL.price > 0);
    assert.equal((await request(base, '/account')).status, 401);
    assert.equal((await request(base, '/auth/register', { method: 'POST', verified: false, body: {} })).status, 403);

    const registered = await request(base, '/auth/register', { method: 'POST', body: { name: 'Taylor Chen', email: 'taylor@example.com', password: 'secure-password-123' } });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.role, 'user');
    assert.ok(registered.cookie?.startsWith('northstar_session='));
    const cookie = registered.cookie;
    assert.equal((await request(base, '/auth/register', { method: 'POST', body: { name: 'Taylor Chen', email: 'TAYLOR@example.com', password: 'secure-password-123' } })).status, 409);
    const initialAccount = await request(base, '/account', { cookie });
    assert.equal(initialAccount.data.cashCents, 10000000);
    assert.deepEqual(initialAccount.data.positions, []);

    const buy = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 3 } });
    assert.equal(buy.status, 201);
    assert.equal(buy.data.order.status, 'filled');
    assert.equal(buy.data.account.positions.find(position => position.symbol === 'AAPL').quantity, 3);
    assert.equal(buy.data.account.cashCents, 10000000 - buy.data.order.filledPriceCents * 3);
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'sell', type: 'market', quantity: 4 } })).status, 400);
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: -1 } })).status, 400);

    const limitBuy = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 2, limitPrice: 1 } });
    assert.equal(limitBuy.data.order.status, 'pending');
    assert.equal(limitBuy.data.account.reservedCashCents, 200);
    assert.equal(limitBuy.data.account.availableCashCents, limitBuy.data.account.cashCents - 200);
    const cancelled = await request(base, `/orders/${limitBuy.data.order.id}`, { method: 'DELETE', cookie });
    assert.equal(cancelled.data.order.status, 'cancelled');
    assert.equal(cancelled.data.account.reservedCashCents, 0);
    assert.equal((await request(base, `/orders/${limitBuy.data.order.id}`, { method: 'DELETE', cookie })).status, 400);

    const limitSell = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'sell', type: 'limit', quantity: 2, limitPrice: 99999 } });
    assert.equal(limitSell.data.order.status, 'pending');
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'sell', type: 'market', quantity: 2 } })).status, 400);
    assert.equal((await request(base, '/watchlist/TSLA', { method: 'PUT', cookie })).status, 200);
    assert.ok((await request(base, '/watchlist', { cookie })).data.symbols.includes('TSLA'));
    await request(base, '/watchlist/TSLA', { method: 'DELETE', cookie });
    assert.ok(!(await request(base, '/watchlist', { cookie })).data.symbols.includes('TSLA'));

    assert.equal((await request(base, '/admin/overview', { cookie })).status, 403);
    const adminLogin = await request(base, '/auth/login', { method: 'POST', body: { email: 'admin@tests.example', password: 'a-long-test-password-123' } });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.cookie;
    assert.equal((await request(base, '/admin/overview', { cookie: adminCookie })).status, 200);
    assert.equal((await request(base, '/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { tradingEnabled: false } })).status, 200);
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 1 } })).status, 403);
    await request(base, '/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { tradingEnabled: true } });
    const listed = await request(base, '/admin/assets', { method: 'POST', cookie: adminCookie,
      body: { symbol: 'ACME', name: 'Acme Corporation', sector: 'Industrial', exchange: 'NYSE', kind: 'stock', basePrice: 42.5 } });
    assert.equal(listed.status, 201);
    assert.equal((await request(base, '/market')).data.quotes.ACME.price, 42.5);
    const waiting = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'ACME', side: 'buy', type: 'limit', quantity: 1, limitPrice: 20 } });
    assert.equal(waiting.data.order.status, 'pending');
    await request(base, '/admin/assets/ACME', { method: 'PATCH', cookie: adminCookie, body: { basePrice: 15 } });
    let matched;
    const matchDeadline = Date.now() + 11000;
    while (Date.now() < matchDeadline) {
      matched = (await request(base, '/orders', { cookie })).data.orders.find(order => order.id === waiting.data.order.id);
      if (matched.status === 'filled') break;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    assert.equal(matched.status, 'filled', 'a crossed pending limit order should fill on a price tick');
    assert.ok(matched.filledPriceCents <= 2000);
    assert.equal((await request(base, '/account', { cookie })).data.positions.find(position => position.symbol === 'ACME').quantity, 1);
    const announcement = await request(base, '/admin/announcements', { method: 'POST', cookie: adminCookie, body: { title: 'Platform update', body: 'Paper trading is available today.' } });
    assert.equal(announcement.status, 201);
    assert.ok((await request(base, '/market')).data.notices.some(notice => notice.title === 'Platform update'));
    assert.equal((await request(base, `/admin/assets/AAPL`, { method: 'PATCH', cookie: adminCookie, body: { active: false } })).status, 200);
    assert.equal((await request(base, '/orders', { cookie })).data.orders.find(order => order.id === limitSell.data.order.id).status, 'cancelled');
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 1 } })).status, 400);
    assert.equal((await request(base, `/admin/users/${registered.data.user.id}`, { method: 'PATCH', cookie: adminCookie, body: { action: 'suspend' } })).status, 200);
    assert.equal((await request(base, '/account', { cookie })).status, 401);
    assert.ok((await request(base, '/admin/audit', { cookie: adminCookie })).data.entries.length >= 4);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
