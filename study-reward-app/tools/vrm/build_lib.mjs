// three.js + three-vrm を file:// でも動く IIFE（window.VRMLib）にまとめる: node tools/vrm/build_lib.mjs
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "../../assets/lib/three-vrm.iife.js");
const v = (p) => JSON.parse(fs.readFileSync(path.join(HERE, "node_modules", p, "package.json"), "utf8")).version;
const banner = `/*! three.js r${v("three").split(".")[1]} (c) 2010-2024 three.js authors, MIT License — https://github.com/mrdoob/three.js
 *  @pixiv/three-vrm ${v("@pixiv/three-vrm")} (c) 2019-2024 pixiv Inc., MIT License — https://github.com/pixiv/three-vrm
 *  全文は assets/lib/LICENSE-three.txt / LICENSE-three-vrm.txt。tools/vrm/build_lib.mjs で生成。 */`;
await build({ entryPoints: [path.join(HERE, "lib_entry.js")], bundle: true, minify: true, format: "iife", globalName: "VRMLib", target: ["safari15"], outfile: OUT, banner: { js: banner }, legalComments: "none" });
fs.copyFileSync(path.join(HERE, "node_modules/three/LICENSE"), path.join(path.dirname(OUT), "LICENSE-three.txt"));
const vrmLic = ["LICENSE", "LICENSE.md", "LICENSE.txt"].map((f) => path.join(HERE, "node_modules/@pixiv/three-vrm", f)).find((f) => fs.existsSync(f));
if (vrmLic) fs.copyFileSync(vrmLic, path.join(path.dirname(OUT), "LICENSE-three-vrm.txt"));
else throw new Error("three-vrm license not found");
console.log("wrote", OUT, (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
