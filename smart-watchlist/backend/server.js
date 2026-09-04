const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { MarketEngine } = require('./marketEngine');
const changeEngine = require('./changeEngine');
const llmAdvocate = require('./llmAdvocate');
const db = require('./db');

const app = express();
app.use(express.json());

const engine = new MarketEngine();
engine.start();

// ---------- helpers ----------

function requireUser(req, res, next) {
  const code = req.query.userId || req.body.userId;
  if (!code) return res.status(400).json({ error: 'userId (watchlist code) is required' });
  const user = db.getUser(code);
  if (!user) return res.status(404).json({ error: 'Unknown watchlist code' });
  req.user = user;
  next();
}

async function annotatedWatchlist(user) {
  const raw = user.watchlist.map(sym => engine.getQuote(sym)).filter(Boolean);
  return Promise.all(
    raw.map(q => changeEngine.annotate(q, (user.settings[q.symbol] || {}).sensitivity || 'normal', user.theses[q.symbol] || null))
  );
}

// ---------- session / identity ----------

// Create a brand new watchlist code (no signup friction).
app.post('/api/session', (req, res) => {
  const { code } = req.body || {};
  if (code) {
    const existing = db.getUser(code.toUpperCase().trim());
    if (existing) return res.json(publicUser(existing));
    return res.status(404).json({ error: 'That code was not found' });
  }
  const user = db.createUser();
  res.json(publicUser(user));
});

function publicUser(u) {
  return { userId: u.code, code: u.code, watchlist: u.watchlist, settings: u.settings, lastSeen: u.lastSeen };
}

// Permanently delete an entire watchlist (all its symbols, theses,
// settings, and history) - for cleaning up codes created while testing.
// Irreversible, so the frontend confirms before calling this.
app.delete('/api/session', requireUser, (req, res) => {
  const deleted = db.deleteUser(req.user.code);
  res.json({ deleted });
});

// ---------- catalog ----------

app.get('/api/symbols', (req, res) => {
  res.json(engine.listCatalog());
});

// Global transparency endpoint: how many symbols are on real vs. simulated
// data right now. The frontend polls this to show a plain-language banner
// so it's never ambiguous what's actually live.
app.get('/api/status', (req, res) => {
  res.json({ ...engine.statusSummary(), llm: llmAdvocate.config() });
});

// ---------- watchlist CRUD ----------

app.get('/api/watchlist', requireUser, async (req, res) => {
  const quotes = await annotatedWatchlist(req.user);
  const insights = changeEngine.sectorInsights(quotes);
  quotes.sort((a, b) => b.attentionScore - a.attentionScore);
  res.json({ quotes, insights });
});

app.post('/api/watchlist', requireUser, async (req, res) => {
  try {
    const result = await db.withUserLock(req.user.code, async () => {
      const symbol = (req.body.symbol || '').toUpperCase().trim();
      const thesisText = (req.body.thesis || '').trim();
      const stance = req.body.stance;
      if (!engine.state[symbol]) return { status: 404, body: { error: 'Unknown symbol' } };
      if (!req.user.watchlist.includes(symbol)) {
        req.user.watchlist.push(symbol);
      }
      if (thesisText && ['bullish', 'bearish', 'neutral'].includes(stance)) {
        const quote = engine.getQuote(symbol);
        req.user.theses[symbol] = {
          text: thesisText,
          stance,
          addedAt: Date.now(),
          addedPrice: quote ? quote.price : null,
        };
      }
      db.saveUser(req.user);
      return { status: 200, body: { watchlist: req.user.watchlist, thesis: req.user.theses[symbol] || null } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

// Set or replace the thesis for a symbol already on the watchlist. Changing
// the text or stance is treated as a fresh call -- it resets the reference
// price and clock, since re-committing to a belief is a new belief.
app.post('/api/thesis', requireUser, async (req, res) => {
  try {
    const result = await db.withUserLock(req.user.code, async () => {
      const symbol = (req.body.symbol || '').toUpperCase().trim();
      const text = (req.body.thesis || '').trim();
      const stance = req.body.stance;
      if (!req.user.watchlist.includes(symbol)) return { status: 404, body: { error: 'Symbol is not on this watchlist' } };
      if (!['bullish', 'bearish', 'neutral'].includes(stance)) {
        return { status: 400, body: { error: 'stance must be bullish|bearish|neutral' } };
      }
      if (!text) {
        delete req.user.theses[symbol];
      } else {
        const quote = engine.getQuote(symbol);
        req.user.theses[symbol] = { text, stance, addedAt: Date.now(), addedPrice: quote ? quote.price : null };
      }
      db.saveUser(req.user);
      return { status: 200, body: { thesis: req.user.theses[symbol] || null } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

app.delete('/api/watchlist/:symbol', requireUser, async (req, res) => {
  try {
    const result = await db.withUserLock(req.user.code, async () => {
      const symbol = req.params.symbol.toUpperCase();
      req.user.watchlist = req.user.watchlist.filter(s => s !== symbol);
      delete req.user.settings[symbol];
      delete req.user.theses[symbol];
      db.saveUser(req.user);
      return { watchlist: req.user.watchlist };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/api/settings', requireUser, async (req, res) => {
  try {
    const result = await db.withUserLock(req.user.code, async () => {
      const symbol = (req.body.symbol || '').toUpperCase().trim();
      const sensitivity = req.body.sensitivity;
      if (!['low', 'normal', 'high'].includes(sensitivity)) {
        return { status: 400, body: { error: 'sensitivity must be low|normal|high' } };
      }
      req.user.settings[symbol] = { sensitivity };
      db.saveUser(req.user);
      return { status: 200, body: { settings: req.user.settings } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

// ---------- digest ("what changed since you last checked") ----------

app.get('/api/digest', requireUser, async (req, res) => {
  const quotes = await annotatedWatchlist(req.user);
  const digest = changeEngine.buildDigest(quotes, req.user.lastSnapshot, req.user.lastSeen);
  res.json(digest);
});

// Explicit acknowledgement advances the "last seen" baseline. Digest state
// only moves forward when the user actually reviews it -- an idle GET (e.g.
// a background poll or an accidental refresh) must never silently erase the
// diff the user hasn't looked at yet.
app.post('/api/digest/ack', requireUser, async (req, res) => {
  try {
    const result = await db.withUserLock(req.user.code, async () => {
      const quotes = await annotatedWatchlist(req.user);
      const snapshot = {};
      for (const q of quotes) {
        snapshot[q.symbol] = {
          price: q.price,
          attentionScore: q.attentionScore,
          thesisStatus: q.thesis ? q.thesis.status : null,
        };
      }
      req.user.lastSnapshot = snapshot;
      req.user.lastSeen = Date.now();
      db.saveUser(req.user);
      return { ok: true, lastSeen: req.user.lastSeen };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- websocket: live tick fan-out ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', quotes: engine.getAllQuotes() }));
});

engine.onTick((deltas) => {
  const payload = JSON.stringify({ type: 'tick', quotes: deltas });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Smart Watchlist server running on http://localhost:${PORT}`);
});