# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

## [1.0.1] - 2026-09-13

### Added
- Numbers and all-caps words are now emphasized in full (every glyph stroked),
  while regular words keep the bionic fixation prefix.

### Changed

### Fixed

- Symbol-encoded glyphs (Greek letters, math operators, superscript/subscript
  digits) that PDF.js extracts as Private-Use-Area codepoints are now remapped to
  their real Unicode equivalents, so they no longer render as missing/tofu boxes.
- PDFs whose math fonts use Identity-H with an incomplete /ToUnicode CMap
  (e.g. Cambria) leak raw glyph-id codepoints into Indic/Syriac Unicode ranges;
  formulas such as "σobs = (ν − νref)/νref × 10^6" were rendered as unrelated
  Indic glyphs. These leaked codepoints are now remapped to their true glyphs.
- Text overlay now honors the PDF's per-font `ascent`/`descent` metrics (from
  the text-content styles table) instead of a hard-coded 0.8 ascent, fixing
  misplaced superscripts and subscripts.
- Superscripts and subscripts are now horizontally re-scaled to match the
  embedded font's advance width. The overlay uses a substituted system font whose
  glyph advances differ from the PDF's, so separate smaller superscript/subscript
  spans were rendered with over-/under-spacing. Each span is now scaled so its
  rendered width equals `item.width` (converted from user-space points to screen
  pixels), mirroring PDF.js's own text-layer correction.
- Text overlay now uses the PDF's actual font family with a Unicode-complete
  fallback stack instead of forcing Helvetica/Arial, so Greek, math, and symbol
  glyphs render correctly.
- Wingdings and ZapfDingbats text is now decoded with the correct font-specific
  table instead of always assuming Symbol. The same PUA codepoint means different
  glyphs per font (U+F0E0 is a lozenge in Symbol but a heavy rightwards arrow in
  Wingdings), so page 8's "small molecules → rapid tumbling → ..." arrows now
  render as arrows instead of lozenges. The real `/BaseFont` name is resolved
  from the page before cleanup and passed to the text layer.
- Fix vector-art displacement on pages that mix text and paths. The paint canvas
  previously skipped text by filtering out the showText operators, which left
  PDF.js's canvas text-object transform unbalanced; a later transform-free
  `constructPath` (page 10's large solid arrow) was then drawn under the stale
  CTM and landed on the wrong part of the page. The full operator stream is now
  rendered with only the terminal fillText/strokeText calls suppressed, so vector
  artwork stays in place.
- The Geometry Guard no longer reports spurious "detected N drifts, corrected 0"
  warnings. It was comparing the glyph baseline against the span's top edge and
  the embedded font's advance width against the substituted font's rendered
  width, producing a false drift on nearly every span. It now compares position
  like-for-like (left vs left, top vs top) and ignores the expected advance-width
  difference, compensating only genuine position displacement.

## [1.0.0] - 2026-09-09

Initial stable release of **Bionic Reader for PDF**.

### Added
- Self-hosted Manifest V3 Chrome extension built around a bundled PDF.js viewer.
- Bionic Reading emphasis with stroke, highlight, and shadow styles.
- Fixation-prefix (percent) and strength controls, persisted to `chrome.storage.sync`.
- Page navigation, zoom, progress, and error UI in the viewer.
- PDF routing for page navigation, links, and `<embed>`/`<object>`/`<iframe>`
  sources via a dynamic `declarativeNetRequest` rule plus content-script fallback.
- Popup quick-toggle and full Options page.
- Defense-in-depth URL validation (`src/security.js`).
- Geometry Guard that compensates measured glyph drift only when needed.
- Unit tests for the engine, layout, tokenizer, and security modules.

### Fixed
- Text placement now uses the full affine PDF viewport transform, so overlay text
  renders on-page at the correct coordinates instead of off-screen.
- Original PDF text is no longer drawn on the paint canvas, eliminating the
  doubled/overlapped appearance between the source text and the Bionic overlay
  while preserving images and vector graphics.
