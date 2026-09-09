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
  getTextItems,
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
    try { textItems = await getTextItems(page); } catch (err) { textItems = []; }
    try { await page.cleanup(); } catch (e) {}

    setLoadingProgress(0.9);
    if (!textItems.length) {
      reportStatus('No machine text found; showing the PDF as-is.', false);
    } else {
      buildTextLayer(textLayer, viewport, textItems);
    }

    setLoadingProgress(1);
    updateToolbarState();
    reportStatus('Ready');
  }

  // ---- Bionic + Layout + Media pipeline (spec 3.2/3.3) ----------------------
  // Each glyph span is absolutely positioned at its exact PDF coordinate and the
  // paint canvas is left untouched. Emphasis uses only zero-layout-change CSS,
  // then the Geometry Guard measures/compensates (Module 7).
  function buildTextLayer(textLayer, viewport, items) {
    const styleClass = STYLE_CLASSES[settings.style] || STYLE_CLASSES.stroke;
    const strokeWidth = STROKE_WIDTHS[settings.strength] || STROKE_WIDTHS[2];
    const bionicOn = !!settings.enabled;
    const pct = settings.fixationPercent;

    const v0 = viewport.transform[0];
    const v3 = viewport.transform[3];

    const placements = [];
    for (const item of items) {
      if (!item || typeof item.str !== 'string' || item.str.length === 0) continue;
      const placement = Layout.computePlacement(item, viewport.transform);
      const span = document.createElement('span');
      span.style.fontFamily = '"Helvetica", "Arial", sans-serif';
      span.style.whiteSpace = 'pre';
      Layout.positionSpan(span, placement);

      if (!bionicOn) {
        span.textContent = item.str;
      } else if (Bionic && typeof Bionic.analyze === 'function') {
        const segments = Bionic.analyze(item.str, pct);
        for (const seg of segments) {
          if (seg.type === 'space') {
            span.appendChild(document.createTextNode(seg.text));
          } else {
            // Zero-layout-change emphasis (stroke/highlight/shadow): splitting
            // into runs never shifts glyph coordinates.
            const run = document.createElement('span');
            run.style.whiteSpace = 'pre';
            const head = document.createElement('span');
            head.textContent = seg.head;
            head.classList.add(styleClass);
            if (styleClass === 'bionic-stroke') {
              head.style.setProperty('-webkit-text-stroke', strokeWidth);
            }
            run.appendChild(head);
            run.appendChild(document.createTextNode(seg.tail));
            span.appendChild(run);
          }
        }
      } else {
        span.textContent = item.str; // engine missing -> render as-is (never blank)
      }

      textLayer.appendChild(span);

      // Intended advance width for the geometry guard (approx from font size).
      placements.push({
        span,
        intended: {
          x: placement.x,
          y: placement.y,
          width: item.width || placement.fontSize * item.str.length * 0.5
        }
      });
    }

    // Geometry Guard (Module 7, mandatory): measure every span and compensate
    // only if a measurable x-drift is detected. Stroke/highlight/shadow cause
    // none, so this is normally a no-op fast path.
    if (Layout && typeof Layout.runGeometryGuard === 'function') {
      const report = Layout.runGeometryGuard(placements, { parent: textLayer, compensate: true });
      if (report.drifts.length > 0) {
        console.warn(`[Bionic Reader] Geometry guard corrected ${report.compensated.length}/${report.drifts.length} drift(s).`);
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
