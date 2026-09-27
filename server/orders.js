import { db, getSetting, transaction } from './db.js';
import { getAsset, getQuote } from './market.js';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function reservedCash(userId, excludeOrderId = 0) {
  return db.prepare(`SELECT COALESCE(SUM(quantity * limit_price_cents), 0) AS amount
    FROM orders WHERE user_id = ? AND side = 'buy' AND status = 'pending' AND id != ?`)
    .get(userId, excludeOrderId).amount;
}

export function reservedShares(userId, symbol, excludeOrderId = 0) {
  return db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS amount
    FROM orders WHERE user_id = ? AND symbol = ? AND side = 'sell' AND status = 'pending' AND id != ?`)
    .get(userId, symbol, excludeOrderId).amount;
}

export function getAccountSummary(userId) {
  const user = db.prepare('SELECT cash_cents AS cashCents FROM users WHERE id = ?').get(userId);
  if (!user) fail('Account not found.', 404);
  const positions = db.prepare(`SELECT positions.symbol, assets.name, assets.sector, assets.color,
    positions.quantity, positions.average_cost_cents AS averageCostCents
    FROM positions JOIN assets ON positions.symbol = assets.symbol WHERE positions.user_id = ? ORDER BY positions.symbol`).all(userId)
    .map(position => {
      const quote = getQuote(position.symbol);
      const marketValueCents = Math.round(quote.price * 100) * position.quantity;
      const costBasisCents = position.averageCostCents * position.quantity;
      const dayChangeCents = Math.round(quote.change * 100) * position.quantity;
      return {
        ...position, price: quote.price, changePercent: quote.changePercent,
        marketValueCents, costBasisCents, totalReturnCents: marketValueCents - costBasisCents,
        dayChangeCents,
      };
    });
  const portfolioValueCents = positions.reduce((sum, position) => sum + position.marketValueCents, 0);
  const dayChangeCents = positions.reduce((sum, position) => sum + position.dayChangeCents, 0);
  const totalReturnCents = positions.reduce((sum, position) => sum + position.totalReturnCents, 0);
  const equityCents = user.cashCents + portfolioValueCents;
  return {
    cashCents: user.cashCents, availableCashCents: Math.max(0, user.cashCents - reservedCash(userId)),
    reservedCashCents: reservedCash(userId), portfolioValueCents, equityCents,
    dayChangeCents, dayChangePercent: equityCents - dayChangeCents > 0 ? Math.round(dayChangeCents / (equityCents - dayChangeCents) * 10000) / 100 : 0,
    totalReturnCents, positions,
  };
}

export function getOrders(userId) {
  return db.prepare(`SELECT orders.id, orders.symbol, assets.name, assets.color, orders.side, orders.type,
    orders.quantity, orders.limit_price_cents AS limitPriceCents, orders.filled_price_cents AS filledPriceCents,
    orders.status, orders.created_at AS createdAt, orders.filled_at AS filledAt
    FROM orders JOIN assets ON assets.symbol = orders.symbol WHERE orders.user_id = ?
    ORDER BY orders.created_at DESC, orders.id DESC LIMIT 200`).all(userId);
}

function getOrder(id) {
  return db.prepare(`SELECT orders.id, orders.symbol, assets.name, assets.color, orders.side, orders.type,
    orders.quantity, orders.limit_price_cents AS limitPriceCents, orders.filled_price_cents AS filledPriceCents,
    orders.status, orders.created_at AS createdAt, orders.filled_at AS filledAt
    FROM orders JOIN assets ON assets.symbol = orders.symbol WHERE orders.id = ?`).get(id);
}

function executeFill(userId, symbol, side, quantity, priceCents, excludeOrderId = 0) {
  const user = db.prepare('SELECT cash_cents AS cashCents, status FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active') fail('This account cannot place orders.', 403);
  if (side === 'buy') {
    const cost = quantity * priceCents;
    if (cost > user.cashCents - reservedCash(userId, excludeOrderId)) fail('Insufficient available buying power.');
    const position = db.prepare('SELECT quantity, average_cost_cents AS averageCostCents FROM positions WHERE user_id = ? AND symbol = ?').get(userId, symbol);
    if (position) {
      const newQuantity = position.quantity + quantity;
      const newAverage = Math.round((position.quantity * position.averageCostCents + cost) / newQuantity);
      db.prepare('UPDATE positions SET quantity = ?, average_cost_cents = ? WHERE user_id = ? AND symbol = ?')
        .run(newQuantity, newAverage, userId, symbol);
    } else {
      db.prepare('INSERT INTO positions(user_id, symbol, quantity, average_cost_cents) VALUES(?, ?, ?, ?)')
        .run(userId, symbol, quantity, priceCents);
    }
    db.prepare('UPDATE users SET cash_cents = cash_cents - ? WHERE id = ?').run(cost, userId);
  } else {
    const position = db.prepare('SELECT quantity FROM positions WHERE user_id = ? AND symbol = ?').get(userId, symbol);
    if (!position || quantity > position.quantity - reservedShares(userId, symbol, excludeOrderId)) fail('Not enough available shares to sell.');
    if (position.quantity === quantity) {
      db.prepare('DELETE FROM positions WHERE user_id = ? AND symbol = ?').run(userId, symbol);
    } else {
      db.prepare('UPDATE positions SET quantity = quantity - ? WHERE user_id = ? AND symbol = ?').run(quantity, userId, symbol);
    }
    db.prepare('UPDATE users SET cash_cents = cash_cents + ? WHERE id = ?').run(quantity * priceCents, userId);
  }
}

export function placeOrder(userId, input) {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = input.side;
  const type = input.type;
  const quantity = Number(input.quantity);
  const limitPrice = Number(input.limitPrice);
  if (!/^[A-Z0-9.]{1,8}$/.test(symbol) || !getAsset(symbol)?.active) fail('Choose an available asset.');
  if (!['buy', 'sell'].includes(side) || !['market', 'limit'].includes(type)) fail('Choose a valid order side and type.');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) fail('Enter between 1 and 10,000 whole shares.');
  if (type === 'limit' && (!Number.isFinite(limitPrice) || limitPrice < 0.01 || limitPrice > 100000)) fail('Enter a valid limit price.');
  const limitPriceCents = type === 'limit' ? Math.round(limitPrice * 100) : null;
  const quote = getQuote(symbol);
  const priceCents = Math.round(quote.price * 100);
  if (!priceCents) fail('A price is not available for this asset.');

  return transaction(() => {
    if (getSetting('trading_enabled') !== '1') fail('Trading is temporarily paused by an administrator.', 403);
    const asset = getAsset(symbol);
    if (!asset?.active) fail('This asset is not available for trading.');
    const user = db.prepare('SELECT cash_cents AS cashCents, status FROM users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') fail('This account cannot place orders.', 403);
    const crosses = type === 'market' || (side === 'buy' ? priceCents <= limitPriceCents : priceCents >= limitPriceCents);
    if (crosses) {
      executeFill(userId, symbol, side, quantity, priceCents);
    } else if (side === 'buy') {
      if (quantity * limitPriceCents > user.cashCents - reservedCash(userId)) fail('Insufficient buying power to reserve this limit order.');
    } else {
      const position = db.prepare('SELECT quantity FROM positions WHERE user_id = ? AND symbol = ?').get(userId, symbol);
      if (!position || quantity > position.quantity - reservedShares(userId, symbol)) fail('Not enough available shares to reserve this limit order.');
    }
    const now = Date.now();
    const result = db.prepare(`INSERT INTO orders(user_id, symbol, side, type, quantity, limit_price_cents,
      filled_price_cents, status, created_at, filled_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, symbol, side, type, quantity, limitPriceCents, crosses ? priceCents : null,
        crosses ? 'filled' : 'pending', now, crosses ? now : null);
    return getOrder(Number(result.lastInsertRowid));
  });
}

export function cancelOrder(userId, id) {
  return transaction(() => {
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ? AND user_id = ?').get(id, userId);
    if (!order) fail('Order not found.', 404);
    if (order.status !== 'pending') fail('Only pending orders can be cancelled.');
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
    return getOrder(id);
  });
}

export function matchPendingOrders() {
  if (getSetting('trading_enabled') !== '1') return;
  const pending = db.prepare(`SELECT orders.* FROM orders
    JOIN users ON users.id = orders.user_id JOIN assets ON assets.symbol = orders.symbol
    WHERE orders.status = 'pending' AND users.status = 'active' AND assets.active = 1 ORDER BY orders.created_at`).all();
  for (const order of pending) {
    const priceCents = Math.round(getQuote(order.symbol).price * 100);
    if (order.side === 'buy' ? priceCents > order.limit_price_cents : priceCents < order.limit_price_cents) continue;
    try {
      transaction(() => {
        const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id);
        if (current?.status !== 'pending' || getSetting('trading_enabled') !== '1') return;
        executeFill(order.user_id, order.symbol, order.side, order.quantity, priceCents, order.id);
        db.prepare("UPDATE orders SET status = 'filled', filled_price_cents = ?, filled_at = ? WHERE id = ?")
          .run(priceCents, Date.now(), order.id);
      });
    } catch (error) {
      // Unexpectedly unfillable orders are cancelled rather than keeping funds/shares reserved indefinitely.
      console.warn(`Cancelling unfillable limit order ${order.id}:`, error.message);
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(order.id);
    }
  }
}


const MAX_CASH_TRANSACTION_CENTS = 10_000_000; // $100,000 per simulated transaction.

export function getCashTransactions(userId) {
  return db.prepare(`SELECT id, type, amount_cents AS amountCents,
    balance_after_cents AS balanceAfterCents, created_at AS createdAt
    FROM cash_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`).all(userId);
}

export function createCashTransaction(userId, input) {
  const type = input?.type;
  const amountCents = input?.amountCents;
  if (!['top_up', 'withdrawal'].includes(type)) fail('Choose top up or withdrawal.');
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > MAX_CASH_TRANSACTION_CENTS) {
    fail('Enter an amount from $1.00 to $100,000.00.');
  }

  return transaction(() => {
    const user = db.prepare('SELECT cash_cents AS cashCents, status FROM users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') fail('This account cannot move cash.', 403);
    if (type === 'withdrawal') {
      const available = user.cashCents - reservedCash(userId);
      if (amountCents > available) fail('Withdrawal exceeds available cash after pending order reserves.');
      db.prepare('UPDATE users SET cash_cents = cash_cents - ? WHERE id = ?').run(amountCents, userId);
    } else {
      if (user.cashCents + amountCents > Number.MAX_SAFE_INTEGER) fail('This account has reached its virtual cash limit.');
      db.prepare('UPDATE users SET cash_cents = cash_cents + ? WHERE id = ?').run(amountCents, userId);
    }
    const balanceAfterCents = type === 'top_up' ? user.cashCents + amountCents : user.cashCents - amountCents;
    const createdAt = Date.now();
    const result = db.prepare(`INSERT INTO cash_transactions(user_id, type, amount_cents, balance_after_cents, created_at)
      VALUES(?, ?, ?, ?, ?)`).run(userId, type, amountCents, balanceAfterCents, createdAt);
    return { id: Number(result.lastInsertRowid), type, amountCents, balanceAfterCents, createdAt };
  });
}
