import puppeteer from "/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
const DIR = new URL(".", import.meta.url).pathname;
const b = await puppeteer.launch({ headless: true }); const p = await b.newPage();
await p.setViewport({ width: 390, height: 700, deviceScaleFactor: 2 });
await p.goto("file://" + DIR + "index.html"); await p.click("#tracks button"); await new Promise(r => setTimeout(r, 1000));
await p.screenshot({ path: DIR + "page.png" }); await b.close();
