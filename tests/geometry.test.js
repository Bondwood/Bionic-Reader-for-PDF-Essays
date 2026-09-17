// Tests for Module 7 (Layout Preserver / Geometry Guard).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectDrift,
  runGeometryGuard,
  computeHorizontalScaleFactor,
  classifyScriptAgainstBase,
  findScriptBase
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

// ---- Sub/superscript detection (page-3 NMR formula fix) --------------------
// PDF.js emits a formula as several separate runs at different sizes and
// baselines: the body run at 12pt, subscripts at 8.52/7.98pt, superscripts at
// 7.02/7.98pt. Emphasis must skip those script runs (stroking them turns
// "v_ref" into "vref" and "10^6" into "106"). Detection is LOCAL: a run is a
// script only relative to an adjacent larger run, never by a page-wide size.

// Build a fake PDF.js text item: transform = [a, b, c, d, x, y] where the
// font size is hypot(c, d).
function item(str, size, x, y, width) {
  return { str, width: width === undefined ? str.length * size * 0.5 : width, transform: [size, 0, 0, size, x, y] };
}

test('classifyScriptAgainstBase labels a smaller lower run as subscript', () => {
  const base = item("ref", 12, 100, 300);
  // 8.52pt run sitting slightly BELOW the base baseline.
  const sub = item("ref", 8.52, 118, 298.2);
  assert.strictEqual(classifyScriptAgainstBase(sub, base), 'subscript');
});

test('classifyScriptAgainstBase labels a smaller higher run as superscript', () => {
  const base = item("10", 12, 300, 300);
  // 7.02pt run sitting ABOVE the base baseline (the "6" in 10^6).
  const sup = item("6", 7.02, 312, 304.2);
  assert.strictEqual(classifyScriptAgainstBase(sup, base), 'superscript');
});

test('classifyScriptAgainstBase returns null for a same-size run', () => {
  const base = item("body", 12, 100, 300);
  const same = item("more", 12, 120, 300);
  assert.strictEqual(classifyScriptAgainstBase(same, base), null);
});

test('classifyScriptAgainstBase returns null when a small run is on the same baseline', () => {
  // A smaller run at the same baseline is small text (caption/label), not a script.
  const base = item("Figure:", 12, 100, 300);
  const small = item("From Advanced Light Source", 7.98, 140, 300);
  assert.strictEqual(classifyScriptAgainstBase(small, base), null);
});

test('classifyScriptAgainstBase guards missing input', () => {
  const base = item("x", 12, 0, 0);
  assert.strictEqual(classifyScriptAgainstBase(null, base), null);
  assert.strictEqual(classifyScriptAgainstBase(base, null), null);
  assert.strictEqual(classifyScriptAgainstBase({}, base), null);
});

test('findScriptBase locates the adjacent larger run on the same line', () => {
  const body = item("v", 12, 100, 300);
  const sub = item("ref", 7.02, 112, 298.5, 12);
  const other = item("unrelated", 12, 400, 300); // far away, must be ignored
  const base = findScriptBase(sub, [body, sub, other]);
  assert.strictEqual(base, body);
});

test('findScriptBase ignores far-away and differently-sized candidates', () => {
  const sub = item("ref", 7.02, 112, 300, 12);
  const far = item("distant", 12, 900, 300);
  assert.strictEqual(findScriptBase(sub, [sub, far]), null);
  // Same-size neighbour is not a base.
  const peer = item("peer", 7.02, 130, 300);
  assert.strictEqual(findScriptBase(sub, [sub, peer]), null);
});

test('findScriptBase returns null for an item without usable transform', () => {
  assert.strictEqual(findScriptBase({}, []), null);
  assert.strictEqual(findScriptBase(null, []), null);
});

test('page-3 formula: every script run is classified and the body run is not', () => {
  // Representative geometry taken from the page-3 NMR formula.
  const bodyRun = item("10", 12, 300, 299.94, 12);        // body-size math run
  const subRef = item("ref", 7.02, 312, 306.0, 12);       // superscripted "ref"
  const supSix = item("6", 8.52, 328, 304.32, 5);         // the "6" in 10^6
  const subLater = item("ref)", 7.98, 200, 249.6, 30);    // subscript "ref)"
  const textBase = item("the absolute", 12, 234, 252, 60);
  const items = [bodyRun, subRef, supSix, subLater, textBase];

  // The small "ref" attaches to the nearby body run and is a superscript.
  assert.strictEqual(classifyScriptAgainstBase(subRef, findScriptBase(subRef, items)), 'superscript');
  assert.strictEqual(classifyScriptAgainstBase(supSix, findScriptBase(supSix, items)), 'superscript');
  assert.strictEqual(classifyScriptAgainstBase(subLater, findScriptBase(subLater, items)), 'subscript');
  // Full-size runs must never be reclassified as scripts.
  assert.strictEqual(classifyScriptAgainstBase(bodyRun, findScriptBase(bodyRun, items)), null);
  assert.strictEqual(classifyScriptAgainstBase(textBase, findScriptBase(textBase, items)), null);
});

test('page-3 formula: fraction numerator is a script (no stretch)', () => {
  // Representative page-3 geometry: sigma_obs at 12pt, the fraction numerator
  // 'nu - nu' at 8.52pt sitting 7.86pt above the 12pt baseline. The earlier
  // 0.6*base band (7.2pt) missed it, so the numerator was mis-scaled and
  // visibly cramped while its 'ref' subscript floated free.
  const sigma = item('sigmaobs =', 12, 123.3, 299.94, 33.38);
  const numerator = item('nu - nu', 8.52, 162.66, 307.80, 13.76);
  const base = findScriptBase(numerator, [sigma, numerator]);
  assert.ok(base, 'the numerator must attach to the sigma_obs base run');
  assert.strictEqual(classifyScriptAgainstBase(numerator, base), 'superscript');
});

test('page-3 formula: denominator nu_ref is a script too', () => {
  const sigma = item('sigmaobs =', 12, 123.3, 299.94, 33.38);
  const denom = item('nu ref', 8.52, 170.16, 293.88, 17.36);
  const base = findScriptBase(denom, [sigma, denom]);
  assert.ok(base);
  assert.strictEqual(classifyScriptAgainstBase(denom, base), 'subscript');
});
