const assert = require('node:assert/strict');
const test = require('node:test');
const { getThemeHtml } = require('./helpers');

test('theme assets use HTTPS without inline data or HTTP references', () => {
  const html = getThemeHtml();
  assert.doesNotMatch(html, /http:\/\/|data:(?:font|image)\//i);

  const urls = [...html.matchAll(/url\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
  for (const url of urls) {
    assert.ok(url.startsWith('https://'), `Asset must use HTTPS: ${url}`);
  }
  const fontFaces = [...html.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.equal(fontFaces.length, 7);
  for (const face of fontFaces) {
    assert.match(face, /src:\s*url\('https:\/\/static\.tumblr\.com\/[^']+\.otf'\)\s*format\('opentype'\)/);
  }
});
