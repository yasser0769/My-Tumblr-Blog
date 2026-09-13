const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function getThemeHtml() {
  return fs.readFileSync('Tumblr.html', 'utf8');
}

function assertIncludes(html, expected) {
  assert.ok(html.includes(expected), `Expected Tumblr.html to include: ${expected}`);
}

test('pagination uses previous and next page controls without numeric jump links', () => {
  const html = getThemeHtml();

  assertIncludes(html, '<meta name="text:Next" content="التالي">');
  assertIncludes(html, '<meta name="text:Old" content="السابق">');
  assert.doesNotMatch(html, /block:JumpPagination/);
  assert.doesNotMatch(html, /{PageNumber}/);
  assertIncludes(html, 'class="pagination__link pagination__link--next"');
  assertIncludes(html, 'class="pagination__link pagination__link--previous"');
});

test('blog word is styled as a signature in the header and footer', () => {
  const html = getThemeHtml();

  assertIncludes(html, '<span class="brand-kicker">مدونة</span>');
  assertIncludes(html, '<span class="brand-name">ياسر الشهري</span>');
  assertIncludes(html, '<span class="footer-signature__kicker">مدونة</span>');
  assertIncludes(html, '<span class="footer-signature__name">ياسر الشهري</span>');
  assertIncludes(html, 'class="footer-years"');
});
