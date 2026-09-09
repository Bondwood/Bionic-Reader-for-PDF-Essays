# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- (planned) Next release work goes here.

### Changed

### Fixed

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
