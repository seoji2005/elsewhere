import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync, rmSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';

const yaw = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };
const unsupported = '미지원(캐릭터는 리깅·표정 경로 별도 카드)';
const inside = (root, path) => { const p = relative(root, path); return p !== '..' && !p.startsWith('../') && !isAbsolute(p); };
export function validateAsset(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(asset.id)) throw Error('Invalid id');
  if (asset.kind === 'character') return { status: 'skipped', reason: unsupported };
  if (!['prop', 'tree', 'building'].includes(asset.kind)) throw Error('Invalid kind');
  if (typeof asset.height !== 'number' || !Number.isFinite(asset.height) || asset.height <= 0) throw Error('Invalid height');
  if (!Object.hasOwn(yaw, asset.front)) throw Error('Invalid front: use +x|-x|+z|-z');
  if (typeof asset.file !== 'string' || isAbsolute(asset.file) || asset.file.split(/[\\/]/).includes('..') || extname(asset.file).toLowerCase() !== '.glb') throw Error('Invalid GLB path');
  const points = asset.interactions ?? [];
  if (!Array.isArray(points) || points.some(p => !p || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(Number.isFinite)) || new Set(points.map(p => p.name)).size !== points.length) throw Error('Invalid interactions');
  return { status: 'ready' };
}

// Interaction positions: metres in the normalized, grounded GLB, before front rotation (Y up).
export async function orientAsset(path, asset) {
  const io = new NodeIO(), doc = await io.read(path), scene = doc.getRoot().getDefaultScene();
  if (!scene || doc.getRoot().listScenes().length !== 1) throw Error('Expected one normalized scene');
  const angle = yaw[asset.front], root = doc.createNode('IntakeFront').setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
  for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
  scene.addChild(root);
  const { min, max } = getBounds(scene);
  if (![...min, ...max].every(Number.isFinite) || max[1] <= min[1]) throw Error('Invalid bounds');
  const size = max.map((n, i) => n - min[i]);
  await io.write(path, doc);
  return {
    front: '+z', size_m: { width: size[0], height: size[1], depth: size[2] },
    collision: { type: 'aabb', min, max },
    interactions: (asset.interactions ?? []).map(p => {
      const [x, y, z] = p.position, c = Math.cos(angle), s = Math.sin(angle);
      return { name: p.name, position: [c * x + s * z, y, -s * x + c * z] };
    }),
  };
}

export async function runIntake({ spec, inputRoot, out }) {
  const data = JSON.parse(readFileSync(spec, 'utf8'));
  if (!Array.isArray(data.assets) || !data.assets.length) throw Error('Expected nonempty assets array');
  inputRoot = realpathSync(inputRoot); out = resolve(out);
  for (const a of data.assets) if (typeof a?.file === 'string' && inside(out, resolve(inputRoot, a.file))) throw Error('Output overlaps an input');
  mkdirSync(out, { recursive: true });
  const reports = [], ids = new Set();
  for (const asset of data.assets) {
    const report = { id: asset?.id ?? null, kind: asset?.kind ?? null, source: asset?.file ?? null, status: 'failed' };
    let dir, stage = 'input';
    try {
      const validation = validateAsset(asset);
      if (ids.has(asset.id)) throw Error('Duplicate id');
      ids.add(asset.id);
      if (validation.status === 'skipped') { Object.assign(report, validation); continue; }
      const source = realpathSync(resolve(inputRoot, asset.file));
      if (!inside(inputRoot, source)) throw Error('GLB escapes input root');
      dir = join(out, asset.id); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
      const target = join(dir, asset.id + '.glb');
      stage = 'normalize';
      execFileSync(process.execPath, [fileURLToPath(new URL('./normalize.mjs', import.meta.url)), source, target, '--kind', asset.kind, '--height', String(asset.height)], { stdio: 'ignore', timeout: 150000 });
      const normalized = JSON.parse(readFileSync(target + '.json', 'utf8'));
      const geometry = await orientAsset(target, asset);
      stage = 'preview';
      execFileSync(process.env.BLENDER || '/usr/local/bin/blender', ['--background', '--factory-startup', '--python-exit-code', '1', '--python', fileURLToPath(new URL('./blender/preview.py', import.meta.url)), '--', target], { stdio: 'ignore', timeout: 240000 });
      for (const file of ['front.png', 'angle45.png']) if (!statSync(join(dir, file)).size) throw Error('Missing preview');
      Object.assign(report, normalized, geometry, { status: 'ok', bytes: statSync(target).size, glb: `${asset.id}/${asset.id}.glb`, previews: [`${asset.id}/front.png`, `${asset.id}/angle45.png`] });
    } catch (error) {
      // Do not include subprocess stdout/stderr or environment values in public reports.
      report.reason = error.code || error.status != null || error.signal ? `${stage} failure: ${error.code ?? error.status ?? error.signal}` : error.message;
      if (dir) rmSync(dir, { recursive: true, force: true });
    } finally { reports.push(report); }
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ assets: reports }, null, 2) + '\n');
  return reports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { spec: { type: 'string', default: '.intake.json' }, 'input-root': { type: 'string', default: '.' }, out: { type: 'string', default: 'intake-out' } } });
    const reports = await runIntake({ spec: values.spec, inputRoot: values['input-root'], out: values.out });
    console.log(`Intake: ${reports.filter(r => r.status === 'ok').length} ok, ${reports.filter(r => r.status === 'skipped').length} skipped, ${reports.filter(r => r.status === 'failed').length} failed`);
    if (reports.some(r => r.status === 'failed')) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
