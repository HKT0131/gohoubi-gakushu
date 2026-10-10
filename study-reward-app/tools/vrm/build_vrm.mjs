// 3D版キャラ（VRM）の加工: node tools/vrm/build_vrm.mjs
//   入力: tools/vrm/src/AvatarSample_G.vrm（VRoid 公式 β Ver AvatarSample_4、CC0）
//   出力: assets/vrm/chara.vrm
//
// 加工内容
//  1. 体のテクスチャに「ワンピース水着」を焼き込む（元の体テクスチャは出力に残さない）。
//     → 衣装をどう外しても、体は常に水着を着た状態でしか描画されない。
//     塗る範囲は体メッシュの3D位置（Tポーズ）で決め、UV 空間で三角形ごとにラスタライズする。
//     焼き込み後に「水着で覆うべき範囲の三角形がすべて水着色か」を検査し、1つでも肌色なら失敗で終了する。
//  2. ニーハイを肌色に塗った「素足」版の体テクスチャを追加（最終段階で差し替え。こちらも水着入り）。
//     json.extras.studyReward.bareLegsTexture にテクスチャ番号を記録。
//  3. 服（ワンピース1枚のメッシュ）を UV で 袖 / ブラウス / スカート の3マテリアルに分割（表示切り替え用）。
//  4. 胸の揺れもの（secondaryAnimation の "Bust"）を削除。
//  5. 容量削減: 体テクスチャは JPEG（アルファ無し）、法線マップは縮小、サムネイルは縮小。
//  6. meta のタイトルに改変版であることを追記（利用条件の各項目は元のまま）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readGLB, writeGLB, accessor, imageBytes, humanBones } from "./gltf.mjs";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, "src/AvatarSample_G.vrm");
// 候補として tools/vrm/out/ に書き出す。verify_render.mjs の実レンダリング検査に通ったものだけ assets/vrm/chara.vrm にコピーする。
const OUT = path.resolve(HERE, "out/chara.candidate.vrm");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vrmbuild-"));

const g = readGLB(SRC);
const J = g.json;
const VRM = J.extensions.VRM;
const BODY_MESH = 1, BODY_PRIM = 0, FEET_PRIM = 1, CLOTH_PRIM = 4;
const BODY_IMG = J.textures[VRM.materialProperties[9].textureProperties._MainTex].source;
if (VRM.materialProperties[9].textureProperties._ShadeTexture !== VRM.materialProperties[9].textureProperties._MainTex) throw new Error("shade texture differs; must paint it too");

// ------------------------------------------------------------ 水着の範囲（Tポーズ、モデルは -Z 向き）
const hb = humanBones(g);
// ビキニ（標準的な布面積のトップ＋ボトム）。寸法は体メッシュの実測（tools/vrm/analyze.mjs）から:
//   胸: 頂点 y1.274 |x|0.059 z-0.143、膨らみは y1.21〜1.35、横は |x|0.117 まで。股 y0.871。お尻の後ろ z0.085（y0.96〜1.0）。
// トップ: 前は y1.185〜1.355（胸の下側の付け根より 3cm 下〜上側のふくらみの上まで）、背中は y1.20〜1.245 のバンド、肩ひも。
// ボトム: 上端は前 0.97／後ろ 0.99。脚ぐりは股の 3.5cm 下から腰の横へ上がる（後ろはお尻を覆うようにゆるやか）。
// v3: 2D の stage4 に合わせた三角ビキニ。
//  トップ: 三角カップ（底辺 y1.185 の |x| 0.004〜0.128、頂点 (0.066, 1.385)）＋首掛けの細いストラップ＋アンダーの細いバンド（背中まで一周）。
//          胸の頂点 (0.059, 1.274) はカップの縁から 2cm 以上内側。
//  ボトム: 脚の付け根（鼠径部）に沿ったレッグカット。太ももには掛けない。股の中央（|x|<0.025）は前から後ろまで連続して覆う。
//          前の上端 0.965（2D と同じ低め）、後ろはお尻の割れ目の上 1.02 まで。
// v4: カップを胸の実寸に合わせる（下胸線 y≈1.222（内）〜1.235（外）、胸の外端 |x|≈0.115〜0.12、内端 |x|≈0.015）。
//     底辺は下胸線にわずかに掛かる高さ（内 1.214・外 1.228）、アンダーの紐もその高さへ。
const CUP = { x0: 0.012, y0: 1.214, x1: 0.118, y1: 1.228, ax: 0.062, ay: 1.372 };
const BAND_LO = 1.204, BAND_HI = 1.215;
const HALTER_W = 0.0048; // 半幅
const NECK_Y0 = 1.43, NECK_Y1 = 1.441;
const BOT_HI_F = 0.985, BOT_HI_B = 1.02; // 後ろの上端: お尻の割れ目（形状上 y0.97 付近から）より 5cm 上
const ZC = -0.035, ZC_HIP = -0.01; // 胸・腰の前後の中心
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 点 (x,y) から線分 a-b までの距離
function segDist(x, y, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1); return Math.hypot(x - ax - t * dx, y - ay - t * dy); }
// 三角カップの内側の余裕（正面に投影した x,y で計算。x は |x|）
function cupMargin(x, y) {
  const e = (ax, ay, bx, by) => { const nx = -(by - ay), ny = bx - ax, l = Math.hypot(nx, ny); return ((x - ax) * nx + (y - ay) * ny) / l; };
  // 頂点の並び（底辺左 → 底辺右 → 頂点）で、内側が正になる向き
  return Math.min(e(CUP.x0, CUP.y0, CUP.x1, CUP.y1), e(CUP.x1, CUP.y1, CUP.ax, CUP.ay), e(CUP.ax, CUP.ay, CUP.x0, CUP.y0));
}
// v5: 本当の股（法線が真下を向く面）は中心線上で 前 y0.920（z-0.033）〜後ろ y0.945（z0.024）。
//     その下（y0.87〜0.92、|x|<0.015 で法線が真横）は左右の内もも。布は股の面の 8mm 下（y0.912）で止め、内ももには掛けない。
//     前: 股から脚の付け根に沿って斜めに上がる三角形（横は 1.2cm 幅の紐）。
//     後ろ: 股から少し下がってお尻の下側（y0.90）を通り、腰の横へ上がる。
const CROTCH_Y = 0.912;
function legLineF(x) { return Math.min(CROTCH_Y + Math.max(0, x - 0.008) * 0.6, BOT_HI_F - 0.012); }
function legLineB(x) { return x < 0.008 ? CROTCH_Y : x < 0.02 ? CROTCH_Y - (x - 0.008) : x < 0.06 ? CROTCH_Y - 0.012 : CROTCH_Y - 0.012 + (x - 0.06) * 0.5; }
// 戻り値: 水着の内側までの余裕（m）。>= 0 なら水着。
function swimMargin(px, y, z) {
  const x = Math.abs(px);
  const f = clamp((ZC - z) / 0.08 + 0.5, 0, 1); // 1=前 0=後ろ
  let top = -1;
  // 三角カップ（前側のみ）
  if (f > 0.5) top = Math.max(top, Math.min(cupMargin(x, y), (f - 0.5) * 0.2));
  // アンダーバンド（一周）。腕は含めない
  // 前はカップの底辺（傾いている）に沿わせ、カップとの間に肌のすき間を作らない
  const bandHi = f > 0.5 && x < CUP.x1 + 0.01 ? Math.max(BAND_HI, CUP.y0 + (CUP.y1 - CUP.y0) * clamp((x - CUP.x0) / (CUP.x1 - CUP.x0), 0, 1) + 0.004) : BAND_HI;
  top = Math.max(top, Math.min(y - BAND_LO, bandHi - y, 0.2 - x));
  // 首掛けストラップ: カップの頂点から首の横へ、首の後ろは一周
  // 前後の境目は胸の高さでは ZC、首の付け根（y1.34→1.40）で首の中心（首の骨 z0.015）へ移す。ZC のままだと首の付け根（z≈0）で紐が切れる。
  const zFront = ZC + (0.015 - ZC) * clamp((y - 1.34) / 0.06, 0, 1);
  if (z < zFront) top = Math.max(top, HALTER_W - segDist(x, y, CUP.ax, CUP.ay - 0.01, 0.046, NECK_Y1));
  if (x < 0.06) top = Math.max(top, Math.min(y - NECK_Y0, NECK_Y1 - y));
  // ボトム
  const fh = clamp((ZC_HIP - z) / 0.08 + 0.5, 0, 1);
  const leg = legLineB(x) + fh * (legLineF(x) - legLineB(x));
  const bot = Math.min(y - leg, BOT_HI_B + fh * (BOT_HI_F - BOT_HI_B) - y, 0.2 - x);
  return Math.max(top, bot);
}
const LEG = 0.835, TOP_FRONT = CUP.ay;
const SWIM = [236, 128, 160], SWIM_DARK = [214, 104, 140], TRIM = [150, 52, 92];
const TRIM_W = 0.006;
// 水玉（3D 位置で配置。縁取りから離す）。マスク値 200。
const DOT_S = 0.03, DOT_R = 0.0068;
function isDot(px, y, m) {
  if (m < TRIM_W + 0.005) return false;
  const j = Math.round(y / DOT_S), off = (j & 1) ? DOT_S / 2 : 0;
  const i = Math.round((px - off) / DOT_S);
  return (px - off - i * DOT_S) ** 2 + (y - j * DOT_S) ** 2 < DOT_R * DOT_R;
}
function swimColor(x, y, z, m) {
  if (m < TRIM_W) return TRIM;
  if (isDot(x, y, m)) return TRIM;
  const t = clamp((y - 0.83) / (1.36 - 0.83), 0, 1);
  return SWIM.map((v, i) => Math.round(v + (SWIM_DARK[i] - v) * (1 - t) * 0.5));
}

// ------------------------------------------------------------ テクスチャ塗り
const bodyPng = PNG.sync.read(imageBytes(g, BODY_IMG));
const TW = bodyPng.width, TH = bodyPng.height;
const prims = J.meshes[BODY_MESH].primitives;
const POS = accessor(g, prims[BODY_PRIM].attributes.POSITION);
const UV = accessor(g, prims[BODY_PRIM].attributes.TEXCOORD_0);
const triList = (pk) => accessor(g, prims[pk].indices);

// 三角形を UV 空間でラスタライズし、各ピクセルに 3D 位置を渡す
function rasterUV(idx, cb) {
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
    const ax = UV[ia * 2] * TW, ay = UV[ia * 2 + 1] * TH, bx = UV[ib * 2] * TW, by = UV[ib * 2 + 1] * TH, cx = UV[ic * 2] * TW, cy = UV[ic * 2 + 1] * TH;
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(TW - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(TH - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const sx = px + 0.5, sy = py + 0.5;
      const w1 = ((sx - ax) * (cy - ay) - (cx - ax) * (sy - ay)) / d, w2 = ((bx - ax) * (sy - ay) - (sx - ax) * (by - ay)) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const P = (k) => w0 * POS[ia * 3 + k] + w1 * POS[ib * 3 + k] + w2 * POS[ic * 3 + k];
      cb(px, py, P(0), P(1), P(2));
    }
  }
}
function paintSwimsuit(png) {
  const covered = new Uint8Array(TW * TH), swim = new Uint8Array(TW * TH);
  const set = (o, c) => { png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255; };
  // 元テクスチャには白い下着が描かれている。ビキニの外にはみ出す部分は、近くの肌の色で塗りつぶす。
  const isWhite = (o) => { const r = Math.max(1, png.data[o]); return png.data[o + 2] / r > 0.95 && png.data[o + 1] / r > 0.85; };
  const fixed = new Uint8Array(TW * TH);
  rasterUV(triList(BODY_PRIM), (px, py, x, y, z) => {
    const i = py * TW + px; covered[i] = 1;
    const m = swimMargin(x, y, z);
    if (m >= 0) { swim[i] = m < TRIM_W ? 3 : isDot(x, y, m) ? 5 : 1; set(i * 4, swimColor(x, y, z, m)); }
    else if (!swim[i] && y > 0.78 && y < 1.42 && Math.abs(x) < 0.2 && isWhite(i * 4)) fixed[i] = 1;
  });
  // 同じテクスチャを使う他の体プリミティブ（足・手・頭の一部）の領域も「使用中」にして、余白の塗り広げで上書きしない
  for (let pk = 0; pk < prims.length; pk++) {
    if (pk === BODY_PRIM || prims[pk].material !== prims[BODY_PRIM].material) continue;
    if (prims[pk].attributes.TEXCOORD_0 !== prims[BODY_PRIM].attributes.TEXCOORD_0) throw new Error("body prims do not share UVs");
    rasterUV(triList(pk), (px, py) => { const i = py * TW + px; covered[i] = 1; if (swim[i]) throw new Error("swimsuit painted over another body primitive"); });
  }
  // 下着の輪郭線・にじみも含めるため 8px 広げる（水着と UV の外は除く）
  for (let it = 0; it < 8; it++) {
    const add = [];
    for (let i = 0; i < fixed.length; i++) if (fixed[i]) { const x = i % TW, y = (i / TW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const j = ny * TW + nx; if (covered[j] && !swim[j] && !fixed[j]) add.push(j); } }
    add.forEach((j) => (fixed[j] = 1));
  }
  // いちばん近い肌の色で内側へ塗り広げ（多点 BFS）、そのあと近傍平均でならす
  let front = [];
  for (let i = 0; i < fixed.length; i++) if (fixed[i]) { const x = i % TW, y = (i / TW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const j = ny * TW + nx;
      if (covered[j] && !swim[j] && !fixed[j]) { png.data.copyWithin(i * 4, j * 4, j * 4 + 3); fixed[i] = 2; front.push(i); break; } } }
  while (front.length) {
    const next = [];
    for (const i of front) { const x = i % TW, y = (i / TW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const j = ny * TW + nx;
        if (fixed[j] === 1) { png.data.copyWithin(j * 4, i * 4, i * 4 + 3); fixed[j] = 2; next.push(j); } } }
    front = next;
  }
  const list = []; for (let i = 0; i < fixed.length; i++) if (fixed[i]) list.push(i);
  for (let it = 0; it < 40; it++) for (const i of list) {
    const x = i % TW, y = (i / TW) | 0; const a = [0, 0, 0]; let c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const j = ny * TW + nx;
      if (!covered[j] || swim[j]) continue; for (let k = 0; k < 3; k++) a[k] += png.data[j * 4 + k]; c++;
    }
    if (c) for (let k = 0; k < 3; k++) png.data[i * 4 + k] = Math.round(a[k] / c);
  }
  console.log("repainted leftover underwear pixels with nearby skin", list.length);
  toneMatch(png, swim);
  // 首の付け根（y1.31〜1.47）は、元の絵に明るさの段差（y≈1.385）があるため、細かいセル（1.5cm）でもう一度合わせる（端はなだらかに）
  toneMatch(png, swim, { cell: 0.015, y0: 1.31, y1: 1.47, feather: 0.025 });
  // UV の隙間（三角形の外）を埋める（3段階）。
  //  1) 最初の 6px は、いちばん近いテクセル（水着・肌とも）の色 → 肌の島の縁（背中の継ぎ目など）に水着の色が入らない
  //  2) 残りは水着からさらに 34px → 縮小（ミップマップ）でも水着の島に隣の肌がにじまない
  //  3) まだ空いている所は肌から 8px
  const pad = new Uint8Array(TW * TH);
  const grow = (seeds, iters, ok) => {
    let front = seeds;
    for (let it = 0; it < iters; it++) {
      const next = [];
      for (const i of front) { const x = i % TW, y = (i / TW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const j = ny * TW + nx;
          if (covered[j] || pad[j] || !ok(i)) continue;
          pad[j] = 1; png.data.copyWithin(j * 4, i * 4, i * 4 + 4);
          swim[j] = !swim[i] ? 0 : swim[i] === 3 || swim[i] === 4 ? 4 : swim[i] === 5 || swim[i] === 6 ? 6 : 2;
          next.push(j); } }
      front = next;
    }
  };
  const all = []; for (let i = 0; i < covered.length; i++) if (covered[i]) all.push(i);
  grow(all, 6, () => true);
  const swimSeeds = []; for (let i = 0; i < swim.length; i++) if (swim[i]) swimSeeds.push(i);
  grow(swimSeeds, 40, (i) => !!swim[i]);
  const skinSeeds = []; for (let i = 0; i < covered.length; i++) if ((covered[i] || pad[i]) && !swim[i]) skinSeeds.push(i);
  grow(skinSeeds, 8, (i) => !swim[i]);
  return swim;
}
// 体の肌の色合わせ: 元テクスチャは胴・腕が首や顔より白い（服で隠れていた部分）。首・あごの色に合わせて、
// 4cm 角のセル（周り 3x3x3）の平均色との比率で補正する（細部の陰影は残す。倍率 0.85〜1.12）。ニーハイ・足（y<0.72）と水着は対象外。
const SKIN_TARGET = [254, 225, 209]; // 実レンダリングで鎖骨・胸元があご下（顔）と ΔE≈1 になる値（tools/vrm/measure_skin.mjs で調整）
function toneMatch(png, swim, { cell = 0.04, y0 = 0.72, y1 = 9, feather = 0 } = {}) {
  // UV の島（首・胴・腕…）ごとに分けて補正する。島の境目（首の付け根＝鎖骨の上）で色の段差が出ないように。
  const island = new Int32Array(TW * TH).fill(-1);
  {
    const par = new Map(), f = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
    for (const pk of [0, 1, 2, 3]) { if (pk >= prims.length) continue; const idx = triList(pk); for (let t = 0; t < idx.length; t += 3) { for (let k = 0; k < 3; k++) if (!par.has(idx[t + k])) par.set(idx[t + k], idx[t + k]); const a = f(idx[t]); par.set(f(idx[t + 1]), a); par.set(f(idx[t + 2]), a); } }
    for (const pk of [0, 1, 2, 3]) { if (pk >= prims.length) continue; const idx = triList(pk); for (let t = 0; t < idx.length; t += 3) { const id = f(idx[t]); rasterUV(idx.subarray(t, t + 3), (px, py) => (island[py * TW + px] = id)); } }
  }
  const CELL = cell, cells = new Map(), key = (i, x, y, z) => `${island[i]}:${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const body = [0, 2, 3].filter((pk) => pk < prims.length && prims[pk].material === prims[BODY_PRIM].material);
  const visit = (cb) => { const done = new Uint8Array(TW * TH); for (const pk of body) rasterUV(triList(pk), (px, py, x, y, z) => { const i = py * TW + px; if (done[i] || swim[i] || y < y0 || y >= y1) return; done[i] = 1; cb(i, x, y, z); }); };
  visit((i, x, y, z) => { const k = key(i, x, y, z); const c = cells.get(k) || [0, 0, 0, 0]; c[0] += png.data[i * 4]; c[1] += png.data[i * 4 + 1]; c[2] += png.data[i * 4 + 2]; c[3]++; cells.set(k, c); });
  // セル（中心）ごとの周り 3x3x3 の平均を、テクセルの位置で三線形補間する（セルの境目で段差が出ないように）
  const win = new Map();
  const cellMean = (id, cx, cy, cz) => {
    const k = `${id}:${cx},${cy},${cz}`; if (win.has(k)) return win.get(k);
    const a = [0, 0, 0]; let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const c = cells.get(`${id}:${cx + dx},${cy + dy},${cz + dz}`); if (c) { a[0] += c[0]; a[1] += c[1]; a[2] += c[2]; n += c[3]; } }
    const r = n ? a.map((v) => v / n) : null; win.set(k, r); return r;
  };
  const mean = (i, x, y, z) => {
    const fx = x / CELL - 0.5, fy = y / CELL - 0.5, fz = z / CELL - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const a = [0, 0, 0]; let wsum = 0;
    for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
      const m = cellMean(island[i], x0 + dx, y0 + dy, z0 + dz); if (!m) continue;
      const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0)) * (dz ? fz - z0 : 1 - (fz - z0));
      for (let k = 0; k < 3; k++) a[k] += m[k] * w; wsum += w;
    }
    return a.map((v) => v / Math.max(1e-6, wsum));
  };
  let changed = 0; // 書き込みは 255 で頭打ちにする（Uint8 は桁あふれして色が反転する）
  visit((i, x, y, z) => {
    const m = mean(i, x, y, z);
    const w = feather ? clamp((y - y0) / feather, 0, 1) * clamp((y1 - y) / feather, 0, 1) : 1; // 範囲の端はなだらかに
    for (let k = 0; k < 3; k++) { const f = 1 + (clamp(SKIN_TARGET[k] / Math.max(1, m[k]), 0.85, 1.12) - 1) * w; if (f < 0.999) changed++; png.data[i * 4 + k] = Math.min(255, Math.round(png.data[i * 4 + k] * f)); }
  });
  console.log("tone-matched skin texels", changed);
}
const swimMap = paintSwimsuit(bodyPng);

// 水着色（地色・縁取り・水玉とも）: 緑/赤 < 0.72。元の肌は 緑/赤 0.8〜0.95・青/赤 < 0.92（下で実測して確認）。
function isCoverColor(r, gg, b) { r = Math.max(r, 1); return gg / r < 0.72; }
{
  // 元テクスチャの肌（水着範囲外の体）で isCoverColor に当たるピクセルが無いことを確認（判定基準の妥当性）
  const orig = PNG.sync.read(imageBytes(g, BODY_IMG)); let n = 0, hit = 0, maxBR = 0, minGR = 9;
  rasterUV(triList(BODY_PRIM), (px, py, x, y, z) => { if (swimMargin(x, y, z) >= 0) return; const o = (py * TW + px) * 4; const r = orig.data[o], gg = orig.data[o + 1], b = orig.data[o + 2];
    if (y < 0.7) return; // ニーハイ（白）は肌ではない
    n++; if (isCoverColor(r, gg, b)) hit++; maxBR = Math.max(maxBR, b / Math.max(r, 1)); minGR = Math.min(minGR, gg / Math.max(r, 1)); });
  console.log(`skin pixels ${n}: classified as cover ${hit} (b/r max ${maxBR.toFixed(3)}, g/r min ${minGR.toFixed(3)})`);
}
// ------------------------------------------------------------ 検査（安全要件）
// 覆うべき範囲（境界から 3mm 内側）の三角形について、頂点・辺の中点・重心の UV 位置の色が水着色か確認
function verify(png, label, ref = null) {
  const idx = triList(BODY_PRIM);
  let checked = 0, bad = 0;
  // ref（検査済みの PNG）があるときは、JPEG で各チャンネルが 40 以上ずれていないこと（肌色との差は 50 以上）も条件にする
  const isSwim = (o) => { const r = png.data[o], gg = png.data[o + 1], b = png.data[o + 2];
    if (ref) return Math.max(Math.abs(r - ref.data[o]), Math.abs(gg - ref.data[o + 1]), Math.abs(b - ref.data[o + 2])) < 40 && (isCoverColor(r, gg, b) || gg / Math.max(r, 1) < 0.78);
    // 水着色（緑成分が低いピンク）か、縁取りの白（青成分が赤とほぼ同じ）。肌色は b < r - 20 なのでどちらにも入らない。
    return isCoverColor(r, gg, b); };
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => idx[t + k]);
    const samples = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [.5, .5, 0], [0, .5, .5], [.5, 0, .5], [1 / 3, 1 / 3, 1 / 3]];
    for (const w of samples) {
      const P = (k) => w[0] * POS[v[0] * 3 + k] + w[1] * POS[v[1] * 3 + k] + w[2] * POS[v[2] * 3 + k];
      const x = P(0), y = P(1), z = P(2);
      if (swimMargin(x, y, z) < 0.003) continue;
      const u = w[0] * UV[v[0] * 2] + w[1] * UV[v[1] * 2] + w[2] * UV[v[2] * 2], vv = w[0] * UV[v[0] * 2 + 1] + w[1] * UV[v[1] * 2 + 1] + w[2] * UV[v[2] * 2 + 1];
      // サンプル点の周囲 3x3 ピクセル（バイリニア補間で混ざる範囲）すべて水着色であること
      const cx = Math.floor(u * TW), cy = Math.floor(vv * TH);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = clamp(cx + dx, 0, TW - 1), py = clamp(cy + dy, 0, TH - 1);
        checked++;
        if (!isSwim((py * TW + px) * 4)) { bad++; if (bad < 5) console.error(`[${label}] uncovered at`, x.toFixed(3), y.toFixed(3), z.toFixed(3), "px", px, py, [...png.data.subarray((py * TW + px) * 4, (py * TW + px) * 4 + 3)]); }
      }
    }
  }
  console.log(`verify ${label}: checked ${checked} samples, uncovered ${bad}`);
  if (bad) throw new Error(`swimsuit coverage check failed (${label})`);
  // 胸の頂点・股・お尻の中心が覆う範囲の内側（余裕 2cm 以上）にあること
  // 胸の頂点（2cm 以上）、その周り半径 1cm（乳輪に相当、1.2cm 以上）、股の中央・股下、お尻（中心・下側）、お尻の割れ目
  const crit = [[0.059, 1.274, -0.143], [0, 0.95, 0.08], [0.06, 0.93, 0.08], [0, 0.97, 0.075], [0.03, 0.93, 0.07], [0.0, 0.94, -0.07], [0.02, 0.945, -0.06]].flatMap(([x, y, z]) => [[x, y, z], [-x, y, z]]);
  // 股の面（中心線、法線が真下）は下が内ももなので、下向きの余裕は 6mm（股布）。
  for (const c of [[0, 0.920, -0.033], [0, 0.923, -0.006], [0, 0.935, 0.015], [0, 0.944, 0.024], [0.005, 0.924, -0.005]].flatMap(([x, y, z]) => [[x, y, z], [-x, y, z]])) { const m = swimMargin(...c); if (m < 0.006) throw new Error("crotch point too close to swimsuit edge: " + c + " m=" + m); }
  const ring = []; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; for (const sx of [1, -1]) ring.push([sx * (0.059 + Math.cos(a) * 0.01), 1.274 + Math.sin(a) * 0.01, -0.14]); }
  for (const c of ring) { const m = swimMargin(...c); if (m < 0.012) throw new Error("areola-equivalent point too close to cup edge: " + c + " m=" + m); }
  for (const c of crit) { const m = swimMargin(...c); if (m < 0.02) throw new Error("critical point too close to swimsuit edge: " + c + " m=" + m); }
}
verify(bodyPng, "swimsuit");

// ------------------------------------------------------------ 素足版（ニーハイを肌色に）
const barePng = new PNG({ width: TW, height: TH }); bodyPng.data.copy(barePng.data);
{
  // 太ももの肌色（y 0.74〜0.80）を平均して使う
  let n = 0; const acc = [0, 0, 0];
  rasterUV(triList(BODY_PRIM), (px, py, x, y) => { if (y > 0.74 && y < 0.80) { const o = (py * TW + px) * 4; acc[0] += bodyPng.data[o]; acc[1] += bodyPng.data[o + 1]; acc[2] += bodyPng.data[o + 2]; n++; } });
  const skin = acc.map((v) => Math.round(v / n));
  console.log("skin color", skin);
  const LEG_TOP = 0.715; // ニーハイの上端（0.69）より少し上から塗る
  const paint = (px, py, x, y) => { const o = (py * TW + px) * 4; if (swimMap[py * TW + px]) return;
    if (y < LEG_TOP) { barePng.data[o] = skin[0]; barePng.data[o + 1] = skin[1]; barePng.data[o + 2] = skin[2]; barePng.data[o + 3] = 255; }
    else if (y < LEG_TOP + 0.02) { const t = (y - LEG_TOP) / 0.02; for (let k = 0; k < 3; k++) barePng.data[o + k] = Math.round(skin[k] * (1 - t) + bodyPng.data[o + k] * t); } };
  rasterUV(triList(BODY_PRIM), paint);
  rasterUV(triList(FEET_PRIM), paint);
}
verify(barePng, "bare-legs");

// ------------------------------------------------------------ 画像の置き換え
const newImages = new Map(); // imageIndex -> {bytes, mime}
function toJpeg(png, size, q = 88) {
  const p = path.join(TMP, `t${Math.random().toString(36).slice(2)}.png`), o = p.replace(".png", ".jpg");
  fs.writeFileSync(p, PNG.sync.write(png));
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), ...(size ? ["-Z", String(size)] : []), p, "--out", o], { stdio: "ignore" });
  return fs.readFileSync(o);
}
function resizePng(bytes, size) {
  const p = path.join(TMP, `r${Math.random().toString(36).slice(2)}.png`), o = p.replace(".png", "_o.png");
  fs.writeFileSync(p, bytes);
  execFileSync("sips", ["-Z", String(size), p, "--out", o], { stdio: "ignore" });
  return fs.readFileSync(o);
}
function resizeJpeg(bytes, size, q = 80) {
  const p = path.join(TMP, `j${Math.random().toString(36).slice(2)}.png`), o = p.replace(".png", ".jpg");
  fs.writeFileSync(p, bytes);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), "-Z", String(size), p, "--out", o], { stdio: "ignore" });
  return fs.readFileSync(o);
}
// JPEG にした後も、デコードし直して同じ検査をする
function jpegChecked(png, label) {
  const bytes = toJpeg(png, 0, Number(process.env.JPEG_Q || 100));
  const j = path.join(TMP, `v${Math.random().toString(36).slice(2)}.jpg`), o = j.replace(".jpg", ".png");
  fs.writeFileSync(j, bytes); execFileSync("sips", ["-s", "format", "png", j, "--out", o], { stdio: "ignore" });
  const back = PNG.sync.read(fs.readFileSync(o));
  if (back.width !== TW || back.height !== TH) throw new Error("jpeg size mismatch");
  verify(back, label + " (jpeg)", png);
  return bytes;
}
newImages.set(BODY_IMG, { bytes: jpegChecked(bodyPng, "swimsuit"), mime: "image/jpeg" });
const BARE_IMG = J.images.length;
J.images.push({ name: "Body_BareLegs_swim", mimeType: "image/jpeg", bufferView: -1 });
newImages.set(BARE_IMG, { bytes: jpegChecked(barePng, "bare-legs"), mime: "image/jpeg" });
const BARE_TEX = J.textures.length;
J.textures.push({ sampler: J.textures[J.materials[9].pbrMetallicRoughness.baseColorTexture.index].sampler, source: BARE_IMG });
// 法線マップを縮小
J.images.forEach((im, i) => {
  if (/_nml$/.test(im.name)) newImages.set(i, { bytes: resizePng(imageBytes(g, i), 512), mime: "image/png" });
  if (im.name === "Thumbnail") newImages.set(i, { bytes: resizeJpeg(imageBytes(g, i), 256), mime: "image/jpeg" });
});
// 水着の範囲マスク（255=水着の地色、200=水玉、128=縁取り、0=それ以外）。実行時に水着の色をキャラ設定の色に置き換えるのに使う。
const maskPng = new PNG({ width: TW, height: TH });
for (let i = 0; i < TW * TH; i++) { const m = swimMap[i], v = m === 1 || m === 2 ? 255 : m === 5 || m === 6 ? 200 : m ? 128 : 0; maskPng.data[i * 4] = maskPng.data[i * 4 + 1] = maskPng.data[i * 4 + 2] = v; maskPng.data[i * 4 + 3] = 255; }
const MASK_IMG = J.images.length;
J.images.push({ name: "Body_SwimMask", mimeType: "image/png", bufferView: -1 });
newImages.set(MASK_IMG, { bytes: PNG.sync.write(maskPng, { colorType: 0 }), mime: "image/png" });
const MASK_TEX = J.textures.length;
J.textures.push({ sampler: J.textures[BARE_TEX].sampler, source: MASK_IMG });
J.extras = { ...(J.extras || {}), studyReward: { swimMaskTexture: MASK_TEX, swimBaseColor: SWIM, swimTrimColor: TRIM, bareLegsTexture: BARE_TEX, swimsuitBaked: true, source: "VRoid β Ver AvatarSample_4 (CC0)" } };

// ------------------------------------------------------------ 服の分割（UV で判定）
const cloth = prims[CLOTH_PRIM];
const cIdx = accessor(g, cloth.indices), cUV = accessor(g, cloth.attributes.TEXCOORD_0);
const parts = { Sleeves: [], Blouse: [], Skirt: [], Ties: [] };
for (let t = 0; t < cIdx.length; t += 3) {
  const u = (cUV[cIdx[t] * 2] + cUV[cIdx[t + 1] * 2] + cUV[cIdx[t + 2] * 2]) / 3, v = (cUV[cIdx[t] * 2 + 1] + cUV[cIdx[t + 1] * 2 + 1] + cUV[cIdx[t + 2] * 2 + 1]) / 3;
  const part = v > 0.525 ? "Skirt" : u < 0.262 || u > 0.738 ? "Sleeves" : "Blouse";
  parts[part].push(cIdx[t], cIdx[t + 1], cIdx[t + 2]);
}
// ブラウスの前の小さな飾り紐（独立した小さい連結成分）は "Ties" に分ける（上着を着ている間は隠すため）
{
  const cPos = accessor(g, cloth.attributes.POSITION);
  const key = (i) => `${cPos[i * 3].toFixed(4)},${cPos[i * 3 + 1].toFixed(4)},${cPos[i * 3 + 2].toFixed(4)}`;
  const weld = new Map(), par = new Map();
  const rep = (i) => { const k = key(i); if (!weld.has(k)) weld.set(k, i); return weld.get(k); };
  const f = (x) => { while (par.has(x) && par.get(x) !== x) x = par.get(x); return x; };
  const B = parts.Blouse;
  for (let t = 0; t < B.length; t += 3) { const a = f(rep(B[t])), b = f(rep(B[t + 1])), c = f(rep(B[t + 2])); par.set(a, a); par.set(b, a); par.set(c, a); }
  const size = new Map(); for (let t = 0; t < B.length; t += 3) { const r = f(rep(B[t])); size.set(r, (size.get(r) || 0) + 1); }
  const keep = [], ties = [];
  for (let t = 0; t < B.length; t += 3) (size.get(f(rep(B[t]))) <= 60 ? ties : keep).push(B[t], B[t + 1], B[t + 2]);
  parts.Blouse = keep; parts.Ties = ties;
}
console.log("cloth split", Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length / 3])));
const extraViews = []; // {bytes} -> appended
function addIndexAccessor(arr) {
  const bytes = Buffer.from(new Uint32Array(arr).buffer);
  const bv = J.bufferViews.length; J.bufferViews.push({ buffer: 0, byteLength: bytes.length, target: 34963 });
  extraViews.push({ bv, bytes });
  J.accessors.push({ bufferView: bv, componentType: 5125, count: arr.length, type: "SCALAR" });
  return J.accessors.length - 1;
}
const clothMatIdx = cloth.material;
const newPrims = [];
for (const [name, arr] of Object.entries(parts)) {
  const mat = JSON.parse(JSON.stringify(J.materials[clothMatIdx])); mat.name = `${J.materials[clothMatIdx].name}_${name}`;
  J.materials.push(mat);
  const mp = JSON.parse(JSON.stringify(VRM.materialProperties[clothMatIdx])); mp.name = mat.name; VRM.materialProperties.push(mp);
  newPrims.push({ ...JSON.parse(JSON.stringify(cloth)), indices: addIndexAccessor(arr), material: J.materials.length - 1 });
}
prims.splice(CLOTH_PRIM, 1, ...newPrims);

// ------------------------------------------------------------ 揺れもの・meta
VRM.secondaryAnimation.boneGroups = VRM.secondaryAnimation.boneGroups.filter((bg) => bg.comment !== "Bust");
VRM.meta.title = "ヴィクトリア・ルービン（ごほうび学習用 改変版）";
VRM.meta.reference = "VRoid β Ver AvatarSample_4 / pixiv Inc. (CC0) — modified: swimsuit texture, outfit split";

// ------------------------------------------------------------ バイナリの再構成
const chunks = []; let off = 0;
const pad4 = () => { const p = (4 - (off % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); off += p; } };
const viewData = (i) => { const bv = J.bufferViews[i]; return g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); };
const imgByView = new Map(); J.images.forEach((im, i) => { if (newImages.has(i)) { if (im.bufferView >= 0) imgByView.set(im.bufferView, i); } });
const extraByView = new Map(extraViews.map((e) => [e.bv, e.bytes]));
const origViewCount = J.bufferViews.length;
for (let i = 0; i < origViewCount; i++) {
  let data = extraByView.get(i) || (imgByView.has(i) ? newImages.get(imgByView.get(i)).bytes : viewData(i));
  if (imgByView.has(i)) J.images[imgByView.get(i)].mimeType = newImages.get(imgByView.get(i)).mime;
  pad4(); J.bufferViews[i].byteOffset = off; J.bufferViews[i].byteLength = data.length; chunks.push(data); off += data.length;
}
// 追加画像
for (const [ii, im] of J.images.entries()) if (im.bufferView === -1) {
  const data = newImages.get(ii).bytes; pad4();
  J.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: data.length }); im.bufferView = J.bufferViews.length - 1; chunks.push(data); off += data.length;
}
pad4();
const bin = Buffer.concat(chunks);
J.buffers = [{ byteLength: bin.length }];
fs.mkdirSync(path.dirname(OUT), { recursive: true });
writeGLB(OUT, J, bin);
// 確認用（水着が焼き込まれた後のテクスチャのみ）
if (process.env.DEBUG_TEX) { fs.writeFileSync(path.join(process.env.DEBUG_TEX, "body_swim.png"), PNG.sync.write(bodyPng)); }
console.log("wrote", OUT, (fs.statSync(OUT).size / 1048576).toFixed(2), "MB");
fs.rmSync(TMP, { recursive: true, force: true });
