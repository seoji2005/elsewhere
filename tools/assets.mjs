import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, textureCompress, meshopt, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'assets/manifest.json'), 'utf8'));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
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
  const chunks = [], fallback = [], size = list => list.reduce((sum, chunk) => sum + chunk.length, 0), used = [];
  const append = (list, bytes) => { const at = size(list); list.push(bytes, new Uint8Array((4 - bytes.length % 4) % 4)); return at; };
  for (const image of json.images) {
    const side = /_nml/.test(image.name) ? maxSize / 2 : maxSize, webp = await sharp(data(image.bufferView))
      .resize(side, side, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    image.bufferView = used.push({ buffer: 0, byteOffset: append(chunks, webp), byteLength: webp.length }) - 1;
    image.mimeType = 'image/webp';
  }
  for (const [i, accessor] of json.accessors.entries()) {
    const bytes = data(accessor.bufferView).subarray(accessor.byteOffset ?? 0), { count } = accessor;
    const stride = bytes.length / count, mode = triangles.has(i) ? 'TRIANGLES' : 'ATTRIBUTES';
    const packed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    accessor.bufferView = used.push({ buffer: 1, byteOffset: append(fallback, bytes), byteLength: bytes.length,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(chunks, packed), byteLength: packed.length,
        byteStride: stride, count, mode } } }) - 1;
    delete accessor.byteOffset;
  }
  json.bufferViews = used;
  json.buffers = [{ byteLength: size(chunks) }, { byteLength: size(fallback), extensions: { EXT_meshopt_compression: { fallback: true } } }];
  for (const key of ['extensionsUsed', 'extensionsRequired']) json[key] = [...(json[key] ?? []), 'EXT_meshopt_compression'];
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
