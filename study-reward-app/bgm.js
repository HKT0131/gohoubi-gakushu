// BGM（背景音楽）
// window.GameBGM = { unlock(), play(track,{fadeMs}), stop(fadeMs), setVolume(0..1), setEnabled(bool), duck(bool) }
// track: "title" | "home" | "study" | "study_hurry" | "result_win" | "result_lose" | "event"
//
// 再生する音源の優先順位:
//   1) assets/bgm/<track>.m4a（無ければ .mp3）を読み込めれば、それをループ再生
//      - fetch / XHR で読めれば AudioBuffer で隙間なくループ（イントロ付きの曲はイントロ後からループ）
//      - file:// などで読めなければ <audio> 要素で再生。onerror なら「ファイル無し」と判断
//   2) ファイルが無ければ WebAudio でリアルタイム合成（下の SONGS の楽譜データから演奏）
// 合成した曲は GameBGM._render(track) で 1 ループ分を書き出せる（tools: scratchpad/bgm/export.mjs）。
(function (root) {
  "use strict";
  var AC = root.AudioContext || root.webkitAudioContext;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;

  // ================================================================
  // 音楽理論ヘルパー
  // ================================================================
  var PCN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function pcOf(s) {
    var n = PCN[s[0]];
    for (var i = 1; i < s.length; i++) { if (s[i] === "#") n++; else if (s[i] === "b") n--; }
    return ((n % 12) + 12) % 12;
  }
  function toMidi(s) {
    var m = /^([A-G][#b]?)(-?\d)$/.exec(s);
    if (!m) throw new Error("bad note " + s);
    return pcOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
  }
  function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var QUAL = {
    "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    sus4: [0, 5, 7], "7sus4": [0, 5, 7, 10], add9: [0, 4, 7, 14], m7b5: [0, 3, 6, 10], "6": [0, 4, 7, 9]
  };
  function parseChord(s) {
    var parts = s.split("/");
    var m = /^([A-G][#b]?)(.*)$/.exec(parts[0]);
    var iv = m && QUAL[m[2]];
    if (!iv) throw new Error("bad chord " + s);
    var r = pcOf(m[1]);
    return { name: s, root: r, bass: parts[1] ? pcOf(parts[1]) : r, iv: iv, pcs: iv.map(function (i) { return (r + i) % 12; }) };
  }
  function above(pc, lo) { var n = lo + ((pc - lo) % 12 + 12) % 12; return n; } // lo 以上で最小の pc
  // コードを lo 以上に並べる。open=true ならベース音を一番下に置き、残りを 5 度以上離して開離配置（ピアノ左手向け）
  function voice(ch, lo, open) {
    var out = [];
    if (open) {
      var b = above(ch.bass, lo); out.push(b);
      ch.pcs.forEach(function (p) { if (p !== ch.bass) out.push(above(p, b + 5)); });
    } else {
      ch.pcs.forEach(function (p) { var n = above(p, lo); if (out.indexOf(n) < 0) out.push(n); });
    }
    return out.sort(function (a, b) { return a - b; });
  }
  var SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

  // パターン文字列: 1 文字 = 16 分音符。'.' 休符、'-' 直前の音を伸ばす、それ以外は発音
  function hits(p) {
    while (p.length < 16) p += p;
    var out = [];
    for (var i = 0; i < 16; i++) {
      var c = p[i];
      if (c === "." || c === "-") continue;
      var L = 1; while (i + L < 16 && p[i + L] === "-") L++;
      out.push({ s: i, len: L, c: c });
    }
    return out;
  }
  // 決定的な疑似乱数（ループごとに同じ揺らぎにするため Math.random は使わない）
  function h01(n) {
    n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }
  function R(n) { var a = []; for (var i = 0; i < n; i++) a.push("r:16"); return a; }
  var ONE = "x...............";

  // ================================================================
  // 楽曲データ
  //   chords: 小節を "|" で区切る。1 小節に 2 つ書くと 2 拍ずつ
  //   mel:    "音名:長さ(16分音符単位)"、r は休符。1 小節 = 16
  //   layers: lead(メロディ) / pad(持続和音) / comp(和音の刻み) / arp(分散和音) / bass / drums
  // ================================================================
  var SONGS = {
    // 爽やかでわくわく。D メジャー、I–V–vi–IV の王道進行、ベル系メロ
    title: {
      bpm: 128, key: "D", mode: "major", gain: 0.85, delay: 3,
      form: "AAAAAAAABBBBBBBB",
      chords: "D | A | Bm | G | D | A | Bm | G A | G | A | F#m | Bm | Em7 | A | D/F# G | A A7",
      mel: [
        "F#5:2 A5:2 D6:3 E6:1 F#6:4 E6:2 D6:2", "C#6:6 B5:2 A5:4 E5:4",
        "D6:2 C#6:2 B5:2 D6:2 F#6:6 E6:2", "D6:4 B5:4 G5:2 A5:2 B5:4",
        "F#5:2 A5:2 D6:3 E6:1 F#6:4 A6:4", "E6:4 C#6:2 E6:2 A6:4 E6:4",
        "F#6:4 D6:2 B5:2 D6:2 C#6:2 B5:4", "B5:2 A5:2 G5:4 A5:4 C#6:4",
        "B5:6 A5:2 G5:4 D6:4", "C#6:6 B5:2 A5:4 E6:4",
        "C#6:6 D6:2 C#6:4 A5:4", "D6:4 C#6:2 B5:2 F#5:8",
        "G5:2 B5:2 E6:4 D6:4 B5:4", "C#6:4 E6:4 A6:6 G6:2",
        "F#6:4 E6:2 D6:2 D6:4 B5:4", "C#6:4 B5:2 A5:2 G5:2 A5:2 E5:4"
      ],
      layers: [
        { type: "lead", inst: "bell", vel: 0.9, rev: 0.22, dly: 0.22 },
        { type: "lead", inst: "pluck", oct: -12, vel: 0.42, pan: -0.4, rev: 0.15, on: "B" },
        { type: "pad", lo: "A3", vel: 0.6, rev: 0.35 },
        { type: "arp", inst: "pluck", lo: "D4", vel: 0.42, pan: 0.45, rev: 0.15, dly: 0.12,
          pat: { A: "0-2-1-3-0-2-1-3-", B: "0123210301232103" } },
        { type: "bass", lo: "C2", vel: 0.9, pat: { A: "R--.R-8-R--.R-8-", B: "R-8-R-8-R-8-R-8-" } },
        { type: "drums", rev: 0.08, drums: function (b, L, first, last) {
          var d = L === "A"
            ? { k: "x.....x...x.....", s: "....x.......x...", h: "x.o.x.o.x.o.x.o." }
            : { k: "x...x...x...x...", c: "....x.......x...", h: "o.o.o.o.o.o.o.o.", oh: "..x...x...x...x." };
          if (last) { d.k = "x.....x.x.x....."; d.s = "....x.....x.xoxx"; d.c = ""; d.oh = ""; }
          if (first) d.cr = ONE;
          return d;
        } }
      ]
    },

    // ゆったり可愛い。F メジャー、メジャーセブンス＋ツーファイブ、エレピ＋マリンバ、スウィング
    home: {
      bpm: 96, key: "F", mode: "major", swing: 0.16, gain: 1.0,
      form: "AAAAAAAABBBBBBBB",
      chords: "Fmaj7 | Em7 A7 | Dm7 | Cm7 F7 | Bbmaj7 | Am7 | Gm7 | C7sus4 C7 | Bbmaj7 | C7 | Am7 | Dm7 | Gm7 | C7 | Fmaj7 | Gm7 C7",
      mel: [
        "A5:2 C6:2 E6:4 r:2 C6:2 A5:4", "G5:2 B5:2 D6:4 C#6:4 E6:4",
        "F6:6 E6:2 D6:4 A5:4", "G5:2 Bb5:2 Eb6:4 Eb6:2 D6:2 C6:4",
        "D6:4 F6:4 A6:6 G6:2", "E6:6 C6:2 A5:4 G5:4",
        "Bb5:2 D6:2 F6:4 D6:2 C6:2 Bb5:4", "G5:4 F5:4 E5:4 G5:4",
        "F5:4 A5:4 D6:8", "E6:2 D6:2 C6:4 Bb5:4 G5:4",
        "A5:6 C6:2 E6:8", "F6:4 E6:2 D6:2 C6:4 A5:4",
        "Bb5:4 D6:4 F6:6 E6:2", "E6:4 G6:4 Bb6:4 G6:4",
        "A6:6 G6:2 E6:4 C6:4", "D6:4 Bb5:4 C6:4 E5:4"
      ],
      layers: [
        { type: "lead", inst: "marimba", vel: 0.95, pan: -0.15, rev: 0.22 },
        { type: "lead", inst: "bell", vel: 0.22, pan: 0.4, rev: 0.3, on: "B" },
        { type: "comp", inst: "ep", lo: "F3", vel: 0.5, pan: 0.3, rev: 0.25, strum: 0.008,
          pat: { A: "x-----.o-----...", B: "x--.o-..x--.o-.." } },
        { type: "pad", lo: "A3", vel: 0.35, rev: 0.4, on: "B" },
        { type: "bass", lo: "C2", vel: 0.62, pat: { A: "R-------R-----5-", B: "R---.R--R---5---" } },
        { type: "drums", mix: { sh: 0.6 }, drums: function (b, L, first, last) {
          var d = { k: "x......x..x.....", rim: "....x.......x...", sh: "xoxoxoxoxoxoxoxo" };
          if (L === "B") { d.rim = ""; d.s = "....o.......o..."; }
          if (last) { d.k = "x......x..x.x..."; d.rim = "....x.....x.x.xx"; d.s = ""; }
          return d;
        } }
      ]
    },

    // 集中できる軽快なローファイ。C メジャー、IVmaj7–iii7–ii7–Imaj7 の下降、控えめなエレピのメロ
    study: {
      bpm: 86, key: "C", mode: "major", swing: 0.12, gain: 1.05, tone: 3800,
      form: "AAAAAAAABBBBBBBB",
      chords: "Fmaj7 | Em7 | Dm7 | Cmaj7 | Fmaj7 | Em7 | Dm7 G7 | Cmaj7 | Am7 | Em7 | Fmaj7 | Cmaj7 | Am7 | Em7 | Dm7 | G7sus4 G7",
      mel: [
        "r:4 C6:2 A5:2 E5:8", "r:8 D5:2 E5:2 G5:4",
        "A5:6 G5:2 F5:8", "r:4 E5:2 G5:2 B5:8",
        "r:2 A5:2 C6:2 E6:6 D6:2 C6:2", "B5:8 G5:4 E5:4",
        "F5:4 A5:4 B5:4 D6:4", "C6:8 r:8",
        "r:4 E5:2 A5:2 C6:6 B5:2", "B5:6 G5:2 E5:8",
        "r:4 F5:2 A5:2 C6:4 E6:4", "E6:2 D6:2 C6:4 G5:8",
        "A5:4 C6:4 E6:4 G6:4", "B5:4 D6:4 E6:8",
        "F6:4 E6:2 D6:2 C6:4 A5:4", "C6:4 D6:4 B5:4 G5:4"
      ],
      layers: [
        { type: "lead", inst: "ep", vel: 0.62, pan: 0.2, rev: 0.3, dly: 0.18 },
        { type: "comp", inst: "ep", lo: "E3", vel: 0.5, pan: -0.3, rev: 0.25, strum: 0.012,
          pat: { A: "x---------o-----", B: "x-----.o-----..." } },
        { type: "pad", lo: "G3", vel: 0.3, rev: 0.45 },
        { type: "bass", inst: "sub", lo: "C2", vel: 0.62, pat: { A: "R-----....R-.R--", B: "R-------..R-5---" } },
        { type: "drums", mix: { h: 0.6, k: 0.7, s: 0.75 }, rev: 0.06, drums: function (b, L, first, last) {
          var d = { k: "x......x..x.....", s: "....x.......x...", h: "x.o.x.o.x.o.x.oo" };
          if (L === "B") d.k = "x......x.xx.....";
          if (last) { d.k = "x......x..x..x.."; d.s = "....x.......x.o."; }
          return d;
        } }
      ]
    },

    // 残り 10 秒。study と同じ調号（A マイナー＝C メジャーの平行調）、150BPM、和声的短音階の E で緊張感
    study_hurry: {
      bpm: 150, key: "A", mode: "minor", gain: 0.85, delay: 3,
      form: "AAAABBBB",
      chords: "Am | F | G | E7 | Am | F | Dm | E7",
      mel: [
        "E6:3 E6:3 C6:2 A5:4 B5:2 C6:2", "A5:3 A5:3 C6:2 F6:4 E6:2 C6:2",
        "B5:3 B5:3 D6:2 G6:4 F6:2 D6:2", "G#5:3 B5:3 E6:2 D6:2 C6:2 B5:4",
        "E6:3 E6:3 C6:2 A6:4 G6:2 A6:2", "F6:3 E6:3 C6:2 A5:4 C6:4",
        "D6:3 F6:3 A6:2 F6:4 D6:4", "B5:3 G#5:3 E5:2 G#5:2 B5:2 D6:4"
      ],
      layers: [
        { type: "lead", inst: "bell", vel: 0.75, rev: 0.15, dly: 0.12 },
        { type: "lead", inst: "pluck", oct: -12, vel: 0.4, pan: -0.4, rev: 0.1, on: "B" },
        { type: "arp", inst: "pluck", lo: "A3", vel: 0.4, pan: 0.45, rev: 0.1, pat: "0121012101210121" },
        { type: "pad", lo: "A3", vel: 0.35, rev: 0.3, on: "B" },
        { type: "bass", lo: "C2", vel: 0.9, pat: "R.R.R.R.R.R.R.8." },
        { type: "drums", rev: 0.05, drums: function (b, L, first, last) {
          var d = { k: "x...x...x...x...", s: "....x.......x...", h: "xoxoxoxoxoxoxoxo" };
          if (L === "B") { d.c = "....x.......x..."; d.oh = "..x...x...x...x."; }
          if (last) d.s = "....x...x.x.xxxx";
          if (first) d.cr = ONE;
          return d;
        } }
      ]
    },

    // 合格: 2 小節のファンファーレ → 明るいループ。G メジャー
    result_win: {
      bpm: 132, key: "G", mode: "major", gain: 0.85, intro: 2, delay: 3,
      form: "FFAAAABBBB",
      chords: "G | C D | G | D/F# | Em | C | G | D | C D | G",
      mel: ["G5:2 G5:2 G5:2 D6:10", "E6:2 E6:2 G6:2 A6:10",
        "B5:2 D6:2 G6:6 F#6:2 D6:4", "A5:4 D6:4 F#6:4 E6:2 D6:2",
        "G5:2 B5:2 E6:4 G6:2 F#6:2 E6:4", "C6:4 E6:4 G6:4 E6:4",
        "D6:2 B5:2 G5:4 B5:2 D6:2 G6:4", "F#6:4 A6:4 F#6:2 E6:2 D6:4",
        "E6:4 G6:4 F#6:4 A6:4", "G6:8 D6:4 B5:4"],
      layers: [
        { type: "lead", inst: "brass", vel: 0.85, rev: 0.3, on: "F" },
        { type: "comp", inst: "brass", lo: "G3", vel: 0.5, rev: 0.3, pan: -0.1, on: "F",
          pat: function (b) { return b === 0 ? "x-x-x-x---------" : "x-x-x-..x-------"; } },
        { type: "lead", inst: "bell", vel: 0.85, rev: 0.22, dly: 0.2, on: "AB" },
        { type: "lead", inst: "brass", oct: -12, vel: 0.3, pan: -0.4, rev: 0.2, on: "B" },
        { type: "arp", inst: "pluck", lo: "D4", vel: 0.4, pan: 0.45, rev: 0.15, on: "AB", pat: "0-2-1-2-0-2-1-2-" },
        { type: "pad", lo: "G3", vel: 0.5, rev: 0.35, on: "AB" },
        { type: "bass", lo: "C2", vel: 0.9,
          pat: function (b, L) { return L !== "F" ? "R-8-R-8-R-8-R-8-" : b === 0 ? "R-R-R-R---------" : "R-R-R-..R-------"; } },
        { type: "drums", rev: 0.08, drums: function (b, L, first, last) {
          if (b === 0) return { k: "x.x.x.x.........", cr: ONE };
          if (b === 1) return { k: "x.x.x...x.......", s: "........xoxoxxxx" };
          var d = { k: "x...x...x...x...", c: "....x.......x...", h: "o.o.o.o.o.o.o.o.", oh: "..x...x...x...x." };
          if (L === "B") d.s = "..........o....o";
          if (first) d.cr = ONE;
          return d;
        } }
      ]
    },

    // 不合格: 少し切ないが前向き。A マイナー（vi–IV–I–V）、ピアノ、80BPM
    result_lose: {
      bpm: 80, key: "A", mode: "minor", gain: 1.25,
      form: "AAAABBBB",
      chords: "Am | F | C | G | Am | F | Dm7 | Gsus4 G",
      mel: ["E5:4 A5:4 C6:6 B5:2", "A5:6 G5:2 F5:8", "E5:4 G5:4 C6:6 D6:2", "D6:8 B5:4 G5:4",
        "C6:4 E6:4 A6:6 G6:2", "F6:4 E6:2 C6:2 A5:8", "D6:4 C6:2 A5:2 F5:4 A5:4", "C6:8 B5:8"],
      layers: [
        { type: "lead", inst: "piano", vel: 0.8, pan: 0.05, rev: 0.32 },
        { type: "arp", inst: "piano", lo: "F2", open: true, vel: 0.38, pan: -0.3, rev: 0.3, pat: "0-1-2-1-3-1-2-1-" },
        { type: "pad", lo: "A3", vel: 0.4, rev: 0.45 },
        { type: "bass", inst: "sub", lo: "C2", vel: 0.7, on: "B", pat: "R-------R-----5-" },
        { type: "drums", on: "B", mix: { sh: 0.6, k: 0.8 }, drums: function () {
          return { k: "x.......x.......", rim: "....x.......x...", sh: "x.o.x.o.x.o.x.o." };
        } }
      ]
    },

    // 会話イベント: やさしいピアノ。G メジャー、76BPM、ドラム無し
    event: {
      bpm: 76, key: "G", mode: "major", gain: 1.6,
      form: "AAAAAAAABBBBBBBB",
      chords: "Gmaj7 | D/F# | Em7 | Bm7 | Cmaj7 | G/B | Am7 | D7sus4 D7 | Cmaj7 | D | Bm7 | Em7 | Am7 | D | Gmaj7 | Am7 D7",
      mel: [
        "B5:6 A5:2 G5:4 D5:4", "F#5:6 E5:2 D5:8", "E5:4 G5:4 B5:6 A5:2", "A5:6 F#5:2 D5:8",
        "E5:4 G5:4 B5:4 C6:4", "D6:6 C6:2 B5:8", "C6:4 B5:2 A5:2 E5:8", "G5:4 A5:4 F#5:8",
        "G5:4 C6:4 E6:8", "F#6:4 E6:2 D6:2 A5:8", "D6:6 B5:2 F#5:8", "G5:4 B5:4 E6:6 D6:2",
        "C6:6 B5:2 A5:8", "A5:4 D6:4 F#6:8", "G6:4 F#6:2 D6:2 B5:8", "C6:4 A5:4 F#5:4 A5:4"
      ],
      layers: [
        { type: "lead", inst: "piano", vel: 0.72, rev: 0.38 },
        { type: "arp", inst: "piano", lo: "E2", open: true, vel: 0.36, pan: -0.3, rev: 0.35,
          pat: { A: "0-1-2-3-4-3-2-1-", B: "0-2-3-1-4-2-3-2-" } },
        { type: "pad", lo: "B3", vel: 0.3, rev: 0.5, on: "B" }
      ]
    }
  };
  var TRACKS = Object.keys(SONGS);

  // ================================================================
  // 楽譜 → ステップごとのイベント列にコンパイル（リアルタイムでも書き出しでも同じものを使う）
  // ================================================================
  var DRUM_GROUP = { k: "kick", s: "snare", c: "snare", rim: "snare", h: "hat", oh: "hat", sh: "hat", cr: "hat" };
  var DRUM_INST = { k: "kick", s: "snare", c: "clap", rim: "rim", h: "hat", oh: "ohat", sh: "shaker", cr: "crash" };
  var compiled = {};
  function compile(name) {
    if (compiled[name]) return compiled[name];
    var def = SONGS[name], form = def.form, nb = form.length;
    var bars = def.chords.split("|").map(function (x) { return x.trim().split(/\s+/).map(parseChord); });
    if (bars.length !== nb) throw new Error(name + ": chords " + bars.length + " bars, form " + nb);
    function chordAt(s) { var cs = bars[Math.floor(s / 16)]; return cs[Math.floor((s % 16) / (16 / cs.length))]; }
    var steps = []; for (var i = 0; i < nb * 16; i++) steps.push([]);
    var chans = [];
    function addChan(o) { chans.push({ pan: o.pan || 0, rev: o.rev || 0, dly: o.dly || 0, gain: o.gain == null ? 1 : o.gain }); return chans.length - 1; }
    var warn = [];
    // メロディ（全レイヤー共通の def.mel）
    var mel = [];
    def.mel.forEach(function (bs, b) {
      var st = 0;
      bs.trim().split(/\s+/).forEach(function (tok) {
        var p = tok.split(":"), d = +p[1];
        if (p[0] !== "r") mel.push({ s: b * 16 + st, n: toMidi(p[0]), d: d });
        st += d;
      });
      if (st !== 16) warn.push(name + " mel bar " + (b + 1) + " = " + st + "/16");
    });
    if (def.mel.length !== nb) warn.push(name + " mel bars " + def.mel.length + " != " + nb);

    def.layers.forEach(function (L, li) {
      var on = function (b) { return !L.on || L.on.indexOf(form[b]) >= 0; };
      var hum = function (s) { return 0.9 + 0.14 * h01(s * 7 + li * 131); };
      if (L.type === "drums") {
        var dch = {
          kick: addChan({ gain: 1, rev: (L.rev || 0) * 0.3 }),
          snare: addChan({ gain: 1, rev: (L.rev || 0) + 0.06, pan: 0.04 }),
          hat: addChan({ gain: 1, rev: L.rev || 0, pan: 0.3 })
        };
        var mix = L.mix || {};
        for (var b = 0; b < nb; b++) {
          if (!on(b)) continue;
          var first = b === 0 || form[b - 1] !== form[b];
          var last = b === nb - 1 || form[b + 1] !== form[b];
          var pat = L.drums(b, form[b], first, last);
          Object.keys(pat).forEach(function (k) {
            if (!pat[k]) return;
            hits(pat[k]).forEach(function (h) {
              var s = b * 16 + h.s;
              var v = (h.c === "o" ? 0.5 : 1) * (mix[k] == null ? 1 : mix[k]) * hum(s);
              steps[s].push({ i: DRUM_INST[k], c: dch[DRUM_GROUP[k]], n: 0, d: h.len, v: v, seed: s });
            });
          });
        }
        return;
      }
      var c = addChan(L), lo = L.lo ? toMidi(L.lo) : 0, inst = L.inst || L.type;
      if (L.type === "lead") {
        mel.forEach(function (nt) {
          if (!on(Math.floor(nt.s / 16))) return;
          var acc = nt.s % 16 === 0 ? 1.06 : nt.s % 4 === 0 ? 1 : 0.9;
          steps[nt.s].push({ i: inst, c: c, n: nt.n + (L.oct || 0), d: nt.d, v: L.vel * acc * hum(nt.s) });
        });
        return;
      }
      if (L.type === "pad") {
        // コードが変わるごとに 1 つ。同じコードが続けばつなげる
        var segs = [];
        for (var s = 0; s < nb * 16; s++) {
          if (!on(Math.floor(s / 16))) continue;
          var ch = chordAt(s), prev = segs[segs.length - 1];
          if (prev && prev.ch === ch.name && prev.end === s) prev.end = s + 1;
          else segs.push({ s: s, end: s + 1, ch: ch.name, chord: ch });
        }
        segs.forEach(function (g) { steps[g.s].push({ i: "pad", c: c, n: voice(g.chord, lo), d: g.end - g.s, v: L.vel }); });
        return;
      }
      for (var bb = 0; bb < nb; bb++) {
        if (!on(bb)) continue;
        var p = typeof L.pat === "function" ? L.pat(bb, form[bb]) : typeof L.pat === "object" ? L.pat[form[bb]] : L.pat;
        if (!p) continue;
        hits(p).forEach(function (h) {
          var s = bb * 16 + h.s, ch = chordAt(s), v = L.vel * (h.c === "o" ? 0.6 : 1) * hum(s);
          if (L.type === "bass") {
            var base = above(ch.bass, lo), rt = above(ch.root, lo);
            var n = h.c === "8" ? base + 12 : h.c === "5" ? rt + 7 : h.c === "3" ? rt + ch.iv[1] : base;
            steps[s].push({ i: inst, c: c, n: n, d: h.len, v: v });
          } else if (L.type === "comp") {
            var vs = voice(ch, lo, L.open);
            vs.forEach(function (n, k) {
              steps[s].push({ i: inst, c: c, n: n, d: h.len, v: v / Math.sqrt(vs.length) * 1.3, dt: k * (L.strum || 0) });
            });
          } else if (L.type === "arp") {
            var va = voice(ch, lo, L.open), idx = parseInt(h.c, 10) || 0;
            steps[s].push({ i: inst, c: c, n: va[idx % va.length] + 12 * Math.floor(idx / va.length), d: h.len, v: v });
          }
        });
      }
    });
    var intro = def.intro || 0;
    var song = {
      name: name, def: def, bpm: def.bpm, stepDur: 60 / def.bpm / 4, swing: def.swing || 0,
      introSteps: intro * 16, loopSteps: (nb - intro) * 16, steps: steps, chans: chans,
      gain: def.gain || 1, tone: def.tone || 0, delay: def.delay || 0, warn: warn, mel: mel, chordAt: chordAt
    };
    if (warn.length && root.console) console.warn("[bgm]", warn.join("; "));
    compiled[name] = song;
    return song;
  }

  // ================================================================
  // 音色（1 音ごとに少数のノードを作って使い捨て。iPhone で軽くなるよう 2〜3 オシレータまで）
  // ================================================================
  function mkOsc(c, type, f, t, stop, det) {
    var o = c.createOscillator(); o.type = type; o.frequency.value = f;
    if (det) o.detune.value = det;
    o.start(t); o.stop(stop); return o;
  }
  function mkGain(c, v, out) { var g = c.createGain(); g.gain.value = v; if (out) g.connect(out); return g; }
  function mkFilt(c, type, f, q, out) { var b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (out) b.connect(out); return b; }
  function noiseSrc(E, t, stop, seed) {
    var s = E.ctx.createBufferSource(); s.buffer = E.noise;
    s.start(t, h01(seed + 7) * 1.5); s.stop(stop); return s;
  }
  function pluckEnv(P, t, peak, tc, atk) {
    P.setValueAtTime(0, t); P.linearRampToValueAtTime(peak, t + (atk || 0.003)); P.setTargetAtTime(0, t + (atk || 0.003), tc);
  }

  var INST = {
    // FM のベル（チェレスタ／グロッケン風）。アタックだけ金属的で、すぐ澄んだ正弦波に
    bell: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), end = t + Math.max(dur, 0.1) + 1.8;
      var g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.2 * v, 0.36, 0.004);
      var car = mkOsc(c, "sine", f, t, end); car.connect(g);
      var m = mkOsc(c, "sine", f * 3.5, t, end), mg = mkGain(c, 0);
      mg.gain.setValueAtTime(f * 1.4 * v, t); mg.gain.setTargetAtTime(0, t, 0.1);
      m.connect(mg); mg.connect(car.frequency);
      var o2 = mkOsc(c, "sine", f * 2, t, end), g2 = mkGain(c, 0.16, g); o2.connect(g2);
    },
    // エレピ（ローズ風）。比 1:1 の FM で温かい鳴り。ベロシティで明るさが変わる
    ep: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur, 0.08), end = off + 0.5;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.2 * v, t + 0.006);
      P.setTargetAtTime(0, t + 0.006, 1.1); P.setTargetAtTime(0, off, 0.09);
      var car = mkOsc(c, "sine", f, t, end); car.connect(g);
      var m = mkOsc(c, "sine", f, t, end), mg = mkGain(c, 0);
      mg.gain.setValueAtTime(f * (0.5 + 1.1 * v), t); mg.gain.setTargetAtTime(f * 0.12, t, 0.25);
      m.connect(mg); mg.connect(car.frequency);
    },
    marimba: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), end = t + 1.0;
      var g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.3 * v, 0.1 + 30 / f, 0.002);
      mkOsc(c, "sine", f, t, end).connect(g);
      var g2 = mkGain(c, 0, out); pluckEnv(g2.gain, t, 0.07 * v, 0.022, 0.001);
      mkOsc(c, "sine", f * 3.93, t, t + 0.2).connect(g2);
    },
    // ピアノ風: のこぎり波＋三角波をローパスの減衰で丸める
    piano: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur, 0.1), end = off + 0.7;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.26 * v, t + 0.003);
      P.setTargetAtTime(0, t + 0.003, Math.min(1.6, 0.5 + 160 / f)); P.setTargetAtTime(0, off, 0.13);
      var lp = mkFilt(c, "lowpass", 0, 0.4, g);
      lp.frequency.setValueAtTime(Math.min(f * 6 + 900 * v, 12000), t);
      lp.frequency.setTargetAtTime(f * 1.8 + 250, t, 0.3);
      var s = mkOsc(c, "sawtooth", f, t, end), sg = mkGain(c, 0.25, lp); s.connect(sg);
      mkOsc(c, "triangle", f, t, end, 4).connect(lp);
    },
    pluck: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur, 0.06), end = off + 0.3;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.13 * v, t + 0.003);
      P.setTargetAtTime(0, t + 0.003, 0.12); P.setTargetAtTime(0, off, 0.04);
      var lp = mkFilt(c, "lowpass", 0, 1.2, g);
      lp.frequency.setValueAtTime(Math.min(f * 8, 9000), t); lp.frequency.setTargetAtTime(f * 1.6, t, 0.06);
      mkOsc(c, "square", f, t, end).connect(lp);
    },
    brass: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur, 0.08), end = off + 0.4;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.12 * v, t + 0.025);
      P.setTargetAtTime(0.09 * v, t + 0.025, 0.2); P.setTargetAtTime(0, off, 0.06);
      var lp = mkFilt(c, "lowpass", 0, 1, g), F = lp.frequency;
      F.setValueAtTime(f * 1.2, t); F.linearRampToValueAtTime(Math.min(f * 6 + 600, 12000), t + 0.05);
      F.setTargetAtTime(Math.min(f * 3 + 400, 9000), t + 0.05, 0.2);
      mkOsc(c, "sawtooth", f, t, end, -7).connect(lp);
      mkOsc(c, "sawtooth", f, t, end, 7).connect(lp);
    },
    // 持続和音。デチューンしたのこぎり波を左右に振り分けてステレオの広がりを出す
    pad: function (E, out, t, ns, dur, v) {
      var c = E.ctx, off = t + dur, end = off + 1.5;
      var g = mkGain(c, 0, out), P = g.gain, lvl = 0.05 * v / Math.sqrt(ns.length / 3);
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(lvl, t + Math.min(0.45, dur * 0.4));
      P.setValueAtTime(lvl, Math.max(t + 0.46, off - 0.05)); P.setTargetAtTime(0, off, 0.3);
      var lp = mkFilt(c, "lowpass", 1300, 0.5, g);
      var pl = E.pan(-0.6, lp), pr = E.pan(0.6, lp);
      ns.forEach(function (n) {
        var f = mtof(n);
        mkOsc(c, "sawtooth", f, t, end, -9).connect(pl);
        mkOsc(c, "sawtooth", f, t, end, 9).connect(pr);
      });
    },
    bass: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur * 0.92, 0.06), end = off + 0.15;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.16 * v, t + 0.005);
      P.setTargetAtTime(0.1 * v, t + 0.005, 0.25); P.setTargetAtTime(0, off, 0.025);
      var lp = mkFilt(c, "lowpass", f * 3 + 180, 0.8, g);
      mkOsc(c, "triangle", f, t, end).connect(lp);
      var sq = mkOsc(c, "square", f, t, end), sg = mkGain(c, 0.45, lp); sq.connect(sg);
    },
    sub: function (E, out, t, n, dur, v) {
      var c = E.ctx, f = mtof(n), off = t + Math.max(dur * 0.95, 0.08), end = off + 0.2;
      var g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t); P.linearRampToValueAtTime(0.18 * v, t + 0.01);
      P.setTargetAtTime(0.13 * v, t + 0.01, 0.4); P.setTargetAtTime(0, off, 0.04);
      mkOsc(c, "sine", f, t, end).connect(g);
      var tr = mkOsc(c, "triangle", f * 2, t, end), tg = mkGain(c, 0.2, g); tr.connect(tg);
    },
    // ---- ドラム（ノイズとオシレータで合成）
    kick: function (E, out, t, n, dur, v) {
      var c = E.ctx, o = mkOsc(c, "sine", 150, t, t + 0.45), g = mkGain(c, 0, out);
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(56, t + 0.1);
      pluckEnv(g.gain, t, 0.48 * v, 0.075, 0.002); o.connect(g);
    },
    snare: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.3 * v, 0.055, 0.001);
      noiseSrc(E, t, t + 0.35, seed).connect(mkFilt(c, "bandpass", 2400, 0.6, g));
      var g2 = mkGain(c, 0, out); pluckEnv(g2.gain, t, 0.24 * v, 0.04, 0.001);
      mkOsc(c, "triangle", 185, t, t + 0.25).connect(g2);
    },
    clap: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out), P = g.gain;
      P.setValueAtTime(0, t);
      for (var k = 0; k < 3; k++) { P.setValueAtTime(0.3 * v, t + k * 0.011); P.setTargetAtTime(0.02, t + k * 0.011 + 0.001, 0.004); }
      P.setValueAtTime(0.28 * v, t + 0.033); P.setTargetAtTime(0, t + 0.034, 0.07);
      noiseSrc(E, t, t + 0.45, seed).connect(mkFilt(c, "bandpass", 1300, 1.1, g));
    },
    rim: function (E, out, t, n, dur, v) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.16 * v, 0.014, 0.001);
      mkOsc(c, "triangle", 1650, t, t + 0.1).connect(g);
      mkOsc(c, "sine", 510, t, t + 0.1).connect(g);
    },
    hat: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.15 * v, 0.018, 0.001);
      noiseSrc(E, t, t + 0.12, seed).connect(mkFilt(c, "highpass", 7800, 0.7, g));
    },
    ohat: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.11 * v, 0.09, 0.002);
      noiseSrc(E, t, t + 0.5, seed).connect(mkFilt(c, "highpass", 7000, 0.7, g));
    },
    shaker: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.12 * v, 0.03, 0.012);
      noiseSrc(E, t, t + 0.15, seed).connect(mkFilt(c, "bandpass", 6000, 0.9, g));
    },
    crash: function (E, out, t, n, dur, v, seed) {
      var c = E.ctx, g = mkGain(c, 0, out); pluckEnv(g.gain, t, 0.11 * v, 0.55, 0.003);
      noiseSrc(E, t, t + 2.6, seed).connect(mkFilt(c, "highpass", 4500, 0.5, g));
    }
  };

  // ================================================================
  // ミキサー（コンテキストごとに 1 つ）
  //   各曲 → synthIn → コンプレッサー → post(音量) → duck → 出力
  //   リバーブ（合成インパルスの ConvolverNode）は全曲で共有。ファイル音源は post に直接入れる
  // ================================================================
  function seeded(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function makeImpulse(c, sec) {
    var sr = c.sampleRate, len = Math.floor(sr * sec), pre = Math.floor(sr * 0.012);
    var buf = c.createBuffer(2, len, sr), rnd = seeded(12345);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), y = 0;
      for (var i = pre; i < len; i++) {
        var x = (i - pre) / sr, a = 0.85 - 0.75 * Math.min(1, x / sec);   // 後半ほど暗く
        y += a * ((rnd() * 2 - 1) - y);
        d[i] = y * Math.exp(-x * 6.9 / sec) * (x < 0.004 ? x / 0.004 : 1);
      }
    }
    return buf;
  }
  function makeGraph(c) {
    var E = { ctx: c };
    var nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0), rnd = seeded(777);
    for (var i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    E.noise = nb;
    E.pan = function (p, out) {
      if (!c.createStereoPanner || !p) return out;
      var s = c.createStereoPanner(); s.pan.value = p; s.connect(out); return s;
    };
    E.duck = mkGain(c, 1, c.destination);
    E.post = mkGain(c, 1, E.duck);
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5;
    comp.attack.value = 0.008; comp.release.value = 0.25;
    comp.connect(E.post);
    var hp = mkFilt(c, "highpass", 38, 0.6, comp);   // 超低域のゴロゴロを切る
    E.trim = mkGain(c, 0.6, hp);          // コンプ前の全体レベル
    E.synthIn = E.trim;
    var conv = c.createConvolver(); conv.buffer = makeImpulse(c, 1.8);
    E.rvIn = mkGain(c, 1, conv);
    conv.connect(mkGain(c, 0.6, E.synthIn));
    return E;
  }

  // ================================================================
  // 合成プレイヤー（1 曲ぶん）
  // ================================================================
  function SynthPlayer(E, song) {
    var c = E.ctx; this.E = E; this.s = song; this.track = song.name;
    this.fade = mkGain(c, 0, E.synthIn);
    var tail = this.fade;
    if (song.tone) tail = mkFilt(c, "lowpass", song.tone, 0.5, this.fade);
    this.bus = mkGain(c, song.gain, tail);
    this.wet = mkGain(c, 0, E.rvIn);
    var dlIn = null;
    if (song.delay) {
      dlIn = mkGain(c, 1);
      var dl = c.createDelay(1); dl.delayTime.value = song.delay * song.stepDur;
      var fb = mkGain(c, 0.3), lp = mkFilt(c, "lowpass", 3000, 0.5, fb);
      dlIn.connect(dl); dl.connect(lp); fb.connect(dl);
      dl.connect(mkGain(c, 0.55, E.pan(-0.55, this.bus)));
      this.dl = [dlIn, dl, fb];
    }
    var self = this;
    this.ch = song.chans.map(function (d) {
      var g = mkGain(c, d.gain), p = E.pan(d.pan, self.bus);
      g.connect(p);
      if (d.rev) g.connect(mkGain(c, d.rev, self.wet));
      if (d.dly && dlIn) g.connect(mkGain(c, d.dly, dlIn));
      return g;
    });
    this.g = 0; this.next = 0;
  }
  SynthPlayer.prototype.stepIndex = function (g) {
    var s = this.s;
    return g < s.introSteps ? g : s.introSteps + ((g - s.introSteps) % s.loopSteps);
  };
  SynthPlayer.prototype.playStep = function (g, t) {
    var s = this.s, idx = this.stepIndex(g), evs = s.steps[idx];
    if (idx % 2 === 1) t += s.swing * s.stepDur;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i], f = INST[ev.i];
      if (f) f(this.E, this.ch[ev.c], t + (ev.dt || 0), ev.n, ev.d * s.stepDur, ev.v, ev.seed || idx);
    }
  };
  SynthPlayer.prototype.start = function (t0, fadeSec) {
    this.next = t0; this.g = 0;
    rampTo(this.fade.gain, 1, t0, fadeSec); rampTo(this.wet.gain, 1, t0, fadeSec);
  };
  SynthPlayer.prototype.pump = function (now, until) {
    if (this.stopped) return;
    var sd = this.s.stepDur;
    if (this.next < now - 0.05) {                 // 大きく遅れたら拍の格子を保ったまま先へ進める
      var k = Math.ceil((now + 0.02 - this.next) / sd); this.g += k; this.next += k * sd;
    }
    while (this.next < until) { this.playStep(this.g, this.next); this.g++; this.next += sd; }
  };
  SynthPlayer.prototype.stop = function (fadeSec) {
    var c = this.E.ctx, t = c.currentTime, self = this;
    this.stopping = true;
    rampTo(this.fade.gain, 0, t, fadeSec); rampTo(this.wet.gain, 0, t, fadeSec);
    this.stopAt = t + fadeSec + 0.05;
    setTimeout(function () {
      self.stopped = true;
      setTimeout(function () { try { self.fade.disconnect(); self.wet.disconnect(); if (self.dl) self.dl.forEach(function (n) { n.disconnect(); }); } catch (e) {} }, 2500);
    }, fadeSec * 1000 + 300);
  };
  function rampTo(P, v, t, sec) {
    if (P.cancelAndHoldAtTime) P.cancelAndHoldAtTime(t);
    else { var cur = P.value; P.cancelScheduledValues(t); P.setValueAtTime(cur, t); }
    if (sec <= 0.005) P.setValueAtTime(v, t); else P.linearRampToValueAtTime(v, t + sec);
  }

  // ファイル（AudioBuffer）プレイヤー。イントロ付きの曲はイントロ後から隙間なくループ
  function BufferPlayer(E, track, buf) {
    var c = E.ctx, song = compile(track);
    this.E = E; this.track = track;
    this.fade = mkGain(c, 0, E.post);
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    var introDur = song.introSteps * song.stepDur, loopDur = song.loopSteps * song.stepDur;
    if (buf.duration >= introDur + loopDur - 0.05) { src.loopStart = introDur; src.loopEnd = Math.min(buf.duration, introDur + loopDur); }
    src.connect(this.fade); this.src = src;
  }
  BufferPlayer.prototype.start = function (t0, fadeSec) { this.src.start(t0); rampTo(this.fade.gain, 1, t0, fadeSec); };
  BufferPlayer.prototype.pump = function () {};
  BufferPlayer.prototype.stop = function (fadeSec) {
    var t = this.E.ctx.currentTime, self = this; this.stopping = true;
    rampTo(this.fade.gain, 0, t, fadeSec);
    try { this.src.stop(t + fadeSec + 0.05); } catch (e) {}
    setTimeout(function () { self.stopped = true; try { self.fade.disconnect(); } catch (e) {} }, fadeSec * 1000 + 300);
  };

  // <audio> 要素プレイヤー（file:// で fetch/XHR できない環境用）。音量はJSでフェード
  // ※ iOS の <audio>.volume は読み取り専用のため、フェード・ダッキングは効かない（音量0/無効時は一時停止）
  function ElementPlayer(eng, track, url) {
    var song = compile(track), el = new Audio(url), self = this;
    this.eng = eng; this.track = track; this.el = el; this.level = 0; this.from = 0; this.to = 0; this.t0 = 0; this.dur = 0;
    this.introDur = song.introSteps * song.stepDur;
    el.preload = "auto"; el.loop = !this.introDur; el.volume = 0;
    if (this.introDur) el.addEventListener("ended", function () { el.currentTime = self.introDur; el.play().catch(function () {}); });
  }
  ElementPlayer.prototype.anim = function (to, sec) { this.from = this.cur(); this.to = to; this.t0 = Date.now(); this.dur = sec * 1000; this.eng.elTick(); };
  ElementPlayer.prototype.cur = function () { var k = this.dur ? Math.min(1, (Date.now() - this.t0) / this.dur) : 1; return this.from + (this.to - this.from) * k; };
  ElementPlayer.prototype.start = function (t0, fadeSec) { this.anim(1, fadeSec); this.resume(); };
  ElementPlayer.prototype.resume = function () { if (!this.stopping) { var p = this.el.play(); if (p && p.catch) p.catch(function () {}); } };
  ElementPlayer.prototype.pump = function () {};
  ElementPlayer.prototype.stop = function (fadeSec) {
    var self = this; this.stopping = true; this.anim(0, fadeSec);
    setTimeout(function () { self.stopped = true; self.el.pause(); self.el.removeAttribute("src"); try { self.el.load(); } catch (e) {} }, fadeSec * 1000 + 100);
  };

  // ================================================================
  // 本体
  // ================================================================
  var BASE = "assets/bgm/", EXTS = [".m4a", ".mp3"];
  var LOOK = 0.3, TICK = 50;
  var st = {
    ctx: null, E: null, unlocked: false, vol: 0.6, on: true, ducked: false, duckLv: 1,
    want: null, cur: null, players: [], tok: 0, timer: null, elTimer: null,
    src: {}, bufs: []   // src[track] = {kind:"buffer"|"element"|"none", url}; bufs = 最近の AudioBuffer（最大3）
  };
  try {
    var sv = parseFloat(localStorage.getItem("bgmVol")); if (!isNaN(sv)) st.vol = Math.max(0, Math.min(1, sv));
    st.on = localStorage.getItem("bgmOn") !== "0";
  } catch (e) {}
  function level() { return st.on ? st.vol : 0; }
  function hidden() { return typeof document !== "undefined" && document.hidden; }

  function ensureCtx() {
    if (st.ctx || !AC) return st.ctx;
    try { st.ctx = new AC({ latencyHint: "playback" }); } catch (e) { try { st.ctx = new AC(); } catch (e2) { return null; } }
    st.E = makeGraph(st.ctx);
    st.E.post.gain.value = level();
    return st.ctx;
  }
  function tick() {
    var c = st.ctx; if (!c) return;
    var now = c.currentTime;
    st.players = st.players.filter(function (p) { return !p.stopped; });
    st.players.forEach(function (p) { p.pump(now, now + LOOK); });
    if (!st.players.length) { clearInterval(st.timer); st.timer = null; }
  }
  function ensureTimer() { if (!st.timer) st.timer = setInterval(tick, TICK); }

  function elTick() {
    if (st.elTimer) return;
    st.elTimer = setInterval(function () {
      var any = false, lv = level() * st.duckLv;
      st.players.forEach(function (p) {
        if (!p.el) return; any = true;
        var v = Math.max(0, Math.min(1, p.cur() * lv));
        try { p.el.volume = v; } catch (e) {}
        if (lv <= 0.001 && !p.el.paused) p.el.pause();
      });
      st.players = st.players.filter(function (p) { return !p.stopped; });
      if (!any) { clearInterval(st.elTimer); st.elTimer = null; }
    }, 40);
  }
  var eng = { elTick: elTick };

  // ---- ファイルの有無を調べる（結果はキャッシュ）
  function loadBytes(url) {
    function viaXHR() {
      return new Promise(function (res, rej) {
        try {
          var x = new XMLHttpRequest(); x.open("GET", url); x.responseType = "arraybuffer";
          x.onload = function () { (x.status === 200 || (x.status === 0 && x.response && x.response.byteLength)) ? res(x.response) : rej(x.status === 404 ? "404" : "xhr"); };
          x.onerror = function () { rej("xhr"); };
          x.send();
        } catch (e) { rej("xhr"); }
      });
    }
    if (/^file:/.test(location.protocol)) {
      // file:// の fetch はどのブラウザでも失敗する。XHR は iOS WKWebView（allowFileAccessFromFileURLs）でだけ通るので、
      // それ以外（PC の Chrome など）では試さずに <audio> 判定へ（コンソールに CORS エラーを出さないため）
      var ua = (root.navigator && navigator.userAgent) || "";
      return /AppleWebKit/.test(ua) && !/Chrome|CriOS|Edg|Android/.test(ua) ? viaXHR() : Promise.reject("file");
    }
    if (!root.fetch) return viaXHR();
    return fetch(url).then(function (r) {
      if (r.status === 404) throw "404";
      if (!r.ok) throw "http";
      return r.arrayBuffer();
    }, viaXHR);
  }
  function probeElement(url) {
    return new Promise(function (res) {
      var a = new Audio(), done = false;
      function fin(ok) { if (done) return; done = true; a.removeAttribute("src"); try { a.load(); } catch (e) {} res(ok); }
      a.preload = "metadata";
      a.onloadedmetadata = function () { fin(true); };
      a.oncanplay = function () { fin(true); };
      a.onerror = function () { fin(false); };
      setTimeout(function () { fin(false); }, 4000);
      a.src = url;
    });
  }
  function decode(ab) {
    return new Promise(function (res, rej) {
      var p = st.ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  function cachedBuf(track) { for (var i = 0; i < st.bufs.length; i++) if (st.bufs[i].track === track) return st.bufs[i].buf; return null; }
  function keepBuf(track, buf) { st.bufs = st.bufs.filter(function (b) { return b.track !== track; }); st.bufs.unshift({ track: track, buf: buf }); st.bufs.length = Math.min(st.bufs.length, 3); }
  function resolve(track) {
    var known = st.src[track];
    if (known && known.kind === "none") return Promise.resolve({ kind: "synth" });
    if (known && known.kind === "element") return Promise.resolve(known);
    var b = cachedBuf(track); if (b) return Promise.resolve({ kind: "buffer", buf: b });
    var i = 0;
    function attempt() {
      if (i >= EXTS.length) { st.src[track] = { kind: "none" }; return { kind: "synth" }; }
      var url = (GameBGM.base || BASE) + track + EXTS[i++];
      return loadBytes(url).then(function (ab) {
        return decode(ab).then(function (buf) { keepBuf(track, buf); st.src[track] = { kind: "buffer", url: url }; return { kind: "buffer", buf: buf }; },
          function () { return probeOrNext(url); });
      }, function (err) { return err === "404" ? attempt() : probeOrNext(url); });
    }
    function probeOrNext(url) {
      if (typeof Audio === "undefined") return attempt();
      return probeElement(url).then(function (ok) {
        if (ok) { st.src[track] = { kind: "element", url: url }; return st.src[track]; }
        return attempt();
      });
    }
    return attempt();
  }

  function startWanted(fadeMs) {
    var track = st.want;
    if (!track || !st.unlocked || !st.on || hidden() || !ensureCtx()) return;
    if (st.cur && st.cur.track === track && !st.cur.stopping) return;
    if (st.pending === track) return;
    var tok = ++st.tok, fade = Math.max(0.01, (fadeMs == null ? 800 : fadeMs) / 1000);
    st.pending = track;
    resolve(track).then(function (r) {
      if (tok !== st.tok) return;
      st.pending = null;
      var c = st.ctx, p;
      if (r.kind === "buffer") p = new BufferPlayer(st.E, track, r.buf);
      else if (r.kind === "element") p = new ElementPlayer(eng, track, r.url);
      else p = new SynthPlayer(st.E, compile(track));
      var old = st.cur;
      st.cur = p; st.players.push(p);
      p.start(c.currentTime + 0.06, fade);
      if (old && !old.stopping) old.stop(fade);
      if (p instanceof SynthPlayer) { ensureTimer(); tick(); }
    }).catch(function (e) { if (tok === st.tok) st.pending = null; if (root.console) console.warn("[bgm]", e); });
  }
  function stopCurrent(fadeMs) {
    st.tok++; st.pending = null;
    if (st.cur && !st.cur.stopping) st.cur.stop(Math.max(0.01, fadeMs / 1000));
    st.cur = null;
  }
  function applyLevel(sec) {
    if (st.E) rampTo(st.E.post.gain, level(), st.ctx.currentTime, sec == null ? 0.08 : sec);
    st.players.forEach(function (p) { if (p.el && p.el.paused && level() > 0.001 && !hidden()) p.resume(); });
    elTick();
  }

  var GameBGM = {
    tracks: TRACKS.slice(),
    base: BASE,
    unlock: function () {
      st.unlocked = true;
      var c = ensureCtx(); if (!c) return;
      if (c.state !== "running" && !hidden()) { try { var pr = c.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
      if (!st.silent) {           // iOS: 無音を 1 回鳴らしてオーディオを起こす
        st.silent = true;
        try { var s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, c.sampleRate); s.connect(c.destination); s.start(0); } catch (e) {}
      }
      if (st.cur && st.cur.el && st.cur.el.paused && level() > 0) st.cur.resume();
      startWanted(800);
    },
    play: function (track, opts) {
      if (!SONGS[track]) { if (root.console) console.warn("[bgm] unknown track", track); return; }
      var fadeMs = opts && opts.fadeMs != null ? opts.fadeMs : 800;
      st.want = track;
      if (st.cur && st.cur.track === track && !st.cur.stopping) { st.tok++; st.pending = null; return; }
      startWanted(fadeMs);
    },
    stop: function (fadeMs) {
      st.want = null;
      stopCurrent(fadeMs == null ? 600 : fadeMs);
    },
    setVolume: function (v) {
      st.vol = Math.max(0, Math.min(1, +v || 0));
      try { localStorage.setItem("bgmVol", String(st.vol)); } catch (e) {}
      applyLevel();
    },
    setEnabled: function (on) {
      st.on = !!on;
      try { localStorage.setItem("bgmOn", st.on ? "1" : "0"); } catch (e) {}
      if (!st.on) { stopCurrent(400); applyLevel(0.4); }
      else { applyLevel(0.05); startWanted(600); }
    },
    duck: function (on) {
      st.ducked = !!on;
      var to = on ? 0.35 : 1;
      if (st.E) rampTo(st.E.duck.gain, to, st.ctx.currentTime, 0.2);
      // <audio> 用
      var from = st.duckLv, t0 = Date.now();
      clearInterval(st.duckTimer);
      st.duckTimer = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / 200); st.duckLv = from + (to - from) * k;
        if (k >= 1) clearInterval(st.duckTimer);
      }, 30);
      elTick();
    },
    getVolume: function () { return st.vol; },
    isEnabled: function () { return st.on; },
    current: function () { return st.want; },
    // ---- 開発用: 書き出し・検証
    _compile: compile,
    _songs: SONGS,
    _sourceOf: function (t) { return st.src[t] && st.src[t].kind; },
    _render: render,
    _wav: toWav
  };

  // ================================================================
  // 書き出し: OfflineAudioContext で [イントロ][ループA][ループB][ループCの頭] を描画し、
  //   ファイル = [イントロ][ループB]。ループBの頭には A の残響・余韻が乗っているので、
  //   さらに頭の XF 秒を「C の頭（＝B の末尾の本当の続き）」→ B へ直線クロスフェードしておく。
  //   これで B の末尾から頭へ戻る継ぎ目は、描画上の連続した波形と一致する。
  //   イントロ末尾は B の末尾へ短くクロスフェードし、イントロ→ループの入りも連続させる。
  //   各ループの開始はサンプル単位に揃える（B と C がちょうど lN サンプルずれた同じ波形になる）。
  // ================================================================
  function render(track, sr, raw) {
    sr = sr || 44100;
    var song = compile(track), sd = song.stepDur;
    var iN = Math.round(song.introSteps * sd * sr), lN = Math.round(song.loopSteps * sd * sr);
    var XF = Math.min(Math.round(1.5 * sr), lN >> 2), XI = Math.round(0.08 * sr);
    var len = iN + 2 * lN + XF + 16, endT = len / sr;
    var c = new OAC(2, len, sr), E = makeGraph(c), p = new SynthPlayer(E, song);
    p.fade.gain.value = 1; p.wet.gain.value = 1;
    function timeOf(g) {
      if (g < song.introSteps) return g * sd;
      var j = g - song.introSteps, L = Math.floor(j / song.loopSteps);
      return (iN + L * lN) / sr + (j % song.loopSteps) * sd;
    }
    // リアルタイムと同じく少しずつノードを作る（一度に全部作るとグラフが巨大になり極端に遅い）
    var g = 0;
    function feed(until) { var t; while ((t = timeOf(g)) < Math.min(until, endT)) { p.playStep(g, t); g++; } }
    if (c.suspend) {
      feed(2);
      for (var q = 1; q < endT; q++) (function (q) {
        c.suspend(q).then(function () { feed(q + 2); c.resume(); });
      })(q);
    } else feed(Infinity);
    var r = c.startRendering();
    var done = r && r.then ? r : new Promise(function (res) { c.oncomplete = function (e) { res(e.renderedBuffer); }; });
    return done.then(function (buf) {
      if (raw) return buf;
      var out = [], B = iN + lN, C = iN + 2 * lN;
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch), o = new Float32Array(iN + lN), k, w;
        o.set(d.subarray(0, iN), 0);
        o.set(d.subarray(B, B + lN), iN);
        for (k = 0; k < XF; k++) { w = k / XF; o[iN + k] = d[C + k] * (1 - w) + d[B + k] * w; }
        if (iN) for (k = 0; k < XI; k++) { w = (k + 1) / XI; var i = iN - XI + k; o[i] = d[i] * (1 - w) + d[C - XI + k] * w; }
        out.push(o);
      }
      return { sampleRate: sr, channels: out, introDur: iN / sr, loopDur: lN / sr };
    });
  }
  function toWav(r) {
    var n = r.channels[0].length, nc = r.channels.length, ab = new ArrayBuffer(44 + n * nc * 2), v = new DataView(ab);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * nc * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, r.sampleRate, true);
    v.setUint32(28, r.sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * nc * 2, true);
    var o = 44;
    for (var i = 0; i < n; i++) for (var ch = 0; ch < nc; ch++) {
      var x = Math.max(-1, Math.min(1, r.channels[ch][i])); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2;
    }
    return ab;
  }

  // ---- タブ切り替え・アプリのバックグラウンドで止める
  function onHide() {
    if (st.ctx && st.ctx.state === "running") { try { st.ctx.suspend(); } catch (e) {} }
    st.players.forEach(function (p) { if (p.el) p.el.pause(); });
  }
  function onShow() {
    if (!st.unlocked || !st.on) return;
    if (st.ctx && st.ctx.state !== "running") { try { var pr = st.ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
    st.players.forEach(function (p) { if (p.el && !p.stopping) p.resume(); });
    if (st.want && !st.cur) startWanted(600);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () { hidden() ? onHide() : onShow(); });
    root.addEventListener("pagehide", onHide);
    root.addEventListener("appbackground", onHide);
    root.addEventListener("appforeground", onShow);
  }

  root.GameBGM = GameBGM;
})(typeof window !== "undefined" ? window : this);
