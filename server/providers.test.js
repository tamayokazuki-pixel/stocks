import test from 'node:test';
import assert from 'node:assert/strict';
import { finnhubProvider, selectProvider, yahooProvider } from './providers.js';

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(String(url), init);
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

const chartBody = {
  chart: {
    result: [{
      meta: {
        currency: 'USD', symbol: 'AAPL', regularMarketPrice: 255.5, chartPreviousClose: 250,
        regularMarketOpen: 251, regularMarketDayHigh: 256.2, regularMarketDayLow: 250.4,
        regularMarketVolume: 41234567, regularMarketTime: 1758800000,
      },
      timestamp: [1758790000, 1758790300, 1758790600, 1758790900],
      indicators: { quote: [{ close: [251.1, null, 253.75, 255.5] }] },
    }],
    error: null,
  },
};

test('yahoo quote is normalized from the chart endpoint', async () => {
  const restore = mockFetch(url => {
    assert.match(url, /query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL/);
    return jsonResponse(chartBody);
  });
  try {
    const quote = await yahooProvider.quote('AAPL');
    assert.equal(quote.symbol, 'AAPL');
    assert.equal(quote.price, 255.5);
    assert.equal(quote.previousClose, 250);
    assert.equal(quote.change, 5.5);
    assert.equal(quote.changePercent, 2.2);
    assert.equal(quote.source, 'live');
    assert.equal(quote.volume, 41234567);
    assert.equal(quote.asOf, 1758800000000);
  } finally { restore(); }
});

test('yahoo history fills gaps and returns ascending points', async () => {
  const restore = mockFetch(() => jsonResponse(chartBody));
  try {
    const history = await yahooProvider.history('AAPL', '1D');
    assert.equal(history.source, 'live');
    assert.equal(history.points.length, 4);
    assert.equal(history.points[1].value, 251.1); // null close carried forward
    assert.equal(history.points.at(-1).value, 255.5);
    assert.ok(history.points.every((point, i, all) => i === 0 || point.time > all[i - 1].time));
  } finally { restore(); }
});

test('yahoo falls back to the second host and then gives up quietly', async () => {
  let calls = 0;
  const restore = mockFetch(url => {
    calls += 1;
    if (url.includes('query1')) throw new Error('network down');
    return jsonResponse(chartBody);
  });
  try {
    assert.equal((await yahooProvider.quote('AAPL')).price, 255.5);
    assert.equal(calls, 2);
  } finally { restore(); }

  const restoreAll = mockFetch(() => { throw new Error('offline'); });
  try {
    assert.equal(await yahooProvider.quote('AAPL'), null);
    assert.equal(await yahooProvider.history('AAPL', '1D'), null);
  } finally { restoreAll(); }
});

test('yahoo rejects nonsensical payloads instead of inventing prices', async () => {
  const restore = mockFetch(() => jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 0, chartPreviousClose: 0 } }] } }));
  try { assert.equal(await yahooProvider.quote('AAPL'), null); } finally { restore(); }
});

test('quotes() resolves every requested symbol', async () => {
  const restore = mockFetch(url => {
    if (url.includes('/MSFT')) return jsonResponse({ chart: { result: null, error: { description: 'Not found' } } });
    return jsonResponse(chartBody);
  });
  try {
    const map = await yahooProvider.quotes(['AAPL', 'MSFT', 'SPY']);
    assert.deepEqual([...map.keys()].sort(), ['AAPL', 'MSFT', 'SPY']);
    assert.equal(map.get('MSFT'), null);
    assert.equal(map.get('SPY').price, 255.5);
  } finally { restore(); }
});

test('finnhub adapter still normalizes quotes', async () => {
  const restore = mockFetch(() => jsonResponse({ c: 101, pc: 100, o: 100.5, h: 102, l: 99.5, t: 1758800000 }));
  try {
    const quote = await finnhubProvider('key').quote('AAPL');
    assert.equal(quote.price, 101);
    assert.equal(quote.changePercent, 1);
    assert.equal(quote.source, 'live');
  } finally { restore(); }
});

test('provider selection honours configuration', () => {
  assert.equal(selectProvider({}).id, 'yahoo');
  assert.equal(selectProvider({ FINNHUB_API_KEY: 'abc' }).id, 'finnhub');
  assert.equal(selectProvider({ MARKET_PROVIDER: 'yahoo', FINNHUB_API_KEY: 'abc' }).id, 'yahoo');
  assert.equal(selectProvider({ MARKET_PROVIDER: 'demo' }), null);
  assert.equal(selectProvider({ MARKET_PROVIDER: 'finnhub' }), null);
});
