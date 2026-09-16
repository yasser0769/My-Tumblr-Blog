const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

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
  // max-height clamp used to break the ratio and leave a large blank gap. The
  // dimensions must stay intact: the player's inner <video> is pinned to the
  // injected height by its own `height` attribute, so shrinking the frame to
  // the column width pushes the control bar out of the visible viewport.
  const containerRule = getCssRule('.tumblr_video_container');

  assert.doesNotMatch(
    containerRule,
    /max-height/,
    '.tumblr_video_container must not clamp max-height: it breaks the video ratio'
  );
  assertDeclaration(containerRule, 'max-width', '100%');

  // The ratio is handled by the inline script (it pins the native size and
  // scales optically), so the iframe must fill that container instead of
  // forcing 16:9 and a 70vh cap on it.
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

// ---------------------------------------------------------------- video fit

function getVideoFitScript() {
  const html = getThemeHtml();
  const match = html.match(/<script>\s*\/\* مشغّل فيديو تمبلر[\s\S]*?<\/script>/);

  assert.ok(match, 'Could not find the video fit script in Tumblr.html');
  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

// A container as Tumblr renders it: pixel dimensions in `style`, and the player
// iframe carrying the same numbers in `data-width` / `data-height`.
function makeVideoContainer(nativeWidth, nativeHeight, columnWidth) {
  const style = {
    width: nativeWidth + 'px',
    height: nativeHeight + 'px',
  };

  const frame = {
    dataset: { width: String(nativeWidth), height: String(nativeHeight) },
    getAttribute(name) {
      if (name === 'width') return String(nativeWidth);
      if (name === 'height') return String(nativeHeight);
      return null;
    },
  };

  const classes = new Set();

  return {
    style,
    dataset: {},
    tagName: 'DIV',
    parentElement: { clientWidth: columnWidth },
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    },
    classes,
    querySelector: (selector) => (selector === 'iframe' ? frame : null),
  };
}

function runVideoFitScript({ containers, supportsZoom = true, withResizeObserver = true }) {
  const resizeObservers = [];
  const windowListeners = {};

  const context = {
    document: {
      querySelectorAll: (selector) => (selector === '.tumblr_video_container' ? containers : []),
    },
    window: {
      addEventListener(event, callback) {
        windowListeners[event] = callback;
      },
    },
    CSS: { supports: () => supportsZoom },
    console,
  };

  if (withResizeObserver) {
    context.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        resizeObservers.push(this);
      }
      observe(element) {
        this.element = element;
      }
      disconnect() {}
    };
  }

  vm.runInNewContext(getVideoFitScript(), context);

  return { resizeObservers, windowListeners };
}

test('the video player keeps its native size and is scaled optically, not shrunk', () => {
  // Shrinking the frame is what broke playback: inside the iframe the <video>
  // keeps `height: 1237px` from its own height attribute, so at a 359px frame
  // the video box (359x1237) was twice as tall as the 634px viewport, its
  // controls landed at y≈1197 (off-screen) and nothing could be played.
  const box = makeVideoContainer(700, 1237, 578);
  runVideoFitScript({ containers: [box] });

  const scale = 578 / 700;

  assert.equal(
    box.style.width,
    '700px',
    'The container must keep Tumblr\'s native width so the player keeps its layout'
  );
  assert.equal(box.style.height, '1237px', 'The container must keep Tumblr\'s native height');
  assert.equal(
    box.style.maxWidth,
    'none',
    'max-width: 100% would clamp the container to the column width and break the player'
  );
  assert.equal(box.style.zoom, String(scale), 'The player must be scaled down with zoom');
  assert.equal(box.classes.has('is-ratio-set'), true, 'The scaled state must be flagged in CSS');

  // Regression guard: the old script rewrote the width to 100% and let the
  // iframe inherit the column width.
  assert.doesNotMatch(
    getVideoFitScript(),
    /style\.width\s*=\s*'100%'/,
    'The container must never be shrunk to 100%: the player cannot reflow its video box'
  );
});

test('the video player is re-scaled when its column changes width', () => {
  const box = makeVideoContainer(700, 1237, 578);
  const { resizeObservers } = runVideoFitScript({ containers: [box] });

  assert.equal(resizeObservers.length, 1, 'The column should be observed for width changes');
  assert.equal(resizeObservers[0].element, box.parentElement);

  // A phone-width column (the wrapper drops its padding at <=768px).
  box.parentElement.clientWidth = 294;
  resizeObservers[0].callback();

  assert.equal(box.style.zoom, String(294 / 700), 'zoom must follow the new column width');
  assert.equal(box.style.width, '700px', 'the native layout size must not change');
});

test('the video player falls back to transform for browsers without zoom', () => {
  // `zoom` is what keeps the iframe viewport at its native size; without it we
  // scale optically with transform and take the leftover layout height out of
  // the bottom margin, so the caption does not sit a whole frame lower.
  const box = makeVideoContainer(700, 1237, 578);
  runVideoFitScript({ containers: [box], supportsZoom: false });

  const scale = 578 / 700;

  assert.equal(box.style.zoom, '', 'zoom must not be applied when unsupported');
  assert.equal(box.style.transform, `scale(${scale})`);
  assert.equal(box.style.transformOrigin, 'top right');
  assert.equal(box.style.marginBottom, (-(1237 * (1 - scale))).toFixed(2) + 'px');
  assert.equal(box.style.width, '700px');
});

test('a video container without injected dimensions is left untouched', () => {
  const box = makeVideoContainer(700, 1237, 578);
  delete box.dataset.videoWidth;
  box.querySelector = () => null;
  box.style.width = '';
  box.style.height = '';
  box.parentElement.clientWidth = 578;

  runVideoFitScript({ containers: [box] });

  assert.equal(box.style.zoom, undefined, 'Nothing may be scaled without a known native size');
  assert.equal(box.classes.has('is-ratio-set'), false);
});
