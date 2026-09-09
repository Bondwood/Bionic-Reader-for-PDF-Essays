// Tests for Module 6 (Bionic Engine): tokenization + fixation prefix length.
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  tokenize,
  computeFixationLength,
  baseFixationLength,
  emphasizeWord,
  analyze
} = require('../src/bionic-engine.js');

test('tokenize preserves whitespace and word boundaries', () => {
  assert.deepStrictEqual(tokenize('hello world'), ['hello', ' ', 'world']);
  assert.deepStrictEqual(tokenize('  lead space'), ['  ', 'lead', ' ', 'space']);
  assert.deepStrictEqual(tokenize('a\tb'), ['a', '\t', 'b']);
  // No characters dropped: concatenation equals input.
  const input = 'Fixation of the\nword  order';
  assert.strictEqual(tokenize(input).join(''), input);
});

test('tokenize handles empty / non-string input', () => {
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize(null), []);
  assert.deepStrictEqual(tokenize(undefined), []);
});

test('computeFixationLength stays in [1, length] and grows with percent', () => {
  const words = ['a', 'ab', 'abc', 'abcd', 'abcdefgh'];
  for (const w of words) {
    for (let p = 0; p <= 100; p += 10) {
      const len = computeFixationLength(w, p);
      assert.ok(len >= 1 && len <= w.length, `${w}@${p} -> ${len}`);
      assert.strictEqual(computeFixationLength(w, p), computeFixationLength(w, p));
    }
  }
  // Longer percent never emphasizes fewer chars.
  assert.ok(computeFixationLength('popular', 80) >= computeFixationLength('popular', 20));
});

test('baseFixationLength follows the classic Bionic table', () => {
  assert.strictEqual(baseFixationLength('a'), 1);
  assert.strictEqual(baseFixationLength('ab'), 2);
  assert.strictEqual(baseFixationLength('abc'), 2);
  assert.strictEqual(baseFixationLength('abcd'), 2);
  assert.strictEqual(baseFixationLength('abcde'), 3);
  assert.strictEqual(baseFixationLength('abcdef'), 3);
  assert.strictEqual(baseFixationLength('abcdefg'), 4);
});

test('emphasizeWord splits head and tail consistently', () => {
  const e = emphasizeWord('reading', 50);
  assert.strictEqual(e.head + e.tail, 'reading');
  assert.strictEqual(e.headLength, e.head.length);
  assert.ok(e.headLength >= 1 && e.headLength <= e.word.length);
});

test('analyze yields space and word segments with full reconstruction', () => {
  const text = 'Read  faster now';
  const segs = analyze(text, 50);
  const rebuilt = segs.map((s) => (s.type === 'space' ? s.text : s.word)).join('');
  assert.strictEqual(rebuilt, text);
  const words = segs.filter((s) => s.type === 'word');
  assert.strictEqual(words.length, 3);
  for (const w of words) {
    assert.strictEqual(w.head + w.tail, w.word);
  }
});
