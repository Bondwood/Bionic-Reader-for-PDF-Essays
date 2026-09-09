> This module is part of the Bionic Reader extension. It will be integrated with the other modules at the end.
> See `docs/README.md` for the full module list.

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
