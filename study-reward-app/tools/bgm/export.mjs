// 使い方: node export.mjs [track,...] [--install]
import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
import fs from "fs"; import { execFileSync } from "child_process";
const DIR = new URL(".", import.meta.url).pathname;
const OUT = DIR + "out/"; fs.mkdirSync(OUT, { recursive: true });
const DEST = "/Users/hkt/bizdev/study-reward-app/assets/bgm/";
const install = process.argv.includes("--install");
const browser = await puppeteer.launch({ headless: true, args: ["--allow-file-access-from-files"] });
const p = await browser.newPage();
p.on("console", m => console.log("[page]", m.text())); p.on("pageerror", e => console.log("[pageerror]", e.message));
await p.goto("file://" + DIR + "render.html");
const meta = fs.existsSync(OUT+"meta.json") ? JSON.parse(fs.readFileSync(OUT+"meta.json")) : {};
const tracks = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2].split(",") : await p.evaluate(() => GameBGM.tracks);
for (const t of tracks) {
  const t0 = Date.now();
  const r = await p.evaluate(tr => renderB64(tr), t);
  fs.writeFileSync(OUT + t + ".wav", Buffer.from(r.b64, "base64"));
  meta[t] = { intro: r.introDur, loop: r.loopDur }; fs.writeFileSync(OUT + "meta.json", JSON.stringify(meta, null, 1));
  console.log(`${t}: rendered ${(Date.now()-t0)}ms intro=${r.introDur.toFixed(3)} loop=${r.loopDur.toFixed(3)}`);
  if (install) {
    fs.mkdirSync(DEST, { recursive: true });
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "160000", OUT + t + ".wav", DEST + t + ".m4a"]);
  }
}
await browser.close();
