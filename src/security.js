// Module 12 - Security / URL validation.
//
// Central, defense-in-depth validation used by the background worker, the PDF
// router content script, and the viewer page:
//   * Only http(s) and (optionally) file:// URLs are ever routed or fetched.
//   * data:, javascript:, blob:, and chrome/chrome-extension: URLs are always
//     rejected before routing or opening.
//
// It exports pure functions only; it performs no I/O and declares no globals
// beyond the BR.* namespace so it is safe to load in any context (content
// script, extension page, service worker, or Node tests).

(function (global) {
  'use strict';

  // Schemes that are safe to route / fetch. file:// is included but only
  // honored when the user has granted the "Allow access to file URLs"
  // permission; the browser enforces that at fetch time.
  const ALLOWED_PROTO_RE = /^(https?|file):\/\//i;

  // Schemes that are always dangerous to route / fetch.
  const REJECTED_PROTO_RE = /^(data|javascript|blob):/i;
  const EXTENSION_SCHEME_RE = /^chrome(-extension)?:\/\//i;

  // Heuristic for "this URL points at a PDF": a path segment ending in .pdf,
  // optionally followed by a query string. Header-based signals (Content-Type:
  // application/pdf) cannot be read by a content script and are resolved by the
  // background worker during navigation routing.
  function isAllowedScheme(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    return ALLOWED_PROTO_RE.test(url);
  }

  function isRejectedScheme(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    return REJECTED_PROTO_RE.test(url) || EXTENSION_SCHEME_RE.test(url);
  }

  function looksLikePdf(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    const path = url.replace(/#.*$/, '');
    return /\.pdf(?:\?[^#]*)?$/i.test(path);
  }

  // Combined PDF heuristic: allowed + not rejected + looks like a .pdf.
  function isPdfLikeUrl(url) {
    if (typeof url !== 'string') return false;
    if (isRejectedScheme(url)) return false;
    if (!isAllowedScheme(url)) return false;
    return looksLikePdf(url);
  }

  // Validate + sanitize a candidate PDF URL. Returns the trimmed absolute URL
  // string if it may be routed, or null if it must not be routed.
  function sanitizePdfUrl(url) {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (isRejectedScheme(trimmed)) return null;
    if (!isAllowedScheme(trimmed)) return null;
    return trimmed;
  }

  // Validate a viewer source by kind. kind is 'url' (default) or 'file'.
  function sanitizeSource(raw, kind) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (isRejectedScheme(trimmed)) return null;
    if (kind === 'file') return /^file:\/\//i.test(trimmed) ? trimmed : null;
    return isAllowedScheme(trimmed) ? trimmed : null;
  }

  const BR = global.BR || (global.BR = {});
  BR.Security = Object.freeze({
    isAllowedScheme,
    isRejectedScheme,
    looksLikePdf,
    isPdfLikeUrl,
    sanitizePdfUrl,
    sanitizeSource
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isAllowedScheme,
      isRejectedScheme,
      looksLikePdf,
      isPdfLikeUrl,
      sanitizePdfUrl,
      sanitizeSource
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
