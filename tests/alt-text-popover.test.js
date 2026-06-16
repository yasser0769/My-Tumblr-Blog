const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function getFirstInlineScript() {
  const html = fs.readFileSync('Tumblr.html', 'utf8');
  const match = html.match(/<script>\s*document\.addEventListener\("DOMContentLoaded"[\s\S]*?<\/script>/);

  assert.ok(match, 'Could not find the DOMContentLoaded localization script');

  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

function getShareControlScript() {
  const html = fs.readFileSync('Tumblr.html', 'utf8');
  const match = html.match(/<script>\s*document\.querySelectorAll\('\.share-control'\)[\s\S]*?<\/script>/);

  assert.ok(match, 'Could not find the share control script');

  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
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

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
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

function createHarness() {
  const body = new FakeElement('body');
  const domReadyCallbacks = [];
  const observers = [];

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
  };

  vm.runInNewContext(getFirstInlineScript(), context);
  assert.equal(domReadyCallbacks.length, 1);
  domReadyCallbacks[0]();

  return { body, document, observers };
}

function createImageAndPopover(body) {
  const post = body.appendChild(new FakeElement('article', 'posts'));
  const media = post.appendChild(new FakeElement('div', 'media'));
  const image = media.appendChild(new FakeElement('img'));
  image.rect = { top: 10, left: 10, width: 700, height: 420 };

  const popover = body.appendChild(new FakeElement('div', 'popover tutorial alt-text-helper_step'));
  const title = popover.appendChild(new FakeElement('div', 'title'));
  const content = popover.appendChild(new FakeElement('div', 'content'));
  const closeButton = popover.appendChild(new FakeElement('button', 'ok_button'));

  title.textContent = 'Alt text';
  content.textContent = 'في رحاب المسجد النبوي ليلة 27 من رمضان';
  closeButton.textContent = 'OK';

  return { media, popover };
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
    body,
    addEventListener(eventName, callback) {
      documentListeners[eventName] = callback;
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
  };

  vm.runInNewContext(getShareControlScript(), { document });

  return { documentListeners, first, second, outside };
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

test('opening one share menu closes any previously open share menu', () => {
  const { documentListeners, first, second, outside } = createShareHarness();

  first.dispatch('click');
  assert.equal(first.classList.contains('pop'), true);
  assert.equal(second.classList.contains('pop'), false);

  second.dispatch('click');
  assert.equal(first.classList.contains('pop'), false);
  assert.equal(second.classList.contains('pop'), true);

  second.dispatch('click');
  assert.equal(second.classList.contains('pop'), false);

  first.dispatch('click');
  documentListeners.click({ target: outside });
  assert.equal(first.classList.contains('pop'), false);
});
