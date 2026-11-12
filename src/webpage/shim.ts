/**
 * The small script put at the top of every web page on the board, ahead of the page's
 * own. The page runs walled off (a sandboxed frame with no origin of its own, so it
 * can reach neither the whiteboard nor its sign-in); this is its only line to the
 * board, by messages.
 *
 * - It notes what the person does — clicks, typing and choices, keys, drags, scrolling
 *   — and tells the board, which keeps it as their log (`logs.ts`).
 * - It replays a log it is given, which rebuilds that person's page: their own progress
 *   when they come back, a student's page for the teacher, the teacher's for everyone.
 * - "Random" numbers come from a seed, the same in every copy of the page, so a replay
 *   shuffles the same way the original did.
 * - The page's storage is held in memory: a walled-off page has none of its own, and
 *   what it remembers comes back by replaying the log.
 *
 * Written as plain old JavaScript in a string: it runs inside pages of any kind.
 */
const SHIM = String.raw`
(function () {
  var seed = __SEED__ >>> 0;
  Math.random = function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function memoryStorage() {
    var items = Object.create(null);
    return {
      getItem: function (k) { k = String(k); return k in items ? items[k] : null; },
      setItem: function (k, v) { items[String(k)] = String(v); },
      removeItem: function (k) { delete items[String(k)]; },
      clear: function () { items = Object.create(null); },
      key: function (i) { var keys = Object.keys(items); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(items).length; }
    };
  }
  try { Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true }); } catch (e) {}

  var live = true; // this person's own page: what they do is noted
  var last = Date.now();
  function send(event) {
    if (!live) return;
    var now = Date.now();
    event.gap = Math.min(5000, now - last);
    last = now;
    parent.postMessage({ sabboura: 'event', event: event }, '*');
  }

  function pathOf(node) {
    if (!node || node.nodeType !== 1) return null;
    var path = [];
    while (node && node !== document.body) {
      var up = node.parentElement;
      if (!up) return null;
      path.unshift(Array.prototype.indexOf.call(up.children, node));
      node = up;
    }
    return node === document.body ? path : null;
  }
  function nodeAt(path) {
    var node = document.body;
    for (var i = 0; node && i < path.length; i++) node = node.children[path[i]];
    return node || null;
  }
  var FORM = 'input,select,textarea,label,option';
  function elementOf(target) { return target && target.nodeType === 1 ? target : target && target.parentElement; }
  function typing(target) {
    target = elementOf(target);
    return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  // Clicks on form fields are left out: their input and change carry what happened,
  // and replaying both would do it twice.
  window.addEventListener('click', function (e) {
    var target = elementOf(e.target);
    if (!e.isTrusted || !target || target.closest(FORM)) return;
    var path = pathOf(target);
    if (path) send({ t: 'click', path: path, x: e.clientX, y: e.clientY });
  }, true);

  ['input', 'change'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      var target = elementOf(e.target);
      if (!e.isTrusted || !target) return;
      var path = pathOf(target);
      if (!path) return;
      var event = { t: type, path: path };
      if (target.type === 'checkbox' || target.type === 'radio') event.checked = target.checked;
      else if ('value' in target) event.value = String(target.value).slice(0, 2000);
      else if (target.isContentEditable) event.html = target.innerHTML.slice(0, 2000);
      send(event);
    }, true);
  });

  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted) return;
    if (typing(e.target)) {
      // Escape leaves a field, so the next key is the board's again.
      if (e.key === 'Escape') elementOf(e.target).blur();
      return;
    }
    send({ t: 'key', path: pathOf(elementOf(e.target)) || [], key: e.key, code: e.code,
      shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
  }, true);

  // The board's shortcuts keep working while the page has the keyboard: a key the
  // page does not take (one not typed into a field, and not used by the page itself)
  // goes on to the board, once the page has had its turn at it.
  ['keydown', 'keyup'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (!e.isTrusted || typing(e.target)) return;
      setTimeout(function () {
        if (e.defaultPrevented) return;
        parent.postMessage({ sabboura: 'key', type: type, key: e.key, code: e.code,
          shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat }, '*');
      }, 0);
    }, true);
  });

  // The wheel scrolls the page where something under the pointer can still scroll
  // that way; past its end, or where nothing scrolls, it moves the board. With Ctrl
  // (or a trackpad's pinch), it always zooms the board.
  function canScroll(node, dx, dy) {
    for (; node && node.nodeType === 1; node = node.parentElement) {
      var style = getComputedStyle(node);
      var root = node === document.scrollingElement || node === document.body;
      var oy = root || /(auto|scroll)/.test(style.overflowY);
      var ox = root || /(auto|scroll)/.test(style.overflowX);
      if (dy && oy && node.scrollHeight > node.clientHeight + 1) {
        if (dy < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
      if (dx && ox && node.scrollWidth > node.clientWidth + 1) {
        if (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
      }
    }
    var page = document.scrollingElement;
    if (page && dy && page.scrollHeight > page.clientHeight + 1 &&
      (dy < 0 ? page.scrollTop > 0 : page.scrollTop + page.clientHeight < page.scrollHeight - 1)) return true;
    return false;
  }
  window.addEventListener('wheel', function (e) {
    if (!e.isTrusted) return;
    if (!e.ctrlKey && !e.metaKey && canScroll(elementOf(e.target), e.deltaX, e.deltaY)) return;
    e.preventDefault();
    parent.postMessage({ sabboura: 'wheel', x: e.clientX, y: e.clientY, dx: e.deltaX, dy: e.deltaY,
      mode: e.deltaMode, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey }, '*');
  }, { passive: false, capture: true });

  // Drags: pointer down, its moves (a few a second), and up — not plain hovering.
  var pressed = false, lastMove = 0;
  ['pointerdown', 'pointermove', 'pointerup'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (!e.isTrusted) return;
      if (type === 'pointerdown') pressed = true;
      if (type === 'pointermove') {
        if (!pressed || Date.now() - lastMove < 60) return;
        lastMove = Date.now();
      }
      if (type === 'pointerup') pressed = false;
      var target = elementOf(e.target);
      if (target && target.closest(FORM)) return;
      send({ t: 'pointer', type: type, path: pathOf(target) || [], x: e.clientX, y: e.clientY,
        button: e.button, buttons: e.buttons });
    }, true);
  });

  // Scrolling, a few times a second; a scroll the replay made is not noted again.
  var placed = new WeakMap(), lastScroll = 0;
  window.addEventListener('scroll', function (e) {
    var target = e.target === document ? document.scrollingElement : e.target;
    if (!target) return;
    var at = placed.get(target);
    if (at && at.top === target.scrollTop && at.left === target.scrollLeft) return;
    if (Date.now() - lastScroll < 150) return;
    lastScroll = Date.now();
    send({ t: 'scroll', path: target === document.scrollingElement ? null : pathOf(target),
      top: target.scrollTop, left: target.scrollLeft });
  }, true);

  function apply(event) {
    var node = event.path ? nodeAt(event.path) : null;
    switch (event.t) {
      case 'click':
        if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
          view: window, clientX: event.x, clientY: event.y, button: 0 }));
        break;
      case 'input':
      case 'change':
        if (!node) break;
        if ('checked' in event) node.checked = event.checked;
        else if ('value' in event) node.value = event.value;
        else if ('html' in event) node.innerHTML = event.html;
        node.dispatchEvent(new Event(event.t, { bubbles: true }));
        break;
      case 'key': {
        var target = node || document.activeElement || document.body;
        var init = { key: event.key, code: event.code, shiftKey: event.shift, ctrlKey: event.ctrl,
          altKey: event.alt, metaKey: event.meta, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        break;
      }
      case 'pointer': {
        var at = document.elementFromPoint(event.x, event.y) || node || document.body;
        var mouse = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[event.type];
        var common = { bubbles: true, cancelable: true, view: window, clientX: event.x, clientY: event.y,
          button: event.button, buttons: event.buttons };
        at.dispatchEvent(new PointerEvent(event.type, Object.assign({ pointerId: 1, isPrimary: true,
          pointerType: 'mouse' }, common)));
        if (mouse) at.dispatchEvent(new MouseEvent(mouse, common));
        break;
      }
      case 'scroll': {
        var box = event.path ? node : document.scrollingElement;
        if (!box) break;
        placed.set(box, { top: event.top, left: event.left });
        box.scrollTop = event.top;
        box.scrollLeft = event.left;
        break;
      }
    }
  }

  // Replayed one after another, each when what it acts on is there (a page often
  // builds its next part a moment after a click), with a little of the pause the
  // person left — short when catching up.
  var queue = [], running = false;
  function next() {
    if (queue.length === 0) { running = false; return; }
    running = true;
    var item = queue[0], started = Date.now();
    (function attempt() {
      var ready = !item.event.path || nodeAt(item.event.path) || item.event.t === 'pointer';
      if (!ready && Date.now() - started < 3000) return setTimeout(attempt, 60);
      queue.shift();
      try { if (ready) apply(item.event); } catch (e) {}
      var wait = Math.min(item.catchUp ? 120 : 600, Math.max(0, (queue[0] && queue[0].event.gap) || 0));
      setTimeout(next, item.catchUp ? Math.min(wait, 120) : 0);
    })();
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || typeof e.data !== 'object') return;
    var message = e.data;
    if (message.sabboura === 'replay') {
      live = !!message.live;
      (message.events || []).forEach(function (event) {
        queue.push({ event: event, catchUp: !!message.catchUp });
      });
      if (!running) setTimeout(next, message.catchUp ? 60 : 0);
    } else if (message.sabboura === 'live') {
      live = !!message.live;
    }
  });

  // Filling the box: a page written as one fixed-size card (an "app" 1280 by 800, say,
  // centred on a background) is stretched to the whole box, so the box is the page and
  // dragging it bigger gives the page more room. A page that already flows is left be.
  var FILL = __FILL__;
  function declared(el, prop) {
    var value = el.style.getPropertyValue(prop);
    if (value) return value;
    var found = '';
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.cssRules && rule.media) {
          if (window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules);
          continue;
        }
        if (!rule.style || !rule.selectorText) continue;
        try {
          if (el.matches(rule.selectorText)) found = rule.style.getPropertyValue(prop) || found;
        } catch (e) {}
      }
    }
    for (var i = 0; i < document.styleSheets.length; i++) {
      try { walk(document.styleSheets[i].cssRules); } catch (e) {}
    }
    return found;
  }
  var fixedSize = /^\s*\d+(\.\d+)?px\s*$/;
  var filled = null;
  function fill() {
    if (!FILL || !document.body) return;
    var kids = Array.prototype.filter.call(document.body.children, function (child) {
      if (/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(child.tagName)) return false;
      var style = getComputedStyle(child);
      return style.display !== 'none' && style.position !== 'fixed' && style.position !== 'absolute';
    });
    if (kids.length !== 1) return;
    var app = kids[0];
    if (app === filled) return;
    var wide = fixedSize.test(declared(app, 'width'));
    var tall = fixedSize.test(declared(app, 'height'));
    if (!wide && !tall) return;
    filled = app;
    var page = document.createElement('style');
    page.textContent = 'html,body{margin:0!important;padding:0!important;width:100%!important;' +
      'height:100%!important;min-height:0!important;overflow:hidden!important}';
    document.head.appendChild(page);
    var set = function (prop, value) { app.style.setProperty(prop, value, 'important'); };
    set('max-width', 'none');
    set('max-height', 'none');
    set('margin', '0');
    set('border-radius', '0');
    set('box-sizing', 'border-box');
    if (wide) set('width', '100%');
    if (tall) set('height', '100%');
    document.documentElement.setAttribute('data-sabboura-filled', '');
  }
  if (FILL) {
    document.addEventListener('DOMContentLoaded', fill);
    window.addEventListener('load', function () { fill(); setTimeout(fill, 300); setTimeout(fill, 1200); });
  }

  var told = false;
  function ready() {
    if (told) return;
    told = true;
    parent.postMessage({ sabboura: 'ready' }, '*');
  }
  if (document.readyState === 'complete') setTimeout(ready, 50);
  else window.addEventListener('load', function () { setTimeout(ready, 50); });
})();
`;

/** A number from a string, the same everywhere: the page's random seed, a version tag. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/**
 * "<", made at run time: the app is also published as a single file whose host refuses
 * document tags anywhere in it, even inside a string, so none are written out here.
 */
const LT = String.fromCharCode(60);

/** The page as given, with the board's script first in its head. */
export function pageSource(html: string, seed: string, fill = true): string {
  const script = `${LT}script>${SHIM.replace('__SEED__', String(hashOf(seed))).replace(
    '__FILL__',
    String(fill),
  )}${LT}/script>`;
  const head = new RegExp(`${LT}head(\\s[^>]*)?>`, 'i').exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  const root = new RegExp(`${LT}html(\\s[^>]*)?>`, 'i').exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}${LT}head>${script}${LT}/head>${html.slice(at)}`;
  }
  return (
    `${LT}!doctype html>${LT}html>${LT}head>${LT}meta charset="utf-8">${script}${LT}/head>` +
    `${LT}body>${html}${LT}/body>${LT}/html>`
  );
}

/** The page's title, for its card where a live page cannot be drawn. */
export function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = match?.[1]?.trim();
  return title ? title.slice(0, 80) : null;
}
