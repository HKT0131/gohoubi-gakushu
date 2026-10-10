// ゲーム演出: タイプライター表示、STAGE カットイン、コンボ、フラッシュ／シェイク、残り時間の緊張演出、
// 結果のランク段階表示、画面切り替え（暗転・ワイプ）、ハートのパーティクル、衣装チェンジの光、触覚フィードバック。
// app.js からは window.GameFX があれば呼ぶ形で使う。無くてもアプリは動く。
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var sfx = function (name, o) { if (window.GameSFX) window.GameSFX.play(name, o); };

  // ---------- 触覚（iOS ネイティブ側のブリッジがあれば） ----------
  var HKEY = "fxHaptic";
  var hapticOn = true;
  try { hapticOn = localStorage.getItem(HKEY) !== "0"; } catch (e) {}
  function haptic(kind) {
    if (!hapticOn) return;
    try {
      var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic;
      if (h && typeof h.postMessage === "function") h.postMessage(kind);
    } catch (e) {}
  }
  function setHaptic(v) {
    hapticOn = !!v;
    try { localStorage.setItem(HKEY, hapticOn ? "1" : "0"); } catch (e) {}
    if (hapticOn) haptic("light");
  }

  // ---------- 共通 ----------
  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function retrigger(el, cls) {
    if (!el || reduced) return;
    el.classList.remove(cls);
    void el.offsetWidth; // アニメーションを最初から
    el.classList.add(cls);
  }
  function layer(cls) {
    var root = $("game") || document.body;
    var el = root.querySelector("." + cls);
    if (!el) { el = document.createElement("div"); el.className = cls; el.setAttribute("aria-hidden", "true"); root.appendChild(el); }
    return el;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  // ---------- タイプライター（要素ごとに1つ） ----------
  // type(el, text, { speed, onDone }) → { skip(), get done() }
  var typing = new Map();
  function type(el, text, o) {
    o = o || {};
    if (!el) return { skip: function () {}, done: true };
    var prev = typing.get(el);
    if (prev) prev.cancel();
    var full = String(text || ""), chars = Array.from(full), i = 0, timer = null, finished = false;
    el.textContent = "";
    var shown = document.createElement("span"), rest = document.createElement("span");
    rest.className = "tw-rest";
    el.appendChild(shown); el.appendChild(rest);
    el.setAttribute("aria-label", full);
    var win = el.closest(".msgwin, .bubble");
    if (win) win.classList.remove("done");
    function finish() {
      if (finished) return;
      finished = true;
      if (timer) { clearInterval(timer); timer = null; }
      shown.textContent = full; rest.textContent = "";
      if (win) win.classList.add("done");
      typing.delete(el);
      if (o.onDone) o.onDone();
    }
    var h = {
      skip: finish,
      cancel: function () { if (timer) clearInterval(timer); finished = true; typing.delete(el); },
      get done() { return finished; },
    };
    typing.set(el, h);
    if (reduced || !chars.length) { finish(); return h; }
    rest.textContent = full;
    timer = setInterval(function () {
      i++;
      shown.textContent = chars.slice(0, i).join("");
      rest.textContent = chars.slice(i).join("");
      if (i >= chars.length) finish();
    }, o.speed || 38);
    return h;
  }

  // ---------- 画面遷移 ----------
  // wipe(fn, kind): 暗転（"fade"）またはワイプ（"wipe"）で覆ってから fn を実行し、明ける
  var wiping = false;
  function wipe(fn, kind) {
    var w = $("wipe");
    if (!w || reduced) { fn(); return; }
    if (wiping) { fn(); return; }
    wiping = true;
    w.className = "wipe " + (kind || "fade") + " in";
    setTimeout(function () {
      try { fn(); } finally {
        w.className = "wipe " + (kind || "fade") + " out";
        setTimeout(function () { w.className = "wipe"; wiping = false; }, 340);
      }
    }, kind === "wipe" ? 300 : 240);
  }
  function screen(name) {
    clearTimers();
    document.body.classList.remove("time-low");
    var r = $("result");
    if (r) r.classList.remove("reveal", "r1", "r2", "r3", "r4");
    if (name !== "quiz") lastSec = null;
    var c = document.querySelector(".fx-cutin");
    if (c) { c.classList.add("hidden"); c.innerHTML = ""; }
  }

  // ---------- ラウンド開始：STAGE カットイン ----------
  var INTRO_MS = 1150;
  function roundStart(o) {
    var c = layer("fx-cutin");
    var n = Math.min(o.stage + 1, o.max);
    var k = o.stage >= o.max ? "EXTRA <em>DATE</em>" : "STAGE <em>" + n + "</em>";
    var label = o.stage >= o.max ? "復習の勉強デート" : "勉強デート ── 合格で" + o.label;
    c.innerHTML = '<div class="band"><div><div class="k">' + k + '</div><div class="l">' + esc(label) + "</div></div></div>";
    c.classList.remove("hidden");
    sfx("cutin"); haptic("light");
    later(function () { c.classList.add("hidden"); c.innerHTML = ""; }, reduced ? 950 : 1300);
    combo = 0;
    return INTRO_MS;
  }

  // ---------- 回答 ----------
  var combo = 0;
  function answer(o) {
    var choices = $("choices");
    if (choices) choices.classList.add("locked");
    if (o.ok) {
      combo = o.combo || 0;
      sfx("correct", { combo: combo }); haptic("success");
      retrigger(layer("fx-flash"), "go");
      if (combo >= 2) {
        var cb = layer("fx-combo");
        cb.innerHTML = "<b>" + combo + "</b><span>COMBO</span>";
        retrigger(cb, "go");
        if (reduced) { cb.style.opacity = "1"; later(function () { cb.style.opacity = ""; }, 700); }
        later(function () { sfx("combo"); }, 120);
      }
    } else {
      combo = 0;
      sfx("wrong"); haptic("error");
      retrigger($("qpanel"), "fx-shake");
    }
  }
  function nextQuestion() {
    var choices = $("choices");
    if (choices) choices.classList.remove("locked");
  }

  // ---------- 残り時間 ----------
  var lastSec = null;
  function tick(left) {
    var sec = Math.ceil(left);
    var low = left > 0 && sec <= 10;
    document.body.classList.toggle("time-low", low);
    if (low && sec !== lastSec && lastSec !== null) { sfx("tick", { urgent: sec <= 3 }); if (sec <= 3) haptic("light"); }
    lastSec = sec;
  }

  // ---------- よそ見 ----------
  function away() { sfx("away"); haptic("error"); retrigger($("qpanel"), "fx-shake"); }

  // ---------- 結果：ランクの段階表示 ----------
  function rankOf(pct) { return pct >= 100 ? "S" : pct >= 80 ? "A" : pct >= 60 ? "B" : "C"; }
  function result(o) {
    var r = $("result"), rank = $("r-rank");
    var R = rankOf(o.pct);
    if (rank) { rank.textContent = R; rank.dataset.rank = R; rank.setAttribute("aria-label", "ランク " + R); }
    lastSec = null;
    document.body.classList.remove("time-low");
    var step = reduced ? [0, 0, 0, 0] : [120, 620, 1050, 1350];
    if (r) r.classList.add("reveal");
    later(function () { r && r.classList.add("r1"); sfx("tap"); }, step[0]);
    later(function () { r && r.classList.add("r2"); sfx("stamp"); haptic("light"); }, step[1]);
    later(function () {
      r && r.classList.add("r3");
      if (o.passed) { sfx("pass"); haptic("success"); } else { sfx("fail"); haptic("error"); }
    }, step[2]);
    later(function () { r && r.classList.add("r4"); }, step[3]);
    return reduced ? 300 : 1700; // 段階表示が終わるまでの時間
  }
  // 結果画面をタップしたら段階表示を飛ばす
  var resultEl = $("result");
  if (resultEl) resultEl.addEventListener("click", function () {
    if (resultEl.classList.contains("reveal")) resultEl.classList.add("r1", "r2", "r3", "r4");
  });

  // ---------- ハートのパーティクル ----------
  function hearts(x, y, n) {
    if (reduced) return;
    var root = $("game") || document.body;
    for (var i = 0; i < (n || 5); i++) {
      var h = document.createElement("i");
      h.className = "fx-heart";
      h.setAttribute("aria-hidden", "true");
      var dx = (Math.random() * 2 - 1) * 46, dy = -50 - Math.random() * 60, s = 0.6 + Math.random() * 0.7;
      h.style.left = x + "px"; h.style.top = y + "px";
      h.style.setProperty("--dx", dx + "px"); h.style.setProperty("--dy", dy + "px"); h.style.setProperty("--s", s);
      h.style.animationDelay = (i * 50) + "ms";
      root.appendChild(h);
      setTimeout(function (el) { el.remove(); }, 1300 + i * 50, h);
    }
  }

  // ---------- 衣装チェンジ：やわらかい光 ----------
  function light() {
    var l = document.querySelector(".stand-light");
    sfx("unveil"); haptic("success");
    retrigger(l, "go");
  }
  function flash() { retrigger(layer("fx-flash"), "go"); }

  // ボタンの押し込みに軽い触覚とクリック音
  document.addEventListener("pointerdown", function (e) {
    var b = e.target && e.target.closest && e.target.closest("button");
    if (b && !b.closest("#choices")) haptic("light");
  }, { passive: true });

  window.GameFX = {
    type: type, wipe: wipe, screen: screen, roundStart: roundStart, answer: answer, nextQuestion: nextQuestion,
    tick: tick, away: away, result: result, hearts: hearts, light: light, flash: flash,
    haptic: haptic, setHaptic: setHaptic, get hapticOn() { return hapticOn; }, get reduced() { return reduced; },
  };
})();
