// Module 6 - Bionic Engine.
//
// Converts plain text into "Bionic Reading" form by emphasizing the fixation
// prefix of each word. The core requirement (spec 2.3) is that emphasis must NOT
// change glyph advance widths, so every letter keeps its exact on-screen
// coordinate. This module therefore only:
//   * tokenizes text into words (preserving whitespace),
//   * computes the fixation prefix length for each word,
//   * and produces per-word span structures to which the caller applies
//     zero-layout-change CSS classes (stroke / highlight / shadow).
//
// It never applies 'font-weight: bold' itself; the Layout Preserver (Module 7)
// remains the authority for asserting that no glyph moved. The module is pure
// and DOM-free so it can run in Node for unit tests and in the browser.
//
// Prefix strategy (matches the classic Bionic convention):
//   * length 1   -> 1                               ([[a]])
//   * length 2-3 -> 2                               ([[ab]], [[abc]])
//   * length 4   -> 2-3 depending on percent         ([[abcd]])
//   * length 5   -> 3                               ([[abcde]])
//   * length 6-7 -> 3-4
//   * length 8+  -> 4-5
// The percent slider (fixationPercent, 0..100) biases the base ratio; the
// default 50 yields the classic table above.

(function (global) {
  'use strict';

  // Split a run of text into [word, whitespace, word, whitespace, ...] tokens
  // without dropping any characters. Whitespace runs are kept verbatim so the
  // reconstructed text is byte-identical to the input.
  function tokenize(text) {
    if (typeof text !== 'string') return [];
    // Match a word (letters/digits/combining marks/internal punctuation) or a
    // span of whitespace/separators; preserve ordering and content.
    const re = /[^\s]+|\s+/g;
    const parts = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      parts.push(m[0]);
    }
    return parts;
  }

  // Base prefix length for a word (before applying the user's percent bias).
  function baseFixationLength(rawWord) {
    const word = (typeof rawWord === 'string' ? rawWord : String(rawWord));
    const len = word.length;
    if (len <= 1) return len;         // 1 -> 1
    if (len <= 3) return 2;           // 2-3 -> 2
    if (len === 4) return 2;          // 4 -> 2 (basis)
    if (len === 5) return 3;          // 5 -> 3
    if (len === 6) return 3;          // 6 -> 3
    if (len === 7) return 4;          // 7 -> 4
    return Math.min(5, Math.max(4, Math.floor(len * 0.55))); // 8+ -> 4-5
  }

  // Compute the number of leading characters to emphasize for a word, honoring
  // the user's fixationPercent (0..100). Returns a value in [1, word.length]
  // for non-empty words, 0 for an empty word.
  function computeFixationLength(word, percent) {
    if (typeof word !== 'string' || word.length === 0) return 0;
    const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 50;
    const base = baseFixationLength(word);
    // Bias toward the percent: at 0% we lean to 1 char, at 100% the full word.
    // Use a smooth interpolation around the base.
    const ratio = p / 100;
    let target;
    if (ratio <= 0.5) {
      target = 1 + (base - 1) * (ratio / 0.5);
    } else {
      target = base + (word.length - base) * ((ratio - 0.5) / 0.5);
    }
    const abs = Math.round(target);
    return Math.max(1, Math.min(word.length, abs));
  }

  // Struct describing one emphasized word: the head (fixation prefix) and the
  // tail (the remainder). Used by renderers to build the DOM span.
  function emphasizeWord(word, percent) {
    const len = computeFixationLength(word, percent);
    return {
      word,
      head: word.slice(0, len),
      tail: word.slice(len),
      headLength: len
    };
  }

  // A token counts as a "number" when it contains at least one digit. Units,
  // signs, decimal points, slashes and similar numeric punctuation are covered
  // by rendering the whole whitespace-delimited token, which is exactly what the
  // caller does for fully-emphasized segments.
  function isNumberLike(word) {
    return typeof word === 'string' && /\d/.test(word);
  }

  // A token counts as "all-caps" when it has two or more letters and none of them
  // are lowercase. Single uppercase letters (e.g. the unit "T" in "23.4 T") are
  // left to the normal fixation-prefix path so we don't over-emphasize.
  function isAllCaps(word) {
    if (typeof word !== 'string') return false;
    const letters = word.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) return false;
    return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  }

  // High-level: turn a text run into an ordered list of segments, each either
  // a whitespace segment (keep verbatim) or an emphasized word segment.
  //   -> [{ type: 'space', text }, { type: 'word', text, head, tail, headLength }]
  function analyze(text, percent) {
    return tokenize(text).map((part) => {
      if (/^\s+$/.test(part)) {
        return { type: 'space', text: part };
      }
      const e = emphasizeWord(part, percent);
      // Numbers and all-caps words are emphasized in full (every glyph stroked),
      // rather than only the fixation prefix of a normal word.
      const full = isNumberLike(part) || isAllCaps(part);
      return { type: 'word', ...e, full };
    });
  }

  const BR = global.BR || (global.BR = {});
  BR.Bionic = Object.freeze({
    tokenize,
    computeFixationLength,
    baseFixationLength,
    emphasizeWord,
    isNumberLike,
    isAllCaps,
    analyze
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      tokenize,
      computeFixationLength,
      baseFixationLength,
      emphasizeWord,
      isNumberLike,
      isAllCaps,
      analyze
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
