// Module 8 - Media Preserver.
//
// Guarantees that every raster image and vector graphic drawn by the PDF's paint
// canvas remains bit-for-bit visually unchanged (spec G5) and that the bionic
// text layer is stacked ABOVE the canvas while remaining visually transparent
// except for the glyphs (spec G6 / 3.3 z-order).
//
// Responsibilities:
//   * Create the paint canvas and NEVER touch its pixel data after render.
//   * Establish the stacking context (canvas z0 < text layer z2) so the overlay
//     sits above the artwork but transparent regions let images show through.
//   * Expose helpers for building a page frame with the correct z-order.
//
// The module is DOM-oriented but small helpers are isolated for unit tests.

(function (global) {
  'use strict';

  // Z-indices per spec 3.3.
  const Z = Object.freeze({
    CANVAS: 0,
    ANNOTATION: 1,
    TEXT_LAYER: 2
  });

  // Create the low-level paint canvas at the desired pixel size. Returns the
  // canvas element and its 2D context. The canvas is marked with a data attribute
  // so the media preserver (and any later audit) can recognize it as untouchable
  // artwork.
  function createPaintCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    canvas.className = 'pdf-canvas';
    canvas.dataset.bionicMedia = 'paint-canvas'; // never modify pixels after this
    const ctx = canvas.getContext('2d', { alpha: false });
    return { canvas, ctx };
  }

  // Create a page frame element with the correct stacked children already in
  // place: [paint canvas (z0), annotation layer (z1, optional), text layer (z2)].
  // Returns { frame, canvas, ctx, textLayer, annotationLayer? }.
  function createPageFrame(width, height) {
    const frame = document.createElement('div');
    frame.className = 'pdf-page';
    frame.style.width = `${Math.ceil(width)}px`;
    frame.style.height = `${Math.ceil(height)}px`;

    const { canvas, ctx } = createPaintCanvas(width, height);
    canvas.style.zIndex = String(Z.CANVAS);
    frame.appendChild(canvas);

    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.style.width = `${Math.ceil(width)}px`;
    textLayer.style.height = `${Math.ceil(height)}px`;
    textLayer.style.zIndex = String(Z.TEXT_LAYER);
    frame.appendChild(textLayer);

    return { frame, canvas, ctx, textLayer };
  }

  // Assert that a canvas has not been re-sized or had its pixel buffer replaced
  // by a pointer comparison. Because canvas contexts cannot be detached in
  // modern browsers, we detect the common failure mode: width/height changed.
  // Returns true if the canvas looks unmodified.
  function isCanvasUntouched(canvas, expectedWidth, expectedHeight) {
    if (!canvas) return false;
    if (!closeNum(canvas.width, expectedWidth)) return false;
    if (!closeNum(canvas.height, expectedHeight)) return false;
    return true;
  }

  function closeNum(a, b, eps) {
    return Math.abs(a - b) <= (eps === undefined ? 1 : eps);
  }

  const BR = global.BR || (global.BR = {});
  BR.Media = Object.freeze({
    Z,
    createPaintCanvas,
    createPageFrame,
    isCanvasUntouched
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Z, createPaintCanvas, createPageFrame, isCanvasUntouched };
  }
})(typeof window !== 'undefined' ? window : globalThis);
