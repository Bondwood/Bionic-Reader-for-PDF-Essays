# Bionic Reader — Chrome Extension Specification

> **Title:** Bionic Reader (PDF Bionic Reading Transformer)
> **Component:** Chrome Extension (Manifest V3)
> **Scope:** Transform visible text in PDF documents into the "Bionic Reading" style, while (a) leaving all images and vector graphics visually unchanged, and (b) preserving the exact on-screen position of every letter before and after the transformation.
> **Spec version:** 1.0
> **Status:** Ready for implementation

---

## 1. Purpose of This Document

This document is the single source of truth that describes **every module** required to build the extension, the **responsibility and function of each module**, the **inputs/outputs and key function signatures**, the **dependencies between modules**, and the **acceptance criteria** against which each module will be verified. It is written so that a coding agent (Codex) can read this file and implement the modules in dependency order without further clarification.

---

## 2. Product Overview

Bionic Reading is a reading technique in which the first few letters of each word are rendered with a heavier visual emphasis, helping the eye latch onto the beginning of each word and increasing reading speed.

A PDF is not HTML: it is a page-description language with a fixed coordinate system, embedded fonts, raster images, and vector graphics. Transforming only the *text* while keeping *everything else* identical — and keeping *each glyph exactly where it was* — is the hard part of this project. This spec exists to solve that constraint head-on.

### 2.1 Core Goals

| # | Goal |
|---|------|
| G1 | Open and render real PDF files inside the extension. |
| G2 | Detect and extract machine-readable text, glyph by glyph, with exact page coordinates. |
| G3 | Convert the text into Bionic form by emphasizing the fixation prefix of each word. |
| G4 | Apply the emphasis in a way that **does not change glyph advance widths**, so every letter stays at its original coordinate. |
| G5 | Leave every raster image and vector graphic (drawn by the PDF's paint canvas) **bit-for-bit visually identical**. |
| G6 | Keep the transformed text layer stacked **above** the image canvas but visually transparent except for the glyphs, so images show through unchanged. |
| G7 | Provide user controls (enable/disable, fixation strength, emphasis style), persisted in `chrome.storage.sync`. |
| G8 | Route PDF navigation (links, address bar, embeds/`<embed>`/`<iframe>`) into the extension's own viewer. |
| G9 | Be secure: only load `http(s)` (and optionally `file://`) PDFs the user explicitly opens; never execute arbitrary remote script. |

### 2.2 Non-Goals

- No OCR (if a PDF has no machine text layer, we cannot bionicize it — we render it as-is and inform the user).
- No modification of encrypted/DRM PDFs against their permissions.
- No cloud/backend service; everything runs locally in the browser.
- No editing or re-saving of the PDF file itself — the output is purely a render-time visual overlay.

### 2.3 The Central Technical Constraint (read first)

Bionic emphasis is normally done with `font-weight: bold`. **In a PDF text layer, bold changes the advance width of glyphs**, which would slide every subsequent character to the right and break the "letters stay where they were" requirement.

Therefore the default emphasis strategy **must not affect layout metrics**. We use, in priority order:

1. **`-webkit-text-stroke`** / **`text-shadow`** (draws a heavy outline/glow around the same glyph, zero layout change — preferred).
2. **Color + background highlight** (also zero layout change).
3. **Synthetic bold via `text-shadow` multi-pass** (e.g. four 1px shadows) to imitate bold weight without changing width.
4. **`font-weight` + width compensation** only as a final fallback, gated by a **Geometry Guard** that measures `getBoundingClientRect()` before and after and adjusts `transform: scaleX()` / `letter-spacing` if — and only if — a measurable drift is detected.

The Geometry Guard (Module 7) is mandatory regardless of strategy: it measures and asserts that no glyph moved.

---

## 3. Architecture Overview

### 3.1 Why a Self-Hosted PDF.js Viewer (and not injecting into Chrome's built-in viewer)

Chrome's native PDF viewer (`mhjfbmdgcfjbbpaeojofohoefgiehjai`) runs inside an extension iframe that is sandboxed and content-script-injection-resistant. We **cannot reliably** reach into it to replace its text layer. Therefore the extension ships its own **PDF.js** viewer (`viewer.html`) as a full page, rendered from a bundled copy of `pdf.js`, which gives us full programmatic access to text items, transforms, and canvas rendering.

### 3.2 High-Level Data Flow

```
[Address bar / <a href=".pdf"> / <embed> / in-folder file]
        │
        ▼
┌───────────────────────────┐     enable/disable + settings
│ 3. PDF Router (pdf-router) │◄──────── (chrome.storage.sync)
└──────────┬────────────────┘
           │ open viewer.html?url=<encoded PDF URL>
           ▼
┌───────────────────────────┐
│ 4. Self-Hosted Viewer Page │  viewer.html / viewer.js / viewer.css
│   (loads PDF.js, fetches   │
│    the PDF bytes)          │
└──────────┬────────────────┘
           │ PDF bytes + page requests
           ▼
┌───────────────────────────┐
│ 5. PDF.js Rendering Engine │  renders:
│  (pdf_renderer.js +        │   • paint canvas  (images + vector art)  → UNTOUCHED
│   vendor/pdf.mjs)          │   • text items   (str + exact transform)  → TO LAYOUT PRESERVER
└──────┬──────────────┬──────┘
       │              │
   text items     paint canvas
       ▼              ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│ 6. Bionic Engine           │   │ 8. Media Preserver         │
│  (tokenize → prefix spans) │   │  (keeps canvas + overlay   │
└──────────┬────────────────┘   │   ordering intact)          │
           │                    └───────────────────────────┘
           ▼
┌───────────────────────────┐
│ 7. Layout Preserver        │  geometry guard: absolute position,
│  (position + no-shift)     │  width compensation if needed
└──────────┬────────────────┘
           ▼
    text layer DIV (above canvas)
```

### 3.3 Z-Order (page stack)

```
┌────────────────────────────────┐
│ 3) Text layer  (z: 2)           │  transparent background, glyphs only
│    └ spans from Layout Preserver│
│ 2) Annotation/form layer (z: 1) │  optional, pass-through
│ 1) Paint canvas (z: 0)          │  images + vector art — NEVER modified
└────────────────────────────────┘
```

### 3.4 Technology Stack

| Concern | Choice |
|---|---|
| Extension manifest | Manifest V3 |
| PDF rendering | Mozilla PDF.js (`pdf.mjs` + `pdf.worker.mjs`), vendored locally (CSP forbids remote script) |
| Background logic | MV3 service worker (non-persistent) |
| Routing | `declarativeNetRequest` static rules + content-script fallback |
| UI | Vanilla HTML/CSS/JS (options page + popup) |
| Persistence | `chrome.storage.sync` for settings |
| Layout preservation | CSS (`text-shadow`, `-webkit-text-stroke`, transforms) + runtime geometry measurement |
| Tests | Local HTML/Jest-style unit tests for pure modules + manual acceptance checklist |

### 3.5 Directory Structure

```
bionic-reader/
├── manifest.json
├── background.js
├── src/
│   ├── pdf-router.js
│   ├── viewer.js
│   ├── viewer.css
│   ├── pdf_renderer.js
│   ├── bionic-engine.js
│   ├── layout-preserver.js
│   ├── media-preserver.js
│   ├── messages.js
│   └── security.js
├── pages/
│   ├── viewer.html
│   ├── options.html
│   ├── options.js
│   ├── options.css
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── vendor/
│   └── pdfjs/            (pdf.mjs, pdf.worker.mjs, assets)
├── icons/                (16/32/48/128)
├── rules/                (declarativeNetRequest static rules)
└── tests/
    ├── tokenizer.test.js
    ├── prefix.test.js
    ├── geometry.test.js
    └── fixtures/
```

---

## 4. Module Specifications

Each module below contains: **Purpose, Files, Key Functions (signatures), Inputs, Outputs, Dependencies, and Acceptance Criteria.**

---

### Module 1 — Extension Shell / Manifest (`manifest.json`)

**Purpose**
Declare the extension's identity, permissions, entry points, and content security policy for MV3. It is the gatekeeper: everything else is unreachable unless it is correctly registered here.

**Files**
- `manifest.json`
- `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`

**Key fields & rationale**

```json
{
  "manifest_version": 3,
  "name": "Bionic Reader for PDF",
  "version": "1.0.0",
  "permissions": ["storage", "declarativeNetRequest", "declarativeNetRequestWithHostAccess"],
  "host_permissions": ["http://*/*", "https://*/*", "file:///*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "pages/popup.html" },
  "options_page": "pages/options.html",
  "web_accessible_resources": [
    { "resources": ["pages/viewer.html", "vendor/pdfjs/*"], "matches": ["<all_urls>"] }
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/security.js", "src/messages.js", "src/pdf-router.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "declarative_net_request": {
    "rule_resources": [{ "id": "pdf_rules", "enabled": true, "path": "rules/rules.json" }]
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; worker-src 'self'"
  }
}
```

- **`storage`** — persist user settings.
- **`declarativeNetRequest` + host permissions** — rewrite/redirect navigations whose destination is a PDF so they open in our viewer. `host_permissions` grants read access needed to detect `application/pdf` responses; `file://` is included but requires the user to enable "Allow access to file URLs" manually.
- **`content_scripts` run at `document_idle` in all frames** — intercept `<a href="*.pdf">` downloads/anchors and `<embed>`/`<iframe>` elements before they load in the browser maze.
- **CSP `script-src 'self'`** — no remote scripts; PDF.js must be vendored.

**Inputs**
None (static declaration). Read by Chrome at install time.

**Outputs**
A registered extension with correct entry points.

**Dependencies**
None (foundation module).

**Acceptance Criteria**
- `chrome://extensions` loads the extension without manifest errors.
- Popup, options page, and viewer page are all reachable.
- CSP blocks remote scripts; vendored `pdf.mjs` still loads (bundled as `'self'`).
- Installing the extension does not throw permission warnings beyond `file://` (which is justified in the options page).

---

### Module 2 — Background Service Worker (`background.js`)

**Purpose**
Maintain global enabled/disabled state, coordinate inter-module messaging, decide when to redirect PDF navigations, and open the Bionic viewer for a given PDF URL.

**Files**
- `background.js`

**Key functions**

```js
// Called on install/update: seed defaults and register DNR rules.
chrome.runtime.onInstalled.addListener(async (details) => { ... });

// Central message dispatcher for popup/options/content scripts.
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => { ... return true; } // async keep-alive
);

async function getSettings();                    // -> Settings (from chrome.storage.sync)
async function setSetting(key, value);           // persist one setting (validated)
function isEnabled();                            // -> boolean shortcut

// Open (or focus) the Bionic viewer tab for a PDF URL.
async function openBionicViewer(pdfUrl, { focus = true } = {});

// Build viewer URL: chrome-extension://<id>/pages/viewer.html?url=<encoded>
function buildViewerUrl(pdfUrl);

// Validate + sanitize the PDF URL before opening (delegates to security.js).
function routePdf(pdfUrl, { source = 'nav' } = {});

// Handle chrome.tabs.onUpdated / chrome.webNavigation.onBeforeNavigate events
// that indicate a PDF destination; apply routing decision.
chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
```

**Inputs**
- Extension lifecycle events.
- Runtime messages: `OPEN_PDF`, `TOGGLE_ENABLED`, `GET_SETTINGS`, `SET_SETTING`, `ROUTE_PDF`.
- Navigation events (`webNavigation.onBeforeNavigate`, `tabs.onUpdated`).

**Outputs**
- Redirected or cancelled navigations opening `viewer.html`.
- Replies to all message senders with typed, validated responses.
- Persisted settings changes.

**Dependencies**
- Module 1 (manifest permissions), Module 11 (`messages.js` protocol), Module 12 (`security.js` validation).
- `src/pdf-router.js` for rule-context decisions.

**Acceptance Criteria**
- Flipping the enable toggle instantly affects routing.
- `chrome.storage.sync` defaults are seeded on first install.
- Malformed shared state does not crash the worker; every `onMessage` path returns a typed response (or an error type).
- Service worker stays non-persistent (no long timers, no blocking work on the hot path).

---

### Module 3 — PDF Routing / Interception (`pdf-router.js`)

**Purpose**
Detect when the user is navigating to (or embedding) a PDF and redirect that navigation into the extension's viewer. This is how a user "just opens a PDF and it gets bionicized."

**Files**
- `src/pdf-router.js` (content-script portion)
- `rules/rules.json` (declarativeNetRequest static rules)

**Key functions**

```js
// --- Content-script portion ---
function initRouter(settings);                    // wire DOM + history listeners

// Walk document, hook anchors and object/embed/iframe elements pointing at PDFs.
function hookPdfLinks(root = document);
function interceptClick(event);                   // capture http(s) .pdf anchors
function interceptEmbeddedPdf(el);                // replace <embed src=...> with viewer iframe
function isPdfLikeUrl(url);                       // heuristic: .pdf, content-disposition, mime
function openInViewer(pdfUrl);                    // message background to open viewer tab

// --- DNR static rules (rules.json) ---
// Rule: match urlFilter="*://*/*.pdf*", resourceTypes=["main_frame"],
//       action: { type:"redirect", redirect:{ regexSubstitution
//         : "chrome-extension://EXT_ID/pages/viewer.html?url=\\0" } }
```

> Note: `declarativeNetRequest` cannot know the `Content-Type` header, so routing relies on URL pattern (`*.pdf`) plus a content-script fallback for links whose headers actually say `application/pdf`. `background.js` decides the final redirect for `webNavigation` events using `security.js`.

**Inputs**
- DOM links/embeds (in visited pages).
- Navigation events and URLs.

**Outputs**
- Redirect to `viewer.html?url=...` for PDF destinations.
- No-op for non-PDF destinations.
- Telemetry-free routing decision (no logging of URLs beyond internal routing).

**Dependencies**
- Module 2 (background routing decision), Module 12 (`security.js` for URL validation), Module 11 (`messages.js`).
- DNR rule files must be declared in Module 1.

**Acceptance Criteria**
- Clicking a plain `<a href="/doc.pdf">` opens the Bionic viewer, not the default download/viewer.
- `<embed src="file.pdf">` inside a page is replaced by an `<iframe>` pointing at the viewer.
- Non-PDF links and binary downloads are left completely alone.
- `data:` and `javascript:` URLs are rejected by `security.js` before routing.

---

### Module 4 — Self-Hosted PDF Viewer Page (`viewer.html` + `viewer.js` + `viewer.css`)

**Purpose**
Present the full-page PDF reader. It owns the page shell, the toolbar (page nav, zoom, bionic toggle, strength control), and glues the PDF.js engine (Module 5) to the Bionic engine (Module 6), Layout Preserver (Module 7), and Media Preserver (Module 8).

**Files**
- `pages/viewer.html`
- `src/viewer.js`
- `src/viewer.css`

**Key elements / functions**

```html
<!-- viewer.html (abbreviated) -->
<div id="toolbar">
  <button id="toggle-bionic">Bionic: ON</button>
  <input id="strength" type="range" min="0" max="4" step="1">
  <button id="prev">‹</button> <span id="page">1 / N</span> <button id="next">›</button>
  <button id="zoom-out">−</button><button id="zoom-in">+</button>
  <span id="status"></span>
</div>
<div id="viewer-container">
  <div id="page-stack"></div>  <!-- per-page: canvas + text layer -->
</div>
<progress id="load-progress"></progress>
```

```js
// viewer.js
async function initViewer();                       // parse ?url= / ?file=, load settings
async function loadPdfBytes(source);               // fetch bytes via security.js
async function openPdf(bytes);                     // hand bytes to pdf_renderer.js
function renderPage(pageNumber);                   // canvas + text layer pipeline
function onSettingsChanged(settings);              // re-run bionic pipeline in place
function handleZoom(delta);                        // re-render at new scale, reassert positions
function reportStatus(text, isError = false);      // toolbar + console
```

**Inputs**
- URL query parameters: `?url=<encoded absolute URL>` or `?file=<encoded file:// path>`.
- Packaged assets (vendored PDF.js), settings.

**Outputs**
- A rendered, navigable, zoomable PDF.
- A bionicized text overlay that satisfies the position-preservation guarantee.
- Progress and error UI (loading, password prompt, unsupported/encrypted, no-text PDF).

**Dependencies**
- Modules 5, 6, 7, 8, 11, 12.

**Acceptance Criteria**
- A PDF passed via `?url=` renders page 1 within a reasonable time for a 1 MB file.
- Toolbar pagination, zoom in/out, and the bionic toggle all work.
- Loading a `file://` PDF works after the user grants the "file access" permission.
- Error states (network failure, encrypted PDF, zero text glyphs) show a clear, non-blank message.

