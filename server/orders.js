import { one, many, run, getSetting, transaction } from './db.js';
import { getAsset, getQuote } from './market.js';

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

export async function reservedCash(userId, excludeOrderId = 0) {
  return (await one(`SELECT COALESCE(SUM(quantity * limit_price_cents), 0) AS amount
    FROM orders WHERE user_id = $1 AND side = 'buy' AND status = 'pending' AND id <> $2`, [userId, excludeOrderId])).amount;
}
export async function reservedShares(userId, symbol, excludeOrderId = 0) {
  return (await one(`SELECT COALESCE(SUM(quantity), 0) AS amount FROM orders
    WHERE user_id = $1 AND symbol = $2 AND side = 'sell' AND status = 'pending' AND id <> $3`, [userId, symbol, excludeOrderId])).amount;
}

export async function getAccountSummary(userId) {
  const user = await one('SELECT cash_cents AS "cashCents" FROM users WHERE id = $1', [userId]);
  if (!user) fail('Account not found.', 404);
  const positions = (await many(`SELECT positions.symbol, assets.name, assets.sector, assets.color,
    positions.quantity, positions.average_cost_cents AS "averageCostCents"
    FROM positions JOIN assets ON positions.symbol = assets.symbol WHERE positions.user_id = $1 ORDER BY positions.symbol`, [userId]))
    .map(position => {
      const quote = getQuote(position.symbol);
      const marketValueCents = Math.round(quote.price * 100) * position.quantity;
      const costBasisCents = position.averageCostCents * position.quantity;
      const dayChangeCents = Math.round(quote.change * 100) * position.quantity;
      return { ...position, price: quote.price, changePercent: quote.changePercent, marketValueCents, costBasisCents,
        totalReturnCents: marketValueCents - costBasisCents, dayChangeCents };
    });
  const portfolioValueCents = positions.reduce((sum, position) => sum + position.marketValueCents, 0);
  const dayChangeCents = positions.reduce((sum, position) => sum + position.dayChangeCents, 0);
  const totalReturnCents = positions.reduce((sum, position) => sum + position.totalReturnCents, 0);
  const equityCents = user.cashCents + portfolioValueCents;
  const reservedCashCents = await reservedCash(userId);
  return { cashCents: user.cashCents, availableCashCents: Math.max(0, user.cashCents - reservedCashCents), reservedCashCents,
    portfolioValueCents, equityCents, dayChangeCents,
    dayChangePercent: equityCents - dayChangeCents > 0 ? Math.round(dayChangeCents / (equityCents - dayChangeCents) * 10000) / 100 : 0,
    totalReturnCents, positions };
}

const ORDER_COLUMNS = `orders.id, orders.symbol, assets.name, assets.color, orders.side, orders.type,
  orders.quantity, orders.limit_price_cents AS "limitPriceCents", orders.filled_price_cents AS "filledPriceCents",
  orders.status, orders.created_at AS "createdAt", orders.filled_at AS "filledAt"`;
export async function getOrders(userId) {
  return many(`SELECT ${ORDER_COLUMNS} FROM orders JOIN assets ON assets.symbol = orders.symbol
    WHERE orders.user_id = $1 ORDER BY orders.created_at DESC, orders.id DESC LIMIT 200`, [userId]);
}
async function getOrder(id) {
  return one(`SELECT ${ORDER_COLUMNS} FROM orders JOIN assets ON assets.symbol = orders.symbol WHERE orders.id = $1`, [id]);
}

async function executeFill(userId, symbol, side, quantity, priceCents, excludeOrderId = 0) {
  const user = await one('SELECT cash_cents AS "cashCents", status FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!user || user.status !== 'active') fail('This account cannot place orders.', 403);
  if (side === 'buy') {
    const cost = quantity * priceCents;
    if (cost > user.cashCents - await reservedCash(userId, excludeOrderId)) fail('Insufficient available buying power.');
    const position = await one('SELECT quantity, average_cost_cents AS "averageCostCents" FROM positions WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
    if (position) {
      const newQuantity = position.quantity + quantity;
      const newAverage = Math.round((position.quantity * position.averageCostCents + cost) / newQuantity);
      await run('UPDATE positions SET quantity = $1, average_cost_cents = $2 WHERE user_id = $3 AND symbol = $4', [newQuantity, newAverage, userId, symbol]);
    } else await run('INSERT INTO positions(user_id, symbol, quantity, average_cost_cents) VALUES($1, $2, $3, $4)', [userId, symbol, quantity, priceCents]);
    await run('UPDATE users SET cash_cents = cash_cents - $1 WHERE id = $2', [cost, userId]);
  } else {
    const position = await one('SELECT quantity FROM positions WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
    if (!position || quantity > position.quantity - await reservedShares(userId, symbol, excludeOrderId)) fail('Not enough available shares to sell.');
    if (position.quantity === quantity) await run('DELETE FROM positions WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
    else await run('UPDATE positions SET quantity = quantity - $1 WHERE user_id = $2 AND symbol = $3', [quantity, userId, symbol]);
    await run('UPDATE users SET cash_cents = cash_cents + $1 WHERE id = $2', [quantity * priceCents, userId]);
  }
}

export async function placeOrder(userId, input) {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = input.side, type = input.type;
  const quantity = Number(input.quantity), limitPrice = Number(input.limitPrice);
  if (!/^[A-Z0-9.]{1,8}$/.test(symbol) || !getAsset(symbol)?.active) fail('Choose an available asset.');
  if (!['buy', 'sell'].includes(side) || !['market', 'limit'].includes(type)) fail('Choose a valid order side and type.');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) fail('Enter between 1 and 10,000 whole shares.');
  if (type === 'limit' && (!Number.isFinite(limitPrice) || limitPrice < 0.01 || limitPrice > 100000)) fail('Enter a valid limit price.');
  const limitPriceCents = type === 'limit' ? Math.round(limitPrice * 100) : null;
  const priceCents = Math.round(getQuote(symbol).price * 100);
  if (!priceCents) fail('A price is not available for this asset.');

  return transaction(async tx => {
    if (await getSetting('trading_enabled') !== '1') fail('Trading is temporarily paused by an administrator.', 403);
    if (!getAsset(symbol)?.active) fail('This asset is not available for trading.');
    const user = await one('SELECT cash_cents AS "cashCents", status FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user || user.status !== 'active') fail('This account cannot place orders.', 403);
    const crosses = type === 'market' || (side === 'buy' ? priceCents <= limitPriceCents : priceCents >= limitPriceCents);
    if (crosses) await executeFill(userId, symbol, side, quantity, priceCents);
    else if (side === 'buy') {
      if (quantity * limitPriceCents > user.cashCents - await reservedCash(userId)) fail('Insufficient buying power to reserve this limit order.');
    } else {
      const position = await one('SELECT quantity FROM positions WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
      if (!position || quantity > position.quantity - await reservedShares(userId, symbol)) fail('Not enough available shares to reserve this limit order.');
    }
    const now = Date.now();
    const inserted = await tx(`INSERT INTO orders(user_id, symbol, side, type, quantity, limit_price_cents, filled_price_cents, status, created_at, filled_at)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [userId, symbol, side, type, quantity, limitPriceCents, crosses ? priceCents : null, crosses ? 'filled' : 'pending', now, crosses ? now : null]);
    return getOrder(inserted.rows[0].id);
  });
}

export async function cancelOrder(userId, id) {
  return transaction(async () => {
    const order = await one('SELECT id, status FROM orders WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!order) fail('Order not found.', 404);
    if (order.status !== 'pending') fail('Only pending orders can be cancelled.');
    await run("UPDATE orders SET status = 'cancelled' WHERE id = $1", [id]);
    return getOrder(id);
  });
}

export async function matchPendingOrders() {
  if (await getSetting('trading_enabled') !== '1') return;
  const pending = await many(`SELECT orders.* FROM orders JOIN users ON users.id = orders.user_id JOIN assets ON assets.symbol = orders.symbol
    WHERE orders.status = 'pending' AND users.status = 'active' AND assets.active = 1 ORDER BY orders.created_at`);
  for (const order of pending) {
    const priceCents = Math.round(getQuote(order.symbol).price * 100);
    if (order.side === 'buy' ? priceCents > order.limit_price_cents : priceCents < order.limit_price_cents) continue;
    try {
      await transaction(async () => {
        const current = await one('SELECT status FROM orders WHERE id = $1', [order.id]);
        if (current?.status !== 'pending' || await getSetting('trading_enabled') !== '1') return;
        await executeFill(order.user_id, order.symbol, order.side, order.quantity, priceCents, order.id);
        await run("UPDATE orders SET status = 'filled', filled_price_cents = $1, filled_at = $2 WHERE id = $3", [priceCents, Date.now(), order.id]);
      });
    } catch (error) {
      console.warn(`Cancelling unfillable limit order ${order.id}:`, error.message);
      await run("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'", [order.id]);
    }
  }
}

const MAX_CASH_TRANSACTION_CENTS = 10_000_000;
export async function getCashTransactions(userId) {
  return many(`SELECT id, type, amount_cents AS "amountCents", balance_after_cents AS "balanceAfterCents", created_at AS "createdAt"
    FROM cash_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [userId]);
}
export async function createCashTransaction(userId, input) {
  const type = input?.type, amountCents = input?.amountCents;
  if (!['top_up', 'withdrawal'].includes(type)) fail('Choose top up or withdrawal.');
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > MAX_CASH_TRANSACTION_CENTS) fail('Enter an amount from $1.00 to $100,000.00.');
  return transaction(async tx => {
    const user = await one('SELECT cash_cents AS "cashCents", status FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user || user.status !== 'active') fail('This account cannot move cash.', 403);
    if (type === 'withdrawal') {
      if (amountCents > user.cashCents - await reservedCash(userId)) fail('Withdrawal exceeds available cash after pending order reserves.');
      await run('UPDATE users SET cash_cents = cash_cents - $1 WHERE id = $2', [amountCents, userId]);
    } else {
      if (user.cashCents + amountCents > Number.MAX_SAFE_INTEGER) fail('This account has reached its virtual cash limit.');
      await run('UPDATE users SET cash_cents = cash_cents + $1 WHERE id = $2', [amountCents, userId]);
    }
    const balanceAfterCents = type === 'top_up' ? user.cashCents + amountCents : user.cashCents - amountCents;
    const createdAt = Date.now();
    const inserted = await tx('INSERT INTO cash_transactions(user_id, type, amount_cents, balance_after_cents, created_at) VALUES($1, $2, $3, $4, $5) RETURNING id',
      [userId, type, amountCents, balanceAfterCents, createdAt]);
    return { id: Number(inserted.rows[0].id), type, amountCents, balanceAfterCents, createdAt };
  });
}
