import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, textureCompress, meshopt, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'assets/manifest.json'), 'utf8'));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
// VRM: gltf-transform would drop the VRM extension, so rewrite the GLB directly (all indices stay valid):
// drop the thumbnail, merge primitives sharing a material, webp textures, meshopt-encoded geometry.
async function shrinkVrm(file, output, maxSize) {
  const glb = await readFile(file), length = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + length));
  const bin = glb.subarray(28 + length), views = json.bufferViews, raw = new Map(), triangles = new Set();
  const data = i => raw.get(i) ?? new Uint8Array(bin.subarray(views[i].byteOffset ?? 0, (views[i].byteOffset ?? 0) + views[i].byteLength));
  const meta = json.extensions.VRM.meta;
  if (meta.texture === json.textures.length - 1) { json.images.splice(json.textures.pop().source, 1); delete meta.texture; }
  for (const mesh of json.meshes) mesh.primitives = [...Map.groupBy(mesh.primitives,
    p => JSON.stringify([p.material, p.attributes, p.targets])).values()].map(([first, ...rest]) => {
    if (rest.length) {
      const all = [first, ...rest].flatMap(p => { const a = json.accessors[p.indices], bytes = data(a.bufferView).slice();
        return [...new (a.componentType === 5125 ? Uint32Array : Uint16Array)(bytes.buffer, a.byteOffset ?? 0, a.count)]; });
      raw.set(views.push({}) - 1, new Uint8Array(new Uint32Array(all).buffer));
      first = { ...first, indices: json.accessors.push({ bufferView: views.length - 1, componentType: 5125, count: all.length, type: 'SCALAR' }) - 1 };
    }
    triangles.add(first.indices);
    return first;
  });
  // Keep only the expressions the game plays (blink, wink, smile, talk): each dropped morph target is ~6 KiB.
  const master = json.extensions.VRM.blendShapeMaster, wanted = new Map();
  master.blendShapeGroups = master.blendShapeGroups.filter(group => ['neutral', 'blink', 'blink_l', 'blink_r', 'joy', 'a'].includes(group.presetName));
  for (const { binds } of master.blendShapeGroups) for (const bind of binds) (wanted.get(bind.mesh) ?? wanted.set(bind.mesh, new Set()).get(bind.mesh)).add(bind.index);
  json.meshes.forEach((mesh, m) => {
    const list = [...wanted.get(m) ?? []].sort((a, b) => a - b);
    for (const primitive of mesh.primitives) if (primitive.targets) primitive.targets = list.map(i => primitive.targets[i]);
    for (const { binds } of master.blendShapeGroups) for (const bind of binds) if (bind.mesh === m) bind.index = list.indexOf(bind.index);
    if (mesh.weights) mesh.weights = list.map(i => mesh.weights[i]);
    if (mesh.extras?.targetNames) mesh.extras.targetNames = list.map(i => mesh.extras.targetNames[i]);
  });
  // Hair only: retain authored vertices/UVs/skin weights and all VRM spring nodes; replace indices only.
  // Lock strand borders and joint-palette transitions so disconnected strands keep their outline and deformation.
  const array = i => {
    const a = json.accessors[i], bytes = data(a.bufferView), n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    return new Type(bytes.buffer, bytes.byteOffset + (a.byteOffset ?? 0), a.count * n);
  };
  for (const mesh of json.meshes.filter(mesh => /^Hair/i.test(mesh.name))) {
    let before = 0, after = 0;
    for (const p of mesh.primitives) {
      const indices = new Uint32Array(array(p.indices)), positions = array(p.attributes.POSITION);
      const normals = array(p.attributes.NORMAL), uv = array(p.attributes.TEXCOORD_0);
      const weights = array(p.attributes.WEIGHTS_0), joints = array(p.attributes.JOINTS_0);
      const count = positions.length / 3, attributes = new Float32Array(count * 9), lock = new Uint8Array(count);
      for (let v = 0; v < count; v++) {
        attributes.set(normals.subarray(v * 3, v * 3 + 3), v * 9);
        attributes.set(uv.subarray(v * 2, v * 2 + 2), v * 9 + 3);
        attributes.set(weights.subarray(v * 4, v * 4 + 4), v * 9 + 5);
      }
      for (let i = 0; i < indices.length; i += 3) for (let e = 0; e < 3; e++) {
        const a = indices[i + e], b = indices[i + (e + 1) % 3];
        if (joints.subarray(a * 4, a * 4 + 4).some((joint, c) => joint !== joints[b * 4 + c])) lock[a] = lock[b] = 1;
      }
      const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, 9,
        [0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1], lock, Math.floor(indices.length / 6) * 3, 0.01, ['LockBorder']);
      const a = json.accessors[p.indices];
      raw.set(a.bufferView, new Uint8Array(reduced.buffer, reduced.byteOffset, reduced.byteLength));
      Object.assign(a, { componentType: 5125, count: reduced.length });
      delete a.byteOffset; delete a.min; delete a.max;
      before += indices.length / 3; after += reduced.length / 3;
      console.log(`${basename(file)} ${mesh.name}: error=${error.toFixed(6)}`);
    }
    console.log(`${basename(file)} hair triangles: ${before} -> ${after} (${(100 * after / before).toFixed(1)}%)`);
  }
  // Quantize (KHR_mesh_quantization; model.ts expands them back to floats): positions int16 over +-2 m, normals int8,
  // UVs and skin weights uint16. Morph deltas use half the scale so +-2 fits. Unreferenced accessors are emptied.
  const roles = new Map(json.skins.map(skin => [skin.inverseBindMatrices, 'IBM']));
  for (const { primitives } of json.meshes) for (const p of primitives) {
    roles.set(p.indices, 'INDICES');
    for (const [name, i] of Object.entries(p.attributes)) roles.set(i, name);
    for (const target of p.targets ?? []) for (const [name, i] of Object.entries(target)) roles.set(i, 'TARGET_' + name);
  }
  const quant = { POSITION: [Int16Array, 5122, 32767 / 2, 8], TARGET_POSITION: [Int16Array, 5122, 32767 / 2, 8],
    NORMAL: [Int8Array, 5120, 127, 4], TARGET_NORMAL: [Int8Array, 5120, 127 / 2, 4],
    TEXCOORD_0: [Uint16Array, 5123, 65535, 4], WEIGHTS_0: [Uint16Array, 5123, 65535, 8] };
  const chunks = [], fallback = [], size = list => list.reduce((sum, chunk) => sum + chunk.length, 0), used = [];
  const append = (list, bytes) => { const at = size(list); list.push(bytes, new Uint8Array((4 - bytes.length % 4) % 4)); return at; };
  for (const image of json.images) {
    const side = /_nml/.test(image.name) ? maxSize / 2 : maxSize, webp = await sharp(data(image.bufferView))
      .resize(side, side, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    image.bufferView = used.push({ buffer: 0, byteOffset: append(chunks, webp), byteLength: webp.length }) - 1;
    image.mimeType = 'image/webp';
  }
  for (const [i, accessor] of json.accessors.entries()) {
    if (!roles.has(i)) { accessor.count = 1; for (const key of ['bufferView', 'byteOffset', 'min', 'max']) delete accessor[key]; continue; }
    let bytes = data(accessor.bufferView).subarray(accessor.byteOffset ?? 0);
    const { count } = accessor, n = { VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type], q = quant[roles.get(i)];
    if (q && accessor.componentType === 5126) {
      const [Type, componentType, scale, byteStride] = q, floats = new Float32Array(bytes.buffer, bytes.byteOffset, count * n);
      const limit = Type === Int8Array ? 127 : Type === Int16Array ? 32767 : 65535, per = byteStride / Type.BYTES_PER_ELEMENT;
      const out = new Type(count * per);
      for (let v = 0; v < count; v++) for (let c = 0; c < n; c++) // VRoid normals are not exactly unit length: clamp
        out[v * per + c] = Math.max(Type === Uint16Array ? 0 : -limit, Math.min(limit, Math.round(floats[v * n + c] * scale)));
      bytes = new Uint8Array(out.buffer);
      Object.assign(accessor, { componentType, normalized: true });
      for (const key of ['min', 'max']) if (accessor[key]) accessor[key] = accessor[key].map(x => Math.round(x * scale));
    }
    const stride = bytes.length / count, mode = triangles.has(i) ? 'TRIANGLES' : 'ATTRIBUTES';
    const packed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    accessor.bufferView = used.push({ buffer: 1, byteOffset: append(fallback, bytes), byteLength: bytes.length,
      ...mode === 'ATTRIBUTES' && { byteStride: stride }, // padded int8/int16 vertex layouts need the stride here too
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(chunks, packed), byteLength: packed.length,
        byteStride: stride, count, mode } } }) - 1;
    delete accessor.byteOffset;
  }
  json.bufferViews = used;
  json.buffers = [{ byteLength: size(chunks) }, { byteLength: size(fallback), extensions: { EXT_meshopt_compression: { fallback: true } } }];
  for (const key of ['extensionsUsed', 'extensionsRequired']) json[key] = [...(json[key] ?? []), 'EXT_meshopt_compression', 'KHR_mesh_quantization'];
  const text = Buffer.from(JSON.stringify(json)), pad = Buffer.alloc((4 - text.length % 4) % 4, ' '), body = Buffer.concat(chunks);
  await writeFile(output, Buffer.concat([new Uint8Array(new Uint32Array([0x46546c67, 2, 28 + text.length + pad.length + body.length,
    text.length + pad.length, 0x4e4f534a]).buffer), text, pad, new Uint8Array(new Uint32Array([body.length, 0x004e4942]).buffer), body]));
}

await mkdir(join(root, 'src/assets'), { recursive: true });
const only = process.argv.slice(2); // optional bundle names: rebuild only those
for (const [bundle, { directory, files, clips, maxTexture }] of Object.entries(manifest)) {
  if (only.length && !only.includes(bundle)) continue;
  if (files[0].endsWith('.vrm')) {
    await shrinkVrm(join(directory, files[0]), join(root, `src/assets/${bundle}.vrm`), maxTexture);
    console.log(`${bundle}: ${((await stat(join(root, `src/assets/${bundle}.vrm`))).size / 1024).toFixed(1)} KiB`);
    continue;
  }
  const document = new Document();
  const scene = document.createScene(bundle);
  document.getRoot().setDefaultScene(scene);
  for (const file of files) {
    const source = await io.read(join(directory, file));
    const sourceScene = source.getRoot().getDefaultScene() ?? source.getRoot().listScenes()[0];
    if (!sourceScene) throw Error(`Missing scene: ${file}`);
    const map = mergeDocuments(document, source);
    const node = document.createNode(basename(file, '.gltf').replace(/\.glb$/, ''));
    for (const child of sourceScene.listChildren()) node.addChild(map.get(child));
    scene.addChild(node);
    for (const importedScene of source.getRoot().listScenes()) map.get(importedScene).dispose();
  }
  if (clips) for (const a of document.getRoot().listAnimations()) if (!clips.includes(a.getName())) { a.listSamplers().forEach(s => s.dispose()); a.dispose(); }
  await document.transform(
    prune({ keepLeaves: true }), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }), unpartition(),
  );
  const output = join(root, `src/assets/${bundle}.glb`);
  await io.write(output, document);
  console.log(`${bundle}: ${( (await stat(output)).size / 1024).toFixed(1)} KiB`);
}
