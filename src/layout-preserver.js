// Module 7 - Layout Preserver (position + no-shift guarantee).
//
// The central technical constraint (spec 2.3) is that every letter must keep its
// exact on-screen coordinate before and after bionic emphasis. The default
// emphasis strategies (stroke / highlight / shadow) are zero-layout-change, so
// glyph advance widths never move. This module is the *mandatory* runtime guard
// (the "Geometry Guard") that:
//   1. absolutely positions each glyph span at its exact PDF coordinate, and
//   2. measures each span's bounding rect after emphasis and, if and only if a
//      measurable displacement is detected, snaps its left/top back to the
//      intended PDF coordinate.
//
// Design notes:
//   * It never reaches into PDF.js internals; it consumes the already-extracted
//     text items (str + 2D transform) produced by the renderer (Module 5).
//   * It is DOM-optional: the geometry measurement functions accept an injectable
//     getBoundingClientRect so it can be unit-tested in Node without a browser.
//   * A guard that has never observed drift is in the "no-op" (zero-copy) path,
//     which is exactly the intended fast path for default emphasis.

(function (global) {
  'use strict';

  const EPS = 0.5; // px tolerance before we consider a span "moved"

  // Compose a PDF item's [a b c d e f] transform with the viewport's
  // [scaleX 0 0 scaleY offX offY] (top-left origin) to get screen-space
  // coordinates for the item's origin and font size. Returns
  // { x, y, fontSize, scaleX, scaleY }.
  function computePlacement(item, viewportTransform) {
    // General 2x2 affine composition of the PDF item transform [ta tb tc td te tf]
    // with the viewport transform [va vb vc vd ve vf] (which for PDF.js is
    // [s 0 0 -s 0 s*H] — note the NEGATIVE d for the y-axis flip). We cannot
    // assume a top-left [scaleX 0 0 scaleY offX offY] shape.
    const v = viewportTransform;
    const t = item.transform;
    const tx = [
      v[0] * t[0] + v[2] * t[1],  // a
      v[1] * t[0] + v[3] * t[1],  // b
      v[0] * t[2] + v[2] * t[3],  // c
      v[1] * t[2] + v[3] * t[3],  // d
      v[0] * t[4] + v[2] * t[5] + v[4], // e (screen x of origin)
      v[1] * t[4] + v[3] * t[5] + v[5]  // f (screen y of origin/baseline)
    ];
    const angle = Math.atan2(tx[1], tx[0]);
    // Font size (screen units) is the magnitude of the y-column of the composed
    // linear map — the true size of a glyph's vertical axis.
    const fontSize = Math.hypot(tx[2], tx[3]);
    const scaleX = Math.hypot(tx[0], tx[2]);
    const scaleY = Math.hypot(tx[1], tx[3]);
    return { x: tx[4], y: tx[5], fontSize, angle, scaleX, scaleY };
  }

  // ascentRatio is the fraction of the em box that sits above the baseline. The
  // caller supplies the PDF font's real ascent/descent (see Module 5 styles); the
  // fallback (0.8) matches historical PDF.js behavior when metrics are unavailable.
  function positionSpan(span, placement) {
    const ratio = (placement.ascentRatio !== undefined)
      ? placement.ascentRatio
      : 0.8;
    span.style.left = `${placement.x}px`;
    const ascent = placement.fontSize * ratio;
    span.style.top = `${placement.y - ascent}px`;
    span.style.fontSize = `${placement.fontSize}px`;
    span.style.transformOrigin = '0 0';
    if (placement.angle && Math.abs(placement.angle) > 1e-4) {
      span.style.transform = `rotate(${placement.angle}rad)`;
    } else {
      span.style.transform = '';
    }
  }
  // Read a span's on-screen geometry. `rectFn` defaults to getBoundingClientRect
  // and returns { left, top, width, height }. The parent's rect is subtracted so
  // the measurement is relative to the text layer (stable under page scroll).
  function measureSpan(span, parent, rectFn) {
    const getRect = rectFn || (typeof span.getBoundingClientRect === 'function'
      ? () => span.getBoundingClientRect()
      : () => ({ left: 0, top: 0, width: 0, height: 0 }));
    const r = getRect.call(span);
    let pr = { left: 0, top: 0 };
    if (parent && typeof parent.getBoundingClientRect === 'function') {
      pr = parent.getBoundingClientRect();
    }
    return {
      left: r.left - pr.left,
      top: r.top - pr.top,
      width: r.width,
      height: r.height
    };
  }

  function close(a, b, eps) {
    return Math.abs(a - b) <= (eps === undefined ? EPS : eps);
  }
  // ---- Horizontal advance correction --------------------------------------
  //
  // The overlay renders extracted text with a *substituted* CSS font, but the
  // PDF lays glyphs out with the *embedded* font. Those advances differ, and
  // because each text item is an independently positioned span the mismatch
  // accumulates as visible over-/under-spacing around runs that use a different
  // size or font - most obviously superscripts and subscripts (separate smaller
  // spans). PDF.js's own text layer fixes this by scaling each glyph run
  // horizontally so its rendered width equals the embedded font's advance
  // (item.width, in user-space points, scaled to screen px). We mirror that here.

  // Pure scale factor: how much to horizontally scale a run so a substituted
  // font of `measuredWidth` px matches the PDF's `intendedWidth` px advance.
  function computeHorizontalScaleFactor(intendedWidth, measuredWidth) {
    if (!Number.isFinite(intendedWidth) || !Number.isFinite(measuredWidth)) return NaN;
    if (intendedWidth <= 0 || measuredWidth <= 0) return NaN;
    const ratio = intendedWidth / measuredWidth;
    return Number.isFinite(ratio) ? ratio : NaN;
  }

  // Shared off-screen 2D context for measuring substituted-font advance widths.
  let _measureCtx = null;
  function measureTextWidth(text, fontFamily, fontSizePx) {
    if (!text || typeof document === 'undefined') return 0;
    let ctx = _measureCtx;
    if (!ctx) {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      _measureCtx = ctx;
    }
    const px = Number(fontSizePx) || 0;
    if (px <= 0) return 0;
    const family = fontFamily || 'serif';
    ctx.font = px + 'px ' + family;
    return ctx.measureText(String(text)).width;
  }

  // Scale a span horizontally so its substituted-font width matches the PDF's
  // intended px advance. Appends a scaleX(sx) to the existing transform (which
  // may be a rotate(...) from positioning) at origin 0 0, so base text left
  // stays put and only the glyph advance is corrected.
  function applyHorizontalScale(span, text, fontFamily, fontSizePx, intendedWidthPx) {
    if (!span || !span.style) return false;
    const measured = measureTextWidth(text, fontFamily, fontSizePx);
    const sx = computeHorizontalScaleFactor(intendedWidthPx, measured);
    if (!Number.isFinite(sx) || Math.abs(sx - 1) < 1e-3) return false;
    let existing = (span.style.transform || '').trim();
    span.style.transform = existing
      ? existing + ' scaleX(' + sx.toFixed(6) + ')'
      : 'scaleX(' + sx.toFixed(6) + ')';
    return true;
  }



  // Compare an item's intended origin against the measured geometry. Returns an
  // array of drift descriptors (one per violation); empty array means no drift.
  function detectDrift(intended, measured) {
    const drifts = [];
    // The guard is a position guard: it verifies the glyph origin's on-screen
    // coordinate. Width is intentionally not compared here. The PDF advance
    // (item.width) describes the *embedded* font while the overlay renders with
    // a substituted system font, so their pixel widths legitimately differ and
    // that is not a layout drift. Comparing them produced a false "drift" on
    // almost every span (the source of the "detected N drifts, corrected 0" noise).
    if (!close(intended.x, measured.left)) {
      drifts.push({ axis: 'x', intended: intended.x, actual: measured.left, diff: measured.left - intended.x });
    }
    if (!close(intended.y, measured.top)) {
      drifts.push({ axis: 'y', intended: intended.y, actual: measured.top, diff: measured.top - intended.y });
    }
    return drifts;
  }

  // The Geometry Guard. `spans` is an array of { span, intended } where intended
  // is a { x, y, width? } descriptor. After emphasis has been applied, it
  // measures every span and returns a report. When a non-zero X drift is found a
  // compensating scaleX transform is written to the span (only if compensate is
  // true). The return value is the aggregate report so callers can log/assert.
  function runGeometryGuard(spans, options) {
    const opts = options || {};
    const parent = opts.parent || null;
    const rectFn = opts.getBoundingClientRect || null;
    const compensate = opts.compensate !== false;

    const report = { checked: spans.length, drifts: [], compensated: [] };
    for (const entry of spans) {
      if (!entry || !entry.span) continue;
      const measured = measureSpan(entry.span, parent, rectFn);
      const intended = entry.intended || null;
      if (!intended) continue;
      const drifts = detectDrift(intended, measured);
      for (const d of drifts) {
        report.drifts.push({ span: entry.span, ...d });
        if (compensate && Math.abs(d.diff) > EPS) {
          // Re-assert the exact PDF coordinate. Default emphasis is zero-layout-
          // change, so a real drift means the span box moved and we snap its
          // origin straight back to the intended left/top pixel.
          const prop = d.axis === 'x' ? 'left' : 'top';
          entry.span.style[prop] = String(d.intended) + 'px';
          entry.span.dataset.bionicCompensated = String(d.intended);
          report.compensated.push({ span: entry.span, axis: d.axis, intended: d.intended });
        }
      }
    }
    return report;
  }

  // Convenience: position + measure a set of spans in one call. `items` is an
  // array of { span, intended } where intended is the placement descriptor from
  // computePlacement plus an optional width.
  function applyAndGuard(items, options) {
    const opts = options || {};
    if (opts.position !== false) {
      for (const it of items) {
        if (it && it.span && it.placement) positionSpan(it.span, it.placement);
      }
    }
    return runGeometryGuard(items.map((it) => ({ span: it.span, intended: it.intended || it.placement })), opts);
  }

  const BR = global.BR || (global.BR = {});
  BR.LayoutPreserver = Object.freeze({
    computePlacement,
    positionSpan,
    measureSpan,
    detectDrift,
    runGeometryGuard,
    applyAndGuard,
    computeHorizontalScaleFactor,
    measureTextWidth,
    applyHorizontalScale
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computePlacement,
      positionSpan,
      measureSpan,
      detectDrift,
      runGeometryGuard,
      applyAndGuard,
      computeHorizontalScaleFactor,
      measureTextWidth,
      applyHorizontalScale
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
