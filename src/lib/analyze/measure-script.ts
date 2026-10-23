/**
 * The layout measurement, as source text. It runs inside a page: in a headless browser when a
 * reference site is analysed, and inside the preview when the result is compared with it. One
 * source, so both sides measure exactly the same way.
 *
 * It must stay plain JavaScript without backticks or template placeholders (it is a string).
 * Evaluate it as `(<source>)(options)`; the result is JSON-safe.
 */
export const MEASURE_SOURCE = String.raw`function (opts) {
  opts = opts || {};
  var MAX_BLOCKS = opts.maxBlocks || 90;
  var W = window.innerWidth;
  var canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  function hex(c) {
    if (!c || c === 'transparent' || c === 'none') return null;
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      var d = ctx.getImageData(0, 0, 1, 1).data;
      var a = d[3];
      if (a === 0) return null;
      var r = Math.round(d[0] * 255 / a), g = Math.round(d[1] * 255 / a), b = Math.round(d[2] * 255 / a);
      var h = '#' + [r, g, b].map(function (v) { return ('0' + Math.min(255, v).toString(16)).slice(-2); }).join('');
      return a >= 250 ? h : h + ' @' + (a / 255).toFixed(2);
    } catch (e) { return null; }
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
  function rect(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }
  function cs(el) { return window.getComputedStyle(el); }
  function visible(el) {
    var s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  function clean(t, n) { return (t || '').replace(/\s+/g, ' ').trim().slice(0, n || 160); }
  function firstFamily(f) { return (f || '').split(',')[0].replace(/["']/g, '').trim(); }
  function kids(el) { return Array.prototype.filter.call(el.children, function (k) { return !/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(k.tagName) && visible(k); }); }
  function isBar(el) { var s = cs(el); return (s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().height < 160; }

  var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);

  // ---------- page level ----------
  var out = { vw: W, cw: document.documentElement.clientWidth, vh: window.innerHeight, docH: docH, title: document.title, lang: document.documentElement.lang || '' };
  var loaded = {};
  try { document.fonts.forEach(function (f) { if (f.status === 'loaded') { var k = f.family.replace(/["']/g, ''); (loaded[k] = loaded[k] || {})[String(f.weight)] = 1; } }); } catch (e) {}
  out.fonts = Object.keys(loaded).map(function (k) { return k + ' ' + Object.keys(loaded[k]).join('/'); });
  var vars = {};
  try {
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var rules; try { rules = sheet.cssRules; } catch (e) { return; }
      Array.prototype.forEach.call(rules, function (r) {
        if (r.selectorText === ':root' || r.selectorText === 'html' || r.selectorText === 'body') {
          for (var i = 0; i < r.style.length; i++) {
            var p = r.style[i];
            if (p.indexOf('--') === 0 && Object.keys(vars).length < 70) {
              var v = r.style.getPropertyValue(p).trim();
              var h = /^(#|rgb|hsl|lab|lch|oklab|oklch|color)/.test(v) ? hex(v) : null;
              vars[p] = h || v.slice(0, 80);
            }
          }
        }
      });
    });
  } catch (e) {}
  out.vars = vars;
  var bodyS = cs(document.body);
  out.body = { bg: hex(bodyS.backgroundColor) || hex(cs(document.documentElement).backgroundColor), color: hex(bodyS.color), ff: firstFamily(bodyS.fontFamily), fs: num(bodyS.fontSize), lh: bodyS.lineHeight };

  // ---------- header and fixed bars ----------
  var header = document.querySelector('header') || document.querySelector('nav');
  if (header && visible(header) && header.getBoundingClientRect().top < 40 && header.getBoundingClientRect().height < 200) {
    var hs = cs(header);
    var logo = header.querySelector('img');
    out.header = { r: rect(header), pos: hs.position, bg: hex(hs.backgroundColor), bd: num(hs.borderBottomWidth) ? hex(hs.borderBottomColor) : null,
      logo: logo ? { src: (logo.currentSrc || logo.src || '').slice(0, 200), w: Math.round(logo.getBoundingClientRect().width), h: Math.round(logo.getBoundingClientRect().height) } : null,
      links: Array.prototype.slice.call(header.querySelectorAll('a, button')).filter(visible).slice(0, 16).map(function (a) {
        var s = cs(a), r = rect(a);
        return { t: clean(a.textContent, 28), x: r.x, w: r.w, h: r.h, fs: num(s.fontSize), fw: num(s.fontWeight), c: hex(s.color), bg: hex(s.backgroundColor), r: s.borderRadius === '0px' ? 0 : num(s.borderRadius) };
      }) };
  }
  out.overlays = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(function (el) {
    if (header && header.contains(el)) return false;
    var s = cs(el); if (s.position !== 'fixed') return false;
    var r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20 && r.height < 400 && visible(el) && clean(el.textContent).length > 3;
  }).slice(0, 4).map(function (el) {
    var s = cs(el), r = el.getBoundingClientRect();
    return { t: clean(el.textContent, 90), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(window.innerHeight - r.bottom), bg: hex(s.backgroundColor), bd: num(s.borderTopWidth) ? hex(s.borderTopColor) : null, r: num(s.borderRadius) };
  });

  // ---------- sections ----------
  var c = document.body;
  for (var i = 0; i < 6; i++) {
    var ks = kids(c).filter(function (k) { return !isBar(k); });
    var big = ks.filter(function (k) { return k.getBoundingClientRect().height >= docH * 0.6; });
    if (ks.length === 1 || (big.length === 1 && ks.length <= 3)) {
      var next = big[0] || ks[0];
      // A real section is a section: stop there, even when it is the only one on the page.
      if (/^(SECTION|ARTICLE|FOOTER|ASIDE|NAV|HEADER)$/.test(next.tagName)) break;
      c = next;
    } else break;
  }
  function flatten(list, depth) {
    var res = [];
    list.forEach(function (el) {
      var tag = el.tagName;
      var inner = kids(el).filter(function (k) { return !isBar(k) && k.getBoundingClientRect().height > 24; });
      var s = cs(el);
      var plain = !hex(s.backgroundColor) && s.backgroundImage === 'none' && !num(s.borderTopWidth);
      var tall = el.getBoundingClientRect().height > 700;
      if (depth < 3 && tag !== 'FOOTER' && tag !== 'HEADER' && inner.length >= 2 && (tag === 'MAIN' || (tag === 'DIV' && plain && tall && inner.every(function (k) { return k.getBoundingClientRect().width >= W * 0.6; })))) {
        res = res.concat(flatten(inner, depth + 1));
      } else res.push(el);
    });
    return res;
  }
  var secEls = flatten(kids(c).filter(function (k) { return !isBar(k) && k.tagName !== 'HEADER' && k.getBoundingClientRect().height > 24; }), 0);
  out.sections = secEls.slice(0, 24).map(function (sec, idx) { return measureSection(sec, idx); });

  function measureSection(sec, idx) {
    var base = sec.getBoundingClientRect().top + window.scrollY;
    var s = cs(sec);
    var o = { i: idx, tag: sec.tagName.toLowerCase(), id: sec.id || '', top: Math.round(base), h: Math.round(sec.getBoundingClientRect().height), pt: num(s.paddingTop), pb: num(s.paddingBottom), bg: hex(s.backgroundColor), blocks: [], boxes: [] };
    var bgi = s.backgroundImage;
    if (bgi && bgi !== 'none') o.bgi = bgi.replace(/\s+/g, ' ').slice(0, 160);
    var bt = num(s.borderTopWidth); if (bt) o.bt = hex(s.borderTopColor);
    var seen = [];
    var walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null);
    var node, blocks = [];
    function interactive(el) { return el.tagName === 'A' || el.tagName === 'BUTTON'; }
    function textBlockOf(n) {
      var el = n.parentElement;
      while (el && el !== sec) {
        var d = cs(el).display;
        if (interactive(el)) {
          var blockKids = el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li');
          if (!blockKids.length && clean(el.textContent).length < 60) return el;
        }
        if (d.indexOf('inline') !== 0 || d === 'inline-flex' || d === 'inline-block') { if (d.indexOf('inline') !== 0) return el; if (el.parentElement && cs(el.parentElement).display.indexOf('inline') === 0) { el = el.parentElement; continue; } return el; }
        el = el.parentElement;
      }
      return n.parentElement;
    }
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      var p = node.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
      var el = textBlockOf(node);
      if (!el || seen.indexOf(el) >= 0 || !visible(el)) continue;
      seen.push(el);
      var st = cs(el), r = el.getBoundingClientRect();
      var tag = el.tagName.toLowerCase();
      var kind = /^h[1-6]$/.test(tag) ? tag : tag === 'a' ? 'a' : tag === 'button' ? 'btn' : tag === 'li' ? 'li' : tag === 'p' ? 'p' : tag === 'blockquote' ? 'quote' : 'text';
      var b = { k: kind, t: clean(el.textContent), y: Math.round(r.top + window.scrollY - base), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), fs: num(st.fontSize), fw: num(st.fontWeight), ff: firstFamily(st.fontFamily), c: hex(st.color) };
      var lh = num(st.lineHeight); if (lh) b.lh = lh;
      if (st.letterSpacing !== 'normal' && num(st.letterSpacing)) b.ls = num(st.letterSpacing);
      if (st.textTransform !== 'none') b.tt = st.textTransform;
      if (st.fontStyle === 'italic') b.it = 1;
      if (st.textAlign === 'center' || st.textAlign === 'right') b.ta = st.textAlign;
      if (st.backgroundImage && st.backgroundImage !== 'none' && (st.webkitBackgroundClip === 'text' || st.backgroundClip === 'text')) b.grad = st.backgroundImage.replace(/\s+/g, ' ').slice(0, 130);
      var pill = hex(st.backgroundColor), bdw = num(st.borderTopWidth);
      if (interactive(el) || pill || bdw) {
        if (pill) b.bg = pill;
        if (bdw) { b.bd = num(st.borderTopWidth) + ' ' + hex(st.borderTopColor); }
        var rad = num(st.borderTopLeftRadius); if (rad) b.r = rad > 200 ? 'full' : rad;
        var pad = st.paddingTop + ' ' + st.paddingRight + ' ' + st.paddingBottom + ' ' + st.paddingLeft; if (pad !== '0px 0px 0px 0px') b.pad = pad;
      }
      if (interactive(el) && el.getAttribute('href')) b.href = el.getAttribute('href').slice(0, 120);
      blocks.push(b);
    }
    Array.prototype.forEach.call(sec.querySelectorAll('img, video, iframe, canvas'), function (m) {
      if (!visible(m)) return;
      var r = m.getBoundingClientRect(); var st = cs(m);
      var b = { k: m.tagName === 'IMG' ? 'img' : 'embed', y: Math.round(r.top + window.scrollY - base), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
      if (m.tagName === 'IMG') { b.src = (m.currentSrc || m.src || '').slice(0, 220); if (m.alt) b.alt = clean(m.alt, 80); b.nw = m.naturalWidth; b.nh = m.naturalHeight; }
      else b.src = (m.currentSrc || m.src || '').slice(0, 200);
      var rad = num(st.borderTopLeftRadius); if (rad) b.r = rad > 200 ? 'full' : rad;
      if (st.objectFit && st.objectFit !== 'fill') b.of = st.objectFit;
      if (num(st.opacity) < 1) b.op = num(st.opacity);
      if (st.filter && st.filter !== 'none') b.fl = st.filter.slice(0, 70);
      blocks.push(b);
    });
    Array.prototype.forEach.call(sec.querySelectorAll('svg'), function (m) {
      if (!visible(m) || m.closest('a, button') && clean(m.closest('a, button').textContent).length > 0 && false) return;
      var r = m.getBoundingClientRect(); if (r.width < 8) return;
      blocks.push({ k: 'svg', y: Math.round(r.top + window.scrollY - base), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), c: hex(cs(m).color) });
    });
    blocks.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    o.blocks = blocks.slice(0, MAX_BLOCKS);
    if (blocks.length > MAX_BLOCKS) o.more = blocks.length - MAX_BLOCKS;

    // grids and card rows
    var boxes = [];
    Array.prototype.forEach.call(sec.querySelectorAll('div, ul, ol, section, article, nav'), function (g) {
      if (boxes.length >= 8) return;
      var gs = cs(g);
      var kidsG = kids(g);
      if (kidsG.length < 2 || !(gs.display === 'grid' || (gs.display === 'flex' && gs.flexDirection.indexOf('row') === 0))) return;
      var rs = kidsG.map(function (k) { return k.getBoundingClientRect(); }).filter(function (r) { return r.width > 100 && r.height > 60; });
      if (rs.length < 2) return;
      var w0 = rs[0].width; if (!rs.every(function (r) { return Math.abs(r.width - w0) / w0 < 0.15; })) return;
      var first = kidsG[0], fs = cs(first);
      var box = { y: Math.round(g.getBoundingClientRect().top + window.scrollY - base), x: Math.round(g.getBoundingClientRect().left), w: Math.round(g.getBoundingClientRect().width), h: Math.round(g.getBoundingClientRect().height), n: rs.length, disp: gs.display, gap: gs.columnGap === 'normal' ? 0 : num(gs.columnGap), cw: Math.round(w0), ch: Math.round(rs[0].height) };
      if (gs.display === 'grid') box.cols = gs.gridTemplateColumns.split(' ').length;
      var cbg = hex(fs.backgroundColor), cbd = num(fs.borderTopWidth), cr = num(fs.borderTopLeftRadius);
      if (cbg) box.bg = cbg; if (cbd) box.bd = num(fs.borderTopWidth) + ' ' + hex(fs.borderTopColor); if (cr) box.r = cr;
      if (fs.paddingTop !== '0px') box.pad = fs.paddingTop + ' ' + fs.paddingRight;
      if (fs.boxShadow && fs.boxShadow !== 'none') box.sh = fs.boxShadow.slice(0, 90);
      boxes.push(box);
    });
    o.boxes = boxes;
    // Stacked slides: several large siblings with the same box, laid on top of each other.
    var slides = 0;
    Array.prototype.forEach.call(sec.querySelectorAll('div, ul'), function (g) {
      var abs = Array.prototype.filter.call(g.children, function (k) { return cs(k).position === 'absolute' && k.getBoundingClientRect().width > 300 && k.getBoundingClientRect().height > 200; });
      if (abs.length < 2) return;
      var r0 = abs[0].getBoundingClientRect();
      var same = abs.filter(function (k) { var r = k.getBoundingClientRect(); return Math.abs(r.left - r0.left) < 3 && Math.abs(r.top - r0.top) < 3 && Math.abs(r.width - r0.width) < 3; });
      if (same.length >= 2 && same.length > slides) slides = same.length;
    });
    if (slides) o.carousel = slides;
    return o;
  }
  return JSON.parse(JSON.stringify(out));
}`;
