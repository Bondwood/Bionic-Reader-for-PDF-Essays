// Tests for Module 13 (Symbol Encoding Remap).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  remapSymbolText,
  remapTextForFont,
  hasSymbolPua,
  hasSymbolGlyph,
  normalizeMinus,
  isStandaloneDashRun
} = require('../src/symbol-encoding.js');

test('remaps Symbol PUA Greek letters to real Unicode', () => {
  // F044=Delta, F045=Epsilon, F067=gamma, F070=pi (PDF Symbol encoding).
  assert.strictEqual(remapSymbolText('\uF044'), 'Δ');
  assert.strictEqual(remapSymbolText('\uF045'), 'Ε');
  assert.strictEqual(remapSymbolText('\uF067'), 'γ');
  assert.strictEqual(remapSymbolText('\uF070'), 'π');
});

test('remaps a full Symbol equation string (real NMR equation glyphs)', () => {
  // F044=Δ, F045=Ε, F020=space, F03D==, F02D=−, F067=γ, F068=η, F06F=ο, F070=π.
  const src = '\uF044\uF045\uF020\uF03D\uF020\uF067\uF068\uF06F\uF06F/2\uF070';
  const out = remapSymbolText(src);
  assert.strictEqual(out, 'ΔΕ = γηοο/2π');
});

test('remaps Symbol superscript digit + bullets', () => {
  assert.strictEqual(remapSymbolText('\uF032'), '2');
  assert.strictEqual(remapSymbolText('\uF0B7'), '•');
});

test('leaves non-PUA text unchanged', () => {
  const plain = 'Hello νγπ ²';
  assert.strictEqual(remapSymbolText(plain), plain);
  assert.strictEqual(hasSymbolPua(plain), false);
});

test('hasSymbolPua detects PUA Symbol codepoints only', () => {
  assert.strictEqual(hasSymbolPua('\uF044'), true);
  assert.strictEqual(hasSymbolPua('normal'), false);
  assert.strictEqual(hasSymbolPua(null), false);
  assert.strictEqual(hasSymbolPua(undefined), false);
});

test('handle non-string input safely', () => {
  assert.strictEqual(remapSymbolText(null), null);
  assert.strictEqual(remapSymbolText(undefined), undefined);
  assert.strictEqual(remapSymbolText(''), '');
});

test('remaps leaked Cambria glyph-id codepoints to real glyphs', () => {
  // Each leaked codepoint (an unresolved Identity-H glyph id falling in an Indic
  // Unicode range) must map to its true math/Greek/Latin glyph.
  assert.strictEqual(remapSymbolText('\u0754'), '×');
  assert.strictEqual(remapSymbolText('\u07EA'), 'σ');
  assert.strictEqual(remapSymbolText('\u0B3A'), '6');
  assert.strictEqual(remapSymbolText('\u0B3F'), '−');
  assert.strictEqual(remapSymbolText('\u0BD5'), 'b');
  assert.strictEqual(remapSymbolText('\u0BE2'), 'o');
  assert.strictEqual(remapSymbolText('\u0BE6'), 's');
  assert.strictEqual(remapSymbolText('\u0C14'), 'ν');
  assert.strictEqual(remapSymbolText('\u0CD0'), 'e');
  assert.strictEqual(remapSymbolText('\u0CD1'), 'f');
  assert.strictEqual(remapSymbolText('\u0CDD'), 'r');
  assert.strictEqual(remapSymbolText('\u0D4C'), '=');
});

test('reconstructs the page-3 NMR formula from leaked glyph ids', () => {
  // σobs = (ν − νref)/νref × 10^6 built from the raw Cambria glyph codes.
  const src = '\u07EA\u0BE2\u0BD5\u0BE6\u0D4C\u0B3F\u0C14\u0B3F\u0C14\u0CDD\u0CD0\u0CD1\u0D4C\u0C14\u0CDD\u0CD0\u0CD1\u0B3A\u0754';
  const out = remapSymbolText(src);
  assert.strictEqual(out, 'σobs=−ν−νref=νref6×');
});

test('hasSymbolGlyph detects PUA and leaked glyph ids', () => {
  assert.strictEqual(hasSymbolGlyph('\uF044'), true);
  assert.strictEqual(hasSymbolGlyph('\u07EA'), true);
  assert.strictEqual(hasSymbolGlyph('nobody'), false);
  assert.strictEqual(hasSymbolGlyph(null), false);
});

test('font-aware remap: Wingdings E0 is an arrow, not a Symbol lozenge', () => {
  // Test_PDF.pdf page 8 draws "small molecules → rapid tumbling → ..." in
  // HOKHHL+Wingdings-Regular. PDF.js reports U+F0E0 with no /ToUnicode, which
  // the Symbol table would decode as a lozenge (U+25CA). The real Wingdings
  // glyph is the heavy wide-headed rightwards arrow (U+2794).
  assert.strictEqual(remapTextForFont('\uF0E0', 'HOKHHL+Wingdings-Regular'), '➔');
  assert.strictEqual(remapTextForFont('\uF0E0', 'Wingdings'), '➔');
  assert.strictEqual(remapTextForFont('\uF0E0', 'wingdings-bold'), '➔');
  // Same codepoint under a real Symbol font must stay the lozenge.
  assert.strictEqual(remapTextForFont('\uF0E0', 'SymbolMT'), '◊');
  assert.strictEqual(remapTextForFont('\uF0E0', 'Symbol'), '◊');
});

test('font-aware remap: verified Wingdings arrow codes', () => {
  assert.strictEqual(remapTextForFont('\uF0E8', 'Wingdings-Regular'), '➡');
  assert.strictEqual(remapTextForFont('\uF0E9', 'Wingdings'), '⬆');
  assert.strictEqual(remapTextForFont('\uF0DE', 'Wingdings'), '⬇');
  assert.strictEqual(remapTextForFont('\uF0DF', 'Wingdings'), '⬅');
});

test('font-aware remap: ZapfDingbats uses its own table', () => {
  // 0xA1 -> U+2761 CURVED STEM PARAGRAPH SIGN ORNAMENT in ZapfDingbats,
  // whereas the Symbol table wouldn't have this glyph.
  assert.strictEqual(remapTextForFont('\uF0A1', 'ZapfDingbats'), '❡');
});

test('font-aware remap: unknown font falls back to Symbol behavior', () => {
  assert.strictEqual(remapTextForFont('\uF0E0', 'Arial'), '◊');
  assert.strictEqual(remapTextForFont('\uF0E0', null), '◊');
  assert.strictEqual(remapTextForFont('\uF0E0', undefined), '◊');
});

test('font-aware remap: unverified Wingdings codes are left untouched', () => {
  // We never guess: a Wingdings code with no verified mapping passes through.
  assert.strictEqual(remapTextForFont('\uF0A5', 'Wingdings'), '\uF0A5');
});

test('font-aware remap handles non-string input safely', () => {
  assert.strictEqual(remapTextForFont(null, 'Wingdings'), null);
  assert.strictEqual(remapTextForFont(undefined, 'Wingdings'), undefined);
  assert.strictEqual(remapTextForFont('', 'Wingdings'), '');
});

// ---- Minus-sign normalization (page-3 minus-mark fix) ----------------------
// Math PDFs embed inconsistent dash codepoints, and PDF.js may emit a hyphen
// (U+002D) where the visual glyph is a true minus. All variants normalize to
// U+2212 so the engine's isMathOperator sees one consistent operator glyph.

test('normalizeMinus maps every dash variant to U+2212', () => {
  const variants = [
    '\u2212', // MINUS SIGN (the canonical target)
    '\u2010', // HYPHEN
    '\u2011', // NON-BREAKING HYPHEN
    '\u2012', // FIGURE DASH
    '\u2013', // EN DASH
    '\u2014', // EM DASH
    '\u2015', // HORIZONTAL BAR
    '\uFE58', // SMALL EM DASH
    '\uFE63', // SMALL HYPHEN-MINUS
    '\uFF0D', // FULLWIDTH HYPHEN-MINUS
    '\u002D'  // ASCII HYPHEN-MINUS (what PDF.js emitted on page 3)
  ];
  for (const ch of variants) {
    assert.strictEqual(normalizeMinus(ch), '\u2212', JSON.stringify(ch));
  }
});

test('normalizeMinus leaves non-dash characters untouched', () => {
  for (const ch of ['a', 'Z', '0', '=', '+', '\u03BD', ' ']) {
    assert.strictEqual(normalizeMinus(ch), ch, JSON.stringify(ch));
  }
});

test('remapSymbolText normalizes a standalone dash run to a true minus', () => {
  assert.strictEqual(remapSymbolText('-'), '\u2212');
  assert.strictEqual(remapSymbolText(' - '), '\u2212');
  assert.strictEqual(remapSymbolText('\u2013'), '\u2212');
});

test('remapSymbolText preserves prose hyphens and dashes verbatim', () => {
  // Rewriting these would change the rendered advance and corrupt the text.
  for (const s of ['well-known', 'spin-1/2', 'non-invasive', 'FID-based',
                   'peak \u2013 trough', 'a\u2014b', 'spanning 2-23.4 Tesla']) {
    assert.strictEqual(remapSymbolText(s), s, s);
  }
});

test('isStandaloneDashRun accepts only dash-only runs', () => {
  for (const s of ['-', ' - ', '\u2013', '\u2212', '\u2014']) {
    assert.strictEqual(isStandaloneDashRun(s), true, JSON.stringify(s));
  }
  for (const s of ['well-known', '1-2', 'a-b', '', 'x', '-1', '1-']) {
    assert.strictEqual(isStandaloneDashRun(s), false, JSON.stringify(s));
  }
});

// ---- Page-3 formula glyphs (nu / minus / subscript ref) ------------------
// Test_PDF.pdf page 3 typesets its formula in a Cambria Math Identity-H font
// whose /ToUnicode CMap is partial. PDF.js therefore emits glyph ids from
// unrelated Indic blocks for the Greek nu, the minus, and the subscript
// 'ref'. The LEAKED_GID table must decode every one of those runs.

test('page-3 formula: nu and minus decode to real math glyphs', () => {
  assert.strictEqual(remapTextForFont('\u0C14 \u0B3F \u0C14', 'Symbol'), '\u03BD \u2212 \u03BD');
});

test('page-3 formula: subscript ref decodes (Kannada glyph ids)', () => {
  assert.strictEqual(remapTextForFont('\u0CC1\u0CDD\u0CD0\u0CD1', 'Symbol'), '\u200Bref');
  assert.strictEqual(remapTextForFont('\u0CDD\u0CD0\u0CD1', 'Symbol'), 'ref');
});

test('page-3 formula: alternate Telugu subscript ref glyph ids decode too', () => {
  assert.strictEqual(remapTextForFont('\u0C90\u0C91\u0C92', 'Symbol'), 'ref');
});

test('page-3 formula: sigma_obs run decodes', () => {
  assert.strictEqual(remapTextForFont('\u07EA\u0BE2\u0BD5\u0BE6 \u0D4C', 'Symbol'), '\u03C3obs =');
  assert.strictEqual(remapTextForFont('\u0BE2\u0BD5\u0BE6\u07EA', 'Symbol'), 'obs\u03C3');
});

test('page-3 formula: script-positioning artifact maps to zero-width space', () => {
  // U+0CC1 is a positioning artifact with no visible glyph; it must not leak
  // through as tofu and must not be mistaken for a dash.
  assert.strictEqual(remapTextForFont('\u0CC1', 'Symbol'), '\u200B');
});
