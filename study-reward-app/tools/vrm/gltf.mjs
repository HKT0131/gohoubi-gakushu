// GLB 読み書きと accessor ヘルパー（VRM 加工ツール共通）
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
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
export function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const n = NC[a.type], C = CT[a.componentType];
  const stride = bv.byteStride || n * C.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new C(a.count * n);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * C.BYTES_PER_ELEMENT;
    out[k * n + c] = C === Float32Array ? dv.getFloat32(o, true) : C === Uint16Array ? dv.getUint16(o, true) : C === Uint32Array ? dv.getUint32(o, true) : C === Uint8Array ? dv.getUint8(o) : C === Int16Array ? dv.getInt16(o, true) : dv.getInt8(o);
  }
  return out;
}
export function imageBytes(g, imgIndex) {
  const bv = g.json.bufferViews[g.json.images[imgIndex].bufferView];
  return g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
}
// ノードのワールド行列（列優先 4x4）
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
export function worldMatrices(g) {
  const N = g.json.nodes, parent = new Array(N.length).fill(-1);
  N.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const W = [];
  const get = (i) => W[i] || (W[i] = parent[i] < 0 ? local(N[i]) : mul(get(parent[i]), local(N[i])));
  N.forEach((_, i) => get(i));
  return W;
}
export function humanBones(g) {
  const W = worldMatrices(g), out = {};
  for (const hb of g.json.extensions.VRM.humanoid.humanBones) out[hb.bone] = [W[hb.node][12], W[hb.node][13], W[hb.node][14]];
  return out;
}
// GLB 書き出し（bin は 4 バイト境界に揃える）
export function writeGLB(path, json, bin) {
  const js = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = Buffer.alloc((4 - (js.length % 4)) % 4, 0x20), bpad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
  const J = Buffer.concat([js, jpad]), B = Buffer.concat([bin, bpad]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + J.length + 8 + B.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(J.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(B.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(path, Buffer.concat([h, jh, J, bh, B]));
}
