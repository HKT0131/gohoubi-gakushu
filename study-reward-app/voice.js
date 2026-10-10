// キャラクターボイス再生
// 依存: assets/voice/manifest.js（window.VOICE_MANIFEST。tools/voice/gen.mjs が生成）。無ければ何も鳴らない。
// 公開グローバル: GameVoice = { unlock(), play(lineId) → Promise<boolean>, stop(), has(lineId),
//                              setEnabled(bool), isEnabled(), setVolume(0..1), getVolume(), preload(lineId), credits }
// 設定は localStorage "voiceOn"（"1"/"0"）と "voiceVol"（0..1）。
// 再生中は window.GameBGM?.duck(true)、終わったら duck(false)。
// 注意: iOS Safari / WKWebView では HTMLAudioElement.volume が無視される（端末の音量に従う）。
(() => {
  "use strict";
  const BASE = "assets/voice/";
  const manifest = () => (window.VOICE_MANIFEST && window.VOICE_MANIFEST.lines) || {};

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  let enabled = store.get("voiceOn") !== "0";
  let volume = (() => { const v = parseFloat(store.get("voiceVol")); return Number.isFinite(v) ? clamp(v) : 0.9; })();
  function clamp(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }

  // 1 つの要素を使い回す（iOS はユーザー操作で一度再生した要素なら以後も鳴らせる）
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");

  let current = null; // { id, resolve, done }
  let unlocked = false;

  function duck(on) {
    try { window.GameBGM && typeof window.GameBGM.duck === "function" && window.GameBGM.duck(on); } catch {}
  }

  function finish(result) {
    const c = current;
    if (!c) return;
    current = null;
    audio.onended = audio.onerror = null;
    duck(false);
    c.resolve(result);
  }

  // 無音の短い WAV（unlock 用）
  const SILENT = (() => {
    const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    s(0, "RIFF"); v.setUint32(4, 36 + n, true); s(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, "data"); v.setUint32(40, n, true);
    b.fill(128, 44);
    let bin = ""; b.forEach((x) => (bin += String.fromCharCode(x)));
    return "data:audio/wav;base64," + btoa(bin);
  })();

  const GameVoice = {
    /** ユーザー操作（tap/click）のハンドラ内で一度呼ぶ。iOS の自動再生制限を解除する */
    unlock() {
      if (unlocked || current) return;
      unlocked = true;
      try {
        audio.muted = true;
        audio.src = SILENT;
        const p = audio.play();
        const reset = () => { audio.pause(); audio.muted = false; };
        if (p && p.then) p.then(reset, () => { audio.muted = false; unlocked = false; });
        else reset();
      } catch { audio.muted = false; unlocked = false; }
    },

    has(lineId) { return !!manifest()[lineId]; },

    /** 再生。終わったら true、鳴らさなかった/止められた/失敗したら false で resolve（reject はしない） */
    play(lineId) {
      GameVoice.stop();
      const entry = manifest()[lineId];
      if (!enabled || !entry || volume <= 0) return Promise.resolve(false);
      return new Promise((resolve) => {
        const token = (current = { id: lineId, resolve });
        audio.muted = false;
        audio.volume = volume;
        audio.onended = () => { if (current === token) finish(true); };
        audio.onerror = () => { if (current === token) finish(false); };
        audio.src = BASE + entry.file;
        duck(true);
        let p;
        try { p = audio.play(); } catch { finish(false); return; }
        if (p && p.catch) p.catch(() => { if (current === token) finish(false); });
      });
    },

    stop() {
      if (!current) return;
      try { audio.pause(); } catch {}
      finish(false);
    },

    preload(lineId) {
      const e = manifest()[lineId];
      if (!e || current) return;
      try { const a = new Audio(); a.preload = "auto"; a.src = BASE + e.file; } catch {}
    },

    setEnabled(on) {
      enabled = !!on;
      store.set("voiceOn", enabled ? "1" : "0");
      if (!enabled) GameVoice.stop();
    },
    isEnabled() { return enabled; },

    setVolume(v) {
      volume = clamp(v);
      store.set("voiceVol", String(volume));
      audio.volume = volume;
    },
    getVolume() { return volume; },

    /** クレジット表記（設定画面などに表示する） */
    get credits() { return (window.VOICE_MANIFEST && window.VOICE_MANIFEST.credits) || []; },
  };

  window.GameVoice = GameVoice;
})();
