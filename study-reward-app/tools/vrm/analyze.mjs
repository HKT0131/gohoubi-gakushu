// メッシュの部位構成を調べる: node tools/vrm/analyze.mjs <file.vrm>
import { readGLB, accessor, humanBones } from "./gltf.mjs";
const g = readGLB(process.argv[2]);
const hb = humanBones(g);
for (const k of ["hips","spine","chest","upperChest","neck","head","leftShoulder","leftUpperArm","leftLowerArm","leftHand","leftUpperLeg","leftLowerLeg","leftFoot"]) if (hb[k]) console.log(k.padEnd(14), hb[k].map(v=>v.toFixed(3)).join(" "));
const vp = g.json.extensions.VRM.materialProperties;
console.log("body mp", JSON.stringify(vp[9].textureProperties), "cloth", JSON.stringify(vp[10].textureProperties));
console.log("body node", JSON.stringify(g.json.nodes[1]));
const mesh = g.json.meshes[1];
mesh.primitives.forEach((p, k) => {
  const pos = accessor(g, p.attributes.POSITION), idx = accessor(g, p.indices), uv = accessor(g, p.attributes.TEXCOORD_0);
  const used = new Set(idx); let mn=[9,9,9], mx=[-9,-9,-9], umn=[9,9], umx=[-9,-9];
  for (const i of used) { for (let c=0;c<3;c++){mn[c]=Math.min(mn[c],pos[i*3+c]);mx[c]=Math.max(mx[c],pos[i*3+c]);} for(let c=0;c<2;c++){umn[c]=Math.min(umn[c],uv[i*2+c]);umx[c]=Math.max(umx[c],uv[i*2+c]);} }
  console.log("prim", k, "mat", p.material, "tris", idx.length/3, "verts", used.size, "bbox", mn.map(v=>v.toFixed(3)).join(","), "->", mx.map(v=>v.toFixed(3)).join(","), "uv", umn.map(v=>v.toFixed(2)).join(","), "->", umx.map(v=>v.toFixed(2)).join(","), "attrs", Object.keys(p.attributes).join(","));
});
// Onepiece の連結成分（位置を溶接して判定）
for (const pk of [4]) {
  const p = mesh.primitives[pk];
  const pos = accessor(g, p.attributes.POSITION), idx = accessor(g, p.indices), uv = accessor(g, p.attributes.TEXCOORD_0);
  const key = (i) => `${pos[i*3].toFixed(4)},${pos[i*3+1].toFixed(4)},${pos[i*3+2].toFixed(4)}`;
  const weld = new Map(), rep = new Int32Array(pos.length/3);
  for (let i = 0; i < rep.length; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
  const par = Int32Array.from(rep.keys()); const f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (let t = 0; t < idx.length; t += 3) { const a=f(rep[idx[t]]), b=f(rep[idx[t+1]]), c=f(rep[idx[t+2]]); par[b]=a; par[f(c)]=a; }
  const comp = new Map();
  for (let t = 0; t < idx.length; t += 3) { const r = f(rep[idx[t]]); if (!comp.has(r)) comp.set(r, { tris: 0, mn:[9,9,9], mx:[-9,-9,-9], umn:[9,9], umx:[-9,-9] }); const c = comp.get(r); c.tris++;
    for (let v=0; v<3; v++){ const i=idx[t+v]; for(let d=0;d<3;d++){c.mn[d]=Math.min(c.mn[d],pos[i*3+d]);c.mx[d]=Math.max(c.mx[d],pos[i*3+d]);} for(let d=0;d<2;d++){c.umn[d]=Math.min(c.umn[d],uv[i*2+d]);c.umx[d]=Math.max(c.umx[d],uv[i*2+d]);} } }
  console.log("onepiece components", comp.size);
  [...comp.values()].sort((a,b)=>b.mx[1]-a.mx[1]).forEach((c, i) => console.log(" c", i, "tris", c.tris, "bbox", c.mn.map(v=>v.toFixed(3)).join(","), "->", c.mx.map(v=>v.toFixed(3)).join(","), "uv", c.umn.map(v=>v.toFixed(2)).join(","), "->", c.umx.map(v=>v.toFixed(2)).join(",")));
}
