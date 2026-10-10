#!/usr/bin/env node
// キャラクターボイス生成（VOICEVOX ENGINE → WAV → m4a）
//
// 使い方（プロジェクトルートで）:
//   docker run --rm -d --name voicevox -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-arm64-latest
//   node tools/voice/gen.mjs                 # script.js の全セリフを差分生成
//   node tools/voice/gen.mjs --sample        # tools/voice/sample-lines.json を入力にする
//   node tools/voice/gen.mjs --only gentle.  # lineId の前方一致で絞る（複数可: --only a. --only b.）
//   node tools/voice/gen.mjs --force         # ハッシュを無視して全部作り直す
//   node tools/voice/gen.mjs --kana 簿記      # text に「簿記」を含む行の読み（AquesTalk風カナ）を表示するだけ
//   node tools/voice/gen.mjs --prune         # 入力に無くなった lineId の音声を削除
//   docker stop voicevox
//
// 出力: assets/voice/<lineId>.m4a, assets/voice/manifest.json, assets/voice/manifest.js
// 設定: tools/voice/config.json（性格ごとの話者スタイル・話速・ピッチ・抑揚、表情補正、辞書、置換表）

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(ROOT, "assets/voice");
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const ENGINE = (process.env.VOICEVOX_URL || CONFIG.engine).replace(/\/$/, "");
const PIPELINE_VERSION = 1; // 生成方法を変えたら上げる（全行が再生成される）

// ---------- 引数 ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const values = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
const OPT = {
  sample: flag("--sample"),
  force: flag("--force"),
  prune: flag("--prune"),
  only: values("--only"),
  kana: values("--kana"),
};

// ---------- 入力 ----------
function loadLines() {
  if (OPT.sample) {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, "sample-lines.json"), "utf8"));
    return { lines: j.lines, source: "tools/voice/sample-lines.json" };
  }
  const file = path.join(ROOT, "script.js");
  if (!fs.existsSync(file)) throw new Error("script.js がありません（--sample で検証用サンプルを使えます）");
  const ctx = { console, window: {}, document: undefined, localStorage: undefined };
  ctx.window = ctx;
  vm.createContext(ctx);
  // const SCRIPT はグローバルオブジェクトに載らないので、同じスクリプト内で取り出す
  vm.runInContext(
    fs.readFileSync(file, "utf8") +
      "\n;globalThis.__SCRIPT__ = (typeof SCRIPT !== 'undefined') ? SCRIPT : globalThis.SCRIPT;",
    ctx,
    { filename: "script.js" },
  );
  const S = ctx.__SCRIPT__;
  if (!S || !S.lines) throw new Error("script.js に SCRIPT.lines がありません");
  return { lines: S.lines, source: "script.js" };
}

// ---------- エンジン ----------
async function api(method, p, { query, body, raw } = {}) {
  const url = new URL(ENGINE + p);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text().catch(() => "")}`);
  if (raw) return Buffer.from(await res.arrayBuffer());
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function resolveStyles() {
  const speakers = await api("GET", "/speakers");
  const sp = speakers.find((s) => s.name === CONFIG.speaker);
  if (!sp) throw new Error(`話者「${CONFIG.speaker}」がエンジンにありません: ${speakers.map((s) => s.name).join(", ")}`);
  const byName = Object.fromEntries(sp.styles.map((s) => [s.name, s.id]));
  return (style) => {
    if (!(style in byName)) throw new Error(`${CONFIG.speaker} にスタイル「${style}」がありません（${Object.keys(byName).join(", ")}）`);
    return byName[style];
  };
}

async function installDictionary() {
  // 同じ表記の既存単語は消してから登録し直す（何度実行しても同じ状態になる）
  const cur = await api("GET", "/user_dict");
  const surfaces = new Set(CONFIG.dictionary.map((w) => toFullWidth(w.surface)));
  for (const [uuid, w] of Object.entries(cur || {})) {
    if (surfaces.has(w.surface)) await api("DELETE", `/user_dict_word/${uuid}`);
  }
  for (const w of CONFIG.dictionary) {
    await api("POST", "/user_dict_word", {
      query: { surface: w.surface, pronunciation: w.pronunciation, accent_type: w.accent ?? 0, word_type: "PROPER_NOUN", priority: 8 },
    });
  }
}
// エンジンは表記を全角で保存するので比較用に揃える
const toFullWidth = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

// ---------- パラメータ ----------
function paramsFor(lineId, line) {
  const personality = lineId.split(".")[0];
  const base = CONFIG.personalities[personality] || CONFIG.personalities.gentle;
  const ex = CONFIG.expr[line.expr || "normal"] || {};
  const p = { ...base };
  for (const k of ["speedScale", "intonationScale", "volumeScale"]) if (ex[k] != null) p[k] = round(p[k] * ex[k]);
  if (ex.pitchScale != null) p.pitchScale = round(p.pitchScale + ex.pitchScale);
  for (const k of ["prePhonemeLength", "postPhonemeLength", "style"]) if (ex[k] != null) p[k] = ex[k];
  return applyTone(p, CONFIG.tone);
}
// 全性格共通の声のトーン補正（config.json の "tone"。audition.mjs の候補と同じ形式）
export function applyTone(p, tone) {
  if (!tone) return p;
  const q = { ...p };
  if (tone.pitchAdd) q.pitchScale = round(q.pitchScale + tone.pitchAdd);
  if (tone.intonationMul) q.intonationScale = round(q.intonationScale * tone.intonationMul);
  if (tone.speedMul) q.speedScale = round(q.speedScale * tone.speedMul);
  if (tone.style) q.style = tone.style;
  return q;
}
const round = (x) => Math.round(x * 1000) / 1000;

function speechText(text) {
  let t = String(text);
  for (const r of CONFIG.replace || []) t = t.replace(new RegExp(r.from, "g"), r.to);
  return t.replace(/^[、。\s]+/, "").trim();
}

function hashOf(obj) {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

function wavDuration(buf) {
  // RIFF を走査して fmt / data チャンクから長さを出す
  let off = 12, rate = 24000, ch = 1, bits = 16, data = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { ch = buf.readUInt16LE(off + 10); rate = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (id === "data") { data = size; break; }
    off += 8 + size + (size & 1);
  }
  return Math.round((data / (rate * ch * (bits / 8))) * 1000) / 1000;
}

// ---------- メイン ----------
async function main() {
  const { lines, source } = loadLines();
  let ids = Object.keys(lines).filter((id) => lines[id] && typeof lines[id].text === "string" && lines[id].text.trim());
  if (OPT.only.length) ids = ids.filter((id) => OPT.only.some((p) => id.startsWith(p)));

  try {
    await api("GET", "/version");
  } catch (e) {
    throw new Error(`VOICEVOX ENGINE に接続できません (${ENGINE})。先に docker run してください。\n${e.message}`);
  }
  const engineVersion = await api("GET", "/version");
  const styleId = await resolveStyles();
  await installDictionary();

  // 読み確認モード
  if (OPT.kana.length) {
    for (const id of Object.keys(lines)) {
      const text = lines[id]?.text || "";
      if (!OPT.kana.some((k) => text.includes(k))) continue;
      const p = paramsFor(id, lines[id]);
      const q = await api("POST", "/audio_query", { query: { text: speechText(text), speaker: styleId(p.style) } });
      console.log(`${id}\n  text: ${text}\n  kana: ${q.kana}`);
    }
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, "manifest.json");
  let old = { lines: {} };
  try { old = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
  const outLines = { ...(old.lines || {}) };
  const dictKey = hashOf({ d: CONFIG.dictionary, r: CONFIG.replace });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-"));

  let made = 0, skipped = 0, failed = 0;
  for (const [i, id] of ids.entries()) {
    const line = lines[id];
    const p = paramsFor(id, line);
    const text = speechText(line.text);
    const file = `${id}.m4a`;
    const hash = hashOf({ v: PIPELINE_VERSION, speaker: CONFIG.speaker, text, p, dictKey });
    const dest = path.join(OUT, file);
    if (!OPT.force && old.lines?.[id]?.hash === hash && fs.existsSync(dest)) { skipped++; continue; }
    try {
      const sid = styleId(p.style);
      const q = await api("POST", "/audio_query", { query: { text, speaker: sid } });
      Object.assign(q, {
        speedScale: p.speedScale, pitchScale: p.pitchScale, intonationScale: p.intonationScale,
        volumeScale: p.volumeScale, prePhonemeLength: p.prePhonemeLength, postPhonemeLength: p.postPhonemeLength,
        outputSamplingRate: 24000, outputStereo: false,
      });
      const wav = await api("POST", "/synthesis", { query: { speaker: sid }, body: q, raw: true });
      const wavPath = path.join(tmp, "a.wav");
      fs.writeFileSync(wavPath, wav);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, dest]);
      outLines[id] = { file, hash, duration: wavDuration(wav) };
      made++;
      process.stdout.write(`[${i + 1}/${ids.length}] ${id} ${outLines[id].duration}s  ${line.text}\n`);
    } catch (e) {
      failed++;
      console.error(`× ${id}: ${e.message}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // 入力から消えた行
  const all = new Set(Object.keys(lines));
  for (const id of Object.keys(outLines)) {
    if (all.has(id) && fs.existsSync(path.join(OUT, outLines[id].file))) continue;
    if (!all.has(id) && !OPT.prune) continue; // 消すのは --prune のときだけ（manifest には残す）
    if (!all.has(id)) fs.rmSync(path.join(OUT, outLines[id].file), { force: true });
    delete outLines[id];
  }

  const sorted = Object.fromEntries(Object.keys(outLines).sort().map((k) => [k, outLines[k]]));
  const manifest = {
    version: hashOf(sorted),
    generatedAt: new Date().toISOString(),
    engine: `VOICEVOX ENGINE ${engineVersion}`,
    source,
    credits: CONFIG.credits,
    lines: sorted,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
  fs.writeFileSync(
    path.join(OUT, "manifest.js"),
    "// 自動生成（tools/voice/gen.mjs）。file:// でも読めるよう manifest.json と同じ内容をグローバルに置く\n" +
      "window.VOICE_MANIFEST = " + JSON.stringify(manifest) + ";\n",
  );
  console.log(`生成 ${made} / スキップ ${skipped} / 失敗 ${failed} / manifest ${Object.keys(sorted).length} 行 (${source})`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
export { CONFIG, api, resolveStyles, installDictionary, paramsFor, speechText, loadLines };
