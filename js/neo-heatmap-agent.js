(function () {
  'use strict';

  // ===== CONFIG =====
  var ALLOWED_PARENTS = ['http://localhost:8080']; // hoặc '*' khi debug
  var NS = 'NEO_HEATMAP';
  var OVERLAY_ROOT_ID = 'neo-heatmap-overlay-root';

  // ===== STATE in iframe =====
  var state = {
    items: [],
    maxCount: 1,
    currentStep: -1, // -1 show all, -2 hide all
    overlayRoot: null,
    spotEls: [],     // aligned by item index (some may be null if not found/hidden)
    observer: null,
    rafId: 0
  };

  // ===== UTILS =====
  function isAllowed(origin) {
    if (ALLOWED_PARENTS.indexOf('*') !== -1) return true;
    return ALLOWED_PARENTS.indexOf(origin) !== -1;
  }

  function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  var HEATMAP_STOPS = [
    { stop: 0.0, color: { r: 0, g: 0, b: 255 } },
    { stop: 0.3, color: { r: 0, g: 255, b: 255 } },
    { stop: 0.5, color: { r: 0, g: 255, b: 0 } },
    { stop: 0.7, color: { r: 255, g: 255, b: 0 } },
    { stop: 1.0, color: { r: 255, g: 0, b: 0 } }
  ];

  var HEAT_MAX = 20;
  var MIN_SIZE = 40;
  var MAX_SIZE = 150;

  function colorAt(tRaw) {
    var t = Math.max(0, Math.min(1, tRaw));
    var i = 0;
    while (i < HEATMAP_STOPS.length - 1 && t > HEATMAP_STOPS[i + 1].stop) i++;
    var a = HEATMAP_STOPS[i];
    var b = HEATMAP_STOPS[Math.min(i + 1, HEATMAP_STOPS.length - 1)];
    var span = b.stop - a.stop || 1;
    var tt = (t - a.stop) / span;
    return {
      r: Math.round(lerp(a.color.r, b.color.r, tt)),
      g: Math.round(lerp(a.color.g, b.color.g, tt)),
      b: Math.round(lerp(a.color.b, b.color.b, tt))
    };
  }

  function rgba(c, a) {
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
  }

  function getHeatStyle(count, maxCount) {
    var denom = Math.max(HEAT_MAX, maxCount || 0);
    var t = denom > 0 ? Math.max(0, Math.min(1, count / denom)) : 0;
    var base = colorAt(t);

    var size = MIN_SIZE + Math.sqrt(t) * (MAX_SIZE - MIN_SIZE);
    var centerA = 0.35 + 0.65 * t;
    var midA = 0.18 + 0.42 * t;

    return {
      width: size + 'px',
      height: size + 'px',
      background: 'radial-gradient(circle, ' +
        rgba(base, centerA) + ' 0%, ' +
        rgba(base, midA) + ' 55%, ' +
        rgba(base, 0) + ' 100%)',
      opacity: 1
    };
  }

  function resolveElementByXPath(doc, xpath) {
    if (!doc || !xpath) return null;
    try {
      var idMatch = xpath.match(/@id="([^"]+)"/);
      if (idMatch && idMatch[1]) {
        var elById = doc.getElementById(idMatch[1]);
        if (elById) return elById;
      }
      var result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      var node = result.singleNodeValue;
      if (node && node.nodeType === 1) return node;

      if (xpath.indexOf('/body') === 0 || xpath.indexOf('//body') === 0) {
        var fixedXpath = xpath.replace(/^\/+body/, '/html/body');
        result = doc.evaluate(fixedXpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        node = result.singleNodeValue;
        if (node && node.nodeType === 1) return node;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      var cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        var style = window.getComputedStyle(cur);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        cur = cur.parentElement;
      }
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  }

  function getOrCreateOverlayRoot() {
    var root = document.getElementById(OVERLAY_ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    root.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      'width: 100vw',
      'height: 100vh',
      'pointer-events: none',
      'z-index: 2147483647',
      'mix-blend-mode: multiply',
      'overflow: visible'
    ].join(';');

    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function clearOverlay() {
    var root = document.getElementById(OVERLAY_ROOT_ID);
    if (root) root.remove();
    state.overlayRoot = null;
    state.spotEls = [];
  }

  function applyStepVisibility() {
    for (var i = 0; i < state.spotEls.length; i++) {
      var el = state.spotEls[i];
      if (!el) continue;
      var visible = (state.currentStep === -1) || (state.currentStep >= i) || (state.currentStep === -2 ? false : false);
      el.style.opacity = visible ? '1' : '0';
    }
  }

  // ✅ Core: render spots (create once), then positions updated separately
  function renderSpots() {
    state.overlayRoot = getOrCreateOverlayRoot();
    state.overlayRoot.innerHTML = '';

    state.spotEls = new Array(state.items.length);

    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];

      // pre-create spot; if element hidden/not found => we still keep spot null
      var el = resolveElementByXPath(document, it.xpath);
      if (!el) {
        state.spotEls[i] = null;
        continue;
      }
      if (!isElementVisible(el)) {
        state.spotEls[i] = null;
        continue;
      }

      var heat = getHeatStyle(it.count || 1, state.maxCount);

      var spot = document.createElement('div');
      spot.className = 'neo-heatmap-spot';
      spot.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'left: 0px',
        'top: 0px',
        'transform: translate(-50%, -50%)',
        'width: ' + heat.width,
        'height: ' + heat.height,
        'background: ' + heat.background,
        'opacity: 1',
        'border-radius: 50%',
        'filter: blur(10px)',
        'transition: opacity 0.3s ease'
      ].join(';');

      state.overlayRoot.appendChild(spot);
      state.spotEls[i] = spot;
    }

    updatePositions();      // initial position
    applyStepVisibility();  // apply step opacity
  }

  // ✅ update positions to stick to elements while scroll/resize
  function updatePositions() {
    for (var i = 0; i < state.items.length; i++) {
      var spot = state.spotEls[i];
      if (!spot) continue;

      var it = state.items[i];
      var el = resolveElementByXPath(document, it.xpath);
      if (!el || !isElementVisible(el)) {
        // element disappeared -> hide spot
        spot.style.opacity = '0';
        continue;
      }

      var rect = el.getBoundingClientRect();
      var xRatio = clamp01(it.xRatio);
      var yRatio = clamp01(it.yRatio);

      var x = rect.left + rect.width * xRatio;
      var y = rect.top + rect.height * yRatio;

      spot.style.left = x + 'px';
      spot.style.top = y + 'px';
    }
  }

  // throttle updates by rAF
  function scheduleUpdate() {
    if (state.rafId) return;
    state.rafId = requestAnimationFrame(function () {
      state.rafId = 0;
      updatePositions();
    });
  }

  function setupObservers() {
    // scroll/resize
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    // MutationObserver for SPA
    if (state.observer) state.observer.disconnect();
    if (document.body) {
      state.observer = new MutationObserver(function () {
        // simplest: rebuild spots then update
        renderSpots();
      });
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'disabled']
      });
    }
  }

  // ===== messaging =====
  function reply(toWindow, origin, message) {
    try { toWindow.postMessage(message, origin); }
    catch (e) { toWindow.postMessage(message, '*'); }
  }

  window.addEventListener('message', function (e) {
    if (!e || !e.data || e.data.ns !== NS) return;
    if (!isAllowed(e.origin)) return;

    var type = e.data.type;
    var requestId = e.data.requestId;
    var payload = e.data.payload || {};
    var sourceWin = e.source;

    if (type === 'PING') {
      reply(sourceWin, e.origin, { ns: NS, type: 'PONG', requestId: requestId });
      return;
    }

    // ✅ parent sends all heatmap data
    if (type === 'INIT') {
      state.items = payload.items || [];
      state.maxCount = payload.maxCount || 1;
      state.currentStep = (typeof payload.currentStep === 'number') ? payload.currentStep : -1;

      setupObservers();
      renderSpots();

      reply(sourceWin, e.origin, { ns: NS, type: 'INIT_OK', requestId: requestId });
      return;
    }

    // ✅ step control
    if (type === 'SET_STEP') {
      state.currentStep = payload.currentStep;
      applyStepVisibility();
      reply(sourceWin, e.origin, { ns: NS, type: 'SET_STEP_OK', requestId: requestId });
      return;
    }

    if (type === 'CLEAR') {
      clearOverlay();
      reply(sourceWin, e.origin, { ns: NS, type: 'CLEAR_OK', requestId: requestId });
      return;
    }
  });

  console.log('[NeoHeatmapAgent] render-in-iframe ready');
})();
