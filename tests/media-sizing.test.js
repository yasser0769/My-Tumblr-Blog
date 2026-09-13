const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function getThemeHtml() {
  return fs.readFileSync('Tumblr.html', 'utf8');
}

function getCssRule(selector) {
  const html = getThemeHtml();
  const rules = html.match(/[^{}]+{[^{}]*}/g) || [];

  const rule = rules.find((candidate) => {
    const selectorList = candidate
      .slice(0, candidate.indexOf('{'))
      .split(',')
      .map((part) => part.trim());

    return selectorList.includes(selector);
  });

  assert.ok(rule, `Expected CSS rule for selector "${selector}"`);
  return rule;
}

function assertDeclaration(rule, property, expectedValue) {
  const normalizedRule = rule.replace(/\s+/g, ' ');
  const normalizedExpected = expectedValue.replace(/\s+/g, ' ');

  assert.match(
    normalizedRule,
    new RegExp(`${property}\\s*:\\s*${normalizedExpected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    `Expected "${property}: ${expectedValue}" in ${rule}`
  );
}

test('post content images are constrained by viewport height without relying on generic post images', () => {
  const selectors = [
    '.posts > .media img',
    '.posts .header-posts figure.tmblr-full img',
    '.posts .header-posts .npf_row img',
  ];

  selectors.forEach((selector) => {
    const rule = getCssRule(selector);

    assertDeclaration(rule, 'max-height', 'min(82vh, 900px)');
    assertDeclaration(rule, 'width', 'auto');
    assertDeclaration(rule, 'height', 'auto');
    assertDeclaration(rule, 'object-fit', 'contain');
    assertDeclaration(rule, 'margin-inline', 'auto');
    assertDeclaration(rule, 'display', 'block');
  });

  const genericPostImageRule = getCssRule('.posts img');
  assert.doesNotMatch(genericPostImageRule, /max-height\s*:\s*min\(82vh,\s*900px\)/);
  assert.doesNotMatch(genericPostImageRule, /object-fit\s*:\s*contain/);
});

test('post videos and iframes are constrained without cropping or stretching', () => {
  const videoRule = getCssRule('.posts .header-posts figure.tmblr-full video');

  assertDeclaration(videoRule, 'max-height', 'min(78vh, 720px)');
  assertDeclaration(videoRule, 'width', 'auto');
  assertDeclaration(videoRule, 'max-width', '100%');
  assertDeclaration(videoRule, 'height', 'auto');
  assertDeclaration(videoRule, 'object-fit', 'contain');
  assertDeclaration(videoRule, 'margin-inline', 'auto');
  assertDeclaration(videoRule, 'display', 'block');

  const iframeRule = getCssRule('.media iframe');

  assertDeclaration(iframeRule, 'aspect-ratio', '16 / 9');
  assertDeclaration(iframeRule, 'max-height', 'min(70vh, 700px)');
  assertDeclaration(iframeRule, 'max-width', '100%');
  assertDeclaration(iframeRule, 'margin-inline', 'auto');
  assertDeclaration(iframeRule, 'display', 'block');
});

test('alt text controls are positioned inside an image-sized media frame', () => {
  const frameRule = getCssRule('.alt-text-media-frame');

  assertDeclaration(frameRule, 'position', 'relative');
  assertDeclaration(frameRule, 'display', 'block');
  assertDeclaration(frameRule, 'max-width', '100%');
  assertDeclaration(frameRule, 'margin-inline', 'auto');
  assertDeclaration(frameRule, 'line-height', '0');
  assertDeclaration(frameRule, 'margin-bottom', '20px');

  const framedImageRule = getCssRule('.alt-text-media-frame img');
  assertDeclaration(framedImageRule, 'margin-bottom', '0');

  const helperRule = getCssRule('.alt-text-media-frame .tmblr-alt-text-helper');
  assertDeclaration(helperRule, 'position', 'absolute !important');
  assertDeclaration(helperRule, 'left', '12px !important');
  assertDeclaration(helperRule, 'bottom', '12px !important');
  assertDeclaration(helperRule, 'z-index', '18');
});
