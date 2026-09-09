// Tests for the fixation-prefix policy (spec 2.3 / Module 6 prefix table).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const { computeFixationLength, baseFixationLength } = require('../src/bionic-engine.js');

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
