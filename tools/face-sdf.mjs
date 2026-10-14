import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix3, Matrix4, Vector3, Box3 } from 'three';
import sharp from 'sharp';

const start = performance.now(), [input, output, ...args] = process.argv.slice(2);
assert(input && output, 'Usage: node tools/face-sdf.mjs <vrm> <out.png> [--size 512] [--angles 16] [--normal-mix 0.8]');
const options = { '--size': 512, '--angles': 16, '--normal-mix': 0.8 };
for (let i = 0; i < args.length; i += 2) {
  assert(Object.hasOwn(options, args[i]) && args[i + 1] !== undefined, `Invalid option: ${args[i]}`);
  options[args[i]] = Number(args[i + 1]);
}
const size = options['--size'], count = options['--angles'], mix = options['--normal-mix'], pixels = size * size;
assert(Number.isInteger(size) && size >= 1 && size <= 2048, 'size must be 1..2048');
assert(Number.isInteger(count) && count >= 3 && count <= 64, 'angles must be 3..64');
assert(Number.isFinite(mix) && mix >= 0 && mix <= 1, 'normal-mix must be 0..1');
const bytes = await readFile(input), gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const bone = gltf.extensions?.VRMC_vrm?.humanoid?.humanBones?.head?.node
  ?? gltf.extensions?.VRM?.humanoid?.humanBones?.find(b => b.bone === 'head')?.node;
assert(bone !== undefined, 'Missing VRM head bone');
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(input);
const nodes = doc.getRoot().listNodes(), head = nodes.find(n => n.getName() === gltf.nodes[bone].name);
assert(head, 'Missing named head node');
// VRoid rest pose: VRM0 forward=-Z/right=+X; VRM1 forward=+Z/right=-X.
const forward = gltf.extensions?.VRMC_vrm ? 1 : -1, right = -forward;
const inverseHead = new Matrix4().fromArray(head.getWorldMatrix()).invert(), bounds = new Box3(), faces = [];
for (const node of nodes) for (const p of node.getMesh()?.listPrimitives() ?? []) {
  if (p.getMaterial()?.getName() !== 'F00_000_00_Face_00_SKIN') continue;
  assert(p.getMode() === 4, 'Face must contain triangles');
  const pos = p.getAttribute('POSITION'), normal = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0');
  assert(pos && normal && uv, 'Face needs POSITION, NORMAL and TEXCOORD_0');
  const indices = p.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
  const transform = inverseHead.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()));
  const normalMatrix = new Matrix3().getNormalMatrix(transform), vertices = new Map();
  for (const i of indices) if (!vertices.has(i)) {
    const point = new Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(transform);
    const n = new Vector3().fromArray(normal.getElement(i, [])).applyNormalMatrix(normalMatrix);
    const tex = uv.getElement(i, []).map(v => v * size);
    assert([...point, ...n, ...tex].every(Number.isFinite), 'Non-finite face data');
    bounds.expandByPoint(point); vertices.set(i, { point, n, tex });
  }
  faces.push({ indices, vertices });
}
assert(faces.length, 'Missing face skin primitive');
const center = bounds.getCenter(new Vector3()), radii = bounds.getSize(new Vector3()).multiplyScalar(0.5);
assert(radii.x > 0 && radii.y > 0 && radii.z > 0, 'Degenerate face bounds');
const nx = new Float32Array(pixels), nz = new Float32Array(pixels), covered = new Uint8Array(pixels);
for (const { indices, vertices } of faces) {
  for (const v of vertices.values()) {
    const ellipsoid = v.point.clone().sub(center).divide(radii).divide(radii).normalize();
    v.n.multiplyScalar(1 - mix).addScaledVector(ellipsoid, mix).normalize();
  }
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map(k => vertices.get(indices[t + k]));
    const [ax, ay] = a.tex, [bx, by] = b.tex, [cx, cy] = c.tex;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-10) continue;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(size - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(size - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / det;
      const v = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / det, w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-6) continue;
      const i = y * size + x; covered[i] = 1;
      nx[i] = right * (u * a.n.x + v * b.n.x + w * c.n.x);
      nz[i] = forward * (u * a.n.z + v * b.n.z + w * c.n.z);
    }
  }
}
// Extend nearest covered normals into unused UV space, avoiding dark atlas borders.
const queue = new Uint32Array(pixels); let tail = 0;
for (let i = 0; i < pixels; i++) if (covered[i]) queue[tail++] = i;
assert(tail, 'Face UV rasterization covered no texels');
console.log(`Face: ${faces.length} primitives, ${tail}/${pixels} covered texels`);
for (let q = 0; q < tail; q++) {
  const i = queue[q], x = i % size;
  for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size]) {
    if (j < 0 || j >= pixels || covered[j]) continue;
    covered[j] = 1; nx[j] = nx[i]; nz[j] = nz[i]; queue[tail++] = j;
  }
}
// R016a sdfBake's original 8-neighbour chamfer distance and angular crossing interpolation.
function distance(mask, target) {
  const d = Float32Array.from(mask, v => v === target ? 0 : Math.hypot(size, size));
  for (const step of [1, -1]) for (let y = step > 0 ? 0 : size - 1; y >= 0 && y < size; y += step)
    for (let x = step > 0 ? 0 : size - 1; x >= 0 && x < size; x += step) {
      const i = y * size + x, px = x - step, py = y - step;
      if (px >= 0 && px < size) d[i] = Math.min(d[i], d[y * size + px] + 1);
      if (py < 0 || py >= size) continue;
      d[i] = Math.min(d[i], d[py * size + x] + 1);
      for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < size) d[i] = Math.min(d[i], d[py * size + x + dx] + Math.SQRT2);
    }
  return d;
}
function signed(mask) {
  const dark = distance(mask, 0), lit = distance(mask, 1);
  return dark.map((d, i) => mask[i] ? d - 0.5 : 0.5 - lit[i]);
}
const preview = await mkdtemp('/tmp/face-sdf-'), data = new Uint8Array(pixels * 4);
const png = (file, buffer, channels) => sharp(buffer, { raw: { width: size, height: size, channels } }).png().toFile(file);
for (const [channel, side, label] of [[0, 1, 'right'], [1, -1, 'left']]) {
  let previous = new Uint8Array(pixels).fill(1), previousDistance = signed(previous);
  const areas = [];
  for (let k = 0; k < count; k++) {
    const angle = Math.PI * k / (count - 1), mask = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      // Intersect successive N·L masks: rear/ear texels cannot re-light in a single-threshold map.
      mask[i] = k === 0 ? 1 : k === count - 1 ? 0 : Number(previous[i] && side * nx[i] * Math.sin(angle) + nz[i] * Math.cos(angle) >= 0);
      assert(k !== 0 || mask[i] === 1); assert(k !== count - 1 || mask[i] === 0);
      assert(mask[i] <= previous[i], `Non-monotonic ${label} mask at ${k}:${i}`);
    }
    const currentDistance = k ? signed(mask) : previousDistance;
    if (k) for (let i = 0; i < pixels; i++) if (previous[i] && !mask[i]) {
      const blend = previousDistance[i] / (previousDistance[i] - currentDistance[i]);
      const crossing = Math.PI * (k - 1 + blend) / (count - 1);
      data[4 * i + channel] = Math.max(1, Math.min(254, Math.round(255 * (1 - Math.cos(crossing)) / 2)));
    }
    areas.push(mask.reduce((sum, v) => sum + v, 0));
    if ([0, Math.round((count - 1) / 3), Math.round((count - 1) / 2), Math.round(2 * (count - 1) / 3), count - 1].includes(k))
      await png(join(preview, `${label}-${Math.round(angle * 180 / Math.PI)}deg.png`), mask.map(v => v * 255), 1);
    previous = mask; previousDistance = currentDistance;
  }
  console.log(`${label} lit counts (asserted endpoints/monotonicity): ${areas.join(', ')}`);
}
for (let i = 0; i < pixels; i++) { assert(data[4 * i] && data[4 * i + 1]); data[4 * i + 3] = 255; }
// PNG scanline 0 is UV v=0. Load as NoColorSpace, flipY=false, generateMipmaps=false.
await png(output, data, 4);
console.log(`PNG: ${resolve(output)}\nMasks: ${preview}\nElapsed: ${((performance.now() - start) / 1000).toFixed(3)}s`);
