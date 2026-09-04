// marketEngine.js
//
// Hybrid feed: for each symbol, this engine tries to keep it on REAL data
// (fetched from Yahoo Finance's free public endpoint, see liveFeed.js) and
// only drops a symbol into SIMULATED mode if real fetches for it keep
// failing (network blocked, endpoint rate-limiting, unknown ticker, etc).
// Every quote this engine hands out carries an explicit `source: 'real' |
// 'simulated'` field -- the frontend surfaces this directly so it's never
// ambiguous what a given number actually is.
//
// Real quotes are genuinely delayed-market data (typically minutes behind,
// like almost all free quote sources) and only change when a poll actually
// returns a new value -- they don't jitter every few seconds the way the
// simulator does. That's intentional, not a bug: manufacturing fake motion
// on top of real numbers would defeat the point of calling them "real."

const SYMS = require('./symbols');
const liveFeed = require('./liveFeed');

const TICK_MS = 3000;              // broadcast cadence (also drives the simulator)
const REAL_POLL_MS = 20_000;       // how often each real symbol is re-fetched
const REAL_POLL_JITTER_MS = 15_000; // spread initial polls so we don't burst 20 requests at once
const FAILURE_FALLBACK_THRESHOLD = 3;      // consecutive failures before falling back to simulation
const NEVER_SUCCEEDED_FALLBACK_MS = 45_000; // or: never got a single real quote within this long
const SIM_HISTORY_WINDOW = 240;
const SIM_RETURN_WINDOW = 40;

const FORCE_SIMULATED = process.env.PULSE_MODE === 'simulated'; // escape hatch for offline/blocked networks

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function round2(n) { return Math.round(n * 100) / 100; }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

class MarketEngine {
  constructor() {
    this.state = {};
    this.listeners = new Set();
    const now = Date.now();
    for (const def of SYMS) {
      this.state[def.symbol] = {
        ...def,
        mode: FORCE_SIMULATED ? 'simulated' : 'pending', // 'pending' -> 'real' | 'simulated'
        firstSeenAt: now,

        // --- simulated fallback state (random-walk model) ---
        sim: {
          sessionOpen: def.base,
          price: def.base,
          feedB: { price: def.base, ts: now, laggedQueue: [] },
          history: [{ t: now, price: def.base, volume: 0 }],
          returns: [],
          volumes: [],
          rangeHigh: def.base,
          rangeLow: def.base,
          lastTickTs: now,
          lastJumpTs: null,
        },

        // --- real-feed state ---
        real: {
          price: null, prevClose: null, dayHigh: null, dayLow: null,
          fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, marketState: null,
          closes: [], returns: [], lastVolume: 0, avgVolume: 0,
          crossCheckDiscrepancy: 0, fetchedAt: null, consecutiveFailures: 0,
          lastError: null,
        },
      };
    }
    this._interval = null;
    this._pollTimers = [];
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), TICK_MS);
    if (!FORCE_SIMULATED) {
      // Stagger the first poll of each symbol so we don't fire 20 requests
      // at once against a free/unofficial endpoint.
      for (const symbol of Object.keys(this.state)) {
        const delay = Math.random() * REAL_POLL_JITTER_MS;
        const t = setTimeout(() => this._pollLoop(symbol), delay);
        this._pollTimers.push(t);
      }
    }
  }

  stop() {
    clearInterval(this._interval);
    this._interval = null;
    for (const t of this._pollTimers) clearTimeout(t);
    this._pollTimers = [];
  }

  onTick(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async _pollLoop(symbol) {
    await this._pollOnce(symbol);
    // Re-schedule regardless of success/failure - a symbol in fallback mode
    // keeps trying in the background and can recover to 'real' automatically.
    const t = setTimeout(() => this._pollLoop(symbol), REAL_POLL_MS + Math.random() * 2000);
    this._pollTimers.push(t);
  }

  async _pollOnce(symbol) {
    const s = this.state[symbol];
    if (!s) return;
    const result = await liveFeed.fetchQuote(symbol);
    if (result.ok) {
      s.real.price = result.price;
      s.real.prevClose = result.prevClose;
      s.real.dayHigh = result.dayHigh;
      s.real.dayLow = result.dayLow;
      s.real.fiftyTwoWeekHigh = result.fiftyTwoWeekHigh;
      s.real.fiftyTwoWeekLow = result.fiftyTwoWeekLow;
      s.real.marketState = result.marketState;
      s.real.closes = result.closes;
      s.real.returns = result.returns;
      s.real.lastVolume = result.lastVolume;
      s.real.avgVolume = result.avgVolume;
      s.real.crossCheckDiscrepancy = result.crossCheckDiscrepancy;
      s.real.fetchedAt = result.fetchedAt;
      s.real.consecutiveFailures = 0;
      s.real.lastError = null;
      s.mode = 'real';
    } else {
      s.real.consecutiveFailures += 1;
      s.real.lastError = result.error;
      const neverSucceeded = s.real.fetchedAt === null;
      const tooManyFailures = s.real.consecutiveFailures >= FAILURE_FALLBACK_THRESHOLD;
      const waitedTooLong = neverSucceeded && (Date.now() - s.firstSeenAt) > NEVER_SUCCEEDED_FALLBACK_MS;
      if (tooManyFailures || waitedTooLong) {
        s.mode = 'simulated';
      }
    }
  }

  _tick() {
    const now = Date.now();
    const deltas = [];
    for (const symbol of Object.keys(this.state)) {
      const s = this.state[symbol];
      if (s.mode !== 'real') this._advanceSimulated(s, now);
      deltas.push(this.getQuote(symbol));
    }
    for (const fn of this.listeners) fn(deltas);
  }

  _advanceSimulated(s, now) {
    const sim = s.sim;
    const isJump = Math.random() < 0.025;
    let ret = gaussian() * s.vol;
    if (isJump) {
      const sign = Math.random() < 0.5 ? -1 : 1;
      ret += sign * (0.03 + Math.random() * 0.07);
      sim.lastJumpTs = now;
    }
    const newPrice = Math.max(0.5, sim.price * (1 + ret));
    sim.price = newPrice;

    let volMultiplier = 0.4 + Math.random() * 1.4;
    if (isJump) volMultiplier *= 3 + Math.random() * 3;
    const volume = Math.round(s.baseVolume / 20 * volMultiplier);

    sim.history.push({ t: now, price: newPrice, volume });
    if (sim.history.length > SIM_HISTORY_WINDOW) sim.history.shift();
    sim.returns.push(ret);
    if (sim.returns.length > SIM_RETURN_WINDOW) sim.returns.shift();
    sim.volumes.push(volume);
    if (sim.volumes.length > SIM_RETURN_WINDOW) sim.volumes.shift();
    sim.rangeHigh = Math.max(sim.rangeHigh, newPrice);
    sim.rangeLow = Math.min(sim.rangeLow, newPrice);
    sim.lastTickTs = now;

    // Secondary mirror feed, purely for the simulated-mode data-quality demo.
    sim.feedB.laggedQueue.push({ price: newPrice * (1 + gaussian() * 0.0015), ts: now });
    const lagTicks = Math.random() < 0.05 ? 4 + Math.floor(Math.random() * 5) : 1;
    while (sim.feedB.laggedQueue.length > lagTicks) {
      const next = sim.feedB.laggedQueue.shift();
      sim.feedB.price = next.price;
      sim.feedB.ts = next.ts;
    }
  }

  getQuote(symbol) {
    const s = this.state[symbol];
    if (!s) return null;
    return s.mode === 'real' ? this._realQuote(s) : this._simulatedQuote(s);
  }

  _realQuote(s) {
    const r = s.real;
    const changePct = r.prevClose ? (r.price - r.prevClose) / r.prevClose : 0;
    const std = stddev(r.returns) || 0.01;
    const lastReturn = changePct; // best available "latest move" signal for a slow-polled feed
    const zScore = std > 0 ? Math.abs(lastReturn) / std : 0;
    const volSpike = r.avgVolume > 0 ? r.lastVolume / r.avgVolume : 1;
    const hasRange = r.fiftyTwoWeekHigh != null && r.fiftyTwoWeekLow != null && r.fiftyTwoWeekHigh > r.fiftyTwoWeekLow;
    const rangePos = hasRange ? (r.price - r.fiftyTwoWeekLow) / (r.fiftyTwoWeekHigh - r.fiftyTwoWeekLow) : 0.5;

    const ageMs = r.fetchedAt ? Date.now() - r.fetchedAt : Infinity;
    let dataQuality = 'live';
    if (r.marketState && r.marketState !== 'REGULAR') dataQuality = 'closed';
    else if (r.crossCheckDiscrepancy > 0.004) dataQuality = 'conflicting';
    else if (ageMs > REAL_POLL_MS * 4) dataQuality = 'delayed';

    return {
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      source: 'real',
      price: round2(r.price),
      sessionOpen: round2(r.prevClose),
      changePct,
      zScore,
      volSpike,
      rangePos: clamp01(rangePos),
      rangeHigh: hasRange ? round2(r.fiftyTwoWeekHigh) : null,
      rangeLow: hasRange ? round2(r.fiftyTwoWeekLow) : null,
      rangeLabel: '52-week',
      marketState: r.marketState,
      recentJump: false,
      dataQuality,
      secondaryPrice: null,
      secondaryAgeMs: ageMs,
      sparkline: r.closes.length ? r.closes.map(round2) : [r.price],
      ts: r.fetchedAt,
    };
  }

  _simulatedQuote(s) {
    const sim = s.sim;
    const changePct = (sim.price - sim.sessionOpen) / sim.sessionOpen;
    const std = stddev(sim.returns) || s.vol;
    const lastReturn = sim.returns[sim.returns.length - 1] || 0;
    const zScore = std > 0 ? Math.abs(lastReturn) / std : 0;
    const avgVolume = sim.volumes.length ? sim.volumes.reduce((a, b) => a + b, 0) / sim.volumes.length : 1;
    const lastVolume = sim.volumes[sim.volumes.length - 1] || 0;
    const volSpike = avgVolume > 0 ? lastVolume / avgVolume : 1;
    const range = sim.rangeHigh - sim.rangeLow || 1;
    const rangePos = (sim.price - sim.rangeLow) / range;

    const discrepancy = Math.abs(sim.price - sim.feedB.price) / sim.price;
    const feedBAgeMs = Date.now() - sim.feedB.ts;
    let dataQuality = 'live';
    if (discrepancy > 0.004) dataQuality = 'conflicting';
    else if (feedBAgeMs > TICK_MS * 3) dataQuality = 'delayed';

    return {
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      source: 'simulated',
      price: round2(sim.price),
      sessionOpen: round2(sim.sessionOpen),
      changePct,
      zScore,
      volSpike,
      rangePos,
      rangeHigh: round2(sim.rangeHigh),
      rangeLow: round2(sim.rangeLow),
      rangeLabel: "today's",
      marketState: null,
      recentJump: Boolean(sim.lastJumpTs && (Date.now() - sim.lastJumpTs) < 30_000),
      dataQuality,
      secondaryPrice: round2(sim.feedB.price),
      secondaryAgeMs: feedBAgeMs,
      sparkline: sim.history.slice(-40).map(h => round2(h.price)),
      ts: sim.lastTickTs,
    };
  }

  getAllQuotes() {
    return Object.keys(this.state).map(sym => this.getQuote(sym));
  }

  listCatalog() {
    return SYMS.map(({ symbol, name, sector }) => ({ symbol, name, sector }));
  }

  statusSummary() {
    const symbols = Object.values(this.state);
    const real = symbols.filter(s => s.mode === 'real').length;
    const simulated = symbols.filter(s => s.mode === 'simulated').length;
    const pending = symbols.filter(s => s.mode === 'pending').length;
    return { total: symbols.length, real, simulated, pending, forcedSimulated: FORCE_SIMULATED };
  }
}

module.exports = { MarketEngine, TICK_MS };
