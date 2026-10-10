#!/usr/bin/env node
// 声のトーン候補の試聴サンプルを作る（全596行の再生成はしない）
//   ssh -N -L 50021:127.0.0.1:50021 dgx &     # エンジンは DGX 上で動かす
//   node tools/voice/audition.mjs <出力フォルダ>
// 候補ごと×性格ごとに代表3行（喜び・照れ・通常）を 0.5 秒の無音で連結し「候補A_gentle.m4a」等で出力。
// 採用した候補は config.json の "tone" に同じ値を書けば gen.mjs に反映される。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { CONFIG, api, resolveStyles, installDictionary, paramsFor, speechText, loadLines, applyTone } from "./gen.mjs";

export const CANDIDATES = {
  現在: null,
  候補A: { pitchAdd: 0.06, intonationMul: 1.10, speedMul: 1.03 },
  候補B: { pitchAdd: 0.10, intonationMul: 1.20, speedMul: 1.05 },
  候補C: { pitchAdd: 0.15, intonationMul: 1.30, speedMul: 1.07 },
  候補D: { pitchAdd: 0.10, intonationMul: 1.20, speedMul: 1.05, style: "クイーン" },
};
const PICK = {
  gentle: ["gentle.greet_morning.1", "gentle.talk2.3", "gentle.talk0.1"],
  tsundere: ["tsundere.pass.2", "tsundere.talk1.4", "tsundere.talk0.3"],
  cool: ["cool.talk1.1", "cool.talk1.4", "cool.greet_morning.2"],
  genki: ["genki.greet_morning.1", "genki.talk0.4", "genki.talk0.3"],
};

function pcmOf(wav) {
  let off = 12, fmt = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4), size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { ch: wav.readUInt16LE(off + 10), rate: wav.readUInt32LE(off + 12), bits: wav.readUInt16LE(off + 22) };
    if (id === "data") return { fmt, data: wav.subarray(off + 8, off + 8 + size) };
    off += 8 + size + (size & 1);
  }
  throw new Error("WAV の data チャンクがありません");
}
function wavOf({ ch, rate, bits }, data) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * bits / 8, 28);
  h.writeUInt16LE(ch * bits / 8, 32); h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function main() {
  const out = path.resolve(process.argv[2] || "voice_samples");
  fs.mkdirSync(out, { recursive: true });
  const { lines } = loadLines();
  const styleId = await resolveStyles();
  await installDictionary();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audition-"));
  const table = [];
  for (const [name, tone] of Object.entries(CANDIDATES)) {
    for (const [pers, ids] of Object.entries(PICK)) {
      const parts = [];
      let fmt;
      for (const id of ids) {
        const base = paramsFor(id, lines[id]); // config.json の tone が入っていてもここでは使わない
        const p = applyTone({ ...base, ...(CONFIG.tone ? undoTone(base, CONFIG.tone) : {}) }, tone);
        const sid = styleId(p.style);
        const q = await api("POST", "/audio_query", { query: { text: speechText(lines[id].text), speaker: sid } });
        Object.assign(q, {
          speedScale: p.speedScale, pitchScale: p.pitchScale, intonationScale: p.intonationScale, volumeScale: p.volumeScale,
          prePhonemeLength: p.prePhonemeLength, postPhonemeLength: p.postPhonemeLength, outputSamplingRate: 24000, outputStereo: false,
        });
        const w = pcmOf(await api("POST", "/synthesis", { query: { speaker: sid }, body: q, raw: true }));
        fmt = w.fmt;
        if (parts.length) parts.push(Buffer.alloc(Math.round(fmt.rate * 0.5) * fmt.ch * fmt.bits / 8));
        parts.push(w.data);
        table.push({ 候補: name, 性格: pers, lineId: id, expr: lines[id].expr, style: p.style, speed: p.speedScale, pitch: p.pitchScale, intonation: p.intonationScale });
      }
      const wavPath = path.join(tmp, "x.wav");
      fs.writeFileSync(wavPath, wavOf(fmt, Buffer.concat(parts)));
      const dest = path.join(out, `${name}_${pers}.m4a`);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, dest]);
      console.log("✓", path.basename(dest));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, "params.json"), JSON.stringify({ candidates: CANDIDATES, lines: table }, null, 1));
  // 読みやすい表（性格ごとの基本値 = 通常(normal)行の値）
  const md = ["| 候補 | 補正 | gentle | tsundere | cool | genki |", "|---|---|---|---|---|---|"];
  for (const [name, tone] of Object.entries(CANDIDATES)) {
    const cell = (pers) => { const r = table.find((t) => t.候補 === name && t.性格 === pers && t.expr === "normal") || table.find((t) => t.候補 === name && t.性格 === pers);
      return `${r.style} 速${r.speed} 高${r.pitch} 抑${r.intonation}`; };
    const desc = tone ? `pitch+${tone.pitchAdd} 抑揚×${tone.intonationMul} 話速×${tone.speedMul}${tone.style ? " スタイル=" + tone.style : ""}` : "現行設定";
    md.push(`| ${name} | ${desc} | ${["gentle", "tsundere", "cool", "genki"].map(cell).join(" | ")} |`);
  }
  fs.writeFileSync(path.join(out, "params.md"), md.join("\n") + "\n");
  console.log(md.join("\n"));
}
// config.json に tone が既に入っている場合は、それを外した値を基準にする
function undoTone(p, t) {
  const q = {};
  if (t.pitchAdd) q.pitchScale = Math.round((p.pitchScale - t.pitchAdd) * 1000) / 1000;
  if (t.intonationMul) q.intonationScale = Math.round((p.intonationScale / t.intonationMul) * 1000) / 1000;
  if (t.speedMul) q.speedScale = Math.round((p.speedScale / t.speedMul) * 1000) / 1000;
  return q;
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
