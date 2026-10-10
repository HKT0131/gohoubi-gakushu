// 確認ページを開いて、ファイル優先／合成フォールバック／API の動作を確認
import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
for (const mode of ["file", "synth"]) {
  const p = await browser.newPage(); const errs = [];
  p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() !== "log") errs.push(m.type() + ": " + m.text()); });
  await p.goto("file://" + DIR + "index.html" + (mode === "synth" ? "#synth" : ""));
  await p.evaluate(() => { localStorage.clear(); });
  await p.mouse.click(5, 5);
  const res = [];
  for (const t of ["title","home","study","study_hurry","result_win","result_lose","event"]) {
    await p.evaluate(t => { GameBGM.unlock(); GameBGM.play(t, { fadeMs: 300 }); }, t);
    await wait(1200);
    res.push(t + "=" + await p.evaluate(t => GameBGM._sourceOf(t), t));
  }
  const api = await p.evaluate(async () => {
    GameBGM.setVolume(0.3); GameBGM.duck(true); await new Promise(r => setTimeout(r, 400));
    const s1 = { vol: localStorage.getItem("bgmVol") };
    GameBGM.duck(false); GameBGM.setEnabled(false); const off = localStorage.getItem("bgmOn");
    GameBGM.setEnabled(true); GameBGM.play("home"); GameBGM.play("home"); await new Promise(r => setTimeout(r, 800));
    GameBGM.stop(300); await new Promise(r => setTimeout(r, 500));
    return { ...s1, off, after: GameBGM.current() };
  });
  console.log(mode, res.join(" "), JSON.stringify(api), errs.length ? "ERR " + errs.join(" | ") : "no errors");
  await p.close();
}
// Chrome で m4a をデコードしたときの長さと WAV との位置ずれ（AAC のプライミング処理の確認）
const p = await browser.newPage(); await p.goto("file://" + DIR + "render.html");
const dec = await p.evaluate(async () => {
  const out = {};
  for (const t of ["title", "result_win"]) {
    const ab = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", "file:///Users/hkt/bizdev/study-reward-app/assets/bgm/" + t + ".m4a"); x.responseType = "arraybuffer"; x.onload = () => res(x.response); x.onerror = rej; x.send(); }).catch(e => null);
    if (!ab) { out[t] = "xhr blocked"; continue; }
    const c = new OfflineAudioContext(2, 44100, 44100); const buf = await c.decodeAudioData(ab);
    out[t] = buf.duration.toFixed(4) + "s";
  }
  return out;
});
console.log("decode m4a in Chrome:", JSON.stringify(dec));
await browser.close();
