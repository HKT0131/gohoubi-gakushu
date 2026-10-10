// 効果音（WebAudio で合成。外部音源ファイルは使わない）
// window.GameSFX.play(name, opts) / .enabled / .setEnabled(bool) / .volume / .setVolume(0..1)
// iOS は最初のユーザー操作で AudioContext を起こす必要があるので unlock() を pointerdown で呼ぶ。
(function () {
  "use strict";
  var KEY = "fxSound";
  var ctx = null, master = null, noiseBuf = null;
  var enabled = true, volume = 0.8;
  try { enabled = localStorage.getItem(KEY) !== "0"; } catch (e) {}
  try { var v = parseFloat(localStorage.getItem(KEY + "Vol")); if (!isNaN(v)) volume = Math.max(0, Math.min(1, v)); } catch (e) {}

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.4 * volume;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() {
    if (!enabled) return;
    var c = ensure();
    if (c && c.state === "suspended") { try { c.resume(); } catch (e) {} }
  }
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = ctx.sampleRate * 0.6;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // 単音: type, 周波数(開始→終了), 開始時刻オフセット, 長さ, 音量
  function tone(type, f0, f1, at, dur, vol) {
    var t = ctx.currentTime + (at || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(at, dur, vol, fFrom, fTo, q) {
    var t = ctx.currentTime + (at || 0);
    var s = ctx.createBufferSource(); s.buffer = noise();
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q || 1.2;
    bp.frequency.setValueAtTime(fFrom, t);
    bp.frequency.exponentialRampToValueAtTime(fTo, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  var N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, E4: 329.63, C4: 261.63 };

  var SOUNDS = {
    tap: function () { tone("square", 1400, 900, 0, 0.03, 0.08); },
    correct: function (o) {
      var up = Math.pow(1.0595, Math.min(8, ((o && o.combo) || 1) - 1)); // コンボで半音ずつ上がる
      tone("triangle", N.E5 * up, null, 0, 0.09, 0.32);
      tone("triangle", N.A5 * up, null, 0.07, 0.18, 0.32);
      tone("sine", N.A5 * up * 2, null, 0.07, 0.14, 0.06);
    },
    wrong: function () {
      tone("sawtooth", 180, 120, 0, 0.22, 0.16);
      tone("square", 186, 124, 0, 0.22, 0.07);
    },
    tick: function (o) { tone("square", (o && o.urgent) ? 1320 : 990, null, 0, 0.035, 0.07); },
    cutin: function () {
      hiss(0, 0.45, 0.25, 600, 4000, 0.9);
      tone("triangle", N.C5, null, 0.18, 0.4, 0.16);
      tone("triangle", N.G5, null, 0.18, 0.4, 0.12);
    },
    stamp: function () {
      tone("sine", 140, 48, 0, 0.28, 0.6);
      hiss(0, 0.12, 0.3, 2400, 600, 0.7);
    },
    pass: function () {
      [N.C5, N.E5, N.G5, N.C6].forEach(function (f, i) { tone("triangle", f, null, i * 0.09, 0.22, 0.26); });
      tone("triangle", N.E6, null, 0.36, 0.5, 0.16);
    },
    fail: function () {
      tone("triangle", N.E4 * 1.5, null, 0, 0.22, 0.24);
      tone("triangle", N.C4 * 1.5, null, 0.2, 0.42, 0.24);
    },
    unveil: function () { hiss(0, 0.55, 0.18, 900, 3200, 1.6); tone("sine", N.G5, N.C6, 0.1, 0.4, 0.06); },
    combo: function () { tone("square", N.C6, null, 0, 0.05, 0.06); tone("square", N.E6, null, 0.05, 0.08, 0.06); },
    heart: function () { tone("sine", N.E6, N.G5 * 2, 0, 0.12, 0.08); tone("triangle", N.C6, null, 0.06, 0.16, 0.08); },
    coin: function () { tone("square", 1975, null, 0, 0.05, 0.06); tone("square", 2637, null, 0.05, 0.16, 0.06); },
    levelup: function () {
      [N.C5, N.E5, N.G5, N.C6, N.E6].forEach(function (f, i) { tone("triangle", f, null, i * 0.08, 0.3, 0.2); });
      hiss(0.1, 0.8, 0.08, 2000, 6000, 2);
    },
    page: function () { hiss(0, 0.12, 0.12, 3000, 1200, 1.2); },
    away: function () { tone("square", 440, null, 0, 0.08, 0.12); tone("square", 440, null, 0.12, 0.08, 0.12); },
  };

  window.GameSFX = {
    get enabled() { return enabled; },
    setEnabled: function (v) {
      enabled = !!v;
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) {}
      if (enabled) unlock();
    },
    get volume() { return volume; },
    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      try { localStorage.setItem(KEY + "Vol", String(volume)); } catch (e) {}
      if (master) master.gain.value = 0.4 * volume;
    },
    play: function (name, opts) {
      if (!enabled || !SOUNDS[name]) return;
      var c = ensure();
      if (!c) return;
      try {
        if (c.state === "suspended") c.resume();
        SOUNDS[name](opts);
      } catch (e) { /* 音が鳴らなくてもアプリは止めない */ }
    },
  };
})();
