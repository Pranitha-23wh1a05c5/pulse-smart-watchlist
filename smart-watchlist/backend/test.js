// test.js
//
// A small, dependency-free regression suite (plain Node `assert`, no test
// framework) covering the specific pieces of logic that have real bugs
// possible in them - including two bugs actually caught and fixed during
// development (the sensitivity-direction mixup, and the "waiting" contains
// "ai" substring-matching bug in the theme detector). This is not
// exhaustive coverage of the whole app; it's the "does the reasoning-heavy
// part of this app still do what it claims" check.
//
// Run with:  node test.js

const assert = require('assert');
const changeEngine = require('./changeEngine');
const thesisThemes = require('./thesisThemes');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL  - ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

function baseQuote(overrides) {
  return {
    symbol: 'TEST', name: 'Test Corp.', sector: 'Technology', source: 'simulated',
    price: 100, sessionOpen: 100, changePct: 0, zScore: 0.3, volSpike: 1, rangePos: 0.5,
    rangeHigh: 120, rangeLow: 90, rangeLabel: "today's", recentJump: false, dataQuality: 'live',
    secondaryPrice: 100, secondaryAgeMs: 0, sparkline: [100], ts: Date.now(), ...overrides,
  };
}

console.log('thesisThemes.containsWord (word-boundary matching)');
test('"ai" matches "AI demand"', () => {
  assert.strictEqual(thesisThemes.containsWord('ai demand is strong', 'ai'), true);
});
test('"ai" does NOT match inside "waiting" (regression: this was a real bug)', () => {
  assert.strictEqual(thesisThemes.containsWord('waiting for the breakout', 'ai'), false);
});
test('"lower" does NOT match inside "slower" (regression: same bug class)', () => {
  assert.strictEqual(thesisThemes.containsWord('periods of slower growth', 'lower'), false);
});
test('multi-word phrase "data center" still matches', () => {
  assert.strictEqual(thesisThemes.containsWord('driven by data center demand', 'data center'), true);
});

console.log('\nthesisThemes theme detection');
test('AI-themed thesis gets the AI counter-argument', () => {
  const text = thesisThemes.bullishFallback('continued AI infrastructure demand');
  assert.ok(text.includes('AI/infrastructure'), 'expected AI theme text');
});
test('a thesis merely containing "waiting" does not falsely trigger the AI theme', () => {
  const text = thesisThemes.bullishFallback('Waiting for the technical breakout above resistance');
  assert.ok(!text.includes('AI/infrastructure'), 'should not have matched AI theme');
  assert.ok(text.includes('technical setup'), 'expected technical theme text instead');
});
test('same thesis text always yields the same generic fallback (stable, not random)', () => {
  const a = thesisThemes.bullishFallback('it just feels right, no strong reason');
  const b = thesisThemes.bullishFallback('it just feels right, no strong reason');
  assert.strictEqual(a, b);
});

console.log('\nsensitivity multiplier direction');
test('high sensitivity AMPLIFIES the score, low sensitivity DAMPENS it (regression: this was backwards once)', () => {
  assert.ok(changeEngine.SENSITIVITY_MULTIPLIER.high > changeEngine.SENSITIVITY_MULTIPLIER.normal);
  assert.ok(changeEngine.SENSITIVITY_MULTIPLIER.low < changeEngine.SENSITIVITY_MULTIPLIER.normal);
});

console.log('\nthesis status computation');
test('bullish thesis + price up >=3% => confirmed', () => {
  const status = changeEngine.computeThesisStatus(
    { text: 'x', stance: 'bullish', addedAt: Date.now(), addedPrice: 100 },
    baseQuote({ price: 105 })
  );
  assert.strictEqual(status.status, 'confirmed');
});
test('bullish thesis + price down >=3% => contradicted', () => {
  const status = changeEngine.computeThesisStatus(
    { text: 'x', stance: 'bullish', addedAt: Date.now(), addedPrice: 100 },
    baseQuote({ price: 95 })
  );
  assert.strictEqual(status.status, 'contradicted');
});
test('thesis untested for 14+ days with no real move => stale', () => {
  const status = changeEngine.computeThesisStatus(
    { text: 'x', stance: 'bullish', addedAt: Date.now() - 15 * 24 * 60 * 60 * 1000, addedPrice: 100 },
    baseQuote({ price: 100.5 })
  );
  assert.strictEqual(status.status, 'stale');
});

console.log('\nattention score responds to a contradicted thesis');
(async () => {
  const withoutThesis = await changeEngine.annotate(baseQuote({ zScore: 1.5, price: 95, changePct: -0.05 }), 'normal', null);
  const withContradicted = await changeEngine.annotate(
    baseQuote({ zScore: 1.5, price: 95, changePct: -0.05 }),
    'normal',
    { text: 'bullish case', stance: 'bullish', addedAt: Date.now(), addedPrice: 100 }
  );
  test('a contradicted thesis scores strictly higher than the same move with no thesis at all', () => {
    assert.ok(withContradicted.attentionScore > withoutThesis.attentionScore,
      `expected ${withContradicted.attentionScore} > ${withoutThesis.attentionScore}`);
  });

  console.log('\ndigest prioritization');
  const prevSnapshot = { TEST: { price: 100, attentionScore: 10, thesisStatus: 'pending' } };
  const digest = changeEngine.buildDigest([withContradicted], prevSnapshot, Date.now() - 3600000);
  test('a thesis-status transition is surfaced as its own prioritized digest item', () => {
    assert.strictEqual(digest.items[0].kind, 'thesis');
    assert.strictEqual(digest.items[0].priority, true);
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('Some checks FAILED - see above.');
})();
