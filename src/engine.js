/*
 * Антинейрослоп: движок разбора
 * analyze(text) находит штампы, считает «оценку человечности»
 * planFix(text, match, insert) готовит аккуратную замену: убирает двойные пробелы,
 * висящие запятые и поднимает регистр в начале предложения
 */
(function (root) {
  'use strict';

  var R = root.AntiSlopRules || (typeof require === 'function' ? require('./rules.js') : null);
  var MAX_LEN = 30000;

  function countWords(text) {
    var m = text.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu);
    return m ? m.length : 0;
  }

  function splitSentences(text) {
    return text
      .split(/(?<=[.!?…])\s+|\n+/u)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return countWords(s) > 0; });
  }

  // Ровный ритм: все предложения одной длины — признак генерации
  function rhythmNote(text) {
    var sents = splitSentences(text);
    if (sents.length < 5) return null;
    var lens = sents.map(countWords);
    var mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
    if (mean < 6) return null;
    var sd = Math.sqrt(lens.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / lens.length);
    var cv = sd / mean;
    if (cv < 0.28) {
      return {
        id: 'rhythm',
        cat: 'Ритм',
        title: 'Одинаковая длина предложений',
        why: 'Все предложения примерно по ' + Math.round(mean) + ' слов. Человек пишет неровно: длинная мысль, потом короткая',
        weight: 3
      };
    }
    return null;
  }

  function analyze(text, opts) {
    opts = opts || {};
    var disabled = opts.disabled || {};
    var ignored = opts.ignored || {};
    text = String(text || '');
    var src = text.length > MAX_LEN ? text.slice(0, MAX_LEN) : text;
    var found = [];

    R.rules.forEach(function (rule) {
      if (disabled[rule.id]) return;
      var re = rule.re;
      re.lastIndex = 0;
      var g;
      var guard = 0;
      while ((g = re.exec(src)) !== null) {
        if (++guard > 2000) break;
        if (g[0].length === 0) { re.lastIndex++; continue; }
        var raw = g[0];
        if (rule.check && !rule.check(raw, g, src, g.index)) continue;
        // Видимая часть без крайних пробелов и запятых
        var lead = raw.match(/^[\s,]*/)[0].length;
        var trail = raw.match(/[\s,]*$/)[0].length;
        if (rule.id === 'em-dash') { lead = raw.match(/^\s*/)[0].length; trail = raw.match(/\s*$/)[0].length; }
        var start = g.index + lead;
        var end = g.index + raw.length - trail;
        if (end <= start) { start = g.index; end = g.index + raw.length; }
        var shown = src.slice(start, end);
        var key = rule.id + '|' + shown.toLowerCase();
        if (ignored[key]) continue;
        var fixes = typeof rule.fix === 'function' ? rule.fix(shown, g, src, g.index) : (rule.fix || []);
        found.push({
          rule: rule.id,
          cat: rule.cat,
          title: rule.title,
          why: rule.why,
          weight: rule.weight || 1,
          advice: !!rule.advice,
          start: start,
          end: end,
          rawStart: g.index,
          rawEnd: g.index + raw.length,
          text: shown,
          key: key,
          fixes: rule.advice ? [] : uniq(fixes),
          hint: rule.advice ? fixes[0] : null
        });
      }
    });

    // Пересечения: оставляем более весомое, при равенстве более длинное и раннее
    found.sort(function (a, b) {
      return b.weight - a.weight || (b.end - b.start) - (a.end - a.start) || a.start - b.start;
    });
    var kept = [];
    found.forEach(function (m) {
      for (var i = 0; i < kept.length; i++) {
        if (m.start < kept[i].end && kept[i].start < m.end) return;
      }
      kept.push(m);
    });
    kept.sort(function (a, b) { return a.start - b.start; });

    var notes = [];
    if (!disabled.rhythm) {
      var rn = rhythmNote(src);
      if (rn) notes.push(rn);
    }

    var words = countWords(src);
    var score = humanScore(kept, notes, words);
    return { matches: kept, notes: notes, words: words, score: score, verdict: verdict(score, words), truncated: text.length > MAX_LEN };
  }

  function uniq(arr) {
    var seen = {};
    return arr.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
  }

  // Плотность штампов на 100 слов → оценка 0..100
  function humanScore(matches, notes, words) {
    if (words === 0) return 100;
    var w = 0;
    matches.forEach(function (m) { w += m.weight; });
    notes.forEach(function (n) { w += n.weight; });
    var per100 = w / Math.max(words, 40) * 100;
    return Math.round(100 / (1 + per100 / 5));
  }

  function verdict(score, words) {
    if (words === 0) return { label: 'Пусто', tone: 'none' };
    if (score >= 85) return { label: 'Похоже на человека', tone: 'good' };
    if (score >= 65) return { label: 'Есть штампы', tone: 'ok' };
    if (score >= 40) return { label: 'Пахнет нейросетью', tone: 'warn' };
    return { label: 'Нейрослоп', tone: 'bad' };
  }

  function isUpper(ch) { return ch && ch.toLowerCase() !== ch && ch.toUpperCase() === ch; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /*
   * План замены совпадения на insert
   * Возвращает {start, end, insert} в координатах исходного текста
   */
  function planFix(text, m, insert) {
    var start, end;
    if (insert === '') { start = m.rawStart; end = m.rawEnd; }
    else { start = m.start; end = m.end; }
    if (m.rule === 'em-dash') { start = m.rawStart; end = m.rawEnd; }

    var left = text.slice(0, start);
    var right = text.slice(end);
    var atSentenceStart = /(?:^|[.!?…]\s+|\n\s*)$/u.test(left);

    // Регистр: если исходник был с заглавной, заглавная и у замены
    if (insert && isUpper(m.text.charAt(0)) && atSentenceStart) insert = cap(insert);

    if (insert === '') {
      // Висящая запятая или пробел перед знаком препинания
      var tailJunk = left.match(/[\s,]+$/);
      if (tailJunk && /^[.,!?;:)»]/.test(right)) { start -= tailJunk[0].length; left = text.slice(0, start); }
      // Двойной пробел на стыке
      if (/[ \t]$/.test(left) && /^[ \t]/.test(right)) {
        var sp = right.match(/^[ \t]+/)[0].length;
        end += sp; right = text.slice(end);
      }
      // Пробел в начале строки после удаления
      if (/(?:^|\n)$/.test(left)) {
        var lsp = right.match(/^[ \t]+/);
        if (lsp) { end += lsp[0].length; right = text.slice(end); }
      }
      // Удалили хвост строки: убираем висящую запятую и пробелы
      if (/^(?:\r?\n|$)/.test(right)) {
        var dangling = left.match(/[ \t,]+$/);
        if (dangling) { start -= dangling[0].length; left = text.slice(0, start); }
      }
      if (/(?:^|[.!?…]\s+|\n\s*)$/u.test(left) && /^\p{Ll}/u.test(right)) {
        insert = right.charAt(0).toUpperCase();
        end += 1;
      }
    } else if (/[.!?]\s$/.test(insert) && /^\p{Ll}/u.test(right)) {
      insert += right.charAt(0).toUpperCase();
      end += 1;
    }
    return { start: start, end: end, insert: insert };
  }

  function applyPlan(text, p) {
    return text.slice(0, p.start) + p.insert + text.slice(p.end);
  }

  function fixText(text, m, insert) {
    return applyPlan(text, planFix(text, m, insert));
  }

  var api = { analyze: analyze, planFix: planFix, applyPlan: applyPlan, fixText: fixText, countWords: countWords, rules: R.rules };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AntiSlop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
