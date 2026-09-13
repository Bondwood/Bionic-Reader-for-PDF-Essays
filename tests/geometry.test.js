// Tests for Module 7 (Layout Preserver / Geometry Guard).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectDrift,
  runGeometryGuard,
  computeHorizontalScaleFactor
} = require('../src/layout-preserver.js');

test('no drift when measured geometry matches intended', () => {
  const intended = { x: 10, y: 20, width: 30 };
  const measured = { left: 10, top: 20, width: 30, height: 12 };
  assert.deepStrictEqual(detectDrift(intended, measured), []);
});

test('reports x and y drift when measured differs', () => {
  const intended = { x: 10, y: 20, width: 30 };
  const measured = { left: 14, top: 20, width: 30, height: 12 };
  const drifts = detectDrift(intended, measured);
  assert.strictEqual(drifts.length, 1);
  assert.strictEqual(drifts[0].axis, 'x');
  assert.strictEqual(drifts[0].diff, 4);
});

test('runGeometryGuard compensates positional drift back to the intended origin', () => {
  // Fake span whose getBoundingClientRect reports a shifted box.
  const span = {};
  const parent = {};
  const rectFn = () => ({ left: 12, top: 20, width: 45, height: 12 });
  span.style = {};
  span.dataset = {};

  const entries = [
    { span, intended: { x: 10, y: 20 } }
  ];

  // With compensation off -> drift reported, no correction written.
  const noComp = runGeometryGuard(entries, { parent, getBoundingClientRect: rectFn, compensate: false });
  assert.ok(noComp.drifts.length > 0);
  assert.strictEqual(noComp.compensated.length, 0);

  // With compensation on -> x drift snapped back to its intended left.
  const comp = runGeometryGuard(entries, { parent, getBoundingClientRect: rectFn, compensate: true });
  assert.strictEqual(comp.drifts.length > 0, true);
  assert.strictEqual(comp.compensated.length, 1);
  assert.strictEqual(span.style.left, '10px', 'x origin restored');
  assert.strictEqual(span.dataset.bionicCompensated, '10');
});

test('runGeometryGuard ignores width mismatch (embedded vs substituted font)', () => {
  // A span at the correct origin but a different rendered width is NOT a drift.
  const span = { style: {}, dataset: {} };
  const rectFn = () => ({ left: 10, top: 20, width: 999, height: 12 });
  const entries = [{ span, intended: { x: 10, y: 20 } }];
  const report = runGeometryGuard(entries, { getBoundingClientRect: rectFn, compensate: true });
  assert.strictEqual(report.drifts.length, 0);
  assert.strictEqual(report.compensated.length, 0);
});

test('sub-pixel drift within EPS is treated as no drift', () => {
  const intended = { x: 10, y: 20, width: 30 };
  const measured = { left: 10.2, top: 20.1, width: 30.3, height: 12 };
  assert.deepStrictEqual(detectDrift(intended, measured), []);
});
test('computeHorizontalScaleFactor corrects substituted-font advance', () => {
  // Superscript glyph: PDF advance 6.03px vs substituted-font 7.2px -> shrink.
  const sx = computeHorizontalScaleFactor(6.03, 7.2);
  assert.ok(Math.abs(sx - 6.03 / 7.2) < 1e-9);
  // Normal glyph matches -> factor ~1.
  assert.ok(Math.abs(computeHorizontalScaleFactor(9.702, 9.7) - 1) < 0.01);
});

test('computeHorizontalScaleFactor guards degenerate inputs', () => {
  assert.ok(Number.isNaN(computeHorizontalScaleFactor(0, 10)));
  assert.ok(Number.isNaN(computeHorizontalScaleFactor(10, 0)));
  assert.ok(Number.isNaN(computeHorizontalScaleFactor(-1, 10)));
  assert.ok(Number.isNaN(computeHorizontalScaleFactor(NaN, 10)));
  assert.ok(Number.isNaN(computeHorizontalScaleFactor(10, Infinity)));
});

