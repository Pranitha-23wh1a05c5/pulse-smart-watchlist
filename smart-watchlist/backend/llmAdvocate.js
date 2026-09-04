// llmAdvocate.js
//
// Generates the devil's-advocate counter-argument via a real LLM call
// instead of (or on top of) the fixed keyword-template system in
// changeEngine.js. This is opt-in-by-default-provider, not opt-in-by-effort:
// it tries Ollama automatically (no API key, runs locally, free) and falls
// back to the template system if Ollama isn't installed/running/slow, or if
// a configured provider errors out. Nothing here ever throws past its own
// boundary - a failure here always degrades to "let the caller use the
// template instead", never a crash or a hung request.
//
// Config (all optional, all via environment variables):
//   PULSE_LLM_PROVIDER   'ollama' (default) | 'anthropic' | 'none'
//   OLLAMA_HOST          default 'http://localhost:11434'
//   OLLAMA_MODEL         default 'llama3.2'
//   ANTHROPIC_API_KEY    required if PULSE_LLM_PROVIDER=anthropic
//   ANTHROPIC_MODEL      default 'claude-haiku-4-5-20251001'

const PROVIDER = (process.env.PULSE_LLM_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const TIMEOUT_MS = 12_000;         // local models can be slow on modest hardware
const CACHE_TTL_MS = 5 * 60_000;   // don't re-hit the LLM on every 25s poll for an unchanged thesis

const cache = new Map();     // key -> { text, ts }
const inFlight = new Set();  // keys currently being generated, to avoid piling up duplicate requests

function cacheKey(symbol, thesis) {
  return `${symbol}|${thesis.stance}|${thesis.text}`;
}

function pct(n) { return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`; }

const SYSTEM_PROMPT = `You are a terse, honest "devil's advocate" built into a stock watchlist app. Given a user's stated investment thesis (their stance and reasoning) plus current market metrics for that stock, write ONE short counter-argument - 2 to 4 sentences, no preamble, no bullet points, no markdown formatting, no headers - that argues AGAINST the user's stated stance. Ground it specifically in what they actually wrote and/or the numbers given; do not invent facts you weren't given. Be direct and a little uncomfortable to read, not vague or generic. Output only the counter-argument text itself, nothing else.`;

function buildUserPrompt(thesis, q) {
  return `Stock: ${q.symbol} (${q.name}, ${q.sector})
Current price: $${q.price}, recent change ${pct(q.changePct)}
Volatility-adjusted surprise (z-score vs this stock's own normal swing): ${q.zScore.toFixed(2)}
Volume vs its average: ${q.volSpike.toFixed(2)}x
Position within its ${q.rangeLabel} range: ${Math.round(q.rangePos * 100)}% (0 = at the low, 100 = at the high)
Data quality flag: ${q.dataQuality}

User's stance: ${thesis.stance}
User's stated thesis, in their own words: "${thesis.text}"

Write the counter-argument now.`;
}

async function callOllama(thesis, q) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: { temperature: 0.7 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(thesis, q) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = data && data.message && data.message.content;
    if (!text || !text.trim()) throw new Error('Ollama returned empty content');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(thesis, q) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 220,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(thesis, q) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = await res.json();
    const block = data && data.content && data.content.find(b => b.type === 'text');
    const text = block && block.text;
    if (!text || !text.trim()) throw new Error('Anthropic returned empty content');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Non-blocking: returns the LLM-generated text immediately if it's already
 * cached and fresh, or null immediately if it isn't - it NEVER makes the
 * caller wait on network/LLM latency. A null result also kicks off a
 * background generation (if one for this exact thesis isn't already in
 * flight) that populates the cache once it completes, so the *next* poll
 * or refresh picks up the upgraded answer - the page never blocks on an
 * LLM response, it just quietly upgrades from template to AI-generated a
 * few seconds later once the model has actually replied.
 */
function getCachedOrKickOff(thesis, q) {
  if (PROVIDER === 'none') return null;

  const key = cacheKey(q.symbol, thesis);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.text;

  if (!inFlight.has(key)) {
    inFlight.add(key);
    const call = PROVIDER === 'anthropic' ? callAnthropic(thesis, q) : callOllama(thesis, q);
    call
      .then(text => cache.set(key, { text, ts: Date.now() }))
      .catch(err => {
        // Deliberately quiet by default - an unreachable local Ollama is
        // the expected common case (not installed / not running), not a
        // bug to spam the logs about on every request.
        if (process.env.PULSE_LLM_DEBUG) console.warn(`[llmAdvocate] ${PROVIDER} failed: ${err.message}`);
      })
      .finally(() => inFlight.delete(key));
  }
  return null; // not ready yet - caller uses the template for this response
}

function config() {
  return { provider: PROVIDER, model: PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OLLAMA_MODEL, host: PROVIDER === 'ollama' ? OLLAMA_HOST : null };
}

module.exports = { getCachedOrKickOff, config };