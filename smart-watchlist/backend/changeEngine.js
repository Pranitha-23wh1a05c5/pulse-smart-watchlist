// changeEngine.js
//
// This is the "smart" layer, and it works in two dimensions, not one:
//
//   STATISTICAL: is this move unusual for this specific stock? (the
//   Attention Score - surprise, volume, positioning.)
//
//   PERSONAL: does this move agree or disagree with what the user
//   themselves said they believed about this stock? (the Thesis layer.)
//
// A "meaningful change" in this app isn't just a big number on a screen —
// it's most meaningful when a real statistical move ALSO contradicts a
// belief the user committed to. That's the actual product bet: most
// watchlists monitor the market and assume you'll interpret it well. This
// one also tracks whether YOU are still right, and argues against your own
// bias on purpose (the "devil's advocate" counter-argument) instead of
// just reflecting your view back at you.
//
// This file still does the ordinary jobs too:
//   1. Attention Score (0-100): surprise + volume + positioning.
//   2. Plain-English explanation of why a symbol scored the way it did.
//   3. A "since you last checked" digest, prioritizing belief-invalidation
//      moments above ordinary price moves.
//   4. Sector-level drift detection.

// "High sensitivity" = alert me on smaller moves (amplify score).
// "Low sensitivity" = only bother me for big moves (dampen score).
const SENSITIVITY_MULTIPLIER = { low: 0.6, normal: 1.0, high: 1.5 };

const llmAdvocate = require('./llmAdvocate');
const thesisThemes = require('./thesisThemes');

// A thesis is considered confirmed/contradicted once the stock has moved
// this much in the relevant direction since the thesis was recorded.
const THESIS_CONFIRM_THRESHOLD = 0.03; // 3%
// A thesis that's neither confirmed nor contradicted after this long is
// "stale" - not wrong, just never actually tested by a real move. Worth a
// nudge to revisit rather than letting it sit forever.
const THESIS_STALE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function attentionScore(q) {
  // zScore: how unusual is this move relative to the symbol's *own* normal
  // volatility (a 1% move in KO is louder than a 1% move in TSLA).
  const zComponent = Math.min(q.zScore, 4) * 15;         // up to 60
  const volComponent = Math.min(q.volSpike, 4) * 7.5;    // up to 30
  const rangeComponent = (q.rangePos > 0.92 || q.rangePos < 0.08) ? 10 : 0; // near session extremes
  const jumpBonus = q.recentJump ? 8 : 0;
  const raw = zComponent + volComponent + rangeComponent + jumpBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function classify(score) {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'notable';
  if (score >= 20) return 'minor';
  return 'quiet';
}

function pct(n) { return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`; }

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

function explain(q, score) {
  const parts = [];
  const dir = q.changePct >= 0 ? 'up' : 'down';
  parts.push(`${q.symbol} is ${dir} ${pct(q.changePct)}`);

  if (q.zScore >= 2.5) parts.push(`a move about ${q.zScore.toFixed(1)}x this stock's normal volatility`);
  else if (q.zScore >= 1.3) parts.push(`somewhat larger than its usual swing`);

  if (q.volSpike >= 2) parts.push(`on ${q.volSpike.toFixed(1)}x average volume`);

  // "52-week" reads naturally as "its 52-week range"; "today's" reads
  // naturally as "today's range" (not "its today's range").
  const rangePhrase = q.rangeLabel === "today's" ? "today's range" : `its ${q.rangeLabel || 'tracked'} range`;
  if (q.rangePos > 0.92) parts.push(`trading near the top of ${rangePhrase}`);
  else if (q.rangePos < 0.08) parts.push(`trading near the bottom of ${rangePhrase}`);

  if (q.recentJump) parts.push(`following a sudden move in the last few ticks`);

  if (q.dataQuality === 'conflicting') parts.push(`(two data points from the feed disagree — treat with caution)`);
  else if (q.dataQuality === 'delayed') parts.push(`(quote is running behind — treat as stale)`);
  else if (q.dataQuality === 'closed') parts.push(`(market is currently closed, so this won't move)`);

  if (q.source === 'simulated') parts.push(`— simulated data, not a real quote`);

  if (parts.length === 1) return `${parts[0]}, in line with normal day-to-day noise.`;
  return parts.join(', ') + '.';
}

function humanizeElapsed(ms) {
  const s = ms / 1000;
  if (s < 60) return 'moments ago';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} minute${Math.round(m) === 1 ? '' : 's'} ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = h / 24;
  return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago`;
}

/**
 * Turn a raw stored thesis ({ text, stance, addedAt, addedPrice }) plus the
 * current quote into a status: has reality confirmed it, contradicted it,
 * left it untested (pending), or let it go stale without ever being tested?
 */
function computeThesisStatus(thesis, q) {
  if (!thesis || !thesis.text) return null;
  const pctMove = thesis.addedPrice ? (q.price - thesis.addedPrice) / thesis.addedPrice : 0;
  const ageMs = Date.now() - (thesis.addedAt || Date.now());

  let status = 'pending';
  if (thesis.stance === 'bullish') {
    if (pctMove >= THESIS_CONFIRM_THRESHOLD) status = 'confirmed';
    else if (pctMove <= -THESIS_CONFIRM_THRESHOLD) status = 'contradicted';
  } else if (thesis.stance === 'bearish') {
    if (pctMove <= -THESIS_CONFIRM_THRESHOLD) status = 'confirmed';
    else if (pctMove >= THESIS_CONFIRM_THRESHOLD) status = 'contradicted';
  }
  // neutral stance: there's no direction to confirm/contradict against,
  // it's purely an observation post, so it just ages toward "stale".

  if (status === 'pending' && ageMs > THESIS_STALE_MS) status = 'stale';

  return {
    text: thesis.text,
    stance: thesis.stance,
    status,
    pctMove,
    ageMs,
    addedAt: thesis.addedAt,
  };
}

/**
 * Template-based devil's advocate (see llmAdvocate.js for the LLM-backed
 * version this is the fallback for). Deliberately NOT sentiment analysis -
 * a small set of templates chosen from the same real metrics driving the
 * attention score, plus a keyword scan of the thesis text, always arguing
 * the OPPOSITE side of the user's stated stance. This exists as a fast,
 * free, fully-deterministic fallback: every sentence traces back to a
 * specific number or word the user actually wrote, which matters more here
 * than in an ordinary explanation - an argument built on data that turns
 * out to be wrong or stale is actively misleading, not just unhelpful,
 * which is also why this only runs on quotes whose dataQuality isn't
 * already flagged as conflicting.
 */
function counterArgumentTemplate(thesis, q) {
  if (!thesis || !thesis.text) return null;
  if (q.dataQuality === 'conflicting') {
    return `Sitting this one out — the underlying data is flagged as conflicting right now, and arguing from a number that might be wrong would be worse than not arguing at all.`;
  }

  if (thesis.stance === 'bullish') {
    if (q.rangePos > 0.9) {
      return `You're bullish, and it's trading near the top of ${q.rangeLabel === "today's" ? "today's" : 'its 52-week'} range — that's also exactly where reversals tend to start. Being near a high isn't the same as having room left to run.`;
    }
    if (q.changePct < -0.02) {
      return `The case was bullish, but it's down ${pct(q.changePct)} right now. Worth a gut check: are you still holding the thesis, or just holding the position and hoping it comes back?`;
    }
    if (q.zScore < 0.5) {
      return `Nothing unusual is happening here either way. A quiet stock doesn't confirm a bullish thesis — it just means it hasn't been tested by a real move yet.`;
    }
    return thesisThemes.bullishFallback(thesis.text);
  }

  if (thesis.stance === 'bearish') {
    if (q.rangePos < 0.1) {
      return `You're bearish, and it's already trading near the bottom of ${q.rangeLabel === "today's" ? "today's" : 'its 52-week'} range — a lot of the downside you expected may already be priced in.`;
    }
    if (q.changePct > 0.02) {
      return `The case was bearish, but it's up ${pct(q.changePct)} right now. Bearish views are easy to keep believing precisely because bad news feels more available in memory than good news.`;
    }
    if (q.zScore < 0.5) {
      return `Quiet trading doesn't confirm a bearish thesis — it just means the catalyst you're waiting for hasn't shown up yet. Absence of good news isn't the same as bad news.`;
    }
    return thesisThemes.bearishFallback(thesis.text);
  }

  // neutral / just-watching stance
  const lean = thesisThemes.detectDirectionalLean(thesis.text);
  if (lean) {
    return `You picked "Just watching," but your own notes read pretty ${lean} — if that's really your call, switching the stance to ${lean === 'bullish' ? 'Bullish' : 'Bearish'} is what lets Pulse actually check it against reality later (and argue the other side properly, instead of sitting neutral on something you clearly have a view on).`;
  }
  return `You haven't taken a side on this one — worth noticing whether that's a considered call, or just a decision you haven't made yet.`;
}

function thesisTransitionHeadline(q) {
  const t = q.thesis;
  const verbBy = {
    confirmed: 'just got confirmed',
    contradicted: 'just got contradicted',
    stale: 'has gone two weeks without a real test',
  }[t.status] || 'updated';
  const quoted = t.text ? ` ("${truncate(t.text, 70)}")` : '';
  const tail = q.counterArgument ? ` ${q.counterArgument}` : '';
  return `Your ${t.stance} thesis on ${q.symbol} ${verbBy}${quoted} — ${pct(t.pctMove)} since you called it.${tail}`;
}

/**
 * The actual devil's advocate entry point: try the LLM first (see
 * llmAdvocate.js - Ollama by default, Anthropic if configured), and fall
 * back to the deterministic template system if the LLM is disabled,
 * unreachable, too slow, or errors. Returns { text, source } so the caller
 * (and eventually the UI) can be honest about which one actually produced
 * a given sentence, the same way the app is already honest about
 * real-vs-simulated market data.
 */
async function buildCounterArgument(thesis, q) {
  if (q.dataQuality === 'conflicting') {
    return {
      text: `Sitting this one out — the underlying data is flagged as conflicting right now, and arguing from a number that might be wrong would be worse than not arguing at all.`,
      source: 'template',
    };
  }
  const llmText = await llmAdvocate.generateCounterArgument(thesis, q);
  if (llmText) return { text: llmText, source: 'llm' };
  return { text: counterArgumentTemplate(thesis, q), source: 'template' };
}

/**
 * Build the annotated view of a single quote (score + label + explanation),
 * respecting the user's per-symbol sensitivity setting and, if present,
 * their stated thesis for this symbol. Async because generating a thesis's
 * counter-argument may involve an LLM call; quotes with no thesis resolve
 * immediately with no network I/O at all.
 */
async function annotate(q, sensitivity = 'normal', rawThesis = null) {
  const mult = SENSITIVITY_MULTIPLIER[sensitivity] || 1;
  let score = attentionScore(q);

  const thesis = computeThesisStatus(rawThesis, q);
  // A contradicted belief is worth more attention than an equivalent price
  // move with no belief attached to it - this is the personal layer
  // actually changing what counts as "meaningful", not just decorating it.
  if (thesis && thesis.status === 'contradicted') score += 15;
  else if (thesis && thesis.status === 'stale') score += 5;

  const adjusted = Math.min(100, Math.round(score * mult));
  const label = classify(adjusted);
  const built = thesis ? await buildCounterArgument(rawThesis, q) : null;

  return {
    ...q,
    attentionScore: adjusted,
    attentionLabel: label,
    explanation: explain(q, adjusted),
    meaningful: adjusted >= 40 || (thesis && thesis.status === 'contradicted'),
    thesis,
    counterArgument: built ? built.text : null,
    counterArgumentSource: built ? built.source : null,
  };
}

/**
 * Compare current annotated quotes against the snapshot taken the last time
 * the user acknowledged their digest, and produce a short, sorted list of
 * what actually deserves attention now. Thesis status changes ("your belief
 * was just proven wrong") are surfaced ahead of ordinary price moves,
 * because that's a categorically bigger deal than a number moving.
 */
function buildDigest(annotatedQuotes, lastSnapshot, lastSeenTs) {
  const now = Date.now();
  const items = [];

  for (const q of annotatedQuotes) {
    const prev = lastSnapshot ? lastSnapshot[q.symbol] : null;

    if (q.thesis && prev && prev.thesisStatus && q.thesis.status !== prev.thesisStatus) {
      items.push({
        symbol: q.symbol,
        kind: 'thesis',
        priority: true,
        attentionScore: q.attentionScore,
        thesisStatus: q.thesis.status,
        headline: thesisTransitionHeadline(q),
      });
    }

    if (!prev) {
      items.push({
        symbol: q.symbol,
        kind: 'new',
        attentionScore: q.attentionScore,
        headline: `${q.symbol} added — currently ${pct(q.changePct)} at $${q.price}.`,
      });
      continue;
    }
    const deltaSincePrev = (q.price - prev.price) / prev.price;
    const scoreDelta = q.attentionScore - prev.attentionScore;
    // Surface it if it's meaningful *now*, or it moved meaningfully since
    // the snapshot was taken (covers a symbol that spiked then calmed down
    // in between checks -- still worth knowing about).
    if (q.meaningful || Math.abs(deltaSincePrev) >= 0.01 || scoreDelta >= 20) {
      items.push({
        symbol: q.symbol,
        kind: 'change',
        attentionScore: q.attentionScore,
        attentionLabel: q.attentionLabel,
        priceThen: prev.price,
        priceNow: q.price,
        deltaSincePrev,
        headline: `${q.symbol}: ${pct(deltaSincePrev)} since you last checked ($${prev.price} → $${q.price}). ${q.explanation}`,
      });
    }
  }

  items.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || b.attentionScore - a.attentionScore);

  return {
    generatedAt: now,
    lastSeen: lastSeenTs,
    elapsed: lastSeenTs ? humanizeElapsed(now - lastSeenTs) : null,
    isFirstVisit: !lastSeenTs,
    items,
  };
}

/**
 * Detect sector-wide drift: if several watchlist symbols in the same sector
 * are all moving the same direction beyond a small threshold, that's a
 * different, higher-level story than "3 unrelated stocks moved".
 */
function sectorInsights(annotatedQuotes) {
  const bySector = {};
  for (const q of annotatedQuotes) {
    (bySector[q.sector] = bySector[q.sector] || []).push(q);
  }
  const insights = [];
  for (const [sector, list] of Object.entries(bySector)) {
    if (list.length < 2) continue;
    const movers = list.filter(q => Math.abs(q.changePct) >= 0.008);
    const up = movers.filter(q => q.changePct > 0).length;
    const down = movers.filter(q => q.changePct < 0).length;
    if (movers.length >= Math.max(2, Math.ceil(list.length * 0.6))) {
      const direction = up > down ? 'up' : 'down';
      const avg = movers.reduce((a, q) => a + q.changePct, 0) / movers.length;
      insights.push({
        sector,
        direction,
        count: movers.length,
        of: list.length,
        avgChangePct: avg,
        headline: `${sector} is broadly ${direction} today (${movers.length}/${list.length} of your ${sector} names), averaging ${pct(avg)}.`,
      });
    }
  }
  return insights;
}

module.exports = { annotate, buildDigest, sectorInsights, humanizeElapsed, SENSITIVITY_MULTIPLIER, computeThesisStatus, counterArgumentTemplate, buildCounterArgument };
