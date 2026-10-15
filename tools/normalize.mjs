import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { kind: { type: 'string' }, height: { type: 'string' } } });
  const budget = { prop: 3000, tree: 5000, building: 8000 }[values.kind], height = Number(values.height);
  if (positionals.length !== 2 || !budget || !Number.isFinite(height) || height <= 0 || positionals.some(p => extname(p).toLowerCase() !== '.glb') || resolve(positionals[0]) === resolve(positionals[1]))
    throw Error('Usage: node tools/normalize.mjs <in.glb> <out.glb> --kind prop|building|tree --height <positive metres>');
  const reportPath = resolve(positionals[1]) + '.json';
  rmSync(reportPath, { force: true });
  execFileSync(process.env.BLENDER || '/usr/local/bin/blender', ['--background', '--factory-startup', '--python', fileURLToPath(new URL('./blender/normalize.py', import.meta.url)), '--', ...positionals.map(p => resolve(p)), values.kind, String(height)], { stdio: ['ignore', 2, 2], timeout: 120000 });
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.triangles_after > budget || Math.abs(report.size_m.height - height) > 1e-5) throw Error('Output failed budget/height checks');
  console.log(JSON.stringify(report));
} catch (error) { console.error(error.message); process.exitCode = 1; }
