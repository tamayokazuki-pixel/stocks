// Market-data adapters.
//
// Two real providers are supported:
//   * yahoo   - keyless public Yahoo Finance chart endpoints (default). Real, but delayed
//               by up to ~15 minutes depending on the exchange, and offered without any SLA.
//   * finnhub - used when FINNHUB_API_KEY is set.
//
// Both return a normalized quote/history shape. When a provider call fails, market.js falls
// back to the clearly labeled simulated feed so paper trading keeps working.

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function round(value) { return Math.round(value * 100) / 100; }
function positive(value) { return Number.isFinite(value) && value > 0 ? value : null; }

async function getJson(url, timeout = 7000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/* ------------------------------------------------------------------ Yahoo */

// Ranges/intervals chosen so each chart keeps a useful number of points.
const YAHOO_RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
};

async function yahooChart(symbol, range, interval, timeout) {
  let lastError;
  for (const host of YAHOO_HOSTS) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}`
        + `?range=${range}&interval=${interval}&includePrePost=false`;
      const data = await getJson(url, timeout);
      const result = data?.chart?.result?.[0];
      if (!result?.meta) throw new Error(data?.chart?.error?.description || 'Empty chart response');
      return result;
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('Yahoo request failed');
}

function yahooQuoteFromChart(symbol, result) {
  const meta = result.meta || {};
  const price = positive(meta.regularMarketPrice);
  const previousClose = positive(meta.chartPreviousClose) ?? positive(meta.previousClose);
  if (!price || !previousClose) return null;
  const change = price - previousClose;
  const asOf = Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime * 1000 : Date.now();
  return {
    symbol,
    price: round(price),
    change: round(change),
    changePercent: round(change / previousClose * 100),
    previousClose: round(previousClose),
    open: round(positive(meta.regularMarketOpen) ?? previousClose),
    high: round(positive(meta.regularMarketDayHigh) ?? Math.max(price, previousClose)),
    low: round(positive(meta.regularMarketDayLow) ?? Math.min(price, previousClose)),
    volume: Number.isFinite(meta.regularMarketVolume) ? meta.regularMarketVolume : null,
    currency: meta.currency || 'USD',
    source: 'live',
    asOf,
  };
}

function yahooPoints(result) {
  const stamps = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return [];
  const points = [];
  let previous = null;
  for (let i = 0; i < stamps.length; i++) {
    const value = Number.isFinite(closes[i]) ? closes[i] : previous;
    if (!Number.isFinite(value) || !Number.isFinite(stamps[i])) continue;
    previous = value;
    points.push({ time: stamps[i] * 1000, value: round(value) });
  }
  return points;
}

export const yahooProvider = {
  id: 'yahoo',
  label: 'Yahoo Finance',
  // Keyless endpoint: a short interval is fine, but stay polite.
  refreshMs: 15000,
  async quote(symbol) {
    try {
      const result = await yahooChart(symbol, '1d', '5m', 7000);
      return yahooQuoteFromChart(symbol, result);
    } catch { return null; }
  },
  async quotes(symbols) {
    // The chart endpoint is per-symbol; a bounded pool avoids a burst of parallel requests.
    const out = new Map();
    const queue = [...symbols];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const symbol = queue.shift();
        out.set(symbol, await yahooProvider.quote(symbol));
      }
    });
    await Promise.all(workers);
    return out;
  },
  async history(symbol, range) {
    const spec = YAHOO_RANGES[range];
    if (!spec) return null;
    try {
      const result = await yahooChart(symbol, spec.range, spec.interval, 9000);
      const points = yahooPoints(result);
      if (points.length < 3) return null;
      return { symbol, range, source: 'live', points };
    } catch { return null; }
  },
};

/* ---------------------------------------------------------------- Finnhub */

export function finnhubProvider(apiKey) {
  const token = encodeURIComponent(apiKey);
  return {
    id: 'finnhub',
    label: 'Finnhub',
    // One request per listed instrument every 30s stays inside the free quote rate limit.
    refreshMs: 30000,
    async quote(symbol) {
      try {
        const data = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`, 6500);
        const price = positive(data.c);
        const previousClose = positive(data.pc);
        if (!price || !previousClose) return null;
        const change = price - previousClose;
        return {
          symbol,
          price: round(price),
          change: round(change),
          changePercent: round(change / previousClose * 100),
          previousClose: round(previousClose),
          open: round(positive(data.o) ?? previousClose),
          high: round(positive(data.h) ?? price),
          low: round(positive(data.l) ?? price),
          volume: null,
          currency: 'USD',
          source: 'live',
          asOf: Number.isFinite(data.t) && data.t > 0 ? data.t * 1000 : Date.now(),
        };
      } catch { return null; }
    },
    async quotes(symbols) {
      const results = await Promise.all(symbols.map(symbol => this.quote(symbol)));
      return new Map(symbols.map((symbol, i) => [symbol, results[i]]));
    },
    async history(symbol, range) {
      const resolution = { '1D': '5', '1W': '60', '1M': 'D', '3M': 'D', '1Y': 'W' }[range];
      const seconds = { '1D': 86400, '1W': 7 * 86400, '1M': 35 * 86400, '3M': 95 * 86400, '1Y': 370 * 86400 }[range];
      if (!resolution) return null;
      const to = Math.floor(Date.now() / 1000);
      try {
        const data = await getJson(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}`
          + `&resolution=${resolution}&from=${to - seconds}&to=${to}&token=${token}`, 7500);
        if (data.s !== 'ok' || !Array.isArray(data.c) || data.c.length < 3) return null;
        return { symbol, range, source: 'live', points: data.c.map((value, i) => ({ time: data.t[i] * 1000, value: round(value) })) };
      } catch { return null; }
    },
  };
}

/* ----------------------------------------------------------------- Select */

// MARKET_PROVIDER=yahoo|finnhub|demo|auto (default auto: Finnhub when a key exists, else Yahoo).
export function selectProvider(env = process.env) {
  const choice = (env.MARKET_PROVIDER || 'auto').trim().toLowerCase();
  const apiKey = env.FINNHUB_API_KEY?.trim();
  if (choice === 'demo' || choice === 'off' || choice === 'simulated') return null;
  if (choice === 'finnhub') return apiKey ? finnhubProvider(apiKey) : null;
  if (choice === 'yahoo') return yahooProvider;
  return apiKey ? finnhubProvider(apiKey) : yahooProvider;
}
