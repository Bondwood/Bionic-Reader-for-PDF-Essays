// Tests for Module 7 (Layout Preserver / Geometry Guard).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectDrift,
  runGeometryGuard
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

test('runGeometryGuard compensates x drift with scaleX only when enabled', () => {
  // Fake span whose getBoundingClientRect reports a shifted/wide box.
  const span = {};
  const parent = {};
  const rectFn = () => ({ left: 12, top: 20, width: 45, height: 12 });
  span.style = {};
  span.dataset = {};

  const entries = [
    { span, intended: { x: 10, y: 20, width: 30 } }
  ];

  // With compensation off -> drifts reported, no transform written.
  const noComp = runGeometryGuard(entries, { parent, getBoundingClientRect: rectFn, compensate: false });
  assert.ok(noComp.drifts.length > 0);
  assert.strictEqual(noComp.compensated.length, 0);

  // With compensation on -> drift corrected via scaleX.
  const comp = runGeometryGuard(entries, { parent, getBoundingClientRect: rectFn, compensate: true });
  assert.strictEqual(comp.drifts.length > 0, true);
  assert.strictEqual(comp.compensated.length, 1);
  assert.ok(/scaleX/.test(span.style.transform), 'scaleX compensation applied');
  assert.ok(span.dataset.bionicCompensated);
});

test('sub-pixel drift within EPS is treated as no drift', () => {
  const intended = { x: 10, y: 20, width: 30 };
  const measured = { left: 10.2, top: 20.1, width: 30.3, height: 12 };
  assert.deepStrictEqual(detectDrift(intended, measured), []);
});
