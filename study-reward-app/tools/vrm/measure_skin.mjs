// 首・あご下と体（鎖骨・胸元・肩・お腹）の肌色差を実レンダリングで測る: node tools/vrm/measure_skin.mjs <model(app からの相対パス)> <out.png>
import fs from "node:fs"; import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const puppeteer = (await import(process.env.PUPPETEER || "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js")).default;
const b = await puppeteer.launch({ headless: true, args: ["--allow-file-access-from-files", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage(); await p.setViewport({ width: 500, height: 500 });
await p.goto("file://" + path.join(HERE, "skin.html"));
const r = await p.evaluate((m) => window.measure({ model: m }), process.argv[2]);
console.log("bands", JSON.stringify(r.res.bands)); delete r.res.bands;
for (const [k, v] of Object.entries(r.res)) console.log(k.padEnd(9), "n", String(v.n).padStart(4), "Lab", v.lab.join(", ").padEnd(20), "ΔE(首)", v.dE_vs_neck, "ΔE(あご)", v.dE_vs_jaw);
if (process.argv[3]) fs.writeFileSync(process.argv[3], Buffer.from(r.png.split(",")[1], "base64"));
await b.close();
