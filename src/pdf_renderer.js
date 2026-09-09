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

// Text operator ids from the vendored PDF.js OPS table (see vendor/pdfjs/pdf.mjs):
// showText=44, showSpacedText=45, nextLineShowText=46, nextLineSetSpacingShowText=47.
// Skipping these renders images + vector art fully while omitting original PDF glyphs.
const TEXT_OP_IDS = new Set([44, 45, 46, 47]);

// Render a single page to a paint canvas (images + vector art, untouched) and
// return the canvas context. `viewport` should come from page.getViewport.
//
// By default the original PDF text is NOT drawn: it would sit directly beneath the
// Bionic overlay glyphs and appear doubled/overlapped (spec G5/G6: artwork stays,
// original text yields to the overlay). Two independent safeguards suppress it:
//   1. operationsFilter (backed by a one-time getOperatorList lookup) skips the
//      showText/showSpacedText operators so PDF.js never enters glyph painting and
//      never loads faces it would otherwise need.
//   2. A temp no-op on canvas fillText/strokeText catches any residual text draws
//      (fallback fonts, Type3, or pattern-filled glyphs) while leaving fillRect,
//      strokeRect, drawImage, and path fills/strokes (vector art) fully intact.
export async function renderPageToCanvas(page, viewport, canvasContext, options) {
  const stripText = !(options && options.renderText === true);

  // Precompute the set of operator indices that draw text so the render filter can
  // skip them. getOperatorList() returns { fnArray, argsArray }; indices match render()'s.
  let textOpIndices = null;
  if (stripText) {
    try {
      const opList = await page.getOperatorList();
      textOpIndices = new Set();
      for (let i = 0; i < opList.fnArray.length; i++) {
        if (TEXT_OP_IDS.has(opList.fnArray[i])) textOpIndices.add(i);
      }
    } catch (err) {
      textOpIndices = null; // fall back to the fillText/strokeText guard below
    }
  }

  const origFillText = canvasContext.fillText;
  const origStrokeText = canvasContext.strokeText;
  if (stripText) {
    canvasContext.fillText = function () {};
    canvasContext.strokeText = function () {};
  }

  try {
    await page.render({
      canvasContext,
      viewport,
      operationsFilter: stripText && textOpIndices
        ? (i) => !textOpIndices.has(i)
        : null
    }).promise;
  } finally {
    if (stripText) {
      canvasContext.fillText = origFillText;
      canvasContext.strokeText = origStrokeText;
    }
  }
  return canvasContext;
}

// Extract the machine-readable text items (str + transform) for a page.
export async function getTextItems(page) {
  try {
    const content = await page.getTextContent();
    return (content && content.items) || [];
  } catch (err) {
    return [];
  }
}

// Convenience: build a viewport at a given scale. DEVICE_SCALE is the canvas
// supersampling factor for crisp text.
export const DEVICE_SCALE = 1.5;
export function getViewport(page, scale, deviceScale) {
  const ds = deviceScale || DEVICE_SCALE;
  return page.getViewport({ scale: scale * ds });
}
