import { many, one, getSetting } from './db.js';
import { selectProvider } from './providers.js';

const provider = selectProvider();
const liveEnabled = Boolean(provider);
const quotes = new Map();
const clients = new Set();
const historyCache = new Map();
let assetsCache = [];
let noticesCache = [];
let tradingEnabledCache = true;
let updatedAt = Date.now();
let refreshing = false;
let onPricesUpdated = () => {};

export async function initializeMarket() {
  await reloadMarketData();
  for (const asset of assetsCache) quotes.set(asset.symbol, demoQuote(asset));
}

export async function reloadMarketData() {
  assetsCache = await many(`SELECT symbol, name, sector, exchange, kind, color,
    base_price_cents AS "basePriceCents", base_change_percent AS "baseChangePercent", active, featured
    FROM assets ORDER BY featured DESC, symbol ASC`);
  assetsCache = assetsCache.map(row => ({ ...row, active: Boolean(row.active), featured: Boolean(row.featured) }));
  noticesCache = await many('SELECT id, title, body, created_at AS "createdAt" FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 3');
  tradingEnabledCache = (await getSetting('trading_enabled')) === '1';
  historyCache.clear();
}

export function getAssets(activeOnly = true) { return activeOnly ? assetsCache.filter(asset => asset.active) : [...assetsCache]; }
export function getAsset(symbol) { return assetsCache.find(asset => asset.symbol === symbol) || null; }
function round(value) { return Math.round(value * 100) / 100; }

function demoQuote(asset, previous) {
  const basePrice = asset.basePriceCents / 100;
  const previousClose = round(basePrice / (1 + asset.baseChangePercent / 100));
  const movement = previous?.source === 'demo' ? (Math.random() - 0.5) * basePrice * 0.0009 : 0;
  const price = round(Math.max(basePrice * 0.92, Math.min(basePrice * 1.08, (previous?.source === 'demo' ? previous.price : basePrice) + movement)));
  const change = round(price - previousClose);
  return { symbol: asset.symbol, price, change, changePercent: round(change / previousClose * 100), previousClose,
    open: round(previousClose * 1.001), high: round(Math.max(price, basePrice, previousClose) * 1.004),
    low: round(Math.min(price, basePrice, previousClose) * 0.996), volume: null, source: 'demo', asOf: Date.now() };
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

export function marketStatus() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const isOpen = !['Sat', 'Sun'].includes(parts.weekday) && minute >= 570 && minute < 960;
  return { isOpen, label: isOpen ? 'US session open' : 'US session closed' };
}

export function getSnapshot() {
  const assets = getAssets();
  const activeQuotes = Object.fromEntries(assets.map(asset => [asset.symbol, getQuote(asset.symbol)]));
  const sources = new Set(Object.values(activeQuotes).map(quote => quote.source));
  const mode = sources.size > 1 ? 'mixed' : sources.has('live') ? 'live' : 'demo';
  return { assets, quotes: activeQuotes, mode, provider: mode === 'demo' ? 'Simulated' : provider?.label ?? 'Simulated',
    updatedAt, marketStatus: marketStatus(), tradingEnabled: tradingEnabledCache, notices: noticesCache };
}

function broadcast() {
  if (!clients.size) return;
  const data = `event: quotes\ndata: ${JSON.stringify(getSnapshot())}\n\n`;
  for (const client of clients) { try { client.write(data); } catch { clients.delete(client); } }
}

export async function publishMarketUpdate() {
  await reloadMarketData();
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
    if (provider) {
      const fetched = await provider.quotes(assets.map(asset => asset.symbol));
      for (const asset of assets) quotes.set(asset.symbol, fetched.get(asset.symbol) || demoQuote(asset, quotes.get(asset.symbol)));
    } else for (const asset of assets) quotes.set(asset.symbol, demoQuote(asset, quotes.get(asset.symbol)));
    updatedAt = Date.now();
    try { await onPricesUpdated(); } catch (error) { console.error('Order matching failed:', error); }
    broadcast();
  } finally { refreshing = false; }
}

export function startMarket() {
  const tick = () => refreshMarket().catch(error => console.error('Market refresh failed:', error));
  tick();
  const timer = setInterval(tick, provider ? provider.refreshMs : 7000);
  console.log(provider ? `Market data: ${provider.label} (real quotes, may be delayed), refreshing every ${Math.round(provider.refreshMs / 1000)}s.`
    : 'Market data: simulated feed (no provider configured).');
  return () => clearInterval(timer);
}

export function marketProviderInfo() { return { live: liveEnabled, id: provider?.id ?? 'demo', label: provider?.label ?? 'Simulated' }; }

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
function hashString(text) { let hash = 2166136261; for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return hash >>> 0; }
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
    return { time: Math.round(now - durations[range] * (1 - t)), value: round(Math.max(0.01, start + (quote.price - start) * t + wobble + wave)) };
  });
  points.at(-1).value = quote.price;
  return { symbol, range, source: 'demo', points };
}

export async function getHistory(symbol, range) {
  const cached = historyCache.get(`${symbol}:${range}`);
  if (cached && cached.expires > Date.now()) return cached.data;
  let data = null;
  if (provider && getQuote(symbol)?.source === 'live') data = await provider.history(symbol, range);
  if (!data) data = demoHistory(symbol, range);
  historyCache.set(`${symbol}:${range}`, { data, expires: Date.now() + (data.source === 'live' ? 60000 : 20000) });
  return data;
}
