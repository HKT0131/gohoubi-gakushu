// キャラクター描画（SVG・アニメ塗り）。成人女性（デフォルト25歳・社会人、約7頭身）として描く。
// ステージ: 0=全部着ている / 1=帽子・マフラー / 2=コート / 3=ブレザー / 4=ブラウス・スカート を脱いだ状態（水着）
// ※最終段階は水着（スカート付きワンピース水着）まで。これ以上の露出は描画しない。水着の下の体は描かない。
//
// 公開グローバル: LAYERS / MAX_STAGE / renderCharacter(svg, c, stage, expr) / setStage(svg, stage)
//                 face(c, expr) / shade(hex, amt) / mirror(d)
//
// SVG のパーツ構造（2.5D アニメーション用。data-pivot は回転・揺れの基準点 "x,y"＝viewBox座標）
//   <g data-part="hair-tail">        ポニーテールのテール（ポニーテール時のみ中身あり）
//   <g data-part="hair-back">        後ろ髪
//   <g data-part="body">             首から下の体（肌・水着・靴）
//   <g class="layer" data-layer="blouse|blazer|coat">  衣装（stage > i で .off）
//   <g class="layer" data-layer="accessory" data-part="scarf">  マフラー（体側）
//   <g data-part="hands">            手とノート
//   <g data-part="face-slot">        非表示。app.js の表情差し替え用の受け口（下記）
//   <g data-part="head">             頭全体（首かしげ用）
//      <g data-part="head-tilt">     静的な首の傾き（アニメーションは外側の head に掛ける）
//        <g data-part="face">        輪郭・肌・眉・鼻・頬（face() の出力。中に eyes / mouth）
//            <g data-part="eyes"> <g data-part="iris">… <g data-part="lids">… <g data-part="eyes-closed" display="none">…
//            <g data-part="mouth">
//        <g data-part="side-locks">  横髪（中に side-lock-l / side-lock-r。前髪の下に重なる）
//        <g data-part="hair-front">  前髪
//        <g data-part="glasses">     眼鏡（任意）
//        <g class="layer" data-layer="accessory" data-part="beret">  ベレー帽
//   ※ head-tilt の内側の data-pivot は、傾ける前の（head-tilt のローカル）座標。
//
// app.js は「耳の楕円 ellipse[cx=110][cy=102] を含む svg 直下の <g>」を顔グループとみなし、
// 表情変更時にその innerHTML を face(c, expr) で置き換える。head を1つのグループにまとめるため、
// その目印は非表示の face-slot に置き、書き込まれた内容を MutationObserver で head 内の face へ移す。

const LAYERS = [
  { id: "accessory", label: "ベレー帽とマフラー" },
  { id: "coat", label: "コート" },
  { id: "blazer", label: "ブレザー" },
  { id: "blouse", label: "ブラウスとスカート" },
];
const MAX_STAGE = LAYERS.length;

function shade(hex, amt) {
  let n = parseInt(String(hex).replace("#", ""), 16);
  if (isNaN(n)) n = 0x888888;
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// 左右反転（x → 300 - x）したパスを作る（M/L/C/Q/Z の絶対座標のみ対応）
function mirror(d) {
  let i = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (m) => (i++ % 2 === 0 ? String(+(300 - parseFloat(m)).toFixed(2)) : m));
}

const CharacterArt = (() => {
  "use strict";
  // ---------------- 色 ----------------
  const INK = "#1d1a33";      // 藍墨
  const SHADOW = "#3a3466";   // 影の寄せ色（青紫）
  const PAPER = "#f6eddc";    // 生成り
  function rgb(h) {
    h = String(h || "").trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) h = "888888";
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function fromHsl([h, s, l]) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // 極端な色を和らげ、紙色に少し寄せる（UI の生成り・藍墨になじませる）
  function tame(c, smax = 0.7, lmin = 0.08, lmax = 0.93) {
    const [h, s, l] = toHsl(rgb(c));
    return mix(hex(fromHsl([h, Math.min(s, smax), Math.max(lmin, Math.min(lmax, l))])), PAPER, 0.06);
  }
  const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  // 布の色セット: b=ベース sh=1影 dp=濃い影 hi=ハイライト ln=線
  function cloth(base) {
    const b = tame(base), dark = lum(b) < 0.3;
    return {
      b, sh: mix(b, SHADOW, dark ? 0.32 : 0.26), dp: mix(b, INK, dark ? 0.5 : 0.42),
      hi: mix(b, "#fff8ec", dark ? 0.2 : 0.32), ln: mix(b, dark ? "#07060f" : INK, dark ? 0.6 : 0.62),
    };
  }
  function palette(c) {
    const skin = tame(c.skin || "#fde3d3", 0.75, 0.22, 0.95);
    const hair = tame(c.hair || "#6b4a3a", 0.6, 0.1, 0.86);
    const eye = tame(c.eye || "#4a7bd0", 0.75, 0.15, 0.8);
    return {
      skin: { b: skin, sh: mix(skin, "#d8707a", 0.26), sh2: mix(skin, "#a8505e", 0.38), hi: mix(skin, "#fffaf4", 0.55), ln: mix(skin, "#5e2a30", 0.62) },
      hair: { b: hair, sh: mix(hair, "#2c2244", 0.34), dp: mix(hair, "#160f22", 0.58), hi: mix(hair, "#fff1e0", 0.4), ln: mix(hair, "#140c18", 0.62), brow: mix(hair, "#2a1a22", 0.45) },
      eye: { b: eye, dk: mix(eye, "#0d0a1e", 0.62), lt: mix(eye, "#ffffff", 0.45), pu: mix(eye, "#080614", 0.78) },
      lash: mix(hair, "#1c1220", 0.72),
      lip: mix(skin, "#c8505e", 0.5), mouth: mix(skin, "#7a2a38", 0.75), tongue: mix(skin, "#e0707c", 0.6),
      accent: cloth(c.accent || "#e85d8a"), accent2: cloth(c.accent2 || "#3f4a6b"),
      blazer: cloth(c.blazer || "#2f3b5c"), coat: cloth(c.coat || "#c9a27e"), beret: cloth(c.beret || "#8a3550"),
      swim: cloth(c.swim || "#4fb3c9"), shoe: cloth(c.shoe || "#3a2a2a"),
      white: { b: "#fbf8f1", sh: "#dcd7e6", dp: "#bdb6cf", hi: "#ffffff", ln: "#8c86a2" },
    };
  }

  // ---------------- 汎用 ----------------
  let seq = 0;
  const uid = () => "chr" + (++seq).toString(36) + "_";
  const TILT = -3, PIV = [150, 112]; // 首かしげ（静的）と首の付け根
  function W(x, y) { // 頭座標 → ワールド座標
    const a = (TILT * Math.PI) / 180, dx = x - PIV[0], dy = y - PIV[1];
    return [+(PIV[0] + dx * Math.cos(a) - dy * Math.sin(a)).toFixed(1), +(PIV[1] + dx * Math.sin(a) + dy * Math.cos(a)).toFixed(1)];
  }
  // クリップ付きの塗りパーツ: ベース → 影/ハイライト（形の内側だけ）→ 輪郭線
  function piece(id, d, k, o = {}) {
    const inner = []
      .concat((o.sh || []).map((p) => `<path d="${p}" fill="${o.shc || k.sh}"/>`))
      .concat((o.dp || []).map((p) => `<path d="${p}" fill="${k.dp}"/>`))
      .concat((o.hi || []).map((p) => `<path d="${p}" fill="${o.hic || k.hi}" opacity="${o.hio || 0.9}"/>`))
      .concat(o.inner ? [o.inner] : []).join("");
    return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${o.fill || k.b}"/>` +
      (inner ? `<g clip-path="url(#${id})">${inner}</g>` : "") +
      (o.noline ? "" : `<path d="${o.ol || d}" fill="none" stroke="${o.ln || k.ln}" stroke-width="${o.sw || 1.5}" stroke-linejoin="round"/>`);
  }
  const line = (d, col, w = 1, op = 1) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ""}/>`;
  const fillp = (d, col, op = 1) => `<path d="${d}" fill="${col}"${op < 1 ? ` opacity="${op}"` : ""}/>`;
  // 先細りの毛束（root から tip へ。bend で反り）
  function lock(x0, y0, x1, y1, w, bend = 0) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend, h = w / 2;
    const f = (v) => +v.toFixed(1);
    return `M${f(x0 - nx * h)} ${f(y0 - ny * h)} Q${f(mx - nx * h * 0.8)} ${f(my - ny * h * 0.8)} ${f(x1)} ${f(y1)} Q${f(mx + nx * h * 0.8)} ${f(my + ny * h * 0.8)} ${f(x0 + nx * h)} ${f(y0 + ny * h)} Z`;
  }

  // ---------------- 体の骨格（ワールド座標） ----------------
  // 重心は向かって左の脚。右腕（向かって右）は曲げてノートを持つ。
  const G = {
    torso: "M141 121 C134 127 122 130 113 135 C106 139 104 148 105 158 L121 160 C121 176 124 196 128 216 C124 232 116 246 114 262 C114 276 118 288 124 298 L176 300 C182 290 186 278 184 266 C182 250 176 232 172 216 C176 196 179 176 179 158 L195 156 C196 146 194 138 187 134 C178 130 166 127 159 121 Z",
    armL: "M113 135 C106 139 102 150 101 166 C100 182 98 198 97 212 C95 232 94 252 95 276 L105 278 C106 256 108 236 110 214 C113 196 117 178 121 160 Z",
    armR: "M187 134 C195 138 199 150 200 166 C201 182 205 196 209 206 C211 213 208 217 204 222 C200 233 195 245 191 257 L181 252 C185 240 188 228 191 216 C188 200 184 182 179 158 Z",
    legL: "M116 262 C112 292 114 332 120 372 C124 402 128 420 128 432 C127 452 125 472 127 497 C129 520 133 540 135 553 L147 553 C147 538 148 515 149 492 C150 467 148 447 147 432 C147 415 149 395 150 362 C151 332 151 306 150 292 Z",
    legR: "M184 266 C188 300 187 336 183 372 C180 397 177 416 176 430 C177 452 182 476 184 500 C186 520 186 536 185 549 L172 549 C171 535 168 513 165 493 C161 471 158 451 159 433 C159 415 156 394 154 366 C152 336 151 310 150 292 Z",
  };

  // ---------------- 後ろ髪 ----------------
  function hairBack(c, P, k) {
    const h = k.hair, st = c.hairStyle;
    const gid = P + "hbg";
    const grad = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h.b}"/><stop offset=".55" stop-color="${h.sh}"/><stop offset="1" stop-color="${h.dp}"/></linearGradient>`;
    // 頭の後ろ（頭座標）
    const skull = "M109 74 C104 44 122 17 151 17 C180 17 198 44 192 76 C192 92 188 104 182 112 L118 112 C112 104 109 92 108 74 Z";
    let headPart = "", world = "";
    if (st === "bob") {
      const bob = "M108 72 C104 44 122 17 151 17 C180 17 198 44 194 74 C196 92 196 110 191 122 C188 130 180 132 174 127 C170 124 166 124 162 126 L138 126 C134 124 130 124 126 127 C120 132 112 130 109 122 C104 110 104 92 107 72 Z";
      headPart = piece(P + "hbb", bob, h, {
        fill: `url(#${gid})`, sw: 1.5,
        dp: ["M118 84 C122 104 128 118 138 126 L162 126 C172 118 178 104 182 84 C170 96 132 96 118 84 Z"],
        inner: line("M114 100 C116 112 120 120 126 124", h.ln, 0.9, 0.6) + line("M186 100 C184 112 180 120 174 124", h.ln, 0.9, 0.6) +
          line("M110 86 C110 100 112 112 116 120", h.hi, 1.2, 0.5) + line("M190 86 C190 100 188 112 184 120", h.hi, 1.2, 0.35),
      });
    } else if (st === "ponytail") {
      headPart = piece(P + "hbp", "M110 70 C105 42 122 17 151 17 C180 17 197 42 191 70 C189 80 185 88 180 92 L120 92 C115 88 111 80 110 70 Z", h, { fill: `url(#${gid})`, dp: ["M118 80 C122 88 126 92 130 92 L170 92 C174 92 178 88 182 80 C170 86 130 86 118 80 Z"] });
    } else {
      headPart = piece(P + "hbs", skull, h, { fill: h.b, dp: ["M116 84 C120 100 128 110 136 112 L164 112 C172 110 180 100 184 84 C170 96 130 96 116 84 Z"] });
      // ロング: 背中に垂れる部分（ワールド座標・重力方向）
      const [lx, ly] = W(108, 74), [rx, ry] = W(193, 76);
      const longD = `M${lx} ${ly} C98 104 95 140 94 178 C93 214 95 246 99 270 L104 290 L110 278 L116 296 L124 282 L134 298 L146 286 L158 299 L168 285 L180 297 L188 280 L196 292 L201 272 C205 246 207 214 206 180 C205 142 202 106 ${rx} ${ry} Z`;
      world = piece(P + "hbl", longD, h, {
        fill: `url(#${gid})`, sw: 1.5,
        dp: ["M122 112 C122 150 126 200 132 240 L168 240 C174 200 178 150 178 112 Z"],
        inner: line("M104 120 C100 170 100 220 106 278", h.hi, 1.4, 0.45) + line("M196 124 C200 170 200 220 194 276", h.hi, 1.2, 0.3) +
          line("M112 160 C108 200 110 240 118 282", h.ln, 0.8, 0.55) + line("M188 160 C192 200 190 240 184 280", h.ln, 0.8, 0.55) +
          line("M100 200 C99 230 101 255 106 280", h.ln, 0.8, 0.4) + line("M200 200 C201 230 199 255 194 282", h.ln, 0.8, 0.4),
      });
    }
    return { defs: grad, head: headPart, world };
  }

  function hairTail(c, P, k) {
    if (c.hairStyle !== "ponytail") return "";
    const h = k.hair, a = k.accent;
    const gid = P + "htg";
    const [tx, ty] = W(184, 30); // 結び目
    const tail = `M${tx - 6} ${ty - 2} C${tx + 18} ${ty - 14} ${tx + 40} ${ty + 4} ${tx + 42} ${ty + 34} C${tx + 46} ${ty + 70} ${tx + 36} ${ty + 110} ${tx + 40} ${ty + 150} C${tx + 42} ${ty + 172} ${tx + 34} ${ty + 192} ${tx + 22} ${ty + 206} L${tx + 24} ${ty + 186} L${tx + 14} ${ty + 198} L${tx + 16} ${ty + 172} C${tx + 14} ${ty + 130} ${tx + 22} ${ty + 90} ${tx + 16} ${ty + 54} C${tx + 12} ${ty + 30} ${tx + 4} ${ty + 14} ${tx - 6} ${ty + 10} Z`;
    return `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h.b}"/><stop offset="1" stop-color="${h.sh}"/></linearGradient>` +
      piece(P + "htl", tail, h, {
        fill: `url(#${gid})`,
        sh: [`M${tx + 14} ${ty + 40} C${tx + 24} ${ty + 80} ${tx + 18} ${ty + 120} ${tx + 22} ${ty + 170} L${tx + 14} ${ty + 198} C${tx + 12} ${ty + 150} ${tx + 16} ${ty + 100} ${tx + 8} ${ty + 40} Z`],
        inner: line(`M${tx + 6} ${ty + 2} C${tx + 30} ${ty + 6} ${tx + 36} ${ty + 40} ${tx + 34} ${ty + 80}`, h.hi, 2, 0.55) +
          line(`M${tx + 30} ${ty + 60} C${tx + 30} ${ty + 100} ${tx + 26} ${ty + 140} ${tx + 30} ${ty + 180}`, h.ln, 0.8, 0.6) +
          line(`M${tx + 22} ${ty + 70} C${tx + 22} ${ty + 110} ${tx + 20} ${ty + 150} ${tx + 22} ${ty + 186}`, h.ln, 0.7, 0.45),
      }) +
      // シュシュ
      `<g transform="rotate(-25 ${tx} ${ty})">${piece(P + "scr", `M${tx - 8} ${ty - 7} C${tx - 2} ${ty - 11} ${tx + 6} ${ty - 10} ${tx + 9} ${ty - 5} C${tx + 12} ${ty} ${tx + 10} ${ty + 7} ${tx + 4} ${ty + 9} C${tx - 3} ${ty + 11} ${tx - 10} ${ty + 6} ${tx - 10} ${ty} C${tx - 10} ${ty - 3} ${tx - 9} ${ty - 6} ${tx - 8} ${ty - 7} Z`, a, {
        sh: [`M${tx - 10} ${ty + 1} C${tx - 4} ${ty + 4} ${tx + 4} ${ty + 4} ${tx + 11} ${ty} L${tx + 11} ${ty + 12} L${tx - 11} ${ty + 12} Z`],
        inner: line(`M${tx - 4} ${ty - 9} C${tx - 2} ${ty - 2} ${tx - 3} ${ty + 4} ${tx - 5} ${ty + 9}`, a.ln, 0.8, 0.6) + line(`M${tx + 3} ${ty - 10} C${tx + 5} ${ty - 2} ${tx + 4} ${ty + 4} ${tx + 2} ${ty + 10}`, a.ln, 0.8, 0.6) +
          line(`M${tx - 6} ${ty - 6} C${tx - 1} ${ty - 9} ${tx + 4} ${ty - 9} ${tx + 7} ${ty - 6}`, a.hi, 1.4, 0.8),
      })}</g>`;
  }

  // ---------------- 体（肌・水着・靴） ----------------
  function bodyArt(c, P, k) {
    const s = k.skin;
    const neck = "M141 98 L141 124 C146 129 154 129 159 124 L159 98 Z";
    const legs =
      piece(P + "lgL", G.legL, s, {
        sh: ["M116 262 C112 292 114 332 120 372 C124 402 128 420 128 432 C127 452 125 472 127 497 C129 520 133 540 135 553 L139 553 C136 530 133 505 134 480 C135 455 134 440 133 430 C131 410 126 380 124 340 C122 310 122 290 124 270 Z",
          "M150 292 C147 330 145 360 144 380 L151 380 Z"],
        hi: ["M141 448 C143 470 143 500 141 530 L143 530 C146 500 146 470 143 448 Z"], hio: 0.7, sw: 1.3,
        inner: line("M133 424 C136 428 140 429 143 427", s.ln, 0.8, 0.5),
      }) +
      piece(P + "lgR", G.legR, s, {
        sh: ["M150 292 C151 310 152 336 154 366 C156 394 159 415 159 433 C158 451 161 471 165 493 C168 513 171 535 172 549 L177 549 C175 530 170 505 168 482 C166 460 166 445 167 432 C166 410 162 380 160 350 C158 320 158 300 158 292 Z"],
        hi: ["M178 450 C181 470 182 495 181 520 L183 520 C184 495 183 470 180 450 Z"], hio: 0.7, sw: 1.3,
        inner: line("M163 424 C166 428 170 428 173 425", s.ln, 0.8, 0.5),
      });
    const torso = piece(P + "tor", G.torso, s, {
      sh: ["M105 158 L121 160 C121 176 124 196 128 216 L140 300 L100 300 Z"], sw: 1.3,
      inner: line("M131 135 C135 136 139 136 142 135", s.ln, 0.8, 0.45) + line("M158 135 C161 136 165 136 169 135", s.ln, 0.8, 0.45),
    });
    const arms =
      piece(P + "amL", G.armL, s, { ol: "M113 135 C106 139 102 150 101 166 C100 182 98 198 97 212 C95 232 94 252 95 276 M105 278 C106 256 108 236 110 214 C113 196 117 178 121 160", sh: ["M113 135 C106 139 102 150 101 166 C100 182 98 198 97 212 C95 232 94 252 95 276 L100 277 C100 250 101 230 103 212 C105 192 108 170 112 150 Z"], sw: 1.3 }) +
      piece(P + "amR", G.armR, s, { ol: "M187 134 C195 138 199 150 200 166 C201 182 205 196 209 206 C211 213 208 217 204 222 C200 233 195 245 191 257 M181 252 C185 240 188 228 191 216 C188 200 184 182 179 158", sh: ["M179 158 C184 182 188 200 191 216 C188 228 185 240 181 252 L186 254 C190 240 194 228 197 216 C194 198 190 178 186 160 Z"], sw: 1.3,
        inner: line("M199 207 C202 210 204 212 205 216", s.ln, 0.8, 0.5) });
    const neckP = piece(P + "nck", neck, s, { sh: ["M141 98 L159 98 L159 108 C154 116 146 116 141 108 Z", "M141 108 L146 126 L141 126 Z"], sw: 1.2 });
    // 靴（ローヒールのパンプス）
    const sh = k.shoe;
    const shoeL = "M134 549 C130 556 127 564 128 570 C130 576 146 578 151 573 C153 568 151 558 148 549 C144 552 138 552 134 549 Z";
    const shoeR = "M172 545 C169 554 171 563 178 568 C186 574 199 573 199 566 C198 559 191 551 186 545 C182 548 176 548 172 545 Z";
    const shoes =
      piece(P + "shL", shoeL, sh, { sh: ["M128 562 C134 568 144 570 152 566 L152 580 L126 580 Z"], hi: ["M140 556 C144 556 147 558 148 562 C145 560 142 559 140 556 Z"], sw: 1.4 }) +
      piece(P + "shR", shoeR, sh, { sh: ["M170 558 C178 566 190 570 200 566 L200 580 L168 580 Z"], hi: ["M188 553 C192 555 195 558 196 562 C193 560 190 557 188 553 Z"], sw: 1.4 }) +
      fillp("M133 551 C138 554 144 554 148 551 C146 548 136 548 133 551 Z", s.sh, 0.9) + fillp("M173 547 C177 550 183 550 186 547 C184 545 175 545 173 547 Z", s.sh, 0.9);
    const ground = `<ellipse cx="162" cy="575" rx="44" ry="5" fill="${INK}" opacity=".12"/>`;
    return ground + legs + shoes + torso + arms + neckP + swimsuit(c, P, k);
  }

  // 水着: スカート付きのワンピース水着（露出控えめ）
  function swimsuit(c, P, k) {
    const w = k.swim;
    const suit = "M121 141 L133 136 C137 150 143 157 150 157 C157 157 163 150 167 134 L179 139 C179 146 179 152 179 158 C179 176 176 196 172 214 C176 226 182 242 186 258 C194 274 198 290 198 304 C186 310 168 312 150 311 C132 312 114 310 102 302 C102 288 106 272 114 258 C118 242 124 226 128 214 C124 196 121 176 121 158 C121 152 121 146 121 141 Z";
    return piece(P + "sw", suit, w, {
      sh: ["M121 141 L133 136 C137 150 143 157 150 157 L150 166 C140 166 132 160 128 150 Z", "M121 158 C121 176 124 196 128 214 C124 226 118 242 114 258 C106 272 102 288 102 302 L118 308 C116 280 124 250 132 220 C128 196 126 176 126 158 Z",
        "M142 230 C140 260 138 285 140 311 L148 311 C147 285 148 258 150 232 Z", "M168 236 C172 262 176 284 176 310 L184 309 C184 284 180 260 172 236 Z"],
      hi: ["M166 150 C172 160 173 180 170 200 C172 182 172 164 166 150 Z", "M186 270 C190 280 192 292 192 302 L195 302 C195 290 192 278 186 270 Z"],
      inner: line("M128 214 C142 218 158 218 172 214", w.ln, 1, 0.8) + line("M128 216.5 C142 220.5 158 220.5 172 216.5", "#ffffff", 1.4, 0.75) +
        line("M104 298 C120 306 138 308 150 308 C164 308 182 306 196 300", "#ffffff", 1.4, 0.65) +
        line("M134 139 C138 152 144 157 150 157 C156 157 162 152 166 137", "#ffffff", 1.3, 0.7) +
        line("M122 244 C120 266 116 284 112 300", w.ln, 0.8, 0.5) + line("M158 240 C160 264 162 286 162 308", w.ln, 0.8, 0.5) +
        line("M178 240 C184 262 188 282 190 302", w.ln, 0.8, 0.45),
      sw: 1.5,
    }) + bow(150, 160, 0.55, k.accent, P + "swb");
  }

  // リボン結び（cx,cy 中心、scale）
  function bow(cx, cy, sc, a, id) {
    const T = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(cx + x * sc).toFixed(1)} ${+(cy + y * sc).toFixed(1)}`);
    const loopL = T("M-3 -2 C-10 -12 -24 -12 -25 -3 C-26 5 -14 8 -3 3 Z"), loopR = mirrorAt(loopL, cx);
    const tailL = T("M-3 3 C-7 12 -11 22 -14 30 L-8 28 L-5 33 C-3 24 -1 12 1 4 Z"), tailR = mirrorAt(tailL, cx);
    const knot = T("M-4 -4 C-2 -6 2 -6 4 -4 C5 -1 5 2 4 4 C2 6 -2 6 -4 4 C-5 2 -5 -1 -4 -4 Z");
    const o = (d, sfx, sh) => piece(id + sfx, d, a, { sh: sh ? [sh] : [], sw: 1.1 });
    return o(tailL, "tl", T("M-6 10 L-14 30 L-30 30 L-30 10 Z")) + o(tailR, "tr", T("M2 4 L-4 4 L-1 33 L4 33 Z")) +
      o(loopL, "ll", T("M-25 -1 C-20 5 -12 6 -3 2 L-3 8 L-30 8 Z")) + o(loopR, "lr", T("M25 -1 C20 5 12 6 3 2 L3 8 L30 8 Z")) +
      line(T("M-8 -4 C-13 -7 -18 -7 -21 -4"), a.hi, 1, 0.8) + line(T("M8 -4 C13 -7 18 -7 21 -4"), a.hi, 1, 0.8) + o(knot, "kn", T("M-5 1 L5 1 L5 6 L-5 6 Z"));
  }
  function mirrorAt(d, cx) { let i = 0; return d.replace(/-?\d+(\.\d+)?/g, (m) => (i++ % 2 === 0 ? String(+(2 * cx - parseFloat(m)).toFixed(1)) : m)); }

  // ---------------- ブラウス＋プリーツスカート ----------------
  function blouseArt(c, P, k) {
    const w = k.white, sk = k.accent2;
    // スカート（腰〜膝上）
    const band = "M125 211 L175 211 L176 222 L124 222 Z";
    const hemPts = [[91, 377], [100, 385], [111, 379], [123, 388], [136, 381], [150, 390], [164, 382], [178, 391], [191, 384], [203, 392], [214, 386]];
    const topX = [124, 130, 135, 140, 145, 150, 155, 160, 165, 170, 176];
    const hemRev = hemPts.slice(0, -1).reverse().map((p) => `L${p[0]} ${p[1]}`).join(" ");
    const skirt = `M124 222 L176 222 C183 240 190 260 194 280 C201 312 208 350 214 386 ${hemRev} C96 345 101 310 106 280 C110 260 117 240 124 222 Z`;
    let pleats = "", panels = [];
    for (let i = 1; i < hemPts.length - 1; i++) {
      pleats += line(`M${topX[i]} 222 C${(topX[i] * 2 + hemPts[i][0]) / 3} 290 ${hemPts[i][0]} 340 ${hemPts[i][0]} ${hemPts[i][1]}`, sk.ln, i % 2 ? 1.1 : 0.7, i % 2 ? 0.9 : 0.6);
      if (i % 2) panels.push(`M${topX[i]} 222 L${topX[i + 1]} 222 L${hemPts[i + 1][0]} ${hemPts[i + 1][1]} L${hemPts[i][0]} ${hemPts[i][1]} Z`);
    }
    const skirtP = piece(P + "sk", skirt, sk, {
      sh: panels.concat(["M124 222 C117 240 110 260 106 280 C100 310 94 345 88 377 L100 385 C104 340 112 290 128 222 Z", "M138 300 L162 300 L164 392 L136 392 Z"]),
      hi: ["M176 222 C182 240 188 262 192 284 C196 304 200 330 204 360 C200 330 194 300 188 276 C184 258 180 240 176 222 Z"],
      inner: pleats, sw: 1.5,
    });
    const bandP = piece(P + "skb", band, sk, { sh: ["M124 218 L176 218 L176 222 L124 222 Z"], sw: 1.2 });
    // ブラウス胴
    const torso = "M141 119 C132 125 121 130 112 134 C104 138 101 149 102 160 L120 163 C120 180 122 198 125 214 C134 217 166 217 175 214 C178 198 180 180 180 162 L198 158 C199 147 195 138 188 133 C180 129 169 125 159 119 Z";
    const torsoP = piece(P + "bl", torso, w, {
      sh: ["M102 160 L120 163 C120 180 122 198 125 214 L134 216 C130 196 128 178 128 160 C126 150 120 142 112 138 Z", "M141 119 L159 119 L156 134 L150 140 L144 134 Z",
        "M128 178 C136 186 144 190 150 190 C140 194 132 192 128 186 Z", "M150 196 C152 204 152 212 150 216 L146 216 C148 210 149 204 150 196 Z"],
      inner: line("M150 146 L150 214", w.ln, 0.9, 0.8) + [168, 190, 208].map((y) => `<circle cx="152.5" cy="${y}" r="1.4" fill="${w.b}" stroke="${w.ln}" stroke-width=".7"/>`).join("") +
        line("M134 200 C138 206 140 210 140 215", w.dp, 0.9, 0.7) + line("M166 198 C163 205 161 210 161 215", w.dp, 0.9, 0.7) +
        line("M122 170 C126 176 128 180 128 186", w.dp, 0.8, 0.6),
      sw: 1.3,
    });
    const slL = "M112 134 C104 139 99 150 98 166 C97 184 95 199 94 213 C92 234 91 254 92 268 L106 270 C106 252 108 234 111 214 C114 196 117 180 120 163 Z";
    const slR = "M188 133 C197 138 201 150 202 166 C203 182 207 194 211 204 C214 212 211 218 206 223 C202 234 197 246 193 258 L180 252 C184 240 187 228 190 217 C187 200 184 182 180 162 Z";
    const sleeves =
      piece(P + "slL", slL, w, { sh: ["M112 134 C104 139 99 150 98 166 C97 184 95 199 94 213 C92 234 91 254 92 268 L99 268 C99 250 100 232 102 214 C104 192 106 170 110 150 Z", "M96 210 C100 214 105 214 110 212 L109 220 C104 220 99 219 96 216 Z"],
        inner: line("M100 215 C103 218 107 218 110 216", w.ln, 0.8, 0.6) + line("M98 240 C100 242 103 243 106 242", w.ln, 0.7, 0.4), sw: 1.3 }) +
      piece(P + "slR", slR, w, { sh: ["M180 162 C184 182 187 200 190 217 C187 228 184 240 180 252 L186 255 C190 242 193 230 196 218 C193 200 190 180 186 162 Z"],
        inner: line("M198 204 C202 206 205 210 206 214", w.ln, 0.8, 0.6) + line("M201 198 C205 201 208 204 209 207", w.ln, 0.7, 0.5) + line("M196 224 C200 223 203 222 206 220", w.ln, 0.8, 0.5), sw: 1.3 }) +
      piece(P + "cfL", "M91 266 L107 268 L106 279 L91 277 Z", w, { sh: ["M91 274 L107 276 L107 280 L91 280 Z"], inner: `<circle cx="102" cy="273" r="1.2" fill="${w.ln}"/>`, sw: 1.2 }) +
      piece(P + "cfR", "M179 251 L194 258 L190 268 L176 261 Z", w, { sh: ["M176 259 L192 266 L190 270 L174 263 Z"], sw: 1.2 });
    // 襟とリボン
    const colL = "M141 117 C139 125 137 133 133 142 L146 140 L150 133 Z";
    const collar = piece(P + "coL", colL, w, { sh: ["M137 134 L146 140 L133 142 Z"], sw: 1.2 }) + piece(P + "coR", mirror(colL), w, { sh: ["M163 134 L154 140 L167 142 Z"], sw: 1.2 });
    return skirtP + bandP + sleeves + torsoP + collar + bow(150, 140, 0.62, k.accent, P + "blb");
  }

  // ---------------- テーラードブレザー ----------------
  function blazerArt(c, P, k) {
    const b = k.blazer;
    const panelL = "M141 118 C132 124 120 129 109 133 C101 137 98 148 99 162 L118 166 C118 186 120 204 122 220 C117 238 112 260 111 286 C122 292 134 293 144 290 C146 268 148 244 150 225 C147 196 145 168 146 148 C145 136 143 126 141 118 Z";
    const panelR = "M159 118 C168 124 180 129 191 133 C199 137 202 148 201 162 L182 166 C182 186 180 204 178 220 C183 238 188 260 189 286 C178 292 166 293 156 290 C156 268 153 246 150 225 C153 196 155 168 154 148 C155 136 157 126 159 118 Z";
    const lapL = "M141 117 C137 124 132 130 126 135 L131 144 L126 149 C133 172 141 199 150 224 C147 196 145 168 146 148 C145 136 143 126 141 117 Z";
    const lapR = mirror(lapL);
    const slL = "M110 132 C101 137 96 149 95 166 C94 184 92 199 91 213 C89 234 88 252 89 264 L107 266 C107 248 109 232 112 214 C115 197 118 182 121 165 Z";
    const slR = "M190 132 C199 137 203 150 204 166 C205 182 209 193 214 203 C217 212 214 219 208 225 C204 236 199 246 195 255 L178 248 C182 236 186 226 188 217 C185 200 182 182 180 164 Z";
    const body =
      piece(P + "bzL", panelL, b, {
        sh: ["M99 162 L118 166 C118 186 120 204 122 220 C117 238 112 260 111 286 L124 290 C124 262 128 236 130 214 C128 196 126 178 126 160 C122 148 114 140 109 136 Z", "M146 148 C145 168 147 196 150 225 L144 290 L138 290 C142 262 144 236 146 214 C144 190 143 168 146 148 Z"],
        inner: line("M128 172 C129 200 128 230 126 288", b.ln, 0.8, 0.6) + piece(P + "pkL", "M114 256 L136 255 L136 262 L113 264 Z", b, { sh: ["M113 261 L136 260 L136 264 L113 264 Z"], sw: 0.9 }),
        sw: 1.6,
      }) +
      piece(P + "bzR", panelR, b, {
        sh: ["M156 290 C156 268 153 246 150 225 L158 224 C160 246 162 268 164 290 Z"],
        hi: ["M186 172 C186 196 184 210 182 222 C186 240 188 260 189 282 L186 282 C185 260 182 240 179 222 C181 208 182 190 182 172 Z"],
        inner: line("M172 172 C171 200 172 230 174 288", b.ln, 0.8, 0.6) + piece(P + "pkR", "M164 255 L186 256 L187 264 L164 262 Z", b, { sh: ["M164 260 L187 261 L187 264 L164 262 Z"], sw: 0.9 }),
        sw: 1.6,
      });
    const laps =
      piece(P + "lpL", lapL, b, { fill: b.sh, inner: line("M128 137 C134 160 142 192 149 220", b.hi, 0.8, 0.5), sw: 1.3 }) +
      piece(P + "lpR", lapR, b, { fill: mix(b.b, b.hi, 0.35), inner: line("M172 137 C166 160 158 192 151 220", b.hi, 0.9, 0.7), sw: 1.3 });
    const sleeves =
      piece(P + "bsL", slL, b, { sh: ["M110 132 C101 137 96 149 95 166 C94 184 92 199 91 213 C89 234 88 252 89 264 L97 265 C97 248 98 232 100 214 C102 192 104 170 108 150 Z"],
        inner: line("M93 214 C98 218 104 218 111 215", b.ln, 0.9, 0.7) + line("M92 254 L107 256", b.ln, 0.8, 0.6) + [258, 261].map((y) => `<circle cx="103" cy="${y}" r="1" fill="#d9b860"/>`).join(""), sw: 1.6 }) +
      piece(P + "bsR", slR, b, { sh: ["M180 164 C182 182 185 200 188 217 C186 226 182 236 178 248 L184 251 C188 240 192 230 195 220 C192 202 189 182 186 164 Z"],
        hi: ["M197 150 C200 160 201 172 202 182 C203 190 206 196 209 202 C205 196 201 188 200 178 C199 168 199 158 197 150 Z"],
        inner: line("M199 204 C203 207 206 211 208 215", b.ln, 0.9, 0.7) + line("M194 226 C199 226 204 224 209 220", b.ln, 0.8, 0.6) + line("M180 243 L196 250", b.ln, 0.8, 0.6), sw: 1.6 });
    const btn = `<circle cx="150" cy="226" r="3.2" fill="#d6b25a" stroke="${mix("#d6b25a", INK, 0.5)}" stroke-width=".9"/><circle cx="149" cy="225" r="1" fill="#fff4cc"/>`;
    return sleeves + body + laps + btn;
  }

  // ---------------- トレンチコート ----------------
  function coatArt(c, P, k) {
    const t = k.coat;
    const coatD = "M141 116 C130 122 116 128 106 133 C98 138 95 150 96 164 L117 168 C116 186 118 204 120 214 L180 214 C182 204 184 186 183 166 L204 162 C205 150 202 139 194 133 C184 128 170 122 159 116 Z";
    const skirtD = "M120 222 L180 222 C193 246 202 272 205 300 C209 350 215 400 224 448 C198 455 172 456 152 453 C128 456 104 455 77 448 C86 400 93 350 96 300 C99 272 107 246 120 222 Z";
    const slL = "M106 132 C97 137 91 150 90 168 C89 186 88 200 87 214 C85 234 84 254 85 270 L108 272 C108 254 110 234 113 216 C116 198 119 182 122 166 Z";
    const slR = "M194 132 C203 138 207 151 208 168 C209 182 213 192 218 202 C221 212 218 220 211 227 C207 238 202 250 197 260 L176 251 C181 238 185 228 187 218 C184 200 181 182 179 165 Z";
    const sleeves =
      piece(P + "csL", slL, t, { sh: ["M106 132 C97 137 91 150 90 168 C89 186 88 200 87 214 C85 234 84 254 85 270 L95 271 C95 252 96 232 98 214 C100 190 103 166 108 146 Z"],
        inner: line("M89 216 C95 220 103 220 112 217", t.ln, 0.9, 0.7) + line("M90 236 C94 238 98 238 101 236", t.ln, 0.7, 0.4), sw: 1.6 }) +
      piece(P + "ctL", "M85 254 L109 256 L109 264 L85 262 Z", t, { fill: t.sh, inner: `<rect x="99" y="256.5" width="5" height="6" rx="1" fill="none" stroke="${mix(t.b, INK, 0.75)}" stroke-width="1"/>`, sw: 1.1 }) +
      piece(P + "csR", slR, t, { sh: ["M179 165 C181 182 184 200 187 218 C185 228 181 238 176 251 L183 254 C187 242 191 230 194 220 C191 202 188 182 185 165 Z"],
        hi: ["M199 146 C203 158 204 170 205 182 C206 190 209 196 212 202 C208 196 204 188 203 178 C202 166 202 156 199 146 Z"],
        inner: line("M200 206 C205 209 208 213 210 218", t.ln, 0.9, 0.7) + line("M194 228 C200 228 206 226 212 222", t.ln, 0.8, 0.6), sw: 1.6 }) +
      piece(P + "ctR", "M178 241 L199 250 L196 257 L175 248 Z", t, { fill: t.sh, sw: 1.1 });
    const skirt = piece(P + "cks", skirtD, t, {
      sh: ["M120 222 C110 246 103 270 101 300 C97 350 90 400 80 448 L100 452 C104 400 112 340 118 300 C120 270 124 246 132 222 Z", "M142 300 C140 350 138 400 136 454 L146 454 C146 400 147 350 150 300 Z",
        "M158 230 L160 452 L156 452 L154 230 Z"],
      hi: ["M186 240 C192 270 196 300 198 330 C202 370 206 410 212 446 L208 447 C202 410 198 370 194 330 C192 300 190 270 186 240 Z"],
      inner: line("M157 222 C158 300 160 380 160 452", t.ln, 1.2, 0.9) + line("M124 236 C118 300 110 380 104 450", t.dp, 0.8, 0.5) + line("M176 236 C182 300 190 380 196 450", t.dp, 0.8, 0.5) +
        line("M84 440 C110 446 130 448 150 446 C174 448 196 446 216 440", t.ln, 0.8, 0.6) +
        line("M106 292 L114 318", t.ln, 1.1, 0.8) + line("M108 291 L116 317", t.hi, 0.8, 0.5),
      sw: 1.6,
    });
    const top = piece(P + "ckt", coatD, t, {
      sh: ["M96 164 L117 168 C116 186 118 204 120 214 L132 214 C128 196 126 178 126 162 C122 148 114 138 106 134 C98 140 95 152 96 164 Z", "M141 116 L159 116 L150 140 Z"],
      // ストームフラップと前合わせ
      inner: fillp("M159 120 C168 126 178 131 186 136 C190 150 188 160 182 168 C176 160 168 152 162 148 Z", t.sh) + line("M159 120 C168 126 178 131 186 136 C190 150 188 160 182 168", t.ln, 1, 0.8) +
        line("M157 150 L158 214", t.ln, 1.2, 0.9) + [[146, 170], [168, 170], [146, 196], [168, 196]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${t.dp}" stroke="${t.ln}" stroke-width=".8"/><circle cx="${x - 0.7}" cy="${y - 0.7}" r=".8" fill="${t.hi}"/>`).join("") +
        line("M106 133 L118 138", t.ln, 1, 0.8) + line("M194 133 L182 138", t.ln, 1, 0.8),
      sw: 1.6,
    });
    // 大きな襟
    const lapL = "M141 115 C136 122 130 127 122 131 L127 140 L120 145 C128 160 138 176 148 190 L150 150 C147 140 144 128 141 115 Z";
    const lapR = "M159 115 C164 122 170 127 178 131 L173 140 L180 145 C174 158 166 170 158 180 L152 152 C154 140 156 128 159 115 Z";
    const laps = piece(P + "clL", lapL, t, { fill: t.sh, inner: line("M124 133 C130 150 140 168 147 184", t.hi, 0.8, 0.5), sw: 1.4 }) +
      piece(P + "clR", lapR, t, { fill: mix(t.b, t.hi, 0.4), inner: line("M176 133 C170 150 164 162 159 174", t.ln, 0.7, 0.5), sw: 1.4 });
    // ベルト（結び目付き）
    const belt = piece(P + "cbt", "M119 212 C140 216 160 216 181 212 L181 224 C160 228 140 228 119 224 Z", t, { fill: t.sh, inner: line("M120 215 C140 219 160 219 180 215", t.ln, 0.6, 0.5) + line("M120 221 C140 225 160 225 180 221", t.ln, 0.6, 0.5), sw: 1.4 }) +
      piece(P + "cbk", "M127 213 L139 214 L139 226 L127 225 Z", t, { fill: "none", ln: "#c9a24c", sw: 1.8 }) +
      piece(P + "cbe", "M133 224 C131 236 128 250 126 262 L133 263 C135 250 137 238 139 225 Z", t, { fill: t.sh, sw: 1.2 }) +
      piece(P + "cbf", "M139 224 C141 238 143 252 144 270 L150 268 C148 252 146 238 144 225 Z", t, { sw: 1.2, sh: ["M139 224 L142 224 L146 270 L144 270 Z"] });
    return sleeves + skirt + top + laps + belt;
  }

  // ---------------- マフラー ----------------
  function scarfArt(c, P, k) {
    const a = k.accent;
    const wrap = "M131 116 C138 124 162 124 170 116 C176 120 180 128 178 136 C170 146 132 146 122 138 C120 130 124 121 131 116 Z";
    const tail = "M132 138 C128 156 126 176 124 196 C123 204 124 212 126 218 L146 218 C146 200 146 178 148 160 C148 150 146 144 142 140 Z";
    const knot = "M128 128 C134 124 144 126 148 134 C150 142 144 150 136 150 C128 150 124 144 124 138 C124 133 125 130 128 128 Z";
    const rib = (x0, x1, y0, y1, n) => { let s = ""; for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n; s += line(`M${x.toFixed(1)} ${y0} L${(x - 1).toFixed(1)} ${y1}`, a.sh, 1, 0.8); } return s; };
    const fringe = [127, 131, 135, 139, 143].map((x) => line(`M${x} 218 L${x - 0.5} 226`, a.sh, 2, 1) + line(`M${x} 218 L${x - 0.5} 226`, a.ln, 0.5, 0.5)).join("");
    const tail2 = "M146 136 C150 152 152 168 152 186 C152 192 153 197 155 200 L169 197 C168 182 166 164 162 146 C160 140 158 136 156 134 Z";
    const fringe2 = [154, 158, 162, 166].map((x) => line(`M${x} ${199 - (x - 154) * 0.25} L${x + 0.5} ${206 - (x - 154) * 0.25}`, a.sh, 2, 1)).join("");
    return fringe2 + piece(P + "sf2", tail2, a, { fill: a.sh, inner: rib(148, 166, 140, 198, 4) + line("M154 192 L168 189", a.ln, 0.8, 0.6), sw: 1.3 }) +
      fringe +
      piece(P + "sft", tail, a, { sh: ["M132 138 C128 156 126 176 124 196 C123 204 124 212 126 218 L132 218 C131 196 133 170 137 142 Z"], hi: ["M141 146 C142 170 142 194 142 214 L144 214 C144 194 144 170 143 146 Z"], hio: 0.5, inner: rib(126, 146, 148, 218, 5) + line("M126 210 L146 210", a.ln, 0.8, 0.6) + line("M126 213 L146 213", a.sh, 0.8, 0.8), sw: 1.4 }) +
      piece(P + "sfw", wrap, a, { sh: ["M122 136 C132 144 168 144 178 134 L180 150 L120 150 Z", "M131 116 C126 122 122 130 122 138 L130 140 C128 132 130 124 134 118 Z"],
        inner: [136, 144, 152, 160, 168].map((x) => line(`M${x} 122 C${x + 1} 130 ${x + 1} 136 ${x} 143`, a.sh, 1.1, 0.85)).join("") + line("M134 120 C146 125 158 125 168 120", a.hi, 1.4, 0.7),
        sw: 1.4 }) +
      piece(P + "sfk", "M127 134 C133 131 143 132 147 137 C148 143 144 147 137 147 C131 147 126 144 125 140 C125 137 126 135 127 134 Z", a, { sh: ["M125 141 C131 147 143 148 148 141 L148 150 L124 150 Z"], inner: line("M131 135 C138 134 143 135 146 138", a.hi, 1.1, 0.7) + line("M136 133 C136 138 137 142 139 146", a.sh, 0.9, 0.8), sw: 1.3 });
  }

  // ---------------- 手とノート ----------------
  function handsArt(c, P, k) {
    const s = k.skin;
    // 向かって左: 力を抜いて下ろした手（親指が手前）
    const handL = "M95 276 C92 283 91 291 93 298 C94 303 96 307 99 308 C101 309 103 307 103 305 C104 307 106 307 107 305 C108 301 108 296 107 292 C109 294 111 296 112 296 C114 295 113 292 111 289 C109 285 107 281 105 277 Z";
    const left = piece(P + "hdL", handL, s, { sh: ["M95 276 C92 283 91 291 93 298 C94 303 96 307 99 308 L100 300 C98 292 98 284 100 277 Z"], hi: ["M104 282 C106 286 107 290 107 294 C105 290 104 286 104 282 Z"],
      inner: line("M99 296 C100 300 101 303 103 305", s.ln, 0.8, 0.7) + line("M103 294 C104 298 105 302 106 304", s.ln, 0.6, 0.5), sw: 1.2 });
    // 向かって右: ノートを持つ手
    const nb = "M155 254 L193 259 L188 314 L150 309 Z";
    const nbk = cloth("#9c4f42"), pg = { b: "#f7f1e3", sh: "#e2d8c4", ln: "#9c8f78", hi: "#fff", dp: "#cfc3ab" };
    const book = piece(P + "nbp", "M150 309 L188 314 L189 318 L151 313 Z", pg, { sw: 0.9, inner: line("M151 311 L188 316", pg.ln, 0.5, 0.6) }) +
      piece(P + "nb", nb, nbk, { sh: ["M155 254 L160 255 L155 310 L150 309 Z"], hi: ["M193 259 L191 280 L189 280 L191 259 Z"],
        inner: piece(P + "nbl", "M163 274 L182 276.5 L181 285 L162 282.5 Z", pg, { sw: 0.7 }) + line("M165 278 L179 280", pg.ln, 0.6, 0.7) + line("M165 281 L173 282", pg.ln, 0.6, 0.6) +
          line("M152 298 L189 303", nbk.dp, 1.2, 0.6),
        sw: 1.4 });
    const handR = "M181 251 C176 254 172 258 172 263 C171 268 173 272 176 273 C178 274 180 272 180 270 C181 273 184 274 186 272 C188 271 188 268 188 266 C190 268 192 268 193 266 C195 263 194 259 192 257 Z";
    const right = piece(P + "hdR", handR, s, { sh: ["M181 251 C176 254 172 258 172 263 L180 262 C182 258 184 255 186 253 Z"], hi: ["M187 255 C190 257 192 259 192 262 C190 259 188 257 187 255 Z"],
      inner: line("M180 263 C180 266 180 268 180 270", s.ln, 0.8, 0.7) + line("M187 262 C187 264 188 266 188 266", s.ln, 0.8, 0.7), sw: 1.2 }) +
      piece(P + "thR", "M181 252 C177 249 172 248 169 250 C167 252 169 254 172 254 C175 254 178 255 181 256 Z", s, { sh: ["M169 252 L182 254 L182 258 L168 256 Z"], sw: 1.1 });
    return left + book + right;
  }

  // ---------------- 顔（表情差分） ----------------
  // 目の形（向かって左の目。右目は mirror）
  const EYE = {
    white: "M127.5 78.5 C129 72 134 69.5 139 69.5 C142.6 69.5 144.7 71.6 145.6 74.6 C145 79 141.2 83 136.6 83 C132.2 83 129.2 81 127.5 78.5 Z",
    lash: "M122.6 78.2 C124.6 77.8 126.2 77.2 127.2 76.2 C129.2 70.6 134 67.6 139.6 67.6 C143.2 67.6 145.8 70 146.8 73.6 L145.6 75.2 C144.4 72 142.2 70.6 139.2 70.6 C134.4 70.6 130.4 72.8 128.6 78.8 C126.8 79.8 124.6 79.4 122.6 78.2 Z",
    shadow: "M127 70 L147 70 L147 75.5 C144 72.6 141.8 72.2 139 72.2 C134 72.2 130.4 74 128.4 80 Z",
    crease: "M129.6 68.6 C132.6 66.2 137.4 65.2 141.8 66",
    lower: "M129.8 81.4 C132.4 83.4 135.4 84 138.4 83.8",
    outer: "M126.4 79.2 C127.6 80.8 128.6 81.4 129.6 81.6",
    closed: "M126 76.6 C130 79.8 135 81 140 80.4 C142.6 80 144.6 78.8 146 77.2",
    happy: "M126.6 79 C130 72.2 140.6 71.2 146 76.6",
  };

  function face(c, expr = "normal") {
    const k = palette(c), P = uid(), s = k.skin, e = k.eye;
    const ex = ["normal", "happy", "shy", "sad", "pout"].includes(expr) ? expr : "normal";
    const head = "M120 54 C119 72 122 86 130 97 C137 105 144 110 150 111 C156 110 163 105 170 97 C178 86 181 72 180 54 C180 34 167 26 150 26 C133 26 120 34 120 54 Z";
    const ear = "M121 64 C116 61 113 67 114 73 C115 79 118 84 123 84 Z";
    const defs = `<radialGradient id="${P}bl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff7d8e" stop-opacity=".75"/><stop offset=".6" stop-color="#ff8f9c" stop-opacity=".3"/><stop offset="1" stop-color="#ff9aa6" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="${P}ir" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${e.dk}"/><stop offset=".45" stop-color="${e.b}"/><stop offset="1" stop-color="${e.lt}"/></linearGradient>` +
      `<radialGradient id="${P}fc" cx=".62" cy=".38" r=".7"><stop offset="0" stop-color="${mix(s.b, "#fffaf4", 0.25)}"/><stop offset=".7" stop-color="${s.b}"/><stop offset="1" stop-color="${mix(s.b, s.sh, 0.4)}"/></radialGradient>`;
    const faceP = piece(P + "hd", head, s, {
      fill: `url(#${P}fc)`,
      sh: [
        // 前髪の落ち影
        "M118 50 L182 50 L182 62 C178 66 175 62 172 66 C168 61 164 66 160 63 C155 67 150 62 146 66 C141 62 136 68 132 64 C128 68 124 64 118 70 Z",
        // 向かって左の頬〜あごの影（光は右上から）
        "M120 66 C120 78 123 88 130 97 C137 105 144 110 150 111 C145 108 139 103 135 97 C128 88 124 78 124 66 Z",
      ],
      sw: 1.3,
    }) + line("M130 97 C137 105 144 110 150 111 C156 110 163 105 170 97", s.ln, 1.6, 0.9);
    const ears = piece(P + "eaL", ear, s, { sh: ["M118 68 C117 72 118 77 121 80 L123 80 L123 66 Z"], inner: line("M119 68 C117 71 118 76 121 79", s.ln, 0.7, 0.6), sw: 1.1 }) +
      piece(P + "eaR", mirror(ear), s, { sh: ["M182 68 C183 72 182 77 179 80 L177 80 L177 66 Z"], inner: line("M181 68 C183 71 182 76 179 79", s.ln, 0.7, 0.6), sw: 1.1 });

    // 眉
    const browSets = {
      normal: ["M126 62.6 C130 59.6 136 58.6 142 59.6", 0],
      happy: ["M126 61.6 C130 58.4 136 57.4 142 58.4", 0],
      shy: ["M127 61.4 C131 59.6 136 59.2 142 60.8", 0],
      sad: ["M126 61 C131 61 136 60 141.6 57.6", 0],
      pout: ["M126.4 59 C131 59.6 136.4 61 142 63.8", 0],
    };
    const bd = browSets[ex][0];
    const brows = `<g data-part="brows">${line(bd, k.hair.brow, 1.5, 0.95) + line(mirror(bd), k.hair.brow, 1.5, 0.95)}</g>`;

    // 目
    const gaze = ex === "shy" ? -2.2 : ex === "pout" ? 1.6 : 0;
    const lidDrop = ex === "sad" ? 2.2 : ex === "pout" ? 1.6 : 0; // まぶたを下げる量
    const eyeOpen = (m) => {
      const M = (d) => (m ? mirror(d) : d);
      const cx = m ? 300 - 137.4 : 137.4, gx = cx + (m ? gaze * 0.9 : gaze);
      const id = P + (m ? "eR" : "eL");
      const lidCut = lidDrop ? `<path d="${M(`M126 66 L148 66 L148 ${74 + lidDrop} C143 ${71 + lidDrop} 134 ${70.5 + lidDrop} 127 ${79}`)} Z" fill="${s.b}"/>` : "";
      const iris = `<g data-part="iris" data-pivot="${cx.toFixed(1)},77">` +
        `<ellipse cx="${gx}" cy="76.8" rx="5.9" ry="7.1" fill="url(#${P}ir)"/>` +
        `<ellipse cx="${gx}" cy="76.8" rx="5.9" ry="7.1" fill="none" stroke="${e.dk}" stroke-width=".9"/>` +
        `<ellipse cx="${gx}" cy="77.4" rx="2.6" ry="3.6" fill="${e.pu}"/>` +
        `<path d="M${gx - 4.2} 80.4 C${gx - 2} 83 ${gx + 2} 83 ${gx + 4.2} 80.4 C${gx + 2} 81.6 ${gx - 2} 81.6 ${gx - 4.2} 80.4 Z" fill="${e.lt}" opacity=".9"/>` +
        `<ellipse cx="${gx - 2.2}" cy="73.4" rx="2" ry="2.6" fill="#fff" transform="rotate(-20 ${gx - 2.2} 73.4)"/>` +
        `<circle cx="${gx + 2.6}" cy="79.6" r="1" fill="#fff"/><circle cx="${gx + 3.2}" cy="73.6" r=".55" fill="#fff" opacity=".9"/>` +
        (ex === "sad" ? `<path d="M${gx - 4.6} 81.4 C${gx - 1} 83.6 ${gx + 2} 83.6 ${gx + 5} 81.4" stroke="#fff" stroke-width=".9" fill="none" opacity=".8"/>` : "") +
        `</g>`;
      return `<clipPath id="${id}"><path d="${M(EYE.white)}"/></clipPath>` +
        `<path d="${M(EYE.white)}" fill="#fff"/>` +
        `<g clip-path="url(#${id})">${iris}<path d="${M(EYE.shadow)}" fill="${mix("#cdc6e6", e.dk, 0.15)}" opacity=".55"/>${lidCut}</g>`;
    };
    const lidsOpen = (m) => {
      const M = (d) => (m ? mirror(d) : d);
      const lashD = lidDrop ? M(EYE.lash.replace(/(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g, (_, x, y) => `${x} ${(+y < 79 ? +y + lidDrop * (1 - Math.abs(+x - 137) / 14) : +y).toFixed(1)}`)) : M(EYE.lash);
      return fillp(lashD, k.lash) +
        line(M(EYE.crease), s.ln, 0.8, 0.55) + line(M(EYE.lower), k.lash, 0.8, 0.55) + line(M(EYE.outer), k.lash, 1.1, 0.85) +
        // 目尻のまつげ
        fillp(M("M123.2 78.4 C122 76.6 121.6 75.4 121.8 74 C123 75.6 124.4 76.6 126.2 77.2 Z"), k.lash) +
        fillp(M("M125.6 74.8 C124.6 73.2 124.4 72 124.8 70.8 C125.8 72.4 126.8 73.4 128.2 74 Z"), k.lash, 0.9);
    };
    let eyesInner;
    const closedL = line(EYE.closed, k.lash, 1.6) + line(mirror(EYE.closed), k.lash, 1.6);
    if (ex === "happy") {
      const hp = (m) => { const M = (d) => (m ? mirror(d) : d); return line(M(EYE.happy), k.lash, 2.2) + fillp(M("M124.6 80.4 C125.4 79.6 126 79.2 126.8 78.8 L127.6 80 C126.6 80.4 125.6 80.6 124.6 80.4 Z"), k.lash) + line(M("M129 82.4 C132 84 136 84.4 139 84"), s.ln, 0.8, 0.5); };
      eyesInner = `<g data-part="iris"></g><g data-part="lids">${hp(false)}${hp(true)}</g>`;
    } else {
      eyesInner = `<g data-part="eyeballs">${eyeOpen(false)}${eyeOpen(true)}</g><g data-part="lids">${lidsOpen(false)}${lidsOpen(true)}</g>`;
    }
    const eyes = `<g data-part="eyes" data-pivot="150,77">${eyesInner}<g data-part="eyes-closed" display="none">${closedL}</g></g>`;

    // 鼻
    const nose = fillp("M149.6 86.4 C150.6 89 151.2 91.2 150.8 93 C150 93.8 149 93.6 148.4 93 C149.4 92 149.8 89.6 149.6 86.4 Z", s.sh, 0.9) + line("M149.4 93.4 C150.4 93.8 151.4 93.6 152 93", s.ln, 0.8, 0.6) + `<circle cx="152.2" cy="89" r=".8" fill="#fff" opacity=".7"/>`;
    // 頬
    const blushOp = { normal: 0.55, happy: 0.75, shy: 1, sad: 0.4, pout: 0.85 }[ex];
    const hatch = (x) => [0, 3.2, 6.4].map((d) => line(`M${x + d} 92.6 L${x + d + 2} 89.2`, mix(s.sh2, "#ff6f80", 0.4), 0.8, 0.8)).join("");
    const cheeks = `<g data-part="cheeks" opacity="${blushOp}"><ellipse cx="131" cy="90.5" rx="10" ry="5.6" fill="url(#${P}bl)"/><ellipse cx="169" cy="90.5" rx="10" ry="5.6" fill="url(#${P}bl)"/>` +
      (ex === "shy" || ex === "pout" || ex === "happy" ? hatch(126.5) + hatch(165) : "") + `</g>`;
    const puff = ex === "pout" ? line("M178.6 84 C180.6 88 180.2 93 177.6 96.6", s.ln, 1, 0.8) : "";

    // 口
    const mouths = {
      normal: line("M145 100.4 C148 102 152 102 155.4 100" , k.mouth, 1.3) + line("M148.4 103.6 C150 104.2 151.2 104.2 152.4 103.6", s.sh2, 0.9, 0.7),
      happy: `<path d="M143.4 99.2 C146 106.6 154.4 106.6 157 99.2 C152.6 100.6 147.6 100.6 143.4 99.2 Z" fill="${k.mouth}" stroke="${mix(k.mouth, "#000", 0.3)}" stroke-width="1" stroke-linejoin="round"/>` +
        `<path d="M146.6 104 C148.6 102.6 151.8 102.6 153.8 104 C152 105.4 148.4 105.4 146.6 104 Z" fill="${k.tongue}"/>` +
        `<path d="M145 100 C148.4 101 152 101 155.4 100 L155 101.2 C152 102 148.4 102 145.4 101.2 Z" fill="#fff" opacity=".85"/>`,
      shy: line("M145.6 101.2 C147 100 148.4 100 149.6 101 C150.8 102 152.4 102 154 100.6", k.mouth, 1.2),
      sad: line("M145.4 102.6 C148 100.4 152.4 100.4 155 102.4", k.mouth, 1.3) + line("M148.4 104.6 C150 105 151.2 105 152.4 104.6", s.sh2, 0.8, 0.5),
      pout: `<path d="M146.6 101 C148 99.2 152 99.2 153.6 101 C152.4 103.4 148 103.4 146.6 101 Z" fill="${k.lip}" stroke="${k.mouth}" stroke-width="1"/>` + `<ellipse cx="151" cy="100.6" rx="1" ry=".5" fill="#fff" opacity=".7"/>`,
    };
    const mouth = `<g data-part="mouth" data-pivot="150,101">${mouths[ex]}</g>`;
    const sweat = ex === "sad" ? `<path d="M179.2 66 C181.6 70 182.6 72.4 181.4 74 C180.2 75.2 178 74.8 177.6 73 C177.2 71.2 178.4 68.8 179.2 66 Z" fill="#cfe6f4" stroke="#7fa6c4" stroke-width=".7"/>` : "";

    // app.js が顔グループを見つけるための目印（非表示）
    const marker = `<ellipse cx="110" cy="102" rx="0" ry="0" fill="none" data-part="face-marker"/>`;
    return marker + defs + ears + faceP + cheeks + puff + nose + brows + eyes + mouth + sweat;
  }

  // ---------------- 前髪・横髪（頭座標） ----------------
  function hairFront(c, P, k) {
    const h = k.hair;
    // 前髪は一枚のシルエット＋毛束の筋で描く（分け目は向かって右、左へ流れる）
    const tips = [[175, 67], [161, 65], [146, 68], [131, 69], [117, 77]];
    const notches = [[180, 53], [168, 53], [155, 52], [142, 54], [129, 57]];
    let edge = "M191 72 C188 63 184 57 180 53";
    tips.forEach(([tx, ty], i) => {
      const [nx, ny] = notches[i];
      edge += ` C${nx} ${ny + 7} ${tx + 4} ${ty - 2} ${tx} ${ty}`;
      if (i < tips.length - 1) { const [mx, my] = notches[i + 1]; edge += ` C${tx + 1} ${ty - 6} ${mx + 1} ${my + 5} ${mx} ${my}`; }
    });
    const bang = edge + " C114 70 112 64 111 58 C108 34 126 13 152 13 C181 13 197 36 191 72 Z";
    const id = P + "bg";
    let inner = "";
    // 毛先側の影（各毛束の左側）
    tips.forEach(([tx, ty], i) => {
      const [nx, ny] = notches[i];
      inner += `<path d="M${nx} ${ny} C${nx - 1} ${ny + 6} ${tx + 3} ${ty - 3} ${tx} ${ty} C${tx + 5} ${ty - 6} ${nx + 4} ${ny + 2} ${nx + 3} ${ny - 6} Z" fill="${h.sh}" opacity=".85"/>`;
    });
    // 上部の影（頭頂の丸み）
    inner += `<path d="M104 64 C104 34 124 14 150 12 C134 20 122 34 116 60 Z" fill="${h.sh}" opacity=".45"/>`;
    // 天使の輪
    inner += `<path d="M118 44 C127 33 140 28 155 28 C170 28 181 33 187 42 C183 40 179 39.6 176 40 L173 37.4 L169 40.4 C163 37.6 156 36.8 150 37.6 L146 40.6 L142 38.2 C133 39 125 41 118 44 Z" fill="${mix(h.b, "#ffeedd", 0.3)}" opacity=".8"/>` +
      `<path d="M140 30.5 C146 29 153 29 159 30 L157 32.4 C151 31.6 146 31.8 141 33 Z" fill="#fff" opacity=".6"/>` +
      `<path d="M176 35 C179 36 182 38 184 41 L182 41.6 C180 39.6 178 38.2 175.6 37 Z" fill="#fff" opacity=".45"/>`;
    // 毛束の筋（先細り）
    const strands = [[166, 38, 168, 53, 1.6, 1], [160, 38, 155, 52, 1.8, 1], [153, 40, 142, 54, 1.8, -2], [146, 41, 129, 57, 1.8, -3], [136, 42, 117, 66, 1.6, -4],
      [174, 38, 180, 52, 1.4, 2], [156, 46, 150, 64, 1.1, -1], [148, 48, 136, 66, 1.1, -2], [167, 46, 170, 62, 1.1, 1], [140, 22, 124, 40, 1.2, -3], [168, 21, 182, 36, 1.2, 3]];
    inner += strands.map((s) => `<path d="${lock(...s)}" fill="${h.ln}" opacity=".5"/>`).join("");
    return `<clipPath id="${id}"><path d="${bang}"/></clipPath><path d="${bang}" fill="${h.b}"/><g clip-path="url(#${id})">${inner}</g>` +
      `<path d="${bang}" fill="none" stroke="${h.ln}" stroke-width="1.4" stroke-linejoin="round"/>` +
      line("M160 15 C161 18 162 21 163 24", h.ln, 0.9, 0.6);
  }

  function sideLocks(c, P, k) {
    const h = k.hair, st = c.hairStyle;
    const mk = (d, id, shD, hiD, lnD) => piece(id, d, h, { sh: shD ? [shD] : [], inner: (hiD ? line(hiD, h.hi, 1.3, 0.6) : "") + (lnD ? line(lnD, h.ln, 0.7, 0.55) : ""), sw: 1.2 });
    const n = st === "bob" ? 122 : st === "long" ? 126 : 106;
    const dL = `M115 52 C111 68 110 86 112 ${n - 20} C113 ${n - 10} 114 ${n - 5} 113 ${n} C117 ${n - 6} 119 ${n - 12} 120 ${n - 17} C121 ${n - 11} 121 ${n - 7} 120 ${n - 2} C124 ${n - 14} 125 ${n - 30} 124 ${n - 44} C123 78 124 64 128 54 Z`;
    const shL = `M119 66 C122 80 123 ${n - 30} 120 ${n - 4} L118 ${n - 14} C119 ${n - 28} 119 84 116 70 Z`;
    const L = mk(dL, P + "hsL", shL, "M114 62 C112 74 112 86 113 98", `M118 64 C117 80 118 ${n - 30} 117 ${n - 10}`);
    const R = mk(mirror(dL), P + "hsR", mirror(shL), "M186 62 C188 74 188 86 187 98", mirror(`M118 64 C117 80 118 ${n - 30} 117 ${n - 10}`));
    // ロング: 向かって左の肩から胸元へ流した一房（ワールド座標）
    const front = st === "long" ? mk("M111 96 C103 118 104 140 108 160 C111 178 110 198 105 218 C111 212 114 205 116 198 C117 206 118 211 117 218 C123 202 125 184 123 164 C121 144 122 122 125 102 Z", P + "hsF",
      "M117 120 C121 140 122 170 119 200 L116 198 C118 172 117 144 113 122 Z", "M108 112 C106 130 107 146 110 160", "M115 108 C113 140 117 170 113 204") : "";
    // side-locks は head-tilt の中に置くため、ワールド座標の一房だけ傾きを打ち消す
    const untilt = `transform="rotate(${-TILT} ${PIV[0]} ${PIV[1]})"`;
    return `<g data-part="side-lock-l" data-pivot="122,54">${front ? `<g ${untilt}>${front}</g>` : ""}${L}</g><g data-part="side-lock-r" data-pivot="178,54">${R}</g>`;
  }

  function glassesArt(c, P, k) {
    const fr = mix(k.hair.ln, "#5a3a3a", 0.4);
    const rim = (x) => `<path d="M${x - 11} 70 C${x - 4} 68.6 ${x + 6} 68.6 ${x + 11} 70 C${x + 12} 76 ${x + 10} 83 ${x} 84 C${x - 10} 83 ${x - 12} 76 ${x - 11} 70 Z" fill="#e8f0ff" fill-opacity=".14" stroke="${fr}" stroke-width="1.5"/>` +
      `<path d="M${x + 5} 71.4 L${x + 8} 71.6 L${x + 2} 80 L${x - 1} 80 Z" fill="#fff" opacity=".35"/>`;
    return rim(137) + rim(163) + line("M148 72 C149.4 70.8 150.6 70.8 152 72", fr, 1.3) + line("M126 71 L120 69", fr, 1.4) + line("M174 71 L180 69", fr, 1.4);
  }

  function beretArt(c, P, k) {
    const b = k.beret;
    const d = "M110 50 C104 36 116 18 142 13 C168 9 196 16 204 30 C208 38 202 44 192 44 C176 42 152 40 132 44 C122 46 114 50 110 50 Z";
    return piece(P + "brt", d, b, {
      sh: ["M110 50 C114 44 124 40 136 39 C156 37 180 38 198 42 L206 52 L106 56 Z", "M110 50 C106 40 110 30 120 24 C114 32 112 40 116 48 Z"],
      hi: ["M138 18 C152 14 170 14 184 19 C170 18 154 19 140 23 Z"],
      inner: line("M120 44 C140 38 168 37 196 41", b.ln, 0.8, 0.5) + line("M150 18 C156 26 160 32 162 40", b.sh, 1, 0.7),
      sw: 1.5,
    }) + piece(P + "bst", "M152 13 C152 9 154 6 157 5 L159 7 C157 8 156 10 156 13 Z", b, { fill: b.dp, sw: 1 });
  }

  // ---------------- 組み立て ----------------
  function render(svg, c, stage, expr) {
    c = Object.assign({ hairStyle: "long" }, c || {});
    const k = palette(c), P = uid();
    const on = (i) => (stage > i ? "layer off" : "layer");
    const hb = hairBack(c, P, k);
    const tiltT = `rotate(${TILT} ${PIV[0]} ${PIV[1]})`;
    const [tx, ty] = W(184, 30);
    svg.innerHTML =
      `<defs>${hb.defs}</defs>` +
      `<g data-part="hair-tail" data-pivot="${tx},${ty}">${hairTail(c, P, k)}</g>` +
      `<g data-part="hair-back" data-pivot="150,112"><g transform="${tiltT}">${hb.head}</g>${hb.world}</g>` +
      `<g data-part="body" data-pivot="150,290">${bodyArt(c, P, k)}</g>` +
      `<g class="${on(3)}" data-layer="blouse">${blouseArt(c, P, k)}</g>` +
      `<g class="${on(2)}" data-layer="blazer">${blazerArt(c, P, k)}</g>` +
      `<g class="${on(1)}" data-layer="coat">${coatArt(c, P, k)}</g>` +
      `<g class="${on(0)}" data-layer="accessory" data-part="scarf" data-pivot="150,130">${scarfArt(c, P, k)}</g>` +
      `<g data-part="hands" data-pivot="150,290">${handsArt(c, P, k)}</g>` +
      `<g data-part="face-slot" display="none"><ellipse cx="110" cy="102" rx="0" ry="0" fill="none"/></g>` +
      `<g data-part="head" data-pivot="150,112">` +
        `<g data-part="head-tilt" transform="${tiltT}">` +
          `<g data-part="face" data-pivot="150,112">${face(c, expr)}</g>` +
          `<g data-part="side-locks" data-pivot="150,56">${sideLocks(c, P, k)}</g>` +
          `<g data-part="hair-front" data-pivot="152,22">${hairFront(c, P, k)}</g>` +
          (c.glasses ? `<g data-part="glasses" data-pivot="150,76">${glassesArt(c, P, k)}</g>` : "") +
          `<g class="${on(0)}" data-layer="accessory" data-part="beret" data-pivot="150,30">${beretArt(c, P, k)}</g>` +
        `</g>` +
      `</g>`;
    bindFaceSlot(svg);
  }

  // app.js が face-slot に書き込んだ表情を、head 内の face グループへ移す
  function bindFaceSlot(svg) {
    if (svg.__chrObs) svg.__chrObs.disconnect();
    const slot = svg.querySelector('[data-part="face-slot"]');
    if (!slot || typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => {
      if (!slot.querySelector('[data-part="eyes"]')) return;
      const target = svg.querySelector('[data-part="head"] [data-part="face"]');
      if (target) target.innerHTML = slot.innerHTML;
      slot.innerHTML = '<ellipse cx="110" cy="102" rx="0" ry="0" fill="none"/>';
    });
    obs.observe(slot, { childList: true });
    svg.__chrObs = obs;
  }

  return { render, face, palette };
})();

function face(c, expr = "normal") { return CharacterArt.face(c, expr); }

// stage 以上のレイヤーは非表示（CSS で脱げるアニメーション）
function renderCharacter(svg, c, stage, expr = "normal") { CharacterArt.render(svg, c, stage, expr); }

// 表示済みSVGに対して、レイヤーだけ切り替える（アニメーション用）。accessory は頭と体の2グループ。
function setStage(svg, stage) {
  LAYERS.forEach((l, i) => {
    svg.querySelectorAll(`[data-layer="${l.id}"]`).forEach((g) => g.classList.toggle("off", stage > i));
  });
}
