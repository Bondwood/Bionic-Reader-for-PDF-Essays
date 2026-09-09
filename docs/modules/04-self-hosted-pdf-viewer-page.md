> This module is part of the Bionic Reader extension. It will be integrated with the other modules at the end.
> See `docs/README.md` for the full module list.

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
