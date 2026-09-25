# Bionic Reader for PDF

A **Chrome extension (Manifest V3)** that renders PDFs and applies *Bionic
Reading* emphasis — the first few letters of each word rendered heavier to speed
up reading — while leaving:
- every glyph at its **exact on-screen position**, and
- every raster image and vector graphic **bit-for-bit unchanged**.

It bundles its own [PDF.js](https://mozilla.github.io/pdf.js/) viewer instead of
trying to rewrite Chrome's built-in PDF viewer, giving full programmatic access
to text items, coordinates, fonts, and the paint canvas.

## Features

- Self-hosted PDF.js viewer with page navigation, jump-to-page, zoom, progress, and errors.
- Bionic emphasis with three zero-layout-change styles:
  - **Stroke** (`-webkit-text-stroke`) — the default.
  - **Highlight** (background color).
  - **Shadow** (synthetic bold via `text-shadow`, no width change).
- Fixation-prefix slider (percent of each word emphasized) and strength control.
- A mandatory **Geometry Guard** that measures each glyph span after emphasis and
  compensates (via `scaleX`) only if a measurable drift is detected — the fast
  path never touches layout for the default styles.
- Routing: page navigation, `<a href="*.pdf">`, `<embed>`/`<object>`/`<iframe>`
  pointing at a PDF all open in the Bionic viewer **in a new tab**, so the
  original page is never replaced (webNavigation/tabs listeners +
  content-script fallback).
- Popup (quick toggle + "Open PDF in Viewer") and a full Options page, persisted
  to `chrome.storage.sync`.
- Defense-in-depth URL validation (`src/security.js`): only `http(s)`/`file://`
  PDFs are ever routed or fetched; `data:`/`javascript:`/`blob:`/`chrome-*:` are
  always rejected.

## Project layout

```
Bionic Reader/
├── manifest.json
├── background.js              # Module 2 — service worker (messaging, new-tab routing)
├── src/
│   ├── viewer.js              # Module 4 — viewer page controller (ES module)
│   ├── viewer.css
│   ├── pdf_renderer.js        # Module 5 — PDF.js wrapper (ES module)
│   ├── bionic-engine.js       # Module 6 — tokenizer + prefix engine
│   ├── layout-preserver.js    # Module 7 — placement + Geometry Guard
│   ├── media-preserver.js     # Module 8 — canvas/media + z-order
│   ├── messages.js            # Module 11 — shared message protocol
│   ├── security.js            # Module 12 — URL validation
│   └── pdf-router.js          # Module 3 — content-script routing
├── pages/                     # viewer.html, options.*, popup.*
├── vendor/pdfjs/              # vendored PDF.js (pdf.mjs, worker, cmaps, fonts, wasm)
├── icons/                     # 16/32/48/128
├── rules/rules.json           # reference only — no active DNR redirect rule
├── docs/                      # module specs
└── tests/                     # unit tests + fixture
```

## Loading the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`Bionic Reader`).
4. For `file://` PDFs, grant **Allow access to file URLs** on the extension card.

## Development

```powershell
# Run the unit tests (bash/zsh):
node --test 'tests/**/*.test.js'
```

All engine/protocol/security modules are **UMD** (usable in the browser as
`window.BR.*` and in Node for tests); `viewer.js`, `pdf_renderer.js`, and
`background.js` are native ES modules.

> See [`docs/README.md`](docs/README.md) for the module index and
> [`BIONIC_READER_SPEC.md`](BIONIC_READER_SPEC.md) for the full specification.


## Versioning & releases

Releases follow [Semantic Versioning](https://semver.org/) and are recorded in
[CHANGELOG.md](CHANGELOG.md). See [docs/VERSIONING.md](docs/VERSIONING.md) for the
step-by-step release process (version bump, changelog entry, test run, commit, and
git tag).
