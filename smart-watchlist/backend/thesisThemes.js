// thesisThemes.js
//
// The keyword-matching half of the template-based devil's advocate (see
// changeEngine.js's counterArgumentTemplate, which this supports as the
// fallback when the LLM in llmAdvocate.js is unavailable). Pulled into its
// own module on purpose: this list grew reactively, theme by theme, as
// real gaps surfaced in testing (an "AI demand" thesis, a "management
// execution" thesis, a plain "it'll keep growing" thesis, etc) - keeping it
// separate from the scoring/digest logic in changeEngine.js means it can be
// extended, tested, and reasoned about on its own, without wading through
// unrelated attention-score math to get to it.
//
// Everything here is a fixed keyword scan, never an LLM call - every
// output sentence is traceable to specific words the user actually wrote.

// Word-boundary match, not plain substring - "ai" must match "AI demand"
// but must NOT match inside "waiting", "again", "explain", etc. (a real bug
// this module was built to fix: `"waiting".includes("ai")` is true). Multi-
// word phrases (e.g. "data center") still work since \b sits at the
// phrase's start/end, not around the internal space.
function containsWord(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Narrative themes the counter-argument can recognize in the thesis TEXT
// itself (not just market metrics), so two different stated reasons for the
// same stance on a quiet trading day don't get the identical response.
const BULLISH_THEMES = [
  { keywords: ['ai', 'artificial intelligence', 'infrastructure', 'data center', 'datacenter', 'chips', 'semiconductor', 'gpu'],
    text: `You're leaning on an AI/infrastructure demand story — that's also the single most crowded narrative in the market right now. The risk usually isn't whether the demand is real, it's whether everyone telling themselves the same story has already bid the price up to reflect it.` },
  { keywords: ['earnings', 'revenue', 'guidance', 'beat', 'margins', 'profit'],
    text: `Betting on earnings and revenue to keep climbing assumes the growth stays smooth and predictable — but a stock priced for that story is also the one that gets punished hardest the moment a single quarter comes in only slightly light.` },
  { keywords: ['breakout', 'resistance', 'support', 'technical', 'momentum', 'chart', 'pattern'],
    text: `A technical setup tells you where other traders are watching, not whether the underlying business story is actually still true. Levels get broken in both directions, and a chart pattern doesn't know which way it'll resolve.` },
  { keywords: ['management', 'ceo', 'leadership', 'execution'],
    text: `Betting on management execution is really betting on a small number of people continuing to make good decisions indefinitely — a thesis that quietly stops being checkable until well after it's already wrong.` },
  { keywords: ['grow', 'growing', 'compound', 'compounding', 'multi-year', 'multiyear'],
    text: `A multi-year "it'll keep growing" thesis is hard to disprove on any single day — that's exactly what makes it comfortable to keep holding even if nearer-term evidence turns against it. Worth naming now, while you're not under pressure: what would actually need to happen in the next few months for you to reconsider, rather than waiting out the full stretch no matter what shows up along the way?` },
];

const BEARISH_THEMES = [
  { keywords: ['overvalued', 'valuation', 'overpriced', 'multiple', 'p/e', 'bubble'],
    text: `Valuation-based bearish calls can be right for years before the market agrees with them — "overvalued" isn't a timing signal, and a stock can get more overvalued for a long time before it corrects.` },
  { keywords: ['overextended', 'pullback', 'correction', 'overbought'],
    text: `"Overextended" describes what already happened, not what happens next — a stock can stay overbought for a lot longer than a single thesis stays comfortable to hold.` },
  { keywords: ['competition', 'competitor', 'market share', 'disruption'],
    text: `Competitive-threat theses are usually right eventually and wrong about the timing — the gap between "this will matter" and "this matters now" is where most bearish positions actually lose money.` },
  { keywords: ['macro', 'rates', 'fed', 'inflation', 'recession', 'economy'],
    text: `A macro-driven bearish case adds a variable you don't control at all and can't verify against this stock specifically — it can stay wrong for this one name even if you're right about the overall backdrop.` },
];

const BULLISH_GENERIC_FALLBACKS = [
  `Bullish theses feel most convincing right after a stock has already moved in your favor — which is also usually when the easy part of the move is already over.`,
  `The more convincing a growth story sounds, the more of that optimism is usually already reflected in today's price — the market tends to price in the obvious version of a story fast.`,
  `A long time horizon is often used to explain away short-term evidence that would otherwise challenge the thesis — worth naming, now, what would actually change your mind before "the long term" arrives.`,
];

const BEARISH_GENERIC_FALLBACKS = [
  `Waiting for a stock to "prove you right" by falling can quietly anchor you to a level it was never actually coming back to.`,
  `A bearish case that keeps not playing out tends to get held onto longer than it should, since admitting it was early can feel the same as admitting it was wrong.`,
  `The market can stay wrong — or just disagree with you — for far longer than a single thesis stays comfortable to keep holding.`,
];

/**
 * Match the thesis text against a theme list; if nothing matches, rotate
 * among a few generic pushbacks keyed off the text itself, so the SAME
 * thesis always gets the SAME line (stable across re-renders) but
 * DIFFERENT stated reasons land on different lines.
 */
function themedFallback(text, themes, generics) {
  const t = (text || '').toLowerCase();
  for (const theme of themes) {
    if (theme.keywords.some(k => containsWord(t, k))) return theme.text;
  }
  const idx = hashString(text || '') % generics.length;
  return generics[idx];
}

function bullishFallback(text) { return themedFallback(text, BULLISH_THEMES, BULLISH_GENERIC_FALLBACKS); }
function bearishFallback(text) { return themedFallback(text, BEARISH_THEMES, BEARISH_GENERIC_FALLBACKS); }

/**
 * Small keyword heuristic (not sentiment analysis, just a word-list scan) to
 * catch the case where someone writes a clearly directional thesis but
 * leaves the stance on "neutral" - without this, the neutral counter-
 * argument response ("you haven't taken a side") reads as if it's ignoring
 * what they just wrote, which is confusing even though the stance logic
 * itself is working correctly.
 */
function detectDirectionalLean(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const bullWords = ['bullish', 'buy', 'upside', 'growth', 'increasing', 'increase', 'outperform', 'strong', 'higher', 'breakout', 'rally', 'long-term'];
  const bearWords = ['bearish', 'sell', 'downside', 'decline', 'drop', 'weak', 'overextended', 'pullback', 'short', 'lower', 'correction', 'crash'];
  const bullHits = bullWords.filter(w => containsWord(t, w)).length;
  const bearHits = bearWords.filter(w => containsWord(t, w)).length;
  if (bullHits > bearHits && bullHits > 0) return 'bullish';
  if (bearHits > bullHits && bearHits > 0) return 'bearish';
  return null;
}

module.exports = { bullishFallback, bearishFallback, detectDirectionalLean, containsWord, hashString };
