#!/usr/bin/env node
// アセット検証スクリプト（Node 標準ライブラリのみ）
//
//   node tools/check_assets.mjs            … study-reward-app/assets を検証
//   node tools/check_assets.mjs <appDir>   … 別のフォルダを検証
//   node tools/check_assets.mjs --strict   … 必須ファイル不足・エラーがあれば終了コード 1
//
// 調べること:
//   - ファイル名が仕様どおりか（assets/chara/stage{0-4}_{expr}.png, assets/bg/{name}.jpg）
//   - PNG / JPEG の実サイズ、縦横比のズレ、中身と拡張子の一致
//   - 立ち絵に透過（アルファ）があるか、実際に透明な画素があるか
//   - 立ち絵の人物の位置（頭頂・足元・頭の左右中心）が段階間でズレていないか
//   - 透過のフチが白っぽくないか（目安）
//   - 全立ち絵が同じキャンバスサイズか
//   - 必須5枚・推奨25枚・背景5枚のうち足りないもの
//   - 1枚 2MB 超の警告、合計容量（iOS バンドルの目安）

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- 仕様
const STAGES = [0, 1, 2, 3, 4];
const EXPRS = ["normal", "happy", "shy", "sad", "pout"];
const BGS = ["room_morning", "room_evening", "room_night", "library", "cafe"];
const CHARA_RE = /^stage([0-4])_(normal|happy|shy|sad|pout)\.png$/;
const BG_RE = /^(room_morning|room_evening|room_night|library|cafe)\.jpe?g$/;

const CHARA_W = 1024, CHARA_H = 2048, CHARA_RATIO = CHARA_W / CHARA_H; // 0.5
const BG_W = 1170, BG_H = 2532, BG_RATIO = BG_W / BG_H;               // 約 0.462
const HEAD_TOP_PCT = 5;   // 頭頂は上端から約5%
const FOOT_PCT = 3;       // 足元は下端から約3%
const MAX_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- 引数
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(here, ".."));
const assetsDir = path.join(appDir, "assets");
const charaDir = path.join(assetsDir, "chara");
const bgDir = path.join(assetsDir, "bg");

// ---------------------------------------------------------------- 表示ユーティリティ
const width = (s) => {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += c >= 0x1100 && !(c >= 0xff61 && c <= 0xff9f) ? 2 : 1;
  }
  return w;
};
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - width(s)));
function table(headers, rows) {
  const ws = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const line = (r) => "| " + r.map((c, i) => pad(c ?? "", ws[i])).join(" | ") + " |";
  console.log(line(headers));
  console.log("|" + ws.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const r of rows) console.log(line(r));
}
const mb = (n) => (n / 1024 / 1024).toFixed(2) + "MB";
const pct = (n) => n.toFixed(1) + "%";

// ---------------------------------------------------------------- 画像の読み取り
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "heic/avif";
  return "unknown";
}

// PNG のチャンクを読む。必要なら IDAT を展開して透明画素の範囲（バウンディングボックス）を調べる
function readPng(buf, analyze) {
  const info = { type: "png" };
  let off = 8;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      info.width = data.readUInt32BE(0);
      info.height = data.readUInt32BE(4);
      info.bitDepth = data[8];
      info.colorType = data[9];
      info.interlace = data[12];
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!info.width) throw new Error("IHDR が見つかりません（壊れた PNG）");
  const ct = info.colorType;
  info.hasAlphaChannel = ct === 4 || ct === 6;
  info.hasTrns = !!trns;
  info.alphaKind = ct === 6 ? "RGBA" : ct === 4 ? "グレー+α" : trns ? (ct === 3 ? "パレット+tRNS" : "tRNS単色") : "なし";
  if (!analyze || !(ct === 6 || ct === 4 || (ct === 3 && trns))) return info;
  if (info.interlace) { info.note = "インターレースPNGのため位置解析を省略"; return info; }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const bd = info.bitDepth;
  const W = info.width, H = info.height;
  const stride = Math.ceil((W * channels * bd) / 8);
  const bpp = Math.max(1, (channels * bd) >> 3);
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e) { throw new Error("IDAT の展開に失敗（壊れた PNG）: " + e.message); }
  if (raw.length < (stride + 1) * H) throw new Error("画素データが足りません（壊れた PNG）");

  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let top = -1, bottom = -1, left = W, right = -1;
  const rowL = new Int32Array(H).fill(-1), rowR = new Int32Array(H).fill(-1); // 行ごとの人物の左右端（頭の中心を測る）
  let transparent = 0, semi = 0, semiWhite = 0, semiRgbCount = 0;
  const TH = 16; // これ以上の不透明度を「人物がある」とみなす
  const alphaAt = (row, x) => {
    if (ct === 6) return bd === 8 ? row[x * 4 + 3] : row[x * 8 + 6];
    if (ct === 4) return bd === 8 ? row[x * 2 + 1] : row[x * 4 + 2];
    // パレット
    let idx;
    if (bd === 8) idx = row[x];
    else { const per = 8 / bd; const byte = row[Math.floor(x / per)]; const shift = 8 - bd * (1 + (x % per)); idx = (byte >> shift) & ((1 << bd) - 1); }
    return idx < trns.length ? trns[idx] : 255;
  };
  for (let y = 0; y < H; y++) {
    const base = y * (stride + 1);
    const ft = raw[base];
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error("不正なフィルタ種別（壊れた PNG）");
      }
      cur[i] = v & 255;
    }
    let rowHas = false;
    for (let px = 0; px < W; px++) {
      const al = alphaAt(cur, px);
      if (al === 0) transparent++;
      if (al > TH) { rowHas = true; if (px < left) left = px; if (px > right) right = px; if (rowL[y] < 0) rowL[y] = px; rowR[y] = px; }
      if (al > 0 && al < 255) {
        semi++;
        if (ct === 6 && bd === 8) {
          semiRgbCount++;
          const o = px * 4;
          if (cur[o] > 235 && cur[o + 1] > 235 && cur[o + 2] > 235) semiWhite++;
        }
      }
    }
    if (rowHas) { if (top < 0) top = y; bottom = y; }
    const t = prev; prev = cur; cur = t;
  }
  info.transparentRatio = transparent / (W * H);
  if (top >= 0) {
    info.bbox = { top, bottom, left, right };
    info.headTopPct = (top / H) * 100;
    info.footPct = ((H - 1 - bottom) / H) * 100;
    info.centerXPct = (((left + right) / 2) / W) * 100;
    // 頭の左右中心: 頭頂から画像高さの 3〜8% 下の行で、人物の左右端の中点を平均する。
    // 服（コート・袖）や腕の広がりで全体の幅が変わっても、頭が動いていなければ同じ値になる。
    let sum = 0, n = 0;
    for (let y = top + Math.round(H * 0.03); y <= Math.min(bottom, top + Math.round(H * 0.08)); y++) {
      if (rowL[y] >= 0) { sum += (rowL[y] + rowR[y]) / 2; n++; }
    }
    info.headCenterXPct = n ? (sum / n / W) * 100 : info.centerXPct;
    info.bodyHeightPct = ((bottom - top + 1) / H) * 100;
  }
  info.semiWhiteRatio = semiRgbCount > 200 ? semiWhite / semiRgbCount : null;
  return info;
}

function readJpeg(buf) {
  const info = { type: "jpeg" };
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { off += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buf.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      info.height = buf.readUInt16BE(off + 5);
      info.width = buf.readUInt16BE(off + 7);
      info.components = buf[off + 9];
      info.progressive = marker === 0xc2;
      return info;
    }
    off += 2 + len;
  }
  throw new Error("JPEG のサイズ情報（SOF）が見つかりません");
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !d.name.startsWith("."));
  } catch { return null; }
}

// ---------------------------------------------------------------- 検査本体
const problems = { error: 0, warn: 0 };
const allNotes = [];
const flag = (level, list, msg) => { problems[level]++; list.push((level === "error" ? "[エラー] " : "[注意] ") + msg); };

console.log("アセット検証: " + assetsDir);
console.log("");

let totalBytes = 0;

// ---- 立ち絵
const charaEntries = listDir(charaDir);
const chara = new Map(); // "stageN_expr" -> info
const charaRows = [];
const unknownFiles = [];
if (!charaEntries) {
  console.log("assets/chara/ がありません（まだ立ち絵がない状態です）。");
} else {
  for (const d of charaEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(charaDir, d.name);
    if (d.isDirectory()) { unknownFiles.push("chara/" + d.name + "/（フォルダは読み込まれません）"); continue; }
    const notes = [];
    const lower = d.name.toLowerCase();
    if (!CHARA_RE.test(d.name)) {
      if (CHARA_RE.test(lower)) flag("error", notes, "大文字が含まれています。小文字に直してください（iOS は大文字小文字を区別）");
      else if (/^stage[0-4]_(normal|happy|shy|sad|pout)\.(jpe?g|webp|heic)$/i.test(d.name)) flag("error", notes, "立ち絵は .png（透過）にしてください");
      else { unknownFiles.push("chara/" + d.name); continue; }
    }
    const buf = fs.readFileSync(full);
    totalBytes += buf.length;
    const kind = sniff(buf);
    let info = { type: kind };
    try {
      if (kind === "png") info = readPng(buf, true);
      else if (kind === "jpeg") { info = readJpeg(buf); flag("error", notes, "中身が JPEG です（拡張子だけ .png）。透過PNGで書き出し直してください"); }
      else flag("error", notes, `PNG ではありません（${kind}）`);
    } catch (e) { flag("error", notes, e.message); }
    if (kind === "png" && !/\.png$/i.test(d.name)) flag("error", notes, "拡張子を .png にしてください");

    if (info.width) {
      const r = info.width / info.height;
      if (Math.abs(r - CHARA_RATIO) > 0.02) flag("warn", notes, `縦横比 ${r.toFixed(3)}（推奨 1:2 = 0.500）。表示時に人物の大きさや位置がずれます`);
      if (info.width < 768) flag("warn", notes, `解像度が低め（推奨 ${CHARA_W}x${CHARA_H}）`);
      if (info.width > 1536) flag("warn", notes, `必要以上に大きい（推奨 ${CHARA_W}x${CHARA_H}）。容量が増えます`);
    }
    if (info.type === "png") {
      if (info.alphaKind === "なし") flag("error", notes, "透過（アルファ）がありません。背景を除去した透過PNGにしてください");
      else if (info.alphaKind === "tRNS単色") flag("warn", notes, "単色透過（tRNS）です。フチがギザギザになりやすいので RGBA で書き出し直すのがおすすめ");
      else if (info.transparentRatio !== undefined && info.transparentRatio < 0.05) flag("error", notes, "アルファはあるが透明な画素がほぼありません（背景が残っている）");
      if (info.bbox) {
        if (Math.abs(info.footPct - FOOT_PCT) > 2.5) flag("warn", notes, `足元が下端から ${pct(info.footPct)}（目安 ${FOOT_PCT}%）`);
        if (Math.abs(info.headTopPct - HEAD_TOP_PCT) > 3) flag("warn", notes, `頭頂が上端から ${pct(info.headTopPct)}（目安 ${HEAD_TOP_PCT}%）`);
        if (info.bbox.top === 0) flag("warn", notes, "頭（または帽子）が画像の上端で切れています");
        if (info.bbox.bottom === info.height - 1) flag("warn", notes, "足元が画像の下端で切れています（全身にしてください）");
        if (info.semiWhiteRatio !== null && info.semiWhiteRatio > 0.35) flag("warn", notes, `半透明のフチの ${Math.round(info.semiWhiteRatio * 100)}% が白っぽい（白フチの可能性。ASSETS.md「透過のフチが白い」参照）`);
      } else if (info.transparentRatio !== undefined && info.transparentRatio > 0.999) flag("error", notes, "全面が透明です（人物が消えています）");
      if (info.note) notes.push("[情報] " + info.note);
    }
    if (buf.length > MAX_BYTES) flag("warn", notes, `${mb(buf.length)} は大きめ（目安 2MB 以下。pngquant 等で減色すると軽くなります）`);

    const m = CHARA_RE.exec(d.name); // 大文字入りなどはアプリから読めないので「あり」に数えない
    if (m) chara.set(`stage${m[1]}_${m[2]}`, { ...info, file: d.name, bytes: buf.length });
    charaRows.push([
      d.name,
      info.width ? `${info.width}x${info.height}` : "-",
      info.width ? (info.width / info.height).toFixed(3) : "-",
      info.type === "png" ? info.alphaKind : info.type,
      info.bbox ? `${pct(info.headTopPct)} / ${pct(info.footPct)} / ${pct(info.headCenterXPct)}` : "-",
      mb(buf.length),
      notes.length ? notes.filter((n) => !n.startsWith("[情報]")).length ? "要確認" : "OK" : "OK",
    ]);
    if (notes.length) allNotes.push({ file: "chara/" + d.name, notes });
  }
  console.log("■ 立ち絵 assets/chara/");
  if (charaRows.length) table(["ファイル", "サイズ", "縦横比", "透過", "頭頂/足元/頭の中心X", "容量", "判定"], charaRows);
  else console.log("（PNG がまだありません）");
  console.log("  頭頂・足元は画像の上端・下端からの距離、頭の中心Xは頭の左右中央（目安: 頭頂5% / 足元3% / 中心50%。服や腕の幅の変化に左右されないよう頭で測ります）");
}
console.log("");

// ---- 立ち絵の揃い（必須・推奨のマトリクス）
console.log("■ 立ち絵の揃い（normal は必須、他の表情は推奨）");
const matrixRows = STAGES.map((s) => [
  `stage${s}`,
  ...EXPRS.map((e) => (chara.has(`stage${s}_${e}`) ? "あり" : e === "normal" ? "なし(必須)" : "なし")),
]);
table(["段階", ...EXPRS], matrixRows);
const missingRequired = STAGES.filter((s) => !chara.has(`stage${s}_normal`)).map((s) => `stage${s}_normal.png`);
const haveCount = chara.size;
console.log(`  必須 ${5 - missingRequired.length}/5 枚、推奨 ${haveCount}/25 枚`);
if (missingRequired.length) {
  console.log("  不足（必須）: " + missingRequired.join(", "));
  console.log("  ※ 足りない段階はアプリ内蔵の SVG イラストで表示されます（エラーにはなりません）");
}
const missingExpr = [];
for (const s of STAGES) for (const e of EXPRS) if (e !== "normal" && !chara.has(`stage${s}_${e}`)) missingExpr.push(`stage${s}_${e}`);
if (missingExpr.length && missingExpr.length < 20) console.log("  不足（推奨・表情）: " + missingExpr.join(", ") + "  → その段階の normal で代用されます");
else if (missingExpr.length === 20) console.log("  表情差分はまだありません（各段階の normal で代用されます）");
console.log("");

// ---- 段階間の揃い（キャンバスサイズと人物位置）
const consistency = [];
const pngs = [...chara.values()].filter((i) => i.width);
if (pngs.length >= 2) {
  const sizes = new Map();
  for (const i of pngs) {
    const k = `${i.width}x${i.height}`;
    if (!sizes.has(k)) sizes.set(k, []);
    sizes.get(k).push(i.file);
  }
  if (sizes.size > 1) {
    const [major] = [...sizes.entries()].sort((a, b) => b[1].length - a[1].length);
    flag("error", consistency, `キャンバスサイズが揃っていません（多数派 ${major[0]}）: ` +
      [...sizes.entries()].filter(([k]) => k !== major[0]).map(([k, f]) => `${k} → ${f.join(", ")}`).join(" / "));
  }
  // 位置: 基準は stage0_normal（なければ最初の1枚）
  const withBox = pngs.filter((i) => i.bbox);
  const ref = chara.get("stage0_normal")?.bbox ? chara.get("stage0_normal") : withBox[0];
  if (ref) {
    for (const i of withBox) {
      if (i === ref) continue;
      const d = [];
      const dFoot = i.footPct - ref.footPct;
      const dCx = i.headCenterXPct - ref.headCenterXPct;
      if (Math.abs(dFoot) > 1) d.push(`足元 ${dFoot > 0 ? "+" : ""}${dFoot.toFixed(1)}%`);
      if (Math.abs(dCx) > 2.5) d.push(`頭の左右中心 ${dCx > 0 ? "+" : ""}${dCx.toFixed(1)}%`);
      // stage0 はベレー帽の分だけ頭頂が高いので、頭頂は stage1 以降どうしで比べる
      const sameHeadGroup = (i.file.startsWith("stage0") === ref.file.startsWith("stage0"));
      const dTop = i.headTopPct - ref.headTopPct;
      if (sameHeadGroup && Math.abs(dTop) > 1.5) d.push(`頭頂 ${dTop > 0 ? "+" : ""}${dTop.toFixed(1)}%`);
      if (d.length) flag("warn", consistency, `${i.file} が ${ref.file} とずれています: ${d.join("、")}（差し替え時に人物が動いて見えます）`);
    }
    // stage1〜4 の頭頂どうし
    const later = withBox.filter((i) => !i.file.startsWith("stage0"));
    if (later.length >= 2 && ref.file.startsWith("stage0")) {
      const tops = later.map((i) => i.headTopPct);
      const spread = Math.max(...tops) - Math.min(...tops);
      if (spread > 1.5) flag("warn", consistency, `stage1〜4 の頭頂の位置が ${spread.toFixed(1)}% ばらついています（体の大きさが変わって見えます）`);
    }
  }
}
console.log("■ 段階間の揃い（キャンバスサイズ・人物の位置）");
if (pngs.length < 2) console.log("  （比較できる立ち絵が2枚未満）");
else if (consistency.length) consistency.forEach((n) => console.log("  " + n));
else console.log("  OK（全立ち絵が同じキャンバスで、人物の位置も揃っています）");
console.log("");

// ---- 背景
const bgEntries = listDir(bgDir);
const bg = new Map();
const bgRows = [];
if (!bgEntries) {
  console.log("assets/bg/ がありません（まだ背景がない状態です）。");
} else {
  for (const d of bgEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(bgDir, d.name);
    if (d.isDirectory()) { unknownFiles.push("bg/" + d.name + "/（フォルダは読み込まれません）"); continue; }
    const notes = [];
    const lower = d.name.toLowerCase();
    if (!BG_RE.test(d.name)) {
      if (BG_RE.test(lower)) flag("error", notes, "大文字が含まれています。小文字に直してください");
      else if (/^(room_morning|room_evening|room_night|library|cafe)\.(png|webp|heic)$/i.test(d.name)) flag("error", notes, "背景は .jpg にしてください（アプリは .jpg を読みます）");
      else { unknownFiles.push("bg/" + d.name); continue; }
    }
    if (/\.jpeg$/i.test(d.name)) flag("error", notes, "拡張子は .jpeg ではなく .jpg にしてください");
    const buf = fs.readFileSync(full);
    totalBytes += buf.length;
    const kind = sniff(buf);
    let info = { type: kind };
    try {
      if (kind === "jpeg") info = readJpeg(buf);
      else if (kind === "png") { info = readPng(buf, false); flag("error", notes, "中身が PNG です（拡張子だけ .jpg）。JPEG で書き出し直してください"); }
      else flag("error", notes, `JPEG ではありません（${kind}）`);
    } catch (e) { flag("error", notes, e.message); }
    if (info.width) {
      const r = info.width / info.height;
      if (info.width > info.height) flag("error", notes, "横長です。縦長（1170x2532 前後）にしてください");
      else if (Math.abs(r - BG_RATIO) > 0.03) flag("warn", notes, `縦横比 ${r.toFixed(3)}（推奨 ${BG_RATIO.toFixed(3)}）。画面に合わせて端が切り取られます`);
      if (info.width < 900) flag("warn", notes, "解像度が低め（iPhone で粗く見えます）");
      if (info.width > 1600) flag("warn", notes, "必要以上に大きい（容量が増えます）");
      if (info.components === 4) flag("warn", notes, "CMYK の JPEG です。RGB で書き出してください");
    }
    if (buf.length > MAX_BYTES) flag("warn", notes, `${mb(buf.length)} は大きめ（品質 80〜85 で書き出すと 1MB 前後になります）`);
    const m = /^(room_morning|room_evening|room_night|library|cafe)\.jpg$/.exec(d.name);
    if (m) bg.set(m[1], info);
    bgRows.push([
      d.name,
      info.width ? `${info.width}x${info.height}` : "-",
      info.width ? (info.width / info.height).toFixed(3) : "-",
      mb(buf.length),
      notes.length ? "要確認" : "OK",
    ]);
    if (notes.length) allNotes.push({ file: "bg/" + d.name, notes });
  }
  console.log("■ 背景 assets/bg/");
  if (bgRows.length) table(["ファイル", "サイズ", "縦横比", "容量", "判定"], bgRows);
  else console.log("（JPEG がまだありません）");
}
const missingBg = BGS.filter((b) => !bg.has(b));
console.log(`  背景 ${5 - missingBg.length}/5 枚` + (missingBg.length ? `、不足: ${missingBg.map((b) => b + ".jpg").join(", ")}（無い背景はアプリの既定の背景色で表示されます）` : ""));
console.log("");

// ---- 個別の指摘
if (allNotes.length) {
  console.log("■ ファイルごとの指摘");
  for (const { file, notes } of allNotes) {
    console.log("  " + file);
    for (const n of notes) console.log("    - " + n);
  }
  console.log("");
}
if (unknownFiles.length) {
  console.log("■ 仕様にないファイル（アプリからは読み込まれません。名前の打ち間違いがないか確認）");
  unknownFiles.forEach((f) => console.log("  - " + f));
  console.log("");
}

// ---- まとめ
console.log("■ まとめ");
console.log(`  合計容量 ${mb(totalBytes)}（iOS アプリにそのまま同梱されます。目安: 全部で 40MB 以下）`);
if (totalBytes > 40 * 1024 * 1024) { problems.warn++; console.log("  [注意] 合計が 40MB を超えています。立ち絵を減色、背景の JPEG 品質を下げるなどで軽くしてください"); }
console.log(`  エラー ${problems.error} 件 / 注意 ${problems.warn} 件 / 必須立ち絵の不足 ${missingRequired.length} 枚 / 背景の不足 ${missingBg.length} 枚`);
if (!problems.error && !missingRequired.length) console.log("  アプリで表示できる状態です。iOS は Xcode で再ビルドすると assets が同梱されます。");
else if (!problems.error) console.log("  エラーはありません。必須の立ち絵が揃うまでは足りない段階に内蔵イラストが出ます。");
else console.log("  エラーのファイルを直してから、もう一度実行してください。");

if (strict && (problems.error || missingRequired.length)) process.exit(1);
