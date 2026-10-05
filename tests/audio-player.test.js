const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { getInlineScript } = require('./helpers');

function getAudioPlayerScript() {
  // The DOMContentLoaded listener containing formatTime
  return getInlineScript(
    /<script>\s*document\.addEventListener\("DOMContentLoaded", function\(\) \{\s*function formatTime[\s\S]*?<\/script>/,
    'custom audio player'
  );
}

class FakeAudio {
  constructor() {
    this.src = '';
    this.volume = 1.0;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 100;
    this.eventListeners = {};
  }

  addEventListener(event, callback) {
    this.eventListeners[event] = callback;
  }

  play() {
    this.paused = false;
    if (this.eventListeners['play']) this.eventListeners['play']();
    if (this.eventListeners['playing']) this.eventListeners['playing']();
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    if (this.eventListeners['pause']) this.eventListeners['pause']();
  }
}

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }
  add(cls) { this.classes.add(cls); }
  remove(cls) { this.classes.delete(cls); }
  contains(cls) { return this.classes.has(cls); }
}

class FakeElement {
  constructor(tagName = 'div', className = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.eventListeners = {};
    this.children = [];
    this.parent = null;
    this.rect = { right: 100, left: 0, width: 100 };
  }

  get parentNode() {
    return this.parent;
  }

  get textContent() {
    let text = '';
    for (const child of this.children) {
      if (child instanceof FakeElement) {
        text += child.textContent;
      } else if (child && child.textContent) {
        text += child.textContent;
      } else if (child && child.nodeValue) {
        text += child.nodeValue;
      } else if (typeof child === 'string') {
        text += child;
      }
    }
    return text || this._textContent || '';
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [val];
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    const idx = this.children.indexOf(refChild);
    if (idx !== -1) {
      this.children.splice(idx, 0, newChild);
    } else {
      this.children.push(newChild);
    }
    newChild.parent = this;
    return newChild;
  }

  removeAttribute(attr) {
    this[attr] = null;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.includes('.')) {
        const [tag, cls] = selector.split('.');
        const tagMatch = !tag || curr.tagName.toLowerCase() === tag.toLowerCase();
        if (tagMatch && curr.className.includes(cls)) return curr;
      } else {
        if (curr.tagName.toLowerCase() === selector.toLowerCase()) return curr;
      }
      curr = curr.parent;
    }
    return null;
  }

  querySelector(selector) {
    const choices = selector.split(',').map(s => s.trim());
    for (const choice of choices) {
      const parts = choice.split(/\s+/).filter(Boolean);
      let current = [this];
      let failed = false;
      for (const part of parts) {
        let found = [];
        for (const node of current) {
          found.push(...node.querySelectorAll(part));
        }
        if (found.length === 0) {
          failed = true;
          break;
        }
        current = found;
      }
      if (!failed && current.length > 0) {
        return current[0];
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const selectors = selector.split(',').map(s => s.trim());
    
    function matchesSelector(child, sel) {
      if (!child || !child.tagName) {
        return false;
      }
      if (sel.toLowerCase() === child.tagName.toLowerCase()) {
        return true;
      }
      if (sel.startsWith('.')) {
        const classes = sel.split('.').filter(Boolean);
        const childClasses = child.className.split(/\s+/).filter(Boolean);
        return classes.every(cls => childClasses.includes(cls));
      }
      return false;
    }

    function walk(node) {
      for (const child of node.children) {
        if (!(child instanceof FakeElement)) {
          continue;
        }
        let isMatch = false;
        for (const sel of selectors) {
          if (matchesSelector(child, sel)) {
            isMatch = true;
            break;
          }
        }
        if (isMatch) {
          matches.push(child);
        }
        walk(child);
      }
    }
    walk(this);
    return matches;
  }

  set innerHTML(htmlStr) {
    this._innerHTML = htmlStr;
    if (this.className.includes('custom-audio-player')) {
      buildPlayButton(this);

      if (htmlStr.includes('<audio')) {
        const aud = new FakeElement('audio');
        this.appendChild(aud);
      }

      if (htmlStr.includes('player-album-art')) {
        const albumArt = new FakeElement('div', 'player-album-art');
        const artImg = new FakeElement('img');
        const srcMatch = htmlStr.match(/class="player-album-art"[^>]*><img[^>]+src="([^"]+)"/);
        if (srcMatch && srcMatch[1]) {
          artImg.src = srcMatch[1];
        }
        albumArt.appendChild(artImg);
        this.appendChild(albumArt);
      }

      const info = new FakeElement('div', 'player-info');
      const titleWrapper = new FakeElement('div', 'track-title-wrapper');
      
      const titleSpan = new FakeElement('span', 'track-title');
      const titleMatch = htmlStr.match(/<span class="track-title"[^>]*>([^<]*)<\/span>/);
      if (titleMatch && titleMatch[1]) {
        titleSpan.textContent = titleMatch[1];
      }
      titleWrapper.appendChild(titleSpan);

      if (htmlStr.includes('track-artist')) {
        titleWrapper.appendChild(new FakeElement('span', 'track-artist-divider'));
        const artistSpan = new FakeElement('span', 'track-artist');
        const artistMatch = htmlStr.match(/<span class="track-artist"[^>]*>([^<]*)<\/span>/);
        if (artistMatch && artistMatch[1]) {
          artistSpan.textContent = artistMatch[1];
        }
        titleWrapper.appendChild(artistSpan);
      }

      info.appendChild(titleWrapper);
      this.appendChild(info);

      buildPlayerControls(this);
    }
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  getBoundingClientRect() {
    return this.rect;
  }

  addEventListener(event, callback) {
    this.eventListeners[event] = callback;
  }

  click() {
    if (this.eventListeners['click']) {
      this.eventListeners['click']({ preventDefault() {} });
    }
  }

  mousedown(clientX) {
    if (this.eventListeners['mousedown']) {
      this.eventListeners['mousedown']({
        clientX,
        preventDefault() {},
      });
    }
  }
}

// Appends `children` (tag + class list) under a new element of `className`.
function buildGroup(parent, tagName, className, children) {
  const group = parent.appendChild(new FakeElement(tagName, className));
  children.forEach(([tag, cls]) => group.appendChild(new FakeElement(tag, cls)));
  return group;
}

function buildPlayButton(player) {
  return buildGroup(player, 'button', 'play-pause-btn', [
    ['svg', 'play-icon'],
    ['svg', 'pause-icon'],
    ['svg', 'loading-icon'],
  ]);
}

// The volume, timeline and time-label controls the player script queries for.
function buildPlayerControls(player) {
  buildGroup(player, 'button', 'volume-btn', [
    ['svg', 'volume-high-icon'],
    ['svg', 'volume-mute-icon'],
  ]);
  buildGroup(player, 'div', 'volume-slider-track', [
    ['div', 'volume-slider-fill'],
    ['div', 'volume-slider-thumb'],
  ]);
  buildGroup(player, 'div', 'audio-progress-container', [
    ['div', 'audio-progress-bar'],
    ['div', 'audio-progress-fill'],
    ['div', 'audio-progress-thumb'],
  ]);
  player.appendChild(new FakeElement('span', 'current-time'));
  player.appendChild(new FakeElement('span', 'total-time'));
}

// An <audio> element whose media behaviour is backed by a FakeAudio.
function createAudioElement() {
  const audio = new FakeElement('audio');
  const media = new FakeAudio();
  audio.src = '';
  audio.play = () => media.play();
  audio.pause = () => media.pause();
  audio.addEventListener = (ev, cb) => media.addEventListener(ev, cb);
  Object.defineProperty(audio, 'paused', { get: () => media.paused });
  Object.defineProperty(audio, 'volume', {
    get: () => media.volume,
    set: (v) => { media.volume = v; }
  });
  return { audio, media };
}

// A ready-to-init custom player with its audio element and controls.
function createPlayer(audioUrl) {
  const player = new FakeElement('div', 'custom-audio-player');
  player.dataset.audioUrl = audioUrl;
  const { audio, media } = createAudioElement();
  player.appendChild(audio);
  const playBtn = buildPlayButton(player);
  buildPlayerControls(player);
  return { player, audio, playBtn, media };
}

function bootAudioPlayer(context, domListeners) {
  vm.runInNewContext(getAudioPlayerScript(), context);
  domListeners['DOMContentLoaded']();
}

function setupHarness() {
  const players = [];
  const domListeners = {};

  const document = {
    addEventListener(event, callback) {
      domListeners[event] = callback;
    },
    querySelectorAll(selector) {
      if (selector === '.custom-audio-player') {
        return players;
      }
      return [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        }
      };
    }
  };

  const windowListeners = {};
  const window = {
    addEventListener(event, callback) {
      windowListeners[event] = callback;
    }
  };

  const context = {
    document,
    window,
    console,
    URL,
    URLSearchParams,
    location: {
      hostname: 'yasser1410.tumblr.com',
      protocol: 'https:'
    },
    NodeFilter: {
      SHOW_TEXT: 4
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    },
    setInterval(fn, ms) { return 0; },
    clearInterval() {}
  };

  return { players, domListeners, context };
}

test('audio player correctly extracts source URL from hidden native iframe', () => {
  const { players, domListeners, context } = setupHarness();

  // An empty data-audio-url triggers the iframe fallback
  const { player, audio } = createPlayer('');

  // Mock parent audio-container layout
  const container = new FakeElement('div', 'audio-container');
  container.appendChild(player);

  const nativeAudio = new FakeElement('div', 'tumblr-native-audio');
  const iframe = new FakeElement('iframe');
  iframe.src = 'https://tumblr.com/audio_player_iframe?audio_file=https%3A%2F%2Fa.tumblr.com%2Ftrack1.mp3';
  nativeAudio.appendChild(iframe);
  container.appendChild(nativeAudio);

  players.push(player);

  bootAudioPlayer(context, domListeners);

  // Verify URL was correctly extracted from iframe
  assert.equal(audio.src, 'https://a.tumblr.com/track1.mp3');
});

test('playing one custom player pauses any other active custom players', () => {
  const { players, domListeners, context } = setupHarness();

  const p1 = createPlayer('https://example.com/p1.mp3');
  const p2 = createPlayer('https://example.com/p2.mp3');
  players.push(p1.player, p2.player);

  bootAudioPlayer(context, domListeners);

  // Both should start paused
  assert.equal(p1.media.paused, true);
  assert.equal(p2.media.paused, true);

  // Click play on player 1
  p1.playBtn.click();
  assert.equal(p1.media.paused, false);
  assert.equal(p2.media.paused, true);

  // Click play on player 2 (should auto-pause player 1)
  p2.playBtn.click();
  assert.equal(p1.media.paused, true);
  assert.equal(p2.media.paused, false);
});

test('NPF audio tags are dynamically converted into custom players on DOMContentLoaded', () => {
  const { domListeners, context } = setupHarness();

  // Create native HTML structure for NPF audio post
  const figure = new FakeElement('figure', 'tmblr-full');
  
  const figcaption = new FakeElement('figcaption', 'audio-caption');
  
  const artistSpan = new FakeElement('span', 'tmblr-audio-meta artist');
  artistSpan.textContent = 'محمد الغزالي';
  
  const titleSpan = new FakeElement('span', 'tmblr-audio-meta title');
  titleSpan.textContent = 'أطلق عنانك';
  
  figcaption.appendChild(artistSpan);
  figcaption.appendChild(titleSpan);
  
  const img = new FakeElement('img', 'album-cover');
  img.src = 'https://example.com/cover.jpg';
  figcaption.appendChild(img);
  
  figure.appendChild(figcaption);
  
  const audio = new FakeElement('audio');
  audio.src = 'https://example.com/audio.mp3';
  figure.appendChild(audio);

  // Mock global document querySelectorAll and body
  const nativeAudios = [audio];
  const customPlayers = [];

  context.document.querySelectorAll = (selector) => {
    if (selector === 'audio:not(.custom-audio-player audio)') {
      return nativeAudios;
    }
    if (selector === '.custom-audio-player') {
      return customPlayers;
    }
    return [];
  };

  // Mock document body container
  const body = new FakeElement('body');
  body.appendChild(figure);
  context.document.body = body;

  bootAudioPlayer(context, domListeners);

  // Check if a custom-audio-player was created and wrapped the audio
  const customPlayer = figure.querySelector('.custom-audio-player');
  assert.ok(customPlayer, 'Custom audio player should be created inside figure');
  assert.equal(customPlayer.dataset.audioUrl, 'https://example.com/audio.mp3');

  // Verify that controls were removed and audio was hidden
  assert.equal(audio.controls, null);
  assert.equal(audio.style.display, 'none');

  // Verify elements inside customPlayer structure (e.g. title, album art)
  const albumArt = customPlayer.querySelector('.player-album-art');
  assert.ok(albumArt, 'Album art container should be rendered');
  const albumArtImg = albumArt.querySelector('img');
  assert.equal(albumArtImg.src, 'https://example.com/cover.jpg');

  // Verify title
  const trackTitle = customPlayer.querySelector('.track-title');
  assert.ok(trackTitle, 'Track title element should be rendered');
  assert.equal(trackTitle.textContent, 'أطلق عنانك');

  // Verify artist
  const trackArtist = customPlayer.querySelector('.track-artist');
  assert.ok(trackArtist, 'Track artist element should be rendered');
  assert.equal(trackArtist.textContent, 'محمد الغزالي');
});
