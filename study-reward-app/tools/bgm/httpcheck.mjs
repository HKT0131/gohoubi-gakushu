import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
import { spawn } from "child_process"; import fs from "fs";
const DIR = new URL(".", import.meta.url).pathname;
const srv = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", "/Users/hkt/bizdev/study-reward-app"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await browser.newPage(); const errs = []; p.on("response", x => { if (x.status() >= 400) console.log("404:", x.url()); });
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() !== "log") errs.push(m.text()); });
await p.goto("http://127.0.0.1:8765/");
await p.addScriptTag({ url: "/bgm.js" });
const r = await p.evaluate(async () => {
  GameBGM.unlock(); GameBGM.play("result_win");
  await new Promise(r => setTimeout(r, 1500));
  const src = GameBGM._sourceOf("result_win");
  // デコード結果と WAV の位置ずれ（AAC プライミング）
  const ab = await (await fetch("assets/bgm/title.m4a")).arrayBuffer();
  const c = new OfflineAudioContext(2, 44100, 44100); const buf = await c.decodeAudioData(ab);
  return { src, decodedDur: buf.duration, head: Array.from(buf.getChannelData(0).subarray(0, 44100)) };
});
// WAV の頭とのずれを相互相関で求める
const b = fs.readFileSync(DIR + "out/title.wav"); const w = new Float32Array(44100); for (let i = 0; i < 44100; i++) w[i] = b.readInt16LE(44 + i * 4) / 32768;
let best = 0, bl = 0; for (let lag = -3000; lag <= 3000; lag++) { let s = 0; for (let i = 3000; i < 40000; i++) s += w[i] * r.head[i + lag]; if (s > best) { best = s; bl = lag; } }
console.log("http: result_win source =", r.src, "| title.m4a decoded", r.decodedDur.toFixed(4), "s (wav 30.0000) | offset vs wav =", bl, "samples", errs.length ? errs : "no errors");
await browser.close(); srv.kill();
