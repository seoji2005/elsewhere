import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const shots = ['look=b', 'look=b@cam=18,18,18,0,0,0', 'look=b@cam=-18,18,18,0,0,0'];
const rows = [];
for (const gl of ['swiftshader', 'vulkan']) {
  for (const mode of ['legacy', 'shared']) {
    const start = performance.now();
    const run = spawnSync(process.execPath, ['tools/shot.mjs', ...shots], {
      env: { ...process.env, SHOT_GL: gl, SHOT_MODE: mode }, encoding: 'utf8',
    });
    rows.push({ mode, requested: gl, actual: run.stdout?.match(/GL=(\w+)/)?.[1] ?? '-',
      seconds: ((performance.now() - start) / 1000).toFixed(2), result: run.status === 0 ? 'PASS' : 'FAIL' });
    if (run.status !== 0) console.error(run.stderr || run.error);
  }
}
console.table(rows);
if (rows.some(row => row.result === 'FAIL')) process.exitCode = 1;
