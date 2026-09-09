// Module 3 — PDF Router (content-script portion).
// Detects when the user navigates to (or embeds) a PDF and redirects that
// navigation into the extension's Bionic viewer, so a user "just opens a PDF
// and it gets bionicized."
//
// Detected sources:
//   * <a href="...\.pdf">            -> open viewer tab (no native download/viewer)
//   * <embed src="....pdf">          -> replaced by a viewer <iframe>
//   * <object data="....pdf">        -> replaced by a viewer <iframe>
//   * <iframe src="....pdf">         -> replaced by a viewer <iframe>
//
// Non-PDF links, plain binary downloads, and data:/javascript: URLs are left
// completely untouched.
//
// Shared modules (11 = message protocol, 12 = security/URL validation) are
// loaded ahead of this content script by the manifest (content_scripts order),
// so their helpers are available on window.BR.*.

(() => {
  'use strict';

  // ---- Shared protocol + security modules (Module 11 / 12) ----
  const BR = (typeof window !== 'undefined' && window.BR) || {};
  const MessageType = (BR.Messages && BR.Messages.MessageType) || {
    GET_SETTINGS: 'GET_SETTINGS',
    OPEN_PDF: 'OPEN_PDF'
  };
  const ResponseType = (BR.Messages && BR.Messages.ResponseType) || { OK: 'ok', ERROR: 'error' };
  const DEFAULT_SETTINGS = (BR.Messages && BR.Messages.DEFAULT_SETTINGS) || {
    enabled: true,
    routePdfs: true
  };
  const Security = BR.Security || {};
  const isAllowedScheme = Security.isAllowedScheme || (() => false);
  const isPdfLikeUrl = Security.isPdfLikeUrl || (() => false);
  const sanitizePdfUrl = Security.sanitizePdfUrl || ((url) => (typeof url === 'string' ? url : null));

  // Resolve a possibly-relative reference against the current document.
  function toAbsoluteUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(raw, (typeof document !== 'undefined' && document.baseURI) || undefined).href;
    } catch (err) {
      return null;
    }
  }

  // ---- Settings -------------------------------------------------------------
  // Cached copy of the routing-relevant settings, refreshed from background at
  // startup, on user-triggered toggles (storage.onChanged), and on focus.
  let settings = { ...DEFAULT_SETTINGS };

  function isRoutingActive() {
    return !!(settings && settings.enabled !== false && settings.routePdfs !== false);
  }

  async function refreshSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.GET_SETTINGS });
      if (res && res.type === ResponseType.OK && res.settings && typeof res.settings === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...res.settings };
      }
    } catch (err) {
      // Background worker may be asleep or unreachable; keep current (default)
      // settings so we never crash the page.
    }
  }

  // ---- Viewer opening -------------------------------------------------------
  function buildViewerUrl(pdfUrl) {
    let extensionId = 'UNKNOWN';
    try {
      extensionId = chrome.runtime && chrome.runtime.id ? chrome.runtime.id : extensionId;
    } catch (err) { /* keep fallback */ }
    return `chrome-extension://${extensionId}/pages/viewer.html?url=${encodeURIComponent(pdfUrl)}`;
  }

  // Build a viewer <iframe> that preserves the source element's box.
  function buildViewerIframe(pdfUrl, sourceEl) {
    const iframe = document.createElement('iframe');
    iframe.src = buildViewerUrl(pdfUrl);
    iframe.setAttribute('allowfullscreen', 'true');
    if (sourceEl && typeof sourceEl.getAttribute === 'function') {
      for (const attr of ['width', 'height']) {
        if (sourceEl.hasAttribute(attr)) iframe.setAttribute(attr, sourceEl.getAttribute(attr));
      }
      const style = sourceEl.getAttribute('style');
      if (style) iframe.setAttribute('style', style);
      const align = sourceEl.getAttribute('align');
      if (align) iframe.setAttribute('align', align);
    }
    return iframe;
  }

  // Ask background.js to open (or focus) the viewer tab for a PDF URL.
  function openInViewer(pdfUrl) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ type: ResponseType.ERROR, error: 'Extension runtime unavailable' });
        return;
      }
      try {
        chrome.runtime.sendMessage(
          { type: MessageType.OPEN_PDF, url: pdfUrl },
          (res) => resolve(res)
        );
      } catch (err) {
        resolve({ type: ResponseType.ERROR, error: String(err && err.message || err) });
      }
    });
  }

  // ---- Embedded-PDF interception --------------------------------------------
  // Replace an <embed>/<object>/<iframe> that points at a PDF with a viewer
  // iframe. Returns true if the element was replaced.
  function interceptEmbeddedPdf(el) {
    if (!el || !el.getAttribute || !isRoutingActive()) return false;
    // Resolve the target from whichever attribute the element type uses.
    const raw = el.getAttribute('src') || el.getAttribute('data');
    if (!raw) return false;
    const absUrl = toAbsoluteUrl(raw);
    const clean = sanitizePdfUrl(absUrl);
    if (!clean || !isPdfLikeUrl(clean)) return false;
    const viewer = buildViewerIframe(clean, el);
    if (el.replaceWith) {
      el.replaceWith(viewer);
    } else if (el.parentNode) {
      el.parentNode.replaceChild(viewer, el);
    } else {
      return false;
    }
    return true;
  }

  // ---- Anchor-click interception --------------------------------------------
  function interceptClick(event) {
    if (!event || !isRoutingActive()) return;

    // Locate the clicked anchor using the composed path (works across shadow
    // DOM), falling back to closest('a[href]').
    let anchor = null;
    if (typeof event.composedPath === 'function') {
      for (const node of event.composedPath()) {
        if (node && node.nodeType === 1 && node.tagName === 'A') {
          anchor = node;
          break;
        }
      }
    }
    if (!anchor && event.target && typeof event.target.closest === 'function') {
      anchor = event.target.closest('a[href]');
    }
    if (!anchor) return;

    const url = anchor.href || anchor.getAttribute('href');
    if (!url) return;
    const clean = sanitizePdfUrl(url);
    if (!clean || !isPdfLikeUrl(clean)) return;

    // Route this PDF anchor into the viewer instead of the native behavior
    // (download / Chrome's built-in viewer).
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    openInViewer(clean);
  }

  // ---- DOM walk -------------------------------------------------------------
  // Hook every PDF-pointing <embed>/<object>/<iframe> in (and under) root.
  // Anchors need no per-node work: their clicks are caught by the delegated
  // document-level listener above.
  function hookPdfLinks(root) {
    if (!isRoutingActive()) return;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const nodes = root.querySelectorAll('embed[src], object[data], iframe[src]');
    for (const el of nodes) {
      if (el.dataset && el.dataset.bionicRouterHandled === '1') continue;
      if (interceptEmbeddedPdf(el) && el.dataset) {
        el.dataset.bionicRouterHandled = '1';
      }
    }
  }

  // Re-hook embedded PDFs that are added to the DOM after initial load (SPAs,
  // lazy-loaded embeds, dynamically inserted frames).
  function observeDynamicPdfs() {
    if (typeof MutationObserver === 'undefined') return;
    let scheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (scheduled) return;
      scheduled = true;
      // Batch DOM mutations onto the next tick to avoid redundant walks.
      setTimeout(() => {
        scheduled = false;
        for (const mut of mutations) {
          if (mut.type === 'childList') {
            hookPdfLinks(mut.target);
            for (const added of mut.addedNodes) {
              if (added.nodeType === 1) hookPdfLinks(added);
            }
          }
        }
      }, 0);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---- Module entry point ---------------------------------------------------
  function initRouter(initialSettings) {
    if (initialSettings && typeof initialSettings === 'object') {
      settings = { ...DEFAULT_SETTINGS, ...initialSettings };
    }

    // Intercept PDF anchor clicks at the document level (capture phase so we
    // see them before any page-level handler and before navigation starts).
    document.addEventListener('click', interceptClick, true);

    // Replace any existing embedded PDFs, then watch for newly added ones.
    hookPdfLinks(document);

    // Keep settings fresh so toggling the extension in the popup immediately
    // affects routing without a reload.
    if (chrome && chrome.storage && chrome.storage.onChanged &&
        typeof chrome.storage.onChanged.addListener === 'function') {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') refreshSettings();
      });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', refreshSettings);
    }

    observeDynamicPdfs();
    refreshSettings().catch(() => {});
  }

  // Do not run on the extension's own pages (incl. the viewer itself).
  const isExtensionPage = typeof location !== 'undefined' &&
    /^chrome-extension:\/\//i.test(location.href);

  if (!isExtensionPage &&
      typeof document !== 'undefined' &&
      (document.readyState === 'complete' || document.readyState === 'interactive')) {
    initRouter();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => initRouter(), { once: true });
  }

  // Expose for manual/test use and for other modules during integration.
  if (typeof window !== 'undefined') {
    window.__bionicRouter = { initRouter, hookPdfLinks, isPdfLikeUrl, openInViewer };
  }
})();


