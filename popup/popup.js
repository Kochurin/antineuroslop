/* Антинейрослоп: окно разбора */
(function () {
  'use strict';
  var ext = globalThis.browser || globalThis.chrome;
  var AS = globalThis.AntiSlop;
  var $ = function (id) { return document.getElementById(id); };
  var ta = $('text');
  var state = { enabled: true, disabledRules: {}, disabledSites: {}, host: '', active: null, res: null };

  var SAMPLE = 'В современном мире искусственный интеллект — это не просто модное слово, а настоящий инструмент для бизнеса. Давайте разберёмся, почему это важно.\n\n' +
    'Важно отметить, что данный подход является ключевым для компаний любого масштаба. Он делает работу быстрой, надёжной и удобной. Результат? Команда действительно экономит время.\n\n' +
    'Быстро. Просто. Эффективно.\n\n' +
    'В заключение, это меняет правила игры. Надеюсь, это поможет!';

  function store() { return ext && ext.storage && ext.storage.local; }
  function get(keys) {
    try { var p = store().get(keys); if (p && p.then) return p; } catch (e) {}
    return new Promise(function (res) { try { store().get(keys, res); } catch (e) { res({}); } });
  }
  function set(obj) { try { store().set(obj); } catch (e) {} }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function run() {
    var text = ta.value;
    var has = text.trim().length > 0;
    $('result').hidden = !has;
    $('empty').hidden = has;
    $('copy').disabled = !has;
    set({ draft: text });
    if (!has) { $('autofix').disabled = true; return; }
    var res = AS.analyze(text, { disabled: state.disabledRules });
    state.res = res;
    if (state.active != null && state.active >= res.matches.length) state.active = null;

    $('result').className = 'tone-' + res.verdict.tone;
    $('score').textContent = res.score;
    $('verdict').textContent = res.verdict.label;
    $('bar').style.width = res.score + '%';
    var n = res.matches.length + res.notes.length;
    $('stats').textContent = res.words + ' ' + plural(res.words, 'слово', 'слова', 'слов') + ', ' + (n ? n + ' ' + plural(n, 'штамп', 'штампа', 'штампов') : 'штампов не нашёл');
    $('autofix').disabled = !res.matches.some(function (m) { return m.fixes.length; });

    // Текст с подсветкой
    var html = '', pos = 0;
    res.matches.forEach(function (m, i) {
      html += esc(text.slice(pos, m.start));
      html += '<mark data-i="' + i + '" class="' + (m.weight >= 2 ? 's' : '') + (state.active === i ? ' on' : '') + '" title="' + esc(m.title) + '">' + esc(text.slice(m.start, m.end)) + '</mark>';
      pos = m.end;
    });
    html += esc(text.slice(pos));
    $('preview').innerHTML = html;

    // Список
    var list = res.notes.map(function (nt) {
      return '<li class="note"><div class="top"><span class="cat">' + esc(nt.cat) + '</span><span class="t">' + esc(nt.title) + '</span></div><div class="w">' + esc(nt.why) + '</div></li>';
    });
    res.matches.forEach(function (m, i) {
      var fx = m.fixes.map(function (f, k) {
        return '<button data-i="' + i + '" data-f="' + k + '">' + esc(fixLabel(m, f, k)) + '</button>';
      }).join('');
      list.push('<li data-i="' + i + '" class="' + (state.active === i ? 'on' : '') + '">' +
        '<div class="top"><span class="cat">' + esc(m.cat) + '</span><span class="t">' + esc(m.title) + '</span></div>' +
        '<q>' + esc(m.text.trim() || m.text) + '</q>' +
        '<div class="w">' + esc(m.why) + '</div>' +
        (m.hint ? '<div class="h">' + esc(m.hint) + '</div>' : '') +
        (fx ? '<div class="fx">' + fx + '</div>' : '') + '</li>');
    });
    $('list').innerHTML = list.join('');
  }

  function fixLabel(m, f, k) {
    if (m.rule === 'em-dash') return ['Запятая', 'Точка', 'Двоеточие', '«это»'][k] || f;
    if (m.rule === 'final-period') return 'Убрать точку';
    if (f === '') return 'Удалить';
    return 'Заменить на «' + f.trim() + '»';
  }

  function plural(n, a, b, c) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return b;
    return c;
  }

  function applyFix(i, k) {
    var m = state.res.matches[i];
    ta.value = AS.fixText(ta.value, m, m.fixes[k]);
    state.active = null;
    run();
  }

  // Применяет первый вариант ко всем простым штампам, где замена однозначна
  function autofix() {
    var text = ta.value;
    for (var guard = 0; guard < 300; guard++) {
      var res = AS.analyze(text, { disabled: state.disabledRules });
      var m = res.matches.filter(function (x) { return x.fixes.length && x.rule !== 'em-dash' && x.rule !== 'triplet'; })[0];
      if (!m) break;
      var next = AS.fixText(text, m, m.fixes[0]);
      if (next === text) break;
      text = next;
    }
    ta.value = text;
    state.active = null;
    run();
  }

  ta.addEventListener('input', function () { state.active = null; run(); });
  $('sample').addEventListener('click', function () { ta.value = SAMPLE; state.active = null; run(); ta.focus(); });
  $('clear').addEventListener('click', function () { ta.value = ''; run(); ta.focus(); });
  $('autofix').addEventListener('click', autofix);
  $('copy').addEventListener('click', function () {
    var b = $('copy');
    navigator.clipboard.writeText(ta.value).then(function () {
      b.textContent = 'Скопировано';
      setTimeout(function () { b.textContent = 'Копировать'; }, 1200);
    }, function () { ta.select(); document.execCommand('copy'); });
  });

  $('preview').addEventListener('click', function (e) {
    var mk = e.target.closest('mark');
    if (!mk) return;
    state.active = +mk.dataset.i;
    run();
    var li = $('list').querySelector('li[data-i="' + state.active + '"]');
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (b) { applyFix(+b.dataset.i, +b.dataset.f); return; }
    var li = e.target.closest('li[data-i]');
    if (!li) return;
    state.active = +li.dataset.i;
    run();
    var mk = $('preview').querySelector('mark[data-i="' + state.active + '"]');
    if (mk) mk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // Настройки
  $('enabled').addEventListener('change', function () {
    state.enabled = this.checked;
    set({ enabled: state.enabled });
    syncToggles();
  });
  $('site').addEventListener('change', function () {
    if (!state.host) return;
    if (this.checked) delete state.disabledSites[state.host]; else state.disabledSites[state.host] = 1;
    set({ disabledSites: state.disabledSites });
  });
  $('restore').addEventListener('click', function () {
    state.disabledRules = {};
    set({ disabledRules: {} });
    syncDisabled();
    run();
  });

  function syncToggles() {
    $('enabled').checked = state.enabled;
    $('site').checked = !state.disabledSites[state.host];
    $('siteWrap').classList.toggle('off', !state.enabled || !state.host);
    $('host').textContent = state.host || 'этот сайт';
  }
  function syncDisabled() {
    var n = Object.keys(state.disabledRules).length;
    $('disabledWrap').hidden = n === 0;
    $('disabledCount').textContent = n;
  }

  $('promoClose').addEventListener('click', function () {
    $('promo').hidden = true;
    set({ promoHidden: true });
  });

  get(['enabled', 'disabledRules', 'disabledSites', 'draft', 'promoHidden']).then(function (v) {
    v = v || {};
    $('promo').hidden = !!v.promoHidden;
    state.enabled = v.enabled !== false;
    state.disabledRules = v.disabledRules || {};
    state.disabledSites = v.disabledSites || {};
    if (v.draft) ta.value = v.draft;
    syncToggles();
    syncDisabled();
    run();
  });

  try {
    ext.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      var u = tabs && tabs[0] && tabs[0].url;
      if (u && /^https?:/.test(u)) state.host = new URL(u).hostname;
      syncToggles();
    }, function () {});
  } catch (e) {}

  ta.focus();
})();
