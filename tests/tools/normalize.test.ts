import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('normalizes dense and textured primitives into bounded, grounded palette GLBs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-'));
  try {
    const script = join(dir, 'fixtures.py');
    writeFileSync(script, `import bpy, sys\nfrom pathlib import Path\np = Path(sys.argv[-1])
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, location=(4, 2, 7)); bpy.context.object.scale=(2, 1, 3)
bpy.ops.export_scene.gltf(filepath=str(p/'dense.glb'), export_format='GLB', use_selection=True)
bpy.ops.object.delete(use_global=False); bpy.ops.mesh.primitive_cube_add(location=(-3, 4, 6))
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=7); bpy.ops.object.mode_set(mode='OBJECT')
m=bpy.data.materials.new('texture'); m.use_nodes=True; n=m.node_tree.nodes.new('ShaderNodeTexImage')
im=bpy.data.images.new('four colors', width=2, height=2); im.pixels[:]=[.6,.36,.3,1, .8,.73,.62,1, .2,.25,.35,1, .24,.42,.32,1]; n.image=im
m.node_tree.links.new(n.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color']); bpy.context.object.data.materials.append(m)
bpy.ops.export_scene.gltf(filepath=str(p/'textured.glb'), export_format='GLB', use_selection=True)
`);
    execFileSync('/usr/local/bin/blender', ['--background', '--factory-startup', '--python', script, '--', dir], { stdio: 'inherit' });
    for (const [name, kind, budget] of [['dense', 'prop', 3000], ['textured', 'building', 8000], ['dense', 'tree', 5000]] as const) {
      const out = join(dir, `${name}-${kind}.glb`); execFileSync('node', ['tools/normalize.mjs', join(dir, `${name}.glb`), out, '--kind', kind, '--height', '2.5'], { stdio: 'inherit' }); const report = JSON.parse(readFileSync(out + '.json', 'utf8'));
      const b = readFileSync(out), gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()), primitives = gltf.meshes.flatMap((m: any) => m.primitives);
      expect(report.triangles_after).toBeLessThanOrEqual(budget); expect(report.size_m.height).toBeCloseTo(2.5, 5);
      expect(primitives.reduce((s: number, p: any) => s + gltf.accessors[p.indices].count / 3, 0)).toBe(report.triangles_after);
      expect(gltf.textures ?? []).toHaveLength(0); expect(gltf.images ?? []).toHaveLength(0);
      const palette = JSON.parse(readFileSync('docs/look/palette.json', 'utf8'));
      expect(report.palette.every((n: string) => palette[n])).toBe(true); expect(report.palette.length).toBeGreaterThan(name === 'textured' ? 1 : 0);
      expect(Math.min(...primitives.map((p: any) => gltf.accessors[p.attributes.POSITION].min[1]))).toBeCloseTo(0, 5);
      expect(Math.max(...primitives.map((p: any) => gltf.accessors[p.attributes.POSITION].max[1]))).toBeCloseTo(2.5, 5);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120000);
