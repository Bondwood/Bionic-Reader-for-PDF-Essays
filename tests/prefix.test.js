// Tests for the fixation-prefix policy (spec 2.3 / Module 6 prefix table).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const { computeFixationLength, baseFixationLength, isNumberLike, isAllCaps, analyze } = require('../src/bionic-engine.js');

// The classic Bionic convention yields these exact prefixes at the default 50%.
// (The engine interpolates around the integer base, so for short words the
// rounded result matches the table below; these assertions lock the behavior.)
test('default (50%) prefix lengths follow the Bionic convention', () => {
  const expect = {
    a: 1,
    ab: 2,
    abc: 2,
    abcd: 2,
    abcde: 3,
    abcdef: 3,
    abcdefg: 4
  };
  for (const [word, len] of Object.entries(expect)) {
    assert.strictEqual(computeFixationLength(word, 50), len, `word=${word}`);
  }
});

test('prefix length monotonically respects percent extremes', () => {
  // At 100% the entire word is emphasized.
  assert.strictEqual(computeFixationLength('reading', 100), 'reading'.length);
  // At the low end we still never return 0 for a non-empty word.
  assert.strictEqual(computeFixationLength('reading', 0), 1);
});

test('computeFixationLength never exceeds word length and ignores invalid input', () => {
  assert.strictEqual(computeFixationLength('', 50), 0);
  assert.strictEqual(computeFixationLength(null, 50), 0);
  assert.strictEqual(computeFixationLength(undefined, 50), 0);
  assert.strictEqual(computeFixationLength('word', Number.NaN), computeFixationLength('word', 50));
});

test('baseFixationLength bounds output for very long words', () => {
  for (let n = 1; n <= 40; n++) {
    const len = baseFixationLength('x'.repeat(n));
    assert.ok(len >= 1 && len <= n);
  }
});

test('isNumberLike marks numeric tokens and rejects words without digits', () => {
  assert.strictEqual(isNumberLike('123'), true);
  assert.strictEqual(isNumberLike('23.4'), true);
  assert.strictEqual(isNumberLike('-1/2'), true);
  assert.strictEqual(isNumberLike('10^6'), true);
  assert.strictEqual(isNumberLike('hello'), false);
  assert.strictEqual(isNumberLike('ABC'), false);
  assert.strictEqual(isNumberLike(''), false);
});

test('isAllCaps marks two-or-more-letter uppercase tokens only', () => {
  assert.strictEqual(isAllCaps('NMR'), true);
  assert.strictEqual(isAllCaps('TROSY'), true);
  assert.strictEqual(isAllCaps('UP'), true);
  assert.strictEqual(isAllCaps('T'), false);
  assert.strictEqual(isAllCaps('Nmr'), false);
  assert.strictEqual(isAllCaps('24.4'), false);
  assert.strictEqual(isAllCaps('a'), false);
});

test('analyze sets full=true for numbers and all-caps words only', () => {
  const segs = analyze('NMR 23.4 T normal', 50);
  const byWord = segs.filter((sg) => sg.type === 'word');
  const flags = Object.fromEntries(byWord.map((w) => [w.word, w.full]));
  assert.deepStrictEqual(flags, {
    NMR: true,
    '23.4': true,
    T: false,
    normal: false
  });
  for (const w of byWord) {
    assert.strictEqual(w.head + w.tail, w.word);
  }
});
