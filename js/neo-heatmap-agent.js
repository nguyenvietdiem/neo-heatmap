(function () {
  'use strict';

  // ================= CONFIG =================
  // ✅ Production: hãy đổi '*' thành domain trang JSP của bạn (an toàn hơn)
  // Ví dụ: ['https://your-jsp-domain.com', 'http://localhost:8080']
  var ALLOWED_PARENTS = ['http://localhost:8080'];

  var NS = 'NEO_HEATMAP';

  // ================= UTILS =================
  function isAllowed(origin) {
    if (ALLOWED_PARENTS.indexOf('*') !== -1) return true;
    return ALLOWED_PARENTS.indexOf(origin) !== -1;
  }

  function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

  function resolveElementByXPath(doc, xpath) {
    if (!doc || !xpath) return null;
    try {
      // Priority: XPath contains @id="..."
      var idMatch = xpath.match(/@id="([^"]+)"/);
      if (idMatch && idMatch[1]) {
        var elById = doc.getElementById(idMatch[1]);
        if (elById) return elById;
      }

      var result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      var node = result.singleNodeValue;
      if (node && node.nodeType === 1) return node;

      // Fix /body -> /html/body
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

  function computePositions(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];

      var xpath = it.xpath;
      var xRatio = clamp01(it.xRatio);
      var yRatio = clamp01(it.yRatio);

      var el = resolveElementByXPath(document, xpath);
      if (!el) {
        out.push({
          stepIndex: it.stepIndex,
          xpath: xpath,
          xpathWithHash: it.xpathWithHash,
          found: false,
          visible: false
        });
        continue;
      }

      var visible = isElementVisible(el);
      var rect = el.getBoundingClientRect();

      // ✅ X/Y trong viewport của iframe
      var x = rect.left + rect.width * xRatio;
      var y = rect.top + rect.height * yRatio;

      out.push({
        stepIndex: it.stepIndex,
        xpath: xpath,
        xpathWithHash: it.xpathWithHash,
        found: true,
        visible: visible,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        x: x,
        y: y
      });
    }
    return out;
  }

  function reply(toWindow, origin, message) {
    try {
      toWindow.postMessage(message, origin);
    } catch (e) {
      toWindow.postMessage(message, '*');
    }
  }

  // ================= OPTIONAL: PUSH VIEWPORT CHANGES =================
  var notifyTimer = null;
  function notifyViewportChanged() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () {
      if (!window.parent) return;
      window.parent.postMessage(
        {
          ns: NS,
          type: 'VIEWPORT_CHANGED',
          payload: {
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          }
        },
        '*'
      );
    }, 80);
  }

  window.addEventListener('scroll', notifyViewportChanged, { passive: true });
  window.addEventListener('resize', notifyViewportChanged);

  // ================= MESSAGE HANDLER =================
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

    if (type === 'GET_POSITIONS') {
      var items = payload.items || [];
      var positions = computePositions(items);

      reply(sourceWin, e.origin, {
        ns: NS,
        type: 'POSITIONS',
        requestId: requestId,
        payload: {
          positions: positions,
          viewport: {
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          }
        }
      });
      return;
    }

    // Optional: replay click
    if (type === 'REPLAY_STEP') {
      var xpath2 = payload.xpath;
      var el2 = resolveElementByXPath(document, xpath2);
      var ok = false;

      if (el2) {
        try {
          el2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          ok = true;
        } catch (err) {
          try {
            el2.click();
            ok = true;
          } catch (err2) {}
        }
      }

      reply(sourceWin, e.origin, {
        ns: NS,
        type: 'REPLAY_RESULT',
        requestId: requestId,
        payload: { ok: ok }
      });
    }
  });

  console.log('[NeoHeatmapAgent] ready');
})();
