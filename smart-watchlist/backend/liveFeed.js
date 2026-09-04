// liveFeed.js
//
// Fetches a real quote + intraday history from Yahoo Finance's public chart
// endpoint. This is genuinely real market data (delayed, typically by
// minutes, like most free quote sources) -- not simulated. No API key is
// required, but it's an *unofficial* endpoint: Yahoo can rate-limit, change
// its response shape, or reject requests without a browser-like User-Agent.
// A failed/malformed response is treated as "this symbol falls back to
// simulated data for now," not a crash -- see marketEngine.js for how that
// fallback is wired in, and README.md for why this tradeoff was made
// deliberately visible instead of hidden.

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

async function fetchQuote(symbol, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${BASE}${encodeURIComponent(symbol)}?interval=5m&range=1d`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // The unofficial endpoint frequently rejects requests that don't
        // look like they came from a browser.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Pulse/1.0',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result) throw new Error('no result in response body');

    const meta = result.meta || {};
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
    if (typeof price !== 'number' || typeof prevClose !== 'number') {
      throw new Error('missing price fields in response');
    }

    const quoteBlock = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const rawCloses = quoteBlock.close || [];
    const rawVolumes = quoteBlock.volume || [];
    const closes = rawCloses.filter((c) => typeof c === 'number');
    const volumes = rawVolumes.filter((v) => typeof v === 'number');

    // Rolling returns between consecutive intraday candles - this is the
    // real volatility baseline the attention score gets compared against.
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1], b = closes[i];
      if (a > 0) returns.push((b - a) / a);
    }

    const lastCandleClose = closes[closes.length - 1];
    const lastVolume = volumes[volumes.length - 1] || 0;
    const avgVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

    // Cross-check: the headline "regularMarketPrice" vs. the most recent
    // intraday candle close Yahoo also reports in the same payload. These
    // are normally in sync; a real gap between them means one of the two
    // fields is running on a stale cache somewhere in Yahoo's infrastructure
    // -- a genuine (not manufactured) data-conflict signal.
    const crossCheckDiscrepancy = lastCandleClose ? Math.abs(price - lastCandleClose) / price : 0;

    return {
      ok: true,
      symbol,
      price,
      prevClose,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      marketState: meta.marketState, // 'REGULAR' | 'CLOSED' | 'PRE' | 'POST' | 'PREPRE' | 'POSTPOST'
      currency: meta.currency,
      closes: closes.slice(-40),
      returns,
      lastVolume,
      avgVolume,
      crossCheckDiscrepancy,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return { ok: false, symbol, error: err.message, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchQuote };
