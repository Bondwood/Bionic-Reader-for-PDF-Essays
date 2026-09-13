// Module 5 - PDF.js Rendering Engine (pdf_renderer.js).
//
// Thin, deterministic wrapper around the vendored PDF.js engine that the viewer
// page (Module 4) uses to render PDF pages. It:
//   * imports the vendored pdf.mjs (CSP-safe, 'self'),
//   * configures the web worker, cMaps, standard fonts, and wasm decoder URLs
//     relative to the extension's own files (no remote requests),
//   * opens a document from raw bytes,
//   * renders the paint canvas (images + vector art) and extracts the text
//     items (str + transform) needed by the Bionic / Layout / Media modules.
//
// It intentionally does NOT apply any bionic styling; it only produces the raw
// render + text geometry. Styling is the Bionic Engine's job.
//
// This file is an ES module (imports pdf.mjs) and is consumed by viewer.js,
// which is loaded as <script type="module">.

import * as pdfjsLib from '../vendor/pdfjs/pdf.mjs';

// Resolve an absolute URL relative to the current (extension) page. Falls back
// to the token unchanged if the base is unavailable.
function absUrl(base, path) {
  try {
    return new URL(path, base).href;
  } catch (err) {
    return path;
  }
}

// Configure the PDF.js global worker + asset locations from the extension page.
// All URLs resolve against the extension origin so CSP ('self') is satisfied and
// no external requests are made. The resolved asset root is stored in a module-level
// variable (NOT on the pdfjsLib module, whose namespace is frozen), then used by
// assetUrl() when opening a document.
let assetRoot = null;

export function configurePdfJs(base) {
  const root = base || (typeof location !== 'undefined' ? location.href : '');
  pdfjsLib.GlobalWorkerOptions.workerSrc = absUrl(root, '../vendor/pdfjs/pdf.worker.mjs');
  assetRoot = new URL('../vendor/pdfjs/', root).href;
  return pdfjsLib;
}

function assetUrl(subPath) {
  const root =
    assetRoot ||
    (typeof location !== 'undefined' ? new URL('../vendor/pdfjs/', location.href).href : '');
  return root + subPath;
}

export function getPdfJs() {
  return pdfjsLib;
}

// Open a PDF document from raw bytes. Returns the pdfjsLib.PDFDocumentProxy.
// onProgress(p) receives { loaded, total }.
export async function openDocument(bytes, onProgress) {
  const lib = getPdfJs();
  const loadingTask = lib.getDocument({
    data: bytes,
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    isEvalSupported: false // CSP forbids eval in extension pages
  });
  if (typeof onProgress === 'function') {
    loadingTask.onProgress = (p) => onProgress(p);
  }
  return loadingTask.promise;
}

// Render a single page to a paint canvas (images + vector art, untouched) and
// return the canvas context. `viewport` should come from page.getViewport.
//
// By default the original PDF text is NOT drawn: it would sit directly beneath the
// Bionic overlay glyphs and appear doubled/overlapped (spec G5/G6: artwork stays,
// original text yields to the overlay). A temporary no-op on the context's
// fillText/strokeText catches every glyph paint while leaving fillRect,
// strokeRect, drawImage, and path fills/strokes (vector art) fully intact.
//
// NOTE: do NOT suppress text with an operationsFilter that skips showText.
// PDF.js's canvas graphics state carries the text-object transform (set by
// beginText/setTextMatrix and restored by endText). Dropping the showText
// operators desynchronizes that state so a later transform-free constructPath
// (e.g. page 10's large vector arrow) is emitted under the wrong CTM and lands
// in the middle of unrelated artwork. Rendering the full operator stream and
// muting the terminal fillText/strokeText calls keeps the state machine intact.
export async function renderPageToCanvas(page, viewport, canvasContext, options) {
  const stripText = !(options && options.renderText === true);

  const origFillText = canvasContext.fillText;
  const origStrokeText = canvasContext.strokeText;
  if (stripText) {
    canvasContext.fillText = function () {};
    canvasContext.strokeText = function () {};
  }

  try {
    await page.render({
      canvasContext,
      viewport
    }).promise;
  } finally {
    if (stripText) {
      canvasContext.fillText = origFillText;
      canvasContext.strokeText = origStrokeText;
    }
  }
  return canvasContext;
}

// Extract the machine-readable text items (str + transform) plus the font
// style table for a page. `styles` maps fontName -> { fontFamily, ascent,
// descent, vertical } and is required for correct glyph baseline placement
// (superscripts/subscripts) and for honoring the PDF's actual font (so Greek,
// Symbol, and math glyphs are not substituted away as Helvetica/Arial).
export async function getTextContent(page) {
  try {
    const content = await page.getTextContent();
    return {
      items: (content && content.items) || [],
      styles: (content && content.styles) || {}
    };
  } catch (err) {
    return { items: [], styles: {} };
  }
}

// Backwards-compatible alias returning just the items array.
export async function getTextItems(page) {
  const c = await getTextContent(page);
  return c.items;
}

// Resolve each text-content fontName (e.g. "g_d0_f3") to the PDF's real
// BaseFont name (e.g. "HOKHHL+Wingdings-Regular"). getTextContent() only exposes
// a generic family ("serif"/"sans-serif"), which is not enough to tell a Symbol
// font from Wingdings/ZapfDingbats: the same PUA codepoint (U+F0E0) means a
// lozenge in Symbol but a heavy arrow in Wingdings. The real name is available
// on the page's commonObjs font proxy, but it resolves asynchronously, so poll
// briefly. Returns {} on failure; callers fall back to Symbol decoding.
export async function getFontBaseNames(page, fontNames, timeoutMs) {
  const names = Array.from(new Set((fontNames || []).filter(Boolean)));
  if (!names.length) return {};
  const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 2000);
  let remaining = names.slice();

  while (remaining.length && Date.now() < deadline) {
    const pending = [];
    for (const fontName of remaining) {
      let obj = null;
      try {
        obj = page.commonObjs && page.commonObjs.has(fontName)
          ? page.commonObjs.get(fontName)
          : null;
      } catch (err) {
        obj = null;
      }
      if (obj && obj.name) {
        // keep resolving; loop below drops it
      } else {
        pending.push(fontName);
      }
    }
    if (!pending.length) break;
    remaining = pending;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const out = {};
  for (const fontName of names) {
    try {
      const obj = page.commonObjs && page.commonObjs.has(fontName)
        ? page.commonObjs.get(fontName)
        : null;
      if (obj && obj.name) out[fontName] = obj.name;
    } catch (err) { /* leave unresolved */ }
  }
  return out;
}

// Convenience: build a viewport at a given scale. DEVICE_SCALE is the canvas
// supersampling factor for crisp text.
export const DEVICE_SCALE = 1.5;
export function getViewport(page, scale, deviceScale) {
  const ds = deviceScale || DEVICE_SCALE;
  return page.getViewport({ scale: scale * ds });
}
