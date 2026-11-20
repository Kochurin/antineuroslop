/*
 * Антинейрослоп: подсветка штампов в полях ввода
 * textarea и input: прозрачная копия поля поверх него с подчёркиваниями
 * contenteditable: CSS Custom Highlight API, DOM страницы не трогаем
 * Текст никуда не отправляется: весь разбор идёт в этой вкладке
 */
(function () {
  'use strict';
  if (window.__antislopLoaded) return;
  window.__antislopLoaded = true;

  var AS = globalThis.AntiSlop;
  if (!AS) return;
  var ext = globalThis.browser || globalThis.chrome;
  var HAS_HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  var host = location.hostname;

  var settings = { enabled: true, disabledRules: {}, disabledSites: {} };
  var ignored = {}; // пропущенные в этой вкладке
  var cur = null;   // текущий редактор
  var timer = 0;

  function active() { return settings.enabled !== false && !(settings.disabledSites || {})[host]; }

  try {
    ext.storage.local.get(['enabled', 'disabledRules', 'disabledSites']).then(apply, function () {});
  } catch (e) {
    try { ext.storage.local.get(['enabled', 'disabledRules', 'disabledSites'], apply); } catch (e2) {}
  }
  function apply(v) {
    v = v || {};
    if (typeof v.enabled === 'boolean') settings.enabled = v.enabled;
    settings.disabledRules = v.disabledRules || {};
    settings.disabledSites = v.disabledSites || {};
    if (!active()) clearAll(); else if (cur) analyzeNow();
  }
  try {
    ext.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local') return;
      var v = {};
      ['enabled', 'disabledRules', 'disabledSites'].forEach(function (k) { v[k] = ch[k] ? ch[k].newValue : settings[k]; });
      apply(v);
    });
  } catch (e) {}

  // ---------- Интерфейс в shadow DOM ----------
  var rootHost = document.createElement('antislop-root');
  rootHost.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
  var shadow = rootHost.attachShadow({ mode: 'open' });
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    ':host{all:initial}',
    '.mirror{position:fixed;overflow:hidden;pointer-events:none;color:transparent!important;background:transparent!important;border-color:transparent!important;box-sizing:border-box;margin:0}',
    '.mirror mark{color:transparent;background:rgba(245,158,11,.18);text-decoration:underline wavy rgba(217,119,6,.9);text-decoration-thickness:1.5px;text-underline-offset:3px;border-radius:2px;padding:0;margin:0}',
    '.mirror mark.s{background:rgba(229,72,77,.16);text-decoration-color:rgba(220,38,38,.95)}',
    '.mirror mark.on{background:rgba(229,72,77,.32)}',
    '.badge{position:fixed;pointer-events:auto;cursor:pointer;font:600 11px/1 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;background:#fff;border:1px solid #d6d6da;border-radius:999px;padding:4px 8px 4px 6px;box-shadow:0 2px 8px rgba(0,0,0,.12);display:flex;align-items:center;gap:5px;user-select:none;white-space:nowrap}',
    '.badge i{width:8px;height:8px;border-radius:50%;background:#22a06b;display:inline-block}',
    '.badge.ok i{background:#d4a017}.badge.warn i{background:#e8743b}.badge.bad i{background:#dc2626}',
    '.badge[hidden],.pop[hidden],.mirror[hidden]{display:none}',
    '.pop{position:fixed;pointer-events:auto;width:300px;max-width:calc(100vw - 16px);background:#fff;color:#111;border:1px solid #dcdce0;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.16);font:13px/1.4 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:12px 12px 10px;box-sizing:border-box}',
    '.pop .cat{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a8a90}',
    '.pop .t{font-weight:700;font-size:14px;margin:3px 0 4px}',
    '.pop .w{color:#4a4a50;margin-bottom:9px}',
    '.pop .h{color:#111;background:#f3f3f5;border-radius:8px;padding:7px 9px;margin-bottom:9px}',
    '.pop .fx{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
    '.pop button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid #d6d6da;background:#fff;color:#111;padding:5px 9px}',
    '.pop button.p{background:#111;color:#fff;border-color:#111}',
    '.pop button:hover{filter:brightness(.95)}',
    '.pop .ft{display:flex;gap:10px;border-top:1px solid #eee;padding-top:8px}',
    '.pop .ft button{border:0;padding:2px 0;color:#6b6b70;background:none}',
    '.pop .ft button:hover{color:#111}',
    '.pop .nav{margin-left:auto;color:#8a8a90;font-size:12px;display:flex;gap:8px;align-items:center}',
    '.pop .nav button{border:0;background:none;padding:0 2px;color:#6b6b70;font-size:14px}',
    '.pop s{color:#8a8a90}'
  ].join('');
  function box(cls) { var d = document.createElement('div'); d.className = cls; d.hidden = true; return d; }
  var mirror = box('mirror');
  var badge = box('badge');
  badge.appendChild(document.createElement('i'));
  badge.appendChild(document.createElement('span'));
  var pop = box('pop');
  [styleEl, mirror, badge, pop].forEach(function (n) { shadow.appendChild(n); });
  function mount() { if (!rootHost.isConnected) (document.body || document.documentElement).appendChild(rootHost); }

  // ---------- Поиск редактора ----------
  var SKIP = '.monaco-editor,.cm-editor,.CodeMirror,.ace_editor,[data-antislop="off"]';
  function editorFrom(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest && el.closest(SKIP)) return null;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return el.readOnly || el.disabled ? null : el;
    if (tag === 'INPUT') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (['text', 'search', ''].indexOf(t) < 0 || el.readOnly || el.disabled) return null;
      return el;
    }
    if (el.isContentEditable) {
      var r = el;
      while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
      return r;
    }
    return null;
  }
  function isField(el) { return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'); }

  // ---------- Текст contenteditable с картой смещений ----------
  var BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER)$/;
  function ceText(root) {
    var text = '';
    var map = [];
    function nl() { if (text && text.charAt(text.length - 1) !== '\n') text += '\n'; }
    (function walk(node) {
      if (node.nodeType === 3) { map.push({ node: node, start: text.length, len: node.data.length }); text += node.data; return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'BR') { text += '\n'; return; }
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'TEMPLATE') return;
      var block = BLOCK.test(tag) && node !== root;
      if (block) nl();
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      if (block) nl();
    })(root);
    return { text: text, map: map };
  }
  function domPos(map, pos, isEnd) {
    for (var i = 0; i < map.length; i++) {
      var s = map[i];
      if (pos < s.start) return { node: s.node, off: 0 };
      if (pos <= s.start + s.len) {
        if (pos === s.start + s.len && !isEnd && map[i + 1] && map[i + 1].start === pos) continue;
        return { node: s.node, off: pos - s.start };
      }
    }
    var last = map[map.length - 1];
    return last ? { node: last.node, off: last.len } : null;
  }
  function textPos(map, node, off) {
    for (var i = 0; i < map.length; i++) if (map[i].node === node) return map[i].start + off;
    return -1;
  }
  function makeRange(map, start, end) {
    var a = domPos(map, start, false), b = domPos(map, end, true);
    if (!a || !b) return null;
    var r = document.createRange();
    try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); } catch (e) { return null; }
    return r;
  }

  // ---------- Разбор ----------
  function getText(st) {
    if (isField(st.el)) return st.el.value;
    var t = ceText(st.el);
    st.map = t.map;
    return t.text;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(analyzeNow, 280);
  }

  function analyzeNow() {
    if (!cur || !active()) return;
    if (!cur.el.isConnected) { detach(); return; }
    var text = getText(cur);
    cur.text = text;
    cur.res = AS.analyze(text, { disabled: settings.disabledRules, ignored: ignored });
    if (!isField(cur.el)) cur.ranges = cur.res.matches.map(function (m) { return makeRange(cur.map, m.start, m.end); });
    render();
  }

  function render() {
    mount();
    if (!cur || !cur.res) return;
    if (isField(cur.el)) renderMirror(); else renderHighlights();
    position();
    renderBadge();
  }

  function renderHighlights() {
    if (!HAS_HL) return;
    var strong = [], mild = [];
    cur.res.matches.forEach(function (m, i) {
      var r = cur.ranges[i];
      if (!r) return;
      (m.weight >= 2 ? strong : mild).push(r);
    });
    CSS.highlights.set('antislop', new Highlight(...mild));
    CSS.highlights.set('antislop-strong', new Highlight(...strong));
    var a = cur.activeIdx != null ? cur.ranges[cur.activeIdx] : null;
    if (a) CSS.highlights.set('antislop-active', new Highlight(a)); else CSS.highlights.delete('antislop-active');
  }

  var COPY = ['boxSizing', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
    'fontSize', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'fontKerning', 'textAlign', 'textTransform', 'textIndent',
    'letterSpacing', 'wordSpacing', 'tabSize', 'direction', 'wordBreak', 'overflowWrap', 'hyphens'];

  function renderMirror() {
    var el = cur.el, text = cur.text, ms = cur.res.matches;
    var cs = getComputedStyle(el);
    COPY.forEach(function (p) { mirror.style[p] = cs[p]; });
    var isInput = el.tagName === 'INPUT';
    mirror.style.whiteSpace = isInput ? 'pre' : 'pre-wrap';
    mirror.style.overflowWrap = isInput ? 'normal' : 'break-word';
    var sbw = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    if (sbw > 0) mirror.style.paddingRight = (parseFloat(cs.paddingRight) + sbw) + 'px';
    if (isInput) {
      var inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      mirror.style.lineHeight = inner + 'px';
    }
    var frag = document.createDocumentFragment();
    var pos = 0;
    ms.forEach(function (m, i) {
      if (m.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.start)));
      var mk = document.createElement('mark');
      mk.dataset.i = i;
      mk.className = (m.weight >= 2 ? 's' : '') + (cur.activeIdx === i ? ' on' : '');
      mk.textContent = text.slice(m.start, m.end);
      frag.appendChild(mk);
      pos = m.end;
    });
    frag.appendChild(document.createTextNode(text.slice(pos) + '​'));
    mirror.textContent = '';
    mirror.appendChild(frag);
    mirror.hidden = ms.length === 0;
  }

  function position() {
    if (!cur) return;
    var r = cur.el.getBoundingClientRect();
    var visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    if (isField(cur.el)) {
      mirror.hidden = !visible || !cur.res || cur.res.matches.length === 0;
      mirror.style.left = r.left + 'px';
      mirror.style.top = r.top + 'px';
      mirror.style.width = r.width + 'px';
      mirror.style.height = r.height + 'px';
      mirror.scrollTop = cur.el.scrollTop;
      mirror.scrollLeft = cur.el.scrollLeft;
    }
    if (!visible) { badge.hidden = true; return; }
    if (!cur.res || cur.res.words < 3) { badge.hidden = true; return; }
    badge.hidden = false;
    var bw = badge.offsetWidth || 60, bh = badge.offsetHeight || 20;
    var x = r.right - bw - 6, y = r.bottom - bh - 6;
    if (r.height < bh + 12) y = r.bottom + 4;
    badge.style.left = Math.max(4, Math.min(x, innerWidth - bw - 4)) + 'px';
    badge.style.top = Math.max(4, Math.min(y, innerHeight - bh - 4)) + 'px';
    if (!pop.hidden && cur.activeIdx != null) placePop();
  }

  function renderBadge() {
    var res = cur.res;
    var n = res.matches.length + res.notes.length;
    badge.className = 'badge ' + res.verdict.tone;
    var n10 = n % 10, n100 = n % 100;
    var word = n10 === 1 && n100 !== 11 ? 'штамп' : (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? 'штампа' : 'штампов');
    badge.querySelector('span').textContent = n ? n + ' ' + word : 'Чисто';
    badge.title = 'Антинейрослоп: человечность ' + res.score + ' из 100, ' + res.verdict.label.toLowerCase() + (n ? '. Нажмите, чтобы пройтись по штампам' : '');
  }

  // ---------- Подсказка ----------
  // Элемент из тега, атрибутов и детей (строки становятся текстом, без innerHTML)
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 5) === 'data-') el.dataset[k.slice(5)] = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function fill(el, kids) { el.textContent = ''; kids.forEach(function (c) { if (c) el.appendChild(c); }); }

  function openPop(i) {
    if (!cur || !cur.res) return;
    var ms = cur.res.matches;
    if (!ms.length) {
      if (cur.res.notes.length) {
        var n = cur.res.notes[0];
        fill(pop, [h('div', { class: 'cat' }, [n.cat]), h('div', { class: 't' }, [n.title]), h('div', { class: 'w' }, [n.why])]);
        cur.activeIdx = null; pop.hidden = false; placePopAt(cur.el.getBoundingClientRect(), true);
      }
      return;
    }
    i = (i + ms.length) % ms.length;
    var m = ms[i];
    cur.activeIdx = i;
    var fixes = m.fixes.map(function (f, k) {
      var label = f === '' ? 'Удалить «' + short(m.text) + '»' : (f.trim() === '' ? 'Убрать' : f);
      if (m.rule === 'em-dash') label = ['Запятая', 'Точка', 'Двоеточие', '«это»'][k] || label;
      if (m.rule === 'final-period') label = 'Убрать точку';
      return h('button', { 'data-f': String(k), class: k === 0 ? 'p' : '' }, [label]);
    });
    fill(pop, [
      h('div', { class: 'cat' }, [m.cat]),
      h('div', { class: 't' }, [m.title]),
      h('div', { class: 'w' }, [m.why]),
      m.hint ? h('div', { class: 'h' }, [m.hint]) : null,
      fixes.length ? h('div', { class: 'fx' }, fixes) : null,
      h('div', { class: 'ft' }, [
        h('button', { 'data-a': 'skip' }, ['Пропустить']),
        h('button', { 'data-a': 'off' }, ['Не искать такое']),
        h('span', { class: 'nav' }, [
          h('button', { 'data-a': 'prev', title: 'Предыдущий' }, ['‹']),
          (i + 1) + ' из ' + ms.length,
          h('button', { 'data-a': 'next', title: 'Следующий' }, ['›'])
        ])
      ])
    ]);
    pop.hidden = false;
    if (isField(cur.el)) renderMirror(); else renderHighlights();
    revealMatch(m);
    placePop();
  }
  function short(s) { s = s.trim(); return s.length > 28 ? s.slice(0, 26) + '…' : s; }

  function revealMatch(m) {
    if (!isField(cur.el)) {
      var r = cur.ranges[cur.activeIdx];
      if (r) {
        var rr = r.getBoundingClientRect();
        var er = cur.el.getBoundingClientRect();
        if (rr.top < er.top || rr.bottom > er.bottom) {
          var n = r.startContainer.parentElement;
          if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
        }
      }
      return;
    }
    var mk = mirror.querySelector('mark[data-i="' + cur.activeIdx + '"]');
    if (!mk) return;
    var el = cur.el;
    var top = mk.offsetTop, h = mk.offsetHeight;
    if (top < el.scrollTop || top + h > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
      mirror.scrollTop = el.scrollTop;
    }
  }

  function anchorRect() {
    if (!cur || cur.activeIdx == null) return null;
    if (isField(cur.el)) {
      var mk = mirror.querySelector('mark[data-i="' + cur.activeIdx + '"]');
      return mk ? mk.getBoundingClientRect() : null;
    }
    var r = cur.ranges[cur.activeIdx];
    if (!r) return null;
    var rects = r.getClientRects();
    return rects.length ? rects[0] : r.getBoundingClientRect();
  }
  function placePop() {
    var a = anchorRect();
    if (a) placePopAt(a, false); else placePopAt(cur.el.getBoundingClientRect(), true);
  }
  function placePopAt(a, inside) {
    var pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 160;
    var x = Math.max(8, Math.min(a.left, innerWidth - pw - 8));
    var y = inside ? a.top + 8 : a.bottom + 6;
    if (!inside && y + ph > innerHeight - 8) y = Math.max(8, a.top - ph - 6);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }
  function closePop() {
    pop.hidden = true;
    if (cur && cur.activeIdx != null) {
      cur.activeIdx = null;
      if (cur.res) { if (isField(cur.el)) renderMirror(); else renderHighlights(); }
    }
  }

  // Клики внутри подсказки не должны забирать фокус у поля
  pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
  badge.addEventListener('mousedown', function (e) { e.preventDefault(); });
  badge.addEventListener('click', function () {
    if (!pop.hidden) { closePop(); return; }
    openPop(0);
  });
  pop.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !cur || cur.activeIdx == null) return;
    var m = cur.res.matches[cur.activeIdx];
    if (b.dataset.f != null) { applyFix(m, m.fixes[+b.dataset.f]); return; }
    var a = b.dataset.a;
    if (a === 'next') openPop(cur.activeIdx + 1);
    else if (a === 'prev') openPop(cur.activeIdx - 1);
    else if (a === 'skip') { ignored[m.key] = 1; afterChange(cur.activeIdx); }
    else if (a === 'off') {
      settings.disabledRules[m.rule] = 1;
      try { ext.storage.local.set({ disabledRules: settings.disabledRules }); } catch (err) {}
      afterChange(cur.activeIdx);
    }
  });

  function afterChange(idx) {
    analyzeNow();
    if (cur && cur.res && cur.res.matches.length) openPop(Math.min(idx, cur.res.matches.length - 1));
    else closePop();
  }

  function applyFix(m, insert) {
    var el = cur.el;
    var text = getText(cur);
    if (text !== cur.text) { analyzeNow(); closePop(); return; }
    var p = AS.planFix(text, m, insert);
    el.focus();
    var ok = false;
    if (isField(el)) {
      el.setSelectionRange(p.start, p.end);
      try { ok = p.insert ? document.execCommand('insertText', false, p.insert) : document.execCommand('delete'); } catch (e) { ok = false; }
      if (!ok || el.value === text) {
        el.setRangeText(p.insert, p.start, p.end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      var r = makeRange(cur.map, p.start, p.end);
      if (!r) return;
      var sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      try { ok = p.insert ? document.execCommand('insertText', false, p.insert) : document.execCommand('delete'); } catch (e) { ok = false; }
      if (!ok) {
        r.deleteContents();
        if (p.insert) r.insertNode(document.createTextNode(p.insert));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: p.insert }));
      }
    }
    var idx = cur.activeIdx;
    // Редакторы вроде Telegram перерисовывают DOM асинхронно
    setTimeout(function () { afterChange(idx); }, 30);
  }

  // Клик по подсвеченному слову
  function caretOffset() {
    if (!cur) return -1;
    if (isField(cur.el)) {
      if (cur.el.selectionStart !== cur.el.selectionEnd) return -1;
      return cur.el.selectionStart;
    }
    var sel = getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || !cur.el.contains(sel.anchorNode)) return -1;
    if (sel.anchorNode.nodeType !== 3) return -1;
    getText(cur);
    return textPos(cur.map, sel.anchorNode, sel.anchorOffset);
  }

  function onClick(e) {
    if (!cur || !active()) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(rootHost) >= 0) return;
    if (!cur.el.contains(e.target) && e.target !== cur.el) { closePop(); return; }
    setTimeout(function () {
      if (!cur || !cur.res) return;
      if (cur.text !== getText(cur)) { analyzeNow(); }
      var off = caretOffset();
      if (off < 0) { closePop(); return; }
      var ms = cur.res.matches;
      for (var i = 0; i < ms.length; i++) {
        if (off >= ms[i].start && off <= ms[i].end) { openPop(i); return; }
      }
      closePop();
    }, 0);
  }

  // ---------- Жизненный цикл ----------
  function attach(el) {
    if (!el || !active()) return;
    if (cur && cur.el === el) return;
    detach();
    cur = { el: el, res: null, ranges: [], map: [], activeIdx: null, text: '' };
    el.addEventListener('scroll', position, { passive: true });
    analyzeNow();
  }
  function detach() {
    if (cur) cur.el.removeEventListener('scroll', position);
    cur = null;
    clearAll();
  }
  function clearAll() {
    mirror.hidden = true;
    badge.hidden = true;
    pop.hidden = true;
    if (HAS_HL) ['antislop', 'antislop-strong', 'antislop-active'].forEach(function (k) { CSS.highlights.delete(k); });
  }

  document.addEventListener('focusin', function (e) {
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    var ed = editorFrom(t);
    if (ed) attach(ed);
  }, true);
  document.addEventListener('input', function (e) {
    if (!active()) return;
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    var ed = editorFrom(t);
    if (!ed) return;
    if (!cur || cur.el !== ed) attach(ed);
    if (!pop.hidden) closePop();
    schedule();
  }, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) closePop(); }, true);
  addEventListener('scroll', function () { if (cur) position(); }, true);
  addEventListener('resize', function () { if (cur) render(); });
  // Поле может переехать без событий: раз в 300 мс сверяем позицию
  setInterval(function () { if (cur && cur.res) { if (!cur.el.isConnected) detach(); else position(); } }, 300);

  // Поле уже в фокусе при загрузке
  if (document.activeElement) attach(editorFrom(document.activeElement));
})();
