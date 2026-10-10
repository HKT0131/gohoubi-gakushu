import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true });
const p = await browser.newPage(); await p.goto("file://" + DIR + "render.html");
const r = await p.evaluate(async () => {
  const out = {};
  async function diff(label, mut) {
    const s = GameBGM._compile("title"); const saved = { delay: s.delay, steps: s.steps };
    mut(s);
    const buf = await GameBGM._render("title", 44100, true), sr = 44100;
    Object.assign(s, saved);
    const lN = Math.round(s.loopSteps*s.stepDur*sr), d = buf.getChannelData(0);
    let m = 0, at = 0; for (let k = 1; k <= 44100; k++) { const x = Math.abs(d[lN-k] - d[2*lN-k]); if (x > m) { m = x; at = k; } }
    out[label] = m.toFixed(5) + " at -" + (at/sr).toFixed(3) + "s";
  }
  await diff("full", s => {});
  await diff("noDelay", s => { s.delay = 0; });
  const only = (pred) => s => { s.steps = s.steps.map(a => a.filter(pred)); };
  for (const inst of ["bell","pluck","pad","bass","kick","snare","clap","hat","ohat","crash"]) await diff("only " + inst, s => { s.delay = 0; s.steps = s.steps.map(a => a.filter(e => e.i === inst)); });
  return out;
});
console.log(r); await browser.close();
