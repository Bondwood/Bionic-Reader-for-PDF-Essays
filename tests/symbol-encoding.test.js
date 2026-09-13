// Tests for Module 13 (Symbol Encoding Remap).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  remapSymbolText,
  remapTextForFont,
  hasSymbolPua,
  hasSymbolGlyph
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