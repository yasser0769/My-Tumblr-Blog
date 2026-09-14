const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function getThemeHtml() {
  return fs.readFileSync('Tumblr.html', 'utf8');
}

// Comments are stripped before rules are matched. The theme documents the bugs
// it fixes by naming the old declarations (e.g. "was max-height: 700px here"),
// and a naive `{...}` match would otherwise read that prose as a real
// declaration — and let a comment pollute the selector text.
function getThemeCss() {
  return getThemeHtml().replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function getCssRule(selector) {
  const css = getThemeCss();
  const rules = css.match(/[^{}]+{[^{}]*}/g) || [];

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

// Concatenates the contents of every `@media screen and (max-width: Npx)`
// block, so a rule that lives inside a media query can be inspected even
// though `getCssRule` is first-match-wins and would return the base rule.
function getMediaBlock(css, maxWidth) {
  const marker = `@media screen and (max-width: ${maxWidth}px)`;
  let block = '';
  let index = css.indexOf(marker);

  while (index !== -1) {
    const open = css.indexOf('{', index);
    let depth = 0;
    let i = open;

    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    block += `\n${css.slice(open + 1, i)}`;
    index = css.indexOf(marker, i);
  }

  return block;
}

function getCssRuleIn(css, selector) {
  const rules = css.match(/[^{}]+{[^{}]*}/g) || [];

  return rules.find((candidate) => {
    const selectorList = candidate
      .slice(0, candidate.indexOf('{'))
      .split(',')
      .map((part) => part.trim());

    return selectorList.includes(selector);
  });
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

test('.header-posts does not reserve empty space in posts without text', () => {
  // It renders in EVERY post, but only receives content for Text/Link/Quote/
  // Chat. A min-height here became 160px of dead space inside every photo,
  // video, audio and answer post.
  const rule = getCssRule('.header-posts');

  assert.doesNotMatch(
    rule,
    /min-height/,
    '.header-posts must not reserve a min-height: it is empty in media posts'
  );
  assert.doesNotMatch(
    rule,
    /padding-bottom/,
    '.header-posts must not reserve padding-bottom: it is empty in media posts'
  );

  // Spacing is applied only when the wrapper actually holds something.
  const withContent = getCssRule('.header-posts:has(*)');
  assertDeclaration(withContent, 'margin-bottom', '24px');

  const withoutContent = getCssRule('.header-posts:not(:has(*))');
  assertDeclaration(withoutContent, 'display', 'none');
});

test('the video player keeps the video aspect ratio instead of a fixed 16:9 window', () => {
  // Tumblr injects the real pixel dimensions into the container's style, so a
  // max-height clamp used to break the ratio and leave a large blank gap.
  const containerRule = getCssRule('.tumblr_video_container');

  assert.doesNotMatch(
    containerRule,
    /max-height/,
    '.tumblr_video_container must not clamp max-height: it breaks the video ratio'
  );
  assertDeclaration(containerRule, 'max-width', '100%');

  // The ratio is applied by the inline script once it has read the dimensions,
  // so the iframe must stop forcing 16:9 on that element.
  const playerFrameRule = getCssRule('.tumblr_video_container.is-ratio-set iframe');
  assertDeclaration(playerFrameRule, 'aspect-ratio', 'auto');
  assertDeclaration(playerFrameRule, 'max-height', 'none');
});

test('figure margins are reset so images fill the post column', () => {
  // The UA default `figure { margin: 1em 40px }` narrowed every image inside a
  // text post to 224px in a 304px column and doubled the vertical spacing.
  const rule = getCssRule('.posts figure');

  assertDeclaration(rule, 'margin', '0 0 20px');

  const imageRule = getCssRule('.posts figure img');
  assertDeclaration(imageRule, 'margin-bottom', '12px');
});

test('the header description keeps a gap under the hero image on mobile', () => {
  // The base rule pulls the description up with `margin: -30px 0 30px 0`. That
  // is tuned for the desktop `--wrapper-pad-y: 70px`, leaving 40px of air under
  // the hero. At <=768px the wrapper padding drops to 26px, so the same -30px
  // put the description 4px ABOVE the hero's bottom edge and the title looked
  // glued to the image (measured gap: -4px before, +34px after the override).
  const base = getCssRule('.header-description');
  assertDeclaration(base, 'margin', '-30px 0 30px 0');

  const mobile = getCssRuleIn(getMediaBlock(getThemeCss(), 768), '.header-description');
  assert.ok(mobile, 'Expected a .header-description override in the 768px media query');

  const marginTop = /margin-top\s*:\s*(-?[\d.]+)px/.exec(mobile.replace(/\s+/g, ' '));
  assert.ok(marginTop, 'Expected an explicit margin-top in the mobile .header-description rule');
  assert.ok(
    Number(marginTop[1]) >= 0,
    `Mobile .header-description margin-top must not be negative (got ${marginTop[1]}px): ` +
      'it cancels the reduced wrapper padding and glues the title to the hero image'
  );
});
