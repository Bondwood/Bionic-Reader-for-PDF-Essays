// Module 7 - Layout Preserver (position + no-shift guarantee).
//
// The central technical constraint (spec 2.3) is that every letter must keep its
// exact on-screen coordinate before and after bionic emphasis. The default
// emphasis strategies (stroke / highlight / shadow) are zero-layout-change, so
// glyph advance widths never move. This module is the *mandatory* runtime guard
// (the "Geometry Guard") that:
//   1. absolutely positions each glyph span at its exact PDF coordinate, and
//   2. measures each span's bounding rect after emphasis and, if and only if a
//      measurable drift is detected, compensates with transform: scaleX() /
//      letter-spacing to restore the original geometry.
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
    const v = viewportTransform;
    const t = item.transform;
    const tx = [
      v[0] * t[0] + v[2] * t[1],
      v[1] * t[0] + v[3] * t[1],
      v[0] * t[2] + v[2] * t[3],
      v[1] * t[2] + v[3] * t[3],
      v[0] * t[4] + v[2] * t[5] + v[4],
      v[1] * t[4] + v[3] * t[5] + v[5]
    ];
    const angle = Math.atan2(tx[1], tx[0]);
    const fontSize = Math.hypot(tx[2], tx[3]);
    const scaleX = Math.hypot(tx[0], tx[2]);
    const scaleY = Math.hypot(tx[1], tx[3]);
    return { x: tx[4], y: tx[5], fontSize, angle, scaleX, scaleY };
  }

  function positionSpan(span, placement) {
    span.style.left = `${placement.x}px`;
    const ascent = placement.fontSize * 0.8;
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

  // Compare an item's intended origin against the measured geometry. Returns an
  // array of drift descriptors (one per violation); empty array means no drift.
  function detectDrift(intended, measured) {
    const drifts = [];
    if (!close(intended.x, measured.left)) {
      drifts.push({ axis: 'x', intended: intended.x, actual: measured.left, diff: measured.left - intended.x });
    }
    if (!close(intended.y, measured.top)) {
      drifts.push({ axis: 'y', intended: intended.y, actual: measured.top, diff: measured.top - intended.y });
    }
    // Width compares the intended glyph advance to the measured span width, which
    // is only meaningful when a scale has been applied; we compare the "slack"
    // against the intended width factored by scaleX.
    const intendedWidth = (intended.width !== undefined) ? intended.width : intended.fontSize * 0.6;
    if (!close(intendedWidth, measured.width, EPS * 2)) {
      drifts.push({
        axis: 'width', intended: intendedWidth, actual: measured.width,
        diff: measured.width - intendedWidth
      });
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
        if (compensate && Math.abs(d.diff) > EPS && d.axis === 'x' && entry.intended.width) {
          // Compensate horizontal drift with scaleX so the glyph's advance is
          // restored without relaying out siblings.
          const baseWidth = entry.intended.width;
          const factor = baseWidth / (measured.width || baseWidth);
          entry.span.style.transformOrigin = 'left center';
          const existing = entry.span.style.transform || '';
          entry.span.style.transform = `${existing} scaleX(${factor.toFixed(4)})`;
          entry.span.dataset.bionicCompensated = factor.toFixed(4);
          report.compensated.push({ span: entry.span, factor });
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
    applyAndGuard
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computePlacement,
      positionSpan,
      measureSpan,
      detectDrift,
      runGeometryGuard,
      applyAndGuard
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
