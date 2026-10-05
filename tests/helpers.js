// Shared test helpers. The theme is a single 180 KB file, so it is read and
// indexed once here instead of on every assertion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEME_HTML = fs.readFileSync(path.join(__dirname, '..', 'Tumblr.html'), 'utf8');

// Only the stylesheet blocks are tokenised, and comments are stripped first:
// the theme documents the bugs it fixes by naming the old declarations
// (e.g. "was max-height: 700px here"), and a naive `{...}` match would read
// that prose as a real declaration — and let a comment pollute the selector.
const THEME_CSS = THEME_HTML.slice(THEME_HTML.indexOf('<style'), THEME_HTML.lastIndexOf('</style>')).replace(
  /\/\*[\s\S]*?\*\//g,
  ' '
);

// selector -> first rule whose selector list contains it (first-match-wins,
// so a rule inside a media query never shadows its base rule).
function indexRules(css) {
  const index = new Map();
  for (const rule of css.match(/[^{}]+{[^{}]*}/g) || []) {
    for (const selector of rule.slice(0, rule.indexOf('{')).split(',')) {
      const key = selector.trim();
      if (!index.has(key)) index.set(key, rule);
    }
  }
  return index;
}

const THEME_RULES = indexRules(THEME_CSS);

function getThemeHtml() {
  return THEME_HTML;
}

function getThemeCss() {
  return THEME_CSS;
}

function getCssRule(selector) {
  const rule = THEME_RULES.get(selector);
  assert.ok(rule, `Expected CSS rule for selector "${selector}"`);
  return rule;
}

function getCssRuleIn(css, selector) {
  return indexRules(css).get(selector);
}

// Concatenates the contents of every `@media screen and (max-width: Npx)`
// block, so a rule that lives inside a media query can be inspected even
// though `getCssRule` would return the base rule.
function getMediaBlock(maxWidth) {
  const css = THEME_CSS;
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

function assertDeclaration(rule, property, expectedValue) {
  const normalize = (text) => text.replace(/\s*:\s*/g, ': ').replace(/\s+/g, ' ');

  assert.ok(
    normalize(rule).includes(`${property}: ${normalize(expectedValue)}`),
    `Expected "${property}: ${expectedValue}" in ${rule}`
  );
}

// Returns the body of the first inline <script> whose opening matches
// `pattern` (a regex starting at `<script>`), without the tags.
function getInlineScript(pattern, label) {
  const match = THEME_HTML.match(pattern);
  assert.ok(match, `Could not find the ${label} script in Tumblr.html`);
  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

module.exports = {
  getThemeHtml,
  getThemeCss,
  getCssRule,
  getCssRuleIn,
  getMediaBlock,
  assertDeclaration,
  getInlineScript,
};
