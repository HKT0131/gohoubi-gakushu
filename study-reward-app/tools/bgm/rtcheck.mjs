// 合成モードのリアルタイム動作: スケジュールされたノード数・メインスレッド負荷・hidden での suspend
import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await browser.newPage(); const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.evaluateOnNewDocument(() => {
  window.__osc = 0; const o = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); };
});
await p.goto("file://" + DIR + "index.html#synth");
for (const t of ["title", "home", "study", "study_hurry", "result_win", "result_lose", "event"]) {
  const m0 = await p.metrics();
  const r = await p.evaluate(async (t) => {
    const o0 = window.__osc; GameBGM.unlock(); GameBGM.play(t, { fadeMs: 200 });
    await new Promise(r => setTimeout(r, 4000));
    return { osc: window.__osc - o0 };
  }, t);
  const m1 = await p.metrics();
  console.log(t.padEnd(12), `oscillators/4s=${r.osc}  main-thread script ${((m1.ScriptDuration - m0.ScriptDuration) * 1000 / 4).toFixed(1)}ms/s`);
}
console.log(errs.length ? errs : "no errors");
await browser.close();
