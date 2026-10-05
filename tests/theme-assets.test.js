const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getThemeHtml } = require('./helpers');

test('theme assets use HTTPS without inline data or HTTP references', () => {
  const html = getThemeHtml();
  assert.doesNotMatch(html, /http:\/\/|data:(?:font|image)\//i);

  const urls = [...html.matchAll(/url\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
  for (const url of urls) {
    assert.ok(url.startsWith('https://'), `Asset must use HTTPS: ${url}`);
    if (url.endsWith('.woff2')) {
      const font = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', path.basename(url)));
      assert.equal(font.subarray(0, 4).toString(), 'wOF2');
    }
  }
  assert.equal(urls.filter(url => url.endsWith('.woff2')).length, 7);
});
