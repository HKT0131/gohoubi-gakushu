// ごほうび学習 — アプリ本体（恋愛シミュレーション風）
// 依存: character.js（SVG の立ち絵: renderCharacter / LAYERS / MAX_STAGE。画像が無いときの代替表示）
//       character_vrm.js（任意。3D 表示 CharacterVRM。設定 → キャラ → キャラ表示 で 3D を選んだときだけ使う）
//       questions.js（buildQuestions / SUBJECTS）
//       script.js（SCRIPT: セリフと会話イベント）
//       fx.js（GameFX: 演出）/ sfx.js（GameSFX: 効果音）
//       bgm.js（GameBGM）/ voice.js（GameVoice）… 無くても動く
//
// 画面はすべて1画面に収まる固定レイアウト。ページはスクロールしない。
// 画面の切り替えは GameFX.wipe（暗転・ワイプ）、補助画面はシート（タブ・ページ送り）とフルスクリーン演出で出す。

(() => {
"use strict";

// ================= 定数 =================
const DEFAULTS = {
  study: { subject: "english", count: 5, time: 60, pass: 80, penalty: false, focus: true, custom: "" },
  chara: {
    name: "ミサキ", age: 25, personality: "gentle", hairStyle: "long",
    hair: "#6b4a3a", eye: "#4a7bd0", skin: "#fde3d3", accent: "#e85d8a", accent2: "#3f4a6b",
    blazer: "#2f3b5c", coat: "#c9a27e", beret: "#8a3550", swim: "#4fb3c9", shoe: "#3a2a2a", glasses: false,
  },
  audio: { bgm: 0.6, bgmOn: true, voice: 0.9, voiceOn: true, sfx: 0.8, sfxOn: true },
};
const FALLBACK_SUBJECTS = [
  { id: "english", label: "ビジネス英単語" }, { id: "math", label: "計算トレーニング" },
  { id: "general", label: "一般教養" }, { id: "custom", label: "自作問題" },
];
const SESSION_GAP_MS = 15 * 60 * 1000; // これ以上空いたら「連続ラウンド」をリセット
const POMODORO_ROUNDS = 4;              // 何ラウンドごとに休憩を勧めるか
const DAILY_KEEP_DAYS = 60;

// 好感度レベル（at = 必要な好感度の累計）
const LEVELS = [
  { name: "知り合い", at: 0 }, { name: "顔なじみ", at: 40 }, { name: "友達", at: 120 },
  { name: "仲良し", at: 240 }, { name: "特別な人", at: 400 }, { name: "大切なパートナー", at: 600 },
];
// 衣装段階ごとの「いまの服装」（stage = 脱いだ枚数）。水着が最終段階で、これより先はない
const OUTFITS = ["ベレー帽とマフラー", "コート", "ブレザー", "ブラウスとスカート", "水着"];
const EXPRS = [["normal", "ふつう"], ["happy", "笑顔"], ["shy", "照れ"], ["sad", "しょんぼり"], ["pout", "むくれ"]];
const TALK_PER_DAY = 5;
const GIFT_PER_DAY = 3;
const GIFTS = [ // 順番は script.js の "<性格>.gift.<n>" と対応
  { name: "付箋セット", price: 30, aff: 6, desc: "勉強の必需品" },
  { name: "ホットのカフェラテ", price: 50, aff: 10, desc: "休憩のおともに" },
  { name: "5色の蛍光ペン", price: 40, aff: 8, desc: "ノートが華やかに" },
  { name: "押し花の栞", price: 80, aff: 15, desc: "ちょっと特別な贈り物" },
  { name: "小さな花束", price: 150, aff: 25, desc: "気持ちを伝えたいときに" },
];
const LOGIN_REWARDS = [20, 30, 40, 50, 60, 80, 150];
const MISSIONS = [
  { id: "pass", label: "勉強デートで1回合格", target: 1, reward: 40 },
  { id: "correct", label: "1日で合計10問正解", target: 10, reward: 30 },
  { id: "combo", label: "5問連続で正解", target: 5, reward: 40 },
];
const MISSION_BONUS = 50;
const ALBUM_PRICE = 30;
const EP_FIRST_REWARD = 20;
const BG_NAMES = ["room_morning", "room_evening", "room_night", "library", "cafe"];

// ================= 小物 =================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FX = (name, ...args) => {
  const fx = window.GameFX;
  if (!fx || typeof fx[name] !== "function") return undefined;
  try { return fx[name](...args); } catch (e) { console.warn("演出でエラー", e); return undefined; }
};
const sfx = (n, o) => { try { window.GameSFX && window.GameSFX.play(n, o); } catch (e) {} };
const icon = (id, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

function load(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return { ...def }; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = () => dayKey();
const yesterday = () => dayKey(new Date(Date.now() - 864e5));

// ================= 状態 =================
let study, chara, prog, daily, session, audio, game;
function loadAll() {
  study = load("study", DEFAULTS.study);
  if ("view" in study) { delete study.view; save("study", study); } // 旧バージョンの 2D/3D 表示モード（3D は撤去）
  chara = load("chara", DEFAULTS.chara);
  chara.age = clamp(parseInt(chara.age, 10) || 25, 20, 60);
  prog = load("progress", { stage: 0, rounds: 0, passes: 0, correct: 0, answered: 0, streak: 0, review: [] });
  prog.stage = clamp(prog.stage | 0, 0, MAX_STAGE);
  if (!Array.isArray(prog.review)) prog.review = [];
  daily = load("daily", {});
  session = load("session", { count: 0, lastEnd: 0 });
  audio = loadAudio();
  game = migrateGame();
}

// 音量・ON/OFF は各モジュール（bgm.js / voice.js / sfx.js）と同じ localStorage キーで共有する
function loadAudio() {
  const g = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const vol = (k, d) => { const v = parseFloat(g(k)); return isNaN(v) ? d : clamp(v, 0, 1); };
  const D = DEFAULTS.audio;
  return {
    bgm: vol("bgmVol", D.bgm), bgmOn: g("bgmOn") !== "0",
    voice: vol("voiceVol", D.voice), voiceOn: g("voiceOn") !== "0",
    sfx: vol("fxSoundVol", D.sfx), sfxOn: g("fxSound") !== "0",
  };
}
function saveAudio() {
  const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  set("bgmVol", audio.bgm); set("bgmOn", audio.bgmOn ? "1" : "0");
  set("voiceVol", audio.voice); set("voiceOn", audio.voiceOn ? "1" : "0");
  set("fxSoundVol", audio.sfx); set("fxSound", audio.sfxOn ? "1" : "0");
}

// 好感度・コインなどのゲーム進行（localStorage "game"）。旧データ（progress）から初期値を引き継ぐ。
function migrateGame() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem("game") || "null"); } catch {}
  const fresh = !g || typeof g !== "object";
  const base = {
    v: 1, aff: 0, exp: 0, coins: 0, maxStage: 0, levelSeen: 0,
    seen: [], knownEps: [], album: [],
    talk: { day: "", n: 0 }, gifts: { day: "", n: 0, total: 0 },
    login: { last: "", idx: -1 }, streak: { last: "", n: 0, best: 0 },
    missions: { day: "", pass: 0, correct: 0, combo: 0, claimed: [], bonus: false },
  };
  g = { ...base, ...(fresh ? {} : g) };
  if (fresh) {
    // 既存の学習成果を好感度・経験値・コインに換算（レベルアップ演出が連発しないよう、見たことにする）
    g.aff = Math.min(LEVELS[4].at - 1, (prog.passes | 0) * 12 + (prog.correct | 0));
    g.exp = (prog.correct | 0) * 10 + (prog.passes | 0) * 30;
    g.coins = 100 + (prog.passes | 0) * 10;
    g.levelSeen = levelOf(g.aff);
    g.streak = streakFromDaily();
  }
  g.maxStage = Math.max(g.maxStage | 0, prog.stage);
  g.knownEps = fresh ? unlockedEpisodes(g).map((e) => e.id) : g.knownEps;
  save("game", g);
  return g;
}
function streakFromDaily() {
  let n = 0, last = "";
  for (let i = 0; i < DAILY_KEEP_DAYS; i++) {
    const k = dayKey(new Date(Date.now() - i * 864e5));
    const r = daily[k];
    if (r && r.rounds > 0) { n++; if (!last) last = k; } else if (i > 0 || n > 0) break;
  }
  return { last, n, best: n };
}
const saveGame = () => save("game", game);

// ---------- 好感度・経験値 ----------
function levelOf(aff) { let i = 0; LEVELS.forEach((l, k) => { if (aff >= l.at) i = k; }); return i; }
function levelInfo() {
  const i = levelOf(game.aff), cur = LEVELS[i], nx = LEVELS[i + 1];
  return { i, name: cur.name, next: nx, pct: nx ? (game.aff - cur.at) / (nx.at - cur.at) : 1, left: nx ? nx.at - game.aff : 0 };
}
function expInfo() {
  let lv = 1, rest = game.exp, need = 100;
  while (rest >= need) { rest -= need; lv++; need = 100 + 50 * (lv - 1); }
  return { lv, rest, need };
}
function curStreak() { const s = game.streak; return s.last === today() || s.last === yesterday() ? s.n : 0; }
function bumpStreak() {
  const s = game.streak, t = today();
  if (s.last === t) return;
  s.n = s.last === yesterday() ? s.n + 1 : 1;
  s.last = t; s.best = Math.max(s.best | 0, s.n);
}

// ---------- エピソード ----------
const EPISODES = (typeof SCRIPT !== "undefined" && SCRIPT && Array.isArray(SCRIPT.episodes)) ? SCRIPT.episodes : [];
function isUnlocked(ep, g = game) {
  const u = ep.unlock || {};
  return levelOf(g.aff) >= (u.level || 0) && (g.streak.best | 0) >= (u.streak || 0);
}
function unlockedEpisodes(g = game) { return EPISODES.filter((e) => isUnlocked(e, g)); }
function unlockText(ep) {
  const u = ep.unlock || {}, t = [];
  if (u.level) t.push(`好感度「${LEVELS[u.level].name}」`);
  if (u.streak) t.push(`連続学習${u.streak}日`);
  return t.join("・") + "で解放";
}
// 新しく解放されたエピソードを返し、既知に加える
function takeNewEpisodes() {
  const fresh = unlockedEpisodes().filter((e) => !game.knownEps.includes(e.id));
  if (fresh.length) { game.knownEps.push(...fresh.map((e) => e.id)); saveGame(); }
  return fresh;
}

// ---------- デイリー ----------
function missionsToday() {
  const m = game.missions;
  if (m.day !== today()) Object.assign(m, { day: today(), pass: 0, correct: 0, combo: 0, claimed: [], bonus: false });
  return m;
}
function missionDone(def) { return (missionsToday()[def.id] | 0) >= def.target; }
function missionClaimable() {
  const m = missionsToday();
  return MISSIONS.some((d) => missionDone(d) && !m.claimed.includes(d.id)) ||
    (!m.bonus && MISSIONS.every((d) => m.claimed.includes(d.id)));
}
function talkToday() { if (game.talk.day !== today()) game.talk = { day: today(), n: 0 }; return game.talk; }
function giftsToday() { if (game.gifts.day !== today()) game.gifts = { ...game.gifts, day: today(), n: 0 }; return game.gifts; }

// ================= サウンド・音声 =================
let curTrack = null;
function music(track) {
  if (curTrack === track) return;
  curTrack = track;
  try { window.GameBGM && window.GameBGM.play(track, { fadeMs: 700 }); } catch (e) {}
}
let voiceSeq = 0, voiceDone = Promise.resolve();
function voice(id) {
  const V = window.GameVoice;
  ++voiceSeq;
  voiceDone = Promise.resolve();
  try {
    if (V && V.stop) V.stop();
    // 再生中の BGM のダッキングは voice.js が行う
    if (V && audio.voiceOn && V.has && V.has(id)) voiceDone = Promise.resolve(V.play(id)).catch(() => {});
  } catch (e) {}
}
function stopVoice() { voiceSeq++; try { window.GameVoice && window.GameVoice.stop(); } catch (e) {} }
function applyAudio() {
  try {
    const B = window.GameBGM, V = window.GameVoice, S = window.GameSFX;
    if (B) { B.setVolume && B.setVolume(audio.bgm); B.setEnabled && B.setEnabled(audio.bgmOn); }
    if (V) { V.setVolume && V.setVolume(audio.voice); V.setEnabled && V.setEnabled(audio.voiceOn); }
    if (S) { S.setVolume && S.setVolume(audio.sfx); S.setEnabled && S.setEnabled(audio.sfxOn); }
  } catch (e) {}
}
// iOS: 最初のユーザー操作で音を起こす
let unlocked = false;
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try { window.GameBGM && window.GameBGM.unlock(); } catch (e) {}
  try { window.GameVoice && window.GameVoice.unlock(); } catch (e) {}
  const t = curTrack; curTrack = null; if (t) music(t);
}
window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio);

// ================= 立ち絵 =================
// assets/chara/stage{n}_{expr}.png → stage{n}_normal.png → SVG（character.js）
const artState = {}; // "stage0_normal" → "ok" | "err"
const bgState = {};
function probe(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
}
const charaSrc = (s, e) => `assets/chara/stage${s}_${e}.png`;
function srcFor(s, e) {
  if (artState[`stage${s}_${e}`] === "ok") return charaSrc(s, e);
  if (artState[`stage${s}_normal`] === "ok") return charaSrc(s, "normal");
  return null;
}
function preloadArt() {
  // 各段階の normal を先に確かめ、あれば表情差分も読み込む（無いファイルへの問い合わせを減らす）
  for (let s = 0; s <= MAX_STAGE; s++) {
    probe(charaSrc(s, "normal")).then((ok) => {
      artState[`stage${s}_normal`] = ok ? "ok" : "err";
      if (ok) {
        if (stand.stage === s) redrawStand();
        EXPRS.slice(1).forEach(([e]) => probe(charaSrc(s, e)).then((ok2) => {
          artState[`stage${s}_${e}`] = ok2 ? "ok" : "err";
          if (ok2 && stand.stage === s && stand.expr === e) redrawStand();
        }));
      }
    });
  }
  BG_NAMES.forEach((n) => probe(`assets/bg/${n}.jpg`).then((ok) => { bgState[n] = ok; if (ok && $("bg").dataset.bg === n) setBg(n); }));
}
function hasImages() { return Object.values(artState).includes("ok"); }

const stand = { stage: 0, expr: "normal", slot: 0 };
const slotEl = (i) => document.querySelector(`#stand .slot[data-slot="${i}"]`);
function paint(el, s, e, c = chara) {
  const src = srcFor(s, e);
  if (src) {
    const img = el.querySelector("img");
    if (img && el.firstElementChild === img) { if (!img.src.endsWith(src)) img.src = src; }
    else el.innerHTML = `<img alt="" draggable="false" src="${src}">`;
  } else {
    let svg = el.querySelector("svg");
    if (!svg || el.querySelector("img")) { el.innerHTML = '<svg viewBox="0 0 300 600" aria-hidden="true"></svg>'; svg = el.firstElementChild; }
    renderCharacter(svg, c, s, e);
  }
  el.setAttribute("aria-label", `${chara.name}（${outfitName(s)}）`);
}
function drawStand(s, e = "normal", fade = false) {
  const prev = stand.stage;
  stand.stage = s; stand.expr = e;
  $("stand").dataset.stage = String(s);
  if (v3d) { v3d.setStage(s, { animate: fade }); v3d.setExpr(e); }
  if (!fade || prev === s) { paint(slotEl(stand.slot), s, e); return; }
  const next = 1 - stand.slot;
  paint(slotEl(next), s, e);
  slotEl(next).classList.add("on");
  slotEl(stand.slot).classList.remove("on");
  stand.slot = next;
}
function redrawStand() { paint(slotEl(stand.slot), stand.stage, stand.expr); }
function setExpr(e) { if (!e || e === stand.expr) return; stand.expr = e; redrawStand(); if (v3d) v3d.setExpr(e); }
function react(kind) {
  if (v3d) v3d.react(kind === "hop" ? "correct" : kind === "droop" ? "wrong" : kind);
  const el = $("stand");
  el.classList.remove("hop", "droop"); void el.offsetWidth; el.classList.add(kind);
  setTimeout(() => el.classList.remove(kind), 950);
}

// ================= 3D 表示（character_vrm.js / assets/vrm/chara.vrm） =================
// localStorage "charaView" = "2d" | "3d"。3D は #stand の中に canvas を重ね、2D の立ち絵は隠す（読み込み失敗・WebGL 不可なら 2D のまま）。
let v3d = null;
const VIEW_KEY = "charaView";
// 3D 表示中は段階名を 3D 用（モデル本来の服: ベレー帽とマフラー／袖／ブラウス／スカート）にする。2D は従来どおり。
const use3dLabels = () => !!v3d && typeof CharacterVRM !== "undefined" && !!CharacterVRM.LAYERS;
function layerLabel(i) { return (use3dLabels() ? CharacterVRM.LAYERS : LAYERS)[i].label; }
function outfitName(s) { return (use3dLabels() ? CharacterVRM.OUTFITS : OUTFITS)[s]; }
function viewMode() { try { return localStorage.getItem(VIEW_KEY) === "3d" ? "3d" : "2d"; } catch { return "2d"; } }
function setViewMode(m) { try { localStorage.setItem(VIEW_KEY, m === "3d" ? "3d" : "2d"); } catch {} applyView(); }
function applyView() {
  const st = $("stand");
  const want = viewMode() === "3d" && typeof CharacterVRM !== "undefined" && CharacterVRM.supported();
  if (!want) {
    if (v3d) { v3d.dispose(); v3d = null; }
    st.classList.remove("is3d"); st.querySelectorAll(".stand-3d").forEach((x) => x.remove());
    renderHud();
    if (viewMode() === "3d" && typeof CharacterVRM !== "undefined") toast("この端末では3D表示を使えないため、2Dで表示します");
    return;
  }
  if (v3d) { v3d.setColors(chara); return; }
  const box = document.createElement("div");
  box.className = "stand-3d";
  st.insertBefore(box, st.querySelector(".stand-light"));
  const v = (v3d = CharacterVRM.mount(box, { colors: chara }));
  v.setStage(stand.stage); v.setExpr(stand.expr);
  renderHud();
  v.ready.then(() => { if (v3d === v) st.classList.add("is3d"); }).catch((e) => {
    console.warn("3D表示を読み込めませんでした", e);
    if (v3d !== v) return;
    v.dispose(); v3d = null; box.remove(); st.classList.remove("is3d"); renderHud();
    toast("3Dモデルを読み込めなかったため、2Dで表示します");
  });
}

// ================= 背景・時間帯 =================
function timeSlot() {
  const q = new URLSearchParams(location.search).get("time");
  if (["morning", "evening", "night"].includes(q)) return q;
  const h = new Date().getHours();
  return h >= 5 && h < 15 ? "morning" : h >= 15 && h < 19 ? "evening" : "night";
}
function setBg(name) {
  const bg = $("bg");
  bg.dataset.bg = name;
  bg.dataset.time = name.startsWith("room_") ? name.slice(5) : timeSlot();
  const img = bg.querySelector(".bg-img");
  if (bgState[name]) { img.style.backgroundImage = `url("assets/bg/${name}.jpg")`; bg.classList.add("has-img"); }
  else { img.style.backgroundImage = ""; bg.classList.remove("has-img"); }
}

// ================= セリフ =================
const MSG = { home: "home-msg", bubble: "quiz-msg", ep: "ep-msg" };
let lastLine = {};
function lineFor(cat) { return typeof SCRIPT !== "undefined" ? SCRIPT.line(chara.personality, cat) : null; }
// lineId のセリフを表示して音声を鳴らす。target は "home" | "bubble" | "ep" | 要素
function showLine(id, target = "home", { expr = true } = {}) {
  const L = id && SCRIPT.lines[id];
  if (!L) return null;
  if (expr) setExpr(L.expr);
  const el = typeof target === "string" ? $(MSG[target]) : target;
  const h = FX("type", el, L.text) || (el.textContent = L.text, null);
  voice(id);
  lastLine[target] = id;
  return h;
}
function say(cat, target = "home", opt) {
  // 同じカテゴリで同じセリフが続かないように
  let id = lineFor(cat);
  for (let k = 0; k < 3 && id === lastLine[target]; k++) id = lineFor(cat);
  return showLine(id, target, opt);
}
document.querySelectorAll(".msgwin, .bubble").forEach((w) => w.addEventListener("click", () => {
  if (w.id === "ep-win") return; // 会話イベントは別処理
  const m = w.querySelector(".msg"); FX("type", m, m.getAttribute("aria-label") || m.textContent);
}));

// ================= 画面（シーン） =================
let current = "home";
let flowId = 0; // 画面が変わったら進行中の非同期演出を打ち切る
function setMode(name) {
  flowId++;
  current = name;
  FX("screen", name);
  ["home", "quiz", "result", "ep"].forEach((s) => {
    const el = $(s);
    el.classList.toggle("hidden", s !== name);
    if (s === name) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
  });
  document.body.className = `mode-${name}`;
  $("quiz-bubble").classList.toggle("hidden", !(name === "quiz" || name === "result"));
}
function transit(fn, kind = "fade") { FX("wipe", fn, kind) === undefined && !window.GameFX && fn(); }
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.classList.remove("hidden");
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 2700);
}

// ================= ホーム =================
function roomBg() { return "room_" + timeSlot(); }
function renderHud(beat = false) {
  const L = levelInfo();
  $("aff-level").textContent = L.name;
  $("aff-lv-no").textContent = `Lv.${L.i + 1}`;
  $("aff-gauge").style.width = Math.round(L.pct * 100) + "%";
  $("aff-fill-rect").setAttribute("y", String(30 - 30 * Math.max(0.08, L.pct)));
  $("aff-next").textContent = L.next ? `次の「${L.next.name}」まで あと${L.left}` : "これ以上ない関係";
  $("aff").setAttribute("aria-label", `好感度 ${L.name}（レベル${L.i + 1}）`);
  if (beat) { const a = $("aff"); a.classList.remove("beat"); void a.offsetWidth; a.classList.add("beat"); }
  $("hud-coins").textContent = game.coins;
  $("hud-lv").textContent = expInfo().lv;
  $("hud-streak").textContent = curStreak();
  $("pips").innerHTML = LAYERS.map((_, i) => `<span class="${i < prog.stage ? "on" : ""}"></span>`).join("");
  $("next-label").textContent = prog.stage >= MAX_STAGE ? "ALL CLEAR" : `次の合格で：${layerLabel(prog.stage)}`;
  ["home-name", "quiz-name", "ep-name"].forEach((id) => ($(id).textContent = chara.name));
  const t = talkToday();
  $("talk-left").textContent = `おはなし あと${Math.max(0, TALK_PER_DAY - t.n)}回`;
  $("talk-hint").classList.toggle("hidden", t.n > 0);
  $("b-talk").classList.toggle("hidden", !unlockedEpisodes().some((e) => !game.seen.includes(e.id)));
  $("b-mission").classList.toggle("hidden", !missionClaimable());
}
function enterHome() {
  setMode("home");
  setBg(roomBg());
  drawStand(prog.stage, "normal");
  renderHud();
  say(prog.stage >= MAX_STAGE && Math.random() < 0.3 ? "complete" : "greet_" + timeSlot());
  music("home");
}
function goHome() {
  stopQuiz();
  transit(() => { enterHome(); }, "fade");
  setTimeout(homeEvents, 420);
}
// ホームに戻ったときに順番に出す演出（ログボ → レベルアップ → 新エピソード）
let homeBusy = false;
async function homeEvents() {
  if (homeBusy || current !== "home") return;
  homeBusy = true;
  try {
    if (game.login.last !== today()) await showLogin();
    await checkLevelUp();
    const fresh = takeNewEpisodes();
    if (fresh.length) toast(`新しい会話イベント「${fresh[0].title}」が解放されました`);
    renderHud();
  } finally { homeBusy = false; }
}

// 話しかける
$("chara-hit").addEventListener("click", (e) => {
  if (current !== "home") return;
  const t = talkToday();
  if (t.n >= TALK_PER_DAY) { say("talklimit"); renderHud(); return; }
  t.n++;
  const band = levelOf(game.aff) >= 4 ? 2 : levelOf(game.aff) >= 2 ? 1 : 0;
  say("talk" + band);
  addAff(1);
  FX("hearts", e.clientX, e.clientY, 4); sfx("heart");
  react("hop");
  renderHud(true);
  setTimeout(() => checkLevelUp(), 900);
});

function addAff(n) { game.aff = Math.max(0, game.aff + n); saveGame(); }

// ================= フルスクリーン演出 =================
function fsOpen(cls, html) {
  const fs = $("fs");
  fs.className = "fs " + cls;
  fs.innerHTML = html;
  return fs;
}
function fsClose() { const fs = $("fs"); fs.className = "fs hidden"; fs.innerHTML = ""; }

async function checkLevelUp() {
  const lv = levelOf(game.aff);
  if (lv <= game.levelSeen) return;
  const from = game.levelSeen;
  game.levelSeen = lv; saveGame();
  await showLevelUp(from, lv);
}
function showLevelUp(from, lv) {
  return new Promise((resolve) => {
    const fresh = takeNewEpisodes();
    const prevTrack = curTrack;
    music("event");
    sfx("levelup"); FX("haptic", "success");
    const fs = fsOpen("levelup", `
      <div class="kicker">LOVE LEVEL UP</div>
      <div class="lv-heart">${icon("i-heart")}<b>${lv + 1}</b></div>
      <h2>${esc(LEVELS[lv].name)}</h2>
      <div class="lv-change"><s>${esc(LEVELS[from].name)}</s><i></i><b>${esc(LEVELS[lv].name)}</b></div>
      <div class="quote"><span class="plate">${esc(chara.name)}</span><p class="msg" id="fs-msg"></p></div>
      ${fresh.length ? `<div class="unlock">会話イベント解放：<b>「${esc(fresh[0].title)}」</b></div>` : ""}
      <div class="btns">${fresh.length ? '<button class="btn" id="fs-later" type="button">あとで</button><button class="btn primary" id="fs-go" type="button">いま見る</button>'
        : '<button class="btn primary" id="fs-ok" type="button">つづける</button>'}</div>`);
    showLine(lineFor("levelup" + lv), $("fs-msg"), { expr: false });
    const done = (go) => {
      stopVoice(); fsClose();
      if (go) playEpisode(fresh[0]);
      else if (prevTrack) music(prevTrack);
      resolve();
    };
    fs.querySelector("#fs-ok, #fs-later").onclick = () => done(false);
    const g = fs.querySelector("#fs-go"); if (g) g.onclick = () => done(true);
  });
}

function showLogin() {
  return new Promise((resolve) => {
    const idx = (game.login.idx + 1) % 7;
    const reward = LOGIN_REWARDS[idx];
    const cell = (i) => `<div class="d${i === 6 ? " big" : ""}${i < idx ? " got" : ""}${i === idx ? " today" : ""}">
      <span class="dn">DAY ${i + 1}</span>${icon(i === 6 ? "i-gift" : "i-coin", "coin")}<b>${LOGIN_REWARDS[i]}</b></div>`;
    const fs = fsOpen("login", `
      <div class="kicker">LOGIN BONUS</div>
      <h2>今日の来訪ボーナス</h2>
      <p class="sub">7日でひと巡り。7日目は特別なごほうび。</p>
      <div class="cal">${Array.from({ length: 7 }, (_, i) => cell(i)).join("")}</div>
      <div class="quote"><span class="plate">${esc(chara.name)}</span><p class="msg" id="fs-msg"></p></div>
      <div class="btns"><button class="btn accent" id="fs-ok" type="button">${icon("i-coin", "coin")} ${reward} を受け取る</button></div>`);
    showLine(lineFor("login"), $("fs-msg"));
    fs.querySelector("#fs-ok").onclick = () => {
      game.login = { last: today(), idx };
      game.coins += reward; saveGame();
      fs.querySelector(".d.today").classList.add("got");
      sfx("coin"); FX("haptic", "success");
      renderHud();
      const c = document.querySelector(".coin-pill"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
      setTimeout(() => { stopVoice(); fsClose(); resolve(); }, 650);
    };
  });
}

// 衣装チェンジ：前の立ち絵から新しい立ち絵へクロスフェード＋やわらかい光
function showCostume(stage) {
  return new Promise((resolve) => {
    document.body.classList.add("mode-show");
    const fs = fsOpen("show", `
      <div class="ribbon">${stage >= MAX_STAGE ? "ALL STAGE CLEAR" : `STAGE ${stage} CLEAR`}</div>
      <div class="quote"><span class="plate">${esc(chara.name)}</span><p class="msg" id="fs-msg"></p></div>
      <div class="tap">TAP TO CONTINUE</div>`);
    setTimeout(() => {
      FX("light");
      drawStand(stage, "shy", true);
      showLine(lineFor("stage" + stage), $("fs-msg"), { expr: false });
    }, 450);
    let ok = false;
    setTimeout(() => { ok = true; }, 900);
    fs.onclick = () => {
      if (!ok) return;
      fs.onclick = null; fsClose();
      document.body.classList.remove("mode-show");
      resolve();
    };
  });
}

// ================= 汎用ダイアログ =================
function dialog(html, setup) {
  return new Promise((resolve) => {
    const d = $("dialog"), w = $("dialog-win");
    w.className = "window";
    w.innerHTML = html;
    d.classList.remove("hidden");
    const close = (v) => { d.classList.add("hidden"); w.innerHTML = ""; resolve(v); };
    if (setup) setup(w, close);
    w.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => close(b.dataset.v)));
    const f = w.querySelector(".primary"); if (f) f.focus();
  });
}
const alertBox = (msg) => dialog(`<span class="plate">システム</span><p>${esc(msg)}</p><div class="btns"><button class="btn primary" data-v="1" type="button">OK</button></div>`);
const confirmBox = (msg, ok = "はい") => dialog(`<span class="plate">確認</span><p>${esc(msg)}</p><div class="btns"><button class="btn" data-v="" type="button">キャンセル</button><button class="btn primary" data-v="1" type="button">${esc(ok)}</button></div>`).then(Boolean);

// めくり式（ページ送り）: items を1件ずつ／n件ずつ表示する
function pager(page, pages, onMove) {
  const el = document.createElement("div");
  el.className = "pager";
  el.innerHTML = `<button class="iconbtn" type="button" aria-label="前へ" ${page <= 0 ? "disabled" : ""}>${icon("i-left")}</button>
    <span class="pg">${page + 1} / ${pages}</span>
    <button class="iconbtn" type="button" aria-label="次へ" ${page >= pages - 1 ? "disabled" : ""}>${icon("i-right")}</button>`;
  const [l, r] = el.querySelectorAll("button");
  l.onclick = () => { sfx("page"); onMove(page - 1); };
  r.onclick = () => { sfx("page"); onMove(page + 1); };
  return el;
}
// スワイプでもめくれるように
function swipe(el, onLeft, onRight) {
  let x0 = null;
  el.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
  el.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (dx < -40) onLeft(); else if (dx > 40) onRight();
  });
}

// 復習カード（1問ずつめくる）
function renderFlip(box, items, { title = "間違えた問題", empty = "" } = {}) {
  let i = 0;
  const draw = (anim) => {
    box.innerHTML = "";
    if (!items.length) { box.innerHTML = `<div class="card"><p class="card-empty">${esc(empty)}</p></div>`; return; }
    const w = items[i];
    box.insertAdjacentHTML("beforeend", `<div class="flip-head"><b>${esc(title)}</b><span>めくって復習</span></div>
      <div class="card${anim ? " turn" : ""}"><div class="cq">${esc(w.q)}</div><div class="ca">正解：<b>${esc(w.a)}</b></div>${w.yours ? `<div class="cy">あなたの答え：${esc(w.yours)}</div>` : ""}</div>`);
    box.appendChild(pager(i, items.length, (n) => { i = clamp(n, 0, items.length - 1); draw(true); }));
  };
  draw(false);
  swipe(box, () => { if (i < items.length - 1) { i++; sfx("page"); draw(true); } }, () => { if (i > 0) { i--; sfx("page"); draw(true); } });
}

// ================= シート（パネル） =================
let sheet = null;
function openSheet(def) {
  closeSheetNow();
  sheet = { ...def, tab: def.tab || (def.tabs && def.tabs[0].id) };
  $("sheet-title").textContent = def.title;
  $("sheet-wrap").classList.remove("hidden", "closing");
  renderSheet();
}
function renderSheet() {
  if (!sheet) return;
  const tabs = $("sheet-tabs");
  tabs.innerHTML = (sheet.tabs || []).map((t) => `<button type="button" class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === sheet.tab}">${esc(t.label)}${t.badge && t.badge() ? '<i class="badge"></i>' : ""}</button>`).join("");
  tabs.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { if (sheet.tab !== b.dataset.tab) { sfx("tap"); sheet.leave && sheet.leave(sheet.tab); sheet.tab = b.dataset.tab; sheet.page = 0; renderSheet(); } }));
  const body = $("sheet-body"), foot = $("sheet-foot");
  if (sheet.leave) sheet.leave(sheet.tab, true);
  body.innerHTML = ""; foot.innerHTML = "";
  sheet.render(sheet.tab, body, foot);
}
function closeSheetNow() {
  if (sheet && sheet.leave) sheet.leave(sheet.tab);
  if (sheet && sheet.onClose) sheet.onClose();
  sheet = null;
  $("sheet-wrap").classList.add("hidden");
  $("sheet-body").innerHTML = ""; $("sheet-foot").innerHTML = "";
}
function closeSheet() {
  if (!sheet) return;
  const w = $("sheet-wrap");
  w.classList.add("closing");
  const s = sheet;
  setTimeout(() => { if (sheet === s) { closeSheetNow(); renderHud(); } }, 190);
}
$("sheet-close").onclick = closeSheet;
$("sheet-wrap").addEventListener("click", (e) => { if (e.target.id === "sheet-wrap") closeSheet(); });

// ---------- 勉強デートの準備 ----------
function subjectList() {
  let list = (typeof SUBJECTS !== "undefined" && Array.isArray(SUBJECTS) && SUBJECTS.length) ? SUBJECTS.filter((s) => s && s.id) : FALLBACK_SUBJECTS;
  if (!list.length) list = FALLBACK_SUBJECTS;
  if (!list.some((s) => s.id === "custom")) list = [...list, { id: "custom", label: "自作問題" }];
  return list;
}
function subjectLabel(id) { const s = subjectList().find((x) => x.id === id); return s ? s.label || s.id : id; }

function openStudy() {
  openSheet({
    title: "勉強デート",
    render(_, body, foot) {
      body.innerHTML = `
        <div class="subhead">科目をえらぶ</div>
        <div class="subjects">${subjectList().map((s) => `<button type="button" data-s="${esc(s.id)}" aria-pressed="${s.id === study.subject}">${esc(s.label || s.id)}</button>`).join("")}</div>
        <p class="rule-line" id="rule-line"></p>
        <div class="date-plan">
          <div><div class="dp-k">次の合格で</div><div class="dp-v">${prog.stage >= MAX_STAGE ? "復習デート" : esc(layerLabel(prog.stage))}</div></div>
          <div class="dp-gain">合格で 好感度・経験値・コイン<br>正解ごとにも少しずつ</div>
        </div>
        <div class="spacer"></div>
        ${prog.review.length ? `<button type="button" class="btn rowbtn" id="btn-review">前回の間違いを見直す<span>${prog.review.length}問・1問ずつめくって確認</span></button>` : ""}`;
      const rule = () => ($("rule-line").textContent = `${subjectLabel(study.subject)}・${study.count}問・制限${study.time}秒・${study.pass}%以上で合格`);
      rule();
      body.querySelectorAll(".subjects button").forEach((b) => (b.onclick = () => {
        study.subject = b.dataset.s; save("study", study); sfx("tap");
        body.querySelectorAll(".subjects button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        rule();
        if (study.subject === "custom" && !String(study.custom).trim()) editCustom();
      }));
      const rv = $("btn-review");
      if (rv) rv.onclick = () => dialog(`<span class="plate">復習</span><h2>前回の間違い</h2><div class="flip" id="dlg-flip" style="height:220px"></div><div class="btns"><button class="btn primary" data-v="1" type="button">閉じる</button></div>`,
        (w) => renderFlip(w.querySelector("#dlg-flip"), prog.review, { title: "前回の間違い" }));
      foot.innerHTML = `<button class="btn primary" id="btn-start" type="button">デートに出かける</button>`;
      $("btn-start").onclick = () => startRound();
    },
  });
}
function editCustom() {
  return dialog(`<span class="plate">自作問題</span><h2>自作問題を編集</h2>
    <p class="note">1行に1問。問題,正解,誤答1,誤答2,誤答3（誤答は省略可）。4問以上必要です。</p>
    <textarea id="dlg-custom" placeholder="ROIの意味は？,投資利益率,売上総利益,自己資本比率"></textarea>
    <div class="btns"><button class="btn" data-v="" type="button">キャンセル</button><button class="btn primary" id="dlg-save" type="button">保存</button></div>`,
    (w, close) => {
      w.classList.add("custom-win");
      const ta = w.querySelector("#dlg-custom"); ta.value = study.custom || "";
      w.querySelector("#dlg-save").onclick = () => { study.custom = ta.value; save("study", study); close(true); };
    });
}

// ================= 勉強デート（クイズ） =================
let quiz = null;
function stopQuiz() {
  if (!quiz) return;
  const cur = quiz;
  cur.done = true; clearInterval(cur.timer); quiz = null;
  addDaily({ ms: Date.now() - cur.startedAt }); // 中断しても学習時間は記録
}
function startRound() {
  const qs = buildQuestions(study.subject, study.count, study.custom);
  if (!qs || !qs.length) { alertBox("自作問題が4問以上必要です（勉強デートの科目「自作問題」から入力できます）"); return; }
  closeSheetNow();
  if (quiz) { clearInterval(quiz.timer); quiz = null; }
  transit(() => {
    setMode("quiz");
    setBg("library");
    drawStand(prog.stage, "normal");
    music("study");
    const intro = FX("roundStart", { stage: prog.stage, max: MAX_STAGE, label: prog.stage < MAX_STAGE ? layerLabel(prog.stage) : "" }) || 0;
    quiz = { qs, i: 0, score: 0, combo: 0, maxCombo: 0, wrong: [], away: 0, locked: false, hurried: false,
      startedAt: Date.now(), end: Date.now() + study.time * 1000 + intro };
    say("start", "bubble");
    renderQuestion();
    tick();
    quiz.timer = setInterval(tick, 250);
  }, "wipe");
}
function tick() {
  if (!quiz) return;
  const left = Math.max(0, (quiz.end - Date.now()) / 1000);
  $("q-time").textContent = `${Math.min(study.time, Math.ceil(left))}`;
  const pct = Math.min(100, (left / study.time) * 100);
  FX("tick", left, study.time);
  $("timebar-fill").style.width = pct + "%";
  $("timebar-fill").classList.toggle("low", pct < 25);
  if (!quiz.hurried && left <= 10 && left > 0 && study.time > 15) {
    quiz.hurried = true; music("study_hurry"); say("hurry", "bubble");
  }
  if (left <= 0) finishRound(true);
}
function fitQuestion() {
  const el = $("q-text");
  let size = window.innerHeight < 700 ? 17.5 : 20;
  el.style.fontSize = size + "px";
  while (el.scrollHeight > el.clientHeight + 1 && size > 12) { size -= 1; el.style.fontSize = size + "px"; }
}
function renderQuestion() {
  const q = quiz.qs[quiz.i];
  $("q-count").textContent = `${quiz.i + 1}/${quiz.qs.length}`;
  $("q-score").textContent = `正解 ${quiz.score}`;
  $("q-text").textContent = q.q;
  $("choices").innerHTML = "";
  q.choices.forEach((c, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="ch-n">${idx + 1}</span><span class="ch-t">${esc(c)}</span>`;
    b.setAttribute("aria-label", `${idx + 1}. ${c}`);
    b.dataset.choice = String(c);
    if (String(c) === String(q.a)) b.dataset.correct = "1";
    b.onclick = () => answer(b);
    $("choices").appendChild(b);
  });
  quiz.locked = false;
  fitQuestion();
  FX("nextQuestion");
}
function answer(btn) {
  const cur = quiz;
  if (!cur || cur.locked || cur.done) return;
  cur.locked = true;
  const q = cur.qs[cur.i];
  const ok = btn.dataset.correct === "1";
  cur.combo = ok ? cur.combo + 1 : 0;
  cur.maxCombo = Math.max(cur.maxCombo, cur.combo);
  FX("answer", { ok, combo: cur.combo });
  if (ok) {
    cur.score++; btn.classList.add("correct");
    say(cur.combo === 3 || cur.combo === 6 ? "combo" : "correct", "bubble");
    react("hop");
  } else {
    btn.classList.add("wrong");
    const right = $("choices").querySelector('[data-correct="1"]');
    if (right) right.classList.add("correct");
    cur.wrong.push({ q: q.q, a: q.a, yours: btn.dataset.choice });
    say("wrong", "bubble");
    react("droop");
  }
  $("q-score").textContent = `正解 ${cur.score}`;
  setTimeout(() => {
    if (quiz !== cur || cur.done) return;
    cur.i++;
    if (cur.i >= cur.qs.length) finishRound(false);
    else { setExpr("normal"); renderQuestion(); }
  }, ok ? 650 : 1150);
}

// ---------- 学習記録 ----------
function addDaily({ rounds = 0, correct = 0, answered = 0, ms = 0 }) {
  const k = dayKey();
  const d = daily[k] || { rounds: 0, correct: 0, answered: 0, ms: 0 };
  d.rounds += rounds; d.correct += correct; d.answered += answered; d.ms += ms;
  daily[k] = d;
  const cutoff = dayKey(new Date(Date.now() - DAILY_KEEP_DAYS * 864e5));
  Object.keys(daily).forEach((key) => { if (key < cutoff) delete daily[key]; });
  save("daily", daily);
}
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`;
}
function sessionCount() { return Date.now() - session.lastEnd > SESSION_GAP_MS ? 0 : session.count; }

// ---------- 結果 ----------
function finishRound(timeUp) {
  const cur = quiz;
  if (!cur || cur.done) return;
  cur.done = true;
  clearInterval(cur.timer);
  quiz = null;

  const total = cur.qs.length;
  const answeredCount = Math.min(total, cur.i + (cur.locked ? 1 : 0));
  const timedOut = timeUp && answeredCount < total;
  const pct = Math.round((cur.score / total) * 100);
  const passed = pct >= study.pass;
  const rank = pct >= 100 ? "S" : pct >= 80 ? "A" : pct >= 60 ? "B" : "C";

  prog.rounds++; prog.correct += cur.score; prog.answered += total;
  prog.review = cur.wrong.slice(0, 20);
  const prevStage = prog.stage;
  if (passed) {
    prog.passes++; prog.streak++;
    if (prog.stage < MAX_STAGE) prog.stage++;
  } else {
    prog.streak = 0;
    if (study.penalty && prog.stage > 0) prog.stage--;
  }
  save("progress", prog);

  // ごほうび（好感度・経験値・コイン）
  const gain = {
    aff: (passed ? 15 : 4) + cur.score + (rank === "S" ? 8 : rank === "A" ? 4 : 0) + (cur.maxCombo >= 5 ? 3 : 0),
    exp: cur.score * 10 + (passed ? 30 : 0),
    coins: cur.score * 2 + (passed ? 20 : 0) + (rank === "S" ? 20 : rank === "A" ? 10 : 0),
  };
  const lvBefore = expInfo().lv;
  game.aff += gain.aff; game.exp += gain.exp; game.coins += gain.coins;
  game.maxStage = Math.max(game.maxStage, prog.stage);
  bumpStreak();
  const m = missionsToday();
  m.pass += passed ? 1 : 0; m.correct += cur.score; m.combo = Math.max(m.combo, cur.maxCombo);
  saveGame();

  const now = Date.now();
  addDaily({ rounds: 1, correct: cur.score, answered: total, ms: now - cur.startedAt });
  session = { count: sessionCount() + 1, lastEnd: now };
  save("session", session);

  // 画面
  setMode("result");
  music(passed ? "result_win" : "result_lose");
  drawStand(prevStage, passed ? "happy" : "sad");
  if (passed && v3d) v3d.react("pass");
  $("r-title").textContent = passed ? "合格！" : timedOut ? "時間切れ…" : "不合格";
  $("r-score").textContent = `${cur.score} / ${total}（${pct}%）`;
  $("r-detail").textContent = `合格ライン ${study.pass}%` + (cur.away ? `・よそ見 ${cur.away}回` : "") +
    (!passed && study.penalty && prevStage > 0 ? "・衣装が1段階戻りました" : "") +
    (session.count % POMODORO_ROUNDS === 0 ? `・${session.count}ラウンド連続！少し休憩を` : "") +
    (expInfo().lv > lvBefore ? `・学習Lv.${expInfo().lv}に上がった` : "");
  $("r-rewards").innerHTML = `
    <div class="rw"><span class="k">${icon("i-heart", "heart")}好感度</span><b>+${gain.aff}</b></div>
    <div class="rw"><span class="k">経験値</span><b>+${gain.exp}</b></div>
    <div class="rw"><span class="k">${icon("i-coin", "coin")}コイン</span><b>+${gain.coins}</b></div>`;
  renderFlip($("r-wrong"), cur.wrong, { empty: timedOut ? "時間内に解き終わりませんでした。" : "全問正解！復習する問題はありません。" });
  const reveal = FX("result", { passed, pct, timedOut }) || 300;

  const stageUp = passed && prog.stage > prevStage;
  if (!stageUp) {
    if (rank === "S") say("perfect", "bubble"); else if (passed) say("pass", "bubble"); else say(timedOut ? "timeup" : "fail", "bubble");
  } else say("pass", "bubble");

  // 演出の続き（画面が変わったら打ち切る。レベルアップはホームでも拾う）
  const my = flowId;
  (async () => {
    await sleep(reveal + 500);
    if (my !== flowId) return;
    if (stageUp) {
      await showCostume(prog.stage);
      if (my !== flowId) return;
      if (prog.stage >= MAX_STAGE && prevStage < MAX_STAGE) say("complete", "bubble");
    } else if (prog.stage !== prevStage) {
      drawStand(prog.stage, "sad", true);
    }
    if (my !== flowId) return;
    await checkLevelUp();
    renderHud();
  })();
}

// よそ見検知：クイズ中にタブ移動／アプリがバックグラウンドへ行ったら −5秒
let lastAway = 0;
function onAway() {
  if (!quiz || !study.focus) return;
  const now = Date.now();
  if (now - lastAway < 1000) return; // visibilitychange と appbackground の二重計上を防ぐ
  lastAway = now;
  quiz.away++;
  quiz.end -= 5000;
  $("focus-warn").classList.remove("hidden");
  setTimeout(() => $("focus-warn").classList.add("hidden"), 2500);
  say("away", "bubble");
  FX("away");
  if (v3d) v3d.react("away");
}
document.addEventListener("visibilitychange", () => { if (document.hidden) onAway(); });
window.addEventListener("appbackground", onAway); // iOS（WKWebView）側から送られる

document.addEventListener("keydown", (e) => {
  if (!quiz || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  const b = n >= 1 ? $("choices").children[n - 1] : null;
  if (b) b.click();
});

$("btn-quit").onclick = async () => { if (await confirmBox("勉強デートを中断してホームへ戻りますか？", "中断する")) goHome(); };
$("btn-again").onclick = (e) => { e.stopPropagation(); fsClose(); startRound(); };
$("btn-home").onclick = (e) => { e.stopPropagation(); fsClose(); goHome(); };

// ================= 会話イベント（ビジュアルノベル） =================
let ep = null;
function playEpisode(def, { replay = false } = {}) {
  if (!def) return;
  closeSheetNow();
  stopQuiz();
  transit(() => {
    setMode("ep");
    setBg(def.bg || "room_evening");
    drawStand(clamp(def.outfit | 0, 0, MAX_STAGE - 1), "normal");
    music("event");
    $("ep-title").textContent = def.title;
    $("ep-choices").classList.add("hidden");
    ep = { def, i: -1, replay, auto: false, skip: false, typer: null, waitChoice: false, timer: null, aff: 0 };
    $("ep-auto").setAttribute("aria-pressed", "false");
    epNext();
  }, "fade");
}
function epText(s) { return String(s || "").split("{name}").join(chara.name); }
function epNext() {
  if (!ep) return;
  clearTimeout(ep.timer);
  ep.i++;
  const st = ep.def.steps[ep.i];
  if (!st) { epEnd(); return; }
  const win = $("ep-win");
  if (st.choice) { epChoice(st.choice); return; }
  if (st.narration != null) {
    win.classList.add("narr"); $("ep-name").textContent = "";
    stopVoice();
    ep.typer = FX("type", $("ep-msg"), epText(st.narration), { onDone: epAfterLine });
  } else if (st.lineId) {
    win.classList.remove("narr"); $("ep-name").textContent = chara.name;
    const id = SCRIPT.resolve(chara.personality, st.lineId);
    if (ep.skip) { const L = SCRIPT.lines[id]; if (L) setExpr(L.expr); ep.typer = FX("type", $("ep-msg"), L ? L.text : "", { onDone: epAfterLine }); }
    else ep.typer = showLine(id, "ep");
    if (ep.typer && !ep.skip) { const t = ep.typer; const iv = setInterval(() => { if (t.done) { clearInterval(iv); epAfterLine(); } }, 80); }
  } else { epNext(); return; }
  if (ep.skip && ep.typer) ep.typer.skip();
}
function epAfterLine() {
  if (!ep || ep.afterGuard === ep.i) return;
  ep.afterGuard = ep.i;
  if (ep.skip) { ep.timer = setTimeout(epNext, 70); return; }
  if (ep.auto) {
    const i = ep.i;
    Promise.race([voiceDone, sleep(15000)]).then(() => {
      if (ep && ep.auto && ep.i === i && !ep.waitChoice) ep.timer = setTimeout(() => { if (ep && ep.i === i) epNext(); }, 1100);
    });
  }
}
function epChoice(opts) {
  ep.waitChoice = true;
  ep.skip = false;
  const box = $("ep-choices");
  box.innerHTML = opts.map((o, i) => `<button type="button" data-i="${i}">${esc(epText(o.text))}</button>`).join("");
  box.classList.remove("hidden");
  box.querySelectorAll("button").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const o = opts[+b.dataset.i];
    box.classList.add("hidden"); box.innerHTML = "";
    ep.waitChoice = false;
    if (!ep.replay && o.aff) { addAff(o.aff); ep.aff += o.aff; }
    if (o.aff >= 3) { const r = b.getBoundingClientRect(); FX("hearts", r.left + r.width / 2, r.top, 5); sfx("heart"); }
    if (o.reply) {
      $("ep-win").classList.remove("narr"); $("ep-name").textContent = chara.name;
      const id = SCRIPT.resolve(chara.personality, o.reply);
      const t = showLine(id, "ep");
      ep.afterGuard = null;
      if (t) { const iv = setInterval(() => { if (t.done) { clearInterval(iv); epAfterLine(); } }, 80); }
    } else epNext();
  }));
}
function epTap() {
  if (!ep || ep.waitChoice) return;
  if (ep.skip) return;
  if (ep.typer && !ep.typer.done) { ep.typer.skip(); return; }
  sfx("tap");
  epNext();
}
async function epEnd(aborted = false) {
  if (!ep) return;
  const e = ep; ep = null;
  clearTimeout(e.timer); stopVoice();
  if (!aborted && !e.replay && !game.seen.includes(e.def.id)) {
    game.seen.push(e.def.id); game.coins += EP_FIRST_REWARD; saveGame();
    toast(`「${e.def.title}」を見た　コイン +${EP_FIRST_REWARD}${e.aff ? `　好感度 +${e.aff}` : ""}`);
  }
  if (e.replay && !aborted) { goHome(); setTimeout(() => openAlbum("ep"), 700); return; }
  goHome();
}
$("ep").addEventListener("click", (e) => { if (e.target.closest(".ep-bar") || e.target.closest("#ep-choices")) return; epTap(); });
$("ep-auto").onclick = () => {
  if (!ep) return;
  ep.auto = !ep.auto; ep.skip = false;
  $("ep-auto").setAttribute("aria-pressed", String(ep.auto));
  if (ep.auto && ep.typer && ep.typer.done && !ep.waitChoice) { ep.afterGuard = null; epAfterLine(); }
};
$("ep-skip").onclick = () => {
  if (!ep || ep.waitChoice) return;
  ep.skip = true; stopVoice();
  if (ep.typer && !ep.typer.done) ep.typer.skip();
  else epNext();
};
$("ep-close").onclick = async () => {
  if (!ep) return;
  const wasAuto = ep.auto; ep.auto = false;
  if (await confirmBox("会話イベントを終了しますか？（最後まで見ないと既読になりません）", "終了する")) epEnd(true);
  else if (ep) ep.auto = wasAuto;
};

// ================= おはなし（エピソード一覧・プレゼント） =================
function episodeRows(list, page, per, onPick, opts = {}) {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const slice = list.slice(page * per, page * per + per);
  return { pages, html: slice.map((e) => {
    const n = EPISODES.indexOf(e) + 1;
    const open = opts.all ? isUnlocked(e) : true;
    const seen = game.seen.includes(e.id);
    return open
      ? `<button type="button" class="row-item" data-ep="${e.id}"><span class="no">${String(n).padStart(2, "0")}</span><span class="tx"><span class="tt">${esc(e.title)}</span><span class="ts">${esc(e.summary || "")}</span></span>${seen ? '<span class="tag seen">既読</span>' : '<span class="tag">NEW</span>'}</button>`
      : `<div class="row-item locked"><span class="no">${String(n).padStart(2, "0")}</span><span class="tx"><span class="tt">？？？</span><span class="ts">${esc(unlockText(e))}</span></span>${icon("i-lock")}</div>`;
  }).join("") };
}
function openTalk(tab = "ep") {
  openSheet({
    title: "おはなし", tab, page: 0,
    tabs: [{ id: "ep", label: "会話イベント", badge: () => unlockedEpisodes().some((e) => !game.seen.includes(e.id)) }, { id: "gift", label: "プレゼント" }],
    render(t, body) {
      if (t === "ep") {
        const per = window.innerHeight < 700 ? 4 : 5;
        const draw = () => {
          const { pages, html } = episodeRows(EPISODES, sheet.page || 0, per, null, { all: true });
          body.innerHTML = `<p class="note" style="margin-bottom:10px">勉強して仲良くなると、新しい会話イベントが解放されます。</p><div class="rows">${html}</div>`;
          body.appendChild(pager(sheet.page || 0, pages, (n) => { sheet.page = clamp(n, 0, pages - 1); draw(); }));
          body.querySelectorAll("[data-ep]").forEach((b) => (b.onclick = () => playEpisode(EPISODES.find((e) => e.id === b.dataset.ep), { replay: game.seen.includes(b.dataset.ep) })));
        };
        draw();
      } else {
        const g = giftsToday();
        body.innerHTML = `<div class="wallet"><span>今日あと${Math.max(0, GIFT_PER_DAY - g.n)}回 贈れます</span><b>${icon("i-coin", "coin")}${game.coins}</b></div>
          <div class="rows">${GIFTS.map((x, i) => `<button type="button" class="row-item" data-g="${i}" ${game.coins < x.price || g.n >= GIFT_PER_DAY ? "disabled" : ""}>
            ${icon("i-gift", "gift-ic")}<span class="tx"><span class="tt">${esc(x.name)}</span><span class="ts">${esc(x.desc)}・好感度 +${x.aff}</span></span>
            <span class="price">${icon("i-coin", "coin")}${x.price}</span></button>`).join("")}</div>`;
        body.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => giveGift(+b.dataset.g)));
      }
    },
  });
}
function giveGift(i) {
  const x = GIFTS[i], g = giftsToday();
  if (!x || game.coins < x.price || g.n >= GIFT_PER_DAY) return;
  game.coins -= x.price; g.n++; g.total = (g.total | 0) + 1;
  addAff(x.aff);
  closeSheetNow();
  if (current !== "home") enterHome();
  renderHud(true);
  sfx("coin");
  showLine(`${chara.personality}.gift.${i + 1}`, "home");
  react("hop");
  const r = $("stand").getBoundingClientRect();
  FX("hearts", r.left + r.width / 2, r.top + r.height * 0.3, 7); sfx("heart");
  toast(`${x.name}を贈った　好感度 +${x.aff}`);
  setTimeout(() => checkLevelUp(), 1600);
}

// ================= アルバム =================
function thumbArt(s, e) {
  const src = srcFor(s, e);
  if (src) return `<img alt="" src="${src}" draggable="false">`;
  return `<svg class="art" viewBox="45 4 210 280" data-s="${s}" data-e="${e}" aria-hidden="true"></svg>`;
}
function fillSvgs(root) { root.querySelectorAll("svg.art[data-s]").forEach((svg) => renderCharacter(svg, chara, +svg.dataset.s, svg.dataset.e)); }
function artUnlocked(s, e) { return s <= game.maxStage && (e === "normal" || game.album.includes(`${s}_${e}`)); }
function openAlbum(tab = "ep") {
  openSheet({
    title: "アルバム", tab, page: 0,
    tabs: [{ id: "ep", label: "思い出" }, { id: "art", label: "立ち絵" }],
    render(t, body) {
      if (t === "ep") {
        const per = window.innerHeight < 700 ? 4 : 5;
        const draw = () => {
          const seen = EPISODES.filter((e) => game.seen.includes(e.id));
          const { pages, html } = episodeRows(seen, sheet.page || 0, per);
          body.innerHTML = `<p class="note" style="margin-bottom:10px">見た会話イベントをもう一度再生できます（${seen.length} / ${EPISODES.length}）。</p>
            <div class="rows">${html || '<div class="card"><p class="card-empty">まだ思い出がありません。<br>「おはなし」から会話イベントを見てみよう。</p></div>'}</div>`;
          body.appendChild(pager(sheet.page || 0, pages, (n) => { sheet.page = clamp(n, 0, pages - 1); draw(); }));
          body.querySelectorAll("[data-ep]").forEach((b) => (b.onclick = () => playEpisode(EPISODES.find((e) => e.id === b.dataset.ep), { replay: true })));
        };
        draw();
      } else {
        const draw = () => {
          const s = clamp(sheet.page || 0, 0, MAX_STAGE);
          const reached = s <= game.maxStage;
          body.innerHTML = `<div class="stage-title"><b>STAGE ${s + 1}　${esc(outfitName(s))}</b><span>${reached ? "表情差分はコインで解放" : `衣装段階 ${s + 1} で解放`}</span></div>
            <div class="gallery">${EXPRS.map(([e, label]) => {
              const ok = artUnlocked(s, e);
              return `<button type="button" class="thumb${ok ? "" : " locked"}" data-e="${e}" aria-label="${esc(label)}${ok ? "" : "（未解放）"}">${thumbArt(s, e)}
                ${ok ? "" : `<span class="lk">${icon("i-lock")}${reached ? `<span class="price">${icon("i-coin")}${ALBUM_PRICE}</span>` : "未解放"}</span>`}
                <span class="cap">${esc(label)}</span></button>`;
            }).join("")}<div class="thumb" style="display:grid;place-items:center;font-size:11px;color:var(--color-ink-2);text-align:center;padding:6px">所持コイン<br><b class="num" style="font-size:22px;color:var(--color-ink)">${game.coins}</b></div></div>`;
          fillSvgs(body);
          body.appendChild(pager(s, MAX_STAGE + 1, (n) => { sheet.page = clamp(n, 0, MAX_STAGE); draw(); }));
          body.querySelectorAll(".thumb[data-e]").forEach((b) => (b.onclick = async () => {
            const e = b.dataset.e;
            if (artUnlocked(s, e)) { viewArt(s, e); return; }
            if (!reached) { toast(`衣装段階 ${s + 1} に進むと解放できます`); return; }
            if (game.coins < ALBUM_PRICE) { toast("コインが足りません"); return; }
            if (await confirmBox(`コイン${ALBUM_PRICE}枚で「${EXPRS.find((x) => x[0] === e)[1]}」を解放しますか？`, "解放する")) {
              game.coins -= ALBUM_PRICE; game.album.push(`${s}_${e}`); saveGame(); sfx("coin"); draw(); renderHud();
            }
          }));
        };
        draw();
      }
    },
  });
}
function viewArt(s, e) {
  const fs = fsOpen("viewer", `<div class="kicker">STAGE ${s + 1}・${esc(EXPRS.find((x) => x[0] === e)[1])}</div>
    <div class="viewer-art">${srcFor(s, e) ? `<img alt="" src="${srcFor(s, e)}">` : `<svg viewBox="0 0 300 600" aria-hidden="true"></svg>`}</div>
    <div class="btns"><button class="btn primary" type="button" id="fs-ok">閉じる</button></div>`);
  const svg = fs.querySelector(".viewer-art svg"); if (svg) renderCharacter(svg, chara, s, e);
  fs.querySelector("#fs-ok").onclick = fsClose;
}

// ================= ミッション・記録 =================
function openMissions(tab = "daily") {
  openSheet({
    title: "ミッション", tab,
    tabs: [{ id: "daily", label: "デイリー", badge: missionClaimable }, { id: "log", label: "学習記録" }],
    render(t, body) {
      if (t === "daily") {
        const m = missionsToday();
        const allClaimed = MISSIONS.every((d) => m.claimed.includes(d.id));
        body.innerHTML = `<p class="note" style="margin-bottom:10px">毎日0時に更新。達成したら受け取ろう。</p><div class="rows">${MISSIONS.map((d) => {
          const v = Math.min(d.target, m[d.id] | 0), done = v >= d.target, got = m.claimed.includes(d.id);
          return `<div class="mission${done ? " done" : ""}"><span class="mt">${esc(d.label)}</span>
            ${got ? '<span class="claimed">受取済</span>' : `<button class="btn ${done ? "accent" : ""}" type="button" data-m="${d.id}" ${done ? "" : "disabled"}>${icon("i-coin", "coin")}${d.reward}</button>`}
            <span class="mg"><span class="bar"><i style="width:${(v / d.target) * 100}%"></i></span>${v} / ${d.target}</span></div>`;
        }).join("")}
          <div class="mission${allClaimed ? " done" : ""}"><span class="mt">ぜんぶ達成ボーナス</span>
            ${m.bonus ? '<span class="claimed">受取済</span>' : `<button class="btn ${allClaimed ? "accent" : ""}" type="button" data-m="bonus" ${allClaimed ? "" : "disabled"}>${icon("i-coin", "coin")}${MISSION_BONUS}</button>`}
            <span class="mg">デイリー3つを受け取る</span></div></div>`;
        body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => {
          const id = b.dataset.m;
          if (id === "bonus") { m.bonus = true; game.coins += MISSION_BONUS; }
          else { const d = MISSIONS.find((x) => x.id === id); if (!d || m.claimed.includes(id)) return; m.claimed.push(id); game.coins += d.reward; }
          saveGame(); sfx("coin"); FX("haptic", "success");
          const r = b.getBoundingClientRect(); FX("hearts", r.left + r.width / 2, r.top, 3);
          renderHud(); renderSheet();
          say("mission");
        }));
      } else {
        const td = daily[dayKey()] || { rounds: 0, correct: 0, answered: 0, ms: 0 };
        const n = sessionCount();
        const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5));
        const rows = days.map((d) => ({ d, r: daily[dayKey(d)] || { rounds: 0, correct: 0, answered: 0 } }));
        const max = Math.max(1, ...rows.map((x) => x.r.rounds));
        const wd = "日月火水木金土";
        body.innerHTML = `
          <div class="subhead">通算</div>
          <div class="ledger"><div><span>挑戦</span><b>${prog.rounds}</b></div><div><span>合格</span><b>${prog.passes}</b></div>
            <div><span>正答率</span><b>${prog.answered ? Math.round((prog.correct / prog.answered) * 100) + "%" : "-"}</b></div><div><span>連続合格</span><b>${prog.streak}</b></div></div>
          <div class="subhead">今日</div>
          <div class="ledger three"><div><span>連続ラウンド</span><b>${n}</b></div><div><span>学習時間</span><b>${fmtDur(td.ms)}</b></div>
            <div><span>正答率</span><b>${td.answered ? Math.round((td.correct / td.answered) * 100) + "%" : "-"}</b></div></div>
          <p class="hint">${n === 0 ? `${POMODORO_ROUNDS}ラウンドごとに5分休憩するのがおすすめです。` : n % POMODORO_ROUNDS === 0 ? `${n}ラウンド連続！ここで5分ほど休憩しましょう。` : `あと${POMODORO_ROUNDS - (n % POMODORO_ROUNDS)}ラウンドで小休憩。`}</p>
          <div class="subhead">直近7日の挑戦数</div>
          <div class="week">${rows.map(({ d, r }, i) => `<div class="day${i === 6 ? " today" : ""}">
            <span class="n">${r.rounds || ""}</span><div class="bar"><i style="height:${(r.rounds / max) * 100}%"></i></div>
            <span>${r.answered ? Math.round((r.correct / r.answered) * 100) + "%" : "&nbsp;"}</span><span class="wd">${i === 6 ? "今日" : wd[d.getDay()]}</span></div>`).join("")}</div>`;
      }
    },
  });
}

// ================= 設定 =================
const CHARA_FIELDS = ["name", "age", "personality", "hairStyle", "hair", "eye", "skin", "accent", "accent2", "blazer", "coat", "beret", "swim"];
function fillSettingsForm() {
  $("s-subject").innerHTML = subjectList().map((s) => `<option value="${esc(s.id)}">${esc(s.label || s.id)}</option>`).join("");
  $("s-subject").value = study.subject; $("s-count").value = study.count; $("s-time").value = study.time;
  $("s-pass").value = study.pass; $("s-penalty").checked = study.penalty; $("s-focus").checked = study.focus;
  CHARA_FIELDS.forEach((f) => ($("c-" + f).value = chara[f]));
  $("c-glasses").checked = !!chara.glasses;
  $("v-view").value = viewMode();
  ["bgm", "voice", "sfx"].forEach((k) => {
    $("a-" + k).value = Math.round(audio[k] * 100); $("a-" + k + "On").checked = audio[k + "On"];
    $("a-" + k).style.setProperty("--v", $("a-" + k).value + "%");
  });
  $("fx-haptic").checked = window.GameFX ? window.GameFX.hapticOn : true;
}
function readCharaForm() {
  const c = { ...chara };
  CHARA_FIELDS.forEach((f) => (c[f] = $("c-" + f).value));
  c.name = String(c.name || "").trim() || DEFAULTS.chara.name;
  c.age = clamp(parseInt(c.age, 10) || 20, 20, 60);
  c.glasses = $("c-glasses").checked;
  return c;
}
function saveSettings() {
  study = {
    ...study,
    subject: $("s-subject").value, count: +$("s-count").value || 5,
    time: clamp(+$("s-time").value || 60, 15, 600), pass: clamp(+$("s-pass").value || 80, 10, 100),
    penalty: $("s-penalty").checked, focus: $("s-focus").checked,
  };
  const prevP = chara.personality;
  chara = readCharaForm();
  save("study", study); save("chara", chara);
  if ($("v-view").value !== viewMode()) setViewMode($("v-view").value); else if (v3d) v3d.setColors(chara);
  return prevP !== chara.personality;
}
function previewChara() { renderCharacter($("c-preview"), readCharaForm(), 0, "happy"); }
function openSettings(tab = "study") {
  fillSettingsForm();
  const src = $("settings-src");
  let charaPage = 0;
  openSheet({
    title: "設定", tab,
    tabs: [{ id: "study", label: "学習" }, { id: "chara", label: "キャラ" }, { id: "sound", label: "サウンド" }, { id: "other", label: "その他" }],
    leave(t) { const p = $("sheet-body").querySelector(".tabpage"); if (p) src.appendChild(p); },
    render(t, body, foot) {
      const page = src.querySelector(`.tabpage[data-tab="${t}"]`);
      if (page) body.appendChild(page);
      if (t === "chara") {
        const draw = () => {
          page.querySelectorAll(".pager-page").forEach((p) => p.classList.toggle("hidden", +p.dataset.page !== charaPage));
          page.querySelectorAll(".pager").forEach((p) => p.remove());
          page.appendChild(pager(charaPage, 2, (n) => { charaPage = clamp(n, 0, 1); draw(); }));
          if (charaPage === 1) previewChara();
        };
        draw();
      }
      foot.innerHTML = `<button class="btn primary" id="btn-save" type="button">保存して閉じる</button>`;
      $("btn-save").onclick = () => {
        const changed = saveSettings();
        closeSheet();
        drawStand(prog.stage, stand.expr); renderHud();
        if (changed && current === "home") say("greet_" + timeSlot());
      };
    },
  });
}
document.querySelectorAll("[id^=c-]").forEach((el) => el.addEventListener("input", () => { if (!$("c-preview").closest(".hidden")) previewChara(); }));
["bgm", "voice", "sfx"].forEach((k) => {
  $("a-" + k).addEventListener("input", (e) => {
    audio[k] = clamp(+e.target.value / 100, 0, 1); e.target.style.setProperty("--v", e.target.value + "%");
    saveAudio(); applyAudio();
  });
  $("a-" + k + "On").addEventListener("change", (e) => {
    audio[k + "On"] = e.target.checked; saveAudio(); applyAudio();
    if (k === "sfx" && e.target.checked) sfx("tap");
    if (k === "bgm" && e.target.checked) { const t = curTrack; curTrack = null; music(t || "home"); }
  });
});
$("fx-haptic").addEventListener("change", (e) => FX("setHaptic", e.target.checked));
$("btn-custom").onclick = () => editCustom();
$("btn-defaults").onclick = async () => {
  if (!(await confirmBox("学習設定とキャラ設定を初期値に戻しますか？"))) return;
  study = { ...DEFAULTS.study }; chara = { ...DEFAULTS.chara };
  save("study", study); save("chara", chara);
  fillSettingsForm(); drawStand(prog.stage, stand.expr); if (v3d) v3d.setColors(chara); renderHud(); toast("初期値に戻しました");
};
$("btn-reset-stage").onclick = async () => {
  if (!(await confirmBox("衣装を最初の段階に戻しますか？（好感度・コイン・アルバムはそのまま）"))) return;
  prog.stage = 0; save("progress", prog); drawStand(0, "normal"); renderHud(); toast("衣装を最初に戻しました");
};
$("btn-reset-all").onclick = async () => {
  if (!(await confirmBox("進行・学習記録・アルバムをすべて消します。元に戻せません。よろしいですか？", "すべて消す"))) return;
  ["study", "chara", "progress", "daily", "session", "game", "fxHaptic"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  loadAll(); closeSheetNow(); goHome();
};
$("btn-credits").onclick = () => showCredits();

// クレジット（音声の提供元）: assets/voice/manifest.json の "credits" を表示する
function normCredits(c) {
  if (!c) return [];
  if (typeof c === "string") return [{ text: c }];
  if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? { text: x } : x)).filter(Boolean);
  if (typeof c === "object") return Object.entries(c).map(([k, v]) => (typeof v === "string" ? { name: k, text: v } : { name: k, ...v }));
  return [];
}
function loadCredits() {
  const V = window.GameVoice;
  const direct = V && (V.credits || (V.manifest && V.manifest.credits));
  if (direct) return Promise.resolve(normCredits(direct));
  return new Promise((res) => {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", "assets/voice/manifest.json");
      x.onload = () => { try { res(normCredits(JSON.parse(x.responseText).credits)); } catch { res(null); } };
      x.onerror = () => res(null);
      x.send();
    } catch { res(null); }
  });
}
// 3D 表示のモデルとライブラリ（CC0 のモデルは表記不要だが出典として載せる。MIT は著作権表示が必要）
const CREDITS_3D = [
  { name: "3Dモデル（3D表示）", text: "VRoid β Ver AvatarSample_4（ヴィクトリア・ルービン）© pixiv Inc. VRoidプロジェクト／CC0。衣装の分割・水着テクスチャ・小物の追加などの改変をしています。", url: "https://vroid.pixiv.help/hc/ja/articles/360014900233" },
  { name: "three.js / @pixiv/three-vrm", text: "three.js © three.js authors、@pixiv/three-vrm © pixiv Inc.（いずれも MIT License。全文は assets/lib/ に同梱）" },
];
async function showCredits() {
  const voiceList = await loadCredits();
  const list = [...(voiceList && voiceList.length ? voiceList : [{ text: "音声クレジット情報（assets/voice/manifest.json）を読み込めませんでした。音声ファイルを同梱すると、ここに提供元が表示されます。" }, { name: "ごほうび学習", text: "立ち絵の代替イラスト・効果音（WebAudio 合成）はアプリ内で作成" }]), ...CREDITS_3D];
  const per = 3;
  let page = 0;
  dialog(`<span class="plate">クレジット</span><h2>クレジット</h2><div class="credits" id="cr-box"></div><div id="cr-pg"></div>
    <div class="btns"><button class="btn primary" data-v="1" type="button">閉じる</button></div>`, (w) => {
    w.style.height = "min(100%, 520px)";
    const draw = () => {
      const box = w.querySelector("#cr-box");
      if (!list || !list.length) {
        box.innerHTML = `<div class="credit">音声クレジット情報（assets/voice/manifest.json）を読み込めませんでした。音声ファイルを同梱すると、ここに提供元が表示されます。</div>
          <div class="credit"><b>ごほうび学習</b><span class="cr-s">立ち絵の代替イラスト・効果音（WebAudio 合成）はアプリ内で作成</span></div>`;
        return;
      }
      box.innerHTML = list.slice(page * per, page * per + per).map((c) => {
        const head = c.name || c.character || c.voice || c.title || "";
        const body = c.text || c.credit || c.notice || c.license || c.role || "";
        const extra = [c.role && c.text ? c.role : "", c.url || ""].filter(Boolean).join(" ");
        return `<div class="credit">${head ? `<b>${esc(head)}</b><br>` : ""}${esc(body)}${extra ? `<span class="cr-s">${esc(extra)}</span>` : ""}</div>`;
      }).join("");
      const pg = w.querySelector("#cr-pg"); pg.innerHTML = "";
      const pages = Math.ceil(list.length / per);
      if (pages > 1) pg.appendChild(pager(page, pages, (n) => { page = clamp(n, 0, pages - 1); draw(); }));
    };
    draw();
  });
}

// ================= メニュー =================
$("m-study").onclick = () => { sfx("tap"); openStudy(); };
$("m-talk").onclick = () => { sfx("tap"); openTalk(); };
$("m-album").onclick = () => { sfx("tap"); openAlbum(); };
$("m-mission").onclick = () => { sfx("tap"); openMissions(); };
$("m-settings").onclick = () => { sfx("tap"); openSettings(); };

// ================= スクロール・バウンスの抑止 =================
document.addEventListener("touchmove", (e) => {
  if (e.target.closest && e.target.closest("textarea, input[type=range]")) return;
  e.preventDefault();
}, { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());
window.addEventListener("scroll", () => { if (window.scrollY) window.scrollTo(0, 0); });

// ================= 起動 =================
loadAll();
applyAudio();
preloadArt();
enterHome();
applyView();
setTimeout(homeEvents, 500);

// 時間帯が変わったら背景を更新（ホームにいるとき）
setInterval(() => { if (current === "home") { const b = roomBg(); if ($("bg").dataset.bg !== b) setBg(b); } }, 60000);
})();
