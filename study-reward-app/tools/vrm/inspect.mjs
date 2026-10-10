// VRM(GLB) の構造を表示する: node tools/vrm/inspect.mjs <file.vrm>
import fs from "node:fs";
export function readGLB(path) {
  const b = fs.readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not glb");
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return { json, bin };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { json: j, bin } = readGLB(process.argv[2]);
  console.log("asset", j.asset, "ext", j.extensionsUsed, "bin", bin.length);
  const v = j.extensions?.VRM;
  if (v) console.log("meta", JSON.stringify(v.meta));
  console.log("images", j.images.map((im, i) => `${i}:${im.name}:${j.bufferViews[im.bufferView].byteLength}`).join(" "));
  console.log("materials:"); j.materials.forEach((m, i) => console.log(" ", i, m.name, m.alphaMode || "", "tex", m.pbrMetallicRoughness?.baseColorTexture?.index));
  if (v) v.materialProperties.forEach((m, i) => console.log("  mp", i, m.name, m.shader, "main", m.textureProperties?._MainTex, "rq", m.renderQueue));
  console.log("textures", j.textures.map((t, i) => `${i}->${t.source}`).join(" "));
  j.meshes.forEach((m, i) => {
    console.log("mesh", i, m.name, "prims", m.primitives.length);
    m.primitives.forEach((p, k) => console.log("   ", k, "mat", p.material, j.materials[p.material].name, "idx", j.accessors[p.indices].count, "targets", p.targets?.length || 0));
  });
  j.nodes.forEach((n, i) => { if (n.mesh !== undefined) console.log("node", i, n.name, "mesh", n.mesh, "skin", n.skin); });
  if (v) { console.log("blendShapeGroups", v.blendShapeMaster.blendShapeGroups.map(g => g.presetName + ":" + g.name).join(" "));
    console.log("secondary", v.secondaryAnimation.boneGroups.map(g => g.comment + "/" + g.bones.length).join(" ")); }
}
