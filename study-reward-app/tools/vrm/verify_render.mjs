// 実レンダリングでのビキニ被覆検査: node tools/vrm/verify_render.mjs [--out <dir>]
//   tools/vrm/out/chara.candidate.vrm を headless Chrome（SwiftShader）で描画し、正面・斜め・背面・下方・遠目から
//   ボトム中央・トップ中央の矩形に「肌色ピクセル」が 1 つも無いことを確認する（お腹の矩形は肌色が出ることを確認＝判定の対照）。
//   stage 3（トップ＋スカート）と stage 4（ビキニ）、水着色は既定と複数の設定色で検査。合格したら assets/vrm/chara.vrm にコピーする。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const APP = path.resolve(HERE, "../..");
const CAND = path.join(HERE, "out/chara.candidate.vrm");
const OUTDIR = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(HERE, "out/verify");
fs.mkdirSync(OUTDIR, { recursive: true });
const puppeteerPath = process.env.PUPPETEER || "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const puppeteer = (await import(puppeteerPath)).default;

// ワールド座標（+Z が正面、+X は画面の右＝キャラの左）
const R = {
  botF: { name: "bottom-center-front", x: 0.025, y0: 0.93, y1: 0.975, side: "front" },
  botB: { name: "bottom-center-back", x: 0.04, y0: 0.925, y1: 0.98, side: "back" },
  // 股布（中心線 ±6mm、股の面 y0.918〜0.945）
  crotch: { name: "crotch-below", x: 0.006, y0: 0.918, y1: 0.945, side: "front" },
  // 三角カップ: 左右それぞれ、胸の頂点のまわり（|x| 0.059±0.02、y 1.25〜1.30）
  cupL: { name: "cup-left", cx: 0.059, sign: -1, x: 0.02, y0: 1.25, y1: 1.3, side: "front" },
  cupR: { name: "cup-right", cx: 0.059, sign: 1, x: 0.02, y0: 1.25, y1: 1.3, side: "front" },
  topB: { name: "top-band-back", x: 0.03, y0: 1.206, y1: 1.213, side: "back" },
  belly: { name: "belly(control)", x: 0.03, y0: 1.05, y1: 1.12, side: "front", expect: "skin" },
};
const near = (name, pos, at, rects) => ({ name, pos, at, fov: 20, rects });
const VIEWS = [
  near("front-near", [0, 1.0, 1.5], [0, 1.0, 0], [R.botF, R.belly]),
  near("chest-front-near", [0, 1.27, 1.3], [0, 1.27, 0], [R.cupL, R.cupR]),
  near("chest-diag-near", [1.0, 1.3, 1.45], [0, 1.27, 0], [R.cupL, R.cupR]),
  near("chest-above", [0, 1.75, 0.9], [0, 1.27, 0], [R.cupL, R.cupR]),
  near("front-far", [0, 0.9, 6.5], [0, 0.9, 0], [R.botF, R.cupL, R.cupR, R.belly]),
  near("diag-near", [0.95, 1.0, 1.15], [0, 1.0, 0], [R.botF]),
  near("back-near", [0, 1.0, -1.5], [0, 1.0, 0], [R.botB]),
  near("back-far", [0, 0.9, -6.5], [0, 0.9, 0], [R.botB]),
  near("front-xfar", [0, 0.9, 11], [0, 0.9, 0], [R.botF, R.cupL, R.cupR, R.belly]),
  near("back-xfar", [0, 0.9, -11], [0, 0.9, 0], [R.botB]),
  near("below-front", [0, 0.45, 0.9], [0, 0.88, 0], [R.crotch, R.botF]),
  near("below-back", [0, 0.45, -0.9], [0, 0.9, 0], [R.botB]),
];
const browser = await puppeteer.launch({ headless: true, args: ["--allow-file-access-from-files", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.setViewport({ width: 400, height: 800, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(HERE, "verify.html"));
let fail = 0;
const summary = [];
const cases = [
  { stage: 4, swim: undefined }, { stage: 4, swim: "#4fb3c9" }, { stage: 4, swim: "#fde3d3" }, { stage: 4, swim: "#ffffff" }, { stage: 4, swim: "#e8a07a" },
  { stage: 3, swim: undefined, views: ["front-near", "front-far", "chest-front-near", "chest-diag-near", "chest-above"] },
];
for (const c of cases) {
  const views = VIEWS.filter((v) => !c.views || c.views.includes(v.name)).map((v) => (c.stage === 3 ? { ...v, rects: v.rects.filter((r) => r.name.startsWith("top") || r.name.startsWith("cup") || r.expect) } : v));
  const res = await page.evaluate((cfg) => window.runCheck(cfg), { stage: c.stage, swim: c.swim, w: 400, h: 800, model: path.relative(APP, CAND), views });
  for (const r of res) {
    const tag = `stage${c.stage}-${(c.swim || "default").replace("#", "")}-${r.view}`;
    fs.writeFileSync(path.join(OUTDIR, tag + ".png"), Buffer.from(r.png.split(",")[1], "base64"));
    for (const rc of r.rects) {
      let ok;
      if (rc.error) ok = false;
      else if (rc.expect === "skin") ok = rc.px >= 8 && rc.skin / rc.px > 0.5;
      else ok = rc.px >= 4 && rc.skin === 0;
      if (!ok) fail++;
      summary.push(`${ok ? "OK  " : "FAIL"} ${tag.padEnd(44)} ${rc.name.padEnd(22)} pixels=${rc.px} skin=${rc.skin}${rc.error ? " " + rc.error : ""}${ok ? "" : " box=" + rc.box}`);
    }
  }
}
await browser.close();
console.log(summary.join("\n"));
if (errs.length) { console.log("page errors:", errs); fail++; }
if (fail) { console.error(`verify_render: ${fail} check(s) failed — assets/vrm/chara.vrm は更新しません`); process.exit(1); }
fs.copyFileSync(CAND, path.join(APP, "assets/vrm/chara.vrm"));
console.log("verify_render: all passed → assets/vrm/chara.vrm を更新しました");
