const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { getInlineScript, getThemeCss } = require('./helpers');

function getFirstInlineScript() {
  return getInlineScript(
    /<script>\s*document\.addEventListener\("DOMContentLoaded"[\s\S]*?<\/script>/,
    'DOMContentLoaded localization'
  );
}

function getShareControlScript() {
  return getInlineScript(/<script>\s*\/\* قائمة المشاركة[\s\S]*?<\/script>/, 'share control');
}

class FakeStyle {
  constructor() {
    this.properties = {};
    this.priorities = {};
  }

  setProperty(name, value, priority = '') {
    this.properties[name] = String(value);
    this.priorities[name] = priority;
    this[name] = String(value);
  }

  getPropertyPriority(name) {
    return this.priorities[name] || '';
  }
}

class FakeElement {
  constructor(tagName = 'div', className = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.nodeType = 1;
    this.dataset = {};
    this.style = new FakeStyle();
    this.attributes = {};
    this.eventListeners = {};
    this.attributeWrites = 0;
    this._textContent = '';
    this.rect = { top: 0, left: 0, width: 100, height: 100 };
    this.classList = {
      add: (...classNames) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classNames.forEach((classNameToAdd) => classes.add(classNameToAdd));
        this.className = [...classes].join(' ');
      },
      remove: (...classNames) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classNames.forEach((classNameToRemove) => classes.delete(classNameToRemove));
        this.className = [...classes].join(' ');
      },
      contains: (classNameToFind) => this.className.split(/\s+/).includes(classNameToFind),
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return [this._textContent, ...this.children.map((child) => child.textContent)].join('');
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  // Moves `child` out of its current parent (if any) and under this element.
  #adopt(child) {
    child.remove();
    child.parentElement = this;
  }

  appendChild(child) {
    this.#adopt(child);
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, referenceChild) {
    this.#adopt(newChild);
    const referenceIndex = this.children.indexOf(referenceChild);
    this.children.splice(referenceIndex === -1 ? this.children.length : referenceIndex, 0, newChild);
    return newChild;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(target) {
    if (this === target) return true;
    return this.children.some((child) => child.contains(target));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this.attributeWrites += 1;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(eventName, callback) {
    this.eventListeners[eventName] = callback;
  }

  dispatch(eventName) {
    if (this.eventListeners[eventName]) {
      this.eventListeners[eventName].call(this, {
        stopPropagation() {},
        preventDefault() {},
        target: this,
      });
    }
  }

  getBoundingClientRect() {
    return this.rect;
  }

  matches(selector) {
    return selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => {
        if (part === 'img') return this.tagName === 'IMG';
        if (/^[a-z]+\./i.test(part)) {
          const [tagName, ...classNames] = part.split('.');
          return (
            this.tagName.toLowerCase() === tagName.toLowerCase() &&
            classNames.every((classNameToFind) => this.classList.contains(classNameToFind))
          );
        }
        if (part.startsWith('.')) {
          return part
            .slice(1)
            .split('.')
            .every((classNameToFind) => this.classList.contains(classNameToFind));
        }
        return this.tagName.toLowerCase() === part.toLowerCase();
      });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];

    function walk(node) {
      node.children.forEach((child) => {
        if (child.matches(selector)) {
          matches.push(child);
        }
        walk(child);
      });
    }

    walk(this);
    return matches;
  }
}

function createHarness(beforeDomReady) {
  const body = new FakeElement('body');
  const domReadyCallbacks = [];
  const observers = [];
  const windowListeners = {};

  const document = {
    body,
    activeElement: null,
    addEventListener(eventName, callback) {
      if (eventName === 'DOMContentLoaded') {
        domReadyCallbacks.push(callback);
      }
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === '.notes') return null;
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
  };

  const context = {
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe() {}
    },
    document,
    window: {
      addEventListener(eventName, callback) {
        windowListeners[eventName] = callback;
      },
    },
  };

  vm.runInNewContext(getFirstInlineScript(), context);
  assert.equal(domReadyCallbacks.length, 1);
  if (beforeDomReady) beforeDomReady(body);
  domReadyCallbacks[0]();

  return { body, document, observers, windowListeners };
}

// Tumblr's alt-text tutorial popover as it is injected into the page.
function createAltTextPopover(body) {
  const popover = body.appendChild(new FakeElement('div', 'popover tutorial alt-text-helper_step'));
  popover.appendChild(new FakeElement('div', 'title')).textContent = 'Alt text';
  popover.appendChild(new FakeElement('div', 'content')).textContent = 'في رحاب المسجد النبوي ليلة 27 من رمضان';
  popover.appendChild(new FakeElement('button', 'ok_button')).textContent = 'OK';
  return popover;
}

function createImageAndPopover(body) {
  const post = body.appendChild(new FakeElement('article', 'posts'));
  const media = post.appendChild(new FakeElement('div', 'media'));
  const image = media.appendChild(new FakeElement('img'));
  image.rect = { top: 10, left: 10, width: 700, height: 420 };

  return { media, popover: createAltTextPopover(body) };
}

function createNpfImageAndPopover(body) {
  const post = body.appendChild(new FakeElement('article', 'posts'));
  const header = post.appendChild(new FakeElement('div', 'header-posts'));
  const row = header.appendChild(new FakeElement('div', 'npf_row'));
  const col = row.appendChild(new FakeElement('div', 'npf_col'));
  const figure = col.appendChild(new FakeElement('figure', 'tmblr-full'));
  figure.rect = { top: 10, left: 0, width: 1000, height: 980 };

  const anchor = figure.appendChild(new FakeElement('a', 'post_media_photo_anchor'));
  const image = anchor.appendChild(new FakeElement('img', 'post_media_photo image'));
  image.rect = { top: 10, left: 230, width: 540, height: 960 };

  const altHelper = figure.appendChild(new FakeElement('span', 'tmblr-alt-text-helper'));

  return { figure, anchor, image, altHelper, popover: createAltTextPopover(body) };
}

function createShareHarness() {
  const body = new FakeElement('body');
  const documentListeners = {};

  function createShareControl() {
    const control = body.appendChild(new FakeElement('div', 'share-control'));
    control.appendChild(new FakeElement('a', 'share selector icon-export'));
    const menu = control.appendChild(new FakeElement('div', 'pop-menu share-menu south'));
    const list = menu.appendChild(new FakeElement('ul'));
    list.appendChild(new FakeElement('li')).appendChild(new FakeElement('a', 'share-item facebook'));
    return control;
  }

  const first = createShareControl();
  const second = createShareControl();
  const outside = body.appendChild(new FakeElement('div', 'outside'));

  const document = {
    addEventListener(eventName, callback) {
      documentListeners[eventName] = callback;
    },
  };

  vm.runInNewContext(getShareControlScript(), { document });

  // The menu is driven by one delegated listener, so a click anywhere reaches
  // the document with the element that was hit as its target.
  const click = (target) => documentListeners.click({ target });

  return { click, first, second, outside };
}

test('alt text helper localization does not trigger an observer loop', () => {
  const { body, observers } = createHarness();
  const { popover } = createImageAndPopover(body);

  observers.at(-1).callback([{ addedNodes: [popover] }]);
  const writesAfterInitialLocalization = popover.attributeWrites;

  observers.at(-1).callback([{ addedNodes: [] }]);

  assert.equal(
    popover.attributeWrites,
    writesAfterInitialLocalization,
    'unrelated body mutations should not re-localize an existing alt-text popover',
  );
});

test('alt text helper renders as a dark overlay on the image with a clear x close button', () => {
  const { body, observers } = createHarness();
  const { media, popover } = createImageAndPopover(body);

  observers.at(-1).callback([{ addedNodes: [popover] }]);

  const overlay = media.querySelector('.alt-text-image-overlay');
  assert.ok(overlay, 'expected an overlay to be added to the image media container');
  assert.equal(popover.style.display, 'none');
  assert.equal(popover.style.getPropertyPriority('display'), 'important');
  assert.equal(overlay.querySelector('.alt-text-image-overlay__text').textContent, 'في رحاب المسجد النبوي ليلة 27 من رمضان');
  assert.equal(overlay.querySelector('.alt-text-image-overlay__close').textContent, '×');

  overlay.querySelector('.alt-text-image-overlay__close').dispatch('click');
  assert.equal(media.querySelector('.alt-text-image-overlay'), null);
});

test('npf image alt helper is framed with its photo anchor on dom ready', () => {
  let fixture;
  createHarness((body) => {
    fixture = createNpfImageAndPopover(body);
  });

  const frame = fixture.figure.querySelector('.alt-text-media-frame');

  assert.ok(frame, 'expected an image-sized frame to be created inside the NPF figure');
  assert.equal(frame.parentElement, fixture.figure);
  assert.equal(fixture.anchor.parentElement, frame);
  assert.equal(fixture.altHelper.parentElement, frame);
  assert.equal(frame.children[0], fixture.anchor);
  assert.equal(frame.children[1], fixture.altHelper);
  assert.equal(frame.style.width, '540px');
});

test('npf alt text overlay is constrained to the image-sized frame', () => {
  let fixture;
  const { observers } = createHarness((body) => {
    fixture = createNpfImageAndPopover(body);
  });

  observers.at(-1).callback([{ addedNodes: [fixture.popover] }]);

  const frame = fixture.figure.querySelector('.alt-text-media-frame');
  const overlay = frame.querySelector('.alt-text-image-overlay');

  assert.ok(overlay, 'expected overlay to be added to the image-sized frame');
  assert.equal(overlay.parentElement, frame);
  assert.equal(fixture.figure.children.includes(overlay), false);
  assert.equal(overlay.querySelector('.alt-text-image-overlay__text').textContent, 'في رحاب المسجد النبوي ليلة 27 من رمضان');

  overlay.querySelector('.alt-text-image-overlay__close').dispatch('click');
  assert.equal(frame.querySelector('.alt-text-image-overlay'), null);
});

test('opening one share menu closes any previously open share menu', () => {
  const { click, first, second, outside } = createShareHarness();

  click(first);
  assert.equal(first.classList.contains('pop'), true);
  assert.equal(second.classList.contains('pop'), false);

  click(second);
  assert.equal(first.classList.contains('pop'), false);
  assert.equal(second.classList.contains('pop'), true);

  click(second);
  assert.equal(second.classList.contains('pop'), false);

  click(first);
  click(outside);
  assert.equal(first.classList.contains('pop'), false);
});

test('the share menu is positioned with physical left/right, never inset-inline', () => {
  // In RTL `inset-inline-start/end` map to right/left and win the cascade over
  // the physical `left: 0 !important` that pins the menu to the button, which
  // dropped the box back to its static position: -(160-44)/2 = -58px, off-screen.
  const rules = getThemeCss().match(/[^{}]+{[^{}]*}/g) || [];
  const popMenuRules = rules.filter((rule) => rule.slice(0, rule.indexOf('{')).includes('.pop-menu'));

  assert.ok(popMenuRules.length > 0, 'Expected .pop-menu rules in the theme CSS');
  popMenuRules.forEach((rule) => {
    assert.doesNotMatch(rule, /inset-inline/, `.pop-menu rule must not use inset-inline:\n${rule}`);
  });
});
