import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true });
const p = await browser.newPage(); await p.goto("file://" + DIR + "render.html");
for (const t of await p.evaluate(() => GameBGM.tracks)) {
  const r = await p.evaluate(async (t) => {
    const buf = await GameBGM._render(t, 44100, true), s = GameBGM._compile(t), sr = 44100;
    const iN = Math.round(s.introSteps*s.stepDur*sr), lN = Math.round(s.loopSteps*s.stepDur*sr), d = buf.getChannelData(0);
    // 1周目末尾→2周目頭（本来の連続）と、2周目末尾→2周目頭（ファイルのループ）の差
    let maxEnd = 0, maxStart = 0, ref = 0;
    for (let k = 1; k <= 4410; k++) { maxEnd = Math.max(maxEnd, Math.abs(d[iN+lN-k] - d[iN+2*lN-k])); ref = Math.max(ref, Math.abs(d[iN+2*lN-k])); }
    return { maxEnd, ref };
  }, t);
  console.log(t.padEnd(12), `loop1末尾 vs loop2末尾 (最後の100ms) 最大差 ${r.maxEnd.toFixed(5)} / 信号ピーク ${r.ref.toFixed(3)}`);
}
await browser.close();
