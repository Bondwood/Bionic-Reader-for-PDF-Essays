// Tests for Module 6 (Bionic Engine): tokenization + fixation prefix length.
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  tokenize,
  computeFixationLength,
  baseFixationLength,
  emphasizeWord,
  analyze,
  isAllCaps,
  splitAcronymPlural,
  isMathOperator
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

test('isAllCaps is strict: pure acronyms only', () => {
  // Pure all-uppercase acronyms are all-caps.
  for (const w of ['FID', 'URL', 'PDF', 'ID', 'HTTP', 'TS']) {
    assert.strictEqual(isAllCaps(w), true, w);
  }
  // A plural acronym like "FIDs" is NOT all-caps in itself; its lowercase
  // plural suffix is split off by splitAcronymPlural instead.
  for (const w of ['FIDs', 'URLs', 'PDFs', 'IDs', 'ATMs', 'pdf', 'Es', 'T', 'FiDs', 'BUSes', 'boxes', 'reads', 'a', '']) {
    assert.strictEqual(isAllCaps(w), false, w);
  }
});

test('splitAcronymPlural splits all-caps acronyms with a plural suffix', () => {
  const cases = {
    'FIDs': { base: 'FID', suffix: 's' },
    'URLs': { base: 'URL', suffix: 's' },
    'PDFs': { base: 'PDF', suffix: 's' },
    'IDs': { base: 'ID', suffix: 's' },
    'ATMs': { base: 'ATM', suffix: 's' },
    'HTTPs': { base: 'HTTP', suffix: 's' },
    'BUSes': { base: 'BUS', suffix: 'es' }
  };
  for (const [word, expected] of Object.entries(cases)) {
    const r = splitAcronymPlural(word);
    assert.deepStrictEqual(r, expected, word);
    if (r) assert.strictEqual(r.base + r.suffix, word); // zero-layout invariant
  }
});

test('splitAcronymPlural rejects non-acronym-plural tokens', () => {
  for (const w of ['FID', 'FIDES', 'Es', 'Ts', 'T', 'FiDs', 'pdf', 'boxes', 'reads', 'URLsX', 'a', '']) {
    assert.strictEqual(splitAcronymPlural(w), null, w);
  }
});

test('analyze renders FIDs as stroked FID + plain s', () => {
  const segs = analyze('FIDs', 50);
  assert.strictEqual(segs.length, 1);
  const w = segs[0];
  assert.strictEqual(w.type, 'word');
  assert.strictEqual(w.word, 'FIDs');
  assert.strictEqual(w.head, 'FID');
  assert.strictEqual(w.tail, 's');
  assert.strictEqual(w.head + w.tail, w.word);
  assert.strictEqual(w.full, false);   // tail "s" must NOT be stroked
  assert.strictEqual(w.headLength, 3); // all three acronym letters stroked

  // Same split for other plural acronyms.
  for (const { word, head, tail } of [
    { word: 'URLs', head: 'URL', tail: 's' },
    { word: 'IDs', head: 'ID', tail: 's' },
    { word: 'ATMs', head: 'ATM', tail: 's' },
    { word: 'BUSes', head: 'BUS', tail: 'es' }
  ]) {
    const s2 = analyze(word, 50)[0];
    assert.strictEqual(s2.head, head, word);
    assert.strictEqual(s2.tail, tail, word);
    assert.strictEqual(s2.head + s2.tail, word, word);
    assert.strictEqual(s2.full, false, word);
  }

  // Pure acronyms keep full-stroke emphasis: the whole token is stroked
  // via full=true (head+tail still reconstructs the word exactly).
  const fid = analyze('FID', 50)[0];
  assert.strictEqual(fid.full, true);
  assert.strictEqual(fid.head + fid.tail, 'FID');
  assert.strictEqual(fid.headLength >= 1 && fid.headLength <= fid.word.length, true);
});

// ---- Math operator handling (page-3 minus-sign fix) ------------------------
// A standalone operator/delimiter run ("-", "=", "+", ...) is not a word: it
// must never receive a fixation prefix. Without this, the minus sign in
// "1 - 1/2" was treated as a word head and stroked in the wrong place.

test('isMathOperator accepts standalone math operators and delimiters', () => {
  for (const op of ['-', '\u2212', '+', '=', '\u00D7', '\u00F7', '\u2044',
                    '(', ')', '[', ']', ',', ';', ':', '?', '!']) {
    assert.strictEqual(isMathOperator(op), true, JSON.stringify(op));
  }
});

test('isMathOperator rejects words, numbers, and mixed tokens', () => {
  for (const w of ['FIDs', 'word', '10', 'x', 'a-b', '1/2', '2\u03C0', '', '   ']) {
    assert.strictEqual(isMathOperator(w), false, JSON.stringify(w));
  }
  assert.strictEqual(isMathOperator(null), false);
  assert.strictEqual(isMathOperator(undefined), false);
  assert.strictEqual(isMathOperator(42), false);
});

test('analyze renders a standalone minus as an unstroked operator', () => {
  const segs = analyze('-', 50);
  assert.strictEqual(segs.length, 1);
  const w = segs[0];
  assert.strictEqual(w.type, 'word');
  assert.strictEqual(w.word, '-');
  assert.strictEqual(w.operator, true);
  assert.strictEqual(w.head, '');          // nothing is stroked
  assert.strictEqual(w.tail, '-');
  assert.strictEqual(w.headLength, 0);
  assert.strictEqual(w.full, false);
  assert.strictEqual(w.head + w.tail, w.word); // zero-layout invariant
});

test('analyze keeps a normal hyphenated word as a word, not an operator', () => {
  const segs = analyze('well-known', 50);
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].operator, undefined);
  assert.strictEqual(segs[0].word, 'well-known');
});
