import { db, getSetting } from './db.js';

const apiKey = process.env.FINNHUB_API_KEY?.trim();
const quotes = new Map();
const clients = new Set();
const historyCache = new Map();
let updatedAt = Date.now();
let refreshing = false;
let onPricesUpdated = () => {};

export function getAssets(activeOnly = true) {
  const rows = db.prepare(`SELECT symbol, name, sector, exchange, kind, color,
    base_price_cents AS basePriceCents, base_change_percent AS baseChangePercent, active, featured
    FROM assets ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY featured DESC, symbol ASC`).all();
  return rows.map(row => ({ ...row, active: Boolean(row.active), featured: Boolean(row.featured) }));
}

export function getAsset(symbol) {
  const row = db.prepare(`SELECT symbol, name, sector, exchange, kind, color,
    base_price_cents AS basePriceCents, base_change_percent AS baseChangePercent, active, featured
    FROM assets WHERE symbol = ?`).get(symbol);
  return row ? { ...row, active: Boolean(row.active), featured: Boolean(row.featured) } : null;
}

function round(value) { return Math.round(value * 100) / 100; }

function demoQuote(asset, previous) {
  const basePrice = asset.basePriceCents / 100;
  const previousClose = round(basePrice / (1 + asset.baseChangePercent / 100));
  // Small bounded price movements keep the local demo lively without implying real quotes.
  const movement = previous?.source === 'demo' ? (Math.random() - 0.5) * basePrice * 0.0009 : 0;
  const price = round(Math.max(basePrice * 0.92, Math.min(basePrice * 1.08, (previous?.source === 'demo' ? previous.price : basePrice) + movement)));
  const change = round(price - previousClose);
  return {
    symbol: asset.symbol, price, change, changePercent: round(change / previousClose * 100), previousClose,
    open: round(previousClose * 1.001), high: round(Math.max(price, basePrice, previousClose) * 1.004),
    low: round(Math.min(price, basePrice, previousClose) * 0.996), volume: null,
    source: 'demo', asOf: Date.now(),
  };
}

export function getQuote(symbol) {
  const cached = quotes.get(symbol);
  if (cached) return cached;
  const asset = getAsset(symbol);
  if (!asset) return null;
  const initial = demoQuote(asset);
  quotes.set(symbol, initial);
  return initial;
}

export function resetQuote(symbol) {
  quotes.delete(symbol);
  historyCache.clear();
  const asset = getAsset(symbol);
  if (asset) quotes.set(symbol, demoQuote(asset));
  broadcast();
}

async function fetchFinnhubQuote(asset) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(asset.symbol)}&token=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Number.isFinite(data.c) || data.c <= 0 || !Number.isFinite(data.pc) || data.pc <= 0 || !data.t) return null;
    return {
      symbol: asset.symbol, price: round(data.c), change: round(data.c - data.pc),
      changePercent: round((data.c - data.pc) / data.pc * 100), previousClose: round(data.pc),
      open: round(data.o || data.pc), high: round(data.h || data.c), low: round(data.l || data.c),
      volume: null, source: 'live', asOf: data.t * 1000,
    };
  } catch { return null; }
}

export function marketStatus() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const isOpen = !['Sat', 'Sun'].includes(parts.weekday) && minute >= 570 && minute < 960;
  // A time-based indication only; exchange holidays are not included.
  return { isOpen, label: isOpen ? 'US session open' : 'US session closed' };
}

export function getSnapshot() {
  const assets = getAssets();
  const activeQuotes = Object.fromEntries(assets.map(asset => [asset.symbol, getQuote(asset.symbol)]));
  const sources = new Set(Object.values(activeQuotes).map(quote => quote.source));
  const mode = sources.size > 1 ? 'mixed' : sources.has('live') ? 'live' : 'demo';
  const notices = db.prepare('SELECT id, title, body, created_at AS createdAt FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 3').all();
  return {
    assets, quotes: activeQuotes, mode, provider: mode === 'demo' ? 'Simulated' : 'Finnhub',
    updatedAt, marketStatus: marketStatus(), tradingEnabled: getSetting('trading_enabled') === '1', notices,
  };
}

function broadcast() {
  if (!clients.size) return;
  const data = `event: quotes\ndata: ${JSON.stringify(getSnapshot())}\n\n`;
  for (const client of clients) {
    try { client.write(data); } catch { clients.delete(client); }
  }
}

// Push administrative notices and trading-control changes without waiting for the next quote tick.
export function publishMarketUpdate() {
  updatedAt = Date.now();
  broadcast();
}

export function subscribeToMarket(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  clients.add(res);
  res.write(`event: quotes\ndata: ${JSON.stringify(getSnapshot())}\n\n`);
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); } }, 25000);
  req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
}

export function setOrderMatcher(fn) { onPricesUpdated = fn; }

export async function refreshMarket() {
  if (refreshing) return;
  refreshing = true;
  try {
    const assets = getAssets(false);
    if (apiKey) {
      // One request per listed instrument every 30 seconds stays within the free quote rate limit.
      const results = await Promise.all(assets.map(asset => fetchFinnhubQuote(asset)));
      assets.forEach((asset, i) => quotes.set(asset.symbol, results[i] || demoQuote(asset, quotes.get(asset.symbol))));
    } else {
      for (const asset of assets) quotes.set(asset.symbol, demoQuote(asset, quotes.get(asset.symbol)));
    }
    updatedAt = Date.now();
    try { onPricesUpdated(); } catch (error) { console.error('Order matching failed:', error); }
    broadcast();
  } finally {
    refreshing = false;
  }
}

export function startMarket() {
  refreshMarket().catch(error => console.error('Market refresh failed:', error));
  const timer = setInterval(() => refreshMarket().catch(error => console.error('Market refresh failed:', error)), apiKey ? 30000 : 7000);
  return () => clearInterval(timer);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function demoHistory(symbol, range) {
  const quote = getQuote(symbol);
  const durations = { '1D': 24 * 3600000, '1W': 7 * 86400000, '1M': 30 * 86400000, '3M': 90 * 86400000, '1Y': 365 * 86400000 };
  const amplitudes = { '1D': 0.012, '1W': 0.025, '1M': 0.055, '3M': 0.09, '1Y': 0.17 };
  const count = range === '1D' ? 78 : 90;
  const seed = hashString(`${symbol}-${range}-${new Date().toISOString().slice(0, 10)}`);
  const random = seededRandom(seed);
  const trend = ((seed % 19) - 7) / 100;
  const start = range === '1D' ? quote.previousClose : quote.price / (1 + trend);
  const noise = [0];
  for (let i = 1; i < count; i++) noise.push(noise[i - 1] + (random() - 0.49) * 0.6);
  const endNoise = noise[count - 1];
  const now = Date.now();
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const wobble = (noise[i] - endNoise * t) * quote.price * amplitudes[range] * 0.58;
    const wave = Math.sin(t * Math.PI * 5) * Math.sin(t * Math.PI) * quote.price * amplitudes[range] * 0.16;
    return {
      time: Math.round(now - durations[range] * (1 - t)),
      value: round(Math.max(0.01, start + (quote.price - start) * t + wobble + wave)),
    };
  });
  points[points.length - 1].value = quote.price;
  return { symbol, range, source: 'demo', points };
}

async function finnhubHistory(symbol, range) {
  const resolution = { '1D': '5', '1W': '60', '1M': 'D', '3M': 'D', '1Y': 'W' }[range];
  const seconds = { '1D': 86400, '1W': 7 * 86400, '1M': 35 * 86400, '3M': 95 * 86400, '1Y': 370 * 86400 }[range];
  const to = Math.floor(Date.now() / 1000);
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${to - seconds}&to=${to}&token=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7500) });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.s !== 'ok' || !Array.isArray(data.c) || data.c.length < 3) return null;
    return { symbol, range, source: 'live', points: data.c.map((value, i) => ({ time: data.t[i] * 1000, value: round(value) })) };
  } catch { return null; }
}

export async function getHistory(symbol, range) {
  const cached = historyCache.get(`${symbol}:${range}`);
  if (cached && cached.expires > Date.now()) return cached.data;
  let data = null;
  if (apiKey && getQuote(symbol)?.source === 'live') data = await finnhubHistory(symbol, range);
  if (!data) data = demoHistory(symbol, range);
  historyCache.set(`${symbol}:${range}`, { data, expires: Date.now() + (data.source === 'live' ? 60000 : 20000) });
  return data;
}
