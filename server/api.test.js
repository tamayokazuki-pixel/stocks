import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startIsolatedServer, request } from './test-support.js';

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

    assert.equal((await request(base, '/account/cash-transactions')).status, 401);
    const topUp = await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'top_up', amountCents: 50025 } });
    assert.equal(topUp.status, 201);
    assert.equal(topUp.data.account.cashCents, 10050025);
    assert.equal(topUp.data.transaction.type, 'top_up');
    const withdrawal = await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'withdrawal', amountCents: 2500 } });
    assert.equal(withdrawal.status, 201);
    assert.equal(withdrawal.data.account.cashCents, 10047525);
    assert.equal((await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'withdrawal', amountCents: 0 } })).status, 400);
    assert.equal((await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'top_up', amountCents: 10000001 } })).status, 400);
    assert.equal((await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'cash_out', amountCents: 100 } })).status, 400);

    const buy = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 3 } });
    assert.equal(buy.status, 201);
    assert.equal(buy.data.order.status, 'filled');
    assert.equal(buy.data.account.positions.find(position => position.symbol === 'AAPL').quantity, 3);
    assert.equal(buy.data.account.cashCents, withdrawal.data.account.cashCents - buy.data.order.filledPriceCents * 3);
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'sell', type: 'market', quantity: 4 } })).status, 400);
    assert.equal((await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'market', quantity: -1 } })).status, 400);

    const limitBuy = await request(base, '/orders', { method: 'POST', cookie, body: { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 2, limitPrice: 1 } });
    assert.equal(limitBuy.data.order.status, 'pending');
    assert.equal(limitBuy.data.account.reservedCashCents, 200);
    assert.equal(limitBuy.data.account.availableCashCents, limitBuy.data.account.cashCents - 200);
    const overdrawReserved = await request(base, '/account/cash-transactions', { method: 'POST', cookie, body: { type: 'withdrawal', amountCents: limitBuy.data.account.cashCents } });
    assert.equal(overdrawReserved.status, 400, 'withdrawals cannot use cash reserved by pending buy orders');
    const history = await request(base, '/account/cash-transactions', { cookie });
    assert.equal(history.status, 200);
    assert.equal(history.data.transactions.length, 2);
    assert.equal(history.data.transactions[0].type, 'withdrawal');
    assert.equal(history.data.transactions[1].amountCents, 50025);
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

test('a real account and the shared demo account stay separate and switchable', { timeout: 30000 }, async () => {
  const { base, child, directory } = await startIsolatedServer();
  try {
    const registered = await request(base, '/auth/register', { method: 'POST', body: { name: 'Jordan Reyes', email: 'jordan@example.com', password: 'secure-password-123' } });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.isDemo, false);
    assert.equal(registered.data.switchTarget.isDemo, true, 'a real account can open the shared demo');
    const realCookie = registered.cookie;

    // The demo domain is reserved, so a real account can never shadow the shared demo.
    const reserved = await request(base, '/auth/register', { method: 'POST', body: { name: 'Not Demo', email: 'someone@northstar.demo', password: 'secure-password-123' } });
    assert.equal(reserved.status, 400);
    assert.equal((await request(base, '/auth/switch', { method: 'POST' })).status, 401);

    const bought = await request(base, '/orders', { method: 'POST', cookie: realCookie, body: { symbol: 'TSLA', side: 'buy', type: 'market', quantity: 2 } });
    assert.equal(bought.status, 201);

    const toDemo = await request(base, '/auth/switch', { method: 'POST', cookie: realCookie });
    assert.equal(toDemo.status, 200);
    assert.equal(toDemo.data.user.isDemo, true);
    assert.equal(toDemo.data.switchTarget.isDemo, false);
    assert.equal(toDemo.data.switchTarget.name, 'Jordan Reyes', 'the real account stays linked for switching back');
    const demoCookie = toDemo.cookie;
    assert.notEqual(demoCookie, realCookie);
    assert.equal((await request(base, '/account', { cookie: realCookie })).status, 401, 'the previous session is replaced');

    const demoAccount = await request(base, '/account', { cookie: demoCookie });
    assert.ok(demoAccount.data.positions.length > 0, 'the demo keeps its seeded portfolio');
    assert.ok(!demoAccount.data.positions.some(position => position.symbol === 'TSLA'), 'demo data is not the real account data');
    const demoTransfers = await request(base, '/transfers/config', { cookie: demoCookie });
    assert.equal(demoTransfers.data.enabled, false, 'the shared demo cannot use manual transfers');

    const backToReal = await request(base, '/auth/switch', { method: 'POST', cookie: demoCookie });
    assert.equal(backToReal.status, 200);
    assert.equal(backToReal.data.user.isDemo, false);
    assert.equal(backToReal.data.user.email, 'jordan@example.com');
    assert.equal(backToReal.data.switchTarget.isDemo, true);
    const realAccount = await request(base, '/account', { cookie: backToReal.cookie });
    assert.equal(realAccount.data.positions.find(position => position.symbol === 'TSLA').quantity, 2, 'the real account keeps its own holdings');

    const adminLogin = await request(base, '/auth/login', { method: 'POST', body: { email: 'admin@tests.example', password: 'a-long-test-password-123' } });
    const adminCookie = adminLogin.cookie;
    const demo = (await request(base, '/admin/users', { cookie: adminCookie })).data.users.find(user => user.isDemo);
    assert.ok(demo, 'the demo account is labelled for administrators');
    assert.equal((await request(base, `/admin/users/${demo.id}`, { method: 'PATCH', cookie: adminCookie, body: { action: 'suspend' } })).status, 403);
    assert.equal((await request(base, `/admin/users/${demo.id}`, { method: 'PATCH', cookie: adminCookie, body: { action: 'adjustCash', amountCents: 100 } })).status, 403);
    assert.equal((await request(base, '/admin/users', { cookie: adminCookie })).data.users.find(user => user.isDemo).status, 'active');
    const overview = await request(base, '/admin/overview', { cookie: adminCookie });
    assert.equal(overview.data.users.realAccounts, overview.data.users.total - 1, 'the demo is excluded from real-account counts');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
