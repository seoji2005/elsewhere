import { readFile, mkdir, stat } from 'node:fs/promises';
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
await mkdir(join(root, 'src/assets'), { recursive: true });
for (const [bundle, { directory, files }] of Object.entries(manifest)) {
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
  await document.transform(
    prune({ keepLeaves: true }), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }), unpartition(),
  );
  const output = join(root, `src/assets/${bundle}.glb`);
  await io.write(output, document);
  console.log(`${bundle}: ${( (await stat(output)).size / 1024).toFixed(1)} KiB`);
}
