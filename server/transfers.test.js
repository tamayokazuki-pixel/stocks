import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { startIsolatedServer, request } from './test-support.js';

const bank = { kind: 'bank', bankName: 'Test bank', accountHolder: 'Test operator', accountNumber: '123456789012', routingNumber: '021000021', accountType: 'checking' };
const wallet = { kind: 'wallet', network: 'Polygon', address: `0x${'a1'.repeat(20)}` };
const payload = (extra = {}) => ({ type: 'withdrawal', amountCents: 12345, details: bank, acknowledged: true, requestKey: crypto.randomUUID(), ...extra });
async function stop({ child, directory }) {
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  fs.rmSync(directory, { recursive: true, force: true });
}
async function register(base, name) {
  const result = await request(base, '/auth/register', { method: 'POST', body: { name, email: `${name}@example.test`, password: 'secure-password-123' } });
  assert.equal(result.status, 201);
  return result;
}

test('enabling manual transfers requires a valid encryption key', () => {
  for (const key of ['', 'not-a-valid-encryption-key']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server/transfers.js')"], {
      env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'false', DATABASE_PATH: ':memory:',
        ADMIN_EMAIL: '', ADMIN_PASSWORD: '', MANUAL_TRANSFERS_ENABLED: 'true', TRANSFER_DETAILS_KEY: key },
      encoding: 'utf8', timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Manual transfers require TRANSFER_DETAILS_KEY/);
  }
});

test('manual transfers are opt-in and reject requests while disabled', async () => {
  const server = await startIsolatedServer();
  try {
    const { cookie } = await register(server.base, 'Disabled');
    assert.equal((await request(server.base, '/transfers/config', { cookie })).data.enabled, false);
    assert.equal((await request(server.base, '/transfers/methods', { cookie })).status, 503);
    assert.equal((await request(server.base, '/transfers/requests', { method: 'POST', cookie, body: payload() })).status, 503);
  } finally { await stop(server); }
});

test('manual transfers protect details, isolate paper money and require external review', { timeout: 30000 }, async () => {
  const server = await startIsolatedServer({ MANUAL_TRANSFERS_ENABLED: 'true', TRANSFER_DETAILS_KEY: crypto.randomBytes(32).toString('hex') });
  const { base, directory } = server;
  try {
    const owner = await register(base, 'Owner');
    const other = await register(base, 'Other');
    const cookie = owner.cookie;
    const admin = await request(base, '/auth/login', { method: 'POST', body: { email: 'admin@tests.example', password: 'a-long-test-password-123' } });
    const adminCookie = admin.cookie;
    // Provision a second administrator to exercise exclusive review ownership.
    const setup = new DatabaseSync(path.join(directory, 'test.sqlite'));
    setup.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(other.data.user.id);
    setup.close();
    const demo = await request(base, '/auth/demo', { method: 'POST' });
    assert.equal((await request(base, '/transfers/config', { cookie: demo.cookie })).data.enabled, false);
    assert.equal((await request(base, '/transfers/requests', { cookie: demo.cookie })).status, 403);
    const submit = body => request(base, '/transfers/requests', { method: 'POST', cookie, body });
    const review = (id, body) => request(base, `/admin/transfers/requests/${id}`, { method: 'PATCH', cookie: adminCookie, body });
    const add = details => request(base, '/admin/transfers/methods', { method: 'POST', cookie: adminCookie, body: { details } });
    assert.equal((await request(base, '/transfers/config')).status, 401);
    assert.equal((await request(base, '/transfers/requests')).status, 401);
    assert.equal((await request(base, '/admin/transfers/requests', { cookie })).status, 403);
    assert.equal((await request(base, '/admin/transfers/methods', { method: 'POST', cookie, body: { details: bank } })).status, 403);
    assert.equal((await request(base, '/transfers/requests', { method: 'POST', cookie, verified: false, body: payload() })).status, 403);
    assert.equal((await add({ ...bank, routingNumber: '123456789' })).status, 400);
    assert.equal((await add({ ...bank, accountNumber: 'not-a-number' })).status, 400);
    assert.equal((await add({ ...wallet, network: 'Bitcoin' })).status, 400);
    assert.equal((await add({ ...wallet, address: `0x${'0'.repeat(40)}` })).status, 400);
    assert.equal((await add({ ...wallet, address: 'seed phrase not accepted' })).status, 400);
    const bankMethod = await add(bank);
    const walletMethod = await add(wallet);
    assert.equal(bankMethod.status, 201);
    assert.equal(walletMethod.status, 201);
    const methodId = bankMethod.data.method.id;
    const methods = await request(base, '/transfers/methods', { cookie });
    assert.equal(methods.data.methods.length, 2);
    assert.equal(methods.data.methods[1].details.accountNumber, bank.accountNumber);
    const response = await fetch(`${base}/api/transfers/methods`, { headers: { Cookie: cookie } });
    assert.equal(response.headers.get('cache-control'), 'no-store');

    for (const amountCents of [0, -1, 99, 10000001, 100.5, '100', null]) assert.equal((await submit(payload({ amountCents }))).status, 400);
    assert.equal((await submit(payload({ type: 'top_up' }))).status, 400);
    assert.equal((await submit(payload({ acknowledged: false }))).status, 400);
    assert.equal((await submit(payload({ requestKey: '' }))).status, 400);
    assert.equal((await submit(payload({ details: { kind: 'bank' } }))).status, 400);
    assert.equal((await submit(payload({ type: 'deposit', methodId, reference: '' }))).status, 400);
    assert.equal((await submit(payload({ type: 'deposit', methodId: 9999, reference: 'external-reference' }))).status, 400);

    const depositBody = payload({ type: 'deposit', methodId, reference: 'bank-transfer-reference-001', details: wallet });
    const concurrent = await Promise.all([submit(depositBody), submit(depositBody)]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 201]);
    const deposit = concurrent[0].data.request;
    assert.equal(concurrent[1].data.request.id, deposit.id);
    assert.equal(deposit.details.kind, 'bank', 'receiving details must come from the server, not from user-supplied details');
    assert.equal(deposit.status, 'pending');
    assert.equal((await submit({ ...depositBody, amountCents: 222 })).status, 409);
    const withdrawal = await submit(payload({ details: wallet }));
    assert.equal(withdrawal.status, 201);
    const withdrawalId = withdrawal.data.request.id;
    assert.equal(withdrawal.data.request.details.asset, 'USDC');
    assert.equal((await request(base, '/transfers/requests', { cookie: other.cookie })).data.requests.length, 0);
    assert.equal((await request(base, `/transfers/requests/${withdrawalId}/cancel`, { method: 'POST', cookie: other.cookie })).status, 404);
    assert.equal((await request(base, `/admin/transfers/requests/${withdrawalId}`, { method: 'PATCH', cookie, body: { status: 'completed' } })).status, 403);

    await request(base, `/admin/transfers/methods/${methodId}`, { method: 'PATCH', cookie: adminCookie, body: { active: false } });
    assert.equal((await request(base, '/transfers/methods', { cookie })).data.methods.length, 1);
    assert.equal((await request(base, '/admin/transfers/methods', { cookie: adminCookie })).data.methods.length, 2);
    assert.equal((await submit({ ...depositBody, requestKey: crypto.randomUUID() })).status, 400);
    assert.equal((await submit(depositBody)).status, 200, 'retrying an existing request still works after a method is disabled');
    assert.equal((await request(base, '/transfers/requests', { cookie })).data.requests.find(row => row.id === deposit.id).details.accountNumber, bank.accountNumber);

    assert.equal((await review(deposit.id, { status: 'completed', note: 'settlement-confirmation' })).status, 400);
    assert.equal((await review(deposit.id, { status: 'completed', note: '', externallyVerified: true })).status, 400);
    assert.equal((await review(deposit.id, { status: 'pending', note: 'test' })).status, 400);
    assert.equal((await review(deposit.id, { status: 'completed', note: 'settlement-confirmation-001', externallyVerified: true })).status, 409, 'claim before external processing');
    assert.equal((await review(deposit.id, { status: 'processing' })).status, 200);
    assert.equal((await review(deposit.id, { status: 'processing' })).status, 200, 'claim retries are idempotent');
    assert.equal((await request(base, `/transfers/requests/${deposit.id}/cancel`, { method: 'POST', cookie })).status, 409, 'claimed requests cannot be cancelled');
    assert.equal((await request(base, `/admin/transfers/requests/${deposit.id}`, { method: 'PATCH', cookie: other.cookie, body: { status: 'processing' } })).status, 409);
    assert.equal((await request(base, `/admin/transfers/requests/${deposit.id}`, { method: 'PATCH', cookie: other.cookie, body: { status: 'completed', note: 'duplicate-settlement', externallyVerified: true } })).status, 409);
    const completed = await review(deposit.id, { status: 'completed', note: 'settlement-confirmation-001', externallyVerified: true });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.request.status, 'completed');
    assert.equal((await review(deposit.id, { status: 'rejected', note: 'duplicate review' })).status, 409);
    assert.equal((await request(base, `/transfers/requests/${deposit.id}/cancel`, { method: 'POST', cookie })).status, 409);
    assert.equal((await review(withdrawalId, { status: 'rejected', note: 'External balance could not be verified' })).status, 200);
    assert.equal((await request(base, '/admin/transfers/requests?status=completed', { cookie: adminCookie })).data.requests[0].id, deposit.id);
    assert.equal((await request(base, '/admin/transfers/requests?status=invalid', { cookie: adminCookie })).status, 400);
    assert.equal((await request(base, '/admin/transfers/requests?status=completed&before=1', { cookie: adminCookie })).data.requests.length, 0);

    const walletDeposit = await submit(payload({ type: 'deposit', methodId: walletMethod.data.method.id, reference: 'wallet-transaction-hash-001' }));
    assert.equal(walletDeposit.status, 201);
    assert.equal(walletDeposit.data.request.details.network, 'Polygon');
    const paidWithdrawal = await submit(payload({ details: bank }));
    assert.equal((await review(paidWithdrawal.data.request.id, { status: 'processing' })).status, 200);
    assert.equal((await review(paidWithdrawal.data.request.id, { status: 'completed', note: 'bank-payout-reference-001', externallyVerified: true })).status, 200);
    assert.equal((await review(walletDeposit.data.request.id, { status: 'rejected', note: 'Test transfer only' })).status, 200);

    const cancelId = (await submit(payload())).data.request.id;
    assert.equal((await request(base, `/transfers/requests/${cancelId}/cancel`, { method: 'POST', cookie })).status, 200);
    assert.equal((await review(cancelId, { status: 'completed', note: 'settlement-reference', externallyVerified: true })).status, 409);
    assert.equal((await request(base, `/transfers/requests/${cancelId}/cancel`, { method: 'POST', cookie })).status, 409);
    const adminRequest = await request(base, '/transfers/requests', { method: 'POST', cookie: adminCookie, body: payload() });
    assert.equal((await review(adminRequest.data.request.id, { status: 'completed', note: 'self-review', externallyVerified: true })).status, 403);

    const pending = await submit(payload());
    for (let count = 1; count < 20; count++) assert.equal((await submit(payload())).status, 201);
    assert.equal((await submit(payload())).status, 409, 'cap pending requests');
    await request(base, `/admin/users/${owner.data.user.id}`, { method: 'PATCH', cookie: adminCookie, body: { action: 'suspend' } });
    assert.equal((await submit(payload())).status, 401);
    assert.equal((await review(pending.data.request.id, { status: 'completed', note: 'settlement-reference', externallyVerified: true })).status, 409);
    assert.equal((await review(pending.data.request.id, { status: 'rejected', note: 'Account is suspended' })).status, 200);

    const raw = new DatabaseSync(path.join(directory, 'test.sqlite'));
    try {
      assert.equal(raw.prepare('SELECT cash_cents FROM users WHERE id = ?').get(owner.data.user.id).cash_cents, 10000000, 'external records never credit/debit virtual funds');
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM cash_transactions').get().count, 0);
      const stored = JSON.stringify({ methods: raw.prepare('SELECT * FROM transfer_methods').all(), requests: raw.prepare('SELECT * FROM transfer_requests').all(), audit: raw.prepare('SELECT * FROM audit_log').all() });
      for (const secret of [bank.accountNumber, bank.accountHolder, wallet.address, depositBody.reference, 'settlement-confirmation-001']) assert.ok(!stored.includes(secret), `must not store plaintext: ${secret}`);
    } finally { raw.close(); }
  } finally { await stop(server); }
});
