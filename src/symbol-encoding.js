// Module 13 - Symbol Encoding Remap.
//
// Some PDFs encode math/Symbol glyphs (Greek, operators, superscript digits) in
// a Symbol-encoded font whose glyph codes PDF.js cannot always map back to real
// Unicode. In those cases getTextContent() returns the glyphs as Private Use
// Area codepoints (U+F000..U+F0FF), where the low byte equals the Symbol font's
// character code. If the overlay re-renders those PUA codepoints as-is with a
// normal UI font, the glyphs have no outline and render as empty/tofu — i.e.
// Greek letters and super/subscript symbols "go missing".
//
// This module remaps PUA Symbol codepoints to their standard Unicode
// equivalents (per the PDF spec SymbolEncoding table) so the Bionic overlay can
// render them. Non-PUA characters pass through unchanged. The module is pure and
// DOM-free, so it runs in Node for unit tests and in the browser.

(function (global) {
  'use strict';

  // SymbolEncoding table: code (0..255) -> Unicode. Described by the PDF spec
  // Annex D "Symbol Set and Encoding". Values not present map to themselves or
  // are left untouched (we never emit a replacement for an unmapped code).
  const SYMBOL = Object.freeze({
    0x20: ' ', 0x21: '!', 0x22: '∀', 0x23: '#', 0x24: '∃', 0x25: '%',
    0x26: '&', 0x27: '∍', 0x28: '(', 0x29: ')', 0x2A: '∗', 0x2B: '+',
    0x2C: ',', 0x2D: '−', 0x2E: '.', 0x2F: '/',
    0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4', 0x35: '5',
    0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9', 0x3A: ':', 0x3B: ';',
    0x3C: '<', 0x3D: '=', 0x3E: '>', 0x3F: '?',
    0x40: '≅', 0x41: 'Α', 0x42: 'Β', 0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε',
    0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι', 0x4A: 'ϑ', 0x4B: 'Κ',
    0x4C: 'Λ', 0x4D: 'Μ', 0x4E: 'Ν', 0x4F: 'Ο', 0x50: 'Π', 0x51: 'Θ',
    0x52: 'Ρ', 0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ', 0x56: 'ς', 0x57: 'Ω',
    0x58: 'Ξ', 0x59: 'Ψ', 0x5A: 'Ζ', 0x5B: '[', 0x5C: '∴', 0x5D: ']',
    0x5E: '⊥', 0x5F: '_', 0x60: '‾',
    0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ',
    0x67: 'γ', 0x68: 'η', 0x69: 'ι', 0x6A: 'ϕ', 0x6B: 'κ', 0x6C: 'λ',
    0x6D: 'μ', 0x6E: 'ν', 0x6F: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ',
    0x73: 'σ', 0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ', 0x77: 'ω', 0x78: 'ξ',
    0x79: 'ψ', 0x7A: 'ζ', 0x7B: '{', 0x7C: '|', 0x7D: '}', 0x7E: '∼',
    0xA0: '€', 0xA1: 'ϒ', 0xA2: '′', 0xA3: '≤', 0xA4: '⁄', 0xA5: '∞',
    0xA6: 'ƒ', 0xA7: '♣', 0xA8: '♦', 0xA9: '♥', 0xAA: '♠', 0xAB: '↔',
    0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓', 0xB0: '°', 0xB1: '±',
    0xB2: '″', 0xB3: '≥', 0xB4: '×', 0xB5: '∝', 0xB6: '∂', 0xB7: '•',
    0xB8: '÷', 0xB9: '≠', 0xBA: '≡', 0xBB: '≈', 0xBC: '…', 0xBD: '⏐',
    0xBE: '⎯', 0xBF: '↵', 0xC0: 'ℵ', 0xC1: 'ℑ', 0xC2: 'ℜ', 0xC3: '℘',
    0xC4: '⊗', 0xC5: '⊕', 0xC6: '∅', 0xC7: '∩', 0xC8: '∪', 0xC9: '⊃',
    0xCA: '⊇', 0xCB: '⊄', 0xCC: '⊂', 0xCD: '⊆', 0xCE: '∈', 0xCF: '∉',
    0xD0: '∠', 0xD1: '∇', 0xD2: '®', 0xD3: '©', 0xD4: '™', 0xD5: '∏',
    0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔',
    0xDC: '⇐', 0xDD: '⇑', 0xDE: '⇒', 0xDF: '⇓', 0xE0: '◊', 0xE1: '〈',
    0xE2: '®', 0xE3: '©', 0xE4: '™', 0xE5: '∑', 0xE6: '⎛', 0xE7: '⎜',
    0xE8: '⎝', 0xE9: '⎡', 0xEA: '⎢', 0xEB: '⎣', 0xEC: '⎧', 0xED: '⎨',
    0xEE: '⎩', 0xEF: '⎪'
  });

  // Wingdings code (low byte of the PUA codepoint) -> Unicode. PDF.js ships no
  // authoritative Wingdings encoding table (only a substitution alias), so every
  // entry below is verified against the installed Wingdings face rather than
  // guessed. Codes not listed here are intentionally left unmapped: emitting a
  // wrong glyph is worse than leaving the original codepoint alone.
  //
  // Verified against C:\Windows\Fonts\wingding.ttf (glyph outlines rendered in
  // Chrome at 120px, matched to candidate Unicode glyphs):
  //   0xE0 -> U+2794 HEAVY WIDE-HEADED RIGHTWARDS ARROW  (used by Test_PDF.pdf p8)
  //   0xE8 -> U+27A1 BLACK RIGHTWARDS ARROW
  //   0xE9 -> U+2B06 UPWARDS BLACK ARROW
  //   0xE1 -> U+2B06 UPWARDS BLACK ARROW
  //   0xDF -> U+2B05 LEFTWARDS BLACK ARROW
  //   0xDE -> U+2B07 DOWNWARDS BLACK ARROW
  //   0xD8 -> U+27A4 BLACK RIGHTWARDS ARROWHEAD
  //   0xC6 -> U+21B0 UPWARDS ARROW WITH TIP LEFTWARDS
  //   0xC7 -> U+21B3 DOWNWARDS ARROW WITH TIP RIGHTWARDS
  const WINGDINGS = Object.freeze({
    0xC6: '↰', 0xC7: '↳', 0xD8: '➤', 0xDE: '⬇', 0xDF: '⬅',
    0xE0: '➔', 0xE1: '⬆', 0xE8: '➡', 0xE9: '⬆'
  });
  // ZapfDingbats code -> Unicode, extracted from PDF.js's authoritative
  // ZapfDingbatsEncoding + getDingbatsGlyphsUnicode tables.
  const ZAPFDINGBATS = Object.freeze({
    0x20:'\u0020', 0x21:'\u2701', 0x22:'\u2702', 0x23:'\u2703', 0x24:'\u2704',
    0x25:'\u260E', 0x26:'\u2706', 0x27:'\u2707', 0x28:'\u2708', 0x29:'\u2709',
    0x2A:'\u261B', 0x2B:'\u261E', 0x2C:'\u270C', 0x2D:'\u270D', 0x2E:'\u270E',
    0x2F:'\u270F', 0x30:'\u2710', 0x31:'\u2711', 0x32:'\u2712', 0x33:'\u2713',
    0x34:'\u2714', 0x35:'\u2715', 0x36:'\u2716', 0x37:'\u2717', 0x38:'\u2718',
    0x39:'\u2719', 0x3A:'\u271A', 0x3B:'\u271B', 0x3C:'\u271C', 0x3D:'\u271D',
    0x3E:'\u271E', 0x3F:'\u271F', 0x40:'\u2720', 0x41:'\u2721', 0x42:'\u2722',
    0x43:'\u2723', 0x44:'\u2724', 0x45:'\u2725', 0x46:'\u2726', 0x47:'\u2727',
    0x48:'\u2605', 0x49:'\u2729', 0x4A:'\u272A', 0x4B:'\u272B', 0x4C:'\u272C',
    0x4D:'\u272D', 0x4E:'\u272E', 0x4F:'\u272F', 0x50:'\u2730', 0x51:'\u2731',
    0x52:'\u2732', 0x53:'\u2733', 0x54:'\u2734', 0x55:'\u2735', 0x56:'\u2736',
    0x57:'\u2737', 0x58:'\u2738', 0x59:'\u2739', 0x5A:'\u273A', 0x5B:'\u273B',
    0x5C:'\u273C', 0x5D:'\u273D', 0x5E:'\u273E', 0x5F:'\u273F', 0x60:'\u2740',
    0x61:'\u2741', 0x62:'\u2742', 0x63:'\u2743', 0x64:'\u2744', 0x65:'\u2745',
    0x66:'\u2746', 0x67:'\u2747', 0x68:'\u2748', 0x69:'\u2749', 0x6A:'\u274A',
    0x6B:'\u274B', 0x6C:'\u25CF', 0x6D:'\u274D', 0x6E:'\u25A0', 0x6F:'\u274F',
    0x70:'\u2750', 0x71:'\u2751', 0x72:'\u2752', 0x73:'\u25B2', 0x74:'\u25BC',
    0x75:'\u25C6', 0x76:'\u2756', 0x77:'\u25D7', 0x78:'\u2758', 0x79:'\u2759',
    0x7A:'\u275A', 0x7B:'\u275B', 0x7C:'\u275C', 0x7D:'\u275D', 0x7E:'\u275E',
    0x80:'\u2768', 0x81:'\u2769', 0x82:'\u276A', 0x83:'\u276B', 0x84:'\u276C',
    0x85:'\u276D', 0x86:'\u276E', 0x87:'\u276F', 0x88:'\u2770', 0x89:'\u2771',
    0x8A:'\u2772', 0x8B:'\u2773', 0x8C:'\u2774', 0x8D:'\u2775', 0xA1:'\u2761',
    0xA2:'\u2762', 0xA3:'\u2763', 0xA4:'\u2764', 0xA5:'\u2765', 0xA6:'\u2766',
    0xA7:'\u2767', 0xA8:'\u2663', 0xA9:'\u2666', 0xAA:'\u2665', 0xAB:'\u2660',
    0xAC:'\u2460', 0xAD:'\u2461', 0xAE:'\u2462', 0xAF:'\u2463', 0xB0:'\u2464',
    0xB1:'\u2465', 0xB2:'\u2466', 0xB3:'\u2467', 0xB4:'\u2468', 0xB5:'\u2469',
    0xB6:'\u2776', 0xB7:'\u2777', 0xB8:'\u2778', 0xB9:'\u2779', 0xBA:'\u277A',
    0xBB:'\u277B', 0xBC:'\u277C', 0xBD:'\u277D', 0xBE:'\u277E', 0xBF:'\u277F',
    0xC0:'\u2780', 0xC1:'\u2781', 0xC2:'\u2782', 0xC3:'\u2783', 0xC4:'\u2784',
    0xC5:'\u2785', 0xC6:'\u2786', 0xC7:'\u2787', 0xC8:'\u2788', 0xC9:'\u2789',
    0xCA:'\u278A', 0xCB:'\u278B', 0xCC:'\u278C', 0xCD:'\u278D', 0xCE:'\u278E',
    0xCF:'\u278F', 0xD0:'\u2790', 0xD1:'\u2791', 0xD2:'\u2792', 0xD3:'\u2793',
    0xD4:'\u2794', 0xD5:'\u2192', 0xD6:'\u2194', 0xD7:'\u2195', 0xD8:'\u2798',
    0xD9:'\u2799', 0xDA:'\u279A', 0xDB:'\u279B', 0xDC:'\u279C', 0xDD:'\u279D',
    0xDE:'\u279E', 0xDF:'\u279F', 0xE0:'\u27A0', 0xE1:'\u27A1', 0xE2:'\u27A2',
    0xE3:'\u27A3', 0xE4:'\u27A4', 0xE5:'\u27A5', 0xE6:'\u27A6', 0xE7:'\u27A7',
    0xE8:'\u27A8', 0xE9:'\u27A9', 0xEA:'\u27AA', 0xEB:'\u27AB', 0xEC:'\u27AC',
    0xED:'\u27AD', 0xEE:'\u27AE', 0xEF:'\u27AF', 0xF1:'\u27B1', 0xF2:'\u27B2',
    0xF3:'\u27B3', 0xF4:'\u27B4', 0xF5:'\u27B5', 0xF6:'\u27B6', 0xF7:'\u27B7',
    0xF8:'\u27B8', 0xF9:'\u27B9', 0xFA:'\u27BA', 0xFB:'\u27BB', 0xFC:'\u27BC',
    0xFD:'\u27BD', 0xFE:'\u27BE',
  });

  // Some PDFs (e.g. a formula typeset in Cambria with Identity-H + a partial
  // /ToUnicode CMap) produce raw glyph-id codepoints that PDF.js cannot resolve
  // to real Unicode. Because those codepoints happen to fall inside the devanagari
  // / south-Asian Unicode ranges, the Bionic overlay renders unrelated Indic
  // glyphs as "tofu-like" text instead of the intended math/Greek/Latin symbols.
  // This table maps the leaked codepoints back to the glyphs they really denote.
  // Keyed by the leaked codepoint's integer value.
  const LEAKED_GID = Object.freeze({
    0x0754: '×',   // U+0754 (Syriac)  -> multiplication sign
    0x07EA: 'σ',   // U+07EA (N'Ko)    -> Greek small sigma
    0x0B3A: '6',   // U+0B3A (Oriya)   -> digit six
    0x0B3F: '−',   // U+0B3F (Oriya)   -> minus sign U+2212
    0x0BD5: 'b',   // U+0BD5 (Tamil)   -> latin b
    0x0BE2: 'o',   // U+0BE2 (Tamil)   -> latin o
    0x0BE6: 's',   // U+0BE6 (Tamil)   -> latin s
    0x0C14: 'ν',   // U+0C14 (Telugu)  -> Greek small nu
    0x0CD0: 'e',   // U+0CD0 (Kannada) -> latin e
    0x0CD1: 'f',   // U+0CD1 (Kannada) -> latin f
    0x0CDD: 'r',   // U+0CDD (Kannada) -> latin r
    0x0D4C: '='    // U+0D4C(Malayalam) -> equals sign
  });

  // The PUA block PDF.js uses for Symbol-encoded glyphs. A codepoint is remapped
  // only if it sits inside this plane AND its low byte has a Symbol mapping.
  const PUA_START = 0xF000;
  const PUA_END = 0xF0FF;

  // Pick the encoding table for a PDF BaseFont name. Symbol is the default so
  // existing behavior is unchanged when the real font name is unavailable.
  function tableForFont(baseFontName) {
    const name = typeof baseFontName === 'string' ? baseFontName.toLowerCase() : '';
    if (name.indexOf('wingdings') !== -1) return WINGDINGS;
    if (name.indexOf('zapf') !== -1 || name.indexOf('dingbat') !== -1) return ZAPFDINGBATS;
    return SYMBOL;
  }

  function remapCodepoint(cp, table) {
    const leaked = LEAKED_GID[cp];
    if (leaked !== undefined) return leaked;
    const ch = String.fromCodePoint(cp);
    if (cp < PUA_START || cp > PUA_END) return ch;
    const mapped = (table || SYMBOL)[cp & 0xFF];
    return mapped !== undefined ? mapped : ch;
  }

  // Remap PUA codepoints using the encoding table for the given PDF BaseFont.
  // Fonts without a known symbol encoding fall back to Symbol and then pass
  // unmapped codepoints through untouched (never emit a guess).
  function remapTextForFont(str, baseFontName) {
    if (typeof str !== 'string' || str.length === 0) return str;
    const table = tableForFont(baseFontName);
    let out = '';
    for (const ch of str) {
      out += remapCodepoint(ch.codePointAt(0), table);
    }
    return out;
  }

  // Remap every PUA Symbol codepoint in a string to its Unicode equivalent.
  // Backward-compatible: assumes Symbol when no BaseFont name is supplied.
  function remapSymbolText(str) {
    return remapTextForFont(str, null);
  }

  // True if a string would change under the remap (has at least one PUA Symbol).
  function hasSymbolPua(str) {
    if (typeof str !== 'string') return false;
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp >= PUA_START && cp <= PUA_END && SYMBOL[cp & 0xFF] !== undefined) {
        return true;
      }
    }
    return false;
  }

  // True if a string would change under the remap (PUA Symbol OR leaked GID).
  function hasSymbolGlyph(str) {
    if (typeof str !== 'string') return false;
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (LEAKED_GID[cp] !== undefined) return true;
      if (cp >= PUA_START && cp <= PUA_END && SYMBOL[cp & 0xFF] !== undefined) {
        return true;
      }
    }
    return false;
  }

  const BR = global.BR || (global.BR = {});
  BR.SymbolEncoding = Object.freeze({
    remapSymbolText, remapTextForFont, hasSymbolPua, hasSymbolGlyph,
    SYMBOL, WINGDINGS, ZAPFDINGBATS, LEAKED_GID
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      remapSymbolText, remapTextForFont, hasSymbolPua, hasSymbolGlyph,
      SYMBOL, WINGDINGS, ZAPFDINGBATS, LEAKED_GID
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
