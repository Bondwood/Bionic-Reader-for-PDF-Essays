// Tests for Module 12 (Security / URL validation).
// Run with: node --test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isAllowedScheme,
  isRejectedScheme,
  looksLikePdf,
  isPdfLikeUrl,
  sanitizePdfUrl,
  sanitizeSource,
  sanitizeExternalLink
} = require('../src/security.js');

test('allowed schemes: http, https, file', () => {
  assert.strictEqual(isAllowedScheme('https://a.com/x.pdf'), true);
  assert.strictEqual(isAllowedScheme('http://a.com/x.pdf'), true);
  assert.strictEqual(isAllowedScheme('file:///c/tmp/x.pdf'), true);
  assert.strictEqual(isAllowedScheme('ftp://a/x'), false);
  assert.strictEqual(isAllowedScheme(''), false);
});

test('rejected schemes: data, javascript, blob, chrome-extension', () => {
  assert.strictEqual(isRejectedScheme('data:text/html,hi'), true);
  assert.strictEqual(isRejectedScheme('javascript:alert(1)'), true);
  assert.strictEqual(isRejectedScheme('blob:https://a/x'), true);
  assert.strictEqual(isRejectedScheme('chrome-extension://abc/viewer.html'), true);
  assert.strictEqual(isRejectedScheme('https://a/x.pdf'), false);
});

test('looksLikePdf detects .pdf (with query, strips fragment)', () => {
  assert.strictEqual(looksLikePdf('https://a.com/doc.pdf'), true);
  assert.strictEqual(looksLikePdf('https://a.com/doc.pdf?page=2'), true);
  assert.strictEqual(looksLikePdf('https://a.com/doc.PDF'), true);
  assert.strictEqual(looksLikePdf('https://a.com/doc.pdf#frag'), true);
  assert.strictEqual(looksLikePdf('https://a.com/doc.txt'), false);
});

test('isPdfLikeUrl requires allowed scheme + pdf', () => {
  assert.strictEqual(isPdfLikeUrl('https://a.com/doc.pdf'), true);
  assert.strictEqual(isPdfLikeUrl('data:application/pdf,doc.pdf'), false);
  assert.strictEqual(isPdfLikeUrl('https://a.com/doc.txt'), false);
});

test('sanitizePdfUrl returns trimmed url or null', () => {
  assert.strictEqual(sanitizePdfUrl(' https://a.com/doc.pdf '), 'https://a.com/doc.pdf');
  assert.strictEqual(sanitizePdfUrl('javascript:alert(1)'), null);
  assert.strictEqual(sanitizePdfUrl('chrome-extension://x/viewer.html'), null);
  assert.strictEqual(sanitizePdfUrl(''), null);
  assert.strictEqual(sanitizePdfUrl(null), null);
});

test('sanitizeSource distinguishes url vs file kinds', () => {
  assert.strictEqual(sanitizeSource('https://a.com/doc.pdf', 'url'), 'https://a.com/doc.pdf');
  assert.strictEqual(sanitizeSource('file:///c/a.pdf', 'file'), 'file:///c/a.pdf');
  assert.strictEqual(sanitizeSource('https://a.com/doc.pdf', 'file'), null);
  assert.strictEqual(sanitizeSource('data:x', 'url'), null);
});


test('sanitizeExternalLink permits http, https, mailto and tel', () => {
  assert.strictEqual(sanitizeExternalLink('https://a.com/doc'), 'https://a.com/doc');
  assert.strictEqual(sanitizeExternalLink(' http://a.com/x '), 'http://a.com/x');
  assert.strictEqual(sanitizeExternalLink('mailto:reader@example.com'), 'mailto:reader@example.com');
  assert.strictEqual(sanitizeExternalLink('tel:+8613800000000'), 'tel:+8613800000000');
});

test('sanitizeExternalLink rejects active and local schemes', () => {
  assert.strictEqual(sanitizeExternalLink('javascript:alert(1)'), null);
  assert.strictEqual(sanitizeExternalLink('data:text/html,x'), null);
  assert.strictEqual(sanitizeExternalLink('blob:https://a/x'), null);
  assert.strictEqual(sanitizeExternalLink('file:///c/secret.txt'), null);
  assert.strictEqual(sanitizeExternalLink('chrome-extension://abc/x.html'), null);
  assert.strictEqual(sanitizeExternalLink('ftp://a/x'), null);
  assert.strictEqual(sanitizeExternalLink(''), null);
  assert.strictEqual(sanitizeExternalLink(null), null);
});
