import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { one, many, run, transaction, audit } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';

const enabled = process.env.MANUAL_TRANSFERS_ENABLED === 'true';
const keyHex = process.env.TRANSFER_DETAILS_KEY || '';
if (enabled && !/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error('Manual transfers require TRANSFER_DETAILS_KEY (64 hexadecimal characters).');
const key = /^[a-fA-F0-9]{64}$/.test(keyHex) ? Buffer.from(keyHex, 'hex') : null;
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function requireEnabled(req, _res, next) {
  if (!enabled) fail('Manual transfers are not enabled. Contact the operator.', 503);
  if (req.user.isDemo) fail('Use a private account, not the shared demo, for manual transfers.', 403);
  next();
}
function text(value, label, min = 2, max = 120) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`Enter a valid ${label} (${min}–${max} characters).`);
  return value.trim();
}
function id(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail('Invalid ID.'); return number; }

export function validateDetails(input) {
  if (!input || typeof input !== 'object') fail('Enter bank or wallet details.');
  if (input.kind === 'wallet') {
    if (!['Ethereum', 'Polygon'].includes(input.network)) fail('Choose Ethereum or Polygon for USDC.');
    const address = text(input.address, 'wallet address', 42, 42);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) fail('Enter a non-zero EVM wallet address (0x followed by 40 hexadecimal characters).');
    return { kind: 'wallet', network: input.network, asset: 'USDC', address };
  }
  if (input.kind === 'bank') {
    const accountHolder = text(input.accountHolder, 'account holder', 2, 100);
    const bankName = text(input.bankName, 'bank name', 2, 100);
    const accountNumber = text(input.accountNumber, 'US account number', 4, 17);
    const routingNumber = text(input.routingNumber, 'ABA routing number', 9, 9);
    if (!/^\d{4,17}$/.test(accountNumber)) fail('US account numbers must contain 4–17 digits.');
    if (!/^\d{9}$/.test(routingNumber) || /^0{9}$/.test(routingNumber) || [...routingNumber].reduce((sum, digit, index) => sum + Number(digit) * [3, 7, 1][index % 3], 0) % 10 !== 0) fail('Enter a valid nine-digit ABA routing number.');
    if (!['checking', 'savings'].includes(input.accountType)) fail('Choose checking or savings.');
    return { kind: 'bank', accountHolder, bankName, accountNumber, routingNumber, accountType: input.accountType, currency: 'USD', country: 'US' };
  }
  fail('Choose bank or wallet.');
}
function seal(value) {
  if (!key) fail('Transfer encryption is not configured.', 503);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
}
function open(value) {
  if (!key) fail('Transfer encryption is not configured.', 503);
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
function methodView(row) { return { id: row.id, details: open(row.details), active: Boolean(row.active), createdAt: row.created_at }; }
function requestView(row) {
  return { id: row.id, userId: row.user_id, userName: row.user_name, userEmail: row.user_email, type: row.type,
    amountCents: row.amount_cents, methodId: row.method_id, details: open(row.details), reference: open(row.reference), status: row.status,
    reviewNote: row.review_note ? open(row.review_note) : null, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, createdAt: row.created_at };
}
function getRequest(requestId, lock = false) { return one(`SELECT * FROM transfer_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [requestId]); }

export function registerTransferRoutes(api) {
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.user.id), message: { error: 'Too many transfer requests. Please try again later.' } });
  api.use(['/transfers', '/admin/transfers'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.get('/transfers/config', requireAuth, (req, res) => res.json({ enabled: enabled && !req.user.isDemo }));
  api.get('/transfers/methods', requireAuth, requireEnabled, async (_req, res) => {
    res.json({ methods: (await many('SELECT * FROM transfer_methods WHERE active = 1 ORDER BY id DESC')).map(methodView) });
  });
  api.get('/admin/transfers/methods', requireAdmin, requireEnabled, async (_req, res) => {
    res.json({ methods: (await many('SELECT * FROM transfer_methods ORDER BY id DESC')).map(methodView) });
  });
  api.post('/admin/transfers/methods', requireAdmin, requireEnabled, async (req, res) => {
    const details = validateDetails(req.body?.details);
    const method = await transaction(async tx => {
      const result = await tx('INSERT INTO transfer_methods(details, created_at) VALUES($1, $2) RETURNING id', [seal(details), Date.now()]);
      const methodId = result.rows[0].id;
      await audit(req.user.id, null, 'transfer_method_added', `Added ${details.kind} receiving method #${methodId}`);
      return one('SELECT * FROM transfer_methods WHERE id = $1', [methodId]);
    });
    res.status(201).json({ method: methodView(method) });
  });
  api.patch('/admin/transfers/methods/:id', requireAdmin, requireEnabled, async (req, res) => {
    const methodId = id(req.params.id);
    if (typeof req.body?.active !== 'boolean') fail('Choose whether this method is active.');
    await transaction(async () => {
      const result = await run('UPDATE transfer_methods SET active = $1 WHERE id = $2', [Number(req.body.active), methodId]);
      if (!result.rowCount) fail('Method not found.', 404);
      await audit(req.user.id, null, 'transfer_method_updated', `Receiving method #${methodId}: ${req.body.active ? 'enabled' : 'disabled'}`);
    });
    res.json({ ok: true });
  });
  api.get('/transfers/requests', requireAuth, requireEnabled, async (req, res) => {
    res.json({ requests: (await many('SELECT * FROM transfer_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [req.user.id])).map(requestView) });
  });
  api.post('/transfers/requests', requireAuth, requireEnabled, limiter, async (req, res) => {
    const body = req.body || {};
    if (!['deposit', 'withdrawal'].includes(body.type)) fail('Choose deposit or withdrawal.');
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents < 100 || body.amountCents > 10000000) fail('Enter an amount from $1 to $100,000, in whole cents.');
    if (body.acknowledged !== true) fail('Acknowledge the external transfer terms.');
    if (typeof body.requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.requestKey)) fail('A request key is required.');
    const reference = body.type === 'deposit' ? text(body.reference, 'bank reference or transaction hash', 3, 160) : '';
    const result = await transaction(async tx => {
      // Serialize submissions per account so idempotency and the open-request cap remain race-safe.
      await one('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      const existing = await one('SELECT * FROM transfer_requests WHERE user_id = $1 AND request_key = $2', [req.user.id, body.requestKey]);
      if (existing) {
        const same = existing.type === body.type && existing.amount_cents === body.amountCents && open(existing.reference) === reference &&
          (body.type === 'deposit' ? existing.method_id === body.methodId : JSON.stringify(open(existing.details)) === JSON.stringify(validateDetails(body.details)));
        if (!same) fail('This request key was already used for different details.', 409);
        return { row: existing, created: false };
      }
      const openCount = await one("SELECT COUNT(*) AS count FROM transfer_requests WHERE user_id = $1 AND status IN ('pending', 'processing')", [req.user.id]);
      if (Number(openCount.count) >= 20) fail('You already have 20 open requests. Wait for review before submitting another.', 409);
      let details, methodId = null;
      if (body.type === 'deposit') {
        methodId = id(body.methodId);
        const method = await one('SELECT * FROM transfer_methods WHERE id = $1 AND active = 1', [methodId]);
        if (!method) fail('This receiving method is unavailable. Refresh and choose an active method.');
        details = open(method.details);
      } else details = validateDetails(body.details);
      const inserted = await tx(`INSERT INTO transfer_requests(user_id, type, amount_cents, method_id, details, reference, created_at, request_key)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.id, body.type, body.amountCents, methodId, seal(details), seal(reference), Date.now(), body.requestKey]);
      const requestId = inserted.rows[0].id;
      await audit(req.user.id, req.user.id, 'transfer_requested', `${body.type} request #${requestId}; external review required`);
      return { row: await getRequest(requestId), created: true };
    });
    res.status(result.created ? 201 : 200).json({ request: requestView(result.row) });
  });
  api.post('/transfers/requests/:id/cancel', requireAuth, requireEnabled, async (req, res) => {
    const requestId = id(req.params.id);
    await transaction(async () => {
      const row = await getRequest(requestId, true);
      if (!row || row.user_id !== req.user.id) fail('Request not found.', 404);
      if (row.status !== 'pending') fail('Only pending requests can be cancelled.', 409);
      await run("UPDATE transfer_requests SET status = 'cancelled', reviewed_at = $1 WHERE id = $2", [Date.now(), requestId]);
      await audit(req.user.id, req.user.id, 'transfer_cancelled', `Cancelled request #${requestId}; no money moved`);
    });
    res.json({ request: requestView(await getRequest(requestId)) });
  });
  api.get('/admin/transfers/requests', requireAdmin, requireEnabled, async (req, res) => {
    const status = req.query.status || 'pending';
    if (!['pending', 'processing', 'completed', 'rejected', 'cancelled'].includes(status)) fail('Invalid request status.');
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : id(req.query.before);
    const rows = await many(`SELECT r.*, u.name AS user_name, u.email AS user_email FROM transfer_requests r JOIN users u ON u.id = r.user_id
      WHERE r.status = $1 AND r.id < $2 ORDER BY r.id DESC LIMIT 100`, [status, before]);
    res.json({ requests: rows.map(requestView), nextBefore: rows.length === 100 ? rows.at(-1).id : null });
  });
  api.patch('/admin/transfers/requests/:id', requireAdmin, requireEnabled, async (req, res) => {
    const requestId = id(req.params.id), status = req.body?.status;
    if (!['processing', 'completed', 'rejected'].includes(status)) fail('Choose processing, completed or rejected.');
    const note = status === 'processing' ? null : text(req.body?.note, status === 'completed' ? 'external settlement reference' : 'rejection reason', 3, 300);
    if (status === 'completed' && req.body?.externallyVerified !== true) fail('Confirm external settlement and balance verification before recording completion.');
    await transaction(async () => {
      const row = await getRequest(requestId, true);
      if (!row) fail('Request not found.', 404);
      if (!['pending', 'processing'].includes(row.status)) fail('This request has already been reviewed or cancelled.', 409);
      if (row.status === 'processing' && row.reviewed_by !== req.user.id) fail('Another administrator is processing this request. Do not initiate another payment.', 409);
      if (row.user_id === req.user.id) fail('Another administrator must review your own requests.', 403);
      const owner = await one('SELECT status FROM users WHERE id = $1', [row.user_id]);
      if (status !== 'rejected' && owner.status !== 'active') fail('Cannot complete a request for a suspended account.', 409);
      if (status === 'completed' && row.status !== 'processing') fail('Claim this request for processing before recording settlement.', 409);
      if (status === 'processing' && row.status === 'processing') return;
      await run('UPDATE transfer_requests SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $5',
        [status, note === null ? null : seal(note), req.user.id, Date.now(), requestId]);
      await audit(req.user.id, row.user_id, 'transfer_reviewed', `Request #${requestId} recorded as ${status}; no in-app balance change`);
    });
    res.json({ request: requestView(await getRequest(requestId)) });
  });
}
