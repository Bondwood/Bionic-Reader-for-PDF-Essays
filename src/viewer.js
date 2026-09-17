// Module 4 - Self-Hosted PDF Viewer Page (viewer.js).
//
// Owns the full-page PDF reader: toolbar (page nav, zoom, bionic toggle,
// strength control), progress/error UI, and the pipeline that glues the PDF.js
// render engine (Module 5) to the Bionic Engine (Module 6), Layout Preserver
// (Module 7), and Media Preserver (Module 8).
//
// Loaded as <script type="module">. It imports the ES-module pdf_renderer.js for
// PDF.js access and reads the UMD-style engine modules (security, bionic,
// layout, media, messages) from window.BR.* (loaded as classic scripts in
// viewer.html ahead of this module).

import {
  configurePdfJs,
  openDocument,
  renderPageToCanvas,
  getTextContent,
  getFontBaseNames,
  getViewport,
  DEVICE_SCALE
} from './pdf_renderer.js';

(function () {
  'use strict';

  const BR = window.BR || {};
  const Bionic = BR.Bionic;
  const Layout = BR.LayoutPreserver;
  const Media = BR.Media;
  const Security = BR.Security || {};
  const SymbolEncoding = BR.SymbolEncoding || null;

  // ---- Settings contract (Module 2 DEFAULT_SETTINGS) ----------------------
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    fixationPercent: 50,
    strength: 2,
    style: 'stroke',
    routePdfs: true
  });

  const STYLE_CLASSES = Object.freeze({
    stroke: 'bionic-stroke',
    highlight: 'bionic-highlight',
    shadow: 'bionic-shadow'
  });

  const STROKE_WIDTHS = ['0.4px', '0.8px', '1.2px', '1.8px', '2.4px'];

  const SCALE_STEP = 0.25;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4.0;

  // ---- Module state --------------------------------------------------------
  let pdfDoc = null;
  let currentPageNumber = 1;
  let scale = 1.0;
  let settings = { ...DEFAULT_SETTINGS };
  let renderToken = 0;
  let el = null;

  // ---- Small DOM helpers ---------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function reportStatus(text, isError = false) {
    const status = el && el.status;
    if (status) {
      status.textContent = text || '';
      status.classList.toggle('error', !!isError);
    }
    const prefix = '[Bionic Reader]';
    if (isError) console.error(prefix, text);
    else if (text) console.log(prefix, text);
  }

  function showMessage(title, message, isError = false) {
    if (!el || !el.pageStack) return;
    el.pageStack.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.id = 'message-overlay';
    overlay.className = isError ? 'error' : '';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    overlay.appendChild(h);
    overlay.appendChild(p);
    el.pageStack.appendChild(overlay);
    if (isError) reportStatus(message, true);
  }

  function setLoadingProgress(fraction) {
    if (!el || !el.progress) return;
    const pct = Math.max(0, Math.min(1, fraction)) * 100;
    el.progress.value = pct;
    el.progress.hidden = false;
    if (fraction >= 1) {
      setTimeout(() => { if (el.progress) el.progress.hidden = true; }, 400);
    }
  }

  // ---- Settings persistence -------------------------------------------------
  function sanitizeSettings(raw) {
    const out = { ...DEFAULT_SETTINGS };
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if (typeof raw.routePdfs === 'boolean') out.routePdfs = raw.routePdfs;
    if (typeof raw.fixationPercent === 'number' && Number.isFinite(raw.fixationPercent)) {
      out.fixationPercent = Math.min(100, Math.max(0, Math.round(raw.fixationPercent)));
    }
    if (typeof raw.strength === 'number' && Number.isFinite(raw.strength)) {
      out.strength = Math.min(4, Math.max(0, Math.round(raw.strength)));
    }
    if (['stroke', 'highlight', 'shadow'].includes(raw.style)) out.style = raw.style;
    return out;
  }

  async function fetchSettings() {
    try {
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (res && res.type === 'ok' && res.settings && typeof res.settings === 'object') {
          settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...res.settings });
          return;
        }
      }
    } catch (err) { /* fall through to direct storage */ }
    try {
      const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
      settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
    } catch (err) {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function persistSetting(key, value) {
    const sanitized = sanitizeSettings({ ...settings, [key]: value });
    settings = sanitized;
    try { chrome.storage.sync.set({ [key]: sanitized[key] }); } catch (err) {
      reportStatus(`Could not save setting "${key}"`, true);
    }
    applySettingsToUi();
  }

  // ---- Source parsing (via Module 12 security.js) ---------------------------
  function parseSourceFromLocation() {
    if (typeof location === 'undefined') return null;
    const params = new URLSearchParams(location.search);
    const url = Safety('sanitizeSource')(params.get('url'), 'url');
    const file = Safety('sanitizeSource')(params.get('file'), 'file');
    if (url) return { type: 'url', value: url };
    if (file) return { type: 'file', value: file };
    return null;
  }
  function Safety(fn) {
    return function () { return Security && typeof Security[fn] === 'function' ? Security[fn].apply(null, arguments) : null; };
  }

  // ---- PDF bytes loading -----------------------------------------------------
  async function loadPdfBytes(source) {
    if (!source) throw new Error('No PDF source was provided (?url= or ?file=).');
    reportStatus(source.type === 'file' ? 'Opening local file…' : 'Downloading PDF…');
    const res = await fetch(source.value);
    if (!res.ok) {
      throw new Error(`Failed to load (${res.status} ${res.statusText}).`);
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      return new Uint8Array(await res.arrayBuffer());
    }
    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (total > 0) setLoadingProgress(0.05 + (received / total) * 0.1);
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    return merged;
  }

  // ---- Open / render pipeline ------------------------------------------------
  async function openPdf(bytes) {
    if (!el) return;
    const token = ++renderToken;
    el.pageStack.innerHTML = '';

    reportStatus('Parsing PDF…');
    setLoadingProgress(0.15);

    let pdf = null;
    try {
      pdf = await openDocument(bytes, (p) => {
        if (p && p.total > 0) setLoadingProgress(0.15 + (p.loaded / p.total) * 0.45);
      });
    } catch (err) {
      pdfDoc = null;
      const code = String(err && (err.name || err.code || ''));
      if (/password/i.test(code)) {
        showMessage('Password-protected PDF',
          'This PDF is encrypted and requires a password. Passwords are not supported yet.', true);
      } else {
        showMessage('Could not open PDF',
          `The PDF could not be parsed: ${err && err.message || err}`, true);
      }
      updateToolbarState();
      return;
    }
    if (token !== renderToken) { try { await pdf.destroy(); } catch (e) {} return; }

    pdfDoc = pdf;
    currentPageNumber = 1;
    await renderPage(1);
  }

  async function renderPage(pageNumber) {
    if (!el || !pdfDoc) return;
    const token = ++renderToken;

    const page = await pdfDoc.getPage(pageNumber);
    if (token !== renderToken) return;

    const viewport = getViewport(page, scale, DEVICE_SCALE);
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);

    // Build the page frame via Media Preserver (canvas z0 + text layer z2).
    const { frame, canvas, ctx, textLayer } = Media.createPageFrame(w, h);
    el.pageStack.innerHTML = '';
    el.pageStack.appendChild(frame);

    setLoadingProgress(0.7);
    reportStatus(`Rendering page ${pageNumber}…`);

    try {
      await renderPageToCanvas(page, viewport, ctx);
    } catch (err) {
      if (token === renderToken) {
        showMessage('Render error',
          `Could not render page ${pageNumber}: ${err && err.message || err}`, true);
      }
      try { await page.cleanup(); } catch (e) {}
      return;
    }
    if (token !== renderToken) return;

    let textItems = [];
    let textStyles = {};
    let fontBaseNames = {};
    try {
      const content = await getTextContent(page);
      textItems = content.items || [];
      textStyles = content.styles || {};
      // Resolve real BaseFont names (Symbol vs Wingdings vs ZapfDingbats) BEFORE
      // page.cleanup() tears down commonObjs. Same PUA codepoint means different
      // glyphs depending on the font, so the text layer needs the real name.
      try {
        const names = textItems.map((it) => it && it.fontName).filter(Boolean);
        fontBaseNames = await getFontBaseNames(page, names);
      } catch (e) { fontBaseNames = {}; }
    } catch (err) { textItems = []; textStyles = {}; fontBaseNames = {}; }
    try { await page.cleanup(); } catch (e) {}

    setLoadingProgress(0.9);
    if (!textItems.length) {
      reportStatus('No machine text found; showing the PDF as-is.', false);
    } else {
      buildTextLayer(textLayer, viewport, textItems, textStyles, fontBaseNames);
    }

    setLoadingProgress(1);
    updateToolbarState();
    reportStatus('Ready');
  }

  // ---- Bionic + Layout + Media pipeline (spec 3.2/3.3) ----------------------
  // Each glyph span is absolutely positioned at its exact PDF coordinate and the
  // paint canvas is left untouched. Emphasis uses only zero-layout-change CSS,
  // then the Geometry Guard measures/compensates (Module 7).
  // Map a PDF text-content style's generic family to a Unicode-complete CSS
  // font stack that covers Latin, Greek, and math/symbol glyphs, so no codepoint
  // falls to a tofu/missing box. Falls back to a broad serif stack.
  function resolveFontFamily(family) {
    if (family === 'monospace') {
      return '"Courier New", "Consolas", monospace, "Segoe UI Symbol", "Noto Sans Symbols", sans-serif';
    }
    if (family === 'sans-serif') {
      return '"Arial", "Helvetica", "Segoe UI", sans-serif, "Segoe UI Symbol", "Noto Sans Symbols", sans-serif';
    }
    // 'serif' and anything unknown: serif covers Greek/math well.
    return '"Times New Roman", Georgia, "Cambria Math", serif, "Segoe UI Symbol", "Noto Sans Symbols", sans-serif';
  }

  function buildTextLayer(textLayer, viewport, items, styles, fontBaseNames) {
    const styleClass = STYLE_CLASSES[settings.style] || STYLE_CLASSES.stroke;
    const strokeWidth = STROKE_WIDTHS[settings.strength] || STROKE_WIDTHS[2];
    const bionicOn = !!settings.enabled;
    const pct = settings.fixationPercent;
    const stylesMap = styles || {};

    // Resolve, once per page, the base run each item belongs to. A sub/superscript
    // is a materially smaller run whose baseline is offset from an adjacent
    // larger run; those runs must never be stroked (see Layout.findScriptBase).
    const itemsWithText = items.filter(
      (it) => it && typeof it.str === 'string' && it.str.length > 0
    );
    const scriptKinds = new Map();
    if (Layout && typeof Layout.findScriptBase === 'function') {
      for (const it of itemsWithText) {
        const base = Layout.findScriptBase(it, itemsWithText);
        scriptKinds.set(it, Layout.classifyScriptAgainstBase(it, base));
      }
    }

    const placements = [];
    for (const item of items) {
      if (!item || typeof item.str !== 'string' || item.str.length === 0) continue;

      // Symbol-encoded glyphs are extracted as PUA codepoints (U+F000..U+F0FF)
      // that normal UI fonts cannot draw. Remap them to real Unicode so Greek
      // letters, arrows, and super/subscript symbols don't disappear (Module 13).
      // The same PUA codepoint differs by font (U+F0E0 is a lozenge in Symbol
      // but a heavy arrow in Wingdings), so decode with the resolved BaseFont.
      const baseFont = fontBaseNames && item.fontName ? fontBaseNames[item.fontName] : null;
      const text = (SymbolEncoding && typeof SymbolEncoding.remapTextForFont === 'function')
        ? SymbolEncoding.remapTextForFont(item.str, baseFont)
        : item.str;

      // Honor the PDF's actual font family + metrics from the text-content
      // styles table (fontName -> { fontFamily, ascent, descent }). This keeps
      // Greek/Symbol glyphs in a font that actually covers them and gives each
      // run its true baseline (critical for superscripts/subscripts).
      // Classify sub/superscript runs from their geometry. Their glyphs are
      // already in the correct place; the rule is simply that they must never be
      // given a fixation-prefix stroke (which would emphasize the wrong glyphs).
      const scriptKind = scriptKinds.get(item) || null;
      const isScript = !!scriptKind;

      const fontStyle = stylesMap[item.fontName] || {};
      const family = resolveFontFamily(fontStyle.fontFamily);

      const placement = Layout.computePlacement(item, viewport.transform);
      if (fontStyle.ascent && fontStyle.descent) {
        // ascent/descent are fractions of the em box (may be >0 or <0).
        const asc = Math.abs(fontStyle.ascent);
        const desc = Math.abs(fontStyle.descent);
        placement.ascentRatio = (asc + desc) ? asc / (asc + desc) : 0.8;
      }

      const span = document.createElement('span');
      span.style.fontFamily = family;
      span.style.whiteSpace = 'pre';
      Layout.positionSpan(span, placement);

      if (!bionicOn || isScript) {
        // Disabled, or a sub/superscript run: render verbatim, never stroked.
        span.textContent = text;
      } else if (Bionic && typeof Bionic.analyze === 'function') {
        const segments = Bionic.analyze(text, pct);
        for (const seg of segments) {
          if (seg.type === 'space') {
            span.appendChild(document.createTextNode(seg.text));
          } else {
            // Zero-layout-change emphasis (stroke/highlight/shadow): splitting
            // into runs never shifts glyph coordinates.
            //
            // Numbers and all-caps words are emphasized in full (the whole token
            // is stroked), while regular words keep the bionic fixation prefix.
            if (seg.operator) {
              // Standalone math operators/delimiters are never emphasized.
              span.appendChild(document.createTextNode(seg.word));
              continue;
            }
            const emphasizedText = seg.full ? seg.word : seg.head;
            const tailText = seg.full ? '' : seg.tail;
            const head = document.createElement('span');
            head.textContent = emphasizedText;
            head.classList.add(styleClass);
            if (styleClass === 'bionic-stroke') {
              head.style.setProperty('-webkit-text-stroke', strokeWidth);
            }
            // Ensure the styled run inherits the no-wrap behavior of its parent so
            // the full token and its prefix split are measured identically.
            head.style.whiteSpace = 'pre';

            if (tailText) {
              const run = document.createElement('span');
              run.style.whiteSpace = 'pre';
              run.appendChild(head);
              run.appendChild(document.createTextNode(tailText));
              span.appendChild(run);
            } else {
              span.appendChild(head);
            }
          }
        }
      } else {
        span.textContent = text; // engine missing -> render as-is (never blank)
      }

      // Horizontal advance correction (Module 7): the overlay uses a
      // substituted system font whose glyph advances differ from the PDF's
      // embedded font. Each item is an independent span, so a mismatch shows up
      // as over-/under-spacing around runs of a different size or font - most
      // visibly superscripts and subscripts. Scale the span horizontally so its
      // rendered width matches the embedded font's advance (item.width, in
      // user-space points, converted to screen px by the viewport x-scale).
      const pxScale = (viewport.transform && Number.isFinite(viewport.transform[0]))
        ? viewport.transform[0]
        : 1;
      const intendedWidthPx = Number.isFinite(item.width) ? item.width * pxScale : 0;
      // Sub/superscript runs are excluded from the horizontal advance correction.
      // They are separate small runs whose PDF advance is already tightly
      // attached to the base glyph; scaling them to a substituted font's metric
      // shifts them off their intended anchor (the page-3 "ref"/"6" tearing).
      // PDF.js itself only scales full-size glyph runs for this reason.
      if (!isScript && Layout && typeof Layout.applyHorizontalScale === 'function' && intendedWidthPx > 0) {
        Layout.applyHorizontalScale(span, text, family, placement.fontSize, intendedWidthPx);
      }
      textLayer.appendChild(span);

      // Intended origin for the geometry guard. x matches span.style.left and
      // y is the span TOP (the value positionSpan writes to style.top), so both
      // compare like-for-like against getBoundingClientRect.
      const top = placement.y - (placement.ascentRatio !== undefined
        ? placement.fontSize * placement.ascentRatio
        : placement.fontSize * 0.8);
      placements.push({
        span,
        intended: {
          x: placement.x,
          y: top
        }
      });
    }

    // Geometry Guard (Module 7, mandatory): measure every span and compensate
    // only if a real position drift is detected. Stroke/highlight/shadow cause
    // none, so this is normally a no-op fast path.
    if (Layout && typeof Layout.runGeometryGuard === 'function') {
      const report = Layout.runGeometryGuard(placements, { parent: textLayer, compensate: true });
      if (report.drifts.length > 0) {
        const driftCount = report.drifts.length;
        const driftWord = driftCount === 1 ? 'drift' : 'drifts';
        const fixedCount = report.compensated.length;
        console.warn(
          `[Bionic Reader] Geometry guard detected ${driftCount} ${driftWord} and corrected ${fixedCount}.`
        );
      }
    }
  }

  // ---- Settings change / zoom / pagination ----------------------------------
  async function onSettingsChanged(changed) {
    settings = sanitizeSettings({ ...settings, ...changed });
    applySettingsToUi();
    if (pdfDoc) await renderPage(currentPageNumber);
  }

  async function handleZoom(delta) {
    if (!pdfDoc) return;
    let next = scale + delta;
    next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    if (next === scale) return;
    scale = next;
    await renderPage(currentPageNumber);
  }

  async function goToPage(pageNumber) {
    if (!pdfDoc) return;
    const clamped = Math.max(1, Math.min(pdfDoc.numPages, pageNumber));
    if (clamped === currentPageNumber) return;
    currentPageNumber = clamped;
    await renderPage(currentPageNumber);
  }

  // ---- Toolbar wiring --------------------------------------------------------
  function applySettingsToUi() {
    if (!el) return;
    el.toggle.textContent = `Bionic: ${settings.enabled ? 'ON' : 'OFF'}`;
    el.toggle.classList.toggle('off', !settings.enabled);
    el.strength.value = String(settings.strength);
    el.strengthValue.textContent = String(settings.strength);
    if (el.fixation) el.fixation.value = String(settings.fixationPercent);
    if (el.fixationValue) el.fixationValue.textContent = `${settings.fixationPercent}%`;
    if (el.styleSelect) el.styleSelect.value = settings.style;
  }

  function updateToolbarState() {
    if (!el) return;
    const count = pdfDoc ? pdfDoc.numPages : 1;
    el.page.textContent = `${currentPageNumber} / ${count}`;
    el.zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    el.prev.disabled = !pdfDoc || currentPageNumber <= 1;
    el.next.disabled = !pdfDoc || currentPageNumber >= count;
    el.zoomOut.disabled = !pdfDoc || scale <= MIN_SCALE;
    el.zoomIn.disabled = !pdfDoc || scale >= MAX_SCALE;
  }

  function wireToolbar() {
    el.toggle.addEventListener('click', () => {
      const next = !settings.enabled;
      persistSetting('enabled', next);
      onSettingsChanged({ enabled: next });
    });

    el.strength.addEventListener('input', () => {
      el.strengthValue.textContent = el.strength.value;
    });
    el.strength.addEventListener('change', () => {
      const v = parseInt(el.strength.value, 10);
      persistSetting('strength', v);
      onSettingsChanged({ strength: v });
    });

    if (el.fixation) {
      el.fixation.addEventListener('input', () => {
        el.fixationValue.textContent = `${el.fixation.value}%`;
      });
      el.fixation.addEventListener('change', () => {
        const v = parseInt(el.fixation.value, 10);
        persistSetting('fixationPercent', v);
        onSettingsChanged({ fixationPercent: v });
      });
    }

    if (el.styleSelect) {
      el.styleSelect.addEventListener('change', () => {
        persistSetting('style', el.styleSelect.value);
        onSettingsChanged({ style: el.styleSelect.value });
      });
    }

    el.prev.addEventListener('click', () => goToPage(currentPageNumber - 1));
    el.next.addEventListener('click', () => goToPage(currentPageNumber + 1));
    el.zoomOut.addEventListener('click', () => handleZoom(-SCALE_STEP));
    el.zoomIn.addEventListener('click', () => handleZoom(SCALE_STEP));
  }

  // ---- Init ------------------------------------------------------------------
  async function initViewer() {
    el = {
      toggle: $('toggle-bionic'),
      strength: $('strength'),
      strengthValue: $('strength-value'),
      fixation: $('fixation'),
      fixationValue: $('fixation-value'),
      styleSelect: $('style-select'),
      prev: $('prev'),
      next: $('next'),
      page: $('page'),
      zoomIn: $('zoom-in'),
      zoomOut: $('zoom-out'),
      zoomLevel: $('zoom-level'),
      status: $('status'),
      progress: $('load-progress'),
      pageStack: $('page-stack')
    };

    // Configure PDF.js worker + asset locations before opening any document.
    try { configurePdfJs(); } catch (err) {
      console.error('[Bionic Reader] Could not configure PDF.js', err);
    }

    wireToolbar();
    await fetchSettings();
    applySettingsToUi();
    updateToolbarState();

    const source = parseSourceFromLocation();
    if (!source) {
      showMessage('No PDF specified',
        'Open this viewer from a PDF: pass ?url=<encoded URL> or ?file=<encoded file:// path>.');
      return;
    }

    setLoadingProgress(0.05);
    reportStatus('Loading PDF…');
    try {
      const bytes = await loadPdfBytes(source);
      await openPdf(bytes);
    } catch (err) {
      showMessage('Failed to load PDF', String(err && err.message || err), true);
      setLoadingProgress(1);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initViewer(), { once: true });
    } else {
      initViewer();
    }
  }

  window.__bionicViewer = {
    initViewer, handleZoom, goToPage, renderPage, openPdf, loadPdfBytes,
    onSettingsChanged, reportStatus, parseSourceFromLocation
  };
})();
