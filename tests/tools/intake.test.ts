import { test, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore Tool is an ES module, outside the application TS project.
import { validateAsset, orientAsset, runIntake } from '../../tools/intake.mjs';

const asset = { id: 'bench', kind: 'prop', file: 'bench.glb', height: 2, front: '+z' };
test('accepts static kinds and skips characters before requiring static metadata', () => {
  for (const kind of ['prop', 'tree', 'building']) expect(validateAsset({ ...asset, kind }).status).toBe('ready');
  expect(validateAsset({ id: 'person', kind: 'character' })).toEqual({ status: 'skipped', reason: '미지원(캐릭터는 리깅·표정 경로 별도 카드)' });
  for (const patch of [{ id: '../bad' }, { kind: 'vehicle' }, { height: 0 }, { height: Infinity }, { height: '2' }, { front: '+y' }, { front: 'toString' }, { file: '../x.glb' }, { file: '/x.glb' }, { file: 'x.obj' }, { interactions: [{ name: 'seat', position: [0, NaN, 0] }] }, { interactions: [{ name: 'seat', position: [0, 0] }] }]) {
    expect(() => validateAsset({ ...asset, ...patch })).toThrow();
  }
});

async function fixture(path: string) {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([-1, 0, -2, 1, 0, -2, 1, 2, 2]));
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', positions));
  const scene = doc.createScene().addChild(doc.createNode().setMesh(mesh));
  doc.getRoot().setDefaultScene(scene); await new NodeIO().write(path, doc);
}
test('rotates actual bounds and interaction points into +Z for every front', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intake-'));
  try {
    for (const front of ['+z', '-z', '+x', '-x']) {
      const path = join(dir, 'test.glb'); await fixture(path);
      const vector = { '+z': [0, 1, 1], '-z': [0, 1, -1], '+x': [1, 1, 0], '-x': [-1, 1, 0] }[front];
      const result = await orientAsset(path, { ...asset, front, interactions: [{ name: 'front', position: vector }] });
      expect(result.front).toBe('+z'); expect(result.size_m.height).toBeCloseTo(2);
      expect(result.size_m.width).toBeCloseTo(front.endsWith('x') ? 4 : 2);
      expect(result.size_m.depth).toBeCloseTo(front.endsWith('x') ? 2 : 4);
      expect(result.collision.min[1]).toBeCloseTo(0);
      result.interactions[0].position.forEach((n: number, i: number) => expect(n).toBeCloseTo([0, 1, 1][i]));
      expect((await new NodeIO().read(path)).getRoot().getDefaultScene()?.listChildren()[0].getName()).toBe('IntakeFront');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writes success, skipped and failure reports without Blender, preserves sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intake-')), previous = process.env.BLENDER;
  try {
    const source = join(dir, 'bench.glb'); await fixture(source);
    const original = readFileSync(source), spec = join(dir, '.intake.json'), out = join(dir, 'out');
    const fake = join(dir, 'blender');
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), args = process.argv.slice(process.argv.indexOf('--') + 1);
if (args.length === 4) { fs.copyFileSync(args[0], args[1]); fs.writeFileSync(args[1] + '.json', JSON.stringify({triangles_before:1,triangles_after:1,palette:['stone'],size_m:{height:2}})); }
else for (const name of ['front.png','angle45.png']) fs.writeFileSync(path.join(path.dirname(args[0]),name), 'mock PNG');
`, { mode: 0o755 });
    process.env.BLENDER = fake;
    symlinkSync('/etc/hosts', join(dir, 'escape.glb'));
    writeFileSync(spec, JSON.stringify({ assets: [asset, { id: 'person', kind: 'character' }, { ...asset, id: 'bad', height: -1 }, { ...asset, id: 'missing', file: 'missing.glb' }, { ...asset, id: 'escape', file: 'escape.glb' }, asset] }));
    const reports = await runIntake({ spec, inputRoot: dir, out });
    expect(reports.map((r: any) => r.status)).toEqual(['ok', 'skipped', 'failed', 'failed', 'failed', 'failed']);
    expect(reports[0]).toMatchObject({ id: 'bench', kind: 'prop', triangles_after: 1, size_m: { width: 2, height: 2, depth: 4 }, collision: { type: 'aabb', min: [-1, 0, -2], max: [1, 2, 2] }, previews: ['bench/front.png', 'bench/angle45.png'] });
    expect(reports[0].bytes).toBe(readFileSync(join(out, 'bench/bench.glb')).length);
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).assets).toEqual(reports);
    expect(reports[4].reason).toBe('GLB escapes input root');
    expect(reports[5].reason).toBe('Duplicate id'); expect(existsSync(join(out, 'person'))).toBe(false);
    expect(readFileSync(source)).toEqual(original);
    writeFileSync(spec, JSON.stringify({ assets: [{ ...asset, file: 'out/bench/bench.glb' }] }));
    await expect(runIntake({ spec, inputRoot: dir, out })).rejects.toThrow('overlaps');
    writeFileSync(spec, JSON.stringify({ assets: [] }));
    await expect(runIntake({ spec, inputRoot: dir, out })).rejects.toThrow('nonempty');
  } finally {
    if (previous === undefined) delete process.env.BLENDER; else process.env.BLENDER = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
