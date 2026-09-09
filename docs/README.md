# Bionic Reader — Implementation Overview

> Status: fully implemented (all spec modules are scaffolded and wired). The
> final Chrome extension is assembled; see [the project README](../README.md)
> for how to load it.

This project is built from the modules defined in
[`BIONIC_READER_SPEC.md`](../BIONIC_READER_SPEC.md). Each module lives in a
single, well-scoped file so it can be unit-tested independently.

## Module index

| # | Module | File(s) | State |
|---|--------|---------|-------|
| 1 | Extension Shell / Manifest | `manifest.json`, `icons/` | ✅ |
| 2 | Background Service Worker | `background.js` | ✅ |
| 3 | PDF Router | `src/pdf-router.js`, `rules/rules.json` | ✅ |
| 4 | Self-Hosted PDF Viewer | `pages/viewer.html`, `src/viewer.js`, `src/viewer.css` | ✅ |
| 5 | PDF.js Rendering Engine | `src/pdf_renderer.js`, `vendor/pdfjs/` | ✅ |
| 6 | Bionic Engine | `src/bionic-engine.js` | ✅ |
| 7 | Layout Preserver (Geometry Guard) | `src/layout-preserver.js` | ✅ |
| 8 | Media Preserver | `src/media-preserver.js` | ✅ |
| 11 | Shared message protocol | `src/messages.js` | ✅ |
| 12 | Security / URL validation | `src/security.js` | ✅ |

## Additional UI

- **Popup** — `pages/popup.html` / `pages/popup.js` / `pages/popup.css`
  (enable toggle, "Open PDF in Viewer", link to options).
- **Options page** — `pages/options.html` / `pages/options.js` / `pages/options.css`
  (enable, routing toggle, fixation %, strength, style, reset to defaults).

## Tests

- `tests/tokenizer.test.js` — Bionic tokenizer / prefix engine.
- `tests/prefix.test.js` — fixation prefix lengths follow the classic table.
- `tests/geometry.test.js` — Layout Preserver place/measure/guard.
- `tests/security.test.js` — URL scheme validation.
- `tests/fixtures/sample.pdf` — a minimal, valid, machine-readable PDF used for
  render/integration checks.

Run with:

```powershell
node --test 'tests/**/*.test.js'
```

> The detailed module specs below describe the original design for Modules 1–4.
> Modules 5–8, 11–12, and the UI/tests are implemented directly in the files
> listed above and are described in `BIONIC_READER_SPEC.md` (sections 3.2–3.5).

- [Module 1 — Extension Shell](modules/01-extension-shell.md)
- [Module 2 — Background Service Worker](modules/02-background-service-worker.md)
- [Module 3 — PDF Router](modules/03-pdf-router.md)
- [Module 4 — Self-Hosted PDF Viewer Page](modules/04-self-hosted-pdf-viewer-page.md)
