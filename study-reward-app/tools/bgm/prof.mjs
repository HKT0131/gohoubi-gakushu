import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true });
const p = await browser.newPage();
await p.goto("file://" + DIR + "render.html");
const r = await p.evaluate(async () => {
  const out = {};
  async function time(label, fn){ const t=performance.now(); await fn(); out[label]=Math.round(performance.now()-t); }
  // 60s の空グラフ（コンボルバのみ）
  await time("conv only 60s", async()=>{ const c=new OfflineAudioContext(2,44100*60,44100); const conv=c.createConvolver(); const b=c.createBuffer(2,44100*1.8,44100); for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/20000);} conv.buffer=b; const o=c.createOscillator(); o.connect(conv); conv.connect(c.destination); o.start(); await c.startRendering(); });
  await time("osc only 60s", async()=>{ const c=new OfflineAudioContext(2,44100*60,44100); const o=c.createOscillator(); o.connect(c.destination); o.start(); await c.startRendering(); });
  await time("title render", ()=>GameBGM._render("title"));
  return out;
});
console.log(r); await browser.close();
