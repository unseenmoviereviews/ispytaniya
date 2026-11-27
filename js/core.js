/*
 * Движок «Испытаний»: вход по ФИО и группе, меню работ, пошаговое прохождение,
 * подсчёт баллов и оценки, счётчик уходов со страницы, отправка в Google Таблицу.
 * Содержание работ лежит в js/data.js (собирается из папки src/).
 */
(function () {
  "use strict";
  var CFG = window.ISP_CONFIG || {};
  var STORE = "ispytaniya-v1";
  var WORKS = window.WORKS = window.WORKS || {};
  var ORDER = window.WORK_ORDER = window.WORK_ORDER || [];

  /* ---------- утилиты ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function dec(v) {
    if (typeof v !== "string" || v.charAt(0) !== "~") return v;
    try { return JSON.parse(atob(v.slice(1).split("").reverse().join("")).slice(3)); } catch (e) { return null; }
  }
  function hash(s) { // cyrb53
    s = String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
    var h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7;
    for (var i = 0, ch; i < s.length; i++) { ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function sameSet(a, b) { a = (a || []).slice().sort(); b = (b || []).slice().sort(); return same(a, b); }
  function plural(n, f) { var m10 = n % 10, m100 = n % 100; return f[(m10 === 1 && m100 !== 11) ? 0 : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) ? 1 : 2]; }
  function ask(t) { try { return window.confirm(t); } catch (e) { return true; } }
  function device() {
    var u = navigator.userAgent || "";
    var d = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : /Mac/.test(u) ? "Mac" : "другое";
    return d + ", " + (window.innerWidth || 0) + "px";
  }
  window.ISP = { esc: esc, pic: pic, dec: dec };

  /* ---------- состояние ---------- */
  if (/[?&]reset=teacher\b/.test(location.search)) { try { localStorage.removeItem(STORE); } catch (e) {} }
  var state = load() || { fio: "", group: "", works: {} };
  state.unlock = state.unlock || {};
  function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }
  function ws(id) {
    return state.works[id] || (state.works[id] = { started: false, submitted: false, idx: 0, res: {}, ans: {}, ord: {}, flags: {}, exits: 0, log: [], t0: 0 });
  }
  function val(x, S) { return typeof x === "function" ? x(S.flags, S) : x; }

  /* ---------- изображения ---------- */
  function pic(id, cap, alt) {
    if (!id) return "";
    var c = cap ? "<figcaption>" + cap + "</figcaption>" : "";
    return '<figure class="pic"><img src="img/' + id + '.jpg" alt="' + esc(alt || cap || "") + '" loading="lazy" ' +
      'onerror="this.outerHTML=\'<div class=&quot;ph&quot;><div><span>☙</span>' + esc(alt || "иллюстрация").replace(/'/g, "&#39;") + '</div></div>\'">' + c + "</figure>";
  }

  /* ---------- баллы ---------- */
  function maxPts(st) {
    if (st.p != null) return st.p;
    switch (st.t) {
      case "single": return 1;
      case "multi": case "match": case "order": return 2;
      case "fields": return st.f.length;
      case "spot": return st.errs.length * 2;
      case "decide": case "tap": case "swipe": return 1;
      case "sort": return 3;
      default: return 0;
    }
  }
  function isTask(st) { return ["single", "multi", "match", "order", "fields", "open", "spot", "decide", "sort", "tap", "swipe"].indexOf(st.t) >= 0; }
  function steps(W) { return W.steps; }
  function visible(W, S, i) { var st = W.steps[i]; return !st.when || st.when(S.flags, S); }
  function sum(W, S) {
    var pts = 0, max = 0, done = 0, tasks = 0, right = 0;
    W.steps.forEach(function (st, i) {
      if (!isTask(st) || !visible(W, S, i)) return;
      var m = maxPts(st); max += m; tasks++;
      var r = S.res[st.id];
      if (r && !r.pend) { pts += r.pts; done++; if (r.ok) right++; }
    });
    return { pts: pts, max: max, done: done, tasks: tasks, right: right, pct: max ? pts / max : 0 };
  }
  function gradeOf(W, pct) {
    var sc = W.scale || [0.9, 0.72, 0.52];
    return pct >= sc[0] ? 5 : pct >= sc[1] ? 4 : pct >= sc[2] ? 3 : 2;
  }

  /* ---------- маршрутизация ---------- */
  var main = $("#main");
  var current = null;
  function route() {
    var m = location.hash.match(/^#w-([a-z0-9]+)/);
    document.body.classList.toggle("inwork", !!(m && WORKS[m[1]]));
    if (m && WORKS[m[1]]) { current = m[1]; if (!state.fio) { location.hash = "#start"; return; } renderWork(m[1]); }
    else { current = null; renderHome(); }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ---------- главный экран ---------- */
  function renderHome() {
    removeBar();
    var h = '<div class="card" id="reg">';
    if (state.fio) {
      var locked = ORDER.some(function (id) { return ws(id).started; });
      h += '<div class="who">Работы выполняет: <b>' + esc(state.fio) + "</b>, группа <b>" + esc(state.group) + "</b>." +
        (locked ? "" : ' <button class="linkbtn" id="edit">Изменить</button>') + "</div>";
    } else {
      h += '<h2>Вход</h2><p class="muted">Укажите фамилию, имя и группу так, как они записаны в ведомости. После начала первой работы данные изменить нельзя.</p>' +
        '<form id="regf"><label class="field"><span>Фамилия, имя, отчество</span><input id="fio" autocomplete="name" required></label>' +
        '<label class="field"><span>Группа</span><input id="grp" placeholder="например, ЮЗ-101" autocomplete="off" required></label>' +
        '<div class="err" id="rerr" hidden></div><div class="actions"><button class="btn" type="submit">Войти</button></div></form>';
    }
    h += "</div>";
    h += '<div class="orn"></div><div class="works">';
    ORDER.forEach(function (id) {
      var W = WORKS[id], S = ws(id), st, cls = "";
      if (S.submitted) { st = "сдано" + (S.result && S.result.grade && CFG.SHOW_GRADE ? " · оценка " + S.result.grade : ""); cls = "done"; }
      else if (S.started) { st = "в процессе"; cls = "go"; }
      else if ((CFG.PASSWORDS || {})[id] && !state.unlock[id]) { st = "🔒 откроется по паролю"; }
      else st = "не начато";
      h += '<button class="work" data-w="' + id + '"' + (state.fio ? "" : " disabled") + '><div class="num">' + W.num + "</div><div>" +
        "<h3>" + esc(W.title) + '</h3><div class="meta">' + esc(W.meta) + '</div><div class="desc">' + esc(W.short) + "</div>" +
        '<span class="st ' + cls + '">' + st + "</span></div></button>";
    });
    h += "</div>";
    h += '<div class="card"><h3>Как устроены работы</h3><p>Каждая работа проходится один раз. Ответ на задание принимается кнопкой «Проверить», после этого его нельзя изменить. ' +
      'Прогресс сохраняется в этом браузере: работу можно прервать и продолжить позже на том же телефоне. ' +
      'Оценка ставится по доле набранных баллов: 90 % и выше — «5», от 72 % — «4», от 52 % — «3». ' +
      'Развёрнутые ответы читает преподаватель. Уходы со страницы во время работы записываются и отправляются вместе с результатом.</p></div>';
    if (window.ISP_CREDITS) {
      h += '<details class="credits"><summary>Источники изображений</summary>';
      ISP_CREDITS.forEach(function (g) {
        h += '<p class="cr-h">' + esc(g[0]) + '</p><ul>';
        g[1].forEach(function (r) {
          var t = esc(r[0]) + (r[1] ? ' · ' + esc(r[1]) : '') + (r[2] ? ' · ' + esc(r[2]) : '');
          h += '<li>' + (r[3] ? '<a href="https://commons.wikimedia.org/wiki/File:' + encodeURI(r[3]) + '" target="_blank" rel="noopener">' + t + '</a>' : t) + '</li>';
        });
        h += '</ul>';
      });
      h += '<p class="cr-h">Изображения взяты с Викисклада (Wikimedia Commons). Лицензии CC BY-SA: creativecommons.org/licenses/by-sa/4.0</p></details>';
    }
    h += '<footer class="foot">Колесников М. А. · История России · 1 семестр</footer>';
    main.innerHTML = h;
    var f = $("#regf");
    if (f) f.onsubmit = function (e) {
      e.preventDefault();
      var fio = $("#fio").value.replace(/\s+/g, " ").trim(), g = $("#grp").value.replace(/\s+/g, " ").trim().toUpperCase();
      var err = fio.split(" ").length < 2 || fio.length < 5 ? "Введите фамилию и имя полностью." : !g ? "Укажите группу." : "";
      var re = $("#rerr"); re.hidden = !err; re.textContent = err;
      if (err) return;
      state.fio = fio; state.group = g; save(); renderHome();
    };
    var ed = $("#edit"); if (ed) ed.onclick = function () { state.fio = ""; state.group = ""; save(); renderHome(); };
    $$(".work").forEach(function (b) { b.onclick = function () { if (!b.disabled) location.hash = "#w-" + b.dataset.w; }; });
  }

  /* ---------- верхняя полоса работы ---------- */
  function removeBar() { var b = $("#bar"); if (b) b.remove(); }
  function bar(W, S) {
    var b = $("#bar");
    if (!b) {
      b = document.createElement("div"); b.id = "bar"; b.className = "bar";
      document.body.insertBefore(b, document.getElementById("app"));
    }
    var s = sum(W, S);
    b.innerHTML = '<div class="wrap"><button class="btn ghost" id="home" style="min-height:40px;padding:6px 12px;width:auto">‹ Все работы</button>' +
      '<div class="ttl">' + esc(W.title) + '</div><div class="cnt">' + s.done + " / " + s.tasks + "</div></div>" +
      '<div class="prog"><i style="width:' + (s.tasks ? Math.round(s.done / s.tasks * 100) : 0) + '%"></i></div>';
    $("#home").onclick = function () { location.hash = "#start"; };
  }

  /* ---------- работа ---------- */
  function renderWork(id) {
    var W = WORKS[id], S = ws(id);
    bar(W, S);
    var PW = (CFG.PASSWORDS || {})[id];
    if (!S.started && PW && !state.unlock[id]) {
      main.innerHTML = '<div class="card"><div class="place">' + esc(W.meta) + "</div><h2>" + esc(W.title) + "</h2>" +
        (W.cover ? pic(W.cover.id, W.cover.cap, W.cover.alt) : "") +
        '<p>Работа откроется, когда преподаватель назовёт пароль.</p><form id="pwf"><label class="field"><span>Пароль</span>' +
        '<input id="pw" autocomplete="off" autocapitalize="none" spellcheck="false"></label><div class="err" id="pwerr" hidden></div>' +
        '<div class="actions"><button class="btn" type="submit">Открыть</button></div></form></div>';
      $("#pwf").onsubmit = function (e) {
        e.preventDefault();
        if (hash($("#pw").value) === PW) { state.unlock[id] = 1; save(); renderWork(id); }
        else { var er = $("#pwerr"); er.hidden = false; er.textContent = "Пароль неверный. Проверьте раскладку и попробуйте ещё раз."; }
      };
      return;
    }
    if (!S.started) {
      main.innerHTML = '<div class="card"><div class="place">' + esc(W.meta) + "</div><h2>" + esc(W.title) + "</h2>" +
        (W.cover ? pic(W.cover.id, W.cover.cap, W.cover.alt) : "") + val(W.intro, S) +
        '<p class="muted">Заданий: ' + sum(W, S).tasks + ". Примерное время: " + W.time + ". После нажатия «Начать» включится счётчик уходов со страницы.</p>" +
        '<div class="actions"><button class="btn" id="go">Начать</button></div></div>';
      $("#go").onclick = function () { S.started = true; S.t0 = Date.now(); S.idx = firstVisible(W, S, 0); save(); renderWork(id); };
      return;
    }
    if (S.idx >= W.steps.length) { renderFinal(W, S); return; }
    renderStep(W, S);
  }
  function firstVisible(W, S, i) { while (i < W.steps.length && !visible(W, S, i)) i++; return i; }
  function next(W, S) { S.idx = firstVisible(W, S, S.idx + 1); save(); renderWork(W.id); window.scrollTo(0, 0); }

  function hud(W, S) { return W.hud ? '<div class="hud">' + W.hud(S, sum(W, S)) + "</div>" : ""; }

  function renderStep(W, S) {
    var st = W.steps[S.idx], r = S.res[st.id];
    var h = hud(W, S) + '<div class="card step' + (st.t === "scene" ? " scene" : "") + (r ? " locked" : "") + '" id="step">';
    if (st.place) h += '<div class="place">' + esc(val(st.place, S)) + "</div>";
    if (st.title) h += '<h2 class="step-title">' + esc(val(st.title, S)) + "</h2>";
    if (st.img) h += pic(st.img, st.cap, st.alt);
    if (st.pre) h += val(st.pre, S);
    if (st.src) h += '<blockquote class="src"><span class="src-t">' + val(st.src, S) + '</span>' + (st.srcA ? '<span class="src-a">' + st.srcA + "</span>" : "") + "</blockquote>";
    if (st.text) h += '<div class="' + (st.plain ? "" : "bukv") + '">' + val(st.text, S) + "</div>";
    if (st.q) h += '<p class="q-text">' + val(st.q, S) + "</p>";
    h += '<div id="body"></div><div id="fb"></div><div class="actions" id="act"></div></div>';
    main.innerHTML = h;
    var body = $("#body"), act = $("#act");
    var T = TYPES[st.t];
    function commit(given) {
      if (S.res[st.id]) return;
      var res = T.check(st, given, S);
      S.res[st.id] = res;
      if (T.after) T.after(st, res, S, W);
      save();
      bar(W, S); renderStep(W, S);
    }
    T.render(body, st, S, r, commit);
    enhanceSelects(body);
    if (r && r.pend) {
      act.innerHTML = '<button class="btn" id="chk">' + (T.btn2 || "Проверить") + "</button>";
      $("#chk").onclick = function () {
        var g2 = T.read2(body, st, S, r);
        if (g2 === null) { $("#fb").innerHTML = '<div class="fb bad"><div class="ex">' + (T.need2 || "Сначала дайте ответ.") + "</div></div>"; return; }
        S.res[st.id] = T.check2(st, g2, S, r); save(); bar(W, S); renderStep(W, S);
      };
      if (T.fb1) $("#fb").innerHTML = T.fb1(st, r);
      return;
    }
    if (r) { showFb(st, S, r); act.innerHTML = '<button class="btn" id="nx">Далее</button>'; $("#nx").onclick = function () { next(W, S); }; return; }
    if (st.t === "scene" || st.t === "info") {
      if (st.t === "scene" && st.choices) return; // выбор делается кнопками сцены
      act.innerHTML = '<button class="btn" id="nx">' + (st.btn || "Далее") + "</button>";
      $("#nx").onclick = function () { if (st.onNext) st.onNext(S.flags, S); next(W, S); };
      return;
    }
    if (T.auto) return;
    act.innerHTML = '<button class="btn" id="chk">' + (T.btn || (st.t === "open" ? "Сохранить ответ" : "Проверить")) + "</button>";
    $("#chk").onclick = function () {
      var given = T.read(body, st, S);
      if (given === null) { $("#fb").innerHTML = '<div class="fb bad"><div class="ex">' + (T.need || "Сначала дайте ответ.") + "</div></div>"; return; }
      var res = T.check(st, given, S);
      S.res[st.id] = res;
      if (T.after) T.after(st, res, S, W);
      save();
      bar(W, S); renderStep(W, S);
    };
    if (st.t === "scene") return;
  }
  /* ---------- выбор из списка: полный текст вариантов на телефоне ---------- */
  function enhanceSelects(root) {
    $$("select.sel", root).forEach(function (sel) {
      if (sel._enh) return; sel._enh = 1;
      var b = document.createElement("button"); b.type = "button"; b.className = "pick";
      function lab() {
        var o = sel.options[sel.selectedIndex];
        b.innerHTML = sel.value === "" ? '<span class="ph">Выбрать…</span>' : esc(o.text);
        b.classList.toggle("set", sel.value !== "");
      }
      lab(); sel.style.display = "none"; sel.parentNode.insertBefore(b, sel.nextSibling);
      if (sel.disabled) { b.disabled = true; return; }
      b.onclick = function () { openSheet(sel, lab); };
    });
  }
  function openSheet(sel, done) {
    var ov = document.createElement("div"); ov.className = "sheet-ov";
    var row = sel.closest(".mrow"), head = row && $(".ml", row) ? $(".ml", row).textContent : "Выберите ответ";
    var h = '<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-h">' + esc(head) + "</div>";
    [].slice.call(sel.options).forEach(function (o) {
      if (o.value === "") return;
      h += '<button type="button" class="sheet-o' + (sel.value === o.value ? " on" : "") + '" data-v="' + esc(o.value) + '">' + esc(o.text) + "</button>";
    });
    h += '<button type="button" class="btn ghost sheet-x">Отмена</button></div>';
    ov.innerHTML = h; document.body.appendChild(ov); document.body.classList.add("noscroll");
    function close() { ov.remove(); document.body.classList.remove("noscroll"); }
    ov.onclick = function (e) {
      var t = e.target.closest(".sheet-o");
      if (t) { sel.value = t.dataset.v; sel.dispatchEvent(new Event("change", { bubbles: true })); done(); close(); }
      else if (e.target === ov || e.target.classList.contains("sheet-x")) close();
    };
  }

  function showFb(st, S, r) {
    if (st.t === "open") { $("#fb").innerHTML = '<div class="fb"><b>Ответ сохранён</b><div class="ex">Его прочитает преподаватель.</div></div>'; return; }
    var ex = st.ex ? '<div class="ex">' + val(st.ex, S) + "</div>" : "";
    if (st.t === "decide" && st.o[r.given] && st.o[r.given].out) ex = '<div class="ex"><i>' + st.o[r.given].out + "</i></div>" + ex;
    if (st.t === "swipe") {
      var o = st.o[r.given] || {};
      var hs = '<div class="fb' + (r.ok ? "" : " bad") + '"><b>' + (r.ok ? "Так и было" : "На деле было иначе") + "</b>" +
        (o.out ? '<div class="ex"><i>' + o.out + "</i></div>" : "") + (st.ex ? '<div class="ex">' + val(st.ex, S) + "</div>" : "") + "</div>";
      if (r.crash) hs += '<div class="rg-crash"><b>' + esc(r.crash.t) + "</b><p>" + r.crash.x + '</p><p class="muted">Совет спасает положение: шкалы возвращаются к середине, но кризис остаётся в летописи правления.</p></div>';
      $("#fb").innerHTML = hs; return;
    }
    if (st.t === "spot" && r.falseK && r.falseK.length) ex += '<div class="ex muted">Пунктиром подчёркнуты слова, отмеченные напрасно.</div>';
    var W = WORKS[current] || {}; var head = r.ok ? (st.yes || W.yes || "Верно") : r.pts > 0 ? "Частично верно" : (st.no || W.no || "Неверно");
    $("#fb").innerHTML = '<div class="fb' + (r.ok ? "" : " bad") + '"><b>' + head + "</b>" + (r.pts > 0 && !r.ok ? " (" + r.pts + " из " + maxPts(st) + ")" : "") + ex + "</div>";
  }

  /* ---------- типы заданий ---------- */
  function ordOf(st, S, n) { if (!S.ord[st.id]) { S.ord[st.id] = st.fixed ? range(n) : shuffle(range(n)); save(); } return S.ord[st.id]; }
  var TYPES = {
    info: { render: function () {} },
    scene: {
      render: function (body, st, S) {
        if (!st.choices) return;
        var h = "";
        val(st.choices, S).forEach(function (c, i) { h += '<button class="choice" data-i="' + i + '">' + esc(c.label) + "</button>"; });
        body.innerHTML = h;
        $$(".choice", body).forEach(function (b) {
          b.onclick = function () {
            var c = val(st.choices, S)[+b.dataset.i];
            if (c.set) for (var k in c.set) S.flags[k] = c.set[k];
            S.flags["ch_" + st.id] = +b.dataset.i;
            var W = WORKS[current]; next(W, S);
          };
        });
      }
    },
    single: {
      render: function (body, st, S, r) {
        var ord = ordOf(st, S, st.o.length), a = r ? dec(st.a) : null, h = "";
        ord.forEach(function (i) {
          var cls = r ? (i === a ? " right" : i === r.given ? " wrong" : "") : "";
          h += '<label class="opt' + cls + '"><input type="radio" name="o" value="' + i + '"' + (r && r.given === i ? " checked" : "") + (r ? " disabled" : "") + "><span>" + st.o[i] + "</span></label>";
        });
        body.innerHTML = h;
      },
      read: function (body) { var c = $("input:checked", body); return c ? +c.value : null; },
      check: function (st, g) { var ok = g === dec(st.a); return { given: g, ok: ok, pts: ok ? maxPts(st) : 0 }; },
      need: "Выберите один вариант."
    },
    multi: {
      render: function (body, st, S, r) {
        var ord = ordOf(st, S, st.o.length), a = r ? dec(st.a) : null, h = '<p class="ord-hint">Верных вариантов несколько.</p>';
        ord.forEach(function (i) {
          var on = r && r.given.indexOf(i) >= 0, good = r && a.indexOf(i) >= 0;
          var cls = r ? (good ? " right" : on ? " wrong" : "") : "";
          h += '<label class="opt' + cls + '"><input type="checkbox" value="' + i + '"' + (on ? " checked" : "") + (r ? " disabled" : "") + "><span>" + st.o[i] + "</span></label>";
        });
        body.innerHTML = h;
      },
      read: function (body) { var v = $$("input:checked", body).map(function (c) { return +c.value; }); return v.length ? v : null; },
      check: function (st, g) { var ok = sameSet(g, dec(st.a)); return { given: g, ok: ok, pts: ok ? maxPts(st) : 0 }; },
      need: "Отметьте хотя бы один вариант."
    },
    match: {
      render: function (body, st, S, r) {
        var ord = ordOf(st, S, st.right.length), a = r ? dec(st.a) : null, h = "";
        st.left.forEach(function (l, li) {
          var cls = r ? (r.given[li] === a[li] ? " right" : " wrong") : "";
          h += '<div class="mrow' + cls + '"><div class="ml">' + l + '</div><select class="sel" data-l="' + li + '"' + (r ? " disabled" : "") + '><option value="">— выберите —</option>';
          ord.forEach(function (ri) { h += '<option value="' + ri + '"' + (r && r.given[li] === ri ? " selected" : "") + ">" + esc(st.right[ri]) + "</option>"; });
          h += "</select>" + (r && r.given[li] !== a[li] ? '<div class="corr">Верно: ' + esc(st.right[a[li]]) + "</div>" : "") + "</div>";
        });
        body.innerHTML = h;
      },
      read: function (body, st) {
        var v = $$("select", body).map(function (s) { return s.value === "" ? null : +s.value; });
        return v.some(function (x) { return x === null; }) ? null : v;
      },
      check: function (st, g) {
        var a = dec(st.a), n = 0; g.forEach(function (x, i) { if (x === a[i]) n++; });
        var ok = n === a.length; return { given: g, ok: ok, pts: ok ? maxPts(st) : (n * 2 >= a.length ? 1 : 0), part: n };
      },
      need: "Выберите ответ в каждой строке."
    },
    fields: {
      render: function (body, st, S, r) {
        var h = "";
        st.f.forEach(function (f, fi) {
          var ord = S.ord[st.id + "_" + fi] || (S.ord[st.id + "_" + fi] = shuffle(range(f.o.length)));
          var a = r ? dec(f.a) : null, cls = r ? (r.given[fi] === a ? " right" : " wrong") : "";
          h += '<div class="mrow' + cls + '"><div class="ml">' + esc(f.l) + '</div><select class="sel"' + (r ? " disabled" : "") + '><option value="">— выберите —</option>';
          ord.forEach(function (oi) { h += '<option value="' + oi + '"' + (r && r.given[fi] === oi ? " selected" : "") + ">" + esc(f.o[oi]) + "</option>"; });
          h += "</select>" + (r && r.given[fi] !== a ? '<div class="corr">Верно: ' + esc(f.o[a]) + "</div>" : "") + "</div>";
        });
        save(); body.innerHTML = h;
      },
      read: function (body) {
        var v = $$("select", body).map(function (s) { return s.value === "" ? null : +s.value; });
        return v.some(function (x) { return x === null; }) ? null : v;
      },
      check: function (st, g) {
        var n = 0; st.f.forEach(function (f, i) { if (g[i] === dec(f.a)) n++; });
        return { given: g, ok: n === st.f.length, pts: n };
      },
      need: "Заполните все строки этикетки."
    },
    order: {
      render: function (body, st, S, r) {
        var a = r ? dec(st.a) : null;
        if (r) {
          var h = '<ol class="ord-list">';
          r.given.forEach(function (i, k) { h += '<li style="' + (i === a[k] ? "border-color:var(--ok)" : "border-color:var(--bad)") + '"><b>' + (k + 1) + "</b><span>" + st.o[i] + "</span></li>"; });
          h += "</ol>";
          if (!r.ok) { h += '<p class="ord-hint">Верный порядок:</p><ol class="ord-list">'; a.forEach(function (i, k) { h += "<li><b>" + (k + 1) + "</b><span>" + st.o[i] + "</span></li>"; }); h += "</ol>"; }
          body.innerHTML = h; return;
        }
        var ord = ordOf(st, S, st.o.length), picked = [];
        function draw() {
          var h = '<p class="ord-hint">Нажимайте на события по порядку, от раннего к позднему. Нажатие на выбранное событие возвращает его назад.</p><ol class="ord-list">';
          picked.forEach(function (i, k) { h += '<li data-i="' + i + '" data-in="1"><b>' + (k + 1) + "</b><span>" + st.o[i] + "</span></li>"; });
          h += '</ol><ul class="ord-pool">';
          ord.forEach(function (i) { if (picked.indexOf(i) < 0) h += '<li data-i="' + i + '"><span>' + st.o[i] + "</span></li>"; });
          h += "</ul>";
          body.innerHTML = h; body._picked = picked;
          $$("li", body).forEach(function (li) {
            li.onclick = function () {
              var i = +li.dataset.i;
              if (li.dataset.in) picked.splice(picked.indexOf(i), 1); else picked.push(i);
              draw();
            };
          });
        }
        draw();
      },
      read: function (body, st) { var p = body._picked || []; return p.length === st.o.length ? p.slice() : null; },
      check: function (st, g) {
        var a = dec(st.a), ok = same(g, a), n = 0; g.forEach(function (x, i) { if (x === a[i]) n++; });
        return { given: g, ok: ok, pts: ok ? maxPts(st) : (n >= a.length - 2 ? 1 : 0), part: n };
      },
      need: "Расставьте все события."
    },
    open: {
      render: function (body, st, S, r) {
        var v = S.ans[st.id] || "", min = st.min || 60;
        body.innerHTML = (st.hint ? '<p class="ord-hint">' + st.hint + "</p>" : "") +
          '<textarea class="open" maxlength="2500"' + (r ? " disabled" : "") + ' placeholder="Ответ своими словами">' + esc(v) + '</textarea><div class="chars"><span>' + v.length + "</span> / не меньше " + min + " знаков</div>";
        var ta = $("textarea", body);
        ta.oninput = function () { S.ans[st.id] = ta.value; $(".chars span", body).textContent = ta.value.length; clearTimeout(ta._t); ta._t = setTimeout(save, 300); };
      },
      read: function (body, st) { var v = $("textarea", body).value.trim(); return v.length >= (st.min || 60) ? v : null; },
      check: function (st, g, S) { S.ans[st.id] = g; return { given: "текст", ok: true, pts: 0 }; },
      need: "Ответ слишком короткий: напишите два-три полных предложения."
    }
  };

  /* ---------- найди ошибку ---------- */
  TYPES.spot = {
    btn: "Проверить лист", btn2: "Исправить",
    render: function (body, st, S, r) {
      var N = st.errs.length, parts = st.doc.split(/\{(\d+)\}/), h = "", k = 0;
      parts.forEach(function (p, pi) {
        if (pi % 2 === 1) {
          var i = +p, cls = "w";
          var inner = esc(st.errs[i].w);
          if (r) {
            cls += r.hit[i] ? " found" : " missed";
            if (!r.pend) { var a = dec(st.errs[i].a), ok = r.fix[i] === a; inner = "<s>" + inner + "</s> " + '<b class="' + (ok ? "fx-ok" : "fx-bad") + '">' + esc(st.errs[i].o[a]) + "</b>"; }
          }
          h += '<span class="' + cls + '" data-e="' + i + '">' + inner + "</span>";
        } else {
          p.split(/(\s+)/).forEach(function (wd) {
            if (!wd) return;
            if (/^\s+$/.test(wd)) { h += wd; return; }
            var mk = r && r.falseK && r.falseK.indexOf(k) >= 0;
            h += '<span class="w' + (mk ? " false" : "") + '" data-k="' + k + '">' + esc(wd) + "</span>"; k++;
          });
        }
      });
      var top = r ? "" : '<p class="ord-hint">На листе ошибок: <b>' + N + "</b>. Нажмите на " + (N === 1 ? "слово или дату с ошибкой" : "слова или даты с ошибками") + '. Отмечено: <b class="mkc">0</b> из ' + N + ".</p>";
      var fix = "";
      if (r && r.pend) {
        fix = '<div class="fixes"><p class="ord-hint">Как должно быть написано?</p>';
        st.errs.forEach(function (e, i) {
          var key = st.id + "_e" + i, ord = S.ord[key] || (S.ord[key] = shuffle(range(e.o.length)));
          fix += '<div class="mrow"><div class="ml">Вместо «' + esc(e.w) + '»</div><select class="sel" data-e="' + i + '"><option value="">— выберите —</option>';
          ord.forEach(function (oi) { fix += '<option value="' + oi + '">' + esc(e.o[oi]) + "</option>"; });
          fix += "</select></div>";
        });
        fix += "</div>"; save();
      }
      body.innerHTML = top + '<div class="doc' + (r ? " checked" : "") + '">' + h + "</div>" + fix;
      if (r) return;
      var marks = body._marks = [];
      $$(".doc .w", body).forEach(function (sp) {
        sp.onclick = function () {
          var id = sp.dataset.e != null ? "e" + sp.dataset.e : "k" + sp.dataset.k, at = marks.indexOf(id);
          if (at >= 0) { marks.splice(at, 1); sp.classList.remove("mk"); }
          else if (marks.length < N) { marks.push(id); sp.classList.add("mk"); }
          $(".mkc", body).textContent = marks.length;
        };
      });
    },
    read: function (body, st) { var m = body._marks || []; return m.length === st.errs.length ? m.slice() : null; },
    need: "Отметьте столько слов, сколько ошибок на листе.",
    check: function (st, g) {
      var hit = st.errs.map(function (e, i) { return g.indexOf("e" + i) >= 0; });
      var falseK = g.filter(function (x) { return x.charAt(0) === "k"; }).map(function (x) { return +x.slice(1); });
      return { pend: true, hit: hit, falseK: falseK, given: g };
    },
    fb1: function (st, r) {
      var n = r.hit.filter(Boolean).length;
      return '<div class="fb' + (n === st.errs.length ? "" : " bad") + '"><b>Найдено: ' + n + " из " + st.errs.length + "</b>" +
        '<div class="ex">Зелёным отмечены найденные ошибки, жёлтым — пропущенные, красным — слова, отмеченные напрасно. Теперь исправьте каждую ошибку.</div></div>';
    },
    read2: function (body) {
      var v = $$(".fixes select", body).map(function (s) { return s.value === "" ? null : +s.value; });
      return v.some(function (x) { return x === null; }) ? null : v;
    },
    need2: "Выберите исправление для каждой ошибки.",
    check2: function (st, g2, S, r) {
      var fixOk = 0, found = r.hit.filter(Boolean).length;
      st.errs.forEach(function (e, i) { if (g2[i] === dec(e.a)) fixOk++; });
      var pts = found + fixOk;
      return { pend: false, hit: r.hit, falseK: r.falseK, fix: g2, given: r.given, pts: pts, ok: pts === st.errs.length * 2 };
    }
  };

  /* ---------- решение с последствиями ---------- */
  TYPES.decide = {
    btn: "Принять решение",
    render: function (body, st, S, r) {
      var ord = ordOf(st, S, st.o.length), a = r ? dec(st.a) : null, h = "";
      ord.forEach(function (i) {
        var cls = r ? (i === a ? " right" : i === r.given ? " wrong" : "") : "";
        h += '<label class="opt dec' + cls + '"><input type="radio" name="o" value="' + i + '"' + (r && r.given === i ? " checked" : "") + (r ? " disabled" : "") + "><span>" + st.o[i].l + "</span></label>";
      });
      body.innerHTML = h;
    },
    read: function (body) { var c = $("input:checked", body); return c ? +c.value : null; },
    check: function (st, g) { var ok = g === dec(st.a); return { given: g, ok: ok, pts: ok ? 1 : 0 }; },
    after: function (st, r, S, W) {
      var fx = st.o[r.given].fx; if (!fx) return;
      var R = S.flags.res || (S.flags.res = JSON.parse(JSON.stringify(W.res0 || {})));
      for (var k in fx) R[k] = Math.max(0, Math.min(W.resMax || 10, (R[k] || 0) + fx[k]));
    },
    need: "Выберите решение."
  };

  /* ---------- разложить по группам ---------- */
  TYPES.sort = {
    render: function (body, st, S, r) {
      var ord = ordOf(st, S, st.items.length), a = r ? dec(st.a) : null;
      var sel = body._sel = r ? r.given.slice() : st.items.map(function () { return null; });
      var h = '<p class="ord-hint">Для каждой строки выберите группу.</p>';
      ord.forEach(function (i) {
        var cls = r ? (sel[i] === a[i] ? " right" : " wrong") : "";
        h += '<div class="srow' + cls + '" data-i="' + i + '"><div class="sitem">' + st.items[i] + '</div><div class="chips">';
        st.bins.forEach(function (b, bi) { h += '<button type="button" class="chip' + (sel[i] === bi ? " on" : "") + '" data-b="' + bi + '"' + (r ? " disabled" : "") + ">" + esc(b) + "</button>"; });
        h += "</div>" + (r && sel[i] !== a[i] ? '<div class="corr">Верно: ' + esc(st.bins[a[i]]) + "</div>" : "") + "</div>";
      });
      body.innerHTML = h;
      if (r) return;
      $$(".srow", body).forEach(function (row) {
        var i = +row.dataset.i;
        $$(".chip", row).forEach(function (c) {
          c.onclick = function () { sel[i] = +c.dataset.b; $$(".chip", row).forEach(function (x) { x.classList.toggle("on", x === c); }); };
        });
      });
    },
    read: function (body) { var s = body._sel || []; return s.some(function (x) { return x === null; }) ? null : s.slice(); },
    check: function (st, g) {
      var a = dec(st.a), n = 0; g.forEach(function (x, i) { if (x === a[i]) n++; });
      var m = maxPts(st); return { given: g, ok: n === a.length, pts: Math.floor(m * n / a.length) };
    },
    need: "Распределите все строки."
  };

  /* ---------- выбор на чертеже ---------- */
  TYPES.tap = {
    render: function (body, st, S, r) {
      var a = r ? dec(st.a) : null;
      body.innerHTML = '<div class="map tapmap">' + val(st.svg, S) + "</div>";
      var hots = $$("[data-i]", body);
      hots.forEach(function (el) {
        var i = +el.getAttribute("data-i");
        if (r) { if (i === a) el.classList.add("hot-ok"); else if (i === r.given) el.classList.add("hot-bad"); return; }
        el.classList.add("hot");
        el.addEventListener("click", function () { body._pick = i; hots.forEach(function (x) { x.classList.toggle("hot-sel", x === el); }); });
      });
    },
    read: function (body) { return body._pick == null ? null : body._pick; },
    check: function (st, g) { var ok = g === dec(st.a); return { given: g, ok: ok, pts: ok ? 1 : 0 }; },
    need: "Нажмите на место на чертеже."
  };
  /* ---------- карточки в духе Reigns: свайп влево или вправо ---------- */
  TYPES.swipe = {
    auto: true,
    render: function (body, st, S, r, commit) {
      var h = '<div class="rg' + (r ? " rg-done" : "") + '"><div class="rg-card" id="rgc">' +
        '<div class="rg-who"><div class="rg-ava">' + esc(st.ava || (st.who || "?").charAt(0)) + '</div><div><b>' + esc(st.who) + "</b><span>" + esc(st.role || "") + "</span></div></div>" +
        '<div class="rg-say">' + st.say + "</div>" +
        '<div class="rg-tag rg-tl">' + esc(st.o[0].l) + '</div><div class="rg-tag rg-tr">' + esc(st.o[1].l) + "</div></div>";
      if (r) {
        h += '<div class="rg-pick">Ваше решение: <b>' + esc(st.o[r.given].l) + "</b></div></div>";
        body.innerHTML = h; return;
      }
      h += '<div class="rg-hint">Смахните карточку влево или вправо или нажмите кнопку</div>' +
        '<div class="rg-btns"><button class="btn ghost" data-s="0"><span>←</span> ' + esc(st.o[0].l) + '</button><button class="btn ghost" data-s="1">' + esc(st.o[1].l) + " <span>→</span></button></div></div>";
      body.innerHTML = h;
      var card = $("#rgc"), x0 = null, dx = 0, done = false, pid = null;
      function preview(side) {
        $$(".rg-bar").forEach(function (b) {
          var k = b.dataset.k, v = side == null ? 0 : (st.o[side].fx || {})[k] || 0;
          b.classList.toggle("pv", !!v); b.classList.toggle("pv2", Math.abs(v) >= 2);
        });
        card.classList.toggle("sl", side === 0); card.classList.toggle("sr", side === 1);
      }
      function go(side) {
        if (done) return; done = true; preview(null);
        card.style.transition = "transform .28s ease, opacity .28s ease";
        card.style.transform = "translateX(" + (side ? 140 : -140) + "%) rotate(" + (side ? 18 : -18) + "deg)";
        card.style.opacity = "0";
        setTimeout(function () { commit(side); }, 260);
      }
      card.addEventListener("pointerdown", function (e) {
        if (done) return; x0 = e.clientX; dx = 0; pid = e.pointerId;
        try { card.setPointerCapture(pid); } catch (er) {}
        card.style.transition = "none";
      });
      card.addEventListener("pointermove", function (e) {
        if (x0 == null || done) return;
        dx = e.clientX - x0;
        card.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 18) + "deg)";
        preview(dx < -30 ? 0 : dx > 30 ? 1 : null);
      });
      function up() {
        if (x0 == null || done) return; x0 = null;
        var lim = Math.min(110, card.offsetWidth * 0.28);
        if (dx < -lim) go(0); else if (dx > lim) go(1);
        else { card.style.transition = "transform .2s ease"; card.style.transform = ""; preview(null); }
      }
      card.addEventListener("pointerup", up);
      card.addEventListener("pointercancel", up);
      $$(".rg-btns button", body).forEach(function (b) {
        var s = +b.dataset.s;
        b.onmouseenter = function () { preview(s); };
        b.onmouseleave = function () { preview(null); };
        b.onclick = function () { go(s); };
      });
      if (window._rgKey) document.removeEventListener("keydown", window._rgKey);
      window._rgKey = function (e) {
        if (!document.body.contains(card)) return;
        if (e.key === "ArrowLeft") go(0); else if (e.key === "ArrowRight") go(1);
      };
      document.addEventListener("keydown", window._rgKey);
    },
    check: function (st, g) { var ok = g === dec(st.a); return { given: g, ok: ok, pts: ok ? 1 : 0 }; },
    after: function (st, r, S, W) {
      var R = S.flags.res || (S.flags.res = JSON.parse(JSON.stringify(W.res0)));
      var fx = st.o[r.given].fx || {}, mx = W.resMax || 10, hit = null;
      for (var k in fx) {
        R[k] = Math.max(0, Math.min(mx, (R[k] || 0) + fx[k]));
        if (!hit && (R[k] === 0 || R[k] === mx)) hit = k + (R[k] === 0 ? "0" : "1");
      }
      if (hit && W.crash && W.crash[hit]) {
        r.crash = W.crash[hit];
        S.flags.crashes = (S.flags.crashes || 0) + 1;
        S.flags.crashLog = (S.flags.crashLog || []).concat([st.year + ": " + W.crash[hit].t]);
        S.flags.res = JSON.parse(JSON.stringify(W.res0));
      }
    }
  };

  TYPES.scene.read = function () { return null; };

  /* ---------- итог и отправка ---------- */
  function renderFinal(W, S) {
    var s = sum(W, S), g = gradeOf(W, s.pct);
    var h = hud(W, S) + '<div class="card"><h2>' + esc(W.title) + ": итог</h2>";
    if (W.finale) h += W.finale(S, s, g);
    h += '<table class="res-table"><tr><td>Баллы</td><td>' + s.pts + " из " + s.max + "</td></tr>" +
      "<tr><td>Верно выполнено заданий</td><td>" + s.right + " из " + s.tasks + "</td></tr>" +
      "<tr><td>Уходов со страницы</td><td>" + S.exits + "</td></tr></table>";
    if (S.submitted && S.result) {
      h += CFG.SHOW_GRADE ? '<p style="text-align:center">Оценка</p><div class="grade">' + S.result.grade + "</div>" : "";
      h += '<div class="fb"><b>Результат отправлен</b><div class="ex">Преподаватель видит его в таблице.' + (hasOpen(W) ? " Развёрнутые ответы он прочитает отдельно, итоговая оценка может измениться." : "") + "</div></div>";
      h += review(W, S);
      h += '<div class="actions"><button class="btn ghost" id="back">К списку работ</button></div></div>';
      main.innerHTML = h; $("#back").onclick = function () { location.hash = "#start"; }; return;
    }
    h += '<p>Проверьте, что все задания пройдены, и отправьте результат. После отправки работу пройти заново нельзя.</p>' +
      '<div class="actions"><button class="btn" id="send">Отправить результат</button></div><div id="sendmsg"></div></div>';
    main.innerHTML = h;
    $("#send").onclick = function () { send(W, S); };
  }
  function shortOf(st, S) {
    var t = String(val(st.title || st.q || st.say || "", S) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return t.length > 95 ? t.slice(0, 92).replace(/\s\S*$/, "") + "…" : t;
  }
  function lost(W, S) {
    var out = [], n = 0;
    W.steps.forEach(function (st, i) {
      if (!isTask(st) || !visible(W, S, i)) return;
      n++; if (st.t === "open") return;
      var r = S.res[st.id], m = maxPts(st);
      if (!r || r.pts < m) out.push({ n: n, st: st, p: r ? r.pts : 0, m: m });
    });
    return out;
  }
  function review(W, S) {
    var L = lost(W, S);
    if (!L.length) return '<div class="fb"><b>Без потерь</b><div class="ex">Все задания выполнены полностью.</div></div>';
    var h = '<details class="review" open><summary>Разбор: где потеряны баллы (' + L.length + ')</summary><ol>';
    L.forEach(function (x) {
      h += '<li value="' + x.n + '"><b>' + esc(shortOf(x.st, S)) + '</b> <span class="muted">' + x.p + " из " + x.m + "</span>" +
        (x.st.ex ? '<div class="ex">' + val(x.st.ex, S) + "</div>" : "") + "</li>";
    });
    return h + "</ol>" + (W.reread ? '<p class="muted">Что перечитать: ' + W.reread + ".</p>" : "") + "</details>";
  }
  function hasOpen(W) { return W.steps.some(function (st) { return st.t === "open"; }); }

  function details(W, S) {
    var L = lost(W, S);
    return L.length ? L.map(function (x) { return "№" + x.n + " " + shortOf(x.st, S) + " (" + x.p + "/" + x.m + ")"; }).join("\n") : "без потерь";
  }
  function detailsOld(W, S) {
    var out = [];
    W.steps.forEach(function (st, i) {
      if (!isTask(st) || st.t === "open" || !visible(W, S, i)) return;
      var r = S.res[st.id]; out.push(st.id + ":" + (r ? r.pts + "/" + maxPts(st) : "—"));
    });
    return out.join(" ");
  }
  function send(W, S) {
    var s = sum(W, S), g = gradeOf(W, s.pct);
    var open = {}; W.steps.forEach(function (st) { if (st.t === "open") open[st.id] = { q: typeof st.q === "string" ? st.q.replace(/<[^>]+>/g, "") : st.id, a: S.ans[st.id] || "" }; });
    var payload = {
      work: W.id, title: W.title, fio: state.fio, group: state.group, score: s.pts, max: s.max,
      percent: Math.round(s.pct * 100), grade: g, exits: S.exits, exitLog: S.log.join(", "),
      duration: Math.round((Date.now() - (S.t0 || Date.now())) / 60000) + " мин",
      device: device(), extra: W.extra ? W.extra(S, s) : "", open: open, details: details(W, S)
    };
    var msg = $("#sendmsg"), btn = $("#send");
    if (!CFG.SCRIPT_URL) {
      msg.innerHTML = '<div class="warn"><b>Демо-режим.</b> Таблица преподавателя ещё не подключена, результат никуда не отправлен. Ваша оценка по баллам: ' + g + ".</div>";
      return;
    }
    btn.disabled = true; msg.innerHTML = '<p class="muted">Отправляю…</p>';
    fetch(CFG.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.error || "ошибка скрипта");
        S.submitted = true; S.result = { grade: g, score: s.pts, max: s.max }; save(); renderWork(W.id);
      })
      .catch(function (e) {
        btn.disabled = false;
        msg.innerHTML = '<div class="warn">Не удалось отправить (' + esc(e.message) + "). Проверьте интернет и нажмите ещё раз: ответы сохранены.</div>";
      });
  }

  /* ---------- счётчик уходов со страницы ---------- */
  var awayAt = 0;
  function activeS() { if (!current) return null; var S = ws(current); return S.started && !S.submitted ? S : null; }
  document.addEventListener("visibilitychange", function () {
    var S = activeS(); if (!S) return;
    if (document.hidden) awayAt = Date.now();
    else if (awayAt) {
      var sec = Math.round((Date.now() - awayAt) / 1000); awayAt = 0;
      if (sec >= 2) { S.exits++; S.log.push(sec + " с"); save(); var b = $("#bar .cnt"); if (b) b.title = "уходов: " + S.exits; }
    }
  });

  window.ISP_START = function () { route(); };
})();
